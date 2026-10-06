from datetime import date

from tests.conftest import add_tier, at, make_event


def test_copy_tiers_from_another_event(client):
    source = make_event(client, event_name="Last Year")
    target = make_event(client, event_name="This Year")
    add_tier(client, source["id"], "Early Bird", 1000, sale_phase="early_bird", quantity_available=300)
    vip = add_tier(client, source["id"], "VIP", 6000, sale_phase="premium", access_level="vip",
                   quantity_available=100)
    add_tier(client, source["id"], "Bank Card Offer", 1500, audience="partner", partner_name="KCB")
    # The source has sales; the copies must not inherit them.
    client.post(f"/events/{source['id']}/sales-snapshots", json={
        "recorded_at": at(date.today()), "tier_sales": [{"tier_id": vip["id"], "tickets_sold": 10}],
    })
    add_tier(client, target["id"], "vip", 5000)   # existing name, different case

    response = client.post(f"/events/{target['id']}/tiers/copy-from/{source['id']}")
    assert response.status_code == 201, response.text
    created = response.json()
    assert [t["name"] for t in created] == ["Early Bird", "Bank Card Offer"]   # VIP skipped
    partner = created[1]
    assert (partner["audience"], partner["partner_name"], partner["price"]) == ("partner", "KCB", 1500)
    assert created[0]["quantity_available"] == 300
    assert all(t["event_id"] == target["id"] and t["sales_snapshot_count"] == 0 for t in created)

    listed = client.get(f"/events/{target['id']}/tiers").json()
    assert [t["name"] for t in listed] == ["vip", "Early Bird", "Bank Card Offer"]
    # Copied prices stay editable (no sales on the new tiers).
    assert client.patch(f"/events/{target['id']}/tiers/{created[0]['id']}",
                        json={"price": 1200}).status_code == 200
    # Copying again creates nothing new.
    again = client.post(f"/events/{target['id']}/tiers/copy-from/{source['id']}")
    assert again.status_code == 201 and again.json() == []


def test_copy_tiers_404s(client):
    event = make_event(client)
    assert client.post(f"/events/{event['id']}/tiers/copy-from/999").status_code == 404
    assert client.post(f"/events/999/tiers/copy-from/{event['id']}").status_code == 404
