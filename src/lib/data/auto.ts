import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth";
import { AUTO_THRESHOLD, countByMerchant, type AutoFiledSummary, type AutoSettings, type RuleState } from "@/lib/auto-categorise";
import { displayMerchant } from "@/lib/merchant";
import { getActiveSpace } from "@/lib/spaces";
import { createClient } from "@/lib/supabase/server";

// Reads for automatic categorisation (trusted merchants). Same rules as
// queries.ts: the user's own client, so RLS applies, narrowed to the space viewed.

type Row = Record<string, unknown>;

function fail(context: string, error: { message: string } | null): never {
  console.error(`[data] ${context} failed`, error?.message);
  throw new Error(`Could not load ${context}.`);
}

/** A rule's merchant key as a name ("rema 1000" → "Rema 1000"). */
export function merchantName(merchantKey: string): string {
  return displayMerchant(merchantKey, null);
}

async function spaceEnabled(supabase: SupabaseClient, spaceId: string): Promise<boolean> {
  const { data, error } = await supabase.from("spaces").select("auto_categorize").eq("id", spaceId).maybeSingle();
  if (error) fail("auto-categorise setting", error);
  return data?.auto_categorize !== false;
}

/** Everything the "Auto-categorised merchants" page shows, for the space being viewed. */
export async function getAutoSettings(): Promise<AutoSettings> {
  await requireUser();
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  const [enabled, rules, filed] = await Promise.all([
    spaceEnabled(supabase, space.id),
    supabase
      .from("categorization_rules")
      .select("id, merchant_key, category_id, confirmations, auto_enabled")
      .eq("space_id", space.id)
      .gte("confirmations", AUTO_THRESHOLD)
      .order("merchant_key"),
    supabase
      .from("transactions")
      .select("merchant_key")
      .eq("space_id", space.id)
      .not("auto_categorized_at", "is", null)
      .is("removed_at", null)
      .limit(10000),
  ]);
  if (rules.error) fail("merchant rules", rules.error);
  if (filed.error) fail("auto-filed transactions", filed.error);
  const counts = countByMerchant((filed.data as Row[]).map((r) => ({ merchantKey: (r.merchant_key as string | null) ?? null })));
  return {
    spaceId: space.id,
    spaceKind: space.kind,
    enabled,
    merchants: (rules.data as Row[]).map((r) => ({
      ruleId: r.id as string,
      merchantKey: r.merchant_key as string,
      name: merchantName(r.merchant_key as string),
      categoryId: r.category_id as string,
      confirmations: Number(r.confirmations),
      autoEnabled: r.auto_enabled as boolean,
      autoFiledCount: counts.get(r.merchant_key as string) ?? 0,
    })),
  };
}

/** One line for the Settings list: off, or how many merchants are automatic. */
export async function getAutoSummary(): Promise<{ enabled: boolean; merchants: number }> {
  await requireUser();
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  const [enabled, rules] = await Promise.all([
    spaceEnabled(supabase, space.id),
    supabase
      .from("categorization_rules")
      .select("id", { count: "exact", head: true })
      .eq("space_id", space.id)
      .eq("auto_enabled", true)
      .gte("confirmations", AUTO_THRESHOLD),
  ]);
  if (rules.error) fail("merchant rules", rules.error);
  return { enabled, merchants: rules.count ?? 0 };
}

/**
 * Transactions filed automatically in the last `days` days that nobody has
 * looked at since, for the "filed automatically" notice. Null when there are none.
 */
export async function getRecentAutoFiled(days = 7): Promise<AutoFiledSummary | null> {
  await requireUser();
  const [supabase, space] = await Promise.all([createClient(), getActiveSpace()]);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("transactions")
    .select("merchant_key, counterparty, description")
    .eq("space_id", space.id)
    .gte("auto_categorized_at", since)
    .is("removed_at", null)
    .order("auto_categorized_at", { ascending: false })
    .limit(500);
  if (error) fail("auto-filed transactions", error);
  if (data.length === 0) return null;
  const names: string[] = [];
  for (const r of data) {
    const name = displayMerchant((r.counterparty as string | null) ?? null, (r.description as string | null) ?? null);
    if (!names.includes(name)) names.push(name);
  }
  return { count: data.length, days, merchants: names };
}

/** Rules for some merchants in one space, keyed by merchant. */
export async function ruleStates(supabase: SupabaseClient, spaceId: string, merchantKeys: string[]): Promise<Map<string, RuleState>> {
  if (merchantKeys.length === 0) return new Map();
  const { data, error } = await supabase
    .from("categorization_rules")
    .select("id, merchant_key, category_id, confirmations, auto_enabled")
    .eq("space_id", spaceId)
    .in("merchant_key", merchantKeys);
  if (error) throw error;
  return new Map(
    (data as Row[]).map((r) => [
      r.merchant_key as string,
      {
        id: r.id as string,
        merchantKey: r.merchant_key as string,
        categoryId: r.category_id as string,
        confirmations: Number(r.confirmations),
        autoEnabled: r.auto_enabled as boolean,
      },
    ]),
  );
}

/** The space of a category, whether it files automatically, and the merchants of some transactions. */
export async function categorisationContext(
  supabase: SupabaseClient,
  transactionIds: string[],
  categoryId: string,
): Promise<{ spaceId: string; enabled: boolean; merchantKeys: string[] } | null> {
  const [category, txs] = await Promise.all([
    supabase.from("categories").select("space_id, spaces ( auto_categorize )").eq("id", categoryId).maybeSingle(),
    supabase.from("transactions").select("merchant_key").in("id", transactionIds),
  ]);
  if (category.error) throw category.error;
  if (txs.error) throw txs.error;
  if (!category.data) return null;
  const spaces = category.data.spaces as unknown as { auto_categorize: boolean } | null;
  return {
    spaceId: category.data.space_id as string,
    enabled: spaces?.auto_categorize !== false,
    merchantKeys: [...new Set((txs.data as Row[]).map((r) => r.merchant_key as string | null).filter((k): k is string => !!k))],
  };
}
