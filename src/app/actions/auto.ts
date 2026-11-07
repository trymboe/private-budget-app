"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { getActiveSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

// Automatic categorisation settings: the space-wide switch and the trusted
// merchant rules. Everything goes through RPCs that run with the caller's rights
// (or check membership explicitly), so the partner can never change private rules.

const uuid = z.uuid();

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function failed(context: string, error: { message: string; code?: string } | null): ActionResult {
  console.error(`[auto] ${context}`, error?.code, error?.message);
  return { ok: false, error: "That did not save. Please try again." };
}

/** Turn automatic filing on or off for the space being viewed. */
export async function setAutoCategorize(enabled: boolean): Promise<ActionResult> {
  await requireUser();
  if (typeof enabled !== "boolean") return { ok: false, error: "Invalid request." };
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  const { error } = await supabase.rpc("set_auto_categorize", { p_space: space.id, p_enabled: enabled });
  return error ? failed("space switch", error) : done();
}

const patchSchema = z
  .object({
    categoryId: uuid.optional(),
    autoEnabled: z.boolean().optional(),
    confirmations: z.number().int().min(1).max(100_000).optional(),
  })
  .refine((p) => p.categoryId !== undefined || p.autoEnabled !== undefined || p.confirmations !== undefined);

/** Change a merchant rule's category or automatic switch, or restore its confirmations after a one-off correction. */
export async function updateMerchantRule(
  ruleId: string,
  patch: { categoryId?: string; autoEnabled?: boolean; confirmations?: number },
): Promise<ActionResult> {
  await requireUser();
  const id = uuid.safeParse(ruleId);
  const p = patchSchema.safeParse(patch);
  if (!id.success || !p.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_merchant_rule", {
    p_rule: id.data,
    p_category_id: p.data.categoryId ?? null,
    p_auto_enabled: p.data.autoEnabled ?? null,
    p_confirmations: p.data.confirmations ?? null,
  });
  return error ? failed("rule", error) : done();
}

/** Forget a merchant rule: no suggestions or automatic filing until it is learned again. */
export async function forgetMerchantRule(ruleId: string): Promise<ActionResult> {
  await requireUser();
  const id = uuid.safeParse(ruleId);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("forget_merchant_rule", { p_rule: id.data });
  return error ? failed("forget rule", error) : done();
}

/** Stop filing the merchant of one transaction automatically (from the transaction sheet). */
export async function stopAutoForTransaction(transactionId: string): Promise<ActionResult> {
  await requireUser();
  const id = uuid.safeParse(transactionId);
  if (!id.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { data: tx, error: txError } = await supabase
    .from("transactions")
    .select("space_id, merchant_key")
    .eq("id", id.data)
    .maybeSingle();
  if (txError) return failed("transaction", txError);
  if (!tx?.merchant_key) return { ok: false, error: "This merchant has no rule." };
  const { data: rule, error: ruleError } = await supabase
    .from("categorization_rules")
    .select("id")
    .eq("space_id", tx.space_id)
    .eq("merchant_key", tx.merchant_key)
    .maybeSingle();
  if (ruleError) return failed("rule", ruleError);
  if (!rule) return { ok: false, error: "This merchant has no rule." };
  const { error } = await supabase.rpc("set_merchant_rule", { p_rule: rule.id, p_auto_enabled: false });
  return error ? failed("rule", error) : done();
}
