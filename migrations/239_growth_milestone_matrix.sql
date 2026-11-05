-- 239 — Growth Milestone Matrix (calculation version 2): ONE server-authoritative
-- evidence ledger and ONE calculation engine. Written 2026-11-05.
-- NOT APPLIED. Apply only with the guarded production procedure after the
-- owner's explicit approval. Additive: no table, column, row or relationship is
-- deleted; nobody's stage goes down; promotions stay OFF.
--
-- What this does
--   • Four independent dimensions — Consistency · Learning · Application ·
--     Service & Contribution. A stage is met only when EVERY requirement of
--     every dimension is met; nothing in one dimension compensates for another.
--   • p2p_growth_matrix: the authoritative thresholds (calculation version 2),
--     the single place they live. The engine, API and app all read them from
--     here; only an administrator can change them, while the matrix is a
--     draft, with a reason (p2p_growth_matrix_changes).
--   • p2p_growth_evidence: an append-only ledger written only by the server from
--     trustworthy records — never from lesson_progress.completed, plan
--     enrolments, client-written activity events or screen views. Every record
--     has a stable natural deduplication key, a server-bounded occurrence time,
--     the participant-local date AT EVENT TIME (a later timezone change never
--     rewrites history), verification, verifier and beneficiaries. Corrections
--     are reviews (p2p_growth_evidence_reviews), never deletions.
--   • Learning = ASSESSED learning: a lesson-backed unit (Kingdom School lesson,
--     Kingdom Stories chapter, Learning Plan session — any resource, the unit
--     is the lesson) counts once, when EVERY question of its assessment has a
--     peer approval that is not self-approved, not by the learner, and not
--     from an evaluation whose quality concern was substantiated. Attempts and
--     revisions are recorded separately and earn nothing. A lesson with no
--     assessment earns nothing and is listed for administrators.
--   • Forest Builder also needs EVERY published lesson of Kingdom School Foundations
--     (Kingdom School Foundations: every published lesson of every published
--     Kingdom School curriculum) passed, in addition to 100 units.
--   • Application: verified practical actions from existing workflows only —
--     assessment questions an administrator marks as practical, reviewed
--     Family/Church group assignments, and service/compassion actions confirmed
--     by the other person. No new forms, diaries or uploads; no private content.
--   • Service & Contribution: useful learning feedback given as an evaluator,
--     facilitating Study Together / live study / Family learning (ONE event per
--     session for the facilitator — never per attendee), and support confirmed
--     by the person helped. Attendance alone never counts as a contribution.
--   • Guide genealogy vs contribution network: the designated relationship
--     (p2p_discipleship_links, history kept) is separate from the contribution
--     network (who verifiably helped whom). Credit is never inherited or
--     transferred. Fruitful Tree / Forest Builder require evidenced learner
--     development and second-generation contribution, from the ledger.
--   • Consistency: active weeks/months from meaningful evidence only, on
--     event-time local dates; rolling windows; time at the current stage;
--     personal pauses (p2p_growth_pauses) that never erase evidence and never
--     count against anyone.
--   • The previous formulas can no longer change anyone's stage: the 236 legacy
--     branch is removed and the old growth_level triggers are frozen.
--   • Phone writes keep working for older builds, but cannot fabricate
--     qualifying timestamps or re-target records (server-time guards).
--   • Forest of Nations: collective totals only, with small-cell suppression;
--     countries only for people who explicitly opt in.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Settings (one row; every tunable value lives here or in the matrix)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.p2p_growth_settings
  add column if not exists legacy_formula_frozen   boolean not null default true,
  add column if not exists enforce_guide_stage     boolean not null default true,
  add column if not exists exceptions_enabled      boolean not null default false,
  add column if not exists development_min_units   integer not null default 3  check (development_min_units >= 1),
  add column if not exists feedback_min_chars      integer not null default 20 check (feedback_min_chars >= 0),
  add column if not exists min_session_minutes     integer not null default 10 check (min_session_minutes >= 1),
  add column if not exists listening_min_seconds   integer not null default 60 check (listening_min_seconds >= 1),
  add column if not exists confirmation_pair_days  integer not null default 30 check (confirmation_pair_days >= 1),
  add column if not exists collective_min_cell     integer not null default 5  check (collective_min_cell >= 2),
  add column if not exists max_pause_days_per_year integer not null default 90 check (max_pause_days_per_year between 0 and 365),
  add column if not exists server_activity_types   text[] not null default array['prayer_gathering_completed', 'peer_prayer_supported', 'prayer_offered', 'scripture_devotional_completed'];

-- Version 2 starts as a draft with promotions off, whatever was set before.
update public.p2p_growth_settings
   set calc_version = 2, thresholds_status = 'draft', promotions_enabled = false, approved_at = null, approved_by = null,
       updated_at = now();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. The matrix (calculation version 2) and its change log
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.p2p_growth_matrix (
  calc_version  integer  not null,
  stage         smallint not null check (stage between 2 and 5),
  dimension     text     not null check (dimension in ('consistency', 'learning', 'application', 'service')),
  fact_key      text     not null check (fact_key in (
                  'journey_days', 'active_weeks', 'active_months', 'active_weeks_window', 'days_in_stage',
                  'learning_units', 'core_curriculum_complete', 'application_actions', 'contributions',
                  'learners_supported_developed', 'second_generation_contributors', 'second_generation_sustained')),
  min_value     numeric  not null check (min_value >= 0),
  param         integer  check (param is null or param between 1 and 104),   -- window weeks / months, where the fact needs one
  label         text     not null,
  explanation   text     not null,
  display_order smallint not null default 0,
  primary key (calc_version, stage, fact_key)
);

insert into public.p2p_growth_matrix (calc_version, stage, dimension, fact_key, min_value, param, label, explanation, display_order) values
  -- Seed → Sprout
  (2, 2, 'consistency', 'journey_days',   30, null, 'At least 30 days of participation', 'Counted from your first meaningful activity on P2P Global (not sign-ins or screen views).', 1),
  (2, 2, 'consistency', 'active_weeks',    4, null, 'Active in at least 4 weeks', 'One meaningful activity in a week makes it an active week; more activity in the same week does not add weeks.', 2),
  (2, 2, 'consistency', 'active_months',   2, null, 'Active in at least 2 calendar months', 'Calendar months in which you had at least one meaningful activity.', 3),
  (2, 2, 'learning',    'learning_units', 10, null, '10 learning units passed', 'A lesson, story chapter or plan session counts once, when its assessment has been passed and reviewed by a peer. Opening or reading content does not count.', 4),
  (2, 2, 'application', 'application_actions', 10, null, '10 verified practical actions', 'Practical activities completed through existing P2P workflows and verified by a reviewer or the person involved.', 5),
  (2, 2, 'service',     'contributions',  10, null, '10 verified contributions to others'' learning', 'Useful learning feedback, facilitating a study session, or help confirmed by the person you supported. Attendance and messages alone do not count.', 6),
  -- Sprout → Young Tree
  (2, 3, 'consistency', 'days_in_stage',      90, null, 'At least 3 months as a Sprout', 'Time at your current milestone. Paused periods are not counted against you.', 1),
  (2, 3, 'consistency', 'active_weeks_window', 10,  16, 'Active in 10 of your latest 16 weeks', 'Paused weeks are skipped, so the window reaches further back instead.', 2),
  (2, 3, 'consistency', 'active_months',       3, null, 'Active in at least 3 calendar months', 'Calendar months in which you had at least one meaningful activity.', 3),
  (2, 3, 'learning',    'learning_units',     20, null, '20 learning units passed', 'Total passed learning units since you joined.', 4),
  (2, 3, 'application', 'application_actions', 20, null, '20 verified practical actions', 'Total verified practical actions since you joined.', 5),
  (2, 3, 'service',     'contributions',      20, null, '20 verified contributions', 'Total verified contributions since you joined.', 6),
  -- Young Tree → Fruitful Tree
  (2, 4, 'consistency', 'days_in_stage',      180, null, 'At least 6 months as a Young Tree', 'Time at your current milestone. Paused periods are not counted against you.', 1),
  (2, 4, 'consistency', 'active_weeks_window', 18,  26, 'Active in 18 of your latest 26 weeks', 'Paused weeks are skipped, so the window reaches further back instead.', 2),
  (2, 4, 'learning',    'learning_units',      50, null, '50 learning units passed', 'Total passed learning units since you joined.', 3),
  (2, 4, 'application', 'application_actions', 50, null, '50 verified practical actions', 'Total verified practical actions since you joined.', 4),
  (2, 4, 'service',     'contributions',       50, null, '50 verified contributions', 'Total verified contributions since you joined.', 5),
  (2, 4, 'service',     'learners_supported_developed', 1, 3, 'Helped one learner over 3 months, who developed', 'Verified contributions to the same person in at least 3 different months, and that person passed further learning units afterwards.', 6),
  (2, 4, 'service',     'second_generation_contributors', 1, null, 'Someone you helped is now helping another person', 'A learner you supported has made a verified contribution to someone else.', 7),
  -- Fruitful Tree → Forest Builder
  (2, 5, 'consistency', 'days_in_stage',      180, null, 'At least 6 months as a Fruitful Tree', 'Time at your current milestone. Paused periods are not counted against you.', 1),
  (2, 5, 'consistency', 'active_weeks_window', 18,  26, 'Active in 18 of your latest 26 weeks', 'Paused weeks are skipped, so the window reaches further back instead.', 2),
  (2, 5, 'learning',    'learning_units',     100, null, '100 learning units passed', 'Total passed learning units since you joined.', 3),
  (2, 5, 'learning',    'core_curriculum_complete', 1, null, 'Every Kingdom School Foundations lesson passed', 'Every published lesson in Kingdom School Foundations (Peer-to-Peer Orientation, The Gospel & Salvation, The Christian Foundation and any Foundations lessons added later), each with its assessment passed. Other pathways cannot replace it.', 4),
  (2, 5, 'application', 'application_actions', 100, null, '100 verified practical actions', 'Total verified practical actions since you joined.', 5),
  (2, 5, 'service',     'contributions',      100, null, '100 verified contributions', 'Total verified contributions since you joined.', 6),
  (2, 5, 'service',     'learners_supported_developed', 1, 6, 'Helped one learner over 6 months, who developed', 'Verified contributions to the same person in at least 6 different months, and that person passed further learning units afterwards.', 7),
  (2, 5, 'service',     'second_generation_sustained', 1, 3, 'Someone you helped has helped others for 3 months', 'A learner you supported for 6 months has made verified contributions to other people in at least 3 different months.', 8)
on conflict (calc_version, stage, fact_key) do nothing;

