import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Legend,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const API_BASE = "http://127.0.0.1:8000";

function DashboardPage() {
  const [summary, setSummary] = useState(null);
  const [recentEvents, setRecentEvents] = useState([]);
  const [recentPredictions, setRecentPredictions] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [summaryRes, eventsRes, predictionsRes, comparisonRes] = await Promise.all([
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

  const comparisonItems = comparison?.items ?? [];

  const formatError = (value) =>
    value === null || value === undefined
      ? "-"
      : `${value > 0 ? "+" : ""}${value}%`;

  if (loading) {
    return <p>Loading dashboard...</p>;
  }

  return (
    <>
      <header className="header">
        <div>
          <h1>EntertainMetrics</h1>
          <p>AI-powered entertainment analytics dashboard</p>
        </div>
      </header>

      <section className="summary-grid">
        <div className="card">
          <h3>Total Events</h3>
          <p className="metric">{summary?.total_events ?? 0}</p>
        </div>
        <div className="card">
          <h3>Total Artists</h3>
          <p className="metric">{summary?.total_artists ?? 0}</p>
        </div>
        <div className="card">
          <h3>Total Predictions</h3>
          <p className="metric">{summary?.total_predictions ?? 0}</p>
        </div>
        <div className="card">
          <h3>Avg Predicted Attendance</h3>
          <p className="metric">
            {summary?.average_predicted_attendance?.toFixed(0) ?? 0}
          </p>
        </div>
        <div className="card">
          <h3>Avg Predicted Revenue</h3>
          <p className="metric">
            KES {summary?.average_predicted_revenue?.toFixed(2) ?? "0.00"}
          </p>
        </div>
      </section>

      <section className="charts-grid">
        <div className="panel">
          <h2>Predicted Attendance</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={attendanceChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="attendance" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <h2>Predicted Revenue</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip formatter={(value) => [`KES ${value}`, "Revenue"]} />
                <Bar dataKey="revenue" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Predicted vs Actual</h2>
        {comparisonItems.length === 0 ? (
          <p>
            No events have both a prediction and recorded actual results yet.
          </p>
        ) : (
          <>
            <section className="summary-grid">
              <div className="card">
                <h3>Events Compared</h3>
                <p className="metric">{comparison.events_compared}</p>
              </div>
              <div className="card">
                <h3>Avg Attendance Error</h3>
                <p className="metric">
                  {comparison.mean_attendance_error_pct ?? "-"}%
                </p>
              </div>
              <div className="card">
                <h3>Avg Revenue Error</h3>
                <p className="metric">
                  {comparison.mean_revenue_error_pct ?? "-"}%
                </p>
              </div>
            </section>

            <section className="charts-grid">
              <div className="chart-box">
                <h3>Attendance</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparisonItems}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="event_name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="predicted_attendance"
                      name="Predicted"
                      fill="#0ea5e9"
                    />
                    <Bar
                      dataKey="actual_attendance"
                      name="Actual"
                      fill="#f59e0b"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="chart-box">
                <h3>Revenue (KES)</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={comparisonItems}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="event_name" />
                    <YAxis />
                    <Tooltip formatter={(value) => `KES ${value}`} />
                    <Legend />
                    <Bar
                      dataKey="predicted_revenue"
                      name="Predicted"
                      fill="#0ea5e9"
                    />
                    <Bar
                      dataKey="actual_revenue"
                      name="Actual"
                      fill="#f59e0b"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Predicted Attendance</th>
                    <th>Actual Attendance</th>
                    <th>Attendance Error</th>
                    <th>Revenue Error</th>
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
          </>
        )}
      </section>

      <section className="content-grid">
        <div className="panel">
          <h2>Recent Events</h2>
          {recentEvents.length === 0 ? (
            <p>No events available.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Type</th>
                    <th>City</th>
                    <th>Venue</th>
                    <th>Ticket Price</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{event.event_name}</td>
                      <td>{event.event_type}</td>
                      <td>{event.city}</td>
                      <td>{event.venue}</td>
                      <td>KES {event.ticket_price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Recent Predictions</h2>
          {recentPredictions.length === 0 ? (
            <p>No predictions available.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event ID</th>
                    <th>Attendance</th>
                    <th>Revenue</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {recentPredictions.map((prediction) => (
                    <tr key={prediction.id}>
                      <td>{prediction.event_id}</td>
                      <td>{prediction.predicted_attendance}</td>
                      <td>KES {prediction.predicted_revenue}</td>
                      <td>{Math.round(prediction.confidence_score * 100)}%</td>
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