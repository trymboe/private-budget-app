import "server-only";
import { requireUser } from "@/lib/auth";
import { budgetPerformance, type MonthPerformance } from "@/lib/budget";
import { addMonths, daysInMonth, diffDays, monthStart, type IsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getConnections, getToday, isMonthPartial } from "./queries";
import type { Category } from "./types";

export type CategoryTrend = { category: Category; months: { month: IsoDate; spent: number; budget: number }[]; average: number };

export type Insights = {
  today: IsoDate;
  performance: MonthPerformance[];
  cumulativeVariance: number;
  averageSpent: number;
  completeMonths: number;
  currentMonth: IsoDate;
  pace: { day: number; thisMonth: number | null; lastMonth: number | null }[];
  thisMonthBudget: number;
  trends: CategoryTrend[];
  cashFlow: { month: IsoDate; inflow: number; outflow: number; net: number; partial: boolean }[];
};

const MONTHS = 12;

export async function getInsights(): Promise<Insights> {
  await requireUser();
  const supabase = await createClient();
  const [today, categories, connections] = await Promise.all([getToday(), getCategories(), getConnections()]);
  const current = monthStart(today);
  const first = addMonths(current, -(MONTHS - 1));
  const previous = addMonths(current, -1);

  const [totals, budgets, flows, daily] = await Promise.all([
    supabase.from("monthly_category_totals").select("month, category_id, net_minor").gte("month", first),
    supabase.from("monthly_budgets").select("month, category_id, amount_minor").gte("month", first).lte("month", current),
    supabase.from("monthly_cash_flow").select("month, inflow_minor, outflow_minor").gte("month", first),
    supabase
      .from("transaction_allocations")
      .select("category_id, amount_minor, transactions!inner ( effective_date, treatment, removed_at, accounts!inner ( include_in_budget ) )")
      .gte("transactions.effective_date", previous)
      .eq("transactions.treatment", "budget")
      .is("transactions.removed_at", null)
      .eq("transactions.accounts.include_in_budget", true)
      .limit(10000),
  ]);
  for (const r of [totals, budgets, flows, daily]) {
    if (r.error) {
      console.error("[insights] query failed", r.error.code);
      throw new Error("Could not load insights.");
    }
  }

  const expense = new Map(categories.filter((c) => c.kind === "expense").map((c) => [c.id, c]));
  const months = Array.from({ length: MONTHS }, (_, i) => addMonths(first, i));

  const spentBy = new Map<string, number>(); // `${month}|${category}`
  for (const t of totals.data!) {
    if (!expense.has(t.category_id)) continue;
    spentBy.set(`${t.month}|${t.category_id}`, -Number(t.net_minor));
  }
  const budgetBy = new Map<string, number>();
  for (const b of budgets.data!) {
    if (!expense.has(b.category_id)) continue;
    budgetBy.set(`${b.month}|${b.category_id}`, Number(b.amount_minor));
  }

  const monthRows = months.map((month) => {
    let spent = 0;
    let budget = 0;
    for (const id of expense.keys()) {
      spent += spentBy.get(`${month}|${id}`) ?? 0;
      budget += budgetBy.get(`${month}|${id}`) ?? 0;
    }
    // The running month is incomplete by definition; so are months the bank did
    // not (fully) provide.
    const partial = month === current || isMonthPartial(connections, month);
    return { month, budget, spent, partial };
  });
  // Drop leading months with neither budget nor spending (before you started).
  const firstUseful = monthRows.findIndex((m) => m.budget > 0 || m.spent !== 0);
  const useful = firstUseful === -1 ? [] : monthRows.slice(firstUseful);
  // The running month is on the home screen; here only finished months are judged.
  const perf = budgetPerformance(useful.filter((m) => m.budget > 0 && m.month < current));

  // Daily cumulative spending: this month vs last month.
  const perDay = { [current]: new Map<number, number>(), [previous]: new Map<number, number>() } as Record<string, Map<number, number>>;
  for (const a of daily.data! as unknown as { category_id: string; amount_minor: number; transactions: { effective_date: string } }[]) {
    if (!expense.has(a.category_id)) continue;
    const date = a.transactions.effective_date;
    const m = monthStart(date);
    if (!perDay[m]) continue;
    const day = Number(date.slice(8, 10));
    perDay[m].set(day, (perDay[m].get(day) ?? 0) - Number(a.amount_minor));
  }
  const todayDay = diffDays(today, current) + 1;
  const maxDay = Math.max(daysInMonth(current), daysInMonth(previous));
  const pace: Insights["pace"] = [];
  let cumThis = 0;
  let cumLast = 0;
  for (let d = 1; d <= maxDay; d++) {
    cumThis += perDay[current].get(d) ?? 0;
    cumLast += perDay[previous].get(d) ?? 0;
    pace.push({
      day: d,
      thisMonth: d <= todayDay ? cumThis : null,
      lastMonth: d <= daysInMonth(previous) ? cumLast : null,
    });
  }

  const trends: CategoryTrend[] = [...expense.values()]
    .filter((c) => !c.archived)
    .map((category) => {
      const rows = useful.map((m) => ({
        month: m.month,
        spent: spentBy.get(`${m.month}|${category.id}`) ?? 0,
        budget: budgetBy.get(`${m.month}|${category.id}`) ?? 0,
      }));
      const complete = rows.filter((r, i) => !useful[i].partial);
      const average = complete.length ? Math.round(complete.reduce((s, r) => s + r.spent, 0) / complete.length) : 0;
      return { category, months: rows, average };
    })
    .filter((t) => t.months.some((m) => m.spent !== 0 || m.budget !== 0))
    .sort((a, b) => b.average - a.average);

  const flowBy = new Map(flows.data!.map((f) => [f.month as string, f]));
  const cashFlow = useful.map((m) => {
    const f = flowBy.get(m.month);
    const inflow = Number(f?.inflow_minor ?? 0);
    const outflow = -Number(f?.outflow_minor ?? 0);
    return { month: m.month, inflow, outflow, net: inflow - outflow, partial: m.partial };
  });

  return {
    today,
    performance: perf.months,
    cumulativeVariance: perf.cumulativeVariance,
    averageSpent: perf.averageSpent,
    completeMonths: perf.completeMonths,
    currentMonth: current,
    pace,
    thisMonthBudget: monthRows.at(-1)?.budget ?? 0,
    trends,
    cashFlow,
  };
}
