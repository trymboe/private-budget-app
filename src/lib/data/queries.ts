import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth";
import { summarizeMonth, type MonthSummary } from "@/lib/budget";
import { addMonths, minDate, monthEnd, monthStart, todayIn, weekStart, type IsoDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import type { AccountSummary, Category, ConnectionSummary, TransactionListItem } from "./types";

// Data access layer. Every function resolves the signed-in user first and queries
// through the user's own Supabase client, so RLS applies to all reads.

type Row = Record<string, unknown>;

const TX_SELECT = `id, account_id, status, effective_date, amount_minor, currency, original_amount_minor, original_currency,
  counterparty, description, merchant_key, treatment, needs_review, note, removed_at,
  suggested_category_id, suggested_treatment, suggestion_reason,
  transaction_allocations ( category_id, amount_minor ),
  accounts!inner ( name, include_in_budget, is_synced, provider )`;

function toCategory(r: Row): Category {
  return {
    id: r.id as string,
    name: r.name as string,
    kind: r.kind as Category["kind"],
    icon: r.icon as string,
    color: r.color as string,
    isFixed: r.is_fixed as boolean,
    sortOrder: r.sort_order as number,
    archived: r.archived_at !== null,
  };
}

function toTransaction(r: Row): TransactionListItem {
  const account = r.accounts as Row;
  return {
    id: r.id as string,
    accountId: r.account_id as string,
    accountName: account?.name as string,
    status: r.status as TransactionListItem["status"],
    effectiveDate: r.effective_date as string,
    amountMinor: Number(r.amount_minor),
    currency: r.currency as string,
    originalAmountMinor: r.original_amount_minor === null ? null : Number(r.original_amount_minor),
    originalCurrency: (r.original_currency as string | null) ?? null,
    counterparty: (r.counterparty as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    merchantKey: (r.merchant_key as string | null) ?? null,
    treatment: r.treatment as TransactionListItem["treatment"],
    needsReview: r.needs_review as boolean,
    note: (r.note as string | null) ?? null,
    removed: r.removed_at !== null,
    suggestedCategoryId: (r.suggested_category_id as string | null) ?? null,
    suggestedTreatment: (r.suggested_treatment as TransactionListItem["suggestedTreatment"]) ?? null,
    suggestionReason: (r.suggestion_reason as string | null) ?? null,
    allocations: ((r.transaction_allocations as Row[]) ?? []).map((a) => ({
      categoryId: a.category_id as string,
      amountMinor: Number(a.amount_minor),
    })),
    isDemo: account?.provider === "demo",
    accountIncluded: account?.include_in_budget === true,
  };
}

function fail(context: string, error: { message: string } | null): never {
  // Log the context only; Supabase error messages never contain row data, but
  // keep logs free of financial details anyway.
  console.error(`[data] ${context} failed`, error?.message);
  throw new Error(`Could not load ${context}.`);
}

export const getProfile = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, currency, time_zone, onboarding_bank_at, onboarding_budget_at, onboarding_completed_at")
    .eq("id", user.id)
    .single();
  if (error) fail("profile", error);
  return {
    userId: user.id,
    email: user.email,
    displayName: data.display_name as string | null,
    currency: data.currency as string,
    timeZone: data.time_zone as string,
    onboarding: {
      bank: data.onboarding_bank_at !== null,
      budget: data.onboarding_budget_at !== null,
      completed: data.onboarding_completed_at !== null,
    },
  };
});

export const getToday = cache(async (): Promise<IsoDate> => {
  const profile = await getProfile();
  return todayIn(profile.timeZone);
});

export const getCategories = cache(async (): Promise<Category[]> => {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, kind, icon, color, is_fixed, sort_order, archived_at")
    .is("merged_into_id", null)
    .order("sort_order")
    .order("name");
  if (error) fail("categories", error);
  return data.map(toCategory);
});

export async function getMonthBudgets(month: IsoDate): Promise<Map<string, number>> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("monthly_budgets").select("category_id, amount_minor").eq("month", month);
  if (error) fail("budgets", error);
  return new Map(data.map((b) => [b.category_id as string, Number(b.amount_minor)]));
}

/** Make sure `month` has its own budget snapshot (copied from the latest earlier month). */
export async function ensureMonthBudget(month: IsoDate) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("ensure_month_budget", { p_month: month });
  if (error) fail("budget snapshot", error);
}

export type DataNote =
  | { kind: "partial_history"; accountName: string; availableFrom: IsoDate }
  | { kind: "import_incomplete"; accountName: string }
  | { kind: "stale"; institutionName: string; lastSyncedAt: string | null; status: string };

