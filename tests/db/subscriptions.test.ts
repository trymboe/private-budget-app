import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createTransaction, createUser, personalSpace, type Db } from "./harness";

// Subscription decisions (confirmed / dismissed / cancelled) belong to a space, like
// categories. Two partners share a household; a third person is a stranger.
const TRYM = "00000000-0000-4000-8000-00000000a5b1";
const PARTNER = "00000000-0000-4000-8000-00000000a5b2";
const STRANGER = "00000000-0000-4000-8000-00000000a5b3";

let db: Db;
let shared: string;
let trymSpace: string;
let partnerSpace: string;
let trymTx: string;
let jointTx: string;
let trymCategory: string;
let sharedCategory: string;

type SaveArgs = {
  space: string;
  key?: string;
  cadence?: string;
  status?: string;
  name?: string;
  amount?: number;
  category?: string | null;
  source?: string;
  tx?: string | null;
  cancelledOn?: string | null;
};

const save = (a: SaveArgs) =>
  db
    .query<{ id: string }>(`select public.save_subscription($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) as id`, [
      a.space,
      a.key ?? "netflix",
      a.cadence ?? "monthly",
      a.status ?? "confirmed",
      a.name ?? "Netflix",
      a.amount ?? 12_900,
      a.category ?? null,
      a.source ?? "detected",
      a.tx ?? null,
      a.cancelledOn ?? null,
    ])
    .then((r) => r.rows[0].id);

const rowsFor = (space: string) =>
  db.query<{ merchant_key: string; status: string; amount_minor: string; cancelled_on: string | null; name: string }>(
    `select merchant_key, status, amount_minor::text, cancelled_on::text, name from public.subscriptions where space_id = $1 order by merchant_key`,
    [space],
  );

beforeAll(async () => {
  db = await createDb();
  for (const u of [TRYM, PARTNER, STRANGER]) await createUser(db, u);
  const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [TRYM]);
  shared = rows[0].id;
  await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, PARTNER]);
  trymSpace = await personalSpace(db, TRYM);
  partnerSpace = await personalSpace(db, PARTNER);

  const trymAccount = await createAccount(db, TRYM, "Trym brukskonto");
  const joint = await createAccount(db, TRYM, "Felleskonto", true, shared);
  trymTx = await createTransaction(db, TRYM, trymAccount, -12_900, { merchantKey: "netflix" });
  jointTx = await createTransaction(db, TRYM, joint, -45_000, { merchantKey: "fjordkraft" });

  await db.asUser(TRYM, () => db.query(`select public.create_starter_categories($1)`, [trymSpace]));
  const cat = async (space: string) =>
    (await db.query<{ id: string }>(`select id from public.categories where space_id = $1 and name = 'Subscriptions'`, [space])).rows[0].id;
  trymCategory = await cat(trymSpace);
  sharedCategory = await cat(shared);
}, 60_000);

