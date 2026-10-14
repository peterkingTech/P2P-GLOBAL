-- 188: Publishing Studio — editorial review, approval-gated publication of
-- Kingdom Stories, server-side scheduled publishing, and an append-only audit
-- log written in the same transaction as every action.
--
-- DRAFT — NOT APPLIED to any database. Validate on staging first, only after
-- explicit approval. Independent of 179-187. The API's Studio scheduler stays
-- off until STUDIO_SCHEDULER_ENABLED=true is set AFTER this migration is
-- applied (separate approval).
--
-- RELEASE DEPENDENCY: once applied, the existing Kingdom Stories editor can
-- no longer publish a story that has not been approved in the Publishing
-- Studio, and a live story's content can no longer be changed in place. The
-- Studio screens must be available to editors (web admin or an app build that
-- contains app/admin/studio) BEFORE this is applied to production, or story
-- publishing stalls.
--
-- Design (artifacts/api-server/src/lib/studio/, routes/studio.ts):
--   * Content keeps living in its own table (p2p_kingdom_stories, …) with its
--     own status column — the only "is it published" truth. A Studio item is
--     an envelope pointing at exactly one native record (source_type +
--     source_id, unique); no content is copied.
--   * APPROVAL IS BOUND TO CONTENT: approving stores a SHA-256 fingerprint of
--     the story's reader-visible content (text fields, Scripture reference,
--     related links, media rows, source rows). Publication recomputes it; any
--     difference blocks publication until the story is reviewed again.
--   * EVERY PUBLICATION PATH IS GATED by a trigger on p2p_kingdom_stories:
--     the existing editor API, the Studio, a direct PostgREST update, the
--     scheduler and SQL by the owner. A story is never created as published.
--   * LIVE STORIES ARE FROZEN: while a story is published, its reader-visible
--     content (story fields, media, sources) cannot change. To change it:
--     unpublish (audited) → edit → review → publish. Non-content fields
--     (is_featured) and unpublish/archive stay possible. Stories already
--     published before this migration keep their content and status.
--   * IDENTITY: every editorial write function takes the actor from the
--     caller's verified Supabase session (auth.uid()), never from a
--     parameter, and re-reads that user's CURRENT role. These functions are
--     executable only by signed-in users (they refuse non-editors), NOT by
--     the service role — so the service key cannot act as an arbitrary user.
--     Only the scheduler functions run as the service role, as "scheduler".
--   * ATOMIC AUDIT: every Studio write and every story status change or
--     deletion appends its audit row in the same transaction; if the audit
--     insert fails, the action is rolled back.
--   * Tables: RLS on; staff can READ; nobody (clients or API) can write them
--     directly — only through the functions below.
--   * The audit log is append-only: UPDATE, DELETE, TRUNCATE raise for every
--     role. Limits: the table OWNER (postgres) can disable or drop the
--     triggers or the table; a holder of the service key can still change
--     p2p_profiles roles. This protects against application roles, it is not
--     tamper-evidence against database administrators.
--
-- Changes to existing objects: triggers are added to p2p_kingdom_stories,
-- p2p_kingdom_story_media and p2p_kingdom_story_sources. No existing column,
-- row, policy or grant is changed. No rows are seeded.
--
-- Error codes raised for the API (routes/studio.ts maps them):
--   S0401 no signed-in user · S0403 not permitted · S0404 not found ·
--   S0409 conflict / stale version · S0422 invalid request ·
--   S0423 publication blocked (approval missing/stale, live story frozen)

begin;

-- ── Role helpers (mirror p2p_is_kingdom_stories_editor(), migration 152) ────
create or replace function public.p2p_is_studio_staff()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from p2p_profiles
    where id = auth.uid()
      and role in ('super_admin', 'admin_content', 'admin_supervisor', 'admin_moderation',
                   'moderator', 'admin_translation', 'admin_marketing')
  );
$$;
revoke all on function public.p2p_is_studio_staff() from public, anon;
grant execute on function public.p2p_is_studio_staff() to authenticated;

-- Same roles as the API's AUDIT_VIEW_ROLES (lib/studio/policy.ts).
create or replace function public.p2p_is_studio_auditor()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from p2p_profiles
    where id = auth.uid() and role in ('super_admin', 'admin_supervisor', 'admin_content')
  );
$$;
revoke all on function public.p2p_is_studio_auditor() from public, anon;
grant execute on function public.p2p_is_studio_auditor() to authenticated;

-- ── Items: one envelope per native record ──────────────────────────────────
create table if not exists public.p2p_studio_items (
  id                   uuid primary key default gen_random_uuid(),
  source_type          text not null check (source_type in ('kingdom_story', 'kingdom_win')),
  source_id            uuid not null,
  review_state         text not null default 'draft'
                       check (review_state in ('draft', 'in_review', 'changes_requested', 'approved')),
  submitted_by         uuid references public.p2p_profiles(id) on delete set null,
  submitted_at         timestamptz,
  reviewed_by          uuid references public.p2p_profiles(id) on delete set null,
  reviewed_at          timestamptz,
  review_note          text check (review_note is null or char_length(review_note) <= 2000),
  -- Fingerprint of the exact content that was approved (set only while approved).
  approved_fingerprint text check (approved_fingerprint is null or char_length(approved_fingerprint) = 64),
  planned_for          date,
  timezone             text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  -- Optimistic concurrency: every review change must name the version it read.
  version              integer not null default 1 check (version >= 1),
  created_by           uuid references public.p2p_profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (source_type, source_id),
  check ((review_state = 'approved') = (approved_fingerprint is not null))
);
create index if not exists idx_p2p_studio_items_review on public.p2p_studio_items(review_state, updated_at desc);
create index if not exists idx_p2p_studio_items_planned on public.p2p_studio_items(planned_for) where planned_for is not null;

