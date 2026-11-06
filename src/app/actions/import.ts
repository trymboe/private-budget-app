"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CATEGORY_COLORS } from "@/components/category-icon";
import { requireUser } from "@/lib/auth";
import type { IsoDate } from "@/lib/dates";
import { getProfile, IMPORTED_HISTORY_IDENTITY } from "@/lib/data/queries";
import { BUDDY_SOURCE, ImportFormatError, parseBuddyExport } from "@/lib/import/buddy";
import { buildPlan, type CategoryDecision, type ExistingCategory, type ImportPlan, type SkipReason } from "@/lib/import/plan";
import { normalizeMerchant } from "@/lib/merchant";
import type { Minor } from "@/lib/money";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getSpaces, type Space } from "@/lib/spaces";

// History imported from Buddy lives in its own account ("Buddy history") in the
// space the user imports into, so it is easy to see, and "Remove" on that account
// undoes the whole import. Users cannot
// insert transactions under RLS, so the rows are written with the server-only
// client, always scoped to the signed-in user and to that account.

const IMPORT_ACCOUNT_NAME = "Buddy history";
const MAX_FILE_CHARS = 4_000_000;
const BATCH = 500;

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("existing"), categoryId: z.uuid() }),
  z.object({ action: z.literal("create"), kind: z.enum(["expense", "income"]) }),
]);

const optionsSchema = z.object({
  /** The space to import into; must be one the user belongs to. */
  spaceId: z.uuid(),
  /** "bank": stop where bank data starts. "all": import every row. */
  range: z.enum(["bank", "all"]),
  decisions: z.record(z.string().max(200), decisionSchema),
});

export type ImportOptions = z.input<typeof optionsSchema>;

export type ImportPreview = {
  ok: true;
  rowsInFile: number;
  toImport: number;
  firstDate: IsoDate | null;
  lastDate: IsoDate | null;
  totalOutMinor: Minor;
  totalInMinor: Minor;
  uncategorized: number;
  skipped: { reason: SkipReason; count: number }[];
  /** First day of bank data; rows from this day on are skipped when range = "bank". */
  bankStartsOn: IsoDate | null;
  previouslyImported: number;
  categories: {
    key: string;
    name: string;
    rowCount: number;
    spentMinor: Minor;
    receivedMinor: Minor;
    suggestion: CategoryDecision;
    decision: CategoryDecision;
  }[];
  sample: { date: IsoDate; amountMinor: Minor; description: string | null; category: string | null }[];
};

type Failure = { ok: false; error: string };

function fail(error: string): Failure {
  return { ok: false, error };
}

async function loadCategories(spaceId: string): Promise<ExistingCategory[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, kind, archived_at, merged_into_id")
    .eq("space_id", spaceId);
  if (error) throw error;
  return data.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    kind: c.kind as "expense" | "income",
    archived: c.archived_at !== null,
    mergedIntoId: (c.merged_into_id as string | null) ?? null,
  }));
}

/** First day with transactions from a real bank account in the space (not manual or imported). */
async function bankStartsOn(spaceId: string): Promise<IsoDate | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("effective_date, accounts!inner ( provider )")
    .eq("space_id", spaceId)
    .neq("accounts.provider", "manual")
    .is("removed_at", null)
    .order("effective_date", { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data[0]?.effective_date as string | undefined) ?? null;
}

/** Like manual accounts: the personal space keeps the plain identity. */
function importIdentity(space: Space): string {
  return space.kind === "personal" ? IMPORTED_HISTORY_IDENTITY : `${IMPORTED_HISTORY_IDENTITY}:${space.id}`;
}

async function findImportAccount(userId: string, space: Space): Promise<{ id: string; currency: string } | null> {
  const { data, error } = await createAdminClient()
    .from("accounts")
    .select("id, currency")
    .eq("user_id", userId)
    .eq("space_id", space.id)
    .eq("provider", "manual")
    .eq("provider_identity", importIdentity(space))
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function existingFingerprints(userId: string, accountId: string | undefined): Promise<Set<string>> {
  const found = new Set<string>();
  if (!accountId) return found;
  const admin = createAdminClient();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin
      .from("transactions")
      .select("fingerprint")
      .eq("user_id", userId)
      .eq("account_id", accountId)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data) found.add(r.fingerprint as string);
    if (data.length < 1000) return found;
  }
}

