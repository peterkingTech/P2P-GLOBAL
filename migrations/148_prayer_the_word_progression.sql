-- 148: Enhancement Stage 1/2 — Scripture Devotional completion event +
-- Pray the Word sequential progression/lock.
--
-- FORENSIC BASIS: Pray the Word (142) has no progression/lock state at
-- all today — a topic's scriptures just cycle via "Continue" with no
-- persistence and no gate. Prayer Paths (143) already has the exact
-- pattern needed (p2p_prayer_path_progress: one row per user+path,
-- current_step_order, status) — this migration adds the direct analogue
-- for TOPICS, p2p_prayer_topic_progress, rather than inventing a
-- different shape. New topic scriptures are always appended with a
-- higher display_order than existing ones (enforced by convention in the
-- seeding/admin flow, not by a DB constraint), so current_scripture_order
-- for existing users is never invalidated by adding more content.
create table if not exists p2p_prayer_topic_progress (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  topic_id                 uuid not null references p2p_prayer_topics(id) on delete cascade,
  status                   text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  current_scripture_order  integer not null default 0,
  started_at               timestamptz not null default now(),
  completed_at             timestamptz,
  updated_at               timestamptz not null default now(),
  unique (user_id, topic_id)
);

create index if not exists idx_p2p_prayer_topic_progress_user on p2p_prayer_topic_progress(user_id);

alter table p2p_prayer_topic_progress enable row level security;
drop policy if exists "Users manage their own topic progress" on p2p_prayer_topic_progress;
create policy "Users manage their own topic progress" on p2p_prayer_topic_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Scripture Devotional Study (Stage 1) — completion is logged to the
-- existing, purely-informational activity timeline (already widened 4
-- times this program), not a new table. No score impact.
alter table p2p_user_activity_events drop constraint if exists p2p_user_activity_events_event_type_check;
alter table p2p_user_activity_events add constraint p2p_user_activity_events_event_type_check
  check (event_type in (
    'session_held', 'peer_encouraged', 'prayer_offered',
    'scripture_opened', 'plan_completed', 'mountain_touched',
    'prayer_gathering_completed', 'peer_prayer_supported',
    'prayer_testimony_shared', 'growth_testimony_shared',
    'prayer_topic_viewed', 'prayer_scripture_viewed',
    'prayer_path_started', 'prayer_path_completed',
    'mission_story_viewed', 'mission_field_viewed',
    'scripture_devotional_completed'
  ));
