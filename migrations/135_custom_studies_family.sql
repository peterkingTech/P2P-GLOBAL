-- 135: Custom Studies — Family Studies (Stage 2 foundation).
--
-- Mirrors 134_custom_studies_church.sql exactly, scoped to family_id
-- instead of church_id. Ownership is family_id, never user_id — per the
-- Stage 1 report's most load-bearing finding: migration 126 deliberately
-- removed the one-active-family-per-user constraint so a single user can
-- belong to multiple families at once, and every family-scoped table
-- since then (p2p_family_worship_sessions, p2p_family_prayer_requests)
-- keys authorization to "does this row's own family_id have you as an
-- active member," never a global "the user's family." Family Studies
-- follows that exact shape: family_id not null, RLS via inline EXISTS
-- against p2p_family_members for THIS row's family_id, never unique(user_id)
-- anywhere in this schema.
--
-- Family RLS in this codebase uses inline EXISTS subqueries, not a SQL
-- helper function (there is no p2p_is_family_member() — confirmed absent
-- across every migration) — so this migration does not invent one, it
-- follows the family domain's own established idiom exactly, the same way
-- 134 followed the church domain's SQL-helper-function idiom exactly.
-- Manage authorization (shepherd or co_shepherd) mirrors
-- isShepherdOrCoShepherd() from routes/family.ts.

create table if not exists p2p_family_studies (
  id           uuid primary key default gen_random_uuid(),
  family_id    uuid not null references p2p_families(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  title        text not null,
  description  text,
  status       text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  order_index  integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_p2p_family_studies_family on p2p_family_studies(family_id, status);

create table if not exists p2p_family_study_lessons (
  id                    uuid primary key default gen_random_uuid(),
  study_id              uuid not null references p2p_family_studies(id) on delete cascade,
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

create index if not exists idx_p2p_family_study_lessons_study on p2p_family_study_lessons(study_id, order_index);

alter table p2p_family_studies enable row level security;
alter table p2p_family_study_lessons enable row level security;

drop policy if exists "Family shepherd manages studies" on p2p_family_studies;
create policy "Family shepherd manages studies" on p2p_family_studies
  for all using (
    exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
    or exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_studies.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
    )
  )
  with check (
    exists (select 1 from p2p_families f where f.id = family_id and f.shepherd_id = auth.uid())
    or exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_studies.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
    )
  );

drop policy if exists "Family members view published studies" on p2p_family_studies;
create policy "Family members view published studies" on p2p_family_studies
  for select using (
    status = 'published'
    and exists (
      select 1 from p2p_family_members m
      where m.family_id = p2p_family_studies.family_id and m.user_id = auth.uid() and m.status = 'active'
    )
  );

drop policy if exists "Family shepherd manages study lessons" on p2p_family_study_lessons;
create policy "Family shepherd manages study lessons" on p2p_family_study_lessons
  for all using (
    exists (
      select 1 from p2p_family_studies s
      join p2p_families f on f.id = s.family_id
      where s.id = study_id
        and (
          f.shepherd_id = auth.uid()
          or exists (
            select 1 from p2p_family_members m
            where m.family_id = s.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
          )
        )
    )
  )
  with check (
    exists (
      select 1 from p2p_family_studies s
      join p2p_families f on f.id = s.family_id
      where s.id = study_id
        and (
          f.shepherd_id = auth.uid()
          or exists (
            select 1 from p2p_family_members m
            where m.family_id = s.family_id and m.user_id = auth.uid() and m.status = 'active' and m.role = 'co_shepherd'
          )
        )
    )
  );

drop policy if exists "Family members view published study lessons" on p2p_family_study_lessons;
create policy "Family members view published study lessons" on p2p_family_study_lessons
  for select using (
    exists (
      select 1 from p2p_family_studies s
      where s.id = study_id and s.status = 'published'
        and exists (
          select 1 from p2p_family_members m
          where m.family_id = s.family_id and m.user_id = auth.uid() and m.status = 'active'
        )
    )
  );
