-- 142: "Pray the Word" Stage 1 — Scripture & Topic foundation.
--
-- FORENSIC BASIS (Stage 0 report): no topic taxonomy, Scripture-collection
-- model, saved/bookmark system, or Prayer Path system exists anywhere in
-- this codebase. p2p_scriptures (pre-migration-history, 1767 rows) is
-- CURRICULUM content — every row FKs to a p2p_lessons row via lesson_id and
-- is read through the generic published-lesson RLS in 004 — it belongs to
-- the Custom Studies/Curriculum domain and is deliberately NOT reused or
-- extended here, to avoid coupling a topic-scoped feature to a
-- lesson-scoped one. A real, licensed Bible-text pipeline already exists
-- (p2p_bible_translations + p2p_bible_verses_cache + bibleService.ts,
-- api.scripture.api.bible-backed, gated by is_licensed_confirmed) — this
-- migration stores STRUCTURED REFERENCES only (book/chapter/verse-range),
-- never Bible text, so that pipeline remains the single source of truth
-- for verse text. This directly avoids repeating the one real pre-existing
-- risk found in Stage 0: p2p_prayer_library.scripture_text hand-copies
-- untracked Bible wording into a migration file with no license record.
--
-- No FK to p2p_bible_translations.translation_code: its existence was
-- confirmed live, but no generic schema-introspection RPC exists in this
-- environment to verify a UNIQUE constraint backs that column (required
-- for a valid FK target). Rather than risk a migration failure on an
-- unverified constraint on a table this feature doesn't own, translation_code
-- is stored as a plain nullable text column, validated at the API layer via
-- bibleService.getTranslationByCode() before being trusted — the same
-- "RLS/FK is a backstop, API does the real check" convention already used
-- for client-controlled soft relationships everywhere else in this codebase.

