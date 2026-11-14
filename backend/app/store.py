"""Tiny JSON-file persistence for Trip Capsules and collective learning."""

from __future__ import annotations

import json
import secrets
import statistics
import threading

from .engines.routing import STORE

TRIPS = STORE / "trips"
TRIPS.mkdir(parents=True, exist_ok=True)
DWELL = STORE / "dwell_stats.json"
_lock = threading.Lock()


def new_trip_id() -> str:
    return secrets.token_urlsafe(6).replace("-", "x").replace("_", "y")


def save(capsule: dict) -> None:
    with _lock:
        (TRIPS / f"{capsule['id']}.json").write_text(json.dumps(capsule, ensure_ascii=False))


def load(trip_id: str) -> dict | None:
    f = TRIPS / f"{trip_id}.json"
    if not f.exists() or "/" in trip_id or ".." in trip_id:
        return None
    return json.loads(f.read_text())


def record_dwell(place_id: str, minutes: int) -> None:
    with _lock:
        data = json.loads(DWELL.read_text()) if DWELL.exists() else {}
        data.setdefault(place_id, []).append(int(minutes))
        DWELL.write_text(json.dumps(data))


def learned_dwell(min_samples: int = 3) -> dict[str, int]:
    """Collective learning: median real stay time, once enough trips report it."""
    if not DWELL.exists():
        return {}
    data = json.loads(DWELL.read_text())
    return {k: int(statistics.median(v)) for k, v in data.items() if len(v) >= min_samples}


# ------------------------------------------------------------------ Travel DNA profiles (per platform user)
PROFILES = STORE / "profiles"
PROFILES.mkdir(parents=True, exist_ok=True)


def load_profile(user_id: int | None) -> dict | None:
    if user_id is None:
        return None
    f = PROFILES / f"{int(user_id)}.json"
    return json.loads(f.read_text()) if f.exists() else None


def save_profile(user_id: int, profile: dict) -> None:
    with _lock:
        (PROFILES / f"{int(user_id)}.json").write_text(json.dumps(profile, ensure_ascii=False))


def capsules_of(user_id: int) -> list[dict]:
    out = []
    for f in TRIPS.glob("*.json"):
        try:
            c = json.loads(f.read_text())
        except Exception:
            continue
        if c.get("owner") == user_id:
            out.append(c)
    out.sort(key=lambda c: c.get("created_at", ""), reverse=True)
    return out
