-- Migration 007: Seed all 36 supported languages
-- Run in Supabase Dashboard → SQL Editor → New query
-- Depends on: 006_languages_schema_upgrade.sql (name_en, name_native, flag_emoji, is_rtl, is_active must exist)
--
-- New languages are seeded with is_active = false.
-- Flip is_active = true only after:
--   1. Batch content translation is done (Phase 4 batch-curriculum route)
--   2. A reviewer has approved a sample from the Review Queue (Phase 4 admin screen)
--   3. The locale file (locales/<code>.json) has been spot-checked
--
-- RTL languages: ar, he, fa, ur — is_rtl = true
--
-- ON CONFLICT behaviour:
--   name_en / name_native / flag_emoji / is_rtl are updated (schema data — keep fresh).
--   is_active is NOT updated — preserves any admin-enabled status from a previous run.

INSERT INTO p2p_languages
  (code, name, name_en, name_native, flag_emoji, is_rtl, is_active)
VALUES
  -- European (Latin script)
  ('es', 'Spanish',              'Spanish',              'Español',           '🇪🇸', false, false),
  ('fr', 'French',               'French',               'Français',          '🇫🇷', false, false),
  ('pt', 'Portuguese',           'Portuguese',           'Português',         '🇧🇷', false, false),
  ('it', 'Italian',              'Italian',              'Italiano',          '🇮🇹', false, false),
  ('nl', 'Dutch',                'Dutch',                'Nederlands',        '🇳🇱', false, false),
  ('pl', 'Polish',               'Polish',               'Polski',            '🇵🇱', false, false),
  ('ro', 'Romanian',             'Romanian',             'Română',            '🇷🇴', false, false),
  ('el', 'Greek',                'Greek',                'Ελληνικά',          '🇬🇷', false, false),
  ('cs', 'Czech',                'Czech',                'Čeština',           '🇨🇿', false, false),

  -- Cyrillic / East European
  ('ru', 'Russian',              'Russian',              'Русский',           '🇷🇺', false, false),
  ('uk', 'Ukrainian',            'Ukrainian',            'Українська',        '🇺🇦', false, false),

  -- Middle East
  ('tr', 'Turkish',              'Turkish',              'Türkçe',            '🇹🇷', false, false),
  ('ar', 'Arabic',               'Arabic',               'العربية',           '🇸🇦', true,  false),
  ('he', 'Hebrew',               'Hebrew',               'עברית',             '🇮🇱', true,  false),
  ('fa', 'Persian',              'Persian',              'فارسی',             '🇮🇷', true,  false),

  -- South Asia
  ('hi', 'Hindi',                'Hindi',                'हिन्दी',             '🇮🇳', false, false),
  ('bn', 'Bengali',              'Bengali',              'বাংলা',              '🇧🇩', false, false),
  ('ur', 'Urdu',                 'Urdu',                 'اردو',              '🇵🇰', true,  false),
  ('ta', 'Tamil',                'Tamil',                'தமிழ்',              '🇮🇳', false, false),
  ('te', 'Telugu',               'Telugu',               'తెలుగు',             '🇮🇳', false, false),
  ('mr', 'Marathi',              'Marathi',              'मराठी',              '🇮🇳', false, false),

  -- East Asia
  ('zh', 'Chinese (Simplified)', 'Chinese (Simplified)', '中文(简体)',          '🇨🇳', false, false),
  ('zh-TW','Chinese (Traditional)','Chinese (Traditional)','中文(繁體)',        '🇹🇼', false, false),
  ('ja', 'Japanese',             'Japanese',             '日本語',              '🇯🇵', false, false),
  ('ko', 'Korean',               'Korean',               '한국어',              '🇰🇷', false, false),

  -- Southeast Asia
  ('th', 'Thai',                 'Thai',                 'ภาษาไทย',            '🇹🇭', false, false),
  ('vi', 'Vietnamese',           'Vietnamese',           'Tiếng Việt',        '🇻🇳', false, false),
  ('id', 'Indonesian',           'Indonesian',           'Bahasa Indonesia',   '🇮🇩', false, false),
  ('ms', 'Malay',                'Malay',                'Bahasa Melayu',     '🇲🇾', false, false),

  -- Africa
  ('sw', 'Swahili',              'Swahili',              'Kiswahili',         '🇰🇪', false, false),
  ('am', 'Amharic',              'Amharic',              'አማርኛ',              '🇪🇹', false, false),
  ('ha', 'Hausa',                'Hausa',                'Hausa',             '🇳🇬', false, false),
  ('yo', 'Yoruba',               'Yoruba',               'Yorùbá',            '🇳🇬', false, false),
  ('ig', 'Igbo',                 'Igbo',                 'Igbo',              '🇳🇬', false, false),
  ('pcm','Nigerian Pidgin',      'Nigerian Pidgin',      'Naijá',             '🇳🇬', false, false)

ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  name_en     = EXCLUDED.name_en,
  name_native = EXCLUDED.name_native,
  flag_emoji  = EXCLUDED.flag_emoji,
  is_rtl      = EXCLUDED.is_rtl;
  -- is_active intentionally NOT updated — preserves admin-enabled status.

-- ── Verify ────────────────────────────────────────────────────────────────────
-- SELECT code, name_en, flag_emoji, is_rtl, is_active
-- FROM p2p_languages
-- ORDER BY is_active DESC, code;
--
-- Expected: en + de with is_active=true, all others false.
-- After spot-checking translations + locale files, run:
--   UPDATE p2p_languages SET is_active = true WHERE code = 'fr';
-- (repeat per language as each one clears review)
