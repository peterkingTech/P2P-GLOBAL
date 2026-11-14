-- APPLIED TO PRODUCTION 2026-11-14 14:38:53 UTC (owner approval 2026-11-14; guarded single-transaction apply with in-transaction checks; backup C:/Users/offic/P2P-Backups/prod-c5e1812c-2026-11-14T14-38-14-679Z-tables-247-250 (JSON of every touched table)).
-- The notes below were written before applying; "PROPOSED" there is historical.
-- 249 (PROPOSED — NOT APPLIED; needs owner approval, a restore test and the guarded production apply):
-- P2P PLANS — one plan system that ORGANISES existing P2P resources (owner brief "Unified Plans System",
-- 2026-11-14). Additive only: four new tables and one widened check. No existing row changes meaning.
--
-- WHY NEW TABLES: the existing "Plans" (migrations 041/054/055) are Learning Centre curriculums
-- (p2p_curriculums type 'plan') — lesson content with its own modules, lessons and locking. They stay
-- exactly as they are and remain the CONTENT. What is missing is the organiser: a plan with ONE main focus
-- (a Bible book, topic, person, event, theme, Foundations, Kingdom School, Kingdom Stories, Deep Study),
-- sessions that point at Scripture and existing resources, each person's own schedule and progress,
-- and a way to follow the same plan together. Nothing here copies Bible text, lessons or stories.
--
-- WHAT:
--   * p2p_study_plans: one row per plan. origin 'p2p' = official (owner_id null, editorial workflow
--     draft → under_review → approved → published → archived, approved by someone other than the
--     submitter); origin 'participant' = created by a person for themselves (never published as P2P
--     curriculum). derived_from = a structured plan whose sessions are the REAL lessons of an existing
--     curriculum (or all of Kingdom School Foundations), read live in curriculum order — never copied.
--   * p2p_study_plan_sessions: ordered sessions of a stored plan. passages = Scripture REFERENCES only
--     ({book, chapter, startVerse, endVerse}); primary_resource / supporting = references to existing
--     resources ({kind, id|ref}); questions = prepared study questions (a learning aid, never an exam).
--   * p2p_study_plan_enrollments: each person's own run of a plan — mode (individual / together),
--     duration, pace, start date, status (active / paused / completed / left), show-questions setting.
--     Together = a Study Together shared study (216) of content_type 'study_plan': membership,
--     invitations and discussion are Study Together's own records, never duplicated here.
--   * p2p_study_plan_completions: the sessions a person marked complete in THEIR enrollment. A composite
--     key makes a completion impossible for a session of another plan or someone else's enrollment.
--   * p2p_shared_studies.content_type gains 'study_plan'.
-- GROWTH MATRIX: nothing here writes evidence. Completing a plan session never creates learning credit;
-- lesson sessions read the existing lesson / evaluation records, which stay authoritative.
-- ACCESS: RLS on with no client policies (the 216 pattern); only the API (service role) reads or writes,
-- after checking the caller from their token on every request. Saves reuse p2p_plan_saves (042; its
-- plan_id has no foreign key, and the curriculum list ignores ids that aren't curriculums).
-- ROLLBACK: new tables and a widened check; rolling the API back leaves them unused. Dropping them
-- would lose people's progress, so rollback is "stop using", not "drop".

create table if not exists public.p2p_study_plans (
  id               uuid primary key default gen_random_uuid(),
  slug             text,
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  description      text check (description is null or char_length(description) <= 2000),
  focus_type       text not null check (focus_type in ('bible_book', 'bible_topic', 'biblical_person', 'biblical_event', 'theme',
                                                       'core_foundations', 'kingdom_school', 'kingdom_stories', 'deep_study')),
  -- The main focus itself, by reference: {book} / {topicSlug} / {curriculumId} / {storyId} / {strongs} …
  focus_ref        jsonb not null default '{}'::jsonb check (jsonb_typeof(focus_ref) = 'object'),
  focus_label      text not null check (char_length(btrim(focus_label)) between 1 and 200),
  plan_kind        text not null check (plan_kind in ('scripture', 'structured', 'mixed')),
  collection       text check (collection is null or collection in ('bible_books', 'topical', 'life_of_jesus', 'biblical_history',
                                                                    'core_foundations', 'kingdom_school', 'kingdom_stories', 'deep_study')),
  -- Structured plans read their sessions live: {"type":"foundations"} or {"type":"curriculum","id":"<uuid>"}.
  derived_from     jsonb check (derived_from is null or (jsonb_typeof(derived_from) = 'object' and derived_from->>'type' in ('foundations', 'curriculum'))),
  language         text not null default 'en' check (char_length(language) between 2 and 12),
  origin           text not null check (origin in ('p2p', 'participant')),
  owner_id         uuid references public.p2p_profiles(id) on delete cascade,
  editorial_status text not null default 'draft' check (editorial_status in ('draft', 'under_review', 'approved', 'published', 'archived')),
  objectives       jsonb not null default '[]'::jsonb check (jsonb_typeof(objectives) = 'array' and jsonb_array_length(objectives) <= 8),
  suggested_pace   text not null default 'daily' check (suggested_pace in ('daily', 'five_weekly', 'three_weekly', 'weekly', 'flexible')),
  suggested_days   integer check (suggested_days is null or suggested_days between 1 and 3660),
  together_suitable boolean not null default true,
  created_by       uuid references public.p2p_profiles(id) on delete set null,
  submitted_by     uuid references public.p2p_profiles(id) on delete set null,
  reviewed_by      uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at      timestamptz,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Official plans have no personal owner; participant plans always do.
  constraint p2p_study_plans_origin_owner check ((origin = 'p2p') = (owner_id is null)),
  -- A participant's plan is never presented as approved P2P curriculum.
  constraint p2p_study_plans_participant_status check (origin = 'p2p' or editorial_status in ('draft', 'archived')),
  -- Approved / published official plans were reviewed by someone other than the submitter.
  constraint p2p_study_plans_four_eyes check (editorial_status not in ('approved', 'published')
    or (reviewed_by is not null and submitted_by is not null and reviewed_by <> submitted_by)),
  constraint p2p_study_plans_published_at check (editorial_status <> 'published' or published_at is not null)
);
create unique index if not exists p2p_study_plans_slug_key on public.p2p_study_plans (slug) where slug is not null;
create index if not exists p2p_study_plans_catalogue_idx on public.p2p_study_plans (origin, editorial_status, collection);
create index if not exists p2p_study_plans_owner_idx on public.p2p_study_plans (owner_id) where owner_id is not null;

create table if not exists public.p2p_study_plan_sessions (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.p2p_study_plans(id) on delete cascade,
  position         integer not null check (position between 1 and 1000),
  title            text not null check (char_length(btrim(title)) between 1 and 200),
  intro            text check (intro is null or char_length(intro) <= 2000),
  passages         jsonb not null default '[]'::jsonb check (jsonb_typeof(passages) = 'array' and jsonb_array_length(passages) <= 10),
  primary_resource jsonb check (primary_resource is null or (jsonb_typeof(primary_resource) = 'object' and primary_resource ? 'kind')),
  supporting       jsonb not null default '[]'::jsonb check (jsonb_typeof(supporting) = 'array' and jsonb_array_length(supporting) <= 12),
  questions        jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 12),
  reflection       text check (reflection is null or char_length(reflection) <= 1000),
  prayer           text check (prayer is null or char_length(prayer) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Every session has something to study: a passage or an existing resource.
  constraint p2p_study_plan_sessions_has_content check (jsonb_array_length(passages) > 0 or primary_resource is not null),
  constraint p2p_study_plan_sessions_position_key unique (plan_id, position) deferrable initially deferred,
  constraint p2p_study_plan_sessions_id_plan_key unique (id, plan_id)
);

create table if not exists public.p2p_study_plan_enrollments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.p2p_profiles(id) on delete cascade,
  plan_id          uuid not null references public.p2p_study_plans(id) on delete cascade,
  mode             text not null default 'individual' check (mode in ('individual', 'together')),
  shared_study_id  uuid references public.p2p_shared_studies(id) on delete set null,
  duration_key     text not null check (duration_key in ('daily', 'weekly', 'monthly', 'quarterly', 'half_year', 'yearly', 'custom')),
  target_days      integer not null check (target_days between 1 and 3660),
  pace             text not null check (pace in ('daily', 'five_weekly', 'three_weekly', 'weekly', 'flexible')),
  start_date       date not null,
  -- The schedule is laid out from here: the start date, or the day the person resumed / adjusted it.
  anchor_date      date not null,
  status           text not null default 'active' check (status in ('active', 'paused', 'completed', 'left')),
  paused_at        timestamptz,
  completed_at     timestamptz,
  left_at          timestamptz,
  show_questions   boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint p2p_study_plan_enrollments_individual check (mode = 'together' or shared_study_id is null),
  constraint p2p_study_plan_enrollments_completed check (status <> 'completed' or completed_at is not null),
  constraint p2p_study_plan_enrollments_id_plan_key unique (id, plan_id)
);
-- One current run of a plan per person (a finished or left run can be followed by a new one).
create unique index if not exists p2p_study_plan_enrollments_one_current
  on public.p2p_study_plan_enrollments (user_id, plan_id) where status in ('active', 'paused');
