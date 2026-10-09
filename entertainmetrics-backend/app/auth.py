"""Authentication for the API, backed by Supabase Auth.

Every request (except the public paths) must carry a Supabase access token in
`Authorization: Bearer <token>`. The token is verified by asking Supabase who
it belongs to (GET {SUPABASE_URL}/auth/v1/user). Successful verifications are
cached briefly, keyed by a hash of the token, so a page that makes several
API calls does not hit Supabase each time.

Roles come from the user's app_metadata.role ("admin" or "viewer"); users
cannot change app_metadata themselves. A missing or unknown role counts as
"viewer", which is read-only. Tokens and Authorization headers are never
logged.
"""

import hashlib
import os
import threading
import time

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException, Request

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = os.getenv("SUPABASE_PUBLISHABLE_KEY") or ""

_missing = [
    name for name, value in (
        ("SUPABASE_URL", SUPABASE_URL),
        ("SUPABASE_PUBLISHABLE_KEY", SUPABASE_PUBLISHABLE_KEY),
    )
    if not value
]
if _missing:
    raise RuntimeError(
        "Missing required environment variable(s): " + ", ".join(_missing)
        + ". Set them in entertainmetrics-backend/.env (see .env.example) or in the "
        "hosting provider's environment settings."
    )

VERIFY_TIMEOUT_SECONDS = 5
CACHE_TTL_SECONDS = 60
ROLES = ("admin", "viewer")
DEFAULT_ROLE = "viewer"
# Methods a read-only (viewer) account may use.
READ_ONLY_METHODS = ("GET", "HEAD", "OPTIONS")
# Paths that never need a token. The docs and OpenAPI schema are served by
# FastAPI outside the app-level dependencies, so they are public as well.
PUBLIC_PATHS = ("/", "/health")


class AuthServiceUnavailable(Exception):
    """Supabase Auth could not be reached or answered with a server error."""


_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()


def _now() -> float:
    """Clock for the cache (replaceable in tests)."""
    return time.monotonic()


def _token_key(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_with_supabase(token: str) -> dict | None:
    """Return the Supabase user for a valid token, or None if it is invalid
    or expired. Raises AuthServiceUnavailable when Supabase is unreachable."""
    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": SUPABASE_PUBLISHABLE_KEY},
            timeout=VERIFY_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as error:
        raise AuthServiceUnavailable() from error
    if response.status_code == 200:
        return response.json()
    if response.status_code >= 500 or response.status_code == 429:
        raise AuthServiceUnavailable()
    return None  # 400 / 401 / 403: bad or expired token


def _cached_user(token: str) -> dict | None:
    key = _token_key(token)
    now = _now()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and entry[0] > now:
            return entry[1]
        if entry:
            del _cache[key]
    return None


def _remember(token: str, user: dict) -> None:
    with _cache_lock:
        _cache[_token_key(token)] = (_now() + CACHE_TTL_SECONDS, user)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def _bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def role_of(user: dict) -> str:
    role = (user.get("app_metadata") or {}).get("role")
    return role if role in ROLES else DEFAULT_ROLE


def get_current_user(request: Request) -> dict | None:
    """App-wide dependency: authenticate the request and enforce read-only
    access for viewers. Returns {id, email, role}, or None on public paths."""
    if request.url.path in PUBLIC_PATHS:
        return None

    token = _bearer_token(request)
    if token is None:
        raise _unauthorized("Not signed in")

    user = _cached_user(token)
    if user is None:
        try:
            user = verify_with_supabase(token)
        except AuthServiceUnavailable as error:
            raise HTTPException(status_code=503, detail="Authentication service unavailable") from error
        if user is None:
            raise _unauthorized("Your session is invalid or has expired")
        _remember(token, user)

    current = {"id": user.get("id"), "email": user.get("email"), "role": role_of(user)}
    if current["role"] != "admin" and request.method not in READ_ONLY_METHODS:
        raise HTTPException(status_code=403, detail="Read-only access: your account cannot make changes")
    return current
