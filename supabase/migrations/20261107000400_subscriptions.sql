-- Subscriptions and fixed costs.
--
-- Recurring payments are detected in the app from transaction history (see
-- src/lib/subscriptions.ts); nothing about a detection is stored. This table only
-- keeps what the person decided about one: "yes, track it" (confirmed), "not a
-- subscription" (dismissed) or "I cancelled it" (cancelled), plus the ones they
-- added by hand from a transaction. A decision belongs to a merchant and cadence
-- (weekly, monthly, quarterly or yearly), so it keeps applying as new charges arrive.
-- One merchant can have several series at the same cadence (two phone lines, several
-- app store billings); each gets its own decision, matched to the series closest to
-- its accepted price, so the pair is not unique.
--
-- Like categories and budgets, a decision belongs to a space: subscriptions found in
-- the shared space are shared, those in a personal space stay private.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  merchant_key text not null check (char_length(merchant_key) between 1 and 120),
  cadence text not null check (cadence in ('weekly', 'monthly', 'quarterly', 'yearly')),
  status text not null check (status in ('confirmed', 'dismissed', 'cancelled')),
  source text not null default 'detected' check (source in ('detected', 'manual')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- The price the person last accepted, as a positive amount in øre. A later charge
  -- above it is shown as a price increase until they accept the new price.
  amount_minor bigint not null check (amount_minor > 0 and amount_minor < 100000000000),
  category_id uuid,
  -- The transaction a manual subscription was created from.
  transaction_id uuid,
  cancelled_on date,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_category_fkey foreign key (category_id, space_id)
    references public.categories (id, space_id) on delete set null (category_id),
  constraint subscriptions_transaction_fkey foreign key (transaction_id, space_id)
    references public.transactions (id, space_id) on delete set null (transaction_id),
  check ((status = 'cancelled') = (cancelled_on is not null))
);

create index subscriptions_space_idx on public.subscriptions (space_id, merchant_key, cadence);

create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- An account changing space: decisions made from one of its transactions stay
-- where they are, but let go of the transaction. Without this, the
-- (transaction_id, space_id) key would block move_account_to_space, because the
-- account's transactions move with it.
create function public.unlink_subscriptions_on_account_move() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.space_id is distinct from old.space_id then
    update public.subscriptions s set transaction_id = null
      from public.transactions t
     where t.account_id = old.id and s.transaction_id = t.id and s.space_id = old.space_id;
  end if;
  return new;
end $$;

create trigger accounts_unlink_subscriptions before update of space_id on public.accounts
  for each row execute function public.unlink_subscriptions_on_account_move();
revoke all on function public.unlink_subscriptions_on_account_move() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security and column grants
-- ---------------------------------------------------------------------------

alter table public.subscriptions enable row level security;

create policy subscriptions_all on public.subscriptions for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

-- Writes go through save_subscription (insert, or update by id; never changes the key or
-- the space, see 20261030000400 for why not a PostgREST upsert). The browser role
-- gets exactly the columns that function writes; it can never move a row to
-- another space or rewrite who created it.
-- Start from nothing: a database without 20261030000500 (default privileges
-- locked) would otherwise hand anon and authenticated every privilege here.
revoke all on public.subscriptions from anon, authenticated;
grant select, delete on public.subscriptions to authenticated;
grant insert (space_id, merchant_key, cadence, status, source, name, amount_minor, category_id, transaction_id, cancelled_on)
  on public.subscriptions to authenticated;
grant update (status, name, amount_minor, category_id, transaction_id, cancelled_on)
  on public.subscriptions to authenticated;
grant all on public.subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- save_subscription: create one decision, or update the one given by p_id (which
-- must be in the same space, merchant and cadence: the key and space never move).
-- SECURITY INVOKER, so RLS and the column grants above still apply.
-- ---------------------------------------------------------------------------

create function public.save_subscription(
  p_space uuid,
  p_merchant_key text,
  p_cadence text,
  p_status text,
  p_name text,
  p_amount_minor bigint,
  p_category_id uuid default null,
  p_source text default 'detected',
  p_transaction_id uuid default null,
  p_cancelled_on date default null,
  p_id uuid default null
) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  perform public.assert_space_member(p_space);
  if p_status not in ('confirmed', 'dismissed', 'cancelled') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if p_id is not null then
    update public.subscriptions s
       set status = p_status,
           name = btrim(p_name),
           amount_minor = p_amount_minor,
           category_id = p_category_id,
           transaction_id = coalesce(p_transaction_id, s.transaction_id),
           cancelled_on = case when p_status = 'cancelled'
             then coalesce(p_cancelled_on, s.cancelled_on, current_date) end
     where s.id = p_id and s.space_id = p_space
       and s.merchant_key = btrim(p_merchant_key) and s.cadence = p_cadence
    returning s.id into v_id;
    if v_id is null then
      raise exception 'Subscription not found' using errcode = 'P0002';
    end if;
    return v_id;
  end if;
  insert into public.subscriptions
    (space_id, merchant_key, cadence, status, source, name, amount_minor, category_id, transaction_id, cancelled_on)
  values
    (p_space, btrim(p_merchant_key), p_cadence, p_status, coalesce(p_source, 'detected'), btrim(p_name), p_amount_minor,
     p_category_id, p_transaction_id,
     case when p_status = 'cancelled' then coalesce(p_cancelled_on, current_date) end)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.save_subscription(uuid, text, text, text, text, bigint, uuid, text, uuid, date, uuid) from public, anon;
grant execute on function public.save_subscription(uuid, text, text, text, text, bigint, uuid, text, uuid, date, uuid) to authenticated, service_role;
