"""Seed the separate DEMO environment for judges (idempotent).

Creates (or reuses) the non-admin account demo@tripzy.app, gives it a completed
Travel DNA, and one clearly labelled demo trip ("[Demo] Hyderabad · 3 days")
with a sample train booking. Everything goes through the real platform API and
the authenticated Tripzy proxy, exactly as the web app does.

    python scripts/seed_demo.py [--base http://localhost:3001]
"""
from __future__ import annotations

import argparse
import sys

import json
from pathlib import Path

import httpx

EMAIL, PASSWORD, NAME = "demo@tripzy.app", "Tripzy@2026", "Demo Traveller"
CATEGORY = {"heritage": "Attraction", "museum": "Attraction", "religious": "Attraction", "show": "Activity",
            "entertainment": "Activity", "market": "Shopping", "nature": "Nature", "viewpoint": "Attraction",
            "food": "Restaurant", "cafe": "Bar/Cafe"}


RESET = '--reset' in sys.argv


def main(base: str) -> None:
    s = httpx.Client(base_url=base, timeout=120)
    r = s.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    if r.status_code != 200:
        r = s.post("/api/auth/register", json={"email": EMAIL, "password": PASSWORD, "username": NAME})
        r.raise_for_status()
        r = s.post("/api/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    print("signed in as", EMAIL)

    s.put("/api/tripzy/me/profile", json={
        "swipes": {"c1": "a", "c3": "a", "c4": "a", "c6": "b", "c7": "a", "c9": "a", "c11": "b"},
        "interests": ["history", "food", "photography"], "pace": 0.35, "morning": 0.7,
        "companions": "parents", "kids": 0, "diet": "veg", "no_stairs": False, "wheelchair": False,
        "budget_style": "mid", "budget_per_day": 2500, "skipped": []}).raise_for_status()

    trips = s.get("/api/trips").json().get("trips", [])
    demo_trips = [t for t in trips if t["title"].startswith("[Demo]")]
    if demo_trips and RESET:
        # --reset: remove only the demo user's [Demo] trips and the capsules linked to them
        links_path = Path(__file__).resolve().parents[1] / "data_store" / "links.json"
        links = json.loads(links_path.read_text()) if links_path.exists() else {}
        for t in demo_trips:
            s.delete(f"/api/trips/{t['id']}").raise_for_status()
            rec = links.pop(str(t["id"]), None)
            cap = rec and (rec.get("capsule_id") if isinstance(rec, dict) else rec)
            if cap:
                (links_path.parent / "trips" / f"{cap}.json").unlink(missing_ok=True)
            print("removed demo trip", t["id"])
        links_path.write_text(json.dumps(links, indent=1))
    elif demo_trips:
        print("demo trip already present, nothing to do (use --reset to rebuild it)")
        return

    cid = s.post("/api/tripzy/demo/seed").json()["capsule_id"]
    c = s.get(f"/api/tripzy/trips/{cid}").json()
    trip = s.post("/api/trips", json={
        "title": f"[Demo] {c['city']['name']} · {c['brief']['days']} days",
        "description": "Demo trip with sample data (sample train booking, simulated live status).",
        "start_date": c["days"][0]["date"], "end_date": c["days"][-1]["date"], "currency": "INR"}).json()["trip"]
    tid = trip["id"]
    cats = {x["name"]: x["id"] for x in s.get("/api/categories").json().get("categories", [])}
    days = {d["date"]: d for d in s.get(f"/api/trips/{tid}/days").json()["days"]}

    pid: dict[str, int] = {}
    for d in c["days"]:
        for b in d["blocks"]:
            if b["kind"] not in ("place", "meal", "rest") or not b.get("place_id") or not b.get("lat") or b["place_id"] in pid:
                continue
            cat = "food" if b["kind"] == "meal" else "cafe" if b["kind"] == "rest" else b.get("cat", "heritage")
            pl = s.post(f"/api/trips/{tid}/places", json={
                "name": b["name"].replace("Recharge at ", ""), "lat": b["lat"], "lng": b["lon"],
                "description": b.get("desc") or None, "price": round(b["cost"]) if b.get("cost") else None,
                "currency": "INR", "duration_minutes": b["dwell"], "category_id": cats.get(CATEGORY.get(cat, "Other")),
                "notes": f"Tripzy: {b['why']}" if b.get("why") else None}).json()["place"]
            pid[b["place_id"]] = pl["id"]
        pd = days.get(d["date"])
        for b in d["blocks"]:
            if b.get("place_id") in pid and b["kind"] in ("place", "meal", "rest"):
                a = s.post(f"/api/trips/{tid}/days/{pd['id']}/assignments", json={"place_id": pid[b["place_id"]]}).json()["assignment"]
                s.put(f"/api/trips/{tid}/assignments/{a['id']}/time", json={"place_time": b["start"][:5], "end_time": b["end"][:5]})
                if b.get("why"):
                    s.put(f"/api/trips/{tid}/assignments/{a['id']}/notes", json={"notes": b["why"]})
        for name, cat, kinds in ((f"Day {d['index'] + 1} · Tickets & entry", "Activities", ("place",)),
                                 (f"Day {d['index'] + 1} · Food", "Food", ("meal", "rest")),
                                 (f"Day {d['index'] + 1} · Local transport", "Transport", ("leg",))):
            total = round(sum(b.get("cost", 0) for b in d["blocks"] if b["kind"] in kinds))
            if total:
                s.post(f"/api/trips/{tid}/budget", json={"name": name, "category": cat, "total_price": total, "currency": "INR"})
    for bk in c["bookings"]:
        s.post(f"/api/trips/{tid}/reservations", json={
            "title": f"Train {bk['number']} · {bk['kind']} (demo)", "type": "train", "status": "confirmed",
            "reservation_time": f"{bk['date']}T{bk['time']}", "location": "Hyderabad Deccan (Nampally)",
            "confirmation_number": bk.get("pnr"), "day_id": days[bk["date"]]["id"],
            "notes": "Sample booking for the demo. Live status is simulated."})
    s.post("/api/tripzy/links", json={"capsule_id": cid, "platform_trip_id": tid,
                                       "places": {str(v): k for k, v in pid.items()}}).raise_for_status()
    print(f"demo trip created: platform trip {tid}, capsule {cid}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3001")
    ap.add_argument("--reset", action="store_true", help="delete the demo user's [Demo] trips and rebuild them")
    try:
        main(ap.parse_args().base)
    except httpx.HTTPError as e:
        sys.exit(f"seed failed: {e}")
