import { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

const initialForm = {
  event_name: "",
  event_type: "",
  event_date: "",
  venue: "",
  city: "",
  ticket_price: "",
  marketing_spend: "",
  capacity: "",
  actual_attendance: "",
  revenue: "",
};

const initialLineupForm = {
  artist_id: "",
  role: "",
  performance_order: "",
  is_headliner: false,
  set_duration_minutes: "",
};

function EventsPage() {
  const [events, setEvents] = useState([]);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const [artists, setArtists] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [lineup, setLineup] = useState([]);
  const [lineupLoading, setLineupLoading] = useState(false);
  const [lineupFormData, setLineupFormData] = useState(initialLineupForm);
  const [lineupSubmitting, setLineupSubmitting] = useState(false);
  const [lineupMessage, setLineupMessage] = useState("");

  async function loadEvents() {
    try {
      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json();
      setEvents(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadArtists() {
    try {
      const res = await fetch(`${API_BASE}/artists`);
      const data = await res.json();
      setArtists(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadLineup(eventId) {
    setLineupLoading(true);
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}/lineup`);
      const data = await res.json();
      setLineup(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLineupLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
    loadArtists();
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setLineup([]);
      return;
    }
    loadLineup(selectedEventId);
  }, [selectedEventId]);

  function getArtistName(artistId) {
    const artist = artists.find((a) => a.id === artistId);
    return artist ? artist.artist_name : `Artist #${artistId}`;
  }

  function handleLineupChange(event) {
    const { name, value, type, checked } = event.target;
    setLineupFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleLineupSubmit(event) {
    event.preventDefault();
    setLineupSubmitting(true);
    setLineupMessage("");

    const payload = {
      event_id: Number(selectedEventId),
      artist_id: Number(lineupFormData.artist_id),
      role: lineupFormData.role || null,
      performance_order: lineupFormData.performance_order
        ? Number(lineupFormData.performance_order)
        : null,
      is_headliner: lineupFormData.is_headliner,
      set_duration_minutes: lineupFormData.set_duration_minutes
        ? Number(lineupFormData.set_duration_minutes)
        : null,
    };

    try {
      const res = await fetch(`${API_BASE}/event-artists`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setLineupMessage(data.detail || "Failed to add artist to lineup");
        return;
      }

      setLineupMessage("Artist added to lineup successfully");
      setLineupFormData(initialLineupForm);
      loadLineup(selectedEventId);
    } catch (err) {
      console.error(err);
      setLineupMessage("Something went wrong while updating the lineup");
    } finally {
      setLineupSubmitting(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");

    const payload = {
      event_name: formData.event_name,
      event_type: formData.event_type,
      event_date: formData.event_date,
      venue: formData.venue,
      city: formData.city,
      ticket_price: Number(formData.ticket_price),
      marketing_spend: Number(formData.marketing_spend),
      capacity: Number(formData.capacity),
      actual_attendance: formData.actual_attendance
        ? Number(formData.actual_attendance)
        : null,
      revenue: formData.revenue ? Number(formData.revenue) : null,
    };

    try {
      const res = await fetch(`${API_BASE}/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || "Failed to create event");
        return;
      }

      setMessage("Event created successfully");
      setFormData(initialForm);
      loadEvents();
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong while creating the event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="panel">
        <h1>Events</h1>
        <p className="panel-subtext">
          Create and manage entertainment events for analytics and forecasting.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          <input
            name="event_name"
            placeholder="Event Name"
            value={formData.event_name}
            onChange={handleChange}
            required
          />
          <input
            name="event_type"
            placeholder="Event Type"
            value={formData.event_type}
            onChange={handleChange}
            required
          />
          <input
            name="event_date"
            type="date"
            value={formData.event_date}
            onChange={handleChange}
            required
          />
          <input
            name="venue"
            placeholder="Venue"
            value={formData.venue}
            onChange={handleChange}
            required
          />
          <input
            name="city"
            placeholder="City"
            value={formData.city}
            onChange={handleChange}
            required
          />
          <input
            name="ticket_price"
            placeholder="Ticket Price"
            value={formData.ticket_price}
            onChange={handleChange}
            type="number"
            required
          />
          <input
            name="marketing_spend"
            placeholder="Marketing Spend"
            value={formData.marketing_spend}
            onChange={handleChange}
            type="number"
            required
          />
          <input
            name="capacity"
            placeholder="Capacity"
            value={formData.capacity}
            onChange={handleChange}
            type="number"
            required
          />
          <input
            name="actual_attendance"
            placeholder="Actual Attendance"
            value={formData.actual_attendance}
            onChange={handleChange}
            type="number"
          />
          <input
            name="revenue"
            placeholder="Revenue"
            value={formData.revenue}
            onChange={handleChange}
            type="number"
          />

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Creating..." : "Create Event"}
          </button>
        </form>

        {message && <p className="form-message">{message}</p>}
      </div>

      <div className="panel">
        <h2>Event Records</h2>
        {events.length === 0 ? (
          <p>No events found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Date</th>
                  <th>City</th>
                  <th>Venue</th>
                  <th>Ticket Price</th>
                  <th>Capacity</th>
                  <th>Attendance</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{event.event_name}</td>
                    <td>{event.event_type}</td>
                    <td>{event.event_date}</td>
                    <td>{event.city}</td>
                    <td>{event.venue}</td>
                    <td>KES {event.ticket_price}</td>
                    <td>{event.capacity}</td>
                    <td>{event.actual_attendance ?? "-"}</td>
                    <td>{event.revenue ? `KES ${event.revenue}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Event Lineup</h2>
        <p className="panel-subtext">
          Link artists to an event to power artist-aware predictions.
        </p>

        <div className="form-grid">
          <select
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            <option value="">
              {events.length === 0 ? "No events available" : "Select an event"}
            </option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.event_name}
              </option>
            ))}
          </select>
        </div>

        {!selectedEventId ? (
          <p className="form-message">Select an event to view its lineup.</p>
        ) : (
          <>
            <form className="form-grid" onSubmit={handleLineupSubmit}>
              <select
                name="artist_id"
                value={lineupFormData.artist_id}
                onChange={handleLineupChange}
                required
              >
                <option value="">
                  {artists.length === 0 ? "No artists available" : "Select an artist"}
                </option>
                {artists.map((artist) => (
                  <option key={artist.id} value={artist.id}>
                    {artist.artist_name}
                  </option>
                ))}
              </select>
              <input
                name="role"
                placeholder="Role (e.g. Headliner, Support)"
                value={lineupFormData.role}
                onChange={handleLineupChange}
              />
              <input
                name="performance_order"
                placeholder="Performance Order"
                value={lineupFormData.performance_order}
                onChange={handleLineupChange}
                type="number"
              />
              <input
                name="set_duration_minutes"
                placeholder="Set Duration (minutes)"
                value={lineupFormData.set_duration_minutes}
                onChange={handleLineupChange}
                type="number"
              />
              <label>
                <input
                  name="is_headliner"
                  type="checkbox"
                  checked={lineupFormData.is_headliner}
                  onChange={handleLineupChange}
                />
                Headliner
              </label>

              <button
                type="submit"
                className="primary-button"
                disabled={lineupSubmitting || artists.length === 0}
              >
                {lineupSubmitting ? "Adding..." : "Add to Lineup"}
              </button>
            </form>

            {lineupMessage && <p className="form-message">{lineupMessage}</p>}

            {lineupLoading ? (
              <p>Loading lineup...</p>
            ) : lineup.length === 0 ? (
              <p>No artists assigned to this event yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Artist</th>
                      <th>Role</th>
                      <th>Headliner</th>
                      <th>Set Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineup.map((entry) => (
                      <tr key={entry.id}>
                        <td>{entry.performance_order ?? "-"}</td>
                        <td>{getArtistName(entry.artist_id)}</td>
                        <td>{entry.role || "-"}</td>
                        <td>{entry.is_headliner ? "Yes" : "No"}</td>
                        <td>
                          {entry.set_duration_minutes
                            ? `${entry.set_duration_minutes} min`
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default EventsPage;