create table if not exists public.p2p_growth_matrix_changes (
  id           uuid primary key default gen_random_uuid(),
  calc_version integer not null,
  stage        smallint not null,
  fact_key     text not null,
  old_value    numeric,
  new_value    numeric not null,
  actor_id     uuid references public.p2p_profiles(id) on delete set null,
  reason       text not null check (char_length(btrim(reason)) >= 5),
  changed_at   timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Evidence types (what each kind of evidence is, in one place)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.p2p_growth_evidence_types (
  evidence_type       text primary key,
  dimension           text not null check (dimension in ('consistency', 'learning', 'application', 'service')),
  credit              boolean not null,            -- counts toward the dimension's total
  counts_for_activity boolean not null,            -- makes a week/month active (Consistency)
  requires_review     boolean not null default false,   -- new evidence waits for an administrator's review
  enabled             boolean not null default true,
  description         text not null
);
insert into public.p2p_growth_evidence_types (evidence_type, dimension, credit, counts_for_activity, description) values
  ('learning.assessment_passed',            'learning',    true,  true,  'Every question of a lesson''s assessment approved by a peer (not self-approved, not the learner)'),
  ('learning.assessment_attempted',         'learning',    false, true,  'An answer submitted to an assessment question (recorded; earns no learning credit)'),
  ('learning.assessment_failed',            'learning',    false, false, 'An answer returned for revision by a peer (recorded; never disqualifies)'),
  ('learning.reflection_submitted',         'consistency', false, true,  'A lesson reflection submitted (its content is never read)'),
  ('application.practical_answer_approved', 'application', true,  true,  'An answer to a question marked practical, approved by a peer'),
  ('application.group_practical_reviewed',  'application', true,  true,  'A Family/Church group assignment reviewed by someone else'),
  ('application.peer_confirmed_action',     'application', true,  true,  'A service or compassion action confirmed by the other person'),
  ('service.learning_feedback',             'service',     true,  true,  'Useful written feedback given as an evaluator on someone else''s answer'),
  ('service.study_session_facilitated',     'service',     true,  true,  'Led a live study session with at least one other participant (one per session)'),
  ('service.family_learning_facilitated',   'service',     true,  true,  'Hosted a Family learning gathering with at least one other participant (one per gathering)'),
  ('service.shared_study_facilitated',      'service',     true,  true,  'Hosted a Study Together study that others responded to (one per study)'),
  ('service.peer_confirmed_support',        'service',     true,  true,  'Encouragement or support confirmed by the person helped'),
  ('consistency.group_learning_attended',   'consistency', false, true,  'Took part in a group learning session (participation only; never a contribution)'),
  ('consistency.scripture_listening',       'consistency', false, true,  'Completed a Scripture listening session (server-recorded)'),
  ('consistency.server_activity',           'consistency', false, true,  'Prayer participation recorded by the server (never screen views)')
on conflict (evidence_type) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. The evidence ledger (append-only), beneficiaries and reviews
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.p2p_growth_evidence (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.p2p_profiles(id) on delete cascade,
  evidence_type       text not null references public.p2p_growth_evidence_types(evidence_type),
  dimension           text not null check (dimension in ('consistency', 'learning', 'application', 'service')),
  credit              boolean not null,
  counts_for_activity boolean not null,
  source_resource     text not null,                -- kingdom_school · kingdom_stories · learning_plan · study_together · family · evaluation · peer_confirmation · scripture · prayer …
  source_table        text not null,
  source_id           text not null,
  dedup_key           text not null unique,         -- the stable natural identity: one underlying action, one record
  unit_key            text,                         -- the learning unit / practical question, where there is one
  occurred_at         timestamptz not null,         -- from the trusted source record, never later than recording
  local_date          date not null,                -- the participant's local date at event time
  time_zone           text not null,
  verification        text not null default 'verified' check (verification in ('verified', 'pending_review', 'rejected')),
  verification_method text not null,
  verified_by         uuid references public.p2p_profiles(id) on delete set null,
  detail              jsonb not null default '{}'::jsonb,   -- ids and counts only, never content
  calc_version        integer not null,
  created_at          timestamptz not null default now(),
  voided_at           timestamptz,
  voided_by           uuid references public.p2p_profiles(id) on delete set null,
  void_reason         text,
  constraint p2p_growth_evidence_not_future check (occurred_at <= created_at + interval '5 minutes'),
  constraint p2p_growth_evidence_void_reason check (voided_at is null or char_length(btrim(coalesce(void_reason, ''))) >= 3)
);
create index if not exists idx_p2p_growth_evidence_user on public.p2p_growth_evidence (user_id, evidence_type, local_date);
create index if not exists idx_p2p_growth_evidence_review on public.p2p_growth_evidence (verification) where verification = 'pending_review';

-- The person or people supported, where reliably evidenced. learner_key is a stable
-- pseudonym, so a contributor's history keeps its shape if a learner later leaves.
create table if not exists public.p2p_growth_evidence_beneficiaries (
  id          uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.p2p_growth_evidence(id) on delete cascade,
  user_id     uuid references public.p2p_profiles(id) on delete set null,
  learner_key text not null,
  unique (evidence_id, learner_key)
);
create index if not exists idx_p2p_growth_beneficiary on public.p2p_growth_evidence_beneficiaries (user_id);
create index if not exists idx_p2p_growth_beneficiary_key on public.p2p_growth_evidence_beneficiaries (learner_key);

-- Learner development, per contributor and learner: live while the learner is on
-- P2P Global; the last verified level is kept if they leave. Derived (rebuilt on
-- every recalculation), never typed in.
create table if not exists public.p2p_growth_learner_development (
  contributor_id   uuid not null references public.p2p_profiles(id) on delete cascade,
  learner_key      text not null,
  learner_id       uuid references public.p2p_profiles(id) on delete set null,
  first_support_at timestamptz not null,
  last_support_at  timestamptz not null,
  support_months   integer not null,
  units_after      integer not null default 0,
  developed        boolean not null default false,
  onward_months    integer not null default 0,
  observed_at      timestamptz not null default now(),
  primary key (contributor_id, learner_key)
);

create table if not exists public.p2p_growth_evidence_reviews (
  id          uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.p2p_growth_evidence(id) on delete cascade,
  action      text not null check (action in ('approve', 'reject', 'void', 'restore', 'auto_void')),
  actor_id    uuid references public.p2p_profiles(id) on delete set null,
  reason      text not null check (char_length(btrim(reason)) >= 3),
  before      jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_p2p_growth_reviews_evidence on public.p2p_growth_evidence_reviews (evidence_id, created_at);

-- Append-only: the facts of a record never change; only its verification/void
-- state, and only through p2p_growth_review_evidence (which logs a review).
-- Records disappear only with the person's own account (cascade).
create or replace function public.p2p_growth_evidence_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from p2p_profiles where id = old.user_id) then
      raise exception 'P2P_GROWTH: evidence is never deleted — void it with a reason instead' using errcode = '42501';
    end if;
    return old;
  end if;
  if coalesce(current_setting('p2p.growth_review', true), '') <> 'on' then
    raise exception 'P2P_GROWTH: evidence is append-only — use a review' using errcode = '42501';
  end if;
  if (new.id, new.user_id, new.evidence_type, new.dimension, new.credit, new.counts_for_activity, new.source_resource, new.source_table,
      new.source_id, new.dedup_key, new.unit_key, new.occurred_at, new.local_date, new.time_zone, new.verification_method, new.detail,
      new.calc_version, new.created_at)
     is distinct from
     (old.id, old.user_id, old.evidence_type, old.dimension, old.credit, old.counts_for_activity, old.source_resource, old.source_table,
      old.source_id, old.dedup_key, old.unit_key, old.occurred_at, old.local_date, old.time_zone, old.verification_method, old.detail,
      old.calc_version, old.created_at) then
    raise exception 'P2P_GROWTH: only the verification of evidence can change' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_growth_evidence_append_only on public.p2p_growth_evidence;
create trigger trg_p2p_growth_evidence_append_only before update or delete on public.p2p_growth_evidence
  for each row execute function public.p2p_growth_evidence_append_only();

create or replace function public.p2p_growth_reviews_append_only() returns trigger
  language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from p2p_growth_evidence where id = old.evidence_id) then return old; end if;
  raise exception 'P2P_GROWTH: evidence reviews are permanent' using errcode = '42501';
end $$;
drop trigger if exists trg_p2p_growth_reviews_append_only on public.p2p_growth_evidence_reviews;
create trigger trg_p2p_growth_reviews_append_only before update or delete on public.p2p_growth_evidence_reviews
  for each row execute function public.p2p_growth_reviews_append_only();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Personal pauses (history kept; never erase evidence)
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.p2p_growth_pauses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.p2p_profiles(id) on delete cascade,
  starts_on      date not null,
  planned_end_on date not null,
  ended_on       date,                    -- set when the person resumes early (the plan is kept)
  reason         text not null check (reason in ('health', 'family', 'travel', 'work', 'ministry', 'other', 'prefer_not_to_say')),
  created_by     uuid references public.p2p_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  ended_by       uuid references public.p2p_profiles(id) on delete set null,
  ended_at       timestamptz,
  constraint p2p_growth_pauses_order check (planned_end_on >= starts_on and (ended_on is null or ended_on >= starts_on - 1)),
  constraint p2p_growth_pauses_length check (planned_end_on - starts_on <= 92)
);
create index if not exists idx_p2p_growth_pauses_user on public.p2p_growth_pauses (user_id, starts_on);

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Small additions to existing tables (additive; older builds unaffected)
-- ════════════════════════════════════════════════════════════════════════════
-- An administrator marks the assessment questions that are practical actions.
alter table public.p2p_assignment_questions add column if not exists is_practical boolean not null default false;
-- Country in the collective view only with explicit consent (show_country_on_profile defaults to true and is not consent).
alter table public.p2p_profiles add column if not exists share_country_in_collective boolean not null default false;
-- Who wrote an activity event. Older rows are 'unknown' and are never evidence.
alter table public.p2p_user_activity_events add column if not exists origin text not null default 'unknown'
  check (origin in ('server', 'client', 'unknown'));
-- An administrator-authorised exception is labelled as such, never as "verified".
alter table public.p2p_growth_status drop constraint if exists p2p_growth_status_verification_check;
alter table public.p2p_growth_status add constraint p2p_growth_status_verification_check
  check (verification in ('verified', 'legacy_unverified', 'exception'));
-- History records the calculation version that made each decision (already present) and its evidence summary.
alter table public.p2p_growth_status add column if not exists evidence_summary jsonb;

