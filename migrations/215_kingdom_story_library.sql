-- 215: Kingdom Stories — stable topic numbers, personal library, editorial
-- collections and image roles. Additive only; no existing row is changed.
--
--   • topic_number: a stable, human-readable number per story ("Topic 012"),
--     unique within its category. It never replaces the story's id and is not
--     part of the Publishing Studio fingerprint, so setting it never makes an
--     approval stale. Numbers are assigned by a separate, reviewed data step.
--   • p2p_kingdom_story_saves: a reader's Favourites and Saved for Later
--     (references to stories — no story content is copied).
--   • p2p_kingdom_story_views: when a reader last opened a story and which
--     chapter (Recently viewed / resume). Completion is NOT stored here: it
--     stays the storybook's real learning progress (migration 212).
--     Both tables are private to their owner (RLS) and have an id, so the
--     Admin Recycle Bin (214) keeps and restores them with a binned story.
--   • p2p_kingdom_story_collections (+ items): editorial collections such as
--     "Start Here", referencing stories; managed by Kingdom Stories editors,
--     recoverable through the Recycle Bin.
--   • p2p_kingdom_story_media.role: where an image is used (cover, hero,
--     overview, chapter, thumbnail, gallery). Null keeps today's meaning
--     (is_cover / chapter_id). Like is_featured, a role is placement, not
--     content: it may change on a live story; everything else stays frozen.

-- ── Topic numbers ──────────────────────────────────────────────────────
alter table public.p2p_kingdom_stories add column if not exists topic_number smallint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_stories_topic_number_range') then
    alter table public.p2p_kingdom_stories add constraint p2p_kingdom_stories_topic_number_range check (topic_number is null or topic_number between 1 and 9999);
  end if;
end $$;
create unique index if not exists uq_p2p_kingdom_stories_topic_number
  on public.p2p_kingdom_stories (category_id, topic_number) where topic_number is not null;

-- ── Personal library ───────────────────────────────────────────────────
create table if not exists public.p2p_kingdom_story_saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  story_id uuid not null references public.p2p_kingdom_stories(id) on delete cascade,
  kind text not null check (kind in ('favourite', 'later')),
  created_at timestamptz not null default now(),
  unique (user_id, story_id, kind)
);
create index if not exists idx_p2p_kingdom_story_saves_user on public.p2p_kingdom_story_saves (user_id, kind, created_at desc);
create index if not exists idx_p2p_kingdom_story_saves_story on public.p2p_kingdom_story_saves (story_id);

create table if not exists public.p2p_kingdom_story_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  story_id uuid not null references public.p2p_kingdom_stories(id) on delete cascade,
  last_chapter_id uuid references public.p2p_kingdom_story_chapters(id) on delete set null,
  first_opened_at timestamptz not null default now(),
  last_opened_at timestamptz not null default now(),
  open_count integer not null default 1 check (open_count >= 1),
  unique (user_id, story_id)
);
create index if not exists idx_p2p_kingdom_story_views_user on public.p2p_kingdom_story_views (user_id, last_opened_at desc);
create index if not exists idx_p2p_kingdom_story_views_story on public.p2p_kingdom_story_views (story_id);

alter table public.p2p_kingdom_story_saves enable row level security;
alter table public.p2p_kingdom_story_views enable row level security;
revoke all on public.p2p_kingdom_story_saves, public.p2p_kingdom_story_views from anon;
grant select, insert, delete on public.p2p_kingdom_story_saves to authenticated;
grant select on public.p2p_kingdom_story_views to authenticated;
grant all on public.p2p_kingdom_story_saves, public.p2p_kingdom_story_views to service_role;
drop policy if exists "Own story saves" on public.p2p_kingdom_story_saves;
create policy "Own story saves" on public.p2p_kingdom_story_saves for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Own story views" on public.p2p_kingdom_story_views;
create policy "Own story views" on public.p2p_kingdom_story_views for select to authenticated using (user_id = auth.uid());

-- ── Editorial collections ──────────────────────────────────────────────
create table if not exists public.p2p_kingdom_story_collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title text not null check (char_length(title) between 1 and 120),
  description text check (description is null or char_length(description) <= 600),
  display_order integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_by uuid references public.p2p_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.p2p_kingdom_story_collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null references public.p2p_kingdom_story_collections(id) on delete cascade,
  story_id uuid not null references public.p2p_kingdom_stories(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (collection_id, story_id)
);
create index if not exists idx_p2p_ks_collection_items_collection on public.p2p_kingdom_story_collection_items (collection_id, display_order);
create index if not exists idx_p2p_ks_collection_items_story on public.p2p_kingdom_story_collection_items (story_id);
alter table public.p2p_kingdom_story_collections enable row level security;
alter table public.p2p_kingdom_story_collection_items enable row level security;
revoke all on public.p2p_kingdom_story_collections, public.p2p_kingdom_story_collection_items from anon;
grant select on public.p2p_kingdom_story_collections, public.p2p_kingdom_story_collection_items to authenticated;
grant all on public.p2p_kingdom_story_collections, public.p2p_kingdom_story_collection_items to service_role;
drop policy if exists "Published collections, editors all" on public.p2p_kingdom_story_collections;
create policy "Published collections, editors all" on public.p2p_kingdom_story_collections for select to authenticated
  using (status = 'published' or public.p2p_is_kingdom_stories_editor());
