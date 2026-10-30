-- Financial integrity rules and the small set of RPCs the app uses for multi-row
-- changes. All RPCs are SECURITY INVOKER: they run with the caller's privileges, so
-- Row Level Security applies exactly as for direct table access.

-- ---------------------------------------------------------------------------
-- Split allocations must always sum exactly to the transaction amount.
-- Checked at commit (deferred) so an RPC can delete + re-insert allocations.
-- ---------------------------------------------------------------------------

create function public.assert_allocations_balance() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_tx uuid := coalesce(new.transaction_id, old.transaction_id);
  v_amount bigint;
  v_sum bigint;
  v_count integer;
begin
  select t.amount_minor into v_amount from public.transactions t where t.id = v_tx;
  if v_amount is null then
    return null; -- transaction deleted in the same statement (cascade)
  end if;
  select coalesce(sum(a.amount_minor), 0), count(*) into v_sum, v_count
    from public.transaction_allocations a where a.transaction_id = v_tx;
  if v_count > 0 and v_sum <> v_amount then
    raise exception 'Allocations (%) must sum to the transaction amount (%)', v_sum, v_amount
      using errcode = '23514';
  end if;
  return null;
end $$;

create constraint trigger transaction_allocations_balance
  after insert or update or delete on public.transaction_allocations
  deferrable initially deferred
  for each row execute function public.assert_allocations_balance();

-- When the bank changes an amount (typically pending -> booked with a final amount):
-- a single allocation follows the new amount; a split can no longer be trusted, so
-- it is cleared and the transaction goes back to review. Categories are never lost
-- silently for the common single-category case.
create function public.realign_allocations_on_amount_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_count integer;
begin
  if new.amount_minor = old.amount_minor then
    return new;
  end if;
  select count(*) into v_count from public.transaction_allocations where transaction_id = new.id;
  if v_count = 1 then
    update public.transaction_allocations set amount_minor = new.amount_minor where transaction_id = new.id;
  elsif v_count > 1 then
    delete from public.transaction_allocations where transaction_id = new.id;
    update public.transactions set needs_review = true, reviewed_at = null where id = new.id;
  end if;
  return new;
end $$;

create trigger transactions_amount_change
  after update of amount_minor on public.transactions
  for each row execute function public.realign_allocations_on_amount_change();

-- Allocations only make sense for transactions treated as budget items.
create function public.clear_allocations_on_treatment_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.treatment <> 'budget' and old.treatment = 'budget' then
    delete from public.transaction_allocations where transaction_id = new.id;
  end if;
  return new;
end $$;

create trigger transactions_treatment_change
  after update of treatment on public.transactions
  for each row execute function public.clear_allocations_on_treatment_change();

-- ---------------------------------------------------------------------------
-- Rule learning
-- ---------------------------------------------------------------------------

