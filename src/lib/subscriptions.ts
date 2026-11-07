// Subscriptions and fixed costs: recurring payments found in transaction history.
//
// Pure functions only (unit tested in subscriptions.test.ts). Detection works on
// outgoing NOK payments:
//   1. Group by merchant key (normalizeMerchant), so "VISA VARE ... NETFLIX.COM"
//      and "Netflix" land together.
//   2. Within a merchant, split charges into series of similar amounts. Each charge
//      joins the series whose latest amount is closest, within a tolerance, so a
//      price increase stays in the same series while a one-off purchase of a
//      different size does not.
//   3. A series is recurring when the gaps between its charges fit one cadence
//      (weekly, monthly, quarterly, yearly), with at most one longer gap for a
//      missed or late charge, and its amounts are steady (either mostly unchanged,
//      or all close to the median, like a phone bill).
// Decisions the person made (confirmed, dismissed, cancelled, added by hand) are
// stored per merchant and cadence and merged in by buildSubscriptionList.

import { addDays, diffDays, type IsoDate } from "@/lib/dates";
import { displayMerchant, normalizeMerchant } from "@/lib/merchant";
import type { Minor } from "@/lib/money";

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";
export const CADENCES: readonly Cadence[] = ["weekly", "monthly", "quarterly", "yearly"];

type CadenceRule = {
  /** Gaps (days) that count as one period. */
  minDays: number;
  maxDays: number;
  /** Charges needed before a series is called recurring. */
  minCharges: number;
  /** Periods per year, for the monthly equivalent. */
  perYear: number;
  /** A series with no charge for this many days has probably ended. */
  staleAfterDays: number;
};

export const CADENCE_RULES: Record<Cadence, CadenceRule> = {
  weekly: { minDays: 6, maxDays: 8, minCharges: 4, perYear: 52, staleAfterDays: 15 },
  monthly: { minDays: 26, maxDays: 35, minCharges: 3, perYear: 12, staleAfterDays: 50 },
  quarterly: { minDays: 84, maxDays: 98, minCharges: 3, perYear: 4, staleAfterDays: 130 },
  yearly: { minDays: 350, maxDays: 380, minCharges: 2, perYear: 1, staleAfterDays: 410 },
};

/** How far back to read history: enough for two yearly charges. */
export const HISTORY_DAYS = 430;

/** Two charges are "the same subscription" if within 25 % (and at least 5 kr) of each other. */
const AMOUNT_TOLERANCE = 0.25;
const AMOUNT_TOLERANCE_MIN: Minor = 500;
/** A change below 2 % (rounding, currency) is not a price change. */
const STEADY_CHANGE = 0.02;
/** Variable bills (phone, power) still count when every charge is within 20 % of the median. */
const VARIABLE_SPREAD = 0.2;
/** A price increase is flagged from 3 % and at least 1 kr. */
const INCREASE_MIN_RATIO = 0.03;
const INCREASE_MIN: Minor = 100;

export type TransactionLike = {
  id: string;
  effectiveDate: IsoDate;
  /** Signed: negative is money out. */
  amountMinor: Minor;
  currency: string;
  merchantKey: string | null;
  counterparty: string | null;
  description: string | null;
  treatment: "budget" | "transfer" | "excluded";
  removed: boolean;
  /** The single category, when the transaction has exactly one. */
  categoryId: string | null;
};

/** One outgoing payment, amount as a positive cost. */
export type Charge = {
  id: string;
  date: IsoDate;
  amountMinor: Minor;
  merchantKey: string;
  name: string;
  categoryId: string | null;
};

export type DetectedSeries = {
  merchantKey: string;
  name: string;
  cadence: Cadence;
  /** Oldest first. */
  charges: Charge[];
  /** What it costs now: the latest charge, or the recent median for a variable bill. */
  amountMinor: Minor;
  /** True when amounts move from charge to charge (a bill rather than a fixed price). */
  variable: boolean;
  firstDate: IsoDate;
  lastDate: IsoDate;
  nextDate: IsoDate;
  /** False when the expected charge is long overdue: probably ended. */
  active: boolean;
  categoryId: string | null;
};

