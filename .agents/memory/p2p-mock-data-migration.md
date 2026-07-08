---
name: P2P Mock Data Migration
description: The mobile app's learning UI (levels, modules, lessons) ran entirely on hardcoded mock arrays disconnected from Supabase; how the real curriculum is selected and gated.
---

## What was found (2026-07-08)

`DataContext.tsx`, `module/[id].tsx`, and `lesson/[id].tsx` used hardcoded `MOCK_MODULES` /
`MOCK_LESSONS` / `LESSON_CONTENT` arrays instead of querying Supabase. This caused visible bugs
(e.g. duplicate "Level 1" badges) that looked like a UI/data bug but were actually mock data with
a copy-paste mistake, fully disconnected from the real `p2p_curriculums` → `p2p_modules` →
`p2p_lessons` tables. Real progress (`p2p_lesson_progress`) was also not being written anywhere.

**How to apply:** when a screen shows implausible or duplicated data (same label twice, counts
that don't match the DB), grep for `MOCK_` / hardcoded arrays in that screen's context/component
before assuming the bug is in query logic — the fetch may not be wired up at all.

## Curriculum selection logic

There were 4 rows in `p2p_curriculums`: two empty stray drafts, one empty published "GREAT
FAITH", and one real published "Foundations of Christianity" (13 modules / 104 lessons). Since no
single curriculum is flagged as "the" active one, the code picks the **published curriculum with
the most modules** as the active curriculum, rather than hardcoding an ID. If more curriculums are
added later and this heuristic breaks, consider adding an explicit `is_active` flag instead.

## Progressive unlocking model

- Module N is locked unless module N-1 is 100% complete (module 1 always unlocked).
- Within an unlocked module, lesson N is locked unless lesson N-1 is complete (lesson 1 always
  unlocked).
- `level` shown in the UI is computed as `moduleIndex + 1` (sequential, unique) rather than read
  from a DB column, so it can never duplicate regardless of underlying module data.
