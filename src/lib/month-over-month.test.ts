import { describe, expect, it } from "vitest";
import { monthOverMonth, parseRange, windowMonths } from "./month-over-month";

const current = "2026-11-01";

function build(entries: { spent?: [string, string, number][]; budget?: [string, string, number][] }, opts: { partial?: string[]; range?: number } = {}) {
  const spent = new Map((entries.spent ?? []).map(([m, c, v]) => [`${m}|${c}`, v]));
  const budget = new Map((entries.budget ?? []).map(([m, c, v]) => [`${m}|${c}`, v]));
  const partial = new Set(opts.partial ?? []);
  return monthOverMonth({
    months: windowMonths(current, opts.range ?? 3),
    current,
    categories: [{ id: "groceries" }, { id: "restaurants" }, { id: "travel" }],
    spent,
    budget,
    isPartial: (m) => partial.has(m),
  });
}

describe("windowMonths", () => {
  it("lists the finished months then the running month, across a year boundary", () => {
    expect(windowMonths("2026-02-01", 3)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });
});

describe("parseRange", () => {
  it("accepts only the offered ranges", () => {
    expect(parseRange("3")).toBe(3);
    expect(parseRange("12")).toBe(12);
    expect(parseRange("7")).toBe(6);
    expect(parseRange(undefined)).toBe(6);
    expect(parseRange("abc")).toBe(6);
  });
});

describe("monthOverMonth", () => {
  const budgets: [string, string, number][] = ["2026-08-01", "2026-09-01", "2026-10-01", "2026-11-01"].flatMap((m) => [
    [m, "groceries", 400_000] as [string, string, number],
    [m, "restaurants", 100_000] as [string, string, number],
  ]);

  it("computes budget, spent and variance per category and month", () => {
    const r = build({
      budget: budgets,
      spent: [
        ["2026-08-01", "groceries", 380_000],
        ["2026-09-01", "groceries", 450_000],
        ["2026-10-01", "groceries", 400_000],
        ["2026-11-01", "groceries", 120_000],
        ["2026-09-01", "restaurants", 50_000],
      ],
    });
    expect(r.columns.map((c) => c.status)).toEqual(["complete", "complete", "complete", "current"]);
    const g = r.rows.find((x) => x.category.id === "groceries")!;
    expect(g.cells.map((c) => c.variance)).toEqual([20_000, -50_000, 0, 280_000]);
    // The running month is shown but never averaged.
    expect(g.completeMonths).toBe(3);
    expect(g.averageSpent).toBe(410_000);
    expect(g.averageBudget).toBe(400_000);
    expect(g.averageVariance).toBe(-10_000);
    expect(g.totalVariance).toBe(-30_000);
    expect(g.overMonths).toBe(1);
    // Exactly on budget counts as within budget.
    expect(g.underMonths).toBe(2);
  });

  it("sums the total across categories", () => {
    const r = build({
      budget: budgets,
      spent: [
        ["2026-09-01", "groceries", 450_000],
        ["2026-09-01", "restaurants", 50_000],
      ],
    });
    const sep = r.total.cells.find((c) => c.month === "2026-09-01")!;
    expect(sep).toMatchObject({ budget: 500_000, spent: 500_000, variance: 0 });
    expect(r.total.averageBudget).toBe(500_000);
    expect(r.total.totalVariance).toBe(1_000_000);
  });

  it("marks months the bank did not fully provide as partial and leaves them out of averages", () => {
    const r = build(
      {
        budget: budgets,
        spent: [
          ["2026-08-01", "groceries", 100_000],
          ["2026-09-01", "groceries", 400_000],
          ["2026-10-01", "groceries", 500_000],
        ],
      },
      { partial: ["2026-08-01"] },
    );
    expect(r.columns[0].status).toBe("partial");
    const g = r.rows.find((x) => x.category.id === "groceries")!;
    expect(g.completeMonths).toBe(2);
    expect(g.averageSpent).toBe(450_000);
    expect(g.totalVariance).toBe(-100_000);
  });

  it("treats leading months with no budget and no spending as before you started", () => {
    const r = build(
      {
        budget: [["2026-10-01", "groceries", 400_000]],
        spent: [["2026-10-01", "groceries", 300_000]],
      },
      { range: 6 },
    );
    expect(r.columns.map((c) => c.status)).toEqual(["empty", "empty", "empty", "empty", "empty", "complete", "current"]);
    expect(r.total.completeMonths).toBe(1);
    expect(r.total.averageSpent).toBe(300_000);
  });

  it("keeps a quiet month after you started as a complete month", () => {
    const r = build({
      budget: [
        ["2026-08-01", "groceries", 400_000],
        ["2026-10-01", "groceries", 400_000],
      ],
      spent: [["2026-08-01", "groceries", 400_000]],
    });
    expect(r.columns.map((c) => c.status)).toEqual(["complete", "complete", "complete", "current"]);
    const g = r.rows[0];
    expect(g.cells[1]).toMatchObject({ budget: 0, spent: 0, variance: 0 });
    // A month with neither budget nor spending is neither over nor under.
    expect(g.overMonths + g.underMonths).toBe(2);
  });

  it("lets refunds lower spending, even below zero", () => {
    const r = build({ budget: [["2026-10-01", "travel", 0]], spent: [["2026-10-01", "travel", -20_000]] });
    const t = r.rows.find((x) => x.category.id === "travel")!;
    expect(t.cells.find((c) => c.month === "2026-10-01")).toMatchObject({ spent: -20_000, variance: 20_000 });
  });

  it("leaves out categories with nothing in the window and keeps the given order", () => {
    const r = build({
      spent: [
        ["2026-10-01", "travel", 10_000],
        ["2026-10-01", "groceries", 10_000],
      ],
    });
    expect(r.rows.map((x) => x.category.id)).toEqual(["groceries", "travel"]);
  });

  it("returns empty rows and zero averages when there is no data", () => {
    const r = build({});
    expect(r.rows).toEqual([]);
    expect(r.columns.map((c) => c.status)).toEqual(["empty", "empty", "empty", "current"]);
    expect(r.total).toMatchObject({ completeMonths: 0, averageSpent: 0, averageVariance: 0, totalVariance: 0 });
  });

  it("keeps money in whole øre when averaging", () => {
    const r = build({
      budget: budgets,
      spent: [
        ["2026-08-01", "groceries", 1],
        ["2026-09-01", "groceries", 1],
        ["2026-10-01", "groceries", 2],
      ],
    });
    const g = r.rows.find((x) => x.category.id === "groceries")!;
    expect(Number.isSafeInteger(g.averageSpent)).toBe(true);
    expect(g.averageSpent).toBe(1);
  });
});
