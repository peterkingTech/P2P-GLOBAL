-- Migration 002: p2p_languages reference table
-- GENERATED FROM LIVE SUPABASE SCHEMA (audited 2026-07-16).
-- Run in Supabase Dashboard → SQL Editor → New query.
--
-- ⚠️  This file reflects the BASE schema as it exists live.
--     Run 006_languages_schema_upgrade.sql immediately after to add the
--     extended columns (name_en, name_native, flag_emoji, is_rtl, is_active)
--     that the app code and 007_seed_languages.sql require.
--
-- Live columns at audit date:
--   code       text  PRIMARY KEY
--   name       text  NOT NULL
--   is_default boolean NOT NULL DEFAULT false
--
-- Live RLS policies at audit date (via p2p_is_admin() helper):
--   SELECT  → authenticated users
--   INSERT  → admins only (p2p_is_admin())
--   UPDATE  → admins only
--   DELETE  → admins only

-- ── 1. Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p2p_languages (
  code       TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false
);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE p2p_languages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read p2p_languages" ON p2p_languages;
CREATE POLICY "Authenticated users can read p2p_languages"
  ON p2p_languages FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can insert p2p_languages" ON p2p_languages;
CREATE POLICY "Admins can insert p2p_languages"
  ON p2p_languages FOR INSERT
  TO authenticated
  WITH CHECK (p2p_is_admin());

DROP POLICY IF EXISTS "Admins can update p2p_languages" ON p2p_languages;
CREATE POLICY "Admins can update p2p_languages"
  ON p2p_languages FOR UPDATE
  TO authenticated
  USING (p2p_is_admin())
  WITH CHECK (p2p_is_admin());

DROP POLICY IF EXISTS "Admins can delete p2p_languages" ON p2p_languages;
CREATE POLICY "Admins can delete p2p_languages"
  ON p2p_languages FOR DELETE
  TO authenticated
  USING (p2p_is_admin());

-- ── 3. Initial seed ───────────────────────────────────────────────────────────
-- Only en and de are active in the live DB at audit date.
-- All 36 languages are seeded in 007_seed_languages.sql (after 006 adds extended columns).

INSERT INTO p2p_languages (code, name, is_default) VALUES
  ('en', 'English', true),
  ('de', 'German',  false)
ON CONFLICT (code) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT code, name, is_default FROM p2p_languages ORDER BY code;
