-- 198: Safeguards for children and teens (family roles 'child' / 'teen'),
-- enforced in the database so they hold for every path (API routes using the
-- service role and direct client writes alike).
--
--   1. Who counts: anyone whose role is 'child' or 'teen' in ANY family they
--      actively belong to ('child' wins over 'teen'). p2p_family_minor_role.
--   2. Direct messages and 1:1 calls: a child only with members of their own
--      families; a teen also with leaders (senior_pastor, discipleship_pastor,
--      small_group_leader) of a church the teen actively belongs to.
--      p2p_minor_contact_allowed, applied in p2p_can_contact_directly (the
--      existing gate used by p2p_start_direct_conversation, profiles.ts and
--      calls.ts) and on every new message in an existing direct conversation.
--      A responder to a help request the minor made is still reachable.
--      The existing adult/minor date-of-birth rule in
--      p2p_start_direct_conversation is unchanged and still applies.
--   3. Groups and rooms outside family/church: a child can't join or be
--      added to Peer Circles, peer groups or Break Rooms, or be invited into
--      calls or prayer gatherings with anyone outside the rules above. A teen
--      can only when the group's leader / host / inviter (and, for calls,
--      every participant) passes the rules. Family and church conversations,
--      Gatherings and church calls are unaffected.
--   4. (Gathering media — enforced in the API, routes/familyWorship.ts.)
--   5. Discovery: children never appear in p2p_discover_peers (people search
--      in the API is filtered too).
--
-- p2p_can_contact_directly and p2p_discover_peers are the LIVE production
-- definitions (pg_get_functiondef, 2026-10-18) with only the marked 198
-- additions; their existing grants are kept (CREATE OR REPLACE). The new
-- helpers are not callable by app users (minor status is private).
-- No existing row changes; production has no teen/child members today.

