import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * Returns a service-role Supabase client, or null when the integration is not
 * configured. Persistence is optional: every caller degrades gracefully so the
 * app keeps working (live collection + send) without a database, exactly as it
 * did before Supabase was wired in.
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) {
    return cached;
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    cached = null;
    return cached;
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function isPersistenceEnabled() {
  return getSupabase() !== null;
}
