import { createContext } from "react";

export const AuthContext = createContext(null);

// Fired by api.js when the API answers 401; AuthProvider signs out and
// redirects to /login.
export const SESSION_EXPIRED_EVENT = "entertainmetrics:session-expired";
export const SESSION_EXPIRED_MESSAGE = "Your session expired, please sign in again";

export function roleOf(user) {
  return user?.app_metadata?.role === "admin" ? "admin" : "viewer";
}

export const ROLE_LABELS = { admin: "Admin", viewer: "Read-only" };

/** "tito.m@example.com" -> "Tito" for greetings. */
export function displayName(email) {
  const first = (email ?? "").split("@")[0].split(/[._+-]/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
}
