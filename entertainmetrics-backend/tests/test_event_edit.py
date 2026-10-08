from datetime import date, timedelta

from tests.conftest import add_snapshot, at, make_event

TODAY = date.today()


def patch(client, event_id, **changes):
    return client.patch(f"/events/{event_id}", json=changes)


def test_edit_event_details(client):
    event = make_event(client, event_name="Sol Fset", capacity=1000, ticket_price=1500)
    response = patch(client, event["id"], event_name="  Sol Fest  ", venue="Uhuru Gardens",
                     ticket_price=2000, capacity=1200)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["event_name"] == "Sol Fest"            # trimmed
    assert (body["venue"], body["ticket_price"], body["capacity"]) == ("Uhuru Gardens", 2000, 1200)
    # Fields not sent are unchanged.
    assert body["city"] == event["city"]
    assert body["event_date"] == event["event_date"]
    assert body["marketing_spend"] == event["marketing_spend"]

    listed = next(e for e in client.get("/events").json() if e["id"] == event["id"])
    assert listed["event_name"] == "Sol Fest"


def test_edit_validation_and_404(client):
    event = make_event(client)
    assert patch(client, 999, event_name="X").status_code == 404
    assert patch(client, event["id"], event_name="   ").status_code == 422
    assert patch(client, event["id"], capacity=0).status_code == 422
    assert patch(client, event["id"], ticket_price=-5).status_code == 422
    assert patch(client, event["id"], venue=None).status_code == 422
    assert patch(client, event["id"]).status_code == 200    # nothing to change


def test_capacity_cannot_drop_below_recorded_sales_or_attendance(client):
    event = make_event(client, days_from_today=10, capacity=1000)
    add_snapshot(client, event["id"], at(TODAY), 600)
    blocked = patch(client, event["id"], capacity=500)
    assert blocked.status_code == 409
    assert "600" in blocked.json()["detail"]
    assert patch(client, event["id"], capacity=600).status_code == 200

    past = make_event(client, days_from_today=-2, capacity=1000, event_name="Past")
    client.patch(f"/events/{past['id']}/actuals", json={"actual_attendance": 800})
    assert patch(client, past["id"], capacity=700).status_code == 409


def test_date_changes_respect_actuals_and_snapshots(client):
    past = make_event(client, days_from_today=-3, event_name="Done")
    client.patch(f"/events/{past['id']}/actuals", json={"actual_attendance": 100})
    future = patch(client, past["id"], event_date=(TODAY + timedelta(days=5)).isoformat())
    assert future.status_code == 409
    assert "actual results" in future.json()["detail"]
    assert patch(client, past["id"], event_date=(TODAY - timedelta(days=4)).isoformat()).status_code == 200

    upcoming = make_event(client, days_from_today=10, event_name="Upcoming")
    add_snapshot(client, upcoming["id"], at(TODAY), 50)
    too_early = patch(client, upcoming["id"], event_date=(TODAY - timedelta(days=3)).isoformat())
    assert too_early.status_code == 409
    assert "snapshots" in too_early.json()["detail"]
    # Moving it later (or to a date the snapshots still fit) is fine.
    assert patch(client, upcoming["id"], event_date=(TODAY + timedelta(days=30)).isoformat()).status_code == 200
    assert patch(client, upcoming["id"], event_date=TODAY.isoformat()).status_code == 200


def test_saved_predictions_keep_their_values_after_an_edit(client):
    event = make_event(client, capacity=5000, ticket_price=2000, marketing_spend=50000)
    first = client.post("/predict", json={"event_id": event["id"], "ticket_price": 2000,
                                         "marketing_spend": 50000, "capacity": 5000}).json()
    patch(client, event["id"], ticket_price=3000)
    saved = next(p for p in client.get("/predictions").json() if p["id"] == first["id"])
    assert saved["predicted_revenue"] == first["predicted_revenue"]
