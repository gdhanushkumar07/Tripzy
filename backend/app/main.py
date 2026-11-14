"""Tripzy API (FastAPI)."""

from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Literal, Optional

import contextvars
import os

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import store
from .data.cities import CITIES, PLACE_BY_ID
from .engines import brief as B
from .engines import dna as D
from .engines import ripple as R
from .engines import trip as T
from .engines.live import train_status
from .engines.planner import to_seq
from .engines.routing import route_geometry
from .engines.timeutil import to_min
from .graph import run_stream

app = FastAPI(title="Tripzy Intelligence", version="2.0.0")

# ------------------------------------------------------------------ trust boundary
# The engine listens on loopback and is reached only through the platform's
# authenticated proxy (/api/tripzy/*). The proxy sends a shared key plus the
# signed-in user's id; the engine enforces ownership from that id.
ENGINE_KEY = os.getenv("TRIPZY_ENGINE_KEY", "")
_user: contextvars.ContextVar[Optional[int]] = contextvars.ContextVar("tripzy_user", default=None)
_user_name: contextvars.ContextVar[str] = contextvars.ContextVar("tripzy_user_name", default="")


@app.middleware("http")
async def trust_boundary(request: Request, call_next):
    if request.url.path != "/api/health" and request.url.path.startswith("/api/"):
        if ENGINE_KEY and request.headers.get("x-tripzy-key") != ENGINE_KEY:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
    uid = request.headers.get("x-tripzy-user")
    _user.set(int(uid) if uid and uid.isdigit() else None)
    from urllib.parse import unquote
    _user_name.set(unquote(request.headers.get("x-tripzy-user-name", "")))
    return await call_next(request)


def current_user(required: bool = False) -> Optional[int]:
    u = _user.get()
    if required and u is None:
        raise HTTPException(401, "Sign in to continue")
    return u


def _get(trip_id: str, write: bool = False) -> dict:
    """Load a capsule the caller may access. Unowned capsules are anonymous drafts:
    readable by anyone with the id, claimed by the first signed-in writer."""
    c = store.load(trip_id)
    if not c:
        raise HTTPException(404, "Trip not found")
    u = current_user()
    owner = c.get("owner")
    if owner is not None and owner != u:
        raise HTTPException(404, "Trip not found")
    if write:
        if u is None:
            raise HTTPException(401, "Sign in to continue")
        if owner is None:
            c["owner"] = u
            store.save(c)
    return c


# ------------------------------------------------------------------ discovery

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/cities")
def cities():
    return [{"key": k, "name": c["name"], "state": c["state"],
             "stations": c["stations"], "stay_areas": c["stay_areas"]} for k, c in CITIES.items()]


class BriefIn(BaseModel):
    text: str


@app.post("/api/brief/parse")
def parse_brief(body: BriefIn):
    return B.parse(body.text).model_dump()


@app.get("/api/dna/cards")
def dna_cards():
    return [{"id": c["id"], "a": {k: v for k, v in c["a"].items() if k != "fx"},
             "b": {k: v for k, v in c["b"].items() if k != "fx"}} for c in D.CARDS]


# ------------------------------------------------------------------ compose (SSE)

class ComposeIn(BaseModel):
    brief: dict
    swipes: dict = {}
    travellers: Optional[list] = None
    stay_id: Optional[str] = None


@app.post("/api/trips/compose")
async def compose(body: ComposeIn):
    brief = B.TripBrief(**{k: v for k, v in body.brief.items() if k in B.TripBrief.model_fields}).model_dump()
    owner = current_user()
    profile = store.load_profile(owner) if owner else None

    def gen():
        try:
            for node, step, capsule in run_stream({"brief": brief, "swipes": body.swipes, "profile": profile,
                                                   "travellers": body.travellers, "stay_id": body.stay_id}):
                if step:
                    yield {"event": "step", "data": json.dumps({"node": node, **step})}
                if capsule:
                    capsule["owner"] = owner
                    store.save(capsule)
                    yield {"event": "done", "data": json.dumps({"id": capsule["id"]})}
        except Exception as e:  # surface to UI
            yield {"event": "error", "data": json.dumps({"message": str(e)})}

    return EventSourceResponse(gen())


@app.get("/api/trips/{trip_id}")
def get_trip(trip_id: str):
    return _get(trip_id)


@app.get("/api/trips/{trip_id}/route/{day}")
def day_route(trip_id: str, day: int):
    c = _get(trip_id)
    d = c["days"][day]
    stay = c["stay"]
    stations = {f"station:{s['id']}": (s["lat"], s["lon"]) for s in CITIES[c["city_key"]]["stations"]}
    pts = [(stay["lat"], stay["lon"])]
    for b in d["blocks"]:
        if b["kind"] == "leg":
            continue
        if b.get("lat"):
            pts.append((b["lat"], b["lon"]))
        elif b.get("node") in stations:
            pts.append(stations[b["node"]])
        elif b.get("node", "").startswith("stay:"):
            pts.append((stay["lat"], stay["lon"]))
    pts.append((stay["lat"], stay["lon"]))
    dedup = [p for i, p in enumerate(pts) if i == 0 or p != pts[i - 1]]
    return {"line": route_geometry(dedup) or [list(p) for p in dedup], "points": dedup}


