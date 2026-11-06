import { describe, expect, it } from "vitest";
import { createDb, createUser, readMigration } from "./harness";

// Upgrading a database that already holds categorised transactions, the way the
// Supabase SQL editor runs a pasted migration: as one transaction.
const SPACES = "20261106000200_spaces.sql";
const USER = "00000000-0000-4000-8000-0000000019a1";

describe("spaces migration on existing data", () => {
  it("applies in one transaction and keeps every row in the owner's personal space", async () => {
    const db = await createDb(SPACES);
    await createUser(db, USER);
    await db.exec(`set request.jwt.claim.sub = '${USER}'; set role authenticated;`);
    await db.query(`select public.create_starter_categories()`);
    await db.exec(`reset role;`);
    const account = (
      await db.query<{ id: string }>(
        `insert into public.accounts (user_id, provider, name) values ($1, 'demo', 'Brukskonto') returning id`,
        [USER],
      )
    ).rows[0].id;
    const tx = (
      await db.query<{ id: string }>(
        `insert into public.transactions (user_id, account_id, fingerprint, status, effective_date, amount_minor, currency)
         values ($1, $2, 'fp', 'booked', '2026-10-01', -5000, 'NOK') returning id`,
        [USER, account],
      )
    ).rows[0].id;
    await db.exec(`set request.jwt.claim.sub = '${USER}'; set role authenticated;`);
    await db.query(`select public.categorize_transactions($1::uuid[], (select id from public.categories where name = 'Groceries'))`, [[tx]]);
    await db.exec(`reset role; reset request.jwt.claim.sub;`);

    await db.exec(`begin;\n${readMigration(SPACES)}\ncommit;`);

    const { rows } = await db.query<{ n: number }>(
      `select count(*)::int as n from public.transaction_allocations a
         join public.spaces s on s.id = a.space_id where s.personal_user_id = $1`,
      [USER],
    );
    expect(rows[0].n).toBe(1);
  });
});
