-- 235 (Phase 2 — growth engine data, approved by the owner 2026-11-04;
-- restore-tested; applied only with the guarded production procedure).
-- ADDITIVE: new API-only tables + a DRAFT threshold matrix. Nothing about any
-- person's growth changes here.
--
-- One authoritative personal stage (1 Dormant Seed · 2 Sprout · 3 Young Tree ·
-- 4 Fruitful Tree · 5 Forest Builder). Forest of Nations is the COLLECTIVE
-- multiplication of disciples, never a personal stage.
--   • p2p_growth_settings: one row. The matrix starts as 'draft' and
--     promotions are OFF: the engine (236) works out everyone's milestones and
--     checklist, but moves nobody to a new stage until the owner approves the
--     matrix and switches promotions on;
--   • p2p_growth_requirements: the stage-by-stage matrix across the four
--     dimensions (consistency, learning, spiritual fruit, discipleship), each
--     with its data source;
--   • p2p_growth_status: each person's current stage, since when, whether it
--     is verified by the engine or a recognised legacy stage, and the latest
--     checklist;
--   • p2p_growth_history: every stage reached — once per stage per person
--     (no duplicates, no duplicate celebrations), with the criteria met, the
--     calculation version and whether it was automatic, imported from the
--     old system or an authorised correction;
--   • p2p_growth_queue: people to recalculate (filled by events, emptied by a
--     scheduled worker, retried on failure with the error recorded).
-- All API-only: no phone can read or write them directly.

begin;

create table if not exists public.p2p_growth_settings (
  id                 boolean primary key default true check (id),
  calc_version       integer not null default 1,
  thresholds_status  text not null default 'draft' check (thresholds_status in ('draft', 'approved')),
  promotions_enabled boolean not null default false,
  approved_at        timestamptz,
  approved_by        uuid references public.p2p_profiles(id) on delete set null,
  updated_at         timestamptz not null default now(),
  -- Promotions only ever run on an approved matrix.
  constraint p2p_growth_settings_promote_approved check (not promotions_enabled or thresholds_status = 'approved')
);
insert into public.p2p_growth_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.p2p_growth_requirements (
  stage         smallint not null check (stage between 2 and 5),
  dimension     text not null check (dimension in ('consistency', 'learning', 'fruit', 'discipleship')),
  fact_key      text not null,
  min_value     numeric not null check (min_value >= 0),
  label         text not null,
  data_source   text not null,
  display_order smallint not null default 0,
  primary key (stage, fact_key)
);

-- DRAFT matrix (owner approval needed before promotions). Durations are in
-- days/weeks/months of real, dated activity; counts are minimums. Missing data
-- never satisfies a requirement (it stays "not yet"), and never lowers anyone.
insert into public.p2p_growth_requirements (stage, dimension, fact_key, min_value, label, data_source, display_order) values
  -- Sprout: begun, with first habits over about a month.
  (2, 'consistency', 'onboarding_done',        1,  'Completed the welcome journey',                         'p2p_profiles.onboarding_journey_completed_at', 1),
  (2, 'consistency', 'journey_days',           30, 'Walking with P2P for at least a month',                 'first dated activity → today', 2),
  (2, 'consistency', 'active_weeks',           4,  'Active in 4 different weeks',                           'answers, completions, evaluations, journal, prayer and Scripture activity (dated)', 3),
  (2, 'learning',    'lessons_completed',      3,  'First 3 lessons completed',                             'p2p_lesson_progress (completed)', 4),
  (2, 'fruit',       'scripture_prayer_days',  3,  'Time in Scripture and prayer on 3 different days',      'lesson reflections, journal entries, prayer and Scripture activity (days, never content)', 5),
  -- Young Tree: rooted over about three months.
  (3, 'consistency', 'journey_days',           90, 'Walking with P2P for at least three months',            'first dated activity → today', 1),
  (3, 'consistency', 'active_weeks',           8,  'Active in 8 different weeks',                           'dated activity, as above', 2),
  (3, 'consistency', 'active_months',          3,  'Active in 3 different months',                          'dated activity, as above', 3),
  (3, 'learning',    'lessons_completed',      10, '10 lessons completed',                                  'p2p_lesson_progress (completed)', 4),
  (3, 'learning',    'modules_completed',      1,  'A whole module completed',                              'p2p_module_fully_completed', 5),
  (3, 'fruit',       'scripture_prayer_days',  8,  'Time in Scripture and prayer on 8 different days',      'as above', 6),
  (3, 'fruit',       'application_answers',    3,  'Applied learning in 3 assignments',                     'p2p_submissions (assignment answers)', 7),
  -- Fruitful Tree: sustained over about six months, serving others.
  (4, 'consistency', 'journey_days',           180, 'Walking with P2P for at least six months',             'first dated activity → today', 1),
  (4, 'consistency', 'active_months',          6,  'Active in 6 different months',                          'dated activity, as above', 2),
  (4, 'learning',    'lessons_completed',      25, '25 lessons completed',                                  'p2p_lesson_progress (completed)', 3),
  (4, 'learning',    'core_modules_completed', 3,  '3 Core Curriculum modules completed',                   'p2p_module_fully_completed (active Core Curriculum)', 4),
  (4, 'fruit',       'scripture_prayer_days',  20, 'Time in Scripture and prayer on 20 different days',     'as above', 5),
  (4, 'fruit',       'application_answers',    10, 'Applied learning in 10 assignments',                    'p2p_submissions (assignment answers)', 6),
  (4, 'fruit',       'service_evidence',       3,  'Served others 3 times (peer evaluations given, fruit recognised)', 'p2p_lesson_evaluations (as evaluator) + p2p_user_fruits', 7),
  -- Forest Builder: everything above, plus a genuine, sustained discipleship relationship.
  (5, 'discipleship', 'sustained_disciples',   1,  'Guiding at least one disciple for 3 months, who is growing', 'p2p_discipleship_links (active ≥ 90 days) + the disciple''s own dated learning since', 1)
