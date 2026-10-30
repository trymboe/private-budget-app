# Architecture

Rolig is a single-person budgeting app. It reads transactions from your bank,
asks you to categorise each one once (one tap, usually confirming a suggestion), and
compares spending to a monthly budget. It is built to be honest about what it does
not know: incomplete months, pending items, uncategorised spending and other
currencies are always called out rather than silently dropped.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | Next.js 16 App Router, React 19, TypeScript | Server components keep queries and secrets on the server; server actions for mutations. |
| UI | Tailwind 4, small in-repo primitives (shadcn style), Radix dialog/popover, Vaul drawer, Lucide, Recharts | Few dependencies, full control over the look. |
| Data | Supabase Postgres + Auth, row-level security | Free tier, RLS enforces per-user isolation even if app code has a bug. |
| Bank | Enable Banking (PSD2) | Covers Handelsbanken Norway, BankID at the bank, free personal mode. |
| Hosting | Vercel Hobby + daily cron | Free, native Next.js. |
| Tests | Vitest; PGlite runs the real migrations in-process | Database rules are tested without Docker. |

## Directory map

```
src/
  app/
    (auth)/            login, sign-up, password reset
    (app)/             signed-in screens: home, review, transactions, budget,
                       budget/categories, insights, settings/*, welcome
    actions/           server actions (transactions, budget, bank)
    api/bank/callback  bank redirect target: exchanges the code, stores the session
    api/bank/import    first import after choosing accounts (up to 300 s)
    api/cron/sync      daily sync of every connection
    auth/confirm       verifies email links
  components/          UI by area (home, transactions, budget, bank, insights, ui)
  lib/
    money.ts           integer øre arithmetic, parsing, formatting
    dates.ts           ISO date helpers, Oslo time zone, Monday weeks
    budget.ts          month summary, pace, performance, split validation
    merchant.ts        merchant normalisation for rules and display
    suggest.ts         category and transfer suggestions
    banking/           provider interface, Enable Banking client, demo bank,
                       normalisation, reconciliation, sync, secret encryption
    data/              server-side queries for each screen
    supabase/          server and admin clients
  proxy.ts             session refresh and sign-in redirect
supabase/migrations/   schema, integrity rules and functions, RLS
tests/db/              database tests on PGlite
```

## User journeys

1. **First run.** Sign up, confirm email, land on **Welcome**: connect a bank, set
   this month's budget from 12 starter categories (amounts editable, any can stay at
   zero), then categorise. Each step can be skipped and finished later.
2. **Connect a bank.** Pick the bank (Handelsbanken first) and how far back to
   import (3, 6, 12, 24 months or a date). The app explains that the bank decides
   how much history it shares. You approve with BankID at the bank, come back,
   choose which accounts to import and which count toward the budget (savings
   accounts default to "not counted"), and the first import starts immediately,
   while long history is still available.
3. **Daily check (the main loop).** Home shows where the month stands: spent vs
   budget, what is left per day for flexible spending, this week vs a steady pace,
   and categories that are close to or over budget. A prompt shows how many
   transactions wait for review.
4. **Review queue.** One transaction at a time, large type. The suggested category
   (from a learned merchant rule) is a single tap; the full category grid never
   reorders, so your thumb learns it. Transfer, Exclude, Split and Skip are one tap
   away. "Also apply to N more from this merchant" handles bulk. Every decision has Undo.
   Keyboard: 1–9, Enter, S.
5. **Transactions.** Search, filter by month, category, account, status, or "needs
   review"; tap any row to change category, split, treatment or add a note.
6. **Budget.** Set amounts per category per month. A new month is copied from the
   previous one when you first open it; past months are read-only unless you choose
   to edit. Categories can be created, renamed, recoloured, given an icon,
   reordered, archived and merged.
7. **Insights.** Finished months only: budget vs actual per month (diverging bars),
   category trends, this month's cumulative pace vs last month, and cash flow
   (money in vs out, including fixed costs and savings transfers) kept separate from
   budget variance. Incomplete months are marked and left out of averages.
8. **Consent renewal.** Bank access lasts up to 180 days. From 14 days before it
   ends, Home shows a quiet reminder; after it ends, history stays and syncing stops
   until you renew (same BankID flow; accounts are re-attached, nothing is
   duplicated).

## Data model

All tables have `user_id` and RLS `user_id = auth.uid()`. Composite foreign keys
`(id, user_id)` make it impossible to reference another user's row.

- `profiles`: time zone (default `Europe/Oslo`), onboarding state.
- `bank_connections`: one bank consent. `session_secret` is the Enable Banking
  session id, AES-256-GCM encrypted, and not readable by the browser role at all
  (column grants). Status, consent end, last sync, rate-limit backoff.
- `bank_auth_requests`: short-lived `state` values for the bank redirect (30 min,
  single use, bound to the user).
- `accounts`: one bank account. `provider_identity` (Enable Banking
  `identification_hash`) is stable across reconnects, so renewing re-attaches the
  same account. `include_in_budget`, `is_synced`, and the history bookkeeping
  (`history_requested_from`, `history_available_from`, `history_limited`,
  `initial_import_completed_at`).
- `categories`: expense or income, icon, colour, `is_fixed` (rent, subscriptions:
  excluded from the pace model), sort order, `archived_at`, `merged_into_id`.
- `monthly_budgets`: one amount per category per month (a snapshot, so changing
  next month never rewrites history).
- `categorization_rules`: learned merchant → category rules.
- `transactions`: bank-owned fields (amount, dates, status, counterparty,
  description, `provider_ref`, `fingerprint`, `bank_meta`) and user-owned fields
  (`treatment`, `needs_review`, `note`). Signed `amount_minor` (negative = money
  out). `removed_at` soft-deletes pending items the bank stopped returning.
