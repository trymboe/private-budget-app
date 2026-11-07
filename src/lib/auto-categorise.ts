// Automatic categorisation for trusted merchants. A merchant rule becomes trusted
// once the same category was chosen for it AUTO_THRESHOLD times in a row; from then
// on sync files new transactions from that merchant by itself (see
// apply_auto_categorization in supabase/migrations/20261107000100_auto_categorise.sql).
// Pure helpers only, so the rules are unit tested.

/** Same-category confirmations that make a merchant automatic. Keep equal to auto_categorize_threshold(). */
export const AUTO_THRESHOLD = 3;

export type RuleState = {
  id: string;
  merchantKey: string;
  categoryId: string;
  confirmations: number;
  autoEnabled: boolean;
};

/** True when this rule files new transactions by itself. */
export function isAutomatic(rule: Pick<RuleState, "confirmations" | "autoEnabled"> | null | undefined, spaceEnabled: boolean): boolean {
  return !!rule && spaceEnabled && rule.autoEnabled && rule.confirmations >= AUTO_THRESHOLD;
}

/** How many more same-category confirmations until the merchant is automatic (0 when trusted). */
export function confirmationsToGo(confirmations: number): number {
  return Math.max(0, AUTO_THRESHOLD - confirmations);
}

/**
 * What a categorisation did to a merchant's automatic filing, so the user can be told:
 *   now_auto:       the merchant just became trusted (offer to turn it off).
 *   no_longer_auto: a trusted merchant was filed differently, which reset the rule
 *                   (offer to keep the old rule, treating this one as an exception).
 */
export type RuleChange =
  | { kind: "now_auto"; ruleId: string; merchantKey: string; categoryId: string }
  | {
      kind: "no_longer_auto";
      ruleId: string;
      merchantKey: string;
      categoryId: string;
      previous: { categoryId: string; confirmations: number };
    };

export function describeRuleChange(before: RuleState | null, after: RuleState | null, spaceEnabled: boolean): RuleChange | null {
  if (!after) return null;
  const was = isAutomatic(before, spaceEnabled);
  const is = isAutomatic(after, spaceEnabled);
  if (!was && is) return { kind: "now_auto", ruleId: after.id, merchantKey: after.merchantKey, categoryId: after.categoryId };
  if (was && !is && before && before.categoryId !== after.categoryId) {
    return {
      kind: "no_longer_auto",
      ruleId: after.id,
      merchantKey: after.merchantKey,
      categoryId: after.categoryId,
      previous: { categoryId: before.categoryId, confirmations: before.confirmations },
    };
  }
  return null;
}

/** The first change across several merchants (a bulk categorisation is usually one merchant). */
export function firstRuleChange(
  before: Map<string, RuleState>,
  after: Map<string, RuleState>,
  merchantKeys: string[],
  spaceEnabled: boolean,
): RuleChange | null {
  for (const key of new Set(merchantKeys)) {
    const change = describeRuleChange(before.get(key) ?? null, after.get(key) ?? null, spaceEnabled);
    if (change) return change;
  }
  return null;
}

/** Counts auto-filed transactions per merchant key. */
export function countByMerchant(rows: { merchantKey: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!r.merchantKey) continue;
    counts.set(r.merchantKey, (counts.get(r.merchantKey) ?? 0) + 1);
  }
  return counts;
}

/** Recently auto-filed transactions nobody has looked at, for the "filed automatically" notice. */
export type AutoFiledSummary = { count: number; days: number; merchants: string[] };

export type AutoMerchant = {
  ruleId: string;
  merchantKey: string;
  name: string;
  categoryId: string;
  /** Times the same category was chosen in a row. */
  confirmations: number;
  autoEnabled: boolean;
  /** Transactions filed automatically that nobody has changed since. */
  autoFiledCount: number;
};

export type AutoSettings = {
  spaceId: string;
  spaceKind: "personal" | "shared";
  enabled: boolean;
  merchants: AutoMerchant[];
};