-- ── p2p_prayer_topics ──────────────────────────────────────────────────────
-- A curated life-topic ("Peace", "Healing", ...). status follows the exact
-- draft/published/archived convention already used by Custom Studies (134)
-- and the curriculum manager (039) — not a new invention.
create table if not exists p2p_prayer_topics (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,
  description       text,
  display_order     integer not null default 0,
  status            text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  parent_topic_id   uuid references p2p_prayer_topics(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_p2p_prayer_topics_published on p2p_prayer_topics(status, display_order) where status = 'published';
create index if not exists idx_p2p_prayer_topics_parent on p2p_prayer_topics(parent_topic_id) where parent_topic_id is not null;

-- ── p2p_scripture_references ────────────────────────────────────────────────
-- A structured pointer (book/chapter/verse-range) — never the verse text
-- itself. reference_display is a denormalized human-readable string (e.g.
-- "Philippians 4:6-7") stored for cheap display without recomputing it
-- client-side; the actual text is resolved on demand via the existing
-- GET/POST /bible/* endpoints (bibleService.ts). One reference row can be
-- shared by many topics via the join table below — never duplicated per topic.
create table if not exists p2p_scripture_references (
  id                  uuid primary key default gen_random_uuid(),
  book                text not null,
  chapter             integer not null check (chapter > 0),
  start_verse         integer not null check (start_verse > 0),
  end_verse           integer not null check (end_verse >= start_verse),
  translation_code    text,
  reference_display   text not null,
  created_at          timestamptz not null default now(),
  unique (book, chapter, start_verse, end_verse)
);

-- ── p2p_topic_scriptures ─────────────────────────────────────────────────────
-- Many-to-many: a Scripture reference can belong to multiple topics
-- (core in one, supporting in another) without ever being duplicated as a
-- row. editorial_note is optional curator commentary, never a generated
-- prayer or theology — content principle enforced at the API layer.
create table if not exists p2p_topic_scriptures (
  id               uuid primary key default gen_random_uuid(),
  topic_id         uuid not null references p2p_prayer_topics(id) on delete cascade,
  scripture_id     uuid not null references p2p_scripture_references(id) on delete cascade,
  role             text not null default 'core' check (role in ('core', 'supporting')),
  display_order    integer not null default 0,
  editorial_note   text,
  created_at       timestamptz not null default now(),
  unique (topic_id, scripture_id)
);

create index if not exists idx_p2p_topic_scriptures_topic on p2p_topic_scriptures(topic_id, role, display_order);
create index if not exists idx_p2p_topic_scriptures_scripture on p2p_topic_scriptures(scripture_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table p2p_prayer_topics enable row level security;
alter table p2p_scripture_references enable row level security;
alter table p2p_topic_scriptures enable row level security;

-- Topics: published readable by anyone (including anonymous — this is
-- curated devotional content, same public-readability posture as
-- p2p_prayer_library); draft/archived readable only by admins. All
-- mutation admin-only — the API layer (requireAdmin) is the primary gate,
-- this is the backstop, matching every other admin-content table.
drop policy if exists "Published topics are public, drafts are admin-only" on p2p_prayer_topics;
create policy "Published topics are public, drafts are admin-only" on p2p_prayer_topics
  for select using (status = 'published' or p2p_is_admin());
drop policy if exists "Admins manage topics" on p2p_prayer_topics;
create policy "Admins manage topics" on p2p_prayer_topics
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update topics" on p2p_prayer_topics;
create policy "Admins update topics" on p2p_prayer_topics
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete topics" on p2p_prayer_topics;
create policy "Admins delete topics" on p2p_prayer_topics
  for delete using (p2p_is_admin());

-- Scripture references: a bare reference (book/chapter/verse) carries no
-- editorial framing by itself and is not tied to draft/published state —
-- readable by anyone; only admins can create/edit/delete the canonical
-- reference rows (the API layer also dedupes via the unique constraint
-- above rather than trusting the client to avoid duplicates).
drop policy if exists "Scripture references are public" on p2p_scripture_references;
create policy "Scripture references are public" on p2p_scripture_references
  for select using (true);
drop policy if exists "Admins manage scripture references" on p2p_scripture_references;
create policy "Admins manage scripture references" on p2p_scripture_references
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update scripture references" on p2p_scripture_references;
create policy "Admins update scripture references" on p2p_scripture_references
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete scripture references" on p2p_scripture_references;
create policy "Admins delete scripture references" on p2p_scripture_references
  for delete using (p2p_is_admin());

-- Topic<->Scripture links: readable only through a PUBLISHED topic (or by
-- an admin) — this is the actual privacy-relevant gate, since the link
-- table is what would otherwise leak a draft topic's curation structure
-- even while the topic row itself stays hidden.
drop policy if exists "Topic-scripture links follow topic visibility" on p2p_topic_scriptures;
create policy "Topic-scripture links follow topic visibility" on p2p_topic_scriptures
  for select using (
    p2p_is_admin()
    or exists (select 1 from p2p_prayer_topics t where t.id = topic_id and t.status = 'published')
  );
drop policy if exists "Admins manage topic-scripture links" on p2p_topic_scriptures;
create policy "Admins manage topic-scripture links" on p2p_topic_scriptures
  for insert with check (p2p_is_admin());
drop policy if exists "Admins update topic-scripture links" on p2p_topic_scriptures;
create policy "Admins update topic-scripture links" on p2p_topic_scriptures
  for update using (p2p_is_admin()) with check (p2p_is_admin());
drop policy if exists "Admins delete topic-scripture links" on p2p_topic_scriptures;
create policy "Admins delete topic-scripture links" on p2p_topic_scriptures
  for delete using (p2p_is_admin());

-- ── Activity timeline: "Pray the Word" viewing events (Stages 2/3/5 need) ──
-- Same purely-informational, zero-score p2p_user_activity_events table
-- Prayer 2.0 already widened twice (139, 141) — proactively adding these
-- four values now so later stages' mobile code can log them without a
-- further migration. p2p_growth_events (the real score engine) is not
-- touched, same as every prior widening of this constraint.
alter table p2p_user_activity_events drop constraint if exists p2p_user_activity_events_event_type_check;
alter table p2p_user_activity_events add constraint p2p_user_activity_events_event_type_check
  check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched',
    'prayer_gathering_completed', 'peer_prayer_supported',
    'prayer_testimony_shared', 'growth_testimony_shared',
    'prayer_topic_viewed', 'prayer_scripture_viewed',
    'prayer_path_started', 'prayer_path_completed'
  ));
