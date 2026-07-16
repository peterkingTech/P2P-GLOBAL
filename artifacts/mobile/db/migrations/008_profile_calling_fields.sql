-- Migration 008: Add mission / calling / occupation columns to p2p_profiles
-- Run in Supabase Dashboard → SQL Editor → New query.
-- Depends on: the p2p_profiles table existing (migration 001 or earlier).
--
-- WHY: users need to express their vocational calling and occupation so
-- potential study partners and peer guides can see their ministry context.

ALTER TABLE p2p_profiles
  ADD COLUMN IF NOT EXISTS mission    TEXT,
  ADD COLUMN IF NOT EXISTS calling    TEXT,
  ADD COLUMN IF NOT EXISTS occupation TEXT;

-- No NOT NULL / defaults needed — these are optional profile enrichment fields.

-- Verify:
-- SELECT id, full_name, mission, calling, occupation
-- FROM p2p_profiles LIMIT 5;
