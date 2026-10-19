CREATE OR REPLACE FUNCTION public.p2p_discover_peers(p_mode text DEFAULT 'worldwide'::text, p_radius_km integer DEFAULT 50, p_name text DEFAULT NULL::text, p_skills text[] DEFAULT NULL::text[], p_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid, username text, full_name text, photo_url text, country text, city text, calling text, role text, gifts text[], skills text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
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
$function$
