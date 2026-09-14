-- 149: Enhancement Stage 5 — Missions photo media support.
--
-- Widens the EXISTING p2p_mission_stories.media_type CHECK (146) from
-- video-only to also allow 'photo', and widens the EXISTING private
-- "mission-media" bucket's allowed_mime_types to include common image
-- types. No new table, no new bucket, no new storage policy — every
-- existing ownership/publication RLS policy on storage.objects and
-- p2p_mission_stories already applies unchanged, since it keys on the
-- {userId}/{storyId}/... path shape and the story's own status, neither
-- of which this migration touches.
alter table p2p_mission_stories drop constraint if exists p2p_mission_stories_media_type_check;
alter table p2p_mission_stories add constraint p2p_mission_stories_media_type_check
  check (media_type in ('video', 'photo'));

update storage.buckets
set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
where id = 'mission-media';
