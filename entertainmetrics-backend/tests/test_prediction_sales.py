from datetime import date, timedelta

import pytest

from tests.conftest import add_snapshot, at, make_event

TODAY = date.today()

# Base formula for these inputs, no lineup:
# 2000 * 0.4 + 50000 / 50 - 1000 / 20 = 1750 attendees, confidence 0.65.
BASE_INPUTS = {"ticket_price": 1000, "marketing_spend": 50000, "capacity": 2000}
BASE_INSIGHT = (
    "Lineup data was not linked, so artist influence was excluded from the "
    "prediction. Dynamic confidence score is 0.65, and confidence is lower "
    "because lineup data is missing."
)
COMPARED_FIELDS = (
    "predicted_attendance", "predicted_revenue", "confidence_score",
    "model_version", "insight_summary",
)


def predict(client, event_id, **overrides):
    response = client.post("/predict", json={"event_id": event_id, **BASE_INPUTS, **overrides})
    assert response.status_code == 200, response.text
    return response.json()


def upcoming_event(client, **extra):
    return make_event(client, days_from_today=10, capacity=2000,
                      ticket_price=1000, marketing_spend=50000, **extra)


def completed_event(client, name, total, gate, attendance):
    event = make_event(client, days_from_today=-5, capacity=2000, event_name=name)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=5), 22), total,
                 gate_tickets_sold=gate, attendance_checked_in=attendance)


def test_regression_zero_and_one_snapshot_predictions_unchanged(client):
    event = upcoming_event(client)

    no_snapshots = predict(client, event["id"])
    assert no_snapshots["predicted_attendance"] == 1750
    assert no_snapshots["predicted_revenue"] == 1750000
    # Existing behaviour is unrounded (0.6500000000000001), so compare approximately.
    assert no_snapshots["confidence_score"] == pytest.approx(0.65)
    assert no_snapshots["model_version"] == "v1-rule-based"
    assert no_snapshots["insight_summary"] == BASE_INSIGHT

    assert add_snapshot(client, event["id"], at(TODAY), 300).status_code == 201
    one_snapshot = predict(client, event["id"])
    for field in COMPARED_FIELDS:
        assert one_snapshot[field] == no_snapshots[field], field


def test_two_snapshots_blend_sales_projection_without_history(client):
    event = upcoming_event(client)
    # 100 -> 300 over 4 days = 50/day; 10 days left -> 800 projected sales.
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), 100)
    add_snapshot(client, event["id"], at(TODAY), 300)

    result = predict(client, event["id"])
    # 0.6 * 800 + 0.4 * 1750 = 1180
    assert result["predicted_attendance"] == 1180
    assert result["predicted_revenue"] == 1180 * 1000
    assert result["confidence_score"] == 0.67      # 0.65 + 2 * 0.01
    assert result["model_version"] == "v1-rule-based+sales"
    assert "Ticket sales projection used" in result["insight_summary"]
    assert "not enough history" in result["insight_summary"]
    assert "were not applied" in result["insight_summary"]


def test_learned_patterns_applied_with_sufficient_history(client):
    # Gate share (20% + 20%) / 2 = 20%; show rate (90% + 50%) / 2 = 70%.
    completed_event(client, "A", total=1000, gate=200, attendance=900)
    completed_event(client, "B", total=1000, gate=200, attendance=500)
    event = upcoming_event(client)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), 100)
    add_snapshot(client, event["id"], at(TODAY), 300)

    result = predict(client, event["id"])
    # 800 advance tickets + 800 * 0.2 / 0.8 = 200 gate -> 1000 tickets,
    # * 70% show rate = 700 attending. 0.6 * 700 + 0.4 * 1750 = 1120.
    assert result["predicted_attendance"] == 1120
    assert "Learned show rate (70.0%) and gate share (20.0%)" in result["insight_summary"]
    assert "200 gate tickets" in result["insight_summary"]


def test_one_completed_event_is_not_enough_history(client):
    completed_event(client, "A", total=1000, gate=200, attendance=900)
    event = upcoming_event(client)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), 100)
    add_snapshot(client, event["id"], at(TODAY), 300)

    result = predict(client, event["id"])
    assert result["predicted_attendance"] == 1180   # same as no history
    assert "1 of 2 completed events" in result["insight_summary"]


def test_blended_prediction_stays_within_capacity(client):
    event = make_event(client, days_from_today=10, capacity=1000,
                       ticket_price=1000, marketing_spend=50000)
    add_snapshot(client, event["id"], at(TODAY - timedelta(days=1)), 900)
    add_snapshot(client, event["id"], at(TODAY), 1000)

    result = predict(client, event["id"], capacity=1000)
    assert 0 <= result["predicted_attendance"] <= 1000
    assert result["predicted_revenue"] == result["predicted_attendance"] * 1000


def test_confidence_boost_is_capped(client):
    event = upcoming_event(client)
    for i, total in enumerate([10, 20, 30, 40, 50, 60, 70]):
        add_snapshot(client, event["id"], at(TODAY - timedelta(days=6 - i)), total)

    result = predict(client, event["id"])
    assert result["confidence_score"] == 0.70      # 0.65 + max boost 0.05
    assert 0.3 <= result["confidence_score"] <= 0.95
