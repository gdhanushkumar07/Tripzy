"""Ripple Engine: live re-planning.

When something happens (delay, rain, tiredness, a closure, staying longer)
the rest of the day is re-timed with the same simulator used at planning
time. Then:
  * blocks that no longer fit are moved to a later day if they fit there,
    otherwise dropped (lowest value first)
  * outdoor blocks hit by rain swap to their pre-computed Plan B
The result is a Diff Card proposal. Small shifts (no drops or swaps,
<= 15 min) are flagged auto-apply. Anything bigger asks the traveller.
"""

from __future__ import annotations

import copy
import secrets

from ..data.cities import PLACE_BY_ID
from . import dna as D
from .planner import choose_rest, simulate, to_seq
from .timeutil import fmt, to_min
from .trip import build_ctx, finalize_day

DAY_HARD_END = 22 * 60 + 45


def _value(ctx, b) -> float:
    if b.get("kind") != "place":
        return 99
    p = PLACE_BY_ID[b["place_id"]]
    v = D.interest_match(p, ctx.dna)
    if p["id"] in ctx.constraints.get("must", []):
        v += 1
    if p.get("slot") or b.get("user_locked"):
        v += 5
    return v


def _resim(ctx, seq, t, node, day, energy0):
    return simulate(seq, t, node, day["date"], day["weekday_idx"], ctx, end_node=ctx.stay_node, energy0=energy0)


MEAL_LATEST = {"lunch": 14 * 60 + 45, "dinner": 21 * 60 + 30}


def _late_meal(out):
    for b in out["blocks"]:
        if b["kind"] == "meal" and b["s"] > MEAL_LATEST.get(b.get("meal"), 24 * 60):
            return b
    return None


def _fits_time_energy(out, budget) -> bool:
    last = max((b["e"] for b in out["blocks"] if b["kind"] != "leg"), default=0)
    return last <= DAY_HARD_END and out["energy"] <= budget * 1.12 and not _late_meal(out)


def _fits(out, budget) -> bool:
    return not out["dropped"] and _fits_time_energy(out, budget)


