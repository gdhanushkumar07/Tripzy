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
