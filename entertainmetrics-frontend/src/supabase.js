import { createClient } from "@supabase/supabase-js";

// Public values (safe for the browser): set them in .env.local or the
// hosting provider's environment settings. See .env.example.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigError =
  !url || !key
    ? "Sign-in is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY " +
      "(see .env.example) and restart the dev server."
    : null;

export const supabase = supabaseConfigError
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

/** The current access token, refreshed by supabase-js when needed. */
export async function getAccessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
