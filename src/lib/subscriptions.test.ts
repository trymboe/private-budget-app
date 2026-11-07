import { describe, expect, it } from "vitest";
import {
  annualCost,
  buildSubscriptionList,
  chargesFromTransactions,
  classifyGaps,
  clusterByAmount,
  detectRecurring,
  monthlyEquivalent,
  nextChargeDate,
  sortByNextDate,
  summarizeSubscriptions,
  type Charge,
  type SubscriptionDecision,
  type TransactionLike,
} from "./subscriptions";

const TODAY = "2026-11-07";
let seq = 0;

function charge(date: string, kr: number, merchantKey = "netflix", extra: Partial<Charge> = {}): Charge {
  seq += 1;
  return { id: `c${seq}`, date, amountMinor: Math.round(kr * 100), merchantKey, name: merchantKey, categoryId: null, ...extra };
}

/** Charges on the same day of each month, from `from` (YYYY-MM-DD) for `n` months. */
function monthly(from: string, n: number, kr: number | ((i: number) => number), merchantKey = "netflix"): Charge[] {
  const out: Charge[] = [];
  let date = from;
  for (let i = 0; i < n; i++) {
    out.push(charge(date, typeof kr === "number" ? kr : kr(i), merchantKey));
    date = nextChargeDate(date, "monthly", Number(from.slice(8, 10)));
  }
  return out;
}

function tx(over: Partial<TransactionLike>): TransactionLike {
  seq += 1;
  return {
    id: `t${seq}`,
    effectiveDate: "2026-10-01",
    amountMinor: -12_900,
    currency: "NOK",
    merchantKey: "netflix",
    counterparty: "NETFLIX.COM",
    description: null,
    treatment: "budget",
    removed: false,
    categoryId: null,
    ...over,
  };
}

describe("chargesFromTransactions", () => {
  it("keeps outgoing NOK payments as positive costs", () => {
    const [c] = chargesFromTransactions([tx({ amountMinor: -12_900, categoryId: "cat" })]);
    expect(c).toMatchObject({ amountMinor: 12_900, merchantKey: "netflix", name: "Netflix.com", categoryId: "cat" });
  });

  it("skips income, refunds, transfers, removed and foreign-currency rows", () => {
    const out = chargesFromTransactions([
      tx({ amountMinor: 50_000 }),
      tx({ treatment: "transfer" }),
      tx({ removed: true }),
      tx({ currency: "EUR" }),
      tx({ merchantKey: null, counterparty: null, description: null }),
    ]);
    expect(out).toEqual([]);
  });

  it("derives a merchant key from the bank text when the row has none", () => {
    const [c] = chargesFromTransactions([tx({ merchantKey: null, counterparty: null, description: "VISA VARE 492500******1234 12.10 SPOTIFY AB" })]);
    expect(c.merchantKey).toBe("spotify");
  });

  it("still counts excluded payments (a work phone is still a fixed cost)", () => {
    expect(chargesFromTransactions([tx({ treatment: "excluded" })])).toHaveLength(1);
  });
});

describe("classifyGaps", () => {
  it("recognises each cadence", () => {
    expect(classifyGaps([7, 7, 7])).toBe("weekly");
    expect(classifyGaps([31, 30, 31])).toBe("monthly");
    expect(classifyGaps([28, 31])).toBe("monthly");
    expect(classifyGaps([91, 92])).toBe("quarterly");
    expect(classifyGaps([365])).toBe("yearly");
  });

  it("needs enough charges for the cadence", () => {
    expect(classifyGaps([30])).toBeNull(); // two monthly charges are not a pattern yet
    expect(classifyGaps([7, 7])).toBeNull();
    expect(classifyGaps([91])).toBeNull();
  });

  it("tolerates one skipped charge, but not a gap that is too short", () => {
    expect(classifyGaps([30, 61, 31])).toBe("monthly");
    expect(classifyGaps([30, 61, 61, 31])).toBeNull();
    expect(classifyGaps([30, 12, 31])).toBeNull();
  });

  it("rejects irregular spending", () => {
    expect(classifyGaps([3, 9, 2, 14, 5])).toBeNull();
    expect(classifyGaps([45, 70, 20])).toBeNull();
  });
});

