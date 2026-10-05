import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import { useApiData } from "./api";
import { EmptyState, Icon, LoadingPanel } from "./components/ui";

// Pages are loaded on demand so the charting library is not part of the
// initial download.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const ArtistsPage = lazy(() => import("./pages/ArtistsPage"));
const PredictionsPage = lazy(() => import("./pages/PredictionsPage"));
const RecommendationsPage = lazy(() => import("./pages/RecommendationsPage"));

const navItems = [
  { to: "/", label: "Dashboard", end: true, icon: "dashboard" },
  { to: "/events", label: "Events", icon: "calendar" },
  { to: "/artists", label: "Artists", icon: "music" },
  { to: "/predictions", label: "Predictions", icon: "chart" },
  { to: "/recommendations", label: "Recommendations", icon: "spark" },
];

function BrandMark() {
  return (
    <div className="brand-mark">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#0B0D10"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 18v-6a9 9 0 0118 0v6" />
        <path d="M21 19a2 2 0 01-2 2h-1v-6h3z" />
        <path d="M3 19a2 2 0 002 2h1v-6H3z" />
      </svg>
    </div>
  );
}

function ApiStatus() {
  const { data, error, loading } = useApiData("/health");
  const state = loading ? "checking" : data?.status === "ok" && !error ? "online" : "offline";
  const label = {
    checking: "Checking API…",
    online: "API connected",
    offline: "API unreachable",
  }[state];

  return (
    <div className={`api-status api-${state}`} title={label}>
      <i />
      {label}
    </div>
  );
}

function NotFound() {
  return (
    <div className="panel">
      <EmptyState
        title="Page not found"
        action={
          <Link to="/" className="cta-button">
            Back to dashboard
          </Link>
        }
      >
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <BrowserRouter>
      <div className="layout">
        <div className="topbar">
          <div className="brand">
            <BrandMark />
            <div className="brand-name">EntertainMetrics</div>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
          >
            <Icon name={menuOpen ? "close" : "menu"} size={20} />
          </button>
        </div>

        {menuOpen && <div className="nav-scrim" onClick={closeMenu} />}

        <aside className={menuOpen ? "sidebar open" : "sidebar"}>
          <div className="brand">
            <BrandMark />
            <div>
              <div className="brand-name">EntertainMetrics</div>
              <div className="brand-tag">Predictive Analytics</div>
            </div>
          </div>

          <nav>
            <div className="nav-section">Workspace</div>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-link"
                onClick={closeMenu}
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-footer">
            <ApiStatus />
            <div className="sidebar-user">
              <small>Workspace</small>
              <div>
                <span className="avatar">T</span>
                Tito
              </div>
            </div>
          </div>
        </aside>

        <main className="main-content">
          <Suspense fallback={<LoadingPanel rows={5} />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/events" element={<EventsPage />} />
              <Route path="/artists" element={<ArtistsPage />} />
              <Route path="/predictions" element={<PredictionsPage />} />
              <Route path="/recommendations" element={<RecommendationsPage />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