-- ── Schedules: server-run publish / unpublish / archive jobs ───────────────
create table if not exists public.p2p_studio_schedules (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.p2p_studio_items(id) on delete cascade,
  action           text not null check (action in ('publish', 'unpublish', 'archive')),
  run_at           timestamptz not null,
  -- What the editor entered, kept for display and DST-correct editing.
  local_time       text not null check (local_time ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
  timezone         text not null check (char_length(timezone) between 1 and 64),
  status           text not null default 'pending'
                   check (status in ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
  attempts         integer not null default 0 check (attempts >= 0),
  max_attempts     integer not null default 5 check (max_attempts between 1 and 20),
  next_attempt_at  timestamptz not null,
  locked_at        timestamptz,
  -- Set on every claim; only the worker holding the current token may finish
  -- the job (a stale worker whose claim was taken over cannot).
  claim_token      uuid,
  last_error       text check (last_error is null or char_length(last_error) <= 1000),
  -- Client-supplied key: repeating the same request never creates a second job.
  idempotency_key  text not null unique check (char_length(idempotency_key) between 8 and 128),
  created_by       uuid references public.p2p_profiles(id) on delete set null,
  cancelled_by     uuid references public.p2p_profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  result           jsonb
);
-- At most one live job per item and action.
create unique index if not exists uq_p2p_studio_schedules_live
  on public.p2p_studio_schedules(item_id, action) where status in ('pending', 'running');
create index if not exists idx_p2p_studio_schedules_due
  on public.p2p_studio_schedules(next_attempt_at) where status = 'pending';
create index if not exists idx_p2p_studio_schedules_run_at on public.p2p_studio_schedules(run_at);

-- ── Audit log: append-only ─────────────────────────────────────────────────
create table if not exists public.p2p_studio_audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,           -- no FK: the record outlives the account
  actor_role   text,
  action       text not null check (char_length(action) between 1 and 64),
  item_id      uuid,
  source_type  text,
  source_id    uuid,
  details      jsonb not null default '{}'::jsonb
);
create index if not exists idx_p2p_studio_audit_item on public.p2p_studio_audit_log(item_id, at desc);
create index if not exists idx_p2p_studio_audit_source on public.p2p_studio_audit_log(source_type, source_id, at desc);
create index if not exists idx_p2p_studio_audit_action on public.p2p_studio_audit_log(action, at desc);
create index if not exists idx_p2p_studio_audit_at on public.p2p_studio_audit_log(at desc);

create or replace function public.p2p_studio_audit_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'p2p_studio_audit_log is append-only' using errcode = '42501';
end;
$$;
drop trigger if exists trg_p2p_studio_audit_immutable on public.p2p_studio_audit_log;
create trigger trg_p2p_studio_audit_immutable
  before update or delete on public.p2p_studio_audit_log
  for each row execute function public.p2p_studio_audit_immutable();
-- TRUNCATE bypasses row triggers; block it too.
drop trigger if exists trg_p2p_studio_audit_no_truncate on public.p2p_studio_audit_log;
create trigger trg_p2p_studio_audit_no_truncate
  before truncate on public.p2p_studio_audit_log
  for each statement execute function public.p2p_studio_audit_immutable();

-- Internal: append one audit row (called only from the functions below).
create or replace function public.p2p_studio_audit(
  p_actor_id uuid, p_actor_role text, p_action text, p_item_id uuid,
  p_source_type text, p_source_id uuid, p_details jsonb
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into p2p_studio_audit_log (actor_id, actor_role, action, item_id, source_type, source_id, details)
  values (p_actor_id, p_actor_role, p_action, p_item_id, p_source_type, p_source_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ── RLS and grants ─────────────────────────────────────────────────────────
alter table public.p2p_studio_items enable row level security;
alter table public.p2p_studio_schedules enable row level security;
alter table public.p2p_studio_audit_log enable row level security;

revoke all on table public.p2p_studio_items from public, anon, authenticated, service_role;
revoke all on table public.p2p_studio_schedules from public, anon, authenticated, service_role;
revoke all on table public.p2p_studio_audit_log from public, anon, authenticated, service_role;
-- Clients: read only, filtered by the policies below.
grant select on table public.p2p_studio_items to authenticated;
grant select on table public.p2p_studio_schedules to authenticated;
grant select on table public.p2p_studio_audit_log to authenticated;
-- The API (service role): read only. Writes go through the functions below.
grant select on table public.p2p_studio_items to service_role;
grant select on table public.p2p_studio_schedules to service_role;
grant select on table public.p2p_studio_audit_log to service_role;
-- The audit id sequence: identity values are assigned by the insert itself,
-- nobody outside the owner needs it. Supabase's default privileges would
-- otherwise grant it to the client roles.
revoke all on sequence public.p2p_studio_audit_log_id_seq from public, anon, authenticated, service_role;

drop policy if exists "Studio staff read items" on public.p2p_studio_items;
create policy "Studio staff read items" on public.p2p_studio_items
  for select to authenticated using (public.p2p_is_studio_staff());
drop policy if exists "Studio staff read schedules" on public.p2p_studio_schedules;
create policy "Studio staff read schedules" on public.p2p_studio_schedules
  for select to authenticated using (public.p2p_is_studio_staff());
drop policy if exists "Studio auditors read audit log" on public.p2p_studio_audit_log;
create policy "Studio auditors read audit log" on public.p2p_studio_audit_log
  for select to authenticated using (public.p2p_is_studio_auditor());

-- ── Content fingerprint (what an approval covers) ──────────────────────────
-- Publication-relevant (reader-visible) content: title, subtitle, category,
-- content type, body, historical period, years, location, people, learning
-- section, reflection, Scripture reference, related links, and every media
-- and source row. NOT included (non-content administrative fields): status,
-- timestamps, is_featured (placement), editor_id (attribution).
create or replace function public.p2p_kingdom_story_fingerprint(s public.p2p_kingdom_stories)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select encode(sha256(convert_to(jsonb_build_object(
    'title', s.title, 'subtitle', s.subtitle, 'category_id', s.category_id, 'content_type', s.content_type,
    'body', s.body, 'historical_period', s.historical_period, 'start_year', s.start_year, 'end_year', s.end_year,
    'location', s.location, 'people', s.people, 'learning_section', s.learning_section, 'reflection', s.reflection,
    'scripture_reference_id', s.scripture_reference_id,
    'related_mission_field_id', s.related_mission_field_id, 'related_mission_story_id', s.related_mission_story_id,
    'related_curriculum_id', s.related_curriculum_id, 'related_kingdom_win_id', s.related_kingdom_win_id,
    'related_story_id', s.related_story_id,
    'media', coalesce((select jsonb_agg(jsonb_build_array(m.id, m.media_type, m.media_path, m.caption, m.display_order, m.is_cover, m.duration_seconds) order by m.id)
                       from p2p_kingdom_story_media m where m.story_id = s.id), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_array(x.id, x.title, x.publisher, x.url, x.citation, x.source_type, x.display_order) order by x.id)
                         from p2p_kingdom_story_sources x where x.story_id = s.id), '[]'::jsonb)
  )::text, 'UTF8')), 'hex');
$$;
revoke all on function public.p2p_kingdom_story_fingerprint(public.p2p_kingdom_stories) from public, anon, authenticated, service_role;

-- Why a story may NOT be published right now (null = it may). Shared by the
-- publication-gate trigger and the scheduler, so both apply the same rule.
create or replace function public.p2p_studio_story_publish_block(p_story public.p2p_kingdom_stories)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_item p2p_studio_items;
  v_reviewer_role text;
begin
  select * into v_item from p2p_studio_items where source_type = 'kingdom_story' and source_id = p_story.id;
  if not found or v_item.review_state <> 'approved' then return 'studio_approval_required'; end if;
  if v_item.reviewed_by is null then return 'studio_reviewer_missing'; end if;
  select role into v_reviewer_role from p2p_profiles where id = v_item.reviewed_by;
  if v_reviewer_role is null or v_reviewer_role not in ('admin_content', 'super_admin') then return 'studio_reviewer_ineligible'; end if;
  if v_item.submitted_by is not distinct from v_item.reviewed_by and v_reviewer_role <> 'super_admin' then return 'studio_four_eyes'; end if;
  if v_item.approved_fingerprint is distinct from p2p_kingdom_story_fingerprint(p_story) then return 'studio_approval_stale'; end if;
  if p_story.content_type = 'scripture_story' and p_story.scripture_reference_id is null then return 'scripture_reference_required'; end if;
  return null;
end;
$$;
revoke all on function public.p2p_studio_story_publish_block(public.p2p_kingdom_stories) from public, anon, authenticated, service_role;

-- Approved Studio items whose story changed since approval (read-only, for
-- the API's review screens: "changed since approval — review again").
create or replace function public.p2p_studio_stale_approvals(p_source_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id
    from p2p_kingdom_stories s
    join p2p_studio_items i on i.source_type = 'kingdom_story' and i.source_id = s.id
   where s.id = any(p_source_ids)
     and i.review_state = 'approved'
     and i.approved_fingerprint is distinct from p2p_kingdom_story_fingerprint(s);
$$;
revoke all on function public.p2p_studio_stale_approvals(uuid[]) from public, anon, authenticated;
grant execute on function public.p2p_studio_stale_approvals(uuid[]) to service_role;

-- ── Publication gate + live-story freeze + audit on p2p_kingdom_stories ────
create or replace function public.p2p_kingdom_story_publication_gate()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_reason text;
begin
  if tg_op = 'INSERT' then
    -- A story is never created already published: it must be reviewed first.
    if new.status = 'published' then
      raise exception 'studio_approval_required' using errcode = 'S0423',
        hint = 'Create the story as a draft and get it approved in the Publishing Studio.';
    end if;
    return new;
  end if;
  if new.status = 'published' and old.status is distinct from 'published' then
    v_reason := p2p_studio_story_publish_block(new);
    if v_reason is not null then
      raise exception '%', v_reason using errcode = 'S0423',
        hint = 'Kingdom Stories are published only after approval in the Publishing Studio.';
    end if;
  elsif new.status = 'published' and old.status = 'published'
        and p2p_kingdom_story_fingerprint(new) is distinct from p2p_kingdom_story_fingerprint(old) then
    -- A live story's reader-visible content never changes in place.
    raise exception 'studio_live_edit_blocked' using errcode = 'S0423',
      hint = 'Unpublish the story, edit it, and get it approved again in the Publishing Studio.';
  end if;
  return new;
end;
$$;
revoke all on function public.p2p_kingdom_story_publication_gate() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_story_publication_gate on public.p2p_kingdom_stories;
create trigger trg_p2p_kingdom_story_publication_gate
  before insert or update on public.p2p_kingdom_stories
  for each row execute function public.p2p_kingdom_story_publication_gate();

-- Media and sources of a live story are part of its content: frozen too.
create or replace function public.p2p_kingdom_story_child_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op in ('UPDATE', 'DELETE') and exists (select 1 from p2p_kingdom_stories where id = old.story_id and status = 'published'))
     or (tg_op in ('INSERT', 'UPDATE') and exists (select 1 from p2p_kingdom_stories where id = new.story_id and status = 'published')) then
    raise exception 'studio_live_edit_blocked' using errcode = 'S0423',
      hint = 'Unpublish the story, edit it, and get it approved again in the Publishing Studio.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.p2p_kingdom_story_child_freeze() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_story_media_freeze on public.p2p_kingdom_story_media;
create trigger trg_p2p_kingdom_story_media_freeze
  before insert or update or delete on public.p2p_kingdom_story_media
  for each row execute function public.p2p_kingdom_story_child_freeze();
drop trigger if exists trg_p2p_kingdom_story_sources_freeze on public.p2p_kingdom_story_sources;
create trigger trg_p2p_kingdom_story_sources_freeze
  before insert or update or delete on public.p2p_kingdom_story_sources
  for each row execute function public.p2p_kingdom_story_child_freeze();

-- Every status change and every deletion of a story is audited in the same
-- transaction. The functions below name the actor via transaction-local
-- settings; a direct change by a signed-in editor is attributed to auth.uid().
create or replace function public.p2p_kingdom_story_status_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item_id uuid;
  v_story_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if tg_op = 'DELETE' or new.status is distinct from old.status then
    select id into v_item_id from p2p_studio_items where source_type = 'kingdom_story' and source_id = v_story_id;
    perform p2p_studio_audit(
      coalesce(nullif(current_setting('p2p.actor_id', true), '')::uuid, auth.uid()),
      coalesce(nullif(current_setting('p2p.actor_role', true), ''), 'direct'),
      case when tg_op = 'DELETE' then 'story.deleted' when new.status = 'published' then 'story.published' else 'story.status_changed' end,
      v_item_id, 'kingdom_story', v_story_id,
      jsonb_build_object('from', old.status, 'to', case when tg_op = 'DELETE' then null else new.status end,
                         'title', old.title,
                         'path', coalesce(nullif(current_setting('p2p.path', true), ''), 'direct')));
  end if;
  return null;
end;
$$;
revoke all on function public.p2p_kingdom_story_status_audit() from public, anon, authenticated, service_role;
drop trigger if exists trg_p2p_kingdom_story_status_audit on public.p2p_kingdom_stories;
create trigger trg_p2p_kingdom_story_status_audit
  after update or delete on public.p2p_kingdom_stories
  for each row execute function public.p2p_kingdom_story_status_audit();

-- ── Editorial write functions (signed-in editors, as themselves) ───────────
-- Each one: takes the actor from auth.uid() (the caller's verified session),
-- re-reads that user's CURRENT role, refuses anything not permitted BEFORE
-- creating any row, and changes state + appends the audit row in one
-- transaction. Not executable by anon or by the service role.

create or replace function public.p2p_studio_editor_role(p_actor_id uuid)
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select role from p2p_profiles where id = p_actor_id and role in ('admin_content', 'super_admin');
$$;
revoke all on function public.p2p_studio_editor_role(uuid) from public, anon, authenticated, service_role;

create or replace function public.p2p_studio_review_transition(
  p_source_type text, p_source_id uuid, p_to text, p_expected_version integer, p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_story p2p_kingdom_stories;
  v_item p2p_studio_items;
  v_from text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cancelled integer := 0;
begin
  if v_actor is null then raise exception 'studio_unauthenticated' using errcode = 'S0401'; end if;
  if p_source_type is distinct from 'kingdom_story' then
    raise exception 'studio_read_only_source' using errcode = 'S0403';
  end if;
  v_role := p2p_studio_editor_role(v_actor);
  if v_role is null then raise exception 'studio_forbidden' using errcode = 'S0403'; end if;
  if p_to is null or p_to not in ('draft', 'in_review', 'changes_requested', 'approved') then
    raise exception 'studio_invalid_state' using errcode = 'S0422';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'studio_version_required' using errcode = 'S0422';
  end if;
  if v_note is not null and char_length(v_note) > 2000 then raise exception 'studio_note_too_long' using errcode = 'S0422'; end if;
  select * into v_story from p2p_kingdom_stories where id = p_source_id;
  if not found then raise exception 'studio_source_missing' using errcode = 'S0404'; end if;

  insert into p2p_studio_items (source_type, source_id, created_by) values ('kingdom_story', p_source_id, v_actor)
    on conflict (source_type, source_id) do nothing;
  select * into v_item from p2p_studio_items where source_type = 'kingdom_story' and source_id = p_source_id for update;
  if v_item.version <> p_expected_version then
    raise exception 'studio_version_conflict' using errcode = 'S0409', detail = v_item.version::text;
  end if;
  v_from := v_item.review_state;
  if not ((v_from = 'draft' and p_to = 'in_review')
       or (v_from = 'in_review' and p_to in ('approved', 'changes_requested', 'draft'))
       or (v_from = 'changes_requested' and p_to in ('in_review', 'draft'))
       or (v_from = 'approved' and p_to = 'draft')) then
    raise exception 'studio_invalid_transition' using errcode = 'S0422', detail = v_from || ' -> ' || p_to;
  end if;
  if p_to in ('approved', 'changes_requested') and v_item.submitted_by = v_actor and v_role <> 'super_admin' then
    raise exception 'studio_four_eyes' using errcode = 'S0403';
  end if;

  update p2p_studio_items set
    review_state = p_to,
    version = version + 1,
    updated_at = now(),
    submitted_by = case when p_to = 'in_review' then v_actor else submitted_by end,
    submitted_at = case when p_to = 'in_review' then now() else submitted_at end,
    reviewed_by = case when p_to in ('approved', 'changes_requested') then v_actor when p_to = 'in_review' then null else reviewed_by end,
    reviewed_at = case when p_to in ('approved', 'changes_requested') then now() when p_to = 'in_review' then null else reviewed_at end,
    review_note = case when p_to in ('approved', 'changes_requested') then v_note else review_note end,
    approved_fingerprint = case when p_to = 'approved' then p2p_kingdom_story_fingerprint(v_story) else null end
  where id = v_item.id
  returning * into v_item;

  -- Leaving "approved" withdraws the approval any pending publish relied on.
  if v_from = 'approved' then
    update p2p_studio_schedules set status = 'cancelled', cancelled_by = v_actor, completed_at = now(), last_error = 'approval_withdrawn'
      where item_id = v_item.id and action = 'publish' and status = 'pending';
    get diagnostics v_cancelled = row_count;
  end if;

  perform p2p_studio_audit(v_actor, v_role, 'review.' || p_to, v_item.id, 'kingdom_story', p_source_id,
    jsonb_build_object('from', v_from, 'to', p_to, 'note', v_note, 'version', v_item.version, 'cancelledPublishSchedules', v_cancelled));

  return jsonb_build_object('itemId', v_item.id, 'reviewState', v_item.review_state, 'version', v_item.version,
                            'cancelledPublishSchedules', v_cancelled);
end;
$$;
revoke all on function public.p2p_studio_review_transition(text, uuid, text, integer, text) from public, anon, service_role;
grant execute on function public.p2p_studio_review_transition(text, uuid, text, integer, text) to authenticated;

create or replace function public.p2p_studio_create_schedule(
  p_source_type text, p_source_id uuid, p_action text, p_run_at timestamptz,
  p_local_time text, p_timezone text, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_prior p2p_studio_schedules;
  v_prior_item p2p_studio_items;
  v_item p2p_studio_items;
  v_row p2p_studio_schedules;
begin
  if v_actor is null then raise exception 'studio_unauthenticated' using errcode = 'S0401'; end if;
  if p_source_type is distinct from 'kingdom_story' then
    raise exception 'studio_read_only_source' using errcode = 'S0403';
  end if;
  v_role := p2p_studio_editor_role(v_actor);
  if v_role is null then raise exception 'studio_forbidden' using errcode = 'S0403'; end if;
  if p_action is null or p_action not in ('publish', 'unpublish', 'archive') then
    raise exception 'studio_invalid_action' using errcode = 'S0422';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'studio_idempotency_key_required' using errcode = 'S0422';
  end if;

  -- Checked only after authorization. The same request repeated by the same
  -- user for the same item gets the same answer; a key reused for anything
  -- else is refused (never silently treated as done).
  select * into v_prior from p2p_studio_schedules where idempotency_key = p_idempotency_key;
  if found then
    select * into v_prior_item from p2p_studio_items where id = v_prior.item_id;
    if v_prior.created_by is not distinct from v_actor and v_prior.action = p_action
       and v_prior_item.source_type = p_source_type and v_prior_item.source_id = p_source_id then
      return jsonb_build_object('replayed', true, 'schedule', to_jsonb(v_prior) - 'claim_token');
    end if;
    raise exception 'studio_idempotency_key_reused' using errcode = 'S0409';
  end if;

  if p_run_at is null or p_run_at < now() + interval '30 seconds' or p_run_at > now() + interval '366 days' then
    raise exception 'studio_invalid_run_at' using errcode = 'S0422';
  end if;
  if not exists (select 1 from p2p_kingdom_stories where id = p_source_id) then
    raise exception 'studio_source_missing' using errcode = 'S0404';
  end if;

  -- Publishing needs an approval that exists BEFORE any row is created.
  select * into v_item from p2p_studio_items where source_type = 'kingdom_story' and source_id = p_source_id for update;
  if p_action = 'publish' and (not found or v_item.review_state <> 'approved') then
    raise exception 'studio_approval_required' using errcode = 'S0403';
  end if;
  if not found then
    insert into p2p_studio_items (source_type, source_id, created_by) values ('kingdom_story', p_source_id, v_actor)
      on conflict (source_type, source_id) do nothing;
    select * into v_item from p2p_studio_items where source_type = 'kingdom_story' and source_id = p_source_id for update;
  end if;

  begin
    insert into p2p_studio_schedules (item_id, action, run_at, next_attempt_at, local_time, timezone, idempotency_key, created_by)
    values (v_item.id, p_action, p_run_at, p_run_at, p_local_time, p_timezone, p_idempotency_key, v_actor)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'studio_already_scheduled' using errcode = 'S0409';
  end;

  perform p2p_studio_audit(v_actor, v_role, 'schedule.created', v_item.id, 'kingdom_story', p_source_id,
    jsonb_build_object('scheduleId', v_row.id, 'jobAction', p_action, 'runAt', p_run_at, 'localTime', p_local_time, 'timezone', p_timezone));
  return jsonb_build_object('replayed', false, 'schedule', to_jsonb(v_row) - 'claim_token');
end;
$$;
revoke all on function public.p2p_studio_create_schedule(text, uuid, text, timestamptz, text, text, text) from public, anon, service_role;
grant execute on function public.p2p_studio_create_schedule(text, uuid, text, timestamptz, text, text, text) to authenticated;

create or replace function public.p2p_studio_cancel_schedule(p_schedule_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_row p2p_studio_schedules;
  v_item p2p_studio_items;
begin
  if v_actor is null then raise exception 'studio_unauthenticated' using errcode = 'S0401'; end if;
  v_role := p2p_studio_editor_role(v_actor);
  if v_role is null then raise exception 'studio_forbidden' using errcode = 'S0403'; end if;
  select * into v_row from p2p_studio_schedules where id = p_schedule_id for update;
  if not found then raise exception 'studio_schedule_missing' using errcode = 'S0404'; end if;
  select * into v_item from p2p_studio_items where id = v_row.item_id;
  if v_item.source_type <> 'kingdom_story' then raise exception 'studio_read_only_source' using errcode = 'S0403'; end if;
  if v_row.status = 'cancelled' then return jsonb_build_object('cancelled', true, 'alreadyCancelled', true); end if;
  if v_row.status <> 'pending' then
    raise exception 'studio_not_cancellable' using errcode = 'S0409', detail = v_row.status;
  end if;
  update p2p_studio_schedules set status = 'cancelled', cancelled_by = v_actor, completed_at = now() where id = v_row.id;
  perform p2p_studio_audit(v_actor, v_role, 'schedule.cancelled', v_item.id, v_item.source_type, v_item.source_id,
    jsonb_build_object('scheduleId', v_row.id, 'jobAction', v_row.action));
  return jsonb_build_object('cancelled', true);
end;
$$;
revoke all on function public.p2p_studio_cancel_schedule(uuid) from public, anon, service_role;
grant execute on function public.p2p_studio_cancel_schedule(uuid) to authenticated;

-- Change a story's status as the signed-in editor: the existing editor's
-- Publish/Archive/Restore buttons and the Studio's "Publish now". Publishing
-- passes the gate trigger like every other path.
create or replace function public.p2p_kingdom_story_set_status(p_story_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_story p2p_kingdom_stories;
begin
  if v_actor is null then raise exception 'studio_unauthenticated' using errcode = 'S0401'; end if;
  v_role := p2p_studio_editor_role(v_actor);
  if v_role is null then raise exception 'studio_forbidden' using errcode = 'S0403'; end if;
  if p_status is null or p_status not in ('draft', 'review', 'published', 'archived') then
    raise exception 'studio_invalid_state' using errcode = 'S0422';
  end if;
  perform set_config('p2p.actor_id', v_actor::text, true);
  perform set_config('p2p.actor_role', v_role, true);
  perform set_config('p2p.path', 'editor', true);
  update p2p_kingdom_stories set
    status = p_status,
    updated_at = now(),
    published_at = case when p_status = 'published' and status <> 'published' then now() else published_at end,
    archived_at = case when p_status = 'archived' and archived_at is null then now() else archived_at end
  where id = p_story_id
  returning * into v_story;
  if not found then raise exception 'studio_source_missing' using errcode = 'S0404'; end if;
  return to_jsonb(v_story);
end;
$$;
revoke all on function public.p2p_kingdom_story_set_status(uuid, text) from public, anon, service_role;
grant execute on function public.p2p_kingdom_story_set_status(uuid, text) to authenticated;

-- ── Scheduler (service role only; acts as "scheduler") ─────────────────────
-- Atomically claims due jobs (FOR UPDATE SKIP LOCKED, so two API instances
-- never claim the same job) and re-claims jobs left 'running' by a crashed
-- worker after p_stale_seconds. Every claim issues a new claim_token; only
-- that token can run or finish the job, so a stale worker cannot.
create or replace function public.p2p_studio_claim_due_jobs(p_limit integer, p_stale_seconds integer default 600)
returns setof public.p2p_studio_schedules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be 1-100' using errcode = '22023';
  end if;
  return query
  update p2p_studio_schedules s
     set status = 'running', locked_at = now(), attempts = s.attempts + 1, claim_token = gen_random_uuid()
   where s.id in (
     select id from p2p_studio_schedules
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'running' and locked_at < now() - make_interval(secs => greatest(p_stale_seconds, 60)))
      order by next_attempt_at
      limit p_limit
      for update skip locked
   )
  returning s.*;
end;
$$;
revoke all on function public.p2p_studio_claim_due_jobs(integer, integer) from public, anon, authenticated;
grant execute on function public.p2p_studio_claim_due_jobs(integer, integer) to service_role;

-- Runs one claimed job to a final outcome in ONE transaction: the content
-- change (through the gate trigger), the job's new status and the audit rows
-- commit together or not at all. Re-checks approval, reviewer eligibility and
-- content integrity at execution time. Permanent refusals are recorded here;
-- an exception rolls everything back and the API records a retry with
-- p2p_studio_finish_job. Notifications are not part of publication (none are
-- sent by this function).
create or replace function public.p2p_studio_run_job(p_schedule_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job p2p_studio_schedules;
  v_item p2p_studio_items;
  v_story p2p_kingdom_stories;
  v_block text;
  v_target text;
  v_changed boolean := false;
  v_reason text;
begin
  select * into v_job from p2p_studio_schedules where id = p_schedule_id for update;
  if not found or v_job.status <> 'running' or v_job.claim_token is distinct from p_claim_token then
    return jsonb_build_object('outcome', 'not_running');
  end if;

  select * into v_item from p2p_studio_items where id = v_job.item_id for update;
  if v_job.attempts > v_job.max_attempts then v_reason := 'attempts_exhausted';
  elsif not found then v_reason := 'item_missing';
  elsif v_item.source_type <> 'kingdom_story' then v_reason := 'no_adapter:' || v_item.source_type;
  else
    select * into v_story from p2p_kingdom_stories where id = v_item.source_id for update;
    if not found then v_reason := 'source_missing'; end if;
  end if;

  if v_reason is null then
    v_target := case v_job.action when 'publish' then 'published' when 'unpublish' then 'draft' else 'archived' end;
    perform set_config('p2p.actor_id', coalesce(v_job.created_by::text, ''), true);
    perform set_config('p2p.actor_role', 'scheduler', true);
    perform set_config('p2p.path', 'studio_schedule', true);
    if v_job.action = 'publish' then
      if v_story.status <> 'published' then
        v_block := p2p_studio_story_publish_block(v_story);
        if v_block = 'studio_approval_stale' then
          -- Content changed after approval: the approval no longer applies.
          update p2p_studio_items set review_state = 'draft', approved_fingerprint = null, version = version + 1, updated_at = now(),
                 review_note = 'Content changed after approval; review again before publishing.'
           where id = v_item.id;
          perform p2p_studio_audit(null, 'scheduler', 'review.invalidated', v_item.id, 'kingdom_story', v_story.id,
            jsonb_build_object('reason', 'changed_since_approval', 'scheduleId', v_job.id));
          v_reason := 'changed_since_approval';
        elsif v_block is not null then
          v_reason := v_block;
        else
          update p2p_kingdom_stories set status = 'published', updated_at = now(), published_at = coalesce(published_at, now())
           where id = v_story.id;
          v_changed := true;
        end if;
      end if;
    elsif v_job.action = 'unpublish' then
      if v_story.status = 'published' then
        update p2p_kingdom_stories set status = 'draft', updated_at = now() where id = v_story.id;
        v_changed := true;
      end if;
    else
      if v_story.status <> 'archived' then
        update p2p_kingdom_stories set status = 'archived', updated_at = now(), archived_at = coalesce(archived_at, now())
         where id = v_story.id;
        v_changed := true;
      end if;
    end if;
  end if;

  if v_reason is not null then
    update p2p_studio_schedules set status = 'failed', locked_at = null, claim_token = null, last_error = v_reason, completed_at = now() where id = v_job.id;
    perform p2p_studio_audit(null, 'scheduler', 'schedule.failed', v_job.item_id, v_item.source_type, v_item.source_id,
      jsonb_build_object('scheduleId', v_job.id, 'jobAction', v_job.action, 'attempt', v_job.attempts, 'reason', v_reason));
    return jsonb_build_object('outcome', 'failed', 'reason', v_reason);
  end if;

  update p2p_studio_schedules set status = 'succeeded', locked_at = null, claim_token = null, last_error = null, completed_at = now(),
         result = jsonb_build_object('changed', v_changed, 'nativeStatus', v_target)
   where id = v_job.id;
  perform p2p_studio_audit(null, 'scheduler', 'schedule.executed', v_job.item_id, 'kingdom_story', v_story.id,
    jsonb_build_object('scheduleId', v_job.id, 'jobAction', v_job.action, 'attempt', v_job.attempts, 'changed', v_changed, 'nativeStatus', v_target));
  return jsonb_build_object('outcome', 'succeeded', 'changed', v_changed, 'nativeStatus', v_target);
end;
$$;
revoke all on function public.p2p_studio_run_job(uuid, uuid) from public, anon, authenticated;
grant execute on function public.p2p_studio_run_job(uuid, uuid) to service_role;

-- Records a retry or final failure for a job whose run raised an error; only
-- the worker holding the job's current claim token can.
create or replace function public.p2p_studio_finish_job(p_schedule_id uuid, p_claim_token uuid, p_retry boolean, p_next_attempt_at timestamptz, p_error text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job p2p_studio_schedules;
  v_item p2p_studio_items;
begin
  update p2p_studio_schedules set
    status = case when p_retry then 'pending' else 'failed' end,
    next_attempt_at = case when p_retry then coalesce(p_next_attempt_at, now()) else next_attempt_at end,
    completed_at = case when p_retry then null else now() end,
    locked_at = null,
    claim_token = null,
    last_error = left(coalesce(p_error, 'error'), 1000)
  where id = p_schedule_id and status = 'running' and claim_token = p_claim_token
  returning * into v_job;
  if not found then return false; end if;
  select * into v_item from p2p_studio_items where id = v_job.item_id;
  perform p2p_studio_audit(null, 'scheduler', case when p_retry then 'schedule.retry' else 'schedule.failed' end,
    v_job.item_id, v_item.source_type, v_item.source_id,
    jsonb_build_object('scheduleId', v_job.id, 'jobAction', v_job.action, 'attempt', v_job.attempts, 'reason', left(coalesce(p_error, 'error'), 300)));
  return true;
end;
$$;
revoke all on function public.p2p_studio_finish_job(uuid, uuid, boolean, timestamptz, text) from public, anon, authenticated;
grant execute on function public.p2p_studio_finish_job(uuid, uuid, boolean, timestamptz, text) to service_role;

-- Internal helper: never callable by any client or by the API directly.
revoke all on function public.p2p_studio_audit(uuid, text, text, uuid, text, uuid, jsonb) from public, anon, authenticated, service_role;

commit;

-- Rollback (manual). Removes the Studio, the publication gate and the
-- live-story freeze; native stories keep their current status and content.
-- Audit history is lost with the table.
--   begin;
--   drop trigger if exists trg_p2p_kingdom_story_publication_gate on public.p2p_kingdom_stories;
--   drop trigger if exists trg_p2p_kingdom_story_status_audit on public.p2p_kingdom_stories;
--   drop trigger if exists trg_p2p_kingdom_story_media_freeze on public.p2p_kingdom_story_media;
--   drop trigger if exists trg_p2p_kingdom_story_sources_freeze on public.p2p_kingdom_story_sources;
--   drop function if exists public.p2p_studio_finish_job(uuid, uuid, boolean, timestamptz, text);
--   drop function if exists public.p2p_studio_run_job(uuid, uuid);
--   drop function if exists public.p2p_studio_claim_due_jobs(integer, integer);
--   drop function if exists public.p2p_kingdom_story_set_status(uuid, text);
--   drop function if exists public.p2p_studio_cancel_schedule(uuid);
--   drop function if exists public.p2p_studio_create_schedule(text, uuid, text, timestamptz, text, text, text);
--   drop function if exists public.p2p_studio_review_transition(text, uuid, text, integer, text);
--   drop function if exists public.p2p_studio_editor_role(uuid);
--   drop function if exists public.p2p_kingdom_story_status_audit();
--   drop function if exists public.p2p_kingdom_story_child_freeze();
--   drop function if exists public.p2p_kingdom_story_publication_gate();
--   drop function if exists public.p2p_studio_stale_approvals(uuid[]);
--   drop function if exists public.p2p_studio_story_publish_block(public.p2p_kingdom_stories);
--   drop function if exists public.p2p_kingdom_story_fingerprint(public.p2p_kingdom_stories);
--   drop table if exists public.p2p_studio_audit_log;
--   drop function if exists public.p2p_studio_audit(uuid, text, text, uuid, text, uuid, jsonb);
--   drop function if exists public.p2p_studio_audit_immutable();
--   drop table if exists public.p2p_studio_schedules;
--   drop table if exists public.p2p_studio_items;
--   drop function if exists public.p2p_is_studio_auditor();
--   drop function if exists public.p2p_is_studio_staff();
--   commit;
