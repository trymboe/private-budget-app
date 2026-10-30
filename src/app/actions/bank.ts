"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { decryptSecret, randomState } from "@/lib/banking/crypto";
import { availableProviders, getProvider } from "@/lib/banking/index";
import { syncConnection } from "@/lib/banking/sync";
import { describeBankError } from "@/lib/banking/types";
import { addDays, todayIn } from "@/lib/dates";
import { getProfile } from "@/lib/data/queries";
import { serverEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

const MAX_CONSENT_DAYS = 180;
const MANUAL_SYNC_COOLDOWN_MINUTES = 60;

const startSchema = z.object({
  provider: z.enum(["enable_banking", "demo"]),
  institution: z.string().min(1).max(200),
  country: z.string().regex(/^[A-Z]{2}$/),
  historyFrom: z.iso.date(),
  reconnect: z.uuid().optional(),
});

export type StartState = { error?: string } | undefined;

/**
 * Begin the bank's own consent flow. Creates a single-use `state` bound to this
 * user, then redirects the browser to the bank (BankID happens there, never here).
 */
export async function startBankConnection(_: StartState, formData: FormData): Promise<StartState> {
  const user = await requireUser();
  const parsed = startSchema.safeParse({
    provider: formData.get("provider"),
    institution: formData.get("institution"),
    country: formData.get("country"),
    historyFrom: formData.get("historyFrom"),
    reconnect: formData.get("reconnect") || undefined,
  });
  if (!parsed.success) return { error: "Choose a bank and a start date." };
  const input = parsed.data;
  if (!availableProviders().includes(input.provider)) return { error: "Bank connections are not configured yet." };

  const profile = await getProfile();
  const today = todayIn(profile.timeZone);
  if (input.historyFrom > today || input.historyFrom < addDays(today, -5 * 366)) {
    return { error: "Pick a start date within the last five years." };
  }

  const provider = getProvider(input.provider);
  let maxConsentSeconds: number | null = null;
  try {
    const institutions = await provider.listInstitutions(input.country);
    const match = institutions.find((i) => i.name === input.institution);
    if (!match) return { error: "That bank is not available right now." };
    maxConsentSeconds = match.maxConsentSeconds;
  } catch {
    return { error: "Could not reach the bank directory. Try again in a moment." };
  }

  const admin = createAdminClient();
  if (input.reconnect) {
    const { data: existing } = await admin
      .from("bank_connections")
      .select("id")
      .eq("id", input.reconnect)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!existing) return { error: "That connection was not found." };
  }

  // Ask for the longest consent the bank allows (capped at 180 days).
  const days = Math.min(MAX_CONSENT_DAYS, maxConsentSeconds ? Math.floor(maxConsentSeconds / 86_400) : 90);
  const validUntil = new Date(Date.now() + days * 86_400_000);
  const state = randomState();
  const { error } = await admin.from("bank_auth_requests").insert({
    state,
    user_id: user.id,
    provider: input.provider,
    institution_name: input.institution,
    institution_country: input.country,
    history_from: input.historyFrom,
    reconnect_connection_id: input.reconnect ?? null,
  });
  if (error) return { error: "Could not start the connection. Try again." };

  let url: string;
  try {
    ({ url } = await provider.startAuthorization({
      institution: { name: input.institution, country: input.country },
      validUntil,
      state,
      redirectUrl: `${serverEnv().APP_URL}/api/bank/callback`,
    }));
  } catch (err) {
    console.error("[bank] start authorization failed", describeBankError(err));
    return { error: "The bank could not start the authorisation. Try again in a moment." };
  }
  redirect(url);
}

const selectionSchema = z.object({
  connectionId: z.uuid(),
  accounts: z.array(z.object({ id: z.uuid(), isSynced: z.boolean(), includeInBudget: z.boolean() })).max(50),
});

