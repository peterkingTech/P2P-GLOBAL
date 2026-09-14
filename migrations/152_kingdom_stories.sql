-- 152: Kingdom Stories — P2P-curated editorial content (Christian history,
-- revival, missions, persecution, discipleship movements, the global
-- Church, present-day Church stories). Genuinely NEW domain — unlike
-- Kingdom Wins/P2P Impact (150/151, peer-authored testimony), this is
-- editorial content: only authorized editors (admin_content, super_admin)
-- may create/publish; ordinary peers only read. There is no official
-- account, creator profile, or follower system — the content is the
-- product, per this feature's own non-negotiable product definition.
--
-- FOUR NEW TABLES, all additive:
--   p2p_kingdom_story_categories — admin-curated taxonomy (lookup table,
--     not a CHECK enum, per product decision — needs its own
--     display_order/description/status the way p2p_prayer_topics does).
--   p2p_kingdom_stories           — the story/content record itself.
--   p2p_kingdom_story_media       — ORDERED, MULTIPLE media items per
--     story (images and/or videos, a designated cover, captions) — a
--     deliberate departure from every other content table in this
--     codebase (Mission Stories/Kingdom Wins/Testimonies all use a single
--     media_type+media_path pair). Kingdom Stories needs real multi-media
--     storytelling, so it gets its own new, separate architecture —
--     Missions' and Kingdom Wins' existing single-media tables/buckets
--     are NOT touched or migrated to this shape.
--   p2p_kingdom_story_sources     — editorial sources/further-reading,
--     for historical credibility. No precedent existed anywhere in this
--     schema; kept intentionally minimal.
--
-- WRITE AUTHORIZATION: explicitly NOT author_id/editor_id-based (unlike
-- every peer-authored domain in this codebase). A new, narrower helper
-- function — p2p_is_kingdom_stories_editor() — gates every write, mirroring
-- the existing p2p_is_super_admin() pattern (087_narrow_admin_data_access)
-- of a purpose-built narrow check layered alongside the broad, pre-existing
-- p2p_is_admin() (which would incorrectly admit all 17 non-student roles,
-- including e.g. admin_marketing/admin_help, to editorial write access).
--
-- ATTRIBUTION: editor_id is nullable with ON DELETE SET NULL from the
-- start — the exact fix migration 151 had to retrofit onto Kingdom Wins
-- after the fact (which itself followed the Missions cascade-delete bug)
-- is built in here from day one. A story is never lost because the admin
-- who wrote it later loses their account.
--
-- GLOBAL VISIBILITY: published stories are visible to every authenticated
-- P2P user — no per-story private/audience option exists, matching the
-- same non-negotiable principle already enforced for Kingdom Wins/P2P
-- Impact. Draft/review content is never peer-visible.
--
-- NO FAKE DATA: only controlled category metadata is seeded below (the
-- product-approved 13-item taxonomy). Zero story rows, zero source rows,
-- zero media rows are created by this migration.

-- ── Narrow editorial-write helper (mirrors p2p_is_super_admin(), 087) ──────
create or replace function p2p_is_kingdom_stories_editor()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from p2p_profiles
    where id = auth.uid() and role in ('admin_content', 'super_admin')
  );
$$;

