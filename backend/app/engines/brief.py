"""One-sentence brief -> structured TripBrief.

Rule-based parser by default. If ANTHROPIC_API_KEY is set, Claude
(structured output) parses the sentence and the rules fill any gaps, so the
demo never depends on a network LLM call.
"""

from __future__ import annotations

import os
import re
from datetime import date, timedelta
from typing import Literal, Optional

from pydantic import BaseModel

from ..data.cities import CITIES, PLACES, find_city

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
WORDNUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7}
INTEREST_WORDS = {
    "history": ["history", "heritage", "fort", "palace", "monument"],
    "food": ["food", "biryani", "street food", "foodie", "eat", "cuisine"],
    "shopping": ["shopping", "bazaar", "market", "shop"],
    "spiritual": ["temple", "spiritual", "pilgrimage", "mosque", "darshan"],
    "nature": ["nature", "lake", "park", "garden"],
    "photography": ["photo", "instagram", "sunset", "sunrise"],
    "nightlife": ["nightlife", "night out", "late night"],
    "art": ["art", "museum", "craft"],
    "adventure": ["adventure", "trek", "hike", "climb"],
    "kids": ["kids", "children", "zoo"],
}


class TripBrief(BaseModel):
    city: Optional[str] = None
    start_date: Optional[str] = None
    days: int = 3
    party: Literal["solo", "couple", "friends", "family", "parents"] = "solo"
    kids: int = 0
    diet: Literal["any", "veg", "jain", "halal"] = "any"
    budget_total: Optional[int] = None
    budget_style: Literal["low", "mid", "high"] = "mid"
    interests: list[str] = []
    must: list[str] = []
    avoid: list[str] = []
    no_stairs: bool = False
    raw: str = ""
    parsed_by: str = "rules"
    assumptions: list[str] = []


def _next_weekday(d: date, wd: int) -> date:
    return d + timedelta(days=(wd - d.weekday()) % 7 or 7)


def _parse_date(t: str, today: date) -> Optional[date]:
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3]))
    day = mon = None
    for m in re.finditer(r"(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*", t):
        if m[2] in MONTHS:
            day, mon = int(m[1]), MONTHS[m[2]]
            break
    if not day:
        for m2 in re.finditer(r"\b([a-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b", t):
            if m2[1] in MONTHS:
                day, mon = int(m2[2]), MONTHS[m2[1]]
                break
    if day and mon:
        y = today.year if (mon, day) >= (today.month, today.day) else today.year + 1
        try:
            return date(y, mon, day)
        except ValueError:
            return None
    if "tomorrow" in t:
        return today + timedelta(days=1)
    if "weekend" in t:
        return _next_weekday(today, 5)
    if "next week" in t:
        return _next_weekday(today, 0)
    return None


def parse_rules(text: str, today: date | None = None) -> TripBrief:
    today = today or date.today()
    t = " " + text.lower().replace(",", " , ") + " "
    b = TripBrief(raw=text)
    b.city = find_city(t)

    m = re.search(r"(\d+|" + "|".join(WORDNUM) + r")\s*-?\s*(days?|d\b)", t)
    n = re.search(r"(\d+|" + "|".join(WORDNUM) + r")\s*-?\s*nights?", t)
    if m:
        b.days = int(WORDNUM.get(m[1], m[1]))
    elif n:
        b.days = int(WORDNUM.get(n[1], n[1])) + 1
    elif "weekend" in t:
        b.days = 2
    else:
        b.assumptions.append("Assumed 3 days")
    b.days = max(1, min(7, b.days))

    d = _parse_date(t, today)
    if d is None:
        d = today + timedelta(days=7)
        b.assumptions.append(f"Assumed start {d.isoformat()}")
    b.start_date = d.isoformat()

    if re.search(r"\b(parents|mom|dad|mother|father|grand)", t):
        b.party = "parents"
    elif re.search(r"\b(kids?|children|son|daughter|family)\b", t):
        b.party = "family"
        k = re.search(r"(\d+|" + "|".join(WORDNUM) + r")\s+(kids?|children)", t)
        b.kids = int(WORDNUM.get(k[1], k[1])) if k else (2 if "kid" in t or "children" in t else 0)
    elif re.search(r"\b(wife|husband|partner|girlfriend|boyfriend|couple|honeymoon)\b", t):
        b.party = "couple"
    elif re.search(r"\b(friends|gang|buddies|colleagues)\b", t):
        b.party = "friends"

    if "jain" in t:
        b.diet = "jain"
    elif re.search(r"\b(veg|vegetarian|pure veg)\b", t) and "non-veg" not in t and "nonveg" not in t:
        b.diet = "veg"
    elif "halal" in t:
        b.diet = "halal"

    raw = " " + text.lower() + " "
    m = re.search(r"(?:₹|rs\.?|inr)\s*([\d,]+)\s*(k)?", raw) or re.search(r"\b(\d+)\s*k\b", raw)
    if m:
        v = int(m[1].replace(",", ""))
        if (m.lastindex or 0) >= 2 and m[2] == "k" or re.search(r"\d+\s*k\b", m[0]):
            v *= 1000
        b.budget_total = v
    if re.search(r"\b(budget|cheap|backpack|low cost|save)\b", t):
        b.budget_style = "low"
    elif re.search(r"\b(luxury|premium|splurge)\b", t):
        b.budget_style = "high"

    if re.search(r"(can'?t|cannot|no|avoid)\s+(climb|stairs|steps|walking)|knee|wheelchair", t):
        b.no_stairs = True
    b.interests = [k for k, words in INTEREST_WORDS.items() if any(w in t for w in words)]
    city_places = [p for p in PLACES if p["city"] == b.city] if b.city else []
    for p in city_places:
        key = p["name"].lower().split("(")[0].split(",")[0].strip()
        first = key.split()[0]
        if key in t or (len(first) >= 6 and f" {first}" in t):
            b.must.append(p["id"])
    if not b.city:
        b.assumptions.append("City not recognised. Supported: " + ", ".join(c["name"] for c in CITIES.values()))
    return b


