import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import DashboardPage from "./pages/DashboardPage";
import EventsPage from "./pages/EventsPage";
import PredictionsPage from "./pages/PredictionsPage";
import ArtistsPage from "./pages/ArtistsPage";
import RecommendationsPage from "./pages/RecommendationsPage";

const iconProps = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

const navItems = [
  {
    to: "/",
    label: "Dashboard",
    end: true,
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    to: "/events",
    label: "Events",
    icon: (
      <svg {...iconProps}>
        <rect x="3" y="4" width="18" height="17" rx="2" />
        <path d="M3 9h18M8 2v4M16 2v4" />
      </svg>
    ),
  },
  {
    to: "/artists",
    label: "Artists",
    icon: (
      <svg {...iconProps}>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    to: "/predictions",
    label: "Predictions",
    icon: (
      <svg {...iconProps}>
        <path d="M3 3v18h18" />
        <path d="M7 15l4-5 3 3 5-7" />
      </svg>
    ),
  },
  {
    to: "/recommendations",
    label: "Recommendations",
    icon: (
      <svg {...iconProps}>
        <path d="M12 2l2.6 6.6L21 11l-6.4 2.4L12 20l-2.6-6.6L3 11l6.4-2.4z" />
      </svg>
    ),
  },
];

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <aside className="sidebar">
          <div className="brand">
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
            <div>
              <div className="brand-name">EntertainMetrics</div>
              <div className="brand-tag">Predictive Analytics</div>
            </div>
          </div>

          <nav>
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-link"
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="sidebar-user">
            <small>Workspace</small>
            <div>
              <span className="avatar">T</span>
              Tito
            </div>
          </div>
        </aside>

        <main className="main-content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/artists" element={<ArtistsPage />} />
            <Route path="/predictions" element={<PredictionsPage />} />
            <Route path="/recommendations" element={<RecommendationsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
