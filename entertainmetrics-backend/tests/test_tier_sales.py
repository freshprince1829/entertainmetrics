from datetime import date, timedelta

import pytest

from tests.conftest import add_snapshot, add_tier, at, make_event

TODAY = date.today()


@pytest.fixture
def tiered(client):
    event = make_event(client, days_from_today=10, capacity=2000, ticket_price=1800)
    tiers = {
        "eb": add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird",
                       quantity_available=200, sort_order=1),
        "adv": add_tier(client, event["id"], "Advance", 2000, sale_phase="advance",
                        quantity_available=1000, sort_order=2),
        "vip": add_tier(client, event["id"], "VIP", 10000, sale_phase="advance",
                        is_premium=True, quantity_available=50, sort_order=3),
        "gate": add_tier(client, event["id"], "Gate", 2500, sale_phase="gate", sort_order=4),
    }
    return event, tiers


def tier_snapshot(client, event_id, when, tiers, sold, **extra):
    return client.post(f"/events/{event_id}/sales-snapshots", json={
        "recorded_at": when,
        "tier_sales": [{"tier_id": tiers[k]["id"], "tickets_sold": v} for k, v in sold.items()],
        **extra,
    })


def test_tier_sales_compute_totals_gate_and_revenue(client, tiered):
    event, tiers = tiered
    response = tier_snapshot(client, event["id"], at(TODAY - timedelta(days=2)), tiers,
                             {"eb": 200, "adv": 300, "vip": 10, "gate": 0})
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["tickets_sold_total"] == 510
    assert body["gate_tickets_sold"] == 0
    # 200*1000 + 300*2000 + 10*10000 = 900,000
    assert body["revenue_to_date"] == 900000
    assert {t["tier_name"]: t["tickets_sold"] for t in body["tier_sales"]} == {
        "Early Bird": 200, "Advance": 300, "VIP": 10, "Gate": 0,
    }

    gate_day = tier_snapshot(client, event["id"], at(TODAY), tiers,
                             {"eb": 200, "adv": 350, "vip": 12, "gate": 40})
    assert gate_day.status_code == 201, gate_day.text
    assert gate_day.json()["gate_tickets_sold"] == 40
    assert gate_day.json()["tickets_sold_total"] == 602

    listed = client.get(f"/events/{event['id']}/sales-snapshots").json()
    assert [s["tickets_sold_total"] for s in listed] == [510, 602]
    assert listed[0]["tier_sales"][0]["tier_price"] == 1000


def test_matching_totals_accepted_and_mismatched_rejected(client, tiered):
    event, tiers = tiered
    sold = {"eb": 100, "adv": 50}
    mismatch = tier_snapshot(client, event["id"], at(TODAY), tiers, sold, tickets_sold_total=999)
    assert mismatch.status_code == 422
    assert "disagree" in mismatch.json()["detail"]

    wrong_revenue = tier_snapshot(client, event["id"], at(TODAY), tiers, sold, revenue_to_date=5)
    assert wrong_revenue.status_code == 422

    wrong_gate = tier_snapshot(client, event["id"], at(TODAY), tiers, sold, gate_tickets_sold=3)
    assert wrong_gate.status_code == 422

    matching = tier_snapshot(client, event["id"], at(TODAY), tiers, sold,
                             tickets_sold_total=150, gate_tickets_sold=0, revenue_to_date=200000)
    assert matching.status_code == 201, matching.text


def test_per_tier_cumulative_and_quantity_limits(client, tiered):
    event, tiers = tiered
    assert tier_snapshot(client, event["id"], at(TODAY - timedelta(days=3)), tiers,
                         {"eb": 150, "adv": 300}).status_code == 201

    lower = tier_snapshot(client, event["id"], at(TODAY), tiers, {"eb": 150, "adv": 250, "vip": 60})
    assert lower.status_code == 400
    assert "Advance" in lower.json()["detail"]

    over = tier_snapshot(client, event["id"], at(TODAY), tiers, {"eb": 201, "adv": 300})
    assert over.status_code == 400
    assert "exceeds the 200 available" in over.json()["detail"]

    # Backdated snapshot higher than the later one is rejected too.
    backdated = tier_snapshot(client, event["id"], at(TODAY - timedelta(days=5)), tiers,
                              {"eb": 160, "adv": 10})
    assert backdated.status_code == 400
    assert "next snapshot" in backdated.json()["detail"]


