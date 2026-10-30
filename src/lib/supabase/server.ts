import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";

/**
 * Supabase client bound to the signed-in user's session (publishable key + auth
 * cookie). Every query through it is subject to Row Level Security.
 */
export async function createClient() {
  // Read cookies first: it marks the route as request-time before anything else runs.
  const cookieStore = await cookies();
  const env = publicEnv();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy
          // refreshes the session cookie on every request, so this is safe to ignore.
        }
      },
    },
  });
}
