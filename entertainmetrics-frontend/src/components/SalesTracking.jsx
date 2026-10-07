import { useState } from "react";
import {
  Bar,
  BarChart,
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
import { ACTUAL, CHECKED_IN, INK, INK_MUTED } from "../theme";
import { localInputValue, withLocalOffset } from "../datetime";
import { tierColor } from "../tiers";
import { TierAnalyticsPanel } from "./TierAnalytics";
import { GateMode } from "./SalesEntry";
import { TierDailyEntryForm } from "./DailySales";
import { SalesImport } from "./SalesImport";

// Chart surface, used for the 2px gaps between stacked segments.
const SURFACE = "#141416";
const MAX_TIER_SERIES = 6;
// Share bars use 70% of the row at 100%, leaving room for the label.
const SHARE_BAR_SCALE = 0.7;


const STATUS_PILL = {
  "on track": "pill pill-high",
  ahead: "pill pill-high",
  behind: "pill pill-mid",
  "within predicted range": "pill pill-high",
  "above range": "pill pill-high",
  "below range": "pill pill-mid",
};

const emptySnapshotForm = {
  recorded_at: "",
  tickets_sold_total: "",
  gate_tickets_sold: "",
  attendance_checked_in: "",
  revenue_to_date: "",
  notes: "",
};

function eventDayStart(eventDate) {
  const [y, m, d] = String(eventDate).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function formatPct(value) {
  return value === null || value === undefined ? "-" : `${Number(value).toFixed(1)}%`;
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
        {(data?.status_label ?? data?.status) && (
          <span className={STATUS_PILL[data.status_label ?? data.status] ?? "pill pill-low"}>
            {data.status_label ?? data.status}
          </span>
        )}
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
                <small>
                  {data.attendance_low != null
                    ? `range ${formatNumber(data.attendance_low)} – ${formatNumber(data.attendance_high)}`
                    : "latest forecast"}
                </small>
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

// Snapshot form for events without ticket tiers (cumulative totals).
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

function TierSalesCharts({ eventId, snapshots, tiers }) {
  const breakdownQuery = useApiData(`/events/${eventId}/revenue-breakdown`);
  const breakdown = breakdownQuery.data;

  const shown = tiers.slice(0, MAX_TIER_SERIES);
  const hasOther = tiers.length > MAX_TIER_SERIES;
  const rows = snapshots
    .filter((s) => s.tier_sales)
    .map((s) => {
      const row = { label: formatDateTime(s.recorded_at), other: 0 };
      s.tier_sales.forEach((sale) => {
        const index = tiers.findIndex((t) => t.id === sale.tier_id);
        if (index >= 0 && index < MAX_TIER_SERIES) row[`t${sale.tier_id}`] = sale.tickets_sold;
        else row.other += sale.tickets_sold;
      });
      return row;
    });

  if (rows.length === 0) return null;

  return (
    <div className="tier-charts">
      <div className="chart-box">
        <h3>Tickets sold per tier</h3>
        <div className="legend" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          {shown.map((tier, index) => (
            <span key={tier.id}>
              <i style={{ background: tierColor(index) }} /> {tier.name}
            </span>
          ))}
          {hasOther && (
            <span>
              <i style={{ background: tierColor(MAX_TIER_SERIES) }} /> Other tiers
            </span>
          )}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis width={48} tickFormatter={(v) => formatNumber(v)} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(value, name) => [formatNumber(value), name]} />
            {shown.map((tier, index) => (
              <Bar key={tier.id} dataKey={`t${tier.id}`} name={tier.name} stackId="tiers"
                fill={tierColor(index)} stroke={SURFACE} strokeWidth={2} maxBarSize={36} />
            ))}
            {hasOther && (
              <Bar dataKey="other" name="Other tiers" stackId="tiers"
                fill={tierColor(MAX_TIER_SERIES)} stroke={SURFACE} strokeWidth={2} maxBarSize={36} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {breakdown?.has_tier_data && (
        <>
          <div className="tier-share">
            <div className="tier-share-head">
              <h3>Share of tickets vs share of revenue</h3>
              <div className="legend">
                <span>
                  <i style={{ background: INK_MUTED }} /> Tickets
                </span>
                <span>
                  <i style={{ background: INK }} /> Revenue
                </span>
              </div>
            </div>
            <ul>
              {breakdown.tiers.map((tier) => (
                <li key={tier.tier_id}>
                  <div className="tier-share-name">
                    {tier.name}
                    {tier.sold_out && <span className="pill pill-low">Sold out</span>}
                  </div>
                  <div className="tier-share-bars">
                    <div className="share-row">
                      <span className="share-bar" style={{ width: `${(tier.share_of_tickets_pct ?? 0) * SHARE_BAR_SCALE}%`, background: INK_MUTED }} />
                      <span className="share-label">Tickets {formatPct(tier.share_of_tickets_pct ?? 0)}</span>
                    </div>
                    <div className="share-row">
                      <span className="share-bar" style={{ width: `${(tier.share_of_revenue_pct ?? 0) * SHARE_BAR_SCALE}%`, background: INK }} />
                      <span className="share-label">Revenue {formatPct(tier.share_of_revenue_pct ?? 0)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="sales-stats">
            <StatCard label="Realized average price" value={formatKes(breakdown.realized_average_price)}
              note={`base price ${formatKes(breakdown.base_price)}`} />
            <StatCard label="Revenue from tiers" value={formatKes(breakdown.revenue_total)}
              note={`${formatNumber(breakdown.tickets_sold_total)} tickets`} />
          </div>
          <p className="live-note">{breakdown.explanation}</p>
        </>
      )}
    </div>
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
                <td title={s.tier_sales ? s.tier_sales.map((t) => `${t.tier_name}: ${t.tickets_sold}`).join(", ") : undefined}>
                  {formatNumber(s.tickets_sold_total)}
                  {s.tier_sales && <div className="event-sub">{s.tier_sales.length} tiers</div>}
                </td>
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

export function SalesTrackingSection({ event, tiers = [], onEventUpdated, onTiersChanged }) {
  const snapshotsQuery = useApiData(`/events/${event.id}/sales-snapshots`);
  const progressQuery = useApiData(`/events/${event.id}/sales-progress`);
  const [liveVersion, setLiveVersion] = useState(0);
  const [savedNotice, setSavedNotice] = useState("");
  const [gateOpen, setGateOpen] = useState(false);

  const snapshots = snapshotsQuery.data ?? [];
  const progress = progressQuery.data;
  const latest = snapshots.length ? snapshots[snapshots.length - 1] : null;
  const latestTierSnapshot = [...snapshots].reverse().find((s) => s.tier_sales) ?? null;

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
          {tiers.length > 0 && (
            <>
              <TierSalesCharts key={`${liveVersion}:${tiers.map((t) => t.id).join("-")}`} eventId={event.id} snapshots={snapshots} tiers={tiers} />
              <TierAnalyticsPanel key={`analytics-${liveVersion}:${tiers.map((t) => t.id).join("-")}`} eventId={event.id} />
            </>
          )}
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

      {tiers.length > 0 && (
        <div className="gate-launch">
          <button type="button" className="ghost-button" onClick={() => setGateOpen(true)}>
            Open gate mode
          </button>
          <span className="event-sub">Full-screen tier counters for the door, with one Save count button.</span>
        </div>
      )}
      {gateOpen && (
        <GateMode
          event={event}
          tiers={tiers}
          snapshots={snapshots}
          latestTierSnapshot={latestTierSnapshot}
          onClose={() => setGateOpen(false)}
          onSaved={reloadSales}
        />
      )}

      {tiers.length > 0 ? (
        <TierDailyEntryForm
          key={`${tiers.map((t) => t.id).join("-")}:${latestTierSnapshot?.id ?? "none"}`}
          event={event}
          tiers={tiers}
          snapshots={snapshots}
          latestTierSnapshot={latestTierSnapshot}
          onSaved={() => {
            setSavedNotice("Entry saved.");
            reloadSales();
          }}
        />
      ) : (
        <SnapshotForm
          eventId={event.id}
          latest={latest}
          onSaved={() => {
            setSavedNotice("Snapshot saved.");
            reloadSales();
          }}
        />
      )}
      <Notice tone="success" onDismiss={() => setSavedNotice("")}>
        {savedNotice}
      </Notice>

      <SalesImport
        event={event}
        tiers={tiers}
        onImported={() => {
          reloadSales();
          onTiersChanged?.();
        }}
      />
    </section>
  );
}
