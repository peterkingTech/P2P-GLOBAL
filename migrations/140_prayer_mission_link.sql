-- 140: Prayer 2.0 Stage 5 — explicit Mission ↔ Prayer relationship.
--
-- FORENSIC BASIS: p2p_missions (unreached-people-group records, predates
-- tracked migrations like several other tables in this codebase) is
-- read-only from the mobile app today — no write/increment path exists,
-- and its prayer_count column is a static, admin-seeded number, never
-- live-incremented by any user action. This migration does NOT touch that
-- column or make it live (doing so risks exactly the "fake activity
-- numbers" this whole feature explicitly avoids) — it only adds an
-- explicit, optional reference so a Prayer Request MAY be "about" a
-- specific mission, per the product's own "explicit relationships, not a
-- recommendation algorithm" instruction.
--
-- No fundraising concept exists here or anywhere in this migration.

alter table p2p_prayer_coord_requests
  add column if not exists mission_id uuid references p2p_missions(id) on delete set null;

create index if not exists idx_p2p_prayer_coord_requests_mission on p2p_prayer_coord_requests(mission_id) where mission_id is not null;
