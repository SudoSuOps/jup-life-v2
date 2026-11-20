import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("FILAMENT_DB", str(tmp_path / "t.db"))
    monkeypatch.setenv("API_TOKEN", "tok-123")
    monkeypatch.setenv("ACCESS_TEAM_DOMAIN", "jup.cloudflareaccess.com")
    monkeypatch.setenv("ACCESS_AUD", "aud123")
    monkeypatch.delenv("DEV_OPEN", raising=False)
    from app.main import app
    with TestClient(app) as c:
        c.headers["authorization"] = "Bearer tok-123"
        yield c


def test_auth_fails_closed(client):
    assert client.get("/api/health").status_code == 200
    r = client.get("/api/filaments", headers={"authorization": ""})
    assert r.status_code == 401 and "error" in r.json()
    assert client.get("/api/filaments", headers={"authorization": "Bearer nope"}).status_code == 401


def test_seed_and_counts(client):
    d = client.get("/api/filaments").json()
    assert len(d["filaments"]) == 32
    black = next(f for f in d["filaments"] if f["id"] == "sunlu-black")
    assert black["maker"] == "SUNLU" and black["nozzle"] == "190-210" and black["stock"]["status"] == "ok"
    pump = next(f for f in d["filaments"] if f["id"] == "pumpkin")
    assert pump["stock"]["status"] == "count" and pump["material"] == "TPU"


def test_patch_usage_summary(client):
    r = client.patch("/api/filaments/pumpkin", json={"full": 2, "partialG": 100, "maker": "QIDI", "nozzle": "210–230"})
    assert r.status_code == 200 and r.json()["nozzle"] == "210-230"
    assert client.patch("/api/filaments/pumpkin", json={"full": -1}).status_code == 400
    assert client.patch("/api/filaments/pumpkin", json={"maker": "Prusa"}).status_code == 400
    r = client.post("/api/usage", json={"items": [{"filament": "pumpkin", "grams": 300}, {"filament": "pumpkin", "grams": 300}, {"filament": "rhubarb", "grams": 10}]}).json()
    assert [(x["full"], x["partialG"]) for x in r["results"]] == [(1, 800), (1, 500), (None, None)]
    assert client.get("/api/filaments/pumpkin").json()["partialG"] == 500
    assert client.get("/api/filaments/rhubarb").json()["full"] is None
    assert client.post("/api/usage", json={"filament": "nope", "grams": 5}).status_code == 404
    client.patch("/api/filaments/sage", json={"full": 0, "partialG": 200})
    client.post("/api/deals", json={"supplier": "Test", "price": 18.5, "sizeG": 1000, "minQty": 10, "expires": "2099-01-01"})
    s = client.get("/api/summary").json()
    assert s["colorsToOrder"] == 1 and s["order"][0]["id"] == "sage" and s["bestDeal"]["perKg"] == 18.5
    assert len(client.get("/api/usage?limit=10").json()["usage"]) == 3


def test_settings_and_deals_validation(client):
    assert client.put("/api/settings", json={"spoolG": 5}).status_code == 400
    assert client.put("/api/settings", json={"targetSpools": 4}).json()["targetSpools"] == 4
    assert client.post("/api/deals", json={"supplier": ""}).status_code == 400
    assert client.post("/api/deals", json=[1, 2]).status_code == 400


def test_access_jwt(client):
    from app.auth import verify_access_jwt
    from app.config import load
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class FakeJWKS:
        def get_signing_key_from_jwt(self, token):
            return type("K", (), {"key": key.public_key()})()

    cfg = load()
    good = {"aud": ["aud123"], "exp": int(time.time()) + 600, "iss": "https://jup.cloudflareaccess.com", "email": "hello@juplifestudio.com"}
    tok = jwt.encode(good, key, algorithm="RS256", headers={"kid": "k1"})
    assert verify_access_jwt(tok, cfg, FakeJWKS()) == "hello@juplifestudio.com"
    for bad in ({**good, "aud": ["other"]}, {**good, "exp": int(time.time()) - 5}, {**good, "iss": "https://evil.cloudflareaccess.com"}):
        assert verify_access_jwt(jwt.encode(bad, key, algorithm="RS256"), cfg, FakeJWKS()) is None
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert verify_access_jwt(jwt.encode(good, other, algorithm="RS256"), cfg, FakeJWKS()) is None


def test_page_served(client):
    r = client.get("/", headers={"authorization": ""})
    assert r.status_code == 200 and "Filament shelf" in r.text
    assert client.get("/app.js").status_code == 200