-- ── Categories: admin-curated taxonomy, not a CHECK enum ───────────────────
create table if not exists p2p_kingdom_story_categories (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  title          text not null,
  description    text,
  display_order  integer not null default 0,
  status         text not null default 'published' check (status in ('draft', 'published', 'archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ── The story record ────────────────────────────────────────────────────────
create table if not exists p2p_kingdom_stories (
  id                       uuid primary key default gen_random_uuid(),

  title                    text not null,
  subtitle                 text,
  category_id              uuid not null references p2p_kingdom_story_categories(id) on delete restrict,
  -- Kept as an optional classification, not a mandatory template: it drives
  -- the admin editor's adaptive form and the peer story-card icon/label
  -- (per this feature's own Step 3 instruction that "the editor experience
  -- should adapt to the story type"), but every other field below works
  -- identically regardless of content_type — so it stays nullable rather
  -- than forcing every story into one of eight rigid shapes.
  content_type             text check (content_type in (
    'historical_story', 'person', 'movement', 'event', 'place',
    'present_day_story', 'documentary', 'scripture_story'
  )),
  body                     text not null,

  -- Optional structured context — none required, per "do not force every
  -- story into the same template."
  historical_period        text,
  start_year               integer,
  end_year                 integer,
  location                 text,
  people                   text,
  learning_section         text,
  reflection               text,

  -- Explicit, named cross-feature references — continuing this codebase's
  -- established no-polymorphic-references convention. All optional; a
  -- story is never forced to connect anywhere. Pray the Word is reached
  -- via scripture_reference_id (no separate FK needed — it's the same
  -- underlying reference the existing Pray the Word pathway already reads).
  scripture_reference_id   uuid references p2p_scripture_references(id) on delete set null,
  related_mission_field_id uuid references p2p_mission_fields(id) on delete set null,
  related_mission_story_id uuid references p2p_mission_stories(id) on delete set null,
  related_curriculum_id    uuid references p2p_curriculums(id) on delete set null,
  related_kingdom_win_id   uuid references p2p_kingdom_wins(id) on delete set null,
  related_story_id         uuid references p2p_kingdom_stories(id) on delete set null,

  is_featured              boolean not null default false,

  -- DRAFT → REVIEW → PUBLISHED → ARCHIVED, exactly as specified. Distinct
  -- from Mission Stories' 5-state lifecycle (no 'removed' — Kingdom
  -- Stories has no reactive-report/moderation-removal flow in this phase;
  -- an editor archives instead).
  status                   text not null default 'draft' check (status in ('draft', 'review', 'published', 'archived')),

  -- Nullable + ON DELETE SET NULL from day one (see header). Never
  -- author_id/ownership-based authorization — see the RLS policies below,
  -- which gate on p2p_is_kingdom_stories_editor(), not on this column.
  editor_id                uuid references auth.users(id) on delete set null,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  published_at             timestamptz,
  archived_at              timestamptz,

  check (related_story_id is null or related_story_id <> id),
  check (end_year is null or start_year is null or end_year >= start_year)
);

create index if not exists idx_p2p_kingdom_stories_feed on p2p_kingdom_stories(status, published_at desc) where status = 'published';
create index if not exists idx_p2p_kingdom_stories_category on p2p_kingdom_stories(category_id) where status = 'published';
create index if not exists idx_p2p_kingdom_stories_featured on p2p_kingdom_stories(is_featured) where status = 'published' and is_featured = true;
create index if not exists idx_p2p_kingdom_stories_editor on p2p_kingdom_stories(editor_id, updated_at desc);

-- ── Media: ORDERED, MULTIPLE items per story — new architecture ────────────
-- Deliberately separate from Mission Stories'/Kingdom Wins' single
-- media_type+media_path column pair, which are NOT modified by this
-- migration. A story's media rows are owned by the story itself (not by a
-- user account), so cascading on story deletion is correct here — this is
-- NOT the author-account-deletion cascade class of bug fixed in 151.
create table if not exists p2p_kingdom_story_media (
  id               uuid primary key default gen_random_uuid(),
  story_id         uuid not null references p2p_kingdom_stories(id) on delete cascade,
  media_type       text not null check (media_type in ('image', 'video')),
  media_path       text not null,
  caption          text,
  display_order    integer not null default 0,
  is_cover         boolean not null default false,
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  created_at       timestamptz not null default now()
);

create index if not exists idx_p2p_kingdom_story_media_story on p2p_kingdom_story_media(story_id, display_order);
-- At most one designated cover item per story.
create unique index if not exists idx_p2p_kingdom_story_media_one_cover on p2p_kingdom_story_media(story_id) where is_cover;

-- ── Sources: minimal, for editorial credibility ────────────────────────────
create table if not exists p2p_kingdom_story_sources (
  id             uuid primary key default gen_random_uuid(),
  story_id       uuid not null references p2p_kingdom_stories(id) on delete cascade,
  title          text not null,
  publisher      text,
  url            text,
  citation       text,
  source_type    text check (source_type in ('book', 'article', 'documentary', 'primary_source', 'oral_history', 'website', 'other')),
  display_order  integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_p2p_kingdom_story_sources_story on p2p_kingdom_story_sources(story_id, display_order);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table p2p_kingdom_story_categories enable row level security;
alter table p2p_kingdom_stories enable row level security;
alter table p2p_kingdom_story_media enable row level security;
alter table p2p_kingdom_story_sources enable row level security;

drop policy if exists "Published kingdom story categories are public, editors see all" on p2p_kingdom_story_categories;
create policy "Published kingdom story categories are public, editors see all" on p2p_kingdom_story_categories
  for select using (status = 'published' or p2p_is_kingdom_stories_editor());
drop policy if exists "Editors write kingdom story categories" on p2p_kingdom_story_categories;
create policy "Editors write kingdom story categories" on p2p_kingdom_story_categories
  for insert with check (p2p_is_kingdom_stories_editor());
drop policy if exists "Editors update kingdom story categories" on p2p_kingdom_story_categories;
create policy "Editors update kingdom story categories" on p2p_kingdom_story_categories
  for update using (p2p_is_kingdom_stories_editor()) with check (p2p_is_kingdom_stories_editor());
drop policy if exists "Editors delete kingdom story categories" on p2p_kingdom_story_categories;
create policy "Editors delete kingdom story categories" on p2p_kingdom_story_categories
  for delete using (p2p_is_kingdom_stories_editor());

-- Published stories: any authenticated P2P user (global, per §9 — no
-- per-story private/audience option). Draft/review: editors only, never
-- gated by editor_id — any authorized editor may see/manage any story.
drop policy if exists "Published kingdom stories are public, editors see all" on p2p_kingdom_stories;
create policy "Published kingdom stories are public, editors see all" on p2p_kingdom_stories
  for select using (status = 'published' or p2p_is_kingdom_stories_editor());
drop policy if exists "Editors create kingdom stories" on p2p_kingdom_stories;
create policy "Editors create kingdom stories" on p2p_kingdom_stories
  for insert with check (p2p_is_kingdom_stories_editor());
drop policy if exists "Editors update kingdom stories" on p2p_kingdom_stories;
create policy "Editors update kingdom stories" on p2p_kingdom_stories
  for update using (p2p_is_kingdom_stories_editor()) with check (p2p_is_kingdom_stories_editor());
drop policy if exists "Editors delete kingdom stories" on p2p_kingdom_stories;
create policy "Editors delete kingdom stories" on p2p_kingdom_stories
  for delete using (p2p_is_kingdom_stories_editor());

drop policy if exists "Kingdom story media visible with its story" on p2p_kingdom_story_media;
create policy "Kingdom story media visible with its story" on p2p_kingdom_story_media
  for select using (
    exists (select 1 from p2p_kingdom_stories s where s.id = story_id and (s.status = 'published' or p2p_is_kingdom_stories_editor()))
  );
drop policy if exists "Editors manage kingdom story media" on p2p_kingdom_story_media;
create policy "Editors manage kingdom story media" on p2p_kingdom_story_media
  for all using (p2p_is_kingdom_stories_editor()) with check (p2p_is_kingdom_stories_editor());

drop policy if exists "Kingdom story sources visible with their story" on p2p_kingdom_story_sources;
create policy "Kingdom story sources visible with their story" on p2p_kingdom_story_sources
  for select using (
    exists (select 1 from p2p_kingdom_stories s where s.id = story_id and (s.status = 'published' or p2p_is_kingdom_stories_editor()))
  );
drop policy if exists "Editors manage kingdom story sources" on p2p_kingdom_story_sources;
create policy "Editors manage kingdom story sources" on p2p_kingdom_story_sources
  for all using (p2p_is_kingdom_stories_editor()) with check (p2p_is_kingdom_stories_editor());

-- ── Storage: new, separate "kingdom-stories-media" bucket ──────────────────
-- Path shape is {storyId}/{mediaId}/file.ext, NOT {userId}/... — this is
-- editorial content with no per-user ownership, so write access is gated
-- purely by editorial role, never by whose uid prefixes the path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kingdom-stories-media', 'kingdom-stories-media', false, 104857600,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm']
)
on conflict (id) do nothing;

drop policy if exists "Editors manage kingdom story media files" on storage.objects;
create policy "Editors manage kingdom story media files" on storage.objects
  for all
  using (bucket_id = 'kingdom-stories-media' and p2p_is_kingdom_stories_editor())
  with check (bucket_id = 'kingdom-stories-media' and p2p_is_kingdom_stories_editor());

drop policy if exists "Read published kingdom story media files" on storage.objects;
create policy "Read published kingdom story media files" on storage.objects
  for select using (
    bucket_id = 'kingdom-stories-media' and
    exists (
      select 1 from p2p_kingdom_stories s
      where s.id::text = split_part(name, '/', 1) and s.status = 'published'
    )
  );

-- ── Seed: controlled category metadata ONLY — zero story content ──────────
insert into p2p_kingdom_story_categories (slug, title, display_order) values
  ('christian-history',  'Christian History',    0),
  ('the-church',         'The Church',            1),
  ('revival',            'Revival',               2),
  ('global-church',      'Global Church',         3),
  ('missions',           'Missions',              4),
  ('scripture',          'Scripture',             5),
  ('prayer',             'Prayer',                6),
  ('discipleship',       'Discipleship',          7),
  ('people',             'People',                8),
  ('persecution',        'Persecution',           9),
  ('church-movements',   'Church Movements',     10),
  ('christianity-today', 'Christianity Today',   11),
  ('places',             'Places',               12)
on conflict (slug) do nothing;
