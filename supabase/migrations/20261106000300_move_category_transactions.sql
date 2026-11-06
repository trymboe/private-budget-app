-- Move every transaction from one category to another, keeping both categories.
-- Unlike merge_categories, the source stays (it is not archived) and monthly budgets
-- are not touched. Learned merchant rules and pending suggestions follow the
-- transactions, so future suggestions go to the new category too.
-- A transaction split across both categories collapses into one allocation.
-- Works within one space: both categories must be in the same space you belong to.
-- Returns the number of transactions that moved.
create function public.move_category_transactions(p_source uuid, p_target uuid) returns integer
language plpgsql set search_path = '' as $$
declare
  v_source public.categories;
  v_target public.categories;
  v_space uuid;
  v_moved integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_source = p_target then
    raise exception 'Pick a different category' using errcode = '22023';
  end if;
  select * into v_source from public.categories
   where id = p_source and space_id in (select public.my_space_ids());
  select * into v_target from public.categories
   where id = p_target and space_id in (select public.my_space_ids()) for update;
  if v_source.id is null or v_target.id is null or v_target.archived_at is not null
     or v_source.space_id <> v_target.space_id then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  v_space := v_source.space_id;

  select count(distinct transaction_id) into v_moved
    from public.transaction_allocations where category_id = p_source and space_id = v_space;

  -- Rare: a split where the two parts cancel out. Dropping both keeps the sum right
  -- (the other parts already add up to the transaction amount).
  delete from public.transaction_allocations a
   using public.transaction_allocations src, public.transaction_allocations ta
   where src.category_id = p_source and ta.category_id = p_target
     and ta.transaction_id = src.transaction_id and src.space_id = v_space
     and ta.amount_minor + src.amount_minor = 0
     and a.id in (src.id, ta.id);
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

  update public.categorization_rules set category_id = p_target
   where category_id = p_source and space_id = v_space;
  update public.transactions set suggested_category_id = p_target
   where suggested_category_id = p_source and space_id = v_space;

  return v_moved;
end $$;

revoke all on function public.move_category_transactions(uuid, uuid) from public, anon;
grant execute on function public.move_category_transactions(uuid, uuid) to authenticated, service_role;
