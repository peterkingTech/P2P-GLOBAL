-- 260 — About P2P introduction videos (owner brief 2026-11-26): per-account viewing status, language asset review
-- workflow and privacy-light analytics. APPLIED to production 2026-11-28 (guarded apply, all checks PASS). Additive only: three new tables, nothing existing changes.
--
-- Until this is applied the API answers `stored: false` and the app keeps viewing status on the phone only
-- (AsyncStorage), and the language review screen is read-only (statuses come from the content files in the repo).

-- 1. Viewing status per account and video (cross-device; first viewing must be completed, never inferred).
create table if not exists public.p2p_intro_video_views (
  user_id          uuid        not null references auth.users(id) on delete cascade,
  video_id         text        not null check (video_id ~ '^[0-9]{2}$'),
  position_seconds numeric     not null default 0 check (position_seconds >= 0),
  max_watched_seconds numeric  not null default 0 check (max_watched_seconds >= 0),
  completed_at     timestamptz,             -- set only when playback genuinely reached the end
  completions      integer     not null default 0,
  skipped_at       timestamptz,             -- accounts that existed before the videos may skip an introduction once
  auto_intro_off   boolean     not null default false, -- "Don't show automatically again" (library access is unaffected)
  audio_language   text,
  subtitle_language text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (user_id, video_id)
);
alter table public.p2p_intro_video_views enable row level security;
-- The API uses the service role; members may read their own rows directly (nothing else).
drop policy if exists "own intro video views" on public.p2p_intro_video_views;
create policy "own intro video views" on public.p2p_intro_video_views for select using (auth.uid() = user_id);
-- This project's default privileges give anon/authenticated ALL on every new public table (TRUNCATE is not covered
-- by RLS), so each new table first takes them away and then grants exactly what is intended (found 2026-11-28).
revoke all on public.p2p_intro_video_views from anon, authenticated;
grant select on public.p2p_intro_video_views to authenticated;
grant all on public.p2p_intro_video_views to service_role;

-- 2. Review status of each language asset (subtitles, on-screen text, voice-over) per video.
--    The repo content files hold the text and its default status; a row here overrides the status after review.
create table if not exists public.p2p_intro_video_assets (
  video_id    text        not null check (video_id ~ '^[0-9]{2}$'),
  language    text        not null check (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  kind        text        not null check (kind in ('subtitles', 'overlays', 'audio')),
  status      text        not null check (status in ('not_started', 'translated', 'audio_generated', 'awaiting_review', 'approved', 'published', 'withdrawn')),
  note        text,
  reviewed_by uuid        references auth.users(id),
  reviewed_at timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (video_id, language, kind)
);
alter table public.p2p_intro_video_assets enable row level security;   -- service role only (Admin Centre via the API)
revoke all on public.p2p_intro_video_assets from anon, authenticated;
grant all on public.p2p_intro_video_assets to service_role;

-- Append-only history of every review action (who, what, when).
create table if not exists public.p2p_intro_video_asset_events (
  id          bigint generated always as identity primary key,
  video_id    text not null,
  language    text not null,
  kind        text not null,
  from_status text,
  to_status   text not null,
  note        text,
  actor       uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table public.p2p_intro_video_asset_events enable row level security;
revoke all on public.p2p_intro_video_asset_events from anon, authenticated;
grant all on public.p2p_intro_video_asset_events to service_role;

-- 3. Analytics: events only, no free text, no device identifiers. user_id is kept so a person's own repeat views are
--    not double counted; it is removed with the account (on delete set null).
create table if not exists public.p2p_intro_video_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  video_id   text not null check (video_id ~ '^[0-9]{2}$'),
  event      text not null check (event in ('intro_shown', 'play_started', 'completed', 'interrupted', 'replayed', 'skipped', 'language_selected', 'translation_unavailable')),
  context    text check (context is null or context ~ '^[a-z_]{1,40}$'),   -- where it was shown (first_launch, learning, library …)
  language   text check (language is null or language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  position_seconds numeric,
  created_at timestamptz not null default now()
);
create index if not exists p2p_intro_video_events_video_idx on public.p2p_intro_video_events (video_id, event, created_at);
alter table public.p2p_intro_video_events enable row level security;   -- service role only
revoke all on public.p2p_intro_video_events from anon, authenticated;
grant all on public.p2p_intro_video_events to service_role;
