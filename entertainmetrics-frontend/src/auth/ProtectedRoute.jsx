import { Navigate, useLocation } from "react-router-dom";
import { LoadingPanel } from "../components/ui";
import { useAuth } from "./useAuth";

/** Renders children for signed-in users; otherwise sends them to /login,
 * remembering where they were going. */
export function ProtectedRoute({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="auth-loading">
        <LoadingPanel rows={3} />
      </div>
    );
  }
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return children;
}