describe("nextChargeDate", () => {
  it("steps one period and keeps the day of month", () => {
    expect(nextChargeDate("2026-10-14", "monthly")).toBe("2026-11-14");
    expect(nextChargeDate("2026-12-14", "monthly")).toBe("2027-01-14");
    expect(nextChargeDate("2026-10-14", "weekly")).toBe("2026-10-21");
    expect(nextChargeDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextChargeDate("2024-02-29", "yearly")).toBe("2025-02-28");
  });

  it("clamps to short months and returns to the usual day afterwards", () => {
    expect(nextChargeDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextChargeDate("2026-02-28", "monthly", 31)).toBe("2026-03-31");
  });
});

describe("clusterByAmount", () => {
  it("keeps a price increase in the same series and a one-off purchase apart", () => {
    const series = clusterByAmount([
      charge("2026-07-03", 129),
      charge("2026-08-03", 129),
      charge("2026-08-20", 399), // a one-off
      charge("2026-09-03", 149), // price increase, +15 %
      charge("2026-10-03", 149),
    ]);
    expect(series.map((s) => s.map((c) => c.amountMinor / 100))).toEqual([[129, 129, 149, 149], [399]]);
  });

  it("separates two subscriptions from the same merchant", () => {
    const series = clusterByAmount([
      charge("2026-08-01", 49, "apple"),
      charge("2026-08-05", 129, "apple"),
      charge("2026-09-01", 49, "apple"),
      charge("2026-09-05", 129, "apple"),
    ]);
    expect(series).toHaveLength(2);
  });
});

describe("detectRecurring", () => {
  it("finds a monthly subscription with its next date", () => {
    const [s] = detectRecurring(monthly("2026-05-14", 6, 129), TODAY);
    expect(s).toMatchObject({
      merchantKey: "netflix",
      cadence: "monthly",
      amountMinor: 12_900,
      variable: false,
      firstDate: "2026-05-14",
      lastDate: "2026-10-14",
      nextDate: "2026-11-14",
      active: true,
    });
  });

  it("finds weekly, quarterly and yearly payments", () => {
    const weekly = [0, 7, 14, 21, 28].map((d) => charge(addDaysIso("2026-10-03", d), 89, "sats"));
    const quarterly = [charge("2026-02-10", 1450, "gjensidige"), charge("2026-05-10", 1450, "gjensidige"), charge("2026-08-10", 1450, "gjensidige")];
    const yearly = [charge("2025-03-02", 990, "nrk"), charge("2026-03-01", 1090, "nrk")];
    const found = detectRecurring([...weekly, ...quarterly, ...yearly], TODAY);
    expect(found.map((s) => [s.merchantKey, s.cadence, s.nextDate])).toEqual([
      ["gjensidige", "quarterly", "2026-11-10"],
      ["nrk", "yearly", "2027-03-01"],
      ["sats", "weekly", "2026-11-07"],
    ]);
  });

  it("ignores everyday spending at the same shop", () => {
    const groceries = [1, 3, 4, 8, 10, 15, 16, 22, 24, 29].map((d, i) => charge(`2026-10-${String(d).padStart(2, "0")}`, 300 + i * 37, "rema 1000"));
    expect(detectRecurring(groceries, TODAY)).toEqual([]);
  });

  it("ignores amounts that jump around even on a monthly rhythm", () => {
    // Within 25 % of each other step by step, but drifting far from the median.
    const drifting = monthly("2026-04-02", 6, (i) => [200, 250, 310, 380, 470, 580][i], "elkjop");
    expect(detectRecurring(drifting, TODAY)).toEqual([]);
  });

  it("accepts a variable bill and uses its recent median", () => {
    const power = monthly("2026-05-20", 6, (i) => [610, 540, 575, 590, 650, 620][i], "fjordkraft");
    const [s] = detectRecurring(power, TODAY);
    expect(s).toMatchObject({ cadence: "monthly", variable: true, amountMinor: 62_000 });
  });

  it("marks a series with no recent charge as ended", () => {
    const [s] = detectRecurring(monthly("2026-01-05", 4, 99, "viaplay"), TODAY);
    expect(s.active).toBe(false);
  });

  it("does not count a duplicate on the same day as a short gap", () => {
    const list = monthly("2026-06-01", 4, 109, "spotify");
    list.push(charge("2026-08-01", 109, "spotify"));
    expect(detectRecurring(list, TODAY)).toHaveLength(1);
  });

  it("takes the most recent category", () => {
    const list = monthly("2026-07-09", 4, 59, "storytel");
    list[1].categoryId = "old";
    list[3].categoryId = "subs";
    expect(detectRecurring(list, TODAY)[0].categoryId).toBe("subs");
  });

  it("ignores future-dated rows", () => {
    const list = monthly("2026-09-01", 2, 59, "storytel");
    list.push(charge("2026-12-01", 59, "storytel"));
    expect(detectRecurring(list, TODAY)).toEqual([]);
  });
});

