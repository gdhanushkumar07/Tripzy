"""Tripzy AI Companion.

Rule-based intent detection answers from the real trip (schedule, weather,
budget, bookings, readiness, emergency numbers) and proposes actions. Actions
are never executed here: the client shows a confirmation and only then calls
the existing Ripple endpoint, so every change still goes through the Diff Card.

Gemini (free tier, optional) is used only for open questions, grounded in a
compact summary of this trip, and is told not to invent prices or times.
"""

from __future__ import annotations

import re
from datetime import date

from . import providers as P
from . import readiness as RD
from .timeutil import to_min

CURRENCIES = {"usd": "USD", "dollar": "USD", "eur": "EUR", "euro": "EUR", "gbp": "GBP", "pound": "GBP",
              "aed": "AED", "dirham": "AED", "sgd": "SGD", "jpy": "JPY", "yen": "JPY", "aud": "AUD", "cad": "CAD"}
NEARBY_WORDS = [("pharmacy", "pharmacy"), ("medical", "pharmacy"), ("chemist", "pharmacy"), ("hospital", "hospital"),
                ("atm", "atm"), ("cash", "atm"), ("toilet", "toilet"), ("washroom", "toilet"), ("restroom", "toilet"),
                ("police", "police"), ("veg", "veg"), ("cafe", "cafe"), ("coffee", "cafe"), ("chai", "cafe"),
                ("restaurant", "restaurant"), ("food", "restaurant"), ("eat", "restaurant"), ("mall", "shopping"),
                ("petrol", "fuel"), ("fuel", "fuel")]


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def _today_index(c: dict) -> int:
    iso = date.today().isoformat()
    for d in c.get("days", []):
        if d.get("date") == iso:
            return d["index"]
    return 0


def _upcoming(c: dict, day: int, now: int) -> tuple[dict | None, dict | None]:
    blocks = [b for b in c["days"][day]["blocks"] if b.get("kind") != "leg"]
    cur = next((b for b in blocks if b["s"] <= now < b["e"]), None)
    nxt = next((b for b in blocks if b["s"] >= now and b is not cur), None)
    return cur, nxt


def _next_place(c: dict, day: int, now: int) -> dict | None:
    return next((b for b in c["days"][day]["blocks"] if b.get("kind") == "place" and b["s"] >= now), None)


def _position(c: dict, day: int, now: int) -> tuple[float, float]:
    cur, nxt = _upcoming(c, day, now)
    for b in (cur, nxt):
        if b and b.get("lat"):
            return b["lat"], b["lon"]
    if c.get("stay", {}).get("lat"):
        return c["stay"]["lat"], c["stay"]["lon"]
    lat, lon = c["city"]["center"]
    return lat, lon


def _minutes(t: str, default: int) -> int:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(h|hr|hour|hours|m|min|mins|minutes)\b", t)
    if not m:
        n = re.search(r"\b(\d{1,3})\b", t)
        return int(n[1]) if n else default
    v = float(m[1])
    return int(v * 60) if m[2].startswith("h") else int(v)


def context_summary(c: dict, day: int, now: int) -> str:
    b = c["brief"]
    lines = [f"Trip: {c['city']['name']}, {len(c['days'])} days from {b.get('start_date')}, party {b.get('party')}, diet {b.get('diet')}."]
    for d in c["days"]:
        stops = ", ".join(f"{x['start']} {x['name']}" for x in d["blocks"] if x.get("kind") in ("place", "meal", "anchor"))
        w = d.get("weather") or {}
        lines.append(f"Day {d['index'] + 1} {d['date']} (max {w.get('tmax')}°C, rain {w.get('rain_prob')}%): {stops}")
    bud = c.get("budget", {})
    lines.append(f"Budget: planned ₹{bud.get('planned_total')}, spent ₹{bud.get('spent_total')}.")
    if c.get("stay"):
        lines.append(f"Staying in: {c['stay']['name']}.")
    lines.append(f"Now: day {day + 1}, {_fmt(now)}.")
    return "\n".join(lines)


