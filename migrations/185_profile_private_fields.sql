-- 185: Signed-in users can no longer read other people's private profile fields.
--
-- DRAFT — NOT APPLIED to production. GATED: apply only after the app build that
-- loads the user's own private fields through p2p_my_private_profile() (and
-- the admin Team screen through p2p_admin_team_directory()) is the build
-- everyone runs. Installed builds up to and including iOS build 53 read
-- email and date_of_birth directly when loading the signed-in profile, which
-- this migration makes fail (sign-in would load no profile).
-- Independent of 179-184; must not be combined with 180-183. Supersedes the
-- column-grant part of the never-applied migration 178: do NOT apply 178
-- after this file (178 would re-grant these columns, and grant anon again).
--
-- Field classes (p2p_profiles):
--   owner-only  email, date_of_birth, latitude, longitude, location_point,
--               send_read_receipts
--               - the owner reads email/date_of_birth via p2p_my_private_profile(),
--                 coordinates via p2p_my_coordinates() (177), the read-receipt
--                 preference via p2p_get_my_read_receipts() (179);
--               - the owner still WRITES them exactly as before (UPDATE/INSERT
--                 column grants from 174 are not touched).
--   privileged  email of other users: super_admin / admin_supervisor only,
--               via p2p_admin_team_directory() (the admin Team screen's gate),
--               never more rows than that role could already see.
--   public      every other column, for signed-in users, with RLS rows
--               unchanged (profiles_select_scoped is not touched).
-- anon keeps no access at all (184). SECURITY DEFINER code (receipts, DM
-- start, discovery, API server via service role) is unaffected.

begin;

-- ── 1. Column-level SELECT for signed-in users: everything except private ──
revoke select on table public.p2p_profiles from authenticated;
do $$
declare cols text; n integer;
begin
  -- clear any earlier column-level SELECT grants first (none expected)
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns where table_schema = 'public' and table_name = 'p2p_profiles';
  execute format('revoke select (%s) on table public.p2p_profiles from authenticated', cols);

  select string_agg(quote_ident(column_name), ', ' order by ordinal_position), count(*) into cols, n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'p2p_profiles'
    and column_name not in ('email', 'date_of_birth', 'latitude', 'longitude', 'location_point', 'send_read_receipts');
  execute format('grant select (%s) on table public.p2p_profiles to authenticated', cols);
  raise notice 'migration 185: % public profile columns readable by signed-in users; 6 owner-only columns withheld', n;
end $$;

-- ── 2. Owner-only fields for the caller (no parameters: identity = auth.uid())
create or replace function public.p2p_my_private_profile()
returns table (email text, date_of_birth date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.email, p.date_of_birth from p2p_profiles p where p.id = auth.uid();
$$;

-- ── 3. Privileged: admin Team directory (id, name, email, role only) ───────
create or replace function public.p2p_admin_team_directory()
returns table (id uuid, full_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_role text := p2p_current_role();
begin
  if v_uid is null or v_role is null or v_role not in ('super_admin', 'admin_supervisor') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return query
    select p.id, p.full_name, p.email, p.role::text
    from p2p_profiles p
    where v_role = 'super_admin'
       or p.id = v_uid
       -- admin_supervisor: no wider than the visibility rule it already had
       or (p.profile_visibility in ('public', 'peers') and not p2p_is_admin_or_official(p.id))
    order by p.full_name nulls last, p.id;
end;
$$;

revoke all on function public.p2p_my_private_profile() from public, anon;
revoke all on function public.p2p_admin_team_directory() from public, anon;
grant execute on function public.p2p_my_private_profile() to authenticated;
grant execute on function public.p2p_admin_team_directory() to authenticated;

commit;

-- Rollback (manual; restores signed-in read access to every column):
--   begin;
--   drop function if exists public.p2p_admin_team_directory();
--   drop function if exists public.p2p_my_private_profile();
--   do $$ declare cols text; begin
--     select string_agg(quote_ident(column_name), ', ') into cols from information_schema.columns
--       where table_schema = 'public' and table_name = 'p2p_profiles';
--     execute format('revoke select (%s) on table public.p2p_profiles from authenticated', cols);
--   end $$;
--   grant select on table public.p2p_profiles to authenticated;
--   commit;