# ------------------------------------------------------------------ planning edits

class EditIn(BaseModel):
    text: str


@app.post("/api/trips/{trip_id}/edit")
def edit(trip_id: str, body: EditIn):
    c = _get(trip_id, write=True)
    ops = B.parse_edit(body.text, c["city_key"], len(c["days"]))
    if not ops:
        return {"capsule": c, "messages": ["I didn't catch a change. Try 'make day 2 lighter', "
                                           "'add Golconda', 'skip Snow World', 'dad can't climb' or 'start later'."]}
    before = {d["index"]: {b.get("place_id") for b in d["blocks"] if b["kind"] == "place"} for d in c["days"]}
    msgs = T.recompose_after_edit(c, ops)
    changes = []
    for d in c["days"]:
        after = {b.get("place_id") for b in d["blocks"] if b["kind"] == "place"}
        add, rem = after - before.get(d["index"], set()), before.get(d["index"], set()) - after
        if add or rem:
            changes.append({"day": d["index"] + 1, "added": [PLACE_BY_ID[x]["name"] for x in add],
                            "removed": [PLACE_BY_ID[x]["name"] for x in rem]})
    store.save(c)
    return {"capsule": c, "messages": msgs, "changes": changes}


class StayIn(BaseModel):
    stay_id: str


@app.post("/api/trips/{trip_id}/stay")
def set_stay(trip_id: str, body: StayIn):
    c = _get(trip_id, write=True)
    opt = next((o for o in c["stay_options"] if o["id"] == body.stay_id), None)
    if not opt:
        raise HTTPException(400, "Unknown stay area")
    for o in c["stay_options"]:
        o["chosen"] = o["id"] == body.stay_id
    c["stay"] = opt
    T.compose(c)
    store.save(c)
    return c


class ChooseIn(BaseModel):
    day: int
    block_id: str
    place_id: str


@app.post("/api/trips/{trip_id}/choose")
def choose(trip_id: str, body: ChooseIn):
    """Decision Card: user picks an alternative (meal option or Plan B)."""
    c = _get(trip_id, write=True)
    ctx = T.build_ctx(c)
    d = c["days"][body.day]
    seq = to_seq(d["blocks"])
    for it in seq:
        if it.get("id") == body.block_id:
            if body.place_id not in PLACE_BY_ID:
                raise HTTPException(400, "Unknown place")
            it["place_id"] = body.place_id
            it["user_locked"] = True
            it.pop("plan_b", None)
            it["why"] = "Your pick"
            if it["kind"] in ("meal", "rest"):
                it["dwell"] = PLACE_BY_ID[body.place_id]["dwell"]
                it["name"] = PLACE_BY_ID[body.place_id]["name"]
            break
    else:
        raise HTTPException(404, "Block not found")
    T.retime_day(c, ctx, d, seq)
    T.finish(c, ctx)
    store.save(c)
    return c


# ------------------------------------------------------------------ bookings (fixed anchors)

class BookingIn(BaseModel):
    kind: Literal["arrival", "departure"]
    mode: Literal["train", "flight", "bus"] = "train"
    number: str = ""
    date: str
    time: str
    station_id: str
    pnr: Optional[str] = None


@app.post("/api/trips/{trip_id}/bookings")
def add_booking(trip_id: str, body: BookingIn):
    c = _get(trip_id, write=True)
    if not re.fullmatch(r"\d{2}:\d{2}", body.time):
        raise HTTPException(400, "time must be HH:MM")
    bk = {"id": secrets.token_hex(3), **body.model_dump(), "live_delay": 0}
    c["bookings"] = [b for b in c["bookings"] if not (b["kind"] == bk["kind"] and b["date"] == bk["date"])] + [bk]
    T.compose(c)
    store.save(c)
    return c


class ParseTicketIn(BaseModel):
    text: str
    city_key: str