- `transaction_allocations`: category assignment. One row normally, several for a
  split. A deferred constraint trigger guarantees allocations sum exactly to the
  transaction amount at commit.
- `sync_runs`: one row per sync with counts and an error code. A partial unique
  index allows only one running sync per account.

Views `monthly_category_totals` and `monthly_cash_flow` (security invoker, so RLS
applies) feed Home and Insights.

## Money

Amounts are integers in minor units (øre) everywhere: `bigint` in Postgres, `number`
in TypeScript, checked with `Number.isSafeInteger`. Bank amounts arrive as decimal
strings and are parsed without floating point (`parseDecimalToMinor` rejects more
than two decimals instead of rounding). Formatting uses `Intl.NumberFormat` for
`nb-NO`. Foreign-currency transactions keep their original amount; only the NOK
amount the bank booked counts toward totals, and the UI says so.

## Treatment: budget, transfer, excluded

Every transaction is one of:
- **budget**: counts toward categories and budgets (refunds reduce spending in
  their category).
- **transfer**: moving money between your own accounts. Never spending or income.
  The app suggests pairs (opposite amounts on two accounts within 3 days).
- **excluded**: you chose to ignore it (reimbursed work expense, one-off).

Changing treatment clears allocations in the database, so a transfer can never keep
a stale category. Accounts with "count toward budget" off are still synced and
listed, but left out of budget totals.

## Sync and reconciliation

Sync must be safe to run any number of times: running it twice in a row changes
nothing the second time.

1. **Guard.** Skip if consent is over or the bank rate-limited us; clear runs stuck
   for 15 minutes; take the per-account lock (unique index on running `sync_runs`).
2. **Window.** First import: from the requested history date. Afterwards: from
   10 days before the last sync, to catch late bookings and pending→booked changes.
3. **Fetch** every page (`continuation_key`). If the bank rejects the period, retry
   with `strategy=longest`. A deadline protects the 300 s function limit; an
   incomplete import is recorded and resumed next time.
4. **Normalise** (`normalize.ts`): sign from `credit_debit_indicator`, counterparty
   is the creditor for money out and the debtor for money in, booked/pending, a
   fingerprint hash from account, date, amount, currency and description, plus an
   occurrence index so two identical coffees on the same day stay two rows.
5. **Reconcile** (`reconcile.ts`, pure and unit tested) one-to-one, in this order:
   bank reference → fingerprint → pending-to-booked promotion (same amount within a
   few days, or same merchant with up to 25 % change for tips and fuel holds) →
   booked row with same amount, date and merchant. Unmatched rows are inserted;
   stored pending rows the bank no longer returns are soft-removed.
6. **Write** only bank-owned fields. Categories, notes and treatment are never in
   the update, so a sync cannot undo your work. If a booked amount differs from the
   pending one, a single category follows the new amount; a split is cleared and the
   transaction returns to review.
7. **Bookkeep**: earliest date actually received, whether the bank limited history,
   balance, last sync; release the lock.

Errors: consent problems mark the connection expired (the reminder appears);
rate limits back off 6 hours; anything else is recorded on the run and retried next
day. Logs contain ids and counts, never descriptions or amounts.

## Budgets, pace and partial months

- A month's budget is a snapshot. Opening a new month copies the previous month's
  amounts once (`ensure_month_budget`); "Copy from last month" can overwrite.
- **Pace** does not assume even spending. Fixed categories (rent, subscriptions)
  are taken out; the flexible remainder is compared with what is left of the month.
  Home shows "left per day" and this week (Monday start) against a steady weekly
  pace.
- **Partial months**: if the bank's earliest transaction is after the start of a
  month, or the first import has not finished, that month is marked partial
  everywhere, and Insights leaves it out of averages and cumulative variance. The
  running month is never judged in Insights.
- Uncategorised spending is shown separately ("not in these totals yet"), never
  silently added to "Other".

## Security

- Auth: Supabase email + password with email confirmation; `getClaims()` verifies
  the JWT on every server request; `proxy.ts` redirects signed-out users.
- RLS on every table, `revoke all` from `anon`, column-level grants for the browser
  role (it cannot write amounts, dates or bank fields, or read the bank session).
- Functions are `security invoker`, so they run with the caller's RLS.
- The secret key is used only in the bank callback, import, sync and cron, always
  filtered by the signed-in user's id.
- The bank session id is encrypted with a key that never reaches the database.
- Bank redirect `state` is random, single-use, expires in 30 minutes and is bound to
  the user who started it.
- Cron is protected by `CRON_SECRET` with a timing-safe comparison.
- Security headers: frame denial, nosniff, strict referrer, HSTS, permissions policy.

## Tests

`npm test` runs:
- Unit tests for money parsing and formatting, dates, merchant normalisation,
  month summary, pace, performance with partial months, splits, transfer pairing,
  and reconciliation: duplicates, identical same-day purchases, pending→booked with
  tip, cancelled pending, repeated sync, multiple accounts, refunds, missing
  merchant data, history boundaries.
- Database tests on PGlite with the real migrations: RLS isolation between users,
  denied writes to bank fields, hidden session secret, cross-user references,
  categorise + rule learning, split sums, amount changes after booking, transfer
  clearing allocations, budget copy across months, category merge, and view
  totals excluding transfers.

## Known limitations

- The Enable Banking integration and the deployed app have **not** been run
  against live services; see [ENABLE_BANKING.md](./ENABLE_BANKING.md#not-verified-yet).
- Vercel Hobby runs the cron once a day without retries. A missed day is caught up
  by the next run (the 10-day window) or by "Sync now".
- Totals are NOK only; other-currency accounts are listed but not converted.
- No offline mode or push notifications.
