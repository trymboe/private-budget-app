import { beforeAll, describe, expect, it } from "vitest";
import { createAccount, createDb, createUser, type Db } from "./harness";

// Balances live on the account row, so they must follow the account's space:
// a private balance is never visible to the partner, a shared one is, and only
// the server's sync can write them.
const OWNER = "00000000-0000-4000-8000-0000000ba1a1";
const PARTNER = "00000000-0000-4000-8000-0000000ba1a2";
const STRANGER = "00000000-0000-4000-8000-0000000ba1a3";

let db: Db;
let privateAccount: string;
let jointAccount: string;
let savings: string;

async function setBalance(accountId: string, minor: number, type = "CLBD", referenceDate: string | null = "2026-11-06") {
  await db.query(
    `update public.accounts
        set balance_minor = $2, balance_at = '2026-11-07T06:00:00Z', balance_type = $3, balance_reference_date = $4
      where id = $1`,
    [accountId, minor, type, referenceDate],
  );
}

beforeAll(async () => {
  db = await createDb();
  for (const u of [OWNER, PARTNER, STRANGER]) await createUser(db, u);
  const { rows } = await db.query<{ id: string }>(`select public.create_shared_space($1) as id`, [OWNER]);
  await db.query(`insert into public.space_members (space_id, user_id) values ($1, $2)`, [rows[0].id, PARTNER]);
  privateAccount = await createAccount(db, OWNER, "Brukskonto");
  savings = await createAccount(db, OWNER, "Sparekonto", false);
  jointAccount = await createAccount(db, OWNER, "Felleskonto", true, rows[0].id);
  await setBalance(privateAccount, 1_284_350);
  await setBalance(savings, 8_450_000, "ITAV", null);
  await setBalance(jointAccount, 2_000_000, "ITBD");
}, 60_000);

describe("account balances", () => {
  const balances = (user: string) =>
    db.asUser(user, async () =>
      (
        await db.query<{ name: string; balance_minor: string; balance_type: string; balance_reference_date: string | null }>(
          `select name, balance_minor::text, balance_type, balance_reference_date::text from public.accounts order by name`,
        )
      ).rows,
    );

  it("shows the owner every balance in their spaces, with what the bank said", async () => {
    expect(await balances(OWNER)).toEqual([
      { name: "Brukskonto", balance_minor: "1284350", balance_type: "CLBD", balance_reference_date: "2026-11-06" },
      { name: "Felleskonto", balance_minor: "2000000", balance_type: "ITBD", balance_reference_date: "2026-11-06" },
      { name: "Sparekonto", balance_minor: "8450000", balance_type: "ITAV", balance_reference_date: null },
    ]);
  });

  it("shows the partner only the shared account's balance, and a stranger nothing", async () => {
    expect((await balances(PARTNER)).map((r) => [r.name, r.balance_minor])).toEqual([["Felleskonto", "2000000"]]);
    expect(await balances(STRANGER)).toEqual([]);
  });

  it("does not let the browser write balances, not even on its own account", async () => {
    for (const column of ["balance_minor = 1", "balance_at = now()", "balance_type = 'XPCD'", "balance_reference_date = current_date"]) {
      await expect(
        db.asUser(OWNER, () => db.query(`update public.accounts set ${column} where id = $1`, [privateAccount])),
      ).rejects.toThrow(/permission denied/);
    }
    const { rows } = await db.query<{ balance_minor: string }>(`select balance_minor::text from public.accounts where id = $1`, [
      privateAccount,
    ]);
    expect(rows[0].balance_minor).toBe("1284350");
  });

  it("requires a read time for every balance and a well-formed balance type", async () => {
    await expect(db.query(`update public.accounts set balance_at = null where id = $1`, [privateAccount])).rejects.toThrow(
      /accounts_balance_read_at/,
    );
    await expect(db.query(`update public.accounts set balance_type = 'booked' where id = $1`, [privateAccount])).rejects.toThrow(
      /check constraint/,
    );
    // An account that has never had a balance read is fine.
    const fresh = await createAccount(db, OWNER, "Ny konto");
    const { rows } = await db.query<{ balance_minor: string | null; balance_at: string | null }>(
      `select balance_minor, balance_at from public.accounts where id = $1`,
      [fresh],
    );
    expect(rows[0]).toEqual({ balance_minor: null, balance_at: null });
  });
});
