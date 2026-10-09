import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, supabaseConfigError } from "../supabase";
import { AuthContext, SESSION_EXPIRED_EVENT, SESSION_EXPIRED_MESSAGE, roleOf } from "./context";

// Sign-in errors never say whether an email exists.
function friendlyError(error) {
  if (!error) return null;
  const status = error.status ?? 0;
  if (status === 429) return "Too many attempts. Please wait a minute and try again.";
  if (error.name === "AuthRetryableFetchError" || status >= 500 || status === 0) {
    return "Could not reach the sign-in service. Check your connection and try again.";
  }
  return "Incorrect email or password.";
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  // A 401 from the API means the session is no longer valid.
  useEffect(() => {
    async function onExpired() {
      if (supabase) await supabase.auth.signOut({ scope: "local" });
      navigate("/login", { replace: true, state: { message: SESSION_EXPIRED_MESSAGE } });
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [navigate]);

  const signIn = useCallback(async (email, password) => {
    if (!supabase) return { error: supabaseConfigError };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: friendlyError(error) };
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, []);

  const resetPassword = useCallback(async (email) => {
    if (!supabase) return { error: supabaseConfigError };
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    // Only rate limits and outages are reported; never whether the email exists.
    if (error && (error.status === 429 || (error.status ?? 0) >= 500 || !error.status)) {
      return { error: friendlyError(error) };
    }
    return { error: null };
  }, []);

  const updatePassword = useCallback(async (password) => {
    if (!supabase) return { error: supabaseConfigError };
    const { error } = await supabase.auth.updateUser({ password });
    if (!error) setRecovery(false);
    return { error: error ? error.message : null };
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      role: session ? roleOf(session.user) : null,
      loading,
      recovery,
      configError: supabaseConfigError,
      signIn,
      signOut,
      resetPassword,
      updatePassword,
    }),
    [session, loading, recovery, signIn, signOut, resetPassword, updatePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
