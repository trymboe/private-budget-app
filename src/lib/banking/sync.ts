import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, maxDate, minDate, todayIn, type IsoDate } from "@/lib/dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { findTransferPairs } from "@/lib/suggest";
import { decryptSecret } from "./crypto";
import { getProvider } from "./index";
import { withOccurrence } from "./normalize";
import { reconcile, storedLookupWindow, type IncomingTransaction, type StoredTransaction } from "./reconcile";
import { BankApiError, type ProviderId } from "./types";

// Synchronisation engine. Runs server-side only, with the admin client, after the
// caller has established which user it acts for. Every write is scoped to that
// user's account explicitly (the admin client bypasses RLS).
//
// Guarantees:
//   * Idempotent: reconciliation by bank reference / fingerprint (see reconcile.ts).
//   * User data is never overwritten: only bank-owned columns are written.
//   * One sync per connection at a time: a unique partial index on running runs.
//   * Bank limits respected: rate-limit responses pause the connection for 6 hours;
//     scheduled sync runs once a day (PSD2 banks typically allow 4 unattended
//     fetches per day).

const RECONCILE_DAYS = 10; // revisit recent days for late/changed transactions
const STALE_RUN_MINUTES = 15;
const RATE_LIMIT_PAUSE_HOURS = 6;
const MAX_PAGES = 400;
const WRITE_CHUNK = 400;

export type SyncTrigger = "initial" | "scheduled" | "manual";

export type SyncOutcome =
  | { ok: true; fetched: number; inserted: number; updated: number; removed: number; earliest: IsoDate | null; limited: boolean }
  | { ok: false; code: SyncErrorCode; message: string };

export type SyncErrorCode =
  | "NOT_FOUND"
  | "CONNECTION_INACTIVE"
  | "CONSENT_EXPIRED"
  | "RATE_LIMITED"
  | "ALREADY_RUNNING"
  | "BANK_ERROR"
  | "INTERNAL";

const MESSAGES: Record<SyncErrorCode, string> = {
  NOT_FOUND: "That account could not be found.",
  CONNECTION_INACTIVE: "This bank connection is no longer active. Reconnect to continue syncing.",
  CONSENT_EXPIRED: "Your bank access has expired. Reconnect with BankID to continue; your history is kept.",
  RATE_LIMITED: "The bank asked us to slow down. We will try again automatically in a few hours.",
  ALREADY_RUNNING: "A sync for this bank is already running.",
  BANK_ERROR: "The bank did not respond as expected. We will try again later.",
  INTERNAL: "Something went wrong while saving transactions.",
};

function failure(code: SyncErrorCode): SyncOutcome {
  return { ok: false, code, message: MESSAGES[code] };
}

type AccountRow = {
  id: string;
  user_id: string;
  connection_id: string | null;
  provider: ProviderId | "manual";
  provider_account_uid: string | null;
  currency: string;
  is_synced: boolean;
  history_requested_from: string | null;
  initial_import_completed_at: string | null;
  last_synced_at: string | null;
  bank_connections: {
    id: string;
    status: string;
    session_secret: string | null;
    consent_valid_until: string | null;
    rate_limited_until: string | null;
  } | null;
};

