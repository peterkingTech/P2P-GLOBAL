-- 184: No anonymous (signed-out) access to p2p_profiles.
--
-- DRAFT — NOT APPLIED to production. Validate on staging first. Independent
-- of 179-183. Touches no data, no RLS policy and nothing for signed-in users.
--
-- Found 2026-10-12 (read-only production check, counts only): the anon role
-- (the public key every app build ships with) holds table-level SELECT on
-- p2p_profiles, and profiles_select_scoped is granted TO public, so a caller
-- with no account could read every 'public'/'peers' profile — including
-- email, date_of_birth and latitude (34 of 42 rows were readable).
--
-- No signed-out screen reads p2p_profiles (login/register/forgot/reset/join/
-- room-invite/church screens checked; username availability goes through the
-- API server with the service role), and signed-in requests use the
-- authenticated role, so every installed build is unaffected.
-- Fix: remove every anon privilege on p2p_profiles (table- and column-level).
--
-- ORDERING with migration 178 (coordinate privacy, gated on app builds):
-- 178 re-grants column SELECT to anon. If 178 is applied after this file,
-- re-apply this file afterwards (it is idempotent).
--
-- Still open (needs an app build, tracked separately): signed-in users can
-- read other visible users' email/date_of_birth. That needs own-profile
-- sensitive fields served by a function, like p2p_my_coordinates().

begin;

revoke all on table public.p2p_profiles from anon;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_profiles';
  execute format('revoke select (%s), insert (%s), update (%s), references (%s) on table public.p2p_profiles from anon', cols, cols, cols, cols);
end $$;

commit;

-- Rollback (manual; restores the previous anonymous access):
--   begin;
--   grant delete, references, select, trigger, truncate on table public.p2p_profiles to anon;
--   commit;
