-- 229 (approved by the owner 2026-11-04; restore-tested, applied with the guarded
-- production procedure): Peer Evaluation Engine — invitations, acceptance, a
-- 48-hour server deadline, automatic reassignment, evaluator orientation and
-- availability, auditable history, quality feedback and evaluation discussions.
--
-- Builds on the live evaluation system (007 and later), never beside it:
--   • p2p_lesson_evaluations stays THE evaluation record (one per submission);
--     its status (pending / approved / needs_revision) keeps driving learning
--     progress, credit and resubmission exactly as today. New columns carry
--     the engine's lifecycle.
--   • p2p_submissions stays the learner's original work — never copied,
--     changed or deleted by the engine.
--   • The existing messaging (p2p_conversations / members / messages) and
--     notifications (p2p_notifications → push) are reused.
--
-- SAFE ROLLOUT: the engine starts SWITCHED OFF (p2p_evaluation_settings.
-- engine_enabled = false). Until an administrator switches it on, new
-- submissions are handled exactly as before (direct assignment / the
-- "first through this lesson" approval) and legacy rows are untouched — so no
-- learner is ever left waiting while evaluators are being oriented.
--
-- Rules the database itself enforces:
--   • the deadline is EXACTLY 48 hours after the server-recorded acceptance;
--     there is no extension of any kind;
--   • at most ONE active (invited / accepted) assignment per evaluation;
--   • only the engine (these functions) chooses evaluators; a mobile client
--     can't set or change who evaluates, or any engine column;
--   • the invited evaluator isn't visible to the evaluatee: evaluator_id is
--     filled only on acceptance; assignment rows are API-only;
--   • every invitation, acceptance, decline, expiry, inability report,
--     missed deadline and reassignment is kept as history (never overwritten);
--   • repeated or concurrent runs can't double-assign or double-notify
--     (row locks + idempotency keys).
-- Additive only: new tables, new nullable columns, replaced function bodies
-- that keep their old behaviour when the engine is off.

begin;

-- ── Settings (one row) ──────────────────────────────────────────────────────
create table if not exists public.p2p_evaluation_settings (
  id                          boolean primary key default true check (id),
  engine_enabled              boolean not null default false,
  -- How long an invitation waits for an answer before P2P invites someone else.
  invitation_window_minutes   integer not null default 180 check (invitation_window_minutes between 15 and 1440),
  -- Evaluations one person may hold at once (invited + accepted).
  default_capacity            integer not null default 2 check (default_capacity between 1 and 10),
  -- Roles that may evaluate any lesson in the categories they choose (others: lessons they completed).
  reviewer_roles              text[] not null default array['peer_guide', 'church_leader'],
  -- Queue retries: first retry after this many minutes, doubling up to the cap.
  queue_retry_minutes         integer not null default 15 check (queue_retry_minutes between 5 and 240),
  queue_retry_cap_minutes     integer not null default 360 check (queue_retry_cap_minutes between 15 and 1440),
  orientation_version         integer not null default 1 check (orientation_version >= 1),
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.p2p_profiles(id) on delete set null
);
insert into public.p2p_evaluation_settings (id) values (true) on conflict (id) do nothing;

-- ── Evaluator profile: orientation, commitment, availability, standing ──────
create table if not exists public.p2p_evaluator_profiles (
  user_id                     uuid primary key references public.p2p_profiles(id) on delete cascade,
  available                   boolean not null default true,
  unavailable_until           timestamptz,
  capacity                    integer check (capacity is null or capacity between 1 and 10),
  -- Curricula this person is prepared to evaluate (empty = the lessons they completed).
  categories                  uuid[] not null default '{}' check (cardinality(categories) <= 100),
  orientation_version         integer,
  orientation_acknowledged_at timestamptz,
  commitment                  jsonb,
  standing                    text not null default 'good' check (standing in ('good', 'under_review', 'restricted')),
  restriction_reason          text check (restriction_reason is null or char_length(restriction_reason) <= 1000),
  restricted_by               uuid references public.p2p_profiles(id) on delete set null,
  restricted_at               timestamptz,
  reinstated_at               timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint p2p_evaluator_profiles_restricted_reason check (standing <> 'restricted' or restriction_reason is not null)
);

-- ── The evaluation record gains the engine lifecycle ────────────────────────
alter table public.p2p_lesson_evaluations
  add column if not exists engine_state text
    constraint p2p_lesson_evaluations_engine_state_check check (engine_state is null or engine_state in ('queued', 'invited', 'in_progress', 'completed', 'cancelled')),
  add column if not exists current_assignment_id uuid,
  add column if not exists accepted_at timestamptz,
  add column if not exists deadline_at timestamptz,
  add column if not exists outcome text
    constraint p2p_lesson_evaluations_outcome_check check (outcome is null or outcome in ('passed', 'passed_with_recommendations', 'revision_required', 'further_discussion', 'clarification_required')),
  add column if not exists feedback_detail jsonb,
  add column if not exists queued_since timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists attempts integer not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_lesson_evaluations_deadline_48h') then
    alter table public.p2p_lesson_evaluations add constraint p2p_lesson_evaluations_deadline_48h
      check (deadline_at is null or (accepted_at is not null and deadline_at = accepted_at + interval '48 hours'));
  end if;
end $$;
create index if not exists p2p_lesson_evaluations_engine_idx on public.p2p_lesson_evaluations (engine_state, next_attempt_at) where engine_state in ('queued', 'invited', 'in_progress');

