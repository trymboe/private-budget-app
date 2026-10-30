-- Row Level Security and privileges.
--
-- Model: the browser (anon/authenticated roles via the publishable key) can only
-- ever see and change the signed-in user's own rows, and only the columns it
-- needs. Bank data is written exclusively by server code using the secret key
-- (service_role, which bypasses RLS) after it has authenticated the user itself.

-- Start from zero: Supabase grants broad table privileges by default.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.bank_connections enable row level security;
alter table public.bank_auth_requests enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.monthly_budgets enable row level security;
alter table public.categorization_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_allocations enable row level security;
alter table public.sync_runs enable row level security;

-- profiles --------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, currency, locale, time_zone,
              onboarding_bank_at, onboarding_budget_at, onboarding_completed_at)
  on public.profiles to authenticated;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- bank_connections: readable without the encrypted session column -------------
grant select (id, user_id, provider, institution_name, institution_country, status,
              consent_valid_until, last_synced_at, last_sync_error, rate_limited_until,
              created_at, updated_at)
  on public.bank_connections to authenticated;
create policy bank_connections_select on public.bank_connections for select to authenticated
  using (user_id = (select auth.uid()));

-- bank_auth_requests: server only (RLS on, no policies, no grants) -------------

-- accounts: read; user may toggle sync/budget inclusion and rename -------------
grant select on public.accounts to authenticated;
grant update (name, is_synced, include_in_budget) on public.accounts to authenticated;
create policy accounts_select on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy accounts_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- categories: full ownership ----------------------------------------------------
grant select, insert, delete on public.categories to authenticated;
grant update (name, icon, color, is_fixed, sort_order, archived_at, merged_into_id) on public.categories to authenticated;
create policy categories_all on public.categories for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- monthly_budgets ----------------------------------------------------------------
grant select, insert, delete on public.monthly_budgets to authenticated;
grant update (amount_minor) on public.monthly_budgets to authenticated;
create policy monthly_budgets_all on public.monthly_budgets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- categorization_rules -------------------------------------------------------------
grant select, insert, delete on public.categorization_rules to authenticated;
grant update (category_id, confirmations, last_confirmed_at) on public.categorization_rules to authenticated;
create policy categorization_rules_all on public.categorization_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- transactions: bank fields are read-only for users -------------------------------
grant select on public.transactions to authenticated;
grant update (treatment, needs_review, note, reviewed_at,
              suggested_category_id, suggested_treatment, suggestion_reason)
  on public.transactions to authenticated;
create policy transactions_select on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- transaction_allocations --------------------------------------------------------
grant select, insert, delete on public.transaction_allocations to authenticated;
grant update (amount_minor, category_id) on public.transaction_allocations to authenticated;
create policy transaction_allocations_all on public.transaction_allocations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- sync_runs: read-only history ----------------------------------------------------
grant select on public.sync_runs to authenticated;
create policy sync_runs_select on public.sync_runs for select to authenticated
  using (user_id = (select auth.uid()));

-- views ---------------------------------------------------------------------------
grant select on public.monthly_category_totals to authenticated;
grant select on public.monthly_cash_flow to authenticated;

-- RPCs (security invoker; RLS still applies inside) ----------------------------------
grant execute on function public.categorize_transactions(uuid[], uuid, boolean) to authenticated;
grant execute on function public.set_transaction_split(uuid, jsonb) to authenticated;
grant execute on function public.set_transaction_treatment(uuid[], public.transaction_treatment) to authenticated;
grant execute on function public.reset_transaction_review(uuid[]) to authenticated;
grant execute on function public.learn_merchant_rule(text, uuid) to authenticated;
grant execute on function public.merge_categories(uuid, uuid) to authenticated;
grant execute on function public.create_starter_categories() to authenticated;
grant execute on function public.copy_month_budget(date, date, boolean) to authenticated;
grant execute on function public.ensure_month_budget(date) to authenticated;

-- Trigger functions run as table owner context; no direct execute needed.
-- service_role keeps Supabase's default full access for server-side sync code.
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
