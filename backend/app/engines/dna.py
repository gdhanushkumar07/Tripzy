"""Trip DNA - 60-second swipe personalisation plus the energy model."""

from __future__ import annotations

TAGS = ["history", "culture", "food", "shopping", "nature", "spiritual", "art",
        "nightlife", "photography", "adventure", "kids", "entertainment"]

CARDS = [
    {"id": "c1", "a": {"label": "Sunrise at a fort", "emoji": "🌅", "fx": {"morning": .3, "t:photography": .2, "t:history": .1}},
     "b": {"label": "Sleep in, slow breakfast", "emoji": "😴", "fx": {"morning": -.35, "pace": -.15}}},
    {"id": "c2", "a": {"label": "Old bazaar buzz", "emoji": "🛍️", "fx": {"crowd": .3, "t:shopping": .3, "t:culture": .2}},
     "b": {"label": "Quiet garden walk", "emoji": "🌿", "fx": {"crowd": -.3, "t:nature": .35}}},
    {"id": "c3", "a": {"label": "Street-food crawl", "emoji": "🍢", "fx": {"food": .4, "t:food": .35}},
     "b": {"label": "Trusted sit-down restaurant", "emoji": "🍽️", "fx": {"food": -.25}}},
    {"id": "c4", "a": {"label": "Museum deep-dive", "emoji": "🏛️", "fx": {"t:art": .35, "t:history": .2}},
     "b": {"label": "Skip museums, just wander", "emoji": "🚶", "fx": {"t:art": -.25, "t:photography": .1}}},
    {"id": "c5", "a": {"label": "Climb 400 steps for the view", "emoji": "🧗", "fx": {"stamina": .3, "t:adventure": .35}},
     "b": {"label": "The view from the cafe is fine", "emoji": "☕", "fx": {"stamina": -.3, "t:adventure": -.2}}},
    {"id": "c6", "a": {"label": "Pack in 6 places a day", "emoji": "⚡", "fx": {"pace": .4}},
     "b": {"label": "2-3 places, done properly", "emoji": "🧘", "fx": {"pace": -.4}}},
    {"id": "c7", "a": {"label": "Temple aarti at dusk", "emoji": "🪔", "fx": {"t:spiritual": .45}},
     "b": {"label": "City lights at dusk", "emoji": "🌆", "fx": {"t:nightlife": .35}}},
    {"id": "c8", "a": {"label": "Splurge on one great experience", "emoji": "💎", "fx": {"budget": .3}},
     "b": {"label": "Smart savings everywhere", "emoji": "💰", "fx": {"budget": -.3}}},
    {"id": "c9", "a": {"label": "Golden-hour photos", "emoji": "📸", "fx": {"t:photography": .4}},
     "b": {"label": "Phone stays in pocket", "emoji": "🙈", "fx": {"t:photography": -.3, "t:culture": .1}}},
    {"id": "c10", "a": {"label": "Fun attractions for all ages", "emoji": "🎡", "fx": {"t:kids": .4, "t:entertainment": .3}},
     "b": {"label": "Grown-up heritage only", "emoji": "🏰", "fx": {"t:history": .3, "t:kids": -.3, "t:entertainment": -.2}}},
    {"id": "c11", "a": {"label": "Join the festival crowd", "emoji": "🎉", "fx": {"crowd": .3, "t:culture": .3}},
     "b": {"label": "Avoid crowds at all costs", "emoji": "🚫", "fx": {"crowd": -.4}}},
    {"id": "c12", "a": {"label": "Late-night city lights", "emoji": "🌃", "fx": {"t:nightlife": .4}},
     "b": {"label": "Back at the hotel by 9", "emoji": "🛏️", "fx": {"t:nightlife": -.3, "pace": -.1}}},
]


def base_dna() -> dict:
    return {"pace": .5, "stamina": .5, "food": .5, "crowd": .5, "budget": .5, "morning": .5,
            "interests": {t: .5 for t in TAGS}}


def _clamp(x: float) -> float:
    return round(max(0.0, min(1.0, x)), 3)


def apply_fx(dna: dict, fx: dict, scale: float = 1.0) -> None:
    for k, v in fx.items():
        if k.startswith("t:"):
            t = k[2:]
            dna["interests"][t] = _clamp(dna["interests"].get(t, .5) + v * scale)
        else:
            dna[k] = _clamp(dna.get(k, .5) + v * scale)


def dna_from_swipes(swipes: dict[str, str], hints: list[str] | None = None) -> dict:
    dna = base_dna()
    by_id = {c["id"]: c for c in CARDS}
    for cid, choice in (swipes or {}).items():
        c = by_id.get(cid)
        if c and choice in ("a", "b"):
            apply_fx(dna, c[choice]["fx"])
    for h in hints or []:  # interests mentioned in the one-line brief
        if h in dna["interests"]:
            dna["interests"][h] = _clamp(dna["interests"][h] + .25)
    return dna


