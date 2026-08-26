-- Study Together Security Hardening: Realtime channel authorization.
--
-- INVESTIGATION (done before writing this): the only Broadcast channel used
-- by Study Together is `study_${channelName}` (useStudySession.ts), carrying
-- section-position, discussion-text, and Scripture-share signals for both
-- 1:1 and 3-6 person group study (the channel name is always the underlying
-- p2p_ call's channel_name — group Study Together does not use a different
-- channel). It was created without `private: true`, so Supabase Realtime
-- never checked any authorization for it — realtime.messages already had
-- row_security enabled (Supabase's default) but zero policies, which for a
-- NON-private channel is irrelevant anyway: legacy/public broadcast bypasses
-- realtime.messages entirely. Anyone with the (public, bundled-in-the-app)
-- anon key who could compute or intercept a channel name could listen in.
-- This predates C3 — the 1:1 implementation used the exact same pattern.
--
-- Two other Broadcast channels exist in this app (circle_call_<channelName>
-- for Peer Circle group calls, room_signal_<roomId> for Break Rooms). They
-- are NOT touched by this migration or this phase — out of the stated scope
-- (Study Together only), and setting private:true only on the `study_`
-- channel client-side (see useStudySession.ts) means these policies below
-- have zero effect on them regardless.
--
-- AUTHORIZATION MODEL: reuses the exact same source of truth C1's
-- /calls/token authorization already relies on — p2p_call_logs.participants
-- (jsonb array) and status = 'initiated'. This is deliberately CALL-scoped,
-- not study-session-scoped: the channel connects for the whole lifetime of
-- the call screen (useStudySession is mounted unconditionally, not only
-- once Study Together has started), so gating on an ACTIVE p2p_study_sessions
-- row would incorrectly block the very first `study_start` broadcast the
-- leader sends to create that row. A participant leaving the STUDY (but not
-- the call) is still a legitimate call participant and may rejoin the study
-- later, so their broadcast access correctly persists — the separate
-- study-session-active check already lives in the HTTP API (GET
-- .../study/current), not here.
create policy "study channel participants can receive broadcast"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and realtime.topic() like 'study\_%' escape '\'
  and exists (
    select 1 from p2p_call_logs
    where channel_name = substring(realtime.topic() from 7)
      and status = 'initiated'
      and participants ? (select auth.uid())::text
  )
);

create policy "study channel participants can send broadcast"
on realtime.messages
for insert
to authenticated
with check (
  extension = 'broadcast'
  and realtime.topic() like 'study\_%' escape '\'
  and exists (
    select 1 from p2p_call_logs
    where channel_name = substring(realtime.topic() from 7)
      and status = 'initiated'
      and participants ? (select auth.uid())::text
  )
);