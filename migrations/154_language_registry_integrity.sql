-- 154: Multilingual Expansion Stage 1 — Canonical Language Registry integrity.
--
-- Forensic audit (Phase 0 + Stage 1) found p2p_languages already exists
-- (created in 001_schema_additions.sql, extended out-of-band by
-- artifacts/mobile/db/migrations/002/006/007 which ran directly against
-- the live DB — that side history is NOT part of this repo's numbered
-- migration sequence and should not be extended further; this file is
-- the first entry in the real, numbered sequence to touch p2p_languages).
--
-- Two concrete gaps found, both fixed here, nothing else:
--
-- 1. p2p_profiles.app_language / content_language are bare `text NOT NULL
--    DEFAULT 'en'` columns with ZERO validation anywhere — not in the API
--    server (profile writes go client -> Supabase directly, RLS-gated,
--    never through an API route), not at the DB level. p2p_languages was
--    never actually authoritative for these columns; nothing stopped a
--    profile from holding a code that doesn't exist in the registry.
--    Fixed with a plain FK, the smallest way to make the registry
--    authoritative. Verified safe against live data: all 33 real profiles
--    hold only 'en' (33) or 'de' (1), both already valid p2p_languages
--    rows, so this FK changes zero existing rows and only prevents future
--    drift — it does not filter by is_active, so it preserves today's
--    (already-approved-elsewhere) behavior of the picker offering some
--    is_active=false codes.
--
-- 2. p2p_languages had no sort_order or updated_at — both are part of the
--    canonical structure this stage is chartered to establish. Added as
--    plain nullable/defaulted columns with no trigger (no updated_at
--    trigger convention exists anywhere else in this codebase — every
--    other table's updated_at is set explicitly by application code, e.g.
--    roomInvitations.ts's revoke handler — so this follows the existing
--    convention rather than introducing a new one). sort_order is seeded
--    to match this project's already-approved 37-language target
--    ordering; nothing reads it yet — Stage 2 is where picker ordering
--    is actually wired up.
--
-- Explicitly NOT done here (documented, not applied, per Stage 1 rules):
--   - zh-TW (this table) vs. zh-Hant (the actual locale file on disk) is
--     a real, confirmed code mismatch. NOT renamed in this migration —
--     zh-TW is not is_active and not in the App Language picker today, so
--     there is no live behavior to preserve, but renaming a primary key
--     is exactly the kind of change Stage 1's own rules require to be
--     proposed and reviewed, not silently applied. See the Stage 1 report
--     for the two resolution options.
--   - No ui_translation_status / review_status / bible_study_available /
--     curriculum_available columns added yet — those belong to whichever
--     later stage (2, 3, 8, 10) actually consumes them; adding them now
--     would be exactly the "add fields nothing reads yet" anti-pattern
--     the project rules warn against.

-- ── 1. Registry hygiene columns ─────────────────────────────────────────

ALTER TABLE public.p2p_languages
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Seed sort_order to match the already-approved 37-language target list
-- ordering (English/German first as the only is_active=true today, then
-- the rest in the order previously presented and approved). Purely
-- informational until Stage 2 wires picker ordering to it.
WITH ordering(code, ord) AS (
  VALUES
    ('en',1),('de',2),('es',3),('fr',4),('pt',5),('it',6),('nl',7),('pl',8),
    ('ro',9),('el',10),('cs',11),('ru',12),('uk',13),('tr',14),('ar',15),
    ('he',16),('fa',17),('hi',18),('bn',19),('ur',20),('ta',21),('te',22),
    ('mr',23),('zh',24),('zh-TW',25),('ja',26),('ko',27),('th',28),('vi',29),
    ('id',30),('ms',31),('sw',32),('am',33),('ha',34),('yo',35),('ig',36),
    ('pcm',37),('tl',38)
)
UPDATE public.p2p_languages l
SET sort_order = o.ord
FROM ordering o
WHERE l.code = o.code;

-- ── 2. Make the registry authoritative for profile language columns ────
-- Pre-integration audit finding: Postgres has no `ADD CONSTRAINT IF NOT
-- EXISTS`, so a plain ADD CONSTRAINT pair here would fail on a second run
-- ("constraint already exists") — every other statement in this file is
-- safely rerunnable, this wasn't. Guarded per-constraint by name, scoped
-- to this table specifically (not a blanket duplicate_object handler),
-- so an unrelated schema error still surfaces instead of being swallowed.
-- Behavior is otherwise identical: same columns, same referenced table,
-- no ON DELETE/ON UPDATE clause (unchanged, matches the original).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'p2p_profiles_app_language_fkey'
      AND conrelid = 'public.p2p_profiles'::regclass
  ) THEN
    ALTER TABLE public.p2p_profiles
      ADD CONSTRAINT p2p_profiles_app_language_fkey
        FOREIGN KEY (app_language) REFERENCES public.p2p_languages(code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'p2p_profiles_content_language_fkey'
      AND conrelid = 'public.p2p_profiles'::regclass
  ) THEN
    ALTER TABLE public.p2p_profiles
      ADD CONSTRAINT p2p_profiles_content_language_fkey
        FOREIGN KEY (content_language) REFERENCES public.p2p_languages(code);
  END IF;
END $$;

-- ── Verify ────────────────────────────────────────────────────────────
-- SELECT conname FROM pg_constraint
--   WHERE conrelid = 'public.p2p_profiles'::regclass
--   AND conname LIKE 'p2p_profiles_%language_fkey';
-- SELECT code, sort_order, updated_at FROM p2p_languages ORDER BY sort_order NULLS LAST;