on conflict (stage, fact_key) do nothing;

create table if not exists public.p2p_growth_status (
  user_id        uuid primary key references public.p2p_profiles(id) on delete cascade,
  stage          smallint not null default 1 check (stage between 1 and 5),
  stage_since    timestamptz not null default now(),
  verification   text not null default 'verified' check (verification in ('verified', 'legacy_unverified')),
  legacy_note    text,
  eligible_stage smallint check (eligible_stage between 1 and 5),
  checklist      jsonb,
  calc_version   integer,
  evaluated_at   timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists public.p2p_growth_history (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.p2p_profiles(id) on delete cascade,
  from_stage   smallint check (from_stage between 1 and 5),
  to_stage     smallint not null check (to_stage between 1 and 5),
  achieved_at  timestamptz not null default now(),
  kind         text not null check (kind in ('automatic', 'legacy_import', 'correction')),
  criteria     jsonb,
  calc_version integer,
  source       text,
  actor_id     uuid references public.p2p_profiles(id) on delete set null,
  reason       text
);
-- A stage is reached once per person: no duplicate history, so no duplicate celebration.
create unique index if not exists p2p_growth_history_once on public.p2p_growth_history (user_id, to_stage);
create index if not exists idx_p2p_growth_history_user on public.p2p_growth_history (user_id, achieved_at);

create table if not exists public.p2p_growth_queue (
  user_id         uuid primary key references public.p2p_profiles(id) on delete cascade,
  reason          text,
  queued_at       timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts        integer not null default 0,
  last_error      text
);
create index if not exists idx_p2p_growth_queue_due on public.p2p_growth_queue (next_attempt_at);

alter table public.p2p_growth_settings enable row level security;
alter table public.p2p_growth_requirements enable row level security;
alter table public.p2p_growth_status enable row level security;
alter table public.p2p_growth_history enable row level security;
alter table public.p2p_growth_queue enable row level security;
revoke all on public.p2p_growth_settings, public.p2p_growth_requirements, public.p2p_growth_status, public.p2p_growth_history, public.p2p_growth_queue from anon, authenticated;
grant all on public.p2p_growth_settings, public.p2p_growth_requirements, public.p2p_growth_status, public.p2p_growth_history, public.p2p_growth_queue to service_role;

-- The celebration feed (p2p_growth_events) gains a "stage reached" entry.
alter table public.p2p_growth_events drop constraint if exists p2p_growth_events_event_type_check;
alter table public.p2p_growth_events add constraint p2p_growth_events_event_type_check
  check (event_type in ('lesson_completed', 'module_completed', 'disciple_gained', 'stage_reached'));

commit;

-- Rollback: drop table p2p_growth_queue, p2p_growth_history, p2p_growth_status, p2p_growth_requirements, p2p_growth_settings;
--   restore the 010 event_type check if no 'stage_reached' rows exist.
