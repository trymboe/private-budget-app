-- Spaces: private and shared budgets.
--
-- Every user has a personal space that only they can see. Two people can also share
-- a "shared" space (a household), which both are members of. Accounts,
-- transactions, categories, budgets and merchant rules each belong to exactly one
-- space, and RLS grants access by space membership instead of by user_id.
--
--   * Bank connections stay personal: the person who approved with BankID owns
--     them. Each account of a connection is put in a space by its owner, so a
--     joint bank account can be shared while the rest stay private.
--   * accounts.user_id and transactions.user_id still say whose bank the data
--     came from. Only that person can rename an account, change its sync options or
--     move it to another space.
--   * Categories, budgets, rules and allocations lose user_id. They belong to the
--     space, so both members of a shared space work with the same ones.
--   * Composite foreign keys (x, space_id) make cross-space references impossible,
--     the same way (x, user_id) made cross-user references impossible before.
--   * Membership is changed only by the server (service role), never by the browser.

-- ---------------------------------------------------------------------------
-- Spaces and membership
-- ---------------------------------------------------------------------------

create type public.space_kind as enum ('personal', 'shared');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind public.space_kind not null,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  -- Set for personal spaces only: the one person it belongs to.
  personal_user_id uuid unique references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'personal') = (personal_user_id is not null))
);

create table public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index space_members_user_idx on public.space_members (user_id);

create trigger spaces_touch before update on public.spaces for each row execute function public.touch_updated_at();

-- A personal space has exactly its own person as member. A person can be in at
-- most one shared space, and a shared space holds at most two people.
create function public.check_space_member() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_space public.spaces;
begin
  select * into v_space from public.spaces where id = new.space_id;
  if v_space.kind = 'personal' and new.user_id is distinct from v_space.personal_user_id then
    raise exception 'A personal space belongs to one person only' using errcode = '42501';
  end if;
  if v_space.kind = 'shared' then
    if exists (select 1 from public.space_members m join public.spaces s on s.id = m.space_id
                where m.user_id = new.user_id and s.kind = 'shared' and s.id <> new.space_id) then
      raise exception 'Already a member of another shared space' using errcode = '23505';
    end if;
    if (select count(*) from public.space_members where space_id = new.space_id) >= 2 then
      raise exception 'A shared space has room for two people' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger space_members_check before insert on public.space_members
  for each row execute function public.check_space_member();

-- The spaces the signed-in user belongs to. SECURITY DEFINER so policies can use it
-- without recursing into space_members' own RLS; it only ever returns the
-- caller's memberships.
create function public.my_space_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.space_id from public.space_members m where m.user_id = (select auth.uid())
$$;

-- Personal spaces for everyone who already exists.
insert into public.spaces (kind, name, personal_user_id)
select 'personal', 'Personal', u.id from auth.users u
on conflict (personal_user_id) do nothing;
insert into public.space_members (space_id, user_id, role)
select s.id, s.personal_user_id, 'owner' from public.spaces s where s.kind = 'personal'
on conflict do nothing;

-- New users get their personal space together with their profile.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_space uuid;
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.spaces (kind, name, personal_user_id) values ('personal', 'Personal', new.id)
  on conflict (personal_user_id) do nothing
  returning id into v_space;
  if v_space is not null then
    insert into public.space_members (space_id, user_id, role) values (v_space, new.id, 'owner');
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- space_id on every space-owned table, backfilled to the owner's personal space
-- ---------------------------------------------------------------------------

alter table public.accounts add column space_id uuid;
alter table public.categories add column space_id uuid;
alter table public.monthly_budgets add column space_id uuid;
alter table public.categorization_rules add column space_id uuid;
alter table public.transactions add column space_id uuid;
alter table public.transaction_allocations add column space_id uuid;

update public.accounts x set space_id = s.id from public.spaces s where s.personal_user_id = x.user_id;
update public.categories x set space_id = s.id from public.spaces s where s.personal_user_id = x.user_id;
update public.monthly_budgets x set space_id = s.id from public.spaces s where s.personal_user_id = x.user_id;
update public.categorization_rules x set space_id = s.id from public.spaces s where s.personal_user_id = x.user_id;
update public.transactions x set space_id = a.space_id from public.accounts a where a.id = x.account_id;
update public.transaction_allocations x set space_id = t.space_id from public.transactions t where t.id = x.transaction_id;

