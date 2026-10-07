import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiDelete, apiPost } from "../api";
import { localInputValue, withLocalOffset } from "../datetime";
import { byRecordedAt, clampEntry, dailySales, latestSnapshot, tierEntry, tierTotals } from "../dailySales";
import { formatDate, formatDateTime, formatKes, formatNumber } from "../format";
import { INK } from "../theme";
import { tierColor } from "../tiers";
import { TierStepper } from "./SalesEntry";
import { Field, Notice } from "./ui";

function emptyAmounts(tiers) {
  return Object.fromEntries(tiers.map((tier) => [tier.id, ""]));
}

/**
 * Tier-mode sales entry: the user types what was sold in THIS entry (e.g.
 * today) per tier. The form adds it to the latest cumulative values and
 * sends cumulative totals, exactly as the API expects.
 */
export function TierDailyEntryForm({ event, tiers, snapshots, latestTierSnapshot, onSaved }) {
  const [recordedAt, setRecordedAt] = useState(() => localInputValue(new Date()));
  const [amounts, setAmounts] = useState(() => emptyAmounts(tiers));
  const [attendance, setAttendance] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  const { sold: soldBefore } = tierTotals(tiers, latestTierSnapshot);
  const rows = tiers.map((tier) => ({
    tier,
    ...tierEntry(tier, soldBefore[tier.id], Number(amounts[tier.id]) || 0),
  }));

  const soldToday = rows.reduce((sum, r) => sum + r.entered, 0);
  const revenueToday = rows.reduce((sum, r) => sum + r.entered * r.tier.price, 0);
  const allocated = rows.filter((r) => r.tier.quantity_available != null);
  const allocatedTotal = allocated.reduce((sum, r) => sum + r.tier.quantity_available, 0);
  const remainingTotal = allocated.reduce((sum, r) => sum + r.remainingAfter, 0);
  const unallocated = event.capacity - allocatedTotal;
  const withoutQuantity = rows.length - allocated.length;

  // Entries must be added in time order (values are cumulative).
  const latest = latestSnapshot(snapshots);
  const outOfOrder =
    latest && recordedAt && new Date(recordedAt) < new Date(latest.recorded_at);

  function setAmount(tierId, value, max) {
    setAmounts((prev) => ({ ...prev, [tierId]: value === "" ? "" : String(clampEntry(value, max)) }));
  }

  function startEventDayCount() {
    setNotice(null);
    setRecordedAt(localInputValue(new Date()));
    setAmounts(emptyAmounts(tiers));
    setNotes("Event-day count");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (outOfOrder) return;
    setSubmitting(true);
    setNotice(null);
    try {
      await apiPost(`/events/${event.id}/sales-snapshots`, {
        recorded_at: withLocalOffset(recordedAt),
        // Cumulative values: tiers with nothing entered are sent unchanged.
        tier_sales: rows.map((r) => ({ tier_id: r.tier.id, tickets_sold: r.after })),
        attendance_checked_in: attendance === "" ? null : Number(attendance),
        notes: notes || null,
      });
      setAmounts(emptyAmounts(tiers));
      setAttendance("");
      setNotes("");
      onSaved();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to save the entry" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="lineup-form" onSubmit={handleSubmit}>
      <div className="form-section">
        Sales for {recordedAt ? formatDate(recordedAt.slice(0, 10)) : "…"}{" "}
        <span className="optional">enter what was sold in this entry, per tier</span>
      </div>
      <div className="form-grid">
        <Field label="Date and time" wide>
          <input type="datetime-local" value={recordedAt}
            onChange={(e) => setRecordedAt(e.target.value)} required />
        </Field>
        {rows.map((r, index) => {
          const quantity = r.tier.quantity_available;
          const hint =
            `${formatKes(r.tier.price)} · ${formatNumber(r.soldBefore)} sold so far` +
            (quantity != null ? ` · ${formatNumber(r.remainingAfter)} left` : "");
          return (
            <Field key={r.tier.id} wide label={
              <span className="entry-label">
                {r.tier.name} sold in this entry
                {r.soldOut && <span className="pill pill-low">Sold out</span>}
                {r.low && <span className="pill pill-mid">Low</span>}
              </span>
            }>
              <span className="tier-input">
                <i className="tier-swatch" style={{ background: tierColor(index) }} aria-hidden="true" />
                <TierStepper
                  label={`${r.tier.name} sold in this entry`}
                  value={amounts[r.tier.id] ?? ""}
                  max={r.remainingBefore ?? undefined}
                  previous={null}
                  onChange={(value) => setAmount(r.tier.id, value, r.remainingBefore)}
                />
                <span className="entry-after" title="Cumulative total sent to the server">
                  = {formatNumber(r.after)} total
                </span>
              </span>
              <span className={r.low || r.soldOut ? "field-hint entry-hint low" : "field-hint entry-hint"}>
                {hint}
              </span>
            </Field>
          );
        })}
        <Field label="Attendance checked in (cumulative)">
          <input type="number" min="0" value={attendance} onChange={(e) => setAttendance(e.target.value)} />
        </Field>
        <Field label="Notes" wide>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Early-bird phase closed" />
        </Field>
      </div>

      <div className="entry-summary" aria-live="polite">
        <p>
          Sold in this entry: <b>{formatNumber(soldToday)}</b> tickets ({formatKes(revenueToday)} revenue)
        </p>
        {allocated.length > 0 && (
          <p>
            Total remaining across tiers: <b>{formatNumber(remainingTotal)}</b> of{" "}
            {formatNumber(allocatedTotal)} allocated
            {withoutQuantity > 0 && ` (${withoutQuantity} tier${withoutQuantity === 1 ? " has" : "s have"} no quantity set)`}
          </p>
        )}
        {unallocated > 0 && (
          <p className="event-sub">
            {formatNumber(unallocated)} of the {formatNumber(event.capacity)} capacity is not allocated to any tier.
          </p>
        )}
      </div>

      {outOfOrder && (
        <Notice tone="error">
          Entries must be added in time order. The latest entry is from {formatDateTime(latest.recorded_at)};
          choose a date and time after it, or undo that entry first.
        </Notice>
      )}
      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>
      <div className="modal-actions">
        <button type="button" className="ghost-button" onClick={startEventDayCount}>
          Log gate / event-day count
        </button>
        <button type="submit" className="primary-button" disabled={submitting || outOfOrder}>
          {submitting ? "Saving…" : "Save entry"}
        </button>
      </div>
    </form>
  );
}

/**
 * Deletes the most recent snapshot after a confirmation that names its date
 * and numbers. Daily entries build on each other, so a wrong entry should be
 * undone before adding the next one.
 */
export function UndoLastEntry({ eventId, snapshots, tiers, onUndone }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const ordered = [...snapshots].sort(byRecordedAt);
  const last = ordered.at(-1);
  if (!last) return null;
  const previous = ordered.at(-2) ?? null;

  const added = last.tickets_sold_total - (previous?.tickets_sold_total ?? 0);
  const tierChanges = last.tier_sales
    ? (() => {
        const before = tierTotals(tiers, previous).sold;
        return last.tier_sales
          .map((row) => ({ name: row.tier_name, delta: row.tickets_sold - (before[row.tier_id] ?? 0) }))
          .filter((change) => change.delta !== 0);
      })()
    : [];

  async function handleUndo() {
    setBusy(true);
    setNotice(null);
    try {
      await apiDelete(`/events/${eventId}/sales-snapshots/${last.id}`);
      setConfirming(false);
      setNotice({ tone: "success", text: `Entry of ${formatDateTime(last.recorded_at)} was deleted.` });
      onUndone();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to delete the entry" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="undo-entry">
      {confirming ? (
        <div className="confirm-box">
          <strong>Delete the entry of {formatDateTime(last.recorded_at)}?</strong>
          <ul>
            <li>
              It recorded <b>{formatNumber(last.tickets_sold_total)}</b> tickets in total
              {last.revenue_to_date != null && <> and <b>{formatKes(last.revenue_to_date)}</b></>}
              {previous && (
                <> ({added >= 0 ? "+" : ""}{formatNumber(added)} tickets compared with the entry before)</>
              )}
              .
            </li>
            {tierChanges.length > 0 && (
              <li>
                {tierChanges
                  .map((c) => `${c.name} ${c.delta > 0 ? "+" : ""}${formatNumber(c.delta)}`)
                  .join(" · ")}
              </li>
            )}
            {last.notes && <li>Note: {last.notes}</li>}
          </ul>
          <p className="event-sub">
            Totals go back to {previous ? `the entry of ${formatDateTime(previous.recorded_at)}` : "no entries"}.
            This cannot be undone.
          </p>
          <div className="modal-actions">
            <button type="button" className="ghost-button" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button type="button" className="primary-button" onClick={handleUndo} disabled={busy}>
              {busy ? "Deleting…" : "Delete this entry"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ghost-button" onClick={() => setConfirming(true)}>
          Undo last entry
        </button>
      )}
      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>
    </div>
  );
}

const MAX_DAILY_SERIES = 6;
// Chart surface, used for the 2px gaps between stacked segments.
const SURFACE = "#141416";

function shortDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/**
 * Tickets sold per day per tier (Nairobi calendar days), from the
 * differences between cumulative snapshots.
 */
export function DailySalesView({ snapshots, tiers }) {
  const days = dailySales(snapshots, tiers);
  if (days.length === 0) return null;

  const shown = tiers.slice(0, MAX_DAILY_SERIES);
  const hasOther = tiers.length > MAX_DAILY_SERIES;
  const nameById = Object.fromEntries(tiers.map((t) => [t.id, t.name]));
  const data = days.map((d) => {
    const row = { label: shortDay(d.day), total: d.total, revenue: d.revenue, other: 0 };
    Object.entries(d.byTier).forEach(([tierId, sold]) => {
      const index = tiers.findIndex((t) => String(t.id) === tierId);
      if (index >= 0 && index < MAX_DAILY_SERIES) row[`t${tierId}`] = sold;
      else row.other += sold;
    });
    return row;
  });
  const recorded = days.filter((d) => !d.noEntry);
  const totalSold = recorded.reduce((sum, d) => sum + d.total, 0);
  const best = recorded.reduce((top, d) => (d.total > (top?.total ?? -1) ? d : top), null);

  return (
    <div className="daily-sales">
      <h3>Tickets sold per day</h3>
      <p className="metric-note">
        Differences between entries, grouped by calendar day in Nairobi time. The first entry counts
        everything sold up to that point. {formatNumber(totalSold)} tickets over {days.length} day
        {days.length === 1 ? "" : "s"}
        {best && best.total > 0 && `; best day ${formatDate(best.day)} with ${formatNumber(best.total)}`}.
      </p>
      <div className="chart-box">
        <div className="legend" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          {shown.map((tier, index) => (
            <span key={tier.id}>
              <i style={{ background: tierColor(index) }} /> {tier.name}
            </span>
          ))}
          {hasOther && (
            <span>
              <i style={{ background: tierColor(MAX_DAILY_SERIES) }} /> Other tiers
            </span>
          )}
          <span>
            <i className="legend-dash" style={{ borderColor: INK }} /> Total per day
          </span>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis width={48} tickFormatter={(v) => formatNumber(v)} />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(value, name) => [formatNumber(value), name]}
            />
            {shown.map((tier, index) => (
              <Bar key={tier.id} dataKey={`t${tier.id}`} name={tier.name} stackId="day"
                fill={tierColor(index)} stroke={SURFACE} strokeWidth={2} maxBarSize={32} />
            ))}
            {hasOther && (
              <Bar dataKey="other" name="Other tiers" stackId="day"
                fill={tierColor(MAX_DAILY_SERIES)} stroke={SURFACE} strokeWidth={2} maxBarSize={32} />
            )}
            <Line type="linear" dataKey="total" name="Total per day" stroke={INK}
              strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Tickets</th>
              <th>Revenue</th>
              <th>By tier</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day} className={d.noEntry ? "no-entry" : undefined}>
                <td className="nowrap">{formatDate(d.day)}</td>
                <td>{d.noEntry ? <span className="event-sub">no entry</span> : formatNumber(d.total)}</td>
                <td className="nowrap">{d.noEntry ? "-" : formatKes(d.revenue)}</td>
                <td className="event-sub">
                  {d.noEntry
                    ? "-"
                    : Object.entries(d.byTier)
                        .map(([tierId, sold]) => `${nameById[tierId] ?? "Tier"} ${formatNumber(sold)}`)
                        .join(" · ") || "0"}
                  {d.entries > 1 && ` (${d.entries} entries)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
