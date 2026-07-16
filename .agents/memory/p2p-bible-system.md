---
name: P2P Bible Verse System
description: Phase 5 licensed Bible verse lookup — tables, service, routes, mobile client, LessonDetailScreen integration
---

# P2P Bible Verse System (Phase 5)

## Tables (migration 005)
- `p2p_bible_translations` — registry of licensed translations per language. Column `api_bible_id` holds the API.Bible internal ID.
  - `is_licensed_confirmed = true` required before a row is used (gate against unverified translations).
  - `is_default_for_language = true` marks which translation to use when the user picks that language.
  - Seeded: KJV (en, api.bible), LUT (de, api.bible) — api_bible_id values are EXAMPLES, must be verified via API.Bible `/bibles` endpoint.
- `p2p_bible_verses_cache` — verse text cached by (translation_code, book, chapter, verse). Public read, service-role write.

## API Server
- `lib/bibleService.ts` — `getVerseText(ref, lang)`, `getBatchVerseText(refs[], lang)`, `parseVerseRef(raw)`.
  - Fallback chain: target language → English KJV → null. Never AI-generates verse text.
  - `parseVerseRef` maps common book names + abbreviations to USFM codes (GEN, JHN, REV etc.).
  - Fetches from `API_BIBLE_BASE/bibles/{apiBibleId}/verses/{verseId}` with `content-type=text`.
  - `API_BIBLE_KEY` secret must be set — without it, returns null (falls back to stored English in LessonDetailScreen).
- `routes/bible.ts` — mounted at `/bible` in routes/index.ts.
  - `GET /bible/verse?ref=John+3:16&lang=de`
  - `POST /bible/batch` — body `{ refs: [{id, ref}], lang }`
  - `GET /bible/translations?lang=de`
  - `POST /admin/bible/warm` — requireAdmin, warms cache manually

## Mobile
- `lib/bibleClient.ts` — `fetchVerseText(ref, lang)`, `fetchBatchVerseText(refs[], lang)`, `clearVerseCache()`.
  - Session-level in-memory cache (Map) to avoid duplicate network calls.
  - Returns null for `lang === 'en'` (English served directly from `p2p_scriptures.verse`).
- `app/lesson/[id].tsx` — imports `fetchBatchVerseText`; after scriptures load, batch-fetches translated verse text.
  - Keyed by scripture row id; `versesFetchedForLang` ref prevents redundant fetches.
  - Display: `verseTexts.get(s.id)?.text ?? s.verse` — graceful fallback to stored English.
  - Shows `(KJV)` / `(LUT)` etc. attribution next to the reference when a translation is served.

## Critical: API.Bible IDs must be verified
The seeded `api_bible_id` values in 005 are placeholder examples.
Verify real IDs by calling: `GET https://api.scripture.api.bible/v1/bibles?language=eng` (for KJV)
and `GET https://api.scripture.api.bible/v1/bibles?language=deu` (for LUT).
Update `p2p_bible_translations` with the correct IDs via Supabase dashboard or a migration.

**Why:** API.Bible's verse endpoint uses its own internal Bible ID, not the translation code. Wrong IDs → 404 on every verse fetch.
