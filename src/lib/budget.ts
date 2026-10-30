// Budget arithmetic. Pure functions over integer minor units, shared by the
// dashboard, budget page and insights, and covered by unit tests.
//
// Definitions (kept deliberately separate):
//   spending      Net of allocations to expense categories, sign-flipped so that
//                 a purchase is positive and a refund reduces it.
//   budget        The month's snapshot in monthly_budgets for expense categories.
//   variance      budget - spending (positive = under budget).
//   cash flow     income - expenses over all budget-included transactions,
//                 regardless of categories. Not the same thing as variance.
// Transfers and excluded transactions never count. Transactions on accounts not
// included in the budget never count. Foreign-currency rows are reported, not summed.
import { addDays, daysInMonth, diffDays, monthStart, weekStart, type IsoDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";

export type BudgetCategory = {
  id: string;
  name: string;
  kind: "expense" | "income";
  isFixed: boolean;
  color: string;
  icon: string;
  sortOrder: number;
  archived: boolean;
};

export type BudgetTransaction = {
  id: string;
  amountMinor: Minor;
  currency: string;
  effectiveDate: IsoDate;
  treatment: "budget" | "transfer" | "excluded";
  needsReview: boolean;
  removed: boolean;
  accountIncluded: boolean;
  allocations: { categoryId: string; amountMinor: Minor }[];
};

export type CategoryStatus = "unbudgeted" | "comfortable" | "approaching" | "over";

export type CategoryLine = {
  category: BudgetCategory;
  budget: Minor;
  spent: Minor;
  remaining: Minor;
  /** 0-100+, integer. */
  usedPercent: number;
  status: CategoryStatus;
};

export type MonthSummary = {
  month: IsoDate;
  today: IsoDate;
  isCurrentMonth: boolean;
  daysInMonth: number;
  /** Days elapsed including today (current month), else full/zero. */
  daysElapsed: number;
  /** Days left including today. */
  daysLeft: number;
  totalBudget: Minor;
  spent: Minor;
  remaining: Minor;
  usedPercent: number;
  lines: CategoryLine[];
  /** Spending in expense categories that have no budget this month. */
  unbudgetedSpent: Minor;
  income: Minor;
  uncategorized: { count: number; outflow: Minor; inflow: Minor };
  foreignCurrencyCount: number;
  pace: Pace;
};

export type Pace = {
  fixedBudget: Minor;
  fixedSpent: Minor;
  flexibleBudget: Minor;
  flexibleSpent: Minor;
  /** Steady-pace flexible spending expected by the end of today. */
  flexibleExpected: Minor;
  /** flexibleExpected - flexibleSpent: positive means spending slower than pace. */
  flexibleAhead: Minor;
  /** What can be spent per day for the rest of the month to land on budget. */
  dailyAllowance: Minor;
  weekStart: IsoDate;
  weekSpent: Minor;
  /** Sustainable flexible spending for this whole week (Mon-Sun, within the month). */
  weekAllowance: Minor;
  /** Expected marker for the whole-month bar: fixed spent + steady flexible pace. */
  expectedTotalByNow: Minor;
};

export const APPROACHING_PERCENT = 85;

function percent(part: Minor, whole: Minor): number {
  if (whole <= 0) return part > 0 ? 100 : 0;
  return Math.round((part * 100) / whole);
}

/** Integer division rounding toward zero; inputs are integers. */
function idiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

export function categoryStatus(budget: Minor, spent: Minor): CategoryStatus {
  if (budget <= 0) return spent > 0 ? "unbudgeted" : "comfortable";
  if (spent > budget) return "over";
  if (spent * 100 >= budget * APPROACHING_PERCENT) return "approaching";
  return "comfortable";
}

export function countsTowardBudget(tx: BudgetTransaction, baseCurrency: string): boolean {
  return tx.accountIncluded && !tx.removed && tx.treatment === "budget" && tx.currency === baseCurrency;
}

export function summarizeMonth(input: {
  month: IsoDate;
  today: IsoDate;
  categories: BudgetCategory[];
  budgets: Map<string, Minor>;
  transactions: BudgetTransaction[];
  baseCurrency?: string;
}): MonthSummary {
  const { month, today, categories, budgets, transactions, baseCurrency = "NOK" } = input;
  const start = monthStart(month);
  const dim = daysInMonth(start);
  const end = addDays(start, dim - 1);
  const isCurrentMonth = monthStart(today) === start;
  const daysElapsed = isCurrentMonth ? diffDays(today, start) + 1 : today > end ? dim : 0;
  const daysLeft = isCurrentMonth ? dim - daysElapsed + 1 : today > end ? 0 : dim;

  const byId = new Map(categories.map((c) => [c.id, c]));
  const net = new Map<string, Minor>(); // net allocation per category (signed)
  const thisWeekStart = isCurrentMonth ? weekStart(today) : start;
  let weekFlexNet = 0;
  let uncategorizedCount = 0;
  let uncategorizedOut = 0;
  let uncategorizedIn = 0;
  let foreign = 0;

  for (const tx of transactions) {
    if (tx.effectiveDate < start || tx.effectiveDate > end) continue;
    if (tx.accountIncluded && !tx.removed && tx.treatment === "budget" && tx.currency !== baseCurrency) {
      foreign += 1;
      continue;
    }
    if (!countsTowardBudget(tx, baseCurrency)) continue;
    if (tx.allocations.length === 0) {
      uncategorizedCount += 1;
      if (tx.amountMinor < 0) uncategorizedOut += -tx.amountMinor;
      else uncategorizedIn += tx.amountMinor;
      continue;
    }
    for (const a of tx.allocations) {
      net.set(a.categoryId, (net.get(a.categoryId) ?? 0) + a.amountMinor);
      const cat = byId.get(a.categoryId);
      if (cat && cat.kind === "expense" && !cat.isFixed && tx.effectiveDate >= thisWeekStart && tx.effectiveDate <= today) {
        weekFlexNet += a.amountMinor;
      }
    }
  }

  const lines: CategoryLine[] = [];
  let totalBudget = 0;
  let spent = 0;
  let unbudgetedSpent = 0;
  let income = 0;
  let fixedBudget = 0;
  let fixedSpent = 0;
  let flexibleBudget = 0;
  let flexibleSpent = 0;

  for (const category of [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    const n = net.get(category.id) ?? 0;
    if (category.kind === "income") {
      income += n;
      continue;
    }
    const budget = budgets.get(category.id) ?? 0;
    const catSpent = -n;
    // Archived categories only show when they carry money this month.
    if (category.archived && budget === 0 && catSpent === 0) continue;
    totalBudget += budget;
    spent += catSpent;
    if (budget === 0) unbudgetedSpent += catSpent;
    if (category.isFixed) {
      fixedBudget += budget;
      fixedSpent += catSpent;
    } else {
      flexibleBudget += budget;
      flexibleSpent += catSpent;
    }
    lines.push({
      category,
      budget,
      spent: catSpent,
      remaining: budget - catSpent,
      usedPercent: percent(catSpent, budget),
      status: categoryStatus(budget, catSpent),
    });
  }

  // Pace: fixed costs are lumpy (rent on the 1st), so only flexible spending is
  // compared with a steady daily pace.
  const flexibleExpected = idiv(flexibleBudget * daysElapsed, dim);
  const flexibleRemaining = flexibleBudget - flexibleSpent;
  const dailyAllowance = daysLeft > 0 ? Math.max(0, idiv(flexibleRemaining, daysLeft)) : 0;

  // Weekly allowance: what was sustainable at the start of this week, over the
  // days of this week that fall inside the month.
  const weekDaysInMonth = isCurrentMonth ? Math.min(7, diffDays(end, thisWeekStart) + 1) : 0;
  const daysLeftAtWeekStart = isCurrentMonth ? diffDays(end, thisWeekStart) + 1 : 0;
  const weekSpent = -weekFlexNet;
  const spentBeforeWeek = flexibleSpent - weekSpent;
  const weekAllowance =
    daysLeftAtWeekStart > 0
      ? Math.max(0, idiv((flexibleBudget - spentBeforeWeek) * weekDaysInMonth, daysLeftAtWeekStart))
      : 0;

  return {
    month: start,
    today,
    isCurrentMonth,
    daysInMonth: dim,
    daysElapsed,
    daysLeft,
    totalBudget,
    spent,
    remaining: totalBudget - spent,
    usedPercent: percent(spent, totalBudget),
    lines,
    unbudgetedSpent,
    income,
    uncategorized: { count: uncategorizedCount, outflow: uncategorizedOut, inflow: uncategorizedIn },
    foreignCurrencyCount: foreign,
    pace: {
      fixedBudget,
      fixedSpent,
      flexibleBudget,
      flexibleSpent,
      flexibleExpected,
      flexibleAhead: flexibleExpected - flexibleSpent,
      dailyAllowance,
      weekStart: thisWeekStart,
      weekSpent,
      weekAllowance,
      expectedTotalByNow: Math.max(fixedSpent, 0) + flexibleExpected,
    },
  };
}

export type MonthPerformance = {
  month: IsoDate;
  budget: Minor;
  spent: Minor;
  variance: Minor;
  /** Integer percent deviation from budget: positive = over budget. */
  deviationPercent: number;
  partial: boolean;
  cumulativeVariance: Minor;
};

/**
 * Month-by-month budget variance with a running total. Each month uses its own
 * budget snapshot. Partial months (incomplete bank history, or the current month)
 * are shown but excluded from the cumulative total so missing data is never
 * mistaken for saving money.
 */
export function budgetPerformance(
  months: { month: IsoDate; budget: Minor; spent: Minor; partial: boolean }[],
): { months: MonthPerformance[]; cumulativeVariance: Minor; averageSpent: Minor; completeMonths: number } {
  let cumulative = 0;
  let completeSpent = 0;
  let complete = 0;
  const rows = [...months]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => {
      const variance = m.budget - m.spent;
      if (!m.partial) {
        cumulative += variance;
        completeSpent += m.spent;
        complete += 1;
      }
      return {
        ...m,
        variance,
        deviationPercent: m.budget > 0 ? Math.round(((m.spent - m.budget) * 100) / m.budget) : 0,
        cumulativeVariance: cumulative,
      };
    });
  return {
    months: rows,
    cumulativeVariance: cumulative,
    averageSpent: complete > 0 ? Math.round(completeSpent / complete) : 0,
    completeMonths: complete,
  };
}

/** Validate that a proposed split sums exactly to the transaction amount. */
export function validateSplit(amountMinor: Minor, parts: { categoryId: string; amountMinor: Minor }[]): string | null {
  if (parts.length < 1) return "Add at least one category.";
  if (parts.some((p) => !Number.isSafeInteger(p.amountMinor) || p.amountMinor === 0)) return "Every part needs an amount.";
  if (new Set(parts.map((p) => p.categoryId)).size !== parts.length) return "Each category can appear only once.";
  const sum = parts.reduce((s, p) => s + p.amountMinor, 0);
  if (sum !== amountMinor) return "The parts must add up to the full amount.";
  return null;
}
