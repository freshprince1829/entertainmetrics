import { lazy, Suspense, useState } from "react";
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import { API_BASE, useApiData } from "./api";
import { AuthProvider } from "./auth/AuthContext";
import { ROLE_LABELS } from "./auth/context";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { useAuth } from "./auth/useAuth";
import { EmptyState, Icon, LoadingPanel } from "./components/ui";
import { ForgotPasswordPage, LoginPage, ResetPasswordPage } from "./pages/AuthPages";
import LandingPage from "./pages/LandingPage";

// Pages are loaded on demand so the charting library is not part of the
// initial download.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const EventsPage = lazy(() => import("./pages/EventsPage"));
const ArtistsPage = lazy(() => import("./pages/ArtistsPage"));
const PredictionsPage = lazy(() => import("./pages/PredictionsPage"));
const RecommendationsPage = lazy(() => import("./pages/RecommendationsPage"));

const navItems = [
  { to: "/dashboard", label: "Dashboard", end: true, icon: "dashboard" },
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
          <Link to="/dashboard" className="cta-button">
            Back to dashboard
          </Link>
        }
      >
        The page you are looking for does not exist.
      </EmptyState>
    </div>
  );
}

function UserCard() {
  const { user, role } = useAuth();
  const email = user?.email ?? "";
  return (
    <div className="workspace-card">
      <span className="workspace-avatar" aria-hidden="true">
        {(email.charAt(0) || "?").toUpperCase()}
      </span>
      <div className="workspace-who">
        <div className="workspace-name" title={email}>
          {email}
        </div>
        <div className="workspace-sub">
          <span className={role === "admin" ? "role-badge admin" : "role-badge"}>{ROLE_LABELS[role]}</span>
        </div>
      </div>
    </div>
  );
}

function SignOutButton() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="ghost-button sign-out"
      onClick={async () => {
        await signOut();
        navigate("/", { replace: true });
      }}
    >
      Sign out
    </button>
  );
}

function ReadOnlyBanner() {
  const { role } = useAuth();
  if (role !== "viewer") return null;
  return (
    <div className="readonly-banner" role="note">
      Read-only access: you can view everything, but changes are disabled for your account.
    </div>
  );
}

/** The signed-in application shell (sidebar + page). */
function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
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
            <div className="brand-name">EntertainMetrics</div>
          </div>

          <UserCard />

          <nav>
            <div className="nav-section">Platform</div>
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
            <div className="engine-card">
              <small>Prediction engine</small>
              <strong>v1 · rule-based</strong>
              <p>Explainable estimates, not guarantees.</p>
              <a href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">
                API reference <Icon name="arrow" size={14} />
              </a>
            </div>
            <ApiStatus />
            <SignOutButton />
          </div>
        </aside>

        <main className="main-content">
          <ReadOnlyBanner />
          <Suspense fallback={<LoadingPanel rows={5} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Signed-in users only */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/artists" element={<ArtistsPage />} />
            <Route path="/predictions" element={<PredictionsPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
