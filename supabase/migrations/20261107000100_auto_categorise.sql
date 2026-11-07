-- Automatic categorisation for trusted merchants.
--
-- A merchant rule (categorization_rules) already counts how many times in a row a
-- merchant was filed in the same category (`confirmations`). Once that reaches the
-- threshold (3), new transactions from that merchant are filed in that category
-- during sync and skip the review queue. They carry `auto_categorized_at`, so the
-- app can mark them "Auto" and list what was filed recently.
--
--   * spaces.auto_categorize: on/off for the whole space (rules belong to a space,
--     so a shared space has one setting for both people). Changed through
--     set_auto_categorize, because the browser cannot update spaces directly.
--   * categorization_rules.auto_enabled: per-merchant off switch. A rule that is
--     off still suggests its category, it just never files on its own.
--   * transactions.auto_categorized_at: set only by the server-side sync. The mark
--     is cleared by a trigger as soon as someone decides on the transaction
--     (category, split, treatment or back to review), so it always means "nobody
--     has looked at this yet".
--
-- Correcting an auto-filed transaction goes through categorize_transactions as
-- before: learn_merchant_rule moves the rule to the new category with one
-- confirmation, so the merchant stops being automatic until it is trusted again.

alter table public.spaces add column auto_categorize boolean not null default true;
alter table public.categorization_rules add column auto_enabled boolean not null default true;
alter table public.transactions add column auto_categorized_at timestamptz;

create index transactions_space_auto_idx on public.transactions (space_id, auto_categorized_at desc)
  where auto_categorized_at is not null;

-- The browser may switch one merchant's automatic filing on or off. Reading the new
-- columns is covered by the existing table-level SELECT grants (spaces, rules,
-- transactions). transactions.auto_categorized_at is not writable by the browser.
grant update (auto_enabled) on public.categorization_rules to authenticated;

-- How many same-category confirmations make a merchant trusted. Mirrored by
-- AUTO_THRESHOLD in src/lib/auto-categorise.ts (a database test keeps them equal).
create function public.auto_categorize_threshold() returns integer
language sql immutable set search_path = '' as $$
  select 3
$$;

-- ---------------------------------------------------------------------------
-- The "Auto" mark disappears once a person decides on the transaction.
-- ---------------------------------------------------------------------------

create function public.clear_auto_mark_on_decision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.auto_categorized_at is not null
     and new.auto_categorized_at is not distinct from old.auto_categorized_at
     and (new.treatment is distinct from old.treatment
          or new.needs_review is distinct from old.needs_review
          or new.reviewed_at is distinct from old.reviewed_at) then
    new.auto_categorized_at := null;
  end if;
  return new;
end $$;

create trigger transactions_clear_auto_mark
  before update of treatment, needs_review, reviewed_at on public.transactions
  for each row execute function public.clear_auto_mark_on_decision();

-- ---------------------------------------------------------------------------
-- Server only: file newly imported transactions of one account by trusted rules.
-- Called by sync with the ids it just inserted. Only untouched transactions
-- qualify (still to review, budget treatment, no allocations, not a suggested
-- transfer), and only rules of the account's own space whose category is active.
-- Runs as the caller (service_role); not executable by the browser.
-- ---------------------------------------------------------------------------

create function public.apply_auto_categorization(p_account uuid, p_transaction_ids uuid[])
returns integer
language plpgsql set search_path = '' as $$
declare
  v_space uuid;
  v_enabled boolean;
  v_count integer;
begin
  select a.space_id, s.auto_categorize into v_space, v_enabled
    from public.accounts a join public.spaces s on s.id = a.space_id
   where a.id = p_account;
  if v_space is null or not v_enabled or p_transaction_ids is null then
    return 0;
  end if;

  with candidates as (
    select t.id, t.amount_minor, r.category_id
      from public.transactions t
      join public.categorization_rules r on r.space_id = t.space_id and r.merchant_key = t.merchant_key
      join public.categories c on c.id = r.category_id and c.space_id = t.space_id
     where t.id = any (p_transaction_ids)
       and t.account_id = p_account
       and t.space_id = v_space
       and t.needs_review
       and t.reviewed_at is null
       and t.removed_at is null
       and t.treatment = 'budget'
       and coalesce(t.suggested_treatment, 'budget') = 'budget'
       and r.auto_enabled
       and r.confirmations >= public.auto_categorize_threshold()
       and c.archived_at is null
       and not exists (select 1 from public.transaction_allocations x where x.transaction_id = t.id)
  ), filed as (
    insert into public.transaction_allocations (space_id, transaction_id, category_id, amount_minor)
    select v_space, c.id, c.category_id, c.amount_minor from candidates c
    returning transaction_id, category_id
  )
  update public.transactions t
     set needs_review = false,
         auto_categorized_at = now(),
         suggested_category_id = f.category_id,
         suggested_treatment = 'budget',
         suggestion_reason = 'merchant_rule'
    from filed f
   where t.id = f.transaction_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Settings RPCs (browser)
