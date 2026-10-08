-- 177: Discovery Search — Worldwide / Nearby with a search radius.
--
-- Additive only. Safe for every app build already installed: no grant is
-- removed, no existing column, policy or function changes. (Restricting
-- direct reads of other users' coordinates is migration 178, applied only
-- once the app build that stops using select("*") is the one in use.)
--
-- 1. PostGIS (Supabase's "extensions" schema) for real geographic distance.
-- 2. p2p_profiles.location_point: a STORED generated geography point built
--    from the existing latitude/longitude — the single source of truth the
--    location verifier already writes. NULL when either is missing or out
--    of range, so invalid data can never break a search. GiST-indexed.
-- 3. p2p_discover_peers(): the ONE Discovery search for both modes. Runs as
--    the owner so it can read coordinates internally; identity and the
--    Nearby origin come only from the caller's session (auth.uid() and their
--    own stored location) — the client never sends coordinates. Returns safe
--    profile fields only: no latitude, longitude or distance.
-- 4. p2p_my_coordinates(): the caller's OWN coordinates, so the app keeps
--    working (e.g. hemisphere-based tree seasons) once 178 removes direct
--    column reads.

create extension if not exists postgis with schema extensions;

alter table public.p2p_profiles
  add column if not exists location_point extensions.geography(Point, 4326)
  generated always as (
    case
      when latitude between -90 and 90 and longitude between -180 and 180
        then extensions.st_setsrid(
               extensions.st_makepoint(longitude::double precision, latitude::double precision),
               4326)::extensions.geography
    end
  ) stored;

create index if not exists p2p_profiles_location_point_gist
  on public.p2p_profiles using gist (location_point);

-- Discovery search. Visibility rules are explicit (the function bypasses
-- RLS to read coordinates) and at least as strict as profiles_select_scoped's
-- rule for ordinary viewers: public/peers profiles only, never admin or
-- official accounts, never the caller, and blocks hidden in BOTH directions
-- (the client-side query could only see blocks the viewer created).
create or replace function public.p2p_discover_peers(
  p_mode text default 'worldwide',
  p_radius_km integer default 50,
  p_name text default null,
  p_skills text[] default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  username text,
  full_name text,
  photo_url text,
  country text,
  city text,
  calling text,
  role text,
  gifts text[],
  skills text[]
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_origin extensions.geography;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  if v_me is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('worldwide', 'nearby') then
    raise exception 'INVALID_MODE' using errcode = '22023';
  end if;

  if p_mode = 'nearby' then
    if p_radius_km is null or p_radius_km < 5 or p_radius_km > 1000 then
      raise exception 'INVALID_RADIUS' using errcode = '22023';
    end if;
    select pr.location_point into v_origin from p2p_profiles pr where pr.id = v_me;
    if v_origin is null then
      -- The app shows "Nearby Search needs your location".
      raise exception 'LOCATION_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  return query
  select
    p.id,
    p.username,
    p.full_name,
    p.photo_url,
    case when p.show_country_on_profile is false then null else p.country end,
    case when p.show_country_on_profile is false then null else p.city end,
    nullif(btrim(p.calling), ''),
    p.role::text,
    coalesce(p.gifts, '{}'::text[]),
    coalesce(p.skills, '{}'::text[])
  from p2p_profiles p
  where p.id <> v_me
    and p.profile_visibility in ('public', 'peers')
    and coalesce(p.is_official_account, false) = false
    and not p2p_is_admin_or_official(p.id)
    and not exists (
      select 1 from p2p_user_blocks b
      where (b.blocker_id = v_me and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = v_me)
    )
    and (v_name is null or p.full_name ilike '%' || v_name || '%')
    and (p_skills is null or cardinality(p_skills) = 0 or p.skills && p_skills)
    and (
      p_mode = 'worldwide'
      or (p.location_point is not null
          and extensions.st_dwithin(p.location_point, v_origin, p_radius_km * 1000.0))
    )
  order by
    -- Nearby: closest first, in 5 km bands (coarse on purpose — the order
    -- must not become a precise distance oracle). Worldwide keeps the
    -- existing alphabetical order.
    case when p_mode = 'nearby'
      then ceil(extensions.st_distance(p.location_point, v_origin) / 5000.0) end nulls last,
    p.full_name
  limit v_limit;
end;
$$;

create or replace function public.p2p_my_coordinates()
returns table (latitude numeric, longitude numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.latitude, p.longitude from p2p_profiles p where p.id = auth.uid();
$$;

revoke all on function public.p2p_discover_peers(text, integer, text, text[], integer) from public, anon;
revoke all on function public.p2p_my_coordinates() from public, anon;
grant execute on function public.p2p_discover_peers(text, integer, text, text[], integer) to authenticated;
grant execute on function public.p2p_my_coordinates() to authenticated;
