"""Travel Readiness Centre: departure checklist, packing list and destination
guide, derived deterministically from the trip itself (dates, bookings,
weather, party, constraints, documents). No paid API, nothing invented.

Guide content is a short, static summary that links to the official source.
It carries a `reviewed` date and tells the traveller to confirm at the source,
because rules (visa, ID, health) can change after it was written.
"""

from __future__ import annotations

from datetime import date

GUIDE_REVIEWED = "2026-11-14"

OFFICIAL = {
    "evisa": ("Indian e-Visa (Govt. of India)", "https://indianvisaonline.gov.in/evisa/"),
    "irctc_id": ("IRCTC: identity proof rules for train travel", "https://www.irctc.co.in"),
    "digiyatra": ("DigiYatra: paperless airport entry", "https://www.digiyatra.gov.in"),
    "digilocker": ("DigiLocker: official digital documents", "https://www.digilocker.gov.in"),
    "imd": ("India Meteorological Department warnings", "https://mausam.imd.gov.in"),
    "health": ("Ministry of Health & Family Welfare", "https://mohfw.gov.in"),
    "tourism": ("Incredible India (Ministry of Tourism)", "https://www.incredibleindia.gov.in"),
    "erss": ("Emergency Response Support System: dial 112", "https://112.gov.in"),
}


def _days_to(start: str) -> int | None:
    try:
        return (date.fromisoformat(start) - date.today()).days
    except (TypeError, ValueError):
        return None


