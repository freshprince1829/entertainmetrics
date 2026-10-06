from datetime import date, timedelta

import pytest

from app import crud
from app.database import get_db
from app.main import app
from app.ranges import BAND_MIN_SPREAD, band_spread
from tests.conftest import add_snapshot, add_tier, at, make_event

TODAY = date.today()


def predict(client, event, price=None, capacity=None, marketing=50000):
    response = client.post("/predict", json={
        "event_id": event["id"],
        "ticket_price": price if price is not None else event["ticket_price"],
        "marketing_spend": marketing,
        "capacity": capacity if capacity is not None else event["capacity"],
    })
    assert response.status_code == 200, response.text
    return response.json()


def assert_valid_band(p, capacity):
    assert 0 <= p["attendance_low"] <= p["predicted_attendance"] <= p["attendance_high"] <= capacity
    assert p["revenue_low"] <= p["predicted_revenue"] <= p["revenue_high"]
    assert "not a statistical confidence interval" in p["range_note"]


def legacy_prediction(event_id, attendance):
    """A prediction saved without a band, like those made before ranges."""
    db = next(app.dependency_overrides[get_db]())
    try:
        return crud.create_prediction(db, {
            "event_id": event_id, "predicted_attendance": attendance,
            "predicted_revenue": attendance * 1000.0, "confidence_score": 0.6,
            "model_version": "v1-rule-based",
        }).id
    finally:
        db.close()


def test_band_math_with_known_numbers(client):
    # Expected 2900, confidence 0.65 -> spread 0.25 - 0.065 = 18.5%.
    event = make_event(client, capacity=5000, ticket_price=2000, marketing_spend=50000)
    p = predict(client, event)
    assert p["predicted_attendance"] == 2900
    assert (p["attendance_low"], p["attendance_high"]) == (2363, 3437)
    assert (p["revenue_low"], p["revenue_high"]) == (2363 * 2000, 3437 * 2000)
    assert "+/-18.5%" in p["range_note"]
    assert_valid_band(p, 5000)


@pytest.mark.parametrize("capacity,price", [
    (1000, 1000),     # expected already at capacity
    (5000, 2000),     # comfortably below capacity
    (2000, 200000),   # price so high the formula floors at 0
])
def test_bands_always_valid(client, capacity, price):
    event = make_event(client, capacity=capacity, ticket_price=price, marketing_spend=50000)
    assert_valid_band(predict(client, event), capacity)


def test_band_valid_with_tiers_and_sales(client):
    event = make_event(client, days_from_today=10, capacity=5000, ticket_price=2000,
                       marketing_spend=50000)
    advance = add_tier(client, event["id"], "Advance", 2000, sale_phase="advance",
                       quantity_available=4000)
    vip = add_tier(client, event["id"], "VIP", 50000, sale_phase="premium", quantity_available=1000)
    for days_ago, (a, v) in [(4, (100, 5)), (0, (300, 20))]:
        client.post(f"/events/{event['id']}/sales-snapshots", json={
            "recorded_at": at(TODAY - timedelta(days=days_ago)),
            "tier_sales": [{"tier_id": advance["id"], "tickets_sold": a},
                           {"tier_id": vip["id"], "tickets_sold": v}],
        })
    p = predict(client, event)
    assert_valid_band(p, 5000)
    # Low revenue uses the cheaper of effective/base price, high the dearer of
    # effective/top tier price (VIP 50,000).
    assert p["revenue_high"] == p["attendance_high"] * 50000
    assert p["revenue_low"] == p["attendance_low"] * 2000
    assert "half pace" in p["range_note"]


def test_band_narrows_with_more_snapshots(client):
    assert band_spread(0.65, 0) > band_spread(0.65, 1) > band_spread(0.65, 3)
    assert band_spread(0.95, 50) == BAND_MIN_SPREAD

    event = make_event(client, days_from_today=10, capacity=5000, ticket_price=2000,
                       marketing_spend=50000)
    before = predict(client, event)
    add_snapshot(client, event["id"], at(TODAY), 300)   # one snapshot: same expected value
    after = predict(client, event)
    assert after["predicted_attendance"] == before["predicted_attendance"]
    width = lambda p: p["attendance_high"] - p["attendance_low"]  # noqa: E731
    assert width(after) < width(before)


