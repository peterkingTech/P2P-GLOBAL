-- Fix: room_signal_* realtime broadcast authorization was completely
-- non-functional for every user, including the room's own host.
--
-- Discovered during live on-device validation testing (real authenticated
-- Supabase Realtime subscribe attempts, not migration/code inspection) —
-- see the "P2P GLOBAL PRODUCTION APK + LDPLAYER FULL RUNTIME VALIDATION"
-- pass. The room's own host, an active participant per
-- p2p_break_room_participants (left_at is null), was denied subscription
-- to their own room's signaling channel with CHANNEL_ERROR/Unauthorized.
--
-- Root cause: migration 093's "room participants can ..." policies compute
-- the room id via `substring(realtime.topic() from 13)`, which strips only
-- the `room_signal_` prefix (12 chars). But the Break Room channel name
-- itself is `room_${roomId}` (calls.ts, POST /calls/rooms), so the full
-- realtime topic is `room_signal_room_<roomId>` — a second `room_` prefix
-- remains after stripping the first 12 characters, so the extracted string
-- never matches p2p_break_room_participants.room_id (a bare uuid). This
-- silently failed 100% of the time for every caller (the SQL predicate
-- always evaluates false, not an error), which is why it was never caught
-- by earlier code-only review.
--
-- Fix: strip 17 characters (`room_signal_` + `room_` = 12 + 5) instead of
-- 12, i.e. substring(... from 18) instead of substring(... from 13).
-- circle_call_* policies are untouched — verified live and unaffected
-- (their channel name is circle_${circleId}, and migration 093's substring
-- offset of 20 already correctly accounts for the doubled circle_ prefix).

drop policy if exists "room participants can receive broadcast" on realtime.messages;
drop policy if exists "room participants can send broadcast" on realtime.messages;

create policy "room participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_room\_%' escape '\'
  and p2p_is_active_room_participant(substring(realtime.topic() from 18), (select auth.uid()))
);

create policy "room participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_room\_%' escape '\'
  and p2p_is_active_room_participant(substring(realtime.topic() from 18), (select auth.uid()))
);
