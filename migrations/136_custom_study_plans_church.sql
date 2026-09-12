-- 136: Custom Study Plans — Church (Stage 1 foundation).
--
-- NOT the same feature as 134_custom_studies_church.sql ("Church Studies").
-- That feature lets a church AUTHOR brand-new, self-contained lesson
-- content (its own title/description/scripture_references/teaching_material
-- jsonb, zero FK to p2p_lessons). This migration is a different product:
-- a "Custom Study Plan" is a purposeful ORDERED ARRANGEMENT of lessons that
-- already exist in the real curriculum catalog (p2p_lessons). It never
-- authors lesson content of its own — p2p_church_study_plan_items only
-- ever references an existing p2p_lessons row plus its position in the
-- plan. Table names are deliberately "_study_plans"/"_study_plan_items",
-- distinct from "_studies"/"_study_lessons", so the two features never get
-- confused at the schema level even though they sit in the same UI area.
--
-- Ownership is church_id, never a bare user_id — created_by is attribution
-- only, carries no access-control weight (same convention as 134).
--
-- Authorization reuses the existing p2p_is_church_member/leadership/pastor
-- SECURITY DEFINER functions (migration 072) verbatim — no new helper
-- functions invented. RLS here is a backstop; the API server's
-- service-role client is the real authorization path (same division of
-- labor as every other church-scoped table in this codebase).
--
-- p2p_lessons itself is completely untouched by this migration — no new
-- column, no new RLS policy on it. A plan item is simply a foreign key
-- pointing at an existing, already-published lesson; eligibility (must be
-- status='published') is enforced server-side in routes/churchStudyPlans.ts,
-- mirroring the exact convention components/family/LessonPicker.tsx already
-- uses for read-only lesson browsing.

create table if not exists p2p_church_study_plans (
  id           uuid primary key default gen_random_uuid(),
  church_id    uuid not null references p2p_churches(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_p2p_church_study_plans_church on p2p_church_study_plans(church_id, status);

-- One row per lesson reference in the plan. order_index is rewritten
-- 0..n-1 by the API on every reorder/add/remove (no DB-level uniqueness
-- constraint on (plan_id, order_index) — a transient duplicate mid-rewrite
-- is fine as long as the final state is dense and ordered, avoiding a
-- deferred-constraint dance for something this simple). Duplicate lesson
-- entries in the same plan are rejected via unique(plan_id, lesson_id) —
-- no existing architectural reason found to allow a lesson twice in one
-- plan.
create table if not exists p2p_church_study_plan_items (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references p2p_church_study_plans(id) on delete cascade,
  lesson_id    uuid not null references p2p_lessons(id) on delete cascade,
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (plan_id, lesson_id)
);

create index if not exists idx_p2p_church_study_plan_items_plan on p2p_church_study_plan_items(plan_id, order_index);

alter table p2p_church_study_plans enable row level security;
alter table p2p_church_study_plan_items enable row level security;

drop policy if exists "Church leadership manage study plans" on p2p_church_study_plans;
create policy "Church leadership manage study plans" on p2p_church_study_plans
  for all using (p2p_is_church_leadership(church_id, auth.uid()))
  with check (p2p_is_church_leadership(church_id, auth.uid()));

drop policy if exists "Church members view published study plans" on p2p_church_study_plans;
create policy "Church members view published study plans" on p2p_church_study_plans
  for select using (status = 'published' and p2p_is_church_member(church_id, auth.uid()));

drop policy if exists "Church leadership manage study plan items" on p2p_church_study_plan_items;
create policy "Church leadership manage study plan items" on p2p_church_study_plan_items
  for all using (
    exists (
      select 1 from p2p_church_study_plans p
      where p.id = plan_id and p2p_is_church_leadership(p.church_id, auth.uid())
    )
  )
  with check (
    exists (
      select 1 from p2p_church_study_plans p
      where p.id = plan_id and p2p_is_church_leadership(p.church_id, auth.uid())
    )
  );

drop policy if exists "Church members view published study plan items" on p2p_church_study_plan_items;
create policy "Church members view published study plan items" on p2p_church_study_plan_items
  for select using (
    exists (
      select 1 from p2p_church_study_plans p
      where p.id = plan_id and p.status = 'published' and p2p_is_church_member(p.church_id, auth.uid())
    )
  );
