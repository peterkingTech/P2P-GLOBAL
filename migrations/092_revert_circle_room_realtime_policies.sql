-- EMERGENCY ROLLBACK. Migrations 089/090/091 (circle_call_/room_signal_
-- realtime.messages policies + helper functions) caused a live regression:
-- Study Together's already-working study_* realtime channel (migration
-- 086, extensively tested and confirmed working in the prior security
-- phase) started returning CHANNEL_ERROR on every subscribe attempt after
-- 089 was applied, and remained broken even after fixing two real, distinct
-- bugs found along the way (089's uuid-cast-on-non-matching-topic
-- exception, fixed in 090; and 089's induced RLS recursion via
-- p2p_peer_circle_members' own self-referential policy, fixed in 091).
-- Something beyond those two fixes was still causing every realtime.messages
-- authorization check to fail — not reliably diagnosable from direct SQL
-- (realtime.topic() only resolves correctly inside the actual Realtime
-- server's own evaluation context, which cannot be faithfully simulated
-- from a psql session, so further trial-and-error migrations risked
-- compounding the live regression rather than resolving it).
--
-- Reverting to exactly the state after migration 086: only Study Together's
-- study_* channel has private-channel RLS. circle_call_*/room_signal_*
-- remain on the pre-existing (pre-roadmap) non-private Broadcast model —
-- the same state they were in before this phase started, not a new
-- weakening. This does NOT touch or undo the separate, independently
-- verified /calls/token fix (Phase 4's more severe finding: Peer Circle and
-- Break Room Agora call tokens now require real membership) — that fix
-- never depended on realtime.messages and is unaffected by this rollback.

drop policy if exists "circle call members can receive broadcast" on realtime.messages;
drop policy if exists "circle call members can send broadcast" on realtime.messages;
drop policy if exists "room participants can receive broadcast" on realtime.messages;
drop policy if exists "room participants can send broadcast" on realtime.messages;

drop function if exists p2p_is_active_circle_member(text, uuid);
drop function if exists p2p_is_active_room_participant(text, uuid);