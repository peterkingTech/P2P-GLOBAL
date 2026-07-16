---
name: P2P Translation Engine (Phase 3)
description: Unified translation table, AI pipeline via OpenAI, DataContext fallback chain, API routes.
---

# P2P AI Translation Engine

## Scripture Rule (CRITICAL)
`verse_text` is NEVER sent to OpenAI. Only `verse_ref` (e.g. "John 3:16") is included as metadata.
Scripture verse text comes from `p2p_bible_verses_cache` (Phase 5), not from `p2p_content_translations`.
Migration 004 includes SQL to strip any stale `scriptures` keys from metadata JSON.

## Review Gate
Public reads (DataContext + `GET /translations/:type/:id`) filter `status='approved'` only.
AI-generated content lands as `status='draft'` and is invisible to end users until approved by an admin.
Admin approval is done via `/admin/translations` → Review Queue screen or `PATCH /translations/:type/:id`.

## Architecture
- **New table**: `p2p_content_translations` — one row per (content_type, content_id, language_code).
- **Legacy tables preserved**: `p2p_module_translations`, `p2p_lesson_translations` — fallback if new table has no approved row.
- **Job tracking table**: `p2p_translation_jobs` — one row per AI call; tracks status, attempts, cost_usd.
- **Migrations**: 003 = content_translations table; 004 = jobs table + admin RLS + scripture purge — both run in Supabase dashboard.

## API Server
- Engine: `artifacts/api-server/src/lib/translationEngine.ts`
  - `P2P_Global_Bible_Study_Network_OPEN_AI` + gpt-4o-mini. Cost tracked at $0.15/1M input, $0.60/1M output.
  - `getTranslation(type, id, lang, adminMode)` — adminMode=false (default) filters approved only.
  - `translateAndStore` — creates job row, calls AI, stores draft, updates job to completed/failed.
  - `retryJob(jobId)` — re-runs translation for a failed job, increments attempts.
  - `getCoverage(lang?)` — per-type breakdown with approved+draft counts; all languages if lang omitted.
- Routes at `/translations` (in routes/index.ts):
  - Public: `GET /:type/:id`, `POST /batch` — approved only.
  - Admin: `POST /admin/trigger`, `POST /admin/batch-curriculum` (SSE), `GET /admin/jobs`, `POST /admin/retry/:jobId`, `DELETE /:type/:id`, `PATCH /:type/:id`, `GET /admin/coverage`.

## DataContext
- Filters `status='approved'` on `p2p_content_translations` query; falls back to legacy tables for missing IDs.

## Admin Screens (mobile)
- `/admin/translations` — overview: language coverage grid, job status counts, batch translate modal.
- `/admin/translation-review` — review queue: side-by-side English vs AI, Approve/Reject per item.
- `/admin/translation-jobs` — job log: paginated, filtered by status, retry button for failed jobs.
- `lib/apiUrl.ts` — `getApiUrl()` derives API base URL from `EXPO_PUBLIC_API_URL` or `window.location.origin + '/api-server'`.

**Why the fallback chain**: migration SQL runs on Supabase; until it's run, the new table is empty and legacy tables still serve German content correctly.
