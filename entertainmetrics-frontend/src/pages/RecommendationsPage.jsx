import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApiData } from "../api";
import {
  EmptyState,
  Field,
  Icon,
  LoadingPanel,
  Notice,
  PageHeader,
  StatCard,
} from "../components/ui";
import {
  formatCompact,
  formatDate,
  formatKes,
  formatNumber,
  thumbGradient,
} from "../format";

const AMBER = "#F0A860";
const TEAL = "#4FD1C5";

function PricingPanel({ eventId, event }) {
  const { data: pricing, error, loading } = useApiData(`/events/${eventId}/recommend/pricing`);

  if (loading) return <LoadingPanel rows={3} />;
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (!pricing) return null;

  const priceDelta = event ? pricing.recommended_ticket_price - event.ticket_price : null;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Ticket price recommendation</h2>
          <p className="panel-subtext">
            Projected revenue across {pricing.candidates.length} candidate prices
          </p>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: AMBER }} /> Revenue
          </span>
          <span>
            <i style={{ background: AMBER, width: 2, height: 12 }} /> Recommended
          </span>
          <span>
            <i style={{ background: TEAL, width: 2, height: 12 }} /> Current price
          </span>
        </div>
      </div>

      <div className="summary-grid">
        <StatCard
          label="Recommended price"
          value={formatKes(pricing.recommended_ticket_price)}
          note={
            priceDelta == null
              ? undefined
              : priceDelta === 0
                ? "same as current price"
                : `${priceDelta > 0 ? "+" : "−"}${formatKes(Math.abs(priceDelta))} vs current`
          }
          accent={AMBER}
        />
        <StatCard label="Projected attendance" value={formatNumber(pricing.predicted_attendance)} accent={TEAL} />
        <StatCard label="Projected revenue" value={formatKes(pricing.predicted_revenue)} accent="#5FD9B4" />
        <StatCard
          label="Confidence"
          value={pricing.confidence_score.toFixed(2)}
          note="heuristic, not a probability"
          accent="#9B8CF2"
        />
      </div>

      <div className="chart-box">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={pricing.candidates} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AMBER} stopOpacity={0.35} />
                <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="ticket_price"
              type="number"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => formatCompact(v)}
            />
            <YAxis tickFormatter={(v) => formatCompact(v)} width={56} />
            <Tooltip
              labelFormatter={(v) => `Ticket price ${formatKes(v)}`}
              formatter={(value, name) =>
                name === "predicted_revenue"
                  ? [formatKes(value), "Revenue"]
                  : [formatNumber(value), "Attendance"]
              }
            />
            {event && (
              <ReferenceLine x={event.ticket_price} stroke={TEAL} strokeDasharray="4 4" />
            )}
            <ReferenceLine x={pricing.recommended_ticket_price} stroke={AMBER} strokeWidth={2} />
            <Area
              type="monotone"
              dataKey="predicted_revenue"
              stroke={AMBER}
              strokeWidth={2}
              fill="url(#revenueFill)"
            />
            <Area type="monotone" dataKey="predicted_attendance" stroke="none" fill="none" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="insight">
        <Icon name="spark" size={16} />
        <p>{pricing.insight_summary}</p>
      </div>
    </section>
  );
}

function ArtistRecommendations({ eventId }) {
  const { data, error, loading } = useApiData(`/events/${eventId}/recommend/artists`);

  if (loading) return <LoadingPanel rows={3} />;
  if (error) return <Notice tone="error">{error.message}</Notice>;

  const recs = data ?? [];
  const maxUplift = Math.max(1, ...recs.map((rec) => rec.projected_revenue_uplift));

  return (
    <section className="panel">
      <h2>Artists to add to the lineup</h2>
      <p className="panel-subtext">
        Ranked by projected revenue uplift if the artist joins this event
      </p>

      {recs.length === 0 ? (
        <EmptyState title="No candidates">
          Every artist on the roster is already linked to this event.
        </EmptyState>
      ) : (
        <ol className="rec-list">
          {recs.map((rec, index) => (
            <li key={rec.artist_id} className="rec-item">
              <span className="rec-rank">{index + 1}</span>
              <div className="event-thumb" style={{ background: thumbGradient(rec.artist_id) }}>
                {rec.artist_name.charAt(0).toUpperCase()}
              </div>
              <div className="rec-main">
                <div className="rec-title">
                  <span className="event-title">{rec.artist_name}</span>
                  {rec.genre && <span className="event-sub">{rec.genre}</span>}
                </div>
                <p className="rec-reason">{rec.reason}</p>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(0, (rec.projected_revenue_uplift / maxUplift) * 100)}%`,
                      background: AMBER,
                    }}
                  />
                </div>
              </div>
              <div className="rec-numbers">
                {rec.projected_revenue_uplift > 0 ? (
                  <>
                    <strong className="positive">+{formatKes(rec.projected_revenue_uplift)}</strong>
                    <span>+{formatNumber(rec.projected_attendance_uplift)} attendees</span>
                  </>
                ) : (
                  <>
                    <strong className="muted">No uplift</strong>
                    <span>event at capacity</span>
                  </>
                )}
                <span>score {rec.recommendation_score.toFixed(2)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function RecommendationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const eventsQuery = useApiData("/events");
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  const selectedEventId = searchParams.get("event") ?? "";
  const selectedEvent = events.find((event) => String(event.id) === selectedEventId);

  return (
    <>
      <PageHeader
        eyebrow="Decision support"
        title="Recommendations"
        description="Explainable suggestions built on the same rule-based engine as predictions. Estimates, not guarantees."
      />

      <section className="panel">
        <div className="event-picker">
          <Field label="Event">
            <select
              value={selectedEventId}
              onChange={(e) =>
                setSearchParams(e.target.value ? { event: e.target.value } : {}, { replace: true })
              }
            >
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

          {selectedEvent && (
            <div className="event-facts">
              <div>
                <span>Date</span>
                <strong>{formatDate(selectedEvent.event_date)}</strong>
              </div>
              <div>
                <span>Venue</span>
                <strong>
                  {selectedEvent.venue}, {selectedEvent.city}
                </strong>
              </div>
              <div>
                <span>Current price</span>
                <strong>{formatKes(selectedEvent.ticket_price)}</strong>
              </div>
              <div>
                <span>Capacity</span>
                <strong>{formatNumber(selectedEvent.capacity)}</strong>
              </div>
              <Link to={`/predictions?event=${selectedEvent.id}`} className="ghost-button">
                <Icon name="chart" size={16} /> Forecast
              </Link>
            </div>
          )}
        </div>
      </section>

      {eventsQuery.error && <Notice tone="error">{eventsQuery.error.message}</Notice>}

      {!selectedEventId ? (
        <div className="panel">
          <EmptyState title="Select an event">
            Choose an event to see the revenue-maximising ticket price and the
            artists most likely to lift attendance.
          </EmptyState>
        </div>
      ) : (
        <div className="page-stack">
          <PricingPanel key={`p-${selectedEventId}`} eventId={selectedEventId} event={selectedEvent} />
          <ArtistRecommendations key={`a-${selectedEventId}`} eventId={selectedEventId} />
        </div>
      )}
    </>
  );
}

export default RecommendationsPage;
