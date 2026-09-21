-- 155: Multilingual Expansion Stage 3 — server-side Bible Study Language
-- validation.
--
-- p2p_profiles.content_language writes go directly from the mobile client
-- to Supabase (RLS-gated) — there is no API route in between to add JS
-- validation to (confirmed: AuthContext.tsx's updateProfile() calls
-- supabase.from("p2p_profiles").update(...) directly). Migration 154
-- already added a generic FK making content_language reference a real
-- p2p_languages.code, but that only rules out garbage codes — it does not
-- rule out a code with no actual Bible source (e.g. 'zh', which has a full
-- UI translation but zero rows in p2p_bible_translations).
--
-- This trigger is the real "does a licensed Bible source exist" gate,
-- checked against p2p_bible_translations.is_licensed_confirmed directly —
-- not a second hardcoded language list that could silently drift out of
-- sync with that table the way the old app/settings/language.tsx picker
-- drifted from lib/i18n.ts's resource list. Adding a 9th confirmed
-- translation later requires zero migration changes here — this trigger
-- reads the table live on every write.
--
-- Verified safe against live data: all 33 real profiles hold
-- content_language 'en' (32) or 'de' (1); both already have an
-- is_licensed_confirmed=true row in p2p_bible_translations, so this
-- changes zero existing rows and only prevents future drift.

CREATE OR REPLACE FUNCTION public.p2p_validate_content_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.p2p_bible_translations
    WHERE language = NEW.content_language
      AND is_licensed_confirmed = true
  ) THEN
    RAISE EXCEPTION 'content_language "%" has no licensed, confirmed Bible translation in p2p_bible_translations', NEW.content_language;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2p_validate_content_language_trigger ON public.p2p_profiles;
CREATE TRIGGER p2p_validate_content_language_trigger
  BEFORE INSERT OR UPDATE OF content_language ON public.p2p_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_validate_content_language();

-- ── Verify ────────────────────────────────────────────────────────────
-- Should succeed (en has a confirmed translation):
--   UPDATE p2p_profiles SET content_language = 'en' WHERE id = '<any real id>';
-- Should fail with the RAISE EXCEPTION above (zh has no confirmed row):
--   UPDATE p2p_profiles SET content_language = 'zh' WHERE id = '<any real id>';
