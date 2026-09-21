-- 158: Multilingual Expansion — register Zulu (zu), the approved 39th App
-- Language (see chat record: "Option C" — a deliberately defined
-- 39-language target rather than an accretion of whatever the translation
-- scripts happened to produce over time).
--
-- Zulu already had a 95.7%-complete locale file (artifacts/mobile/locales/
-- zu.json) but no p2p_languages row — without this row, migration 154's
-- FK on p2p_profiles.app_language would reject the first user who tried
-- to select it. is_active stays false and ui_review_status defaults to
-- 'unreviewed' (migration 157), matching every other non-en/de row —
-- nothing becomes reviewed or active by adding this row.
--
-- Already applied live and verified (39 total p2p_languages rows, zu row
-- confirmed with these exact values) prior to this file being written —
-- this migration is being added now purely to keep the numbered sequence
-- a complete, accurate record of what has actually been run.

INSERT INTO public.p2p_languages
  (code, name, name_en, name_native, flag_emoji, is_rtl, is_active, sort_order)
VALUES
  ('zu', 'Zulu', 'Zulu', 'isiZulu', '🇿🇦', false, false, 39)
ON CONFLICT (code) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────
-- SELECT code, name_native, flag_emoji, is_rtl, is_active, sort_order, ui_review_status
-- FROM p2p_languages WHERE code = 'zu';
