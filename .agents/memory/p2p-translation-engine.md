---
name: P2P Translation Engine (Phase 3)
description: Unified translation table, AI pipeline via OpenAI, DataContext fallback chain, API routes.
---

# P2P AI Translation Engine

## Architecture
- **New table**: `p2p_content_translations` — one row per (content_type, content_id, language_code).
  content_type enum: curriculum, module, lesson, section, scripture, question, assignment, quiz, devotional, journal.
- **Legacy tables preserved**: `p2p_module_translations`, `p2p_lesson_translations` — not dropped; used as fallback.
- **Migration SQL**: `artifacts/mobile/db/migrations/003_content_translations.sql` — must be run manually in Supabase.

## API Server
- Engine: `artifacts/api-server/src/lib/translationEngine.ts`
  - Uses `P2P_Global_Bible_Study_Network_OPEN_AI` secret + `gpt-4o-mini` model.
  - Admin writes via service-role client (`SUPABASE_SERVICE_ROLE_KEY`). Falls back to anon key if not set.
  - Key functions: `getTranslation`, `getBatchTranslations`, `translateAndStore`, `batchTranslateCurriculum`, `getCoverage`.
- Routes: `artifacts/api-server/src/routes/translations.ts` mounted at `/translations` in routes/index.ts.
  - `GET /translations/:contentType/:contentId?lang=de` — fetch (pass `auto=true` to trigger AI if missing).
  - `POST /translations/batch` — batch fetch for multiple IDs.
  - `POST /translations/admin/trigger` — admin AI trigger for one item.
  - `POST /translations/admin/batch-curriculum` — SSE stream for batch curriculum translation.
  - `GET /translations/admin/coverage?lang=de` — coverage stats.

## DataContext
- `loadCurriculum` in DataContext.tsx queries `p2p_content_translations` first (via single `.in("content_id", allIds)` call), then falls back to legacy tables for any IDs not found.
- New table wins; legacy is only used for IDs missing from the new table.

**Why the fallback chain**: migration SQL runs on Supabase; until it's run, the new table is empty and legacy tables still serve German content correctly.
