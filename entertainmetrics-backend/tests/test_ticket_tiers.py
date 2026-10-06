from tests.conftest import add_tier, make_event


def test_tier_crud(client):
    event = make_event(client)
    vip = add_tier(client, event["id"], "VIP", 10000, sale_phase="advance",
                   is_premium=True, quantity_available=100, sort_order=2)
    early = add_tier(client, event["id"], " Early Bird ", 1500, sale_phase="early_bird",
                     quantity_available=300, sort_order=1)
    assert early["name"] == "Early Bird"          # whitespace trimmed
    assert vip["is_premium"] is True
    assert early["is_premium"] is False

    listed = client.get(f"/events/{event['id']}/tiers").json()
    assert [t["name"] for t in listed] == ["Early Bird", "VIP"]   # by sort_order

    patched = client.patch(f"/events/{event['id']}/tiers/{vip['id']}",
                           json={"price": 12000, "quantity_available": 80})
    assert patched.status_code == 200, patched.text
    assert patched.json()["price"] == 12000
    assert patched.json()["quantity_available"] == 80
    assert patched.json()["name"] == "VIP"        # untouched fields kept

    assert client.delete(f"/events/{event['id']}/tiers/{early['id']}").status_code == 204
    assert [t["name"] for t in client.get(f"/events/{event['id']}/tiers").json()] == ["VIP"]


def test_tiers_sorted_by_sort_order_then_price(client):
    event = make_event(client)
    add_tier(client, event["id"], "Gate", 3000, sale_phase="gate")
    add_tier(client, event["id"], "Advance", 2000, sale_phase="advance")
    add_tier(client, event["id"], "Last", 500, sort_order=5)
    names = [t["name"] for t in client.get(f"/events/{event['id']}/tiers").json()]
    assert names == ["Advance", "Gate", "Last"]


def test_duplicate_tier_name_returns_409(client):
    event = make_event(client)
    other = make_event(client, event_name="Other")
    add_tier(client, event["id"], "VIP", 10000)
    duplicate = client.post(f"/events/{event['id']}/tiers", json={"name": "VIP", "price": 1})
    assert duplicate.status_code == 409
    assert "already exists" in duplicate.json()["detail"]

    # The same name is fine on a different event.
    add_tier(client, other["id"], "VIP", 8000)

    standard = add_tier(client, event["id"], "Standard", 2000)
    renamed = client.patch(f"/events/{event['id']}/tiers/{standard['id']}", json={"name": "VIP"})
    assert renamed.status_code == 409


def test_tier_validation_and_404s(client):
    event = make_event(client)
    other = make_event(client, event_name="Other")
    assert client.post(f"/events/{event['id']}/tiers",
                       json={"name": "Bad", "price": -1}).status_code == 422
    assert client.post(f"/events/{event['id']}/tiers",
                       json={"name": "Bad", "price": 1, "sale_phase": "presale"}).status_code == 422
    assert client.post(f"/events/{event['id']}/tiers",
                       json={"name": "   ", "price": 1}).status_code == 422
    assert client.post("/events/999/tiers", json={"name": "X", "price": 1}).status_code == 404

    tier = add_tier(client, other["id"], "Standard", 1000)
    # Tier exists but belongs to another event.
    assert client.patch(f"/events/{event['id']}/tiers/{tier['id']}",
                        json={"price": 5}).status_code == 404
    assert client.delete(f"/events/{event['id']}/tiers/{tier['id']}").status_code == 404
    assert client.patch(f"/events/{other['id']}/tiers/{tier['id']}",
                        json={"price": None}).status_code == 422


def test_price_range_weighted_by_quantity(client):
    event = make_event(client, ticket_price=1800)
    add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird", quantity_available=200)
    add_tier(client, event["id"], "Advance", 2000, sale_phase="advance", quantity_available=600)
    add_tier(client, event["id"], "VIP", 10000, sale_phase="advance", is_premium=True,
             quantity_available=200)

    data = client.get(f"/events/{event['id']}/price-range").json()
    assert data["tier_count"] == 3
    assert data["price_low"] == 1000
    assert data["price_high"] == 10000
    # (1000*200 + 2000*600 + 10000*200) / 1000 = 3400
    assert data["average_price_by_quantity"] == 3400
    assert data["weighting"] == "quantity_available"
    # Base price ignores early bird and premium tiers.
    assert data["base_price"] == 2000
    assert "Advance" in data["base_price_source"]


def test_price_range_simple_mean_when_quantities_unknown(client):
    event = make_event(client, ticket_price=1800)
    add_tier(client, event["id"], "Early Bird", 1000, sale_phase="early_bird", quantity_available=200)
    add_tier(client, event["id"], "Gate", 3000, sale_phase="gate")
    data = client.get(f"/events/{event['id']}/price-range").json()
    assert data["average_price_by_quantity"] == 2000
    assert data["weighting"] == "simple_mean"
    # No standard/advance tier: fall back to the event's ticket price.
    assert data["base_price"] == 1800


def test_price_range_without_tiers(client):
    event = make_event(client, ticket_price=1500)
    data = client.get(f"/events/{event['id']}/price-range").json()
    assert data["tier_count"] == 0
    assert data["price_low"] is None
    assert data["base_price"] == 1500
    assert client.get("/events/999/price-range").status_code == 404


def test_event_responses_include_optional_tier_summary(client):
    plain = make_event(client, event_name="Plain")
    tiered = make_event(client, event_name="Tiered")
    add_tier(client, tiered["id"], "Advance", 2500)
    add_tier(client, tiered["id"], "VVIP", 20000, is_premium=True)

    events = {e["event_name"]: e for e in client.get("/events").json()}
    assert events["Plain"]["tier_count"] == 0
    assert events["Plain"]["price_low"] is None
    assert events["Tiered"]["tier_count"] == 2
    assert (events["Tiered"]["price_low"], events["Tiered"]["price_high"]) == (2500, 20000)

    recent = {e["event_name"]: e for e in client.get("/dashboard/recent-events").json()}
    assert recent["Tiered"]["price_high"] == 20000
    assert plain["ticket_price"] == events["Plain"]["ticket_price"]
