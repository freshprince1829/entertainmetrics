import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

const API_BASE = "http://127.0.0.1:8000";

const AMBER = "#F0A860";
const TEAL = "#4FD1C5";
const VIOLET = "#9B8CF2";
const THUMB_GRADIENTS = [
  "linear-gradient(135deg, #F0A860, #9B6B3A)",
  "linear-gradient(135deg, #4FD1C5, #2C8C82)",
  "linear-gradient(135deg, #9B8CF2, #6657B0)",
];
const BAR_COLORS = [AMBER, TEAL, VIOLET];
const RING_CIRCUMFERENCE = 2 * Math.PI * 38;

function confidencePillClass(score) {
  if (score >= 0.8) return "pill pill-high";
  if (score >= 0.6) return "pill pill-mid";
  return "pill pill-low";
}

function formatKes(value) {
  return `KES ${Number(value).toLocaleString("en-KE", {
    maximumFractionDigits: 0,
  })}`;
}

function formatError(value) {
  return value === null || value === undefined
    ? "-"
    : `${value > 0 ? "+" : ""}${value}%`;
}

function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [recentPredictions, setRecentPredictions] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => new Date());

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [summaryRes, eventsRes, predictionsRes, comparisonRes] =
          await Promise.all([
            fetch(`${API_BASE}/dashboard/summary`),
            fetch(`${API_BASE}/dashboard/recent-events?limit=5`),
            fetch(`${API_BASE}/dashboard/recent-predictions?limit=5`),
            fetch(`${API_BASE}/dashboard/predicted-vs-actual`),
          ]);

        const summaryData = await summaryRes.json();
        const eventsData = await eventsRes.json();
        const predictionsData = await predictionsRes.json();
        const comparisonData = await comparisonRes.json();

        setSummary(summaryData);
        setRecentEvents(eventsData);
        setRecentPredictions(predictionsData);
        setComparison(comparisonData);
      } catch (error) {
        console.error("Failed to load dashboard data:", error);
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  const attendanceChartData = useMemo(() => {
    return recentPredictions.map((prediction) => ({
      name: `Event ${prediction.event_id}`,
      attendance: prediction.predicted_attendance,
    }));
  }, [recentPredictions]);

  const revenueChartData = useMemo(() => {
    return recentPredictions.map((prediction) => ({
      name: `Event ${prediction.event_id}`,
      revenue: prediction.predicted_revenue,
    }));
  }, [recentPredictions]);

  const comparisonItems = useMemo(() => comparison?.items ?? [], [comparison]);

  const averageConfidence = useMemo(() => {
    if (recentPredictions.length === 0) return null;
    const total = recentPredictions.reduce(
      (sum, prediction) => sum + prediction.confidence_score,
      0,
    );
    return total / recentPredictions.length;
  }, [recentPredictions]);

  const latestPredictionByEvent = useMemo(() => {
    const map = {};
    // recentPredictions is newest-first, so keep the first one seen per event
    recentPredictions.forEach((prediction) => {
      if (!(prediction.event_id in map)) {
        map[prediction.event_id] = prediction;
      }
    });
    return map;
  }, [recentPredictions]);

  const eventNameById = useMemo(() => {
    const map = {};
    recentEvents.forEach((event) => {
      map[event.id] = event.event_name;
    });
    comparisonItems.forEach((item) => {
      map[item.event_id] = item.event_name;
    });
    return map;
  }, [recentEvents, comparisonItems]);

  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  if (loading) {
    return <p>Loading dashboard...</p>;
  }

  return (
    <>
      <header className="header">
        <div>
          <div className="eyebrow">{dateLabel}</div>
          <h1>{greeting}, Tito</h1>
        </div>
        <Link to="/predictions" className="cta-button">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#15120C"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          Run a prediction
        </Link>
      </header>

      <section className="summary-grid">
        <div className="card">
          <h3>Total events tracked</h3>
          <p className="metric">{summary?.total_events ?? 0}</p>
        </div>
        <div className="card">
          <h3>Total artists</h3>
          <p className="metric">{summary?.total_artists ?? 0}</p>
        </div>
        <div className="card">
          <h3>Total predictions</h3>
          <p className="metric">{summary?.total_predictions ?? 0}</p>
        </div>
        <div className="card">
          <h3>Avg. predicted attendance</h3>
          <p className="metric">
            {Number(summary?.average_predicted_attendance ?? 0).toLocaleString(
              "en-KE",
              { maximumFractionDigits: 0 },
            )}
          </p>
          <p className="metric-note">across all predictions</p>
        </div>
        <div className="card">
          <h3>Avg. predicted revenue</h3>
          <p className="metric">
            {formatKes(summary?.average_predicted_revenue ?? 0)}
          </p>
          <p className="metric-note">per event, rule-based</p>
        </div>
      </section>

      <section className="hero-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Predicted vs. actual attendance</h2>
              <p className="panel-subtext">
                Completed events with a recorded result
              </p>
            </div>
            <div className="legend">
              <span>
                <i style={{ background: AMBER }} />
                Predicted
              </span>
              <span>
                <i style={{ background: TEAL }} />
                Actual
              </span>
            </div>
          </div>
          {comparisonItems.length === 0 ? (
            <p className="panel-subtext">
              No events have both a prediction and recorded actual results yet.
            </p>
          ) : (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={comparisonItems} barGap={5}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="event_name" />
                  <YAxis />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar
                    dataKey="predicted_attendance"
                    name="Predicted"
                    fill={AMBER}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="actual_attendance"
                    name="Actual"
                    fill={TEAL}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="panel panel-col">
          <h2>Prediction confidence</h2>
          <p className="panel-subtext">
            Heuristic score, not a statistical probability
          </p>
          {averageConfidence === null ? (
            <p className="panel-subtext">No predictions available.</p>
          ) : (
            <>
              <div className="ring-row">
                <svg width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
                  <circle
                    cx="46"
                    cy="46"
                    r="38"
                    fill="none"
                    stroke="#1E2227"
                    strokeWidth="10"
                  />
                  <circle
                    cx="46"
                    cy="46"
                    r="38"
                    fill="none"
                    stroke={AMBER}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${averageConfidence * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                    transform="rotate(-90 46 46)"
                  />
                </svg>
                <div>
                  <div className="ring-value">{averageConfidence.toFixed(2)}</div>
                  <div className="ring-caption">
                    average of {recentPredictions.length} recent predictions
                  </div>
                </div>
              </div>
              <div className="bar-list">
                {Object.values(latestPredictionByEvent)
                  .slice(0, 3)
                  .map((prediction, index) => (
                    <div key={prediction.event_id}>
                      <div className="bar-row-head">
                        <span>
                          {eventNameById[prediction.event_id] ??
                            `Event ${prediction.event_id}`}
                        </span>
                        <span>{Math.round(prediction.confidence_score * 100)}%</span>
                      </div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            width: `${Math.round(prediction.confidence_score * 100)}%`,
                            background: BAR_COLORS[index % BAR_COLORS.length],
                          }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </section>

      {comparisonItems.length > 0 && (
        <section className="panel" style={{ marginBottom: 28 }}>
          <div className="panel-head">
            <div>
              <h2>Prediction accuracy</h2>
              <p className="panel-subtext">
                Negative error means the model under-predicted
              </p>
            </div>
          </div>

          <div className="summary-grid">
            <div className="card">
              <h3>Events compared</h3>
              <p className="metric">{comparison.events_compared}</p>
            </div>
            <div className="card">
              <h3>Avg. attendance error</h3>
              <p className="metric">
                {comparison.mean_attendance_error_pct ?? "-"}%
              </p>
              <p className="metric-note">average absolute error</p>
            </div>
            <div className="card">
              <h3>Avg. revenue error</h3>
              <p className="metric">
                {comparison.mean_revenue_error_pct ?? "-"}%
              </p>
              <p className="metric-note">average absolute error</p>
            </div>
          </div>

          <div className="chart-box" style={{ marginBottom: 20 }}>
            <h3>Revenue (KES)</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={comparisonItems} barGap={5}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="event_name" />
                <YAxis />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  formatter={(value) => formatKes(value)}
                />
                <Legend />
                <Bar
                  dataKey="predicted_revenue"
                  name="Predicted"
                  fill={AMBER}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="actual_revenue"
                  name="Actual"
                  fill={TEAL}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Predicted attendance</th>
                  <th>Actual attendance</th>
                  <th>Attendance error</th>
                  <th>Revenue error</th>
                </tr>
              </thead>
              <tbody>
                {comparisonItems.map((item) => (
                  <tr key={item.event_id}>
                    <td>{item.event_name}</td>
                    <td>{item.predicted_attendance}</td>
                    <td>{item.actual_attendance}</td>
                    <td>{formatError(item.attendance_error_pct)}</td>
                    <td>{formatError(item.revenue_error_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="charts-grid">
        <div className="panel">
          <h2>Predicted attendance</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={attendanceChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                <Bar
                  dataKey="attendance"
                  fill={AMBER}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <h2>Predicted revenue</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.03)" }}
                  formatter={(value) => [formatKes(value), "Revenue"]}
                />
                <Bar
                  dataKey="revenue"
                  fill={TEAL}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="content-grid">
        <div className="panel">
          <h2>Recent events</h2>
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
                    <th>Predicted</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event, index) => {
                    const prediction = latestPredictionByEvent[event.id];
                    return (
                      <tr key={event.id}>
                        <td>
                          <div className="event-cell">
                            <div
                              className="event-thumb"
                              style={{
                                background:
                                  THUMB_GRADIENTS[index % THUMB_GRADIENTS.length],
                              }}
                            >
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
                        <td>{formatKes(event.ticket_price)}</td>
                        <td>
                          {prediction
                            ? prediction.predicted_attendance.toLocaleString(
                                "en-KE",
                              )
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Recent predictions</h2>
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
                      <td>
                        {eventNameById[prediction.event_id] ??
                          `Event ${prediction.event_id}`}
                      </td>
                      <td>
                        {prediction.predicted_attendance.toLocaleString("en-KE")}
                      </td>
                      <td>{formatKes(prediction.predicted_revenue)}</td>
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