def build(c: dict, documents: int = 0) -> dict:
    b = c.get("brief", {})
    done = set(c.get("readiness_done", []))
    days = c.get("days", [])
    weather = [d.get("weather") or {} for d in days]
    rainy = any((w.get("rain_prob") or 0) >= 40 for w in weather)
    hot = any((w.get("tmax") or 0) >= 34 for w in weather)
    cool = any((w.get("tmax") or 99) <= 22 for w in weather)
    seniors = b.get("party") == "parents" or any(t.get("age") == "senior" for t in c.get("travellers", []))
    kids = (b.get("kids") or 0) > 0 or any(t.get("age") == "child" for t in c.get("travellers", []))
    places = [x for d in days for x in d.get("blocks", []) if x.get("kind") == "place"]
    spiritual = any(x.get("cat") in ("religious", "temple", "spiritual") for x in places)
    outdoor = any(not x.get("indoor") for x in places)
    bookings = c.get("bookings", [])
    has_train = any(k.get("mode") == "train" for k in bookings)
    has_flight = any(k.get("mode") == "flight" for k in bookings)
    n_days = len(days) or b.get("days") or 1

    # -------------------------------------------------- checklist (auto items are derived, manual ones are ticked)
    items: list[dict] = []

    def add(iid, title, detail, auto=None, link=None, when=None):
        items.append({"id": iid, "title": title, "detail": detail, "auto": auto is not None,
                      "done": bool(auto) if auto is not None else iid in done,
                      "link": link, "when": when})

    add("booking", "Arrival booked", "Add your train or flight so Tripzy can plan around it and watch for delays.",
        auto=bool(bookings))
    add("docs", "Tickets saved in Tripzy", "Upload the PDF or a photo of each ticket. It's stored privately with the trip.",
        auto=documents > 0)
    add("stay", "Stay area chosen", "Tripzy picks the area with the least travel to your must-sees.", auto=bool(c.get("stay")))
    add("id", "Carry original photo ID", "Aadhaar, passport, driving licence or voter ID. "
        + ("Indian Railways checks ID for reserved tickets. " if has_train else "")
        + ("DigiYatra or a printed boarding pass for flights." if has_flight else ""),
        link=OFFICIAL["digilocker"][1], when="before you leave")
    add("offline", "Download offline maps", "Save the city in your maps app in case mobile data drops.", when="day before")
    add("cash", "Some cash + UPI ready", "Autos, street food and temple stalls often prefer cash or UPI.", when="day before")
    add("emergency", "Share the plan with someone at home", "Send them the shared trip link from Tripzy.", when="day before")
    if seniors:
        add("meds", "Medicines for the whole trip", "Pack regular medicines plus a few extra days' supply, in hand luggage.",
            when="before you leave")
    if rainy:
        add("rain", "Rain plan checked", "Tripzy has an indoor Plan B for rain-exposed stops. Open Trip Intelligence to review it.",
            when="day before")
    if hot:
        add("heat", "Heat plan", "Outdoor stops are kept to cooler hours. Carry water and a cap.", when="day of travel")

    total = len(items)
    complete = sum(1 for i in items if i["done"])

    # -------------------------------------------------- packing (each item says why it is on the list)
    pack: list[dict] = []

    def p(item, why, cat):
        pack.append({"item": item, "why": why, "category": cat})

    p("Photo ID (original)", "Needed at stations, airports and hotel check-in", "Documents")
    p("Phone charger + power bank", f"{n_days} day(s) of maps, tickets and photos", "Electronics")
    p(f"Clothes for {n_days} day(s)", "One set per day plus one spare", "Clothing")
    p("Comfortable walking shoes", "Most stops involve walking", "Clothing")
    p("Reusable water bottle", "Stay hydrated between stops", "Essentials")
    if rainy:
        p("Umbrella / rain jacket", "Forecast shows rain chance of 40% or more on at least one day", "Weather")
    if hot:
        p("Sunscreen, cap, sunglasses", "Forecast highs of 34 °C or more", "Weather")
    if cool:
        p("Light jacket or shawl", "Cooler days or evenings in the forecast", "Weather")
    if spiritual:
        p("Clothes covering shoulders and knees", "Your plan includes places of worship", "Clothing")
        p("Socks (shoes come off at temples)", "Floors can be hot or cold", "Clothing")
    if seniors:
        p("Regular medicines + prescriptions", "Travelling with seniors", "Health")
    if kids:
        p("Snacks and wet wipes", "Travelling with children", "Essentials")
    if outdoor:
        p("Small daypack", "Carry water and essentials between outdoor stops", "Essentials")
    if has_train:
        p("Light sheet / travel pillow", "Train journey", "Comfort")
    p("Basic first-aid kit", "Plasters, pain relief, ORS sachets", "Health")

    # -------------------------------------------------- destination guide
    city = c.get("city", {})
    em = city.get("emergency", {})
    guide = {
        "city": city.get("name"),
        "reviewed": GUIDE_REVIEWED,
        "disclaimer": "Summary for planning. Rules can change: always confirm at the official link.",
        "emergency": [{"label": "All emergencies (ERSS)", "number": "112"}]
        + [{"label": k.replace("_", " ").title(), "number": v} for k, v in em.items()],
        "sections": [
            {"title": "Documents", "points": [
                "Indian citizens: carry an original government photo ID. DigiLocker copies are accepted in many places.",
                "Foreign visitors need a valid visa or e-Visa before arrival.",
            ], "links": [OFFICIAL["digilocker"], OFFICIAL["evisa"], *( [OFFICIAL["irctc_id"]] if has_train else [] ),
                         *( [OFFICIAL["digiyatra"]] if has_flight else [] )]},
            {"title": "Health", "points": [
                "No special vaccinations are required for domestic travel. Drink bottled or filtered water.",
                "Carry ORS sachets in hot weather.",
            ], "links": [OFFICIAL["health"]]},
            {"title": "Weather", "points": [
                ("Rain is likely on some days. Indoor alternatives are in your Plan B." if rainy else
                 "No significant rain expected in the forecast you have."),
                "Check official weather warnings before outdoor stops.",
            ], "links": [OFFICIAL["imd"]]},
            {"title": "Local tips", "points": [
                f"Useful phrase: {city.get('local_phrase')}" if city.get("local_phrase") else "Learn a greeting in the local language.",
                "Agree auto fares before the ride or use the meter. App cabs show the fare upfront.",
                *( ["Dress modestly and remove footwear at places of worship."] if spiritual else [] ),
            ], "links": [OFFICIAL["tourism"]]},
        ],
    }

    return {
        "countdown_days": _days_to(b.get("start_date")),
        "start_date": b.get("start_date"),
        "score": round(100 * complete / total) if total else 0,
        "complete": complete, "total": total,
        "checklist": items, "packing": pack, "guide": guide,
        "sources": [{"name": n, "url": u} for n, u in OFFICIAL.values()],
    }
