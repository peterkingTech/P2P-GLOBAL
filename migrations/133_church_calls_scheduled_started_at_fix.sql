-- 133: Fix p2p_church_calls.started_at for scheduled calls.
--
-- Discovered live during Stage 3 testing: migration 130 defined
-- started_at as `not null default now()`, which was correct when every
-- call was created already-live (Stage 1). Now that 'scheduled' calls can
-- be inserted with no real start yet, that default silently stamped
-- started_at with the SCHEDULING time (not the real start time) —
-- misleading data, even though no current UI path reads it for a
-- scheduled-status call (the Upcoming list reads scheduled_start_at
-- instead). Both /churches/:churchId/calls (live-start) and
-- /churches/calls/:callId/start (scheduled->live transition) already
-- explicitly set started_at themselves, so removing the default changes
-- nothing about their behavior — it only stops a scheduled call from
-- getting a false started_at before it actually starts.

alter table p2p_church_calls alter column started_at drop not null;
alter table p2p_church_calls alter column started_at drop default;

-- Backfill: any currently-scheduled call already has a bogus started_at
-- from the old default — null it out now that the column permits null.
update p2p_church_calls set started_at = null where status = 'scheduled';
