import { formatCompact, formatKes, formatNumber } from "../format";
import { ACTUAL, FORECAST, TRACK } from "../theme";

/**
 * "1,850 expected · range 1,500 – 2,300". Predictions made before ranges
 * existed have no band, so they show the single value as before.
 */
export function RangeValue({ expected, low, high, money = false, note, compact = false }) {
  const format = money ? formatKes : formatNumber;
  if (low == null || high == null) return <>{format(expected)}</>;
  // Compact money ranges use short numbers so table cells stay narrow.
  const bound = money && compact ? formatCompact : formatNumber;
  return (
    <span className={compact ? "range-value compact" : "range-value"} title={note || undefined}>
      <span className="range-expected">{format(expected)}</span>
      <span className="range-span">
        {compact ? "" : "expected · "}range {money ? "KES " : ""}
        {bound(low)} – {bound(high)}
      </span>
    </span>
  );
}

/**
 * Small horizontal band on a 0 – max track: the shaded segment is the
 * predicted range, the solid tick the expected value and, when given, the
 * outlined tick the actual result.
 */
export function RangeBar({ expected, low, high, max, actual, label }) {
  if (low == null || high == null || !max) return null;
  const pos = (value) => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  const width = `${Math.max(0.5, ((high - low) / max) * 100)}%`;
  return (
    <div className="range-bar" role="img" aria-label={label ?? `Range ${low} to ${high}, expected ${expected}`}>
      <span className="range-track" style={{ background: TRACK }} />
      <span className="range-band" style={{ left: pos(low), width, background: FORECAST }} />
      <span className="range-tick" style={{ left: pos(expected), background: FORECAST }} />
      {actual != null && (
        <span className="range-actual" style={{ left: pos(actual), borderColor: ACTUAL }} />
      )}
    </div>
  );
}

/** Expandable explanation of how the range was built. */
export function RangeNote({ note }) {
  if (!note) return null;
  return (
    <details className="range-note">
      <summary>How this range was built</summary>
      <p>{note}</p>
    </details>
  );
}
