-- 134: Custom Studies — Church Studies (Stage 2 foundation).
--
-- FORENSIC BASIS (Stage 1 report): p2p_curriculums/p2p_modules/p2p_lessons
-- have no tenant-scoping hook anywhere and a DB-level sequential-progression
-- trigger + publish-gate trigger tuned specifically to the global catalog's
-- 'type' values — extending them for church-owned content would require
-- touching that trigger and every hardcoded type filter across the app.
-- Per this codebase's own stated convention (church Calls migration 130's
-- comment: "peer_circles/break_rooms/family_worship each have their OWN
-- scoped tables ... not reinvented"), Church Studies gets its own new
-- tables rather than a new p2p_curriculums.type value or a church_id
-- column bolted onto the global catalog.
--
-- Ownership is church_id, never a bare user_id (a Church Study belongs to
-- the church, not its creator) — created_by is recorded for attribution
-- only and carries no access-control weight.
--
-- Authorization reuses the existing p2p_is_church_member/leadership/pastor
-- SECURITY DEFINER functions (migration 072) verbatim — no new helper
-- functions invented. RLS here is a backstop (the API server's
-- service-role client is the real authorization path, matching every
-- other church-scoped table in this codebase); fine-grained rules (e.g.
-- "only a pastor or the study's own creator may archive") are enforced
-- server-side in routes/churchStudies.ts, same division of labor as
-- Church Calls.

create table if not exists p2p_church_studies (
  id           uuid primary key default gen_random_uuid(),
  church_id    uuid not null references p2p_churches(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_p2p_church_studies_church on p2p_church_studies(church_id, status);

-- Lesson content is deliberately lightweight — not the fully-normalized
-- p2p_lesson_sections/p2p_scriptures/p2p_reflection_questions shape, which
-- exists to support admin CMS versioning, multi-language translation, and
-- peer-evaluation gating that a simple church/family-authored study does
-- not need (Stage 1 report, section I). Structured repeating fields
-- (scripture references, questions) are jsonb, mirroring the same
-- lightweight-jsonb pattern already used by p2p_church_calls.
-- scripture_reference and p2p_family_worship_sessions.current_scripture.
create table if not exists p2p_church_study_lessons (
  id                    uuid primary key default gen_random_uuid(),
  study_id              uuid not null references p2p_church_studies(id) on delete cascade,
  title                 text not null,
  description           text,
  scripture_references  jsonb,
  teaching_material     text,
  questions             jsonb,
  prayer_focus          text,
  media_provider        text,
  media_id              text,
  media_url             text,
  order_index           integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_p2p_church_study_lessons_study on p2p_church_study_lessons(study_id, order_index);

alter table p2p_church_studies enable row level security;
alter table p2p_church_study_lessons enable row level security;

drop policy if exists "Church leadership manage studies" on p2p_church_studies;
create policy "Church leadership manage studies" on p2p_church_studies
  for all using (p2p_is_church_leadership(church_id, auth.uid()))
  with check (p2p_is_church_leadership(church_id, auth.uid()));

drop policy if exists "Church members view published studies" on p2p_church_studies;
create policy "Church members view published studies" on p2p_church_studies
  for select using (status = 'published' and p2p_is_church_member(church_id, auth.uid()));

drop policy if exists "Church leadership manage study lessons" on p2p_church_study_lessons;
create policy "Church leadership manage study lessons" on p2p_church_study_lessons
  for all using (
    exists (
      select 1 from p2p_church_studies s
      where s.id = study_id and p2p_is_church_leadership(s.church_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from p2p_church_studies s
      where s.id = study_id and p2p_is_church_leadership(s.church_id, auth.uid())
    )
  );

drop policy if exists "Church members view published study lessons" on p2p_church_study_lessons;
create policy "Church members view published study lessons" on p2p_church_study_lessons
  for select using (
    exists (
      select 1 from p2p_church_studies s
      where s.id = study_id and s.status = 'published' and p2p_is_church_member(s.church_id, auth.uid())
    )
  );