export async function saveAccountSelection(input: z.input<typeof selectionSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid selection." };
  const supabase = await createClient();
  for (const a of parsed.data.accounts) {
    const { error } = await supabase
      .from("accounts")
      .update({ is_synced: a.isSynced, include_in_budget: a.includeInBudget })
      .eq("id", a.id)
      .eq("connection_id", parsed.data.connectionId)
      .eq("user_id", user.id);
    if (error) return { ok: false, error: "Could not save your choice." };
  }
  await supabase.from("profiles").update({ onboarding_bank_at: new Date().toISOString() }).eq("id", user.id);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setAccountOptions(accountId: string, patch: { includeInBudget?: boolean; isSynced?: boolean; name?: string }): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z
    .object({ id: z.uuid(), includeInBudget: z.boolean().optional(), isSynced: z.boolean().optional(), name: z.string().trim().min(1).max(120).optional() })
    .safeParse({ id: accountId, ...patch });
  if (!parsed.success) return { ok: false, error: "Invalid change." };
  const supabase = await createClient();
  const update: Record<string, unknown> = {};
  if (parsed.data.includeInBudget !== undefined) update.include_in_budget = parsed.data.includeInBudget;
  if (parsed.data.isSynced !== undefined) update.is_synced = parsed.data.isSynced;
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  const { error } = await supabase.from("accounts").update(update).eq("id", parsed.data.id).eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** "Sync now". Limited to once an hour per connection to respect bank limits. */
export async function syncNow(connectionId: string): Promise<ActionResult & { message?: string }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(connectionId).success) return { ok: false, error: "Invalid connection." };
  const supabase = await createClient();
  const { data: conn } = await supabase
    .from("bank_connections")
    .select("id, status, last_synced_at, rate_limited_until")
    .eq("id", connectionId)
    .maybeSingle();
  if (!conn) return { ok: false, error: "Connection not found." };
  if (conn.status !== "active") return { ok: false, error: "Reconnect this bank first." };
  if (conn.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < MANUAL_SYNC_COOLDOWN_MINUTES * 60_000) {
    return { ok: false, error: "Synced less than an hour ago. Banks limit how often we can ask." };
  }
  const profile = await getProfile();
  const results = await syncConnection({
    userId: user.id,
    connectionId,
    trigger: "manual",
    timeZone: profile.timeZone,
    deadline: Date.now() + 50_000,
  });
  revalidatePath("/", "layout");
  const failed = results.find((r) => !r.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.message };
  const inserted = results.reduce((n, r) => n + (r.ok ? r.inserted : 0), 0);
  return { ok: true, message: inserted === 0 ? "Up to date" : `${inserted} new ${inserted === 1 ? "transaction" : "transactions"}` };
}

/**
 * Disconnect: ends the consent at the bank (best effort) and forgets the session.
 * Accounts and every imported transaction are kept.
 */
export async function disconnectBank(connectionId: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.uuid().safeParse(connectionId).success) return { ok: false, error: "Invalid connection." };
  const admin = createAdminClient();
  const { data: conn } = await admin
    .from("bank_connections")
    .select("id, provider, session_secret")
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conn) return { ok: false, error: "Connection not found." };
  if (conn.session_secret) {
    try {
      await getProvider(conn.provider).revoke(decryptSecret(conn.session_secret));
    } catch {
      // Already expired at the bank, or the bank is unreachable: forget it anyway.
    }
  }
  const { error } = await admin
    .from("bank_connections")
    .update({ status: "revoked", session_secret: null })
    .eq("id", connectionId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: "Could not disconnect." };
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Remove one account together with every transaction imported from it (and
 * their categorisations, via cascade). Budgets are computed from allocations, so
 * totals update on their own. If the bank access is renewed later, the bank
 * offers the account again on the "Choose accounts" screen.
 */
export async function removeAccount(accountId: string): Promise<ActionResult & { removed?: number }> {
  const user = await requireUser();
  if (!z.uuid().safeParse(accountId).success) return { ok: false, error: "Invalid account." };
  // Users have no delete rights on accounts or transactions under RLS, so this
  // goes through the server-only client, scoped to the signed-in user.
  const admin = createAdminClient();
  const { data: account } = await admin.from("accounts").select("id").eq("id", accountId).eq("user_id", user.id).maybeSingle();
  if (!account) return { ok: false, error: "Account not found." };
  const { count } = await admin
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("user_id", user.id);
  const { error } = await admin.from("accounts").delete().eq("id", accountId).eq("user_id", user.id);
  if (error) {
    console.error("[bank] remove account failed", error.code, error.message);
    return { ok: false, error: "Could not remove the account." };
  }
  revalidatePath("/", "layout");
  return { ok: true, removed: count ?? 0 };
}
