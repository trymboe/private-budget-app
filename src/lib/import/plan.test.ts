import { describe, expect, it } from "vitest";
import { buildPlan, fingerprintRows, type ExistingCategory, type ImportRow } from "./plan";

let line = 1;
function row(date: string, amountMinor: number, category: string | null, description: string | null = null): ImportRow {
  line += 1;
  return { line, date, amountMinor, currency: "NOK", category, kind: null, description, note: null };
}

const existing: ExistingCategory[] = [
  { id: "c-groceries", name: "Groceries", kind: "expense", archived: false, mergedIntoId: null },
  { id: "c-salary", name: "Salary", kind: "income", archived: false, mergedIntoId: null },
  { id: "c-old", name: "Mat", kind: "expense", archived: true, mergedIntoId: "c-groceries" },
  { id: "c-gone", name: "Hobby", kind: "expense", archived: true, mergedIntoId: null },
];

describe("buildPlan", () => {
  it("reuses categories by name (any case/spacing), follows merges, and creates the rest", () => {
    const plan = buildPlan(
      "buddy",
      [
        row("2024-01-02", -10_000, " groceries "),
        row("2024-01-03", -5_000, "Mat"),
        row("2024-01-04", 3_000_000, "Lønn"),
        row("2024-01-05", -2_000, "Hobby"),
        row("2024-01-06", -2_000, "Hobby"),
        row("2024-01-07", 1_000, "Hobby"),
      ],
      existing,
      { currency: "NOK", cutoff: null },
    );
    const byKey = Object.fromEntries(plan.categories.map((c) => [c.key, c.decision]));
    expect(byKey["groceries"]).toEqual({ action: "existing", categoryId: "c-groceries" });
    expect(byKey["mat"]).toEqual({ action: "existing", categoryId: "c-groceries" });
    expect(byKey["lønn"]).toEqual({ action: "create", kind: "income" });
    // Archived without a merge: a new active category is created (refunds don't make it income).
    expect(byKey["hobby"]).toEqual({ action: "create", kind: "expense" });
    expect(plan.categories.find((c) => c.key === "hobby")).toMatchObject({ name: "Hobby", rowCount: 3, spentMinor: 4_000, receivedMinor: 1_000 });
  });

  it("skips rows the bank already has, zero amounts, other currencies and earlier imports", () => {
    const rows = [
      row("2024-12-31", -100, "Groceries"),
      row("2025-01-01", -100, "Groceries"),
      row("2024-06-01", 0, "Groceries"),
      { ...row("2024-06-02", -100, "Groceries"), currency: "EUR" },
      row("2024-06-03", -700, null),
    ];
    const first = buildPlan("buddy", rows, existing, { currency: "NOK", cutoff: "2025-01-01" });
    expect(first.transactions.map((t) => t.date)).toEqual(["2024-12-31", "2024-06-03"]);
    expect(first.uncategorized).toBe(1);
    expect(Object.fromEntries(first.skipped.map((s) => [s.reason, s.count]))).toEqual({
      after_cutoff: 1,
      zero_amount: 1,
      other_currency: 1,
    });

    const again = buildPlan("buddy", rows, existing, {
      currency: "NOK",
      cutoff: "2025-01-01",
      existingFingerprints: new Set(first.transactions.map((t) => t.fingerprint)),
    });
    expect(again.transactions).toHaveLength(0);
  });

  it("keeps identical purchases on the same day as separate rows, stably", () => {
    const rows = [row("2024-03-01", -4_500, "Groceries", "Kaffe"), row("2024-03-01", -4_500, "Groceries", "Kaffe")];
    const a = fingerprintRows("buddy", rows);
    expect(new Set(a).size).toBe(2);
    // A later export with more rows keeps the earlier fingerprints.
    expect(fingerprintRows("buddy", [...rows, row("2024-03-02", -1, null)]).slice(0, 2)).toEqual(a);
  });

  it("applies the user's choices but never creates a duplicate active name", () => {
    const rows = [row("2024-01-02", -10_000, "Groceries"), row("2024-01-03", -10_000, "Kino")];
    const plan = buildPlan("buddy", rows, existing, {
      currency: "NOK",
      cutoff: null,
      decisions: {
        groceries: { action: "create", kind: "expense" },
        kino: { action: "existing", categoryId: "c-groceries" },
      },
    });
    const byKey = Object.fromEntries(plan.categories.map((c) => [c.key, c.decision]));
    expect(byKey["groceries"]).toEqual({ action: "existing", categoryId: "c-groceries" });
    expect(byKey["kino"]).toEqual({ action: "existing", categoryId: "c-groceries" });
  });
});
