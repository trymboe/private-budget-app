# Rolig

A calm, mobile-first personal budgeting app. It reads your transactions from the
bank (Handelsbanken Norway first, through Enable Banking and BankID), lets you
categorise each one with a single tap, and shows where the month stands against
your budget, without pretending to know more than the bank told it.

- **Home**: this month's position, what is left per day for flexible spending,
  this week vs a steady pace, categories close to or over budget.
- **Review**: one transaction at a time, suggested category one tap away, bulk
  apply per merchant, transfers, exclusions, splits that sum exactly, and Undo.
- **Transactions**: search, filters, infinite scroll, edit anything.
- **Budget**: monthly snapshots copied forward, custom categories (rename, icon,
  colour, reorder, archive, merge).
- **Insights**: budget vs actual over finished months, category trends, pace vs
  last month, cash flow kept separate; incomplete months are marked.
- **Banks & accounts**: consent reminders 14 days ahead, one-tap renew, per-account
  "count toward budget".

Stack: Next.js 16 (App Router), TypeScript, Tailwind 4, Supabase (Postgres, Auth,
row-level security), Enable Banking, Vercel with a daily cron. Everything fits in
free tiers.

## Quick start

```bash
npm install
npm test                  # unit + database tests, no services needed
cp .env.example .env.local
npm run dev
```

The app needs a Supabase project to run; `ENABLE_DEMO_BANK=true` gives you a
clearly labelled fake bank with a year of transactions for trying it out.

## Docs

- [Setup](docs/SETUP.md): Supabase, Vercel and Enable Banking, step by step,
  environment variables, cron, demo data.
- [Architecture](docs/ARCHITECTURE.md): user journeys, data model, money handling,
  sync and reconciliation, security, tests, limitations.
- [Enable Banking](docs/ENABLE_BANKING.md): API facts the code relies on, what is
  verified and what is not, a first live test checklist.
- [Design](docs/DESIGN.md): design direction, tokens, chart choices.

## Scripts

| Command | |
| --- | --- |
| `npm run dev` | dev server on :3000 |
| `npm run build` / `npm start` | production build and server |
| `npm test` | Vitest: unit tests and PGlite database tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Status

Built and tested locally: 61 automated tests, type check, lint and production
build pass, and every screen was reviewed at phone and desktop sizes with sample
data. **Not yet verified against live services**: the Enable Banking API, a real
Supabase project and the Vercel deployment. See
[ENABLE_BANKING.md](docs/ENABLE_BANKING.md#first-live-test-step-by-step) for the
first live test.
