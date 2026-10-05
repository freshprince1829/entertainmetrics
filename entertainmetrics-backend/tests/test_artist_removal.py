from tests.conftest import make_event


def make_artist(client, name, **scores):
    response = client.post("/artists", json={"artist_name": name, **scores})
    assert response.status_code == 200, response.text
    return response.json()


def link(client, event_id, artist_id, order):
    response = client.post("/event-artists", json={
        "event_id": event_id, "artist_id": artist_id, "performance_order": order,
    })
    assert response.status_code == 200, response.text
    return response.json()


def lineup_artist_ids(client, event_id):
    return [entry["artist_id"] for entry in client.get(f"/events/{event_id}/lineup").json()]


def test_remove_artist_from_one_lineup_keeps_artist(client):
    event = make_event(client)
    other_event = make_event(client, event_name="Other")
    artist = make_artist(client, "Pulled Out")
    keeper = make_artist(client, "Stays On")
    slot = link(client, event["id"], artist["id"], 1)
    link(client, event["id"], keeper["id"], 2)
    link(client, other_event["id"], artist["id"], 1)

    assert client.delete(f"/event-artists/{slot['id']}").status_code == 204

    assert lineup_artist_ids(client, event["id"]) == [keeper["id"]]
    # Still booked elsewhere and still in the roster.
    assert lineup_artist_ids(client, other_event["id"]) == [artist["id"]]
    assert artist["id"] in [a["id"] for a in client.get("/artists").json()]


def test_remove_unknown_lineup_entry_returns_404(client):
    assert client.delete("/event-artists/999").status_code == 404


def test_delete_artist_removes_them_from_every_lineup(client):
    event_a = make_event(client, event_name="A")
    event_b = make_event(client, event_name="B")
    mistake = make_artist(client, "Typo Artist")
    keeper = make_artist(client, "Real Artist")
    link(client, event_a["id"], mistake["id"], 1)
    link(client, event_b["id"], mistake["id"], 1)
    link(client, event_a["id"], keeper["id"], 2)

    response = client.delete(f"/artists/{mistake['id']}")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "deleted_artist_id": mistake["id"],
        "artist_name": "Typo Artist",
        "lineup_entries_removed": 2,
    }

    assert [a["id"] for a in client.get("/artists").json()] == [keeper["id"]]
    assert lineup_artist_ids(client, event_a["id"]) == [keeper["id"]]
    assert lineup_artist_ids(client, event_b["id"]) == []
    # The name is free to be re-used, e.g. after fixing a typo.
    make_artist(client, "Typo Artist")


def test_delete_unknown_artist_returns_404(client):
    assert client.delete("/artists/999").status_code == 404


def test_saved_predictions_are_kept_and_new_ones_reflect_the_lineup(client):
    event = make_event(client, capacity=5000, ticket_price=1000, marketing_spend=50000)
    artist = make_artist(client, "Headliner", engagement_score=10,
                         headline_score=10, market_strength_score=10)
    link(client, event["id"], artist["id"], 1)
    request = {"event_id": event["id"], "ticket_price": 1000,
               "marketing_spend": 50000, "capacity": 5000}
    with_artist = client.post("/predict", json=request).json()

    client.delete(f"/artists/{artist['id']}")

    saved = client.get("/predictions").json()
    assert [p["id"] for p in saved] == [with_artist["id"]]
    without_artist = client.post("/predict", json=request).json()
    # 30 strength * 10 = 300 fewer attendees once the artist is gone.
    assert with_artist["predicted_attendance"] - without_artist["predicted_attendance"] == 300
