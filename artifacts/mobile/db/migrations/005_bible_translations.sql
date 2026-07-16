-- Migration 005: Licensed Bible verse tables
-- Run in Supabase Dashboard → SQL Editor → New query
-- Depends on: 002_languages_table.sql (p2p_languages must exist)

-- ── 1. Bible translation registry ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p2p_bible_translations (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  language                TEXT        NOT NULL REFERENCES p2p_languages(code),
  translation_code        TEXT        NOT NULL UNIQUE,
  translation_name        TEXT        NOT NULL,
  is_default_for_language BOOLEAN     NOT NULL DEFAULT false,
  provider                TEXT        NOT NULL
    CHECK (provider IN ('api.bible','dbp','local')),
  api_bible_id            TEXT,       -- API.Bible internal ID (e.g. 'de4e12af7fb5a0e6-01')
  license_notes           TEXT,
  is_licensed_confirmed   BOOLEAN     NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pbt_default_lang
  ON p2p_bible_translations (language)
  WHERE is_default_for_language = true;

-- ── 2. Verse text cache ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS p2p_bible_verses_cache (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  translation_code TEXT        NOT NULL REFERENCES p2p_bible_translations(translation_code),
  book             TEXT        NOT NULL,
  chapter          INT         NOT NULL,
  verse            INT         NOT NULL,
  verse_text       TEXT        NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (translation_code, book, chapter, verse)
);

CREATE INDEX IF NOT EXISTS idx_pbvc_lookup
  ON p2p_bible_verses_cache (translation_code, book, chapter, verse);

-- ── 3. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE p2p_bible_translations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE p2p_bible_verses_cache   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pbt_public_read"  ON p2p_bible_translations;
CREATE POLICY "pbt_public_read"  ON p2p_bible_translations  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pbvc_public_read" ON p2p_bible_verses_cache;
CREATE POLICY "pbvc_public_read" ON p2p_bible_verses_cache  FOR SELECT USING (true);

DROP POLICY IF EXISTS "pbt_service_write"  ON p2p_bible_translations;
CREATE POLICY "pbt_service_write"  ON p2p_bible_translations  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "pbvc_service_write" ON p2p_bible_verses_cache;
CREATE POLICY "pbvc_service_write" ON p2p_bible_verses_cache FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ── 4. Seed initial translations ──────────────────────────────────────────────
-- ⚠️  Only insert rows whose licensing is confirmed.
--     Set is_licensed_confirmed = true only after verifying terms with the provider.
--     KJV is public domain. Luther 1912 (LUT) is public domain in most jurisdictions.

INSERT INTO p2p_bible_translations
  (language, translation_code, translation_name, is_default_for_language, provider, api_bible_id, license_notes, is_licensed_confirmed)
VALUES
  ('en', 'KJV',  'King James Version',      true,  'api.bible', 'de4e12af7fb5a0e6-01',
   'Public domain — no restrictions', true),
  ('de', 'LUT',  'Luther Bibel 1912',        true,  'api.bible', 'c4a89f9b6bc5c4b7-01',
   'Public domain in most jurisdictions (1912 edition). Confirm for your deployment region.', true)
ON CONFLICT (translation_code) DO NOTHING;

-- ── 5. Done ───────────────────────────────────────────────────────────────────
-- Verify with:
--   SELECT language, translation_code, translation_name, is_licensed_confirmed
--   FROM p2p_bible_translations ORDER BY language;
--
-- IMPORTANT: The api_bible_id values above are examples. Look up exact IDs at:
--   https://scripture.api.bible/livedocs#/Bibles/getBibles
-- Correct IDs for KJV and LUT are needed for verse fetching to work.
