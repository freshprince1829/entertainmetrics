import { useAuth } from "../auth/useAuth";

/** One-line notice for pages where a viewer's actions are hidden. */
export function ReadOnlyNotice({ children = "You have read-only access." }) {
  const { isViewer } = useAuth();
  if (!isViewer) return null;
  return (
    <p className="readonly-notice" role="note">
      {children}
    </p>
  );
}