type Context = {
  space: Space;
  plan: ImportPlan;
  rowsInFile: number;
  bankStart: IsoDate | null;
  account: { id: string; currency: string } | null;
  previouslyImported: number;
  existing: ExistingCategory[];
};

async function prepare(userId: string, fileText: string, options: z.output<typeof optionsSchema>, currency: string): Promise<Context | Failure> {
  if (fileText.length > MAX_FILE_CHARS) return fail("The file is too large. Export a shorter period and import it in parts.");
  let rows;
  try {
    rows = parseBuddyExport(fileText);
  } catch (e) {
    if (e instanceof ImportFormatError) return fail(e.message);
    throw e;
  }
  if (rows.length === 0) return fail("The file has no transactions.");
  const space = (await getSpaces()).find((s) => s.id === options.spaceId);
  if (!space) return fail("You do not have access to that space.");
  const [existing, bankStart, account] = await Promise.all([
    loadCategories(space.id),
    bankStartsOn(space.id),
    findImportAccount(userId, space),
  ]);
  const fingerprints = await existingFingerprints(userId, account?.id);
  const plan = buildPlan(BUDDY_SOURCE, rows, existing, {
    currency: account?.currency ?? currency,
    cutoff: options.range === "bank" ? bankStart : null,
    decisions: options.decisions,
    existingFingerprints: fingerprints,
  });
  return { space, plan, rowsInFile: rows.length, bankStart, account, previouslyImported: fingerprints.size, existing };
}

export async function previewBuddyImport(fileText: string, input: ImportOptions): Promise<ImportPreview | Failure> {
  const user = await requireUser();
  const options = optionsSchema.safeParse(input);
  if (typeof fileText !== "string" || !options.success) return fail("Invalid request.");
  const profile = await getProfile();
  try {
    const ctx = await prepare(user.id, fileText, options.data, profile.currency);
    if ("error" in ctx) return ctx;
    const { plan } = ctx;
    return {
      ok: true,
      rowsInFile: ctx.rowsInFile,
      toImport: plan.transactions.length,
      firstDate: plan.firstDate,
      lastDate: plan.lastDate,
      totalOutMinor: plan.totalOutMinor,
      totalInMinor: plan.totalInMinor,
      uncategorized: plan.uncategorized,
      skipped: plan.skipped,
      bankStartsOn: ctx.bankStart,
      previouslyImported: ctx.previouslyImported,
      categories: plan.categories,
      sample: plan.transactions.slice(0, 5).map((t) => ({
        date: t.date,
        amountMinor: t.amountMinor,
        description: t.description,
        category: t.category,
      })),
    };
  } catch (e) {
    console.error("[import] preview", e);
    return fail("The file could not be checked. Please try again.");
  }
}

export type ImportResult = { ok: true; imported: number; categoriesCreated: number } | Failure;

