-- 121: family_worship_signal_* private broadcast channels (used for
-- Expressions/reactions, and as of this migration also the primary
-- session-state-sync path — see the "PRIMARY STATE-SYNC" comment in
-- app/family/worship/[sessionId].tsx) were created with `private: true`
-- but NEVER given a matching realtime.messages RLS policy. realtime.
-- messages has RLS enabled (same as every other private channel in this
-- codebase — circle_call_*/room_signal_*, migration 086/089/093), so with
-- no policy matching this topic prefix, every subscribe/send on this
-- channel has been silently denied by default-deny RLS since it shipped.
-- Discovered while investigating why postgres_changes wasn't delivering
-- session updates (a separate, already-fixed gap in migration 120) —
-- verifying the broadcast fallback surfaced this second, more fundamental
-- gap underneath it.
--
-- Exact same shape as 093_reapply_circle_room_realtime_auth.sql's
-- room_signal_ policies: authorization is "you're an active participant
-- of THIS session," checked via p2p_family_worship_participants (not just
-- general family membership) — mirrors room_signal_'s
-- p2p_is_active_room_participant check precisely.

create or replace function p2p_is_active_worship_participant(p_session_id_text text, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from p2p_family_worship_participants
    where session_id::text = p_session_id_text and user_id = p_user_id and left_at is null
  );
$$;

drop policy if exists "worship participants can receive broadcast" on realtime.messages;
create policy "worship participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'family\_worship\_signal\_%' escape '\'
  and p2p_is_active_worship_participant(substring(realtime.topic() from 23), (select auth.uid()))
);

drop policy if exists "worship participants can send broadcast" on realtime.messages;
create policy "worship participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'family\_worship\_signal\_%' escape '\'
  and p2p_is_active_worship_participant(substring(realtime.topic() from 23), (select auth.uid()))
);