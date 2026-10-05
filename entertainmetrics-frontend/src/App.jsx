import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./App.css";
import DashboardPage from "./pages/DashboardPage";
import EventsPage from "./pages/EventsPage";
import PredictionsPage from "./pages/PredictionsPage";
import ArtistsPage from "./pages/ArtistsPage";
import RecommendationsPage from "./pages/RecommendationsPage";

function App() {
  return (
    <BrowserRouter>
      <div className="layout">
        <aside className="sidebar">
          <h2>EntertainMetrics</h2>
          <nav>
            <NavLink to="/" end className="nav-link">
              Dashboard
            </NavLink>
            <NavLink to="/events" className="nav-link">
              Events
            </NavLink>
            <NavLink to="/artists" className="nav-link">
              Artists
            </NavLink>
            <NavLink to="/predictions" className="nav-link">
              Predictions
            </NavLink>
            <NavLink to="/recommendations" className="nav-link">
              Recommendations
            </NavLink>
          </nav>
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