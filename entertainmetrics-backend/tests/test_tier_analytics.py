from datetime import date, timedelta

from tests.conftest import add_tier, at, make_event

TODAY = date.today()


def tier_snapshot(client, event_id, when, sold, **extra):
    """sold: list of (tier, tickets_sold) or (tier, tickets_sold, checked_in)."""
    sales = []
    for entry in sold:
        sale = {"tier_id": entry[0]["id"], "tickets_sold": entry[1]}
        if len(entry) > 2:
            sale["checked_in"] = entry[2]
        sales.append(sale)
    return client.post(f"/events/{event_id}/sales-snapshots",
                       json={"recorded_at": when, "tier_sales": sales, **extra})


def ok(response):
    assert response.status_code == 201, response.text
    return response.json()


def analytics(client, event_id):
    response = client.get(f"/events/{event_id}/tier-analytics")
    assert response.status_code == 200, response.text
    return response.json()


def test_tier_analytics_math(client):
    event = make_event(client, days_from_today=10, capacity=2000, ticket_price=2000)
    eb = add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird", quantity_available=100)
    std = add_tier(client, event["id"], "Standard", 2000, quantity_available=1000)
    vip = add_tier(client, event["id"], "VIP", 6000, sale_phase="premium", access_level="vip",
                   quantity_available=50)
    partner = add_tier(client, event["id"], "Bank Card Offer", 1500, audience="partner",
                       partner_name="KCB")
    ok(tier_snapshot(client, event["id"], at(TODAY - timedelta(days=9)),
                     [(eb, 40), (std, 50), (partner, 10)]))
    ok(tier_snapshot(client, event["id"], at(TODAY),
                     [(eb, 100), (std, 200), (vip, 20), (partner, 80)]))

    data = analytics(client, event["id"])
    assert data["has_tier_data"] is True
    # 400 tickets; revenue 100k + 400k + 120k + 120k = 740k.
    assert data["tickets_sold_total"] == 400
    assert data["revenue_total"] == 740000
    assert data["realized_average_price"] == 1850

    tiers = {t["name"]: t for t in data["tiers"]}
    assert (tiers["Early Bird"]["share_of_tickets_pct"], tiers["Early Bird"]["share_of_revenue_pct"]) == (25.0, 13.5)
    assert (tiers["VIP"]["share_of_tickets_pct"], tiers["VIP"]["share_of_revenue_pct"]) == (5.0, 16.2)
    assert tiers["Early Bird"]["days_to_sell_out"] == 9.0
    assert tiers["Standard"]["days_to_sell_out"] is None           # not sold out
    assert tiers["Bank Card Offer"]["days_to_sell_out"] is None    # quantity unknown
    assert tiers["Standard"]["sell_through_pct"] == 20.0
    assert tiers["VIP"]["realized_average_price"] == 6000
    assert tiers["Standard"]["show_rate_pct"] is None              # no check-ins recorded
    assert round(sum(t["revenue_per_ticket"] for t in data["tiers"]), 2) == 1850

    assert data["partner_discount_share_pct"] == 20.0
    assert data["partner_average_price"] == 1500
    # Bands vs base price 2000: EB 0.5x and partner 0.75x discount, VIP 3x premium.
    assert [(g["key"], g["tickets"], g["share_of_tickets_pct"]) for g in data["affordability_profile"]] == [
        ("discount", 180, 45.0), ("standard", 200, 50.0), ("premium", 20, 5.0)]
    phases = {g["key"]: g["share_of_tickets_pct"] for g in data["by_sale_phase"]}
    assert phases == {"standard": 70.0, "early_bird": 25.0, "premium": 5.0}
    audiences = {g["key"]: g["tickets"] for g in data["by_audience"]}
    assert audiences == {"public": 320, "partner": 80}

    assert data["insights"] == [
        "Early Bird sold out in 9 days.",
        "VIP: 5.0% of tickets, 16.2% of revenue.",
        "Partner tickets: 20.0% of tickets at an average of KES 1,500 (KCB).",
        "Most tickets (50.0%) were sold in the standard price band.",
        "Realized average price is KES 1,850 per ticket.",
    ]
    assert "not demand curves" in data["note"]


def test_show_rate_per_tier_from_checked_in(client):
    event = make_event(client, days_from_today=0, capacity=1000)
    a = add_tier(client, event["id"], "Advance", 1000)
    b = add_tier(client, event["id"], "VIP", 3000, sale_phase="premium", access_level="vip")
    snap = ok(tier_snapshot(client, event["id"], at(TODAY, 21), [(a, 100, 80), (b, 50, 45)]))
    # Snapshot attendance is the sum of per-tier check-ins.
    assert snap["attendance_checked_in"] == 125
    assert {t["tier_name"]: t["checked_in"] for t in snap["tier_sales"]} == {"Advance": 80, "VIP": 45}

    data = analytics(client, event["id"])
    rates = {t["name"]: t["show_rate_pct"] for t in data["tiers"]}
    assert rates == {"Advance": 80.0, "VIP": 90.0}
    assert "Lowest show rate: Advance at 80.0% of tickets sold checked in." in data["insights"]


