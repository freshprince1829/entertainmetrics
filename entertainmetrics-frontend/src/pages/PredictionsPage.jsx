import { useEffect, useState } from "react";

const API_BASE = "http://127.0.0.1:8000";

const initialForm = {
  event_id: "",
  ticket_price: "",
  marketing_spend: "",
  capacity: "",
};

function PredictionsPage() {
  const [predictions, setPredictions] = useState([]);
  const [formData, setFormData] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function loadPredictions() {
    try {
      const res = await fetch(`${API_BASE}/predictions`);
      const data = await res.json();
      setPredictions(data);
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    loadPredictions();
  }, []);

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
      event_id: Number(formData.event_id),
      ticket_price: Number(formData.ticket_price),
      marketing_spend: Number(formData.marketing_spend),
      capacity: Number(formData.capacity),
    };

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.detail || "Failed to generate prediction");
        return;
      }

      setMessage("Prediction generated successfully");
      setFormData(initialForm);
      loadPredictions();
    } catch (err) {
      console.error(err);
      setMessage("Something went wrong while generating the prediction");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="panel">
        <h1>Predictions</h1>
        <p className="panel-subtext">
          Run event performance forecasts using EntertainMetrics.
        </p>

        <form className="form-grid" onSubmit={handleSubmit}>
          <input
            name="event_id"
            placeholder="Event ID"
            value={formData.event_id}
            onChange={handleChange}
            type="number"
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

          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? "Generating..." : "Run Prediction"}
          </button>
        </form>

        {message && <p className="form-message">{message}</p>}
      </div>

      <div className="panel">
        <h2>Prediction Records</h2>
        {predictions.length === 0 ? (
          <p>No predictions found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Event ID</th>
                  <th>Attendance</th>
                  <th>Revenue</th>
                  <th>Confidence</th>
                  <th>Model</th>
                  <th>Insight</th>
                </tr>
              </thead>
              <tbody>
                {predictions.map((prediction) => (
                  <tr key={prediction.id}>
                    <td>{prediction.id}</td>
                    <td>{prediction.event_id}</td>
                    <td>{prediction.predicted_attendance}</td>
                    <td>KES {prediction.predicted_revenue}</td>
                    <td>{Math.round(prediction.confidence_score * 100)}%</td>
                    <td>{prediction.model_version || "-"}</td>
                    <td>{prediction.insight_summary || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default PredictionsPage;