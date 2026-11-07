import { beforeAll, describe, expect, it } from "vitest";
import { AUTO_THRESHOLD } from "@/lib/auto-categorise";
import { createAccount, createDb, createTransaction, createUser, personalSpace, type Db } from "./harness";

// Trusted merchants: after three same-category decisions, sync files new
// transactions from the merchant by itself. Two partners share a space; each
// keeps a private one.
const TRYM = "00000000-0000-4000-8000-0000000a0701";
const PARTNER = "00000000-0000-4000-8000-0000000a0702";

let db: Db;
let trymSpace: string;
let shared: string;
let trymAccount: string;
let jointAccount: string;
let cats: Record<string, string>;
let sharedCats: Record<string, string>;

type TxState = { needs_review: boolean; auto: boolean; categories: string[] };

async function categories(space: string) {
  const { rows } = await db.query<{ id: string; name: string }>(`select id, name from public.categories where space_id = $1`, [space]);
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

async function categorize(user: string, ids: string[], categoryId: string) {
  await db.asUser(user, () => db.query(`select public.categorize_transactions($1::uuid[], $2, true)`, [ids, categoryId]));
}

/** What sync does: insert as the server, then file by trusted rules. */
async function importTx(account: string, user: string, amount: number, merchantKey: string | null) {
  const id = await createTransaction(db, user, account, amount, { merchantKey: merchantKey ?? undefined });
  return id;
}

async function applyAuto(account: string, ids: string[]) {
  const { rows } = await db.query<{ n: number }>(`select public.apply_auto_categorization($1, $2::uuid[]) as n`, [account, ids]);
  return rows[0].n;
}

async function state(id: string): Promise<TxState> {
  const { rows } = await db.query<{ needs_review: boolean; auto: boolean; categories: string[] | null }>(
    `select t.needs_review, t.auto_categorized_at is not null as auto,
            (select array_agg(a.category_id) from public.transaction_allocations a where a.transaction_id = t.id) as categories
       from public.transactions t where t.id = $1`,
    [id],
  );
  return { ...rows[0], categories: rows[0].categories ?? [] };
}

async function rule(space: string, merchantKey: string) {
  const { rows } = await db.query<{ id: string; category_id: string; confirmations: number; auto_enabled: boolean }>(
    `select id, category_id, confirmations, auto_enabled from public.categorization_rules where space_id = $1 and merchant_key = $2`,
    [space, merchantKey],
  );
  return rows[0];
}

/** Confirm a merchant `times` times, one transaction at a time, like the review queue. */
async function trust(user: string, account: string, merchantKey: string, categoryId: string, times = AUTO_THRESHOLD) {
  for (let i = 0; i < times; i += 1) {
    // Bank data belongs to the account owner (Trym); either member may categorise it.
    const id = await importTx(account, TRYM, -10_000 - i, merchantKey);
    await categorize(user, [id], categoryId);
  }
}

beforeAll(async () => {
  db = await createDb();
  for (const u of [TRYM, PARTNER]) await createUser(db, u);
  trymSpace = await personalSpace(db, TRYM);
  await db.asUser(TRYM, () => db.query(`select public.create_starter_categories($1)`, [trymSpace]));
  cats = await categories(trymSpace);
  const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [TRYM]);
  shared = rows[0].id;
  await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, PARTNER]);
  sharedCats = await categories(shared);
  trymAccount = await createAccount(db, TRYM, "Trym brukskonto");
  jointAccount = await createAccount(db, TRYM, "Felleskonto", true, shared);
}, 60_000);

