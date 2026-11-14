"""Trip Capsule orchestration: brief -> DNA -> stay -> days -> verify -> Plan B."""

from __future__ import annotations

import math
import re
from datetime import datetime

from ..data.cities import CITIES, PLACE_BY_ID, places_for
from .. import store
from . import dna as D
from .live import historical_avg_delay
from .planner import Ctx, day_params, meal_options, plan_day, simulate, to_seq
from .routing import get_matrix, leg as route_leg
from .shadow import attach_plan_b
from .timeutil import WEEKDAYS, day_dates, fmt, to_min
from .verify import day_cost, verify_day


def init_capsule(brief: dict, swipes: dict, party_override: dict | None = None, profile: dict | None = None) -> dict:
    import copy
    city_key = brief["city"]
    travellers = D.party_from(brief["party"], brief.get("kids", 0))
    if party_override and party_override.get("travellers"):
        travellers = party_override["travellers"]
    if profile and profile.get("dna") and not swipes:
        # Saved Travel DNA (onboarding + everything learned since) drives this trip.
        dna = copy.deepcopy(profile["dna"])
        for h in brief.get("interests") or []:
            if h in dna["interests"]:
                dna["interests"][h] = min(1.0, dna["interests"][h] + .25)
        prefs = profile.get("constraints") or {}
        if brief.get("diet", "any") == "any" and prefs.get("diet"):
            brief["diet"] = prefs["diet"]
        if prefs.get("no_stairs"):
            brief["no_stairs"] = True
        if brief.get("budget_style", "mid") == "mid" and profile.get("budget_style"):
            brief["budget_style"] = profile["budget_style"]
    else:
        dna = D.dna_from_swipes(swipes, brief.get("interests"))
    if brief.get("budget_style") == "low":
        dna["budget"] = min(dna["budget"], .3)
    elif brief.get("budget_style") == "high":
        dna["budget"] = max(dna["budget"], .75)
    constraints = {
        "diet": brief.get("diet", "any"), "no_stairs": brief.get("no_stairs", False),
        "must": list(brief.get("must", [])), "exclude": list(brief.get("avoid", [])), "must_date": {},
    }
    return {
        "id": store.new_trip_id(), "created_at": datetime.now().isoformat(timespec="seconds"),
        "status": "planned", "city_key": city_key,
        "city": {k: CITIES[city_key][k] for k in ("name", "state", "center", "emergency", "local_phrase", "stations")},
        "brief": brief, "travellers": travellers, "dna": dna, "dna_initial": copy.deepcopy(dna),
        "dna_summary": D.describe(dna), "constraints": constraints, "overrides": {}, "bookings": [],
        "spent": [], "feedback": [], "learned": [], "ripple_log": [], "notes": [], "weather": {},
    }


def build_ctx(c: dict) -> Ctx:
    return Ctx(city_key=c["city_key"], dna=c["dna"], travellers=c["travellers"],
               constraints=c["constraints"], stay_node=f"stay:{c['stay']['id']}" if c.get("stay") else
               f"stay:{CITIES[c['city_key']]['stay_areas'][0]['id']}",
               weather=c.get("weather", {}), learned_dwell=store.learned_dwell())


# ------------------------------------------------------------------ discovery & stay

def ranked_places(c: dict, ctx: Ctx, n: int = 14) -> list[dict]:
    out = []
    for p in places_for(c["city_key"]):
        if p["cat"] in ("food", "cafe") or p["id"] in c["constraints"]["exclude"]:
            continue
        if c["constraints"].get("no_stairs") and p.get("stairs"):
            continue
        m = D.interest_match(p, c["dna"]) + (1 if p["id"] in c["constraints"]["must"] else 0)
        out.append({"place_id": p["id"], "name": p["name"], "match": round(min(1, m) * 100),
                    "tags": p["tags"], "cat": p["cat"]})
    out.sort(key=lambda x: -x["match"])
    return out[:n]


def _price_low(price: str) -> int:
    m = re.search(r"([\d,]+)", price)
    return int(m[1].replace(",", "")) if m else 3000


def stay_options(c: dict, ctx: Ctx) -> list[dict]:
    top = ranked_places(c, ctx, 10)
    opts = []
    for a in CITIES[c["city_key"]]["stay_areas"]:
        node = f"stay:{a['id']}"
        mins = [route_leg(c["city_key"], node, t["place_id"], 11 * 60, ctx.party)["minutes"] * t["match"] / 100
                for t in top]
        avg = sum(mins) / max(1, sum(t["match"] / 100 for t in top))
        price = _price_low(a["price"])
        score = -avg - (price / 1000 * (2.5 if c["dna"]["budget"] < .4 else .8))
        opts.append({"id": a["id"], "name": a["name"], "avg_minutes": round(avg), "price": a["price"],
                     "vibe": a["vibe"], "score": round(score, 1), "lat": a["lat"], "lon": a["lon"]})
    opts.sort(key=lambda o: -o["score"])
    best = opts[0]
    best["pick"] = True
    for o in opts:
        diff = o["avg_minutes"] - best["avg_minutes"]
        o["tradeoff"] = "Tripzy pick: least travel to your must-sees for the money" if o.get("pick") else (
            f"+{diff} min per ride on average" if diff > 0 else f"{-diff} min closer but pricier")
    return opts


