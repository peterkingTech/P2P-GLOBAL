-- URGENT FIX #2 for the same regression chain (089 -> 090 -> this).
--
-- Migration 090 fixed the uuid-cast exception, but a second, distinct bug
-- remained: realtime.messages' circle_call_ policy runs a raw EXISTS
-- subquery against p2p_peer_circle_members. That table has its own RLS
-- policy ("Members can view their circle roster") which is ITSELF
-- self-referential (it queries p2p_peer_circle_members again, aliased, to
-- check "is the caller a member of the same circle as this row" — a
-- normal and safe pattern for a direct top-level query against that
-- table). But evaluating it a SECOND time, from within a completely
-- different top-level query (realtime.messages' policy), triggers
-- Postgres's recursion guard: "infinite recursion detected in policy for
-- relation p2p_peer_circle_members" — confirmed by directly simulating the
-- authenticated role's exact query against realtime.messages, which is
-- what a live subscribe attempt does, and which is why EVERY topic
-- (including Study Together's, already fixed in 086) was failing: the
-- combined OR'd policy expression across all of realtime.messages'
-- policies includes this one, and the thrown recursion error aborted
-- evaluation of the whole expression regardless of which topic was being
-- checked.
--
-- Fix: reuse this codebase's existing established pattern for exactly this
-- situation (p2p_is_church_member, p2p_is_peer, etc.) — a narrowly-scoped
-- SECURITY DEFINER helper function. SECURITY DEFINER functions run as
-- their owner (the migration-running role, which owns the table and is
-- therefore exempt from its own RLS by default), so querying
-- p2p_peer_circle_members / p2p_break_room_participants from inside one
-- never re-enters those tables' RLS policies at all, eliminating the
-- recursion path entirely rather than working around it.

-- p_circle_id_text/p_room_id_text are TEXT, not uuid, and compared via
-- circle_id::text / room_id::text — NOT via casting the incoming value to
-- uuid. A non-matching realtime topic (e.g. Study Together's study_p2p_...)
-- yields an arbitrary, non-UUID-shaped text fragment at the same substring
-- offset; casting THAT to uuid throws (exactly the migration 089 -> 090
-- bug), whereas a text/text comparison simply evaluates to false.
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
  and p2p_is_active_circle_member(
    substring(realtime.topic() from 20),
    (select auth.uid())
  )
);

create policy "circle call members can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'circle\_call\_circle\_%' escape '\'
  and p2p_is_active_circle_member(
    substring(realtime.topic() from 20),
    (select auth.uid())
  )
);

create policy "room participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and p2p_is_active_room_participant(
    substring(realtime.topic() from 13),
    (select auth.uid())
  )
);

create policy "room participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'room\_signal\_%' escape '\'
  and p2p_is_active_room_participant(
    substring(realtime.topic() from 13),
    (select auth.uid())
  )
);