-- ---------------------------------------------------------------------------

-- Turn automatic filing on or off for a whole space. SECURITY DEFINER because the
-- browser has no UPDATE on spaces; membership is checked explicitly and only this
-- one column is changed.
create function public.set_auto_categorize(p_space uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_space_member(p_space);
  if p_enabled is null then
    raise exception 'Choose on or off' using errcode = '22023';
  end if;
  update public.spaces set auto_categorize = p_enabled where id = p_space;
end $$;

-- Change one merchant rule: its category, its automatic switch, and (to restore a
-- rule after a one-off correction) its confirmation count. NULL leaves a field as
-- it is. Runs as the caller: RLS limits it to rules in your spaces, and the
-- (category_id, space_id) key keeps the category in the rule's space.
create function public.set_merchant_rule(
  p_rule uuid,
  p_category_id uuid default null,
  p_auto_enabled boolean default null,
  p_confirmations integer default null
) returns void
language plpgsql set search_path = '' as $$
declare
  v_rule public.categorization_rules;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_rule from public.categorization_rules
   where id = p_rule and space_id in (select public.my_space_ids()) for update;
  if v_rule.id is null then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories c
     where c.id = p_category_id and c.space_id = v_rule.space_id and c.archived_at is null
  ) then
    raise exception 'Unknown category' using errcode = '22023';
  end if;
  if p_confirmations is not null and (p_confirmations < 1 or p_confirmations > 100000) then
    raise exception 'Invalid confirmation count' using errcode = '22023';
  end if;

  update public.categorization_rules
     set category_id = coalesce(p_category_id, category_id),
         auto_enabled = coalesce(p_auto_enabled, auto_enabled),
         confirmations = coalesce(p_confirmations, confirmations)
   where id = p_rule;

  -- Waiting transactions follow the rule's new suggestion.
  if p_category_id is not null and p_category_id <> v_rule.category_id then
    update public.transactions
       set suggested_category_id = p_category_id
     where space_id = v_rule.space_id
       and merchant_key = v_rule.merchant_key
       and needs_review
       and removed_at is null
       and suggestion_reason = 'merchant_rule';
  end if;
end $$;

-- Forget a merchant rule entirely: no more suggestions or automatic filing until
-- the merchant is categorised again. Transactions already filed keep their category.
create function public.forget_merchant_rule(p_rule uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_rule public.categorization_rules;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  delete from public.categorization_rules
   where id = p_rule and space_id in (select public.my_space_ids())
  returning * into v_rule;
  if v_rule.id is null then
    raise exception 'Rule not found' using errcode = 'P0002';
  end if;
  update public.transactions
     set suggested_category_id = null, suggested_treatment = null, suggestion_reason = null
   where space_id = v_rule.space_id
     and merchant_key = v_rule.merchant_key
     and needs_review
     and removed_at is null
     and suggestion_reason = 'merchant_rule';
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.clear_auto_mark_on_decision() from public, anon, authenticated;
revoke all on function public.apply_auto_categorization(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.auto_categorize_threshold() from public, anon;
revoke all on function public.set_auto_categorize(uuid, boolean) from public, anon;
revoke all on function public.set_merchant_rule(uuid, uuid, boolean, integer) from public, anon;
revoke all on function public.forget_merchant_rule(uuid) from public, anon;
grant execute on function public.auto_categorize_threshold() to authenticated;
grant execute on function public.set_auto_categorize(uuid, boolean) to authenticated;
grant execute on function public.set_merchant_rule(uuid, uuid, boolean, integer) to authenticated;
grant execute on function public.forget_merchant_rule(uuid) to authenticated;

grant execute on function public.auto_categorize_threshold() to service_role;
grant execute on function public.apply_auto_categorization(uuid, uuid[]) to service_role;
grant execute on function public.set_auto_categorize(uuid, boolean) to service_role;
grant execute on function public.set_merchant_rule(uuid, uuid, boolean, integer) to service_role;
grant execute on function public.forget_merchant_rule(uuid) to service_role;