def reply(c: dict, message: str, day: int | None = None, now: str | None = None) -> dict:
    t = " " + message.lower().strip() + " "
    day = _today_index(c) if day is None else max(0, min(day, len(c["days"]) - 1))
    now_m = to_min(now) if now else c["days"][day].get("start_t", 540)
    out: dict = {"reply": "", "cards": [], "action": None, "source": "rules"}

    def ripple_action(event: dict, label: str, why: str):
        out["action"] = {"type": "ripple", "label": label, "day": day, "now": _fmt(now_m), "event": event,
                         "confirm": f"{why} Tripzy will show the changes before anything is saved."}

    # ------------------------------------------------ live re-planning intents (need confirmation)
    if re.search(r"\b(late|delayed|running behind|stuck in traffic)\b", t) and "train" not in t and "flight" not in t:
        mins = _minutes(t, 30)
        out["reply"] = f"No problem. I can re-time the rest of Day {day + 1} for a {mins}-minute delay, keeping meals and fixed bookings in place."
        ripple_action({"type": "late", "minutes": mins}, f"Re-plan for {mins} min late", f"You're running {mins} minutes late.")
        return out
    if re.search(r"\b(train|flight)\b.*\b(late|delay|delayed)\b|\b(delay|delayed)\b.*\b(train|flight)\b", t):
        bk = next((x for x in c.get("bookings", []) if x.get("mode") in ("train", "flight")), None)
        if not bk:
            out["reply"] = "There's no train or flight saved on this trip yet. Add one in Trip Intelligence, then I can re-plan around its delay."
            return out
        mins = _minutes(t, 60)
        out["reply"] = f"{bk['mode'].title()} {bk.get('number', '')} delayed {mins} min. I can shift everything after arrival and protect your meals."
        ripple_action({"type": "delay", "minutes": mins, "booking_id": bk["id"]}, f"Re-plan for +{mins} min delay",
                      f"Your {bk['mode']} is {mins} minutes late.")
        return out
    if re.search(r"\b(tired|exhausted|need (a )?break|rest)\b", t):
        out["reply"] = "Let's slow down. I can wrap up the current stop, add a rest and lighten the rest of today."
        ripple_action({"type": "tired"}, "Lighten today", "You're feeling tired.")
        return out
    if re.search(r"\b(raining|rain started|pouring|storm)\b", t) and not re.search(r"\b(will|forecast|chance)\b", t):
        out["reply"] = "Switching to rain mode: outdoor stops get indoor alternatives from your Plan B."
        ripple_action({"type": "rain"}, "Switch to rain plan", "It's raining.")
        return out
    if re.search(r"\b(stay longer|extend|more time here|loving it)\b", t):
        mins = _minutes(t, 45)
        out["reply"] = f"Enjoy it. I can give you {mins} more minutes here and re-fit the rest of the day."
        ripple_action({"type": "extend", "minutes": mins}, f"Stay {mins} min longer", f"You want {mins} more minutes here.")
        return out
    if re.search(r"\b(closed|shut)\b", t):
        tgt = _next_place(c, day, now_m)
        if not tgt:
            out["reply"] = f"There are no more planned stops on Day {day + 1} to replace."
            return out
        out["reply"] = f"If {tgt['name']} is closed, I can swap in the best open alternative nearby."
        ripple_action({"type": "closed", "block_id": tgt["id"]}, f"Replace {tgt['name']}", f"{tgt['name']} is closed.")
        return out
    if re.search(r"\b(skip|drop)\b", t) and re.search(r"\b(next|this|stop)\b", t):
        cur, _ = _upcoming(c, day, now_m)
        tgt = cur if cur and cur.get("kind") == "place" and "this" in t else _next_place(c, day, now_m)
        if not tgt:
            out["reply"] = f"There are no more planned stops on Day {day + 1} to skip."
            return out
        out["reply"] = f"I can skip {tgt['name']} and re-fit the rest of the day."
        ripple_action({"type": "skip", "block_id": tgt["id"]}, f"Skip {tgt['name']}", f"You want to skip {tgt['name']}.")
        return out

    # ------------------------------------------------ information intents (answered from trip data)
    if re.search(r"\b(emergency|help me|sos|ambulance|police number|hospital number)\b", t):
        em = [{"label": "All emergencies (ERSS)", "number": "112"}] + [
            {"label": k.replace('_', ' ').title(), "number": v} for k, v in c["city"].get("emergency", {}).items()]
        out["reply"] = "Emergency numbers for " + c["city"]["name"] + ": " + ", ".join(f"{e['label']} {e['number']}" for e in em) + "."
        out["cards"].append({"type": "emergency", "items": em})
        return out

    m = re.search(r"(\d[\d,]*(?:\.\d+)?)\s*(usd|dollars?|eur|euros?|gbp|pounds?|aed|dirhams?|sgd|jpy|yen|aud|cad|inr|rupees?|rs)\b", t)
    if m or re.search(r"\b(convert|exchange rate|in dollars|in euros)\b", t):
        fx = P.fx_rates("INR")
        if not fx["rates"]:
            out["reply"] = "Live exchange rates are unavailable right now, so I won't guess a number."
            return out
        if m:
            amt = float(m[1].replace(",", ""))
            cur = next((v for k, v in CURRENCIES.items() if m[2].startswith(k)), "INR")
            if cur == "INR":
                usd = amt * fx["rates"]["USD"]
                eur = amt * fx["rates"]["EUR"]
                out["reply"] = f"₹{amt:,.0f} ≈ ${usd:,.2f} or €{eur:,.2f}."
            else:
                inr = amt / fx["rates"][cur]
                out["reply"] = f"{amt:,.2f} {cur} ≈ ₹{inr:,.0f}."
        else:
            out["reply"] = f"1 USD ≈ ₹{1 / fx['rates']['USD']:,.2f}, 1 EUR ≈ ₹{1 / fx['rates']['EUR']:,.2f}."
        out["reply"] += f" ({fx['source']}, {fx['date']})"
        out["source"] = "fx"
        return out

    kind = next((k for w, k in NEARBY_WORDS if re.search(rf"\b{w}", t)), None)
    if kind and re.search(r"\b(near|nearby|closest|nearest|around|find|where)\b", t):
        lat, lon = _position(c, day, now_m)
        res = P.nearby(lat, lon, kind)
        if kind == "veg" and len(res.get("items", [])) < 3:
            more = P.nearby(lat, lon, "restaurant")
            res["items"] = (res.get("items") or []) + [i for i in more.get("items", []) if i not in res.get("items", [])]
        if not res.get("configured"):
            out["reply"] = res["detail"]
            return out
        items = res.get("items", [])[:5]
        if not items:
            out["reply"] = res.get("error") or "I couldn't find one within 1.5 km of where you are in the plan."
            return out
        out["reply"] = f"Closest {kind} options near your current stop:"
        out["cards"].append({"type": "places", "items": items, "source": res.get("source")})
        out["source"] = "geoapify"
        return out

    if re.search(r"\b(hotel|hotels|room|rooms|stay options|where to stay)\b", t):
        b = c["brief"]
        lat, lon = (c["stay"]["lat"], c["stay"]["lon"]) if c.get("stay") else c["city"]["center"]
        adults = max(1, len([x for x in c.get("travellers", []) if x.get("age") != "child"]) or 2)
        res = P.hotels(c["city"]["name"], "IN", lat, lon, b.get("start_date") or "", max(1, len(c["days"]) - 1), adults)
        if not res.get("configured"):
            out["reply"] = res["detail"]
            return out
        if not res["items"]:
            out["reply"] = res.get("error") or res.get("detail") or "No rooms came back for those dates."
            return out
        out["reply"] = f"Hotels near {c['stay']['name'] if c.get('stay') else c['city']['name']}, {res['checkin']} to {res['checkout']}:"
        out["cards"].append({"type": "hotels", "items": res["items"], "source": res["source"], "sandbox": res.get("sandbox")})
        out["source"] = "liteapi"
        return out

    if re.search(r"\b(next|now|what'?s on|where (do|should) (i|we) go|schedule|plan for today|today)\b", t):
        cur, nxt = _upcoming(c, day, now_m)
        parts = []
        if cur:
            parts.append(f"Now: {cur['name']} until {cur['end']}.")
        if nxt:
            leg = next((b for b in c["days"][day]["blocks"] if b.get("kind") == "leg" and b["e"] <= nxt["s"] and b["s"] >= (cur or {}).get("s", 0)), None)
            parts.append(f"Next: {nxt['name']} at {nxt['start']}" + (f", leave by {leg['depart_by']} ({leg['minutes']} min by {leg['mode']})." if leg and leg.get("depart_by") else "."))
            if nxt.get("why"):
                parts.append(f"Why: {nxt['why']}")
        if not parts:
            parts.append(f"Nothing else is planned for Day {day + 1} after {_fmt(now_m)}. Enjoy the evening!")
        out["reply"] = " ".join(parts)
        return out

    if re.search(r"\b(weather|rain|umbrella|hot|temperature|forecast)\b", t):
        rows = []
        for d in c["days"]:
            w = d.get("weather") or {}
            rows.append(f"Day {d['index'] + 1} ({d['weekday']}): max {w.get('tmax')}°C, rain {w.get('rain_prob')}% · {w.get('source', '')}")
        rainy = [d for d in c["days"] if (d.get("weather") or {}).get("rain_prob", 0) >= 40]
        out["reply"] = ("Pack an umbrella: rain is likely on " + ", ".join(f"Day {d['index'] + 1}" for d in rainy) + ". "
                        if rainy else "No significant rain expected. ") + " | ".join(rows)
        return out

    if re.search(r"\b(budget|spent|spend|cost|money|expensive|afford)\b", t):
        bud = c.get("budget", {})
        left = (bud.get("budget_total") or bud.get("planned_total", 0)) - bud.get("spent_total", 0)
        out["reply"] = (f"Planned ₹{bud.get('planned_total', 0):,} (incl. ~₹{bud.get('stay_estimate', 0):,}/night stay), "
                        f"spent ₹{bud.get('spent_total', 0):,} so far, about ₹{left:,} left."
                        + (" You're over budget: I can switch to cheaper meals for the rest of the day." if bud.get("over_budget") else ""))
        if bud.get("over_budget"):
            ripple_action({"type": "over_budget"}, "Make today cheaper", "You're over budget.")
        return out

    if re.search(r"\b(pack|packing|ready|checklist|documents?|visa|id proof|readiness)\b", t):
        r = RD.build(c)
        todo = [i["title"] for i in r["checklist"] if not i["done"]]
        out["reply"] = (f"You're {r['score']}% ready" + (f", {r['countdown_days']} days to go" if (r['countdown_days'] or -1) >= 0 else "")
                        + (". Still to do: " + "; ".join(todo[:4]) + "." if todo else ". Everything is ticked."))
        out["cards"].append({"type": "packing", "items": [p["item"] for p in r["packing"]][:10]})
        return out

    if re.search(r"\b(booking|pnr|ticket|train|flight)\b", t):
        bks = c.get("bookings", [])
        out["reply"] = ("; ".join(f"{b['mode'].title()} {b.get('number', '')} on {b.get('date')} at {b.get('time')}"
                                  + (f", PNR {b['pnr']}" if b.get("pnr") else "") + (f", running {b['live_delay']} min late" if b.get("live_delay") else "")
                                  for b in bks) or "No bookings saved yet. Add your ticket in Trip Intelligence.")
        return out

    # ------------------------------------------------ open question: Gemini grounded in the trip, else help
    ans = P.gemini(
        f"Trip context:\n{context_summary(c, day, now_m)}\n\nTraveller asks: {message}",
        system=("You are Tripzy, a concise travel companion for a trip in India. Answer in at most 4 sentences using "
                "the trip context. Never invent prices, opening hours, bookings or live status; if you don't know, say so "
                "and suggest checking an official source. You cannot change the plan yourself: if a change is needed, tell "
                "the traveller to say e.g. 'I'm running 30 min late', 'I'm tired' or 'it's raining'."),
    )
    if ans:
        out["reply"], out["source"] = ans, "gemini"
        return out
    out["reply"] = ("I can help with: what's next, weather, budget, bookings, packing and readiness, nearby cafés, ATMs or pharmacies, "
                    "hotels, currency conversion and emergency numbers. Or tell me 'running 30 min late', 'I'm tired', "
                    "'it's raining', 'stay longer' and I'll re-plan with your confirmation.")
    return out


