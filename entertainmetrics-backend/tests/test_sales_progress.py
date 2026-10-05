from datetime import date, timedelta

import pytest

from tests.conftest import add_snapshot, at, make_event

TODAY = date.today()


def progress(client, event_id):
    response = client.get(f"/events/{event_id}/sales-progress")
    assert response.status_code == 200, response.text
    return response.json()


# ---------- /sales-progress ----------

def test_progress_without_snapshots(client):
    event = make_event(client, days_from_today=5)
    data = progress(client, event["id"])
    assert data["snapshot_count"] == 0
    assert data["phase"] == "pre-event"
    assert data["days_until_event"] == 5
    assert data["tickets_sold_total"] is None
    assert data["projected_final_sales"] is None
    assert data["finalize_preview"] is None


def test_progress_pre_event_math(client):
    # 100 -> 300 tickets over 4 days = 50/day; 10 days left -> 300 + 500 = 800.
    event = make_event(client, days_from_today=10, capacity=1000)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), 100)
    add_snapshot(client, event["id"], at(TODAY), 300)

    data = progress(client, event["id"])
    assert data["phase"] == "pre-event"
    assert data["days_until_event"] == 10
    assert data["tickets_sold_total"] == 300
    assert data["sell_through_pct"] == 30.0
    assert data["velocity_tickets_per_day"] == 50.0
    assert data["projected_final_sales"] == 800
    assert data["gate_share_pct"] == 0.0
    assert data["show_rate_pct"] is None
    assert "projected to reach 800" in data["explanation"]


def test_projection_is_capped_at_capacity(client):
    event = make_event(client, days_from_today=30, capacity=1000)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), 100)
    add_snapshot(client, event["id"], at(TODAY), 300)
    assert progress(client, event["id"])["projected_final_sales"] == 1000


def test_velocity_uses_last_seven_days_only(client):
    # The day -20 snapshot is outside the window: velocity = (400-100)/6 = 50.
    event = make_event(client, days_from_today=10, capacity=5000)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=20)), 0)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=6)), 100)
    add_snapshot(client, event["id"], at(TODAY), 400)
    assert progress(client, event["id"])["velocity_tickets_per_day"] == 50.0


def test_progress_event_day_math(client):
    event = make_event(client, days_from_today=0, capacity=2000)
    add_snapshot(client, event["id"], at(TODAY, 10), 1000)
    add_snapshot(
        client, event["id"], at(TODAY, 20), 1200,
        gate_tickets_sold=200, attendance_checked_in=900,
    )

    data = progress(client, event["id"])
    assert data["phase"] == "event-day"
    assert data["days_until_event"] == 0
    # Span of 10 hours is floored to 1 day: (1200 - 1000) / 1 = 200/day.
    assert data["velocity_tickets_per_day"] == 200.0
    # No days remain, so nothing further is projected.
    assert data["projected_final_sales"] == 1200
    assert data["gate_share_pct"] == 16.7
    assert data["show_rate_pct"] == 75.0
    assert "not final actuals" in data["explanation"]


def test_progress_post_event_math(client):
    event = make_event(client, days_from_today=-2, capacity=1000)
    event_day = TODAY - timedelta(days=2)
    add_snapshot(client, event["id"], at(event_day - timedelta(days=1), 12), 500)
    add_snapshot(
        client, event["id"], at(event_day, 22), 800,
        gate_tickets_sold=100, attendance_checked_in=700, revenue_to_date=800000,
    )

    data = progress(client, event["id"])
    assert data["phase"] == "post-event"
    assert data["days_until_event"] == -2
    assert data["projected_final_sales"] == 800
    assert data["gate_share_pct"] == 12.5
    assert data["show_rate_pct"] == 87.5
    assert data["finalize_preview"]["actual_attendance"] == 700
    assert data["finalize_preview"]["revenue"] == 800000


# ---------- /live-vs-predicted ----------

def test_live_vs_predicted_statuses(client):
    # Baseline prediction: 2000*0.4 + 50000/50 - 1000/20 = 1750 attendees.
    event = make_event(client, days_from_today=0, capacity=2000,
                       ticket_price=1000, marketing_spend=50000)
    predicted = client.post("/predict", json={
        "event_id": event["id"], "ticket_price": 1000,
        "marketing_spend": 50000, "capacity": 2000,
    }).json()
    assert predicted["predicted_attendance"] == 1750

    def live():
        response = client.get(f"/events/{event['id']}/live-vs-predicted")
        assert response.status_code == 200, response.text
        return response.json()

    add_snapshot(client, event["id"], at(TODAY, 15), 1000, attendance_checked_in=200)
    data = live()
    assert data["status"] == "behind"            # 57.1% of 1750
    assert data["tickets_percent_of_prediction"] == 57.1
    assert data["attendance_percent_of_prediction"] == 11.4
    assert data["is_final"] is False
    assert data["phase"] == "event-day"

    add_snapshot(client, event["id"], at(TODAY, 17), 1700)
    assert live()["status"] == "on track"        # 97.1%, within +/-10%

    add_snapshot(client, event["id"], at(TODAY, 19), 1950)
    assert live()["status"] == "ahead"           # 111.4%


def test_live_vs_predicted_without_prediction_or_snapshots(client):
    event = make_event(client, days_from_today=0)
    data = client.get(f"/events/{event['id']}/live-vs-predicted").json()
    assert data["status"] is None
    assert "No snapshots" in data["explanation"]

    add_snapshot(client, event["id"], at(TODAY, 10), 100)
    data = client.get(f"/events/{event['id']}/live-vs-predicted").json()
    assert data["status"] is None
    assert data["predicted_attendance"] is None
    assert client.get("/events/999/live-vs-predicted").status_code == 404


