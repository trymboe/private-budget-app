import "server-only";
import { requireUser } from "@/lib/auth";
import { monthStart, type IsoDate } from "@/lib/dates";
import { monthOverMonth, windowMonths, type MonthOverMonth, type MonthRange } from "@/lib/month-over-month";
import { getActiveSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getConnections, getToday, isMonthPartial } from "./queries";
import type { Category } from "./types";

export type MonthOverMonthData = MonthOverMonth<Category> & {
  range: MonthRange;
  currentMonth: IsoDate;
  /** Per month: transactions still waiting for review, so not in any category yet. */
  unreviewed: Record<IsoDate, { count: number }>;
};

/** Budget vs actual for each expense category over the last `range` finished months and the running one. */
export async function getMonthOverMonth(range: MonthRange): Promise<MonthOverMonthData> {
  await requireUser();
  const supabase = await createClient();
  const [today, categories, connections, space] = await Promise.all([getToday(), getCategories(), getConnections(), getActiveSpace()]);
  const current = monthStart(today);
  const months = windowMonths(current, range);
  const first = months[0];

  const [totals, budgets, flows] = await Promise.all([
    supabase
      .from("monthly_category_totals")
      .select("month, category_id, net_minor")
      .eq("space_id", space.id)
      .gte("month", first)
      .lte("month", current),
    supabase
      .from("monthly_budgets")
      .select("month, category_id, amount_minor")
      .eq("space_id", space.id)
      .gte("month", first)
      .lte("month", current),
    supabase.from("monthly_cash_flow").select("month, unreviewed_count").eq("space_id", space.id).gte("month", first).lte("month", current),
  ]);
  for (const r of [totals, budgets, flows]) {
    if (r.error) {
      console.error("[month-over-month] query failed", r.error.code);
      throw new Error("Could not load month over month.");
    }
  }

  const expense = categories.filter((c) => c.kind === "expense");
  const ids = new Set(expense.map((c) => c.id));
  const spent = new Map<string, number>();
  for (const t of totals.data!) {
    if (ids.has(t.category_id)) spent.set(`${t.month}|${t.category_id}`, -Number(t.net_minor));
  }
  const budget = new Map<string, number>();
  for (const b of budgets.data!) {
    if (ids.has(b.category_id)) budget.set(`${b.month}|${b.category_id}`, Number(b.amount_minor));
  }
  const unreviewed: MonthOverMonthData["unreviewed"] = {};
  for (const f of flows.data!) {
    const count = Number(f.unreviewed_count ?? 0);
    if (count > 0) unreviewed[f.month as string] = { count };
  }

  const result = monthOverMonth({
    months,
    current,
    categories: expense,
    spent,
    budget,
    isPartial: (m) => isMonthPartial(connections, m),
  });
  return { ...result, range, currentMonth: current, unreviewed };
}
