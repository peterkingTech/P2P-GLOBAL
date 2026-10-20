-- 205: synchronized Media in Church Gatherings — the same playback clock the
-- Family Gathering uses (migrations 116/119, p2p_family_worship_sessions).
--
-- Church calls could only "attach" a video (media_provider/media_id, Stage 4)
-- that nobody could play. These columns are the server-anchored clock the
-- existing SyncedMediaPlayer/SharedMedia reconcile against — the same
-- formula: position = base_position + (now - base_server_time) * rate while
-- playing. No second sync engine, no new player: the app feeds these fields
-- to the Family components unchanged.
--
-- Who controls playback is unchanged: the call host or a church pastor
-- (routes/churchCalls.ts isHostOrPastor — the existing media rule).
-- Additive only; existing calls default to paused at 0. No RLS change:
-- clients never write church calls directly.

alter table public.p2p_church_calls
  add column if not exists is_playing boolean not null default false,
  add column if not exists playback_base_position_ms bigint not null default 0,
  add column if not exists playback_base_server_time timestamptz not null default now(),
  add column if not exists playback_rate real not null default 1;

-- Rollback:
--   alter table public.p2p_church_calls drop column if exists playback_rate,
--     drop column if exists playback_base_server_time, drop column if exists playback_base_position_ms, drop column if exists is_playing;
