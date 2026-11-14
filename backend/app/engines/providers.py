"""Free-tier external providers. Every adapter reports `configured` honestly and
never invents data: when a provider is missing or fails, callers get an explicit
status instead of a made-up price, place or rate.

Keys are read from the environment only (loaded from api-keys.env by start.sh)
and never leave the server.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from datetime import date, timedelta
from typing import Optional

import httpx

UA = {"User-Agent": "Tripzy/2.0 (student hackathon project)"}
_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: float, fn):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (time.time(), val)
    return val


def status() -> dict:
    return {
        "gemini": bool(os.getenv("GEMINI_API_KEY")),
        "geoapify": bool(os.getenv("GEOAPIFY_API_KEY")),
        "liteapi": bool(os.getenv("LITEAPI_KEY")),
        "liteapi_sandbox": (os.getenv("LITEAPI_KEY") or "").startswith("sand_"),
        "travelpayouts": bool(os.getenv("TRAVELPAYOUTS_TOKEN") and os.getenv("TRAVELPAYOUTS_MARKER")),
        "tesseract": bool(shutil.which("tesseract")),
    }


# ------------------------------------------------------------------ Gemini (free tier)

GEMINI_MODELS = [m for m in (os.getenv("GEMINI_MODEL"), "gemini-3.5-flash", "gemini-3.5-flash-lite") if m]


def gemini(prompt: str, system: str = "", timeout: float = 25) -> Optional[str]:
    """Plain-text answer from Gemini's Interactions API, or None when unavailable."""
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        return None
    for model in GEMINI_MODELS:
        try:
            body = {"model": model, "input": prompt}
            if system:
                body["system_instruction"] = system
            r = httpx.post("https://generativelanguage.googleapis.com/v1beta/interactions",
                           headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                           json=body, timeout=timeout)
            if r.status_code != 200:
                continue
            for step in r.json().get("steps", []):
                if step.get("type") == "model_output":
                    text = "".join(p.get("text", "") for p in step.get("content", []) if p.get("type") == "text")
                    if text.strip():
                        return text.strip()
        except Exception:
            continue
    return None


# ------------------------------------------------------------------ currency (no key)

def fx_rates(base: str = "INR") -> dict:
    """Live reference rates. Frankfurter (ECB) first, open.er-api.com as fallback."""
    base = base.upper()

    def fetch():
        try:
            r = httpx.get("https://api.frankfurter.dev/v1/latest", params={"base": base}, timeout=8, headers=UA)
            if r.status_code == 200:
                d = r.json()
                return {"base": base, "date": d.get("date"), "rates": d.get("rates", {}),
                        "source": "Frankfurter (European Central Bank reference rates)"}
        except Exception:
            pass
        try:
            r = httpx.get(f"https://open.er-api.com/v6/latest/{base}", timeout=8, headers=UA)
            d = r.json()
            if d.get("result") == "success":
                return {"base": base, "date": (d.get("time_last_update_utc") or "")[:16], "rates": d.get("rates", {}),
                        "source": "ExchangeRate-API open access (rates by exchangerate-api.com)"}
        except Exception:
            pass
        return None

    out = _cached(f"fx:{base}", 6 * 3600, fetch)
    if out is None:
        _cache.pop(f"fx:{base}", None)
        return {"base": base, "date": None, "rates": {}, "source": None, "error": "Rates unavailable right now"}
    return out


# ------------------------------------------------------------------ Geoapify places (free 3k/day)

PLACE_KINDS = {
    "cafe": "catering.cafe",
    "restaurant": "catering.restaurant",
    "veg": "catering.restaurant",
    "atm": "service.financial.atm",
    "pharmacy": "healthcare.pharmacy",
    "hospital": "healthcare.hospital",
    "toilet": "amenity.toilet",
    "police": "service.police",
    "sights": "tourism.sights",
    "shopping": "commercial.shopping_mall,commercial.marketplace",
    "fuel": "service.vehicle.fuel",
}


def nearby(lat: float, lon: float, kind: str = "cafe", radius: int = 1500, limit: int = 8) -> dict:
    key = os.getenv("GEOAPIFY_API_KEY")
    if not key:
        return {"configured": False, "items": [], "detail": "Live place search needs GEOAPIFY_API_KEY (free)."}
    cats = PLACE_KINDS.get(kind, PLACE_KINDS["cafe"])
    params = {"categories": cats, "filter": f"circle:{lon},{lat},{radius}", "bias": f"proximity:{lon},{lat}",
              "limit": limit, "apiKey": key}
    if kind == "veg":
        params["conditions"] = "vegetarian"

    def fetch():
        r = httpx.get("https://api.geoapify.com/v2/places", params=params, timeout=10, headers=UA)
        r.raise_for_status()
        items = []
        for f in r.json().get("features", []):
            p = f.get("properties", {})
            if not p.get("name"):
                continue
            items.append({
                "name": p.get("name"), "address": p.get("address_line2") or p.get("formatted"),
                "lat": p.get("lat"), "lon": p.get("lon"), "distance_m": p.get("distance"),
                "opening_hours": (p.get("datasource", {}).get("raw", {}) or {}).get("opening_hours"),
                "categories": [c for c in p.get("categories", []) if "." in c][:3],
            })
        return items

    try:
        items = _cached(f"geo:{kind}:{round(lat, 3)}:{round(lon, 3)}:{radius}", 3600, fetch)
        return {"configured": True, "items": items, "source": "Geoapify (© OpenStreetMap contributors)"}
    except Exception as e:
        return {"configured": True, "items": [], "error": f"Place search failed ({type(e).__name__})"}


