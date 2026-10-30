// Pure reconciliation of a freshly fetched window of bank transactions against
// what is already stored for one account. Produces inserts, updates of bank-owned
// fields, and soft removals. User-owned fields (categories, notes, treatment) are
// never part of the output, so repeated syncs cannot overwrite them.
//
// Matching order, one-to-one (an existing row is matched at most once per run):
//   1. Bank reference (entry_reference) for booked items.
//   2. Fingerprint (descriptive hash + occurrence index).
//   3. Pending -> booked promotion: a stored pending row with the same amount
//      a few days around the booked date (or same merchant with a small amount
//      change, e.g. tips or fuel holds). Keeps the row id, so categories survive.
//   4. Unstable descriptions: a stored booked row without bank reference, same
//      amount, same date and compatible merchant.
// Anything unmatched is inserted. Stored pending rows in the window that the bank
// no longer returns are soft-removed (they were cancelled or replaced).
import { addDays, diffDays, type IsoDate } from "@/lib/dates";
import type { NormalizedTransaction } from "./types";

export type StoredTransaction = {
  id: string;
  providerRef: string | null;
  fingerprint: string;
  status: "booked" | "pending";
  effectiveDate: IsoDate;
  amountMinor: number;
  currency: string;
  merchantKey: string | null;
  removedAt: string | null;
};

export type IncomingTransaction = NormalizedTransaction & { fingerprint: string };

export type ReconcilePlan = {
  inserts: IncomingTransaction[];
  updates: { id: string; incoming: IncomingTransaction; restored: boolean; promoted: boolean }[];
  removals: string[];
  unchanged: number;
};

const PROMOTION_DAYS_BEFORE = 3; // booked date can be a little before the pending date
const PROMOTION_DAYS_AFTER = 10; // ...and typically some days after
const PROMOTION_AMOUNT_TOLERANCE_PERCENT = 25; // tips, fuel and hotel holds

export function reconcile(
  stored: StoredTransaction[],
  incoming: IncomingTransaction[],
  window: { from: IsoDate; to: IsoDate },
): ReconcilePlan {
  const plan: ReconcilePlan = { inserts: [], updates: [], removals: [], unchanged: 0 };
  const matched = new Set<string>();
  const byRef = new Map<string, StoredTransaction>();
  const byFingerprint = new Map<string, StoredTransaction>();
  for (const s of stored) {
    if (s.providerRef) byRef.set(s.providerRef, s);
    byFingerprint.set(s.fingerprint, s);
  }

  const take = (s: StoredTransaction | undefined) => (s && !matched.has(s.id) ? s : undefined);

  // Booked items first so references and promotions claim rows before pending
  // items compete for them.
  const ordered = [...incoming].sort((a, b) => (a.status === b.status ? 0 : a.status === "booked" ? -1 : 1));

  for (const tx of ordered) {
    let match = tx.providerRef ? take(byRef.get(tx.providerRef)) : undefined;
    match ??= take(byFingerprint.get(tx.fingerprint));
    let promoted = false;

    if (!match && tx.status === "booked") {
      match = findPendingToPromote(stored, matched, tx);
      promoted = !!match;
    }
    if (!match && tx.status === "booked" && !tx.providerRef) {
      match = stored.find(
        (s) =>
          !matched.has(s.id) &&
          s.status === "booked" &&
          !s.providerRef &&
          s.amountMinor === tx.amountMinor &&
          s.currency === tx.currency &&
          s.effectiveDate === tx.effectiveDate &&
          (!s.merchantKey || !tx.merchantKey || s.merchantKey === tx.merchantKey),
      );
    }
    if (!match && tx.status === "pending") {
      // A pending item never replaces a booked one; but it may be the same
      // pending item whose description changed slightly.
      match = stored.find(
        (s) =>
          !matched.has(s.id) &&
          s.status === "pending" &&
          s.amountMinor === tx.amountMinor &&
          s.currency === tx.currency &&
          s.effectiveDate === tx.effectiveDate &&
          s.merchantKey === tx.merchantKey,
      );
    }

    if (!match) {
      plan.inserts.push(tx);
      continue;
    }
    matched.add(match.id);
    if (!promoted && !match.removedAt && isSameBankData(match, tx)) {
      plan.unchanged += 1;
    }
    plan.updates.push({ id: match.id, incoming: tx, restored: !!match.removedAt, promoted });
  }

  for (const s of stored) {
    if (
      !matched.has(s.id) &&
      s.status === "pending" &&
      !s.removedAt &&
      s.effectiveDate >= window.from &&
      s.effectiveDate <= window.to
    ) {
      plan.removals.push(s.id);
    }
  }
  return plan;
}

function findPendingToPromote(
  stored: StoredTransaction[],
  matched: Set<string>,
  tx: IncomingTransaction,
): StoredTransaction | undefined {
  const candidates = stored.filter((s) => {
    if (matched.has(s.id) || s.status !== "pending" || s.currency !== tx.currency) return false;
    if (Math.sign(s.amountMinor) !== Math.sign(tx.amountMinor)) return false;
    const days = diffDays(tx.effectiveDate, s.effectiveDate);
    return days >= -PROMOTION_DAYS_BEFORE && days <= PROMOTION_DAYS_AFTER;
  });
  const exact = candidates
    .filter((s) => s.amountMinor === tx.amountMinor)
    .sort((a, b) => score(b, tx) - score(a, tx));
  if (exact.length > 0 && (exact[0].merchantKey === tx.merchantKey || !exact[0].merchantKey || !tx.merchantKey || exact.length === 1)) {
    return exact[0];
  }
  // Amount changed between authorisation and booking: only with the same merchant.
  return candidates.find((s) => {
    if (!s.merchantKey || s.merchantKey !== tx.merchantKey) return false;
    const diff = Math.abs(s.amountMinor - tx.amountMinor);
    return diff * 100 <= Math.abs(s.amountMinor) * PROMOTION_AMOUNT_TOLERANCE_PERCENT;
  });
}

function score(s: StoredTransaction, tx: IncomingTransaction): number {
  return (s.merchantKey && s.merchantKey === tx.merchantKey ? 100 : 0) - Math.abs(diffDays(tx.effectiveDate, s.effectiveDate));
}

function isSameBankData(s: StoredTransaction, tx: IncomingTransaction): boolean {
  return (
    s.fingerprint === tx.fingerprint &&
    s.status === tx.status &&
    s.amountMinor === tx.amountMinor &&
    s.effectiveDate === tx.effectiveDate &&
    s.providerRef === tx.providerRef
  );
}

/** Window of stored rows to load for a fetch window (pending rows may predate it). */
export function storedLookupWindow(window: { from: IsoDate; to: IsoDate }) {
  return { from: addDays(window.from, -PROMOTION_DAYS_AFTER), to: addDays(window.to, PROMOTION_DAYS_BEFORE) };
}
