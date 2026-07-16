-- Migration 006: Extend p2p_languages with full multilingual metadata
-- Run in Supabase Dashboard → SQL Editor → New query.
-- Depends on: 002_languages_table.sql (p2p_languages must exist)
-- Must run BEFORE 007_seed_languages.sql.
--
-- WHY THIS MIGRATION EXISTS:
--   The live p2p_languages table was created with only (code, name, is_default).
--   The app code (admin/translations.tsx, settings.tsx, DataContext) and
--   007_seed_languages.sql all reference name_en, name_native, flag_emoji,
--   is_rtl, and is_active — none of which exist in the live base schema.
--   This migration adds those columns and backfills the existing en/de rows.

-- ── 1. Add missing columns ────────────────────────────────────────────────────

ALTER TABLE p2p_languages
  ADD COLUMN IF NOT EXISTS name_en     TEXT,
  ADD COLUMN IF NOT EXISTS name_native TEXT,
  ADD COLUMN IF NOT EXISTS flag_emoji  TEXT,
  ADD COLUMN IF NOT EXISTS is_rtl      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Backfill existing rows ─────────────────────────────────────────────────
-- Existing en and de rows in the live DB have only code/name/is_default.

UPDATE p2p_languages SET
  name_en     = 'English',
  name_native = 'English',
  flag_emoji  = '🇺🇸',
  is_rtl      = false,
  is_active   = true
WHERE code = 'en';

UPDATE p2p_languages SET
  name_en     = 'German',
  name_native = 'Deutsch',
  flag_emoji  = '🇩🇪',
  is_rtl      = false,
  is_active   = true
WHERE code = 'de';

-- ── 3. Apply NOT NULL constraint on name_en (after backfill) ─────────────────
-- Defer this until AFTER backfill so the ALTER doesn't fail on existing rows.

ALTER TABLE p2p_languages ALTER COLUMN name_en SET NOT NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT code, name, name_en, name_native, flag_emoji, is_rtl, is_active
-- FROM p2p_languages
-- ORDER BY code;
--
-- Expected:
--   code | name    | name_en | name_native | flag_emoji | is_rtl | is_active
--   de   | German  | German  | Deutsch     | 🇩🇪         | false  | true
--   en   | English | English | English     | 🇺🇸         | false  | true