describe("trusted merchants", () => {
  it("uses the same threshold as the app", async () => {
    const { rows } = await db.query<{ n: number }>(`select public.auto_categorize_threshold() as n`);
    expect(rows[0].n).toBe(AUTO_THRESHOLD);
  });

  it("files new transactions once a merchant was confirmed three times, and not before", async () => {
    await trust(TRYM, trymAccount, "rema 1000", cats["Groceries"], AUTO_THRESHOLD - 1);
    const early = await importTx(trymAccount, TRYM, -25_000, "rema 1000");
    expect(await applyAuto(trymAccount, [early])).toBe(0);
    expect(await state(early)).toEqual({ needs_review: true, auto: false, categories: [] });

    await categorize(TRYM, [early], cats["Groceries"]);
    expect((await rule(trymSpace, "rema 1000")).confirmations).toBe(AUTO_THRESHOLD);

    const later = await importTx(trymAccount, TRYM, -31_900, "rema 1000");
    const other = await importTx(trymAccount, TRYM, -5_000, "narvesen");
    const unknown = await importTx(trymAccount, TRYM, -7_000, null);
    expect(await applyAuto(trymAccount, [later, other, unknown])).toBe(1);
    expect(await state(later)).toEqual({ needs_review: false, auto: true, categories: [cats["Groceries"]] });
    expect(await state(other)).toEqual({ needs_review: true, auto: false, categories: [] });
    // The allocation covers the full amount (the balance trigger would refuse otherwise).
    const { rows } = await db.query<{ amount_minor: string }>(`select amount_minor from public.transaction_allocations where transaction_id = $1`, [later]);
    expect(rows.map((r) => Number(r.amount_minor))).toEqual([-31_900]);
  });

  it("never files a transaction someone already decided on, or one that looks like a transfer", async () => {
    const decided = await importTx(trymAccount, TRYM, -9_900, "rema 1000");
    await db.asUser(TRYM, () => db.query(`select public.set_transaction_treatment($1::uuid[], 'excluded')`, [[decided]]));
    const transfer = await importTx(trymAccount, TRYM, -9_800, "rema 1000");
    await db.query(`update public.transactions set suggested_treatment = 'transfer', suggestion_reason = 'transfer_match' where id = $1`, [transfer]);
    expect(await applyAuto(trymAccount, [decided, transfer])).toBe(0);
    expect((await state(transfer)).needs_review).toBe(true);
    // Running it twice changes nothing the second time.
    const again = await importTx(trymAccount, TRYM, -9_700, "rema 1000");
    expect(await applyAuto(trymAccount, [again])).toBe(1);
    expect(await applyAuto(trymAccount, [again])).toBe(0);
  });

  it("respects the per-merchant switch and the space switch", async () => {
    const r = await rule(trymSpace, "rema 1000");
    await db.asUser(TRYM, () => db.query(`select public.set_merchant_rule($1, null, false)`, [r.id]));
    const off = await importTx(trymAccount, TRYM, -1_100, "rema 1000");
    expect(await applyAuto(trymAccount, [off])).toBe(0);
    await db.asUser(TRYM, () => db.query(`select public.set_merchant_rule($1, null, true)`, [r.id]));

    await db.asUser(TRYM, () => db.query(`select public.set_auto_categorize($1, false)`, [trymSpace]));
    expect(await applyAuto(trymAccount, [off])).toBe(0);
    await db.asUser(TRYM, () => db.query(`select public.set_auto_categorize($1, true)`, [trymSpace]));
    expect(await applyAuto(trymAccount, [off])).toBe(1);
  });

  it("skips rules whose category was archived", async () => {
    await trust(TRYM, trymAccount, "kino", cats["Entertainment"]);
    await db.query(`update public.categories set archived_at = now() where id = $1`, [cats["Entertainment"]]);
    const tx = await importTx(trymAccount, TRYM, -15_000, "kino");
    expect(await applyAuto(trymAccount, [tx])).toBe(0);
    await db.query(`update public.categories set archived_at = null where id = $1`, [cats["Entertainment"]]);
  });
});

