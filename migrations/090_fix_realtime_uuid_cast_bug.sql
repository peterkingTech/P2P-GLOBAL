-- URGENT FIX for a regression introduced by migration 089.
--
-- Migration 089's circle_call_/room_signal_ policies cast the substring
-- extracted from realtime.topic() TO uuid (`(substring(...))::uuid`) to
-- compare against p2p_peer_circle_members.circle_id / p2p_break_room_
-- participants.room_id. PostgreSQL does NOT guarantee left-to-right
-- short-circuit evaluation of AND/OR operands (documented behavior, not a
-- bug in Postgres) — so the `like 'circle\_call\_circle\_%'` guard did not
-- reliably prevent the ::uuid cast from being attempted against topics
-- that don't match, e.g. Study Together's `study_p2p_<uuid>_<uuid>`
-- topics. That cast throws "invalid input syntax for type uuid" for any
-- non-matching topic, and because PERMISSIVE policies on the same table
-- are combined into one OR'd expression, that thrown error broke
-- authorization for EVERY topic on realtime.messages — including
-- Study Together's already-working study_* channel (confirmed via a live
-- regression check immediately after applying 089, which is what caught
-- this).
--
-- Fix: compare in TEXT space instead of casting the extracted substring to
-- uuid (`circle_id::text = substring(...)` instead of
-- `circle_id = substring(...)::uuid`) — a text/text comparison can never
-- throw for a mismatched or malformed string, it simply evaluates to
-- false, so a non-matching topic (including study_* ones) now safely
-- fails the comparison instead of raising an exception. This mirrors why
-- migration 086 (Study Together) never had this bug: p2p_call_logs.
-- channel_name is already `text`, so no cast was ever involved there.

drop policy "circle call members can receive broadcast" on realtime.messages;
drop policy "circle call members can send broadcast" on realtime.messages;
drop policy "room participants can receive broadcast" on realtime.messages;
drop policy "room participants can send broadcast" on realtime.messages;

create policy "circle call members can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and exists (
    select 1 from p2p_peer_circle_members
    where circle_id::text = substring(realtime.topic() from 20)
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
    where circle_id::text = substring(realtime.topic() from 20)
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
    where room_id::text = substring(realtime.topic() from 13)
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
    where room_id::text = substring(realtime.topic() from 13)
      and user_id = (select auth.uid())
      and left_at is null
  )
);