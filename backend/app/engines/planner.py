"""Compose engine: builds each day's timeline and re-times it.

How a day is built:
  1. `plan_day` greedily picks the next best place. The score combines DNA
     match, best time of day, travel time, waiting, crowds, rain and energy.
     Only places that are open, not closed that weekday, and fit the energy
     budget are considered.
  2. Meals and rest breaks are inserted where the clock and the energy budget
     call for them.
  3. `simulate` turns the ordered sequence into a timeline with real legs.
     The Ripple Engine reuses `simulate` for live re-planning, so planning and
     re-planning follow the same rules.
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from ..data.cities import PLACE_BY_ID, SOURCE, VERIFIED_AT, places_for
from . import dna as D
from .routing import leg as route_leg
from .timeutil import WEEKDAYS, fmt, to_min, windows

_ids = itertools.count(1)
CARRY = ("plan_b", "options", "user_locked", "status", "not_before", "node", "feedback", "flex_until")


def new_id(prefix: str = "b") -> str:
    return f"{prefix}{next(_ids)}"


@dataclass
class Ctx:
    city_key: str
    dna: dict
    travellers: list[dict]
    constraints: dict
    stay_node: str
    weather: dict = field(default_factory=dict)          # iso date -> {tmax, rain_prob, hourly}
    learned_dwell: dict = field(default_factory=dict)    # place id -> minutes (collective learning)
    food_seen: dict = field(default_factory=dict)        # variety: penalise repeating a food spot

    @property
    def party(self) -> int:
        return max(1, len(self.travellers))

    @property
    def limited(self) -> bool:
        return bool(self.constraints.get("no_stairs")) or any(
            t.get("mobility") == "limited" for t in self.travellers)

    @property
    def diet(self) -> str:
        return self.constraints.get("diet", "any")

    def node_pos(self, node: str):
        if node in PLACE_BY_ID:
            p = PLACE_BY_ID[node]
            return p["lat"], p["lon"]
        return None

    def leg(self, a: str, b: str, t: int) -> dict:
        return route_leg(self.city_key, a, b, t, self.party, self.limited)

    def dwell(self, p: dict) -> int:
        return int(self.learned_dwell.get(p["id"], p["dwell"]))

    def tmax(self, iso: str):
        return (self.weather.get(iso) or {}).get("tmax")

    def rain_prob(self, iso: str, t: int | None = None) -> int:
        w = self.weather.get(iso) or {}
        if t is not None and w.get("hourly"):
            return int(w["hourly"][min(23, t // 60)])
        return int(w.get("rain_prob") or 0)


# ------------------------------------------------------------------ eligibility

def diet_ok(place: dict, diet: str) -> bool:
    d = place.get("diet", "both")
    if diet in ("veg", "jain"):
        return d in ("veg", "both") if diet == "veg" else d == "veg"
    return True


def open_window(place: dict, arrive: int, weekday: int):
    """Returns (start, close) of the first window the visit can use, or None."""
    if weekday in place.get("closed", []):
        return None
    for a, b in windows(place):
        if arrive < b:
            return max(arrive, a), b
    return None


def is_activity(p: dict) -> bool:
    return p["cat"] not in ("food", "cafe")


# ------------------------------------------------------------------ timeline

def _place_block(p: dict, start: int, dwell: int, ctx: Ctx, iso: str, why: str = "") -> dict:
    return {
        "id": new_id(), "kind": "place", "place_id": p["id"], "name": p["name"], "cat": p["cat"],
        "lat": p["lat"], "lon": p["lon"], "s": start, "e": start + dwell,
        "start": fmt(start), "end": fmt(start + dwell), "dwell": dwell,
        "energy": D.block_energy(p, dwell, start, ctx.travellers, ctx.tmax(iso)),
        "cost": p.get("cost", 0) * ctx.party, "indoor": p.get("indoor", False),
        "tags": p.get("tags", []), "desc": p.get("desc", ""), "why": why,
        "source": SOURCE, "verified_at": VERIFIED_AT,
        "fixed": bool(p.get("slot")), "best": p.get("best"),
    }


def simulate(seq: list[dict], start_t: int, start_node: str, iso: str, weekday: int, ctx: Ctx,
             end_node: str | None = None, energy0: float = 0.0, strict: bool = False) -> dict:
    """Times an ordered sequence of items into blocks with legs.

    item kinds: place {place_id, dwell?, why?}, meal {place_id|None, meal, dwell},
                rest {place_id|None, dwell, name}, anchor {name, s, e, node, fixed}
    Returns {blocks, t, node, energy, dropped:[(item, reason)]}.
    """
    t, node, energy = start_t, start_node, energy0
    blocks, dropped = [], []
    for it in seq:
        kind = it["kind"]
        target = it.get("place_id") or it.get("node") or node
        lg = ctx.leg(node, target, t)
        arrive = t + lg["minutes"] + lg["buffer"]

        if kind == "anchor":
            s = it["s"]
            if arrive > s and it.get("must_arrive_by"):
                dropped.append((it, f"can't reach {it['name']} in time"))
                continue
            leg_block = _leg_block(lg, node, target, t) if lg["mode"] != "none" else None
            if leg_block:
                blocks.append(leg_block)
            s = max(s, arrive) if not it.get("hard") else s
            blocks.append({**it, "id": it.get("id") or new_id(), "s": s, "e": s + (it["e"] - it["s"]),
                           "start": fmt(s), "end": fmt(s + (it["e"] - it["s"])), "kind": "anchor"})
            t, node = s + (it["e"] - it["s"]), it.get("node", node)
            continue

        p = PLACE_BY_ID.get(it.get("place_id")) if it.get("place_id") else None
        dwell = it.get("dwell") or (ctx.dwell(p) if p else 30)
        if p:
            if p.get("slot"):
                s_slot = to_min(p["slot"][0])
                if arrive > s_slot + 5 or weekday in p.get("closed", []):
                    dropped.append((it, "misses its fixed show time"))
                    continue
                start = s_slot
            else:
                w = open_window(p, arrive, weekday)
                if not w:
                    dropped.append((it, "closed by the time you'd arrive" if weekday not in p.get("closed", [])
                                    else f"closed on {WEEKDAYS[weekday]}"))
                    continue
                start, close = w
                start = max(start, it.get("not_before", 0))
                if start - arrive > 75 and kind == "place" and not it.get("not_before"):
                    dropped.append((it, "would mean waiting over an hour for it to open"))
                    continue
                if start + dwell > close:
                    if (close - start) >= 0.6 * dwell and kind == "place":
                        dwell = close - start
                        it = {**it, "shortened": True}
                    else:
                        dropped.append((it, f"closes at {fmt(close)} before you'd finish"))
                        continue
        else:
            start = max(arrive, it.get("not_before", 0))
        if it.get("flex_until"):  # hotel downtime absorbs delays
            dwell = max(20, it["flex_until"] - start)

        if lg["mode"] != "none":
            blocks.append(_leg_block(lg, node, target, t))
            energy += D.leg_energy(lg)

        if kind == "place":
            b = _place_block(p, start, dwell, ctx, iso, it.get("why", ""))
            if it.get("shortened"):
                b["shortened"] = True
            if start > arrive:
                b["wait"] = start - arrive
            energy += b["energy"]
        elif kind == "meal":
            b = {"id": it.get("id") or new_id(), "kind": "meal", "meal": it["meal"],
                 "place_id": p["id"] if p else None,
                 "name": p["name"] if p else it.get("name", f"{it['meal'].title()} nearby"),
                 "lat": p["lat"] if p else None, "lon": p["lon"] if p else None,
                 "s": start, "e": start + dwell, "start": fmt(start), "end": fmt(start + dwell),
                 "dwell": dwell, "energy": -4, "cost": (p["cost"] if p else 250) * ctx.party,
                 "diet": p.get("diet") if p else None, "indoor": True,
                 "desc": p.get("desc", "") if p else "", "why": it.get("why", ""),
                 "source": SOURCE if p else "generic", "verified_at": VERIFIED_AT if p else None}
            energy -= 4
        else:  # rest
            b = {"id": it.get("id") or new_id(), "kind": "rest", "place_id": p["id"] if p else None,
                 "name": it.get("name") or (f"Recharge at {p['name']}" if p else "Recharge break"),
                 "lat": p["lat"] if p else None, "lon": p["lon"] if p else None,
                 "s": start, "e": start + dwell, "start": fmt(start), "end": fmt(start + dwell),
                 "dwell": dwell, "energy": -12, "cost": (p["cost"] if p else 0) * ctx.party,
                 "indoor": True, "why": it.get("why", "Energy top-up before the next stop")}
            energy -= 12
        energy = max(0.0, energy)
        for k in CARRY:
            if k in it:
                b[k] = it[k]
        if start > arrive and kind != "place":
            b["wait"] = start - arrive
        blocks.append(b)
        t, node = b["e"], target

    if end_node and end_node != node:
        lg = ctx.leg(node, end_node, t)
        if lg["mode"] != "none":
            blocks.append(_leg_block(lg, node, end_node, t, to_stay=True))
            energy += D.leg_energy(lg)
            t += lg["minutes"]
            node = end_node
    return {"blocks": blocks, "t": t, "node": node, "energy": round(energy, 1), "dropped": dropped}


def _leg_block(lg: dict, a: str, b: str, t: int, to_stay: bool = False) -> dict:
    return {"id": new_id("l"), "kind": "leg", "from": a, "to": b, "s": t, "e": t + lg["minutes"],
            "start": fmt(t), "end": fmt(t + lg["minutes"]), "depart_by": fmt(t), **lg,
            "to_stay": to_stay}


def to_seq(blocks: list[dict]) -> list[dict]:
    """Inverse of simulate: turn timed blocks back into an ordered sequence."""
    seq = []
    for b in blocks:
        if b["kind"] == "leg":
            continue
        if b["kind"] == "anchor":
            seq.append(b)
            continue
        it = {"kind": b["kind"], "place_id": b.get("place_id"), "id": b["id"], "why": b.get("why", "")}
        if b["kind"] in ("meal", "rest"):
            it.update(dwell=b["dwell"], meal=b.get("meal"), name=b["name"])
        elif b.get("dwell_override"):
            it["dwell"] = b["dwell"]
        for k in CARRY:
            if k in b:
                it[k] = b[k]
        seq.append(it)
    return seq


# ------------------------------------------------------------------ choosers

def choose_food(ctx: Ctx, node: str, t: int, meal: str, weekday: int, exclude: set,
                n: int = 1) -> list[tuple[dict, dict, float]]:
    out = []
    for p in places_for(ctx.city_key):
        if p["cat"] not in ("food", "cafe", "show") or meal not in p.get("meal", []):
            continue
        if p["id"] in exclude or not diet_ok(p, ctx.diet):
            continue
        lg = ctx.leg(node, p["id"], t)
        if lg["minutes"] > 30:
            continue
        w = open_window(p, t + lg["minutes"], weekday)
        if not w or w[0] - (t + lg["minutes"]) > 20 or w[0] + 30 > w[1]:
            continue
        score = 3 * ctx.dna["food"] + 2 * D.interest_match(p, ctx.dna) - lg["minutes"] * .12
        if p["id"] in ctx.constraints.get("must", []):
            score += 6
        score -= 2.5 * ctx.food_seen.get(p["id"], 0)
        if p.get("best") and to_min(p["best"][0]) <= t + lg["minutes"] <= to_min(p["best"][1]):
            score += 1
        if ctx.dna["budget"] < .35 and p["cost"] > 400:
            score -= 1.5
        out.append((p, lg, round(score, 2)))
    out.sort(key=lambda x: -x[2])
    return out[:n]


def choose_rest(ctx: Ctx, node: str, t: int, weekday: int, exclude: set):
    best = None
    for p in places_for(ctx.city_key):
        if p["cat"] != "cafe" or p["id"] in exclude:
            continue
        lg = ctx.leg(node, p["id"], t)
        if lg["minutes"] > 15 or not open_window(p, t + lg["minutes"], weekday):
            continue
        if best is None or lg["minutes"] < best[1]["minutes"]:
            best = (p, lg)
    return best


# ------------------------------------------------------------------ day builder

def day_params(ctx: Ctx, overrides: dict) -> dict:
    d = ctx.dna
    start = 9 * 60 + (-60 if d["morning"] > .62 else 60 if d["morning"] < .38 else 0)
    end = 22 * 60 + 30 if d["interests"].get("nightlife", .5) > .65 else 21 * 60 + 30
    if any(t.get("age") in ("senior", "child") for t in ctx.travellers):
        end = min(end, 21 * 60 + 15)
    max_acts = 3 + round(d["pace"] * 3)
    eb = D.energy_budget(d, ctx.travellers, ctx.constraints)
    scale = overrides.get("energy_scale", 1.0)
    if scale < 1:
        max_acts -= 1
    elif scale > 1:
        max_acts += 1
    return {"start": start + overrides.get("start_shift", 0), "end": end,
            "max_acts": max(2, max_acts), "energy_budget": round(eb["budget"] * scale),
            "limiter": eb["limiter"]}


def score_place(p: dict, ctx: Ctx, t: int, lg: dict, start: int, iso: str, must: set,
                energy_used: float, budget: float) -> tuple[float, list[str]]:
    why = []
    match = D.interest_match(p, ctx.dna)
    v = 4 + 8 * match
    top = [x for x in p.get("tags", []) if ctx.dna["interests"].get(x, .5) >= .65][:2]
    if top:
        why.append(f"matches your love of {' & '.join(top)}")
    if p["id"] in must:
        v += 7
        why.append("you asked for it")
    best = p.get("best")
    if best:
        bs, be = to_min(best[0]), to_min(best[1])
        if bs <= start <= be:
            v += 3
            why.append(f"best time: {best[2]}")
        elif start < bs - 120 and bs >= 15 * 60:
            v -= 3  # save evening-best places for the evening
    if ctx.dna["crowd"] < .4 and p.get("crowd"):
        cs, ce = to_min(p["crowd"][0]), to_min(p["crowd"][1])
        if cs <= start <= ce:
            v -= 2.5
        else:
            why.append("timed to dodge the crowd peak")
    if not p.get("indoor") and ctx.rain_prob(iso, start) >= 60:
        v -= 3
    if p.get("cost", 0) > 600 and ctx.dna["budget"] < .4:
        v -= 2
    if p["dwell"] >= 300 and ctx.dna["pace"] < .7 and ctx.dna["interests"].get("entertainment", .5) < .7:
        v -= 5
    v -= lg["minutes"] * .1 + (start - (t + lg["minutes"])) * .06
    e = D.block_energy(p, ctx.dwell(p), start, ctx.travellers, ctx.tmax(iso))
    v -= (e / max(budget, 1)) * 4 * (1 - ctx.dna["stamina"])
    return round(v, 2), why


def plan_day(ctx: Ctx, iso: str, weekday: int, used: set, must: set, exclude: set,
             params: dict, anchors_before: list[dict] | None = None,
             end_anchor: dict | None = None, start_node: str | None = None,
             start_t: int | None = None) -> dict:
    """Greedy day builder. Returns simulate() output + meta."""
    budget = params["energy_budget"]
    seq: list[dict] = list(anchors_before or [])
    node = start_node or ctx.stay_node
    t = start_t if start_t is not None else params["start"]
    end = params["end"]
    if end_anchor:
        end = min(end, end_anchor["s"] - 75)

    pre = simulate(seq, t, node, iso, weekday, ctx) if seq else None
    if pre:
        t, node, energy = pre["t"], pre["node"], pre["energy"]
    else:
        energy = 0.0
    acts, lunch, dinner, rested, evening_done = 0, t >= 15 * 60, False, False, False
    day_food: set = set()

    # breakfast out, for early birds and foodies, if a great spot is close
    if t <= 9 * 60 + 30 and (ctx.dna["food"] > .6 or ctx.dna["morning"] > .6):
        opts = [o for o in choose_food(ctx, node, t, "breakfast", weekday, used | exclude, 1)
                if o[1]["minutes"] <= 25]
        if opts:
            p, lg, _ = opts[0]
            seq.append({"kind": "meal", "meal": "breakfast", "place_id": p["id"], "dwell": p["dwell"],
                        "why": f"Local breakfast: {p['best'][2] if p.get('best') else p['desc']}"})
            day_food.add(p["id"])
            ctx.food_seen[p["id"]] = ctx.food_seen.get(p["id"], 0) + 1
            t += lg["minutes"] + lg["buffer"] + p["dwell"]
            node = p["id"]

    while t < end:
        if not lunch and t >= 12 * 60 + 30:
            _add_meal(ctx, seq, "lunch", node, t, weekday, used | exclude | day_food, day_food)
            lunch = True
            t, node = _advance(ctx, seq, t, node)
            continue
        if not dinner and t >= 19 * 60 + 15:
            _add_meal(ctx, seq, "dinner", node, t, weekday, used | exclude | day_food, day_food)
            dinner = True
            t, node = _advance(ctx, seq, t, node)
            continue
        if not rested and energy >= .7 * budget and t < end - 90 and acts < params["max_acts"]:
            r = choose_rest(ctx, node, t, weekday, day_food)
            seq.append({"kind": "rest", "place_id": r[0]["id"] if r else None, "dwell": 30,
                        "name": f"Recharge at {r[0]['name']}" if r else "Recharge break",
                        "why": f"You've used {round(energy / budget * 100)}% of today's energy, so a 30-min top-up comes before the next stop"})
            rested = True
            energy = max(0, energy - 12)
            t, node = _advance(ctx, seq, t, node)
            continue
        if acts >= params["max_acts"]:
            if evening_done or t > 19 * 60:
                break
            ev = _evening_pick(ctx, iso, weekday, used, exclude, must, energy, budget, end)
            if not ev:
                break
            p, target, e = ev
            if not lunch and t < 15 * 60:
                _add_meal(ctx, seq, "lunch", node, max(t, 12 * 60 + 30), weekday, used | exclude | day_food, day_food)
                lunch = True
                t, node = _advance(ctx, seq, t, node)
            lg = ctx.leg(ctx.stay_node, p["id"], target - 30)
            if target - t > 150:
                seq.append({"kind": "rest", "place_id": None, "node": ctx.stay_node,
                            "flex_until": target - lg["minutes"] - lg["buffer"] - 20,
                            "dwell": max(30, target - t - lg["minutes"] - lg["buffer"] - 30),
                            "name": "Back to hotel: rest & freshen up",
                            "why": f"Recharge so you're fresh for {p['name']} at its best time"})
            seq.append({"kind": "place", "place_id": p["id"], "not_before": target,
                        "why": f"Evening highlight: {p['best'][2]}"})
            used.add(p["id"])
            energy += e
            evening_done = True
            t, node = target + ctx.dwell(p), p["id"]
            continue

        best = None
        for p in places_for(ctx.city_key):
            if not is_activity(p) or p["id"] in used or p["id"] in exclude:
                continue
            if ctx.constraints.get("no_stairs") and p.get("stairs"):
                continue
            md = ctx.constraints.get("must_date", {}).get(p["id"])
            if md and md != iso:
                continue
            lg = ctx.leg(node, p["id"], t)
            arrive = t + lg["minutes"] + lg["buffer"]
            if p.get("slot"):
                start = to_min(p["slot"][0])
                if arrive > start or start - arrive > 90 or weekday in p.get("closed", []):
                    continue
                close = to_min(p["slot"][1])
            else:
                w = open_window(p, arrive, weekday)
                if not w or w[0] - arrive > 60:
                    continue
                start, close = w
            dwell = ctx.dwell(p)
            if start + dwell > close or start + dwell > end:
                continue
            if not lunch and start + dwell > 14 * 60 + 30 and start < 14 * 60 + 30:
                continue  # don't starve the group, so lunch comes first
            e = D.block_energy(p, dwell, start, ctx.travellers, ctx.tmax(iso)) + D.leg_energy(lg)
            if energy + e > budget * 1.05:
                continue
            sc, why = score_place(p, ctx, t, lg, start, iso, must, energy, budget)
            if best is None or sc > best[0]:
                best = (sc, p, lg, start, dwell, e, why)

        if best is None:
            if not lunch and t < 14 * 60 + 30:
                _add_meal(ctx, seq, "lunch", node, max(t, 12 * 60 + 30), weekday, used | exclude | day_food, day_food)
                lunch = True
                t, node = _advance(ctx, seq, t, node)
                continue
            break
        sc, p, lg, start, dwell, e, why = best
        reason = "; ".join(why) if why else f"good fit near your route ({lg['minutes']} min away)"
        seq.append({"kind": "place", "place_id": p["id"], "why": reason[0].upper() + reason[1:]})
        used.add(p["id"])
        acts += 1
        energy += e
        t, node = start + dwell, p["id"]

    if not lunch and t < 15 * 60:
        _add_meal(ctx, seq, "lunch", node, max(t, 12 * 60 + 30), weekday, used | exclude | day_food, day_food)
        t, node = _advance(ctx, seq, t, node)
        t = max(t, 13 * 60 + 15)
    if not dinner and t < 17 * 60 + 15 and not end_anchor:
        seq.append({"kind": "rest", "place_id": None, "node": ctx.stay_node, "flex_until": 18 * 60 + 45,
                    "dwell": max(30, 18 * 60 + 45 - t - 20), "name": "Back to hotel: rest & freshen up",
                    "why": "Free time so evening plans start fresh"})
        t = 18 * 60 + 45
        node = ctx.stay_node
    if not dinner and t <= 21 * 60 + 30:
        _add_meal(ctx, seq, "dinner", node, max(t, 19 * 60), weekday, used | exclude | day_food, day_food)
    if end_anchor:
        seq.append(end_anchor)

    out = simulate(seq, params["start"] if not anchors_before else (start_t or params["start"]),
                   start_node or ctx.stay_node, iso, weekday, ctx,
                   end_node=None if end_anchor else ctx.stay_node)
    # don't make people wait at a gate: shift the morning start instead
    if not anchors_before:
        first = next((b for b in out["blocks"] if b["kind"] == "place"), None)
        pre_first = [b for b in out["blocks"] if first and b["s"] < first["s"] and b["kind"] not in ("leg", "meal")]
        if first and first.get("wait", 0) > 20 and not pre_first and not first.get("not_before"):
            shift = (first["wait"] - 5) // 5 * 5
            params = {**params, "start": params["start"] + shift}
            out = simulate(seq, params["start"], start_node or ctx.stay_node, iso, weekday, ctx,
                           end_node=None if end_anchor else ctx.stay_node)
    for it, _ in out["dropped"]:
        if it.get("place_id"):
            used.discard(it["place_id"])
    out["params"] = params
    return out


def _evening_pick(ctx: Ctx, iso, weekday, used, exclude, must, energy, budget, end):
    """One extra stop after the daily cap, but only at its golden evening window."""
    best = None
    for p in places_for(ctx.city_key):
        if not is_activity(p) or p["id"] in used or p["id"] in exclude or not p.get("best"):
            continue
        if ctx.constraints.get("no_stairs") and p.get("stairs"):
            continue
        bs = to_min(p["best"][0])
        if bs < 16 * 60 + 30 or bs + ctx.dwell(p) > end + 30:
            continue
        w = open_window(p, bs, weekday)
        if not w or w[0] > bs + 15 or w[0] + ctx.dwell(p) > w[1] + 1:
            continue
        e = D.block_energy(p, ctx.dwell(p), bs, ctx.travellers, ctx.tmax(iso)) + 3
        if energy + e > budget * 1.05:
            continue
        sc = D.interest_match(p, ctx.dna) + (1 if p["id"] in must else 0)
        if best is None or sc > best[0]:
            best = (sc, p, max(w[0], bs), e)
    return best[1:] if best else None


def _advance(ctx: Ctx, seq, t, node):
    """Re-time the last item to move the greedy clock forward."""
    it = seq[-1]
    target = it.get("place_id") or node
    lg = ctx.leg(node, target, t)
    return t + lg["minutes"] + lg["buffer"] + it.get("dwell", 30), target


NOT_BEFORE = {"breakfast": 0, "lunch": 12 * 60 + 15, "dinner": 19 * 60}


def _add_meal(ctx: Ctx, seq, meal, node, t, weekday, exclude, day_food):
    opts = choose_food(ctx, node, t, meal, weekday, exclude, 3)
    if opts:
        p, lg, _ = opts[0]
        day_food.add(p["id"])
        ctx.food_seen[p["id"]] = ctx.food_seen.get(p["id"], 0) + 1
        why = f"{lg['minutes']} min away, " + ("pure veg, " if p.get("diet") == "veg" else "") + \
              (p["best"][2] if p.get("best") else p["desc"])
        seq.append({"kind": "meal", "meal": meal, "place_id": p["id"], "dwell": p["dwell"], "why": why,
                    "not_before": NOT_BEFORE[meal]})
    else:
        seq.append({"kind": "meal", "meal": meal, "place_id": None, "dwell": 45, "not_before": NOT_BEFORE[meal],
                    "name": f"{meal.title()} nearby", "why": "No verified spot nearby, so pick any well-rated place here"})


def meal_options(ctx: Ctx, block: dict, prev_node: str, weekday: int, exclude: set) -> list[dict]:
    """Decision card: 2-3 real alternatives with tradeoffs + a Tripzy pick."""
    opts = choose_food(ctx, prev_node, block["s"] - 15, block.get("meal") or "lunch", weekday, exclude, 3)
    res = []
    for p, lg, sc in opts:
        res.append({"place_id": p["id"], "name": p["name"], "minutes": lg["minutes"], "mode": lg["mode"],
                    "cost": p["cost"] * ctx.party, "diet": p.get("diet"), "score": sc,
                    "note": p["best"][2] if p.get("best") else p["desc"]})
    if res:
        res[0]["pick"] = True
    return res