def propose(c: dict, day_idx: int, now: int, event: dict) -> dict:
    ctx = build_ctx(c)
    days = copy.deepcopy(c["days"])
    day = days[day_idx]
    blocks = day["blocks"]
    kind = event["type"]

    done = [b for b in blocks if b["e"] <= now]
    current = next((b for b in blocks if b["s"] <= now < b["e"] and b["kind"] != "leg"), None)
    future = [b for b in blocks if b["s"] > now or (b["kind"] == "leg" and b["s"] <= now < b["e"])]
    future = [b for b in future if b is not current]
    used_energy = 0.0
    for b in done + ([current] if current else []):
        used_energy += D.leg_energy(b) if b["kind"] == "leg" else max(0, b.get("energy", 0))

    t = current["e"] if current else now
    node = (current.get("place_id") or current.get("node")) if current else None
    if not node:
        prev = [b for b in done if b["kind"] != "leg"]
        node = (prev[-1].get("place_id") or prev[-1].get("node")) if prev else day.get("start_node") or ctx.stay_node
        if prev and not prev[-1].get("place_id") and prev[-1]["kind"] != "anchor":
            node = ctx.stay_node if "hotel" in prev[-1].get("name", "").lower() else node

    seq = to_seq(future)
    old_times = {b["id"]: (b["start"], b["name"]) for b in future if b["kind"] != "leg"}
    swapped, inserted, notes, user_skipped = [], [], [], []
    headline = ""

    if kind in ("delay", "late"):
        m = int(event.get("minutes", 30))
        anchor = next((i for i, it in enumerate(seq) if it.get("kind") == "anchor" and it.get("hard")), None)
        if anchor is not None and seq[anchor].get("booking_id") and kind == "delay":
            a = seq[anchor]
            seq[anchor] = {**a, "s": a["s"] + m, "e": a["e"] + m, "live_delay": a.get("live_delay", 0) + m}
            headline = f"{a['name'].replace('Arrive: ', '')} delayed {m} min"
        else:
            t += m
            headline = f"Running {m} min behind"
    elif kind == "extend":
        m = int(event.get("minutes", 30))
        if current:
            current = {**current, "e": current["e"] + m, "end": fmt(current["e"] + m),
                       "dwell": current["dwell"] + m}
        t += m
        headline = f"Staying {m} min longer at {current['name'] if current else 'this spot'}"
    elif kind == "tired":
        r = choose_rest(ctx, node, t, day["weekday_idx"], set())
        rest = {"kind": "rest", "place_id": r[0]["id"] if r else None, "dwell": 40,
                "name": f"Recharge at {r[0]['name']}" if r else "Recharge break (shade + water)",
                "why": "You said you're tired, so this is a 40-min AC/shade break"}
        if current and current["kind"] == "place" and current["e"] - now > 25:
            cut = now + 15
            notes.append(f"Wrap up {current['name']} by {fmt(cut)}, no need to see it all")
            current = {**current, "e": cut, "end": fmt(cut), "dwell": cut - current["s"]}
            t = cut
        seq.insert(0, rest)
        inserted.append(rest["name"])
        used_energy += 0.25 * day["energy_budget"]
        for i, it in enumerate(seq):
            if it.get("kind") == "place" and it.get("plan_b", {}).get("tired"):
                p = PLACE_BY_ID[it["place_id"]]
                if p.get("intensity", 3) >= 5:
                    alt = it["plan_b"]["tired"]
                    if alt.get("place_id"):
                        seq[i] = {"kind": "place", "place_id": alt["place_id"], "why": f"Easier swap for {p['name']}: {alt['reason']}"}
                        swapped.append({"from": p["name"], "to": alt["name"], "reason": "lower effort"})
                    else:
                        seq[i] = {**it, "dwell": alt["shorten"]}
                        notes.append(f"{p['name']} trimmed to {alt['shorten']} min (highlights only)")
        headline = "Feeling tired"
    elif kind == "rain":
        rs, re_ = to_min(event.get("from", fmt(now))), to_min(event.get("to", fmt(now + 180)))
        if current and current["kind"] == "place" and not current.get("indoor") and current["e"] > rs + 15:
            cut = max(now, rs) + 15
            notes.append(f"Wrap up {current['name']} by {fmt(cut)} and head for cover")
            current = {**current, "e": cut, "end": fmt(cut), "dwell": cut - current["s"]}
            t = cut
        old_by_id = {b["id"]: b for b in future}
        for i, it in enumerate(seq):
            if it.get("kind") != "place":
                continue
            b = old_by_id.get(it.get("id"))
            p = PLACE_BY_ID[it["place_id"]]
            if p.get("indoor") or not b or not (b["s"] < re_ and b["e"] > rs):
                continue
            alt = (it.get("plan_b") or {}).get("rain")
            if alt:
                seq[i] = {"kind": "place", "place_id": alt["place_id"],
                          "why": f"Rain swap for {p['name']}: indoor & open now"}
                swapped.append({"from": p["name"], "to": alt["name"], "reason": "rain"})
            else:
                seq[i] = {**it, "_drop": "rain, no indoor alternative nearby"}
        seq = [it for it in seq if not it.get("_drop")]
        headline = f"Rain expected {fmt(rs)}-{fmt(re_)}"
    elif kind == "closed":
        bid = event.get("block_id")
        for i, it in enumerate(seq):
            if it.get("id") == bid and it.get("kind") == "place":
                p = PLACE_BY_ID[it["place_id"]]
                pb = it.get("plan_b") or {}
                alt = pb.get("crowd") or pb.get("rain") or (pb.get("tired") if pb.get("tired", {}).get("place_id") else None)
                if alt:
                    seq[i] = {"kind": "place", "place_id": alt["place_id"], "why": f"{p['name']} is closed, so here's a close match nearby"}
                    swapped.append({"from": p["name"], "to": alt["name"], "reason": "unexpected closure"})
                else:
                    seq.pop(i)
                headline = f"{p['name']} closed today"
                break
    elif kind == "skip":
        bid = event.get("block_id")
        if current and current["id"] == bid:
            notes.append(f"Ended {current['name']} early")
            current = {**current, "e": now, "end": fmt(now), "dwell": max(0, now - current["s"])}
            t = now
            headline = f"Skipping the rest of {current['name']}"
        else:
            for i, it in enumerate(seq):
                if it.get("id") == bid:
                    nm = it.get("name") or PLACE_BY_ID.get(it.get("place_id") or "", {}).get("name", "stop")
                    seq.pop(i)
                    user_skipped.append({"name": nm, "reason": "you chose to skip it"})
                    headline = f"Skipping {nm}"
                    break
    elif kind == "over_budget":
        from .planner import choose_food
        planned = {b["id"]: b["s"] for b in future}
        for i, it in enumerate(seq):
            if it.get("kind") == "meal" and it.get("place_id"):
                p = PLACE_BY_ID[it["place_id"]]
                at = planned.get(it.get("id"), t) - 10
                opts = [o for o in choose_food(ctx, it["place_id"], at, it.get("meal") or "lunch",
                                               day["weekday_idx"], {it["place_id"]}, 6)
                        if o[0]["cost"] <= p["cost"] * .7]
                if opts:
                    alt = min(opts, key=lambda o: o[0]["cost"])[0]
                    seq[i] = {**it, "place_id": alt["id"], "name": alt["name"], "dwell": alt["dwell"],
                              "why": f"Budget swap: Rs {alt['cost']} vs Rs {p['cost']} per person"}
                    swapped.append({"from": p["name"], "to": alt["name"], "reason": "cheaper"})
            elif it.get("kind") == "place":
                p = PLACE_BY_ID[it["place_id"]]
                if p.get("cost", 0) * ctx.party >= 400:
                    alts = [a for a in (it.get("plan_b") or {}).values()
                            if isinstance(a, dict) and a.get("place_id")
                            and PLACE_BY_ID[a["place_id"]].get("cost", 0) < p["cost"] * .5]
                    if alts:
                        a = alts[0]
                        seq[i] = {"kind": "place", "place_id": a["place_id"],
                                  "why": f"Budget swap for {p['name']}: similar, much cheaper"}
                        swapped.append({"from": p["name"], "to": a["name"], "reason": "cheaper"})
        headline = "Over budget: cheaper picks for the rest of today"
        if not swapped:
            notes.append("Remaining stops are already the cheapest good options nearby")

    budget = day["energy_budget"]
    out = _resim(ctx, seq, t, node, day, used_energy)
    dropped = list(out["dropped"])
    gone = {id(it) for it, _ in dropped}
    # trim the lowest-value stops until the day fits time + energy
    while not _fits_time_energy(out, budget):
        late = _late_meal(out)
        cut = len(seq)
        if late:
            cut = next((i for i, it in enumerate(seq) if it.get("id") == late["id"]), len(seq))
        cands = [(i, it) for i, it in enumerate(seq[:cut]) if it.get("kind") == "place" and id(it) not in gone]
        if not cands:
            break
        i, worst = min(cands, key=lambda x: _value(ctx, x[1]))
        if _value(ctx, worst) >= 5:
            break
        why = (f"keeps {late['meal']} on time" if late else
               "not enough time left today" if out["t"] > DAY_HARD_END - 30 else "would exceed today's energy budget")
        seq.pop(i)
        dropped.append((worst, why))
        gone.add(id(worst))
        out = _resim(ctx, seq, t, node, day, used_energy)
        for x in out["dropped"]:
            if id(x[0]) not in gone:
                dropped.append(x)
                gone.add(id(x[0]))

    # move dropped places to a later day where they fit
    moved, lost = [], list(user_skipped)
    for it, why in dropped:
        if it.get("kind") in ("meal", "rest"):
            nm = it.get("name") or PLACE_BY_ID.get(it.get("place_id") or "", {}).get("name", it.get("meal", "stop"))
            notes.append(f"Skipped {it.get('meal') or 'break'} at {nm}: {why}")
            continue
        if it.get("kind") != "place":
            continue
        name = PLACE_BY_ID[it["place_id"]]["name"]
        placed = False
        for d2 in days[day_idx + 1:]:
            seq2 = to_seq(d2["blocks"])
            best = None
            for pos in range(len(seq2) + 1):
                trial = seq2[:pos] + [{"kind": "place", "place_id": it["place_id"],
                                       "why": f"Moved from Day {day_idx + 1} ({why})"}] + seq2[pos:]
                o2 = simulate(trial, d2["start_t"], d2.get("start_node") or ctx.stay_node, d2["date"],
                              d2["weekday_idx"], ctx, end_node=ctx.stay_node)
                if _fits(o2, d2["energy_budget"]):
                    if best is None or o2["t"] < best[0]:
                        best = (o2["t"], o2)
            if best:
                d2["blocks"] = best[1]["blocks"]
                finalize_day(c, ctx, d2)
                moved.append({"name": name, "to_day": d2["index"] + 1, "reason": why})
                placed = True
                break
        if not placed:
            lost.append({"name": name, "reason": why})

    new_future = out["blocks"]
    keep = done + ([current] if current else [])
    day["blocks"] = keep + new_future
    finalize_day(c, ctx, day)

    shifted = []
    for b in new_future:
        if b["kind"] == "leg" or b["id"] not in old_times:
            continue
        old_start, nm = old_times[b["id"]]
        delta = to_min(b["start"]) - to_min(old_start)
        if abs(delta) >= 5:
            shifted.append({"name": nm, "from": old_start, "to": b["start"], "delta": delta})

    diff = {"headline": headline, "dropped": lost, "moved": moved, "swapped": swapped,
            "shifted": shifted, "inserted": inserted, "notes": notes,
            "feasibility": {"before": c["days"][day_idx]["verify"]["score"], "after": day["verify"]["score"]},
            "energy": {"before": c["days"][day_idx]["verify"]["energy"]["pct"], "after": day["verify"]["energy"]["pct"]}}
    minor = not (lost or moved or swapped or inserted or notes) and all(abs(s["delta"]) <= 15 for s in shifted)
    proposal = {"id": secrets.token_hex(4), "day": day_idx, "now": fmt(now), "event": event,
                "diff": diff, "auto_apply": minor, "days": days}
    return proposal
