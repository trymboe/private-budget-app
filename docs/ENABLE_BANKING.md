# Enable Banking

[Enable Banking](https://enablebanking.com) is a licensed PSD2 aggregator. The app
never sees bank credentials: you approve read-only access at your bank (BankID for
Handelsbanken Norway), and Enable Banking hands the app a session id that can read
balances and transactions until the consent ends.

Setup steps are in [SETUP.md](./SETUP.md#3-enable-banking-you-with-bankid). This file
records what the code assumes about the API, and how sure we are of each point.

## Verified against the documentation (2026-10-30)

These come from Enable Banking's public API reference and guides, read while
building. **None of it has been exercised against the live API yet**: there were no
credentials in the build environment.

- Base URL `https://api.enablebanking.com`.
- Every request carries `Authorization: Bearer <JWT>`. The JWT is RS256, header
  `kid` = application id, claims `iss: "enablebanking.com"`,
  `aud: "api.enablebanking.com"`, `iat`, `exp`, lifetime at most 24 hours. The app
  signs a 1 hour token and caches it (`src/lib/banking/enable-banking.ts`).
- `GET /aspsps?country=NO&psu_type=personal` lists banks, including
  `maximum_consent_validity` in seconds.
- `POST /auth` with `access.valid_until`, `aspsp {name, country}`, `state`,
  `redirect_url`, `psu_type` returns a `url` to send the user to. The redirect URL
  must be registered on the application.
- The bank redirects back to `/api/bank/callback?code=…&state=…` (or `error=…`).
- `POST /sessions {code}` returns `session_id`, `access.valid_until` and
  `accounts[]` with `uid`, `identification_hash`, `account_id.iban`, `name`,
  `currency`.
- `GET /accounts/{uid}/transactions?date_from&date_to&continuation_key` pages until
  `continuation_key` is empty. `strategy=longest` asks for the longest history the
  bank offers. Fields used: `entry_reference`, `transaction_amount {amount, currency}`
  (amount is a positive decimal string), `credit_debit_indicator` (`CRDT`/`DBIT`),
  `status` (`BOOK`/`PDNG`), `booking_date`, `value_date`, `transaction_date`,
  `creditor.name`, `debtor.name`, `remittance_information[]`,
  `merchant_category_code`, `bank_transaction_code`, `exchange_rate`.
- `GET /accounts/{uid}/balances`; the app prefers the `CLBD` (closing booked) balance.
- `DELETE /sessions/{id}` revokes access when you disconnect.
- Errors that matter: `EXPIRED_SESSION` (consent over: the connection is marked
  expired and you are asked to renew), `ASPSP_RATE_LIMIT_EXCEEDED` (HTTP 429; the app
  backs off for 6 hours), `WRONG_TRANSACTIONS_PERIOD` (the app retries with
  `strategy=longest`).
- Restricted mode: a production application can be activated for free by linking
  your own accounts in the Control Panel. It can then only access those accounts.

## Not verified yet

- **The exact ASPSP name for Handelsbanken Norway** and its maximum consent length.
  The connect screen lists whatever `/aspsps?country=NO` returns and puts anything
  matching "Handelsbanken" first, so no name is hard-coded.
- **How much history Handelsbanken returns.** Many banks give 12 months or more,
  some only 90 days, and long history is often only available during the first hour
  after consent. The first import therefore runs right after you choose accounts,
  and the app records what it actually received (`history_available_from`) and
  marks earlier months as incomplete instead of showing them as low spending.
- **Background fetch limits.** PSD2 allows banks to limit unattended access to about
  4 fetches per account per day. The app syncs once a day by cron, plus a manual
  "Sync now" with a 60 minute cooldown, which should stay well within that.
- Whether `entry_reference` is stable for Handelsbanken between pending and booked.
  Reconciliation does not depend on it (see [ARCHITECTURE.md](./ARCHITECTURE.md#sync-and-reconciliation)).

## First live test, step by step

1. Connect Handelsbanken with a 3 month import and only the checking account.
2. On **Banks & accounts**, check the history date and the balance against the
   bank's own app.
3. Pick a few transactions in **Transactions** and compare amount, date and sign
   with the bank. Check that a card purchase that is still pending shows "Pending".
4. Press **Sync now** the next day and confirm nothing duplicated: the count of
   transactions for the previous days should not change, and pending items should
   have become booked rather than appearing twice.
5. If anything looks off, the `sync_runs` table has one row per run with counts and
   an error code (never transaction content).
