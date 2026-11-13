"""End-to-end API flow covering the V1 workflow (P0 -> P8)."""

import json
import os
import tempfile

os.environ.setdefault("TRIPZY_STORE", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

from app.engines.timeutil import to_min  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)


def compose(text="Hyderabad, 3 days, with my parents, veg, Dec 18", swipes=None):
    brief = client.post("/api/brief/parse", json={"text": text}).json()
    steps, trip_id = [], None
    with client.stream("POST", "/api/trips/compose", json={"brief": brief, "swipes": swipes or {"c6": "b"}}) as r:
        event = None
        for line in r.iter_lines():
            if line.startswith("event:"):
                event = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                data = json.loads(line.split(":", 1)[1])
                if event == "step":
                    steps.append(data)
                elif event == "done":
                    trip_id = data["id"]
                elif event == "error":
                    raise AssertionError(data)
    return brief, steps, client.get(f"/api/trips/{trip_id}").json()


def places(day):
    return [b for b in day["blocks"] if b["kind"] == "place"]


def test_brief_parse():
    b = client.post("/api/brief/parse", json={"text": "Jaipur weekend with 2 kids, jain food, under Rs 30,000"}).json()
    assert b["city"] == "jaipur" and b["days"] == 2 and b["party"] == "family" and b["kids"] == 2
    assert b["diet"] == "jain" and b["budget_total"] == 30000


def test_compose_respects_hours_closures_and_diet():
    brief, steps, c = compose()
    assert [s["node"] for s in steps] == ["understand", "profile", "weather", "discover", "stay",
                                          "schedule", "shadow", "verify", "package"]
    assert len(c["days"]) == 3
    from app.data.cities import PLACE_BY_ID
    for d in c["days"]:
        assert d["verify"]["score"] >= 70
        for b in places(d):
            p = PLACE_BY_ID[b["place_id"]]
            assert d["weekday_idx"] not in p["closed"], f"{p['name']} closed on {d['weekday']}"
            assert any(to_min(a) <= b["s"] and b["e"] <= to_min(z) for a, z in p["hours"]) or p.get("slot")
        for m in [b for b in d["blocks"] if b["kind"] == "meal" and b.get("place_id")]:
            assert PLACE_BY_ID[m["place_id"]]["diet"] in ("veg", "both")
    # Friday (2026-12-18): Salar Jung + Chowmahalla are closed Fridays
    fri = c["days"][0]
    assert not {"hyd-salarjung", "hyd-chowmahalla"} & {b["place_id"] for b in places(fri)}
    assert any(b.get("plan_b") for d in c["days"] for b in d["blocks"])


def test_edit_lighter_and_no_stairs():
    _, _, c = compose()
    before = len(places(c["days"][1]))
    r = client.post(f"/api/trips/{c['id']}/edit", json={"text": "make day 2 lighter, dad can't climb"}).json()
    c2 = r["capsule"]
    assert len(places(c2["days"][1])) <= before
    assert c2["constraints"]["no_stairs"]
    assert not any(b["place_id"] in ("hyd-charminar", "hyd-golconda", "hyd-birla") for d in c2["days"] for b in places(d))


def test_booking_anchor_and_train_delay_ripple():
    _, _, c = compose()
    c = client.post(f"/api/trips/{c['id']}/bookings", json={
        "kind": "arrival", "mode": "train", "number": "12723", "date": "2026-12-18",
        "time": "07:30", "station_id": "HYB"}).json()
    d0 = c["days"][0]
    assert d0["blocks"][0]["kind"] == "anchor" and d0["blocks"][0]["start"] == "07:30"
    prop = client.post(f"/api/trips/{c['id']}/ripple", json={
        "day": 0, "now": "07:00", "event": {"type": "delay", "minutes": 150}}).json()
    assert "delayed 150" in prop["diff"]["headline"]
    assert prop["preview_day"]["blocks"][0]["start"] == "10:00"
    c2 = client.post(f"/api/trips/{c['id']}/ripple/{prop['id']}/accept").json()
    assert c2["ripple_log"] and c2["days"][0]["blocks"][0]["start"] == "10:00"


def test_rain_swaps_outdoor_to_plan_b():
    _, _, c = compose("Jaipur, 2 days, friends, Nov 21", {"c5": "a"})
    d = c["days"][0]
    outdoor = [b for b in places(d) if not b["indoor"] and b.get("plan_b", {}).get("rain")]
    assert outdoor
    first = outdoor[0]
    prop = client.post(f"/api/trips/{c['id']}/ripple", json={
        "day": 0, "now": f"{(first['s'] - 30) // 60:02d}:{(first['s'] - 30) % 60:02d}",
        "event": {"type": "rain", "from": first["start"], "to": first["end"]}}).json()
    assert any(s["from"] == first["name"] for s in prop["diff"]["swapped"])


def test_tired_inserts_rest_and_feedback_learns():
    _, _, c = compose()
    d = c["days"][1]
    p0 = places(d)[0]
    prop = client.post(f"/api/trips/{c['id']}/ripple", json={
        "day": 1, "now": p0["end"], "event": {"type": "tired"}}).json()
    assert prop["diff"]["inserted"]
    fb = client.post(f"/api/trips/{c['id']}/feedback", json={
        "day": 1, "block_id": p0["id"], "reaction": "loved", "actual_dwell": p0["dwell"] * 2}).json()
    assert fb["learned"]
    b = client.post(f"/api/trips/{c['id']}/expense", json={"day": 1, "amount": 99999, "label": "shopping"}).json()
    assert b["over_budget"]


def test_ticket_parse():
    r = client.post("/api/bookings/parse", json={"city_key": "hyderabad", "text":
                    "PNR: 4521378890 Train No: 12723 TELANGANA EXP Date 18-Dec-2026 Arr 07:30 HYB"}).json()
    assert r["pnr"] == "4521378890" and r["number"] == "12723" and r["date"] == "2026-12-18"
    assert r["time"] == "07:30" and r["station_id"] == "HYB"