export async function syncAccount(input: {
  userId: string;
  accountId: string;
  trigger: SyncTrigger;
  timeZone?: string;
  deadline?: number;
}): Promise<SyncOutcome> {
  const db = createAdminClient();
  const { data: account } = await db
    .from("accounts")
    .select(
      `id, user_id, connection_id, provider, provider_account_uid, currency, is_synced, history_requested_from,
       initial_import_completed_at, last_synced_at,
       bank_connections ( id, status, session_secret, consent_valid_until, rate_limited_until )`,
    )
    .eq("id", input.accountId)
    .eq("user_id", input.userId)
    .maybeSingle<AccountRow>();
  if (!account || account.provider === "manual" || !account.provider_account_uid) return failure("NOT_FOUND");
  const conn = account.bank_connections;
  if (!conn || conn.status !== "active" || !conn.session_secret) return failure("CONNECTION_INACTIVE");

  const now = new Date();
  if (conn.consent_valid_until && new Date(conn.consent_valid_until) <= now) {
    await db
      .from("bank_connections")
      .update({ status: "expired", last_sync_error: "CONSENT_EXPIRED" })
      .eq("id", conn.id)
      .eq("user_id", input.userId);
    return failure("CONSENT_EXPIRED");
  }
  if (conn.rate_limited_until && new Date(conn.rate_limited_until) > now) return failure("RATE_LIMITED");

  // Concurrency lock.
  await db
    .from("sync_runs")
    .update({ status: "failed", error_code: "STALE", finished_at: now.toISOString() })
    .eq("connection_id", conn.id)
    .eq("status", "running")
    .lt("started_at", new Date(now.getTime() - STALE_RUN_MINUTES * 60_000).toISOString());

  const today = todayIn(input.timeZone);
  const initial = input.trigger === "initial" || !account.initial_import_completed_at;
  const historyStart = account.history_requested_from ?? addDays(today, -90);
  const from = initial
    ? historyStart
    : maxDate(historyStart, addDays(minDate(account.last_synced_at?.slice(0, 10) ?? today, today), -RECONCILE_DAYS));
  const window = { from, to: today };

  const { data: run, error: lockError } = await db
    .from("sync_runs")
    .insert({
      user_id: input.userId,
      connection_id: conn.id,
      account_id: account.id,
      trigger: initial ? "initial" : input.trigger,
      date_from: window.from,
      date_to: window.to,
    })
    .select("id")
    .single();
  if (lockError) return failure(lockError.code === "23505" ? "ALREADY_RUNNING" : "INTERNAL");

  const finishRun = (patch: Record<string, unknown>) =>
    db.from("sync_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", run.id);

  try {
    const provider = getProvider(account.provider);
    const sessionId = decryptSecret(conn.session_secret);

    // 1. Fetch every page for the window.
    const raw: unknown[] = [];
    let limited = false;
    let strategy: "default" | "longest" = "default";
    let continuationKey: string | null = null;
    let pages = 0;
    let truncated = false;
    for (;;) {
      try {
        const page = await provider.fetchTransactions({
          sessionId,
          accountUid: account.provider_account_uid,
          dateFrom: window.from,
          dateTo: window.to,
          continuationKey,
          strategy,
        });
        raw.push(...page.transactions);
        continuationKey = page.continuationKey;
      } catch (err) {
        // The bank cannot serve the requested range: take the longest it can.
        if (err instanceof BankApiError && err.code === "WRONG_TRANSACTIONS_PERIOD" && strategy === "default" && pages === 0) {
          strategy = "longest";
          limited = true;
          continue;
        }
        throw err;
      }
      pages += 1;
      if (!continuationKey) break;
      if (pages >= MAX_PAGES || (input.deadline && Date.now() > input.deadline)) {
        truncated = true;
        break;
      }
    }

    // 2. Normalise and keep the requested window (strategy=longest may return more).
    const normalized = raw
      .map((r) => provider.normalize(r, account.currency))
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .filter((t) => t.effectiveDate >= window.from || t.status === "pending");
    const incoming = withOccurrence(normalized);

    // 3. Reconcile against what we already have around the window.
    const lookup = storedLookupWindow(window);
    const { data: storedRows, error: storedError } = await db
      .from("transactions")
      .select("id, provider_ref, fingerprint, status, effective_date, amount_minor, currency, merchant_key, removed_at")
      .eq("account_id", account.id)
      .eq("user_id", input.userId)
      .gte("effective_date", lookup.from)
      .lte("effective_date", lookup.to);
    if (storedError) throw storedError;
    const stored: StoredTransaction[] = storedRows.map((r) => ({
      id: r.id,
      providerRef: r.provider_ref,
      fingerprint: r.fingerprint,
      status: r.status,
      effectiveDate: r.effective_date,
      amountMinor: Number(r.amount_minor),
      currency: r.currency,
      merchantKey: r.merchant_key,
      removedAt: r.removed_at,
    }));
    // A truncated fetch must not soft-remove pending rows it simply did not reach.
    const plan = reconcile(stored, incoming, window);
    if (truncated) plan.removals = [];

    // 4. Write.
    const rules = await loadRules(db, input.userId);
    const inserted = await insertTransactions(db, input.userId, account.id, plan.inserts, rules);
    let updated = 0;
    const seenIds: string[] = [];
    for (const u of plan.updates) {
      const unchanged = !u.promoted && !u.restored && isUnchanged(stored.find((s) => s.id === u.id), u.incoming);
      if (unchanged) {
        seenIds.push(u.id);
        continue;
      }
      const { error } = await db
        .from("transactions")
        .update({ ...bankFields(u.incoming), removed_at: null, last_seen_at: new Date().toISOString() })
        .eq("id", u.id)
        .eq("user_id", input.userId);
      if (error) throw error;
      updated += 1;
    }
    for (let i = 0; i < seenIds.length; i += WRITE_CHUNK) {
      await db.from("transactions").update({ last_seen_at: new Date().toISOString() }).in("id", seenIds.slice(i, i + WRITE_CHUNK)).eq("user_id", input.userId);
    }
    if (plan.removals.length > 0) {
      await db.from("transactions").update({ removed_at: new Date().toISOString() }).in("id", plan.removals).eq("user_id", input.userId);
    }
    if (inserted > 0) await suggestTransfers(db, input.userId, window.from);

    // 5. Bookkeeping.
    const earliest = normalized.reduce<IsoDate | null>((min, t) => (!min || t.effectiveDate < min ? t.effectiveDate : min), null);
    const accountPatch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
    if (initial) {
      // Honest coverage: the earliest date the bank actually returned. If it is
      // well after what was asked for, flag it so months are marked partial.
      const available = earliest && earliest > window.from ? earliest : window.from;
      accountPatch.history_available_from = available;
      accountPatch.history_limited = limited || (earliest !== null && addDays(window.from, 31) < earliest);
      if (!truncated) accountPatch.initial_import_completed_at = new Date().toISOString();
    }
    try {
      const balance = await provider.fetchBalance({ sessionId, accountUid: account.provider_account_uid });
      if (balance && balance.currency === account.currency) {
        accountPatch.balance_minor = balance.amountMinor;
        accountPatch.balance_at = new Date().toISOString();
      }
    } catch {
      // Balance is a nicety; never fail a sync over it.
    }
    await db.from("accounts").update(accountPatch).eq("id", account.id).eq("user_id", input.userId);
    await db
      .from("bank_connections")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: truncated ? "IMPORT_INCOMPLETE" : null })
      .eq("id", conn.id)
      .eq("user_id", input.userId);
    await finishRun({
      status: truncated ? "partial" : "succeeded",
      fetched_count: raw.length,
      inserted_count: inserted,
      updated_count: updated,
      removed_count: plan.removals.length,
    });
    return { ok: true, fetched: raw.length, inserted, updated, removed: plan.removals.length, earliest, limited };
  } catch (err) {
    const code = await handleError(db, input.userId, conn.id, err);
    await finishRun({ status: "failed", error_code: err instanceof BankApiError ? err.code.slice(0, 80) : code });
    return failure(code);
  }
}