create or replace function public.p2p_family_minor_role(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (select 1 from p2p_family_members where user_id = p_user_id and status = 'active' and role = 'child') then 'child'
    when exists (select 1 from p2p_family_members where user_id = p_user_id and status = 'active' and role = 'teen') then 'teen'
  end;
$$;

-- May a and b contact each other directly (or share a call / group)?
-- True when neither is a minor. Otherwise each minor side must be allowed
-- by the rules for that minor.
create or replace function public.p2p_minor_contact_allowed(p_a uuid, p_b uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_a text := p2p_family_minor_role(p_a);
  v_b text := p2p_family_minor_role(p_b);
  v_share_family boolean;
begin
  if p_a is null or p_b is null then return false; end if;
  if p_a = p_b or (v_a is null and v_b is null) then return true; end if;
  select exists (
    select 1 from p2p_family_members f1 join p2p_family_members f2 on f1.family_id = f2.family_id
    where f1.user_id = p_a and f1.status = 'active' and f2.user_id = p_b and f2.status = 'active'
  ) into v_share_family;
  if v_share_family then return true; end if;
  -- Not family: only a teen with a leader of a church the teen belongs to.
  if v_a = 'child' or v_b = 'child' then return false; end if;
  if v_a = 'teen' and not exists (
    select 1 from p2p_church_members t join p2p_church_members l on l.church_id = t.church_id
    where t.user_id = p_a and t.is_active and l.user_id = p_b and l.is_active
      and l.role in ('senior_pastor', 'discipleship_pastor', 'small_group_leader')
  ) then return false; end if;
  if v_b = 'teen' and not exists (
    select 1 from p2p_church_members t join p2p_church_members l on l.church_id = t.church_id
    where t.user_id = p_b and t.is_active and l.user_id = p_a and l.is_active
      and l.role in ('senior_pastor', 'discipleship_pastor', 'small_group_leader')
  ) then return false; end if;
  return true;
end;
$$;

revoke all on function public.p2p_family_minor_role(uuid) from public, anon, authenticated;
revoke all on function public.p2p_minor_contact_allowed(uuid, uuid) from public, anon, authenticated;
grant execute on function public.p2p_family_minor_role(uuid) to service_role;
grant execute on function public.p2p_minor_contact_allowed(uuid, uuid) to service_role;

CREATE OR REPLACE FUNCTION public.p2p_can_contact_directly(p_user_a uuid, p_user_b uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  role_a text;
BEGIN
  IF p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_user_blocks b
    WHERE (b.blocker_id = p_user_a AND b.blocked_id = p_user_b)
       OR (b.blocker_id = p_user_b AND b.blocked_id = p_user_a)
  ) THEN
    RETURN false;
  END IF;

  SELECT role INTO role_a FROM p2p_profiles WHERE id = p_user_a;

  -- 198: a child or teen (family role) is contactable only within the
  -- minor rules — family members (teens: also their church's leaders), or a
  -- responder to a help request they made. No other branch below applies.
  IF p2p_family_minor_role(p_user_a) IS NOT NULL OR p2p_family_minor_role(p_user_b) IS NOT NULL THEN
    IF role_a IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
      SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = p_user_b
    ) THEN
      RETURN true;
    END IF;
    RETURN p2p_minor_contact_allowed(p_user_a, p_user_b);
  END IF;

  IF role_a = 'super_admin' THEN
    RETURN true;
  END IF;

  IF role_a IN ('church_leader', 'regional_admin', 'moderator', 'peer_guide', 'admin_help') AND EXISTS (
    SELECT 1 FROM p2p_help_requests hr WHERE hr.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_group_members gm1
    JOIN p2p_group_members gm2 ON gm1.group_id = gm2.group_id
    WHERE gm1.user_id = p_user_a AND gm2.user_id = p_user_b
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_discipleship_links dl
    WHERE dl.active = true
      AND ((dl.mentor_id = p_user_a AND dl.disciple_id = p_user_b)
        OR (dl.mentor_id = p_user_b AND dl.disciple_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_connection_requests cr
    WHERE cr.status = 'accepted' AND cr.request_type = 'connect'
      AND ((cr.from_user_id = p_user_a AND cr.to_user_id = p_user_b)
        OR (cr.from_user_id = p_user_b AND cr.to_user_id = p_user_a))
  ) THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM p2p_family_members fm1
    JOIN p2p_family_members fm2 ON fm1.family_id = fm2.family_id
    WHERE fm1.user_id = p_user_a AND fm1.status = 'active'
      AND fm2.user_id = p_user_b AND fm2.status = 'active'
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$function$;

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
    -- 198: children are never discoverable.
    and p2p_family_minor_role(p.id) is distinct from 'child'
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
$function$;

-- ── Messages in an existing direct conversation (rule 2) ─────────────────
create or replace function public.p2p_messages_minor_safeguard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_other uuid;
  v_role text;
begin
  if new.sender_id is null then return new; end if;
  if not exists (select 1 from p2p_conversations c where c.id = new.conversation_id and c.type = 'direct') then return new; end if;
  select m.user_id into v_other from p2p_conversation_members m where m.conversation_id = new.conversation_id and m.user_id <> new.sender_id limit 1;
  if v_other is null then return new; end if;
  if p2p_family_minor_role(new.sender_id) is null and p2p_family_minor_role(v_other) is null then return new; end if;
  if p2p_can_contact_directly(new.sender_id, v_other) then return new; end if;
  raise exception 'P2P_MINOR_SAFEGUARD: messaging this person is not permitted' using errcode = '42501';
end;
$$;

drop trigger if exists p2p_messages_000_minor_safeguard on public.p2p_messages;
create trigger p2p_messages_000_minor_safeguard
before insert on public.p2p_messages
for each row execute function public.p2p_messages_minor_safeguard();

-- ── Groups and rooms (rule 3) ─────────────────────────────────────────────
-- p_owner: the group's leader / host / inviter. Children: never. Teens: only
-- when the owner passes the minor rules (or is the teen themselves).
create or replace function public.p2p_minor_group_check(p_member uuid, p_owner uuid, p_what text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text := p2p_family_minor_role(p_member);
begin
  if v_role is null then return; end if;
  if v_role = 'child' then
    raise exception 'P2P_MINOR_SAFEGUARD: children can only join their family and church %', p_what using errcode = '42501';
  end if;
  if p_owner is not null and p_owner <> p_member and not p2p_minor_contact_allowed(p_member, p_owner) then
    raise exception 'P2P_MINOR_SAFEGUARD: this % is not available for teen accounts', p_what using errcode = '42501';
  end if;
end;
$$;

create or replace function public.p2p_circle_members_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.status, 'active') = 'active' and (tg_op = 'INSERT' or old.status is distinct from new.status or old.user_id is distinct from new.user_id) then
    perform p2p_minor_group_check(new.user_id, (select leader_id from p2p_peer_circles where id = new.circle_id), 'circle');
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_peer_circle_members_000_minor_safeguard on public.p2p_peer_circle_members;
create trigger p2p_peer_circle_members_000_minor_safeguard
before insert or update of status, user_id on public.p2p_peer_circle_members
for each row execute function public.p2p_circle_members_minor_safeguard();

create or replace function public.p2p_group_members_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform p2p_minor_group_check(new.user_id, (select peer_guide_id from p2p_groups where id = new.group_id), 'group');
  return new;
end;
$$;
drop trigger if exists p2p_group_members_000_minor_safeguard on public.p2p_group_members;
create trigger p2p_group_members_000_minor_safeguard
before insert or update of user_id, group_id on public.p2p_group_members
for each row execute function public.p2p_group_members_minor_safeguard();

create or replace function public.p2p_break_room_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform p2p_minor_group_check(new.user_id, (select host_id from p2p_break_rooms where id = new.room_id), 'room');
  return new;
end;
$$;
drop trigger if exists p2p_break_room_participants_000_minor_safeguard on public.p2p_break_room_participants;
create trigger p2p_break_room_participants_000_minor_safeguard
before insert or update of user_id, room_id on public.p2p_break_room_participants
for each row execute function public.p2p_break_room_minor_safeguard();

-- Call invitations ("Add someone to this call"): the invitee must be allowed
-- with the inviter AND with everyone already in the call — in both
-- directions, so an outsider can't be added to a call a child is in either.
create or replace function public.p2p_call_invitation_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_participants jsonb;
  v_p uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.invitee_id is not distinct from old.invitee_id then return new; end if;
  if new.status not in ('pending', 'accepted') then return new; end if;
  if not p2p_minor_contact_allowed(new.invitee_id, new.inviter_id) then
    raise exception 'P2P_MINOR_SAFEGUARD: this person can''t be added to this call' using errcode = '42501';
  end if;
  select participants into v_participants from p2p_call_logs where id = new.call_id;
  if jsonb_typeof(v_participants) = 'array' then
    for v_p in select (e #>> '{}')::uuid from jsonb_array_elements(v_participants) e
      where (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' loop
      if not p2p_minor_contact_allowed(new.invitee_id, v_p) then
        raise exception 'P2P_MINOR_SAFEGUARD: this person can''t be added to this call' using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_call_invitations_000_minor_safeguard on public.p2p_call_invitations;
create trigger p2p_call_invitations_000_minor_safeguard
before insert or update of status, invitee_id on public.p2p_call_invitations
for each row execute function public.p2p_call_invitation_minor_safeguard();

create or replace function public.p2p_prayer_invitation_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not p2p_minor_contact_allowed(new.recipient_id, new.requester_id) then
    raise exception 'P2P_MINOR_SAFEGUARD: this person can''t be invited' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_prayer_coord_invitations_000_minor_safeguard on public.p2p_prayer_coord_invitations;
create trigger p2p_prayer_coord_invitations_000_minor_safeguard
before insert or update of requester_id, recipient_id on public.p2p_prayer_coord_invitations
for each row execute function public.p2p_prayer_invitation_minor_safeguard();

-- Children can't create (lead / host) Circles, peer groups or Break Rooms
-- either — checked on the group row itself, so no half-created group is left.
create or replace function public.p2p_group_owner_minor_safeguard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  -- Owner column by table name (a direct new.<col> reference would fail on
  -- the tables that don't have that column).
  v_owner := (to_jsonb(new) ->> case tg_table_name when 'p2p_peer_circles' then 'leader_id' when 'p2p_groups' then 'peer_guide_id' when 'p2p_break_rooms' then 'host_id' end)::uuid;
  if v_owner is not null and p2p_family_minor_role(v_owner) = 'child' then
    raise exception 'P2P_MINOR_SAFEGUARD: children can only join their family and church groups' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists p2p_peer_circles_000_minor_safeguard on public.p2p_peer_circles;
create trigger p2p_peer_circles_000_minor_safeguard before insert or update of leader_id on public.p2p_peer_circles
for each row execute function public.p2p_group_owner_minor_safeguard();
drop trigger if exists p2p_groups_000_minor_safeguard on public.p2p_groups;
create trigger p2p_groups_000_minor_safeguard before insert or update of peer_guide_id on public.p2p_groups
for each row execute function public.p2p_group_owner_minor_safeguard();
drop trigger if exists p2p_break_rooms_000_minor_safeguard on public.p2p_break_rooms;
create trigger p2p_break_rooms_000_minor_safeguard before insert or update of host_id on public.p2p_break_rooms
for each row execute function public.p2p_group_owner_minor_safeguard();

revoke all on function public.p2p_messages_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_group_owner_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_minor_group_check(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.p2p_circle_members_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_group_members_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_break_room_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_call_invitation_minor_safeguard() from public, anon, authenticated;
revoke all on function public.p2p_prayer_invitation_minor_safeguard() from public, anon, authenticated;

-- Rollback (restores the pre-198 behaviour):
--   drop trigger if exists p2p_messages_000_minor_safeguard on public.p2p_messages;
--   drop trigger if exists p2p_peer_circle_members_000_minor_safeguard on public.p2p_peer_circle_members;
--   drop trigger if exists p2p_group_members_000_minor_safeguard on public.p2p_group_members;
--   drop trigger if exists p2p_break_room_participants_000_minor_safeguard on public.p2p_break_room_participants;
--   drop trigger if exists p2p_call_invitations_000_minor_safeguard on public.p2p_call_invitations;
--   drop trigger if exists p2p_prayer_coord_invitations_000_minor_safeguard on public.p2p_prayer_coord_invitations;
--   drop trigger if exists p2p_peer_circles_000_minor_safeguard on public.p2p_peer_circles;
--   drop trigger if exists p2p_groups_000_minor_safeguard on public.p2p_groups;
--   drop trigger if exists p2p_break_rooms_000_minor_safeguard on public.p2p_break_rooms;
--   then re-run the pre-198 definitions of p2p_can_contact_directly and
--   p2p_discover_peers (kept with the restore test: m198/*.sql), and drop the
--   new p2p_*minor* functions.
