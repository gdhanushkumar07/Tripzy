"""Shadow Itinerary: a backup plan for every sightseeing block, computed at
compose time so switching works instantly, even offline.

Plan B kinds:
  rain  -> indoor alternative open at that time
  crowd -> a nearby alternative without a crowd peak then
  tired -> a low-effort alternative (or a shorter visit)
"""

from __future__ import annotations

from ..data.cities import PLACE_BY_ID, places_for
from . import dna as D
from .planner import is_activity, open_window
from .routing import haversine_km
from .timeutil import to_min


def _alts(ctx, block, used, weekday, pred):
    p0 = PLACE_BY_ID[block["place_id"]]
    out = []
    for p in places_for(ctx.city_key):
        if p["id"] == p0["id"] or p["id"] in used or not is_activity(p) or p.get("slot"):
            continue
        if ctx.constraints.get("no_stairs") and p.get("stairs"):
            continue
        if not pred(p):
            continue
        w = open_window(p, block["s"], weekday)
        if not w or w[0] - block["s"] > 20 or w[0] + min(p["dwell"], 60) > w[1]:
            continue
        km = haversine_km((p0["lat"], p0["lon"]), (p["lat"], p["lon"]))
        if km > 8:
            continue
        score = D.interest_match(p, ctx.dna) * 10 - km
        out.append((score, p, km))
    out.sort(key=lambda x: -x[0])
    return out


def _pack(alt, reason):
    if not alt:
        return None
    _, p, km = alt[0]
    return {"place_id": p["id"], "name": p["name"], "km": round(km, 1), "reason": reason,
            "indoor": p.get("indoor", False), "dwell": p["dwell"]}


def compute_plan_b(ctx, block: dict, used: set, weekday: int) -> dict:
    p0 = PLACE_BY_ID[block["place_id"]]
    pb = {}
    if not p0.get("indoor"):
        pb["rain"] = _pack(_alts(ctx, block, used, weekday, lambda p: p.get("indoor")),
                           "Indoor and open at this time")
    if p0.get("crowd"):
        pb["crowd"] = _pack(_alts(ctx, block, used, weekday,
                                  lambda p: not p.get("crowd") or not (
                                      to_min(p["crowd"][0]) <= block["s"] <= to_min(p["crowd"][1]))),
                            "Quieter at this hour")
    if p0.get("intensity", 3) >= 4:
        alt = _pack(_alts(ctx, block, used, weekday, lambda p: p.get("intensity", 3) <= 2),
                    "Low-effort option nearby")
        pb["tired"] = alt or {"shorten": max(20, block["dwell"] // 2), "reason": "Shorter visit, highlights only"}
    return {k: v for k, v in pb.items() if v}


def attach_plan_b(ctx, days: list[dict]) -> None:
    used = {b["place_id"] for d in days for b in d["blocks"] if b["kind"] == "place"}
    for d in days:
        for b in d["blocks"]:
            if b["kind"] == "place":
                b["plan_b"] = compute_plan_b(ctx, b, used, d["weekday_idx"])