describe("saving decisions", () => {
  it("creates a decision, then updates it in place through the same function", async () => {
    const id = await db.asUser(TRYM, () => save({ space: trymSpace, category: trymCategory }));
    // Same merchant and cadence: the existing row is updated, not duplicated.
    const again = await db.asUser(TRYM, () => save({ space: trymSpace, amount: 14_900, name: "Netflix Standard", category: trymCategory }));
    expect(again).toBe(id);
    const { rows } = await db.asUser(TRYM, () => rowsFor(trymSpace));
    expect(rows).toEqual([{ merchant_key: "netflix", status: "confirmed", amount_minor: "14900", cancelled_on: null, name: "Netflix Standard" }]);
  });

  it("stamps a cancellation date, and clears it when confirmed again", async () => {
    await db.asUser(TRYM, () => save({ space: trymSpace, status: "cancelled", cancelledOn: "2026-11-01" }));
    expect((await db.asUser(TRYM, () => rowsFor(trymSpace))).rows[0]).toMatchObject({ status: "cancelled", cancelled_on: "2026-11-01" });
    // Saving "cancelled" again without a date keeps the original date.
    await db.asUser(TRYM, () => save({ space: trymSpace, status: "cancelled" }));
    expect((await db.asUser(TRYM, () => rowsFor(trymSpace))).rows[0].cancelled_on).toBe("2026-11-01");
    await db.asUser(TRYM, () => save({ space: trymSpace, status: "confirmed" }));
    expect((await db.asUser(TRYM, () => rowsFor(trymSpace))).rows[0]).toMatchObject({ status: "confirmed", cancelled_on: null });
  });

  it("keeps the same merchant at another cadence as a separate decision", async () => {
    await db.asUser(TRYM, () => save({ space: trymSpace, cadence: "yearly", status: "dismissed", amount: 99_000 }));
    const n = await db.query<{ n: number }>(`select count(*)::int as n from public.subscriptions where space_id = $1`, [trymSpace]);
    expect(n.rows[0].n).toBe(2);
    await db.asUser(TRYM, () => db.query(`delete from public.subscriptions where space_id = $1 and cadence = 'yearly'`, [trymSpace]));
  });

  it("adds one by hand from a transaction in the same space", async () => {
    await db.asUser(TRYM, () =>
      save({ space: trymSpace, key: "sats", name: "SATS", amount: 54_900, source: "manual", tx: trymTx }),
    );
    const { rows } = await db.query<{ source: string; transaction_id: string; created_by: string }>(
      `select source, transaction_id, created_by from public.subscriptions where merchant_key = 'sats'`,
    );
    expect(rows[0]).toEqual({ source: "manual", transaction_id: trymTx, created_by: TRYM });
  });

  it("rejects bad input", async () => {
    await expect(db.asUser(TRYM, () => save({ space: trymSpace, key: "x", cadence: "daily" }))).rejects.toThrow(/check/);
    await expect(db.asUser(TRYM, () => save({ space: trymSpace, key: "x", status: "maybe" }))).rejects.toThrow(/Unknown status/);
    await expect(db.asUser(TRYM, () => save({ space: trymSpace, key: "x", amount: 0 }))).rejects.toThrow(/check/);
    await expect(db.asUser(TRYM, () => save({ space: trymSpace, key: "x", name: "  " }))).rejects.toThrow(/check/);
    await expect(db.asUser(TRYM, () => save({ space: trymSpace, key: "" }))).rejects.toThrow(/check/);
  });

  it("forgets a decision when it is deleted (undo)", async () => {
    await db.asUser(TRYM, () => save({ space: trymSpace, key: "viaplay", status: "dismissed", name: "Viaplay" }));
    await db.asUser(TRYM, () => db.query(`delete from public.subscriptions where merchant_key = 'viaplay'`));
    expect((await db.query(`select 1 from public.subscriptions where merchant_key = 'viaplay'`)).rows).toHaveLength(0);
  });

  it("drops the category, not the decision, when the category is deleted", async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.categories (space_id, name) values ($1, 'Streaming') returning id`,
      [trymSpace],
    );
    await db.asUser(TRYM, () => save({ space: trymSpace, key: "hbo", name: "Max", category: rows[0].id }));
    await db.query(`delete from public.categories where id = $1`, [rows[0].id]);
    const after = await db.query<{ category_id: string | null }>(`select category_id from public.subscriptions where merchant_key = 'hbo'`);
    expect(after.rows).toEqual([{ category_id: null }]);
  });
});

describe("privacy between partners", () => {
  it("shares decisions in the shared space and keeps private ones private", async () => {
    await db.asUser(TRYM, () =>
      save({ space: shared, key: "fjordkraft", name: "Fjordkraft", amount: 45_000, category: sharedCategory, tx: jointTx, source: "manual" }),
    );
    const seen = (user: string) =>
      db.asUser(user, async () =>
        (await db.query<{ merchant_key: string }>(`select merchant_key from public.subscriptions order by merchant_key`)).rows.map(
          (r) => r.merchant_key,
        ),
      );
    expect(await seen(PARTNER)).toEqual(["fjordkraft"]);
    expect(await seen(TRYM)).toEqual(["fjordkraft", "hbo", "netflix", "sats"]);
    expect(await seen(STRANGER)).toEqual([]);
  });

  it("does not let the partner write into, change or delete a private decision", async () => {
    await expect(db.asUser(PARTNER, () => save({ space: trymSpace, key: "sneaky" }))).rejects.toThrow(/Unknown space/);
    await expect(
      db.asUser(PARTNER, () =>
        db.query(`insert into public.subscriptions (space_id, merchant_key, cadence, status, name, amount_minor)
                  values ($1, 'sneaky', 'monthly', 'confirmed', 'Sneaky', 100)`, [trymSpace]),
      ),
    ).rejects.toThrow(/row-level security/);
    const changed = await db.asUser(PARTNER, async () => {
      const u = await db.query(`update public.subscriptions set status = 'dismissed' where space_id = $1`, [trymSpace]);
      const d = await db.query(`delete from public.subscriptions where space_id = $1`, [trymSpace]);
      return [u.affectedRows, d.affectedRows];
    });
    expect(changed).toEqual([0, 0]);
    expect((await rowsFor(trymSpace)).rows.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
  });

  it("never references a category or transaction from another space", async () => {
    // A private category on a shared subscription, or a private transaction behind one.
    await expect(db.asUser(TRYM, () => save({ space: shared, key: "x1", category: trymCategory }))).rejects.toThrow(/foreign key/);
    await expect(db.asUser(TRYM, () => save({ space: shared, key: "x2", tx: trymTx }))).rejects.toThrow(/foreign key/);
    await expect(db.asUser(PARTNER, () => save({ space: partnerSpace, key: "x3", tx: jointTx }))).rejects.toThrow(/foreign key/);
  });

  it("cannot move a decision to another space or rewrite who made it", async () => {
    await expect(
      db.asUser(TRYM, () => db.query(`update public.subscriptions set space_id = $1 where merchant_key = 'netflix'`, [shared])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(TRYM, () => db.query(`update public.subscriptions set created_by = $1 where merchant_key = 'netflix'`, [PARTNER])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(TRYM, () => db.query(`update public.subscriptions set merchant_key = 'other' where merchant_key = 'netflix'`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("gives the anonymous role nothing", async () => {
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select * from public.subscriptions`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select public.save_subscription($1, 'a', 'monthly', 'confirmed', 'A', 100)`, [trymSpace])).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await db.exec(`reset role`);
    }
  });
});