describe("the Auto mark", () => {
  it("disappears when someone decides, and a correction resets the merchant's trust", async () => {
    const tx = await importTx(trymAccount, TRYM, -42_000, "rema 1000");
    expect(await applyAuto(trymAccount, [tx])).toBe(1);
    const before = await rule(trymSpace, "rema 1000");
    expect(before.confirmations).toBeGreaterThanOrEqual(AUTO_THRESHOLD);

    await categorize(TRYM, [tx], cats["Shopping"]);
    expect(await state(tx)).toEqual({ needs_review: false, auto: false, categories: [cats["Shopping"]] });
    const after = await rule(trymSpace, "rema 1000");
    expect(after).toMatchObject({ category_id: cats["Shopping"], confirmations: 1 });

    // "Just this once": the old rule comes back, and the transaction keeps its new category.
    await db.asUser(TRYM, () =>
      db.query(`select public.set_merchant_rule($1, $2, null, $3)`, [after.id, before.category_id, before.confirmations]),
    );
    expect(await rule(trymSpace, "rema 1000")).toMatchObject({ category_id: cats["Groceries"], confirmations: before.confirmations });
    expect((await state(tx)).categories).toEqual([cats["Shopping"]]);
  });

  it("is cleared by treatment changes and by sending it back to review, but not by a note", async () => {
    const a = await importTx(trymAccount, TRYM, -1_000, "rema 1000");
    const b = await importTx(trymAccount, TRYM, -2_000, "rema 1000");
    const c = await importTx(trymAccount, TRYM, -3_000, "rema 1000");
    expect(await applyAuto(trymAccount, [a, b, c])).toBe(3);
    await db.asUser(TRYM, async () => {
      await db.query(`select public.set_transaction_treatment($1::uuid[], 'transfer')`, [[a]]);
      await db.query(`select public.reset_transaction_review($1::uuid[])`, [[b]]);
      await db.query(`update public.transactions set note = 'weekly shop' where id = $1`, [c]);
    });
    expect((await state(a)).auto).toBe(false);
    expect(await state(b)).toEqual({ needs_review: true, auto: false, categories: [] });
    expect((await state(c)).auto).toBe(true);
  });

  it("cannot be set or run from the browser", async () => {
    const tx = await importTx(trymAccount, TRYM, -4_000, "rema 1000");
    await expect(
      db.asUser(TRYM, () => db.query(`update public.transactions set auto_categorized_at = now() where id = $1`, [tx])),
    ).rejects.toThrow(/permission denied/);
    await expect(db.asUser(TRYM, () => db.query(`select public.apply_auto_categorization($1, $2::uuid[])`, [trymAccount, [tx]]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.asUser(TRYM, () => db.query(`update public.spaces set auto_categorize = false where id = $1`, [trymSpace]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("rules stay in their space", () => {
  it("files a joint account's transactions only by the shared space's rules", async () => {
    // Trym trusts "kiwi" privately; the joint account must not use that rule.
    await trust(TRYM, trymAccount, "kiwi", cats["Groceries"]);
    const joint = await importTx(jointAccount, TRYM, -20_000, "kiwi");
    expect(await applyAuto(jointAccount, [joint])).toBe(0);
    // A private transaction id passed with the joint account is ignored too.
    const privateTx = await importTx(trymAccount, TRYM, -20_000, "kiwi");
    expect(await applyAuto(jointAccount, [privateTx])).toBe(0);

    // The partner trusts "kiwi" in the shared space; now the joint account files it.
    await trust(PARTNER, jointAccount, "kiwi", sharedCats["Groceries"]);
    expect(await applyAuto(jointAccount, [joint])).toBe(1);
    expect((await state(joint)).categories).toEqual([sharedCats["Groceries"]]);
  });

  it("does not let the partner see or change private rules or the private switch", async () => {
    const privateRule = await rule(trymSpace, "rema 1000");
    const seen = await db.asUser(PARTNER, () =>
      db.query(`select merchant_key from public.categorization_rules where space_id = $1`, [trymSpace]),
    );
    expect(seen.rows).toEqual([]);
    await expect(db.asUser(PARTNER, () => db.query(`select public.set_merchant_rule($1, null, false)`, [privateRule.id]))).rejects.toThrow(
      /Rule not found/,
    );
    await expect(db.asUser(PARTNER, () => db.query(`select public.forget_merchant_rule($1)`, [privateRule.id]))).rejects.toThrow(
      /Rule not found/,
    );
    await expect(db.asUser(PARTNER, () => db.query(`select public.set_auto_categorize($1, false)`, [trymSpace]))).rejects.toThrow(
      /Unknown space/,
    );
    expect(await rule(trymSpace, "rema 1000")).toMatchObject({ auto_enabled: true });
    const { rows } = await db.query<{ auto_categorize: boolean }>(`select auto_categorize from public.spaces where id = $1`, [trymSpace]);
    expect(rows[0].auto_categorize).toBe(true);
  });

  it("lets either partner manage the shared space's rules, but never with a private category", async () => {
    const sharedRule = await rule(shared, "kiwi");
    await expect(
      db.asUser(PARTNER, () => db.query(`select public.set_merchant_rule($1, $2)`, [sharedRule.id, cats["Shopping"]])),
    ).rejects.toThrow(/Unknown category/);
    await db.asUser(TRYM, () => db.query(`select public.set_merchant_rule($1, $2)`, [sharedRule.id, sharedCats["Shopping"]]));
    expect(await rule(shared, "kiwi")).toMatchObject({ category_id: sharedCats["Shopping"] });
    await db.asUser(PARTNER, () => db.query(`select public.set_auto_categorize($1, false)`, [shared]));
    const { rows } = await db.query<{ auto_categorize: boolean }>(`select auto_categorize from public.spaces where id = $1`, [shared]);
    expect(rows[0].auto_categorize).toBe(false);
  });

  it("forgets a rule and the suggestions it made", async () => {
    const waiting = await importTx(trymAccount, TRYM, -3_300, "narvesen");
    await trust(TRYM, trymAccount, "narvesen", cats["Restaurants & cafés"], 1);
    const { rows: before } = await db.query<{ suggested_category_id: string | null }>(
      `select suggested_category_id from public.transactions where id = $1`,
      [waiting],
    );
    expect(before[0].suggested_category_id).toBe(cats["Restaurants & cafés"]);
    const r = await rule(trymSpace, "narvesen");
    await db.asUser(TRYM, () => db.query(`select public.forget_merchant_rule($1)`, [r.id]));
    expect(await rule(trymSpace, "narvesen")).toBeUndefined();
    const { rows: after } = await db.query<{ suggested_category_id: string | null }>(
      `select suggested_category_id from public.transactions where id = $1`,
      [waiting],
    );
    expect(after[0].suggested_category_id).toBeNull();
  });
});
