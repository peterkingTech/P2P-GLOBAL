-- Migration 003: Enterprise content translation engine
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- This creates the unified p2p_content_translations table and migrates
-- all existing German translations from the legacy per-field tables.
-- DO NOT drop the old tables — they are preserved as a fallback.

-- ── 1. Main table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p2p_content_translations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type    TEXT        NOT NULL
    CHECK (content_type IN (
      'curriculum','module','lesson','section','scripture',
      'question','assignment','quiz','devotional','journal'
    )),
  content_id      UUID        NOT NULL,
  language_code   TEXT        NOT NULL,
  title           TEXT,
  subtitle        TEXT,
  description     TEXT,
  body            TEXT,
  metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  version         INT         NOT NULL DEFAULT 1,
  translated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT        NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','rejected')),
  approved_by     UUID,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (content_type, content_id, language_code)
);

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_pct_lookup
  ON p2p_content_translations (content_type, content_id, language_code);

CREATE INDEX IF NOT EXISTS idx_pct_lang
  ON p2p_content_translations (language_code);

CREATE INDEX IF NOT EXISTS idx_pct_status
  ON p2p_content_translations (status);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE p2p_content_translations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pct_public_read" ON p2p_content_translations;
CREATE POLICY "pct_public_read"
  ON p2p_content_translations FOR SELECT USING (true);

DROP POLICY IF EXISTS "pct_service_write" ON p2p_content_translations;
CREATE POLICY "pct_service_write"
  ON p2p_content_translations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── 4. Migrate existing module translations ──────────────────────────────────
-- One approved German row per module, preserving all existing work.

INSERT INTO p2p_content_translations
  (content_type, content_id, language_code, title, description, status, translated_at)
SELECT
  'module',
  module_id,
  language_code,
  title,
  description,
  'approved',
  now()
FROM p2p_module_translations
ON CONFLICT (content_type, content_id, language_code) DO UPDATE SET
  title       = EXCLUDED.title,
  description = EXCLUDED.description,
  status      = 'approved',
  version     = p2p_content_translations.version + 1,
  translated_at = now();

-- ── 5. Migrate existing lesson translations ───────────────────────────────────

INSERT INTO p2p_content_translations
  (content_type, content_id, language_code, title, subtitle, status, translated_at)
SELECT
  'lesson',
  lesson_id,
  language_code,
  title,
  subtitle,
  'approved',
  now()
FROM p2p_lesson_translations
ON CONFLICT (content_type, content_id, language_code) DO UPDATE SET
  title     = EXCLUDED.title,
  subtitle  = EXCLUDED.subtitle,
  status    = 'approved',
  version   = p2p_content_translations.version + 1,
  translated_at = now();

-- ── 6. Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT content_type, language_code, count(*)
--   FROM p2p_content_translations
--   GROUP BY content_type, language_code
--   ORDER BY content_type, language_code;
