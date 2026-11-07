// Choosing one balance from what the bank reports. Pure, so it is unit tested.
//
// Banks return several balances per account (ISO 20022 types). For "money in
// accounts" the booked balance is the honest figure: it is what has actually
// settled. Available balances can include an overdraft or credit line, and
// expected balances include pending items, so they are used only when the bank
// reports nothing booked.
import { isIsoDate, type IsoDate } from "@/lib/dates";
import { parseDecimalToMinor, type Minor } from "@/lib/money";

export type BankBalance = {
  amountMinor: Minor;
  currency: string;
  /** ISO 20022 balance type as reported (CLBD, ITBD, ITAV, ...), or null. */
  type: string | null;
  /** The date the bank says the balance applies to, if it said. */
  referenceDate: IsoDate | null;
};

export type RawBalance = {
  balance_amount?: { amount?: string | null; currency?: string | null } | null;
  balance_type?: string | null;
  reference_date?: string | null;
};

// Lower is better. Interim and closing booked share a rank: the more recent
// reference date wins, and interim wins a tie.
const RANK: Record<string, number> = {
  ITBD: 0,
  CLBD: 0,
  OPBD: 1,
  PRCD: 1,
  ITAV: 2,
  CLAV: 2,
  OPAV: 3,
  FWAV: 3,
  XPCD: 4,
};
const WORST = 9;

export type BalanceKind = "booked" | "available" | "expected" | null;

export function balanceKind(type: string | null | undefined): BalanceKind {
  switch (type) {
    case "ITBD":
    case "CLBD":
    case "OPBD":
    case "PRCD":
      return "booked";
    case "ITAV":
    case "CLAV":
    case "OPAV":
    case "FWAV":
      return "available";
    case "XPCD":
      return "expected";
    default:
      return null;
  }
}

/** The balance to show for an account, or null when none is usable. */
export function pickBalance(balances: RawBalance[] | null | undefined): BankBalance | null {
  const usable: (BankBalance & { rank: number })[] = [];
  for (const b of balances ?? []) {
    const amount = b.balance_amount?.amount;
    const currency = b.balance_amount?.currency?.toUpperCase();
    if (!amount || !currency || !/^[A-Z]{3}$/.test(currency)) continue;
    let amountMinor: Minor;
    try {
      amountMinor = parseDecimalToMinor(amount, currency);
    } catch {
      continue; // malformed or more precise than the currency allows: skip, never round
    }
    const type = b.balance_type && /^[A-Z]{4}$/.test(b.balance_type) ? b.balance_type : null;
    const ref = b.reference_date?.slice(0, 10) ?? null;
    usable.push({
      amountMinor,
      currency,
      type,
      referenceDate: ref && isIsoDate(ref) ? ref : null,
      rank: type ? (RANK[type] ?? WORST) : WORST,
    });
  }
  usable.sort(
    (a, b) =>
      a.rank - b.rank ||
      // More recent reference date first; unknown dates last.
      (b.referenceDate ?? "").localeCompare(a.referenceDate ?? "") ||
      (a.type === "ITBD" ? -1 : b.type === "ITBD" ? 1 : 0),
  );
  const best = usable[0];
  if (!best) return null;
  return { amountMinor: best.amountMinor, currency: best.currency, type: best.type, referenceDate: best.referenceDate };
}
