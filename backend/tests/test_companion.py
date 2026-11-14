"""Travel companion modules: readiness, companion intents, alerts, finance, recap, OCR.
External providers are switched off here so the tests are deterministic and offline."""
import os
import tempfile

os.environ.setdefault("TRIPZY_STORE", tempfile.mkdtemp())
for k in ("GEMINI_API_KEY", "GEOAPIFY_API_KEY", "LITEAPI_KEY", "TRAVELPAYOUTS_TOKEN", "TRAVELPAYOUTS_MARKER"):
    os.environ.pop(k, None)

from fastapi.testclient import TestClient  # noqa: E402

from app.engines import providers as PV  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app, headers={"x-tripzy-user": "1"})
other = TestClient(app, headers={"x-tripzy-user": "2"})


def seed():
    cid = client.post("/api/demo/seed").json()["capsule_id"]
    return cid, client.get(f"/api/trips/{cid}").json()


def ask(cid, msg, **kw):
    r = client.post(f"/api/trips/{cid}/companion", json={"message": msg, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_readiness_derives_items_and_persists_ticks():
    cid, _ = seed()
    r = client.get(f"/api/trips/{cid}/readiness").json()
    ids = {i["id"]: i for i in r["checklist"]}
    assert ids["booking"]["done"] and ids["booking"]["auto"]      # demo trip has a train
    assert not ids["docs"]["done"]                                  # no documents passed
    assert any(p["item"].startswith("Photo ID") for p in r["packing"])
    assert r["guide"]["emergency"][0]["number"] == "112" and r["guide"]["reviewed"]
    r2 = client.post(f"/api/trips/{cid}/readiness/offline", json={"done": True}).json()
    assert next(i for i in r2["checklist"] if i["id"] == "offline")["done"] and r2["score"] > r["score"]
    assert client.get(f"/api/trips/{cid}/readiness?documents=1").json()["score"] > r2["score"]


def test_companion_proposes_confirmable_ripple_without_applying():
    cid, before = seed()
    out = ask(cid, "we're running 45 min late", day=0, now="11:00")
    assert out["action"]["type"] == "ripple" and out["action"]["event"] == {"type": "late", "minutes": 45}
    assert "confirm" in out["action"]
    assert client.get(f"/api/trips/{cid}").json()["days"] == before["days"]   # nothing changed yet
    # the proposed event is accepted as-is by the existing Ripple endpoint
    a = out["action"]
    r = client.post(f"/api/trips/{cid}/ripple", json={"day": a["day"], "now": a["now"], "event": a["event"]})
    assert r.status_code == 200 and r.json()["diff"]["headline"]


def test_companion_skip_and_closed_target_a_real_stop():
    cid, c = seed()
    for msg, typ in (("skip the next stop", "skip"), ("the next place is closed", "closed")):
        a = ask(cid, msg, day=1, now="09:00")["action"]
        assert a["event"]["type"] == typ
        ids = {b["id"] for b in c["days"][1]["blocks"] if b["kind"] == "place"}
        assert a["event"]["block_id"] in ids


def test_companion_answers_from_trip_data():
    cid, c = seed()
    nxt = ask(cid, "what's next?", day=1, now="08:00")
    assert "Next:" in nxt["reply"] and nxt["action"] is None
    assert "Day 1" in ask(cid, "will it rain?")["reply"]
    assert "Planned ₹" in ask(cid, "how much have we spent?")["reply"]
    assert "112" in ask(cid, "emergency numbers please")["reply"]
    assert "12723" in ask(cid, "show my train booking")["reply"]
    assert "ready" in ask(cid, "what should I pack?")["reply"]


def test_companion_is_honest_without_keys():
    cid, _ = seed()
    assert "GEOAPIFY_API_KEY" in ask(cid, "find a pharmacy nearby")["reply"]
    assert "LITEAPI_KEY" in ask(cid, "show hotels")["reply"]
    fallback = ask(cid, "tell me something interesting")
    assert fallback["source"] == "rules" and "I can help with" in fallback["reply"]


def test_companion_validates_input_and_ownership():
    cid, _ = seed()
    assert client.post(f"/api/trips/{cid}/companion", json={"message": "  "}).status_code == 400
    assert client.post(f"/api/trips/{cid}/companion", json={"message": "hi", "now": "x"}).status_code == 400
    assert other.post(f"/api/trips/{cid}/companion", json={"message": "hi"}).status_code == 404
    assert other.get(f"/api/trips/{cid}/readiness").status_code == 404
    assert other.get(f"/api/trips/{cid}/finance").status_code == 404


def test_finance_adds_up(monkeypatch):
    monkeypatch.setattr(PV, "fx_rates", lambda base="INR": {"rates": {"USD": 0.012, "EUR": 0.011}, "source": "test", "date": "x"})
    cid, _ = seed()
    f = client.get(f"/api/trips/{cid}/finance").json()
    assert f["total"] == sum(f["categories"].values()) > 0
    assert f["per_person"] * f["people"] >= f["total"] - f["people"]
    assert f["converted"]["USD"] == round(f["total"] * 0.012, 2)


def test_alerts_and_recap():
    cid, _ = seed()
    client.post(f"/api/trips/{cid}/ripple", json={"day": 0, "now": "07:00", "event": {"type": "delay", "minutes": 120}})
    assert isinstance(client.get(f"/api/trips/{cid}/alerts").json()["alerts"], list)
    r = client.get(f"/api/trips/{cid}/recap").json()
    assert r["stops"] > 0 and r["km"] > 0 and r["highlights"] and r["story"] is None


def test_photo_ticket_uses_ocr(monkeypatch):
    monkeypatch.setattr(PV, "ocr_image", lambda raw, suffix=".png": "PNR: 4521378890 Train No. 12723 Date 12-Dec-2026 Dep 07:30")
    r = client.post("/api/bookings/parse-file?city_key=hyderabad",
                    files={"file": ("ticket.jpg", b"\xff\xd8fakejpeg", "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["method"] == "ocr" and r.json()["fields"]["pnr"] == "4521378890"


def test_fx_rejects_bad_base():
    assert client.get("/api/fx?base=../x").status_code == 400
