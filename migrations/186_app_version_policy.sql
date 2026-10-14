-- 186: Server-controlled minimum supported app build (for FUTURE builds).
--
-- DRAFT — NOT APPLIED to production. Validate on staging first. Additive and
-- independent of 179-185 (touches no existing table, policy or function).
--
-- Builds that include the version check (components/AppVersionGate.tsx) read
-- their platform's row at launch and when returning to the foreground. If
-- the build's native build number (iOS CFBundleVersion; Android versionCode
-- once the app can read it) is BELOW min_supported_build, the app shows an
-- "Update required" screen instead of the app. Builds released before the
-- check existed (everything up to and including iOS build 53) never read this
-- table and cannot be stopped by it.
--
-- min_supported_build starts NULL = no enforcement. It is raised by hand
-- (SQL editor / service role) only after the newer build is verified and
-- available to every user, e.g.:
--   update public.p2p_app_version_policy
--     set min_supported_build = <verified build>, updated_at = now()
--   where platform = 'ios';
-- Lowering it, or setting NULL, releases older builds again immediately.
--
-- Readable by everyone (it is shown before sign-in); writable by nobody
-- through the app. update_url is limited to official store/TestFlight
-- destinations so the screen can never send users anywhere else.

begin;

create table if not exists public.p2p_app_version_policy (
  platform            text primary key check (platform in ('ios', 'android')),
  min_supported_build integer check (min_supported_build is null or min_supported_build > 0),
  update_url          text check (
                        update_url is null
                        or update_url ~ '^https://(apps\.apple\.com|testflight\.apple\.com)/'
                        or update_url ~ '^itms-(apps|beta)://'
                        or update_url ~ '^https://play\.google\.com/store/apps/details\?id=com\.amentech\.p2pglobaldiscipleshipnetwork(&|$)'
                      ),
  message             text check (message is null or char_length(message) <= 300),
  updated_at          timestamptz not null default now()
);

alter table public.p2p_app_version_policy enable row level security;

drop policy if exists "app_version_policy_read" on public.p2p_app_version_policy;
create policy "app_version_policy_read" on public.p2p_app_version_policy
  for select to anon, authenticated
  using (true);

revoke all on table public.p2p_app_version_policy from public, anon, authenticated;
grant select on table public.p2p_app_version_policy to anon, authenticated;

-- One row per platform, no minimum (nothing is enforced until set explicitly).
insert into public.p2p_app_version_policy (platform) values ('ios'), ('android')
on conflict (platform) do nothing;

commit;

-- Rollback (manual; builds with the check then treat the policy as unknown
-- and keep working):
--   begin;
--   drop table if exists public.p2p_app_version_policy;
--   commit;
