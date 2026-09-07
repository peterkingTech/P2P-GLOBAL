-- 124: P2P Together Phase 7 — Prayer Space, Conversation references,
-- Teaching mode, and the Shared/Private/Scripture-linked Notes
-- architecture. All additive; no existing column or row is touched.
--
-- Prayer participation reuses the existing
-- p2p_family_worship_participants.presence_status 'praying' value (already
-- anticipated by migration 116's enum comment, never wired to a route
-- until now) rather than inventing a new signal. Prayer focus and the
-- prayer timer follow the exact anchor-clock pattern already used for
-- media playback (base value + base server time, recomputed client-side,
-- no per-tick writes). Teaching is simply a new current_mode value — the
-- column is plain text with no CHECK constraint, so no schema change is
-- needed for that part.

-- ── Prayer Space: focus + synced timer on the session row ──────────────────────
alter table p2p_family_worship_sessions
  add column if not exists current_focus_prayer_request_id uuid references p2p_family_prayer_requests(id) on delete set null,
  add column if not exists prayer_timer_duration_seconds integer,
  add column if not exists prayer_timer_started_at timestamptz;

-- ── Prayer Space: Scripture-linked prayer requests ──────────────────────────────
-- Same structured {translation, book, chapter, startVerse, endVerse} shape
-- as p2p_family_worship_sessions.current_scripture (migration 116) and
-- Phase 6's WorshipScripture — never a second copy of translation text.
alter table p2p_family_prayer_requests
  add column if not exists scripture_reference jsonb;

-- ── Shared / Private / Scripture-linked Notes ───────────────────────────────────
-- Deliberately minimal — "prepare architecture... do not over-engineer".
-- Session-scoped (not family-scoped): a note belongs to one Gathering,
-- same boundary as p2p_family_worship_messages (migration 122), whose RLS
-- shape this copies exactly (active-participant-of-this-session gate).
create table if not exists p2p_family_worship_notes (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references p2p_family_worship_sessions(id) on delete cascade,
  author_id           uuid not null references auth.users(id) on delete cascade,
  visibility          text not null default 'shared',  -- 'shared'|'private'
  content             text not null,
  scripture_reference jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_p2p_family_worship_notes_session on p2p_family_worship_notes(session_id, created_at);
create index if not exists idx_p2p_family_worship_notes_author on p2p_family_worship_notes(author_id);

alter table p2p_family_worship_notes enable row level security;

drop policy if exists "active participants read shared notes and their own" on p2p_family_worship_notes;
create policy "active participants read shared notes and their own" on p2p_family_worship_notes
  for select using (
    auth.uid() = author_id
    or (
      visibility = 'shared'
      and exists (
        select 1 from p2p_family_worship_participants p
        where p.session_id = p2p_family_worship_notes.session_id and p.user_id = auth.uid() and p.left_at is null
      )
    )
  );

drop policy if exists "active participants create their own notes" on p2p_family_worship_notes;
create policy "active participants create their own notes" on p2p_family_worship_notes
  for insert with check (
    auth.uid() = author_id
    and exists (
      select 1 from p2p_family_worship_participants p
      where p.session_id = p2p_family_worship_notes.session_id and p.user_id = auth.uid() and p.left_at is null
    )
  );

drop policy if exists "authors manage their own notes" on p2p_family_worship_notes;
create policy "authors manage their own notes" on p2p_family_worship_notes
  for update using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "authors delete their own notes" on p2p_family_worship_notes;
create policy "authors delete their own notes" on p2p_family_worship_notes
  for delete using (auth.uid() = author_id);

-- ── Session Summary: modest, non-sensitive additions ────────────────────────────
-- Counts only, never prayer-request content or note content — "do not
-- record sensitive information unnecessarily". media_provider/media_id
-- mirror the session row's last-known Shared Media, same idea as the
-- existing scripture_reference "last value" summary field.
alter table p2p_family_worship_history
  add column if not exists media_provider text,
  add column if not exists media_id text,
  add column if not exists prayer_request_count integer not null default 0,
  add column if not exists notes_count integer not null default 0;