create function public.learn_merchant_rule(p_merchant_key text, p_category_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if p_merchant_key is null or btrim(p_merchant_key) = '' or v_user is null then
    return;
  end if;
  insert into public.categorization_rules (user_id, merchant_key, category_id)
  values (v_user, p_merchant_key, p_category_id)
  on conflict (user_id, merchant_key) do update
    set confirmations = case
          when public.categorization_rules.category_id = excluded.category_id
            then public.categorization_rules.confirmations + 1
          else 1 end,
        category_id = excluded.category_id,
        last_confirmed_at = now();

  -- Refresh suggestions on the rest of the review queue for this merchant.
  update public.transactions
     set suggested_category_id = p_category_id,
         suggested_treatment = 'budget',
         suggestion_reason = 'merchant_rule'
   where user_id = v_user
     and merchant_key = p_merchant_key
     and needs_review
     and removed_at is null
     and coalesce(suggestion_reason, 'merchant_rule') = 'merchant_rule';
end $$;

-- ---------------------------------------------------------------------------
-- Categorisation RPCs
-- ---------------------------------------------------------------------------

-- Assign one category to whole transactions (the single-tap path, also bulk).
create function public.categorize_transactions(p_transaction_ids uuid[], p_category_id uuid, p_learn boolean default true)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_tx record;
  v_count integer := 0;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.categories c
                  where c.id = p_category_id and c.user_id = v_user and c.archived_at is null) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;

  for v_tx in
    select t.id, t.amount_minor, t.merchant_key from public.transactions t
     where t.id = any (p_transaction_ids) and t.user_id = v_user
     for update
  loop
    update public.transactions
       set treatment = 'budget', needs_review = false, reviewed_at = now(),
           suggested_category_id = null, suggested_treatment = null, suggestion_reason = null
     where id = v_tx.id;
    delete from public.transaction_allocations where transaction_id = v_tx.id;
    insert into public.transaction_allocations (user_id, transaction_id, category_id, amount_minor)
    values (v_user, v_tx.id, p_category_id, v_tx.amount_minor);
    if p_learn then
      perform public.learn_merchant_rule(v_tx.merchant_key, p_category_id);
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Replace a transaction's allocations with a split. p_allocations is
-- [{"category_id": uuid, "amount_minor": int}, ...] in the transaction's sign.
create function public.set_transaction_split(p_transaction_id uuid, p_allocations jsonb)
returns void
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_amount bigint;
  v_item jsonb;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select amount_minor into v_amount from public.transactions
   where id = p_transaction_id and user_id = v_user for update;
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
    insert into public.transaction_allocations (user_id, transaction_id, category_id, amount_minor)
    values (v_user, p_transaction_id, (v_item ->> 'category_id')::uuid, (v_item ->> 'amount_minor')::bigint);
  end loop;
  -- The deferred balance trigger verifies the sum at commit.
end $$;

-- Mark as transfer / excluded, or put back to normal budget handling.
create function public.set_transaction_treatment(p_transaction_ids uuid[], p_treatment public.transaction_treatment)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
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
   where t.id = any (p_transaction_ids) and t.user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Undo a review decision: back into the queue, allocations cleared.
create function public.reset_transaction_review(p_transaction_ids uuid[])
returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.transaction_allocations a
   using public.transactions t
   where a.transaction_id = t.id and t.id = any (p_transaction_ids) and t.user_id = v_user;
  update public.transactions
     set treatment = 'budget', needs_review = true, reviewed_at = null
   where id = any (p_transaction_ids) and user_id = v_user;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------

-- Merge source into target. History moves with it: allocations and rules are
-- re-pointed, and monthly budgets are summed so past months keep the same totals.
create function public.merge_categories(p_source uuid, p_target uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_source public.categories;
  v_target public.categories;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_source = p_target then
    raise exception 'Cannot merge a category into itself' using errcode = '22023';
  end if;
  select * into v_source from public.categories where id = p_source and user_id = v_user for update;
  select * into v_target from public.categories where id = p_target and user_id = v_user for update;
  if v_source.id is null or v_target.id is null or v_target.archived_at is not null then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if v_source.kind <> v_target.kind then
    raise exception 'Only categories of the same kind can be merged' using errcode = '22023';
  end if;

  -- A transaction split across both categories collapses into one allocation.
  update public.transaction_allocations ta
     set amount_minor = ta.amount_minor + src.amount_minor
    from public.transaction_allocations src
   where ta.category_id = p_target and src.category_id = p_source
     and ta.transaction_id = src.transaction_id and ta.user_id = v_user;
  delete from public.transaction_allocations src
   using public.transaction_allocations ta
   where src.category_id = p_source and ta.category_id = p_target
     and ta.transaction_id = src.transaction_id and src.user_id = v_user;
  update public.transaction_allocations set category_id = p_target
   where category_id = p_source and user_id = v_user;

  insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
  select v_user, p_target, b.month, b.amount_minor
    from public.monthly_budgets b where b.category_id = p_source and b.user_id = v_user
  on conflict (user_id, category_id, month) do update
    set amount_minor = public.monthly_budgets.amount_minor + excluded.amount_minor;
  delete from public.monthly_budgets where category_id = p_source and user_id = v_user;

  update public.categorization_rules set category_id = p_target
   where category_id = p_source and user_id = v_user;
  update public.transactions set suggested_category_id = p_target
   where suggested_category_id = p_source and user_id = v_user;

  update public.categories
     set archived_at = now(), merged_into_id = p_target
   where id = p_source;
end $$;

-- Starter categories for a new user. No-op when the user already has categories.
create function public.create_starter_categories() returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.categories where user_id = v_user) then
    return 0;
  end if;
  insert into public.categories (user_id, name, kind, icon, color, is_fixed, sort_order) values
    (v_user, 'Groceries',            'expense', 'shopping-basket', 'moss',  false, 10),
    (v_user, 'Restaurants & cafés',  'expense', 'coffee',          'clay',  false, 20),
    (v_user, 'Transport',            'expense', 'tram-front',      'slate', false, 30),
    (v_user, 'Housing',              'expense', 'house',           'stone', true,  40),
    (v_user, 'Shopping',             'expense', 'shopping-bag',    'plum',  false, 50),
    (v_user, 'Entertainment',        'expense', 'ticket',          'ochre', false, 60),
    (v_user, 'Travel',               'expense', 'plane',           'sky',   false, 70),
    (v_user, 'Health',               'expense', 'heart-pulse',     'brick', false, 80),
    (v_user, 'Subscriptions',        'expense', 'repeat',          'pine',  true,  90),
    (v_user, 'Miscellaneous',        'expense', 'circle-dashed',   'sand',  false, 100),
    (v_user, 'Salary',               'income',  'briefcase',       'pine',  false, 200),
    (v_user, 'Other income',         'income',  'arrow-down-left', 'moss',  false, 210);
  return 12;
