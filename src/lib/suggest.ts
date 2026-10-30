// Rule-based suggestions. No external AI service: a merchant the user has
// categorised before suggests the same category, and mirrored amounts across the
// user's own accounts suggest a transfer. Suggestions are never confirmations.
import { diffDays, type IsoDate } from "@/lib/dates";

export type TransferCandidate = {
  id: string;
  accountId: string;
  amountMinor: number;
  currency: string;
  effectiveDate: IsoDate;
};

const TRANSFER_MAX_DAYS = 3;

/**
 * Pair opposite amounts between different accounts of the same user within a few
 * days. Each transaction pairs at most once; closest dates win.
 */
export function findTransferPairs(items: TransferCandidate[]): [string, string][] {
  const outflows = items.filter((t) => t.amountMinor < 0);
  const inflows = items.filter((t) => t.amountMinor > 0);
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  const options: { out: TransferCandidate; inn: TransferCandidate; days: number }[] = [];
  for (const out of outflows) {
    for (const inn of inflows) {
      if (inn.accountId === out.accountId || inn.currency !== out.currency || inn.amountMinor !== -out.amountMinor) continue;
      const days = Math.abs(diffDays(inn.effectiveDate, out.effectiveDate));
      if (days <= TRANSFER_MAX_DAYS) options.push({ out, inn, days });
    }
  }
  options.sort((a, b) => a.days - b.days);
  for (const o of options) {
    if (used.has(o.out.id) || used.has(o.inn.id)) continue;
    used.add(o.out.id);
    used.add(o.inn.id);
    pairs.push([o.out.id, o.inn.id]);
  }
  return pairs;
}

export type RuleLookup = Map<string, { categoryId: string; confirmations: number }>;

export function suggestCategory(merchantKey: string | null, rules: RuleLookup): string | null {
  if (!merchantKey) return null;
  return rules.get(merchantKey)?.categoryId ?? null;
}
