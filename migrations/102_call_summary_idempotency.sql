-- Call History / Call Information audit fix: /calls/end's call-summary
-- message insert had no idempotency guard at all, and is realistically
-- called twice per ordinary 1:1 call by design of the client — the party
-- who hangs up fires handleEndCall() from their own button press, and the
-- other party's handleEndCall() fires independently from Agora's
-- onUserOffline callback (neither gated by isInitiator) — both requests
-- carry the same call_log_id. Without a guard this produces two identical
-- "call ended" bubbles in the thread for a single call.
--
-- A partial unique index (call_log_id is only ever set on a call-summary
-- row — migration 059) makes the second insert fail with a unique
-- violation (23505) instead of silently succeeding twice; the API route
-- (calls.ts /calls/end) catches that specific error code and treats it as
-- "already recorded," not a failure.
--
-- This bug has already produced real duplicate rows in production (2
-- pairs found before this migration was written) -- these are the bug's
-- own byproduct, not legitimate distinct messages a user wrote, so it's
-- safe and correct to de-duplicate them (keeping the earliest of each
-- pair, matching whichever bubble the user saw first) before the unique
-- index can be created. No other message content is touched.
delete from p2p_messages a
  using p2p_messages b
  where a.call_log_id is not null
    and a.call_log_id = b.call_log_id
    and a.created_at > b.created_at;

create unique index if not exists idx_p2p_messages_call_log_unique
  on p2p_messages(call_log_id)
  where call_log_id is not null;