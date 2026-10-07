import { useState } from "react";
import { apiDelete, apiPost } from "../api";
import { localInputValue, withLocalOffset } from "../datetime";
import { byRecordedAt, clampEntry, latestSnapshot, tierEntry, tierTotals } from "../dailySales";
import { formatDate, formatDateTime, formatKes, formatNumber } from "../format";
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
