-- Re-applies migration 091's circle_call_/room_signal_ realtime
-- authorization, which migration 092 rolled back under a false alarm: the
-- "Study Together is still broken" signal that prompted 092 turned out to
-- be an expired test JWT in the test harness (confirmed via the actual
-- subscribe error detail, "InvalidJWTToken: Token has expired"), not a
-- real regression — a fresh token immediately subscribed successfully,
-- proving migration 091's fixes (090's uuid-cast bug, 091's RLS recursion
-- bug) were already correct and Study Together was never actually broken
-- by them. This migration is byte-identical to 091's functions/policies.

create or replace function p2p_is_active_circle_member(p_circle_id_text text, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from p2p_peer_circle_members
    where circle_id::text = p_circle_id_text and user_id = p_user_id and status = 'active'
  );
$$;

create or replace function p2p_is_active_room_participant(p_room_id_text text, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from p2p_break_room_participants
    where room_id::text = p_room_id_text and user_id = p_user_id and left_at is null
  );
$$;

create policy "circle call members can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and p2p_is_active_circle_member(substring(realtime.topic() from 20), (select auth.uid()))
);

create policy "circle call members can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and p2p_is_active_circle_member(substring(realtime.topic() from 20), (select auth.uid()))
);

create policy "room participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and p2p_is_active_room_participant(substring(realtime.topic() from 13), (select auth.uid()))
);

create policy "room participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and p2p_is_active_room_participant(substring(realtime.topic() from 13), (select auth.uid()))
);