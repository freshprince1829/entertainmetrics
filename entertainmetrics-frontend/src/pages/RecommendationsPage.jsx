import { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

function RecommendationsPage() {
  const [events, setEvents] = useState([]);
  const [selectedEventId, setSelectedEventId] = useState("");

  const [artistRecs, setArtistRecs] = useState([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [artistError, setArtistError] = useState("");

  const [pricingRec, setPricingRec] = useState(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingError, setPricingError] = useState("");

  async function loadEvents() {
    try {
      const res = await fetch(`${API_BASE}/events`);
      const data = await res.json();
      setEvents(data);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadArtistRecommendations(eventId) {
    setArtistLoading(true);
    setArtistError("");
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}/recommend/artists`);
      const data = await res.json();
      if (!res.ok) {
        setArtistError(data.detail || "Failed to load artist recommendations");
        setArtistRecs([]);
        return;
      }
      setArtistRecs(data);
    } catch (err) {
      console.error(err);
      setArtistError("Something went wrong while loading artist recommendations");
    } finally {
      setArtistLoading(false);
    }
  }

  async function loadPricingRecommendation(eventId) {
    setPricingLoading(true);
    setPricingError("");
    try {
      const res = await fetch(`${API_BASE}/events/${eventId}/recommend/pricing`);
      const data = await res.json();
      if (!res.ok) {
        setPricingError(data.detail || "Failed to load pricing recommendation");
        setPricingRec(null);
        return;
      }
      setPricingRec(data);
    } catch (err) {
      console.error(err);
      setPricingError("Something went wrong while loading the pricing recommendation");
    } finally {
      setPricingLoading(false);
    }
  }

  useEffect(() => {
    loadEvents();
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setArtistRecs([]);
      setPricingRec(null);
      return;
    }
    loadArtistRecommendations(selectedEventId);
    loadPricingRecommendation(selectedEventId);
  }, [selectedEventId]);

  return (
    <div className="page-stack">
      <div className="panel">
        <h1>Recommendations</h1>
        <p className="panel-subtext">
          Rule-based, explainable recommendations built on the same prediction
          engine used elsewhere in EntertainMetrics. Estimates, not guarantees.
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
      </div>

      {!selectedEventId ? (
        <div className="panel">
          <p className="form-message">Select an event to see recommendations.</p>
        </div>
      ) : (
        <>
          <div className="panel">
            <h2>Recommended Artists to Add</h2>
            {artistError && <p className="form-message">{artistError}</p>}
            {artistLoading ? (
              <p>Loading artist recommendations...</p>
            ) : artistRecs.length === 0 ? (
              <p>No unlinked artists available to recommend for this event.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Artist</th>
                      <th>Genre</th>
                      <th>Score</th>
                      <th>Attendance Uplift</th>
                      <th>Revenue Uplift</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {artistRecs.map((rec) => (
                      <tr key={rec.artist_id}>
                        <td>{rec.artist_name}</td>
                        <td>{rec.genre || "-"}</td>
                        <td>{rec.recommendation_score.toFixed(2)}</td>
                        <td>{rec.projected_attendance_uplift}</td>
                        <td>KES {rec.projected_revenue_uplift.toFixed(2)}</td>
                        <td>{rec.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Recommended Ticket Price</h2>
            {pricingError && <p className="form-message">{pricingError}</p>}
            {pricingLoading ? (
              <p>Loading pricing recommendation...</p>
            ) : pricingRec ? (
              <>
                <section className="summary-grid">
                  <div className="card">
                    <h3>Recommended Price</h3>
                    <p className="metric">KES {pricingRec.recommended_ticket_price}</p>
                  </div>
                  <div className="card">
                    <h3>Predicted Attendance</h3>
                    <p className="metric">{pricingRec.predicted_attendance}</p>
                  </div>
                  <div className="card">
                    <h3>Predicted Revenue</h3>
                    <p className="metric">
                      KES {pricingRec.predicted_revenue.toFixed(2)}
                    </p>
                  </div>
                  <div className="card">
                    <h3>Confidence</h3>
                    <p className="metric">
                      {Math.round(pricingRec.confidence_score * 100)}%
                    </p>
                  </div>
                </section>

                <p className="panel-subtext">{pricingRec.insight_summary}</p>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Candidate Price</th>
                        <th>Predicted Attendance</th>
                        <th>Predicted Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricingRec.candidates.map((candidate, index) => (
                        <tr
                          key={index}
                          className={
                            candidate.ticket_price ===
                            pricingRec.recommended_ticket_price
                              ? "highlight-row"
                              : undefined
                          }
                        >
                          <td>KES {candidate.ticket_price}</td>
                          <td>{candidate.predicted_attendance}</td>
                          <td>KES {candidate.predicted_revenue.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>No pricing recommendation available.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default RecommendationsPage;
