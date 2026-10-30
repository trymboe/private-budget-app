-- Secure defaults for objects created by later migrations.
--
-- Supabase's default privileges give anon and authenticated rights on every new
-- table, sequence and function in public. On this project that includes TRUNCATE
-- on new tables, which ignores Row Level Security. Every migration here already
-- grants exactly what the app needs, so new objects start with no access at all.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, public;
