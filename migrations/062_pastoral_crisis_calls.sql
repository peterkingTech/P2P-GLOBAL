-- 062: Pastoral quick-call outcomes, crisis-call escalation chain, and call
-- history's conversation link.

-- Which peer guide was notified (needed so /pastoral-care/guide-alerts can
-- find "my" pending alerts — the notified boolean alone doesn't say who),
-- plus the post-call 3-option outcome the peer guide logs after calling.
alter table p2p_pastoral_care_log
  add column if not exists peer_guide_id uuid references auth.users(id) on delete set null;
alter table p2p_pastoral_care_log
  add column if not exists call_outcome text; -- 'reached_them'|'left_message'|'no_answer'
alter table p2p_pastoral_care_log
  add column if not exists call_outcome_at timestamptz;
create index if not exists idx_p2p_pastoral_care_log_peer_guide on p2p_pastoral_care_log(peer_guide_id);

-- Crisis-call escalation: a ringing crisis call unanswered for 5 minutes
-- spawns one escalated call (to a church admin) on the SAME channel, so
-- whoever answers first joins the person already waiting. escalated_from_id
-- both links the chain and stops the sweep from escalating an escalation.
alter table p2p_incoming_calls
  add column if not exists escalated_from_id uuid references p2p_incoming_calls(id) on delete set null;
create index if not exists idx_p2p_incoming_calls_escalated_from on p2p_incoming_calls(escalated_from_id);

-- Lets call history deep-link "tap to open the conversation" without a join
-- through p2p_incoming_calls/p2p_messages.
alter table p2p_call_logs
  add column if not exists conversation_id uuid references p2p_conversations(id) on delete set null;