-- Old policies refer to user_id; they are replaced below.
drop policy accounts_select on public.accounts;
drop policy accounts_update on public.accounts;
drop policy categories_all on public.categories;
drop policy monthly_budgets_all on public.monthly_budgets;
drop policy categorization_rules_all on public.categorization_rules;
drop policy transactions_select on public.transactions;
drop policy transactions_update on public.transactions;
drop policy transaction_allocations_all on public.transaction_allocations;
drop policy bank_connections_select on public.bank_connections;
drop policy profiles_select on public.profiles;

-- The views depend on transactions/accounts columns; recreated below.
drop view public.monthly_category_totals;
drop view public.monthly_cash_flow;

-- Old cross-row references by user. Dropping categories.user_id with CASCADE also
-- drops every foreign key that used categories (id, user_id); they are recreated
-- below on (id, space_id).
alter table public.transaction_allocations drop column user_id cascade;
alter table public.monthly_budgets drop column user_id cascade;
alter table public.categorization_rules drop column user_id cascade;
alter table public.categories drop column user_id cascade;

-- accounts
alter table public.accounts
  alter column space_id set not null,
  add constraint accounts_space_fkey foreign key (space_id) references public.spaces (id),
  add constraint accounts_id_space_key unique (id, space_id);
create index accounts_space_idx on public.accounts (space_id);

-- categories
alter table public.categories
  alter column space_id set not null,
  add constraint categories_space_fkey foreign key (space_id) references public.spaces (id) on delete cascade,
  add constraint categories_id_space_key unique (id, space_id),
  add constraint categories_merged_into_fkey foreign key (merged_into_id, space_id) references public.categories (id, space_id);
create unique index categories_active_name_uidx on public.categories (space_id, lower(btrim(name)))
  where archived_at is null;
create index categories_space_idx on public.categories (space_id, sort_order);

-- monthly_budgets
alter table public.monthly_budgets
  alter column space_id set not null,
  add constraint monthly_budgets_space_fkey foreign key (space_id) references public.spaces (id) on delete cascade,
  add constraint monthly_budgets_category_fkey foreign key (category_id, space_id)
    references public.categories (id, space_id) on delete cascade,
  add constraint monthly_budgets_space_category_month_key unique (space_id, category_id, month);
create index monthly_budgets_month_idx on public.monthly_budgets (space_id, month);

-- categorization_rules
alter table public.categorization_rules
  alter column space_id set not null,
  add constraint categorization_rules_space_fkey foreign key (space_id) references public.spaces (id) on delete cascade,
  add constraint categorization_rules_category_fkey foreign key (category_id, space_id)
    references public.categories (id, space_id) on delete cascade,
  add constraint categorization_rules_space_merchant_key unique (space_id, merchant_key);

-- transactions: the space always follows the account (ON UPDATE CASCADE when an
-- account is moved, see move_account_to_space).
alter table public.transactions
  alter column space_id set not null,
  add constraint transactions_account_space_fkey foreign key (account_id, space_id)
    references public.accounts (id, space_id) on delete cascade on update cascade,
  add constraint transactions_id_space_key unique (id, space_id),
  add constraint transactions_suggested_category_fkey foreign key (suggested_category_id, space_id)
    references public.categories (id, space_id) on delete set null (suggested_category_id);
create index transactions_space_date_idx on public.transactions (space_id, effective_date desc, id desc);
create index transactions_space_review_idx on public.transactions (space_id, effective_date desc)
  where needs_review and removed_at is null;

-- transaction_allocations
alter table public.transaction_allocations
  alter column space_id set not null,
  add constraint transaction_allocations_transaction_fkey foreign key (transaction_id, space_id)
    references public.transactions (id, space_id) on delete cascade on update cascade,
  add constraint transaction_allocations_category_fkey foreign key (category_id, space_id)
    references public.categories (id, space_id);
create index transaction_allocations_category_idx on public.transaction_allocations (space_id, category_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;

grant select on public.spaces to authenticated;
create policy spaces_select on public.spaces for select to authenticated
  using (id in (select public.my_space_ids()));

grant select on public.space_members to authenticated;
create policy space_members_select on public.space_members for select to authenticated
  using (space_id in (select public.my_space_ids()));

-- Your own profile, plus the people you share a space with (for their name).
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select m.user_id from public.space_members m where m.space_id in (select public.my_space_ids()))
  );