def alerts(c: dict, documents: int = 0) -> list[dict]:
    """Proactive, deterministic alerts for the trip."""
    out = []
    for d in c.get("days", []):
        w = d.get("weather") or {}
        if (w.get("rain_prob") or 0) >= 50:
            out.append({"level": "warn", "kind": "rain", "day": d["index"],
                        "text": f"Day {d['index'] + 1}: {w['rain_prob']}% chance of rain. Your Plan B has indoor swaps ready."})
        if (w.get("tmax") or 0) >= 36:
            out.append({"level": "warn", "kind": "heat", "day": d["index"],
                        "text": f"Day {d['index'] + 1}: {w['tmax']}°C expected. Outdoor stops are kept to cooler hours."})
        v = d.get("verify") or {}
        if v.get("score") is not None and v["score"] < 70:
            out.append({"level": "warn", "kind": "feasibility", "day": d["index"],
                        "text": f"Day {d['index'] + 1} feasibility is {v['score']}/100. Consider making it lighter."})
        if d.get("end_t", 0) > 22 * 60:
            out.append({"level": "info", "kind": "late", "day": d["index"], "text": f"Day {d['index'] + 1} ends after 10 pm."})
    for b in c.get("bookings", []):
        if b.get("live_delay"):
            out.append({"level": "warn", "kind": "delay", "text": f"{b['mode'].title()} {b.get('number', '')} is running {b['live_delay']} min late."})
    bud = c.get("budget", {})
    if bud.get("over_budget"):
        out.append({"level": "warn", "kind": "budget", "text": "You're over budget. Ask the Companion to make today cheaper."})
    r = RD.build(c, documents)
    if r["countdown_days"] is not None and 0 <= r["countdown_days"] <= 3 and r["score"] < 100:
        out.append({"level": "warn", "kind": "readiness",
                    "text": f"Trip starts in {r['countdown_days']} day(s) and you're {r['score']}% ready."})
    return out
