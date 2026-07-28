-- 040: Register Filipino/Tagalog so p2p_translation_jobs' language FK stops
-- rejecting it. The batch translation script's target language list
-- (artifacts/api-server/src/scripts/translateCurriculum.ts) includes "tl",
-- but p2p_languages never had it — every translation into Filipino still
-- got stored correctly in p2p_content_translations, but the job-tracking
-- row (and its cost data) silently failed to insert
-- (p2p_translation_jobs_language_fkey violation), swallowed by
-- translationEngine.ts's createJob() warning-and-continue handling.

INSERT INTO p2p_languages (code, name, name_en, name_native, flag_emoji, is_rtl, is_active, is_default)
VALUES ('tl', 'Filipino', 'Filipino', 'Filipino', '🇵🇭', false, false, false)
ON CONFLICT (code) DO NOTHING;