def describe(dna: dict) -> list[str]:
    out = []
    p = dna["pace"]
    out.append("Relaxed pace" if p < .4 else "Packed days" if p > .65 else "Balanced pace")
    out.append("Early bird" if dna["morning"] > .6 else "Late starter" if dna["morning"] < .4 else "Normal mornings")
    if dna["crowd"] < .35:
        out.append("Crowd-averse")
    if dna["food"] > .65:
        out.append("Street-food lover")
    top = sorted(dna["interests"].items(), key=lambda kv: -kv[1])[:3]
    out.append("Loves " + ", ".join(t for t, _ in top))
    return out


# ---------------------------------------------------------------- party & energy

def party_from(kind: str, kids: int = 0) -> list[dict]:
    kind = (kind or "solo").lower()
    adults = {"solo": 1, "couple": 2, "friends": 4, "family": 2, "parents": 1}.get(kind, 1)
    ppl = [{"label": f"Adult {i + 1}", "age": "adult", "mobility": "normal"} for i in range(adults)]
    if kind == "parents":
        ppl += [{"label": "Mom", "age": "senior", "mobility": "normal"},
                {"label": "Dad", "age": "senior", "mobility": "normal"}]
    for i in range(kids):
        ppl.append({"label": f"Kid {i + 1}", "age": "child", "mobility": "normal"})
    return ppl


def energy_budget(dna: dict, travellers: list[dict], constraints: dict | None = None) -> dict:
    """Daily energy budget in units. The whole group moves together, so the
    weakest traveller sets the limit. Returns {budget, limiter, explain}."""
    adult = 70 + dna["stamina"] * 60
    caps = []
    for t in travellers:
        cap = adult
        if t.get("age") == "senior":
            cap = min(cap, 85)
        if t.get("age") == "child":
            cap = min(cap, 90)
        if t.get("mobility") == "limited":
            cap = min(cap, 70)
        caps.append((cap, t["label"]))
    if (constraints or {}).get("no_stairs"):
        caps.append((min(adult, 80), "no-climb constraint"))
    budget, limiter = min(caps) if caps else (adult, "you")
    return {"budget": round(budget), "limiter": limiter,
            "explain": f"Daily energy budget {round(budget)} units, set by {limiter}"}


def block_energy(place: dict, dwell: int, start: int, travellers: list[dict], tmax: float | None) -> float:
    e = place.get("intensity", 3) * dwell / 60 * 4.5
    if place.get("stairs") and any(t.get("age") == "senior" or t.get("mobility") == "limited" for t in travellers):
        e *= 1.5
    if not place.get("indoor") and tmax is not None and tmax >= 32 and 12 * 60 <= start <= 16 * 60:
        e *= 1.3
    return round(e, 1)


def leg_energy(leg: dict) -> float:
    if leg["mode"] == "walk":
        return round(leg["km"] * 6, 1)
    return round(leg["minutes"] / 10, 1)


def interest_match(place: dict, dna: dict) -> float:
    tags = place.get("tags") or []
    if not tags:
        return .4
    vals = sorted((dna["interests"].get(t, .5) for t in tags), reverse=True)
    # weight the strongest tag most: a place is great if it nails one thing you love
    w = [1.0, .5, .25, .15]
    return round(sum(v * w[i] for i, v in enumerate(vals[:4])) / sum(w[:len(vals[:4])]), 3)


def learn(dna: dict, place: dict | None, reaction: str, actual_dwell: int | None, planned_dwell: int | None) -> list[str]:
    """Self-learning: update DNA from one in-trip reaction. Returns what changed."""
    notes = []
    if place:
        delta = {"loved": .08, "ok": 0, "skip": -.12}.get(reaction, 0)
        if delta:
            for t in place.get("tags", [])[:2]:
                before = dna["interests"].get(t, .5)
                dna["interests"][t] = _clamp(before + delta)
                notes.append(f"{'More' if delta > 0 else 'Less'} {t} ({before:.2f} -> {dna['interests'][t]:.2f})")
    if actual_dwell and planned_dwell:
        ratio = actual_dwell / planned_dwell
        if ratio > 1.3:
            dna["pace"] = _clamp(dna["pace"] - .05)
            notes.append("You linger longer than planned, so future days are slower-paced")
        elif ratio < .6:
            dna["pace"] = _clamp(dna["pace"] + .04)
            notes.append("You move quickly, so more stops are allowed per day")
    if reaction == "tired":
        dna["stamina"] = _clamp(dna["stamina"] - .05)
        notes.append("Energy budget lowered slightly for the rest of the trip")
    return notes