-- Your own connections, plus the connection behind an account shared with you
-- (so you can see when it was last synced). The encrypted session column stays
-- ungranted, and only the owner's server actions can change a connection.
create policy bank_connections_select on public.bank_connections for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.accounts a
                where a.connection_id = bank_connections.id
                  and a.space_id in (select public.my_space_ids()))
  );

create policy accounts_select on public.accounts for select to authenticated
  using (space_id in (select public.my_space_ids()));
-- Name and sync options belong to the person whose bank it is.
create policy accounts_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid()) and space_id in (select public.my_space_ids()))
  with check (user_id = (select auth.uid()) and space_id in (select public.my_space_ids()));

create policy categories_all on public.categories for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

create policy monthly_budgets_all on public.monthly_budgets for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

create policy categorization_rules_all on public.categorization_rules for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

create policy transactions_select on public.transactions for select to authenticated
  using (space_id in (select public.my_space_ids()));
create policy transactions_update on public.transactions for update to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

create policy transaction_allocations_all on public.transaction_allocations for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker: RLS of the caller applies)
-- ---------------------------------------------------------------------------

create view public.monthly_category_totals with (security_invoker = true) as
select t.space_id,
       date_trunc('month', t.effective_date)::date as month,
       a.category_id,
       sum(a.amount_minor)::bigint as net_minor,
       count(*)::integer as allocation_count
  from public.transactions t
  join public.transaction_allocations a on a.transaction_id = t.id
  join public.accounts acc on acc.id = t.account_id
 where t.removed_at is null
   and t.treatment = 'budget'
   and acc.include_in_budget
 group by t.space_id, date_trunc('month', t.effective_date), a.category_id;

create view public.monthly_cash_flow with (security_invoker = true) as
select t.space_id,
       date_trunc('month', t.effective_date)::date as month,
       coalesce(sum(t.amount_minor) filter (where t.amount_minor > 0), 0)::bigint as inflow_minor,
       coalesce(sum(t.amount_minor) filter (where t.amount_minor < 0), 0)::bigint as outflow_minor,
       count(*) filter (where t.needs_review)::integer as unreviewed_count,
       coalesce(sum(t.amount_minor) filter (where t.needs_review), 0)::bigint as unreviewed_minor
  from public.transactions t
  join public.accounts acc on acc.id = t.account_id
 where t.removed_at is null
   and t.treatment = 'budget'
   and acc.include_in_budget
 group by t.space_id, date_trunc('month', t.effective_date);

grant select on public.monthly_category_totals to authenticated;
grant select on public.monthly_cash_flow to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs. All SECURITY INVOKER (RLS applies) unless stated otherwise.
-- ---------------------------------------------------------------------------

