"""Platform bridge + the remaining Ripple scenarios (skip, budget exceeded) + demo seed."""
import os
import tempfile

os.environ.setdefault("TRIPZY_STORE", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app, headers={"x-tripzy-user": "1"})


def seed():
    cid = client.post("/api/demo/seed").json()["capsule_id"]
    return cid, client.get(f"/api/trips/{cid}").json()


def test_demo_seed_has_fixed_train_anchor():
    _, c = seed()
    first = c["days"][0]["blocks"][0]
    assert first["kind"] == "anchor" and first["start"] == "07:30" and first["fixed"]


def test_link_roundtrip_keeps_place_mapping():
    cid, _ = seed()
    assert client.post("/api/links", json={"capsule_id": cid, "platform_trip_id": 42, "places": {"7": "hyd-charminar"}}).json()["ok"]
    rec = client.get("/api/links/42").json()
    assert rec["capsule_id"] == cid and rec["places"]["7"] == "hyd-charminar"
    assert client.get("/api/links/999").status_code == 404


def test_resequence_follows_user_order_and_ignores_food():
    cid, c = seed()
    sights = [b["place_id"] for b in c["days"][1]["blocks"] if b["kind"] == "place"]
    wanted = list(reversed(sights)) + ["hyd-paradise"]
    r = client.post(f"/api/trips/{cid}/resequence", json={"day": 1, "place_ids": wanted}).json()
    got = [b["place_id"] for b in r["capsule"]["days"][1]["blocks"] if b["kind"] == "place"]
    kept = [p for p in reversed(sights) if p in got]
    assert got[: len(kept)] == kept and "hyd-paradise" not in got
    assert 0 <= r["feasibility"]["after"] <= 100


def test_skip_removes_stop():
    cid, c = seed()
    target = [b for b in c["days"][1]["blocks"] if b["kind"] == "place"][1]
    p = client.post(f"/api/trips/{cid}/ripple", json={"day": 1, "now": "06:00", "event": {"type": "skip", "block_id": target["id"]}}).json()
    assert any(d["name"] == target["name"] for d in p["diff"]["dropped"])
    assert target["id"] not in {b["id"] for b in p["preview_day"]["blocks"]}


def test_budget_exceeded_swaps_to_cheaper():
    cid, c = seed()
    swaps = []
    for d in range(len(c["days"])):
        p = client.post(f"/api/trips/{cid}/ripple", json={"day": d, "now": "06:00", "event": {"type": "over_budget"}}).json()
        swaps += p["diff"]["swapped"]
    assert swaps and all(s["reason"] == "cheaper" for s in swaps)
