import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createTransaction, createUser, personalSpace, type Db } from "./harness";

// Two people who share a household: each keeps private accounts, and one joint
// account lives in their shared space. A third person is a stranger.
const TRYM = "00000000-0000-4000-8000-0000000017e1";
const PARTNER = "00000000-0000-4000-8000-0000000017e2";
const STRANGER = "00000000-0000-4000-8000-0000000017e3";

let db: Db;
let shared: string;
let trymPrivate: string;
let partnerPrivate: string;
let joint: string;
let trymTx: string;
let partnerTx: string;
let jointTx: string;

const count = (sql: string, params: unknown[] = []) =>
  db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params).then((r) => r.rows[0].n);

beforeAll(async () => {
  db = await createDb();
  for (const u of [TRYM, PARTNER, STRANGER]) await createUser(db, u);
  const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [TRYM]);
  shared = rows[0].id;
  await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, PARTNER]);

  trymPrivate = await createAccount(db, TRYM, "Trym brukskonto");
  partnerPrivate = await createAccount(db, PARTNER, "Partner brukskonto");
  // The joint account comes through Trym's bank login, but lives in the shared space.
  joint = await createAccount(db, TRYM, "Felleskonto", true, shared);
  trymTx = await createTransaction(db, TRYM, trymPrivate, -10_000, { merchantKey: "kiwi" });
  partnerTx = await createTransaction(db, PARTNER, partnerPrivate, -20_000, { merchantKey: "kiwi" });
  jointTx = await createTransaction(db, TRYM, joint, -30_000, { merchantKey: "kiwi" });
}, 60_000);

