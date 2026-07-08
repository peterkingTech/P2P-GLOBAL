---
name: P2P Schema Additions
description: Tables and columns added in migrations/001_schema_additions.sql — the canonical vs translation split, and the registration profile table.
---

## Migration file

`migrations/001_schema_additions.sql` — must be run manually in the Supabase SQL Editor (no postgres connection string is configured for Drizzle).

## New tables

**Language system**
- `p2p_languages(code PK, name, is_default)` — seeded with en(default), de, es, fr, pt, sw, ar, hi
- Added `app_language`, `content_language` TEXT cols to `p2p_profiles`

**Lesson content (canonical, English)**
- `p2p_lesson_sections(id, lesson_id→p2p_lessons, title?, content, sort_order)`
- `p2p_scriptures(id, lesson_id, verse_ref, verse_text, sort_order)`
- `p2p_reflection_questions(id, lesson_id, question, sort_order)`
- `p2p_assignments(id, lesson_id, title, instructions, sort_order)`

**Translation tables (additive — never modify canonical rows)**
- `p2p_curriculum_translations(curriculum_id, language_code, title, description)` UNIQUE(curriculum_id, language_code)
- `p2p_module_translations(module_id, language_code, title, description)`
- `p2p_lesson_translations(lesson_id, language_code, title, subtitle)`
- `p2p_lesson_section_translations(section_id, language_code, title?, content)`
- `p2p_scripture_translations(scripture_id, language_code, verse)` — verse_ref is NOT translated, only verse text
- `p2p_reflection_question_translations(question_id, language_code, question)`

**Status columns added**
- `p2p_lessons`: `status TEXT CHECK IN ('draft','published','archived')` DEFAULT 'draft', `subtitle TEXT`
- `p2p_modules`: `status TEXT CHECK IN ('draft','published','archived')` DEFAULT 'draft'
- `p2p_curriculums`: `status TEXT` DEFAULT 'draft' (alongside existing `is_published` BOOL)

**Registration**
- `p2p_registration_profiles(id, user_id→p2p_profiles, full_name, email, location_city, location_country, contact?, primary_language, other_languages TEXT[], faith_journey_stage INT 1-5, born_again CHECK IN ('yes','no','other'), born_again_other?, walking_with_christ_duration CHECK IN ('less_than_1_year','1_3_years','3_10_years','10_plus_years'), church_involvement?, follow_up_status DEFAULT 'not_contacted' CHECK IN ('not_contacted','contacted','in_progress','resolved'), admin_notes?, submitted_at)`

## Key design rules

- Canonical rows (English) are NEVER modified by translation saves — translation screens write only to `*_translations` tables.
- `verse_ref` on scriptures is always canonical; only `verse_text` / translation `verse` field is translated.
- Admin curriculum manager screens call Supabase directly (not the Express API) for all CRUD. Express `/api/admin/*` routes exist for external integrations.
