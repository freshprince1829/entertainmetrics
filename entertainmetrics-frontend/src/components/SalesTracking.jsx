import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiDelete, apiPost, useApiData } from "../api";
import { canRecordActuals, formatDateTime, formatKes, formatNumber } from "../format";
import { Field, Notice, StatCard } from "./ui";
import { ACTUAL, CHECKED_IN, INK_MUTED } from "../theme";


const STATUS_PILL = {
  "on track": "pill pill-high",
  ahead: "pill pill-high",
  behind: "pill pill-mid",
};

const emptySnapshotForm = {
  recorded_at: "",
  tickets_sold_total: "",
  gate_tickets_sold: "",
  attendance_checked_in: "",
  revenue_to_date: "",
  notes: "",
};

function pad(value) {
  return String(value).padStart(2, "0");
}

// Value for <input type="datetime-local"> in the browser's local time.
function localInputValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

// "2026-12-17T19:30" -> "2026-12-17T19:30:00+03:00", keeping the local date
// so the API validates against the venue's calendar day.
function withLocalOffset(localValue) {
  const offsetMinutes = -new Date(localValue).getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${localValue}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function eventDayStart(eventDate) {
  const [y, m, d] = String(eventDate).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatPct(value) {
  return value === null || value === undefined ? "-" : `${value}%`;
}

function chartDate(ms) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function SalesChart({ snapshots, progress, eventDate }) {
  const eventStart = eventDayStart(eventDate);
  const rows = snapshots.map((s) => ({
    t: new Date(s.recorded_at).getTime(),
    sold: s.tickets_sold_total,
    attended: s.attendance_checked_in,
  }));

  const showProjection =
    progress?.velocity_tickets_per_day != null &&
    progress.days_until_event > 0 &&
    rows.length > 0;
  if (showProjection) {
    rows[rows.length - 1] = { ...rows[rows.length - 1], projected: rows[rows.length - 1].sold };
    rows.push({ t: eventStart, projected: progress.projected_final_sales });
  }
  const hasAttendance = rows.some((row) => row.attended != null);

  const times = [...rows.map((row) => row.t), eventStart];
  const domain = [Math.min(...times), Math.max(...times)];

  return (
    <div className="chart-box">
      <div className="legend" style={{ marginBottom: 10 }}>
        <span>
          <i style={{ background: ACTUAL }} /> Tickets sold
        </span>
        {hasAttendance && (
          <span>
            <i style={{ background: CHECKED_IN }} /> Checked in
          </span>
        )}
        {showProjection && (
          <span>
            <i className="legend-dash" style={{ borderColor: ACTUAL }} /> Projection
          </span>
        )}
        <span>
          <i className="legend-dash" /> Event day
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            tickFormatter={chartDate}
          />
          <YAxis width={48} tickFormatter={(v) => formatNumber(v)} />
          <Tooltip
            labelFormatter={(value) => formatDateTime(value)}
            formatter={(value, name) => [formatNumber(value), name]}
          />
          <ReferenceLine x={eventStart} stroke={INK_MUTED} strokeDasharray="4 4" />
          <Line type="monotone" dataKey="sold" name="Tickets sold" stroke={ACTUAL}
            strokeWidth={2} dot={{ r: 3 }} connectNulls />
          {hasAttendance && (
            <Line type="monotone" dataKey="attended" name="Checked in" stroke={CHECKED_IN}
              strokeWidth={2} dot={{ r: 3 }} connectNulls />
          )}
          {showProjection && (
            <Line type="linear" dataKey="projected" name="Projected sales" stroke={ACTUAL}
              strokeWidth={2} strokeDasharray="6 5" dot={false} connectNulls />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LiveEventCard({ event, showName = false }) {
  const { data, error, loading } = useApiData(`/events/${event.id}/live-vs-predicted`);

  return (
    <div className="card live-card">
      <div className="live-head">
        <span className="pill pill-live">LIVE - not final</span>
        {showName && <strong>{event.event_name}</strong>}
        {data?.status && <span className={STATUS_PILL[data.status]}>{data.status}</span>}
      </div>
      {loading ? (
        <p className="panel-subtext">Loading live numbers…</p>
      ) : error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : (
        <>
          {data.predicted_attendance != null && data.tickets_sold_so_far != null && (
            <div className="live-grid">
              <div>
                <span>Tickets sold so far</span>
                <strong>{formatNumber(data.tickets_sold_so_far)}</strong>
                <small>{formatPct(data.tickets_percent_of_prediction)} of prediction</small>
              </div>
              <div>
                <span>Checked in so far</span>
                <strong>{formatNumber(data.attendance_so_far)}</strong>
                <small>{formatPct(data.attendance_percent_of_prediction)} of prediction</small>
              </div>
              <div>
                <span>Predicted attendance</span>
                <strong>{formatNumber(data.predicted_attendance)}</strong>
                <small>latest forecast</small>
              </div>
            </div>
          )}
          <p className="live-note">{data.explanation}</p>
        </>
      )}
    </div>
  );
}

export function EventDayPatternsCard() {
  const { data, error, loading } = useApiData("/analytics/event-day-patterns");

  return (
    <div className="card">
      <h3>Event-day patterns</h3>
      {loading ? (
        <p className="metric-note">Loading…</p>
      ) : error ? (
        <Notice tone="error">{error.message}</Notice>
      ) : data.sufficient_history ? (
        <>
          <div className="live-grid">
            <div>
              <span>Gate share</span>
              <strong>{formatPct(data.avg_gate_share_pct)}</strong>
              <small>of tickets sold at the gate</small>
            </div>
            <div>
              <span>Show rate</span>
              <strong>{formatPct(data.avg_show_rate_pct)}</strong>
              <small>of ticket holders attended</small>
            </div>
          </div>
          <p className="metric-note">
            Learned from {data.events_used} completed events. Rule-based averages, used
            in later predictions.
          </p>
        </>
      ) : (
        <p className="metric-note">
          Not enough history yet (need {data.min_events_required}+ completed events).{" "}
          {data.events_used} so far.
        </p>
      )}
    </div>
  );
}

function SnapshotForm({ eventId, latest, onSaved }) {
  const [formData, setFormData] = useState(emptySnapshotForm);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  function prefillGateCount() {
    setNotice(null);
    setFormData({
      recorded_at: localInputValue(new Date()),
      tickets_sold_total: latest?.tickets_sold_total ?? "",
      gate_tickets_sold: latest?.gate_tickets_sold ?? "",
      attendance_checked_in: latest?.attendance_checked_in ?? "",
      revenue_to_date: latest?.revenue_to_date ?? "",
      notes: "Event-day count",
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);

    const optionalNumber = (value) => (value === "" ? null : Number(value));
    const payload = {
      recorded_at: withLocalOffset(formData.recorded_at),
      tickets_sold_total: Number(formData.tickets_sold_total),
      gate_tickets_sold: formData.gate_tickets_sold === "" ? 0 : Number(formData.gate_tickets_sold),
      attendance_checked_in: optionalNumber(formData.attendance_checked_in),
      revenue_to_date: optionalNumber(formData.revenue_to_date),
      notes: formData.notes || null,
    };

    try {
      await apiPost(`/events/${eventId}/sales-snapshots`, payload);
      setNotice({ tone: "success", text: "Snapshot saved." });
      setFormData(emptySnapshotForm);
      onSaved();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to save snapshot" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="lineup-form" onSubmit={handleSubmit}>
      <div className="form-section">
        Log a sales snapshot <span className="optional">cumulative totals so far</span>
      </div>
      <div className="form-grid">
        <Field label="Date and time" wide>
          <input name="recorded_at" type="datetime-local" value={formData.recorded_at}
            onChange={handleChange} required />
        </Field>
        <Field label="Total tickets sold">
          <input name="tickets_sold_total" type="number" min="0"
            value={formData.tickets_sold_total} onChange={handleChange} required />
        </Field>
        <Field label="Gate tickets sold">
          <input name="gate_tickets_sold" type="number" min="0"
            value={formData.gate_tickets_sold} onChange={handleChange} placeholder="0" />
        </Field>
        <Field label="Attendance checked in">
          <input name="attendance_checked_in" type="number" min="0"
            value={formData.attendance_checked_in} onChange={handleChange} />
        </Field>
        <Field label="Revenue to date (KES)">
          <input name="revenue_to_date" type="number" min="0" step="any"
            value={formData.revenue_to_date} onChange={handleChange} />
        </Field>
        <Field label="Notes" wide>
          <input name="notes" value={formData.notes} onChange={handleChange}
            placeholder="e.g. Early-bird phase closed" />
        </Field>
      </div>
      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={prefillGateCount}>
          Log gate / event-day count
        </button>
        <button type="submit" className="primary-button" disabled={submitting}>
          {submitting ? "Saving…" : "Save snapshot"}
        </button>
      </div>
    </form>
  );
}

function SnapshotTable({ eventId, snapshots, onDeleted }) {
  const [pendingId, setPendingId] = useState(null);
  const [error, setError] = useState("");

  async function handleDelete(id) {
    setError("");
    try {
      await apiDelete(`/events/${eventId}/sales-snapshots/${id}`);
      setPendingId(null);
      onDeleted();
    } catch (err) {
      setError(err.message || "Failed to delete snapshot");
    }
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Recorded</th>
              <th>Sold</th>
              <th>Gate</th>
              <th>Checked in</th>
              <th>Revenue</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...snapshots].reverse().map((s) => (
              <tr key={s.id}>
                <td>{formatDateTime(s.recorded_at)}</td>
                <td>{formatNumber(s.tickets_sold_total)}</td>
                <td>{formatNumber(s.gate_tickets_sold)}</td>
                <td>{formatNumber(s.attendance_checked_in)}</td>
                <td>{formatKes(s.revenue_to_date)}</td>
                <td className="event-sub">{s.notes || "-"}</td>
                <td>
                  {pendingId === s.id ? (
                    <span className="row-actions">
                      <button type="button" className="text-button danger" onClick={() => handleDelete(s.id)}>
                        Confirm
                      </button>
                      <button type="button" className="text-button" onClick={() => setPendingId(null)}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="text-button" onClick={() => setPendingId(s.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice tone="error">{error}</Notice>
    </>
  );
}

function CloseOutPanel({ event, preview, onFinalized }) {
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  async function handleConfirm() {
    setSubmitting(true);
    setNotice(null);
    try {
      const result = await apiPost(`/events/${event.id}/finalize-actuals`, {});
      setNotice({
        tone: "success",
        text: `Final actuals saved: ${formatNumber(result.actual_attendance)} attendees, ${formatKes(result.revenue)}.`,
      });
      setConfirming(false);
      onFinalized();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to close out the event" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="closeout">
      {confirming ? (
        <div className="confirm-box">
          <strong>Save these as the event's final actuals?</strong>
          <ul>
            <li>
              Actual attendance: <b>{formatNumber(preview.actual_attendance)}</b>{" "}
              <span className="event-sub">
                ({preview.attendance_source === "attendance_checked_in"
                  ? "people checked in"
                  : "tickets sold - no check-in count recorded"}, snapshot of{" "}
                {formatDateTime(preview.recorded_at)})
              </span>
            </li>
            <li>
              Actual revenue: <b>{formatKes(preview.revenue)}</b>{" "}
              <span className="event-sub">
                ({preview.revenue_source === "revenue_to_date"
                  ? "revenue to date from the snapshot"
                  : "unchanged - the snapshot has no revenue figure"})
              </span>
            </li>
          </ul>
          {event.actual_attendance != null && (
            <p className="event-sub">
              This replaces the current actuals ({formatNumber(event.actual_attendance)} attendees,{" "}
              {formatKes(event.revenue)}). They stay editable afterwards.
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="primary-button" onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Saving…" : "Confirm and save final actuals"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost-button" onClick={() => setConfirming(true)}>
          Close out event and record final actuals
        </button>
      )}
      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>
    </div>
  );
}

export function SalesTrackingSection({ event, onEventUpdated }) {
  const snapshotsQuery = useApiData(`/events/${event.id}/sales-snapshots`);
  const progressQuery = useApiData(`/events/${event.id}/sales-progress`);
  const [liveVersion, setLiveVersion] = useState(0);

  const snapshots = snapshotsQuery.data ?? [];
  const progress = progressQuery.data;
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;

  function reloadSales() {
    snapshotsQuery.reload();
    progressQuery.reload();
    setLiveVersion((v) => v + 1);
  }

  const loadError = snapshotsQuery.error || progressQuery.error;

  return (
    <section className="sales-section">
      <h2 className="drawer-heading">Ticket sales &amp; attendance</h2>
      <p className="panel-subtext">
        Cumulative snapshots logged before and during the event. Live numbers never
        become final actuals until you close the event out.
      </p>

      {progress?.phase === "event-day" && <LiveEventCard key={liveVersion} event={event} />}

      {loadError ? (
        <Notice tone="error">{loadError.message}</Notice>
      ) : !progress || snapshotsQuery.loading ? (
        <p className="panel-subtext">Loading sales data…</p>
      ) : progress.snapshot_count === 0 ? (
        <p className="panel-subtext">{progress.explanation}</p>
      ) : (
        <>
          <div className="sales-stats">
            <StatCard label="Sell-through" value={formatPct(progress.sell_through_pct)}
              note={`${formatNumber(progress.tickets_sold_total)} of ${formatNumber(progress.capacity)}`} />
            <StatCard label="Days until event" value={progress.days_until_event}
              note={progress.phase} />
            <StatCard label="Tickets / day"
              value={progress.velocity_tickets_per_day == null ? "-" : formatNumber(progress.velocity_tickets_per_day)}
              note="last 7 days of snapshots" />
            <StatCard label="Gate share" value={formatPct(progress.gate_share_pct)}
              note="sold at the gate" />
            <StatCard label="Show rate" value={formatPct(progress.show_rate_pct)}
              note="checked in / sold" />
            <StatCard label="Projected final sales" value={formatNumber(progress.projected_final_sales)}
              note="capped at capacity" />
          </div>
          <SalesChart snapshots={snapshots} progress={progress} eventDate={event.event_date} />
          <p className="live-note">{progress.explanation}</p>
          <SnapshotTable eventId={event.id} snapshots={snapshots} onDeleted={reloadSales} />
          {canRecordActuals(event.event_date) && progress.finalize_preview && (
            <CloseOutPanel
              event={event}
              preview={progress.finalize_preview}
              onFinalized={() => {
                reloadSales();
                onEventUpdated();
              }}
            />
          )}
        </>
      )}

      <SnapshotForm eventId={event.id} latest={latest} onSaved={reloadSales} />
    </section>
  );
}
