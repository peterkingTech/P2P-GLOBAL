-- 246: Content language may be any app language (owner decision 2026-11-14).
--
-- "Apart from the Bible, every other content should have the same languages as the app language."
-- Content language now governs lessons, plans, Kingdom Stories and Listen signposts — each already falls
-- back to English where no translation exists — while the Bible has its own language and version choice
-- (Bible › Languages / Versions) and no longer depends on content_language.
--
-- Migration 155 added a trigger that refuses a content_language without a licensed, confirmed Bible
-- translation in p2p_bible_translations. That rule no longer matches the product, so it is removed.
-- The registry check stays: migration 154's FK (p2p_profiles_content_language_fkey → p2p_languages.code)
-- still refuses any code that isn't a real language, exactly as for app_language.
--
-- Safety: removes a check only. No row is read, changed or deleted; every existing profile already holds a
-- content language that satisfied the stricter rule. Rerunnable (IF EXISTS).
--
-- Rollback: re-run migrations/155_bible_study_language_validation.sql (recreates the function and trigger).

DROP TRIGGER IF EXISTS p2p_validate_content_language_trigger ON public.p2p_profiles;
DROP FUNCTION IF EXISTS public.p2p_validate_content_language();

-- ── Verify ────────────────────────────────────────────────────────────
-- Trigger gone:
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.p2p_profiles'::regclass AND tgname = 'p2p_validate_content_language_trigger';  -- 0 rows
-- FK still in place:
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.p2p_profiles'::regclass AND conname = 'p2p_profiles_content_language_fkey';  -- 1 row