export async function runBuddyImport(fileText: string, input: ImportOptions): Promise<ImportResult> {
  const user = await requireUser();
  const options = optionsSchema.safeParse(input);
  if (typeof fileText !== "string" || !options.success) return fail("Invalid request.");
  const profile = await getProfile();
  const admin = createAdminClient();
  const supabase = await createClient();

  let ctx: Context | Failure;
  try {
    ctx = await prepare(user.id, fileText, options.data, profile.currency);
  } catch (e) {
    console.error("[import] prepare", e);
    return fail("The file could not be checked. Please try again.");
  }
  if ("error" in ctx) return ctx;
  const { plan, space } = ctx;
  if (plan.transactions.length === 0) return fail("There is nothing new to import from this file.");

  const createdCategoryIds: string[] = [];
  const insertedIds: string[] = [];
  let createdAccountId: string | null = null;

  // Undo everything this run wrote, so a failure never leaves half an import.
  async function rollback() {
    for (let i = 0; i < insertedIds.length; i += BATCH) {
      await admin.from("transactions").delete().eq("user_id", user.id).in("id", insertedIds.slice(i, i + BATCH));
    }
    if (createdCategoryIds.length > 0) {
      await admin.from("categories").delete().eq("space_id", space.id).in("id", createdCategoryIds);
    }
    if (createdAccountId) await admin.from("accounts").delete().eq("user_id", user.id).eq("id", createdAccountId);
  }

  try {
    // 1. Categories: reuse or create, exactly as the preview showed.
    const categoryIds = new Map<string, string>();
    const { data: last } = await supabase
      .from("categories")
      .select("sort_order")
      .eq("space_id", space.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    let sortOrder = ((last?.sort_order as number | undefined) ?? 0) + 10;
    let colorIndex = 0;
    for (const c of plan.categories) {
      if (c.decision.action === "existing") {
        categoryIds.set(c.key, c.decision.categoryId);
        continue;
      }
      const { data, error } = await supabase
        .from("categories")
        .insert({
          space_id: space.id,
          name: c.name,
          kind: c.decision.kind,
          icon: "circle",
          color: CATEGORY_COLORS[colorIndex++ % CATEGORY_COLORS.length],
          is_fixed: false,
          sort_order: sortOrder,
        })
        .select("id")
        .single();
      if (error) throw error;
      sortOrder += 10;
      createdCategoryIds.push(data.id as string);
      categoryIds.set(c.key, data.id as string);
    }

    // 2. The import account.
    let accountId = ctx.account?.id;
    if (!accountId) {
      const { data, error } = await admin
        .from("accounts")
        .insert({
          user_id: user.id,
          space_id: space.id,
          provider: "manual",
          provider_identity: importIdentity(space),
          name: IMPORT_ACCOUNT_NAME,
          currency: profile.currency,
          is_synced: true,
          include_in_budget: true,
          initial_import_completed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      accountId = data.id as string;
      createdAccountId = accountId;
    }

    // 3. Transactions, then their categories. Inserted as "needs review" first so
    //    nothing ever looks categorised before its allocation exists.
    const reviewedAt = new Date().toISOString();
    for (let i = 0; i < plan.transactions.length; i += BATCH) {
      const batch = plan.transactions.slice(i, i + BATCH);
      const { data, error } = await admin
        .from("transactions")
        .insert(
          batch.map((t) => ({
            user_id: user.id,
            space_id: space.id,
            account_id: accountId,
            fingerprint: t.fingerprint,
            status: "booked",
            booking_date: t.date,
            transaction_date: t.date,
            effective_date: t.date,
            amount_minor: t.amountMinor,
            currency: t.currency,
            counterparty: t.description,
            merchant_key: normalizeMerchant(t.description),
            note: t.note,
            bank_meta: { source: BUDDY_SOURCE, line: t.line, category: t.category },
            treatment: "budget",
            needs_review: true,
          })),
        )
        .select("id, fingerprint");
      if (error) throw error;
      const idByFingerprint = new Map(data.map((r) => [r.fingerprint as string, r.id as string]));
      insertedIds.push(...idByFingerprint.values());

      const categorised = batch.filter((t) => t.categoryKey && categoryIds.has(t.categoryKey));
      if (categorised.length === 0) continue;
      const allocations = categorised.map((t) => ({
        space_id: space.id,
        transaction_id: idByFingerprint.get(t.fingerprint)!,
        category_id: categoryIds.get(t.categoryKey!)!,
        amount_minor: t.amountMinor,
      }));
      const { error: allocError } = await admin.from("transaction_allocations").insert(allocations);
      if (allocError) throw allocError;
      const { error: doneError } = await admin
        .from("transactions")
        .update({ needs_review: false, reviewed_at: reviewedAt })
        .eq("user_id", user.id)
        .in(
          "id",
          allocations.map((a) => a.transaction_id),
        );
      if (doneError) throw doneError;
    }

    // 4. History bookkeeping, so months before the import are not flagged as partial.
    const { data: range } = await admin
      .from("transactions")
      .select("effective_date")
      .eq("account_id", accountId)
      .order("effective_date", { ascending: true })
      .limit(1);
    await admin
      .from("accounts")
      .update({ history_available_from: range?.[0]?.effective_date ?? plan.firstDate })
      .eq("id", accountId)
      .eq("user_id", user.id);
  } catch (e) {
    console.error("[import] run", e);
    await rollback().catch((r) => console.error("[import] rollback", r));
    return fail("The import did not go through, and nothing was saved. Please try again.");
  }

  revalidatePath("/", "layout");
  return { ok: true, imported: plan.transactions.length, categoriesCreated: createdCategoryIds.length };
}
