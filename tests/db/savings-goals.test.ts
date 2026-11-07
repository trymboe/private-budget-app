import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createTransaction, createUser, personalSpace, type Db } from "./harness";

// Savings goals live in a space: a private goal is seen only by its owner, a shared
// goal by both partners. A third person sees nothing.
const TRYM = "00000000-0000-4000-8000-00000000901a";
const PARTNER = "00000000-0000-4000-8000-00000000901b";
const STRANGER = "00000000-0000-4000-8000-00000000901c";

let db: Db;
let shared: string;
let trymSpace: string;
let partnerSpace: string;
let savings: string;
let jointSavings: string;

const count = (sql: string, params: unknown[] = []) =>
  db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params).then((r) => r.rows[0].n);

async function createGoal(user: string, space: string, fields: Record<string, unknown> = {}) {
  const cols = { name: "Ferie", target_minor: 2_000_000, ...fields };
  const keys = Object.keys(cols);
  const { rows } = await db.asUser(user, () =>
    db.query<{ id: string }>(
      `insert into public.savings_goals (space_id, ${keys.join(", ")}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) returning id`,
      [space, ...Object.values(cols)],
    ),
  );
  return rows[0].id;
}

beforeAll(async () => {
  db = await createDb();
  for (const u of [TRYM, PARTNER, STRANGER]) await createUser(db, u);
  const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [TRYM]);
  shared = rows[0].id;
  await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [shared, PARTNER]);
  trymSpace = await personalSpace(db, TRYM);
  partnerSpace = await personalSpace(db, PARTNER);
  savings = await createAccount(db, TRYM, "Sparekonto", false);
  jointSavings = await createAccount(db, TRYM, "Felles sparing", false, shared);
}, 60_000);