@app.post("/api/bookings/parse")
def parse_ticket(body: ParseTicketIn):
    """Pull PNR / train no / date / time / station from pasted confirmation text."""
    t = body.text
    out: dict = {"mode": "flight" if re.search(r"\b(flight|indigo|6E|air india|AI-?\d)", t, re.I) else "train"}
    if m := re.search(r"PNR[^\d]{0,10}(\d{10})", t, re.I):
        out["pnr"] = m[1]
    if m := re.search(r"(?:train|tr\.?)\s*(?:no\.?|number|#)?\s*(?:/\s*name)?\s*[:\-]?\s*(\d{5})", t, re.I):
        out["number"] = m[1]
    elif m := re.search(r"\b(6E|AI|UK|SG|QP)\s*-?\s*(\d{2,4})\b", t):
        out["number"] = f"{m[1]} {m[2]}"
    if m := re.search(r"(\d{4}-\d{2}-\d{2})", t):
        out["date"] = m[1]
    elif m := re.search(r"(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{4})", t):
        mon = B.MONTHS.get(m[2].lower()[:3])
        if mon:
            out["date"] = f"{m[3]}-{mon:02d}-{int(m[1]):02d}"
    times = re.findall(r"\b([01]\d|2[0-3])[:.]([0-5]\d)\b", t)
    if m := re.search(r"arr(?:ival)?\.?\s*(?:time)?\s*[:\-]?\s*([01]\d|2[0-3])[:.]([0-5]\d)", t, re.I):
        out["time"], out["kind"] = f"{m[1]}:{m[2]}", "arrival"
    elif times:
        out["time"] = f"{times[-1][0]}:{times[-1][1]}"
    city = CITIES.get(body.city_key)
    if city:
        for s in city["stations"]:
            if s["id"] in re.findall(r"\b[A-Z]{2,4}\b", t) or s["name"].split()[0].lower() in t.lower():
                out["station_id"] = s["id"]
                out.setdefault("kind", "arrival")
                break
    return out


@app.get("/api/live/train/{number}")
def live_train(number: str, date: str, station: str, force: Optional[int] = None):
    return train_status(number, date, station, force)


# ------------------------------------------------------------------ LIVE: ripple engine

class RippleIn(BaseModel):
    day: int
    now: str
    event: dict


@app.post("/api/trips/{trip_id}/ripple")
def ripple(trip_id: str, body: RippleIn):
    c = _get(trip_id, write=True)
    if not (0 <= body.day < len(c["days"])):
        raise HTTPException(400, "bad day")
    first = next((b for b in c["days"][body.day]["blocks"] if b["kind"] != "leg"), None)
    if body.event.get("type") in ("tired", "extend") and first and to_min(body.now) < first["s"]:
        raise HTTPException(400, f"Day {body.day + 1} hasn't started yet (first stop at {first['start']}), so there's nothing to re-plan.")
    prop = R.propose(c, body.day, to_min(body.now), body.event)
    c["pending"] = prop
    c["status"] = "live"
    if prop["auto_apply"]:
        _apply(c, prop)
    store.save(c)
    return {k: v for k, v in prop.items() if k != "days"} | {"preview_day": prop["days"][body.day]}


def _apply(c: dict, prop: dict) -> None:
    c["days"] = prop["days"]
    T.finish(c, plan_b=False, verify=False)
    c["ripple_log"].append({"id": prop["id"], "now": prop["now"], "day": prop["day"],
                            "event": prop["event"], "diff": prop["diff"], "auto": prop["auto_apply"]})
    c["pending"] = None


@app.post("/api/trips/{trip_id}/ripple/{pid}/accept")
def ripple_accept(trip_id: str, pid: str):
    c = _get(trip_id, write=True)
    prop = c.get("pending")
    if not prop or prop["id"] != pid:
        raise HTTPException(409, "Proposal expired, so trigger the event again")
    _apply(c, prop)
    store.save(c)
    return c


@app.post("/api/trips/{trip_id}/ripple/{pid}/reject")
def ripple_reject(trip_id: str, pid: str):
    c = _get(trip_id, write=True)
    c["pending"] = None
    store.save(c)
    return c


# ------------------------------------------------------------------ learning & budget

class FeedbackIn(BaseModel):
    day: int
    block_id: str
    reaction: Literal["loved", "ok", "skip", "tired"]
    actual_dwell: Optional[int] = None


@app.post("/api/trips/{trip_id}/feedback")
def feedback(trip_id: str, body: FeedbackIn):
    c = _get(trip_id, write=True)
    blk = next((b for b in c["days"][body.day]["blocks"] if b["id"] == body.block_id), None)
    if not blk:
        raise HTTPException(404, "Block not found")
    blk["feedback"] = body.reaction
    place = PLACE_BY_ID.get(blk.get("place_id"))
    notes = D.learn(c["dna"], place, body.reaction, body.actual_dwell, blk.get("dwell"))
    if body.actual_dwell and place:
        store.record_dwell(place["id"], body.actual_dwell)
    c["feedback"].append(body.model_dump() | {"place": blk["name"]})
    for n in notes:
        c["learned"].append({"day": body.day + 1, "text": n, "from": blk["name"]})
    c["dna_summary"] = D.describe(c["dna"])
    store.save(c)
    prof = store.load_profile(current_user())
    if prof and not c.get("demo"):  # learning carries into future trips
        D.learn(prof["dna"], place, body.reaction, body.actual_dwell, blk.get("dwell"))
        prof.setdefault("history", [])
        prof["history"] += [{"text": n, "from": blk["name"], "city": c["city"]["name"]} for n in notes]
        store.save_profile(current_user(), prof)
    return {"learned": notes, "dna_summary": c["dna_summary"], "dna": c["dna"]}


