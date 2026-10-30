-- Core schema for the budgeting app.
--
-- Conventions
--   * Every user-owned row carries user_id and is isolated with RLS.
--   * Money is stored as bigint minor units (øre for NOK). Never numeric/float.
--   * Signed amounts: negative = money leaving the account, positive = money arriving.
--   * Calendar dates that come from the bank are stored as `date` (the bank's local
--     booking date). Instants are `timestamptz` (UTC).
--   * Child tables reference parents through (id, user_id) composite keys so a row can
--     never point at another user's parent, even through a buggy server path.


-- ---------------------------------------------------------------------------
-- Profiles & preferences
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  currency char(3) not null default 'NOK' check (currency ~ '^[A-Z]{3}$'),
  locale text not null default 'nb-NO' check (char_length(locale) <= 16),
  time_zone text not null default 'Europe/Oslo' check (char_length(time_zone) <= 64),
  -- Onboarding is progressive: each step is stamped when done, nothing blocks the app.
  onboarding_bank_at timestamptz,
  onboarding_budget_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bank connections (one consent/session at one bank)
-- ---------------------------------------------------------------------------

create type public.connection_status as enum ('active', 'expired', 'revoked', 'error');

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('enable_banking', 'demo')),
  institution_name text not null check (char_length(institution_name) <= 200),
  institution_country char(2) not null check (institution_country ~ '^[A-Z]{2}$'),
  -- Provider session reference, AES-256-GCM encrypted by the server. Never readable
  -- by the browser: column privileges for `authenticated` exclude it (see below).
  session_secret text,
  status public.connection_status not null default 'active',
  consent_valid_until timestamptz,
  last_synced_at timestamptz,
  last_sync_error text check (char_length(last_sync_error) <= 500),
  rate_limited_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index bank_connections_user_idx on public.bank_connections (user_id);
create index bank_connections_active_idx on public.bank_connections (status) where status = 'active';

-- Short-lived state for the bank redirect flow (CSRF protection + carrying the user's
-- chosen import date across the redirect). Server-only table: no RLS policies.
create table public.bank_auth_requests (
  state text primary key check (char_length(state) between 32 and 128),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('enable_banking', 'demo')),
  institution_name text not null,
  institution_country char(2) not null,
  history_from date not null,
  -- Set when this flow re-authorises an existing connection.
  reconnect_connection_id uuid references public.bank_connections (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  consumed_at timestamptz
);

create index bank_auth_requests_user_idx on public.bank_auth_requests (user_id);

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid,
  provider text not null check (provider in ('enable_banking', 'demo', 'manual')),
  -- Session-scoped account id used for API calls; changes on every reconnect.
  provider_account_uid text,
  -- Stable identity across sessions (Enable Banking `identification_hash`).
  provider_identity text,
  name text not null check (char_length(name) between 1 and 120),
  iban_masked text check (char_length(iban_masked) <= 40),
  currency char(3) not null default 'NOK' check (currency ~ '^[A-Z]{3}$'),
  -- Synced: user chose to import this account. Include in budget: its transactions
  -- count towards budgets/insights (e.g. a savings account usually does not).
  is_synced boolean not null default true,
  include_in_budget boolean not null default true,
  -- History bookkeeping, used to flag partial months honestly.
  history_requested_from date,
  history_available_from date,
  history_limited boolean not null default false,
  initial_import_completed_at timestamptz,
  last_synced_at timestamptz,
  balance_minor bigint,
  balance_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (connection_id, user_id) references public.bank_connections (id, user_id) on delete set null (connection_id)
);

create unique index accounts_identity_uidx on public.accounts (user_id, provider, provider_identity)
  where provider_identity is not null;
create index accounts_user_idx on public.accounts (user_id);
create index accounts_connection_idx on public.accounts (connection_id);

-- ---------------------------------------------------------------------------
-- Categories, budgets, rules
-- ---------------------------------------------------------------------------

create type public.category_kind as enum ('expense', 'income');

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind public.category_kind not null default 'expense',
  icon text not null default 'circle' check (icon ~ '^[a-z0-9-]{1,40}$'),
  color text not null default 'stone' check (color in
    ('stone', 'pine', 'moss', 'ochre', 'clay', 'brick', 'plum', 'slate', 'sky', 'sand')),
  -- Fixed costs (rent, subscriptions) are excluded from daily-pace projections.
  is_fixed boolean not null default false,
  sort_order integer not null default 0,
  archived_at timestamptz,
  merged_into_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (merged_into_id, user_id) references public.categories (id, user_id)
);

create unique index categories_active_name_uidx on public.categories (user_id, lower(btrim(name)))
  where archived_at is null;
create index categories_user_idx on public.categories (user_id, sort_order);

-- One row per (category, month). A month's budget is a snapshot: editing October
-- never changes September. Months are stored as the first day of the month.
create table public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid not null,
  month date not null check (extract(day from month) = 1),
  amount_minor bigint not null check (amount_minor >= 0 and amount_minor < 100000000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, month),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

