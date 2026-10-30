import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createTransaction, createUser, type Db } from "./harness";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-000000000b0b";

let db: Db;

async function starter(userId: string) {
  await db.asUser(userId, () => db.query(`select public.create_starter_categories()`));
  const { rows } = await db.query<{ id: string; name: string }>(
    `select id, name from public.categories where user_id = $1`,
    [userId],
  );
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

beforeAll(async () => {
  db = await createDb();
  await createUser(db, ALICE);
  await createUser(db, BOB);
}, 60_000);

describe("profiles", () => {
  it("creates a profile on sign-up with Norwegian defaults", async () => {
    const { rows } = await db.query<{ currency: string; time_zone: string }>(
      `select currency, time_zone from public.profiles where id = $1`,
      [ALICE],
    );
    expect(rows[0]).toEqual({ currency: "NOK", time_zone: "Europe/Oslo" });
  });
});

describe("row level security", () => {
  it("isolates each user's transactions, accounts and categories", async () => {
    const bobAccount = await createAccount(db, BOB, "Bob's account");
    await createTransaction(db, BOB, bobAccount, -12_300);
    await starter(BOB);

    const seen = await db.asUser(ALICE, async () => ({
      tx: (await db.query(`select * from public.transactions`)).rows.length,
      accounts: (await db.query(`select * from public.accounts`)).rows.length,
      categories: (await db.query(`select * from public.categories where user_id = '${BOB}'`)).rows.length,
    }));
    expect(seen).toEqual({ tx: 0, accounts: 0, categories: 0 });
  });

  it("prevents users from inserting transactions directly (server-only)", async () => {
    const account = await createAccount(db, ALICE);
    await expect(
      db.asUser(ALICE, () =>
        db.query(
          `insert into public.transactions (user_id, account_id, fingerprint, status, effective_date, amount_minor, currency)
           values ($1, $2, 'x', 'booked', '2026-10-01', -100, 'NOK')`,
          [ALICE, account],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let users change bank-provided amounts", async () => {
    const account = await createAccount(db, ALICE);
    const tx = await createTransaction(db, ALICE, account, -5_000);
    await expect(
      db.asUser(ALICE, () => db.query(`update public.transactions set amount_minor = -1 where id = $1`, [tx])),
    ).rejects.toThrow(/permission denied/);
  });

  it("hides the encrypted bank session from the browser role", async () => {
    await db.query(
      `insert into public.bank_connections (user_id, provider, institution_name, institution_country, session_secret)
       values ($1, 'demo', 'Demo Bank', 'NO', 'ciphertext')`,
      [ALICE],
    );
    await expect(
      db.asUser(ALICE, () => db.query(`select session_secret from public.bank_connections`)),
    ).rejects.toThrow(/permission denied/);
    const ok = await db.asUser(ALICE, () => db.query(`select institution_name from public.bank_connections`));
    expect(ok.rows).toHaveLength(1);
  });

  it("blocks cross-user category references in allocations", async () => {
    const bobCats = await starter(BOB);
    const account = await createAccount(db, ALICE);
    const tx = await createTransaction(db, ALICE, account, -1_000);
    await expect(
      db.asUser(ALICE, () =>
        db.query(
          `insert into public.transaction_allocations (user_id, transaction_id, category_id, amount_minor)
           values ($1, $2, $3, -1000)`,
          [ALICE, tx, bobCats["Groceries"]],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("categorisation", () => {
  it("categorises with one allocation for the full amount and learns a rule", async () => {
    const cats = await starter(ALICE);
    const account = await createAccount(db, ALICE);
    const first = await createTransaction(db, ALICE, account, -45_900, { merchantKey: "rema 1000" });
    const second = await createTransaction(db, ALICE, account, -12_000, { merchantKey: "rema 1000" });

    await db.asUser(ALICE, () =>
      db.query(`select public.categorize_transactions($1::uuid[], $2)`, [[first], cats["Groceries"]]),
    );

    const alloc = await db.query<{ amount_minor: number }>(
      `select amount_minor from public.transaction_allocations where transaction_id = $1`,
      [first],
    );
    expect(alloc.rows.map((r) => Number(r.amount_minor))).toEqual([-45_900]);

    const other = await db.query<{ suggested_category_id: string; needs_review: boolean }>(
      `select suggested_category_id, needs_review from public.transactions where id = $1`,
      [second],
    );
    expect(other.rows[0]).toEqual({ suggested_category_id: cats["Groceries"], needs_review: true });
  });

  it("rejects splits that do not sum to the transaction amount", async () => {
    const cats = await starter(ALICE);
    const account = await createAccount(db, ALICE);
    const tx = await createTransaction(db, ALICE, account, -60_000);
    const bad = JSON.stringify([
      { category_id: cats["Groceries"], amount_minor: -45_000 },
      { category_id: cats["Miscellaneous"], amount_minor: -14_000 },
    ]);
    await expect(
      db.asUser(ALICE, () => db.transaction((t) => t.query(`select public.set_transaction_split($1, $2)`, [tx, bad]))),
    ).rejects.toThrow(/must sum/);

    const good = JSON.stringify([
      { category_id: cats["Groceries"], amount_minor: -45_000 },
      { category_id: cats["Miscellaneous"], amount_minor: -15_000 },
    ]);
    await db.asUser(ALICE, () => db.transaction((t) => t.query(`select public.set_transaction_split($1, $2)`, [tx, good])));
    const { rows } = await db.query<{ sum: number }>(
      `select sum(amount_minor)::int as sum from public.transaction_allocations where transaction_id = $1`,
      [tx],
    );
    expect(rows[0].sum).toBe(-60_000);
  });

  it("keeps a single category when the bank changes the amount, but re-queues a split", async () => {
    const cats = await starter(ALICE);
    const account = await createAccount(db, ALICE);
    const single = await createTransaction(db, ALICE, account, -10_000, { status: "pending" });
    const split = await createTransaction(db, ALICE, account, -20_000, { status: "pending" });
    await db.asUser(ALICE, () =>
      db.query(`select public.categorize_transactions($1::uuid[], $2, false)`, [[single], cats["Restaurants & cafés"]]),
    );
    await db.asUser(ALICE, () =>
      db.transaction((t) =>
        t.query(`select public.set_transaction_split($1, $2)`, [
          split,
          JSON.stringify([
            { category_id: cats["Groceries"], amount_minor: -15_000 },
            { category_id: cats["Shopping"], amount_minor: -5_000 },
          ]),
        ]),
      ),
    );

    // Sync (service role) books the final amounts.
    await db.transaction(async (t) => {
      await t.query(`update public.transactions set amount_minor = -11_500, status = 'booked' where id = $1`, [single]);
      await t.query(`update public.transactions set amount_minor = -21_000, status = 'booked' where id = $1`, [split]);
    });

    const s = await db.query<{ amount_minor: number; category_id: string }>(
      `select amount_minor, category_id from public.transaction_allocations where transaction_id = $1`,
      [single],
    );
    expect(s.rows.map((r) => [Number(r.amount_minor), r.category_id])).toEqual([[-11_500, cats["Restaurants & cafés"]]]);

    const sp = await db.query<{ needs_review: boolean; n: number }>(
      `select t.needs_review, (select count(*)::int from public.transaction_allocations a where a.transaction_id = t.id) as n
         from public.transactions t where t.id = $1`,
      [split],
    );
    expect(sp.rows[0]).toEqual({ needs_review: true, n: 0 });
  });

  it("clears allocations when a transaction becomes a transfer", async () => {
    const cats = await starter(ALICE);
    const account = await createAccount(db, ALICE);
    const tx = await createTransaction(db, ALICE, account, -100_000);
    await db.asUser(ALICE, () =>
      db.query(`select public.categorize_transactions($1::uuid[], $2, false)`, [[tx], cats["Shopping"]]),
    );
    await db.asUser(ALICE, () => db.query(`select public.set_transaction_treatment($1::uuid[], 'transfer')`, [[tx]]));
    const { rows } = await db.query(`select 1 from public.transaction_allocations where transaction_id = $1`, [tx]);
    expect(rows).toHaveLength(0);
  });
});

describe("budgets", () => {
  it("copies the latest earlier month forward without touching history", async () => {
    const user = "00000000-0000-4000-8000-0000000000c3";
    await createUser(db, user);
    const cats = await starter(user);
    await db.asUser(user, () =>
      db.query(
        `insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
         values ($1, $2, '2026-08-01', 400000), ($1, $3, '2026-08-01', 150000)`,
        [user, cats["Groceries"], cats["Restaurants & cafés"]],
      ),
    );
    const created = await db.asUser(user, () =>
      db.query<{ n: number }>(`select public.ensure_month_budget('2026-10-01') as n`),
    );
    expect(created.rows[0].n).toBe(2);

    // Raising October's grocery budget leaves August alone.
    await db.asUser(user, () =>
      db.query(
        `update public.monthly_budgets set amount_minor = 450000 where category_id = $1 and month = '2026-10-01'`,
        [cats["Groceries"]],
      ),
    );
    const aug = await db.query<{ amount_minor: number }>(
      `select amount_minor from public.monthly_budgets where category_id = $1 and month = '2026-08-01'`,
      [cats["Groceries"]],
    );
    expect(Number(aug.rows[0].amount_minor)).toBe(400000);

    // A second ensure is a no-op.
    const again = await db.asUser(user, () =>
      db.query<{ n: number }>(`select public.ensure_month_budget('2026-10-01') as n`),
    );
    expect(again.rows[0].n).toBe(0);
  });

  it("merges categories without changing historical totals", async () => {
    const user = "00000000-0000-4000-8000-0000000000d4";
    await createUser(db, user);
    const cats = await starter(user);
    const account = await createAccount(db, user);
    const tx = await createTransaction(db, user, account, -30_000, { date: "2026-09-10" });
    await db.asUser(user, () =>
      db.query(`select public.categorize_transactions($1::uuid[], $2, false)`, [[tx], cats["Entertainment"]]),
    );
    await db.asUser(user, () =>
      db.query(
        `insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
         values ($1, $2, '2026-09-01', 100000), ($1, $3, '2026-09-01', 50000)`,
        [user, cats["Entertainment"], cats["Shopping"]],
      ),
    );
    await db.asUser(user, () => db.query(`select public.merge_categories($1, $2)`, [cats["Entertainment"], cats["Shopping"]]));

    const totals = await db.asUser(user, () =>
      db.query<{ net_minor: number }>(
        `select net_minor from public.monthly_category_totals where category_id = $1 and month = '2026-09-01'`,
        [cats["Shopping"]],
      ),
    );
    expect(Number(totals.rows[0].net_minor)).toBe(-30_000);
    const budget = await db.query<{ amount_minor: number }>(
      `select amount_minor from public.monthly_budgets where category_id = $1 and month = '2026-09-01'`,
      [cats["Shopping"]],
    );
    expect(Number(budget.rows[0].amount_minor)).toBe(150_000);
  });

  it("excludes accounts outside the budget and transfers from reports", async () => {
    const user = "00000000-0000-4000-8000-0000000000e5";
    await createUser(db, user);
    const cats = await starter(user);
    const checking = await createAccount(db, user, "Brukskonto");
    const savings = await createAccount(db, user, "Sparekonto", false);
    const groceries = await createTransaction(db, user, checking, -50_000, { date: "2026-10-03" });
    const out = await createTransaction(db, user, checking, -200_000, { date: "2026-10-04" });
    const into = await createTransaction(db, user, savings, 200_000, { date: "2026-10-04" });
    await db.asUser(user, async () => {
      await db.query(`select public.categorize_transactions($1::uuid[], $2, false)`, [[groceries], cats["Groceries"]]);
      await db.query(`select public.set_transaction_treatment($1::uuid[], 'transfer')`, [[out, into]]);
    });
    const flow = await db.asUser(user, () =>
      db.query<{ inflow_minor: number; outflow_minor: number }>(
        `select inflow_minor, outflow_minor from public.monthly_cash_flow where month = '2026-10-01'`,
      ),
    );
    expect(flow.rows.map((r) => [Number(r.inflow_minor), Number(r.outflow_minor)])).toEqual([[0, -50_000]]);
  });
});
