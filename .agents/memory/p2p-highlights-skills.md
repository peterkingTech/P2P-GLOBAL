---
name: P2P Highlights & Skills Taxonomy
description: Design decisions for lesson text-highlighting and the skills taxonomy/search feature.
---

## Lesson highlighting
- RN has no cross-platform text-selection API, so highlighting is sentence-tap based, not drag-select. Sentences are split client-side and persisted as `start_offset`/`end_offset` character ranges relative to `p2p_lesson_sections.content`.
- `p2p_user_highlights` is the real table (pre-existing, backs `app/highlights.tsx` manual add/delete). Migration 016 added `lesson_id`, `section_id`, `start_offset`, `end_offset`, `color` to support lesson-linked highlights on top of the existing manual-entry flow — don't create a second highlights table.

**Why:** avoids fragmenting highlight storage across two systems; the manual-entry UI and lesson-linked highlights should feel like one feature to the user.

## Skills taxonomy
- Added `p2p_skills` (curated reference table, ~50 rows across 8 categories) and `p2p_profiles.skills text[]` (mirrors the existing `gifts text[]` pattern) rather than a join table — simpler for array-overlap search (`.overlaps()`) and consistent with how gifts already work.
- Client-side taxonomy lives in `constants/skillsTaxonomy.ts` (mirrors DB seed) so the searchable multi-select doesn't need a network round trip.

**Why:** consistency with the existing gifts array pattern outweighed normalized-join benefits at this scale (~50 fixed options).
