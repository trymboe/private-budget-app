"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/components/category-icon";
import { parseDecimalToMinor } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

const uuid = z.uuid();
const month = z.iso.date().refine((d) => d.endsWith("-01"), "Month must start on the 1st");

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function failed(context: string, error: { message: string; code?: string } | null, message?: string): ActionResult {
  console.error(`[action] ${context}`, error?.code, error?.message);
  return { ok: false, error: message ?? "That did not save. Please try again." };
}

/** Set one category's budget for one month only. Other months are untouched. */
export async function setCategoryBudget(categoryId: string, monthStart: string, amount: string): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ categoryId: uuid, month }).safeParse({ categoryId, month: monthStart });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  let minor: number;
  try {
    minor = amount.trim() === "" ? 0 : parseDecimalToMinor(amount);
  } catch {
    return { ok: false, error: "Enter an amount like 4500 or 4500,50." };
  }
  if (minor < 0 || minor >= 100_000_000_000) return { ok: false, error: "Enter a positive amount." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_month_budgets", {
    p_month: parsed.data.month,
    p_amounts: { [parsed.data.categoryId]: minor },
  });
  return error ? failed("budget", error) : done();
}

export async function copyBudget(fromMonth: string, toMonth: string, overwrite: boolean): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ from: month, to: month, overwrite: z.boolean() }).safeParse({ from: fromMonth, to: toMonth, overwrite });
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("copy_month_budget", {
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_overwrite: parsed.data.overwrite,
  });
  return error ? failed("copy budget", error) : done();
}

const categoryInput = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(60),
  kind: z.enum(["expense", "income"]),
  icon: z.string().refine((v) => v in CATEGORY_ICONS),
  color: z.enum(CATEGORY_COLORS),
  isFixed: z.boolean(),
});

export type CategoryInput = { name: string; kind: "expense" | "income"; icon: string; color: string; isFixed: boolean };

export async function createCategory(input: CategoryInput): Promise<ActionResult & { id?: string }> {
  const user = await requireUser();
  const parsed = categoryInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid category." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("categories")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      user_id: user.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      icon: parsed.data.icon,
      color: parsed.data.color,
      is_fixed: parsed.data.isFixed,
      sort_order: ((last?.sort_order as number | undefined) ?? 0) + 10,
    })
    .select("id")
    .single();
  if (error) return failed("create category", error, error.code === "23505" ? "You already have a category with that name." : undefined);
  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function updateCategory(id: string, input: CategoryInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = categoryInput.omit({ kind: true }).safeParse(input);
  if (!uuid.safeParse(id).success || !parsed.success) return { ok: false, error: "Invalid category." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ name: parsed.data.name, icon: parsed.data.icon, color: parsed.data.color, is_fixed: parsed.data.isFixed })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return failed("update category", error, error.code === "23505" ? "You already have a category with that name." : undefined);
  return done();
}

/** Archiving hides a category from pickers; history keeps pointing at it. */
export async function setCategoryArchived(id: string, archived: boolean): Promise<ActionResult> {
  const user = await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid category." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return failed("archive category", error, error.code === "23505" ? "An active category already has that name." : undefined);
  return done();
}

export async function mergeCategory(sourceId: string, targetId: string): Promise<ActionResult> {
  await requireUser();
  const parsed = z.object({ s: uuid, t: uuid }).safeParse({ s: sourceId, t: targetId });
  if (!parsed.success || sourceId === targetId) return { ok: false, error: "Pick a different category." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("merge_categories", { p_source: parsed.data.s, p_target: parsed.data.t });
  return error ? failed("merge", error, "Those categories could not be merged.") : done();
}

/** Persist a new order (ids in display order). */
export async function reorderCategories(orderedIds: string[]): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.array(uuid).max(200).safeParse(orderedIds);
  if (!parsed.success) return { ok: false, error: "Invalid order." };
  const supabase = await createClient();
  const results = await Promise.all(
    parsed.data.map((id, i) => supabase.from("categories").update({ sort_order: (i + 1) * 10 }).eq("id", id).eq("user_id", user.id)),
  );
  const error = results.find((r) => r.error)?.error ?? null;
  return error ? failed("reorder", error) : done();
}

/** Onboarding: starter categories + first month's budget in one go. */
export async function saveInitialBudget(monthStart: string, amounts: Record<string, string>): Promise<ActionResult> {
  const user = await requireUser();
  if (!month.safeParse(monthStart).success) return { ok: false, error: "Invalid month." };
  const budgets: Record<string, number> = {};
  for (const [categoryId, value] of Object.entries(amounts)) {
    if (!uuid.safeParse(categoryId).success) return { ok: false, error: "Invalid category." };
    if (!value.trim()) continue;
    try {
      const minor = parseDecimalToMinor(value);
      if (minor < 0) return { ok: false, error: "Budgets must be positive." };
      budgets[categoryId] = minor;
    } catch {
      return { ok: false, error: "Enter amounts like 4500 or 4500,50." };
    }
  }
  const supabase = await createClient();
  if (Object.keys(budgets).length > 0) {
    const { error } = await supabase.rpc("set_month_budgets", { p_month: monthStart, p_amounts: budgets });
    if (error) return failed("initial budget", error);
  }
  const { error } = await supabase.from("profiles").update({ onboarding_budget_at: new Date().toISOString() }).eq("id", user.id);
  return error ? failed("onboarding", error) : done();
}

export async function ensureStarterCategories(): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_starter_categories");
  return error ? failed("starter categories", error) : done();
}

export async function finishOnboarding(): Promise<ActionResult> {
  const user = await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", user.id);
  return error ? failed("finish onboarding", error) : done();
}
