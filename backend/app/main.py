"""Tripzy API (FastAPI)."""

from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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

app = FastAPI(title="Tripzy API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _get(trip_id: str) -> dict:
    c = store.load(trip_id)
    if not c:
        raise HTTPException(404, "Trip not found")
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

    def gen():
        try:
            for node, step, capsule in run_stream({"brief": brief, "swipes": body.swipes,
                                                   "travellers": body.travellers, "stay_id": body.stay_id}):
                if step:
                    yield {"event": "step", "data": json.dumps({"node": node, **step})}
                if capsule:
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
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    c = _get(trip_id)
    prop = c.get("pending")
    if not prop or prop["id"] != pid:
        raise HTTPException(409, "Proposal expired, so trigger the event again")
    _apply(c, prop)
    store.save(c)
    return c


@app.post("/api/trips/{trip_id}/ripple/{pid}/reject")
def ripple_reject(trip_id: str, pid: str):
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    return {"learned": notes, "dna_summary": c["dna_summary"], "dna": c["dna"]}


class RetuneIn(BaseModel):
    from_day: int


@app.post("/api/trips/{trip_id}/retune")
def retune(trip_id: str, body: RetuneIn):
    """Self-learning applied: rebuild upcoming days with the updated DNA."""
    c = _get(trip_id)
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
    c = _get(trip_id)
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
    _get(body.capsule_id)
    data = _links()
    prev = data.get(str(body.platform_trip_id))
    places = {**(prev.get("places", {}) if isinstance(prev, dict) else {}), **body.places}
    data[str(body.platform_trip_id)] = {"capsule_id": body.capsule_id, "places": places}
    LINKS.write_text(json.dumps(data))
    c = _get(body.capsule_id)
    c["platform_trip_id"] = body.platform_trip_id
    store.save(c)
    return {"ok": True}


@app.get("/api/links/{platform_trip_id}")
def get_link(platform_trip_id: int):
    rec = _links().get(str(platform_trip_id))
    rec = {"capsule_id": rec, "places": {}} if isinstance(rec, str) else rec
    if not rec or not store.load(rec["capsule_id"]):
        raise HTTPException(404, "This trip has no Tripzy intelligence yet")
    return rec


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
    c = _get(trip_id)
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
    c["bookings"].append({"id": "demo01", "kind": "arrival", "mode": "train", "number": "12723",
                          "date": start.isoformat(), "time": "07:30", "station_id": "HYB",
                          "pnr": "DEMO000001", "live_delay": 0, "demo": True})
    T.compose(c)
    store.save(c)
    return {"capsule_id": c["id"]}


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
