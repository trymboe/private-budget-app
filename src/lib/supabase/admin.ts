import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/**
 * Privileged client (secret key, bypasses RLS). Only for server code that has
 * already established which user it acts for: bank sync, the bank callback and
 * the cron job. Never import this from a Client Component.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
