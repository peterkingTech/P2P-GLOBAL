-- 137: Custom Study Plans — Family (Stage 1 foundation), mirrors
-- 136_custom_study_plans_church.sql exactly, scoped to family_id.
--
-- NOT the same feature as 135_custom_studies_family.sql ("Family Studies"),
-- which lets a family author brand-new self-contained lesson content with
-- zero FK to p2p_lessons. A "Custom Study Plan" instead orders EXISTING
-- p2p_lessons rows — table names "_study_plans"/"_study_plan_items" are
-- kept distinct from "_studies"/"_study_lessons" for exactly that reason.
--
-- Ownership is family_id, never a bare user_id — per the same forensic
-- finding 135 already documented: migration 126 removed the
-- one-active-family-per-user constraint, so every family-scoped table
-- keys authorization to "does THIS row's family_id have you as an active
-- member," never a global "the user's family."
--
-- Family RLS in this codebase uses inline EXISTS subqueries (there is no
-- p2p_is_family_member() helper function — confirmed absent across every
-- migration), so this migration follows that exact idiom rather than
-- inventing one, same as 135 did.
--
-- p2p_lessons is completely untouched. Eligibility (must be
-- status='published') is enforced server-side in routes/familyStudyPlans.ts,
-- mirroring components/family/LessonPicker.tsx's existing convention.

create table if not exists p2p_family_study_plans (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references p2p_families(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_p2p_family_study_plans_family on p2p_family_study_plans(family_id, status);

create table if not exists p2p_family_study_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references p2p_family_study_plans(id) on delete cascade,
  lesson_id    uuid not null references p2p_lessons(id) on delete cascade,
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (plan_id, lesson_id)
);

create index if not exists idx_p2p_family_study_plan_items_plan on p2p_family_study_plan_items(plan_id, order_index);

alter table p2p_family_study_plans enable row level security;
alter table p2p_family_study_plan_items enable row level security;

drop policy if exists "Family shepherd manages study plans" on p2p_family_study_plans;
create policy "Family shepherd manages study plans" on p2p_family_study_plans
  for all using (
    exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
    or exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_study_plans.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
    )
  )
  with check (
    exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
    or exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_study_plans.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
    )
  );

drop policy if exists "Family members view published study plans" on p2p_family_study_plans;
create policy "Family members view published study plans" on p2p_family_study_plans
  for select using (
    status = 'published'
    and exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_study_plans.family_id and m.user_id = auth.uid() and m.status = 'active'
    )
  );

drop policy if exists "Family shepherd manages study plan items" on p2p_family_study_plan_items;
create policy "Family shepherd manages study plan items" on p2p_family_study_plan_items
  for all using (
    exists (
      select 1 from p2p_family_study_plans p
      join p2p_families f on f.id = p.family_id
      where p.id = plan_id
        and (
          f.shepherd_id = auth.uid()
          or exists (
            select 1 from p2p_family_members m
            where m.family_id = p.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from p2p_family_study_plans p
      join p2p_families f on f.id = p.family_id
      where p.id = plan_id
        and (
          f.shepherd_id = auth.uid()
          or exists (
            select 1 from p2p_family_members m
            where m.family_id = p.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
          )
        )
    )
  );

drop policy if exists "Family members view published study plan items" on p2p_family_study_plan_items;
create policy "Family members view published study plan items" on p2p_family_study_plan_items
  for select using (
    exists (
      select 1 from p2p_family_study_plans p
      where p.id = plan_id and p.status = 'published'
        and exists (
          select 1 from p2p_family_members m
          where m.family_id = p.family_id and m.user_id = auth.uid() and m.status = 'active'
        )
    )
  );

-- ── Family study-source setting ──────────────────────────────────────────
-- Forensic finding (Phase 0, section F): no study_source / family_settings
-- concept exists anywhere in this codebase today — nothing to "extend," so
-- this is the smallest safe new columns on the existing p2p_families row
-- (not a new settings table, since a family has exactly one of these
-- values at a time, same cardinality as shepherd_id already on this row).
-- Default is 'p2p_curriculum' and MUST stay the default per explicit
-- product rule — this alter never changes behavior for any existing
-- family until a Shepherd/Co-Shepherd explicitly switches it.
alter table p2p_families
  add column if not exists study_source text not null default 'p2p_curriculum'
    check (study_source in ('p2p_curriculum', 'custom_study_plan')),
  add column if not exists active_study_plan_id uuid references p2p_family_study_plans(id) on delete set null;

-- No RLS changes needed on p2p_families — its existing SELECT policy
-- already covers all columns on the row; only routes/family.ts's existing
-- shepherd/co-shepherd update path needs a new field, enforced there.
