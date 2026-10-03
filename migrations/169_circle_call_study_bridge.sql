-- P2P Calling Stage 25C — Circle Call / Study Together bridge (schema only).
--
-- Background (Stages 23-25C-A of the group-calling authorization/
-- architecture review): Peer Circle group calls have never created a
-- p2p_call_logs row, unlike every other call type in this codebase, which
-- meant Study Together's server-authoritative live-session primitive
-- (p2p_study_sessions, anchored to call_log_id) structurally could not be
-- reused for Peer Circles. This migration only adds the additive schema
-- pieces the approved design needs; it does not create any call/session
-- lifecycle code, does not touch Agora, and does not migrate group.tsx.
-- That application-level work is explicitly deferred to a later stage.
--
-- Every change below is additive: new nullable columns, new tables, new
-- indexes. No existing column is dropped or retyped, no existing row is
-- modified, no existing RLS policy is touched, no existing migration file
-- is changed.

-- 1. Links a call log to the Peer Circle scheduled-session business object
-- it belongs to (p2p_peer_circle_sessions, migration 044). Nullable: every
-- existing 1:1 call log keeps this null. ON DELETE SET NULL rather than
-- CASCADE — a call log is a historical fact and must survive even if the
-- business-level session row it was linked to is ever removed (nothing in
-- this codebase deletes p2p_peer_circle_sessions rows today, but the call
-- log's own history must not depend on that never changing).
alter table p2p_call_logs
  add column if not exists circle_session_id uuid
  references p2p_peer_circle_sessions(id)
  on delete set null;

-- 2. At most one 'scheduled' Peer Circle session per circle at a time.
-- Production verified (2026-09-28, ad hoc query against Supabase, prior to
-- this migration): zero circles currently have more than one 'scheduled'
-- row, so this index is safe to create as-is.
create unique index if not exists p2p_peer_circle_sessions_one_scheduled_per_circle
  on p2p_peer_circle_sessions (circle_id)
  where session_status = 'scheduled';

-- 3. At most one active ('initiated', matching this codebase's own existing
-- getActivePeerCallLog() definition of "active call" in calls.ts) Circle
-- call log per circle at a time. The `circle_id is not null` guard scopes
-- this to Circle calls only — every 1:1 call log also defaults to
-- status='initiated' and must remain completely unconstrained by this
-- index, since circle_id is null for all of them today and forever.
create unique index if not exists p2p_call_logs_one_initiated_per_circle
  on p2p_call_logs (circle_id)
  where status = 'initiated' and circle_id is not null;

-- 4. A study session's current reflection-question position. Deliberately
-- a NEW column, not a reuse of current_section_index: current_section_index
-- indexes into p2p_lesson_sections (the lesson's narrative body), while
-- current_question_index indexes into p2p_reflection_questions (a separate,
-- independently-numbered table of discussion prompts) — the two are
-- different domain objects that happen to share the same "integer position"
-- shape, not the same value. current_section_index is untouched by this
-- migration in every respect. Nullable: only meaningful for a session that
-- actually has reflection questions in play (Peer Circle-flavored
-- sessions); 1:1 Study Together sessions leave it null forever, exactly as
-- they leave circle_session_id null on p2p_call_logs.
alter table p2p_study_sessions
  add column if not exists current_question_index integer;

-- 5. Persisted "which reflection questions has this study session already
-- discussed" — the piece of Peer Circle's existing completion logic
-- (discussedIds.size / questions.length in group.tsx) that has never
-- survived a reconnect. question_id references the real, existing
-- p2p_reflection_questions table (verified against migration 001 — a
-- genuine uuid primary key, not an opaque reference).
create table if not exists p2p_study_session_questions_discussed (
  id uuid primary key default gen_random_uuid(),
  study_session_id uuid not null
    references p2p_study_sessions(id)
    on delete cascade,
  question_id uuid not null
    references p2p_reflection_questions(id)
    on delete cascade,
  discussed_at timestamptz not null default now(),
  unique (study_session_id, question_id)
);

-- 6. Supporting index for the per-session lookup this table will always be
-- queried by ("which questions has THIS session discussed").
create index if not exists idx_p2p_study_session_questions_discussed_session
  on p2p_study_session_questions_discussed(study_session_id);