class RetuneIn(BaseModel):
    from_day: int


@app.post("/api/trips/{trip_id}/retune")
def retune(trip_id: str, body: RetuneIn):
    """Self-learning applied: rebuild upcoming days with the updated DNA."""
    c = _get(trip_id, write=True)
    days = set(range(body.from_day, len(c["days"])))
    T.compose(c, only_days=days)
    store.save(c)
    return c


class ExpenseIn(BaseModel):
    day: int
    amount: int
    label: str = "Expense"


@app.post("/api/trips/{trip_id}/expense")
def expense(trip_id: str, body: ExpenseIn):
    c = _get(trip_id, write=True)
    c["spent"].append(body.model_dump())
    c["budget"] = T.budget_summary(c)
    store.save(c)
    return c["budget"]


# ------------------------------------------------------------------ platform bridge (Tripzy <-> trip planner)

LINKS = store.STORE / "links.json"


def _links() -> dict:
    return json.loads(LINKS.read_text()) if LINKS.exists() else {}


class LinkIn(BaseModel):
    capsule_id: str
    platform_trip_id: int
    places: dict[str, str] = {}   # platform place id -> Tripzy place id


@app.post("/api/links")
def link(body: LinkIn):
    u = current_user(required=True)
    c = _get(body.capsule_id, write=True)
    data = _links()
    prev = data.get(str(body.platform_trip_id))
    if isinstance(prev, dict) and prev.get("owner") not in (None, u):
        raise HTTPException(404, "Trip not found")
    places = {**(prev.get("places", {}) if isinstance(prev, dict) else {}), **body.places}
    data[str(body.platform_trip_id)] = {"capsule_id": body.capsule_id, "places": places, "owner": u}
    LINKS.write_text(json.dumps(data))
    c["platform_trip_id"] = body.platform_trip_id
    store.save(c)
    return {"ok": True}


@app.get("/api/links/{platform_trip_id}")
def get_link(platform_trip_id: int):
    rec = _links().get(str(platform_trip_id))
    rec = {"capsule_id": rec, "places": {}} if isinstance(rec, str) else rec
    if not rec or not store.load(rec["capsule_id"]):
        raise HTTPException(404, "This trip has no Tripzy intelligence yet")
    _get(rec["capsule_id"])  # ownership
    if rec.get("owner") not in (None, current_user()):
        raise HTTPException(404, "This trip has no Tripzy intelligence yet")
    return {"capsule_id": rec["capsule_id"], "places": rec.get("places", {})}


@app.get("/api/cities/{city_key}/places")
def city_places(city_key: str):
    if city_key not in CITIES:
        raise HTTPException(404, "Unknown city")
    keep = ("id", "name", "cat", "tags", "lat", "lon", "hours", "closed", "dwell", "intensity", "stairs",
            "indoor", "cost", "diet", "best", "desc")
    return [{k: p.get(k) for k in keep} for p in PLACE_BY_ID.values() if p["city"] == city_key]


class ResequenceIn(BaseModel):
    day: int
    place_ids: list[str]


@app.post("/api/trips/{trip_id}/resequence")
def resequence(trip_id: str, body: ResequenceIn):
    """Re-check a day after the traveller re-arranged it in the planner: keep their
    order of sights, keep meals/rests in their slots, add or remove sights, then
    re-time it and re-run the feasibility check."""
    c = _get(trip_id, write=True)
    if not (0 <= body.day < len(c["days"])):
        raise HTTPException(400, "bad day")
    ctx = T.build_ctx(c)
    d = c["days"][body.day]
    seq = to_seq(d["blocks"])
    wanted = [pid for pid in body.place_ids if pid in PLACE_BY_ID and PLACE_BY_ID[pid]["city"] == c["city_key"]
              and PLACE_BY_ID[pid]["cat"] not in ("food", "cafe")]
    queue = list(wanted)
    out = []
    for it in seq:
        if it.get("kind") == "place":
            if queue:
                pid = queue.pop(0)
                same = it.get("place_id") == pid
                out.append(it if same else {"kind": "place", "place_id": pid, "why": "Your choice"})
        else:
            out.append(it)
    for pid in queue:
        out.append({"kind": "place", "place_id": pid, "why": "Your choice"})
    before = d["verify"]["score"]
    T.retime_day(c, ctx, d, out)
    T.finish(c, ctx)
    store.save(c)
    return {"capsule": c, "feasibility": {"before": before, "after": c["days"][body.day]["verify"]["score"]}}


