"""Time-Truth engine: gives each day a feasibility score (0-100) with reasons."""

from __future__ import annotations

from ..data.cities import PLACE_BY_ID
from .timeutil import WEEKDAYS, fmt, to_min


def verify_day(day: dict, ctx, energy_budget: float) -> dict:
    blocks = day["blocks"]
    weekday = day["weekday_idx"]
    iso = day["date"]
    score = 100.0
    checks: list[dict] = []

    def add(level, text, penalty=0.0):
        nonlocal score
        score -= penalty
        checks.append({"level": level, "text": text})

    travel = sum(b["minutes"] for b in blocks if b["kind"] == "leg")
    active = sum(b["dwell"] for b in blocks if b["kind"] in ("place", "meal", "rest"))
    share = travel / max(1, travel + active)
    energy = _energy(blocks)

    places = [b for b in blocks if b["kind"] == "place"]
    for i, b in enumerate(blocks):
        if b["kind"] == "place":
            p = PLACE_BY_ID[b["place_id"]]
            if weekday in p.get("closed", []):
                add("risk", f"{p['name']} is closed on {WEEKDAYS[weekday]}s", 40)
                continue
            ok_window = any(to_min(a) <= b["s"] and b["e"] <= to_min(c) for a, c in p["hours"]) \
                or bool(p.get("slot"))
            if not ok_window:
                add("risk", f"{p['name']}: visit {b['start']}-{b['end']} falls outside opening hours", 25)
            else:
                close = min((to_min(c) for a, c in p["hours"] if to_min(a) <= b["s"] < to_min(c)), default=None)
                if close is not None and close - b["e"] < 10 and not p.get("slot"):
                    add("warn", f"{p['name']} closes at {fmt(close)}, right as you finish. Keep moving.", 6)
            if b.get("shortened"):
                add("warn", f"{p['name']} shortened to {b['dwell']} min to fit opening hours", 4)
            if b.get("wait", 0) > 20 and not b.get("not_before"):
                add("warn", f"{b['wait']} min wait for {p['name']} to open", 3)
            best = p.get("best")
            if best and to_min(best[0]) <= b["s"] <= to_min(best[1]):
                add("ok", f"{p['name']} at {b['start']}: {best[2]}")
            if p.get("crowd") and ctx.dna["crowd"] < .4 and to_min(p["crowd"][0]) <= b["s"] <= to_min(p["crowd"][1]):
                add("warn", f"{p['name']} at crowd peak ({p['crowd'][0]}-{p['crowd'][1]})", 4)
            rp = ctx.rain_prob(iso, b["s"])
            if not p.get("indoor") and rp >= 50:
                add("warn", f"{rp}% rain chance at {b['start']} for outdoor {p['name']}. Plan B ready.", 6)
            if p.get("stairs") and any(t.get("age") == "senior" for t in ctx.travellers):
                add("warn", f"{p['name']} involves a steep climb. Check it suits the seniors in your group.", 3)
        if b["kind"] == "leg":
            nxt = blocks[i + 1] if i + 1 < len(blocks) else None
            if nxt and nxt.get("fixed") and nxt["s"] - b["e"] < b.get("buffer", 0):
                add("risk", f"Tight connection before {nxt['name']}: only {nxt['s'] - b['e']} min slack", 15)
            if b.get("reliability", 1) < .7 and b["minutes"] >= 30:
                add("warn", f"{b['start']} {b['mode']} ride in peak traffic ({b['minutes']} min incl. traffic)", 2)
        if b["kind"] == "anchor" and b.get("delay_risk"):
            add("warn", b["delay_risk"], 3)

    pct = energy / max(1, energy_budget)
    if pct > 1.1:
        add("risk", f"Energy {round(pct * 100)}% of budget. Too heavy for your group.", min(30, (pct - 1) * 100))
    elif pct > .95:
        add("warn", f"Energy at {round(pct * 100)}% of budget, a full day", 4)
    else:
        add("ok", f"Energy {round(pct * 100)}% of budget, comfortable for {day.get('limiter', 'the group')}")
    if share > .35:
        add("warn", f"{round(share * 100)}% of the day is spent in transit", 8)
    late = [b for b in blocks if b["kind"] != "leg" and b["e"] > 22 * 60 + 30]
    if late:
        add("warn", "Day runs past 22:30", 4)
    if not places:
        add("warn", "No sightseeing fits this day. Try relaxing constraints.", 10)

    score = max(0, min(100, round(score)))
    return {"score": score, "checks": checks,
            "energy": {"used": round(energy), "budget": round(energy_budget), "pct": round(pct * 100)},
            "travel_share": round(share * 100), "travel_min": travel}


def _energy(blocks):
    from .dna import leg_energy
    # load = exertion minus recovery (meals 4, rests 12), never below 0
    e = 0.0
    for b in blocks:
        if b["kind"] == "leg":
            e += leg_energy(b)
        elif b["kind"] == "place":
            e += b["energy"]
        elif b["kind"] == "meal":
            e = max(0.0, e - 4)
        elif b["kind"] == "rest":
            e = max(0.0, e - 12)
    return round(e, 1)


def day_cost(day: dict) -> int:
    return int(sum(b.get("cost", 0) for b in day["blocks"]))
