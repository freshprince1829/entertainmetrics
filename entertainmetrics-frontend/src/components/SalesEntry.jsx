import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiPost } from "../api";
import { nowWithOffset } from "../datetime";
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

function startingCounts(tiers, snapshot) {
  const rows = {};
  (snapshot?.tier_sales ?? []).forEach((row) => {
    rows[row.tier_id] = row;
  });
  const sold = {};
  const scanned = {};
  tiers.forEach((tier) => {
    sold[tier.id] = rows[tier.id]?.tickets_sold ?? 0;
    scanned[tier.id] = rows[tier.id]?.checked_in ?? 0;
  });
  return { sold, scanned, trackScans: (snapshot?.tier_sales ?? []).some((r) => r.checked_in != null) };
}

/**
 * Full-screen, tablet-friendly counter for the gate. Counts start from the
 * latest snapshot (they are cumulative); "Save count" writes one snapshot of
 * the current values.
 */
export function GateMode({ event, tiers, latestTierSnapshot, onClose, onSaved }) {
  const start = startingCounts(tiers, latestTierSnapshot);
  const [sold, setSold] = useState(start.sold);
  const [scanned, setScanned] = useState(start.scanned);
  const [trackScans, setTrackScans] = useState(start.trackScans);
  const [saved, setSaved] = useState(start.sold);
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

  function bump(setter, tier, delta, max) {
    setter((prev) => ({ ...prev, [tier.id]: clamp(prev[tier.id] + delta, max) }));
  }

  const totals = tiers.reduce(
    (acc, tier) => {
      acc.sold += sold[tier.id];
      acc.revenue += sold[tier.id] * tier.price;
      acc.unsaved += sold[tier.id] - saved[tier.id];
      acc.scanned += scanned[tier.id];
      return acc;
    },
    { sold: 0, revenue: 0, unsaved: 0, scanned: 0 },
  );

  async function handleSave() {
    setSaving(true);
    setNotice(null);
    try {
      const snapshot = await apiPost(`/events/${event.id}/sales-snapshots`, {
        recorded_at: nowWithOffset(),
        notes: "Gate mode count",
        tier_sales: tiers.map((tier) => ({
          tier_id: tier.id,
          tickets_sold: sold[tier.id],
          ...(trackScans ? { checked_in: Math.min(scanned[tier.id], sold[tier.id]) } : {}),
        })),
      });
      setSaved(sold);
      setNotice({ tone: "success", text: `Count saved at ${formatDateTime(snapshot.recorded_at)}.` });
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
            {formatNumber(totals.sold)} sold · {formatKes(totals.revenue)}
            {trackScans && ` · ${formatNumber(totals.scanned)} scanned in`}
            {totals.unsaved !== 0 && (
              <b className="gate-unsaved"> · {totals.unsaved > 0 ? "+" : ""}{formatNumber(totals.unsaved)} not saved yet</b>
            )}
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
        {tiers.map((tier, index) => {
          const max = tier.quantity_available ?? undefined;
          const soldOut = max != null && sold[tier.id] >= max;
          return (
            <section key={tier.id} className="gate-tile">
              <div className="gate-tile-head">
                <i className="tier-swatch" style={{ background: tierColor(index) }} aria-hidden="true" />
                <h3>{tier.name}</h3>
                <span>{formatKes(tier.price)}</span>
              </div>
              <p className="gate-count" aria-live="polite">{formatNumber(sold[tier.id])}</p>
              <p className="gate-sub">
                sold
                {max != null && ` of ${formatNumber(max)}`}
                {sold[tier.id] !== saved[tier.id] && ` · ${sold[tier.id] - saved[tier.id] > 0 ? "+" : ""}${sold[tier.id] - saved[tier.id]} unsaved`}
              </p>
              <div className="gate-buttons">
                <button type="button" className="gate-button minor" onClick={() => bump(setSold, tier, -1, max)}
                  disabled={sold[tier.id] <= 0} aria-label={`${tier.name}: undo one sale`}>
                  −1
                </button>
                <button type="button" className="gate-button" onClick={() => bump(setSold, tier, 1, max)}
                  disabled={soldOut} aria-label={`${tier.name}: plus 1 sold`}>
                  +1
                </button>
                <button type="button" className="gate-button" onClick={() => bump(setSold, tier, 10, max)}
                  disabled={soldOut} aria-label={`${tier.name}: plus 10 sold`}>
                  +10
                </button>
              </div>
              {trackScans && (
                <div className="gate-scans">
                  <span>
                    Scanned in <b>{formatNumber(scanned[tier.id])}</b>
                  </span>
                  <button type="button" className="gate-button minor" onClick={() => bump(setScanned, tier, 1, sold[tier.id])}
                    disabled={scanned[tier.id] >= sold[tier.id]} aria-label={`${tier.name}: plus 1 scanned in`}>
                    +1
                  </button>
                  <button type="button" className="gate-button minor" onClick={() => bump(setScanned, tier, 10, sold[tier.id])}
                    disabled={scanned[tier.id] >= sold[tier.id]} aria-label={`${tier.name}: plus 10 scanned in`}>
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