@app.post("/api/demo/seed")
def demo_seed():
    """One-click demo: a parents-friendly Hyderabad trip with an arrival train (DEMO data)."""
    owner = current_user(required=True)
    from datetime import date, timedelta
    start = date.today() + timedelta(days=(4 - date.today().weekday()) % 7 or 7)  # next Friday
    brief = B.parse_rules(f"Hyderabad, 3 days, with my parents, veg, {start.isoformat()}").model_dump()
    swipes = {"c1": "a", "c3": "a", "c4": "a", "c6": "b", "c7": "a", "c9": "a", "c11": "b"}
    capsule = None
    for node, _step, cap in run_stream({"brief": brief, "swipes": swipes}):
        if cap:
            capsule = cap
    c = store.load(capsule["id"])
    c["demo"] = True
    c["owner"] = owner
    c["bookings"].append({"id": "demo01", "kind": "arrival", "mode": "train", "number": "12723",
                          "date": start.isoformat(), "time": "07:30", "station_id": "HYB",
                          "pnr": "DEMO000001", "live_delay": 0, "demo": True})
    T.compose(c)
    store.save(c)
    return {"capsule_id": c["id"]}


# ------------------------------------------------------------------ the signed-in traveller

class ProfileIn(BaseModel):
    swipes: dict = {}
    interests: list[str] = []
    pace: Optional[float] = None          # 0 slow .. 1 packed
    morning: Optional[float] = None       # 0 late .. 1 early
    companions: Literal["solo", "couple", "friends", "family", "parents"] = "solo"
    kids: int = 0
    diet: Literal["any", "veg", "jain", "halal"] = "any"
    no_stairs: bool = False
    wheelchair: bool = False
    budget_style: Literal["low", "mid", "high"] = "mid"
    budget_per_day: Optional[int] = None
    home_city: Optional[str] = None
    skipped: list[str] = []


@app.get("/api/me/profile")
def get_profile():
    u = current_user(required=True)
    p = store.load_profile(u)
    if not p:
        return {"completed": False}
    return {**p, "summary": D.describe(p["dna"])}


@app.put("/api/me/profile")
def put_profile(body: ProfileIn):
    """Onboarding answers -> a Travel DNA that every future plan starts from."""
    u = current_user(required=True)
    dna = D.dna_from_swipes(body.swipes, body.interests)
    if body.pace is not None:
        dna["pace"] = round(max(0.0, min(1.0, body.pace)), 3)
    if body.morning is not None:
        dna["morning"] = round(max(0.0, min(1.0, body.morning)), 3)
    if body.budget_style == "low":
        dna["budget"] = min(dna["budget"], .3)
    elif body.budget_style == "high":
        dna["budget"] = max(dna["budget"], .75)
    if body.no_stairs or body.wheelchair:
        dna["stamina"] = min(dna["stamina"], .35)
    prev = store.load_profile(u) or {}
    from datetime import datetime
    profile = {
        "completed": True, "dna": dna, "dna_onboarding": dna, "answers": body.model_dump(),
        "constraints": {"diet": body.diet, "no_stairs": body.no_stairs or body.wheelchair, "wheelchair": body.wheelchair},
        "companions": body.companions, "kids": body.kids, "budget_style": body.budget_style,
        "budget_per_day": body.budget_per_day, "home_city": body.home_city,
        "history": prev.get("history", []), "updated_at": datetime.now().isoformat(timespec="seconds"),
    }
    store.save_profile(u, profile)
    return {**profile, "summary": D.describe(dna)}


@app.get("/api/me/capsules")
def my_capsules():
    """The traveller's own Trip Capsules (summaries) for dashboard and history."""
    u = current_user(required=True)
    out = []
    for c in store.capsules_of(u):
        out.append({
            "id": c["id"], "city": c["city"]["name"], "city_key": c["city_key"], "demo": bool(c.get("demo")),
            "platform_trip_id": c.get("platform_trip_id"), "created_at": c.get("created_at"),
            "start": c["days"][0]["date"] if c.get("days") else None, "days": len(c.get("days", [])),
            "scores": [d["verify"]["score"] for d in c.get("days", []) if d.get("verify")],
            "ripple_log": c.get("ripple_log", [])[-5:], "learned": c.get("learned", [])[-5:],
            "spent_total": (c.get("budget") or {}).get("spent_total", 0),
            "planned_total": (c.get("budget") or {}).get("planned_total", 0),
        })
    return out