# ------------------------------------------------------------------ LiteAPI hotels (free sandbox)

def hotels(city_name: str, country: str, lat: float, lon: float, checkin: str, nights: int,
           adults: int = 2, currency: str = "INR", limit: int = 6) -> dict:
    key = os.getenv("LITEAPI_KEY")
    if not key:
        return {"configured": False, "items": [], "detail": "Hotel comparison needs LITEAPI_KEY (free sandbox)."}
    sandbox = key.startswith("sand_")
    h = {"X-API-Key": key, "accept": "application/json", **UA}
    try:
        ci = date.fromisoformat(checkin)
    except ValueError:
        ci = date.today() + timedelta(days=14)
    if ci <= date.today():
        ci = date.today() + timedelta(days=7)
    co = ci + timedelta(days=max(1, nights))

    def fetch():
        r = httpx.get("https://api.liteapi.travel/v3.0/data/hotels", headers=h, timeout=15,
                      params={"latitude": lat, "longitude": lon, "radius": 6000, "limit": 20})
        r.raise_for_status()
        meta = {x["id"]: x for x in r.json().get("data", []) if x.get("id")}
        if not meta:
            return []
        rr = httpx.post("https://api.liteapi.travel/v3.0/hotels/rates", headers=h, timeout=25, json={
            "hotelIds": list(meta)[:20], "occupancies": [{"adults": max(1, adults)}], "currency": currency,
            "guestNationality": country, "checkin": ci.isoformat(), "checkout": co.isoformat(), "maxRatesPerHotel": 1,
        })
        rr.raise_for_status()
        out = []
        for hd in rr.json().get("data", []):
            m = meta.get(hd.get("hotelId"), {})
            try:
                rate = hd["roomTypes"][0]["rates"][0]
                total = rate["retailRate"]["total"][0]
                refundable = (rate.get("cancellationPolicies") or {}).get("refundableTag") == "RFN"
            except (KeyError, IndexError, TypeError):
                continue
            out.append({
                "id": hd.get("hotelId"), "name": m.get("name"), "stars": m.get("stars"), "rating": m.get("rating"),
                "reviews": m.get("reviewCount"), "address": m.get("address"), "lat": m.get("latitude"),
                "lon": m.get("longitude"), "photo": m.get("main_photo") or m.get("thumbnail"),
                "room": rate.get("name"), "board": rate.get("boardName"),
                "total": round(float(total.get("amount", 0))), "currency": total.get("currency", currency),
                "refundable": refundable,
            })
        out.sort(key=lambda x: x["total"])
        return out[:limit]

    try:
        items = _cached(f"hotels:{round(lat, 3)}:{round(lon, 3)}:{ci}:{nights}:{adults}", 1800, fetch)
        return {"configured": True, "sandbox": sandbox, "checkin": ci.isoformat(), "checkout": co.isoformat(),
                "items": items, "source": "LiteAPI" + (" sandbox (test prices, not bookable)" if sandbox else ""),
                **({"detail": "No rooms returned for these dates."} if not items else {})}
    except Exception as e:
        return {"configured": True, "sandbox": sandbox, "items": [], "error": f"Hotel search failed ({type(e).__name__})"}


# ------------------------------------------------------------------ Travelpayouts flights (free affiliate)

def flights(origin: str, destination: str, depart: str, currency: str = "INR") -> dict:
    token, marker = os.getenv("TRAVELPAYOUTS_TOKEN"), os.getenv("TRAVELPAYOUTS_MARKER")
    if not (token and marker):
        return {"configured": False, "items": [],
                "detail": "Flight comparison needs a free Travelpayouts token + marker. Not configured."}
    try:
        r = httpx.get("https://api.travelpayouts.com/aviasales/v3/prices_for_dates", timeout=12, headers=UA, params={
            "origin": origin, "destination": destination, "departure_at": depart[:7], "currency": currency.lower(),
            "sorting": "price", "limit": 6, "token": token})
        r.raise_for_status()
        items = [{
            "airline": f.get("airline"), "flight_number": f.get("flight_number"), "depart": f.get("departure_at"),
            "price": f.get("price"), "transfers": f.get("transfers"), "duration_min": f.get("duration"),
            "link": f"https://www.aviasales.com{f.get('link', '')}&marker={marker}" if f.get("link") else None,
        } for f in r.json().get("data", [])]
        return {"configured": True, "items": items, "affiliate": True,
                "source": "Travelpayouts cached fares (may differ from the live price; affiliate links)"}
    except Exception as e:
        return {"configured": True, "items": [], "error": f"Flight search failed ({type(e).__name__})"}


# ------------------------------------------------------------------ OCR (local Tesseract)

def ocr_image(raw: bytes, suffix: str = ".png") -> Optional[str]:
    """Text from a photo using the local Tesseract binary. None if Tesseract is not installed."""
    exe = shutil.which("tesseract")
    if not exe:
        return None
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(raw)
        f.flush()
        try:
            p = subprocess.run([exe, f.name, "stdout", "--psm", "6"], capture_output=True, timeout=40)
        except subprocess.TimeoutExpired:
            return ""
        return p.stdout.decode("utf-8", errors="ignore")
