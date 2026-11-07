-- Account balances, as honest as the bank is about them.
--
-- accounts.balance_minor and accounts.balance_at already hold the latest balance
-- and when the app read it. Banks report several balances (booked, available,
-- expected) and each one applies to a date that can be earlier than the moment
-- we asked (a "closing booked" balance is yesterday's close). Home shows money in
-- accounts with "updated X ago", so keep what the bank actually said:
--
--   * balance_type: the ISO 20022 balance type the bank reported (CLBD, ITBD,
--     ITAV, XPCD, ...), so the UI can say "booked" or "available".
--   * balance_reference_date: the date the bank says the balance applies to,
--     when it gives one.
--
-- Visibility is unchanged: the table-level select grant and accounts_select
-- (space_id in my_space_ids()) cover the new columns, so a balance is visible
-- exactly where its account is. The browser's update grant stays limited to
-- (name, is_synced, include_in_budget); only the server's sync writes balances.

alter table public.accounts
  add column balance_type text check (balance_type ~ '^[A-Z]{4}$'),
  add column balance_reference_date date;

-- A balance always says when it was read.
alter table public.accounts
  add constraint accounts_balance_read_at check (balance_minor is null or balance_at is not null);

comment on column public.accounts.balance_minor is 'Latest balance the bank reported, in minor units of accounts.currency.';
comment on column public.accounts.balance_at is 'When the app read balance_minor from the bank.';
comment on column public.accounts.balance_type is 'ISO 20022 balance type the bank reported (e.g. CLBD closing booked, ITAV interim available).';
comment on column public.accounts.balance_reference_date is 'Date the bank says the balance applies to, if it said.';
