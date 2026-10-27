-- 214: P2P Admin Recycle Bin — recoverable deletion for admin-managed content.
--
-- Deleting supported content moves it to the Recycle Bin instead of losing it:
-- one transaction captures a complete snapshot of the item and everything that
-- depends on it (found by walking the foreign keys, so learners' work tied to
-- the content — submissions, evaluations, progress, highlights — is kept too),
-- records every link that the deletion clears (ON DELETE SET NULL), then
-- removes the rows. Restore puts every row back with its ORIGINAL id, parents
-- before children, and re-links what was cleared. Nothing is inferred: the
-- snapshot is the rows exactly as they were.
--
-- Why a snapshot and not a hidden flag: Kingdom School tables are read in
-- ~200 places (API and shipped app builds read some directly), so a new
-- "deleted" filter could not be applied everywhere reliably, and a missed
-- filter would leak deleted content. Removing the rows keeps every existing
-- reader correct; the bin holds them until they are restored or purged.
--
-- Safety rules:
--   • Server-only: the bin table has RLS on and no policies; the functions
--     run only for the API's service role and re-check the actor's role.
--   • A published Kingdom Story (or a chapter/image/source of one) is not
--     deleted: unpublish it first (the Studio's existing live-story freeze).
--   • The hidden Kingdom Stories learning curriculum is never deleted (212).
--   • Restore never publishes: a story returns in the status it had (never
--     'published', since live stories cannot be deleted).
--   • Restore refuses (and changes nothing) if a row with the same id exists
--     again, a unique value is now taken, or a parent outside the snapshot is
--     gone (e.g. restore the module before its lesson).
--   • Restoring old learner work does not re-run side effects: the five
--     insert triggers that assign evaluators, grow the tree, notify or apply
--     outcomes are skipped inside a restore transaction (p2p.restoring).
--   • Purge (permanent deletion) is super_admin only and returns the storage
--     files the API may remove; files still referenced elsewhere are kept.
-- Additive only; existing rows are not touched.

-- ── The bin ─────────────────────────────────────────────────────────────
create table if not exists public.p2p_recycle_bin (
  id uuid primary key default gen_random_uuid(),
  content_type text not null,
  content_id uuid not null,
  title text not null,
  parent_label text,
  parent_type text,
  parent_id uuid,
  original_status text,
  status text not null default 'in_bin' check (status in ('in_bin', 'restored', 'purged')),
  snapshot jsonb,                     -- [{"t": table, "rows": [...]}] in capture order; null once purged
  relinks jsonb not null default '[]'::jsonb,   -- [{"t", "id", "vals": {col: value}}]
  counts jsonb not null default '{}'::jsonb,     -- {table: rows}
  storage_paths jsonb not null default '[]'::jsonb, -- [{"bucket", "path"}]
  deleted_by uuid references public.p2p_profiles(id) on delete set null,
  deleted_at timestamptz not null default now(),
  restored_by uuid references public.p2p_profiles(id) on delete set null,
  restored_at timestamptz,
  restore_warnings jsonb,
  purged_by uuid references public.p2p_profiles(id) on delete set null,
  purged_at timestamptz
);
create index if not exists idx_p2p_recycle_bin_status on public.p2p_recycle_bin (status, deleted_at desc);
create index if not exists idx_p2p_recycle_bin_content on public.p2p_recycle_bin (content_type, content_id);
alter table public.p2p_recycle_bin enable row level security;
revoke all on public.p2p_recycle_bin from public, anon, authenticated;
grant all on public.p2p_recycle_bin to service_role;

-- ── Supported types ─────────────────────────────────────────────────────
-- table, roles allowed to delete/restore, parent column + type (for labels).
create or replace function public.p2p_recycle_type(p_type text)
returns table (tbl text, roles text[], parent_col text, parent_type text)
language sql immutable set search_path = public, pg_temp
as $$
  select v.tbl, v.roles, v.parent_col, v.parent_type from (values
    ('curriculum',            'p2p_curriculums',             array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'parent_category_id', 'curriculum'),
    ('module',                'p2p_modules',                 array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'curriculum_id', 'curriculum'),
    ('lesson',                'p2p_lessons',                 array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'module_id', 'module'),
    ('lesson_block',          'p2p_lesson_blocks',           array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'lesson_id', 'lesson'),
    ('kingdom_story',         'p2p_kingdom_stories',         array['admin_content','super_admin'], 'category_id', 'kingdom_story_category'),
    ('kingdom_story_chapter', 'p2p_kingdom_story_chapters',  array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
    ('kingdom_story_media',   'p2p_kingdom_story_media',     array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
    ('kingdom_story_source',  'p2p_kingdom_story_sources',   array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
    ('kingdom_story_topic',   'p2p_kingdom_story_topics',    array['admin_content','super_admin'], 'category_id', 'kingdom_story_category'),
    ('prayer_topic',          'p2p_prayer_topics',           null::text[], 'parent_topic_id', 'prayer_topic'),
    ('prayer_path',           'p2p_prayer_paths',            null::text[], 'topic_id', 'prayer_topic'),
    ('prayer_path_step',      'p2p_prayer_path_steps',       null::text[], 'path_id', 'prayer_path'),
    ('mission_field',         'p2p_mission_fields',          null::text[], null, null),
    ('mission_story',         'p2p_mission_stories',         null::text[], 'mission_field_id', 'mission_field'),
    ('mission_prayer_point',  'p2p_mission_prayer_points',   null::text[], 'mission_story_id', 'mission_story')
  ) v(t, tbl, roles, parent_col, parent_type) where v.t = p_type
$$;
-- null roles = any admin role (the API's requireAdmin set), as those routes use today.
create or replace function public.p2p_recycle_is_admin_role(p_role text)
returns boolean language sql immutable set search_path = public, pg_temp
as $$ select p_role = any (array['peer_guide','church_leader','regional_admin','moderator','super_admin','admin_supervisor','admin_zone',
  'admin_national','admin_content','admin_translation','admin_moderation','admin_verification','admin_help','admin_username',
  'admin_finance','admin_marketing','admin_church']) $$;

create or replace function public.p2p_recycle_can(p_actor uuid, p_type text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_role text; v_roles text[];
begin
  select role into v_role from p2p_profiles where id = p_actor;
  if v_role is null then return false; end if;
  select roles into v_roles from p2p_recycle_type(p_type);
  if not found then return false; end if;
  if v_roles is null then return p2p_recycle_is_admin_role(v_role); end if;
  return v_role = any (v_roles);
end;
$$;

-- Files a snapshot row points at (bucket, path) — removed only on purge.
create or replace function public.p2p_recycle_files(p_table text, p_row jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp
as $$
  select case
    when p_table = 'p2p_kingdom_story_media' and coalesce(p_row->>'media_path', '') <> ''
      then jsonb_build_array(jsonb_build_object('bucket', 'kingdom-stories-media', 'path', p_row->>'media_path'))
    when p_table = 'p2p_mission_stories' and coalesce(p_row->>'media_path', '') <> ''
      then jsonb_build_array(jsonb_build_object('bucket', 'mission-media', 'path', p_row->>'media_path'))
    else '[]'::jsonb end
$$;

-- ── Capture: the row, everything depending on it, and links to clear ───
-- Walks every foreign key that references p_table. CASCADE / NO ACTION /
-- RESTRICT children are part of the item (deleting needs them gone, and
-- restoring needs them back); SET NULL / SET DEFAULT children are only
-- re-linked. Self-references and repeat visits are handled by skipping ids
-- already captured.
create or replace function public.p2p_recycle_collect(p_table text, p_ids uuid[], p_snap jsonb, p_relinks jsonb, p_depth int default 0)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_have uuid[];
  v_new uuid[];
  v_rows jsonb;
  v_fk record;
  v_child_ids uuid[];
  v_match text;
  v_rl jsonb;
  v_snap jsonb := p_snap;
  v_relinks jsonb := p_relinks;
  v_r jsonb;
begin
  if p_depth > 25 then raise exception 'recycle_too_deep' using errcode = 'R0001'; end if;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_have
    from jsonb_array_elements(v_snap) s, jsonb_array_elements(s->'rows') e where s->>'t' = p_table;
  v_new := array(select unnest(p_ids) except select unnest(v_have));
  if coalesce(array_length(v_new, 1), 0) = 0 then return jsonb_build_object('snap', v_snap, 'relinks', v_relinks); end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x where x.id = any ($1)', p_table) into v_rows using v_new;
  v_snap := v_snap || jsonb_build_array(jsonb_build_object('t', p_table, 'rows', v_rows));

  for v_fk in
    select ch.relname child, con.confdeltype del,
           array(select a.attname from unnest(con.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o)::text[] ccols,
           array(select a.attname from unnest(con.confkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o)::text[] pcols
      from pg_constraint con join pg_class ch on ch.oid = con.conrelid join pg_namespace ns on ns.oid = ch.relnamespace
     where con.contype = 'f' and con.confrelid = format('public.%I', p_table)::regclass and ns.nspname = 'public'
  loop
    v_match := format('(%s) in (select %s from public.%I p where p.id = any ($1))',
      (select string_agg(format('c.%I', c), ', ') from unnest(v_fk.ccols) c),
      (select string_agg(format('p.%I', c), ', ') from unnest(v_fk.pcols) c), p_table);
    if v_fk.del in ('c', 'a', 'r') then
      execute format('select coalesce(array_agg(c.id), ''{}'') from public.%I c where %s', v_fk.child, v_match) into v_child_ids using v_new;
      if coalesce(array_length(v_child_ids, 1), 0) > 0 then
        v_r := p2p_recycle_collect(v_fk.child, v_child_ids, v_snap, v_relinks, p_depth + 1);
        v_snap := v_r->'snap'; v_relinks := v_r->'relinks';
      end if;
    else
      execute format('select coalesce(jsonb_agg(jsonb_build_object(''t'', %L, ''id'', c.id, ''vals'', (select jsonb_object_agg(k, to_jsonb(c)->k) from unnest($2::text[]) k))), ''[]''::jsonb) from public.%I c where %s',
                     v_fk.child, v_fk.child, v_match) into v_rl using v_new, v_fk.ccols;
      v_relinks := v_relinks || v_rl;
    end if;
  end loop;
  return jsonb_build_object('snap', v_snap, 'relinks', v_relinks);
end;
$$;

-- Tables of a snapshot, parents before children (by the foreign keys between them).
create or replace function public.p2p_recycle_table_order(p_snap jsonb)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_tables text[] := array(select distinct s->>'t' from jsonb_array_elements(p_snap) s);
  v_done text[] := '{}';
  v_progress boolean;
  v_t text;
begin
  loop
    v_progress := false;
    foreach v_t in array v_tables loop
      continue when v_t = any (v_done);
      if not exists (
        select 1 from pg_constraint con join pg_class pa on pa.oid = con.confrelid
         where con.contype = 'f' and con.conrelid = format('public.%I', v_t)::regclass
           and pa.relname <> v_t and pa.relname = any (v_tables) and not (pa.relname = any (v_done))) then
        v_done := v_done || v_t; v_progress := true;
      end if;
    end loop;
    exit when not v_progress;
  end loop;
  -- A cycle between tables (none today): fall back to capture order for the rest.
  return v_done || array(select t from (select distinct on (s->>'t') s->>'t' t, o from jsonb_array_elements(p_snap) with ordinality x(s, o) order by s->>'t', o) y
                          where not (t = any (v_done)) order by o);
end;
$$;

-- ── Checks shared by preview and delete ────────────────────────────────
create or replace function public.p2p_recycle_block_reason(p_type text, p_id uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_cur uuid; v_story uuid;
begin
  -- The storybook's hidden curriculum (212), looked up only for Kingdom School types.
  if p_type in ('curriculum', 'module', 'lesson', 'lesson_block') then
    select id into v_cur from p2p_curriculums where type = 'kingdom_story' limit 1;
  end if;
  if p_type = 'kingdom_story' then
    if exists (select 1 from p2p_kingdom_stories where id = p_id and status = 'published') then return 'recycle_live_story'; end if;
  elsif p_type in ('kingdom_story_chapter', 'kingdom_story_media', 'kingdom_story_source') then
    execute format('select story_id from public.%I where id = $1', (select tbl from p2p_recycle_type(p_type))) into v_story using p_id;
    if exists (select 1 from p2p_kingdom_stories where id = v_story and status = 'published') then return 'recycle_live_story'; end if;
  elsif p_type = 'curriculum' then
    if exists (select 1 from p2p_curriculums where id = p_id and type = 'kingdom_story') then return 'recycle_system_content'; end if;
  elsif p_type = 'module' then
    if v_cur is not null and exists (select 1 from p2p_modules where id = p_id and curriculum_id = v_cur) then return 'recycle_system_content'; end if;
  elsif p_type = 'lesson' then
    if v_cur is not null and exists (select 1 from p2p_lessons l join p2p_modules m on m.id = l.module_id where l.id = p_id and m.curriculum_id = v_cur) then return 'recycle_system_content'; end if;
  elsif p_type = 'lesson_block' then
    if v_cur is not null and exists (select 1 from p2p_lesson_blocks b join p2p_lessons l on l.id = b.lesson_id join p2p_modules m on m.id = l.module_id
                                      where b.id = p_id and m.curriculum_id = v_cur) then return 'recycle_system_content'; end if;
  end if;
  return null;
end;
$$;

create or replace function public.p2p_recycle_title(p_type text, p_row jsonb)
returns text language sql immutable set search_path = public, pg_temp
as $$
  select coalesce(nullif(p_row->>'title', ''), nullif(p_row->>'caption', ''),
    case when p_type = 'prayer_path_step' then 'Step ' || (p_row->>'step_order') end,
    case when p_type = 'lesson_block' then initcap(replace(coalesce(p_row->>'block_type', 'content'), '_', ' ')) || ' block'
      || coalesce(': ' || left(nullif(coalesce(p_row->'content'->>'text', p_row->'content'->>'title', p_row->'content'->>'question'), ''), 60), '') end,
    case when p_type = 'kingdom_story_media' then p_row->>'media_path' end, 'Untitled')
$$;

-- Snapshot without changing anything (for the confirmation dialog).
create or replace function public.p2p_recycle_capture(p_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_tbl text; v_root jsonb; v_r jsonb; v_counts jsonb; v_files jsonb;
begin
  select tbl into v_tbl from p2p_recycle_type(p_type);
  if v_tbl is null then raise exception 'recycle_unknown_type' using errcode = 'R0001'; end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', v_tbl) into v_root using p_id;
  if v_root is null then raise exception 'recycle_not_found' using errcode = 'R0002'; end if;
  v_r := p2p_recycle_collect(v_tbl, array[p_id], '[]'::jsonb, '[]'::jsonb);
  -- Links from rows that are themselves in the snapshot come back with them.
  v_r := jsonb_set(v_r, '{relinks}', coalesce((select jsonb_agg(l) from jsonb_array_elements(v_r->'relinks') l
    where not exists (select 1 from jsonb_array_elements(v_r->'snap') s, jsonb_array_elements(s->'rows') e
                       where s->>'t' = l->>'t' and e->>'id' = l->>'id')), '[]'::jsonb));
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) into v_counts
    from (select s->>'t' t, sum(jsonb_array_length(s->'rows'))::int n from jsonb_array_elements(v_r->'snap') s group by 1) x;
  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_files
    from jsonb_array_elements(v_r->'snap') s, jsonb_array_elements(s->'rows') e, jsonb_array_elements(p2p_recycle_files(s->>'t', e)) f;
  return v_r || jsonb_build_object('root', v_root, 'table', v_tbl, 'counts', v_counts, 'files', v_files);
end;
$$;

create or replace function public.p2p_recycle_preview(p_actor uuid, p_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_c jsonb;
begin
  if not p2p_recycle_can(p_actor, p_type) then raise exception 'recycle_forbidden' using errcode = 'R0003'; end if;
  v_c := p2p_recycle_capture(p_type, p_id);
  return jsonb_build_object('title', p2p_recycle_title(p_type, v_c->'root'), 'counts', v_c->'counts',
    'links', jsonb_array_length(v_c->'relinks'), 'files', jsonb_array_length(v_c->'files'),
    'blocked', p2p_recycle_block_reason(p_type, p_id));
end;
$$;

-- ── Move to the Recycle Bin ─────────────────────────────────────────────
create or replace function public.p2p_recycle_delete(p_actor uuid, p_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_c jsonb; v_reason text; v_entry uuid; v_t text; v_ids uuid[]; v_parent uuid; v_parent_col text; v_parent_type text;
  v_parent_label text; v_parent_tbl text;
begin
  if not p2p_recycle_can(p_actor, p_type) then raise exception 'recycle_forbidden' using errcode = 'R0003'; end if;
  v_reason := p2p_recycle_block_reason(p_type, p_id);
  if v_reason is not null then raise exception '%', v_reason using errcode = 'R0004'; end if;
  v_c := p2p_recycle_capture(p_type, p_id);
  select parent_col, parent_type into v_parent_col, v_parent_type from p2p_recycle_type(p_type);
  if v_parent_col is not null then
    v_parent := nullif(v_c->'root'->>v_parent_col, '')::uuid;
    select tbl into v_parent_tbl from p2p_recycle_type(v_parent_type);
    if v_parent is not null and v_parent_tbl is null and v_parent_type = 'kingdom_story_category' then v_parent_tbl := 'p2p_kingdom_story_categories'; end if;
    if v_parent is not null and v_parent_tbl is not null then
      execute format('select coalesce(x.title, null) from public.%I x where x.id = $1', v_parent_tbl) into v_parent_label using v_parent;
    end if;
  end if;

  insert into p2p_recycle_bin (content_type, content_id, title, parent_label, parent_type, parent_id, original_status, snapshot, relinks, counts, storage_paths, deleted_by)
  values (p_type, p_id, p2p_recycle_title(p_type, v_c->'root'), v_parent_label, v_parent_type, v_parent, v_c->'root'->>'status',
          v_c->'snap', v_c->'relinks', v_c->'counts', v_c->'files', p_actor)
  returning id into v_entry;

  -- Attribute the Studio's story deletion audit to this editor.
  perform set_config('p2p.actor_id', p_actor::text, true);
  -- role is the user_role enum in production: compare as text, or 'direct' would be cast to the enum and fail.
  perform set_config('p2p.actor_role', coalesce((select role::text from p2p_profiles where id = p_actor), 'direct'), true);
  perform set_config('p2p.path', 'recycle_bin', true);
  -- Children first; cleared links (SET NULL) were recorded above.
  foreach v_t in array (select array_agg(t order by o desc) from unnest(p2p_recycle_table_order(v_c->'snap')) with ordinality u(t, o)) loop
    select array_agg((e->>'id')::uuid) into v_ids from jsonb_array_elements(v_c->'snap') s, jsonb_array_elements(s->'rows') e where s->>'t' = v_t;
    execute format('delete from public.%I where id = any ($1)', v_t) using v_ids;
  end loop;
  return jsonb_build_object('entryId', v_entry, 'counts', v_c->'counts');
end;
$$;

-- ── Restore ─────────────────────────────────────────────────────────────
create or replace function public.p2p_recycle_restore(p_actor uuid, p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_e p2p_recycle_bin; v_t text; v_rows jsonb; v_cols text; v_ids uuid[]; v_n int;
  v_warn jsonb := '[]'::jsonb; v_rl jsonb; v_set text; v_where text; v_snap jsonb; v_max int; v_constraint text;
  v_fk record; v_rows2 jsonb;
begin
  select * into v_e from p2p_recycle_bin where id = p_entry for update;
  if not found then raise exception 'recycle_not_found' using errcode = 'R0002'; end if;
  if not p2p_recycle_can(p_actor, v_e.content_type) then raise exception 'recycle_forbidden' using errcode = 'R0003'; end if;
  if v_e.status <> 'in_bin' then raise exception 'recycle_not_in_bin' using errcode = 'R0005', detail = v_e.status; end if;
  v_snap := v_e.snapshot;

  -- A restored chapter / path step whose position was taken meanwhile goes at the end.
  if v_e.content_type = 'kingdom_story_chapter' then
    select coalesce(max(chapter_number), 0) into v_max from p2p_kingdom_story_chapters where story_id = v_e.parent_id;
    if exists (select 1 from p2p_kingdom_story_chapters c, jsonb_array_elements(v_snap) s, jsonb_array_elements(s->'rows') r
                where s->>'t' = 'p2p_kingdom_story_chapters' and c.story_id = (r->>'story_id')::uuid and c.chapter_number = (r->>'chapter_number')::int) then
      v_snap := (select jsonb_agg(case when s->>'t' = 'p2p_kingdom_story_chapters'
                   then jsonb_set(s, '{rows}', (select jsonb_agg(jsonb_set(r, '{chapter_number}', to_jsonb(v_max + 1))) from jsonb_array_elements(s->'rows') r))
                   else s end order by o) from jsonb_array_elements(v_snap) with ordinality x(s, o));
      v_warn := v_warn || jsonb_build_array(format('Restored as chapter %s (its old position is used by another chapter now).', v_max + 1));
    end if;
  elsif v_e.content_type = 'prayer_path_step' then
    select coalesce(max(step_order), 0) into v_max from p2p_prayer_path_steps where path_id = v_e.parent_id;
    if exists (select 1 from p2p_prayer_path_steps c, jsonb_array_elements(v_snap) s, jsonb_array_elements(s->'rows') r
                where s->>'t' = 'p2p_prayer_path_steps' and c.path_id = (r->>'path_id')::uuid and c.step_order = (r->>'step_order')::int) then
      v_snap := (select jsonb_agg(case when s->>'t' = 'p2p_prayer_path_steps'
                   then jsonb_set(s, '{rows}', (select jsonb_agg(jsonb_set(r, '{step_order}', to_jsonb(v_max + 1))) from jsonb_array_elements(s->'rows') r))
                   else s end order by o) from jsonb_array_elements(v_snap) with ordinality x(s, o));
      v_warn := v_warn || jsonb_build_array(format('Restored as step %s (its old position is used by another step now).', v_max + 1));
    end if;
  end if;

  -- Old learner work comes back without re-running its side effects.
  perform set_config('p2p.restoring', 'on', true);
  foreach v_t in array p2p_recycle_table_order(v_snap) loop
    select jsonb_agg(e order by o, eo) into v_rows from jsonb_array_elements(v_snap) with ordinality x(s, o), jsonb_array_elements(s->'rows') with ordinality y(e, eo) where s->>'t' = v_t;
    select array_agg((e->>'id')::uuid) into v_ids from jsonb_array_elements(v_rows) e;
    execute format('select count(*) from public.%I where id = any ($1)', v_t) into v_n using v_ids;
    if v_n > 0 then raise exception 'recycle_conflict' using errcode = 'R0006', detail = v_t; end if;
    -- An optional link (ON DELETE SET NULL) to something that is gone now is
    -- cleared with a warning instead of blocking the restore.
    for v_fk in
      select a.attname::text col, pa.oid::regclass::text ptbl, pc.attname::text pcol
        from pg_constraint con join pg_class pa on pa.oid = con.confrelid
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
        join pg_attribute pc on pc.attrelid = con.confrelid and pc.attnum = con.confkey[1]
       where con.contype = 'f' and con.conrelid = format('public.%I', v_t)::regclass and con.confdeltype in ('n', 'd') and array_length(con.conkey, 1) = 1
    loop
      execute format('select jsonb_agg(case when r->>%L is not null and not exists (select 1 from %s p where p.%I::text = r->>%L) then jsonb_set(r, %L, ''null''::jsonb) else r end order by o) from jsonb_array_elements($1) with ordinality x(r, o)',
                     v_fk.col, v_fk.ptbl, v_fk.pcol, v_fk.col, array[v_fk.col]) into v_rows2 using v_rows;
      if v_rows2 is distinct from v_rows then
        v_warn := v_warn || jsonb_build_array(format('A link from %s to %s was cleared because that %s no longer exists.',
          replace(v_t, 'p2p_', ''), replace(v_fk.ptbl, 'p2p_', ''), replace(v_fk.ptbl, 'p2p_', '')));
        v_rows := v_rows2;
      end if;
    end loop;
    -- Columns present in the snapshot AND still in the table (not generated).
    select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into v_cols
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_t and c.is_generated = 'NEVER' and coalesce(c.identity_generation, '') <> 'ALWAYS'
       and v_rows->0 ? c.column_name;
    begin
      execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1)', v_t, v_cols, v_cols, v_t) using v_rows;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception 'recycle_conflict' using errcode = 'R0006', detail = v_t || ':' || coalesce(v_constraint, '');
      when foreign_key_violation then
        get stacked diagnostics v_constraint = constraint_name;
        raise exception 'recycle_missing_parent' using errcode = 'R0007', detail = v_t || ':' || coalesce(v_constraint, '');
    end;
  end loop;

  -- Re-link rows whose link the deletion cleared — only where still cleared.
  for v_rl in select * from jsonb_array_elements(v_e.relinks) loop
    select string_agg(format('%I = (%L::jsonb ->> %L)::%s', k, v_rl->'vals', k, format_type(a.atttypid, a.atttypmod)), ', '),
           string_agg(format('%I is null', k), ' and ')
      into v_set, v_where
      from jsonb_object_keys(v_rl->'vals') k join pg_attribute a on a.attrelid = format('public.%I', v_rl->>'t')::regclass and a.attname = k;
    begin
      execute format('update public.%I set %s where id = $1 and %s', v_rl->>'t', v_set, v_where) using (v_rl->>'id')::uuid;
    exception when others then
      v_warn := v_warn || jsonb_build_array(format('A link from %s could not be restored (%s).', replace(v_rl->>'t', 'p2p_', ''), sqlerrm));
    end;
  end loop;

  update p2p_recycle_bin set status = 'restored', restored_by = p_actor, restored_at = now(), restore_warnings = v_warn where id = p_entry;
  return jsonb_build_object('restored', true, 'contentType', v_e.content_type, 'contentId', v_e.content_id, 'warnings', v_warn);
end;
$$;

-- ── Permanent deletion ──────────────────────────────────────────────────
-- Drops the snapshot; returns the files no live row and no other bin entry
-- still uses, for the API to remove from storage.
create or replace function public.p2p_recycle_purge(p_actor uuid, p_entry uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_e p2p_recycle_bin; v_free jsonb;
begin
  select * into v_e from p2p_recycle_bin where id = p_entry for update;
  if not found then raise exception 'recycle_not_found' using errcode = 'R0002'; end if;
  if (select role from p2p_profiles where id = p_actor) is distinct from 'super_admin' then
    raise exception 'recycle_forbidden' using errcode = 'R0003';
  end if;
  if v_e.status <> 'in_bin' then raise exception 'recycle_not_in_bin' using errcode = 'R0005', detail = v_e.status; end if;
  select coalesce(jsonb_agg(f), '[]'::jsonb) into v_free from jsonb_array_elements(v_e.storage_paths) f
   where not (f->>'bucket' = 'kingdom-stories-media' and exists (select 1 from p2p_kingdom_story_media m where m.media_path = f->>'path'))
     and not (f->>'bucket' = 'mission-media' and exists (select 1 from p2p_mission_stories m where m.media_path = f->>'path'))
     and not exists (select 1 from p2p_recycle_bin b where b.id <> p_entry and b.status = 'in_bin' and b.storage_paths @> jsonb_build_array(f));
  update p2p_recycle_bin set status = 'purged', snapshot = null, relinks = '[]'::jsonb, purged_by = p_actor, purged_at = now() where id = p_entry;
  return jsonb_build_object('purged', true, 'files', v_free, 'keptFiles', jsonb_array_length(v_e.storage_paths) - jsonb_array_length(v_free));
end;
$$;

-- Only the API (service role) calls these; each re-checks the actor's role.
do $$
declare f text;
begin
  foreach f in array array['p2p_recycle_type(text)', 'p2p_recycle_is_admin_role(text)', 'p2p_recycle_can(uuid, text)', 'p2p_recycle_files(text, jsonb)',
    'p2p_recycle_collect(text, uuid[], jsonb, jsonb, integer)', 'p2p_recycle_table_order(jsonb)', 'p2p_recycle_block_reason(text, uuid)',
    'p2p_recycle_title(text, jsonb)', 'p2p_recycle_capture(text, uuid)', 'p2p_recycle_preview(uuid, text, uuid)',
    'p2p_recycle_delete(uuid, text, uuid)', 'p2p_recycle_restore(uuid, uuid)', 'p2p_recycle_purge(uuid, uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ── Kingdom School deletes go through the API (and so the bin) ──────────
-- The admin app used to delete curricula/modules/lessons directly with the
-- signed-in client (hard delete, cascading learners' work). Current builds
-- call the API instead; direct deletes are refused at the database so no
-- client — including older builds — can bypass the Recycle Bin.
do $$
declare t text;
begin
  foreach t in array array['p2p_curriculums', 'p2p_modules', 'p2p_lessons'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke delete on public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;

-- ── Fix: 212's delete guard broke every module/lesson delete ────────────
-- One expression read old.curriculum_id AND old.module_id, so it failed with
-- "record old has no field ..." on whichever table lacks the column: no
-- Kingdom School module or lesson could be deleted at all. Same rule, checked
-- per table.
create or replace function public.p2p_kingdom_story_learning_delete_guard()
returns trigger language plpgsql set search_path = public, pg_temp
as $$
declare v_cur uuid := p2p_kingdom_story_curriculum_id(); v_hit boolean := false;
begin
  if v_cur is null then return old; end if;
  if tg_table_name = 'p2p_modules' then
    v_hit := old.curriculum_id = v_cur;
  elsif tg_table_name = 'p2p_lessons' then
    v_hit := exists (select 1 from p2p_modules m where m.id = old.module_id and m.curriculum_id = v_cur);
  end if;
  if v_hit then
    raise exception 'kingdom_story_learning_kept' using errcode = 'P0001',
      hint = 'Kingdom Stories learning rows hold learners'' work; they are archived, not deleted.';
  end if;
  return old;
end;
$$;

-- ── Restoring learner work must not re-run its side effects ─────────────
-- Same triggers, same functions, same events — plus a WHEN that skips them
-- only inside a restore transaction (set by p2p_recycle_restore above).
do $$
begin
  if to_regclass('public.p2p_submissions') is not null then
    if exists (select 1 from pg_trigger where tgname = 'p2p_tree_growth_on_submission_trg' and tgrelid = 'public.p2p_submissions'::regclass) then
      drop trigger p2p_tree_growth_on_submission_trg on public.p2p_submissions;
      create trigger p2p_tree_growth_on_submission_trg after insert on public.p2p_submissions for each row
        when (coalesce(current_setting('p2p.restoring', true), '') <> 'on') execute function public.p2p_tree_growth_on_submission();
    end if;
    if exists (select 1 from pg_trigger where tgname = 'trg_assign_evaluator_on_submission' and tgrelid = 'public.p2p_submissions'::regclass) then
      drop trigger trg_assign_evaluator_on_submission on public.p2p_submissions;
      create trigger trg_assign_evaluator_on_submission after insert on public.p2p_submissions for each row
        when (coalesce(current_setting('p2p.restoring', true), '') <> 'on') execute function public.p2p_assign_evaluator_on_submission();
    end if;
  end if;
  if to_regclass('public.p2p_lesson_evaluations') is not null then
    if exists (select 1 from pg_trigger where tgname = 'trg_apply_evaluation_outcome' and tgrelid = 'public.p2p_lesson_evaluations'::regclass) then
      drop trigger trg_apply_evaluation_outcome on public.p2p_lesson_evaluations;
      create trigger trg_apply_evaluation_outcome after insert or update of status on public.p2p_lesson_evaluations for each row
        when (coalesce(current_setting('p2p.restoring', true), '') <> 'on') execute function public.p2p_apply_evaluation_outcome();
    end if;
    if exists (select 1 from pg_trigger where tgname = 'trg_create_encouragement_confirmation' and tgrelid = 'public.p2p_lesson_evaluations'::regclass) then
      drop trigger trg_create_encouragement_confirmation on public.p2p_lesson_evaluations;
      create trigger trg_create_encouragement_confirmation after insert or update of status, feedback on public.p2p_lesson_evaluations for each row
        when (coalesce(current_setting('p2p.restoring', true), '') <> 'on') execute function public.p2p_create_encouragement_confirmation();
    end if;
    if exists (select 1 from pg_trigger where tgname = 'trg_notify_evaluator_on_insert' and tgrelid = 'public.p2p_lesson_evaluations'::regclass) then
      drop trigger trg_notify_evaluator_on_insert on public.p2p_lesson_evaluations;
      create trigger trg_notify_evaluator_on_insert after insert on public.p2p_lesson_evaluations for each row
        when (coalesce(current_setting('p2p.restoring', true), '') <> 'on') execute function public.p2p_notify_evaluator();
    end if;
  end if;
end $$;
