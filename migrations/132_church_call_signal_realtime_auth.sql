-- 132: church_call_signal_* private broadcast channels (reactions, raise
-- hand, chat delivery, moderation signals — see app/call/church.tsx) were
-- created with `private: true` but never given a matching realtime.
-- messages RLS policy. realtime.messages has RLS enabled by default
-- (same as every other private channel in this codebase —
-- circle_call_*/room_signal_*/family_worship_signal_*, migrations
-- 086/089/093/121), so with no matching policy every subscribe/send on
-- this channel is silently denied. Discovered live during Church Calls
-- Stage 2 testing: "Church Call realtime channel authorization failed
-- Error: Unauthorized" surfaced the moment a second participant sent a
-- reaction.
--
-- Exact same shape as 121_family_worship_signal_realtime_auth.sql:
-- authorization is "you're an active participant of THIS call," checked
-- via p2p_church_call_participants (not just general church membership).

create or replace function p2p_is_active_call_participant(p_call_id_text text, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from p2p_church_call_participants
    where call_id::text = p_call_id_text and user_id = p_user_id and left_at is null
  );
$$;

drop policy if exists "church call participants can receive broadcast" on realtime.messages;
create policy "church call participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'church\_call\_signal\_%' escape '\'
  and p2p_is_active_call_participant(substring(realtime.topic() from 20), (select auth.uid()))
);

drop policy if exists "church call participants can send broadcast" on realtime.messages;
create policy "church call participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'church\_call\_signal\_%' escape '\'
  and p2p_is_active_call_participant(substring(realtime.topic() from 20), (select auth.uid()))
);
