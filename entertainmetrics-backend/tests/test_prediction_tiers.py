from datetime import date, timedelta

import pytest

from tests.conftest import add_tier, at, make_event

TODAY = date.today()

# Base formula with capacity 5000, marketing 50,000 and price P:
#   5000 * 0.4 + 50000 / 50 - P / 20  ->  P = 2000 gives 2900 attendees.
INPUTS = {"marketing_spend": 50000, "capacity": 5000}


def predict(client, event_id, price=2000):
    response = client.post("/predict", json={"event_id": event_id, "ticket_price": price, **INPUTS})
    assert response.status_code == 200, response.text
    return response.json()


def tiered_event(client, **extra):
    event = make_event(client, days_from_today=10, capacity=5000, ticket_price=2000,
                       marketing_spend=50000, **extra)
    advance = add_tier(client, event["id"], "Advance", 2000, sale_phase="advance",
                       quantity_available=4000)
    vip = add_tier(client, event["id"], "VIP", 50000, sale_phase="advance",
                   is_premium=True, quantity_available=1000)
    return event, advance, vip


def tier_snapshot(client, event_id, when, sold):
    response = client.post(f"/events/{event_id}/sales-snapshots", json={
        "recorded_at": when,
        "tier_sales": [{"tier_id": t["id"], "tickets_sold": n} for t, n in sold],
    })
    assert response.status_code == 201, response.text


def test_no_tiers_prediction_is_unchanged(client):
    event = make_event(client, capacity=5000, ticket_price=2000, marketing_spend=50000)
    result = predict(client, event["id"])
    assert result["predicted_attendance"] == 2900
    assert result["predicted_revenue"] == 2900 * 2000
    assert result["confidence_score"] == pytest.approx(0.65)
    assert result["model_version"] == "v1-rule-based"
    assert "Pricing" not in result["insight_summary"]


def test_premium_tiers_do_not_lower_attendance(client):
    event, _, _ = tiered_event(client)
    result = predict(client, event["id"])
    # Attendance uses the 2000 base price, not the VIP-inflated average.
    assert result["predicted_attendance"] == 2900
    # Revenue uses the quantity-weighted tier average:
    # (2000*4000 + 50000*1000) / 5000 = 11,600.
    assert result["predicted_revenue"] == 2900 * 11600
    assert result["model_version"] == "v1-rule-based+tiers"
    assert result["confidence_score"] == 0.67          # +0.02 for defined tiers
    assert "base price KES 2,000" in result["insight_summary"]
    assert "average tier price weighted by quantity" in result["insight_summary"]

    # For contrast: charging 11,600 as a flat price would cut attendance.
    flat = make_event(client, event_name="Flat", capacity=5000, ticket_price=11600,
                      marketing_spend=50000)
    assert predict(client, flat["id"], price=11600)["predicted_attendance"] == 2420


def test_large_vip_share_of_sales_keeps_attendance_and_raises_revenue(client):
    event, advance, vip = tiered_event(client)
    tier_snapshot(client, event["id"], at(TODAY), [(advance, 100), (vip, 300)])

    result = predict(client, event["id"])
    assert result["predicted_attendance"] == 2900
    # Realized average price: (100*2000 + 300*50000) / 400 = 38,000.
    assert result["predicted_revenue"] == 2900 * 38000
    assert result["confidence_score"] == 0.68          # +0.02 tiers, +0.01 tier sales
    assert "realized average price from 400 tickets" in result["insight_summary"]


def test_what_if_price_overrides_tier_pricing(client):
    event, _, _ = tiered_event(client)
    result = predict(client, event["id"], price=3000)
    assert result["predicted_attendance"] == 2850      # 2000 + 1000 - 150
    assert result["predicted_revenue"] == 2850 * 3000
    assert result["model_version"] == "v1-rule-based"
    assert "What-if ticket price KES 3,000" in result["insight_summary"]


def test_sales_blend_still_works_with_tiers(client):
    event, advance, _ = tiered_event(client)
    tier_snapshot(client, event["id"], at(TODAY - timedelta(days=4)), [(advance, 100)])
    tier_snapshot(client, event["id"], at(TODAY), [(advance, 300)])

    result = predict(client, event["id"])
    # Projected sales 300 + 50/day * 10 = 800; blend 0.6*800 + 0.4*2900 = 1640.
    assert result["predicted_attendance"] == 1640
    assert result["predicted_revenue"] == 1640 * 2000  # realized price = 2000
    assert result["model_version"] == "v1-rule-based+sales+tiers"
    assert result["confidence_score"] == 0.70          # 0.65 +0.02 snaps +0.03 tiers
    assert "Ticket sales projection used" in result["insight_summary"]
    assert "Pricing:" in result["insight_summary"]


def _completed_tier_event(client, name, sold):
    event = make_event(client, days_from_today=-5, capacity=2000, event_name=name)
    tiers = [
        add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird"),
        add_tier(client, event["id"], "Standard", 2000),
        add_tier(client, event["id"], "VIP", 10000, is_premium=True),
    ]
    tier_snapshot(client, event["id"], at(TODAY - timedelta(days=5), 22), list(zip(tiers, sold)))


def test_tier_patterns_with_zero_one_and_two_completed_events(client):
    def patterns():
        return client.get("/analytics/event-day-patterns").json()

    data = patterns()
    assert data["tier_events_used"] == 0
    assert data["tier_sufficient_history"] is False
    assert data["avg_premium_revenue_share_pct"] is None

    # Premium 100k of 800k = 12.5%; early bird 100 of 410 tickets = 24.4%.
    _completed_tier_event(client, "A", (100, 300, 10))
    data = patterns()
    assert data["tier_events_used"] == 1
    assert data["tier_sufficient_history"] is False
    assert data["avg_premium_revenue_share_pct"] == 12.5
    assert data["avg_early_bird_ticket_share_pct"] == 24.4

    # Premium 500k of 1.5M = 33.3%; early bird 0%.
    _completed_tier_event(client, "B", (0, 500, 50))
    data = patterns()
    assert data["tier_events_used"] == 2
    assert data["tier_sufficient_history"] is True
    assert data["avg_premium_revenue_share_pct"] == 22.9
    assert data["avg_early_bird_ticket_share_pct"] == 12.2
    # Existing pattern fields are untouched.
    assert data["events_used"] == 0
    assert data["sufficient_history"] is False
