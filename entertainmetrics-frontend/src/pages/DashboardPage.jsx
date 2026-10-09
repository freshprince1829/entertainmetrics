import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useApiData } from "../api";
import { displayName } from "../auth/context";
import { useAuth } from "../auth/useAuth";
import { ReadOnlyNotice } from "../components/ReadOnly";
import { DeltaBadge, PanelButton, TickGauge, TickMeter } from "../components/meters";
import { EventDayPatternsCard, LiveEventCard } from "../components/SalesTracking";
import { RangeValue } from "../components/PredictionRange";
import { TierPatternsCard } from "../components/TierAnalytics";
import { Icon, LoadingPanel, Notice } from "../components/ui";
import {
  canRecordActuals,
  confidencePillClass,
  formatCompact,
  formatDate,
  formatKes,
  formatNumber,
  formatPriceRange,
  isUpcoming,
  thumbGradient,
} from "../format";
import { ACTUAL, FORECAST, GRID, INK_MUTED } from "../theme";

const DAY = 24 * 60 * 60 * 1000;

// Periods filter events by their event date. Windowed periods compare
// against the window of the same length immediately before them.
const PERIODS = [
  { key: "all", label: "All time" },
  { key: "next90", label: "Next 90 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "last90", label: "Last 90 days" },
  { key: "last365", label: "Last 12 months" },
];

// Shades for the marketing-spend segments; every segment is also labelled,
// so the shade is never the only way to tell them apart.
const SEGMENT_SHADES = ["#E8E8EA", "#A1A1A6", "#5E5E64", "#38383D"];

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function parseDate(value) {
  const [y, m, d] = String(value).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function periodWindow(key, today) {
  switch (key) {
    case "next90":
      return { start: today, end: today + 90 * DAY };
    case "last30":
      return { start: today - 30 * DAY, end: today - DAY };
    case "last90":
      return { start: today - 90 * DAY, end: today - DAY };
    case "last365":
      return { start: today - 365 * DAY, end: today - DAY };
    default:
      return null;
  }
}

function inWindow(row, win) {
  return !win || (row.time >= win.start && row.time <= win.end);
}

function pctChange(current, previous) {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}

function rangeText(start, end) {
  const a = new Date(start);
  const b = new Date(end);
  const opts = { day: "numeric", month: "short" };
  return a.getFullYear() === b.getFullYear()
    ? `${a.toLocaleDateString("en-GB", opts)} – ${b.toLocaleDateString("en-GB", opts)} ${b.getFullYear()}`
    : `${a.toLocaleDateString("en-GB", { ...opts, year: "numeric" })} – ${b.toLocaleDateString("en-GB", { ...opts, year: "numeric" })}`;
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function summarize(rows) {
  const forecasted = rows.filter((row) => row.forecastAtt != null);
  const withActuals = forecasted.filter((row) => row.actualAtt != null && row.actualAtt > 0);
  const errors = withActuals.map((row) => ((row.forecastAtt - row.actualAtt) / row.actualAtt) * 100);
  return {
    events: rows.length,
    forecasted: forecasted.length,
    revenue: forecasted.reduce((sum, row) => sum + row.forecastRev, 0),
    attendance: forecasted.reduce((sum, row) => sum + row.forecastAtt, 0),
    capacity: forecasted.reduce((sum, row) => sum + row.capacity, 0),
    marketing: rows.reduce((sum, row) => sum + (row.marketing || 0), 0),
    compared: withActuals.length,
    meanAbsError: errors.length
      ? errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length
      : null,
    meanSignedError: errors.length ? errors.reduce((sum, e) => sum + e, 0) / errors.length : null,
  };
}

function KpiCell({ label, value, delta, inverse, note }) {
  return (
    <div className="kpi-cell">
      <span className="kpi-label">{label}</span>
      <strong className="kpi-value">{value}</strong>
      {delta !== undefined ? <DeltaBadge value={delta} inverse={inverse} /> : null}
      {note && <span className="kpi-note">{note}</span>}
    </div>
  );
}

function TrendTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const fmt = metric === "revenue" ? formatKes : formatNumber;
  const forecast = metric === "revenue" ? row.forecastRev : row.forecastAtt;
  const actual = metric === "revenue" ? row.actualRev : row.actualAtt;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{formatDate(row.date)}</div>
      <div className="chart-tooltip-title">{row.name}</div>
      <div className="chart-tooltip-row">
        <i style={{ background: FORECAST }} /> Forecast <strong>{fmt(forecast)}</strong>
      </div>
      {actual != null && (
        <div className="chart-tooltip-row">
          <i style={{ background: ACTUAL }} /> Actual <strong>{fmt(actual)}</strong>
        </div>
      )}
    </div>
  );
}

function TodayLabel({ viewBox }) {
  if (!viewBox) return null;
  const { x, y } = viewBox;
  return (
    <g transform={`translate(${x}, ${y - 14})`}>
      <rect x={-24} y={0} width={48} height={20} rx={10} fill="#EDEDEF" />
      <text x={0} y={14} textAnchor="middle" fontSize={11} fontWeight={600} fill="#0a0a0b">
        Today
      </text>
    </g>
  );
}

function buildInsights(stats, rows, upcomingStats, unforecasted) {
  const insights = [];
  const top = [...rows]
    .filter((row) => row.forecastRev != null)
    .sort((a, b) => b.forecastRev - a.forecastRev)[0];
  if (top && stats.revenue > 0) {
    insights.push([
      `${top.name} leads this period with `,
      formatKes(top.forecastRev),
      ` in forecast revenue — ${Math.round((top.forecastRev / stats.revenue) * 100)}% of the total.`,
    ]);
  }
  if (stats.meanSignedError != null) {
    const over = stats.meanSignedError >= 0;
    insights.push([
      `Forecasts are running ${over ? "above" : "below"} recorded attendance by `,
      `${Math.abs(stats.meanSignedError).toFixed(1)}%`,
      ` on average across ${stats.compared} completed event${stats.compared === 1 ? "" : "s"}.`,
    ]);
  }
  if (upcomingStats.capacity > 0) {
    insights.push([
      "Upcoming events are forecast to fill ",
      `${Math.round((upcomingStats.attendance / upcomingStats.capacity) * 100)}%`,
      ` of their ${formatNumber(upcomingStats.capacity)} available seats.`,
    ]);
  }
  if (stats.marketing > 0 && stats.revenue > 0) {
    insights.push([
      "Each KES 1 of marketing spend is matched by ",
      `KES ${(stats.revenue / stats.marketing).toFixed(1)}`,
      " of forecast revenue in this period.",
    ]);
  }
  if (unforecasted > 0) {
    insights.push([
      `${unforecasted} event${unforecasted === 1 ? " has" : "s have"} `,
      "no forecast yet",
      ". Run a prediction to include them in these figures.",
    ]);
  }
  return insights;
}

function InsightsCard({ insights }) {
  const [index, setIndex] = useState(0);
  const current = insights.length ? insights[index % insights.length] : null;

  return (
    <div className="dash-card insight-card">
      <div className="dash-card-head">
        <span className="dash-card-title">
          <Icon name="spark" size={15} /> Insights
        </span>
        <span className="tag">Rule-based</span>
      </div>
      {current ? (
        <p className="insight-text">
          {current[0]}
          <strong>{current[1]}</strong>
          {current[2]}
        </p>
      ) : (
        <p className="insight-text">Add events and run forecasts to generate insights.</p>
      )}
      <div className="insight-foot">
        {insights.length > 1 && (
          <div className="pager">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous insight"
              onClick={() => setIndex((i) => (i - 1 + insights.length) % insights.length)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span>
              {(index % insights.length) + 1} / {insights.length}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Next insight"
              onClick={() => setIndex((i) => (i + 1) % insights.length)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        )}
        <Link to="/predictions" className="text-link">
          Open predictions <Icon name="arrow" size={14} />
        </Link>
      </div>
    </div>
  );
}

function MarketingCard({ rows, total }) {
  const segments = useMemo(() => {
    const byType = {};
    rows.forEach((row) => {
      byType[row.type] = (byType[row.type] || 0) + (row.marketing || 0);
    });
    const sorted = Object.entries(byType)
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3);
    const rest = sorted.slice(3).reduce((sum, [, value]) => sum + value, 0);
    if (rest > 0) top.push(["Other", rest]);
    return top.map(([type, value], i) => ({
      type,
      value,
      share: total > 0 ? value / total : 0,
      shade: SEGMENT_SHADES[i],
    }));
  }, [rows, total]);

  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <span className="dash-card-title">Marketing spend</span>
        <Link to="/events" className="text-link">
          Manage events
        </Link>
      </div>
      <strong className="dash-big">{formatKes(total)}</strong>
      {segments.length === 0 ? (
        <p className="kpi-note">No marketing spend recorded in this period.</p>
      ) : (
        <>
          <div className="segment-bar" role="img" aria-label="Marketing spend share by event type">
            {segments.map((segment) => (
              <div
                key={segment.type}
                className="segment"
                style={{ flexGrow: Math.max(segment.share, 0.04) }}
                title={`${segment.type}: ${formatKes(segment.value)}`}
              >
                <span className="segment-pct">{Math.round(segment.share * 100)}%</span>
                <span className="segment-fill" style={{ background: segment.shade }} />
              </div>
            ))}
          </div>
          <div className="segment-legend">
            {segments.map((segment) => (
              <span key={segment.type}>
                <i style={{ background: segment.shade }} />
                {segment.type}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const periodKey = PERIODS.some((p) => p.key === searchParams.get("period"))
    ? searchParams.get("period")
    : "all";
  const [metric, setMetric] = useState("revenue");

  const summaryQuery = useApiData("/dashboard/summary");
  const eventsQuery = useApiData("/dashboard/recent-events?limit=5");
  const recentPredictionsQuery = useApiData("/dashboard/recent-predictions?limit=5");
  const comparisonQuery = useApiData("/dashboard/predicted-vs-actual");
  const allEventsQuery = useApiData("/events");
  const allPredictionsQuery = useApiData("/predictions");
  const artistsQuery = useApiData("/artists");
  const [now] = useState(() => new Date());
  const [today] = useState(startOfToday);

  const summary = summaryQuery.data;
  const comparison = comparisonQuery.data;
  const recentEvents = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const recentPredictions = useMemo(
    () => recentPredictionsQuery.data ?? [],
    [recentPredictionsQuery.data],
  );
  const allEvents = useMemo(() => allEventsQuery.data ?? [], [allEventsQuery.data]);
  const artists = useMemo(() => artistsQuery.data ?? [], [artistsQuery.data]);

  const queries = [
    summaryQuery,
    eventsQuery,
    recentPredictionsQuery,
    comparisonQuery,
    allEventsQuery,
    allPredictionsQuery,
    artistsQuery,
  ];
  const loading = queries.some((q) => q.loading);
  const loadError = queries.find((q) => q.error)?.error;

  // One row per event, joined with its most recent forecast.
  const rows = useMemo(() => {
    const latest = {};
    (allPredictionsQuery.data ?? []).forEach((prediction) => {
      const existing = latest[prediction.event_id];
      if (!existing || prediction.created_at > existing.created_at) {
        latest[prediction.event_id] = prediction;
      }
    });
    return allEvents
      .map((event) => {
        const forecast = latest[event.id];
        return {
          id: event.id,
          name: event.event_name,
          type: event.event_type,
          date: event.event_date,
          time: parseDate(event.event_date),
          venue: event.venue,
          city: event.city,
          capacity: event.capacity,
          ticketPrice: event.ticket_price,
          marketing: event.marketing_spend,
          forecastAtt: forecast?.predicted_attendance ?? null,
          forecastRev: forecast?.predicted_revenue ?? null,
          confidence: forecast?.confidence_score ?? null,
          actualAtt: event.actual_attendance,
          actualRev: event.revenue,
        };
      })
      .sort((a, b) => a.time - b.time);
  }, [allEvents, allPredictionsQuery.data]);

  const win = periodWindow(periodKey, today);
  const prevWin = win ? { start: win.start - (win.end - win.start) - DAY, end: win.start - DAY } : null;
  const periodRows = rows.filter((row) => inWindow(row, win));
  const stats = summarize(periodRows);
  const prev = prevWin ? summarize(rows.filter((row) => inWindow(row, prevWin))) : null;
  const upcomingStats = summarize(rows.filter((row) => row.time >= today));
  const unforecasted = periodRows.length - stats.forecasted;

  const delta = (key) => (prev ? pctChange(stats[key], prev[key]) : undefined);
  const errorDelta =
    prev && stats.meanAbsError != null && prev.meanAbsError
      ? pctChange(stats.meanAbsError, prev.meanAbsError)
      : prev
        ? null
        : undefined;

  const chartRows = periodRows.filter((row) => row.forecastAtt != null);
  const chartKeys =
    metric === "revenue"
      ? { forecast: "forecastRev", actual: "actualRev" }
      : { forecast: "forecastAtt", actual: "actualAtt" };
  const domain = chartRows.length
    ? [chartRows[0].time - 3 * DAY, chartRows[chartRows.length - 1].time + 3 * DAY]
    : [today - DAY, today + DAY];
  const showToday = today >= domain[0] && today <= domain[1];

  const fill = stats.capacity > 0 ? stats.attendance / stats.capacity : 0;
  const completeArtists = artists.filter(
    (a) => a.engagement_score != null && a.headline_score != null && a.market_strength_score != null,
  ).length;
  const artistRatio = artists.length ? completeArtists / artists.length : 0;
  const nextEvent = rows.find((row) => row.time >= today);
  const insights = buildInsights(stats, periodRows, upcomingStats, unforecasted);

  const liveEvents = allEvents.filter(
    (event) => canRecordActuals(event.event_date) && isUpcoming(event.event_date),
  );
  const comparisonItems = comparison?.items ?? [];
  const awaitingItems = comparison?.awaiting_results ?? [];
  const eventNameById = Object.fromEntries(allEvents.map((event) => [event.id, event.event_name]));
  const averageConfidence = recentPredictions.length
    ? recentPredictions.reduce((sum, p) => sum + p.confidence_score, 0) / recentPredictions.length
    : null;

  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const rangeLabel = win
    ? rangeText(win.start, win.end)
    : rows.length
      ? rangeText(rows[0].time, rows[rows.length - 1].time)
      : "No events yet";

  if (loading) {
    return (
      <div className="page-stack">
        <LoadingPanel rows={2} />
        <LoadingPanel rows={5} />
      </div>
    );
  }

  if (loadError) {
    return <Notice tone="error">Could not load the dashboard: {loadError.message}</Notice>;
  }

  return (
    <>
      <header className="dash-header">
        <div>
          <div className="eyebrow">
            {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          </div>
          <h1>{greeting}, {displayName(user?.email)}</h1>
        </div>
        <div className="dash-controls">
          <label className="select-chip">
            <span className="sr-only">Period</span>
            <select
              value={periodKey}
              onChange={(e) =>
                setSearchParams(e.target.value === "all" ? {} : { period: e.target.value }, {
                  replace: true,
                })
              }
            >
              {PERIODS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <span className="range-chip">
            <Icon name="calendar" size={14} /> {rangeLabel}
          </span>
          {isAdmin && (
            <Link to="/predictions" className="cta-button small">
              <Icon name="plus" size={14} strokeWidth={2.2} /> Run prediction
            </Link>
          )}
        </div>
      </header>
      <ReadOnlyNotice />

      <div className="dash-grid">
        <div className="dash-main">
          <section className="kpi-strip">
            <KpiCell label="Forecast revenue" value={`KES ${formatCompact(stats.revenue)}`} delta={delta("revenue")} />
            <KpiCell label="Forecast attendance" value={formatNumber(stats.attendance)} delta={delta("attendance")} />
            <KpiCell
              label="Events"
              value={formatNumber(stats.events)}
              delta={delta("events")}
              note={`${stats.forecasted} with a forecast`}
            />
            <KpiCell
              label="Avg. attendance error"
              value={stats.meanAbsError == null ? "—" : `${stats.meanAbsError.toFixed(1)}%`}
              delta={errorDelta}
              inverse
              note={
                stats.compared
                  ? `${stats.compared} completed event${stats.compared === 1 ? "" : "s"} compared`
                  : "Needs events with recorded results"
              }
            />
          </section>

          <section className="dash-card trend-card">
            <div className="trend-head">
              <div>
                <strong className="dash-hero">
                  {metric === "revenue" ? formatKes(stats.revenue) : formatNumber(stats.attendance)}
                </strong>
                <span className="kpi-note">
                  Forecast {metric} by event date · latest forecast per event
                </span>
              </div>
              <div className="trend-tools">
                <div className="legend">
                  <span>
                    <i style={{ background: FORECAST }} /> Forecast
                  </span>
                  <span>
                    <i style={{ background: ACTUAL, borderRadius: "50%" }} /> Actual
                  </span>
                </div>
                <div className="segmented" role="group" aria-label="Chart metric">
                  {["revenue", "attendance"].map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={metric === key ? "active" : ""}
                      onClick={() => setMetric(key)}
                    >
                      {key[0].toUpperCase() + key.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {chartRows.length === 0 ? (
              <div className="trend-empty">No forecasts for events in this period yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartRows} margin={{ top: 22, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="forecastFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={FORECAST} stopOpacity={0.32} />
                      <stop offset="100%" stopColor={FORECAST} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis
                    dataKey="time"
                    type="number"
                    scale="time"
                    domain={domain}
                    tickFormatter={shortDate}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={28}
                  />
                  <YAxis
                    tickFormatter={(v) => formatCompact(v)}
                    width={44}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={<TrendTooltip metric={metric} />}
                    cursor={{ stroke: INK_MUTED, strokeDasharray: "3 3" }}
                  />
                  {showToday && (
                    <ReferenceLine x={today} stroke="#EDEDEF" strokeOpacity={0.5} label={<TodayLabel />} />
                  )}
                  <Area
                    type="monotone"
                    dataKey={chartKeys.forecast}
                    stroke={FORECAST}
                    strokeWidth={2}
                    fill="url(#forecastFill)"
                    dot={{ r: 3, fill: FORECAST, stroke: "#0f0f10", strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: "#0f0f10", strokeWidth: 2 }}
                  />
                  <Line
                    dataKey={chartKeys.actual}
                    stroke="none"
                    dot={{ r: 5, fill: ACTUAL, stroke: "#0f0f10", strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: ACTUAL, stroke: "#0f0f10", strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </section>

          <div className="dash-pair">
            <InsightsCard key={periodKey} insights={insights} />
            <MarketingCard rows={periodRows} total={stats.marketing} />
          </div>
        </div>

        <aside className="dash-side">
          <section className="dash-card gauge-card">
            <TickGauge ratio={fill} label={`Forecast fills ${Math.round(fill * 100)}% of capacity`}>
              <span className="gauge-icon">
                <Icon name="users" size={16} />
              </span>
              <span className="kpi-label">Forecast fill</span>
              <strong className="gauge-value">{Math.round(fill * 100)}%</strong>
              <span className="kpi-note">
                {formatNumber(stats.attendance)} of {formatNumber(stats.capacity)} seats
              </span>
            </TickGauge>
            <div className="segment-legend center">
              <span>
                <i style={{ background: "#E8E8EA" }} /> Forecast attendance
              </span>
              <span>
                <i style={{ background: "#38383D" }} /> Unfilled capacity
              </span>
            </div>
            <PanelButton to="/events">
              View events
            </PanelButton>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Artist roster</span>
              <Link to="/artists" className="text-link">
                Artists
              </Link>
            </div>
            <div className="meter-head">
              <strong className="dash-big">{formatNumber(artists.length)}</strong>
              <span className="meter-pct">{Math.round(artistRatio * 100)}%</span>
            </div>
            <TickMeter
              ratio={artistRatio}
              label={`${completeArtists} of ${artists.length} artists have complete scores`}
            />
            <div className="segment-legend">
              <span>
                <i style={{ background: "#E8E8EA" }} /> Complete scores
              </span>
              <span>
                <i style={{ background: "#38383D" }} /> Missing scores
              </span>
            </div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head">
              <span className="dash-card-title">Next event</span>
              {nextEvent && (
                <Link to={`/predictions?event=${nextEvent.id}`} className="text-link">
                  Forecast
                </Link>
              )}
            </div>
            {nextEvent ? (
              <dl className="detail-list">
                <div>
                  <dt>Event</dt>
                  <dd>{nextEvent.name}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{formatDate(nextEvent.date)}</dd>
                </div>
                <div>
                  <dt>Venue</dt>
                  <dd>
                    {nextEvent.venue}, {nextEvent.city}
                  </dd>
                </div>
                <div>
                  <dt>Ticket price</dt>
                  <dd>{formatKes(nextEvent.ticketPrice)}</dd>
                </div>
                <div>
                  <dt>Forecast</dt>
                  <dd>
                    {nextEvent.forecastAtt != null
                      ? `${formatNumber(nextEvent.forecastAtt)} attendees`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <span className={nextEvent.forecastAtt != null ? "status-chip" : "status-chip muted"}>
                      {nextEvent.forecastAtt != null ? "Forecast ready" : "No forecast yet"}
                    </span>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="kpi-note">No upcoming events scheduled.</p>
            )}
          </section>
        </aside>
      </div>

      <section className="dash-section">
          <div className="dash-section-head">
            <h2>Event day</h2>
            <p className="panel-subtext">Live sales against forecast, and patterns learned from past events.</p>
          </div>
          <div className="summary-grid">
            {liveEvents.map((event) => (
              <LiveEventCard key={event.id} event={event} showName />
            ))}
            <EventDayPatternsCard />
            <TierPatternsCard />
          </div>
      </section>

      {comparisonItems.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Prediction accuracy</h2>
              <p className="panel-subtext">
                Positive error means the forecast was above the recorded result
              </p>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: FORECAST }} /> Forecast
              </span>
              <span>
                <i style={{ background: ACTUAL }} /> Actual
              </span>
            </div>
          </div>

          <div className="accuracy-grid">
            <div className="kpi-strip compact">
              <KpiCell label="Events compared" value={formatNumber(comparison.events_compared)} />
              <KpiCell
                label="Avg. attendance error"
                value={comparison.mean_attendance_error_pct == null ? "—" : `${comparison.mean_attendance_error_pct}%`}
                note="average absolute error"
              />
              <KpiCell
                label="Avg. revenue error"
                value={comparison.mean_revenue_error_pct == null ? "—" : `${comparison.mean_revenue_error_pct}%`}
                note="average absolute error"
              />
              <KpiCell
                label="Range coverage"
                value={comparison.range_coverage_pct == null ? "—" : `${comparison.range_coverage_pct}%`}
                note={
                  comparison.events_with_range
                    ? `Actual results fell inside the predicted range for ${comparison.events_in_range} of ${comparison.events_with_range} events`
                    : "No compared events have a predicted range yet"
                }
              />
            </div>
            <div className="chart-box">
              <h3>Attendance</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={comparisonItems} barGap={2} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="event_name" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => formatCompact(v)} width={44} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} formatter={(v) => formatNumber(v)} />
                  <Bar dataKey="predicted_attendance" name="Forecast" fill={FORECAST} radius={[4, 4, 0, 0]} maxBarSize={26} />
                  <Bar dataKey="actual_attendance" name="Actual" fill={ACTUAL} radius={[4, 4, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Forecast attendance</th>
                  <th>Actual attendance</th>
                  <th>In range?</th>
                  <th>Attendance error</th>
                  <th>Revenue error</th>
                </tr>
              </thead>
              <tbody>
                {comparisonItems.map((item) => (
                  <tr key={item.event_id}>
                    <td>{item.event_name}</td>
                    <td className="nowrap">
                      <RangeValue
                        compact
                        expected={item.predicted_attendance}
                        low={item.attendance_low}
                        high={item.attendance_high}
                      />
                    </td>
                    <td>{formatNumber(item.actual_attendance)}</td>
                    <td>
                      {item.attendance_in_range == null ? (
                        <span className="event-sub">No range</span>
                      ) : (
                        <span className={item.attendance_in_range ? "pill pill-high" : "pill pill-low"}>
                          {item.attendance_in_range ? "Inside range" : "Outside range"}
                        </span>
                      )}
                    </td>
                    <td>{item.attendance_error_pct == null ? "—" : `${item.attendance_error_pct > 0 ? "+" : ""}${item.attendance_error_pct}%`}</td>
                    <td>{item.revenue_error_pct == null ? "—" : `${item.revenue_error_pct > 0 ? "+" : ""}${item.revenue_error_pct}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {awaitingItems.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Awaiting results</h2>
              <p className="panel-subtext">
                Events without recorded actuals. They join the accuracy comparison once
                results are recorded on the Events page.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Date</th>
                  <th>Latest forecast attendance</th>
                  <th>Latest forecast revenue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {awaitingItems.map((item) => (
                  <tr key={item.event_id}>
                    <td>{item.event_name}</td>
                    <td>{formatDate(item.event_date)}</td>
                    <td>
                      {item.predicted_attendance != null
                        ? formatNumber(item.predicted_attendance)
                        : "No forecast yet"}
                    </td>
                    <td>{formatKes(item.predicted_revenue)}</td>
                    <td>
                      {canRecordActuals(item.event_date) ? (
                        <Link to="/events" className="pill pill-low">
                          Results not recorded
                        </Link>
                      ) : (
                        <span className="pill pill-high">Awaiting results</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="content-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent events</h2>
              <p className="panel-subtext">{formatNumber(summary?.total_events ?? 0)} events tracked</p>
            </div>
          </div>
          {recentEvents.length === 0 ? (
            <p className="panel-subtext">No events available.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Venue</th>
                    <th>Ticket price</th>
                    <th>Forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event) => {
                    const row = rows.find((r) => r.id === event.id);
                    return (
                      <tr key={event.id}>
                        <td>
                          <div className="event-cell">
                            <div className="event-thumb" style={{ background: thumbGradient(event.id) }}>
                              {event.event_name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="event-title">{event.event_name}</div>
                              <div className="event-sub">{event.event_type}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          {event.venue}
                          <div className="event-sub">{event.city}</div>
                        </td>
                        <td className="nowrap">{formatPriceRange(event)}</td>
                        <td>{row?.forecastAtt != null ? formatNumber(row.forecastAtt) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent predictions</h2>
              <p className="panel-subtext">
                {formatNumber(summary?.total_predictions ?? 0)} runs
                {averageConfidence != null &&
                  ` · avg. confidence ${averageConfidence.toFixed(2)} (heuristic, not a probability)`}
              </p>
            </div>
          </div>
          {recentPredictions.length === 0 ? (
            <p className="panel-subtext">No predictions available.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Attendance</th>
                    <th>Revenue</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPredictions.map((prediction) => (
                    <tr key={prediction.id}>
                      <td>{eventNameById[prediction.event_id] ?? `Event ${prediction.event_id}`}</td>
                      <td>
                        <RangeValue
                          compact
                          expected={prediction.predicted_attendance}
                          low={prediction.attendance_low}
                          high={prediction.attendance_high}
                          note={prediction.range_note}
                        />
                      </td>
                      <td>
                        <RangeValue
                          compact
                          expected={prediction.predicted_revenue}
                          low={prediction.revenue_low}
                          high={prediction.revenue_high}
                          money
                          note={prediction.range_note}
                        />
                      </td>
                      <td>
                        <span className={confidencePillClass(prediction.confidence_score)}>
                          {prediction.confidence_score.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

export default DashboardPage;