export type MonthView = {
  summary: MonthSummary;
  categories: Category[];
  notes: DataNote[];
  reviewCount: number;
  hasAccounts: boolean;
};

export async function getMonthView(month: IsoDate): Promise<MonthView> {
  await requireUser();
  const today = await getToday();
  const start = monthStart(month);
  // Only materialise budgets for the past, the present and next month.
  if (start <= addMonths(monthStart(today), 1)) await ensureMonthBudget(start);

  const supabase = await createClient();
  const from = minDate(start, weekStart(today));
  const [categories, budgets, txs, review, connections] = await Promise.all([
    getCategories(),
    getMonthBudgets(start),
    supabase
      .from("transactions")
      .select(TX_SELECT)
      .gte("effective_date", from)
      .lte("effective_date", monthEnd(start))
      .is("removed_at", null)
      .limit(5000),
    supabase
      .from("transactions")
      .select("id, accounts!inner(is_synced)", { count: "exact", head: true })
      .eq("needs_review", true)
      .is("removed_at", null)
      .eq("accounts.is_synced", true),
    getConnections(),
  ]);
  if (txs.error) fail("transactions", txs.error);
  const transactions = (txs.data as unknown as Row[]).map(toTransaction);

  const summary = summarizeMonth({
    month: start,
    today,
    categories,
    budgets,
    transactions: transactions.map((t) => ({
      id: t.id,
      amountMinor: t.amountMinor,
      currency: t.currency,
      effectiveDate: t.effectiveDate,
      treatment: t.treatment,
      needsReview: t.needsReview,
      removed: t.removed,
      accountIncluded: t.accountIncluded,
      allocations: t.allocations,
    })),
  });

  return {
    summary,
    categories,
    notes: dataNotes(connections, start),
    reviewCount: review.count ?? 0,
    hasAccounts: connections.some((c) => c.accounts.length > 0),
  };
}

/** Honest caveats for a month: missing history, unfinished imports, stale connections. */
export function dataNotes(connections: ConnectionSummary[], month: IsoDate): DataNote[] {
  const notes: DataNote[] = [];
  const end = monthEnd(month);
  for (const c of connections) {
    for (const a of c.accounts) {
      if (!a.isSynced || !a.includeInBudget) continue;
      if (!a.initialImportCompletedAt) notes.push({ kind: "import_incomplete", accountName: a.name });
      else if (a.historyAvailableFrom && a.historyAvailableFrom > month && a.historyAvailableFrom <= end) {
        notes.push({ kind: "partial_history", accountName: a.name, availableFrom: a.historyAvailableFrom });
      }
    }
    if (c.status !== "active" && c.lastSyncedAt && c.lastSyncedAt.slice(0, 10) < end) {
      notes.push({ kind: "stale", institutionName: c.institutionName, lastSyncedAt: c.lastSyncedAt, status: c.status });
    }
  }
  return notes;
}

/** True when the data for `month` is known to be incomplete for budget accounts. */
export function isMonthPartial(connections: ConnectionSummary[], month: IsoDate): boolean {
  const end = monthEnd(month);
  return connections.some((c) =>
    c.accounts.some(
      (a) =>
        a.isSynced &&
        a.includeInBudget &&
        ((a.historyAvailableFrom !== null && a.historyAvailableFrom > month) ||
          (a.historyRequestedFrom !== null && a.historyRequestedFrom > month && a.historyRequestedFrom <= end) ||
          !a.initialImportCompletedAt),
    ),
  );
}

