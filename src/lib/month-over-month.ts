import { addMonths, type IsoDate } from "@/lib/dates";
import { formatMoney, type Minor } from "@/lib/money";

// Budget vs actual, month over month, for every expense category and the total.
// Pure so it can be unit tested; the data layer feeds it rows from
// `monthly_category_totals` and `monthly_budgets`.

/** Ranges the screen offers (finished months, plus the running month shown as "so far"). */
export const MONTH_RANGES = [3, 6, 12] as const;
export type MonthRange = (typeof MONTH_RANGES)[number];
export const DEFAULT_RANGE: MonthRange = 6;

export function parseRange(value: string | undefined | null): MonthRange {
  const n = Number(value);
  return (MONTH_RANGES as readonly number[]).includes(n) ? (n as MonthRange) : DEFAULT_RANGE;
}

/**
 * Why a month is (not) judged:
 * - complete: finished, and the bank data for it is whole.
 * - current: the running month; shown "so far", never judged.
 * - partial: finished, but the bank history does not cover all of it.
 * - empty: before you started (no budget and no spending in any category).
 * Only complete months count toward averages and totals.
 */
export type MonthStatus = "complete" | "current" | "partial" | "empty";

export type MonthCell = {
  month: IsoDate;
  budget: Minor;
  spent: Minor;
  /** budget − spent: positive is under budget, negative is over. */
  variance: Minor;
  status: MonthStatus;
};

export type MonthColumn = { month: IsoDate; status: MonthStatus };

export type RowSummary = {
  /** Number of complete months the averages are taken over. */
  completeMonths: number;
  averageBudget: Minor;
  averageSpent: Minor;
  averageVariance: Minor;
  /** Sum of variance over complete months. */
  totalVariance: Minor;
  overMonths: number;
  underMonths: number;
};

export type MonthOverMonthRow<C> = { category: C; cells: MonthCell[] } & RowSummary;

export type MonthOverMonth<C> = {
  columns: MonthColumn[];
  total: { cells: MonthCell[] } & RowSummary;
  rows: MonthOverMonthRow<C>[];
};

/** The months shown: `range` finished months followed by the running month. */
export function windowMonths(current: IsoDate, range: number): IsoDate[] {
  return Array.from({ length: range + 1 }, (_, i) => addMonths(current, i - range));
}

const key = (month: IsoDate, categoryId: string) => `${month}|${categoryId}`;

function summarize(cells: MonthCell[]): RowSummary {
  const complete = cells.filter((c) => c.status === "complete");
  const n = complete.length;
  const sum = (f: (c: MonthCell) => number) => complete.reduce((s, c) => s + f(c), 0);
  const avg = (f: (c: MonthCell) => number) => (n > 0 ? Math.round(sum(f) / n) : 0);
  return {
    completeMonths: n,
    averageBudget: avg((c) => c.budget),
    averageSpent: avg((c) => c.spent),
    averageVariance: avg((c) => c.variance),
    totalVariance: sum((c) => c.variance),
    // A month with no budget and no spending is neither over nor under.
    overMonths: complete.filter((c) => c.variance < 0).length,
    underMonths: complete.filter((c) => c.variance > 0 || (c.variance === 0 && c.budget > 0)).length,
  };
}

/**
 * Build the month-over-month table.
 *
 * `spent` and `budget` are keyed `${month}|${categoryId}`; spending is positive
 * (money out), refunds lower it. Categories keep the order they are given in
 * (the user's order, so rows never jump around); categories with nothing in the
 * window are left out, as are archived ones with nothing in it.
 */
export function monthOverMonth<C extends { id: string }>(input: {
  months: IsoDate[];
  current: IsoDate;
  categories: C[];
  spent: Map<string, Minor>;
  budget: Map<string, Minor>;
  /** True when the bank data for that month is known to be incomplete. */
  isPartial: (month: IsoDate) => boolean;
}): MonthOverMonth<C> {
  const { months, current, categories, spent, budget, isPartial } = input;
  const ordered = [...months].sort();

  const value = (map: Map<string, Minor>, month: IsoDate, id: string) => map.get(key(month, id)) ?? 0;

  // Leading months with neither budget nor spending in any category are "before
  // you started". A quiet month in the middle of your history still counts.
  const used = ordered.map((m) => categories.some((c) => value(spent, m, c.id) !== 0 || value(budget, m, c.id) !== 0));
  const firstUsed = used.indexOf(true);

  const columns: MonthColumn[] = ordered.map((month, i) => ({
    month,
    status:
      month >= current ? "current" : firstUsed === -1 || i < firstUsed ? "empty" : isPartial(month) ? "partial" : "complete",
  }));

  const cellsFor = (get: (month: IsoDate) => { budget: Minor; spent: Minor }): MonthCell[] =>
    columns.map(({ month, status }) => {
      const v = get(month);
      return { month, budget: v.budget, spent: v.spent, variance: v.budget - v.spent, status };
    });

  const rows = categories
    .map((category) => {
      const cells = cellsFor((m) => ({ budget: value(budget, m, category.id), spent: value(spent, m, category.id) }));
      return { category, cells, ...summarize(cells) };
    })
    .filter((r) => r.cells.some((c) => c.budget !== 0 || c.spent !== 0));

  const totalCells = cellsFor((m) => ({
    budget: categories.reduce((s, c) => s + value(budget, m, c.id), 0),
    spent: categories.reduce((s, c) => s + value(spent, m, c.id), 0),
  }));

  return { columns, total: { cells: totalCells, ...summarize(totalCells) }, rows };
}

/** Short label for a month that is not judged. */
export const STATUS_NOTE: Record<MonthStatus, string | null> = {
  complete: null,
  current: "so far",
  partial: "incomplete",
  empty: "before you started",
};

/** "1 200 kr under", "300 kr over", "on budget" or "nothing". */
export function varianceText(cell: { variance: Minor; budget: Minor; spent: Minor }): string {
  const kr = (minor: Minor) => formatMoney(minor, "NOK", { decimals: "never" });
  if (cell.budget === 0 && cell.spent === 0) return "nothing";
  if (cell.variance === 0) return "on budget";
  return cell.variance > 0 ? `${kr(cell.variance)} under` : `${kr(-cell.variance)} over`;
}
