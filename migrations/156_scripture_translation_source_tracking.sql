-- 156: Multilingual Expansion Stage 7 — Scripture source integrity.
--
-- Forensic finding: routes/admin.ts (requireAdmin-gated, so already
-- correctly access-controlled) upserts admin-submitted text directly into
-- p2p_scripture_translations.verse, entirely separate from both (a) the
-- approved api.scripture.api.bible pipeline (lib/bibleService.ts,
-- p2p_bible_translations.is_licensed_confirmed, p2p_bible_verses_cache),
-- and (b) translationEngine.ts's AI curriculum pipeline, which explicitly
-- refuses to translate scripture at all. Verified live: 0 rows exist in
-- this table today, and no student-facing code anywhere in
-- artifacts/mobile reads from it, p2p_lesson_section_translations,
-- p2p_reflection_question_translations, or p2p_curriculum_translations —
-- confirmed via a repo-wide search, only admin.ts touches them. So there
-- is no live exposure today, but nothing stops a future change from
-- reading this table and unknowingly surfacing unverified "Scripture" as
-- if it were an approved translation.
--
-- Fix: an explicit source column, defaulting to 'admin_manual' so any
-- existing/future row via this path is self-documenting and can never be
-- mistaken for API-sourced, licensed text. This does not restrict or
-- remove the existing admin tool (it may have a legitimate manual-fix use
-- case), it just makes the provenance explicit and queryable.

ALTER TABLE public.p2p_scripture_translations
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin_manual'
    CHECK (source IN ('admin_manual', 'api_bible'));

COMMENT ON COLUMN public.p2p_scripture_translations.source IS
  'Provenance of this verse text. ''admin_manual'' = typed/pasted by an admin via routes/admin.ts, NOT from a licensed Bible provider — must never be presented to users as an approved translation. ''api_bible'' is reserved for a future path that verifies against p2p_bible_translations.is_licensed_confirmed before insert; no such path exists yet, so no row should ever legitimately carry it today.';

COMMENT ON TABLE public.p2p_scripture_translations IS
  'Legacy per-verse translation table. NOT the approved Scripture source — that is p2p_bible_translations + p2p_bible_verses_cache via lib/bibleService.ts (api.scripture.api.bible). This table has no student-facing read path as of migration 156; if one is ever added, it MUST filter source = ''api_bible'' only, never ''admin_manual''.';

-- ── Verify ────────────────────────────────────────────────────────────
-- SELECT scripture_id, language_code, source FROM p2p_scripture_translations;
-- (expect 0 rows today)