-- New permission for reviewing evidence (super admins have every permission already).
insert into public.p2p_admin_role_permissions (role, permission) values ('admin_supervisor', 'growth.review_evidence')
on conflict (role, permission) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Server-controlled timestamps on phone writes (older builds keep working)
-- ════════════════════════════════════════════════════════════════════════════
-- Applies only to requests made with a person's own token (authenticated/anon);
-- the API, the engine and maintenance are unaffected. Arguments:
--   [0] columns set to now() on INSERT;
--   [1] columns set to now() when an UPDATE changes them to a value;
--   [2] columns an UPDATE may not change.
create or replace function public.p2p_growth_server_time() returns trigger
  language plpgsql set search_path = public as $$
declare
  v_role text := coalesce(auth.role(), '');
  v_new jsonb;
  v_old jsonb;
  v_patch jsonb := '{}'::jsonb;
  c text;
begin
  if v_role not in ('authenticated', 'anon') then return new; end if;
  v_new := to_jsonb(new);
  if tg_op = 'INSERT' then
    foreach c in array string_to_array(coalesce(tg_argv[0], ''), ',') loop
      if c <> '' and v_new ? c then v_patch := v_patch || jsonb_build_object(c, now()); end if;
    end loop;
  else
    v_old := to_jsonb(old);
    foreach c in array string_to_array(coalesce(tg_argv[1], ''), ',') loop
      if c <> '' and (v_new -> c) is distinct from (v_old -> c) then
        v_patch := v_patch || jsonb_build_object(c, case when jsonb_typeof(v_new -> c) = 'null' then null else to_jsonb(now()) end);
      end if;
    end loop;
    foreach c in array string_to_array(coalesce(tg_argv[2], ''), ',') loop
      if c <> '' and (v_new -> c) is distinct from (v_old -> c) then v_patch := v_patch || jsonb_build_object(c, v_old -> c); end if;
    end loop;
  end if;
  if v_patch <> '{}'::jsonb then new := jsonb_populate_record(new, v_patch); end if;
  return new;
end $$;

-- Submissions: the answer's time is the server's.
drop trigger if exists trg_p2p_growth_server_time on public.p2p_submissions;
create trigger trg_p2p_growth_server_time before insert or update on public.p2p_submissions
  for each row execute function public.p2p_growth_server_time('created_at', '', 'user_id,lesson_id,assignment_question_id,reflection_question_id,created_at');
-- Evaluations (older evaluation rows the phone may still resolve): resolution time is the server's; who and what can't be re-targeted.
drop trigger if exists trg_p2p_growth_server_time on public.p2p_lesson_evaluations;
create trigger trg_p2p_growth_server_time before update on public.p2p_lesson_evaluations
  for each row execute function public.p2p_growth_server_time('', 'resolved_at', 'submission_id,lesson_id,submitter_id,self_approved,created_at');
-- Peer confirmations: the confirmer can only confirm or decline, at the server's time.
drop trigger if exists trg_p2p_growth_server_time on public.p2p_peer_confirmations;
create trigger trg_p2p_growth_server_time before insert or update on public.p2p_peer_confirmations
  for each row execute function public.p2p_growth_server_time('created_at', 'confirmed_at', 'actor_user_id,confirmer_user_id,confirmation_type,source_type,source_id,created_at');
-- Family gatherings and their participants: start/end/join/leave at the server's time.
drop trigger if exists trg_p2p_growth_server_time on public.p2p_family_worship_sessions;
create trigger trg_p2p_growth_server_time before insert or update on public.p2p_family_worship_sessions
  for each row execute function public.p2p_growth_server_time('created_at', 'started_at,ended_at', 'host_id,family_id,created_at');
drop trigger if exists trg_p2p_growth_server_time on public.p2p_family_worship_participants;
create trigger trg_p2p_growth_server_time before insert or update on public.p2p_family_worship_participants
  for each row execute function public.p2p_growth_server_time('joined_at', 'left_at', 'session_id,user_id,joined_at');

-- Activity events: who wrote it is recorded by the database; a phone cannot
-- relabel or backdate an event.
create or replace function public.p2p_activity_event_origin() returns trigger
  language plpgsql set search_path = public as $$
declare v_phone boolean := coalesce(auth.role(), '') in ('authenticated', 'anon');
begin
  if tg_op = 'INSERT' then
    new.origin := case when v_phone then 'client' else 'server' end;
    if v_phone then new.created_at := now(); end if;
  else
    new.origin := old.origin;
    if v_phone then new.created_at := old.created_at; new.event_type := old.event_type; new.user_id := old.user_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_activity_event_origin on public.p2p_user_activity_events;
create trigger trg_p2p_activity_event_origin before insert or update on public.p2p_user_activity_events
  for each row execute function public.p2p_activity_event_origin();

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Helpers
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_tz(p_tz text) returns text
  language plpgsql stable set search_path = public as $$
begin
  if p_tz is null or btrim(p_tz) = '' then return 'UTC'; end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'UTC';
end $$;

-- Which resource a lesson belongs to (the unit itself is always the lesson).
create or replace function public.p2p_growth_lesson_resource(p_lesson uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select case c.type when 'core' then 'kingdom_school' when 'plan' then 'learning_plan' when 'kingdom_story' then 'kingdom_stories' else coalesce(c.type, 'learning') end
      from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums c on c.id = m.curriculum_id
     where l.id = p_lesson), 'learning');
$$;

create or replace function public.p2p_growth_learner_key(p_user uuid) returns text
  language sql immutable set search_path = public as $$
  select md5('p2p-learner:' || p_user::text);
$$;

-- Kingdom School Foundations (the Core Foundations Curriculum): EVERY published
-- lesson in EVERY published Kingdom School curriculum — today Peer-to-Peer
-- Orientation, The Gospel & Salvation and The Christian Foundation — and any
-- Foundations lessons published later, automatically. Draft and archived
-- curricula/lessons are not part of it.
create or replace function public.p2p_growth_foundation_lessons() returns setof uuid
  language sql stable security definer set search_path = public as $$
  select l.id from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums c on c.id = m.curriculum_id
   where c.type = 'core' and c.status = 'published' and l.status = 'published';
$$;

-- Every lesson-backed learning unit and whether it can earn credit (for administrators).
create or replace view public.p2p_growth_learning_units as
  select l.id as lesson_id, 'lesson:' || l.id as unit_key, l.title, l.status::text as lesson_status,
         m.id as module_id, m.title as module_title, c.id as curriculum_id, c.title as curriculum_title, c.type as curriculum_type,
         public.p2p_growth_lesson_resource(l.id) as resource,
         (c.type = 'core' and c.status = 'published' and l.status = 'published') as is_core,
         (select count(*) from p2p_assignments a where a.lesson_id = l.id)::int as assessments,
         (select count(*) from p2p_assignments a join p2p_assignment_questions q on q.assignment_id = a.id where a.lesson_id = l.id)::int as assessment_questions,
         (select count(*) from p2p_assignments a join p2p_assignment_questions q on q.assignment_id = a.id where a.lesson_id = l.id and q.is_practical)::int as practical_questions
    from p2p_lessons l
    left join p2p_modules m on m.id = l.module_id
    left join p2p_curriculums c on c.id = m.curriculum_id;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Evidence recording: one idempotent pass over a person's TRUSTED records
-- ════════════════════════════════════════════════════════════════════════════
-- Never reads: p2p_lesson_progress.completed, plan enrolments, client-written
-- activity events, views, journals, prayer journals, reflection or message
-- content. Re-running it adds only what is new (stable dedup keys); a voided
-- or rejected record is never recreated.
create or replace function public.p2p_growth_sync_evidence(p_user uuid) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_set record;
  v_tz text;
  v_joined timestamptz;
  v_n int := 0;
  v_k int;
  v_period numeric;
  v_void record;
