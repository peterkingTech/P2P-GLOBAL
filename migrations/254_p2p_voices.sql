-- 254 — P2P Voices + owner-controlled official Kingdom Stories narration.
-- Written 2026-11-18. APPLIED TO PRODUCTION 2026-11-18 (owner approval; guarded apply: in-transaction checks + postcheck PASS).
-- ADDITIVE ONLY: five new tables and one new private storage bucket; no existing row, column, policy, Bible
-- licence or audio file is changed. The API works without this migration (it falls back to: catalogue cache in
-- memory, preferences kept on the phone, usage in memory, legacy narration files only, local audio cache).
--
--   p2p_voice_catalogue         the last VERIFIED voice list per provider (so a restart / provider outage still knows
--                               which voices P2P's account really has). Provider metadata only — no user data.
--   p2p_voice_preferences       a participant's P2P Voices choices: voice per content language, favourites, speed,
--                               "official narration first". One row per participant.
--   p2p_voice_usage             one row per synthesis request (provider, characters, cached/generated/error,
--                               content KIND) for administrators. Never the text that was read.
--   p2p_story_narrations        official Kingdom Stories narration: story, chapter, language, provider, voice,
--                               accent, model, format, duration, file locations, content version, status
--                               (awaiting_upload → uploaded → approved / rejected → published → withdrawn / superseded),
--                               who uploaded / approved / published and when. Rows are never deleted.
--   p2p_story_narration_events  append-only history of every action on a recording.
--   storage: p2p-voices-audio   PRIVATE bucket for generated P2P Voices audio (signed links only).
--
-- Security: API-only (RLS on, no client policies, no anon/authenticated grants), like 249, 251 and 253. The
-- owner-only narration routes are enforced by the API (requireAdmin + super_admin) and audited.
-- Rollback: drop the five tables and the bucket (generated audio is a cache; narration files stay in
-- kingdom-stories-media).

begin;

create table if not exists public.p2p_voice_catalogue (
  provider      text primary key check (provider in ('azure', 'google', 'elevenlabs', 'spitch')),
  voices        jsonb not null default '[]'::jsonb,
  refreshed_at  timestamptz not null default now()
);

create table if not exists public.p2p_voice_preferences (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  prefs       jsonb not null default '{}'::jsonb check (pg_column_size(prefs) < 32768),
  updated_at  timestamptz not null default now()
);

create table if not exists public.p2p_voice_usage (
  id            bigint generated always as identity primary key,
  provider      text not null,
  event         text not null check (event in ('generated', 'cached', 'error')),
  characters    integer not null default 0 check (characters >= 0),
  user_id       uuid references auth.users(id) on delete set null,
  content_kind  text,
  error_code    text,
  created_at    timestamptz not null default now()
);
create index if not exists p2p_voice_usage_provider_time on public.p2p_voice_usage (provider, created_at desc);

create table if not exists public.p2p_story_narrations (
  id                uuid primary key default gen_random_uuid(),
  story_id          uuid not null references public.p2p_kingdom_stories(id) on delete restrict,
  chapter_id        text not null check (chapter_id = 'intro' or chapter_id ~ '^[0-9a-f-]{36}$'),
  language          text not null default 'en' check (language ~ '^[a-z]{2,3}$'),
  provider          text not null default 'elevenlabs' check (provider in ('elevenlabs', 'studio', 'other')),
  voice_id          text,
  voice_name        text not null,
  accent            text,
  model             text,
  audio_format      text,
  duration_seconds  integer,
  word_count        integer,
  size_bytes        bigint,
  audio_path        text,
  timings_path      text,
  content_version   text,
  notes             text,
  legacy            boolean not null default false,
  status            text not null check (status in ('awaiting_upload', 'uploaded', 'approved', 'rejected', 'published', 'withdrawn', 'superseded')),
  reason            text,
  uploaded_by       uuid references auth.users(id) on delete set null,
  uploaded_at       timestamptz,
  approved_by       uuid references auth.users(id) on delete set null,
  approved_at       timestamptz,
  published_by      uuid references auth.users(id) on delete set null,
  published_at      timestamptz,
  withdrawn_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists p2p_story_narrations_chapter on public.p2p_story_narrations (story_id, chapter_id, language, status);
-- At most ONE published official recording per chapter and language.
create unique index if not exists p2p_story_narrations_one_published on public.p2p_story_narrations (story_id, chapter_id, language) where status = 'published';

create table if not exists public.p2p_story_narration_events (
  id            bigint generated always as identity primary key,
  narration_id  uuid not null references public.p2p_story_narrations(id) on delete restrict,
  action        text not null,
  actor         uuid references auth.users(id) on delete set null,
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists p2p_story_narration_events_by on public.p2p_story_narration_events (narration_id, created_at);
-- Append-only: history can't be rewritten.
create or replace function public.p2p_story_narration_events_append_only() returns trigger language plpgsql as $$
begin raise exception 'story narration history is append-only'; end $$;
drop trigger if exists p2p_story_narration_events_no_change on public.p2p_story_narration_events;
create trigger p2p_story_narration_events_no_change before update or delete on public.p2p_story_narration_events
  for each row execute function public.p2p_story_narration_events_append_only();

alter table public.p2p_voice_catalogue enable row level security;
alter table public.p2p_voice_preferences enable row level security;
alter table public.p2p_voice_usage enable row level security;
alter table public.p2p_story_narrations enable row level security;
alter table public.p2p_story_narration_events enable row level security;
do $$ declare t text; begin
  foreach t in array array['p2p_voice_catalogue', 'p2p_voice_preferences', 'p2p_voice_usage', 'p2p_story_narrations', 'p2p_story_narration_events'] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on public.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on public.%I from authenticated', t); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant select, insert, update, delete on public.%I to service_role', t); end if;
  end loop;
end $$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage, select on all sequences in schema public to service_role;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('p2p-voices-audio', 'p2p-voices-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do nothing;

commit;