create index if not exists p2p_study_plan_enrollments_user_idx on public.p2p_study_plan_enrollments (user_id, status);
create index if not exists p2p_study_plan_enrollments_shared_idx on public.p2p_study_plan_enrollments (shared_study_id) where shared_study_id is not null;

create table if not exists public.p2p_study_plan_completions (
  id               uuid primary key default gen_random_uuid(),
  enrollment_id    uuid not null,
  plan_id          uuid not null,
  session_id       uuid not null,
  completed_at     timestamptz not null default now(),
  -- The session belongs to THIS plan, and the enrollment is a run of THIS plan.
  constraint p2p_study_plan_completions_session_fk foreign key (session_id, plan_id)
    references public.p2p_study_plan_sessions (id, plan_id) on delete cascade,
  constraint p2p_study_plan_completions_enrollment_fk foreign key (enrollment_id, plan_id)
    references public.p2p_study_plan_enrollments (id, plan_id) on delete cascade,
  constraint p2p_study_plan_completions_once unique (enrollment_id, session_id)
);

-- Study Together can share a plan.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_content_type_check'
             and pg_get_constraintdef(oid) not like '%study_plan%') then
    alter table public.p2p_shared_studies drop constraint p2p_shared_studies_content_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_content_type_check') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_content_type_check
      check (content_type in ('kingdom_story', 'lesson', 'bible_passage', 'study_plan'));
  end if;
end $$;

alter table public.p2p_study_plans enable row level security;
alter table public.p2p_study_plan_sessions enable row level security;
alter table public.p2p_study_plan_enrollments enable row level security;
alter table public.p2p_study_plan_completions enable row level security;
revoke all on public.p2p_study_plans, public.p2p_study_plan_sessions, public.p2p_study_plan_enrollments,
  public.p2p_study_plan_completions from anon, authenticated;
grant select, insert, update, delete on public.p2p_study_plans, public.p2p_study_plan_sessions, public.p2p_study_plan_enrollments,
  public.p2p_study_plan_completions to service_role;
