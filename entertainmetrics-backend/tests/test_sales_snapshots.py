from datetime import date, timedelta

from tests.conftest import add_snapshot, at, make_event


def test_create_list_and_delete_snapshots(client):
    event = make_event(client, days_from_today=10)
    today = date.today()

    first = add_snapshot(client, event["id"], at(today - timedelta(days=2)), 100, notes="Early bird")
    second = add_snapshot(client, event["id"], at(today), 250, gate_tickets_sold=0)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    assert first.json()["gate_tickets_sold"] == 0
    assert first.json()["notes"] == "Early bird"

    listed = client.get(f"/events/{event['id']}/sales-snapshots")
    assert listed.status_code == 200
    assert [s["tickets_sold_total"] for s in listed.json()] == [100, 250]

    deleted = client.delete(f"/events/{event['id']}/sales-snapshots/{first.json()['id']}")
    assert deleted.status_code == 204
    remaining = client.get(f"/events/{event['id']}/sales-snapshots").json()
    assert [s["id"] for s in remaining] == [second.json()["id"]]


def test_snapshots_are_listed_by_recorded_at_not_insert_order(client):
    event = make_event(client, days_from_today=10)
    today = date.today()
    assert add_snapshot(client, event["id"], at(today), 300).status_code == 201
    assert add_snapshot(client, event["id"], at(today - timedelta(days=3)), 100).status_code == 201

    listed = client.get(f"/events/{event['id']}/sales-snapshots").json()
    assert [s["tickets_sold_total"] for s in listed] == [100, 300]


def test_unknown_event_and_snapshot_return_404(client):
    assert add_snapshot(client, 999, at(date.today()), 10).status_code == 404
    assert client.get("/events/999/sales-snapshots").status_code == 404

    event = make_event(client)
    other = make_event(client, event_name="Other")
    snap = add_snapshot(client, other["id"], at(date.today()), 10).json()
    # Snapshot exists, but belongs to a different event.
    assert client.delete(f"/events/{event['id']}/sales-snapshots/{snap['id']}").status_code == 404
    assert client.delete(f"/events/{event['id']}/sales-snapshots/12345").status_code == 404


def test_decreasing_values_are_rejected(client):
    event = make_event(client, days_from_today=10)
    today = date.today()
    assert add_snapshot(
        client, event["id"], at(today - timedelta(days=1)), 200,
        attendance_checked_in=0, revenue_to_date=200000,
    ).status_code == 201

    lower_total = add_snapshot(client, event["id"], at(today), 150)
    assert lower_total.status_code == 400
    assert "cannot decrease" in lower_total.json()["detail"]

    lower_revenue = add_snapshot(client, event["id"], at(today), 250, revenue_to_date=100)
    assert lower_revenue.status_code == 400
    assert "revenue_to_date" in lower_revenue.json()["detail"]

    # Inserting *before* an existing snapshot with a higher value is also rejected.
    higher_than_next = add_snapshot(client, event["id"], at(today - timedelta(days=3)), 500)
    assert higher_than_next.status_code == 400
    assert "next snapshot" in higher_than_next.json()["detail"]


def test_over_capacity_rejected(client):
    event = make_event(client, capacity=500)
    response = add_snapshot(client, event["id"], at(date.today()), 501)
    assert response.status_code == 400
    assert "capacity" in response.json()["detail"]


def test_gate_and_attendance_cannot_exceed_total(client):
    event = make_event(client)
    gate = add_snapshot(client, event["id"], at(date.today()), 100, gate_tickets_sold=101)
    assert gate.status_code == 422
    assert "gate_tickets_sold" in gate.text

    attendance = add_snapshot(client, event["id"], at(date.today()), 100, attendance_checked_in=101)
    assert attendance.status_code == 422


def test_negative_values_rejected(client):
    event = make_event(client)
    assert add_snapshot(client, event["id"], at(date.today()), -1).status_code == 422
    assert add_snapshot(
        client, event["id"], at(date.today()), 10, revenue_to_date=-5
    ).status_code == 422


def test_event_day_and_next_day_accepted_later_rejected(client):
    event = make_event(client, days_from_today=0, capacity=2000)
    today = date.today()

    assert add_snapshot(client, event["id"], at(today, 18), 500).status_code == 201
    assert add_snapshot(client, event["id"], at(today, 21), 600, gate_tickets_sold=100).status_code == 201
    assert add_snapshot(
        client, event["id"], at(today + timedelta(days=1), 2), 650, gate_tickets_sold=150
    ).status_code == 201

    too_late = add_snapshot(client, event["id"], at(today + timedelta(days=2), 9), 650)
    assert too_late.status_code == 400
    assert "too late" in too_late.json()["detail"]
