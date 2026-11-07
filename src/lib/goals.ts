// Savings goal progress. Pure functions on integer øre and ISO dates, so they can
// be unit tested and used on the server and in the browser alike.
//
// Progress = money from a linked account (optional) + contributions logged by hand.
// A linked account contributes either what came into it since the goal started
// ("growth", always available from transactions) or its balance ("balance", only
// when the bank has told us). `accountProgress` is the one place that chooses, so
// a better balance source can plug in there later.

import { diffDays, type IsoDate } from "@/lib/dates";
import { assertMinor, type Minor } from "@/lib/money";

export type AccountBasis = "growth" | "balance";

export type LinkedAccountFigures = {
  basis: AccountBasis;
  /** Net of the account's transactions since the goal's start date. */
  growthMinor: Minor;
  /** Latest known balance, or null when the bank has not reported one. */
  balanceMinor: Minor | null;
};

export type GoalFigures = {
  targetMinor: Minor;
  targetDate: IsoDate | null;
  startsOn: IsoDate;
  contributedMinor: Minor;
  account: LinkedAccountFigures | null;
};

export type GoalSchedule = {
  targetDate: IsoDate;
  /** Monthly instalments left, counting the current month. 0 once the date has passed. */
  monthsLeft: number;
  /** What to put aside each month from now on, rounded up to whole kroner. */
  perMonthMinor: Minor;
  /** Where a steady pace from the start date would be today. */
  expectedByNowMinor: Minor;
  /** saved − expected: positive is ahead of a steady pace. */
  gapMinor: Minor;
  status: "reached" | "ahead" | "on_track" | "behind" | "overdue";
};

export type GoalProgress = {
  savedMinor: Minor;
  fromAccountMinor: Minor;
  fromContributionsMinor: Minor;
  /** Which account figure was used, or null without a linked account. */
  accountSource: AccountBasis | null;
  /** Balance was asked for but is not known, so growth since the start is shown instead. */
  balanceUnavailable: boolean;
  /** Whole percent, rounded down so 100 only shows when the target is met. Never below 0. */
  percent: number;
  leftMinor: Minor;
  reached: boolean;
  schedule: GoalSchedule | null;
};

/** The account's share of a goal's progress. */
export function accountProgress(account: LinkedAccountFigures): { minor: Minor; source: AccountBasis; balanceUnavailable: boolean } {
  if (account.basis === "balance") {
    if (account.balanceMinor !== null) return { minor: assertMinor(account.balanceMinor), source: "balance", balanceUnavailable: false };
    return { minor: assertMinor(account.growthMinor), source: "growth", balanceUnavailable: true };
  }
  return { minor: assertMinor(account.growthMinor), source: "growth", balanceUnavailable: false };
}

/**
 * Monthly instalments between today and the target date, counting this month.
 * Today 7 Nov, target 1 Jun: Nov … May = 7. Target 30 Jun: Nov … Jun = 8.
 * Any date later this month is 1. A date in the past is 0.
 */
export function monthsUntil(today: IsoDate, target: IsoDate): number {
  if (target <= today) return 0;
  const [y, m, d] = today.split("-").map(Number);
  const [ty, tm, td] = target.split("-").map(Number);
  const months = (ty - y) * 12 + (tm - m) + (td > d ? 1 : 0);
  return Math.max(1, months);
}

/** Integer ceiling of a / b for non-negative safe integers. */
function ceilDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  while (q * b < a) q += 1;
  while (q > 0 && (q - 1) * b >= a) q -= 1;
  return q;
}

/** Round up to a whole unit (100 øre = 1 kr). */
function ceilTo(minor: Minor, unit: number): Minor {
  return ceilDiv(minor, unit) * unit;
}

/** Share of the way from start to target that has passed, applied to `targetMinor`. */
function steadyPaceAmount(targetMinor: Minor, startsOn: IsoDate, targetDate: IsoDate, today: IsoDate): Minor {
  const total = diffDays(targetDate, startsOn);
  if (total <= 0) return targetMinor;
  const elapsed = Math.min(total, Math.max(0, diffDays(today, startsOn)));
  // BigInt: target × days can exceed 2^53 for large targets over long periods.
  return Number((BigInt(targetMinor) * BigInt(elapsed)) / BigInt(total));
}

/** How close to steady pace counts as "on track": 3 % of the target. */
const ON_TRACK_TOLERANCE_PERCENT = 3;

export function goalProgress(goal: GoalFigures, today: IsoDate): GoalProgress {
  const target = assertMinor(goal.targetMinor);
  const contributions = assertMinor(goal.contributedMinor);
  const account = goal.account ? accountProgress(goal.account) : null;
  const fromAccount = account?.minor ?? 0;
  const saved = assertMinor(fromAccount + contributions);
  const counted = Math.max(0, saved);
  const reached = target > 0 && counted >= target;
  const left = reached ? 0 : target - counted;
  const percent = target > 0 ? Math.min(100, Math.floor((counted * 100) / target)) : 0;

  let schedule: GoalSchedule | null = null;
  if (goal.targetDate) {
    const monthsLeft = monthsUntil(today, goal.targetDate);
    const expected = steadyPaceAmount(target, goal.startsOn, goal.targetDate, today);
    const gap = saved - expected;
    const tolerance = Math.floor((target * ON_TRACK_TOLERANCE_PERCENT) / 100);
    const status: GoalSchedule["status"] = reached
      ? "reached"
      : monthsLeft === 0
        ? "overdue"
        : gap > tolerance
          ? "ahead"
          : gap < -tolerance
            ? "behind"
            : "on_track";
    schedule = {
      targetDate: goal.targetDate,
      monthsLeft,
      perMonthMinor: reached || monthsLeft === 0 ? 0 : ceilTo(ceilDiv(left, monthsLeft), 100),
      expectedByNowMinor: expected,
      gapMinor: gap,
      status,
    };
  }

  return {
    savedMinor: saved,
    fromAccountMinor: fromAccount,
    fromContributionsMinor: contributions,
    accountSource: account?.source ?? null,
    balanceUnavailable: account?.balanceUnavailable ?? false,
    percent,
    leftMinor: left,
    reached,
    schedule,
  };
}
