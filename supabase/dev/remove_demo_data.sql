-- Removes everything created by the demo bank (ENABLE_DEMO_BANK=true).
-- Run in the Supabase SQL editor, or: psql "$DATABASE_URL" -f supabase/dev/remove_demo_data.sql
-- Transactions and their allocations cascade from accounts. Categories, budgets and
-- learned merchant rules are kept, since you may have shaped them while testing.
begin;
delete from public.accounts where provider = 'demo';
delete from public.bank_connections where provider = 'demo';
commit;
