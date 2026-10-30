// Runs the real migrations inside PGlite (Postgres compiled to WASM) with a minimal
// stand-in for the parts of Supabase the schema depends on: the `auth` schema,
// `auth.uid()`, and the anon/authenticated/service_role roles. Lets us test
// constraints, triggers, RPCs and RLS without Docker or a Supabase project.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`;

export type Db = PGlite & {
  /** Run `fn` as the given user through the `authenticated` role (RLS applies). */
  asUser<T>(userId: string, fn: () => Promise<T>): Promise<T>;
};

export async function createDb(): Promise<Db> {
  const db = (await PGlite.create()) as Db;
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  db.asUser = async (userId, fn) => {
    await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role; reset request.jwt.claim.sub;`);
    }
  };
  return db;
}

export async function createUser(db: PGlite, id: string) {
  await db.query(`insert into auth.users (id, email) values ($1, $2)`, [id, `${id.slice(0, 8)}@test.local`]);
}

export async function createAccount(db: PGlite, userId: string, name = "Brukskonto", includeInBudget = true) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.accounts (user_id, provider, name, include_in_budget)
     values ($1, 'demo', $2, $3) returning id`,
    [userId, name, includeInBudget],
  );
  return rows[0].id;
}

let seq = 0;
export async function createTransaction(
  db: PGlite,
  userId: string,
  accountId: string,
  amountMinor: number,
  opts: { date?: string; merchantKey?: string; status?: "booked" | "pending" } = {},
) {
  seq += 1;
  const date = opts.date ?? "2026-10-15";
  const { rows } = await db.query<{ id: string }>(
    `insert into public.transactions
       (user_id, account_id, fingerprint, status, booking_date, effective_date, amount_minor, currency, merchant_key)
     values ($1, $2, $3, $4, $5, $5, $6, 'NOK', $7) returning id`,
    [userId, accountId, `fp-${seq}`, opts.status ?? "booked", date, amountMinor, opts.merchantKey ?? null],
  );
  return rows[0].id;
}
