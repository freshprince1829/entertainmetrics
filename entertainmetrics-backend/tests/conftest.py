"""Test setup: every test runs against a throwaway SQLite database.

DATABASE_URL is pointed at SQLite *before* the app is imported, so importing
app.main (which calls create_all) never touches the real Supabase database.
"""

import os
import tempfile
from datetime import date, datetime, time, timedelta, timezone

_TEST_DB_DIR = tempfile.mkdtemp(prefix="entertainmetrics-tests-")
os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_DIR}/import.db"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.database import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402

assert os.environ["DATABASE_URL"].startswith("sqlite"), "tests must never use Supabase"

EAT = timezone(timedelta(hours=3))  # Nairobi local time


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path}/test.db",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


def at(day: date, hour: int = 12, minute: int = 0) -> str:
    """ISO timestamp in Nairobi time for the given day."""
    return datetime.combine(day, time(hour, minute), tzinfo=EAT).isoformat()


def make_event(client, *, days_from_today: int = 10, capacity: int = 1000,
               ticket_price: float = 1000, marketing_spend: float = 50000, **extra):
    payload = {
        "event_name": extra.pop("event_name", "Test Event"),
        "event_type": "Concert",
        "event_date": (date.today() + timedelta(days=days_from_today)).isoformat(),
        "venue": "Test Venue",
        "city": "Nairobi",
        "ticket_price": ticket_price,
        "marketing_spend": marketing_spend,
        "capacity": capacity,
        **extra,
    }
    response = client.post("/events", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def add_snapshot(client, event_id: int, recorded_at: str, total: int, **extra):
    return client.post(
        f"/events/{event_id}/sales-snapshots",
        json={"recorded_at": recorded_at, "tickets_sold_total": total, **extra},
    )


def add_tier(client, event_id: int, name: str, price: float, **extra):
    response = client.post(
        f"/events/{event_id}/tiers", json={"name": name, "price": price, **extra}
    )
    assert response.status_code == 201, response.text
    return response.json()