describe("spaces", () => {
  it("gives every new user a personal space that only they belong to", async () => {
    const space = await personalSpace(db, PARTNER);
    const members = await db.query<{ user_id: string }>(`select user_id from public.space_members where space_id = $1`, [space]);
    expect(members.rows.map((r) => r.user_id)).toEqual([PARTNER]);
    await expect(db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [space, TRYM])).rejects.toThrow(
      /one person/,
    );
  });

  it("keeps a shared space to two people, and a person in one shared space", async () => {
    await expect(db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, STRANGER])).rejects.toThrow(
      /two people/,
    );
    await expect(db.query(`select public.create_shared_space($1)`, [PARTNER])).rejects.toThrow(/another shared space/);
  });

  it("starts a shared space with its own starter categories", async () => {
    expect(await count(`select 1 from public.categories where space_id = $1`, [shared])).toBe(12);
  });

  it("does not let the browser create spaces or change membership", async () => {
    await expect(db.asUser(STRANGER, () => db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, STRANGER]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.asUser(STRANGER, () => db.query(`select public.create_shared_space($1)`, [STRANGER]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.asUser(STRANGER, () => db.query(`insert into public.spaces (kind, name) values ('shared', 'x')`))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("privacy between partners", () => {
  it("shows each person their own private accounts and the joint one, never the other's private ones", async () => {
    const seen = (user: string) =>
      db.asUser(user, async () => ({
        accounts: (await db.query<{ name: string }>(`select name from public.accounts order by name`)).rows.map((r) => r.name),
        transactions: (await db.query<{ id: string }>(`select id from public.transactions`)).rows.map((r) => r.id).sort(),
      }));
    expect(await seen(TRYM)).toEqual({ accounts: ["Felleskonto", "Trym brukskonto"], transactions: [trymTx, jointTx].sort() });
    expect(await seen(PARTNER)).toEqual({ accounts: ["Felleskonto", "Partner brukskonto"], transactions: [partnerTx, jointTx].sort() });
    expect(await seen(STRANGER)).toEqual({ accounts: [], transactions: [] });
  });

  it("hides the other person's private categories, budgets and rules", async () => {
    const trymSpace = await personalSpace(db, TRYM);
    await db.asUser(TRYM, () => db.query(`select public.create_starter_categories($1)`, [trymSpace]));
    const seen = await db.asUser(PARTNER, async () => ({
      categories: await count(`select 1 from public.categories where space_id = $1`, [trymSpace]),
      spaces: await count(`select 1 from public.spaces where id = $1`, [trymSpace]),
    }));
    expect(seen).toEqual({ categories: 0, spaces: 0 });
    // Nor can she write into it.
    await expect(
      db.asUser(PARTNER, () =>
        db.query(`insert into public.categories (space_id, name) values ($1, 'Sneaky')`, [trymSpace]),
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(db.asUser(PARTNER, () => db.query(`select public.create_starter_categories($1)`, [trymSpace]))).rejects.toThrow(
      /Unknown space/,
    );
    await expect(
      db.asUser(PARTNER, () => db.query(`select public.set_month_budgets($1, '2026-10-01', '{}'::jsonb)`, [trymSpace])),
    ).rejects.toThrow(/Unknown space/);
  });

  it("does not let RPCs touch the other person's private transactions", async () => {
    const changed = await db.asUser(PARTNER, async () => ({
      treatment: (await db.query<{ n: number }>(`select public.set_transaction_treatment($1::uuid[], 'excluded') as n`, [[trymTx]])).rows[0].n,
      reset: (await db.query<{ n: number }>(`select public.reset_transaction_review($1::uuid[]) as n`, [[trymTx]])).rows[0].n,
    }));
    expect(changed).toEqual({ treatment: 0, reset: 0 });
    await expect(
      db.asUser(PARTNER, () =>
        db.transaction((t) => t.query(`select public.set_transaction_split($1, '[]'::jsonb)`, [trymTx])),
      ),
    ).rejects.toThrow(/not found/);
    // A shared category cannot be put on a private transaction.
    const { rows } = await db.query<{ id: string }>(`select id from public.categories where space_id = $1 and name = 'Groceries'`, [shared]);
    const n = await db.asUser(PARTNER, () =>
      db.query<{ n: number }>(`select public.categorize_transactions($1::uuid[], $2, false) as n`, [[trymTx, partnerTx], rows[0].id]),
    );
    expect(n.rows[0].n).toBe(0);
  });

  it("only shows the bank connection behind an account that is shared", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.bank_connections (user_id, provider, institution_name, institution_country, session_secret)
       values ($1, 'demo', 'Handelsbanken', 'NO', 'ciphertext'), ($1, 'demo', 'Private Bank', 'NO', 'ciphertext') returning id`,
      [TRYM],
    );
    await db.query(`update public.accounts set connection_id = $1 where id = $2`, [rows[0].id, joint]);
    await db.query(`update public.accounts set connection_id = $1 where id = $2`, [rows[1].id, trymPrivate]);
    const names = await db.asUser(PARTNER, () => db.query<{ institution_name: string }>(`select institution_name from public.bank_connections`));
    expect(names.rows.map((r) => r.institution_name)).toEqual(["Handelsbanken"]);
    await expect(db.asUser(PARTNER, () => db.query(`select session_secret from public.bank_connections`))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("only lets the bank's owner rename or toggle an account, even a shared one", async () => {
    await db.asUser(PARTNER, () => db.query(`update public.accounts set name = 'Renamed' where id = $1`, [joint]));
    const { rows } = await db.query<{ name: string }>(`select name from public.accounts where id = $1`, [joint]);
    expect(rows[0].name).toBe("Felleskonto");
    await expect(db.asUser(TRYM, () => db.query(`update public.accounts set space_id = $1 where id = $2`, [shared, trymPrivate]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("lets partners see each other's name but nothing else about the stranger", async () => {
    const ids = await db.asUser(PARTNER, () => db.query<{ id: string }>(`select id from public.profiles order by id`));
    expect(ids.rows.map((r) => r.id)).toEqual([TRYM, PARTNER].sort());
  });
});

describe("working together in the shared space", () => {
  it("lets either partner categorise the joint account with shared categories", async () => {
    const { rows } = await db.query<{ id: string }>(`select id from public.categories where space_id = $1 and name = 'Groceries'`, [shared]);
    const groceries = rows[0].id;
    const second = await createTransaction(db, TRYM, joint, -4_500, { merchantKey: "kiwi" });
    await db.asUser(PARTNER, () => db.query(`select public.categorize_transactions($1::uuid[], $2)`, [[jointTx], groceries]));

    const totals = await db.asUser(TRYM, () =>
      db.query<{ net_minor: number }>(
        `select net_minor from public.monthly_category_totals where space_id = $1 and category_id = $2`,
        [shared, groceries],
      ),
    );
    expect(totals.rows.map((r) => Number(r.net_minor))).toEqual([-30_000]);
    // The rule is learned in the shared space and suggests only shared transactions.
    const s = await db.query<{ id: string; suggested_category_id: string | null }>(
      `select id, suggested_category_id from public.transactions where id in ($1, $2)`,
      [second, trymTx],
    );
    const byId = Object.fromEntries(s.rows.map((r) => [r.id, r.suggested_category_id]));
    expect(byId).toEqual({ [second]: groceries, [trymTx]: null });
    expect(await count(`select 1 from public.categorization_rules where space_id = $1`, [shared])).toBe(1);
  });

  it("rejects allocations that mix spaces", async () => {
    const trymSpace = await personalSpace(db, TRYM);
    const { rows } = await db.query<{ id: string }>(`select id from public.categories where space_id = $1 and name = 'Groceries'`, [trymSpace]);
    await expect(
      db.asUser(TRYM, () =>
        db.transaction((t) =>
          t.query(`select public.set_transaction_split($1, $2)`, [
            jointTx,
            JSON.stringify([{ category_id: rows[0].id, amount_minor: -30_000 }]),
          ]),
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe("moving an account between spaces", () => {
  it("moves the account and its transactions, and sends them back to review", async () => {
    const trymSpace = await personalSpace(db, TRYM);
    await db.asUser(TRYM, () => db.query(`select public.create_starter_categories($1)`, [trymSpace]));
    const { rows } = await db.query<{ id: string }>(`select id from public.categories where space_id = $1 and name = 'Shopping'`, [trymSpace]);
    const account = await createAccount(db, TRYM, "Kredittkort");
    const tx = await createTransaction(db, TRYM, account, -9_900);
    await db.asUser(TRYM, () => db.query(`select public.categorize_transactions($1::uuid[], $2, false)`, [[tx], rows[0].id]));

    // Only the owner can move it, and only into a space they belong to.
    await expect(db.asUser(PARTNER, () => db.query(`select public.move_account_to_space($1, $2)`, [account, shared]))).rejects.toThrow(
      /not found/,
    );
    const partnerSpace = await personalSpace(db, PARTNER);
    await expect(
      db.asUser(TRYM, () => db.query(`select public.move_account_to_space($1, $2)`, [account, partnerSpace])),
    ).rejects.toThrow(/Unknown space/);

    await db.asUser(TRYM, () => db.transaction((t) => t.query(`select public.move_account_to_space($1, $2)`, [account, shared])));
    const moved = await db.query<{ space_id: string; needs_review: boolean; n: number }>(
      `select t.space_id, t.needs_review, (select count(*)::int from public.transaction_allocations a where a.transaction_id = t.id) as n
         from public.transactions t where t.id = $1`,
      [tx],
    );
    expect(moved.rows[0]).toEqual({ space_id: shared, needs_review: true, n: 0 });
    expect(await db.asUser(PARTNER, () => count(`select 1 from public.transactions where id = $1`, [tx]))).toBe(1);

    // And back to private: the partner loses sight of it.
    await db.asUser(TRYM, () => db.transaction((t) => t.query(`select public.move_account_to_space($1, $2)`, [account, trymSpace])));
    expect(await db.asUser(PARTNER, () => count(`select 1 from public.transactions where id = $1`, [tx]))).toBe(0);
  });
});

describe("deleting a user", () => {
  it("removes their private data and leaves the shared space to the other partner", async () => {
    const a = "00000000-0000-4000-8000-0000000017f1";
    const b = "00000000-0000-4000-8000-0000000017f2";
    await createUser(db, a);
    await createUser(db, b);
    const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [a]);
    await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [rows[0].id, b]);
    const own = await createAccount(db, b, "Mine");
    await createTransaction(db, b, own, -100);
    const jointB = await createAccount(db, b, "Joint", true, rows[0].id);
    await createTransaction(db, b, jointB, -200);

    await db.query(`delete from auth.users where id = $1`, [b]);
    expect(await count(`select 1 from public.spaces where personal_user_id = $1`, [b])).toBe(0);
    expect(await count(`select 1 from public.accounts where user_id = $1`, [b])).toBe(0);
    expect(await count(`select 1 from public.space_members where space_id = $1`, [rows[0].id])).toBe(1);
  });
});
