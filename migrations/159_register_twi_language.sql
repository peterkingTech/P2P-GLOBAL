-- 159: Register Twi (Akan) — tw — as a new App Language.
--
-- Ghana / Akan language family. Added at the user's explicit request, as
-- a genuine 40th language beyond the previously-finalized 39-language
-- target (that target governed which of the ALREADY-EXISTING codes to
-- expose, not a hard ceiling on ever adding a new one — this is a
-- deliberate, explicit addition, not an undocumented accretion like the
-- pa/zu/af/da/no/sv locale files found earlier this session).
--
-- is_active stays false and ui_review_status defaults to 'unreviewed'
-- (migration 157), matching every other non-en/de row. tw.json is
-- registered as a genuinely empty resource ({}) — zero fabricated
-- translation content; every UI string falls back to English via
-- i18next's existing fallbackLng until real Twi translation work happens.

INSERT INTO public.p2p_languages
  (code, name, name_en, name_native, flag_emoji, is_rtl, is_active, sort_order)
VALUES
  ('tw', 'Twi (Akan)', 'Twi (Akan)', 'Twi', '🇬🇭', false, false, 40)
ON CONFLICT (code) DO NOTHING;

-- ── Verify ────────────────────────────────────────────────────────────
-- SELECT code, name_native, flag_emoji, is_rtl, is_active, sort_order, ui_review_status
-- FROM p2p_languages WHERE code = 'tw';
