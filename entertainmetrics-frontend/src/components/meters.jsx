import { Link } from "react-router-dom";
import { INK, POSITIVE, NEGATIVE, TRACK } from "../theme";
import { Icon } from "./ui";

/**
 * Radial tick gauge: `ticks` marks around a 270° arc, lit in proportion to
 * `ratio` (0–1). Children are rendered in the centre.
 */
export function TickGauge({ ratio, label, ticks = 64, size = 232, children }) {
  const clamped = Math.max(0, Math.min(1, ratio ?? 0));
  const lit = Math.round(clamped * ticks);
  const c = size / 2;
  const outer = c - 6;
  const inner = outer - 22;

  return (
    <div className="tick-gauge" style={{ width: size, height: size * 0.86 }}>
      <svg width={size} height={size * 0.86} viewBox={`0 0 ${size} ${size * 0.86}`} role="img" aria-label={label}>
        {Array.from({ length: ticks }, (_, i) => {
          const angle = ((135 + (i * 270) / (ticks - 1)) * Math.PI) / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const on = i < lit;
          return (
            <line
              key={i}
              x1={c + inner * cos}
              y1={c + inner * sin}
              x2={c + outer * cos}
              y2={c + outer * sin}
              stroke={on ? INK : TRACK}
              strokeOpacity={on ? 0.45 + 0.55 * (i / Math.max(1, lit)) : 1}
              strokeWidth={3.2}
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <div className="tick-gauge-center">{children}</div>
    </div>
  );
}

/** Horizontal meter made of thin vertical ticks, lit in proportion to `ratio`. */
export function TickMeter({ ratio, label, ticks = 56 }) {
  const clamped = Math.max(0, Math.min(1, ratio ?? 0));
  const lit = Math.round(clamped * ticks);
  return (
    <div className="tick-meter" role="img" aria-label={label}>
      {Array.from({ length: ticks }, (_, i) => (
        <span key={i} className={i < lit ? "on" : ""} />
      ))}
    </div>
  );
}

/**
 * Up/down change badge. `inverse` flips good/bad (e.g. for error rates,
 * where going down is good). Colour always comes with an arrow icon.
 */
export function DeltaBadge({ value, inverse = false, suffix = "vs prior period" }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className="delta delta-none">No prior data</span>;
  }
  const up = value >= 0;
  const good = inverse ? !up : up;
  return (
    <span className="delta">
      <span
        className="delta-icon"
        style={{ background: good ? POSITIVE : NEGATIVE }}
        aria-hidden="true"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0a0a0b" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
          {up ? <path d="M12 19V5M6 11l6-6 6 6" /> : <path d="M12 5v14M6 13l6 6 6-6" />}
        </svg>
      </span>
      <span className={good ? "delta-good" : "delta-bad"}>
        {up ? "+" : "−"}
        {Math.abs(value).toFixed(1)}%
      </span>
      {suffix && <span className="delta-suffix">{suffix}</span>}
    </span>
  );
}

/** Full-width "view more" link at the foot of a card. */
export function PanelButton({ to, children }) {
  return (
    <Link to={to} className="panel-button">
      {children} <Icon name="arrow" size={14} />
    </Link>
  );
}