create index monthly_budgets_month_idx on public.monthly_budgets (user_id, month);

-- Learned merchant -> category rules. Suggestions only; never auto-confirmed.
create table public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_key text not null check (char_length(merchant_key) between 1 and 120),
  category_id uuid not null,
  confirmations integer not null default 1 check (confirmations >= 0),
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, merchant_key),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Transactions & allocations
-- ---------------------------------------------------------------------------

create type public.transaction_status as enum ('booked', 'pending');
-- budget: counts via allocations. transfer: movement between own accounts.
-- excluded: user chose to ignore it (e.g. reimbursed work expense).
create type public.transaction_treatment as enum ('budget', 'transfer', 'excluded');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  -- Reconciliation keys. provider_ref = bank entry_reference (booked only).
  -- fingerprint = hash of descriptive fields + occurrence index (fallback).
  provider_ref text check (char_length(provider_ref) <= 200),
  fingerprint text not null check (char_length(fingerprint) <= 200),
  status public.transaction_status not null,
  booking_date date,
  value_date date,
  transaction_date date,
  -- The date used for months/weeks: booking date, else transaction/value date.
  effective_date date not null,
  amount_minor bigint not null check (amount_minor <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  -- Foreign-currency purchases: original amount as reported by the bank.
  original_amount_minor bigint,
  original_currency char(3) check (original_currency ~ '^[A-Z]{3}$'),
  counterparty text check (char_length(counterparty) <= 300),
  description text check (char_length(description) <= 1000),
  merchant_key text check (char_length(merchant_key) <= 120),
  merchant_category_code text check (char_length(merchant_category_code) <= 8),
  -- Trimmed bank-native metadata kept for reconciliation/debugging.
  bank_meta jsonb not null default '{}'::jsonb,
  -- User-owned fields. Sync never writes these.
  treatment public.transaction_treatment not null default 'budget',
  needs_review boolean not null default true,
  note text check (char_length(note) <= 1000),
  -- Suggestion (distinct from confirmed allocations).
  suggested_category_id uuid,
  suggested_treatment public.transaction_treatment,
  suggestion_reason text check (suggestion_reason in ('merchant_rule', 'transfer_match', 'income_pattern')),
  reviewed_at timestamptz,
  -- Pending rows the bank stopped returning are soft-removed, never hard deleted
  -- while they carry user data.
  removed_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  foreign key (suggested_category_id, user_id) references public.categories (id, user_id) on delete set null (suggested_category_id),
  check (original_amount_minor is null or original_currency is not null)
);

create unique index transactions_provider_ref_uidx on public.transactions (account_id, provider_ref)
  where provider_ref is not null;
create unique index transactions_fingerprint_uidx on public.transactions (account_id, fingerprint);
create index transactions_user_date_idx on public.transactions (user_id, effective_date desc, id desc);
create index transactions_review_idx on public.transactions (user_id, effective_date desc)
  where needs_review and removed_at is null;
create index transactions_account_date_idx on public.transactions (account_id, effective_date);
create index transactions_merchant_idx on public.transactions (user_id, merchant_key);

create table public.transaction_allocations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null,
  category_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0),
  created_at timestamptz not null default now(),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id),
  unique (transaction_id, category_id)
);

create index transaction_allocations_tx_idx on public.transaction_allocations (transaction_id);
create index transaction_allocations_category_idx on public.transaction_allocations (user_id, category_id);

-- ---------------------------------------------------------------------------
-- Synchronisation runs (job log + concurrency lock)
-- ---------------------------------------------------------------------------

create type public.sync_trigger as enum ('initial', 'scheduled', 'manual');
create type public.sync_status as enum ('running', 'succeeded', 'partial', 'failed');

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null,
  account_id uuid,
  trigger public.sync_trigger not null,
  status public.sync_status not null default 'running',
  date_from date,
  date_to date,
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  removed_count integer not null default 0,
  -- Error code only (e.g. EXPIRED_SESSION). Never raw bank payloads.
  error_code text check (char_length(error_code) <= 80),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  foreign key (connection_id, user_id) references public.bank_connections (id, user_id) on delete cascade
);

-- At most one running sync per connection: concurrent cron/manual runs collide here.
create unique index sync_runs_one_running_uidx on public.sync_runs (connection_id) where status = 'running';
create index sync_runs_user_idx on public.sync_runs (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger bank_connections_touch before update on public.bank_connections for each row execute function public.touch_updated_at();
create trigger accounts_touch before update on public.accounts for each row execute function public.touch_updated_at();
create trigger categories_touch before update on public.categories for each row execute function public.touch_updated_at();
create trigger monthly_budgets_touch before update on public.monthly_budgets for each row execute function public.touch_updated_at();
create trigger transactions_touch before update on public.transactions for each row execute function public.touch_updated_at();

-- Create the profile row when someone signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