def test_foreign_duplicate_and_empty_tier_sales_rejected(client, tiered):
    event, tiers = tiered
    other = make_event(client, event_name="Other")
    foreign = add_tier(client, other["id"], "Standard", 1500)

    response = client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": at(TODAY), "tier_sales": [{"tier_id": foreign["id"], "tickets_sold": 5}],
    })
    assert response.status_code == 422
    assert "does not belong" in response.json()["detail"]

    duplicate = client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": at(TODAY),
        "tier_sales": [{"tier_id": tiers["eb"]["id"], "tickets_sold": 5},
                       {"tier_id": tiers["eb"]["id"], "tickets_sold": 6}],
    })
    assert duplicate.status_code == 422

    empty = client.post(f"/events/{event['id']}/sales-snapshots",
                        json={"recorded_at": at(TODAY), "tier_sales": []})
    assert empty.status_code == 422

    attendance = tier_snapshot(client, event["id"], at(TODAY), tiers, {"eb": 10},
                               attendance_checked_in=11)
    assert attendance.status_code == 422


def test_tier_totals_still_respect_capacity(client):
    event = make_event(client, capacity=100)
    tiers = {"std": add_tier(client, event["id"], "Standard", 1000)}
    response = tier_snapshot(client, event["id"], at(TODAY), tiers, {"std": 101})
    assert response.status_code == 400
    assert "capacity" in response.json()["detail"]


def test_legacy_snapshots_still_work_on_tiered_events(client, tiered):
    event, _ = tiered
    legacy = add_snapshot(client, event["id"], at(TODAY), 120, revenue_to_date=150000)
    assert legacy.status_code == 201, legacy.text
    assert legacy.json()["tier_sales"] is None
    missing_total = client.post(f"/events/{event['id']}/sales-snapshots",
                                json={"recorded_at": at(TODAY)})
    assert missing_total.status_code == 422


def test_tier_delete_and_quantity_blocked_once_sales_exist(client, tiered):
    event, tiers = tiered
    snap = tier_snapshot(client, event["id"], at(TODAY), tiers, {"eb": 120, "vip": 5}).json()

    blocked = client.delete(f"/events/{event['id']}/tiers/{tiers['eb']['id']}")
    assert blocked.status_code == 409
    assert "recorded sales" in blocked.json()["detail"]

    shrink = client.patch(f"/events/{event['id']}/tiers/{tiers['eb']['id']}",
                          json={"quantity_available": 100})
    assert shrink.status_code == 409

    # Tiers without sales can still be deleted.
    assert client.delete(f"/events/{event['id']}/tiers/{tiers['gate']['id']}").status_code == 204

    # Deleting the snapshot removes its tier rows, which unblocks the tier.
    assert client.delete(f"/events/{event['id']}/sales-snapshots/{snap['id']}").status_code == 204
    assert client.delete(f"/events/{event['id']}/tiers/{tiers['eb']['id']}").status_code == 204


def test_revenue_breakdown_math(client, tiered):
    event, tiers = tiered
    tier_snapshot(client, event["id"], at(TODAY - timedelta(days=2)), tiers,
                  {"eb": 200, "adv": 300, "vip": 10, "gate": 0})
    # A later legacy snapshot does not hide the latest tier data.
    add_snapshot(client, event["id"], at(TODAY), 520)

    data = client.get(f"/events/{event['id']}/revenue-breakdown").json()
    assert data["has_tier_data"] is True
    assert data["tickets_sold_total"] == 510
    assert data["revenue_total"] == 900000
    assert data["realized_average_price"] == 1764.71     # 900,000 / 510
    assert data["base_price"] == 2000                     # Advance tier

    by_name = {t["name"]: t for t in data["tiers"]}
    assert by_name["Early Bird"]["sold_out"] is True
    assert by_name["Early Bird"]["share_of_tickets_pct"] == 39.2
    assert by_name["Early Bird"]["share_of_revenue_pct"] == 22.2
    assert by_name["Advance"]["sell_through_pct"] == 30.0
    assert by_name["VIP"]["share_of_revenue_pct"] == 11.1
    assert by_name["Gate"]["sell_through_pct"] is None   # quantity unknown

    assert "Early Bird sold out: 39.2% of tickets but 22.2% of revenue." in data["explanation"]
    assert "VIP is 2.0% of tickets and 11.1% of revenue." in data["explanation"]
    assert "Realized average price is KES 1,765" in data["explanation"]


def test_revenue_breakdown_without_tier_data(client):
    event = make_event(client)
    add_snapshot(client, event["id"], at(TODAY), 50)
    data = client.get(f"/events/{event['id']}/revenue-breakdown").json()
    assert data["has_tier_data"] is False
    assert data["tiers"] == []
    assert client.get("/events/999/revenue-breakdown").status_code == 404
