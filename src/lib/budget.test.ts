import { describe, expect, it } from "vitest";
import { budgetPerformance, categoryStatus, summarizeMonth, validateSplit, type BudgetCategory, type BudgetTransaction } from "./budget";
import { findTransferPairs } from "./suggest";

const cat = (id: string, extra: Partial<BudgetCategory> = {}): BudgetCategory => ({
  id,
  name: id,
  kind: "expense",
  isFixed: false,
  color: "stone",
  icon: "circle",
  sortOrder: 0,
  archived: false,
  ...extra,
});

let n = 0;
const tx = (amountMinor: number, date: string, alloc: [string, number][] | null, extra: Partial<BudgetTransaction> = {}): BudgetTransaction => ({
  id: `t${++n}`,
  amountMinor,
  currency: "NOK",
  effectiveDate: date,
  treatment: "budget",
  needsReview: alloc === null,
  removed: false,
  accountIncluded: true,
  allocations: (alloc ?? []).map(([categoryId, a]) => ({ categoryId, amountMinor: a })),
  ...extra,
});

const categories = [cat("groceries"), cat("restaurants"), cat("housing", { isFixed: true }), cat("salary", { kind: "income" })];
const budgets = new Map([
  ["groceries", 400_000],
  ["restaurants", 150_000],
  ["housing", 1_200_000],
]);

describe("summarizeMonth", () => {
  const transactions = [
    tx(-1_200_000, "2026-10-01", [["housing", -1_200_000]]),
    tx(-60_000, "2026-10-03", [
      ["groceries", -45_000],
      ["restaurants", -15_000],
    ]),
    tx(-30_000, "2026-10-20", [["groceries", -30_000]]),
    tx(5_000, "2026-10-21", [["groceries", 5_000]]), // refund
    tx(4_500_000, "2026-10-15", [["salary", 4_500_000]]),
    tx(-200_000, "2026-10-05", null, { treatment: "transfer", needsReview: false }),
    tx(-9_900, "2026-10-19", null), // uncategorised
    tx(-50_000, "2026-10-10", [["groceries", -50_000]], { accountIncluded: false }),
    tx(-12_300, "2026-10-11", [["groceries", -12_300]], { removed: true }),
    tx(-2_000, "2026-10-12", [["groceries", -2_000]], { currency: "EUR" }),
    tx(-99_999, "2026-09-30", [["groceries", -99_999]]), // previous month
  ];
  const s = summarizeMonth({ month: "2026-10-01", today: "2026-10-21", categories, budgets, transactions });

  it("computes spending net of refunds, ignoring transfers, excluded accounts, removed rows", () => {
    const g = s.lines.find((l) => l.category.id === "groceries")!;
    expect(g.spent).toBe(45_000 + 30_000 - 5_000);
    expect(s.spent).toBe(1_200_000 + 70_000 + 15_000);
    expect(s.totalBudget).toBe(1_750_000);
    expect(s.remaining).toBe(1_750_000 - 1_285_000);
  });

  it("reports income, uncategorised and foreign-currency rows separately", () => {
    expect(s.income).toBe(4_500_000);
    expect(s.uncategorized).toEqual({ count: 1, outflow: 9_900, inflow: 0 });
    expect(s.foreignCurrencyCount).toBe(1);
  });

  it("counts days including today", () => {
    expect(s.daysInMonth).toBe(31);
    expect(s.daysElapsed).toBe(21);
    expect(s.daysLeft).toBe(11);
  });

  it("paces only flexible spending, so rent on the 1st does not look like overspending", () => {
    expect(s.pace.flexibleBudget).toBe(550_000);
    expect(s.pace.flexibleSpent).toBe(85_000);
    expect(s.pace.flexibleExpected).toBe(Math.trunc((550_000 * 21) / 31));
    expect(s.pace.flexibleAhead).toBeGreaterThan(0);
    expect(s.pace.dailyAllowance).toBe(Math.trunc((550_000 - 85_000) / 11));
  });

  it("computes this week's flexible spending from Monday", () => {
    // 2026-10-21 is a Wednesday; week starts Monday 19th.
    expect(s.pace.weekStart).toBe("2026-10-19");
    expect(s.pace.weekSpent).toBe(30_000 - 5_000);
  });
});

describe("categoryStatus", () => {
  it("classifies comfortable, approaching and over", () => {
    expect(categoryStatus(100_000, 50_000)).toBe("comfortable");
    expect(categoryStatus(100_000, 85_000)).toBe("approaching");
    expect(categoryStatus(100_000, 100_001)).toBe("over");
    expect(categoryStatus(0, 100)).toBe("unbudgeted");
  });
});

describe("budgetPerformance", () => {
  it("uses each month's own budget and keeps a cumulative total", () => {
    const r = budgetPerformance([
      { month: "2026-02-01", budget: 2_000_000, spent: 2_050_000, partial: false },
      { month: "2026-01-01", budget: 2_000_000, spent: 1_880_000, partial: false },
      { month: "2026-03-01", budget: 2_200_000, spent: 2_000_000, partial: false },
    ]);
    expect(r.months.map((m) => m.variance)).toEqual([120_000, -50_000, 200_000]);
    expect(r.cumulativeVariance).toBe(270_000);
    expect(r.months[1].deviationPercent).toBe(3);
  });

  it("excludes partial months from the cumulative total", () => {
    const r = budgetPerformance([
      { month: "2026-01-01", budget: 2_000_000, spent: 300_000, partial: true },
      { month: "2026-02-01", budget: 2_000_000, spent: 1_900_000, partial: false },
    ]);
    expect(r.cumulativeVariance).toBe(100_000);
    expect(r.completeMonths).toBe(1);
  });
});

describe("validateSplit", () => {
  it("requires parts to sum exactly", () => {
    expect(validateSplit(-60_000, [{ categoryId: "a", amountMinor: -45_000 }, { categoryId: "b", amountMinor: -15_000 }])).toBeNull();
    expect(validateSplit(-60_000, [{ categoryId: "a", amountMinor: -45_000 }, { categoryId: "b", amountMinor: -14_999 }])).toMatch(/add up/);
    expect(validateSplit(-60_000, [{ categoryId: "a", amountMinor: -30_000 }, { categoryId: "a", amountMinor: -30_000 }])).toMatch(/once/);
  });
});

describe("findTransferPairs", () => {
  it("pairs mirrored amounts between different accounts within 3 days", () => {
    const pairs = findTransferPairs([
      { id: "out", accountId: "checking", amountMinor: -500_000, currency: "NOK", effectiveDate: "2026-10-05" },
      { id: "in", accountId: "savings", amountMinor: 500_000, currency: "NOK", effectiveDate: "2026-10-06" },
      { id: "same-account", accountId: "checking", amountMinor: 500_000, currency: "NOK", effectiveDate: "2026-10-05" },
      { id: "too-late", accountId: "savings", amountMinor: 500_000, currency: "NOK", effectiveDate: "2026-10-15" },
    ]);
    expect(pairs).toEqual([["out", "in"]]);
  });
});