begin
  select * into v_set from p2p_growth_settings;
  select p2p_growth_tz(p.timezone), coalesce(p.created_at at time zone 'UTC', '-infinity'::timestamptz)
    into v_tz, v_joined from p2p_profiles p where p.id = p_user;
  if v_tz is null then return 0; end if;
  v_period := v_set.confirmation_pair_days * 86400.0;

  -- The latest answer to each assessment question and its latest evaluation.
  if to_regclass('pg_temp.p2p_growth_tmp_latest') is null then
    create temporary table p2p_growth_tmp_latest (
      lesson_id uuid, question_id uuid, submission_id uuid, submitted_at timestamptz,
      evaluation_id uuid, status text, valid_peer boolean, evaluator_id uuid, resolved_at timestamptz
    ) on commit drop;
  end if;
  truncate p2p_growth_tmp_latest;
  insert into p2p_growth_tmp_latest
  select distinct on (s.assignment_question_id)
         s.lesson_id, s.assignment_question_id, s.id, s.created_at, e.id, e.status,
         (e.status = 'approved' and not coalesce(e.self_approved, false) and e.evaluator_id is not null and e.evaluator_id <> p_user
          and e.resolved_at is not null
          and not exists (select 1 from p2p_evaluation_quality q where q.evaluation_id = e.id and q.substantiated is true)),
         e.evaluator_id, e.resolved_at
    from p2p_submissions s
    left join lateral (select * from p2p_lesson_evaluations e where e.submission_id = s.id order by e.created_at desc limit 1) e on true
   where s.user_id = p_user and s.assignment_question_id is not null
   order by s.assignment_question_id, s.created_at desc;

  with src (evidence_type, source_resource, source_table, source_id, dedup_key, unit_key, occurred_at, method, verified_by, detail, beneficiaries) as (
    -- Learning — assessment attempted (activity only)
    select 'learning.assessment_attempted', p2p_growth_lesson_resource(s.lesson_id), 'p2p_submissions', s.id::text,
           'attempt:' || s.id, 'lesson:' || s.lesson_id, s.created_at, 'server_record', null::uuid,
           jsonb_build_object('lesson_id', s.lesson_id, 'question_id', s.assignment_question_id), '{}'::uuid[]
      from p2p_submissions s where s.user_id = p_user and s.assignment_question_id is not null
    union all
    -- Consistency — lesson reflection submitted (never read)
    select 'learning.reflection_submitted', p2p_growth_lesson_resource(s.lesson_id), 'p2p_submissions', s.id::text,
           'reflection:' || s.id, 'lesson:' || s.lesson_id, s.created_at, 'server_record', null, jsonb_build_object('lesson_id', s.lesson_id), '{}'
      from p2p_submissions s where s.user_id = p_user and s.reflection_question_id is not null and s.assignment_question_id is null
    union all
    -- Learning — assessment returned for revision (recorded, earns nothing)
    select 'learning.assessment_failed', p2p_growth_lesson_resource(e.lesson_id), 'p2p_lesson_evaluations', e.id::text,
           'failed:' || e.id, 'lesson:' || e.lesson_id, e.resolved_at, 'peer_evaluation', e.evaluator_id, jsonb_build_object('lesson_id', e.lesson_id), '{}'
      from p2p_lesson_evaluations e
     where e.submitter_id = p_user and e.status = 'needs_revision' and not coalesce(e.self_approved, false)
       and e.evaluator_id is not null and e.evaluator_id <> p_user and e.resolved_at is not null
    union all
    -- Learning — assessment PASSED: every question of the lesson's assessment peer-approved
    select 'learning.assessment_passed', p2p_growth_lesson_resource(x.lesson_id), 'p2p_lessons', x.lesson_id::text,
           'passed:' || p_user || ':' || x.lesson_id, 'lesson:' || x.lesson_id, x.at, 'peer_evaluation', null,
           jsonb_build_object('lesson_id', x.lesson_id, 'questions', x.n, 'evaluation_ids', x.evals), '{}'
      from (
        select q.lesson_id, max(t.resolved_at) as at, count(*) as n, jsonb_agg(distinct t.evaluation_id) as evals
          from (select a.lesson_id, aq.id as qid from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id
                 where a.lesson_id in (select distinct lesson_id from p2p_growth_tmp_latest)) q
          left join p2p_growth_tmp_latest t on t.question_id = q.qid
         group by q.lesson_id
        having bool_and(coalesce(t.valid_peer, false))
      ) x
    union all
    -- Application — a practical question's answer approved by a peer
    select 'application.practical_answer_approved', p2p_growth_lesson_resource(t.lesson_id), 'p2p_assignment_questions', t.question_id::text,
           'practical:' || p_user || ':' || t.question_id, 'question:' || t.question_id, t.resolved_at, 'peer_evaluation', t.evaluator_id,
           jsonb_build_object('lesson_id', t.lesson_id, 'evaluation_id', t.evaluation_id), '{}'
      from p2p_growth_tmp_latest t join p2p_assignment_questions q on q.id = t.question_id
     where q.is_practical and t.valid_peer
    union all
    -- Application — a Family/Church group assignment reviewed by someone else (once per assignment)
    (select distinct on (g.assignment_id) 'application.group_practical_reviewed', 'group_learning', 'p2p_group_assignment_submissions', g.id::text,
           'group_practical:' || p_user || ':' || g.assignment_id, 'group_assignment:' || g.assignment_id, g.reviewed_at, 'facilitator_review', g.reviewed_by,
           jsonb_build_object('assignment_id', g.assignment_id), '{}'::uuid[]
      from p2p_group_assignment_submissions g
     where g.user_id = p_user and g.status = 'reviewed' and g.reviewed_by is not null and g.reviewed_by <> p_user and g.reviewed_at is not null
     order by g.assignment_id, g.reviewed_at)
    union all
    -- Application — a service/compassion action confirmed by the other person (one per pair per period)
    select 'application.peer_confirmed_action', 'peer_confirmation', 'p2p_peer_confirmations', c.id::text,
           'app_confirm:' || p_user || ':' || c.confirmer_user_id || ':' || floor(extract(epoch from c.confirmed_at) / v_period),
           null, c.confirmed_at, 'peer_confirmation', c.confirmer_user_id,
           jsonb_build_object('confirmation_type', c.confirmation_type, 'source_type', c.source_type), array[c.confirmer_user_id]
      from p2p_peer_confirmations c
     where c.actor_user_id = p_user and c.confirmer_user_id <> p_user and c.confirmation_status = 'confirmed'
       and c.confirmed_at is not null and c.confirmation_type in ('service', 'compassion')
       -- A confirmation about an evaluation (created automatically for a Guide's feedback) is the
       -- same act as the feedback itself, already a contribution — never also a practical action.
       and coalesce(c.source_type, '') <> 'evaluation_feedback'
    union all
    -- Service — useful learning feedback given as an evaluator (one per evaluation)
    select 'service.learning_feedback', 'evaluation', 'p2p_lesson_evaluations', e.id::text,
           'feedback:' || e.id, 'lesson:' || e.lesson_id, e.resolved_at, 'peer_evaluation_engine', null,
           jsonb_build_object('lesson_id', e.lesson_id, 'status', e.status), array[e.submitter_id]
      from p2p_lesson_evaluations e
     where e.evaluator_id = p_user and e.submitter_id is not null and e.submitter_id <> p_user and not coalesce(e.self_approved, false)
       and e.status in ('approved', 'needs_revision') and e.resolved_at is not null
       and (char_length(btrim(coalesce(e.feedback, ''))) >= v_set.feedback_min_chars or e.feedback_detail is not null)
       and not exists (select 1 from p2p_evaluation_quality q where q.evaluation_id = e.id and q.substantiated is true)
    union all
    -- Service — led a live study session with someone else present long enough (ONE per session)
    select 'service.study_session_facilitated', 'study_together', 'p2p_study_sessions', s.id::text,
           'service:' || p_user || ':session:' || s.id, 'lesson:' || s.lesson_id, s.ended_at, 'server_record', null,
           jsonb_build_object('lesson_id', s.lesson_id, 'participants', cardinality(b.ids)), b.ids
      from p2p_study_sessions s
      cross join lateral (select coalesce(array_agg(distinct p.user_id), '{}') as ids from p2p_study_session_participants p
                           where p.study_session_id = s.id and p.user_id <> p_user
                             and coalesce(p.left_at, s.ended_at) - p.joined_at >= make_interval(mins => v_set.min_session_minutes)) b
     where s.leader_id = p_user and s.status = 'ended' and s.ended_at is not null
       and s.ended_at - s.started_at >= make_interval(mins => v_set.min_session_minutes) and cardinality(b.ids) > 0
    union all
    -- Service — hosted a Family learning gathering with someone else present (ONE per gathering)
    select 'service.family_learning_facilitated', 'family', 'p2p_family_worship_sessions', f.id::text,
           'service:' || p_user || ':family:' || f.id, case when f.lesson_id is not null then 'lesson:' || f.lesson_id end, f.ended_at, 'server_record', null,
           jsonb_build_object('participants', cardinality(b.ids)), b.ids
      from p2p_family_worship_sessions f
      cross join lateral (select coalesce(array_agg(distinct p.user_id), '{}') as ids from p2p_family_worship_participants p
                           where p.session_id = f.id and p.user_id <> p_user
                             and coalesce(p.left_at, f.ended_at) - p.joined_at >= make_interval(mins => v_set.min_session_minutes)) b
     where f.host_id = p_user and f.ended_at is not null and f.started_at is not null
       and (f.lesson_id is not null or f.family_lesson_id is not null)
       and f.ended_at - f.started_at >= make_interval(mins => v_set.min_session_minutes) and cardinality(b.ids) > 0
    union all
    -- Service — hosted a Study Together study that others responded to (ONE per study)
    select 'service.shared_study_facilitated', 'study_together', 'p2p_shared_studies', st.id::text,
           'service:' || p_user || ':shared:' || st.id, null, st.concluded_at, 'server_record', null,
           jsonb_build_object('content_type', st.content_type, 'participants', cardinality(b.ids)), b.ids
      from p2p_shared_studies st
      cross join lateral (select coalesce(array_agg(distinct r.user_id), '{}') as ids from p2p_shared_study_responses r
                           where r.study_id = st.id and r.user_id <> p_user) b
     where st.host_id = p_user and st.status = 'concluded' and st.concluded_at is not null and cardinality(b.ids) > 0
    union all
    -- Service — support confirmed by the person helped (one per pair per period; never twice for an
    -- evaluation or a session already counted above)
    select 'service.peer_confirmed_support', 'peer_confirmation', 'p2p_peer_confirmations', c.id::text,
           'svc_confirm:' || p_user || ':' || c.confirmer_user_id || ':' || floor(extract(epoch from c.confirmed_at) / v_period),
           null, c.confirmed_at, 'peer_confirmation', c.confirmer_user_id,
           jsonb_build_object('confirmation_type', c.confirmation_type, 'source_type', c.source_type), array[c.confirmer_user_id]
      from p2p_peer_confirmations c
     where c.actor_user_id = p_user and c.confirmer_user_id <> p_user and c.confirmation_status = 'confirmed' and c.confirmed_at is not null
       and c.confirmation_type in ('encouragement', 'fellowship', 'unity', 'global')
       and coalesce(c.source_type, '') <> 'evaluation_feedback'
       and not (c.source_type = 'session' and exists (select 1 from p2p_study_sessions s where s.id = c.source_id and s.leader_id = p_user))
    union all
    -- Consistency — took part in group learning (participation only)
    select 'consistency.group_learning_attended', 'study_together', 'p2p_study_session_participants', p.id::text,
           'attend:study:' || p.id, 'lesson:' || s.lesson_id, coalesce(p.left_at, s.ended_at), 'server_record', null, '{}'::jsonb, '{}'
      from p2p_study_session_participants p join p2p_study_sessions s on s.id = p.study_session_id
     where p.user_id = p_user and s.leader_id <> p_user and s.ended_at is not null
       and coalesce(p.left_at, s.ended_at) - p.joined_at >= make_interval(mins => v_set.min_session_minutes)
    union all
    select 'consistency.group_learning_attended', 'family', 'p2p_family_worship_participants', p.id::text,
           'attend:family:' || p.id, null, coalesce(p.left_at, f.ended_at), 'server_record', null, '{}'::jsonb, '{}'
      from p2p_family_worship_participants p join p2p_family_worship_sessions f on f.id = p.session_id
     where p.user_id = p_user and f.host_id is distinct from p_user and f.ended_at is not null
       and (f.lesson_id is not null or f.family_lesson_id is not null)
       and coalesce(p.left_at, f.ended_at) - p.joined_at >= make_interval(mins => v_set.min_session_minutes)
    union all
    (select distinct on (r.study_id) 'consistency.group_learning_attended', 'study_together', 'p2p_shared_study_responses', r.id::text,
           'attend:shared:' || p_user || ':' || r.study_id, null::text, r.created_at, 'server_record', null::uuid, '{}'::jsonb, '{}'::uuid[]
      from p2p_shared_study_responses r join p2p_shared_studies st on st.id = r.study_id
     where r.user_id = p_user and st.host_id <> p_user
     order by r.study_id, r.created_at)
    union all
    -- Consistency — Scripture listening completed (server-recorded)
    select 'consistency.scripture_listening', 'scripture', 'p2p_scripture_listening_history', h.id::text,
           'listen:' || h.id, null, h.completed_at, 'server_record', null, jsonb_build_object('source', h.source), '{}'
      from p2p_scripture_listening_history h
     where h.user_id = p_user and h.completed_at is not null and coalesce(h.listened_seconds, 0) >= v_set.listening_min_seconds
    union all
    -- Consistency — prayer participation recorded by the server (never views, never phone-written)
    select 'consistency.server_activity', 'prayer', 'p2p_user_activity_events', a.id::text,
           'activity:' || a.id, null, a.created_at, 'server_record', null, jsonb_build_object('event_type', a.event_type), '{}'
      from p2p_user_activity_events a
     where a.user_id = p_user and a.origin = 'server' and a.event_type = any (v_set.server_activity_types)
  ),
  typed as (
    select s.*, t.dimension, t.credit, t.counts_for_activity, t.requires_review,
           greatest(least(s.occurred_at, now()), v_joined) as at
      from src s join p2p_growth_evidence_types t on t.evidence_type = s.evidence_type and t.enabled
     where s.occurred_at is not null
  ),
  ins as (
    insert into p2p_growth_evidence (user_id, evidence_type, dimension, credit, counts_for_activity, source_resource, source_table, source_id,
                                     dedup_key, unit_key, occurred_at, local_date, time_zone, verification, verification_method, verified_by,
                                     detail, calc_version)
    select p_user, evidence_type, dimension, credit, counts_for_activity, source_resource, source_table, source_id,
           dedup_key, unit_key, at, (at at time zone v_tz)::date, v_tz,
           case when requires_review then 'pending_review' else 'verified' end, method, verified_by, detail, v_set.calc_version
      from typed
    on conflict (dedup_key) do nothing
    returning id, dedup_key
  ),
  ben as (
    insert into p2p_growth_evidence_beneficiaries (evidence_id, user_id, learner_key)
    select ins.id, b, p2p_growth_learner_key(b) from ins join typed on typed.dedup_key = ins.dedup_key cross join lateral unnest(typed.beneficiaries) b
     where b is not null and b <> p_user and exists (select 1 from p2p_profiles where id = b)
    on conflict do nothing
    returning 1
  )
  select count(*) into v_k from ins;
  v_n := v_n + v_k;

  -- Evidence whose basis was later found invalid is voided (with a review), never deleted.
  for v_void in
    select ev.id from p2p_growth_evidence ev
     where ev.user_id = p_user and ev.voided_at is null and (
           (ev.evidence_type = 'service.learning_feedback'
            and exists (select 1 from p2p_evaluation_quality q where q.evaluation_id = ev.source_id::uuid and q.substantiated is true))
        or (ev.evidence_type = 'learning.assessment_passed'
            and exists (select 1 from p2p_evaluation_quality q
                         where q.substantiated is true and ev.detail -> 'evaluation_ids' @> to_jsonb(q.evaluation_id::text))))
  loop
    perform p2p_growth_review_evidence(v_void.id, null, 'auto_void', 'The evaluation behind this record had a substantiated quality concern');
  end loop;

  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Reviews and corrections (auditable and reversible)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_review_evidence(p_evidence uuid, p_actor uuid, p_action text, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  e record;
begin
  if p_action not in ('approve', 'reject', 'void', 'restore', 'auto_void') then raise exception 'P2P_GROWTH: unknown review action'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'P2P_GROWTH: a reason is required'; end if;
  select * into e from p2p_growth_evidence where id = p_evidence for update;
  if e.id is null then raise exception 'P2P_GROWTH: no such evidence'; end if;
  if p_actor is not null and p_actor = e.user_id then raise exception 'P2P_GROWTH: nobody reviews their own evidence' using errcode = '42501'; end if;
  insert into p2p_growth_evidence_reviews (evidence_id, action, actor_id, reason, before)
  values (e.id, p_action, p_actor, btrim(p_reason), jsonb_build_object('verification', e.verification, 'voided_at', e.voided_at, 'void_reason', e.void_reason));
  perform set_config('p2p.growth_review', 'on', true);
  update p2p_growth_evidence set
    verification = case p_action when 'approve' then 'verified' when 'reject' then 'rejected' else verification end,
    verified_by  = case when p_action in ('approve', 'reject') then p_actor else verified_by end,
    voided_at    = case when p_action in ('void', 'auto_void') then now() when p_action = 'restore' then null else voided_at end,
    voided_by    = case when p_action in ('void', 'auto_void') then p_actor when p_action = 'restore' then null else voided_by end,
    void_reason  = case when p_action in ('void', 'auto_void') then btrim(p_reason) when p_action = 'restore' then null else void_reason end
  where id = e.id;
  perform set_config('p2p.growth_review', 'off', true);
  perform p2p_growth_enqueue(e.user_id, 'evidence_review');
  return jsonb_build_object('id', e.id, 'action', p_action);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Pauses
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_pause_start(p_user uuid, p_starts date, p_ends date, p_reason text, p_actor uuid default null) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone p2p_growth_tz((select timezone from p2p_profiles where id = p_user)))::date;
  v_used int;
  v_cap int := (select max_pause_days_per_year from p2p_growth_settings);
  v_id uuid;
begin
  if p_starts is null or p_ends is null or p_ends < p_starts then raise exception 'P2P_GROWTH_PAUSE: choose a start and an end date'; end if;
  if p_starts < v_today - 7 then raise exception 'P2P_GROWTH_PAUSE: a pause can start at most a week in the past'; end if;
  if p_ends - p_starts > 92 then raise exception 'P2P_GROWTH_PAUSE: one pause can last at most three months'; end if;
  if exists (select 1 from p2p_growth_pauses where user_id = p_user and coalesce(ended_on, planned_end_on) >= starts_on
               and starts_on <= p_ends and coalesce(ended_on, planned_end_on) >= p_starts) then
    raise exception 'P2P_GROWTH_PAUSE: this overlaps a pause you already have';
  end if;
  select coalesce(sum(greatest(0, least(coalesce(ended_on, planned_end_on), v_today + 365) - greatest(starts_on, v_today - 365) + 1)), 0)
    into v_used from p2p_growth_pauses where user_id = p_user;
  if v_used + (p_ends - p_starts + 1) > v_cap then
    raise exception 'P2P_GROWTH_PAUSE: pauses can total at most % days in a year', v_cap;
  end if;
  insert into p2p_growth_pauses (user_id, starts_on, planned_end_on, reason, created_by)
  values (p_user, p_starts, p_ends, p_reason, coalesce(p_actor, p_user)) returning id into v_id;
  perform p2p_growth_enqueue(p_user, 'pause');
  return v_id;
end $$;

create or replace function public.p2p_growth_pause_end(p_user uuid, p_pause uuid, p_actor uuid default null) returns void
  language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone p2p_growth_tz((select timezone from p2p_profiles where id = p_user)))::date;
