"""Travel layer: real road times from OSRM (OpenStreetMap), with fallback.

One OSRM `table` call per city gives a full duration/distance matrix between
every place, stay area and station. It is cached on disk, so later runs and
the live re-planner work offline. If OSRM is unreachable, a straight-line
distance x 1.35 road factor at city speed is used and the leg is marked
`source: "estimate"`.
"""

from __future__ import annotations

import json
import math
import os
import threading
from pathlib import Path

import httpx

from ..data.cities import CITIES, places_for
from .timeutil import ceil5

OSRM_URL = os.getenv("OSRM_URL", "https://router.project-osrm.org")
STORE = Path(os.getenv("TRIPZY_STORE", Path(__file__).resolve().parents[2] / "data_store"))
STORE.mkdir(parents=True, exist_ok=True)
_CACHE_FILE = STORE / "osrm_matrix_cache.json"
_lock = threading.Lock()
_matrices: dict[str, dict] = {}

PEAKS = [(8 * 60 + 30, 10 * 60 + 30), (17 * 60 + 30, 20 * 60 + 30)]


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    d = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(d))


def city_nodes(city_key: str) -> dict[str, tuple[float, float]]:
    c = CITIES[city_key]
    nodes = {p["id"]: (p["lat"], p["lon"]) for p in places_for(city_key)}
    for s in c["stay_areas"]:
        nodes[f"stay:{s['id']}"] = (s["lat"], s["lon"])
    for s in c["stations"]:
        nodes[f"station:{s['id']}"] = (s["lat"], s["lon"])
    return nodes


def _load_cache() -> dict:
    if _CACHE_FILE.exists():
        try:
            return json.loads(_CACHE_FILE.read_text())
        except Exception:
            return {}
    return {}


def get_matrix(city_key: str) -> dict:
    """Returns {ids, idx, dur (sec), dist (m), source}."""
    with _lock:
        if city_key in _matrices:
            return _matrices[city_key]
        nodes = city_nodes(city_key)
        ids = list(nodes.keys())
        cache = _load_cache()
        entry = cache.get(city_key)
        if not entry or entry.get("ids") != ids:
            entry = _fetch_osrm(ids, nodes)
            if entry["source"] == "osrm":
                cache[city_key] = entry
                _CACHE_FILE.write_text(json.dumps(cache))
        entry["idx"] = {i: n for n, i in enumerate(entry["ids"])}
        entry["nodes"] = nodes
        _matrices[city_key] = entry
        return entry


def _fetch_osrm(ids, nodes) -> dict:
    coords = ";".join(f"{nodes[i][1]},{nodes[i][0]}" for i in ids)
    try:
        r = httpx.get(f"{OSRM_URL}/table/v1/driving/{coords}",
                      params={"annotations": "duration,distance"}, timeout=20)
        data = r.json()
        if data.get("code") == "Ok":
            return {"ids": ids, "dur": data["durations"], "dist": data["distances"], "source": "osrm"}
    except Exception:
        pass
    n = len(ids)
    dur = [[0.0] * n for _ in range(n)]
    dist = [[0.0] * n for _ in range(n)]
    for a in range(n):
        for b in range(n):
            km = haversine_km(nodes[ids[a]], nodes[ids[b]]) * 1.35
            dist[a][b] = km * 1000
            dur[a][b] = km / 24 * 3600
    return {"ids": ids, "dur": dur, "dist": dist, "source": "estimate"}


def traffic_factor(t: int) -> float:
    for a, b in PEAKS:
        if a <= t <= b:
            return 1.6
    return 1.2


def is_peak(t: int) -> bool:
    return traffic_factor(t) > 1.5


def leg(city_key: str, a: str, b: str, depart: int, party_size: int = 1,
        limited_mobility: bool = False, pos: dict | None = None) -> dict:
    """Door-to-door leg between two node ids (place id, stay:<id>, station:<id>).

    `pos` can provide ad-hoc coordinates for ids not in the matrix.
    """
    m = get_matrix(city_key)
    if a == b:
        return dict(mode="none", minutes=0, km=0.0, cost=0, reliability=1.0, buffer=0, source=m["source"])
    try:
        ia, ib = m["idx"][a], m["idx"][b]
        road_km = (m["dist"][ia][ib] or 0) / 1000
        drive_min = (m["dur"][ia][ib] or 0) / 60
        source = m["source"]
    except KeyError:
        pa = (pos or {}).get(a) or m["nodes"].get(a)
        pb = (pos or {}).get(b) or m["nodes"].get(b)
        road_km = haversine_km(pa, pb) * 1.35
        drive_min = road_km / 24 * 60
        source = "estimate"

    walk_limit = 0.5 if limited_mobility else 1.0
    if road_km <= walk_limit:
        speed = 3.5 if limited_mobility else 4.5
        minutes = max(3, road_km / speed * 60)
        return dict(mode="walk", minutes=ceil5(minutes), km=round(road_km, 2), cost=0,
                    reliability=0.97, buffer=0, source=source)

    factor = traffic_factor(depart)
    minutes = drive_min * factor + 5  # +5 pickup / parking
    vehicles = 1 if party_size <= 4 else math.ceil(party_size / 4)
    if road_km <= 8 and party_size <= 3:
        mode, cost = "auto", (30 + 18 * max(0.0, road_km - 1.5)) * vehicles
    else:
        mode, cost = "cab", (80 + 20 * road_km) * vehicles
    reliability = 0.65 if factor > 1.5 else 0.85
    buffer = ceil5(minutes * (1 - reliability) * 0.6) if minutes > 10 else 0
    return dict(mode=mode, minutes=ceil5(minutes), km=round(road_km, 1), cost=int(round(cost, -1)),
                reliability=reliability, buffer=buffer, source=source)


def route_geometry(coords: list[tuple[float, float]]) -> list[list[float]] | None:
    """Road geometry (lat, lon pairs) for a day's route, for the map."""
    if len(coords) < 2:
        return None
    key = "geo:" + ";".join(f"{c[0]:.4f},{c[1]:.4f}" for c in coords)
    cache = _load_cache()
    if key in cache:
        return cache[key]
    s = ";".join(f"{c[1]},{c[0]}" for c in coords)
    try:
        r = httpx.get(f"{OSRM_URL}/route/v1/driving/{s}",
                      params={"overview": "simplified", "geometries": "geojson"}, timeout=15)
        data = r.json()
        if data.get("code") == "Ok":
            line = [[p[1], p[0]] for p in data["routes"][0]["geometry"]["coordinates"]]
            with _lock:
                cache = _load_cache()
                cache[key] = line
                _CACHE_FILE.write_text(json.dumps(cache))
            return line
    except Exception:
        pass
    return None
