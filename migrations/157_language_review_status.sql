-- 157: Multilingual Expansion Stage 8 — UI translation review status.
--
-- The curriculum/content translation review workflow ALREADY EXISTS and is
-- architecturally sound — p2p_content_translations.status
-- (draft/approved/rejected), PATCH /translations/:contentType/:contentId
-- (requireAdmin + requireTranslationAdmin-gated), and
-- app/admin/translation-review.tsx already implement exactly the
-- draft -> review -> approved/rejected flow Stage 8 asks for. The real
-- finding is PROCESS, not missing infrastructure: live data shows 768 AI
-- draft rows across 15 languages and only 4 approved rows (legacy German
-- carried over from before the AI pipeline existed) — the review queue is
-- simply not being used, which this migration cannot fix by itself.
--
-- What genuinely has NO review tracking at all: the UI locale JSON files
-- (artifacts/mobile/locales/*.json). They are plain files with zero status
-- concept — a language can be 95.7% string-complete and zero percent
-- reviewed, and nothing records that distinction. Per Stage 1's own
-- deferral ("belongs to whichever later stage actually consumes it —
-- Stage 8"), this is that stage.
--
-- Deliberately NOT injecting a status marker into the locale JSON files
-- themselves — i18next would treat it as a real translatable key, and it
-- would ship inside the app bundle for no reason. p2p_languages (the
-- canonical registry, migration 154) is the right home: one row per
-- language already exists there.

ALTER TABLE public.p2p_languages
  ADD COLUMN IF NOT EXISTS ui_review_status text NOT NULL DEFAULT 'unreviewed'
    CHECK (ui_review_status IN ('unreviewed', 'human_review_required', 'approved')),
  ADD COLUMN IF NOT EXISTS ui_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS ui_reviewed_at timestamptz;

-- English is the source language — definitionally correct, not "reviewed"
-- in the same sense, but the only status that means "safe to treat as
-- ground truth" without a separate review step.
UPDATE public.p2p_languages SET ui_review_status = 'approved' WHERE code = 'en';

-- Every other language stays at the honest default: none of the 39 locale
-- files (AI-generated originally, whether via the older OpenAI script or
-- gap-filled later) has been through an actual documented human review —
-- confirmed by the absence of any reviewer/approval record anywhere in
-- this codebase for UI strings specifically (distinct from the curriculum
-- workflow above, which does have such a record and shows 0 real reviews
-- of its own AI drafts either).

-- ── Verify ────────────────────────────────────────────────────────────
-- SELECT code, ui_review_status FROM p2p_languages ORDER BY code;
-- (expect exactly one 'approved' row: en)