describe("savings goals: privacy", () => {
  it("shows a private goal to its owner only, and a shared goal to both partners", async () => {
    const mine = await createGoal(TRYM, trymSpace, { name: "Ny sykkel" });
    const ours = await createGoal(PARTNER, shared, { name: "Sommerferie" });
    await db.asUser(TRYM, () => db.query(`select public.add_goal_contribution($1, 50000)`, [mine]));
    await db.asUser(PARTNER, () => db.query(`select public.add_goal_contribution($1, 70000)`, [ours]));

    const seen = (user: string) =>
      db.asUser(user, async () => ({
        goals: (await db.query<{ name: string }>(`select name from public.savings_goals order by name`)).rows.map((r) => r.name),
        contributions: await count(`select 1 from public.savings_goal_contributions`),
        progress: (await db.query<{ goal_id: string }>(`select goal_id from public.savings_goal_progress`)).rows.length,
      }));
    expect(await seen(TRYM)).toEqual({ goals: ["Ny sykkel", "Sommerferie"], contributions: 2, progress: 2 });
    expect(await seen(PARTNER)).toEqual({ goals: ["Sommerferie"], contributions: 1, progress: 1 });
    expect(await seen(STRANGER)).toEqual({ goals: [], contributions: 0, progress: 0 });
  });

  it("does not let a partner create, change, contribute to or delete a private goal", async () => {
    const mine = await createGoal(TRYM, trymSpace, { name: "Hemmelig" });
    await expect(createGoal(PARTNER, trymSpace)).rejects.toThrow(/row-level security/);
    await expect(db.asUser(PARTNER, () => db.query(`select public.add_goal_contribution($1, 100)`, [mine]))).rejects.toThrow(/not found/);
    await expect(
      db.asUser(PARTNER, () =>
        db.query(`insert into public.savings_goal_contributions (space_id, goal_id, amount_minor) values ($1, $2, 100)`, [trymSpace, mine]),
      ),
    ).rejects.toThrow(/row-level security/);
    // Smuggling a contribution through the partner's own space breaks the (goal, space) key.
    await expect(
      db.asUser(PARTNER, () =>
        db.query(`insert into public.savings_goal_contributions (space_id, goal_id, amount_minor) values ($1, $2, 100)`, [partnerSpace, mine]),
      ),
    ).rejects.toThrow(/foreign key/);
    const changed = await db.asUser(PARTNER, async () => ({
      updated: (await db.query(`update public.savings_goals set name = 'Mine nå' where id = $1`, [mine])).affectedRows,
      deleted: (await db.query(`delete from public.savings_goals where id = $1`, [mine])).affectedRows,
    }));
    expect(changed).toEqual({ updated: 0, deleted: 0 });
    expect(await count(`select 1 from public.savings_goals where id = $1 and name = 'Hemmelig'`, [mine])).toBe(1);
  });

  it("never moves a goal to another space, and never sets who logged a contribution", async () => {
    const mine = await createGoal(TRYM, trymSpace, { name: "Flytt meg" });
    await expect(db.asUser(TRYM, () => db.query(`update public.savings_goals set space_id = $1 where id = $2`, [shared, mine]))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.asUser(TRYM, () =>
        db.query(`insert into public.savings_goal_contributions (space_id, goal_id, amount_minor, created_by) values ($1, $2, 100, $3)`, [
          trymSpace,
          mine,
          PARTNER,
        ]),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.asUser(TRYM, () => db.query(`update public.savings_goal_contributions set amount_minor = 1 where goal_id = $1`, [mine])),
    ).rejects.toThrow(/permission denied/);
    // Nothing for signed-out visitors.
    await db.exec(`set role anon`);
    try {
      await expect(db.query(`select * from public.savings_goals`)).rejects.toThrow(/permission denied/);
      await expect(db.query(`select * from public.savings_goal_progress`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec(`reset role`);
    }
  });

  it("only links an account in the goal's own space", async () => {
    // A private account cannot back a shared goal, and a shared one cannot back a private goal.
    await expect(createGoal(TRYM, shared, { account_id: savings })).rejects.toThrow(/foreign key/);
    await expect(createGoal(TRYM, trymSpace, { account_id: jointSavings })).rejects.toThrow(/foreign key/);
    const ours = await createGoal(PARTNER, shared, { name: "Bufferkonto" });
    await expect(
      db.asUser(PARTNER, () => db.query(`update public.savings_goals set account_id = $1 where id = $2`, [savings, ours])),
    ).rejects.toThrow(/foreign key/);
    // The partner can link the joint account even though it came through Trym's bank.
    await db.asUser(PARTNER, () => db.query(`update public.savings_goals set account_id = $1 where id = $2`, [jointSavings, ours]));
  });
});

describe("savings goals: progress", () => {
  it("adds up contributions, including money taken out", async () => {
    const goal = await createGoal(TRYM, trymSpace, { name: "Buffer" });
    await db.asUser(TRYM, async () => {
      await db.query(`select public.add_goal_contribution($1, 100000, '2026-10-01', 'Start')`, [goal]);
      await db.query(`select public.add_goal_contribution($1, 50000)`, [goal]);
      await db.query(`select public.add_goal_contribution($1, -20000, null, '  ')`, [goal]);
    });
    const { rows } = await db.asUser(TRYM, () =>
      db.query<{ contributed_minor: string; contribution_count: number; account_growth_minor: string | null }>(
        `select contributed_minor, contribution_count, account_growth_minor from public.savings_goal_progress where goal_id = $1`,
        [goal],
      ),
    );
    expect(rows[0]).toEqual({ contributed_minor: 130_000, contribution_count: 3, account_growth_minor: null });
    const notes = await db.query<{ note: string | null; created_by: string }>(
      `select note, created_by from public.savings_goal_contributions where goal_id = $1 order by created_at, amount_minor`,
      [goal],
    );
    expect(notes.rows.every((r) => r.created_by === TRYM)).toBe(true);
    expect(notes.rows.map((r) => r.note).sort()).toEqual(["Start", null, null]);
    await expect(db.asUser(TRYM, () => db.query(`select public.add_goal_contribution($1, 0)`, [goal]))).rejects.toThrow(/check constraint/);
  });

  it("counts money into a linked account from the goal's start date, ignoring removed rows", async () => {
    const account = await createAccount(db, TRYM, "Sparekonto 2", false);
    await createTransaction(db, TRYM, account, 500_000, { date: "2026-09-20" }); // before the goal
    await createTransaction(db, TRYM, account, 300_000, { date: "2026-10-05" });
    await createTransaction(db, TRYM, account, -50_000, { date: "2026-10-20" });
    const gone = await createTransaction(db, TRYM, account, 999_900, { date: "2026-10-21", status: "pending" });
    await db.query(`update public.transactions set removed_at = now() where id = $1`, [gone]);
    await db.query(`update public.accounts set balance_minor = 750000, balance_at = now() where id = $1`, [account]);

    const goal = await createGoal(TRYM, trymSpace, { name: "Hytte", account_id: account, starts_on: "2026-10-01" });
    await db.asUser(TRYM, () => db.query(`select public.add_goal_contribution($1, 10000)`, [goal]));
    const { rows } = await db.asUser(TRYM, () =>
      db.query(
        `select contributed_minor, account_growth_minor, account_balance_minor, account_name from public.savings_goal_progress where goal_id = $1`,
        [goal],
      ),
    );
    expect(rows[0]).toEqual({ contributed_minor: 10_000, account_growth_minor: 250_000, account_balance_minor: 750_000, account_name: "Sparekonto 2" });
  });

  it("lets go of an account that moves to another space, keeping the goal private", async () => {
    const account = await createAccount(db, TRYM, "Flyttekonto", false);
    const goal = await createGoal(TRYM, trymSpace, { name: "Privat mål", account_id: account });
    await db.asUser(TRYM, () => db.transaction((t) => t.query(`select public.move_account_to_space($1, $2)`, [account, shared])));
    const { rows } = await db.query<{ space_id: string; account_id: string | null }>(
      `select space_id, account_id from public.savings_goals where id = $1`,
      [goal],
    );
    expect(rows[0]).toEqual({ space_id: trymSpace, account_id: null });
    expect(await db.asUser(PARTNER, () => count(`select 1 from public.savings_goals where id = $1`, [goal]))).toBe(0);
  });

  it("keeps the goal and its contributions when the linked account is deleted, and removes contributions with the goal", async () => {
    const account = await createAccount(db, TRYM, "Slettes", false);
    const goal = await createGoal(TRYM, trymSpace, { name: "Overlever", account_id: account });
    await db.asUser(TRYM, () => db.query(`select public.add_goal_contribution($1, 10000)`, [goal]));
    await db.query(`delete from public.accounts where id = $1`, [account]);
    expect(await count(`select 1 from public.savings_goals where id = $1 and account_id is null`, [goal])).toBe(1);
    await db.asUser(TRYM, () => db.query(`delete from public.savings_goals where id = $1`, [goal]));
    expect(await count(`select 1 from public.savings_goal_contributions where goal_id = $1`, [goal])).toBe(0);
  });

  it("rejects nonsense targets", async () => {
    await expect(createGoal(TRYM, trymSpace, { target_minor: 0 })).rejects.toThrow(/check constraint/);
    await expect(createGoal(TRYM, trymSpace, { name: "  " })).rejects.toThrow(/check constraint/);
    await expect(createGoal(TRYM, trymSpace, { starts_on: "2026-11-01", target_date: "2026-10-01" })).rejects.toThrow(/check constraint/);
    await expect(createGoal(TRYM, trymSpace, { account_basis: "guess" })).rejects.toThrow(/check constraint/);
  });
});