class _LLMBrief(BaseModel):
    city: Optional[str]
    start_date: Optional[str]
    days: Optional[int]
    party: Optional[Literal["solo", "couple", "friends", "family", "parents"]]
    kids: Optional[int]
    diet: Optional[Literal["any", "veg", "jain", "halal"]]
    budget_total: Optional[int]
    budget_style: Optional[Literal["low", "mid", "high"]]
    interests: list[str]
    no_stairs: Optional[bool]


def parse(text: str) -> TripBrief:
    b = parse_rules(text)
    if not os.getenv("ANTHROPIC_API_KEY"):
        return b
    try:
        import anthropic
        client = anthropic.Anthropic()
        resp = client.messages.parse(
            model=os.getenv("TRIPZY_MODEL", "claude-opus-5-5"),
            max_tokens=2000,
            messages=[{"role": "user", "content":
                       f"Today is {date.today().isoformat()}. Extract the trip brief from this traveller "
                       f"message. City must be one of {list(CITIES)} (lowercase key) or null. Dates ISO. "
                       f"Interests only from: {list(INTEREST_WORDS)}.\n\nMessage: {text}"}],
            output_format=_LLMBrief,
        )
        if resp.stop_reason == "refusal" or resp.parsed_output is None:
            return b
        o = resp.parsed_output
        for k in ("city", "start_date", "days", "party", "kids", "diet", "budget_total", "budget_style", "no_stairs"):
            v = getattr(o, k)
            if v is not None and (k != "city" or v in CITIES):
                setattr(b, k, v)
        b.interests = sorted(set(b.interests) | {i for i in o.interests if i in INTEREST_WORDS})
        b.parsed_by = "claude"
        b.assumptions = [a for a in b.assumptions if not a.startswith("City not")] if b.city else b.assumptions
    except Exception:
        pass
    return b


# ------------------------------------------------------------------ chat edits

def parse_edit(text: str, city_key: str, n_days: int) -> list[dict]:
    """'make day 2 lighter', 'add biryani', 'dad can't climb', 'start later'..."""
    t = text.lower()
    ops: list[dict] = []
    dm = re.search(r"day\s*(\d)", t)
    day = int(dm[1]) - 1 if dm and 0 < int(dm[1]) <= n_days else None
    if re.search(r"lighter|relax|less|slower|tired|easy", t):
        ops.append({"op": "energy_scale", "day": day, "value": .7})
    if re.search(r"pack|more places|busier|intense", t):
        ops.append({"op": "energy_scale", "day": day, "value": 1.25})
    if re.search(r"(can'?t|cannot|no|avoid|without)\s+(climb|stairs|steps)|knee|wheelchair", t):
        ops.append({"op": "no_stairs"})
    if re.search(r"start (later|late)|sleep in|late start", t):
        ops.append({"op": "start_shift", "day": day, "value": 60})
    if re.search(r"start (earlier|early)|early start|sunrise", t):
        ops.append({"op": "start_shift", "day": day, "value": -60})
    if re.search(r"cheaper|save money|budget", t):
        ops.append({"op": "budget", "value": "low"})
    if re.search(r"\bveg\b|vegetarian", t) and "non" not in t:
        ops.append({"op": "diet", "value": "veg"})
    remove = re.search(r"(remove|skip|drop|no|avoid|don'?t want)\s+(.+)", t)
    add = re.search(r"(add|include|want|visit|see|try|must)\s+(.+)", t)
    city_places = [p for p in PLACES if p["city"] == city_key]

    def match(fragment: str):
        hits = []
        for p in city_places:
            name = p["name"].lower()
            words = [w for w in re.split(r"\W+", fragment) if len(w) >= 4]
            if any(w in name for w in words) or any(w in p.get("desc", "").lower() for w in words if w in ("biryani", "dosa", "chai", "kachori", "thali", "haleem")):
                hits.append(p["id"])
        return hits

    if remove and not ops:
        for pid in match(remove[2]):
            ops.append({"op": "exclude", "place_id": pid})
    elif add:
        for pid in match(add[2])[:2]:
            ops.append({"op": "must", "place_id": pid, "day": day})
    return ops