describe("costs", () => {
  it("converts every cadence to a monthly and yearly figure in whole øre", () => {
    expect(monthlyEquivalent(12_900, "monthly")).toBe(12_900);
    expect(monthlyEquivalent(8_900, "weekly")).toBe(38_567); // 89 kr × 52 / 12
    expect(monthlyEquivalent(145_000, "quarterly")).toBe(48_333);
    expect(monthlyEquivalent(99_000, "yearly")).toBe(8_250);
    expect(annualCost(8_900, "weekly")).toBe(462_800);
  });
});

function decision(over: Partial<SubscriptionDecision>): SubscriptionDecision {
  return {
    id: "d1",
    merchantKey: "netflix",
    cadence: "monthly",
    status: "confirmed",
    source: "detected",
    name: "Netflix",
    amountMinor: 12_900,
    categoryId: null,
    cancelledOn: null,
    transactionId: null,
    ...over,
  };
}

function listFor(charges: Charge[], decisions: SubscriptionDecision[] = []) {
  return buildSubscriptionList(detectRecurring(charges, TODAY), decisions, charges, TODAY);
}

describe("buildSubscriptionList", () => {
  it("lists an undecided detection as new", () => {
    const [item] = listFor(monthly("2026-06-14", 5, 129));
    expect(item).toMatchObject({
      status: "new",
      decisionId: null,
      name: "netflix",
      monthlyMinor: 12_900,
      nextDate: "2026-11-14",
      lastCharge: { date: "2026-10-14", amountMinor: 12_900 },
      priceIncrease: null,
    });
    expect(item.recentCharges[0].date).toBe("2026-10-14");
  });

  it("applies a stored decision and its name and category", () => {
    const [item] = listFor(monthly("2026-06-14", 5, 129), [decision({ name: "Netflix Premium", categoryId: "subs" })]);
    expect(item).toMatchObject({ status: "confirmed", decisionId: "d1", name: "Netflix Premium", categoryId: "subs" });
  });

  it("flags a price increase against the previous charge for a new detection", () => {
    const [item] = listFor(monthly("2026-06-14", 5, (i) => (i < 4 ? 129 : 149)));
    expect(item.priceIncrease).toEqual({ fromMinor: 12_900, toMinor: 14_900 });
    expect(item.amountMinor).toBe(14_900);
  });

  it("flags a price increase against the accepted price until it is accepted", () => {
    const charges = monthly("2026-06-14", 5, (i) => (i < 3 ? 129 : 149));
    expect(listFor(charges, [decision({ amountMinor: 12_900 })])[0].priceIncrease).toEqual({ fromMinor: 12_900, toMinor: 14_900 });
    expect(listFor(charges, [decision({ amountMinor: 14_900 })])[0].priceIncrease).toBeNull();
  });

  it("does not flag small changes, decreases or variable bills", () => {
    expect(listFor(monthly("2026-06-14", 5, (i) => (i < 4 ? 129 : 129.5)))[0].priceIncrease).toBeNull();
    expect(listFor(monthly("2026-06-14", 5, (i) => (i < 4 ? 149 : 129)))[0].priceIncrease).toBeNull();
    const power = monthly("2026-05-20", 6, (i) => [540, 610, 575, 590, 560, 650][i], "fjordkraft");
    expect(listFor(power)[0]).toMatchObject({ variable: true, priceIncrease: null, range: { min: 56_000, max: 65_000 } });
  });

  it("keeps dismissed items (for undo) and drops ended ones nobody decided on", () => {
    const charges = [...monthly("2026-06-14", 5, 129), ...monthly("2026-01-05", 4, 99, "viaplay")];
    const items = listFor(charges, [decision({ status: "dismissed" })]);
    expect(items.map((i) => [i.merchantKey, i.status])).toEqual([["netflix", "dismissed"]]);
    expect(items[0].nextDate).toBeNull();
  });

  it("keeps a confirmed subscription whose charges stopped, marked overdue", () => {
    const [item] = listFor(monthly("2026-01-05", 4, 99, "viaplay"), [decision({ merchantKey: "viaplay", amountMinor: 9_900 })]);
    expect(item).toMatchObject({ status: "confirmed", overdue: true, nextDate: "2026-05-05" });
  });

  it("notices a charge after the person cancelled", () => {
    const charges = monthly("2026-06-14", 5, 129);
    const [item] = listFor(charges, [decision({ status: "cancelled", cancelledOn: "2026-09-20" })]);
    expect(item).toMatchObject({ status: "cancelled", nextDate: null, chargedAfterCancel: { date: "2026-10-14", amountMinor: 12_900 } });
    const [quiet] = listFor(charges, [decision({ status: "cancelled", cancelledOn: "2026-10-20" })]);
    expect(quiet.chargedAfterCancel).toBeNull();
  });

  it("shows one added by hand from a single transaction", () => {
    const charges = [charge("2026-10-25", 549, "sats")];
    const [item] = listFor(charges, [decision({ merchantKey: "sats", name: "SATS", amountMinor: 54_900, source: "manual" })]);
    expect(item).toMatchObject({ source: "manual", status: "confirmed", nextDate: "2026-11-25", lastCharge: { date: "2026-10-25" }, overdue: false });
  });

  it("shows a manual one even with no matching charge yet", () => {
    const [item] = listFor([], [decision({ merchantKey: "husleie", name: "Rent", amountMinor: 1_200_000, source: "manual" })]);
    expect(item).toMatchObject({ amountMinor: 1_200_000, lastCharge: null, nextDate: null });
  });

  it("gives each of two same-merchant series its own key, and the decision to the closest price", () => {
    const charges = [...monthly("2026-06-01", 5, 49, "apple"), ...monthly("2026-06-05", 5, 129, "apple")];
    const items = listFor(charges, [decision({ merchantKey: "apple", amountMinor: 12_900 })]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
    expect(items.find((i) => i.amountMinor === 12_900)?.status).toBe("confirmed");
    expect(items.find((i) => i.amountMinor === 4_900)?.status).toBe("new");
  });
});

describe("buildSubscriptionList with several decisions for one merchant", () => {
  const apple = () => [...monthly("2026-05-03", 6, 39, "apple"), ...monthly("2026-05-12", 6, 129, "apple")];

  it("keeps a decision on each of two series, whatever order they load in", () => {
    const charges = apple();
    const small = decision({ id: "d39", merchantKey: "apple", name: "iCloud", amountMinor: 3_900 });
    const big = decision({ id: "d129", merchantKey: "apple", name: "Apple One", amountMinor: 12_900 });
    for (const order of [[small, big], [big, small]]) {
      const items = buildSubscriptionList(detectRecurring(charges, TODAY), order, charges, TODAY);
      expect(items.map((i) => [i.decisionId, i.status, i.amountMinor]).sort()).toEqual([
        ["d129", "confirmed", 12_900],
        ["d39", "confirmed", 3_900],
      ]);
      expect(summarizeSubscriptions(items).monthlyMinor).toBe(16_800);
    }
  });

  it("does not let a far-off decision claim a series it does not match", () => {
    // Only the 129 kr series is detected; iCloud was tracked by hand from one 39 kr payment.
    const charges = [...monthly("2026-05-12", 6, 129, "apple"), charge("2026-10-03", 39, "apple", { id: "icloud" })];
    const order = [
      decision({ id: "d39", merchantKey: "apple", name: "iCloud", amountMinor: 3_900, source: "manual", transactionId: "icloud" }),
      decision({ id: "d129", merchantKey: "apple", name: "Apple One", amountMinor: 12_900 }),
    ];
    const items = buildSubscriptionList(detectRecurring(charges, TODAY), order, charges, TODAY);
    const byId = Object.fromEntries(items.map((i) => [i.decisionId, i])) as Record<string, (typeof items)[number]>;
    expect(byId.d129).toMatchObject({ amountMinor: 12_900, priceIncrease: null });
    expect(byId.d39).toMatchObject({ name: "iCloud", priceIncrease: null });
    expect(byId.d39.recentCharges.map((c) => c.amountMinor)).toEqual([3_900]);
    expect(summarizeSubscriptions(items).monthlyMinor).toBe(16_800);
  });

  it("shows a decision saved twice for the same series only once", () => {
    const charges = monthly("2026-05-12", 6, 129, "apple");
    const twice = [
      decision({ id: "a", merchantKey: "apple", amountMinor: 12_900 }),
      decision({ id: "b", merchantKey: "apple", amountMinor: 12_900 }),
    ];
    const items = buildSubscriptionList(detectRecurring(charges, TODAY), twice, charges, TODAY);
    expect(items).toHaveLength(1);
    expect(summarizeSubscriptions(items).monthlyMinor).toBe(12_900);
  });
});

describe("summarizeSubscriptions", () => {
  it("totals confirmed and new items, leaving out cancelled, dismissed and stopped ones", () => {
    const charges = [
      ...monthly("2026-06-14", 5, 129), // confirmed
      ...monthly("2026-06-03", 5, 109, "spotify"), // new
      ...monthly("2026-06-20", 5, 59, "storytel"), // cancelled
      ...monthly("2026-06-22", 5, 99, "viaplay"), // dismissed
      ...monthly("2026-01-05", 4, 79, "hbo"), // confirmed but stopped
      charge("2025-12-01", 990, "nrk"),
      charge("2026-12-01", 990, "nrk"), // future: ignored
    ];
    const items = listFor(charges, [
      decision({}),
      decision({ id: "d2", merchantKey: "storytel", status: "cancelled", cancelledOn: "2026-11-01" }),
      decision({ id: "d3", merchantKey: "viaplay", status: "dismissed" }),
      decision({ id: "d4", merchantKey: "hbo", amountMinor: 7_900 }),
    ]);
    expect(summarizeSubscriptions(items)).toEqual({
      monthlyMinor: 23_800,
      annualMinor: 285_600,
      activeCount: 2,
      newCount: 1,
      unconfirmedMonthlyMinor: 10_900,
      priceIncreaseCount: 0,
    });
  });

  it("sorts upcoming first and possibly-ended last", () => {
    const charges = [...monthly("2026-06-20", 5, 129), ...monthly("2026-06-09", 5, 109, "spotify"), ...monthly("2026-01-05", 4, 79, "hbo")];
    const items = sortByNextDate(listFor(charges, [decision({ merchantKey: "hbo", amountMinor: 7_900 })]));
    expect(items.map((i) => i.merchantKey)).toEqual(["spotify", "netflix", "hbo"]);
  });
});

function addDaysIso(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