export const getConnections = cache(async (): Promise<ConnectionSummary[]> => {
  await requireUser();
  const supabase = await createClient();
  const [conns, accounts] = await Promise.all([
    supabase
      .from("bank_connections")
      .select("id, provider, institution_name, status, consent_valid_until, last_synced_at, last_sync_error, rate_limited_until, created_at")
      .order("created_at"),
    supabase
      .from("accounts")
      .select(
        "id, connection_id, name, iban_masked, currency, is_synced, include_in_budget, history_requested_from, history_available_from, history_limited, initial_import_completed_at, last_synced_at, balance_minor, provider, created_at",
      )
      .order("created_at"),
  ]);
  if (conns.error) fail("connections", conns.error);
  if (accounts.error) fail("accounts", accounts.error);
  const toAccount = (a: Row): AccountSummary => ({
    id: a.id as string,
    name: a.name as string,
    ibanMasked: (a.iban_masked as string | null) ?? null,
    currency: a.currency as string,
    isSynced: a.is_synced as boolean,
    includeInBudget: a.include_in_budget as boolean,
    historyRequestedFrom: (a.history_requested_from as string | null) ?? null,
    historyAvailableFrom: (a.history_available_from as string | null) ?? null,
    historyLimited: a.history_limited as boolean,
    initialImportCompletedAt: (a.initial_import_completed_at as string | null) ?? null,
    lastSyncedAt: (a.last_synced_at as string | null) ?? null,
    balanceMinor: a.balance_minor === null ? null : Number(a.balance_minor),
    provider: a.provider as string,
  });
  const result: ConnectionSummary[] = conns.data.map((c) => ({
    id: c.id as string,
    provider: c.provider as ConnectionSummary["provider"],
    institutionName: c.institution_name as string,
    status: c.status as ConnectionSummary["status"],
    consentValidUntil: (c.consent_valid_until as string | null) ?? null,
    lastSyncedAt: (c.last_synced_at as string | null) ?? null,
    lastSyncError: (c.last_sync_error as string | null) ?? null,
    rateLimitedUntil: (c.rate_limited_until as string | null) ?? null,
    accounts: accounts.data.filter((a) => a.connection_id === c.id).map(toAccount),
  }));
  // Accounts whose connection was removed keep their history.
  const orphaned = accounts.data.filter((a) => !a.connection_id).map(toAccount);
  if (orphaned.length > 0) {
    result.push({
      id: "disconnected",
      provider: "enable_banking",
      institutionName: "Disconnected accounts",
      status: "revoked",
      consentValidUntil: null,
      lastSyncedAt: null,
      lastSyncError: null,
      rateLimitedUntil: null,
      accounts: orphaned,
    });
  }
  return result;
});

export async function getReviewQueue(limit = 200): Promise<TransactionListItem[]> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select(TX_SELECT)
    .eq("needs_review", true)
    .is("removed_at", null)
    .eq("accounts.is_synced", true)
    .order("effective_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) fail("review queue", error);
  return data.map(toTransaction);
}

export type TransactionFilters = {
  q?: string;
  accountId?: string;
  categoryId?: string;
  view?: "all" | "review" | "incoming" | "outgoing" | "transfers" | "excluded";
  from?: IsoDate;
  to?: IsoDate;
};

export const PAGE_SIZE = 40;

/**
 * Keyset pagination on (effective_date desc, id desc): stable and fast with years
 * of history, unlike offset paging.
 */
export async function listTransactions(
  filters: TransactionFilters,
  cursor: { date: IsoDate; id: string } | null,
): Promise<{ items: TransactionListItem[]; nextCursor: { date: IsoDate; id: string } | null }> {
  await requireUser();
  const supabase = await createClient();
  const categoryJoin = filters.categoryId ? "transaction_allocations!inner ( category_id, amount_minor )" : "transaction_allocations ( category_id, amount_minor )";
  let query = supabase
    .from("transactions")
    .select(TX_SELECT.replace("transaction_allocations ( category_id, amount_minor )", categoryJoin))
    .order("effective_date", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  query = query.is("removed_at", null);
  if (filters.accountId) query = query.eq("account_id", filters.accountId);
  if (filters.categoryId) query = query.eq("transaction_allocations.category_id", filters.categoryId);
  if (filters.from) query = query.gte("effective_date", filters.from);
  if (filters.to) query = query.lte("effective_date", filters.to);
  switch (filters.view) {
    case "review":
      query = query.eq("needs_review", true);
      break;
    case "incoming":
      query = query.gt("amount_minor", 0);
      break;
    case "outgoing":
      query = query.lt("amount_minor", 0);
      break;
    case "transfers":
      query = query.eq("treatment", "transfer");
      break;
    case "excluded":
      query = query.eq("treatment", "excluded");
      break;
  }
  const q = sanitizeSearch(filters.q);
  if (q) query = query.or(`counterparty.ilike.%${q}%,description.ilike.%${q}%,note.ilike.%${q}%`);
  if (cursor) {
    query = query.or(`effective_date.lt.${cursor.date},and(effective_date.eq.${cursor.date},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) fail("transactions", error);
  const rows = (data as unknown as Row[]).map(toTransaction);
  const hasMore = rows.length > PAGE_SIZE;
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? { date: last.effectiveDate, id: last.id } : null };
}

/** PostgREST filter strings treat , ( ) as syntax; strip them and LIKE wildcards. */
export function sanitizeSearch(q: string | undefined): string {
  if (!q) return "";
  return q
    .replace(/[,()%*\\:"']/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export async function getTransaction(id: string): Promise<TransactionListItem | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.from("transactions").select(TX_SELECT).eq("id", id).maybeSingle();
  if (error) fail("transaction", error);
  return data ? toTransaction(data as unknown as Row) : null;
}
