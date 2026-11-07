"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@/components/category-icon";
import { requireUser } from "@/lib/auth";
import { getToday } from "@/lib/data/queries";
import { parseDecimalToMinor } from "@/lib/money";
import { getActiveSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./transactions";

// Savings goals go through the user's own client: RLS limits every write to goals
// in spaces the user belongs to, and column grants stop a goal from changing
// space. New goals are created in the space being viewed.

const uuid = z.uuid();
const MAX_MINOR = 10_000_000_000_000;

const goalSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(60, "Keep the name under 60 characters."),
  target: z.string().trim().min(1, "Enter a target amount.").max(20),
  targetDate: z.union([z.literal(""), z.iso.date()]),
  icon: z.string().refine((v) => v in CATEGORY_ICONS),
  color: z.enum(CATEGORY_COLORS),
  accountId: z.union([z.literal(""), uuid]),
  accountBasis: z.enum(["growth", "balance"]),
  startsOn: z.iso.date(),
});

export type GoalInput = Omit<z.input<typeof goalSchema>, "color"> & { color: string };

function done(): ActionResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

function failed(context: string, error: { message: string; code?: string } | null, message?: string): ActionResult {
  console.error(`[goals] ${context}`, error?.code, error?.message);
  return { ok: false, error: message ?? "That did not save. Please try again." };
}

function parseAmount(value: string): number | null {
  try {
    return parseDecimalToMinor(value);
  } catch {
    return null;
  }
}

type Parsed = { ok: true; row: Record<string, unknown> } | { ok: false; error: string };

function toRow(input: GoalInput): Parsed {
  const parsed = goalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the goal and try again." };
  const g = parsed.data;
  const target = parseAmount(g.target);
  if (target === null || target <= 0 || target >= MAX_MINOR) return { ok: false, error: "Enter a target like 30000 or 30 000,50." };
  if (g.targetDate && g.targetDate <= g.startsOn) return { ok: false, error: "Pick a target date after the start date." };
  return {
    ok: true,
    row: {
      name: g.name,
      target_minor: target,
      target_date: g.targetDate || null,
      icon: g.icon,
      color: g.color,
      account_id: g.accountId || null,
      account_basis: g.accountBasis,
      starts_on: g.startsOn,
    },
  };
}

function writeError(context: string, error: { message: string; code?: string }) {
  if (error.code === "23503") return failed(context, error, "That account is not in this space.");
  if (error.code === "23514") return failed(context, error, "Check the amount and dates.");
  return failed(context, error);
}

export async function createGoal(input: GoalInput): Promise<ActionResult & { id?: string }> {
  await requireUser();
  const today = await getToday();
  const result = toRow({ ...input, startsOn: input.startsOn || today });
  if (!result.ok) return result;
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  const { data, error } = await supabase
    .from("savings_goals")
    .insert({ space_id: space.id, ...result.row })
    .select("id")
    .single();
  if (error) return writeError("create goal", error);
  revalidatePath("/", "layout");
  return { ok: true, id: data.id as string };
}

export async function updateGoal(id: string, input: GoalInput): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid goal." };
  const result = toRow(input);
  if (!result.ok) return result;
  const supabase = await createClient();
  const { error } = await supabase.from("savings_goals").update(result.row).eq("id", id);
  return error ? writeError("update goal", error) : done();
}

/** Mark reached, archive, or bring back to active. History is kept either way. */
export async function setGoalStatus(id: string, status: "active" | "completed" | "archived"): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success || !["active", "completed", "archived"].includes(status)) return { ok: false, error: "Invalid goal." };
  const now = new Date().toISOString();
  const patch =
    status === "active"
      ? { completed_at: null, archived_at: null }
      : status === "completed"
        ? { completed_at: now, archived_at: null }
        : { archived_at: now };
  const supabase = await createClient();
  const { error } = await supabase.from("savings_goals").update(patch).eq("id", id);
  return error ? failed("goal status", error) : done();
}

export async function deleteGoal(id: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid goal." };
  const supabase = await createClient();
  const { error } = await supabase.from("savings_goals").delete().eq("id", id);
  return error ? failed("delete goal", error) : done();
}

const contributionSchema = z.object({
  goalId: uuid,
  amount: z.string().trim().min(1, "Enter an amount.").max(20),
  direction: z.enum(["in", "out"]),
  date: z.iso.date(),
  note: z.string().trim().max(200),
});

export type ContributionInput = z.input<typeof contributionSchema>;

/** Log money put aside for a goal ("in") or taken out of it ("out"). */
export async function addContribution(input: ContributionInput): Promise<ActionResult & { id?: string }> {
  await requireUser();
  const parsed = contributionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the amount and try again." };
  const today = await getToday();
  if (parsed.data.date > today) return { ok: false, error: "Pick today or an earlier date." };
  const amount = parseAmount(parsed.data.amount);
  if (amount === null || amount === 0 || Math.abs(amount) >= MAX_MINOR) return { ok: false, error: "Enter an amount like 500 or 500,50." };
  const signed = parsed.data.direction === "out" ? -Math.abs(amount) : Math.abs(amount);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_goal_contribution", {
    p_goal: parsed.data.goalId,
    p_amount_minor: signed,
    p_on: parsed.data.date,
    p_note: parsed.data.note || null,
  });
  if (error) return failed("contribution", error, error.code === "P0002" ? "That goal is no longer here." : undefined);
  revalidatePath("/", "layout");
  return { ok: true, id: data as string };
}

export async function deleteContribution(id: string): Promise<ActionResult> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid entry." };
  const supabase = await createClient();
  const { error } = await supabase.from("savings_goal_contributions").delete().eq("id", id);
  return error ? failed("delete contribution", error) : done();
}