begin
  update p2p_growth_pauses
     set ended_on = greatest(starts_on - 1, least(planned_end_on, v_today - 1)), ended_by = coalesce(p_actor, p_user), ended_at = now()
   where id = p_pause and user_id = p_user and ended_on is null and planned_end_on >= v_today;
  if not found then raise exception 'P2P_GROWTH_PAUSE: no current or upcoming pause to end'; end if;
  perform p2p_growth_enqueue(p_user, 'pause');
end $$;

-- Paused days within [p_from, p_to].
create or replace function public.p2p_growth_paused_days(p_user uuid, p_from date, p_to date) returns integer
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(greatest(0, least(coalesce(ended_on, planned_end_on), p_to) - greatest(starts_on, p_from) + 1)), 0)::int
    from p2p_growth_pauses where user_id = p_user and p_to >= p_from;
$$;

-- Active weeks among the latest p_weeks weeks; a mostly-paused week (4+ days) with no
-- activity is skipped, so the window reaches further back — a pause never counts against anyone.
create or replace function public.p2p_growth_active_weeks_window(p_user uuid, p_weeks int, p_today date) returns integer
  language sql stable security definer set search_path = public as $$
  with active as (
    select distinct date_trunc('week', e.local_date)::date as wk from p2p_growth_evidence e
     where e.user_id = p_user and e.counts_for_activity and e.verification = 'verified' and e.voided_at is null and e.local_date <= p_today
  ), cand as (
    select (date_trunc('week', p_today)::date - (k * 7)) as wk from generate_series(0, p_weeks + 104) k
  ), marked as (
    select c.wk, exists (select 1 from active a where a.wk = c.wk) as is_active,
           p2p_growth_paused_days(p_user, c.wk, c.wk + 6) >= 4 as paused
      from cand c
  )
  select count(*) filter (where is_active)::int from (
    select * from marked where is_active or not paused order by wk desc limit greatest(p_weeks, 1)
  ) w;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 11b. Learner development (the contribution network's second half)
-- ════════════════════════════════════════════════════════════════════════════
-- "Over N months" = contributions in N different calendar months, first to last at least (N-1) × 28 days apart
-- (so 31 Jan · 15 Feb · 1 Mar is not "3 months").
-- Development = the learner passed at least development_min_units learning units after the
-- first support. Onward = the learner's own verified contributions to OTHER people since.
create or replace function public.p2p_growth_refresh_development(p_user uuid) returns void
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_min int := (select development_min_units from p2p_growth_settings);
  v_learner uuid;
begin
  -- The learners' own trusted records are recorded first, so their development is current.
  for v_learner in
    select distinct b.user_id from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
     where e.user_id = p_user and e.credit and e.dimension = 'service' and b.user_id is not null and b.user_id <> p_user
  loop
    perform p2p_growth_sync_evidence(v_learner);
  end loop;
  with per as (
    select b.learner_key, (array_agg(b.user_id) filter (where b.user_id is not null))[1] as learner,
           min(e.occurred_at) as f, max(e.occurred_at) as l, count(distinct date_trunc('month', e.local_date))::int as dm
      from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
     where e.user_id = p_user and e.credit and e.dimension = 'service' and e.verification = 'verified' and e.voided_at is null
       and b.user_id is distinct from p_user
     group by b.learner_key
  ), live as (
    select per.*, least(dm, 1 + floor(extract(epoch from (l - f)) / (28 * 86400))::int) as months,
           case when learner is not null then (
             select count(distinct x.unit_key)::int from p2p_growth_evidence x
              where x.user_id = per.learner and x.evidence_type = 'learning.assessment_passed' and x.verification = 'verified'
                and x.voided_at is null and x.occurred_at >= per.f) end as units,
           case when learner is not null then (
             select least(count(distinct date_trunc('month', x.local_date)), 1 + floor(extract(epoch from (max(x.occurred_at) - min(x.occurred_at))) / (28 * 86400)))::int
               from p2p_growth_evidence x join p2p_growth_evidence_beneficiaries b2 on b2.evidence_id = x.id
              where x.user_id = per.learner and x.credit and x.dimension = 'service' and x.verification = 'verified' and x.voided_at is null
                and x.occurred_at >= per.f and b2.learner_key <> per.learner_key and b2.user_id is distinct from p_user) end as onward
      from per
  )
  insert into p2p_growth_learner_development as d (contributor_id, learner_key, learner_id, first_support_at, last_support_at, support_months,
                                                   units_after, developed, onward_months, observed_at)
  select p_user, learner_key, learner, f, l, months, coalesce(units, 0), coalesce(units, 0) >= v_min, coalesce(onward, 0), now() from live
  on conflict (contributor_id, learner_key) do update set
    learner_id = excluded.learner_id, first_support_at = excluded.first_support_at, last_support_at = excluded.last_support_at,
    support_months = excluded.support_months,
    -- A learner who has left keeps their last verified development level.
    units_after   = case when excluded.learner_id is null then d.units_after else excluded.units_after end,
    developed     = case when excluded.learner_id is null then d.developed else excluded.developed end,
    onward_months = case when excluded.learner_id is null then d.onward_months else excluded.onward_months end,
    observed_at   = case when excluded.learner_id is null then d.observed_at else now() end;
  -- Support that no longer stands (its evidence voided) is no longer counted.
  delete from p2p_growth_learner_development d
   where d.contributor_id = p_user and not exists (
     select 1 from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
      where e.user_id = p_user and b.learner_key = d.learner_key and e.credit and e.dimension = 'service'
        and e.verification = 'verified' and e.voided_at is null);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 12. The facts (one function, from the ledger only)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_facts(p_user uuid) returns jsonb
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_set record;
  v_st record;
  v_tz text;
  v_today date;
  v_first timestamptz;
  v_weeks int; v_months int;
  v_units int; v_app int; v_contrib int;
  v_core_total int; v_core_passed int;
  v_paused_in_stage int;
  v_windows jsonb := '{}'::jsonb;
  v_support jsonb := '{}'::jsonb;
  w int;
begin
  select * into v_set from p2p_growth_settings;
  select * into v_st from p2p_growth_status where user_id = p_user;
  select p2p_growth_tz(timezone) into v_tz from p2p_profiles where id = p_user;
  v_today := (now() at time zone coalesce(v_tz, 'UTC'))::date;

  if to_regclass('pg_temp.p2p_growth_tmp_ev') is null then
    create temporary table p2p_growth_tmp_ev on commit drop as select * from p2p_growth_evidence limit 0;
  end if;
  truncate p2p_growth_tmp_ev;
  insert into p2p_growth_tmp_ev select * from p2p_growth_evidence e where e.user_id = p_user and e.verification = 'verified' and e.voided_at is null;

  select min(occurred_at), count(distinct date_trunc('week', local_date)), count(distinct date_trunc('month', local_date))
    into v_first, v_weeks, v_months from p2p_growth_tmp_ev where counts_for_activity;
  select count(distinct unit_key) filter (where evidence_type = 'learning.assessment_passed'),
         count(*) filter (where credit and dimension = 'application'),
         count(*) filter (where credit and dimension = 'service')
    into v_units, v_app, v_contrib from p2p_growth_tmp_ev;

  select count(*) into v_core_total from p2p_growth_foundation_lessons();
  select count(distinct e.unit_key) into v_core_passed
    from p2p_growth_tmp_ev e
   where e.evidence_type = 'learning.assessment_passed' and e.unit_key in (select 'lesson:' || f from p2p_growth_foundation_lessons() f);

  for w in select distinct param from p2p_growth_matrix where calc_version = v_set.calc_version and fact_key = 'active_weeks_window' and param is not null loop
    v_windows := v_windows || jsonb_build_object(w::text, p2p_growth_active_weeks_window(p_user, w, v_today));
  end loop;

  v_paused_in_stage := case when v_st.stage_since is null then 0
                            else p2p_growth_paused_days(p_user, (v_st.stage_since at time zone coalesce(v_tz, 'UTC'))::date, v_today) end;

  -- Contribution network: people this person verifiably helped, in how many months,
  -- whether they developed afterwards, and whether they went on to help others.
  perform p2p_growth_refresh_development(p_user);
  select jsonb_build_object(
           'learners_supported', count(*),
           'learners_developed', count(*) filter (where developed),
           'by_months', (select coalesce(jsonb_object_agg(m::text, (select count(*) from p2p_growth_learner_development d
                                                                      where d.contributor_id = p_user and d.developed and d.support_months >= m)), '{}'::jsonb)
                           from (select distinct param as m from p2p_growth_matrix where calc_version = v_set.calc_version and fact_key = 'learners_supported_developed' and param is not null) ms),
           'second_generation', count(*) filter (where developed and onward_months >= 1 and support_months >= coalesce(
              (select min(param) from p2p_growth_matrix where calc_version = v_set.calc_version and fact_key = 'learners_supported_developed'), 3)),
           'second_generation_sustained', (select coalesce(jsonb_object_agg(m::text, (select count(*) from p2p_growth_learner_development d
                                              where d.contributor_id = p_user and d.developed and d.onward_months >= m and d.support_months >= coalesce(
                                                (select max(param) from p2p_growth_matrix where calc_version = v_set.calc_version and fact_key = 'learners_supported_developed'), 6))), '{}'::jsonb)
                                             from (select distinct param as m from p2p_growth_matrix where calc_version = v_set.calc_version and fact_key = 'second_generation_sustained' and param is not null) ms))
    into v_support
    from p2p_growth_learner_development where contributor_id = p_user;

  return jsonb_build_object(
    'first_activity_at', v_first,
    'today_local', v_today,
    'time_zone', coalesce(v_tz, 'UTC'),
    'journey_days', case when v_first is null then 0 else floor(extract(epoch from (now() - v_first)) / 86400)::int end,
    'active_weeks', coalesce(v_weeks, 0),
    'active_months', coalesce(v_months, 0),
    'active_weeks_window', v_windows,
    'stage', coalesce(v_st.stage, 1),
    'stage_since', v_st.stage_since,
    'days_in_stage', case when v_st.stage_since is null then 0
                          else greatest(0, floor(extract(epoch from (now() - v_st.stage_since)) / 86400)::int - v_paused_in_stage) end,
    'paused_days_in_stage', v_paused_in_stage,
    'learning_units', coalesce(v_units, 0),
    'core_lessons_total', v_core_total,
    'core_lessons_passed', v_core_passed,
    'application_actions', coalesce(v_app, 0),
    'contributions', coalesce(v_contrib, 0),
    'support', v_support,
    'provenance', (select coalesce(jsonb_object_agg(evidence_type, n), '{}'::jsonb) from (select evidence_type, count(*) n from p2p_growth_tmp_ev group by 1) x),
    'pending_review', (select count(*) from p2p_growth_evidence where user_id = p_user and verification = 'pending_review' and voided_at is null),
    'paused_now', exists (select 1 from p2p_growth_pauses where user_id = p_user and starts_on <= v_today and coalesce(ended_on, planned_end_on) >= v_today)
  );
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 13. The checklist (the ONE evaluation: every requirement of every dimension)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_evaluate(p_user uuid) returns jsonb
  language plpgsql volatile security definer set search_path = public as $$
declare
  v_set record;
  v_facts jsonb := p2p_growth_facts(p_user);
  v_stage int;
  v_stages jsonb := '[]'::jsonb;
  v_items jsonb;
  v_met boolean;
  v_any boolean;
  v_chain boolean := true;
  v_eligible int := 1;
  v_have numeric;
  v_need numeric;
  v_ok boolean;
  v_note text;
  r record;
  s int;
begin
  select * into v_set from p2p_growth_settings;
  v_stage := (v_facts ->> 'stage')::int;
  for s in 2..5 loop
    v_items := '[]'::jsonb; v_met := true; v_any := false;
    for r in select * from p2p_growth_matrix where calc_version = v_set.calc_version and stage = s order by display_order, fact_key loop
      v_any := true; v_need := r.min_value; v_note := null;
      case r.fact_key
        when 'active_weeks_window' then v_have := coalesce((v_facts -> 'active_weeks_window' ->> r.param::text)::numeric, 0);
        when 'days_in_stage' then
          -- Time at the stage BELOW this one: already met for stages reached; only the next stage can be accruing it.
          if v_stage >= s then v_have := r.min_value; v_note := 'Already reached';
          elsif v_stage = s - 1 then v_have := (v_facts ->> 'days_in_stage')::numeric;
          else v_have := 0; v_note := 'Starts when you reach the milestone before this one';
          end if;
        when 'core_curriculum_complete' then
          -- Every Foundations lesson published now (the set grows when lessons are added).
          v_have := (v_facts ->> 'core_lessons_passed')::numeric;
          v_need := greatest(r.min_value, (v_facts ->> 'core_lessons_total')::numeric);
        when 'learners_supported_developed' then v_have := coalesce((v_facts -> 'support' -> 'by_months' ->> r.param::text)::numeric, 0);
        when 'second_generation_contributors' then v_have := coalesce((v_facts -> 'support' ->> 'second_generation')::numeric, 0);
        when 'second_generation_sustained' then v_have := coalesce((v_facts -> 'support' -> 'second_generation_sustained' ->> r.param::text)::numeric, 0);
        else v_have := coalesce((v_facts ->> r.fact_key)::numeric, 0);   -- missing evidence never counts
      end case;
      v_ok := v_have >= v_need;
      v_items := v_items || jsonb_build_object('key', r.fact_key, 'dimension', r.dimension, 'label', r.label, 'explanation', r.explanation,
                                               'have', v_have, 'need', v_need, 'met', v_ok, 'note', v_note, 'param', r.param);
      if not v_ok then v_met := false; end if;
    end loop;
    if not v_any then v_met := false; end if;
    v_stages := v_stages || jsonb_build_object('stage', s, 'met', v_met, 'requirements', v_items);
    if v_chain and v_met then v_eligible := s; else v_chain := false; end if;
  end loop;
  return jsonb_build_object('facts', v_facts, 'current_stage', v_stage, 'eligible_stage', v_eligible,
                            'next_stage', case when v_stage < 5 then v_stage + 1 end,
                            'eligible_for_next', v_stage < 5 and v_eligible > v_stage,
                            'stages', v_stages, 'calc_version', v_set.calc_version, 'thresholds', v_set.thresholds_status,
                            'evaluated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 14. Recalculate one person (idempotent). The ONLY code that changes a stage.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_recalculate(p_user uuid, p_source text default 'event') returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_eval jsonb;
  v_set record;
  v_cur record;
  v_eligible int;
  v_new int;
  v_names constant text[] := array['Seed', 'Sprout', 'Young Tree', 'Fruitful Tree', 'Forest Builder'];
begin
  if not exists (select 1 from p2p_profiles where id = p_user and not coalesce(is_official_account, false)) then return null; end if;
  insert into p2p_growth_status (user_id, stage_since) values (p_user, now()) on conflict (user_id) do nothing;
  select * into v_cur from p2p_growth_status where user_id = p_user for update;   -- one recalculation per person at a time
  select * into v_set from p2p_growth_settings;
  perform p2p_growth_sync_evidence(p_user);
  v_eval := p2p_growth_evaluate(p_user);
  v_eligible := (v_eval ->> 'eligible_stage')::int;
  v_new := v_cur.stage;

  -- Promotion: only with an approved matrix and promotions switched on, one stage
  -- at a time (time at a stage is itself a requirement), never down.
  if v_set.promotions_enabled and v_set.thresholds_status = 'approved' and v_eligible > v_cur.stage then
    v_new := v_cur.stage + 1;
    insert into p2p_growth_history (user_id, from_stage, to_stage, kind, criteria, calc_version, source)
    values (p_user, v_cur.stage, v_new, 'automatic', v_eval -> 'stages' -> (v_new - 2), v_set.calc_version, left(p_source, 80))
    on conflict (user_id, to_stage) do nothing;
    if found then
      insert into p2p_notifications (user_id, title, message, notification_type, data)
      values (p_user, 'Milestone reached: ' || v_names[v_new],
              'Your recorded participation on P2P Global now meets every part of the ' || v_names[v_new] || ' milestone.',
              'growth_stage_reached', jsonb_build_object('stage', v_new, 'stageName', v_names[v_new]));
      insert into p2p_growth_events (user_id, event_type, label, score_before, score_after)
      values (p_user, 'stage_reached', v_names[v_new], v_cur.stage, v_new);
    end if;
    update p2p_profiles set growth_level = greatest(coalesce(growth_level, 0), p2p_growth_stage_points(v_new)) where id = p_user;
    v_eval := p2p_growth_evaluate_after_promotion(p_user, v_new, v_eval);
    v_eligible := greatest(v_new, (v_eval ->> 'eligible_stage')::int);
  end if;
  -- (No other branch: the previous growth formula can no longer change a stage.)

  update p2p_growth_status
     set stage = v_new,
         stage_since = case when v_new > v_cur.stage then now() else stage_since end,
         verification = case when v_cur.verification = 'exception' and v_new = v_cur.stage then 'exception'
                             when v_eligible >= v_new then 'verified' else verification end,
         legacy_note = case when v_eligible >= v_new and v_cur.verification <> 'exception' then null else legacy_note end,
         eligible_stage = v_eligible, checklist = v_eval, calc_version = v_set.calc_version,
         evidence_summary = jsonb_build_object('learning_units', v_eval -> 'facts' -> 'learning_units', 'application_actions', v_eval -> 'facts' -> 'application_actions',
                                               'contributions', v_eval -> 'facts' -> 'contributions', 'active_weeks', v_eval -> 'facts' -> 'active_weeks'),
         evaluated_at = now(), updated_at = now()
   where user_id = p_user;
  return jsonb_build_object('stage', v_new, 'eligible_stage', v_eligible, 'promoted', v_new > v_cur.stage, 'calc_version', v_set.calc_version);
end $$;

-- After a promotion the checklist is re-read against the new stage (time-at-stage restarts).
create or replace function public.p2p_growth_evaluate_after_promotion(p_user uuid, p_stage int, p_eval jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  update p2p_growth_status set stage = p_stage, stage_since = now() where user_id = p_user;
  return p2p_growth_evaluate(p_user);
end $$;

-- An authorised, audited exception (off unless the owner enables it): two
-- different administrators, a written reason, one stage up, labelled 'exception'.
-- It never creates evidence.
create or replace function public.p2p_growth_exception(p_user uuid, p_to_stage int, p_actor uuid, p_authoriser uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_cur record;
begin
  if not (select exceptions_enabled from p2p_growth_settings) then raise exception 'P2P_GROWTH: exceptions are switched off' using errcode = '42501'; end if;
  if p_actor is null or p_authoriser is null or p_actor = p_authoriser then raise exception 'P2P_GROWTH: an exception needs two different administrators' using errcode = '42501'; end if;
  if p_actor = p_user or p_authoriser = p_user then raise exception 'P2P_GROWTH: nobody authorises their own exception' using errcode = '42501'; end if;
  if not ('growth.correct' = any (p2p_admin_permissions_for(p_actor)) and 'growth.correct' = any (p2p_admin_permissions_for(p_authoriser))) then
    raise exception 'P2P_GROWTH: both administrators need the growth.correct permission' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 20 then raise exception 'P2P_GROWTH: explain the exception (at least 20 characters)'; end if;
  select * into v_cur from p2p_growth_status where user_id = p_user for update;
  if v_cur.user_id is null or p_to_stage <> v_cur.stage + 1 then raise exception 'P2P_GROWTH: an exception moves one stage up only'; end if;
  insert into p2p_growth_history (user_id, from_stage, to_stage, kind, criteria, calc_version, source, actor_id, reason)
  values (p_user, v_cur.stage, p_to_stage, 'correction', jsonb_build_object('exception', true, 'authorised_by', p_authoriser, 'checklist', p2p_growth_evaluate(p_user)),
          (select calc_version from p2p_growth_settings), 'admin_exception', p_actor, btrim(p_reason));
  update p2p_growth_status set stage = p_to_stage, stage_since = now(), verification = 'exception',
         legacy_note = 'Authorised exception: ' || left(btrim(p_reason), 200), updated_at = now() where user_id = p_user;
  update p2p_profiles set growth_level = greatest(coalesce(growth_level, 0), p2p_growth_stage_points(p_to_stage)) where id = p_user;
  return jsonb_build_object('stage', p_to_stage, 'verification', 'exception');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 15. Thresholds: changed only by an administrator, while the matrix is a draft
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_set_threshold(p_actor uuid, p_stage int, p_fact text, p_value numeric, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare v_set record; v_old numeric;
begin
  select * into v_set from p2p_growth_settings for update;
  if v_set.thresholds_status <> 'draft' then raise exception 'P2P_GROWTH: thresholds can only change while the matrix is a draft' using errcode = '42501'; end if;
  if p_value is null or p_value < 0 then raise exception 'P2P_GROWTH: a threshold must be zero or more'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'P2P_GROWTH: a reason is required'; end if;
  select min_value into v_old from p2p_growth_matrix where calc_version = v_set.calc_version and stage = p_stage and fact_key = p_fact for update;
  if v_old is null then raise exception 'P2P_GROWTH: no such requirement'; end if;
  update p2p_growth_matrix set min_value = p_value where calc_version = v_set.calc_version and stage = p_stage and fact_key = p_fact;
  insert into p2p_growth_matrix_changes (calc_version, stage, fact_key, old_value, new_value, actor_id, reason)
  values (v_set.calc_version, p_stage, p_fact, v_old, p_value, p_actor, btrim(p_reason));
  return jsonb_build_object('stage', p_stage, 'fact', p_fact, 'old', v_old, 'new', p_value);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 16. The previous formulas: frozen. They can never change a stage, and no
--     longer raise growth_level (older builds read growth_level; it now only
--     follows the official stage, upward).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_engine_active() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select promotions_enabled or legacy_formula_frozen from p2p_growth_settings), true);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 17. Peer Guide eligibility (designated genealogy) — reported always, and
--     enforced (enforce_guide_stage, on) whenever a relationship becomes active;
--     existing active relationships are never ended by it
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_guide_stage_ok(p_guide uuid, p_participant uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select stage from p2p_growth_status where user_id = p_guide), 1)
       > coalesce((select stage from p2p_growth_status where user_id = p_participant), 1);
$$;

create or replace view public.p2p_growth_guide_eligibility as
  select l.id as link_id, l.mentor_id as guide_id, l.disciple_id as participant_id, l.status, l.is_primary, l.started_at,
         coalesce(gs.stage, 1) as guide_stage, coalesce(ps.stage, 1) as participant_stage,
         coalesce(gs.stage, 1) > coalesce(ps.stage, 1) as eligible
    from p2p_discipleship_links l
    left join p2p_growth_status gs on gs.user_id = l.mentor_id
    left join p2p_growth_status ps on ps.user_id = l.disciple_id
   where l.status in ('active', 'paused');

create or replace function public.p2p_growth_guide_rule() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and (select enforce_guide_stage from p2p_growth_settings)
     and not p2p_growth_guide_stage_ok(new.mentor_id, new.disciple_id) then
    raise exception 'P2P_GUIDE_STAGE: a Peer Guide must be at a higher milestone than the person they guide' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_p2p_growth_guide_rule on public.p2p_discipleship_links;
create trigger trg_p2p_growth_guide_rule before insert or update of status on public.p2p_discipleship_links
  for each row execute function public.p2p_growth_guide_rule();

-- ════════════════════════════════════════════════════════════════════════════
-- 18. Forest of Nations — collective totals with small-cell suppression
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_collective() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  k int := (select collective_min_cell from p2p_growth_settings);
begin
  return jsonb_build_object(
    'minimumGroup', k,
    'stages', (select jsonb_agg(jsonb_build_object('stage', s, 'people', case when n >= k then n end, 'suppressed', n > 0 and n < k) order by s)
                 from (select s, (select count(*) from p2p_growth_status st join p2p_profiles p on p.id = st.user_id
                                   where st.stage = s and not coalesce(p.is_official_account, false))::int as n
                         from generate_series(1, 5) s) x),
    'months', (select coalesce(jsonb_agg(m order by m ->> 'month'), '[]'::jsonb) from (
                 select case when people >= k then jsonb_build_object('month', month, 'participants', people, 'learningUnitsPassed', units,
                                                                      'practicalActions', apps, 'contributions', contribs)
                             else jsonb_build_object('month', month, 'suppressed', true) end as m
                   from (select to_char(date_trunc('month', e.local_date), 'YYYY-MM') as month,
                                count(distinct e.user_id) filter (where e.counts_for_activity)::int as people,
                                count(*) filter (where e.evidence_type = 'learning.assessment_passed')::int as units,
                                count(*) filter (where e.credit and e.dimension = 'application')::int as apps,
                                count(*) filter (where e.credit and e.dimension = 'service')::int as contribs
                           from p2p_growth_evidence e
                          where e.verification = 'verified' and e.voided_at is null and e.local_date >= (current_date - interval '12 months')
                          group by 1) agg) z),
    -- Countries: only people who opted in, and only countries with at least k of them.
    'countries', (select count(*) from (select lower(btrim(country)) c from p2p_profiles
                                         where share_country_in_collective and coalesce(btrim(country), '') <> '' and not coalesce(is_official_account, false)
                                         group by 1 having count(*) >= k) c)
  );
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 19. Queue: new evidence sources queue a recalculation; contributors are
--     re-checked when someone they helped changes
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.p2p_growth_enqueue(p_user uuid, p_reason text, p_with_mentors boolean default true) returns void
  language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return; end if;
  insert into p2p_growth_queue (user_id, reason) values (p_user, left(p_reason, 80))
  on conflict (user_id) do update set reason = excluded.reason, queued_at = now(), next_attempt_at = least(p2p_growth_queue.next_attempt_at, now());
  if p_with_mentors then
    insert into p2p_growth_queue (user_id, reason)
    select x.uid, 'learner_progress' from (
      select l.mentor_id as uid from p2p_discipleship_links l where l.disciple_id = p_user and l.status = 'active'
      union
      select e.user_id from p2p_growth_evidence e join p2p_growth_evidence_beneficiaries b on b.evidence_id = e.id
       where b.user_id = p_user and e.occurred_at >= now() - interval '400 days'
    ) x where x.uid is not null and x.uid <> p_user
    on conflict (user_id) do update set queued_at = now(), next_attempt_at = least(p2p_growth_queue.next_attempt_at, now());
  end if;
end $$;

create or replace function public.p2p_growth_queue_trigger_v2() returns trigger
  language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  begin
    case tg_table_name
      when 'p2p_study_sessions' then
        perform p2p_growth_enqueue(new.leader_id, 'study_session');
        for u in select user_id from p2p_study_session_participants where study_session_id = new.id loop perform p2p_growth_enqueue(u, 'study_session'); end loop;
      when 'p2p_family_worship_sessions' then
        perform p2p_growth_enqueue(new.host_id, 'family_gathering');
        for u in select user_id from p2p_family_worship_participants where session_id = new.id loop perform p2p_growth_enqueue(u, 'family_gathering'); end loop;
      when 'p2p_shared_studies' then
        perform p2p_growth_enqueue(new.host_id, 'shared_study');
      when 'p2p_shared_study_responses' then
        perform p2p_growth_enqueue(new.user_id, 'shared_study');
        perform p2p_growth_enqueue((select host_id from p2p_shared_studies where id = new.study_id), 'shared_study');
      when 'p2p_group_assignment_submissions' then
        perform p2p_growth_enqueue(new.user_id, 'group_assignment');
      when 'p2p_peer_confirmations' then
        perform p2p_growth_enqueue(new.actor_user_id, 'peer_confirmation');
      when 'p2p_scripture_listening_history' then
        perform p2p_growth_enqueue(new.user_id, 'scripture_listening', false);
      when 'p2p_evaluation_quality' then
        perform p2p_growth_enqueue(new.evaluator_id, 'evaluation_quality');
        perform p2p_growth_enqueue(new.evaluatee_id, 'evaluation_quality');
      else
        null;
    end case;
  exception when others then
    raise warning 'P2P_GROWTH: could not queue a recalculation (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_p2p_growth_queue on public.p2p_study_sessions;
create trigger trg_p2p_growth_queue after update of status, ended_at on public.p2p_study_sessions
  for each row when (new.ended_at is not null) execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_family_worship_sessions;
create trigger trg_p2p_growth_queue after update of ended_at on public.p2p_family_worship_sessions
  for each row when (new.ended_at is not null and old.ended_at is null) execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_shared_studies;
create trigger trg_p2p_growth_queue after update of status on public.p2p_shared_studies
  for each row when (new.status = 'concluded') execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_shared_study_responses;
create trigger trg_p2p_growth_queue after insert on public.p2p_shared_study_responses
  for each row execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_group_assignment_submissions;
create trigger trg_p2p_growth_queue after insert or update of status on public.p2p_group_assignment_submissions
  for each row when (new.status = 'reviewed') execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_peer_confirmations;
create trigger trg_p2p_growth_queue after update of confirmation_status on public.p2p_peer_confirmations
  for each row when (new.confirmation_status = 'confirmed') execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_scripture_listening_history;
create trigger trg_p2p_growth_queue after insert or update of completed_at on public.p2p_scripture_listening_history
  for each row when (new.completed_at is not null) execute function public.p2p_growth_queue_trigger_v2();
drop trigger if exists trg_p2p_growth_queue on public.p2p_evaluation_quality;
create trigger trg_p2p_growth_queue after insert or update of substantiated on public.p2p_evaluation_quality
  for each row execute function public.p2p_growth_queue_trigger_v2();

-- Reconciliation for legacy (recognised, not yet verified) stages: record the
-- trusted historical evidence and re-check — never raising anyone.
create or replace function public.p2p_growth_reconcile_legacy() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select user_id from p2p_growth_status where verification = 'legacy_unverified' loop
    perform p2p_growth_recalculate(r.user_id, 'legacy_reconciliation');
    n := n + 1;
  end loop;
  return jsonb_build_object('checked', n,
    'still_unverified', (select count(*) from p2p_growth_status where verification = 'legacy_unverified'),
    'verified', (select count(*) from p2p_growth_status where verification = 'verified'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 20. Access: API (service role) only; nothing for phones
-- ════════════════════════════════════════════════════════════════════════════
alter table public.p2p_growth_matrix enable row level security;
alter table public.p2p_growth_matrix_changes enable row level security;
alter table public.p2p_growth_evidence_types enable row level security;
alter table public.p2p_growth_evidence enable row level security;
alter table public.p2p_growth_evidence_beneficiaries enable row level security;
alter table public.p2p_growth_evidence_reviews enable row level security;
alter table public.p2p_growth_pauses enable row level security;
alter table public.p2p_growth_learner_development enable row level security;
revoke all on public.p2p_growth_learner_development from public, anon, authenticated;
grant select on public.p2p_growth_learner_development to service_role;
revoke all on public.p2p_growth_matrix, public.p2p_growth_matrix_changes, public.p2p_growth_evidence_types, public.p2p_growth_evidence,
  public.p2p_growth_evidence_beneficiaries, public.p2p_growth_evidence_reviews, public.p2p_growth_pauses,
  public.p2p_growth_learning_units, public.p2p_growth_guide_eligibility from public, anon, authenticated;
grant select, insert, update on public.p2p_growth_matrix, public.p2p_growth_evidence_types to service_role;
grant select, insert on public.p2p_growth_matrix_changes, public.p2p_growth_evidence_reviews, public.p2p_growth_evidence_beneficiaries to service_role;
grant select, insert, update on public.p2p_growth_evidence, public.p2p_growth_pauses to service_role;
grant select on public.p2p_growth_learning_units, public.p2p_growth_guide_eligibility to service_role;

revoke execute on function public.p2p_growth_stage_points(int) from public, anon, authenticated;
grant execute on function public.p2p_growth_stage_points(int) to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'p2p_growth_tz(text)', 'p2p_growth_lesson_resource(uuid)', 'p2p_growth_foundation_lessons()', 'p2p_growth_sync_evidence(uuid)',
    'p2p_growth_review_evidence(uuid, uuid, text, text)', 'p2p_growth_pause_start(uuid, date, date, text, uuid)', 'p2p_growth_pause_end(uuid, uuid, uuid)',
    'p2p_growth_paused_days(uuid, date, date)', 'p2p_growth_active_weeks_window(uuid, integer, date)', 'p2p_growth_facts(uuid)',
    'p2p_growth_evaluate(uuid)', 'p2p_growth_recalculate(uuid, text)', 'p2p_growth_evaluate_after_promotion(uuid, integer, jsonb)',
    'p2p_growth_exception(uuid, integer, uuid, uuid, text)', 'p2p_growth_set_threshold(uuid, integer, text, numeric, text)',
    'p2p_growth_engine_active()', 'p2p_growth_guide_stage_ok(uuid, uuid)', 'p2p_growth_collective()', 'p2p_growth_enqueue(uuid, text, boolean)',
    'p2p_growth_reconcile_legacy()', 'p2p_growth_refresh_development(uuid)', 'p2p_growth_learner_key(uuid)']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['p2p_growth_queue_trigger_v2()', 'p2p_growth_guide_rule()', 'p2p_growth_server_time()', 'p2p_activity_event_origin()',
                           'p2p_growth_evidence_append_only()', 'p2p_growth_reviews_append_only()']
  loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 21. Backfill from trustworthy history, then re-check everyone (promotions are
--     off, so nobody moves; legacy stages are kept and may become verified)
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare r record; n int := 0; e int := 0;
begin
  for r in select id from public.p2p_profiles where not coalesce(is_official_account, false) loop
    e := e + public.p2p_growth_sync_evidence(r.id);
    perform public.p2p_growth_recalculate(r.id, 'migration_239');
    n := n + 1;
  end loop;
  raise notice 'P2P_GROWTH_239: % people re-checked, % evidence records from trusted history; promotions_enabled=%',
    n, (select count(*) from public.p2p_growth_evidence), (select promotions_enabled from public.p2p_growth_settings);
end $$;

commit;

-- Rollback (nothing here deletes data; in this order):
--   drop the trg_p2p_growth_queue triggers on p2p_study_sessions, p2p_family_worship_sessions, p2p_shared_studies,
--     p2p_shared_study_responses, p2p_group_assignment_submissions, p2p_peer_confirmations, p2p_scripture_listening_history,
--     p2p_evaluation_quality; drop trg_p2p_growth_server_time on p2p_submissions, p2p_lesson_evaluations,
--     p2p_peer_confirmations, p2p_family_worship_sessions, p2p_family_worship_participants; drop trg_p2p_activity_event_origin
--     and trg_p2p_growth_guide_rule;
--   re-run the 236 definitions of p2p_growth_engine_active, p2p_growth_facts, p2p_growth_evaluate, p2p_growth_recalculate,
--     p2p_growth_enqueue (stages already reached stay — history is kept);
--   update p2p_growth_settings set calc_version = 1;
--   the new tables/columns may stay (unused) or be dropped after exporting them: p2p_growth_evidence*, p2p_growth_learner_development, p2p_growth_pauses,
--     p2p_growth_matrix*, p2p_growth_evidence_types, p2p_assignment_questions.is_practical,
--     p2p_profiles.share_country_in_collective, p2p_user_activity_events.origin, p2p_growth_status.evidence_summary.
