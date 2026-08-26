-- Security roadmap Phase 4 — Realtime authorization for circle_call_* and
-- room_signal_* (the same class of gap already fixed for Study Together's
-- study_* channel in migration 086: Broadcast channels opened without
-- `private: true` bypass realtime.messages RLS entirely, so anyone with the
-- public anon key who could compute/intercept a topic name could subscribe).
--
-- circle_call_<channelName> — channelName is always `circle_<circleId>`
-- (see /calls/circle-channel and circles.ts's start-session), so the full
-- topic is `circle_call_circle_<circleId>`. Peer Circles are a closed
-- membership model (p2p_peer_circle_members, status='active'), matching
-- the same membership check just added to /calls/token for the Agora
-- channel itself.
--
-- room_signal_<roomId> — Break Rooms are intentionally OPEN-join (any
-- authenticated user may join a live community room via
-- /calls/rooms/:roomId/join, which is exactly what inserts the
-- p2p_break_room_participants row) — so authorization here is "has an
-- active participant row for this room," not a closed membership list.
-- This is a materially lower-severity finding than Study Together's or
-- Peer Circles' (a Break Room's whole purpose is broad, low-barrier
-- participation), but still shouldn't be reachable by an unauthenticated
-- client or a user who was never in the room at all.

create policy "circle call members can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and exists (
    select 1 from p2p_peer_circle_members
    where circle_id = (substring(realtime.topic() from 20))::uuid
      and user_id = (select auth.uid())
      and status = 'active'
  )
);

create policy "circle call members can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and exists (
    select 1 from p2p_peer_circle_members
    where circle_id = (substring(realtime.topic() from 20))::uuid
      and user_id = (select auth.uid())
      and status = 'active'
  )
);

create policy "room participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and exists (
    select 1 from p2p_break_room_participants
    where room_id = (substring(realtime.topic() from 13))::uuid
      and user_id = (select auth.uid())
      and left_at is null
  )
);

create policy "room participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and exists (
    select 1 from p2p_break_room_participants
    where room_id = (substring(realtime.topic() from 13))::uuid
      and user_id = (select auth.uid())
      and left_at is null
  )
);