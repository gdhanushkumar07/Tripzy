"""Live Watcher feeds.

Indian Railways has no free public live-status API, so V1 uses a deterministic
simulator with the same response shape a real feed (NTES or a RailYatri
partner API) would return. Demo triggers can force a delay. Everything is
labelled `simulated` in the UI.
"""

from __future__ import annotations

import hashlib

SAMPLE_TRAINS = {
    "12723": "Telangana Express", "12724": "Telangana Express", "12760": "Charminar Express",
    "12759": "Charminar Express", "12437": "Rajdhani Express", "12985": "Double Decker Express",
    "12956": "Jaipur-Mumbai SF Express", "12015": "Ajmer Shatabdi",
}
SOURCE = "Simulated live feed (plug in NTES/RailYatri partner API in production)"


def _h(s: str) -> int:
    return int(hashlib.sha1(s.encode()).hexdigest()[:8], 16)


def historical_avg_delay(number: str, station: str) -> int:
    """Typical arrival delay used for reliability buffers (sample data)."""
    return 10 + _h(number + station) % 45


def train_status(number: str, date: str, station: str, forced_delay: int | None = None) -> dict:
    delay = forced_delay if forced_delay is not None else _h(number + date) % 35
    return {"number": number, "name": SAMPLE_TRAINS.get(number, f"Train {number}"), "date": date,
            "station": station, "delay_min": delay,
            "status": "On time" if delay < 5 else f"Running {delay} min late",
            "avg_delay_hist": historical_avg_delay(number, station), "source": SOURCE}
