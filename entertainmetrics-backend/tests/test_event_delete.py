from datetime import date

from sqlalchemy import text

from app.database import get_db
from app.main import app
from tests.conftest import add_snapshot, add_tier, at, make_event

TODAY = date.today()


def count_rows(table):
    db = next(app.dependency_overrides[get_db]())
    try:
        return db.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar()
    finally:
        db.close()


def test_delete_event_removes_everything_attached(client):
    event = make_event(client, days_from_today=10, capacity=2000)
    keep = make_event(client, event_name="Keep me")
    artist = client.post("/artists", json={"artist_name": "Stays"}).json()
    client.post("/event-artists", json={"event_id": event["id"], "artist_id": artist["id"],
                                        "performance_order": 1})
    tier = add_tier(client, event["id"], "Advance", 2000, quantity_available=500)
    client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": at(TODAY), "tier_sales": [{"tier_id": tier["id"], "tickets_sold": 40}]})
    add_snapshot(client, event["id"], at(TODAY, 18), 60)
    client.post("/predict", json={"event_id": event["id"], "ticket_price": 2000,
                                  "marketing_spend": 1000, "capacity": 2000})
    client.post("/predict", json={"event_id": keep["id"], "ticket_price": 1000,
                                  "marketing_spend": 1000, "capacity": 1000})

    summary = client.get(f"/events/{event['id']}/delete-summary").json()
    assert summary == {"event_id": event["id"], "event_name": event["event_name"],
                       "predictions": 1, "sales_snapshots": 2, "ticket_tiers": 1,
                       "lineup_entries": 1, "has_actuals": False}

    response = client.delete(f"/events/{event['id']}")
    assert response.status_code == 200, response.text
    assert response.json() == summary

    assert [e["id"] for e in client.get("/events").json()] == [keep["id"]]
    assert client.get(f"/events/{event['id']}/tiers").status_code == 404
    # Nothing orphaned; the other event and the artist are untouched.
    assert count_rows("snapshot_tier_sales") == 0
    assert count_rows("ticket_sales_snapshots") == 0
    assert count_rows("ticket_tiers") == 0
    assert count_rows("event_artists") == 0
    assert count_rows("prediction_bands") == 1
    assert [p["event_id"] for p in client.get("/predictions").json()] == [keep["id"]]
    assert [a["artist_name"] for a in client.get("/artists").json()] == ["Stays"]


def test_delete_unknown_event_returns_404(client):
    assert client.delete("/events/999").status_code == 404
    assert client.get("/events/999/delete-summary").status_code == 404


def test_delete_order_satisfies_enforced_foreign_keys(tmp_path):
    """Postgres enforces foreign keys; SQLite only does with this pragma.
    Deleting a fully populated event must not violate any of them."""
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine, event as sa_event
    from sqlalchemy.orm import sessionmaker

    from app.database import Base

    engine = create_engine(f"sqlite:///{tmp_path}/fk.db", connect_args={"check_same_thread": False})

    @sa_event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    previous = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as client:
            event = make_event(client, days_from_today=10, capacity=2000)
            artist = client.post("/artists", json={"artist_name": "FK Artist"}).json()
            client.post("/event-artists", json={"event_id": event["id"], "artist_id": artist["id"]})
            tiers = [add_tier(client, event["id"], name, 1000) for name in ("A", "B")]
            for hour, sold in ((10, 5), (18, 9)):
                response = client.post(f"/events/{event['id']}/sales-snapshots", json={
                    "recorded_at": at(TODAY, hour),
                    "tier_sales": [{"tier_id": t["id"], "tickets_sold": sold} for t in tiers]})
                assert response.status_code == 201, response.text
            client.post("/predict", json={"event_id": event["id"], "ticket_price": 1000,
                                          "marketing_spend": 1000, "capacity": 2000})
            assert client.delete(f"/events/{event['id']}").status_code == 200
            with engine.connect() as conn:
                for table in ("events", "ticket_tiers", "snapshot_tier_sales",
                              "ticket_sales_snapshots", "predictions", "prediction_bands",
                              "event_artists"):
                    assert conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() == 0, table
    finally:
        if previous is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous
        engine.dispose()
