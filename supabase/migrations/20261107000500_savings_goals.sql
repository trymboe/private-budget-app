-- Savings goals.
--
-- A goal belongs to one space, like everything else: a goal in your personal space
-- is yours alone, a goal in the shared space is visible to (and editable by) both
-- partners. Progress comes from two sources, added together:
--
--   * Contributions you log by hand ("+500 kr"), stored in
--     savings_goal_contributions. Negative amounts record money taken out.
--   * Optionally, one linked account in the same space (usually a savings
--     account). Its progress is either the money that came into the account since
--     the goal started (net of its transactions, "growth") or, when chosen and
--     known, the account's balance ("balance"). The app decides which number to
--     use (src/lib/goals.ts); the view below supplies both.
--
-- The composite foreign key (account_id, space_id) means a goal can only link an
-- account in its own space, so a shared goal can never read a private account.
-- When an account moves to another space, goals in the old space let go of it
-- instead of following it (which would expose a private goal to a partner).
--
-- Writes from the browser: plain inserts and updates on savings_goals limited by
-- column grants (no upserts, see 20261030000400), and contributions through
-- add_goal_contribution(), which takes the space from the goal.

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  target_minor bigint not null check (target_minor > 0 and target_minor < 10000000000000),
  target_date date,
  icon text not null default 'piggy-bank' check (char_length(icon) between 1 and 40),
  color text not null default 'pine' check (char_length(color) between 1 and 20),
  -- Progress from a linked account counts from this date.
  starts_on date not null default current_date,
  account_id uuid,
  account_basis text not null default 'growth' check (account_basis in ('growth', 'balance')),
  completed_at timestamptz,
  archived_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint savings_goals_id_space_key unique (id, space_id),
  constraint savings_goals_account_fkey foreign key (account_id, space_id)
    references public.accounts (id, space_id) on delete set null (account_id),
  constraint savings_goals_target_after_start check (target_date is null or target_date > starts_on)
);

create index savings_goals_space_idx on public.savings_goals (space_id, created_at);
create index savings_goals_account_idx on public.savings_goals (account_id) where account_id is not null;

create trigger savings_goals_touch before update on public.savings_goals
  for each row execute function public.touch_updated_at();

create table public.savings_goal_contributions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  goal_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0 and abs(amount_minor) < 10000000000000),
  contributed_on date not null default current_date,
  note text check (char_length(note) <= 200),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint savings_goal_contributions_goal_fkey foreign key (goal_id, space_id)
    references public.savings_goals (id, space_id) on delete cascade
);

create index savings_goal_contributions_goal_idx on public.savings_goal_contributions (goal_id, contributed_on desc);

-- An account changing space: goals that linked it stay where they are, unlinked.
-- Runs inside move_account_to_space (the only way space_id changes), before the
-- row is updated, so the (account_id, space_id) key is released first.
create function public.unlink_goals_on_account_move() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.space_id is distinct from old.space_id then
    update public.savings_goals set account_id = null where account_id = old.id and space_id = old.space_id;
  end if;
  return new;
end $$;

create trigger accounts_unlink_goals before update of space_id on public.accounts
  for each row execute function public.unlink_goals_on_account_move();

-- ---------------------------------------------------------------------------
-- Row Level Security and grants
-- ---------------------------------------------------------------------------

alter table public.savings_goals enable row level security;
alter table public.savings_goal_contributions enable row level security;

create policy savings_goals_all on public.savings_goals for all to authenticated
  using (space_id in (select public.my_space_ids()))
  with check (space_id in (select public.my_space_ids()));

create policy savings_goal_contributions_select on public.savings_goal_contributions for select to authenticated
  using (space_id in (select public.my_space_ids()));
create policy savings_goal_contributions_insert on public.savings_goal_contributions for insert to authenticated
  with check (space_id in (select public.my_space_ids()) and created_by = (select auth.uid()));
create policy savings_goal_contributions_delete on public.savings_goal_contributions for delete to authenticated
  using (space_id in (select public.my_space_ids()));

-- The browser may choose a goal's space when creating it, never move it later.
-- Start from nothing: a database without 20261030000500 (default privileges
-- locked) would otherwise hand anon and authenticated every privilege here.
revoke all on public.savings_goals, public.savings_goal_contributions from anon, authenticated;
grant select, delete on public.savings_goals to authenticated;
grant insert (space_id, name, target_minor, target_date, icon, color, starts_on, account_id, account_basis)
  on public.savings_goals to authenticated;
grant update (name, target_minor, target_date, icon, color, starts_on, account_id, account_basis, completed_at, archived_at)
  on public.savings_goals to authenticated;

-- created_by is not granted: it always defaults to the caller. Contributions are
-- corrected by deleting and logging again, so there is no update grant.
grant select, delete on public.savings_goal_contributions to authenticated;
grant insert (space_id, goal_id, amount_minor, contributed_on, note) on public.savings_goal_contributions to authenticated;

-- ---------------------------------------------------------------------------
-- Progress view (security_invoker: the caller's RLS applies to every table)
-- ---------------------------------------------------------------------------

create view public.savings_goal_progress with (security_invoker = true) as
select g.id as goal_id,
       g.space_id,
       coalesce((select sum(c.amount_minor) from public.savings_goal_contributions c where c.goal_id = g.id), 0)::bigint
         as contributed_minor,
       (select count(*) from public.savings_goal_contributions c where c.goal_id = g.id)::integer as contribution_count,
       case when g.account_id is null then null else
         coalesce((select sum(t.amount_minor) from public.transactions t
                    where t.account_id = g.account_id
                      and t.removed_at is null
                      and t.effective_date >= g.starts_on), 0)
       end::bigint as account_growth_minor,
       a.balance_minor as account_balance_minor,
       a.balance_at as account_balance_at,
       a.name as account_name,
       a.currency as account_currency
  from public.savings_goals g
  left join public.accounts a on a.id = g.account_id;

revoke all on public.savings_goal_progress from anon, authenticated;
grant select on public.savings_goal_progress to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY INVOKER: RLS and column grants apply)
-- ---------------------------------------------------------------------------

create function public.add_goal_contribution(p_goal uuid, p_amount_minor bigint, p_on date default null, p_note text default null)
returns uuid
language plpgsql set search_path = '' as $$
declare
  v_space uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select g.space_id into v_space from public.savings_goals g
   where g.id = p_goal and g.space_id in (select public.my_space_ids());
  if v_space is null then
    raise exception 'Goal not found' using errcode = 'P0002';
  end if;
  insert into public.savings_goal_contributions (space_id, goal_id, amount_minor, contributed_on, note)
  values (v_space, p_goal, p_amount_minor, coalesce(p_on, current_date), nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.unlink_goals_on_account_move() from public, anon, authenticated;
revoke all on function public.add_goal_contribution(uuid, bigint, date, text) from public, anon;
grant execute on function public.add_goal_contribution(uuid, bigint, date, text) to authenticated;

grant all on public.savings_goals, public.savings_goal_contributions to service_role;
grant select on public.savings_goal_progress to service_role;
grant execute on function public.add_goal_contribution(uuid, bigint, date, text) to service_role;
