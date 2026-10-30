-- Saving budget amounts from the app.
--
-- PostgREST's upsert turns into ON CONFLICT DO UPDATE SET <every column sent>,
-- which needs UPDATE on user_id, category_id and month. The browser role may only
-- update amount_minor (see row_level_security), so the upsert was refused with
-- 42501. This function upserts and only ever updates amount_minor. It runs as the
-- caller, so RLS and the column grants still apply.

create function public.set_month_budgets(p_month date, p_amounts jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception 'Month must be the first day of the month' using errcode = '22023';
  end if;
  if jsonb_typeof(p_amounts) <> 'object' then
    raise exception 'Amounts must be an object of category id to amount' using errcode = '22023';
  end if;

  insert into public.monthly_budgets (user_id, category_id, month, amount_minor)
  select v_user, a.key::uuid, p_month, (a.value #>> '{}')::bigint
    from jsonb_each(p_amounts) a
  on conflict (user_id, category_id, month) do update set amount_minor = excluded.amount_minor;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.set_month_budgets(date, jsonb) from public, anon;
grant execute on function public.set_month_budgets(date, jsonb) to authenticated;