drop policy if exists "Collection items with their collection" on public.p2p_kingdom_story_collection_items;
create policy "Collection items with their collection" on public.p2p_kingdom_story_collection_items for select to authenticated
  using (exists (select 1 from public.p2p_kingdom_story_collections c where c.id = collection_id and (c.status = 'published' or public.p2p_is_kingdom_stories_editor())));

-- ── Image roles ────────────────────────────────────────────────────────
alter table public.p2p_kingdom_story_media add column if not exists role text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'p2p_kingdom_story_media_role_check') then
    alter table public.p2p_kingdom_story_media add constraint p2p_kingdom_story_media_role_check
      check (role is null or role in ('cover', 'hero', 'overview', 'chapter', 'thumbnail', 'gallery'));
  end if;
end $$;
-- One hero per story (the discovery homepage shows one).
create unique index if not exists uq_p2p_kingdom_story_media_hero on public.p2p_kingdom_story_media (story_id) where role = 'hero';

-- The live-story freeze (188) stays exactly as it was, except that an update
-- changing ONLY an image's role is placement, not content, and is allowed.
create or replace function public.p2p_kingdom_story_child_freeze()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and tg_table_name = 'p2p_kingdom_story_media'
     and (to_jsonb(new) - 'role') = (to_jsonb(old) - 'role') then
    return new;
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and exists (select 1 from p2p_kingdom_stories where id = old.story_id and status = 'published'))
     or (tg_op in ('INSERT', 'UPDATE') and exists (select 1 from p2p_kingdom_stories where id = new.story_id and status = 'published')) then
    raise exception 'studio_live_edit_blocked' using errcode = 'S0423',
      hint = 'Unpublish the story, edit it, and get it approved again in the Publishing Studio.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.p2p_kingdom_story_child_freeze() from public, anon, authenticated, service_role;

-- ── Recycle Bin: collections are recoverable admin content ─────────────
-- Same as 214 plus 'kingdom_story_collection' (only applied once 214 exists).
do $$
begin
  if to_regprocedure('public.p2p_recycle_type(text)') is not null then
    execute $f$
      create or replace function public.p2p_recycle_type(p_type text)
      returns table (tbl text, roles text[], parent_col text, parent_type text)
      language sql immutable set search_path = public, pg_temp
      as $q$
        select v.tbl, v.roles, v.parent_col, v.parent_type from (values
          ('curriculum',               'p2p_curriculums',                array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'parent_category_id', 'curriculum'),
          ('module',                   'p2p_modules',                    array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'curriculum_id', 'curriculum'),
          ('lesson',                   'p2p_lessons',                    array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'module_id', 'module'),
          ('lesson_block',             'p2p_lesson_blocks',              array['peer_guide','church_leader','regional_admin','admin_content','super_admin'], 'lesson_id', 'lesson'),
          ('kingdom_story',            'p2p_kingdom_stories',            array['admin_content','super_admin'], 'category_id', 'kingdom_story_category'),
          ('kingdom_story_chapter',    'p2p_kingdom_story_chapters',     array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
          ('kingdom_story_media',      'p2p_kingdom_story_media',        array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
          ('kingdom_story_source',     'p2p_kingdom_story_sources',      array['admin_content','super_admin'], 'story_id', 'kingdom_story'),
          ('kingdom_story_topic',      'p2p_kingdom_story_topics',       array['admin_content','super_admin'], 'category_id', 'kingdom_story_category'),
          ('kingdom_story_collection', 'p2p_kingdom_story_collections',  array['admin_content','super_admin'], null, null),
          ('prayer_topic',             'p2p_prayer_topics',              null::text[], 'parent_topic_id', 'prayer_topic'),
          ('prayer_path',              'p2p_prayer_paths',               null::text[], 'topic_id', 'prayer_topic'),
          ('prayer_path_step',         'p2p_prayer_path_steps',          null::text[], 'path_id', 'prayer_path'),
          ('mission_field',            'p2p_mission_fields',             null::text[], null, null),
          ('mission_story',            'p2p_mission_stories',            null::text[], 'mission_field_id', 'mission_field'),
          ('mission_prayer_point',     'p2p_mission_prayer_points',      null::text[], 'mission_story_id', 'mission_story')
        ) v(t, tbl, roles, parent_col, parent_type) where v.t = p_type
      $q$;
    $f$;
    revoke all on function public.p2p_recycle_type(text) from public, anon, authenticated;
    grant execute on function public.p2p_recycle_type(text) to service_role;
  end if;
end $$;
