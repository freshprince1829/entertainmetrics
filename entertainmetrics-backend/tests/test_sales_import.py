from datetime import date, timedelta

import pytest

from app.sales_import import suggest_tags
from tests.conftest import add_tier, make_event

TODAY = date.today()
D1 = (TODAY - timedelta(days=2)).isoformat()
D2 = (TODAY - timedelta(days=1)).isoformat()
NAIROBI = 180


@pytest.fixture
def setup(client):
    event = make_event(client, days_from_today=10, capacity=1000)
    eb = add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird", quantity_available=200)
    adv = add_tier(client, event["id"], "Advance", 2000, sale_phase="advance")
    return event, eb, adv


def run(client, event_id, csv_text, dry_run=True, **extra):
    return client.post(
        f"/events/{event_id}/sales-import?dry_run={'true' if dry_run else 'false'}",
        json={"csv_text": csv_text, "utc_offset_minutes": NAIROBI, **extra},
    )


def snapshots(client, event_id):
    return client.get(f"/events/{event_id}/sales-snapshots").json()


def test_dry_run_then_import_with_case_insensitive_matching(client, setup):
    event, _, _ = setup
    csv_text = (
        "Date Time,Ticket Type,Quantity,Revenue,Scanned In\n"
        f"{D1} 10:00,early bird,100,100000,\n"
        f"{D1} 10:00,ADVANCE,50,,\n"
        f"{D2} 18:30,Early Bird,200,200000,\n"
    )
    preview = run(client, event["id"], csv_text)
    assert preview.status_code == 200, preview.text
    data = preview.json()
    assert data["dry_run"] is True and data["can_import"] is True
    assert [r["status"] for r in data["rows"]] == ["matched", "matched", "matched"]
    assert [r["tier_name"] for r in data["rows"]] == ["Early Bird", "Advance", "Early Bird"]
    # Second snapshot carries Advance (50) forward: 200 + 50 = 250 tickets.
    assert [(s["tickets_sold_total"], s["revenue_to_date"]) for s in data["snapshots"]] == [
        (150, 200000), (250, 300000)]
    assert snapshots(client, event["id"]) == []          # dry run writes nothing

    imported = run(client, event["id"], csv_text, dry_run=False)
    assert imported.status_code == 200, imported.text
    assert imported.json()["snapshots_created"] == 2
    saved = snapshots(client, event["id"])
    assert [s["tickets_sold_total"] for s in saved] == [150, 250]
    assert {t["tier_name"]: t["tickets_sold"] for t in saved[1]["tier_sales"]} == {
        "Early Bird": 200, "Advance": 50}
    assert saved[0]["notes"] == "Imported from CSV"
    assert saved[0]["recorded_at"].startswith(f"{D1}T07:00")   # 10:00 Nairobi = 07:00 UTC


def test_unmatched_types_get_keyword_suggestions_and_block_import(client, setup):
    event, _, _ = setup
    csv_text = (
        "date,type,qty,amount\n"
        f"{D1} 12:00,VIP Gold,10,60000\n"
        f"{D1} 12:00,KCB Card Offer,20,30000\n"
        f"{D1} 12:00,Early Bird,5,5000\n"
    )
    data = run(client, event["id"], csv_text).json()
    assert data["can_import"] is False
    statuses = {r["ticket_type"]: r["status"] for r in data["rows"]}
    assert statuses == {"VIP Gold": "unmatched", "KCB Card Offer": "unmatched", "Early Bird": "matched"}
    unmatched = {u["ticket_type"]: u for u in data["unmatched_types"]}
    assert unmatched["VIP Gold"]["suggested_access_level"] == "vip"
    assert unmatched["VIP Gold"]["suggested_sale_phase"] == "premium"
    assert unmatched["VIP Gold"]["suggested_price"] == 6000
    assert unmatched["KCB Card Offer"]["suggested_audience"] == "partner"
    assert unmatched["KCB Card Offer"]["suggested_partner_name"] == "KCB"
    assert any("Unmatched ticket type" in e for e in data["errors"])

    rejected = run(client, event["id"], csv_text, dry_run=False)
    assert rejected.status_code == 422
    assert "Nothing was imported" in rejected.json()["detail"]["message"]
    assert snapshots(client, event["id"]) == []


def test_map_and_create_unmatched_types(client, setup):
    event, _, _ = setup
    partner = add_tier(client, event["id"], "Partner Offer", 1500, audience="partner", partner_name="KCB")
    csv_text = (
        "date_time,ticket_type,quantity\n"
        f"{D1} 12:00,VIP Gold,10\n"
        f"{D1} 12:00,KCB Card Offer,20\n"
    )
    extra = {
        "mappings": {"kcb card offer": partner["id"]},
        "create_tiers": [{"ticket_type": "VIP Gold", "name": "VIP", "price": 6000,
                          "sale_phase": "premium", "access_level": "vip", "quantity_available": 50}],
    }
    preview = run(client, event["id"], csv_text, **extra).json()
    assert preview["can_import"] is True, preview["errors"]
    assert {r["ticket_type"]: r["status"] for r in preview["rows"]} == {
        "VIP Gold": "new_tier", "KCB Card Offer": "mapped"}
    assert preview["snapshots"][0]["revenue_to_date"] == 10 * 6000 + 20 * 1500
    assert [t["name"] for t in client.get(f"/events/{event['id']}/tiers").json()].count("VIP") == 0

    done = run(client, event["id"], csv_text, dry_run=False, **extra)
    assert done.status_code == 200, done.text
    assert done.json()["tiers_created"] == ["VIP"]
    tiers = {t["name"]: t for t in client.get(f"/events/{event['id']}/tiers").json()}
    assert tiers["VIP"]["access_level"] == "vip" and tiers["VIP"]["is_premium"] is True
    assert snapshots(client, event["id"])[0]["tickets_sold_total"] == 30


