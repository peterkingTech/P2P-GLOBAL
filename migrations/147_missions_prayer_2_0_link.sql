-- 147: Missions Stage 4 — explicit Mission Story/Field <-> Prayer 2.0 link.
--
-- Mirrors the exact precedent already set by migration 140 (Prayer 2.0
-- Stage 5), which added a nullable mission_id FK (to the legacy
-- p2p_missions table) on p2p_prayer_coord_requests. This migration adds
-- the equivalent pair for the NEW mission domain — nullable references
-- only, never a duplicate of the request itself. Prayer 2.0's own tables
-- remain the sole source of truth for the request/commitment/gathering
-- lifecycle; Missions only ever points at them.
alter table p2p_prayer_coord_requests
  add column if not exists mission_story_id uuid references p2p_mission_stories(id) on delete set null,
  add column if not exists mission_field_id uuid references p2p_mission_fields(id) on delete set null;

create index if not exists idx_p2p_prayer_coord_requests_mission_story on p2p_prayer_coord_requests(mission_story_id) where mission_story_id is not null;
create index if not exists idx_p2p_prayer_coord_requests_mission_field on p2p_prayer_coord_requests(mission_field_id) where mission_field_id is not null;
