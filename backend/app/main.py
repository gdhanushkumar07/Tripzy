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
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
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
    if m := re.search(r"(?:train|tr\.?)\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{5})", t, re.I):
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
    rows.append({"name": "Claude (language understanding)", "purpose": "Parses free-text trip requests",
                 "status": "ok" if os.getenv("ANTHROPIC_API_KEY") else "not_configured", "latency_ms": None,
                 "detail": "ANTHROPIC_API_KEY set" if os.getenv("ANTHROPIC_API_KEY") else "Not configured. Rule-based parser in use.", "attribution": "Anthropic"})
    rows.append({"name": "Indian Railways live status", "purpose": "Train running status for Ripple triggers", "status": "simulated", "latency_ms": None,
                 "detail": "No free official API. Deterministic simulated feed, labelled in the app.", "attribution": "—"})
    data = {"checked_at": datetime.now().isoformat(timespec="seconds"), "providers": rows}
    _health_cache.update(at=time.time(), data=data)
    return data


# ------------------------------------------------------------------ ticket files

@app.post("/api/bookings/parse-file")
async def parse_ticket_file(city_key: str, file: UploadFile):
    """Read a PDF / text ticket and pull PNR, number, date, time, station. Images need OCR (not in V1)."""
    current_user(required=True)
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 10 MB)")
    name = (file.filename or "").lower()
    text = ""
    if name.endswith(".pdf") or raw[:4] == b"%PDF":
        try:
            from io import BytesIO
            from pypdf import PdfReader
            text = "\n".join((pg.extract_text() or "") for pg in PdfReader(BytesIO(raw)).pages[:5])
        except Exception:
            raise HTTPException(422, "Couldn't read this PDF")
    elif name.endswith((".txt", ".eml")) or (file.content_type or "").startswith("text/"):
        text = raw.decode("utf-8", errors="ignore")
    else:
        raise HTTPException(415, "Upload a PDF or text confirmation. Photos of tickets need OCR, which isn't in this version.")
    if not text.strip():
        raise HTTPException(422, "No readable text found in this file")
    fields = parse_ticket(ParseTicketIn(text=text, city_key=city_key))
    return {"fields": fields, "chars": len(text)}


# ------------------------------------------------------------------ static frontend (single deploy)

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        if path and f.is_file() and DIST in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