@app.get("/api/me/discover")
def my_discover(city: Optional[str] = None, limit: int = 8):
    """Places ranked against the traveller's saved Travel DNA, with the reason."""
    u = current_user(required=True)
    p = store.load_profile(u)
    dna = p["dna"] if p else D.base_dna()
    no_stairs = bool(p and p.get("constraints", {}).get("no_stairs"))
    res = []
    for pl in PLACE_BY_ID.values():
        if pl["cat"] in ("food", "cafe") or (city and pl["city"] != city) or (no_stairs and pl.get("stairs")):
            continue
        m = D.interest_match(pl, dna)
        top = sorted(pl.get("tags", []), key=lambda t: -dna["interests"].get(t, .5))[:2]
        res.append({"place_id": pl["id"], "name": pl["name"], "city": CITIES[pl["city"]]["name"], "city_key": pl["city"],
                    "cat": pl["cat"], "match": round(m * 100), "why": f"Matches your love of {' & '.join(top)}",
                    "best": pl.get("best"), "desc": pl.get("desc", "")})
    res.sort(key=lambda r: -r["match"])
    return {"personalised": bool(p), "items": res[: max(1, min(limit, 24))]}


# ------------------------------------------------------------------ provider health

_health_cache: dict = {}


@app.get("/api/providers")
def providers():
    import time
    import httpx
    from datetime import datetime
    if _health_cache.get("at") and time.time() - _health_cache["at"] < 60:
        return _health_cache["data"]

    def probe(name, url, purpose, attribution, ok=lambda r: r.status_code == 200):
        t0 = time.time()
        try:
            r = httpx.get(url, timeout=6, headers={"User-Agent": "Tripzy/2.0 (hackathon)"})
            good = ok(r)
            return {"name": name, "purpose": purpose, "status": "ok" if good else "degraded",
                    "latency_ms": round((time.time() - t0) * 1000), "detail": f"HTTP {r.status_code}", "attribution": attribution}
        except Exception as e:
            return {"name": name, "purpose": purpose, "status": "down", "latency_ms": None,
                    "detail": type(e).__name__, "attribution": attribution}

    from .engines.routing import OSRM_URL, get_matrix
    rows = [
        probe("OSRM routing", f"{OSRM_URL}/route/v1/driving/78.4747,17.3616;78.4011,17.3833?overview=false",
              "Road distance, duration and route geometry", "© OpenStreetMap contributors, OSRM",
              ok=lambda r: r.status_code == 200 and r.json().get("code") == "Ok"),
        probe("Open-Meteo weather", "https://api.open-meteo.com/v1/forecast?latitude=17.38&longitude=78.48&daily=temperature_2m_max&forecast_days=1",
              "Daily and hourly forecast, rain probability", "Open-Meteo.com (CC BY 4.0)"),
        probe("Wikipedia images", "https://en.wikipedia.org/api/rest_v1/page/summary/Charminar",
              "Destination photography", "Wikipedia / Wikimedia Commons"),
    ]
    mx = {k: get_matrix(k)["source"] for k in CITIES}
    rows.append({"name": "Travel-time matrix cache", "purpose": "Pre-computed road times per city", "status": "ok" if all(v == "osrm" for v in mx.values()) else "degraded",
                 "latency_ms": 0, "detail": ", ".join(f"{k}: {v}" for k, v in mx.items()), "attribution": "OSRM"})
    rows.append({"name": "Verified places catalogue", "purpose": "Places, hours, closures, best times", "status": "ok", "latency_ms": 0,
                 "detail": f"{len(PLACE_BY_ID)} places in {len(CITIES)} cities, verified 2026-11-01", "attribution": "Tripzy curated dataset"})
    from .engines import providers as PV
    st = PV.status()
    rows.append(probe("Frankfurter currency", "https://api.frankfurter.dev/v1/latest?base=INR&symbols=USD",
                      "Live reference exchange rates (fallback: open.er-api.com)", "European Central Bank via Frankfurter"))

    def keyed(name, purpose, ok, detail_ok, detail_missing, attribution):
        rows.append({"name": name, "purpose": purpose, "status": "ok" if ok else "not_configured", "latency_ms": None,
                     "detail": detail_ok if ok else detail_missing, "attribution": attribution})

    keyed("Gemini (AI Companion)", "Open questions and trip recaps, grounded in your trip", st["gemini"],
          "Free tier key configured", "Not configured. Companion uses built-in rules.", "Google Gemini")
    keyed("Geoapify places", "Nearby cafés, ATMs, pharmacies, veg food", st["geoapify"],
          "Free tier (3,000 requests/day)", "Not configured. Curated catalogue only.", "Geoapify, © OpenStreetMap")
    keyed("LiteAPI hotels", "Hotel comparison near your stay area", st["liteapi"],
          "Sandbox key: test prices, labelled in the app" if st["liteapi_sandbox"] else "Live key",
          "Not configured. Stay-area estimates only.", "LiteAPI")
    keyed("Travelpayouts flights", "Cached fares + affiliate booking links", st["travelpayouts"],
          "Configured (affiliate links disclosed)", "Not configured. No flight prices shown.", "Travelpayouts / Aviasales")
    keyed("Tesseract OCR", "Reads photos of tickets on the server", st["tesseract"],
          "Installed locally (open source)", "Not installed. PDF and text tickets still work.", "Tesseract (Apache-2.0)")
    rows.append({"name": "Claude (language understanding)", "purpose": "Optional richer parsing of free-text trip requests",
                 "status": "ok" if os.getenv("ANTHROPIC_API_KEY") else "not_configured", "latency_ms": None,
                 "detail": "ANTHROPIC_API_KEY set" if os.getenv("ANTHROPIC_API_KEY") else "Optional, paid. Not used: rule-based parser in use.", "attribution": "Anthropic"})
    rows.append({"name": "Indian Railways live status", "purpose": "Train running status for Ripple triggers", "status": "simulated", "latency_ms": None,
                 "detail": "No free official API. Deterministic simulated feed, labelled in the app.", "attribution": "—"})
    data = {"checked_at": datetime.now().isoformat(timespec="seconds"), "providers": rows}
    _health_cache.update(at=time.time(), data=data)
    return data


