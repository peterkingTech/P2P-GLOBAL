-- 199: Group learning journeys (Family + Church) and group lesson progress.
--
-- A family or church chooses what it is studying together from the CENTRAL
-- P2P library (p2p_curriculums: type 'core' or 'plan') and moves through it.
-- Only references are stored — never a copy of central content — and
-- nothing in the central curriculum changes.
--
--   p2p_group_learning_journeys
--     One row per (group, curriculum) the group has studied. At most one
--     'active' journey per group at a time; switching pauses the current one
--     (status 'paused') instead of deleting it, so a group can pause,
--     resume, revisit and change without losing history.
--     current_lesson_id: where the group is (a lesson of that curriculum —
--     checked in the API, routes/groupLearning.ts).
--
--   p2p_group_lesson_completions
--     "We covered this lesson together" for a journey. GROUP progress only:
--     it never marks anyone's personal lesson complete (p2p_lesson_progress
--     is untouched), and it says nothing about understanding.
--
-- Exactly one of family_id / church_id is set (scope). All reads and writes
-- go through the API with the service role and membership/role checks;
-- RLS is enabled with member-read policies only (no client writes).
-- Additive and re-runnable.

create table if not exists public.p2p_group_learning_journeys (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.p2p_families(id) on delete cascade,
  church_id uuid references public.p2p_churches(id) on delete cascade,
  curriculum_id uuid not null references public.p2p_curriculums(id) on delete cascade,
  current_lesson_id uuid references public.p2p_lessons(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'paused', 'completed')),
  started_by uuid references public.p2p_profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint p2p_group_learning_journeys_one_scope check ((family_id is null) <> (church_id is null))
);

-- One journey row per group + curriculum (resuming reuses it), and at most
-- one active journey per group.
create unique index if not exists p2p_group_learning_journeys_family_curriculum_key
  on public.p2p_group_learning_journeys (family_id, curriculum_id) where family_id is not null;
create unique index if not exists p2p_group_learning_journeys_church_curriculum_key
  on public.p2p_group_learning_journeys (church_id, curriculum_id) where church_id is not null;
create unique index if not exists p2p_group_learning_journeys_family_active_key
  on public.p2p_group_learning_journeys (family_id) where family_id is not null and status = 'active';
create unique index if not exists p2p_group_learning_journeys_church_active_key
  on public.p2p_group_learning_journeys (church_id) where church_id is not null and status = 'active';

create table if not exists public.p2p_group_lesson_completions (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.p2p_group_learning_journeys(id) on delete cascade,
  lesson_id uuid not null references public.p2p_lessons(id) on delete cascade,
  marked_by uuid references public.p2p_profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  unique (journey_id, lesson_id)
);
create index if not exists idx_p2p_group_lesson_completions_journey on public.p2p_group_lesson_completions (journey_id);

-- ── Access: members read their own group's rows; nobody writes directly ────
-- Membership is checked through a SECURITY DEFINER helper: an inline
-- EXISTS on p2p_family_members inside a policy recurses into that table's
-- own (self-referencing) policy for signed-in readers. Same pattern as
-- p2p_is_conversation_member / p2p_is_church_leadership.
create or replace function public.p2p_group_learning_member(p_family_id uuid, p_church_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_family_id is not null then exists (
      select 1 from p2p_family_members m where m.family_id = p_family_id and m.user_id = auth.uid() and m.status = 'active')
    when p_church_id is not null then exists (
      select 1 from p2p_church_members m where m.church_id = p_church_id and m.user_id = auth.uid() and m.is_active)
    else false
  end;
$$;
revoke all on function public.p2p_group_learning_member(uuid, uuid) from public, anon;
grant execute on function public.p2p_group_learning_member(uuid, uuid) to authenticated, service_role;

alter table public.p2p_group_learning_journeys enable row level security;
alter table public.p2p_group_lesson_completions enable row level security;

drop policy if exists group_learning_journeys_member_read on public.p2p_group_learning_journeys;
create policy group_learning_journeys_member_read on public.p2p_group_learning_journeys
  for select to authenticated using (public.p2p_group_learning_member(family_id, church_id));

drop policy if exists group_lesson_completions_member_read on public.p2p_group_lesson_completions;
create policy group_lesson_completions_member_read on public.p2p_group_lesson_completions
  for select to authenticated using (
    exists (select 1 from public.p2p_group_learning_journeys j where j.id = p2p_group_lesson_completions.journey_id
      and public.p2p_group_learning_member(j.family_id, j.church_id))
  );

revoke all on public.p2p_group_learning_journeys from anon;
revoke all on public.p2p_group_lesson_completions from anon;
revoke insert, update, delete on public.p2p_group_learning_journeys from authenticated;
revoke insert, update, delete on public.p2p_group_lesson_completions from authenticated;
grant select on public.p2p_group_learning_journeys to authenticated;
grant select on public.p2p_group_lesson_completions to authenticated;
grant all on public.p2p_group_learning_journeys to service_role;
grant all on public.p2p_group_lesson_completions to service_role;

-- Rollback (removes journeys and group progress; nothing else depends on them):
--   drop table if exists public.p2p_group_lesson_completions;
--   drop table if exists public.p2p_group_learning_journeys;
--   drop function if exists public.p2p_group_learning_member(uuid, uuid);
