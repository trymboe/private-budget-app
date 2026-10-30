# Setup

Everything here runs on free tiers: Supabase Free, Vercel Hobby and Enable Banking's
restricted (personal) mode. Allow about 30 minutes. Steps marked **you** need your own
accounts, BankID or browser; nothing in this repo can do them for you.

Order matters a little: Supabase first (the app cannot start without it), then
Vercel (so you have the final URL), then Enable Banking (it needs that URL as a
redirect).

## 0. Local prerequisites

- Node 22 or newer, npm.
- `npm install`
- `npm test` should pass without any services: database tests run the real
  migrations in an in-process Postgres (PGlite).

## 1. Supabase (you)

1. Create a project at <https://supabase.com/dashboard>. Region: Stockholm
   (`eu-north-1`) or Frankfurt keeps data in the EU. Save the database password.
2. Apply the migrations from this repo:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates the tables, row-level security, functions and views in
   `supabase/migrations/`. Re-run `db push` whenever new migrations land.
3. **Project Settings → API Keys**: copy the URL, the publishable key
   (`sb_publishable_…`) and a secret key (`sb_secret_…`). If your project only shows
   legacy `anon`/`service_role` keys, those work in the same variables.
4. **Authentication → URL Configuration**
   - Site URL: your production URL, for example `https://maate.vercel.app`.
   - Redirect URLs: add `https://maate.vercel.app/**` and
     `http://localhost:3000/**`.
5. **Authentication → Emails → Templates**. The app verifies email links on the
   server (`/auth/confirm`), so two templates need their link changed:
   - *Confirm signup*:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/welcome`
   - *Reset password*:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/settings/password`
6. **Authentication → Sign In / Providers → Email**: keep email confirmation on.
   Once your own account exists, turn **Allow new users to sign up** off; this is a
   single-person app and nobody else needs an account.
7. The built-in email sender is rate limited to a few emails per hour. That is
   enough for one person; add custom SMTP later only if it gets in the way.

Free-tier notes: the database is 500 MB (years of transactions for one person) and
projects are **paused after a week without activity**. The daily sync cron calls the
database every day, which should count as activity, but this has not been
observed over a full week yet. If the project does pause, restore it from the
dashboard; no data is lost.

## 2. Vercel (you)

1. Import the GitHub repo at <https://vercel.com/new>. Framework: Next.js, defaults
   are fine.
2. **Settings → Environment Variables** (Production, and Preview if you use it). All
   names and formats are in [`.env.example`](../.env.example):

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | from step 1.3 |
   | `SUPABASE_PUBLISHABLE_KEY` | from step 1.3 (Sensitive is fine) |
   | `SUPABASE_SECRET_KEY` | from step 1.3 (mark as Sensitive) |
   | `APP_URL` | `https://maate.vercel.app`, no trailing slash |
   | `BANK_TOKEN_ENCRYPTION_KEY` | `openssl rand -base64 32` (Sensitive) |
   | `CRON_SECRET` | `openssl rand -hex 32` (Sensitive) |
   | `ENABLE_BANKING_APP_ID` | from step 3 |
   | `ENABLE_BANKING_PRIVATE_KEY` | from step 3 (Sensitive) |

   Do not set `ENABLE_DEMO_BANK` in production.
3. Deploy. `vercel.json` registers one cron job, `/api/cron/sync` at 04:00 UTC daily.
   On Hobby, Vercel runs it once a day somewhere within that hour, without retries,
   and sends `CRON_SECRET` as a bearer token. Check **Settings → Cron Jobs** after
   the first deploy.
4. Sign up in the app with your email, confirm it, then turn sign-ups off (step 1.6).

## 3. Enable Banking (you, with BankID)

Details and the API facts the code relies on are in
[ENABLE_BANKING.md](./ENABLE_BANKING.md).

1. Create an account at <https://enablebanking.com> and open the Control Panel.
2. **Applications → Add application**, environment **Production**.
   - Redirect URL: `https://maate.vercel.app/api/bank/callback`. Add
     `http://localhost:3000/api/bank/callback` too if you want to connect from local
     development.
   - Let the control panel generate the key in the browser; it downloads a `.pem`
     private key. Keep it safe: it is the only copy.
3. Copy the application ID into `ENABLE_BANKING_APP_ID`.
4. Put the private key into `ENABLE_BANKING_PRIVATE_KEY`. Easiest is base64:
   `base64 -w0 < your-key.pem` (macOS: `base64 -i your-key.pem`). A PEM with literal
   `\n` escapes on one line also works.
5. A new production application starts in restricted mode. Activate it by linking
   your own accounts in the control panel (it walks you through the bank login).
   In restricted mode the application can only read the accounts you linked there,
   which is exactly what a personal app needs, and it is free.
6. Redeploy on Vercel so the new variables are picked up, then in the app go to
   **Settings → Banks & accounts → Connect a bank**, pick Handelsbanken, and approve
   with BankID.

## 4. Local development

```bash
cp .env.example .env.local     # fill in the Supabase values and APP_URL=http://localhost:3000
npm run dev
```

You can point local development at the same Supabase project, or run a local one
with `npx supabase start` (needs Docker) and use the keys it prints.

### Demo data

Set `ENABLE_DEMO_BANK=true` to add **Demo Bank (not real)** to the bank list. It
skips the bank redirect and generates about a year of realistic, deterministic
transactions for a checking and a savings account: rent, salary on the 25th,
transfers to savings, groceries, a refund, a purchase in EUR, and pending items.
Demo transactions are labelled "Demo data" everywhere, and the accounts have
`provider = 'demo'`, so they never mix silently with real data.
`supabase/dev/remove_demo_data.sql` deletes them. Prefer a separate Supabase project
or user for demo data, and never enable it in production.

## 5. Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build      # needs the Supabase variables set
```

## Trying the cron by hand

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://maate.vercel.app/api/cron/sync
```

It returns counts only (connections synced, failed, skipped), never transaction
data.