# ------------------------------------------------------------------ ticket files

@app.post("/api/bookings/parse-file")
async def parse_ticket_file(city_key: str, file: UploadFile):
    """Read a PDF, text or photo ticket (local Tesseract OCR) and pull PNR, number, date, time, station."""
    current_user(required=True)
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10 MB)")
    name = (file.filename or "").lower()
    text, method = "", "text"
    if name.endswith(".pdf") or raw[:4] == b"%PDF":
        try:
            from io import BytesIO
            from pypdf import PdfReader
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(BytesIO(raw)).pages[:5])
            method = "pdf"
        except Exception:
            raise HTTPException(422, "Couldn't read this PDF")
    elif name.endswith((".txt", ".eml")) or (file.content_type or "").startswith("text/"):
        text = raw.decode("utf-8", errors="ignore")
    elif name.endswith((".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")) or (file.content_type or "") in (
            "image/png", "image/jpeg", "image/webp", "image/tiff", "image/bmp"):
        from .engines.providers import ocr_image
        ocr = ocr_image(raw, Path(name).suffix or ".png")
        if ocr is None:
            raise HTTPException(415, "Photo OCR needs Tesseract on the server (brew install tesseract). Upload the PDF instead.")
        text, method = ocr, "ocr"
    else:
        raise HTTPException(415, "Upload a PDF, a text confirmation, or a photo (JPG/PNG) of the ticket.")
    if not text.strip():
        raise HTTPException(422, "No readable text found in this file" + (". Try a sharper, well-lit photo." if method == "ocr" else ""))
    fields = parse_ticket(ParseTicketIn(text=text, city_key=city_key))
    return {"fields": fields, "chars": len(text), "method": method}


# ------------------------------------------------------------------ travel companion modules (free providers)

from .engines import companion as CP  # noqa: E402
from .engines import providers as PV  # noqa: E402
from .engines import readiness as RD  # noqa: E402


@app.get("/api/fx")
def fx(base: str = "INR"):
    if not re.fullmatch(r"[A-Za-z]{3}", base):
        raise HTTPException(400, "base must be a 3-letter currency code")
    return PV.fx_rates(base)


@app.get("/api/trips/{trip_id}/readiness")
def readiness(trip_id: str, documents: int = 0):
    return RD.build(_get(trip_id), documents)


class TickIn(BaseModel):
    done: bool


@app.post("/api/trips/{trip_id}/readiness/{item_id}")
def readiness_tick(trip_id: str, item_id: str, body: TickIn, documents: int = 0):
    c = _get(trip_id, write=True)
    if not re.fullmatch(r"[a-z_]{1,32}", item_id):
        raise HTTPException(400, "bad item")
    done = set(c.get("readiness_done", []))
    (done.add if body.done else done.discard)(item_id)
    c["readiness_done"] = sorted(done)
    store.save(c)
    return RD.build(c, documents)


class CompanionIn(BaseModel):
    message: str
    day: Optional[int] = None
    now: Optional[str] = None


@app.post("/api/trips/{trip_id}/companion")
def companion(trip_id: str, body: CompanionIn):
    c = _get(trip_id)
    msg = body.message.strip()[:500]
    if not msg:
        raise HTTPException(400, "empty message")
    if body.now and not re.fullmatch(r"\d{1,2}:\d{2}", body.now):
        raise HTTPException(400, "now must be HH:MM")
    return CP.reply(c, msg, body.day, body.now)


@app.get("/api/trips/{trip_id}/alerts")
def trip_alerts(trip_id: str, documents: int = 0):
    return {"alerts": CP.alerts(_get(trip_id), documents)}


@app.get("/api/trips/{trip_id}/nearby")
def trip_nearby(trip_id: str, kind: str = "cafe", day: int = 0, now: Optional[str] = None):
    c = _get(trip_id)
    if kind not in PV.PLACE_KINDS:
        raise HTTPException(400, f"kind must be one of {sorted(PV.PLACE_KINDS)}")
    day = max(0, min(day, len(c["days"]) - 1))
    lat, lon = CP._position(c, day, to_min(now) if now else c["days"][day].get("start_t", 540))
    return PV.nearby(lat, lon, kind)


