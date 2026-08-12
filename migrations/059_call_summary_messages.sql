-- 059: Call-summary system messages in conversations (see Prompt 2 STEP 6 —
-- "Audio call · 4m 32s" etc). p2p_messages.sender_id is already nullable,
-- so these are inserted with sender_id = null to mark them as system-
-- authored rather than attributing the summary to whichever party happened
-- to end the call.

alter table p2p_messages
  add column if not exists message_type text not null default 'text';

alter table p2p_messages
  add column if not exists call_log_id uuid references p2p_call_logs(id) on delete set null;

create index if not exists idx_p2p_messages_call_log on p2p_messages(call_log_id);

-- The caller's side (messages/[id].tsx) always has conversation_id in
-- scope already; the recipient's side only learns about the call from the
-- p2p_incoming_calls row (via realtime), which otherwise has no way to
-- know which conversation to post the eventual call-summary message into.
alter table p2p_incoming_calls
  add column if not exists conversation_id uuid references p2p_conversations(id) on delete set null;

-- The initiator creates the p2p_call_logs row up front (so there's exactly
-- one log per call, not one per participant) and passes its id along here
-- so the recipient's side can update/reference the same row.
alter table p2p_incoming_calls
  add column if not exists call_log_id uuid references p2p_call_logs(id) on delete set null;