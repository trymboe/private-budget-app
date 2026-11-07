"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { displayMerchant, normalizeMerchant } from "@/lib/merchant";
import { getActiveSpace } from "@/lib/spaces";
import { CADENCES, withinTolerance } from "@/lib/subscriptions";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

const uuid = z.uuid();
const cadence = z.enum(CADENCES as [string, ...string[]]);

const decisionInput = z.object({
  /** The decision being changed; leave out to record a new one. */
  id: uuid.nullable().optional(),
  merchantKey: z.string().trim().min(1).max(120),
  cadence,
  status: z.enum(["confirmed", "dismissed", "cancelled"]),
  name: z.string().trim().min(1).max(80),
  amountMinor: z.number().int().positive().max(99_999_999_999),
  categoryId: uuid.nullable(),
  source: z.enum(["detected", "manual"]).default("detected"),
  cancelledOn: z.iso.date().nullable().optional(),
});

export type SubscriptionDecisionInput = z.input<typeof decisionInput>;

function failed(context: string, error: { message: string; code?: string } | null): ActionResult {
  console.error(`[action] ${context}`, error?.code, error?.message);
  return { ok: false, error: "That did not save. Please try again." };
}

/** An existing decision for this merchant and cadence at about this price. */
async function findDecision(
  supabase: Awaited<ReturnType<typeof createClient>>,
  spaceId: string,
  merchantKey: string,
  every: string,
  amountMinor: number,
): Promise<{ ok: true; id: string | null } | { ok: false; error: { message: string; code?: string } }> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, amount_minor")
    .eq("space_id", spaceId)
    .eq("merchant_key", merchantKey)
    .eq("cadence", every);
  if (error) return { ok: false, error };
  const close = (data ?? [])
    .filter((r) => withinTolerance(Number(r.amount_minor), amountMinor))
    .sort((a, b) => Math.abs(Number(a.amount_minor) - amountMinor) - Math.abs(Number(b.amount_minor) - amountMinor));
  return { ok: true, id: (close[0]?.id as string | undefined) ?? null };
}

/** Confirm, dismiss or cancel a subscription in the space being viewed (also used to undo). */
export async function saveSubscriptionDecision(input: SubscriptionDecisionInput): Promise<ActionResult & { id?: string }> {
  await requireUser();
  const parsed = decisionInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const d = parsed.data;
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  let id = d.id ?? null;
  if (!id) {
    // A new decision for a series someone already decided about (a second tap,
    // a stale page, or the partner at the same time) updates that decision.
    const found = await findDecision(supabase, space.id, d.merchantKey, d.cadence, d.amountMinor);
    if (!found.ok) return failed("subscription", found.error);
    id = found.id;
  }
  const { data, error } = await supabase.rpc("save_subscription", {
    p_space: space.id,
    p_merchant_key: d.merchantKey,
    p_cadence: d.cadence,
    p_status: d.status,
    p_name: d.name,
    p_amount_minor: d.amountMinor,
    p_category_id: d.categoryId,
    p_source: d.source,
    p_transaction_id: null,
    p_cancelled_on: d.cancelledOn ?? null,
    p_id: id,
  });
  if (error) return failed("subscription", error);
  revalidatePath("/", "layout");
  return { ok: true, id: data as string };
}

/** Forget a decision: a detected subscription goes back to "new", a manual one disappears. */
export async function forgetSubscription(id: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.from("subscriptions").delete().eq("id", id);
  if (error) return failed("forget subscription", error);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Track a payment as a subscription by hand, starting from one transaction. */
export async function trackTransactionAsSubscription(transactionId: string, every: string): Promise<ActionResult & { id?: string }> {
  await requireUser();
  const parsed = z.object({ id: uuid, cadence }).safeParse({ id: transactionId, cadence: every });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select("id, space_id, amount_minor, currency, merchant_key, counterparty, description, transaction_allocations ( category_id )")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (txError) return failed("track subscription", txError);
  if (!tx) return { ok: false, error: "Transaction not found." };
  const amount = Number(tx.amount_minor);
  if (amount >= 0) return { ok: false, error: "Only payments can be subscriptions." };
  if (tx.currency !== "NOK") return { ok: false, error: "Only NOK payments can be tracked for now." };
  const counterparty = (tx.counterparty as string | null) ?? null;
  const description = (tx.description as string | null) ?? null;
  const key = (tx.merchant_key as string | null) || normalizeMerchant(counterparty || description);
  if (!key) return { ok: false, error: "This payment has no merchant to follow." };
  const allocations = (tx.transaction_allocations as { category_id: string }[] | null) ?? [];

  // Already tracking this merchant at about this price: update that decision
  // instead of adding a second one for the same series.
  const same = await findDecision(supabase, tx.space_id as string, key, parsed.data.cadence, -amount);
  if (!same.ok) return failed("track subscription", same.error);

  const { data, error } = await supabase.rpc("save_subscription", {
    // The transaction's own space: RLS already limits it to one you belong to.
    p_space: tx.space_id as string,
    p_merchant_key: key,
    p_cadence: parsed.data.cadence,
    p_status: "confirmed",
    p_name: displayMerchant(counterparty, description).slice(0, 80),
    p_amount_minor: -amount,
    p_category_id: allocations.length === 1 ? allocations[0].category_id : null,
    p_source: "manual",
    p_transaction_id: tx.id as string,
    p_cancelled_on: null,
    p_id: same.id,
  });
  if (error) return failed("track subscription", error);
  revalidatePath("/", "layout");
  return { ok: true, id: data as string };
}