@app.get("/api/trips/{trip_id}/hotels")
def trip_hotels(trip_id: str):
    c = _get(trip_id)
    lat, lon = (c["stay"]["lat"], c["stay"]["lon"]) if c.get("stay") else c["city"]["center"]
    adults = max(1, len([t for t in c.get("travellers", []) if t.get("age") != "child"]))
    return PV.hotels(c["city"]["name"], "IN", lat, lon, c["brief"].get("start_date") or "",
                     max(1, len(c["days"]) - 1), adults)


@app.get("/api/flights")
def flight_search(origin: str, destination: str, date: str):
    if not (re.fullmatch(r"[A-Za-z]{3}", origin) and re.fullmatch(r"[A-Za-z]{3}", destination)):
        raise HTTPException(400, "Use 3-letter IATA codes")
    return PV.flights(origin.upper(), destination.upper(), date)


@app.get("/api/trips/{trip_id}/finance")
def finance(trip_id: str):
    """Full trip cost from the plan itself, per-person split and live conversions."""
    c = _get(trip_id)
    cats = {"tickets": 0, "food": 0, "transport": 0}
    for d in c["days"]:
        for b in d["blocks"]:
            v = int(b.get("cost") or 0)
            cats["transport" if b["kind"] == "leg" else "food" if b["kind"] == "meal" else "tickets"] += v
    nights = max(1, len(c["days"]) - 1)
    stay_rate = int(c.get("budget", {}).get("stay_estimate") or 0)
    cats["stay"] = stay_rate * nights
    total = sum(cats.values())
    people = max(1, len(c.get("travellers", [])) or 1)
    spent = int(c.get("budget", {}).get("spent_total") or 0)
    fxr = PV.fx_rates("INR")
    conv = {k: round(total * fxr["rates"][k], 2) for k in ("USD", "EUR", "GBP") if k in fxr.get("rates", {})}
    by_day = [{"day": d["index"], "date": d["date"], "planned": int(d.get("cost") or 0),
               "spent": sum(int(x["amount"]) for x in c.get("spent", []) if x.get("day") == d["index"])} for d in c["days"]]
    return {
        "currency": "INR", "categories": cats, "total": total, "people": people, "per_person": round(total / people),
        "stay_rate": stay_rate, "nights": nights, "budget_total": c["brief"].get("budget_total"),
        "spent": spent, "remaining": (c["brief"].get("budget_total") or total) - spent, "by_day": by_day,
        "expenses": c.get("spent", []), "converted": conv, "fx": {"source": fxr.get("source"), "date": fxr.get("date")},
        "note": "Estimates from Tripzy's verified catalogue (entry fees, typical meal and auto fares) and the stay area's "
                "typical nightly rate. Not live prices.",
    }


@app.get("/api/trips/{trip_id}/recap")
def recap(trip_id: str, story: bool = False):
    """Trip memories: what you did, what you loved, how Tripzy adapted, what it learned."""
    c = _get(trip_id)
    places = [b for d in c["days"] for b in d["blocks"] if b["kind"] == "place"]
    legs = [b for d in c["days"] for b in d["blocks"] if b["kind"] == "leg"]
    fb = c.get("feedback", [])
    loved = [f["place"] for f in fb if f.get("reaction") == "loved"]
    out = {
        "city": c["city"]["name"], "start_date": c["brief"].get("start_date"), "days": len(c["days"]),
        "stops": len(places), "meals": sum(1 for d in c["days"] for b in d["blocks"] if b["kind"] == "meal"),
        "km": round(sum(float(b.get("km") or 0) for b in legs), 1),
        "travel_min": sum(int(b.get("minutes") or 0) for b in legs),
        "highlights": [{"name": b["name"], "place_id": b.get("place_id"), "day": d["index"], "start": b["start"]}
                       for d in c["days"] for b in d["blocks"] if b["kind"] == "place"][:12],
        "loved": loved, "reactions": len(fb),
        "adaptations": [{"headline": r["diff"].get("headline"), "day": r.get("day"), "auto": r.get("auto")}
                        for r in c.get("ripple_log", []) if r.get("diff")],
        "learned": [x["text"] for x in c.get("learned", [])],
        "spent": c.get("budget", {}).get("spent_total", 0),
        "story": None,
    }
    if story:
        out["story"] = PV.gemini(
            "Write a warm 4-sentence travel memory in second person from these facts only (no invented details):\n"
            + json.dumps({k: out[k] for k in ("city", "days", "stops", "km", "highlights", "loved", "adaptations")}, default=str),
            system="You write short, honest travel recaps. Use only the facts given.")
        out["story_source"] = "gemini" if out["story"] else None
    return out
