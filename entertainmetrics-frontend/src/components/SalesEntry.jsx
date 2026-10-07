import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiPost } from "../api";
import { nowWithOffset } from "../datetime";
import { clampEntry, latestSnapshot, tierEntry, tierTotals } from "../dailySales";
import { formatDateTime, formatKes, formatNumber } from "../format";
import { tierColor } from "../tiers";
import { Notice } from "./ui";

function clamp(value, max) {
  const n = Math.max(0, value);
  return max != null ? Math.min(n, max) : n;
}

/**
 * Cumulative count input with -1 / +1 / +10 buttons and the change since the
 * last snapshot. `value` is a string ("" = not recorded) like a normal input.
 */
export function TierStepper({ value, onChange, max, previous, label }) {
  const current = value === "" || value == null ? null : Number(value);
  const step = (delta) => onChange(String(clamp((current ?? previous ?? 0) + delta, max)));
  const change = current != null && previous != null ? current - previous : null;

  return (
    <div className="stepper">
      <button type="button" className="stepper-button" onClick={() => step(-1)}
        aria-label={`${label}: minus 1`} disabled={!current}>
        −
      </button>
      <input type="number" min="0" max={max ?? undefined} value={value ?? ""}
        aria-label={label} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="stepper-button" onClick={() => step(1)} aria-label={`${label}: plus 1`}>
        +1
      </button>
      <button type="button" className="stepper-button" onClick={() => step(10)} aria-label={`${label}: plus 10`}>
        +10
      </button>
      {change != null && change !== 0 && (
        <span className={change > 0 ? "stepper-change up" : "stepper-change down"}>
          {change > 0 ? "+" : ""}
          {formatNumber(change)} since last
        </span>
      )}
    </div>
  );
}

function zeroes(tiers) {
  return Object.fromEntries(tiers.map((tier) => [tier.id, 0]));
}

/**
 * Full-screen, tablet-friendly counter for the gate. The +1 / +10 tiles add
 * to today's entry (starting at 0) on top of the latest cumulative values;
 * "Save count" writes one snapshot with the cumulative totals.
 */
