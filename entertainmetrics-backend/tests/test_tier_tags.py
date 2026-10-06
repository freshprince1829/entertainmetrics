from datetime import date

from sqlalchemy import create_engine, inspect, text

from app.database import Base, ensure_added_columns
from tests.conftest import add_tier, at, make_event


# ---------- startup column helper ----------

OLD_SCHEMA = (
    "CREATE TABLE ticket_tiers (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL, "
    "name VARCHAR NOT NULL, price FLOAT NOT NULL, quantity_available INTEGER, "
    "sale_phase VARCHAR NOT NULL, is_premium BOOLEAN NOT NULL, sort_order INTEGER NOT NULL, "
    "created_at DATETIME)",
    "CREATE TABLE snapshot_tier_sales (id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL, "
    "tier_id INTEGER NOT NULL, tickets_sold INTEGER NOT NULL)",
    "INSERT INTO ticket_tiers (id, event_id, name, price, sale_phase, is_premium, sort_order) "
    "VALUES (1, 1, 'Advance', 2000, 'advance', 0, 0), (2, 1, 'VIP', 9000, 'premium', 1, 1)",
)


def columns(engine, table):
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_helper_adds_missing_columns_once_and_backfills(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/old.db")
    with engine.begin() as conn:
        for statement in OLD_SCHEMA:
            conn.execute(text(statement))

    added = ensure_added_columns(engine)
    assert sorted(added) == [
        "snapshot_tier_sales.checked_in",
        "ticket_tiers.access_level",
        "ticket_tiers.audience",
        "ticket_tiers.partner_name",
    ]
    assert {"access_level", "audience", "partner_name"} <= columns(engine, "ticket_tiers")
    assert "checked_in" in columns(engine, "snapshot_tier_sales")
    with engine.connect() as conn:
        rows = conn.execute(text(
            "SELECT name, access_level, audience, partner_name FROM ticket_tiers ORDER BY id"
        )).all()
    # Existing rows default to public; the old premium tier becomes "premium".
    assert rows == [("Advance", "general", "public", None), ("VIP", "premium", "public", None)]

    # Running again (every startup) changes nothing and does not fail.
    assert ensure_added_columns(engine) == []
    assert ensure_added_columns(engine) == []
    engine.dispose()


def test_helper_is_a_no_op_on_a_fresh_schema(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/fresh.db")
    Base.metadata.create_all(bind=engine)
    assert ensure_added_columns(engine) == []
    engine.dispose()


def test_helper_skips_tables_that_do_not_exist_yet(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/empty.db")
    assert ensure_added_columns(engine) == []
    engine.dispose()


# ---------- audience, partner name, access level ----------

def test_audience_and_partner_name_on_create_update_and_response(client):
    event = make_event(client)
    public = add_tier(client, event["id"], "Advance", 2000)
    assert (public["audience"], public["partner_name"], public["access_level"]) == (
        "public", None, "general")

    partner = add_tier(client, event["id"], "Bank Card Offer", 1500, audience="partner",
                       partner_name="  Equity Bank ")
    assert partner["audience"] == "partner"
    assert partner["partner_name"] == "Equity Bank"

    updated = client.patch(f"/events/{event['id']}/tiers/{partner['id']}",
                           json={"partner_name": "KCB"}).json()
    assert updated["partner_name"] == "KCB"

    # Partner name only applies to partner tiers.
    group = client.patch(f"/events/{event['id']}/tiers/{partner['id']}",
                         json={"audience": "group"}).json()
    assert group["audience"] == "group"
    assert group["partner_name"] is None

    assert client.post(f"/events/{event['id']}/tiers",
                       json={"name": "X", "price": 1, "audience": "vip"}).status_code == 422

    listed = client.get(f"/events/{event['id']}/tiers").json()
    assert {t["name"]: t["audience"] for t in listed} == {"Advance": "public", "Bank Card Offer": "group"}


def test_access_level_drives_premium(client):
    event = make_event(client)
    vip = add_tier(client, event["id"], "VIP", 10000, sale_phase="premium", access_level="vip")
    all_access = add_tier(client, event["id"], "All Access", 30000, access_level="all_access")
    group = add_tier(client, event["id"], "Squad of 5", 8000, access_level="group", audience="group")
    assert vip["is_premium"] and all_access["is_premium"]
    assert group["is_premium"] is False
    demoted = client.patch(f"/events/{event['id']}/tiers/{all_access['id']}",
                           json={"access_level": "general"}).json()
    assert demoted["is_premium"] is False


def test_price_multiplier_and_band(client):
    event = make_event(client, ticket_price=2000)
    add_tier(client, event["id"], "Advance", 2000, sale_phase="advance")
    tiers = {
        "free": add_tier(client, event["id"], "Guest list", 0, audience="complimentary"),
        "eb": add_tier(client, event["id"], "Early Bird", 1500, sale_phase="early_bird"),
        "gate": add_tier(client, event["id"], "Gate", 2500, sale_phase="gate"),
        "vip": add_tier(client, event["id"], "VIP", 6000, sale_phase="premium", access_level="vip"),
        "vvip": add_tier(client, event["id"], "VVIP", 20000, sale_phase="premium", access_level="vvip"),
    }
    listed = {t["name"]: t for t in client.get(f"/events/{event['id']}/tiers").json()}
    assert listed["Advance"]["price_multiplier"] == 1.0
    assert listed["Early Bird"]["price_multiplier"] == 0.75
    expected_bands = {"Guest list": "free", "Early Bird": "discount", "Advance": "standard",
                      "Gate": "standard", "VIP": "premium", "VVIP": "luxury"}
    assert {name: listed[name]["price_band"] for name in expected_bands} == expected_bands
    assert tiers["vvip"]["price_multiplier"] == 10.0


def test_partner_tiers_never_set_the_base_price(client):
    event = make_event(client, ticket_price=2000)
    add_tier(client, event["id"], "Standard", 2000)
    add_tier(client, event["id"], "Bank Card Offer", 1200, audience="partner", partner_name="KCB")
    assert client.get(f"/events/{event['id']}/price-range").json()["base_price"] == 2000


def test_duplicate_tag_warning_does_not_block(client):
    event = make_event(client)
    first = add_tier(client, event["id"], "Advance A", 2000, sale_phase="advance")
    assert first["warnings"] == []
    twin = add_tier(client, event["id"], "Advance B", 2000, sale_phase="advance")
    assert len(twin["warnings"]) == 1
    assert "Advance A" in twin["warnings"][0]
    different = add_tier(client, event["id"], "Advance C", 2100, sale_phase="advance")
    assert different["warnings"] == []
    # Editing into a duplicate also warns.
    edited = client.patch(f"/events/{event['id']}/tiers/{different['id']}", json={"price": 2000})
    assert edited.status_code == 200
    assert edited.json()["warnings"]


def test_price_locked_once_tier_has_sales(client):
    event = make_event(client, capacity=1000)
    tier = add_tier(client, event["id"], "Advance", 2000)
    assert client.patch(f"/events/{event['id']}/tiers/{tier['id']}",
                        json={"price": 2200}).status_code == 200      # no sales yet
    client.post(f"/events/{event['id']}/sales-snapshots", json={
        "recorded_at": at(date.today()), "tier_sales": [{"tier_id": tier["id"], "tickets_sold": 5}],
    })
    listed = client.get(f"/events/{event['id']}/tiers").json()[0]
    assert listed["sales_snapshot_count"] == 1

    locked = client.patch(f"/events/{event['id']}/tiers/{tier['id']}", json={"price": 2500})
    assert locked.status_code == 409
    assert "cannot change" in locked.json()["detail"]
    # Same price and other fields are still editable.
    assert client.patch(f"/events/{event['id']}/tiers/{tier['id']}",
                        json={"price": 2200, "name": "Advance (Phase 2)"}).status_code == 200
