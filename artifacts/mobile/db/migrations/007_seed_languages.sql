-- Migration 007: Seed all 36 supported languages
-- Run in Supabase Dashboard → SQL Editor → New query
-- Depends on: 002_languages_table.sql (p2p_languages must exist)
--
-- New languages are seeded with is_active = false.
-- Flip is_active = true only after:
--   1. Batch content translation is done (Phase 4 batch-curriculum route)
--   2. A reviewer has approved a sample from the Review Queue (Phase 4 admin screen)
--   3. The locale file (locales/<code>.json) has been spot-checked
--
-- RTL languages: ar, he, fa, ur — is_rtl = true

INSERT INTO p2p_languages
  (code, name_en, name_native, flag_emoji, is_rtl, is_active)
VALUES
  -- European (Latin script)
  ('es', 'Spanish',       'Español',       '🇪🇸', false, false),
  ('fr', 'French',        'Français',      '🇫🇷', false, false),
  ('pt', 'Portuguese',    'Português',     '🇧🇷', false, false),
  ('it', 'Italian',       'Italiano',      '🇮🇹', false, false),
  ('nl', 'Dutch',         'Nederlands',    '🇳🇱', false, false),
  ('pl', 'Polish',        'Polski',        '🇵🇱', false, false),
  ('ro', 'Romanian',      'Română',        '🇷🇴', false, false),
  ('el', 'Greek',         'Ελληνικά',      '🇬🇷', false, false),
  ('cs', 'Czech',         'Čeština',       '🇨🇿', false, false),

  -- Cyrillic / East European
  ('ru', 'Russian',       'Русский',       '🇷🇺', false, false),
  ('uk', 'Ukrainian',     'Українська',    '🇺🇦', false, false),

  -- Middle East / RTL
  ('tr', 'Turkish',       'Türkçe',        '🇹🇷', false, false),
  ('ar', 'Arabic',        'العربية',       '🇸🇦', true,  false),
  ('he', 'Hebrew',        'עברית',         '🇮🇱', true,  false),
  ('fa', 'Persian',       'فارسی',         '🇮🇷', true,  false),

  -- South Asia
  ('hi', 'Hindi',         'हिन्दी',         '🇮🇳', false, false),
  ('bn', 'Bengali',       'বাংলা',          '🇧🇩', false, false),
  ('ur', 'Urdu',          'اردو',           '🇵🇰', true,  false),
  ('ta', 'Tamil',         'தமிழ்',          '🇮🇳', false, false),
  ('te', 'Telugu',        'తెలుగు',         '🇮🇳', false, false),
  ('mr', 'Marathi',       'मराठी',          '🇮🇳', false, false),

  -- East Asia
  ('zh', 'Chinese (Simplified)', '中文(简体)', '🇨🇳', false, false),
  ('zh-TW', 'Chinese (Traditional)', '中文(繁體)', '🇹🇼', false, false),
  ('ja', 'Japanese',      '日本語',         '🇯🇵', false, false),
  ('ko', 'Korean',        '한국어',         '🇰🇷', false, false),

  -- Southeast Asia
  ('th', 'Thai',          'ภาษาไทย',        '🇹🇭', false, false),
  ('vi', 'Vietnamese',    'Tiếng Việt',    '🇻🇳', false, false),
  ('id', 'Indonesian',    'Bahasa Indonesia','🇮🇩',false, false),
  ('ms', 'Malay',         'Bahasa Melayu', '🇲🇾', false, false),

  -- Africa
  ('sw', 'Swahili',       'Kiswahili',     '🇰🇪', false, false),
  ('am', 'Amharic',       'አማርኛ',          '🇪🇹', false, false),
  ('ha', 'Hausa',         'Hausa',         '🇳🇬', false, false),
  ('yo', 'Yoruba',        'Yorùbá',        '🇳🇬', false, false),
  ('ig', 'Igbo',          'Igbo',          '🇳🇬', false, false),
  ('pcm','Nigerian Pidgin','Naijá',        '🇳🇬', false, false)

ON CONFLICT (code) DO UPDATE SET
  name_en       = EXCLUDED.name_en,
  name_native   = EXCLUDED.name_native,
  flag_emoji    = EXCLUDED.flag_emoji,
  is_rtl        = EXCLUDED.is_rtl;
-- Note: is_active is NOT updated on conflict — preserves existing active status.