create function public.assert_space_member(p_space uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_space is null or not exists (select 1 from public.my_space_ids() s where s = p_space) then
    raise exception 'Unknown space' using errcode = '42501';
  end if;
end $$;

create or replace function public.learn_merchant_rule(p_merchant_key text, p_category_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_space uuid;
begin
  if p_merchant_key is null or btrim(p_merchant_key) = '' or auth.uid() is null then
    return;
  end if;
  select c.space_id into v_space from public.categories c
   where c.id = p_category_id and c.space_id in (select public.my_space_ids());
  if v_space is null then
    return;
  end if;
  insert into public.categorization_rules (space_id, merchant_key, category_id)
  values (v_space, p_merchant_key, p_category_id)
  on conflict (space_id, merchant_key) do update
    set confirmations = case
          when public.categorization_rules.category_id = excluded.category_id
            then public.categorization_rules.confirmations + 1
          else 1 end,
        category_id = excluded.category_id,
        last_confirmed_at = now();

  update public.transactions
     set suggested_category_id = p_category_id,
         suggested_treatment = 'budget',
         suggestion_reason = 'merchant_rule'
   where space_id = v_space
     and merchant_key = p_merchant_key
     and needs_review
     and removed_at is null
     and coalesce(suggestion_reason, 'merchant_rule') = 'merchant_rule';
end $$;

create or replace function public.categorize_transactions(p_transaction_ids uuid[], p_category_id uuid, p_learn boolean default true)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_space uuid;
  v_tx record;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select c.space_id into v_space from public.categories c
   where c.id = p_category_id and c.archived_at is null and c.space_id in (select public.my_space_ids());
  if v_space is null then
    raise exception 'Unknown category' using errcode = '22023';
  end if;

  -- Only transactions in the category's space: a category never crosses spaces.
  for v_tx in
    select t.id, t.amount_minor, t.merchant_key from public.transactions t
     where t.id = any (p_transaction_ids) and t.space_id = v_space
     for update
  loop
    update public.transactions
       set treatment = 'budget', needs_review = false, reviewed_at = now(),
           suggested_category_id = null, suggested_treatment = null, suggestion_reason = null
     where id = v_tx.id;
    delete from public.transaction_allocations where transaction_id = v_tx.id;
    insert into public.transaction_allocations (space_id, transaction_id, category_id, amount_minor)
    values (v_space, v_tx.id, p_category_id, v_tx.amount_minor);
    if p_learn then
      perform public.learn_merchant_rule(v_tx.merchant_key, p_category_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function public.set_transaction_split(p_transaction_id uuid, p_allocations jsonb)
returns void
language plpgsql set search_path = '' as $$
declare
  v_amount bigint;
  v_space uuid;
  v_item jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select amount_minor, space_id into v_amount, v_space from public.transactions
   where id = p_transaction_id and space_id in (select public.my_space_ids()) for update;
  if v_amount is null then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0
     or jsonb_array_length(p_allocations) > 20 then
    raise exception 'Invalid allocations' using errcode = '22023';
  end if;

  update public.transactions
     set treatment = 'budget', needs_review = false, reviewed_at = now(),
         suggested_category_id = null, suggested_treatment = null, suggestion_reason = null
   where id = p_transaction_id;
  delete from public.transaction_allocations where transaction_id = p_transaction_id;
  for v_item in select * from jsonb_array_elements(p_allocations) loop
    -- The (category_id, space_id) foreign key rejects categories of other spaces.
    insert into public.transaction_allocations (space_id, transaction_id, category_id, amount_minor)
    values (v_space, p_transaction_id, (v_item ->> 'category_id')::uuid, (v_item ->> 'amount_minor')::bigint);
  end loop;
end $$;

create or replace function public.set_transaction_treatment(p_transaction_ids uuid[], p_treatment public.transaction_treatment)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  update public.transactions t
     set treatment = p_treatment,
         needs_review = case when p_treatment = 'budget'
           then not exists (select 1 from public.transaction_allocations a where a.transaction_id = t.id)
           else false end,
         reviewed_at = case when p_treatment = 'budget' then t.reviewed_at else now() end,
         suggested_category_id = case when p_treatment = 'budget' then t.suggested_category_id else null end,
         suggested_treatment = case when p_treatment = 'budget' then t.suggested_treatment else null end,
         suggestion_reason = case when p_treatment = 'budget' then t.suggestion_reason else null end
   where t.id = any (p_transaction_ids) and t.space_id in (select public.my_space_ids());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.reset_transaction_review(p_transaction_ids uuid[])
returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.transaction_allocations a
   using public.transactions t
   where a.transaction_id = t.id and t.id = any (p_transaction_ids)
     and t.space_id in (select public.my_space_ids());
  update public.transactions
     set treatment = 'budget', needs_review = true, reviewed_at = null
   where id = any (p_transaction_ids) and space_id in (select public.my_space_ids());
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.merge_categories(p_source uuid, p_target uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_source public.categories;
  v_target public.categories;
  v_space uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_source = p_target then
    raise exception 'Cannot merge a category into itself' using errcode = '22023';
  end if;
  select * into v_source from public.categories
   where id = p_source and space_id in (select public.my_space_ids()) for update;
  select * into v_target from public.categories
   where id = p_target and space_id in (select public.my_space_ids()) for update;
  if v_source.id is null or v_target.id is null or v_target.archived_at is not null
     or v_source.space_id <> v_target.space_id then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if v_source.kind <> v_target.kind then
    raise exception 'Only categories of the same kind can be merged' using errcode = '22023';
  end if;
  v_space := v_source.space_id;

  update public.transaction_allocations ta
     set amount_minor = ta.amount_minor + src.amount_minor
    from public.transaction_allocations src
   where ta.category_id = p_target and src.category_id = p_source
     and ta.transaction_id = src.transaction_id and ta.space_id = v_space;
  delete from public.transaction_allocations src
   using public.transaction_allocations ta
   where src.category_id = p_source and ta.category_id = p_target
     and ta.transaction_id = src.transaction_id and src.space_id = v_space;
  update public.transaction_allocations set category_id = p_target
   where category_id = p_source and space_id = v_space;

  insert into public.monthly_budgets (space_id, category_id, month, amount_minor)
  select v_space, p_target, b.month, b.amount_minor
    from public.monthly_budgets b where b.category_id = p_source and b.space_id = v_space
  on conflict (space_id, category_id, month) do update
    set amount_minor = public.monthly_budgets.amount_minor + excluded.amount_minor;
  delete from public.monthly_budgets where category_id = p_source and space_id = v_space;

  update public.categorization_rules set category_id = p_target
   where category_id = p_source and space_id = v_space;
  update public.transactions set suggested_category_id = p_target
   where suggested_category_id = p_source and space_id = v_space;

  update public.categories
     set archived_at = now(), merged_into_id = p_target
   where id = p_source;
end $$;

-- Starter categories, shared by the app RPC and the server-only shared-space setup.
create function public.starter_categories()
returns table (name text, kind public.category_kind, icon text, color text, is_fixed boolean, sort_order integer)
language sql immutable set search_path = '' as $$
  values
    ('Groceries',           'expense'::public.category_kind, 'shopping-basket', 'moss',  false, 10),
    ('Restaurants & cafés', 'expense', 'coffee',          'clay',  false, 20),
    ('Transport',           'expense', 'tram-front',      'slate', false, 30),
    ('Housing',             'expense', 'house',           'stone', true,  40),
    ('Shopping',            'expense', 'shopping-bag',    'plum',  false, 50),
    ('Entertainment',       'expense', 'ticket',          'ochre', false, 60),
    ('Travel',              'expense', 'plane',           'sky',   false, 70),
    ('Health',              'expense', 'heart-pulse',     'brick', false, 80),
    ('Subscriptions',       'expense', 'repeat',          'pine',  true,  90),
    ('Miscellaneous',       'expense', 'circle-dashed',   'sand',  false, 100),
    ('Salary',              'income',  'briefcase',       'pine',  false, 200),
    ('Other income',        'income',  'arrow-down-left', 'moss',  false, 210)
$$;

drop function public.create_starter_categories();
create function public.create_starter_categories(p_space uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.assert_space_member(p_space);
  if exists (select 1 from public.categories where space_id = p_space) then
    return 0;
  end if;
  insert into public.categories (space_id, name, kind, icon, color, is_fixed, sort_order)
  select p_space, s.name, s.kind, s.icon, s.color, s.is_fixed, s.sort_order from public.starter_categories() s;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

drop function public.ensure_month_budget(date);
drop function public.copy_month_budget(date, date, boolean);
drop function public.set_month_budgets(date, jsonb);

create function public.copy_month_budget(p_space uuid, p_from date, p_to date, p_overwrite boolean default false)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.assert_space_member(p_space);
  if extract(day from p_from) <> 1 or extract(day from p_to) <> 1 then
    raise exception 'Months must be the first day of the month' using errcode = '22023';
  end if;
  if p_overwrite then
    insert into public.monthly_budgets (space_id, category_id, month, amount_minor)
    select p_space, b.category_id, p_to, b.amount_minor
      from public.monthly_budgets b
      join public.categories c on c.id = b.category_id and c.archived_at is null
     where b.space_id = p_space and b.month = p_from
    on conflict (space_id, category_id, month) do update set amount_minor = excluded.amount_minor;
  else
    insert into public.monthly_budgets (space_id, category_id, month, amount_minor)
    select p_space, b.category_id, p_to, b.amount_minor
      from public.monthly_budgets b
      join public.categories c on c.id = b.category_id and c.archived_at is null
     where b.space_id = p_space and b.month = p_from
    on conflict (space_id, category_id, month) do nothing;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create function public.ensure_month_budget(p_space uuid, p_month date) returns integer
language plpgsql set search_path = '' as $$
declare
  v_source date;
begin
  perform public.assert_space_member(p_space);
  if exists (select 1 from public.monthly_budgets where space_id = p_space and month = p_month) then
    return 0;
  end if;
  select max(month) into v_source from public.monthly_budgets
   where space_id = p_space and month < p_month;
  if v_source is null then
    return 0;
  end if;
  return public.copy_month_budget(p_space, v_source, p_month, false);
end $$;

-- Upsert that only ever updates amount_minor (see 20261030000400).
create function public.set_month_budgets(p_space uuid, p_month date, p_amounts jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  perform public.assert_space_member(p_space);
  if extract(day from p_month) <> 1 then
    raise exception 'Month must be the first day of the month' using errcode = '22023';
  end if;
  if jsonb_typeof(p_amounts) <> 'object' then
    raise exception 'Amounts must be an object of category id to amount' using errcode = '22023';
  end if;
  insert into public.monthly_budgets (space_id, category_id, month, amount_minor)
  select p_space, a.key::uuid, p_month, (a.value #>> '{}')::bigint
    from jsonb_each(p_amounts) a
  on conflict (space_id, category_id, month) do update set amount_minor = excluded.amount_minor;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Move one of your own accounts (and all its transactions) to another space you
-- belong to. Categories belong to a space, so categorisations cannot follow:
-- budget transactions go back to review in the new space. SECURITY DEFINER
-- because users have no right to change space_id directly; every check is explicit.
create function public.move_account_to_space(p_account uuid, p_space uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_account public.accounts;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_account from public.accounts where id = p_account and user_id = v_user for update;
  if v_account.id is null then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;
  if v_account.provider = 'manual' then
    raise exception 'Hand-entered transactions stay in their space' using errcode = '22023';
  end if;
  if not exists (select 1 from public.space_members where space_id = p_space and user_id = v_user) then
    raise exception 'Unknown space' using errcode = '42501';
  end if;
  if v_account.space_id = p_space then
    return;
  end if;

  delete from public.transaction_allocations a
   using public.transactions t
   where a.transaction_id = t.id and t.account_id = p_account;
  update public.transactions
     set suggested_category_id = null, suggested_treatment = null, suggestion_reason = null,
         needs_review = case when treatment = 'budget' then true else needs_review end,
         reviewed_at = case when treatment = 'budget' then null else reviewed_at end
   where account_id = p_account;
  -- Cascades to transactions.space_id through the (account_id, space_id) key.
  update public.accounts set space_id = p_space where id = p_account;
end $$;

-- Server-only: create a shared space with its first member and starter categories.
create function public.create_shared_space(p_owner uuid, p_name text default 'Shared') returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_space uuid;
begin
  insert into public.spaces (kind, name) values ('shared', p_name) returning id into v_space;
  insert into public.space_members (space_id, user_id, role) values (v_space, p_owner, 'owner');
  insert into public.categories (space_id, name, kind, icon, color, is_fixed, sort_order)
  select v_space, s.name, s.kind, s.icon, s.color, s.is_fixed, s.sort_order from public.starter_categories() s;
  return v_space;
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.check_space_member() from public, anon, authenticated;
revoke all on function public.my_space_ids() from public, anon;
grant execute on function public.my_space_ids() to authenticated;
revoke all on function public.assert_space_member(uuid) from public, anon;
grant execute on function public.assert_space_member(uuid) to authenticated;
revoke all on function public.starter_categories() from public, anon;
grant execute on function public.starter_categories() to authenticated;

revoke all on function public.create_starter_categories(uuid) from public, anon;
revoke all on function public.copy_month_budget(uuid, date, date, boolean) from public, anon;
revoke all on function public.ensure_month_budget(uuid, date) from public, anon;
revoke all on function public.set_month_budgets(uuid, date, jsonb) from public, anon;
revoke all on function public.move_account_to_space(uuid, uuid) from public, anon;
grant execute on function public.create_starter_categories(uuid) to authenticated;
grant execute on function public.copy_month_budget(uuid, date, date, boolean) to authenticated;
grant execute on function public.ensure_month_budget(uuid, date) to authenticated;
grant execute on function public.set_month_budgets(uuid, date, jsonb) to authenticated;
grant execute on function public.move_account_to_space(uuid, uuid) to authenticated;

-- Membership is server-only.
revoke all on function public.create_shared_space(uuid, text) from public, anon, authenticated;

grant all on public.spaces, public.space_members to service_role;
grant select on public.monthly_category_totals, public.monthly_cash_flow to service_role;
grant execute on all functions in schema public to service_role;