# ------------------------------------------------------------------ bookings -> anchors

def anchors_for(c: dict, ctx: Ctx, iso: str):
    before, end_anchor, start_node, start_t = [], None, None, None
    for bk in c.get("bookings", []):
        if bk.get("date") != iso or bk["kind"] not in ("arrival", "departure"):
            continue
        t = to_min(bk["time"])
        station = f"station:{bk['station_id']}"
        sname = next((s["name"] for s in CITIES[c["city_key"]]["stations"] if s["id"] == bk["station_id"]),
                     bk["station_id"])
        label = f"{bk['mode'].title()} {bk.get('number', '')}".strip()
        if bk["kind"] == "arrival":
            delay = bk.get("live_delay", 0)
            avg = historical_avg_delay(bk.get("number", ""), bk["station_id"]) if bk["mode"] == "train" else 15
            before = [
                {"kind": "anchor", "id": f"bk-{bk['id']}", "name": f"Arrive: {label} at {sname}", "node": station,
                 "s": t + delay, "e": t + delay + 15, "hard": True, "fixed": True, "booking_id": bk["id"],
                 "delay_risk": f"{label} averages {avg} min late here, so the plan keeps a buffer" if bk["mode"] == "train" else None,
                 "live_delay": delay},
                {"kind": "anchor", "id": f"ci-{bk['id']}", "name": "Check-in & freshen up", "node": ctx.stay_node,
                 "s": t + delay + 15 + avg // 2, "e": t + delay + 60 + avg // 2, "fixed": False},
            ]
            start_node, start_t = station, t + delay
        else:
            lead = 30 if bk["mode"] == "train" else 120
            end_anchor = {"kind": "anchor", "id": f"bk-{bk['id']}", "name": f"Depart: {label} from {sname}",
                          "node": station, "s": t - lead, "e": t, "hard": True, "fixed": True,
                          "must_arrive_by": True, "booking_id": bk["id"]}
    return before, end_anchor, start_node, start_t


# ------------------------------------------------------------------ compose

def compose(c: dict, ctx: Ctx | None = None, only_days: set | None = None) -> dict:
    ctx = ctx or build_ctx(c)
    compose_days(c, ctx, only_days)
    return finish(c, ctx)


def compose_days(c: dict, ctx: Ctx | None = None, only_days: set | None = None) -> dict:
    ctx = ctx or build_ctx(c)
    b = c["brief"]
    dates = day_dates(b["start_date"], b["days"])
    old = {d["index"]: d for d in c.get("days", [])}
    used = {blk["place_id"] for i, d in old.items() if only_days is not None and i not in only_days
            for blk in d["blocks"] if blk["kind"] == "place"}
    must = set(c["constraints"]["must"])
    exclude = set(c["constraints"]["exclude"])
    days = []
    for i, d in enumerate(dates):
        if only_days is not None and i not in only_days and i in old:
            days.append(old[i])
            continue
        iso, wd = d.isoformat(), d.weekday()
        params = day_params(ctx, c["overrides"].get(str(i), {}))
        before, end_anchor, start_node, start_t = anchors_for(c, ctx, iso)
        if before and i == 0:
            params["energy_budget"] = round(params["energy_budget"] * .85)  # travel-day fatigue
        out = plan_day(ctx, iso, wd, used, must, exclude, params, before, end_anchor, start_node, start_t)
        day = {"index": i, "date": iso, "weekday": WEEKDAYS[wd], "weekday_idx": wd, "blocks": out["blocks"],
               "start_t": start_t if start_t is not None else out["params"]["start"], "start_node": start_node or ctx.stay_node,
               "end_t": params["end"], "energy_budget": params["energy_budget"], "limiter": params["limiter"],
               "weather": c["weather"].get(iso)}
        days.append(day)
    c["days"] = days
    return c


def finish(c: dict, ctx: Ctx | None = None, plan_b: bool = True, verify: bool = True) -> dict:
    ctx = ctx or build_ctx(c)
    days = c["days"]
    must = set(c["constraints"]["must"])
    if plan_b:
        attach_plan_b(ctx, days)
    if verify:
        for day in days:
            finalize_day(c, ctx, day)
    scheduled = {blk["place_id"] for d in days for blk in d["blocks"] if blk.get("place_id")}
    c["notes"] = [f"Couldn't fit {PLACE_BY_ID[m]['name']}: check its hours/closures or add a day"
                  for m in must if m not in scheduled]
    c["budget"] = budget_summary(c)
    return c


def finalize_day(c: dict, ctx: Ctx, day: dict) -> None:
    prev = day.get("start_node") or ctx.stay_node
    day_food = {b["place_id"] for b in day["blocks"] if b["kind"] == "meal" and b.get("place_id")}
    for b in day["blocks"]:
        if b["kind"] == "meal":
            b["options"] = meal_options(ctx, b, prev, day["weekday_idx"], day_food - {b.get("place_id")})
        if b["kind"] in ("place", "meal", "rest") and b.get("place_id"):
            prev = b["place_id"]
        elif b["kind"] == "anchor":
            prev = b.get("node", prev)
    day["verify"] = verify_day(day, ctx, day["energy_budget"])
    day["cost"] = day_cost(day)


def retime_day(c: dict, ctx: Ctx, day: dict, seq: list[dict]) -> dict:
    out = simulate(seq, day["start_t"], day.get("start_node") or ctx.stay_node, day["date"],
                   day["weekday_idx"], ctx, end_node=ctx.stay_node)
    day["blocks"] = out["blocks"]
    finalize_day(c, ctx, day)
    return out


# ------------------------------------------------------------------ budget

def budget_summary(c: dict) -> dict:
    n = len(c["days"])
    stay = next((a for a in CITIES[c["city_key"]]["stay_areas"] if a["id"] == c["stay"]["id"]), None)
    rooms = math.ceil(len(c["travellers"]) / 2)
    stay_cost = _price_low(stay["price"]) * rooms * max(1, n - 1) if stay else 0
    per_day = []
    for d in c["days"]:
        spent = sum(s["amount"] for s in c["spent"] if s["day"] == d["index"])
        per_day.append({"day": d["index"], "planned": d.get("cost", day_cost(d)), "spent": spent})
    planned = sum(p["planned"] for p in per_day) + stay_cost
    spent = sum(s["amount"] for s in c["spent"])
    total = c["brief"].get("budget_total")
    days_with_spend = [p for p in per_day if p["spent"]]
    over = bool(days_with_spend) and sum(p["spent"] for p in days_with_spend) > 1.15 * sum(
        p["planned"] for p in days_with_spend)
    return {"planned_total": planned, "stay_estimate": stay_cost, "per_day": per_day, "spent_total": spent,
            "budget_total": total, "over_budget": over,
            "fits": (total is None) or planned <= total}


def recompose_after_edit(c: dict, ops: list[dict]) -> list[str]:
    msgs = []
    n = c["brief"]["days"]
    for op in ops:
        k = op["op"]
        targets = [op["day"]] if op.get("day") is not None else list(range(n))
        if k == "energy_scale":
            for d in targets:
                c["overrides"].setdefault(str(d), {})["energy_scale"] = op["value"]
            msgs.append(("Lighter" if op["value"] < 1 else "Fuller") + " plan for " +
                        (f"Day {op['day'] + 1}" if op.get("day") is not None else "all days"))
        elif k == "start_shift":
            for d in targets:
                c["overrides"].setdefault(str(d), {})["start_shift"] = op["value"]
            msgs.append(("Later" if op["value"] > 0 else "Earlier") + " start")
        elif k == "no_stairs":
            c["constraints"]["no_stairs"] = True
            msgs.append("No steep climbs: forts and towers with stairs are swapped out")
        elif k == "budget":
            c["dna"]["budget"] = min(c["dna"]["budget"], .3)
            msgs.append("Budget mode: cheaper picks preferred")
        elif k == "diet":
            c["constraints"]["diet"] = op["value"]
            msgs.append("Veg-only food stops")
        elif k == "exclude":
            c["constraints"]["exclude"].append(op["place_id"])
            c["constraints"]["must"] = [m for m in c["constraints"]["must"] if m != op["place_id"]]
            msgs.append(f"Removed {PLACE_BY_ID[op['place_id']]['name']}")
        elif k == "must":
            pid = op["place_id"]
            if pid not in c["constraints"]["must"]:
                c["constraints"]["must"].append(pid)
            c["constraints"]["exclude"] = [x for x in c["constraints"]["exclude"] if x != pid]
            msgs.append(f"Added {PLACE_BY_ID[pid]['name']}")
    if ops:
        compose(c)
    return msgs


def matrix_source(city_key: str) -> str:
    return get_matrix(city_key)["source"]