def test_legacy_predictions_return_null_band_fields(client):
    event = make_event(client)
    legacy_id = legacy_prediction(event["id"], 500)

    for path in ("/predictions", "/dashboard/recent-predictions"):
        row = next(p for p in client.get(path).json() if p["id"] == legacy_id)
        assert row["predicted_attendance"] == 500
        for field in ("attendance_low", "attendance_high", "revenue_low",
                      "revenue_high", "range_note"):
            assert row[field] is None

    fresh = predict(client, event)
    listed = {p["id"]: p for p in client.get("/predictions").json()}
    assert listed[fresh["id"]]["attendance_low"] == fresh["attendance_low"]


def test_live_status_uses_the_band(client):
    # Expected 3000*0.4 + 1000 - 50 = 2150; band 1752-2548.
    event = make_event(client, days_from_today=0, capacity=3000, ticket_price=1000,
                       marketing_spend=50000)
    p = predict(client, event)
    assert (p["attendance_low"], p["attendance_high"]) == (1752, 2548)

    def live():
        return client.get(f"/events/{event['id']}/live-vs-predicted").json()

    add_snapshot(client, event["id"], at(TODAY, 15), 1000)
    data = live()
    assert data["range_status"] == "below range"
    assert data["status_label"] == "below range"
    assert data["status"] == "behind"                 # existing field unchanged

    add_snapshot(client, event["id"], at(TODAY, 17), 2000)
    assert live()["status_label"] == "within predicted range"

    add_snapshot(client, event["id"], at(TODAY, 19), 2600)
    data = live()
    assert data["range_status"] == "above range"
    assert data["status"] == "ahead"
    assert data["attendance_high"] == 2548


def test_live_status_falls_back_without_band(client):
    event = make_event(client, days_from_today=0, capacity=3000)
    legacy_prediction(event["id"], 1000)
    add_snapshot(client, event["id"], at(TODAY, 15), 1050)
    data = client.get(f"/events/{event['id']}/live-vs-predicted").json()
    assert data["range_status"] is None
    assert data["status"] == "on track"
    assert data["status_label"] == "on track"


def test_predicted_vs_actual_range_flags_and_coverage(client):
    def finalized(name, actual, revenue, legacy=False):
        event = make_event(client, days_from_today=-3, capacity=3000, ticket_price=1000,
                           marketing_spend=50000, event_name=name)
        if legacy:
            legacy_prediction(event["id"], 2000)
        else:
            predict(client, event)          # band 1752-2548, revenue 1.752M-2.548M
        response = client.patch(f"/events/{event['id']}/actuals",
                                json={"actual_attendance": actual, "revenue": revenue})
        assert response.status_code == 200, response.text

    finalized("Inside", 2000, 2000000)
    finalized("Outside", 1000, 1000000)
    finalized("Legacy", 2100, 2100000, legacy=True)
    # A live event with snapshots is not part of accuracy statistics.
    live = make_event(client, days_from_today=0, capacity=3000, event_name="Live")
    predict(client, live)
    add_snapshot(client, live["id"], at(TODAY, 12), 2000)

    data = client.get("/dashboard/predicted-vs-actual").json()
    items = {i["event_name"]: i for i in data["items"]}
    assert set(items) == {"Inside", "Outside", "Legacy"}
    assert items["Inside"]["attendance_in_range"] is True
    assert items["Inside"]["revenue_in_range"] is True
    assert items["Outside"]["attendance_in_range"] is False
    assert items["Outside"]["revenue_in_range"] is False
    assert items["Legacy"]["attendance_in_range"] is None
    assert items["Legacy"]["attendance_low"] is None
    assert data["events_compared"] == 3                # existing field unchanged
    assert data["events_with_range"] == 2
    assert data["events_in_range"] == 1
    assert data["range_coverage_pct"] == 50.0
