-- Migration 004: Translation jobs queue + admin RLS for review workflow
-- Run in Supabase Dashboard → SQL Editor → New query
-- Depends on: 003_content_translations.sql (must be run first)

-- ── 1. Translation jobs table ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p2p_translation_jobs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type  TEXT        NOT NULL,
  content_id    UUID        NOT NULL,
  language      TEXT        NOT NULL REFERENCES p2p_languages(code),
  status        TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed','retrying')),
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 3,
  last_error    TEXT,
  triggered_by  TEXT        NOT NULL DEFAULT 'admin',
  ai_provider   TEXT        DEFAULT 'gpt-4o-mini',
  ai_cost_usd   NUMERIC(10,4),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ptj_status ON p2p_translation_jobs (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ptj_content ON p2p_translation_jobs (content_type, content_id, language);

-- ── 2. RLS for jobs table ─────────────────────────────────────────────────────

ALTER TABLE p2p_translation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ptj_service_write" ON p2p_translation_jobs;
CREATE POLICY "ptj_service_write"
  ON p2p_translation_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "ptj_admin_read" ON p2p_translation_jobs;
CREATE POLICY "ptj_admin_read"
  ON p2p_translation_jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM p2p_profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','regional_admin','church_leader','peer_guide')
    )
  );

-- ── 3. Admin RLS for p2p_content_translations (review workflow) ───────────────
-- Allows authenticated admins to approve/reject translations directly.

DROP POLICY IF EXISTS "pct_admin_manage" ON p2p_content_translations;
CREATE POLICY "pct_admin_manage"
  ON p2p_content_translations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM p2p_profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','regional_admin','church_leader','peer_guide')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM p2p_profiles
      WHERE id = auth.uid()
        AND role IN ('super_admin','regional_admin','church_leader','peer_guide')
    )
  );

-- ── 4. Purge stale AI-paraphrased scripture verse text ───────────────────────
-- Phase 3 accidentally bundled verse_text in the AI payload.
-- Remove scripture content from metadata on any rows already stored.
-- (Safe to run even if 003 hasn't been run yet — UPDATE affects 0 rows.)

UPDATE p2p_content_translations
SET metadata = metadata - 'scriptures'
WHERE content_type = 'lesson'
  AND metadata ? 'scriptures';

-- Add the correct field name for Phase 5 compatibility:
-- scriptureRefs will contain {id, verse_ref} only — no verse_text.
-- (No data to backfill here — the engine now stores scriptureRefs correctly.)

-- ── 5. Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT status, count(*) FROM p2p_translation_jobs GROUP BY status;
--   SELECT count(*) FROM p2p_content_translations WHERE metadata ? 'scriptures'; -- should be 0