-- ── Assignment history: every invitation and what became of it ──────────────
create table if not exists public.p2p_evaluation_assignments (
  id                 uuid primary key default gen_random_uuid(),
  evaluation_id      uuid not null references public.p2p_lesson_evaluations(id) on delete cascade,
  evaluator_id       uuid references public.p2p_profiles(id) on delete set null,
  attempt            integer not null check (attempt >= 1),
  status             text not null default 'invited' check (status in ('invited', 'accepted', 'declined', 'expired', 'unable', 'overdue', 'removed', 'unavailable', 'completed', 'cancelled')),
  invited_at         timestamptz not null default now(),
  invite_expires_at  timestamptz not null,
  responded_at       timestamptz,
  accepted_at        timestamptz,
  deadline_at        timestamptz,
  ended_at           timestamptz,
  end_reason         text check (end_reason is null or char_length(end_reason) <= 60),
  decline_reason     text check (decline_reason is null or char_length(decline_reason) <= 60),
  unable_category    text check (unable_category is null or unable_category in ('health', 'family', 'time', 'competence', 'conflict', 'technical', 'other')),
  unable_note        text check (unable_note is null or char_length(unable_note) <= 1000),
  -- The evaluator's working draft (only theirs; discarded if they lose the assignment).
  draft              jsonb,
  draft_saved_at     timestamptz,
  reminded_24_at     timestamptz,
  reminded_12_at     timestamptz,
  reminded_6_at      timestamptz,
  escalated_12_at    timestamptz,
  escalated_24_at    timestamptz,
  actor_type         text not null default 'system' check (actor_type in ('system', 'admin')),
  actor_id           uuid references public.p2p_profiles(id) on delete set null,
  unique (evaluation_id, attempt),
  constraint p2p_evaluation_assignments_deadline_48h check (deadline_at is null or (accepted_at is not null and deadline_at = accepted_at + interval '48 hours')),
  constraint p2p_evaluation_assignments_ended check ((status in ('invited', 'accepted')) = (ended_at is null))
);
-- One active assignment per evaluation, ever.
create unique index if not exists p2p_evaluation_assignments_one_active on public.p2p_evaluation_assignments (evaluation_id) where status in ('invited', 'accepted');
create index if not exists p2p_evaluation_assignments_evaluator_idx on public.p2p_evaluation_assignments (evaluator_id, status, invited_at desc);
create index if not exists p2p_evaluation_assignments_due_idx on public.p2p_evaluation_assignments (status, invite_expires_at, deadline_at) where status in ('invited', 'accepted');

-- ── Event history + idempotency (notifications and steps happen once) ───────
create table if not exists public.p2p_evaluation_events (
  id             uuid primary key default gen_random_uuid(),
  evaluation_id  uuid references public.p2p_lesson_evaluations(id) on delete cascade,
  assignment_id  uuid references public.p2p_evaluation_assignments(id) on delete set null,
  event_type     text not null check (char_length(event_type) <= 60),
  actor_type     text not null default 'system' check (actor_type in ('system', 'evaluator', 'evaluatee', 'admin')),
  actor_id       uuid references public.p2p_profiles(id) on delete set null,
  detail         jsonb not null default '{}',
  idem_key       text unique check (idem_key is null or char_length(idem_key) <= 200),
  created_at     timestamptz not null default now()
);
create index if not exists p2p_evaluation_events_eval_idx on public.p2p_evaluation_events (evaluation_id, created_at);
create index if not exists p2p_evaluation_events_type_idx on public.p2p_evaluation_events (event_type, created_at desc);

-- ── The evaluatee's feedback on the evaluation (private; for growth, not ranking) ─
create table if not exists public.p2p_evaluation_quality (
  evaluation_id      uuid primary key references public.p2p_lesson_evaluations(id) on delete cascade,
  evaluatee_id       uuid not null references public.p2p_profiles(id) on delete cascade,
  evaluator_id       uuid references public.p2p_profiles(id) on delete set null,
  helpfulness        smallint not null check (helpfulness between 1 and 5),
  clarity            smallint not null check (clarity between 1 and 5),
  respectfulness     smallint not null check (respectfulness between 1 and 5),
  encouragement      smallint not null check (encouragement between 1 and 5),
  relevance          smallint not null check (relevance between 1 and 5),
  helped_understand  boolean not null,
  comment            text check (comment is null or char_length(comment) <= 1000),
  concern            boolean not null default false,
  reviewed_at        timestamptz,
  reviewed_by        uuid references public.p2p_profiles(id) on delete set null,
  review_note        text check (review_note is null or char_length(review_note) <= 1000),
  substantiated      boolean,
  created_at         timestamptz not null default now()
);
create index if not exists p2p_evaluation_quality_evaluator_idx on public.p2p_evaluation_quality (evaluator_id, created_at desc);

-- ── Evaluation discussions use the existing messaging ───────────────────────
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'p2p_conversations_conversation_type_check'
             and pg_get_constraintdef(oid) not like '%evaluation%') then
    alter table public.p2p_conversations drop constraint p2p_conversations_conversation_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_conversations_conversation_type_check') then
    alter table public.p2p_conversations add constraint p2p_conversations_conversation_type_check
      check (conversation_type = any (array['direct', 'crisis_response', 'help_request', 'pastoral', 'support', 'peer_group', 'circle', 'family', 'church', 'evaluation']));
  end if;
end $$;
alter table public.p2p_conversations add column if not exists evaluation_id uuid references public.p2p_lesson_evaluations(id) on delete set null;
create unique index if not exists p2p_conversations_one_per_evaluation on public.p2p_conversations (evaluation_id) where evaluation_id is not null;

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function public.p2p_eval_settings() returns public.p2p_evaluation_settings
  language sql stable security definer set search_path = public as $$
  select * from p2p_evaluation_settings where id
$$;

-- People who coordinate evaluations (authorised administrators).
create or replace function public.p2p_eval_coordinators() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select id from p2p_profiles where role::text in ('super_admin', 'admin_supervisor')
$$;

-- Record an event once (by idempotency key). True only the first time.
create or replace function public.p2p_eval_event(p_eval uuid, p_assignment uuid, p_type text, p_actor_type text, p_actor uuid, p_detail jsonb, p_key text)
  returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into p2p_evaluation_events (evaluation_id, assignment_id, event_type, actor_type, actor_id, detail, idem_key)
  values (p_eval, p_assignment, p_type, p_actor_type, p_actor, coalesce(p_detail, '{}'), p_key)
  on conflict (idem_key) do nothing
  returning id into v_id;
  return v_id is not null;
end $$;

-- A notification through the existing pipeline, sent at most once per key.
create or replace function public.p2p_eval_notify(p_user uuid, p_type text, p_title text, p_message text, p_data jsonb, p_key text)
  returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return false; end if;
  if not p2p_eval_event((p_data->>'evaluationId')::uuid, null, 'notified', 'system', null,
                        jsonb_build_object('type', p_type, 'to', p_user), p_key) then
    return false;
  end if;
  insert into p2p_notifications (user_id, title, message, notification_type, data)
  values (p_user, p_title, p_message, p_type, p_data);
  return true;