# ---------- /analytics/event-day-patterns ----------

def _completed_event(client, name, total, gate, attendance, days_ago=5):
    event = make_event(client, days_from_today=-days_ago, capacity=2000, event_name=name)
    event_day = TODAY - timedelta(days=days_ago)
    add_snapshot(client, event["id"], at(event_day, 22), total,
                 gate_tickets_sold=gate, attendance_checked_in=attendance)
    return event


def patterns(client):
    response = client.get("/analytics/event-day-patterns")
    assert response.status_code == 200, response.text
    return response.json()


def test_patterns_with_zero_one_and_two_completed_events(client):
    data = patterns(client)
    assert data["events_used"] == 0
    assert data["sufficient_history"] is False
    assert data["avg_gate_share_pct"] is None

    # Upcoming events and completed events without check-ins are ignored.
    upcoming = make_event(client, days_from_today=3)
    add_snapshot(client, upcoming["id"], at(TODAY), 100, attendance_checked_in=0)
    no_checkins = make_event(client, days_from_today=-3, event_name="No check-ins")
    add_snapshot(client, no_checkins["id"], at(TODAY - timedelta(days=3)), 100)
    assert patterns(client)["events_used"] == 0

    _completed_event(client, "A", total=1000, gate=200, attendance=900)
    data = patterns(client)
    assert data["events_used"] == 1
    assert data["sufficient_history"] is False
    assert data["avg_gate_share_pct"] == 20.0
    assert data["avg_show_rate_pct"] == 90.0
    assert "Not enough history" in data["explanation"]

    _completed_event(client, "B", total=500, gate=50, attendance=400)
    data = patterns(client)
    assert data["events_used"] == 2
    assert data["sufficient_history"] is True
    assert data["avg_gate_share_pct"] == 15.0   # (20 + 10) / 2
    assert data["avg_show_rate_pct"] == 85.0    # (90 + 80) / 2


# ---------- finalize-actuals and the final-actuals rule ----------

def _event_actuals(client, event_id):
    event = next(e for e in client.get("/events").json() if e["id"] == event_id)
    return event["actual_attendance"], event["revenue"]


def test_snapshots_never_write_actuals_and_finalize_does(client):
    event = make_event(client, days_from_today=-1, capacity=1000)
    event_day = TODAY - timedelta(days=1)
    client.post("/predict", json={"event_id": event["id"], "ticket_price": 1000,
                                  "marketing_spend": 50000, "capacity": 1000})
    add_snapshot(client, event["id"], at(event_day, 18), 600, revenue_to_date=600000)
    add_snapshot(client, event["id"], at(event_day, 23), 750, gate_tickets_sold=50,
                 attendance_checked_in=700, revenue_to_date=760000)

    # Snapshots alone change nothing on the event or in accuracy statistics.
    assert _event_actuals(client, event["id"]) == (None, None)
    comparison = client.get("/dashboard/predicted-vs-actual").json()
    assert comparison["events_compared"] == 0
    assert [a["event_id"] for a in comparison["awaiting_results"]] == [event["id"]]

    finalized = client.post(f"/events/{event['id']}/finalize-actuals")
    assert finalized.status_code == 200, finalized.text
    body = finalized.json()
    assert body["actual_attendance"] == 700
    assert body["attendance_source"] == "attendance_checked_in"
    assert body["revenue"] == 760000
    assert body["revenue_source"] == "revenue_to_date"
    assert _event_actuals(client, event["id"]) == (700, 760000)

    comparison = client.get("/dashboard/predicted-vs-actual").json()
    assert comparison["events_compared"] == 1
    assert comparison["items"][0]["actual_attendance"] == 700

    # Final actuals stay editable through the normal flow.
    edited = client.patch(f"/events/{event['id']}/actuals",
                          json={"actual_attendance": 710, "revenue": 765000})
    assert edited.status_code == 200
    assert _event_actuals(client, event["id"]) == (710, 765000)

    # Adding a later snapshot still does not overwrite the edited actuals.
    add_snapshot(client, event["id"], at(TODAY, 1), 760, gate_tickets_sold=60,
                 attendance_checked_in=720)
    assert _event_actuals(client, event["id"]) == (710, 765000)


def test_finalize_falls_back_to_tickets_and_keeps_revenue(client):
    event = make_event(client, days_from_today=-1, capacity=1000, revenue=500000)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=1), 20), 640)

    body = client.post(f"/events/{event['id']}/finalize-actuals").json()
    assert body["actual_attendance"] == 640
    assert body["attendance_source"] == "tickets_sold_total"
    assert body["revenue"] == 500000
    assert body["revenue_source"] == "unchanged"
    assert _event_actuals(client, event["id"]) == (640, 500000)


@pytest.mark.parametrize("days_from_today,has_snapshot,expected", [
    (3, True, 400),     # future event
    (-1, False, 400),   # nothing to copy
])
def test_finalize_rejections(client, days_from_today, has_snapshot, expected):
    event = make_event(client, days_from_today=days_from_today)
    if has_snapshot:
        add_snapshot(client, event["id"], at(TODAY), 10)
    response = client.post(f"/events/{event['id']}/finalize-actuals")
    assert response.status_code == expected
    assert _event_actuals(client, event["id"]) == (None, None)


def test_finalize_unknown_event(client):
    assert client.post("/events/999/finalize-actuals").status_code == 404
