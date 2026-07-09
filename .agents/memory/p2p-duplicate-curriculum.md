---
name: P2P Duplicate Curriculum Rows
description: Three "Foundations of Christianity" curriculum rows exist in the DB; only one is real/active.
---

The `p2p_curriculums` table has 3 rows all titled "Foundations of Christianity" (stray test/duplicate data), plus a stray duplicate `p2p_modules` row (title just "Module 1", order_index 1) with one orphan "Knowing God" lesson under a different curriculum_id.

The app (`DataContext.loadCurriculum` in `artifacts/mobile/contexts/DataContext.tsx`) resolves this by picking whichever `curriculum_id` has the most attached modules — that is the real/active one. As of 2026-07-09 the active curriculum is the one with 13 modules / 104 lessons matching the full "Foundations of Christianity" content (module order_index 0-12).

**Why:** any SQL written directly against `p2p_modules`/`p2p_lessons`/`p2p_curriculums` (bulk content imports, admin scripts, migrations) must replicate this "most modules wins" logic or filter explicitly to the correct `curriculum_id`, or it will silently write to/report on orphaned duplicate data.
**How to apply:** before any bulk write to curriculum/module/lesson content, run `SELECT curriculum_id, count(*) FROM p2p_modules GROUP BY curriculum_id` and target only the curriculum_id with the max count.