end $$;

-- The curriculum a lesson belongs to (its evaluation category).
create or replace function public.p2p_eval_category(p_lesson uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select m.curriculum_id from p2p_lessons l join p2p_modules m on m.id = l.module_id where l.id = p_lesson
$$;

-- Can this person evaluate this evaluation right now? (Shared by picking, accepting and the sweep.)
create or replace function public.p2p_eval_can_evaluate(p_user uuid, p_eval uuid) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare
  e record; p record; s p2p_evaluation_settings; v_role text; v_cat uuid;
begin
  select * into e from p2p_lesson_evaluations where id = p_eval;
  if e.id is null or p_user is null or p_user = e.submitter_id then return false; end if;
  select * into p from p2p_evaluator_profiles where user_id = p_user;
  s := p2p_eval_settings();
  if p.user_id is null or p.orientation_acknowledged_at is null or coalesce(p.orientation_version, 0) < s.orientation_version then return false; end if;
  if p.standing = 'restricted' then return false; end if;
  -- Account standing: active accounts only.
  if exists (select 1 from p2p_account_status a where a.user_id = p_user and a.status <> 'active') then return false; end if;
  -- Safeguarding: blocks either way, and the minor-contact rules.
  if exists (select 1 from p2p_user_blocks b where (b.blocker_id = p_user and b.blocked_id = e.submitter_id) or (b.blocker_id = e.submitter_id and b.blocked_id = p_user)) then return false; end if;
  if not p2p_minor_contact_allowed(p_user, e.submitter_id) then return false; end if;
  -- Competence: completed this lesson, or an authorised reviewer role for this category.
  select role::text into v_role from p2p_profiles where id = p_user;
  v_cat := p2p_eval_category(e.lesson_id);
  if exists (select 1 from p2p_lesson_progress lp where lp.user_id = p_user and lp.lesson_id = e.lesson_id and lp.completed) then return true; end if;
  return v_role = any(s.reviewer_roles) and (cardinality(p.categories) = 0 or v_cat = any(p.categories));
end $$;

-- Choose the next evaluator: eligible, available, under capacity, never
-- before invited for this evaluation; fewest active evaluations first, then
-- the one invited longest ago (fair spread — the same few aren't overloaded).
create or replace function public.p2p_eval_pick(p_eval uuid) returns uuid
  language plpgsql stable security definer set search_path = public as $$
declare s p2p_evaluation_settings := p2p_eval_settings(); v uuid;
begin
  select ep.user_id into v
  from p2p_evaluator_profiles ep
  left join lateral (
    select count(*) filter (where a.status in ('invited', 'accepted')) as active, max(a.invited_at) as last_invited
    from p2p_evaluation_assignments a where a.evaluator_id = ep.user_id
  ) load on true
  where ep.available
    and (ep.unavailable_until is null or ep.unavailable_until <= now())
    and coalesce(load.active, 0) < coalesce(ep.capacity, s.default_capacity)
    and not exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = p_eval and x.evaluator_id = ep.user_id)
    and p2p_eval_can_evaluate(ep.user_id, p_eval)
  order by coalesce(load.active, 0), coalesce(load.last_invited, 'epoch'::timestamptz), md5(ep.user_id::text || p_eval::text)
  limit 1;
  return v;
end $$;

-- ── The engine's one step: make sure an active evaluation has an invitation ─
-- Locks the evaluation row, so concurrent callers (workers, requests) queue
-- behind each other; whoever runs second sees the work done and does nothing.
create or replace function public.p2p_eval_advance(p_eval uuid, p_reason text, p_actor_type text default 'system', p_actor uuid default null)
  returns text language plpgsql security definer set search_path = public as $$
declare
  e p2p_lesson_evaluations; s p2p_evaluation_settings := p2p_eval_settings();
  v_next uuid; v_attempt integer; v_assignment uuid; v_lesson text; v_minutes integer; v_coord uuid;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.engine_state is null or e.engine_state in ('completed', 'cancelled') then return 'closed'; end if;
  if exists (select 1 from p2p_evaluation_assignments where evaluation_id = p_eval and status in ('invited', 'accepted')) then return 'active'; end if;

  v_next := p2p_eval_pick(p_eval);
  select title into v_lesson from p2p_lessons where id = e.lesson_id;

  if v_next is null then
    -- Nobody eligible right now: stay queued, try again later (backing off), tell people once.
    v_minutes := least(s.queue_retry_cap_minutes, s.queue_retry_minutes * (2 ^ least(e.attempts, 10))::integer);
    update p2p_lesson_evaluations set engine_state = 'queued', evaluator_id = null, current_assignment_id = null,
      accepted_at = null, deadline_at = null, queued_since = coalesce(queued_since, now()),
      next_attempt_at = now() + make_interval(mins => v_minutes), attempts = attempts + 1
      where id = p_eval returning * into e;
    perform p2p_eval_event(p_eval, null, 'queued', p_actor_type, p_actor, jsonb_build_object('reason', p_reason, 'retryInMinutes', v_minutes), null);
    perform p2p_eval_notify(e.submitter_id, 'evaluation_arranging', 'Arranging your evaluation',
      'P2P Global is arranging a qualified evaluator for your submission. It is safe — we''ll let you know when someone accepts.',
      jsonb_build_object('evaluationId', p_eval), format('eval:%s:arranging:%s', p_eval, e.queued_since));
    for v_coord in select * from p2p_eval_coordinators() loop
      perform p2p_eval_notify(v_coord, 'evaluation_unassigned', 'An evaluation needs an evaluator',
        format('No eligible evaluator is available for "%s". P2P keeps trying automatically.', coalesce(v_lesson, 'a lesson')),
        jsonb_build_object('evaluationId', p_eval), format('eval:%s:unassigned:%s:%s', p_eval, e.queued_since, v_coord));
    end loop;
    return 'queued';
  end if;

  select coalesce(max(attempt), 0) + 1 into v_attempt from p2p_evaluation_assignments where evaluation_id = p_eval;
  insert into p2p_evaluation_assignments (evaluation_id, evaluator_id, attempt, invite_expires_at, actor_type, actor_id)
  values (p_eval, v_next, v_attempt, now() + make_interval(mins => s.invitation_window_minutes),
          case when p_actor_type = 'admin' then 'admin' else 'system' end, case when p_actor_type = 'admin' then p_actor end)
  returning id into v_assignment;
  update p2p_lesson_evaluations set engine_state = 'invited', current_assignment_id = v_assignment, evaluator_id = null,
    accepted_at = null, deadline_at = null, next_attempt_at = null
    where id = p_eval;
  perform p2p_eval_event(p_eval, v_assignment, 'invited', p_actor_type, p_actor, jsonb_build_object('reason', p_reason, 'attempt', v_attempt), format('assignment:%s:invited', v_assignment));
  perform p2p_eval_notify(v_next, 'evaluation_invitation', 'You''re invited to serve as an evaluator',
    format('A fellow disciple has submitted work on "%s". Please accept or decline within %s hours.', coalesce(v_lesson, 'a lesson'), round(s.invitation_window_minutes / 60.0, 1)),
    jsonb_build_object('evaluationId', p_eval, 'assignmentId', v_assignment), format('assignment:%s:invite-notice', v_assignment));
  return 'invited';
end $$;

-- End the active assignment for a reason, then let the engine move on.
-- Reasons after acceptance (unable / overdue / unavailable / removed) tell the
-- evaluatee every time; before acceptance (declined / expired) at most once a day.
create or replace function public.p2p_eval_end_and_reassign(p_assignment uuid, p_status text, p_reason text, p_actor_type text, p_actor uuid, p_detail jsonb default '{}')
  returns text language plpgsql security definer set search_path = public as $$
declare a p2p_evaluation_assignments; e p2p_lesson_evaluations; v_conv uuid; v_was_accepted boolean;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into a from p2p_evaluation_assignments where id = p_assignment;
  if a.id is null then return 'missing'; end if;
  select * into e from p2p_lesson_evaluations where id = a.evaluation_id for update;
  -- Re-read under the evaluation lock: someone else may have finished it.
  select * into a from p2p_evaluation_assignments where id = p_assignment for update;
  if a.status not in ('invited', 'accepted') or e.engine_state in ('completed', 'cancelled') then return 'already'; end if;
  v_was_accepted := a.status = 'accepted';
  update p2p_evaluation_assignments set status = p_status, ended_at = now(), end_reason = p_reason,
    responded_at = coalesce(responded_at, case when p_status in ('declined') then now() end),
    decline_reason = case when p_status = 'declined' then left(p_detail->>'reason', 60) else decline_reason end,
    unable_category = case when p_status = 'unable' then p_detail->>'category' else unable_category end,
    unable_note = case when p_status = 'unable' then left(p_detail->>'note', 1000) else unable_note end,
    draft = null
    where id = p_assignment;
  update p2p_lesson_evaluations set evaluator_id = null, current_assignment_id = null, accepted_at = null, deadline_at = null
    where id = e.id;
  -- The previous evaluator leaves the active discussion (its history stays).
  select id into v_conv from p2p_conversations where evaluation_id = e.id;
  if v_conv is not null and a.evaluator_id is not null then
    delete from p2p_conversation_members where conversation_id = v_conv and user_id = a.evaluator_id;
  end if;
  perform p2p_eval_event(e.id, p_assignment, p_status, p_actor_type, p_actor, p_detail || jsonb_build_object('reason', p_reason), format('assignment:%s:%s', p_assignment, p_status));
  if v_was_accepted or p_status in ('removed', 'unavailable') then
    perform p2p_eval_notify(e.submitter_id, 'evaluation_reassigned', 'Your evaluation has been reassigned',
      'P2P Global has automatically reassigned your evaluation to another qualified evaluator. Your original submission and learning progress are safe. We will notify you when the new evaluator accepts responsibility.',
      jsonb_build_object('evaluationId', e.id), format('eval:%s:reassigned:%s', e.id, p_assignment));
  else
    perform p2p_eval_notify(e.submitter_id, 'evaluation_reassigned', 'Your evaluation has been reassigned',
      'P2P Global is inviting another qualified evaluator to review your submission. Your original submission and learning progress are safe.',
      jsonb_build_object('evaluationId', e.id), format('eval:%s:reassigned-day:%s', e.id, to_char(now() at time zone 'UTC', 'YYYY-MM-DD')));
  end if;
  return p2p_eval_advance(e.id, p_reason, p_actor_type, p_actor);
end $$;

-- ── Evaluator actions (called by the API with the signed-in user's id) ──────
create or replace function public.p2p_eval_accept(p_assignment uuid, p_user uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a p2p_evaluation_assignments; e p2p_lesson_evaluations; v_now timestamptz := now(); v_conv uuid;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into a from p2p_evaluation_assignments where id = p_assignment;
  if a.id is null or a.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into e from p2p_lesson_evaluations where id = a.evaluation_id for update;
  select * into a from p2p_evaluation_assignments where id = p_assignment for update;
  if a.status = 'accepted' then return jsonb_build_object('ok', true, 'already', true, 'deadlineAt', a.deadline_at); end if;
  if a.status <> 'invited' or e.current_assignment_id is distinct from a.id then return jsonb_build_object('ok', false, 'error', 'no_longer_available'); end if;
  if a.invite_expires_at <= v_now then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  if not p2p_eval_can_evaluate(p_user, e.id) then return jsonb_build_object('ok', false, 'error', 'not_eligible'); end if;
  update p2p_evaluation_assignments set status = 'accepted', responded_at = v_now, accepted_at = v_now, deadline_at = v_now + interval '48 hours' where id = a.id;
  update p2p_lesson_evaluations set engine_state = 'in_progress', evaluator_id = p_user, accepted_at = v_now,
    deadline_at = v_now + interval '48 hours', assigned_at = v_now where id = e.id;
  select id into v_conv from p2p_conversations where evaluation_id = e.id;
  if v_conv is not null then
    insert into p2p_conversation_members (conversation_id, user_id) select v_conv, p_user
      where not exists (select 1 from p2p_conversation_members where conversation_id = v_conv and user_id = p_user);
  end if;
  perform p2p_eval_event(e.id, a.id, 'accepted', 'evaluator', p_user, jsonb_build_object('deadlineAt', v_now + interval '48 hours'), format('assignment:%s:accepted', a.id));
  perform p2p_eval_notify(e.submitter_id, 'evaluation_accepted',
    case when exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = e.id and x.status in ('unable', 'overdue', 'removed', 'unavailable'))
      then 'Your new evaluator has accepted' else 'An evaluator has accepted your submission' end,
    case when exists (select 1 from p2p_evaluation_assignments x where x.evaluation_id = e.id and x.status in ('unable', 'overdue', 'removed', 'unavailable'))
      then 'Your new evaluator has accepted responsibility for your evaluation. Your review is now in progress.'
      else 'A fellow disciple has accepted responsibility for reviewing your submission. Your review is now in progress.' end,
    jsonb_build_object('evaluationId', e.id), format('assignment:%s:accepted-notice', a.id));
  return jsonb_build_object('ok', true, 'acceptedAt', v_now, 'deadlineAt', v_now + interval '48 hours');
end $$;

create or replace function public.p2p_eval_decline(p_assignment uuid, p_user uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a p2p_evaluation_assignments;
begin
  select * into a from p2p_evaluation_assignments where id = p_assignment;
  if a.id is null or a.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.status <> 'invited' then return jsonb_build_object('ok', false, 'error', 'no_longer_available'); end if;
  return jsonb_build_object('ok', true, 'next', p2p_eval_end_and_reassign(p_assignment, 'declined', 'declined', 'evaluator', p_user, jsonb_build_object('reason', coalesce(p_reason, 'not_stated'))));
end $$;

create or replace function public.p2p_eval_report_unable(p_assignment uuid, p_user uuid, p_category text, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a p2p_evaluation_assignments;
begin
  select * into a from p2p_evaluation_assignments where id = p_assignment;
  if a.id is null or a.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if a.status <> 'accepted' then return jsonb_build_object('ok', false, 'error', 'not_active'); end if;
  if p_category is null or p_category not in ('health', 'family', 'time', 'competence', 'conflict', 'technical', 'other') then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  return jsonb_build_object('ok', true, 'next', p2p_eval_end_and_reassign(p_assignment, 'unable', 'unable', 'evaluator', p_user, jsonb_build_object('category', p_category, 'note', p_note)));
end $$;

-- Save the evaluator's draft (only while the assignment is theirs and active).
create or replace function public.p2p_eval_save_draft(p_assignment uuid, p_user uuid, p_draft jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  update p2p_evaluation_assignments set draft = p_draft, draft_saved_at = now()
    where id = p_assignment and evaluator_id = p_user and status = 'accepted' and deadline_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_active'); end if;
  return jsonb_build_object('ok', true, 'savedAt', now());
end $$;

-- Submit the evaluation: only the accepted evaluator, before the deadline.
-- Outcomes map onto the existing learning model: passed (with or without
-- recommendations) → approved; anything asking for more → needs_revision.
create or replace function public.p2p_eval_submit(p_eval uuid, p_user uuid, p_outcome text, p_detail jsonb, p_summary text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e p2p_lesson_evaluations; a p2p_evaluation_assignments; v_status text;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.evaluator_id is distinct from p_user then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if e.engine_state = 'completed' then return jsonb_build_object('ok', true, 'already', true); end if;
  if e.engine_state <> 'in_progress' then return jsonb_build_object('ok', false, 'error', 'not_active'); end if;
  if e.deadline_at <= now() then return jsonb_build_object('ok', false, 'error', 'deadline_passed'); end if;
  if p_outcome not in ('passed', 'passed_with_recommendations', 'revision_required', 'further_discussion', 'clarification_required') then return jsonb_build_object('ok', false, 'error', 'outcome_required'); end if;
  select * into a from p2p_evaluation_assignments where id = e.current_assignment_id for update;
  v_status := case when p_outcome in ('passed', 'passed_with_recommendations') then 'approved' else 'needs_revision' end;
  update p2p_evaluation_assignments set status = 'completed', ended_at = now(), end_reason = 'completed', draft = null where id = a.id;
  update p2p_lesson_evaluations set outcome = p_outcome, feedback_detail = p_detail, feedback = left(p_summary, 4000),
    status = v_status, engine_state = 'completed', current_assignment_id = null, next_attempt_at = null
    where id = e.id;
  perform p2p_eval_event(e.id, a.id, 'completed', 'evaluator', p_user, jsonb_build_object('outcome', p_outcome, 'onTime', true), format('eval:%s:completed', e.id));
  perform p2p_eval_notify(e.submitter_id, 'evaluation_feedback_ready', 'Your feedback is ready',
    'Your evaluator has completed their review. Open it to read their feedback and encouragement.',
    jsonb_build_object('evaluationId', e.id), format('eval:%s:feedback-ready', e.id));
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- An authorised administrator removes the current evaluator; the SYSTEM picks the replacement.
create or replace function public.p2p_eval_admin_reassign(p_eval uuid, p_admin uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_assignment uuid;
begin
  if not exists (select 1 from p2p_profiles where id = p_admin and role::text in ('super_admin', 'admin_supervisor')) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then return jsonb_build_object('ok', false, 'error', 'reason_required'); end if;
  select id into v_assignment from p2p_evaluation_assignments where evaluation_id = p_eval and status in ('invited', 'accepted');
  if v_assignment is null then
    return jsonb_build_object('ok', true, 'next', p2p_eval_advance(p_eval, 'admin_retry', 'admin', p_admin));
  end if;
  return jsonb_build_object('ok', true, 'next', p2p_eval_end_and_reassign(v_assignment, 'removed', 'admin_removed', 'admin', p_admin, jsonb_build_object('note', left(p_reason, 500))));
end $$;

-- ── The sweep: runs every few minutes, day and night, whoever is online ─────
-- Each item is locked with SKIP LOCKED, so two sweeps (or a sweep and a
-- request) never work on the same item; every step is idempotent.
create or replace function public.p2p_eval_sweep(p_limit integer default 200) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  r record; n_expired int := 0; n_overdue int := 0; n_reminded int := 0; n_retried int := 0; n_unavailable int := 0; n_escalated int := 0;
  v_left interval; v_coord uuid; v_lesson text;
begin
  perform set_config('p2p.eval_engine', 'on', true);
  -- 1. Invitations nobody answered in time.
  for r in select id from p2p_evaluation_assignments where status = 'invited' and invite_expires_at <= now() order by invite_expires_at limit p_limit loop
    perform p2p_eval_end_and_reassign(r.id, 'expired', 'invitation_expired', 'system', null); n_expired := n_expired + 1;
  end loop;
  -- 2. Accepted evaluations past their 48-hour deadline: reassign at once.
  for r in select a.id, a.evaluator_id, a.evaluation_id from p2p_evaluation_assignments a where a.status = 'accepted' and a.deadline_at <= now() order by a.deadline_at limit p_limit loop
    -- Lock the evaluation first, then re-check: a submission may have just arrived.
    perform 1 from p2p_lesson_evaluations where id = r.evaluation_id for update;
    continue when not exists (select 1 from p2p_evaluation_assignments where id = r.id and status = 'accepted' and deadline_at <= now());
    perform p2p_eval_notify(r.evaluator_id, 'evaluation_missed_deadline', 'Your evaluation time has ended',
      'The 48 hours for this evaluation have passed, so P2P Global has given it to another evaluator. Thank you for serving — if something got in the way, you can share it privately with the coordinators.',
      jsonb_build_object('evaluationId', r.evaluation_id), format('assignment:%s:missed-notice', r.id));
    perform p2p_eval_end_and_reassign(r.id, 'overdue', 'deadline_passed', 'system', null); n_overdue := n_overdue + 1;
  end loop;
  -- 3. Accepted evaluators who are no longer eligible (restricted, account inactive, safeguarding).
  for r in select a.id from p2p_evaluation_assignments a where a.status in ('accepted', 'invited') and not p2p_eval_can_evaluate(a.evaluator_id, a.evaluation_id) limit p_limit loop
    perform p2p_eval_end_and_reassign(r.id, 'unavailable', 'no_longer_eligible', 'system', null); n_unavailable := n_unavailable + 1;
  end loop;
  -- 4. Reminders before the deadline (the most urgent one that applies, once each).
  for r in select a.* from p2p_evaluation_assignments a where a.status = 'accepted' and a.deadline_at > now() and a.deadline_at - now() <= interval '24 hours'
           and (a.reminded_24_at is null or (a.deadline_at - now() <= interval '12 hours' and a.reminded_12_at is null) or (a.deadline_at - now() <= interval '6 hours' and a.reminded_6_at is null))
           limit p_limit for update skip locked loop
    v_left := r.deadline_at - now();
    if v_left <= interval '6 hours' then
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'About 6 hours left', 'Your evaluation is due in about 6 hours. If you can''t finish, please report it so P2P can arrange someone else.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'urgent'), format('assignment:%s:reminder-6', r.id));
      update p2p_evaluation_assignments set reminded_6_at = now(), reminded_12_at = coalesce(reminded_12_at, now()), reminded_24_at = coalesce(reminded_24_at, now()) where id = r.id;
    elsif v_left <= interval '12 hours' then
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'About 12 hours left', 'Your evaluation is due in about 12 hours. Thank you for serving faithfully.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'priority'), format('assignment:%s:reminder-12', r.id));
      update p2p_evaluation_assignments set reminded_12_at = now(), reminded_24_at = coalesce(reminded_24_at, now()) where id = r.id;
    else
      perform p2p_eval_notify(r.evaluator_id, 'evaluation_reminder', 'A day left for your evaluation', 'A friendly reminder: your evaluation is due in about 24 hours.',
        jsonb_build_object('evaluationId', r.evaluation_id, 'level', 'friendly'), format('assignment:%s:reminder-24', r.id));
      update p2p_evaluation_assignments set reminded_24_at = now() where id = r.id;
    end if;
    n_reminded := n_reminded + 1;
  end loop;
  -- 5. Queued evaluations whose retry time has come.
  for r in select id from p2p_lesson_evaluations where engine_state = 'queued' and next_attempt_at <= now() order by next_attempt_at limit p_limit for update skip locked loop
    perform p2p_eval_advance(r.id, 'retry', 'system', null); n_retried := n_retried + 1;
  end loop;
  -- 6. Escalation: still no accepted evaluator 12 h / 24 h after a missed deadline.
  for r in select a.id, a.evaluation_id, a.deadline_at, a.escalated_12_at, a.escalated_24_at from p2p_evaluation_assignments a
           join p2p_lesson_evaluations e on e.id = a.evaluation_id
           where a.status = 'overdue' and e.engine_state in ('queued', 'invited')
             and ((a.deadline_at <= now() - interval '12 hours' and a.escalated_12_at is null) or (a.deadline_at <= now() - interval '24 hours' and a.escalated_24_at is null))
           limit p_limit for update of a skip locked loop
    select l.title into v_lesson from p2p_lesson_evaluations e join p2p_lessons l on l.id = e.lesson_id where e.id = r.evaluation_id;
    for v_coord in select * from p2p_eval_coordinators() loop
      perform p2p_eval_notify(v_coord, 'evaluation_escalation',
        case when r.deadline_at <= now() - interval '24 hours' then 'Evaluation unresolved for 24 hours' else 'Evaluation unresolved for 12 hours' end,
        format('An evaluation of "%s" still has no accepted evaluator after a missed deadline.', coalesce(v_lesson, 'a lesson')),
        jsonb_build_object('evaluationId', r.evaluation_id),
        format('assignment:%s:escalate-%s:%s', r.id, case when r.deadline_at <= now() - interval '24 hours' then '24' else '12' end, v_coord));
    end loop;
    update p2p_evaluation_assignments set escalated_12_at = coalesce(escalated_12_at, now()),
      escalated_24_at = case when r.deadline_at <= now() - interval '24 hours' then coalesce(escalated_24_at, now()) else escalated_24_at end
      where id = r.id;
    n_escalated := n_escalated + 1;
  end loop;
  perform p2p_eval_event(null, null, 'sweep', 'system', null, jsonb_build_object('expired', n_expired, 'overdue', n_overdue, 'unavailable', n_unavailable, 'reminded', n_reminded, 'retried', n_retried, 'escalated', n_escalated), null);
  return jsonb_build_object('expired', n_expired, 'overdue', n_overdue, 'unavailable', n_unavailable, 'reminded', n_reminded, 'retried', n_retried, 'escalated', n_escalated);
end $$;

-- ── Discussion: one conversation per evaluation, in the existing messaging ──
create or replace function public.p2p_eval_open_discussion(p_eval uuid, p_user uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare e p2p_lesson_evaluations; v_conv uuid; v_title text;
begin
  select * into e from p2p_lesson_evaluations where id = p_eval for update;
  if e.id is null or e.engine_state is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  -- The evaluatee, or the evaluator who has accepted it (never an invitee, never a previous evaluator).
  if p_user is distinct from e.submitter_id and (p_user is distinct from e.evaluator_id or e.engine_state not in ('in_progress', 'completed')) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select id into v_conv from p2p_conversations where evaluation_id = p_eval;
  if v_conv is null then
    select 'Evaluation: ' || coalesce(title, 'lesson') into v_title from p2p_lessons where id = e.lesson_id;
    insert into p2p_conversations (type, name, conversation_type, evaluation_id) values ('direct', left(v_title, 120), 'evaluation', p_eval) returning id into v_conv;
  end if;
  insert into p2p_conversation_members (conversation_id, user_id)
    select v_conv, u from unnest(array[e.submitter_id, e.evaluator_id]) u
    where u is not null and not exists (select 1 from p2p_conversation_members m where m.conversation_id = v_conv and m.user_id = u);
  return jsonb_build_object('ok', true, 'conversationId', v_conv);
end $$;

-- ── New submissions: the engine when switched on, the old path otherwise ────
create or replace function public.p2p_assign_evaluator_on_submission() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_evaluator uuid;
  v_in_active_circle boolean;
  v_eval uuid;
begin
  -- Reflection-only submissions don't gate lesson completion.
  if new.assignment_id is null then
    return new;
  end if;

  select exists (
    select 1
    from p2p_peer_circle_members m
    join p2p_peer_circles c on c.id = m.circle_id
    where m.user_id = new.user_id
      and m.status = 'active'
      and c.status = 'active'
      and c.current_lesson_id = new.lesson_id
  ) into v_in_active_circle;

  if v_in_active_circle then
    return new;
  end if;

  if (select engine_enabled from p2p_evaluation_settings where id) then
    -- Peer Evaluation Engine: the record waits for an evaluator to ACCEPT (no one is named yet).
    perform set_config('p2p.eval_engine', 'on', true);
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at, engine_state, queued_since)
    values (new.id, new.lesson_id, new.user_id, null, 'pending', now(), 'queued', now())
    returning id into v_eval;
    perform p2p_eval_event(v_eval, null, 'submitted', 'evaluatee', new.user_id, jsonb_build_object('submissionId', new.id), format('eval:%s:submitted', v_eval));
    perform p2p_eval_advance(v_eval, 'submitted', 'system', null);
    perform p2p_lesson_progress_recompute(new.user_id, new.lesson_id);
    return new;
  end if;

  v_evaluator := p2p_pick_evaluator(new.lesson_id, array[new.user_id]);
  if v_evaluator is not null then
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at)
    values (new.id, new.lesson_id, new.user_id, v_evaluator, 'pending', now());
  else
    insert into p2p_lesson_evaluations (
      submission_id, lesson_id, submitter_id, evaluator_id, status,
      self_approved, feedback, assigned_at, resolved_at
    )
    values (
      new.id, new.lesson_id, new.user_id, new.user_id, 'approved',
      true, 'First through this lesson — unevaluated, auto-approved.', now(), now()
    );
  end if;

  perform p2p_lesson_progress_recompute(new.user_id, new.lesson_id);
  return new;
end;
$$;

-- The old 72-hour sweep keeps handling only the old rows.
create or replace function public.p2p_reassign_stale_evaluations() returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_new_evaluator uuid;
  v_count integer := 0;
begin
  for v_row in
    select id, lesson_id, submitter_id, evaluator_id
    from p2p_lesson_evaluations
    where status = 'pending'
      and engine_state is null
      and assigned_at < now() - interval '72 hours'
  loop
    v_new_evaluator := p2p_pick_evaluator(v_row.lesson_id, array[v_row.submitter_id, v_row.evaluator_id]);
    if v_new_evaluator is not null then
      insert into p2p_evaluation_reassignments (evaluation_id, previous_evaluator_id, new_evaluator_id, reason)
      values (v_row.id, v_row.evaluator_id, v_new_evaluator, '72h_no_action');

      update p2p_lesson_evaluations
        set evaluator_id = v_new_evaluator,
            reassigned_from = v_row.evaluator_id,
            assigned_at = now()
        where id = v_row.id;

      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- The old "submission reviewed" notification stays for old rows; the engine sends its own.
create or replace function public.p2p_notify_submitter_on_resolution() returns trigger
  language plpgsql security definer set search_path = public as $$
BEGIN
  IF new.engine_state IS NOT NULL THEN
    RETURN new;
  END IF;
  IF old.status = 'pending' AND new.status IN ('approved', 'needs_revision') THEN
    INSERT INTO p2p_notifications (user_id, title, message, notification_type)
    VALUES (
      new.submitter_id,
      CASE WHEN new.status = 'approved'
        THEN 'Your submission was approved!'
        ELSE 'Your submission needs a revision'
      END,
      CASE WHEN new.status = 'approved'
        THEN 'A peer reviewed your work and approved it. Great job!'
        ELSE 'A peer reviewed your work and requested a revision.' ||
          CASE WHEN new.feedback IS NOT NULL AND length(trim(new.feedback)) > 0
            THEN ' Feedback: ' || new.feedback
            ELSE ' Open the lesson to see what to adjust.'
          END
      END,
      'evaluation_resolved'
    );
  END IF;
  RETURN new;
END;
$$;

-- The old "evaluation waiting" notice stays for old rows; engine invitations notify themselves.
create or replace function public.p2p_notify_evaluator() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.engine_state is not null then
    return new;
  end if;
  if new.status = 'pending' then
    insert into p2p_notifications (user_id, title, message, notification_type)
    values (
      new.evaluator_id,
      'You have a lesson evaluation waiting',
      'A fellow disciple submitted work for review. Please evaluate it when you can.',
      'evaluation_waiting'
    );
  end if;
  return new;
end;
$$;

-- ── Guard: clients can never change who evaluates or any engine column ──────
-- Engine rows change only inside the engine functions. An evaluator on an
-- older app may still resolve an in-progress evaluation they accepted (before
-- its deadline): that is turned into a proper completion.
create or replace function public.p2p_eval_guard() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('p2p.eval_engine', true), '') = 'on' or coalesce(current_setting('p2p.restoring', true), '') = 'on' then return new; end if;
  if auth.uid() is null then return new; end if;   -- service role / maintenance
  if tg_op = 'INSERT' then
    if new.engine_state is not null then raise exception 'P2P_EVAL: evaluations are created by P2P Global' using errcode = '42501'; end if;
    return new;
  end if;
  if old.engine_state is null and new.engine_state is null then return new; end if;
  if old.engine_state = 'in_progress' and auth.uid() = old.evaluator_id and now() < old.deadline_at
     and new.status in ('approved', 'needs_revision') and old.status = 'pending'
     and new.evaluator_id is not distinct from old.evaluator_id and new.engine_state is not distinct from old.engine_state
     and new.current_assignment_id is not distinct from old.current_assignment_id and new.deadline_at is not distinct from old.deadline_at
     and new.accepted_at is not distinct from old.accepted_at and new.submitter_id is not distinct from old.submitter_id
     and new.submission_id is not distinct from old.submission_id and new.outcome is not distinct from old.outcome then
    new.engine_state := 'completed';
    new.outcome := case when new.status = 'approved' then 'passed' else 'revision_required' end;
    new.current_assignment_id := null;
    perform set_config('p2p.eval_engine', 'on', true);
    update p2p_evaluation_assignments set status = 'completed', ended_at = now(), end_reason = 'completed_legacy_app', draft = null where id = old.current_assignment_id;
    perform p2p_eval_event(old.id, old.current_assignment_id, 'completed', 'evaluator', auth.uid(), jsonb_build_object('outcome', new.outcome, 'via', 'legacy_app'), format('eval:%s:completed', old.id));
    perform p2p_eval_notify(old.submitter_id, 'evaluation_feedback_ready', 'Your feedback is ready',
      'Your evaluator has completed their review. Open it to read their feedback.', jsonb_build_object('evaluationId', old.id), format('eval:%s:feedback-ready', old.id));
    return new;
  end if;
  raise exception 'P2P_EVAL: this evaluation is managed by P2P Global' using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_eval_guard on public.p2p_lesson_evaluations;
create trigger trg_p2p_eval_guard before insert or update on public.p2p_lesson_evaluations
  for each row execute function public.p2p_eval_guard();

-- ── Access: the new tables are API-only (RLS on, no client policies) ────────
alter table public.p2p_evaluation_settings enable row level security;
alter table public.p2p_evaluator_profiles enable row level security;
alter table public.p2p_evaluation_assignments enable row level security;
alter table public.p2p_evaluation_events enable row level security;
alter table public.p2p_evaluation_quality enable row level security;
revoke all on public.p2p_evaluation_settings, public.p2p_evaluator_profiles, public.p2p_evaluation_assignments,
  public.p2p_evaluation_events, public.p2p_evaluation_quality from anon, authenticated;
grant all on public.p2p_evaluation_settings, public.p2p_evaluator_profiles, public.p2p_evaluation_assignments,
  public.p2p_evaluation_events, public.p2p_evaluation_quality to service_role;
-- Engine functions: the API (service role) only — never callable from a phone.
revoke execute on function public.p2p_eval_settings(), public.p2p_eval_coordinators(), public.p2p_eval_event(uuid, uuid, text, text, uuid, jsonb, text),
  public.p2p_eval_notify(uuid, text, text, text, jsonb, text), public.p2p_eval_category(uuid), public.p2p_eval_can_evaluate(uuid, uuid),
  public.p2p_eval_pick(uuid), public.p2p_eval_advance(uuid, text, text, uuid), public.p2p_eval_end_and_reassign(uuid, text, text, text, uuid, jsonb),
  public.p2p_eval_accept(uuid, uuid), public.p2p_eval_decline(uuid, uuid, text), public.p2p_eval_report_unable(uuid, uuid, text, text),
  public.p2p_eval_save_draft(uuid, uuid, jsonb), public.p2p_eval_submit(uuid, uuid, text, jsonb, text), public.p2p_eval_admin_reassign(uuid, uuid, text),
  public.p2p_eval_sweep(integer), public.p2p_eval_open_discussion(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.p2p_eval_advance(uuid, text, text, uuid), public.p2p_eval_accept(uuid, uuid), public.p2p_eval_decline(uuid, uuid, text),
  public.p2p_eval_report_unable(uuid, uuid, text, text), public.p2p_eval_save_draft(uuid, uuid, jsonb), public.p2p_eval_submit(uuid, uuid, text, jsonb, text),
  public.p2p_eval_admin_reassign(uuid, uuid, text), public.p2p_eval_sweep(integer), public.p2p_eval_open_discussion(uuid, uuid), public.p2p_eval_can_evaluate(uuid, uuid),
  public.p2p_eval_pick(uuid) to service_role;

commit;

-- ── Continuous operation: the sweep every 5 minutes (pg_cron, server-side) ──
do $do$ begin
  if not exists (select 1 from cron.job where jobname = 'p2p-evaluation-sweep') then
    perform cron.schedule('p2p-evaluation-sweep', '*/5 * * * *', 'select public.p2p_eval_sweep(200);');
  end if;
exception when others then
  raise warning 'P2P_EVAL: the evaluation sweep could not be scheduled here (%); schedule it with pg_cron', sqlerrm;
end $do$;

-- Rollback (engine off first: update p2p_evaluation_settings set engine_enabled = false;)
--   select cron.unschedule('p2p-evaluation-sweep');
--   drop trigger if exists trg_p2p_eval_guard on public.p2p_lesson_evaluations;
--   (restore 007's p2p_assign_evaluator_on_submission / p2p_reassign_stale_evaluations / p2p_notify_submitter_on_resolution bodies)
--   drop table p2p_evaluation_quality, p2p_evaluation_events, p2p_evaluation_assignments, p2p_evaluator_profiles, p2p_evaluation_settings;
--   alter table p2p_lesson_evaluations drop columns engine_state … attempts; p2p_conversations drop evaluation_id.
