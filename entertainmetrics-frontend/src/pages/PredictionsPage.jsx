import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiPost, useApiData } from "../api";
import {
  ConfidenceRing,
  EmptyState,
  Field,
  Icon,
  LoadingPanel,
  Notice,
  PageHeader,
  ProgressBar,
} from "../components/ui";
import {
  confidencePillClass,
  formatDateTime,
  formatKes,
  formatNumber,
} from "../format";

const INPUT_FIELDS = [
  { key: "ticket_price", label: "Ticket price (KES)", min: "0" },
  { key: "marketing_spend", label: "Marketing spend (KES)", min: "0" },
  { key: "capacity", label: "Capacity", min: "1" },
];

function ForecastResult({ prediction, event, capacity, fresh }) {
  const utilisation = capacity > 0 ? prediction.predicted_attendance / capacity : 0;

  return (
    <div className="panel result-panel">
      <div className="panel-head">
        <div>
          <h2>{fresh ? "Forecast result" : "Latest saved forecast"}</h2>
          <p className="panel-subtext">
            {event?.event_name ?? `Event #${prediction.event_id}`} ·{" "}
            {formatDateTime(prediction.created_at)}
          </p>
        </div>
        <span className="pill pill-low">{prediction.model_version || "rule-based"}</span>
      </div>

      <div className="result-metrics">
        <div>
          <h3>Predicted attendance</h3>
          <p className="metric">{formatNumber(prediction.predicted_attendance)}</p>
          <ProgressBar value={prediction.predicted_attendance} max={capacity} color="#F0A860" />
          <p className="metric-note">
            {Math.round(utilisation * 100)}% of {formatNumber(capacity)} capacity
          </p>
        </div>
        <div>
          <h3>Predicted revenue</h3>
          <p className="metric">{formatKes(prediction.predicted_revenue)}</p>
          <p className="metric-note">attendance × ticket price</p>
        </div>
        <div className="ring-row compact">
          <ConfidenceRing score={prediction.confidence_score} size={76} />
          <div>
            <h3>Confidence</h3>
            <p className="metric-note">Heuristic score, not a statistical probability</p>
          </div>
        </div>
      </div>

      {prediction.insight_summary && (
        <div className="insight">
          <Icon name="spark" size={16} />
          <p>{prediction.insight_summary}</p>
        </div>
      )}

      <div className="drawer-actions">
        <Link to={`/recommendations?event=${prediction.event_id}`} className="ghost-button">
          See recommendations for this event <Icon name="arrow" size={16} />
        </Link>
      </div>
    </div>
  );
}

function PredictionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventsQuery = useApiData("/events");
  const predictionsQuery = useApiData("/predictions");

  const selectedEventId = searchParams.get("event") ?? "";
  // Values the user typed; anything not overridden falls back to the
  // selected event's stored values.
  const [overrides, setOverrides] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [freshResult, setFreshResult] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("");

  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const predictions = useMemo(
    () =>
      [...(predictionsQuery.data ?? [])].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      ),
    [predictionsQuery.data],
  );

  const eventById = useMemo(() => {
    const map = {};
    events.forEach((event) => {
      map[event.id] = event;
    });
    return map;
  }, [events]);

  const selectedEvent = eventById[selectedEventId];

  function valueFor(key) {
    if (overrides[key] !== undefined) return overrides[key];
    return selectedEvent ? String(selectedEvent[key]) : "";
  }

  const isWhatIf =
    selectedEvent &&
    INPUT_FIELDS.some(
      ({ key }) => overrides[key] !== undefined && Number(overrides[key]) !== Number(selectedEvent[key]),
    );

  function selectEvent(id) {
    setOverrides({});
    setError("");
    setFreshResult(null);
    setSearchParams(id ? { event: id } : {}, { replace: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const payload = {
      event_id: Number(selectedEventId),
      ticket_price: Number(valueFor("ticket_price")),
      marketing_spend: Number(valueFor("marketing_spend")),
      capacity: Number(valueFor("capacity")),
    };

    try {
      const created = await apiPost("/predict", payload);
      setFreshResult({ prediction: created, capacity: payload.capacity });
      predictionsQuery.reload();
    } catch (err) {
      setError(err.message || "Failed to generate prediction");
    } finally {
      setSubmitting(false);
    }
  }

  const latestForSelected = predictions.find(
    (prediction) => String(prediction.event_id) === String(selectedEventId),
  );
  const shownResult = freshResult
    ? freshResult
    : latestForSelected && selectedEvent
      ? { prediction: latestForSelected, capacity: selectedEvent.capacity }
      : null;

  const history = historyFilter
    ? predictions.filter((p) => String(p.event_id) === historyFilter)
    : predictions;

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Predictions"
        description="Forecast attendance and revenue with the rule-based, explainable prediction engine."
      />

      <section className="hero-grid">
        <div className="panel">
          <h2>Run a forecast</h2>
          <p className="panel-subtext" style={{ marginTop: 0 }}>
            Pick an event to load its stored values. Change any value to test a
            what-if scenario.
          </p>

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <Field label="Event" wide>
                <select value={selectedEventId} onChange={(e) => selectEvent(e.target.value)} required>
                  <option value="">
                    {eventsQuery.loading ? "Loading events…" : events.length === 0 ? "No events available" : "Select an event"}
                  </option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.event_name}
                    </option>
                  ))}
                </select>
              </Field>
              {INPUT_FIELDS.map(({ key, label, min }) => (
                <Field
                  key={key}
                  label={label}
                  hint={
                    selectedEvent && overrides[key] !== undefined && Number(overrides[key]) !== Number(selectedEvent[key])
                      ? `Stored value: ${formatNumber(selectedEvent[key])}`
                      : undefined
                  }
                >
                  <input
                    type="number"
                    min={min}
                    step="any"
                    value={valueFor(key)}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                    disabled={!selectedEvent}
                    required
                  />
                </Field>
              ))}
            </div>

            <Notice tone="error">{error}</Notice>

            <div className="modal-actions">
              {isWhatIf && (
                <button type="button" className="ghost-button" onClick={() => setOverrides({})}>
                  Reset to stored values
                </button>
              )}
              <button type="submit" className="primary-button" disabled={submitting || !selectedEvent}>
                {submitting ? "Running…" : isWhatIf ? "Run what-if forecast" : "Run forecast"}
              </button>
            </div>
          </form>
          <p className="table-foot">
            Each run is saved to the prediction history. Predicted attendance is
            always capped at capacity.
          </p>
        </div>

        {shownResult ? (
          <ForecastResult
            prediction={shownResult.prediction}
            capacity={shownResult.capacity}
            event={eventById[shownResult.prediction.event_id]}
            fresh={Boolean(freshResult)}
          />
        ) : (
          <div className="panel">
            <EmptyState title={selectedEvent ? "No forecast for this event yet" : "No event selected"}>
              {selectedEvent
                ? "Run a forecast to see predicted attendance, revenue and confidence."
                : "Select an event to see its latest forecast or run a new one."}
            </EmptyState>
          </div>
        )}
      </section>

      {predictionsQuery.loading ? (
        <LoadingPanel />
      ) : predictionsQuery.error ? (
        <Notice tone="error">{predictionsQuery.error.message}</Notice>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Prediction history</h2>
              <p className="panel-subtext">
                {history.length} of {predictions.length} forecasts
              </p>
            </div>
            <select value={historyFilter} onChange={(e) => setHistoryFilter(e.target.value)} aria-label="Filter history by event">
              <option value="">All events</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.event_name}
                </option>
              ))}
            </select>
          </div>

          {history.length === 0 ? (
            <EmptyState title="No predictions yet">Run a forecast above to get started.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>Event</th>
                    <th>Attendance</th>
                    <th>Revenue</th>
                    <th>Confidence</th>
                    <th>Insight</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((prediction) => (
                    <tr key={prediction.id ?? `${prediction.event_id}-${prediction.created_at}`}>
                      <td className="nowrap">{formatDateTime(prediction.created_at)}</td>
                      <td>
                        <div className="event-title">
                          {eventById[prediction.event_id]?.event_name ?? `Event #${prediction.event_id}`}
                        </div>
                        <div className="event-sub">{prediction.model_version || "-"}</div>
                      </td>
                      <td>{formatNumber(prediction.predicted_attendance)}</td>
                      <td className="nowrap">{formatKes(prediction.predicted_revenue)}</td>
                      <td>
                        <span className={confidencePillClass(prediction.confidence_score)}>
                          {prediction.confidence_score.toFixed(2)}
                        </span>
                      </td>
                      <td className="insight-cell">{prediction.insight_summary || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export default PredictionsPage;