end $$;

-- ---------------------------------------------------------------------------
-- Monthly budgets
-- ---------------------------------------------------------------------------

-- Copy all category budgets from one month to another. Without overwrite, only
-- categories that have no budget in the target month are filled in.
create function public.copy_month_budget(p_from date, p_to date, p_overwrite boolean default false)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if extract(day from p_from) <> 1 or extract(day from p_to) <> 1 then
    raise exception 'Months must be the first day of the month' using errcode = '22023';
  end if;
  if p_overwrite then
    insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
    select v_user, b.category_id, p_to, b.amount_minor
      from public.monthly_budgets b
      join public.categories c on c.id = b.category_id and c.archived_at is null
     where b.user_id = v_user and b.month = p_from
    on conflict (user_id, category_id, month) do update set amount_minor = excluded.amount_minor;
  else
    insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
    select v_user, b.category_id, p_to, b.amount_minor
      from public.monthly_budgets b
      join public.categories c on c.id = b.category_id and c.archived_at is null
     where b.user_id = v_user and b.month = p_from
    on conflict (user_id, category_id, month) do nothing;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Make sure a month has a budget snapshot: if it has none, copy the most recent
-- earlier month that does. Returns the number of rows created.
create function public.ensure_month_budget(p_month date) returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_source date;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if exists (select 1 from public.monthly_budgets where user_id = v_user and month = p_month) then
    return 0;
  end if;
  select max(month) into v_source from public.monthly_budgets
   where user_id = v_user and month < p_month;
  if v_source is null then
    return 0;
  end if;
  return public.copy_month_budget(v_source, p_month, false);
end $$;

-- ---------------------------------------------------------------------------
-- Reporting views (security_invoker: RLS of the caller applies)
-- ---------------------------------------------------------------------------

-- Net allocated amount per category and month, budget accounts only.
-- Negative = spending, positive = refunds/income. Removed pending rows excluded.
create view public.monthly_category_totals with (security_invoker = true) as
select t.user_id,
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
 group by t.user_id, date_trunc('month', t.effective_date), a.category_id;

-- Cash flow per month: income minus expenses, ignoring transfers and excluded rows.
-- Separate from budget variance on purpose.
create view public.monthly_cash_flow with (security_invoker = true) as
select t.user_id,
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
 group by t.user_id, date_trunc('month', t.effective_date);
