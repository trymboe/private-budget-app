// "Money in accounts" for Home: the latest balance the bank reported for each
// account in the space, grouped by whether the account counts toward the budget.
// Pure, so it is unit tested.
//
// Honesty rules:
//   * Only balances in the base currency (NOK) are added up. Other currencies are
//     listed in their own currency and counted separately, never converted.
//   * An account without a balance yet is listed as such and left out of totals.
//   * Every figure carries when it was read; a reading older than STALE_HOURS, or
//     from a bank whose access has ended, is flagged rather than shown as current.
import { balanceKind, type BalanceKind } from "@/lib/banking/balance";
import type { ConnectionSummary } from "@/lib/data/types";
import { formatShortDate, type IsoDate } from "@/lib/dates";
import type { Minor } from "@/lib/money";

/** The daily sync should refresh balances well within this. */
export const STALE_HOURS = 48;

export type BalanceLine = {
  id: string;
  name: string;
  institutionName: string;
  currency: string;
  balanceMinor: Minor | null;
  /** When the app read the balance from the bank. */
  balanceAt: string | null;
  kind: BalanceKind;
  /** The date the bank said the balance applies to, when earlier than the reading. */
  asOf: IsoDate | null;
  includeInBudget: boolean;
  isMine: boolean;
  /** Read long ago, or the bank connection is no longer syncing. */
  stale: boolean;
  /** The bank connection has expired, been revoked or removed. */
  connectionEnded: boolean;
};

export type BalanceGroup = {
  lines: BalanceLine[];
  /** Sum of the base-currency balances in this group. */
  total: Minor;
  /** How many balances make up `total`. */
  counted: number;
};

export type BalanceOverview = {
  currency: string;
  /** Accounts that count toward the budget (everyday spending). */
  budget: BalanceGroup;
  /** Accounts left out of the budget, such as savings. */
  other: BalanceGroup;
  total: Minor;
  counted: number;
  /** Accounts in another currency: listed, not added. */
  foreign: number;
  /** Accounts the bank has not reported a balance for yet. */
  missing: number;
  /** The oldest reading among the counted balances: "updated" is only as fresh as this. */
  oldestAt: string | null;
  /** The most recent reading among the counted balances. */
  newestAt: string | null;
  stale: number;
};

export function summarizeBalances(
  connections: ConnectionSummary[],
  now: Date,
  currency = "NOK",
): BalanceOverview | null {
  const lines: BalanceLine[] = [];
  for (const c of connections) {
    const ended = c.status !== "active" || c.id === "disconnected";
    for (const a of c.accounts) {
      // Accounts the user chose not to import are not theirs to look at here;
      // hand-entered accounts have no bank balance.
      if (!a.isSynced) continue;
      if (a.provider === "manual" && a.balanceMinor === null) continue;
      const hasBalance = a.balanceMinor !== null && a.balanceAt !== null;
      const readOn = a.balanceAt?.slice(0, 10) ?? null;
      const ageHours = a.balanceAt ? (now.getTime() - new Date(a.balanceAt).getTime()) / 3_600_000 : null;
      lines.push({
        id: a.id,
        name: a.name,
        institutionName: c.institutionName,
        currency: a.currency,
        balanceMinor: hasBalance ? a.balanceMinor : null,
        balanceAt: hasBalance ? a.balanceAt : null,
        kind: hasBalance ? balanceKind(a.balanceType) : null,
        asOf: hasBalance && a.balanceReferenceDate && readOn && a.balanceReferenceDate < readOn ? a.balanceReferenceDate : null,
        includeInBudget: a.includeInBudget,
        isMine: a.isMine,
        stale: hasBalance && (ended || (ageHours !== null && ageHours > STALE_HOURS)),
        connectionEnded: ended,
      });
    }
  }
  if (lines.length === 0) return null;

  const group = (include: boolean): BalanceGroup => {
    const ls = lines.filter((l) => l.includeInBudget === include);
    const summed = ls.filter((l) => l.balanceMinor !== null && l.currency === currency);
    return { lines: ls, total: summed.reduce((s, l) => s + (l.balanceMinor as Minor), 0), counted: summed.length };
  };
  const budget = group(true);
  const other = group(false);
  const countedLines = lines.filter((l) => l.balanceMinor !== null && l.currency === currency);
  const readings = countedLines.map((l) => l.balanceAt as string).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  const oldestAt = readings[0] ?? null;
  const newestAt = readings.at(-1) ?? null;
  return {
    currency,
    budget,
    other,
    total: budget.total + other.total,
    counted: budget.counted + other.counted,
    foreign: lines.filter((l) => l.balanceMinor !== null && l.currency !== currency).length,
    missing: lines.filter((l) => l.balanceMinor === null).length,
    oldestAt,
    newestAt,
    stale: lines.filter((l) => l.stale).length,
  };
}

/**
 * "just now", "12 min ago", "3 h ago", "2 days ago", then a date. Deliberately
 * coarse: the point is how fresh the bank's figure is, not a stopwatch.
 */
export function formatAge(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return days === 1 ? "1 day ago" : `${days} days ago`;
  const date = iso.slice(0, 10);
  const year = date.slice(0, 4) !== now.toISOString().slice(0, 4) ? ` ${date.slice(0, 4)}` : "";
  return `on ${formatShortDate(date)}${year}`;
}