def test_row_validation_errors(client, setup):
    event, _, _ = setup
    csv_text = (
        "date_time,ticket_type,quantity,revenue,scanned_in\n"
        "not a date,Early Bird,10,,\n"
        f"{D1} 12:00,Advance,-4,,\n"
        f"{D1} 13:00,Advance,10,,12\n"
        f"{D1} 14:00,Early Bird,10,999,\n"
    )
    data = run(client, event["id"], csv_text).json()
    assert data["can_import"] is False
    problems = {r["row_number"]: " ".join(r["errors"]) for r in data["rows"]}
    assert "unrecognised date/time" in problems[2]
    assert "whole number of 0 or more" in problems[3]
    assert "scanned-in count cannot exceed quantity" in problems[4]
    assert "does not match quantity x tier price" in problems[5]

    missing = run(client, event["id"], "when,what\n2026-01-01,x\n").json()
    assert missing["can_import"] is False
    assert "Missing required column" in missing["errors"][0]


def test_import_is_all_or_nothing(client, setup):
    event, _, _ = setup
    # The second time point lowers Early Bird (150 -> 100): cumulative rule.
    csv_text = (
        "date_time,ticket_type,quantity\n"
        f"{D1} 12:00,Early Bird,150\n"
        f"{D1} 12:00,Brand New Tier,5\n"
        f"{D2} 12:00,Early Bird,100\n"
    )
    extra = {"create_tiers": [{"ticket_type": "Brand New Tier", "price": 500}]}
    preview = run(client, event["id"], csv_text, **extra).json()
    assert preview["can_import"] is False
    assert any("cannot decrease" in e for e in preview["errors"])

    rejected = run(client, event["id"], csv_text, dry_run=False, **extra)
    assert rejected.status_code == 422
    # Neither the valid first snapshot nor the requested tier was written.
    assert snapshots(client, event["id"]) == []
    assert "Brand New Tier" not in [t["name"] for t in client.get(f"/events/{event['id']}/tiers").json()]


def test_import_respects_capacity_quantity_and_existing_snapshots(client, setup):
    event, eb, adv = setup
    over_capacity = run(client, event["id"], f"date_time,ticket_type,quantity\n{D1} 12:00,Advance,1001\n").json()
    assert any("capacity" in e for e in over_capacity["errors"])
    over_quantity = run(client, event["id"], f"date_time,ticket_type,quantity\n{D1} 12:00,Early Bird,201\n").json()
    assert any("200 available" in e for e in over_quantity["errors"])

    # An existing later snapshot with fewer Advance sales blocks a higher import.
    client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": f"{D2}T12:00:00+03:00",
        "tier_sales": [{"tier_id": adv["id"], "tickets_sold": 40}],
    })
    conflict = run(client, event["id"], f"date_time,ticket_type,quantity\n{D1} 12:00,Advance,90\n").json()
    assert conflict["can_import"] is False
    assert any("next snapshot" in e for e in conflict["errors"])


def test_import_404(client):
    assert client.post("/events/999/sales-import", json={"csv_text": "a,b\n"}).status_code == 404


@pytest.mark.parametrize("ticket_type,access,phase,audience,partner", [
    ("Early Bird", "general", "early_bird", "public", None),
    ("Advance GA", "general", "advance", "public", None),
    ("VVIP Lounge", "vvip", "premium", "public", None),
    ("VIP Early", "vip", "early_bird", "public", None),
    ("Gate / Door", "general", "gate", "public", None),
    ("Last Minute", "general", "last_minute", "public", None),
    ("Group of 5", "group", "standard", "group", None),
    ("Equity Bank Card Holders", "general", "standard", "partner", "Equity Bank"),
    ("Partner ticket", "general", "standard", "partner", None),
    ("Guest list", "general", "standard", "complimentary", None),
])
def test_keyword_suggestions(ticket_type, access, phase, audience, partner):
    s = suggest_tags(ticket_type)
    assert (s["suggested_access_level"], s["suggested_sale_phase"], s["suggested_audience"],
            s["suggested_partner_name"]) == (access, phase, audience, partner)


def test_rows_without_scans_keep_previous_check_ins(client, setup):
    event, eb, adv = setup
    response = client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": f"{D1}T12:00:00+03:00",
        "tier_sales": [{"tier_id": eb["id"], "tickets_sold": 50, "checked_in": 10},
                       {"tier_id": adv["id"], "tickets_sold": 20, "checked_in": 5}],
    })
    assert response.status_code == 201, response.text
    # Advance has no scanned_in column and Early Bird is not listed at all.
    data = run(client, event["id"], f"date_time,ticket_type,quantity\n{D2} 12:00,Advance,30\n").json()
    assert data["can_import"] is True, data["errors"]
    assert data["snapshots"][0]["attendance_checked_in"] == 15
    assert data["snapshots"][0]["tickets_sold_total"] == 80
