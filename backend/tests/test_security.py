"""Ownership, isolation, profiles and the trust boundary."""
import os
import tempfile

os.environ.setdefault("TRIPZY_STORE", tempfile.mkdtemp())

from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402

alice = TestClient(main.app, headers={"x-tripzy-user": "101"})
bob = TestClient(main.app, headers={"x-tripzy-user": "202"})
anon = TestClient(main.app)


def test_capsules_are_private_to_their_owner():
    cid = alice.post("/api/demo/seed").json()["capsule_id"]
    assert alice.get(f"/api/trips/{cid}").status_code == 200
    assert bob.get(f"/api/trips/{cid}").status_code == 404
    assert anon.get(f"/api/trips/{cid}").status_code == 404
    assert bob.post(f"/api/trips/{cid}/edit", json={"text": "make day 1 lighter"}).status_code == 404
    assert all(c["id"] != cid for c in bob.get("/api/me/capsules").json())
    assert any(c["id"] == cid for c in alice.get("/api/me/capsules").json())


def test_links_are_private():
    cid = alice.post("/api/demo/seed").json()["capsule_id"]
    assert alice.post("/api/links", json={"capsule_id": cid, "platform_trip_id": 5001}).json()["ok"]
    assert alice.get("/api/links/5001").json()["capsule_id"] == cid
    assert bob.get("/api/links/5001").status_code == 404
    assert bob.post("/api/links", json={"capsule_id": cid, "platform_trip_id": 5001}).status_code == 404


def test_anonymous_draft_needs_sign_in_to_change_and_is_claimed():
    import json as _j
    brief = anon.post("/api/brief/parse", json={"text": "Jaipur 2 days with friends, Dec 5"}).json()
    with anon.stream("POST", "/api/trips/compose", json={"brief": brief, "swipes": {}}) as r:
        cid = next(_j.loads(l[5:]) for l in r.iter_lines() if l.startswith("data:") and '"id"' in l)["id"]
    assert anon.get(f"/api/trips/{cid}").status_code == 200          # preview without account
    assert anon.post(f"/api/trips/{cid}/edit", json={"text": "start later"}).status_code == 401
    assert alice.post(f"/api/trips/{cid}/edit", json={"text": "start later"}).status_code == 200  # claims it
    assert bob.get(f"/api/trips/{cid}").status_code == 404


def test_profile_drives_new_plans_and_requires_auth():
    assert anon.get("/api/me/profile").status_code == 401
    assert bob.get("/api/me/profile").json() == {"completed": False}
    p = bob.put("/api/me/profile", json={"swipes": {"c6": "a"}, "interests": ["food"], "diet": "veg",
                                          "no_stairs": True, "companions": "parents"}).json()
    assert p["completed"] and p["constraints"]["diet"] == "veg"
    import json as _j
    brief = bob.post("/api/brief/parse", json={"text": "Hyderabad 2 days, Dec 12"}).json()
    with bob.stream("POST", "/api/trips/compose", json={"brief": brief, "swipes": {}}) as r:
        cid = next(_j.loads(l[5:]) for l in r.iter_lines() if l.startswith("data:") and '"id"' in l)["id"]
    c = bob.get(f"/api/trips/{cid}").json()
    assert c["constraints"]["diet"] == "veg" and c["constraints"]["no_stairs"]
    disc = bob.get("/api/me/discover").json()
    assert disc["personalised"] and disc["items"]


def test_engine_key_enforced_when_configured(monkeypatch):
    monkeypatch.setattr(main, "ENGINE_KEY", "s3cret")
    assert anon.get("/api/cities").status_code == 403
    assert TestClient(main.app, headers={"x-tripzy-key": "s3cret"}).get("/api/cities").status_code == 200
    assert anon.get("/api/health").status_code == 200
