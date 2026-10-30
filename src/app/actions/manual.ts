"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getProfile } from "@/lib/data/queries";
import { normalizeMerchant } from "@/lib/merchant";
import { parseDecimalToMinor } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

// Transactions the user enters by hand (cash, Vipps from another phone, etc.).
// They live in one "manual" account per user. Users have no insert or delete rights
// on transactions under RLS, so these writes go through the server-only client,
// always scoped to the signed-in user and to the manual account.

const MANUAL_IDENTITY = "manual";
const MANUAL_ACCOUNT_NAME = "Cash & manual";
const MAX_MINOR = 100_000_000_000;

const entrySchema = z.object({
  date: z.iso.date(),
  amount: z.string().trim().min(1).max(20),
  direction: z.enum(["out", "in"]),
  description: z.string().trim().min(1).max(120),
});

const createSchema = entrySchema.extend({ categoryId: z.uuid().optional() });

export type ManualEntry = z.input<typeof entrySchema>;

function signedAmount(entry: z.output<typeof entrySchema>, currency: string): number | null {
  let minor: number;
  try {
    minor = Math.abs(parseDecimalToMinor(entry.amount, currency));
  } catch {
    return null;
  }
  if (minor === 0 || minor >= MAX_MINOR) return null;
  return entry.direction === "out" ? -minor : minor;
}

function dateFields(date: string) {
  return { booking_date: date, transaction_date: date, effective_date: date };
}

function failed(context: string, error: { message: string; code?: string } | null): ActionResult {
  console.error(`[manual] ${context}`, error?.code, error?.message);
  return { ok: false, error: "That did not save. Please try again." };
}

/** The user's manual account, created on first use. */
async function manualAccount(userId: string, currency: string): Promise<{ id: string; currency: string } | null> {
  const admin = createAdminClient();
  const find = () =>
    admin
      .from("accounts")
      .select("id, currency")
      .eq("user_id", userId)
      .eq("provider", "manual")
      .eq("provider_identity", MANUAL_IDENTITY)
      .maybeSingle();
  const { data: existing } = await find();
  if (existing) return existing;
  const { data: created, error } = await admin
    .from("accounts")
    .insert({
      user_id: userId,
      provider: "manual",
      provider_identity: MANUAL_IDENTITY,
      name: MANUAL_ACCOUNT_NAME,
      currency,
      is_synced: true,
      include_in_budget: true,
      // Nothing to import, so never flag it as incomplete.
      initial_import_completed_at: new Date().toISOString(),
    })
    .select("id, currency")
    .single();
  if (created) return created;
  // Created by a parallel request in the meantime.
  if (error?.code === "23505") return (await find()).data ?? null;
  console.error("[manual] create account", error?.code, error?.message);
  return null;
}

/** A manual transaction owned by this user, or null. Bank transactions never match. */
async function ownManualTransaction(userId: string, id: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("transactions")
    .select("id, currency, accounts!inner ( provider )")
    .eq("id", id)
    .eq("user_id", userId)
    .eq("accounts.provider", "manual")
    .maybeSingle();
  return data as { id: string; currency: string } | null;
}

export async function addManualTransaction(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fill in an amount, a description and a date." };
  const profile = await getProfile();
  const account = await manualAccount(user.id, profile.currency);
  if (!account) return { ok: false, error: "That did not save. Please try again." };
  const amount = signedAmount(parsed.data, account.currency);
  if (amount === null) return { ok: false, error: "Enter a valid amount." };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transactions")
    .insert({
      user_id: user.id,
      account_id: account.id,
      fingerprint: `manual:${randomUUID()}`,
      status: "booked",
      ...dateFields(parsed.data.date),
      amount_minor: amount,
      currency: account.currency,
      counterparty: parsed.data.description,
      merchant_key: normalizeMerchant(parsed.data.description),
    })
    .select("id")
    .single();
  if (error) return failed("add", error);

  if (parsed.data.categoryId) {
    // Through the user's own client: the RPC checks the category belongs to them.
    const supabase = await createClient();
    const { error: catError } = await supabase.rpc("categorize_transactions", {
      p_transaction_ids: [data.id],
      p_category_id: parsed.data.categoryId,
      p_learn: false,
    });
    if (catError) console.error("[manual] categorize", catError.code, catError.message);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateManualTransaction(id: string, input: ManualEntry): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = entrySchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "Fill in an amount, a description and a date." };
  const tx = await ownManualTransaction(user.id, id);
  if (!tx) return { ok: false, error: "Only transactions you added yourself can be edited." };
  const amount = signedAmount(parsed.data, tx.currency);
  if (amount === null) return { ok: false, error: "Enter a valid amount." };
  // A single category follows the new amount (database trigger); a split goes back to review.
  const { error } = await createAdminClient()
    .from("transactions")
    .update({
      ...dateFields(parsed.data.date),
      amount_minor: amount,
      counterparty: parsed.data.description,
      merchant_key: normalizeMerchant(parsed.data.description),
    })
    .eq("id", tx.id)
    .eq("user_id", user.id);
  if (error) return failed("update", error);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteManualTransaction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Invalid transaction." };
  const tx = await ownManualTransaction(user.id, id);
  if (!tx) return { ok: false, error: "Only transactions you added yourself can be deleted." };
  const { error } = await createAdminClient().from("transactions").delete().eq("id", tx.id).eq("user_id", user.id);
  if (error) return failed("delete", error);
  revalidatePath("/", "layout");
  return { ok: true };
}
