import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

/* Stylised prediction range: a forecast band (low / expected / high) running
   to the doors, with ticket sales so far climbing into it. Illustrative
   only: no axis values, no real event data. */
function RangeHero() {
  return (
    <svg className="landing-chart" viewBox="0 0 560 360" role="img"
      aria-label="Illustration: a predicted attendance range narrowing toward the event date, with ticket sales so far rising into the range">
      <defs>
        <linearGradient id="band" x1="0" x2="1">
          <stop offset="0" stopColor="#7A8AD6" stopOpacity="0.08" />
          <stop offset="1" stopColor="#7A8AD6" stopOpacity="0.28" />
        </linearGradient>
      </defs>
      {/* grid */}
      {[80, 150, 220, 290].map((y) => (
        <line key={y} x1="32" x2="528" y1={y} y2={y} className="lc-grid" />
      ))}
      {/* forecast band: wide early, narrower as sales evidence builds */}
      <path className="lc-band" fill="url(#band)"
        d="M32 250 C150 205 300 150 470 96 L470 176 C300 214 150 262 32 300 Z" />
      <path className="lc-edge" d="M32 250 C150 205 300 150 470 96" />
      <path className="lc-edge" d="M32 300 C150 262 300 214 470 176" />
      <path className="lc-expected" d="M32 275 C150 234 300 182 470 136" />
      {/* today and doors open */}
      <line x1="300" x2="300" y1="56" y2="318" className="lc-today" />
      <line x1="470" x2="470" y1="56" y2="318" className="lc-doors" />
      {/* ticket sales so far */}
      <path className="lc-sales" pathLength="1"
        d="M32 318 L74 312 L118 300 L160 288 L196 270 L232 252 L268 222 L300 196" />
      <circle cx="300" cy="196" r="6" className="lc-sales-dot" />
      {/* labels */}
      <text x="478" y="100" className="lc-label">High</text>
      <text x="478" y="140" className="lc-label lc-label-strong">Expected</text>
      <text x="478" y="180" className="lc-label">Low</text>
      <text x="306" y="50" className="lc-label">Today</text>
      <text x="420" y="338" className="lc-label">Doors open</text>
      <text x="150" y="338" className="lc-label lc-label-sales">Ticket sales so far</text>
    </svg>
  );
}

const FEATURES = [
  {
    title: "Predict attendance and revenue",
    body: "Every forecast comes as a range: a low, an expected and a high figure, so you plan for what is likely and what is possible.",
    glyph: (
      <svg viewBox="0 0 48 32" aria-hidden="true">
        <path d="M2 24 C16 18 30 10 46 6 L46 16 C30 18 16 26 2 30 Z" fill="#7A8AD6" fillOpacity="0.3" />
        <path d="M2 27 C16 22 30 14 46 11" stroke="#7A8AD6" strokeWidth="2" fill="none" />
      </svg>
    ),
  },
  {
    title: "Track ticket sales by tier",
    body: "Log sales each day or count at the gate. See what each tier sold, what is left and how fast it is moving.",
    glyph: (
      <svg viewBox="0 0 48 32" aria-hidden="true">
        {[[4, 18], [16, 12], [28, 7], [40, 3]].map(([x, top]) => (
          <g key={x}>
            <rect x={x} y={top} width="7" height={(30 - top) * 0.55} fill="#C98232" />
            <rect x={x} y={top + (30 - top) * 0.55 + 1} width="7" height={(30 - top) * 0.45 - 1} fill="#C98232" fillOpacity="0.45" />
          </g>
        ))}
      </svg>
    ),
  },
  {
    title: "Compare predictions with results",
    body: "After the event, see whether the actual attendance landed inside the predicted range, event by event.",
    glyph: (
      <svg viewBox="0 0 48 32" aria-hidden="true">
        <rect x="4" y="9" width="40" height="12" rx="3" fill="#7A8AD6" fillOpacity="0.3" />
        <line x1="22" x2="22" y1="6" y2="24" stroke="#7A8AD6" strokeWidth="2" />
        <rect x="27" y="11" width="6" height="8" rx="1.5" fill="none" stroke="#C98232" strokeWidth="2.5" />
      </svg>
    ),
  },
];

const STEPS = [
  { title: "Set up the event", body: "Add the date, venue, capacity, ticket tiers and lineup." },
  { title: "Get a forecast", body: "See expected attendance and revenue with a range, and why the numbers are what they are." },
  { title: "Track and compare", body: "Record sales as they happen, then the final result, and see how the forecast held up." },
];

const EXPLANATION_PARTS = [
  ["What went in", "Capacity, ticket prices, marketing spend, the lineup and any tickets already sold."],
  ["How it was combined", "The rules applied, and which price was used for attendance and which for revenue."],
  ["How sure it is", "A confidence score and a range that widen or narrow with the evidence available."],
];

export default function LandingPage() {
  const { session } = useAuth();
  const cta = session
    ? { to: "/dashboard", label: "Open dashboard" }
    : { to: "/login", label: "Sign in" };

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="landing-brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D10" strokeWidth="2.2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 18v-6a9 9 0 0118 0v6" />
              <path d="M21 19a2 2 0 01-2 2h-1v-6h3z" />
              <path d="M3 19a2 2 0 002 2h1v-6H3z" />
            </svg>
          </span>
          EntertainMetrics
        </Link>
        <Link to={cta.to} className="landing-nav-link">
          {cta.label}
        </Link>
      </header>

      <main>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-hero-copy">
            <h1 id="landing-title">Know how your event will perform before the doors open</h1>
            <p className="landing-lead">
              EntertainMetrics forecasts attendance and revenue for concerts and festivals, tracks ticket
              sales as they come in, and shows its reasoning for every number.
            </p>
            <div className="landing-actions">
              <Link to={cta.to} className="primary-button landing-cta">
                {cta.label}
              </Link>
              {!session && <span className="landing-invite">Access is by invitation.</span>}
            </div>
          </div>
          <div className="landing-hero-visual">
            <RangeHero />
          </div>
        </section>

        <section className="landing-section" aria-labelledby="features-title">
          <h2 id="features-title">What it does</h2>
          <div className="landing-features">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="landing-feature">
                <div className="landing-glyph">{feature.glyph}</div>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="how-title">
          <h2 id="how-title">How it works</h2>
          <ol className="landing-steps">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <span className="landing-step-number" aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section landing-explain" aria-labelledby="explain-title">
          <div>
            <h2 id="explain-title">Rule-based, not a black box</h2>
            <p className="landing-lead">
              Forecasts come from clear rules you can read, not a trained model you have to trust. Every number
              arrives with its reasoning, so you can check it, question it and explain it to others.
            </p>
          </div>
          <dl className="landing-explain-list">
            {EXPLANATION_PARTS.map(([term, detail]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="landing-footer">
        <span>Final-year project, KCA University</span>
        <Link to={cta.to}>{cta.label}</Link>
      </footer>
    </div>
  );
}
