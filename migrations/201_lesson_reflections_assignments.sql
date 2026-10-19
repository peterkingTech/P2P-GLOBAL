-- 201: Reflections and assignments for custom lessons (Family + Church).
-- REQUIRES 199 (p2p_group_learning_member) and 200 (lesson status/version).
--
-- REFLECTIONS reuse the personal journal (p2p_journal_reflections, 082):
-- an answer to a custom lesson's reflection question is a normal journal
-- entry (owner-only RLS, unchanged), with the question text as its prompt,
-- plus links to the lesson / question / lesson version answered. It is
-- PRIVATE by default. visibility:
--   'private' only the writer (default)
--   'leaders' also the group's leaders (Shepherd / Co-Shepherd; church
--             leadership) — only because the writer chose it
--   'group'   also the other members of that family / church
-- Shared reflections are read ONLY through the API, which checks that the
-- writer and the reader are both current members of the lesson's group.
--
-- ASSIGNMENTS belong to one custom lesson. Submissions are kept as attempts
-- (attempt 1, 2, …) — a resubmission never overwrites earlier work.
--   status 'submitted' → leader marks 'reviewed' or 'returned' (with feedback)
-- Drafts stay on the writer's device until submitted.
-- Members read published assignments of their group and their OWN
-- submissions directly; everything else (reviewing) goes through the API.
-- No client writes on either new table. Additive and re-runnable.

-- ── Reflections: links on the journal ───────────────────────────────────────
alter table public.p2p_journal_reflections
  add column if not exists family_lesson_id uuid references public.p2p_family_study_lessons(id) on delete set null,
  add column if not exists church_lesson_id uuid references public.p2p_church_study_lessons(id) on delete set null,
  add column if not exists question_id text,
  add column if not exists lesson_version integer,
  add column if not exists visibility text not null default 'private',
  add column if not exists shared_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_journal_reflections_visibility_check') then
    alter table public.p2p_journal_reflections add constraint p2p_journal_reflections_visibility_check check (visibility in ('private', 'leaders', 'group'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_journal_reflections_one_custom_lesson') then
    alter table public.p2p_journal_reflections add constraint p2p_journal_reflections_one_custom_lesson check (family_lesson_id is null or church_lesson_id is null);
  end if;
end $$;
create index if not exists idx_p2p_journal_reflections_family_lesson on public.p2p_journal_reflections (family_lesson_id) where family_lesson_id is not null;
create index if not exists idx_p2p_journal_reflections_church_lesson on public.p2p_journal_reflections (church_lesson_id) where church_lesson_id is not null;

-- ── Assignments ─────────────────────────────────────────────────────────────
create table if not exists public.p2p_group_assignments (
  id uuid primary key default gen_random_uuid(),
  family_lesson_id uuid references public.p2p_family_study_lessons(id) on delete cascade,
  church_lesson_id uuid references public.p2p_church_study_lessons(id) on delete cascade,
  family_id uuid references public.p2p_families(id) on delete cascade,
  church_id uuid references public.p2p_churches(id) on delete cascade,
  title text not null,
  instructions text,
  due_at timestamptz,
  scripture_references jsonb not null default '[]'::jsonb,
  resources jsonb not null default '[]'::jsonb,
  allow_resubmission boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.p2p_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint p2p_group_assignments_one_lesson check ((family_lesson_id is null) <> (church_lesson_id is null)),
  constraint p2p_group_assignments_scope_matches check ((family_lesson_id is null or family_id is not null) and (church_lesson_id is null or church_id is not null))
);
create index if not exists idx_p2p_group_assignments_family_lesson on public.p2p_group_assignments (family_lesson_id) where family_lesson_id is not null;
create index if not exists idx_p2p_group_assignments_church_lesson on public.p2p_group_assignments (church_lesson_id) where church_lesson_id is not null;

create table if not exists public.p2p_group_assignment_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.p2p_group_assignments(id) on delete cascade,
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  attempt integer not null default 1,
  content text not null,
  status text not null default 'submitted' check (status in ('submitted', 'reviewed', 'returned')),
  feedback text,
  reviewed_by uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  unique (assignment_id, user_id, attempt)
);
create index if not exists idx_p2p_group_assignment_submissions_assignment on public.p2p_group_assignment_submissions (assignment_id, user_id);

alter table public.p2p_group_assignments enable row level security;
alter table public.p2p_group_assignment_submissions enable row level security;

drop policy if exists group_assignments_member_read on public.p2p_group_assignments;
create policy group_assignments_member_read on public.p2p_group_assignments
  for select to authenticated using (status = 'published' and public.p2p_group_learning_member(family_id, church_id));
drop policy if exists group_assignment_submissions_own_read on public.p2p_group_assignment_submissions;
create policy group_assignment_submissions_own_read on public.p2p_group_assignment_submissions
  for select to authenticated using (user_id = auth.uid());

revoke all on public.p2p_group_assignments from anon;
revoke all on public.p2p_group_assignment_submissions from anon;
revoke insert, update, delete on public.p2p_group_assignments from authenticated;
revoke insert, update, delete on public.p2p_group_assignment_submissions from authenticated;
grant select on public.p2p_group_assignments to authenticated;
grant select on public.p2p_group_assignment_submissions to authenticated;
grant all on public.p2p_group_assignments to service_role;
grant all on public.p2p_group_assignment_submissions to service_role;

-- Rollback (drops assignments and submissions; reflection links can stay):
--   drop table if exists public.p2p_group_assignment_submissions;
--   drop table if exists public.p2p_group_assignments;
