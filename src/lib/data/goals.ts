import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import type { IsoDate } from "@/lib/dates";
import { goalProgress, type AccountBasis, type GoalProgress } from "@/lib/goals";
import type { Minor } from "@/lib/money";
import { getActiveSpace, partnerOf, spaceLabel, type Space } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { getConnections, getToday } from "./queries";

// Savings goals in the space being viewed. RLS decides which goals you may see
// (your own space, or the one you share); progress comes from the
// savings_goal_progress view (security invoker) and src/lib/goals.ts.

type Row = Record<string, unknown>;

export type GoalStatus = "active" | "completed" | "archived";

export type SavingsGoal = {
  id: string;
  name: string;
  targetMinor: Minor;
  targetDate: IsoDate | null;
  startsOn: IsoDate;
  icon: string;
  color: string;
  status: GoalStatus;
  account: { id: string; name: string; currency: string; basis: AccountBasis; balanceAt: string | null } | null;
  contributionCount: number;
  progress: GoalProgress;
  createdAt: string;
};

export type GoalContribution = {
  id: string;
  amountMinor: Minor;
  contributedOn: IsoDate;
  note: string | null;
  createdBy: string | null;
};

const GOAL_SELECT = "id, name, target_minor, target_date, starts_on, icon, color, account_id, account_basis, completed_at, archived_at, created_at";

function fail(context: string, error: { message: string } | null): never {
  console.error(`[data] ${context} failed`, error?.message);
  throw new Error(`Could not load ${context}.`);
}

function toGoal(r: Row, p: Row | undefined, today: IsoDate): SavingsGoal {
  const accountId = (r.account_id as string | null) ?? null;
  const basis = r.account_basis as AccountBasis;
  const growth = p?.account_growth_minor;
  const balance = p?.account_balance_minor;
  const account =
    accountId && p
      ? {
          id: accountId,
          name: p.account_name as string,
          currency: (p.account_currency as string) ?? "NOK",
          basis,
          balanceAt: (p.account_balance_at as string | null) ?? null,
        }
      : null;
  const figures = {
    targetMinor: Number(r.target_minor),
    targetDate: (r.target_date as string | null) ?? null,
    startsOn: r.starts_on as string,
    contributedMinor: Number(p?.contributed_minor ?? 0),
    account: account
      ? { basis, growthMinor: Number(growth ?? 0), balanceMinor: balance === null || balance === undefined ? null : Number(balance) }
      : null,
  };
  return {
    id: r.id as string,
    name: r.name as string,
    targetMinor: figures.targetMinor,
    targetDate: figures.targetDate,
    startsOn: figures.startsOn,
    icon: r.icon as string,
    color: r.color as string,
    status: r.archived_at ? "archived" : r.completed_at ? "completed" : "active",
    account,
    contributionCount: Number(p?.contribution_count ?? 0),
    progress: goalProgress(figures, today),
    createdAt: r.created_at as string,
  };
}

async function loadProgress(goalIds: string[]) {
  if (goalIds.length === 0) return new Map<string, Row>();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("savings_goal_progress")
    .select("goal_id, contributed_minor, contribution_count, account_growth_minor, account_balance_minor, account_balance_at, account_name, account_currency")
    .in("goal_id", goalIds);
  if (error) fail("goal progress", error);
  return new Map((data as Row[]).map((p) => [p.goal_id as string, p]));
}

/** Every goal in the space being viewed: active first, then finished, newest last within each. */
export const getGoals = cache(async (): Promise<SavingsGoal[]> => {
  await requireUser();
  const [supabase, space, today] = await Promise.all([createClient(), getActiveSpace(), getToday()]);
  const { data, error } = await supabase.from("savings_goals").select(GOAL_SELECT).eq("space_id", space.id).order("created_at");
  if (error) fail("goals", error);
  const progress = await loadProgress(data.map((g) => g.id as string));
  const order: Record<GoalStatus, number> = { active: 0, completed: 1, archived: 2 };
  return (data as Row[])
    .map((g) => toGoal(g, progress.get(g.id as string), today))
    .sort((a, b) => order[a.status] - order[b.status]);
});

/** One goal in the space being viewed, with its logged contributions (newest first). */
export async function getGoal(id: string): Promise<{ goal: SavingsGoal; contributions: GoalContribution[] } | null> {
  await requireUser();
  const [supabase, space, today] = await Promise.all([createClient(), getActiveSpace(), getToday()]);
  const { data, error } = await supabase.from("savings_goals").select(GOAL_SELECT).eq("space_id", space.id).eq("id", id).maybeSingle();
  if (error) fail("goal", error);
  if (!data) return null;
  const [progress, contributions] = await Promise.all([
    loadProgress([id]),
    supabase
      .from("savings_goal_contributions")
      .select("id, amount_minor, contributed_on, note, created_by")
      .eq("goal_id", id)
      .order("contributed_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (contributions.error) fail("contributions", contributions.error);
  return {
    goal: toGoal(data as Row, progress.get(id), today),
    contributions: (contributions.data as Row[]).map((c) => ({
      id: c.id as string,
      amountMinor: Number(c.amount_minor),
      contributedOn: c.contributed_on as string,
      note: (c.note as string | null) ?? null,
      createdBy: (c.created_by as string | null) ?? null,
    })),
  };
}

/** How the Goals screens describe the space a goal lives in. */
export function goalSpaceContext(space: Space): { label: string; shared: boolean; note: string } {
  if (space.kind === "shared") {
    const partner = partnerOf(space);
    return {
      label: spaceLabel(space),
      shared: true,
      note: `Goals here are shared with ${partner?.name ?? "your partner"}: you both see them and can add to them.`,
    };
  }
  return { label: spaceLabel(space), shared: false, note: "Goals in Mine are private: only you see them." };
}

/** Accounts in the space being viewed that a goal can follow: savings accounts first. */
export async function getLinkableAccounts(): Promise<{ id: string; name: string; isSavings: boolean; hasBalance: boolean }[]> {
  const connections = await getConnections("space");
  return connections
    .flatMap((c) => c.accounts)
    .filter((a) => a.provider !== "manual")
    .map((a) => ({ id: a.id, name: a.name, isSavings: !a.includeInBudget, hasBalance: a.balanceMinor !== null }))
    .sort((a, b) => Number(b.isSavings) - Number(a.isSavings));
}
