-- Calls were never actually reaching the recipient: p2p_incoming_calls,
-- p2p_break_rooms, and p2p_break_room_participants were all created in
-- migration 058 but never added to the supabase_realtime publication
-- (unlike p2p_messages in 012 and p2p_peer_confirmations in 036, which both
-- got the ALTER PUBLICATION line). Verified live against the actual DB —
-- all three were absent from pg_publication_tables.
--
-- DataContext.tsx's incoming-call listener (INSERT on p2p_incoming_calls
-- filtered by recipient_id) and app/call/audio.tsx's/video.tsx's
-- caller-side decline/missed watcher (UPDATE on the same table) both
-- depend on p2p_incoming_calls being published — without it, the
-- recipient's app is never notified of a ringing call at all, so the
-- caller's screen just shows "Calling..." forever with nothing on the
-- other end. app/call/room.tsx's live-room sync (speaking mode, current
-- speaker, "room ended", participant roster) depends on the other two the
-- same way. This is the actual fix for calls "not going through" — the
-- Agora/token layer was already working correctly; the call simply never
-- reached the other person.

ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_incoming_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_break_rooms;
ALTER PUBLICATION supabase_realtime ADD TABLE public.p2p_break_room_participants;