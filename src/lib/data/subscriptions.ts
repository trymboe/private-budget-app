import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { addDays, type IsoDate } from "@/lib/dates";
import { getActiveSpace } from "@/lib/spaces";
import {
  CADENCES,
  HISTORY_DAYS,
  buildSubscriptionList,
  chargesFromTransactions,
  detectRecurring,
  sortByNextDate,
  summarizeSubscriptions,
  type Cadence,
  type SubscriptionDecision,
  type SubscriptionItem,
  type SubscriptionTotals,
  type TransactionLike,
} from "@/lib/subscriptions";
import { createClient } from "@/lib/supabase/server";
import { getCategories, getToday } from "./queries";
import type { Category } from "./types";

// Subscriptions for the space being viewed: detected from the last ~14 months of
// outgoing payments, merged with the decisions stored in public.subscriptions.
// Reads go through the user's own client, so RLS applies.

type Row = Record<string, unknown>;

const PAGE = 1000; // PostgREST's default max rows per request
const MAX_PAGES = 20;

export type SubscriptionsView = {
  items: SubscriptionItem[];
  totals: SubscriptionTotals;
  categories: Category[];
  today: IsoDate;
  historyFrom: IsoDate;
};

async function loadPayments(spaceId: string, from: IsoDate): Promise<TransactionLike[]> {
  const supabase = await createClient();
  const out: TransactionLike[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, effective_date, amount_minor, currency, merchant_key, counterparty, description, treatment, transaction_allocations ( category_id )")
      .eq("space_id", spaceId)
      .gte("effective_date", from)
      .lt("amount_minor", 0)
      .neq("treatment", "transfer")
      .is("removed_at", null)
      .order("effective_date")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) {
      console.error("[data] subscription history failed", error.message);
      throw new Error("Could not load subscriptions.");
    }
    for (const r of data as Row[]) {
      const allocations = (r.transaction_allocations as Row[] | null) ?? [];
      out.push({
        id: r.id as string,
        effectiveDate: r.effective_date as string,
        amountMinor: Number(r.amount_minor),
        currency: r.currency as string,
        merchantKey: (r.merchant_key as string | null) ?? null,
        counterparty: (r.counterparty as string | null) ?? null,
        description: (r.description as string | null) ?? null,
        treatment: r.treatment as TransactionLike["treatment"],
        removed: false,
        categoryId: allocations.length === 1 ? (allocations[0].category_id as string) : null,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function loadDecisions(spaceId: string): Promise<SubscriptionDecision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select("id, merchant_key, cadence, status, source, name, amount_minor, category_id, cancelled_on, transaction_id")
    .eq("space_id", spaceId)
    .order("created_at")
    .order("id");
  if (error) {
    console.error("[data] subscription decisions failed", error.message);
    throw new Error("Could not load subscriptions.");
  }
  return (data as Row[])
    .filter((r) => CADENCES.includes(r.cadence as Cadence))
    .map((r) => ({
      id: r.id as string,
      merchantKey: r.merchant_key as string,
      cadence: r.cadence as Cadence,
      status: r.status as SubscriptionDecision["status"],
      source: r.source as SubscriptionDecision["source"],
      name: r.name as string,
      amountMinor: Number(r.amount_minor),
      categoryId: (r.category_id as string | null) ?? null,
      cancelledOn: (r.cancelled_on as string | null) ?? null,
      transactionId: (r.transaction_id as string | null) ?? null,
    }));
}

export const getSubscriptionsView = cache(async (): Promise<SubscriptionsView> => {
  await requireUser();
  const [space, today] = await Promise.all([getActiveSpace(), getToday()]);
  const historyFrom = addDays(today, -HISTORY_DAYS);
  const [payments, decisions, categories] = await Promise.all([
    loadPayments(space.id, historyFrom),
    loadDecisions(space.id),
    getCategories(),
  ]);
  const charges = chargesFromTransactions(payments);
  const items = sortByNextDate(buildSubscriptionList(detectRecurring(charges, today), decisions, charges, today));
  return { items, totals: summarizeSubscriptions(items), categories, today, historyFrom };
});