export function GateMode({ event, tiers, snapshots, latestTierSnapshot, onClose, onSaved }) {
  const [base, setBase] = useState(() => tierTotals(tiers, latestTierSnapshot));
  const [entry, setEntry] = useState(() => zeroes(tiers));
  const [scanEntry, setScanEntry] = useState(() => zeroes(tiers));
  const [trackScans, setTrackScans] = useState(() =>
    Object.values(tierTotals(tiers, latestTierSnapshot).checkedIn).some((v) => v != null),
  );
  const [latestTime, setLatestTime] = useState(() => latestSnapshot(snapshots)?.recorded_at ?? null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Escape closes gate mode only, not the event drawer underneath.
    function onKey(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const rows = tiers.map((tier) => {
    const view = tierEntry(tier, base.sold[tier.id], entry[tier.id]);
    const checkedBefore = base.checkedIn[tier.id] ?? 0;
    return { tier, ...view, checkedBefore, checkedAfter: Math.min(checkedBefore + scanEntry[tier.id], view.after) };
  });

  function addSale(r, delta) {
    setEntry((prev) => ({ ...prev, [r.tier.id]: clampEntry(prev[r.tier.id] + delta, r.remainingBefore) }));
  }

  function addScan(r, delta) {
    // Scan-ins can never exceed tickets sold (including this entry).
    const max = Math.max(r.after - r.checkedBefore, 0);
    setScanEntry((prev) => ({ ...prev, [r.tier.id]: clampEntry(prev[r.tier.id] + delta, max) }));
  }

  const soldToday = rows.reduce((sum, r) => sum + r.entered, 0);
  const revenueToday = rows.reduce((sum, r) => sum + r.entered * r.tier.price, 0);
  const allocated = rows.filter((r) => r.tier.quantity_available != null);
  const remainingTotal = allocated.reduce((sum, r) => sum + r.remainingAfter, 0);
  const allocatedTotal = allocated.reduce((sum, r) => sum + r.tier.quantity_available, 0);
  const scannedTotal = rows.reduce((sum, r) => sum + r.checkedAfter, 0);
  const unsaved = soldToday > 0 || Object.values(scanEntry).some((v) => v > 0);

  async function handleSave() {
    const now = new Date();
    if (latestTime && now < new Date(latestTime)) {
      setNotice({ tone: "error", text: `Entries must be in time order: the latest entry is from ${formatDateTime(latestTime)}.` });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const snapshot = await apiPost(`/events/${event.id}/sales-snapshots`, {
        recorded_at: nowWithOffset(),
        notes: "Gate mode count",
        tier_sales: rows.map((r) => ({
          tier_id: r.tier.id,
          tickets_sold: r.after,
          ...(trackScans ? { checked_in: r.checkedAfter } : {}),
        })),
      });
      // The saved totals become the new base; today's counters restart at 0.
      setBase({
        sold: Object.fromEntries(rows.map((r) => [r.tier.id, r.after])),
        checkedIn: Object.fromEntries(
          rows.map((r) => [r.tier.id, trackScans ? r.checkedAfter : base.checkedIn[r.tier.id]]),
        ),
      });
      setEntry(zeroes(tiers));
      setScanEntry(zeroes(tiers));
      setLatestTime(snapshot.recorded_at);
      setNotice({
        tone: "success",
        text: `Count saved at ${formatDateTime(snapshot.recorded_at)}: ${formatNumber(soldToday)} tickets (${formatKes(revenueToday)}).`,
      });
      onSaved();
    } catch (err) {
      setNotice({ tone: "error", text: err.message || "Failed to save the count" });
    } finally {
      setSaving(false);
    }
  }

  // Rendered into <body>: the event drawer's overlay uses backdrop-filter,
  // which would otherwise trap this fixed, full-screen layer inside it.
  return createPortal(
    <div className="gate-mode" role="dialog" aria-modal="true" aria-label="Gate mode">
      <header className="gate-head">
        <div>
          <h2>Gate mode · {event.event_name}</h2>
          <p>
            Sold in this entry: <b className="gate-unsaved">{formatNumber(soldToday)}</b> ({formatKes(revenueToday)})
            {allocated.length > 0 && ` · ${formatNumber(remainingTotal)} of ${formatNumber(allocatedTotal)} left`}
            {trackScans && ` · ${formatNumber(scannedTotal)} scanned in`}
            {unsaved && <b className="gate-unsaved"> · not saved yet</b>}
          </p>
        </div>
        <div className="gate-actions">
          <label className="checkbox">
            <input type="checkbox" checked={trackScans} onChange={(e) => setTrackScans(e.target.checked)} />
            Count scan-ins
          </label>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button gate-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save count"}
          </button>
        </div>
      </header>

      <Notice tone={notice?.tone} onDismiss={() => setNotice(null)}>
        {notice?.text}
      </Notice>

      <div className="gate-grid">
        {rows.map((r, index) => {
          const full = r.remainingAfter === 0;
          return (
            <section key={r.tier.id} className="gate-tile">
              <div className="gate-tile-head">
                <i className="tier-swatch" style={{ background: tierColor(index) }} aria-hidden="true" />
                <h3>{r.tier.name}</h3>
                <span>{formatKes(r.tier.price)}</span>
              </div>
              <p className="gate-count" aria-live="polite">{formatNumber(r.entered)}</p>
              <p className={r.low || r.soldOut ? "gate-sub low" : "gate-sub"}>
                sold in this entry · {formatNumber(r.after)} total
                {r.remainingAfter != null && ` · ${formatNumber(r.remainingAfter)} left`}
                {r.soldOut && " · Sold out"}
              </p>
              <div className="gate-buttons">
                <button type="button" className="gate-button minor" onClick={() => addSale(r, -1)}
                  disabled={r.entered <= 0} aria-label={`${r.tier.name}: undo one sale`}>
                  −1
                </button>
                <button type="button" className="gate-button" onClick={() => addSale(r, 1)}
                  disabled={full} aria-label={`${r.tier.name}: plus 1 sold`}>
                  +1
                </button>
                <button type="button" className="gate-button" onClick={() => addSale(r, 10)}
                  disabled={full} aria-label={`${r.tier.name}: plus 10 sold`}>
                  +10
                </button>
              </div>
              {trackScans && (
                <div className="gate-scans">
                  <span>
                    Scanned in <b>{formatNumber(r.checkedAfter)}</b>
                  </span>
                  <button type="button" className="gate-button minor" onClick={() => addScan(r, 1)}
                    disabled={r.checkedAfter >= r.after} aria-label={`${r.tier.name}: plus 1 scanned in`}>
                    +1
                  </button>
                  <button type="button" className="gate-button minor" onClick={() => addScan(r, 10)}
                    disabled={r.checkedAfter >= r.after} aria-label={`${r.tier.name}: plus 10 scanned in`}>
                    +10
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