def test_checked_in_validation(client):
    event = make_event(client, days_from_today=0, capacity=1000)
    a = add_tier(client, event["id"], "Advance", 1000)
    b = add_tier(client, event["id"], "Gate", 1500, sale_phase="gate")

    over = tier_snapshot(client, event["id"], at(TODAY, 18), [(a, 10, 11)])
    assert over.status_code == 422

    mismatch = tier_snapshot(client, event["id"], at(TODAY, 18), [(a, 100, 60), (b, 10, 5)],
                             attendance_checked_in=70)
    assert mismatch.status_code == 422
    assert "disagrees" in mismatch.json()["detail"]

    matching = tier_snapshot(client, event["id"], at(TODAY, 18), [(a, 100, 60), (b, 10, 5)],
                             attendance_checked_in=65)
    assert matching.status_code == 201, matching.text

    lower = tier_snapshot(client, event["id"], at(TODAY, 20), [(a, 120, 50), (b, 10, 5)])
    assert lower.status_code == 400
    assert "check-ins are cumulative" in lower.json()["detail"]

    # Without per-tier check-ins the snapshot-level number still works.
    legacy_style = tier_snapshot(client, event["id"], at(TODAY, 21), [(a, 130), (b, 12)],
                                 attendance_checked_in=90)
    assert legacy_style.status_code == 201, legacy_style.text


def test_tier_analytics_empty_cases(client):
    event = make_event(client)
    data = analytics(client, event["id"])
    assert data["has_tier_data"] is False
    assert data["tiers"] == [] and data["insights"] == []
    assert "No tier-level sales" in data["message"]

    tier = add_tier(client, event["id"], "Advance", 1000)
    ok(tier_snapshot(client, event["id"], at(TODAY), [(tier, 0)]))
    data = analytics(client, event["id"])
    assert data["has_tier_data"] is False
    assert "no tickets have been sold" in data["message"]

    assert client.get("/events/999/tier-analytics").status_code == 404


def _completed_event(client, name, tiers, sold_first, sold_last, finalize=True):
    """tiers: list of (name, price, extra kwargs); sold_*: tickets per tier."""
    event = make_event(client, days_from_today=-5, capacity=2000, event_name=name)
    created = [add_tier(client, event["id"], n, p, **kw) for n, p, kw in tiers]
    event_day = TODAY - timedelta(days=5)
    if sold_first:
        ok(tier_snapshot(client, event["id"], at(event_day - timedelta(days=5), 22),
                         list(zip(created, sold_first))))
    ok(tier_snapshot(client, event["id"], at(event_day, 22), list(zip(created, sold_last))))
    if finalize:
        response = client.patch(f"/events/{event['id']}/actuals",
                                json={"actual_attendance": sum(sold_last)})
        assert response.status_code == 200
    return event


def test_tier_patterns_with_zero_one_and_two_completed_events(client):
    def patterns():
        response = client.get("/analytics/tier-patterns")
        assert response.status_code == 200, response.text
        return response.json()

    data = patterns()
    assert data["events_used"] == 0
    assert data["sufficient_history"] is False
    assert data["by_access_level"] == []

    # Neither an unfinalized past event nor a live event counts.
    _completed_event(client, "Unfinalized", [("Standard", 2000, {})], None, (500,), finalize=False)
    live = make_event(client, days_from_today=0, event_name="Live")
    live_tier = add_tier(client, live["id"], "Standard", 2000)
    ok(tier_snapshot(client, live["id"], at(TODAY), [(live_tier, 300)]))
    assert patterns()["events_used"] == 0

    vip = ("VIP", 5000, {"sale_phase": "premium", "access_level": "vip"})
    # Event A: Early Bird (qty 40) sells out 5 days after the first snapshot.
    _completed_event(client, "A",
                     [("Early Bird", 1000, {"sale_phase": "early_bird", "quantity_available": 40}), vip],
                     (20, 0), (40, 10))
    data = patterns()
    assert data["events_used"] == 1
    assert data["sufficient_history"] is False
    assert "Not enough history" in data["explanation"]

    # Event B: Standard 90, VIP 10.
    _completed_event(client, "B", [("Standard", 2000, {}), vip], None, (90, 10))
    data = patterns()
    assert data["events_used"] == 2
    assert data["sufficient_history"] is True
    access = {g["key"]: g for g in data["by_access_level"]}
    assert access["vip"]["avg_share_of_tickets_pct"] == 15.0      # (20 + 10) / 2
    assert access["general"]["avg_share_of_tickets_pct"] == 85.0  # (80 + 90) / 2
    phases = {g["key"]: g for g in data["by_sale_phase"]}
    assert phases["early_bird"]["avg_share_of_tickets_pct"] == 40.0   # (80 + 0) / 2
    assert phases["early_bird"]["events_with_key"] == 1
    assert data["avg_early_bird_days_to_sell_out"] == 5.0
    assert {g["key"] for g in data["by_audience"]} == {"public"}
