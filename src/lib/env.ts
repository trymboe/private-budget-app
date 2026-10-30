import "server-only";
import { z } from "zod";

// Server-side configuration. Validated lazily so a missing banking key only fails
// the banking routes, not the whole app.

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url(),
});

const bankingSchema = z.object({
  ENABLE_BANKING_APP_ID: z.string().min(8),
  ENABLE_BANKING_PRIVATE_KEY: z.string().min(100),
  BANK_TOKEN_ENCRYPTION_KEY: z.string().min(40),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

export function serverEnv() {
  return serverSchema.parse(process.env);
}

export function bankingEnv() {
  return bankingSchema.parse(process.env);
}

export function isEnableBankingConfigured() {
  return bankingSchema.safeParse(process.env).success;
}

/** The demo bank exists for local development only and is always labelled as such. */
export function isDemoBankEnabled() {
  return process.env.ENABLE_DEMO_BANK === "true";
}

export function cronSecret() {
  const secret = process.env.CRON_SECRET;
  return secret && secret.length >= 16 ? secret : null;
}
