-- Migration 002: languages reference table
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

CREATE TABLE IF NOT EXISTS languages (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  native_name text NOT NULL,
  is_rtl      boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  content_coverage jsonb DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE languages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "languages_public_read" ON languages;
CREATE POLICY "languages_public_read" ON languages FOR SELECT USING (true);

INSERT INTO languages (code, name, native_name, is_rtl) VALUES
  ('en', 'English',              'English',          false),
  ('de', 'German',               'Deutsch',          false),
  ('es', 'Spanish',              'Español',          false),
  ('fr', 'French',               'Français',         false),
  ('pt', 'Portuguese',           'Português',        false),
  ('zh', 'Chinese (Simplified)', '中文',              false),
  ('ar', 'Arabic',               'العربية',          true),
  ('he', 'Hebrew',               'עברית',            true),
  ('ru', 'Russian',              'Русский',          false),
  ('ja', 'Japanese',             '日本語',            false),
  ('ko', 'Korean',               '한국어',            false),
  ('hi', 'Hindi',                'हिन्दी',            false),
  ('sw', 'Swahili',              'Kiswahili',        false),
  ('am', 'Amharic',              'አማርኛ',             false),
  ('yo', 'Yoruba',               'Yorùbá',           false),
  ('ig', 'Igbo',                 'Igbo',             false),
  ('ha', 'Hausa',                'Hausa',            false),
  ('zu', 'Zulu',                 'isiZulu',          false),
  ('id', 'Indonesian',           'Bahasa Indonesia', false),
  ('ms', 'Malay',                'Bahasa Melayu',    false),
  ('tl', 'Filipino',             'Filipino',         false),
  ('vi', 'Vietnamese',           'Tiếng Việt',       false),
  ('th', 'Thai',                 'ภาษาไทย',          false),
  ('tr', 'Turkish',              'Türkçe',           false),
  ('fa', 'Persian',              'فارسی',            true),
  ('ur', 'Urdu',                 'اردو',             true),
  ('it', 'Italian',              'Italiano',         false),
  ('nl', 'Dutch',                'Nederlands',       false),
  ('pl', 'Polish',               'Polski',           false),
  ('ro', 'Romanian',             'Română',           false),
  ('uk', 'Ukrainian',            'Українська',       false),
  ('bn', 'Bengali',              'বাংলা',            false),
  ('ta', 'Tamil',                'தமிழ்',            false),
  ('te', 'Telugu',               'తెలుగు',           false),
  ('my', 'Burmese',              'မြန်မာဘာသာ',        false),
  ('km', 'Khmer',                'ខ្មែរ',             false)
ON CONFLICT (code) DO NOTHING;