/** Sync every selected account of one connection, one after another. */
export async function syncConnection(input: {
  userId: string;
  connectionId: string;
  trigger: SyncTrigger;
  timeZone?: string;
  deadline?: number;
}): Promise<SyncOutcome[]> {
  const db = createAdminClient();
  const { data: accounts } = await db
    .from("accounts")
    .select("id")
    .eq("connection_id", input.connectionId)
    .eq("user_id", input.userId)
    .eq("is_synced", true)
    .not("initial_import_completed_at", "is", null);
  const results: SyncOutcome[] = [];
  for (const a of accounts ?? []) {
    if (input.deadline && Date.now() > input.deadline) break;
    const r = await syncAccount({ ...input, accountId: a.id });
    results.push(r);
    // Consent or rate problems apply to the whole connection: stop early.
    if (!r.ok && (r.code === "CONSENT_EXPIRED" || r.code === "RATE_LIMITED" || r.code === "CONNECTION_INACTIVE")) break;
  }
  return results;
}

async function handleError(db: SupabaseClient, userId: string, connectionId: string, err: unknown): Promise<SyncErrorCode> {
  if (err instanceof BankApiError) {
    console.error("[sync] bank error", err.status, err.code);
    if (err.isConsentProblem) {
      await db.from("bank_connections").update({ status: "expired", last_sync_error: err.code }).eq("id", connectionId).eq("user_id", userId);
      return "CONSENT_EXPIRED";
    }
    if (err.isRateLimited) {
      await db
        .from("bank_connections")
        .update({
          rate_limited_until: new Date(Date.now() + RATE_LIMIT_PAUSE_HOURS * 3_600_000).toISOString(),
          last_sync_error: err.code,
        })
        .eq("id", connectionId)
        .eq("user_id", userId);
      return "RATE_LIMITED";
    }
    await db.from("bank_connections").update({ last_sync_error: err.code.slice(0, 80) }).eq("id", connectionId).eq("user_id", userId);
    return "BANK_ERROR";
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[sync] internal error", message.slice(0, 200));
  await db.from("bank_connections").update({ last_sync_error: "INTERNAL" }).eq("id", connectionId).eq("user_id", userId);
  return "INTERNAL";
}

function bankFields(t: IncomingTransaction) {
  return {
    provider_ref: t.providerRef,
    fingerprint: t.fingerprint,
    status: t.status,
    booking_date: t.bookingDate,
    value_date: t.valueDate,
    transaction_date: t.transactionDate,
    effective_date: t.effectiveDate,
    amount_minor: t.amountMinor,
    currency: t.currency,
    original_amount_minor: t.originalAmountMinor,
    original_currency: t.originalCurrency,
    counterparty: t.counterparty,
    description: t.description,
    merchant_key: t.merchantKey,
    merchant_category_code: t.merchantCategoryCode,
    bank_meta: t.bankMeta,
  };
}

function isUnchanged(s: StoredTransaction | undefined, t: IncomingTransaction): boolean {
  return (
    !!s &&
    s.fingerprint === t.fingerprint &&
    s.status === t.status &&
    s.amountMinor === t.amountMinor &&
    s.effectiveDate === t.effectiveDate &&
    s.providerRef === t.providerRef &&
    s.merchantKey === t.merchantKey
  );
}

async function loadRules(db: SupabaseClient, userId: string) {
  const { data } = await db.from("categorization_rules").select("merchant_key, category_id").eq("user_id", userId);
  return new Map((data ?? []).map((r) => [r.merchant_key as string, r.category_id as string]));
}

async function insertTransactions(
  db: SupabaseClient,
  userId: string,
  accountId: string,
  items: IncomingTransaction[],
  rules: Map<string, string>,
): Promise<number> {
  if (items.length === 0) return 0;
  const rows = items.map((t) => {
    const suggestion = t.merchantKey ? rules.get(t.merchantKey) : undefined;
    return {
      user_id: userId,
      account_id: accountId,
      ...bankFields(t),
      suggested_category_id: suggestion ?? null,
      suggested_treatment: suggestion ? "budget" : null,
      suggestion_reason: suggestion ? "merchant_rule" : null,
    };
  });
  let inserted = 0;
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const chunk = rows.slice(i, i + WRITE_CHUNK);
    const { error, count } = await db
      .from("transactions")
      .upsert(chunk, { onConflict: "account_id,fingerprint", ignoreDuplicates: true, count: "exact" });
    if (!error) {
      inserted += count ?? chunk.length;
      continue;
    }
    if (error.code !== "23505") throw error;
    // A bank reference collided with a row outside the lookup window: insert
    // one by one and skip the duplicates rather than failing the sync.
    for (const row of chunk) {
      const r = await db.from("transactions").insert(row);
      if (!r.error) inserted += 1;
      else if (r.error.code !== "23505") throw r.error;
    }
  }
  return inserted;
}

/** Suggest "transfer" for mirrored amounts across the user's own accounts. */
async function suggestTransfers(db: SupabaseClient, userId: string, from: IsoDate) {
  const { data } = await db
    .from("transactions")
    .select("id, account_id, amount_minor, currency, effective_date")
    .eq("user_id", userId)
    .eq("needs_review", true)
    .is("removed_at", null)
    .gte("effective_date", addDays(from, -3))
    .limit(2000);
  const pairs = findTransferPairs(
    (data ?? []).map((t) => ({
      id: t.id,
      accountId: t.account_id,
      amountMinor: Number(t.amount_minor),
      currency: t.currency,
      effectiveDate: t.effective_date,
    })),
  );
  const ids = pairs.flat();
  if (ids.length === 0) return;
  await db
    .from("transactions")
    .update({ suggested_treatment: "transfer", suggested_category_id: null, suggestion_reason: "transfer_match" })
    .in("id", ids)
    .eq("user_id", userId);
}
