-- APPLIED TO PRODUCTION 2026-11-14 18:12:31 UTC (owner approval 2026-11-14; guarded single-transaction apply with in-transaction checks incl. rolled-back behaviour tests; backup C:/Users/offic/P2P-Backups/prod-c5e1812c-2026-11-14T18-12-26-731Z-tables-251-252 (JSON of every touched table)).
-- The notes below were written before applying; "NOT APPLIED" there is historical.
-- 251 — P2P Plans: discovery subjects, plan versions, Study Together in private groups, group plan history.
-- Written 2026-11-14. NOT APPLIED. REQUIRES 245 (private groups) and 249 (P2P Plans).
-- Owner decisions 2026-11-14: 1a (editorial subject records, seeded as drafts from P2P's own stories — see 252),
-- 2 (a group made from a plan is a PRIVATE GROUP, migration 245), 3 (this migration).
--
-- ADDITIVE ONLY. No existing row is deleted or rewritten:
--   * existing plans get version 1; existing sessions get added_in_version 1; existing runs keep a NULL snapshot
--     (NULL = "follow the plan's current sessions", exactly today's behaviour);
--   * the sessions' unique position becomes a partial unique index that ignores RETIRED sessions, so a session
--     removed from a plan is retired (kept, with everyone's completions) instead of deleted;
--   * Study Together gains one destination ('private_group'); existing studies are untouched;
--   * one active plan per group is enforced only for study_plan studies that have a group (no existing rows).
--
--   p2p_study_plans          + version, is_draft (builder draft, not startable), client_key (retry-safe create)
--   p2p_study_plan_sessions  + added_in_version, retired_in_version, retired_at
--   p2p_study_plan_enrollments + plan_version, required_session_ids (what was required when the person started)
--   p2p_study_plan_versions  NEW: one row per published change of a plan (what changed, the session list)
--   p2p_study_subjects       NEW: Biblical people / events / places / themes — editorial records, four eyes
--   p2p_subject_resource_links NEW: approved relationships subject → resource (direct / supporting / further)
--   p2p_shared_studies       + plan_schedule (a GROUP's own schedule), client_key, completed_by;
--                            destination 'private_group'; one active plan per group
--   p2p_create_plan_group()  NEW: creates a private group + its admin + the plan's shared study in ONE transaction
--
-- Security: every new table is API-only (RLS on, no client policies, no anon/authenticated grants), like 249.
-- Rollback: drop the function and the three new tables; drop the added columns; restore the destination check
-- and the sessions' (plan_id, position) unique constraint.

begin;

-- ── 1. Plan versions; sessions retire instead of being deleted ───────────────────
alter table public.p2p_study_plans add column if not exists version integer not null default 1;
alter table public.p2p_study_plans add column if not exists is_draft boolean not null default false;
alter table public.p2p_study_plans add column if not exists client_key text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_study_plans_version_check') then
    alter table public.p2p_study_plans add constraint p2p_study_plans_version_check check (version between 1 and 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_study_plans_client_key_check') then
    alter table public.p2p_study_plans add constraint p2p_study_plans_client_key_check check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,80}$');
  end if;
  -- A builder draft is always the participant's own (official plans have the editorial workflow instead).
  if not exists (select 1 from pg_constraint where conname = 'p2p_study_plans_draft_owner') then
    alter table public.p2p_study_plans add constraint p2p_study_plans_draft_owner check (not is_draft or origin = 'participant');
  end if;
end $$;
-- The same create request sent twice (a double tap, a retry after a dropped connection) makes ONE plan.
create unique index if not exists p2p_study_plans_client_key on public.p2p_study_plans (created_by, client_key) where client_key is not null;

alter table public.p2p_study_plan_sessions add column if not exists added_in_version integer not null default 1;
alter table public.p2p_study_plan_sessions add column if not exists retired_in_version integer;
alter table public.p2p_study_plan_sessions add column if not exists retired_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_study_plan_sessions_retired') then
    alter table public.p2p_study_plan_sessions add constraint p2p_study_plan_sessions_retired check ((retired_at is null) = (retired_in_version is null));
  end if;
  -- Positions stay unique among the plan's CURRENT sessions; a retired session keeps its old position.
  if exists (select 1 from pg_constraint where conname = 'p2p_study_plan_sessions_position_key') then
    alter table public.p2p_study_plan_sessions drop constraint p2p_study_plan_sessions_position_key;
  end if;
end $$;
create unique index if not exists p2p_study_plan_sessions_current_position on public.p2p_study_plan_sessions (plan_id, position) where retired_at is null;

alter table public.p2p_study_plan_enrollments add column if not exists plan_version integer;
alter table public.p2p_study_plan_enrollments add column if not exists required_session_ids jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_study_plan_enrollments_required_check') then
    alter table public.p2p_study_plan_enrollments add constraint p2p_study_plan_enrollments_required_check
      check (required_session_ids is null or (jsonb_typeof(required_session_ids) = 'array' and jsonb_array_length(required_session_ids) <= 1000));
  end if;
end $$;

create table if not exists public.p2p_study_plan_versions (
  plan_id     uuid not null references public.p2p_study_plans(id) on delete cascade,
  version     integer not null check (version between 1 and 100000),
  changed_by  uuid references public.p2p_profiles(id) on delete set null,
  changed_at  timestamptz not null default now(),
  -- { added: [ids], retired: [ids], edited: [ids] } and the session list after the change ({id, position, title}).
  changes     jsonb not null default '{}'::jsonb check (jsonb_typeof(changes) = 'object'),
  sessions    jsonb not null default '[]'::jsonb check (jsonb_typeof(sessions) = 'array'),
  primary key (plan_id, version)
);

-- ── 2. Subjects and their resource relationships (editorial, four eyes) ─────────────
create table if not exists public.p2p_study_subjects (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  kind               text not null check (kind in ('person', 'event', 'place', 'theme')),
  name               text not null check (char_length(btrim(name)) between 1 and 120),
  summary            text check (summary is null or char_length(summary) <= 1000),
  -- Scripture references only (USFM book code, chapter, optional verse range) — never text.
  passages           jsonb not null default '[]'::jsonb check (jsonb_typeof(passages) = 'array' and jsonb_array_length(passages) <= 80),
  -- Where the draft came from, e.g. "Kingdom Story 'Abraham: …', chapters 1–8 (narrative references)".
  source_note        text check (source_note is null or char_length(source_note) <= 500),
  editorial_status   text not null default 'draft' check (editorial_status in ('draft', 'under_review', 'approved', 'published', 'archived')),
  created_by         uuid references public.p2p_profiles(id) on delete set null,
  submitted_by       uuid references public.p2p_profiles(id) on delete set null,
  reviewed_by        uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at        timestamptz,
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint p2p_study_subjects_four_eyes check (editorial_status not in ('approved', 'published')
    or (reviewed_by is not null and submitted_by is not null and reviewed_by <> submitted_by)),
  constraint p2p_study_subjects_published_at check (editorial_status <> 'published' or published_at is not null)
);
create index if not exists p2p_study_subjects_status_idx on public.p2p_study_subjects (editorial_status, kind);

create table if not exists public.p2p_subject_resource_links (
  id               uuid primary key default gen_random_uuid(),
  -- What the relationship is FOR: a subject record, a Scripture topic (slug), a Bible book (USFM code) or a curriculum.
  subject_type     text not null check (subject_type in ('subject', 'bible_topic', 'bible_book', 'curriculum')),
  subject_key      text not null check (char_length(subject_key) between 1 and 120),
  -- The resource, by reference ({kind, id} / {kind, slug} / {kind, book, chapter…} / {kind, key}); never content.
  resource         jsonb not null check (jsonb_typeof(resource) = 'object' and resource ? 'kind'),
  resource_key     text not null check (char_length(resource_key) between 3 and 200),
  relation         text not null check (relation in ('direct', 'supporting', 'further')),
  -- Shown to participants: why this resource belongs ("Tells Abraham's story in eight chapters").
  reason           text not null check (char_length(btrim(reason)) between 1 and 300),
  editorial_status text not null default 'needs_review' check (editorial_status in ('needs_review', 'approved', 'archived')),
  created_by       uuid references public.p2p_profiles(id) on delete set null,
  reviewed_by      uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  constraint p2p_subject_resource_links_once unique (subject_type, subject_key, resource_key),
  -- An approved relationship was approved by someone other than the editor who proposed it.
  constraint p2p_subject_resource_links_four_eyes check (editorial_status <> 'approved' or (reviewed_by is not null and (created_by is null or reviewed_by <> created_by)))
);
create index if not exists p2p_subject_resource_links_subject_idx on public.p2p_subject_resource_links (subject_type, subject_key) where editorial_status = 'approved';

-- ── 3. Study Together: private groups; a group's plans over time ─────────────────
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_destination_type_check'
             and pg_get_constraintdef(oid) not like '%private_group%') then
    alter table public.p2p_shared_studies drop constraint p2p_shared_studies_destination_type_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_destination_type_check') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_destination_type_check
      check (destination_type in ('peer', 'family', 'church', 'circle', 'group', 'private_group'));
  end if;
end $$;
-- The GROUP's own schedule for its plan ({durationKey, pace, startDate, customDays?}); the plan itself never changes.
alter table public.p2p_shared_studies add column if not exists plan_schedule jsonb;
alter table public.p2p_shared_studies add column if not exists client_key text;
alter table public.p2p_shared_studies add column if not exists completed_by uuid references public.p2p_profiles(id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_plan_schedule_check') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_plan_schedule_check
      check (plan_schedule is null or (content_type = 'study_plan' and jsonb_typeof(plan_schedule) = 'object'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'p2p_shared_studies_client_key_check') then
    alter table public.p2p_shared_studies add constraint p2p_shared_studies_client_key_check check (client_key is null or client_key ~ '^[A-Za-z0-9_-]{8,80}$');
  end if;
end $$;
create unique index if not exists p2p_shared_studies_client_key on public.p2p_shared_studies (host_id, client_key) where client_key is not null;
-- ONE active plan per group at a time. A completed plan is 'concluded' and stays as the group's history.
create unique index if not exists p2p_shared_studies_one_active_group_plan on public.p2p_shared_studies (destination_type, destination_id)
  where content_type = 'study_plan' and status = 'active' and destination_id is not null;

-- ── 4. Create a private group from a plan, atomically and retry-safe ──────────────
-- Called by the API only (service role) after it has checked the caller and the plan. Creates the group
-- conversation (chat, calls and membership exactly as migration 245), its creator as admin, the audit event,
-- and the plan's Study Together study — or returns what an earlier call with the same key already created.
create or replace function public.p2p_create_plan_group(p_owner uuid, p_plan uuid, p_name text, p_description text,
  p_schedule jsonb, p_client_key text) returns table (group_id uuid, study_id uuid, existing boolean)
  language plpgsql security definer set search_path = public as $$
declare v_group uuid; v_study uuid; v_title text;
begin
  if p_client_key is not null then
    select s.destination_id, s.id into v_group, v_study from p2p_shared_studies s where s.host_id = p_owner and s.client_key = p_client_key;
    if v_study is not null then return query select v_group, v_study, true; return; end if;
  end if;
  select title into v_title from p2p_study_plans where id = p_plan;
  if v_title is null then raise exception 'plan not found' using errcode = 'P0002'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'name' using errcode = '22023'; end if;
  insert into p2p_conversations (type, conversation_type, name, description, created_by, posting)
    values ('group', 'private_group', btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_owner, 'everyone') returning id into v_group;
  insert into p2p_conversation_members (conversation_id, user_id, role) values (v_group, p_owner, 'admin');
  insert into p2p_group_events (target_type, target_id, actor_id, event, detail) values ('group', v_group, p_owner, 'created', jsonb_build_object('fromPlan', p_plan));
  insert into p2p_shared_studies (content_type, content_id, title, host_id, destination_type, destination_id, plan_schedule, client_key)
    values ('study_plan', p_plan, left(v_title, 300), p_owner, 'private_group', v_group, p_schedule, p_client_key) returning id into v_study;
  insert into p2p_shared_study_members (study_id, user_id, role, status, responded_at, last_opened_at) values (v_study, p_owner, 'host', 'accepted', now(), now());
  return query select v_group, v_study, false;
end $$;
revoke all on function public.p2p_create_plan_group(uuid, uuid, text, text, jsonb, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on function public.p2p_create_plan_group(uuid, uuid, text, text, jsonb, text) from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on function public.p2p_create_plan_group(uuid, uuid, text, text, jsonb, text) from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant execute on function public.p2p_create_plan_group(uuid, uuid, text, text, jsonb, text) to service_role'; end if;
end $$;

-- ── 5. API-only access for the new tables ─────────────────────────────────────
alter table public.p2p_study_plan_versions enable row level security;
alter table public.p2p_study_subjects enable row level security;
alter table public.p2p_subject_resource_links enable row level security;
do $$ declare t text; begin
  foreach t in array array['p2p_study_plan_versions', 'p2p_study_subjects', 'p2p_subject_resource_links'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant select, insert, update, delete on public.%I to service_role', t); end if;
  end loop;
end $$;

commit;
