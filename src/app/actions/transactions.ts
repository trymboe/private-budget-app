"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { validateSplit } from "@/lib/budget";
import { getTransaction, listTransactions, type TransactionFilters } from "@/lib/data/queries";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

const uuid = z.uuid();
const ids = z.array(uuid).min(1).max(500);

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function failed(context: string, error: { message: string; code?: string } | null): ActionResult {
  console.error(`[action] ${context}`, error?.code, error?.message);
  return { ok: false, error: "That did not save. Please try again." };
}

export async function categorize(transactionIds: string[], categoryId: string): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ ids, categoryId: uuid }).safeParse({ ids: transactionIds, categoryId });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("categorize_transactions", {
    p_transaction_ids: parsed.data.ids,
    p_category_id: parsed.data.categoryId,
    p_learn: true,
  });
  return error ? failed("categorize", error) : done();
}

export async function setTreatment(transactionIds: string[], treatment: "budget" | "transfer" | "excluded"): Promise<ActionResult> {
  await requireUser();
  const parsed = z
    .object({ ids, treatment: z.enum(["budget", "transfer", "excluded"]) })
    .safeParse({ ids: transactionIds, treatment });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_transaction_treatment", {
    p_transaction_ids: parsed.data.ids,
    p_treatment: parsed.data.treatment,
  });
  return error ? failed("treatment", error) : done();
}

export async function splitTransaction(
  transactionId: string,
  parts: { categoryId: string; amountMinor: number }[],
): Promise<ActionResult> {
  await requireUser();
  const parsed = z
    .object({
      id: uuid,
      parts: z.array(z.object({ categoryId: uuid, amountMinor: z.number().int().refine(Number.isSafeInteger) })).min(1).max(20),
    })
    .safeParse({ id: transactionId, parts });
  if (!parsed.success) return { ok: false, error: "Invalid split." };
  const tx = await getTransaction(parsed.data.id);
  if (!tx) return { ok: false, error: "Transaction not found." };
  const problem = validateSplit(tx.amountMinor, parsed.data.parts);
  if (problem) return { ok: false, error: problem };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_transaction_split", {
    p_transaction_id: tx.id,
    p_allocations: parsed.data.parts.map((p) => ({ category_id: p.categoryId, amount_minor: p.amountMinor })),
  });
  return error ? failed("split", error) : done();
}

export async function undoReview(transactionIds: string[]): Promise<ActionResult> {
  await requireUser();
  const parsed = ids.safeParse(transactionIds);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_transaction_review", { p_transaction_ids: parsed.data });
  return error ? failed("undo", error) : done();
}

export async function saveNote(transactionId: string, note: string): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({ id: uuid, note: z.string().max(1000) }).safeParse({ id: transactionId, note });
  if (!parsed.success) return { ok: false, error: "Notes can be up to 1000 characters." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ note: parsed.data.note.trim() || null })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
  return error ? failed("note", error) : done();
}

const filtersSchema = z.object({
  q: z.string().max(60).optional(),
  accountId: uuid.optional(),
  categoryId: uuid.optional(),
  view: z.enum(["all", "review", "incoming", "outgoing", "transfers", "excluded"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

/** Incremental loading for the transaction list. */
export async function loadMoreTransactions(filters: TransactionFilters, cursor: { date: string; id: string }) {
  await requireUser();
  const f = filtersSchema.parse(filters);
  const c = z.object({ date: z.iso.date(), id: uuid }).parse(cursor);
  return listTransactions(f, c);
}
