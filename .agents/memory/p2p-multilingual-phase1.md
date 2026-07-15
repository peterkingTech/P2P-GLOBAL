---
name: P2P Multilingual Phase 1
description: i18n setup (react-i18next), content language wiring in DataContext, and languages DB table migration.
---

## What was built
Phase 1 of the enterprise multilingual system:

1. **German locale file** — `artifacts/mobile/locales/de.json` mirrors `en.json` (tabs, profile, settings namespaces).
2. **i18n updated** — `artifacts/mobile/lib/i18n.ts` now imports `de.json`; `SUPPORTED_LANGUAGES` includes `"de"`.
3. **DataContext wired** — `loadCurriculum(userId?, languageCode?)` now accepts a `languageCode`. When non-`"en"`, it fetches `p2p_module_translations` + `p2p_lesson_translations` in parallel and overlays titles into `builtModules` / `builtLessons`. Both call sites pass `profile.contentLanguage ?? "en"`.
4. **Settings** — `de` was added to the `LANGUAGES` array in `settings.tsx` in the prior session.

## languages DB table
The `languages` table (code PK, name, native_name, is_rtl, is_active, content_coverage jsonb) must be created manually. SQL migration at:
`artifacts/mobile/db/migrations/002_languages_table.sql`

**Why manual:** `SUPABASE_DB_URL` secret is the HTTP base URL, not a postgres connection string, so psql/Drizzle can't run DDL. No `exec_sql` RPC exists. User must paste SQL into Supabase Dashboard → SQL Editor.

## Phase ordering
- Phase 1 ✅ — content language picker, German translations surfaced via DataContext
- Phase 2 — full UI i18n (remaining screens beyond tabs/settings)
- Phase 3 — AI translation pipeline + `content_translations` table (one row per content item per language)