/** Outgoing NOK payments that could be subscriptions. Transfers between own accounts never are. */
export function chargesFromTransactions(transactions: TransactionLike[]): Charge[] {
  const out: Charge[] = [];
  for (const t of transactions) {
    if (t.removed || t.treatment === "transfer" || t.amountMinor >= 0 || t.currency !== "NOK") continue;
    const key = t.merchantKey || normalizeMerchant(t.counterparty || t.description);
    if (!key) continue;
    out.push({
      id: t.id,
      date: t.effectiveDate,
      amountMinor: -t.amountMinor,
      merchantKey: key,
      name: displayMerchant(t.counterparty, t.description),
      categoryId: t.categoryId,
    });
  }
  return out;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function withinTolerance(a: Minor, b: Minor): boolean {
  const ref = Math.max(a, b);
  return Math.abs(a - b) <= Math.max(AMOUNT_TOLERANCE_MIN, ref * AMOUNT_TOLERANCE);
}

function byDate(a: Charge, b: Charge) {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1;
}

/** Split one merchant's charges (oldest first) into series of similar amounts. */
export function clusterByAmount(charges: Charge[]): Charge[][] {
  const series: Charge[][] = [];
  for (const c of [...charges].sort(byDate)) {
    let best: Charge[] | null = null;
    let bestDiff = Infinity;
    for (const s of series) {
      const last = s[s.length - 1].amountMinor;
      const diff = Math.abs(last - c.amountMinor);
      if (withinTolerance(last, c.amountMinor) && diff < bestDiff) {
        best = s;
        bestDiff = diff;
      }
    }
    if (best) best.push(c);
    else series.push([c]);
  }
  return series;
}

/**
 * The cadence that the gaps between charges fit, if any. Every gap must fit the
 * period, except one longer gap (a skipped or late charge) once there are at
 * least three gaps.
 */
export function classifyGaps(gaps: number[], chargeCount = gaps.length + 1): Cadence | null {
  if (gaps.length === 0) return null;
  for (const cadence of CADENCES) {
    const r = CADENCE_RULES[cadence];
    if (chargeCount < r.minCharges) continue;
    const fits = gaps.filter((g) => g >= r.minDays && g <= r.maxDays).length;
    const tooShort = gaps.some((g) => g < r.minDays);
    if (tooShort) continue;
    const misses = gaps.length - fits;
    if (misses === 0 || (misses === 1 && gaps.length >= 3)) return cadence;
  }
  return null;
}

/** Same day next period. Monthly dates keep the day of month, clamped to short months. */
export function nextChargeDate(last: IsoDate, cadence: Cadence, dayOfMonth?: number): IsoDate {
  if (cadence === "weekly") return addDays(last, 7);
  const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  const y = Number(last.slice(0, 4));
  const m = Number(last.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = (m % 12) + 1;
  const daysIn = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dayOfMonth ?? Number(last.slice(8, 10)), daysIn);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Amounts mostly unchanged from one charge to the next. */
function isSteady(amounts: Minor[]): boolean {
  let changes = 0;
  for (let i = 1; i < amounts.length; i++) {
    if (Math.abs(amounts[i] - amounts[i - 1]) > amounts[i - 1] * STEADY_CHANGE) changes++;
  }
  return changes <= Math.max(1, Math.floor((amounts.length - 1) / 3));
}

function isNarrow(amounts: Minor[]): boolean {
  const m = median(amounts);
  return amounts.every((a) => Math.abs(a - m) <= m * VARIABLE_SPREAD);
}

/** Usual day of month: the most recent charges, so a moved due date is followed. */
function usualDay(charges: Charge[]): number {
  if (charges.length < 3) return Number(charges[charges.length - 1].date.slice(8, 10));
  return median(charges.slice(-3).map((c) => Number(c.date.slice(8, 10))));
}

function analyseSeries(charges: Charge[], today: IsoDate): DetectedSeries | null {
  // Two charges on the same day are one payment split in two at the bank, or a
  // duplicate; neither helps decide the rhythm.
  const unique = charges.filter((c, i) => i === 0 || c.date !== charges[i - 1].date);
  if (unique.length < 2) return null;
  const gaps = unique.slice(1).map((c, i) => diffDays(c.date, unique[i].date));
  const cadence = classifyGaps(gaps, unique.length);
  if (!cadence) return null;
  const amounts = unique.map((c) => c.amountMinor);
  const steady = isSteady(amounts);
  if (!steady && !isNarrow(amounts)) return null;

  const last = unique[unique.length - 1];
  const variable = !steady;
  const nextDate = nextChargeDate(last.date, cadence, cadence === "weekly" ? undefined : usualDay(unique));
  const categoryId = [...unique].reverse().find((c) => c.categoryId)?.categoryId ?? null;
  return {
    merchantKey: last.merchantKey,
    name: last.name,
    cadence,
    charges: unique,
    amountMinor: variable ? median(amounts.slice(-3)) : last.amountMinor,
    variable,
    firstDate: unique[0].date,
    lastDate: last.date,
    nextDate,
    active: diffDays(today, last.date) <= CADENCE_RULES[cadence].staleAfterDays,
    categoryId,
  };
}

/** Every recurring series in the charges, including ones that seem to have ended. */
export function detectRecurring(charges: Charge[], today: IsoDate): DetectedSeries[] {
  const byMerchant = new Map<string, Charge[]>();
  for (const c of charges) {
    if (c.date > today) continue;
    const list = byMerchant.get(c.merchantKey);
    if (list) list.push(c);
    else byMerchant.set(c.merchantKey, [c]);
  }
  const found: DetectedSeries[] = [];
  for (const list of byMerchant.values()) {
    for (const series of clusterByAmount(list)) {
      const s = analyseSeries(series, today);
      if (s) found.push(s);
    }
  }
  return found.sort((a, b) => (a.merchantKey < b.merchantKey ? -1 : a.merchantKey > b.merchantKey ? 1 : a.amountMinor - b.amountMinor));
}

/** Cost per year in øre. */
export function annualCost(amountMinor: Minor, cadence: Cadence): Minor {
  return amountMinor * CADENCE_RULES[cadence].perYear;
}

/** Cost per month in øre, rounded to whole øre. */
export function monthlyEquivalent(amountMinor: Minor, cadence: Cadence): Minor {
  return Math.round(annualCost(amountMinor, cadence) / 12);
}

// ---------------------------------------------------------------------------
// Merging detections with stored decisions
// ---------------------------------------------------------------------------

export type SubscriptionDecision = {
  id: string;
  merchantKey: string;
  cadence: Cadence;
  status: "confirmed" | "dismissed" | "cancelled";
  source: "detected" | "manual";
  name: string;
  /** The price last accepted. */
  amountMinor: Minor;
  categoryId: string | null;
  cancelledOn: IsoDate | null;
  transactionId: string | null;
};

export type SubscriptionStatus = "new" | "confirmed" | "cancelled" | "dismissed";

export type SubscriptionItem = {
  /** Stable for React and for actions: merchant and cadence. */
  key: string;
  decisionId: string | null;
  status: SubscriptionStatus;
  source: "detected" | "manual";
  merchantKey: string;
  name: string;
  cadence: Cadence;
  /** What it costs per charge now. */
  amountMinor: Minor;
  /** The price the person accepted (stored with the decision), if any. */
  acceptedMinor: Minor | null;
  cancelledOn: IsoDate | null;
  monthlyMinor: Minor;
  annualMinor: Minor;
  variable: boolean;
  /** Lowest and highest of the recent charges, for a variable bill. */
  range: { min: Minor; max: Minor } | null;
  categoryId: string | null;
  firstDate: IsoDate | null;
  lastCharge: { date: IsoDate; amountMinor: Minor } | null;
  /** Expected next charge; null once cancelled or dismissed. */
  nextDate: IsoDate | null;
  /** The expected charge is well past due (maybe it ended). */
  overdue: boolean;
  priceIncrease: { fromMinor: Minor; toMinor: Minor } | null;
  /** Charged again after the person said it was cancelled. */
  chargedAfterCancel: { date: IsoDate; amountMinor: Minor } | null;
  chargeCount: number;
  /** Most recent first, at most 12. */
  recentCharges: { id: string; date: IsoDate; amountMinor: Minor }[];
};

export function subscriptionKey(merchantKey: string, cadence: Cadence): string {
  return `${cadence}:${merchantKey}`;
}

function isIncrease(from: Minor, to: Minor): boolean {
  const diff = to - from;
  return diff >= INCREASE_MIN && diff >= from * INCREASE_MIN_RATIO;
}

/**
 * Charges that belong to a stored decision when detection did not produce a
 * matching series (added by hand, or its rhythm broke): same merchant, amounts
 * within tolerance of the accepted price.
 */
function chargesForDecision(d: SubscriptionDecision, charges: Charge[]): Charge[] {
  return charges.filter((c) => c.merchantKey === d.merchantKey && withinTolerance(c.amountMinor, d.amountMinor)).sort(byDate);
}

/** Detections and decisions as one list. Dismissed items are included (status "dismissed") so they can be undone. */
export function buildSubscriptionList(
  detected: DetectedSeries[],
  decisions: SubscriptionDecision[],
  charges: Charge[],
  today: IsoDate,
): SubscriptionItem[] {
  // A decision applies to the series with the same merchant and cadence; if one
  // merchant has two such series, to the one closest to the accepted price.
  const claimed = new Map<DetectedSeries, SubscriptionDecision>();
  const unmatched: SubscriptionDecision[] = [];
  for (const d of decisions) {
    const candidates = detected.filter((s) => s.merchantKey === d.merchantKey && s.cadence === d.cadence && !claimed.has(s));
    if (candidates.length === 0) {
      unmatched.push(d);
      continue;
    }
    candidates.sort((a, b) => Math.abs(a.amountMinor - d.amountMinor) - Math.abs(b.amountMinor - d.amountMinor));
    claimed.set(candidates[0], d);
  }

  const items: SubscriptionItem[] = [];
  for (const s of detected) {
    const d = claimed.get(s) ?? null;
    // An ended series nobody decided about is history, not a subscription.
    if (!d && !s.active) continue;
    items.push(makeItem(d, s.charges, s, today));
  }
  for (const d of unmatched) items.push(makeItem(d, chargesForDecision(d, charges), null, today));

  // Two detected series with the same merchant and cadence would share a key;
  // keep keys unique for the UI (only the first can carry a decision).
  const seen = new Map<string, number>();
  for (const item of items) {
    const n = seen.get(item.key) ?? 0;
    seen.set(item.key, n + 1);
    if (n > 0) item.key = `${item.key}#${n}`;
  }
  return items;
}

function makeItem(d: SubscriptionDecision | null, charges: Charge[], s: DetectedSeries | null, today: IsoDate): SubscriptionItem {
  const cadence = d?.cadence ?? s!.cadence;
  const merchantKey = d?.merchantKey ?? s!.merchantKey;
  const last = charges.at(-1) ?? null;
  const variable = s?.variable ?? false;
  const current = s ? s.amountMinor : (last?.amountMinor ?? d!.amountMinor);
  const status: SubscriptionStatus = d ? d.status : "new";

  let priceIncrease: SubscriptionItem["priceIncrease"] = null;
  if (!variable && last && status !== "dismissed" && status !== "cancelled") {
    if (d) {
      if (isIncrease(d.amountMinor, last.amountMinor)) priceIncrease = { fromMinor: d.amountMinor, toMinor: last.amountMinor };
    } else if (charges.length >= 2) {
      const prev = charges[charges.length - 2].amountMinor;
      if (isIncrease(prev, last.amountMinor)) priceIncrease = { fromMinor: prev, toMinor: last.amountMinor };
    }
  }

  const live = status === "new" || status === "confirmed";
  let nextDate: IsoDate | null = null;
  let overdue = false;
  if (live && last) {
    const day = cadence === "weekly" ? undefined : usualDay(charges);
    nextDate = nextChargeDate(last.date, cadence, day);
    overdue = diffDays(today, last.date) > CADENCE_RULES[cadence].staleAfterDays;
  }

  let chargedAfterCancel: SubscriptionItem["chargedAfterCancel"] = null;
  if (status === "cancelled" && d?.cancelledOn) {
    const after = charges.filter((c) => c.date > d.cancelledOn!).at(-1);
    if (after) chargedAfterCancel = { date: after.date, amountMinor: after.amountMinor };
  }

  const recent = charges.slice(-3).map((c) => c.amountMinor);
  return {
    key: subscriptionKey(merchantKey, cadence),
    decisionId: d?.id ?? null,
    status,
    source: d?.source ?? "detected",
    merchantKey,
    name: d?.name ?? s!.name,
    cadence,
    amountMinor: current,
    acceptedMinor: d?.amountMinor ?? null,
    cancelledOn: d?.cancelledOn ?? null,
    monthlyMinor: monthlyEquivalent(current, cadence),
    annualMinor: annualCost(current, cadence),
    variable,
    range: variable && recent.length > 1 ? { min: Math.min(...recent), max: Math.max(...recent) } : null,
    categoryId: d?.categoryId ?? s?.categoryId ?? last?.categoryId ?? null,
    firstDate: charges[0]?.date ?? null,
    lastCharge: last ? { date: last.date, amountMinor: last.amountMinor } : null,
    nextDate,
    overdue,
    priceIncrease,
    chargedAfterCancel,
    chargeCount: charges.length,
    recentCharges: charges
      .slice(-12)
      .reverse()
      .map((c) => ({ id: c.id, date: c.date, amountMinor: c.amountMinor })),
  };
}

export type SubscriptionTotals = {
  /** Confirmed and new (not yet confirmed) items, before cancellations. */
  monthlyMinor: Minor;
  annualMinor: Minor;
  activeCount: number;
  newCount: number;
  /** Part of the total that is not confirmed yet. */
  unconfirmedMonthlyMinor: Minor;
  priceIncreaseCount: number;
};

export function summarizeSubscriptions(items: SubscriptionItem[]): SubscriptionTotals {
  const live = items.filter((i) => (i.status === "confirmed" || i.status === "new") && !i.overdue);
  const annual = live.reduce((sum, i) => sum + i.annualMinor, 0);
  const unconfirmed = live.filter((i) => i.status === "new").reduce((sum, i) => sum + i.annualMinor, 0);
  return {
    monthlyMinor: Math.round(annual / 12),
    annualMinor: annual,
    activeCount: live.length,
    newCount: items.filter((i) => i.status === "new").length,
    unconfirmedMonthlyMinor: Math.round(unconfirmed / 12),
    priceIncreaseCount: live.filter((i) => i.priceIncrease).length,
  };
}

/** Upcoming first; overdue ones (maybe ended) last. */
export function sortByNextDate(items: SubscriptionItem[]): SubscriptionItem[] {
  return [...items].sort((a, b) => {
    if (a.overdue !== b.overdue) return a.overdue ? 1 : -1;
    const x = a.nextDate ?? "9999";
    const y = b.nextDate ?? "9999";
    return x < y ? -1 : x > y ? 1 : b.monthlyMinor - a.monthlyMinor;
  });
}

export const CADENCE_LABEL: Record<Cadence, { adjective: string; per: string }> = {
  weekly: { adjective: "Weekly", per: "week" },
  monthly: { adjective: "Monthly", per: "month" },
  quarterly: { adjective: "Every 3 months", per: "quarter" },
  yearly: { adjective: "Yearly", per: "year" },
};
