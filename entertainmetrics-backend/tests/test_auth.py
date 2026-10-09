"""The real authentication dependency, with Supabase mocked out."""

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import auth
from app.database import Base, get_db
from app.main import app

ORIGIN = "http://localhost:5173"
REAL_VERIFY = auth.verify_with_supabase   # captured before any test patches it
EVENT = {
    "event_name": "Auth Test", "event_type": "Concert", "event_date": "2030-01-01",
    "venue": "Hall", "city": "Nairobi", "ticket_price": 1000, "marketing_spend": 0, "capacity": 100,
}
USERS = {
    "admin-token": {"id": "u-admin", "email": "admin@example.com", "app_metadata": {"role": "admin"}},
    "viewer-token": {"id": "u-viewer", "email": "viewer@example.com", "app_metadata": {"role": "viewer"}},
    "norole-token": {"id": "u-norole", "email": "norole@example.com", "app_metadata": {}},
    "odd-token": {"id": "u-odd", "email": "odd@example.com", "app_metadata": {"role": "superuser"}},
}


@pytest.fixture
def api(tmp_path, monkeypatch):
    """A client that goes through the real auth dependency."""
    engine = create_engine(f"sqlite:///{tmp_path}/auth.db", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides.pop(auth.get_current_user, None)   # use the real one
    auth.clear_cache()
    calls = []

    def fake_verify(token):
        calls.append(token)
        return USERS.get(token)

    monkeypatch.setattr(auth, "verify_with_supabase", fake_verify)
    with TestClient(app) as client:
        client.verify_calls = calls
        yield client
    auth.clear_cache()
    app.dependency_overrides.pop(get_db, None)
    engine.dispose()


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_no_token_is_401_with_www_authenticate(api):
    response = api.get("/events")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_malformed_and_bad_tokens_are_401(api):
    assert api.get("/events", headers={"Authorization": "Basic abc"}).status_code == 401
    assert api.get("/events", headers={"Authorization": "Bearer "}).status_code == 401
    response = api.get("/events", headers=bearer("not-a-real-token"))
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"


def test_viewer_can_read_but_not_write(api):
    assert api.get("/events", headers=bearer("viewer-token")).status_code == 200
    for method, path, body in (("post", "/events", EVENT), ("patch", "/events/1", {"city": "X"}),
                               ("delete", "/events/1", None)):
        response = api.request(method.upper(), path, headers=bearer("viewer-token"), json=body)
        assert response.status_code == 403, method
        assert response.json()["detail"] == "Read-only access: your account cannot make changes"


def test_admin_can_write(api):
    created = api.post("/events", headers=bearer("admin-token"), json=EVENT)
    assert created.status_code == 200, created.text
    event_id = created.json()["id"]
    assert api.patch(f"/events/{event_id}", headers=bearer("admin-token"),
                     json={"city": "Mombasa"}).json()["city"] == "Mombasa"
    assert api.delete(f"/events/{event_id}", headers=bearer("admin-token")).status_code == 200


@pytest.mark.parametrize("token", ["norole-token", "odd-token"])
def test_missing_or_unknown_role_counts_as_viewer(api, token):
    me = api.get("/me", headers=bearer(token)).json()
    assert me["role"] == "viewer"
    assert api.post("/events", headers=bearer(token), json=EVENT).status_code == 403


def test_me_returns_email_and_role(api):
    assert api.get("/me", headers=bearer("admin-token")).json() == {
        "id": "u-admin", "email": "admin@example.com", "role": "admin"}
    assert api.get("/me").status_code == 401


def test_public_paths_need_no_token(api):
    assert api.get("/").status_code == 200
    assert api.get("/health").status_code == 200
    assert api.get("/openapi.json").status_code == 200
    assert api.get("/docs").status_code == 200
    assert api.get("/redoc").status_code == 200
    assert api.verify_calls == []


def test_token_cache_used_within_ttl_and_expires(api, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(auth, "_now", lambda: clock[0])
    for _ in range(3):
        assert api.get("/events", headers=bearer("admin-token")).status_code == 200
    assert api.verify_calls == ["admin-token"]            # verified once, then cached
    # The raw token is never used as a cache key.
    assert "admin-token" not in auth._cache
    clock[0] += auth.CACHE_TTL_SECONDS - 1
    api.get("/events", headers=bearer("admin-token"))
    assert len(api.verify_calls) == 1
    clock[0] += 2                                          # past the 60 s TTL
    api.get("/events", headers=bearer("admin-token"))
    assert len(api.verify_calls) == 2
    # Invalid tokens are not cached.
    api.get("/events", headers=bearer("bad"))
    api.get("/events", headers=bearer("bad"))
    assert api.verify_calls.count("bad") == 2


def test_supabase_unreachable_is_503_not_401(api, monkeypatch):
    def down(token):
        raise auth.AuthServiceUnavailable()

    monkeypatch.setattr(auth, "verify_with_supabase", down)
    response = api.get("/events", headers=bearer("admin-token"))
    assert response.status_code == 503
    assert response.json()["detail"] == "Authentication service unavailable"


def test_cors_preflight_succeeds_without_a_token(api):
    response = api.options("/events", headers={
        "Origin": ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
    })
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert "authorization" in response.headers["access-control-allow-headers"].lower()
    assert "access-control-allow-credentials" not in response.headers
    blocked = api.options("/events", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in blocked.headers


# ---------- verify_with_supabase against a mocked httpx ----------

class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


def test_verify_calls_supabase_user_endpoint(monkeypatch):
    seen = {}

    def fake_get(url, headers, timeout):
        seen.update(url=url, headers=headers, timeout=timeout)
        return FakeResponse(200, USERS["admin-token"])

    monkeypatch.setattr(auth.httpx, "get", fake_get)
    assert auth.verify_with_supabase("tok") == USERS["admin-token"]
    assert seen["url"] == f"{auth.SUPABASE_URL}/auth/v1/user"
    assert seen["headers"] == {"Authorization": "Bearer tok", "apikey": auth.SUPABASE_PUBLISHABLE_KEY}
    assert seen["timeout"] == 5


@pytest.mark.parametrize("status", [400, 401, 403])
def test_verify_rejected_token_returns_none(monkeypatch, status):
    monkeypatch.setattr(auth.httpx, "get", lambda *a, **k: FakeResponse(status))
    assert auth.verify_with_supabase("tok") is None


@pytest.mark.parametrize("status", [500, 502, 503, 429])
def test_verify_server_errors_raise_unavailable(monkeypatch, status):
    monkeypatch.setattr(auth.httpx, "get", lambda *a, **k: FakeResponse(status))
    with pytest.raises(auth.AuthServiceUnavailable):
        auth.verify_with_supabase("tok")


def test_verify_network_error_raises_unavailable(monkeypatch):
    def boom(*args, **kwargs):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(auth.httpx, "get", boom)
    with pytest.raises(auth.AuthServiceUnavailable):
        auth.verify_with_supabase("tok")


def test_real_dependency_maps_network_error_to_503(api, monkeypatch):
    """End to end: real verify function, httpx timing out -> 503 (never 401)."""
    def timeout(*args, **kwargs):
        raise httpx.ConnectTimeout("timed out")

    monkeypatch.setattr(auth, "verify_with_supabase", REAL_VERIFY)
    monkeypatch.setattr(auth.httpx, "get", timeout)
    response = api.get("/events", headers=bearer("fresh-token"))
    assert response.status_code == 503
    assert response.json()["detail"] == "Authentication service unavailable"
