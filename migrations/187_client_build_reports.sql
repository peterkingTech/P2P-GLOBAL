-- 187: Which app build each signed-in user last ran — adoption evidence for
-- gated migrations (185) and for raising the minimum build (186).
--
-- DRAFT — NOT APPLIED to production. Validate on staging first. Additive and
-- independent of 179-186.
--
-- Builds that include components/ClientBuildReporter.tsx call
-- p2p_report_client_build() once per signed-in session with their native
-- build number (iOS CFBundleVersion / Android versionCode). Builds released
-- before it (everything up to and including iOS build 53) never report.
-- Therefore: a user who was active recently (p2p_profiles.last_active_at, set
-- by every build) but has no report — or a report below the required build —
-- is, by evidence, still running an older build:
--
--   select count(*) filter (where r.user_id is null)                       as active_never_reported,
--          count(*) filter (where r.build < :required_build)               as active_on_older_reported_build,
--          count(*)                                                        as active_total
--   from public.p2p_profiles p
--   left join public.p2p_client_build_reports r on r.user_id = p.id
--   where p.last_active_at > now() - interval '14 days';
--
-- Stored per user: platform, build number, first/last seen. Nothing else.
-- Clients can only write their OWN row through the function (identity =
-- auth.uid(), no user id parameter) and cannot read the table at all. A
-- client could report a false build for itself; that only misstates its own
-- adoption and grants nothing.

begin;

create table if not exists public.p2p_client_build_reports (
  user_id       uuid primary key references public.p2p_profiles(id) on delete cascade,
  platform      text not null check (platform in ('ios', 'android')),
  build         integer not null check (build > 0 and build <= 1000000),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

alter table public.p2p_client_build_reports enable row level security;
-- No policies: no client can select, insert, update or delete rows directly.
revoke all on table public.p2p_client_build_reports from public, anon, authenticated;

create or replace function public.p2p_report_client_build(p_platform text, p_build integer)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android')
     or p_build is null or p_build <= 0 or p_build > 1000000 then
    raise exception 'Invalid platform or build' using errcode = '22023';
  end if;
  insert into p2p_client_build_reports (user_id, platform, build)
  values (v_uid, p_platform, p_build)
  on conflict (user_id) do update
    set platform = excluded.platform, build = excluded.build, last_seen_at = now();
end;
$$;

revoke all on function public.p2p_report_client_build(text, integer) from public, anon;
grant execute on function public.p2p_report_client_build(text, integer) to authenticated;

commit;

-- Rollback (manual; reporting builds then get "function not found" and ignore it):
--   begin;
--   drop function if exists public.p2p_report_client_build(text, integer);
--   drop table if exists public.p2p_client_build_reports;
--   commit;
