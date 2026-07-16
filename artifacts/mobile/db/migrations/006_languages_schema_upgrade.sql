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
--
-- BUG NOTE: The live table has 8 rows at audit date (ar, de, en, es, fr, hi, pt, sw).
--   Only backfilling en/de causes SET NOT NULL to fail on the other 6.
--   This version backfills all 8 known rows, then catches any others with a fallback.

-- ── 1. Add missing columns ────────────────────────────────────────────────────

ALTER TABLE p2p_languages
  ADD COLUMN IF NOT EXISTS name_en     TEXT,
  ADD COLUMN IF NOT EXISTS name_native TEXT,
  ADD COLUMN IF NOT EXISTS flag_emoji  TEXT,
  ADD COLUMN IF NOT EXISTS is_rtl      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT true;

-- ── 2. Backfill every row that existed in the live DB at audit date ───────────

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

UPDATE p2p_languages SET
  name_en     = 'Arabic',
  name_native = 'العربية',
  flag_emoji  = '🇸🇦',
  is_rtl      = true,
  is_active   = false
WHERE code = 'ar';

UPDATE p2p_languages SET
  name_en     = 'Spanish',
  name_native = 'Español',
  flag_emoji  = '🇪🇸',
  is_rtl      = false,
  is_active   = false
WHERE code = 'es';

UPDATE p2p_languages SET
  name_en     = 'French',
  name_native = 'Français',
  flag_emoji  = '🇫🇷',
  is_rtl      = false,
  is_active   = false
WHERE code = 'fr';

UPDATE p2p_languages SET
  name_en     = 'Hindi',
  name_native = 'हिन्दी',
  flag_emoji  = '🇮🇳',
  is_rtl      = false,
  is_active   = false
WHERE code = 'hi';

UPDATE p2p_languages SET
  name_en     = 'Portuguese',
  name_native = 'Português',
  flag_emoji  = '🇧🇷',
  is_rtl      = false,
  is_active   = false
WHERE code = 'pt';

UPDATE p2p_languages SET
  name_en     = 'Swahili',
  name_native = 'Kiswahili',
  flag_emoji  = '🇰🇪',
  is_rtl      = false,
  is_active   = false
WHERE code = 'sw';

-- ── 3. Catch-all: use existing `name` for any row not yet backfilled ──────────
-- Safety net for any rows added between schema creation and this migration.
-- The `name` column has always stored English names, so it is a safe fallback.

UPDATE p2p_languages
SET name_en = name
WHERE name_en IS NULL;

-- ── 4. Apply NOT NULL constraint on name_en ───────────────────────────────────
-- Safe now: every row has been backfilled.

ALTER TABLE p2p_languages ALTER COLUMN name_en SET NOT NULL;

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT code, name, name_en, name_native, flag_emoji, is_rtl, is_active
-- FROM p2p_languages
-- ORDER BY is_active DESC, code;
--
-- Expected after this migration (before 007):
--   en → active=true,  name_en='English', flag=🇺🇸
--   de → active=true,  name_en='German',  flag=🇩🇪
--   ar → active=false, name_en='Arabic',  flag=🇸🇦, is_rtl=true
--   es → active=false, name_en='Spanish', flag=🇪🇸
--   fr → active=false, name_en='French',  flag=🇫🇷
--   hi → active=false, name_en='Hindi',   flag=🇮🇳
--   pt → active=false, name_en='Portuguese', flag=🇧🇷
--   sw → active=false, name_en='Swahili', flag=🇰🇪
