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
- `p2p_reflection_questions(id, lesson_id, question, display_order)` — ordering column is `display_order`, NOT `sort_order` (differs from this migration file's original intent).
- `p2p_assignments(id, lesson_id, title, instructions, due_after_days)` — no `sort_order`/ordering column; one row per lesson.

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

## Real p2p_profiles schema vs. app assumptions (corrected 2026-07-08)

The real deployed `p2p_profiles` table columns are: `id, email, full_name, photo_url, role (enum user_role: student/peer_guide/church_leader/regional_director/global_admin/super_admin, default student), country, language (default 'en'), church_id, created_at, streak_days, last_active_date, app_language, content_language`, plus `growth_level int default 0`, `gifts text[] default '{}'`, `is_praying boolean default false` (added in `migrations/002_fix_profile_rls.sql` because the UI already depended on them but they were missing from the deployed table). There is no `display_name`, `language_code`, or `city` column — the app-level camelCase names map to `full_name` and `language` respectively; `city` has no DB equivalent.

`p2p_profiles` originally had RLS enabled with only a SELECT policy — no INSERT/UPDATE policy — so `AuthContext.signUp`'s upsert was silently blocked and no profile row was ever created, which caused `p2p_registration_profiles_user_id_fkey` violations downstream in the intake form. Fixed in `migrations/002_fix_profile_rls.sql` by adding `auth.uid() = id` INSERT/UPDATE policies.
**Why:** always verify RLS policies (not just table existence) when a Supabase write silently "succeeds" but no row appears — check `pg_policy` for the table, not just column names.
**How to apply:** before writing to any Supabase table from client code, confirm real column names AND that INSERT/UPDATE policies exist, don't assume from app code or docs.

## p2p_notifications real schema vs. assumed (corrected 2026-07-08)

Real columns are `id, user_id, title, message, read (bool), created_at` — there is no `type` or `body` or `is_read` column, even though existing API route code (`notifications.ts`) and a newly-written migration trigger both assumed `type`/`body`/`is_read`. Also had zero RLS policies (silent-block pattern, see above) until fixed.
**Why:** this table's real shape doesn't match the naming convention used elsewhere (`is_*` prefix for booleans is not followed here); assuming column names from sibling tables' conventions caused a runtime `column does not exist` error caught only by an end-to-end DB test.
**How to apply:** always query `information_schema.columns` for the exact table before writing SQL functions/triggers or API routes against it — never infer from naming patterns in other tables.

## p2p_lesson_progress real column is `completed`, not `is_completed`

Confirmed via working `DataContext.tsx` queries (`.select("lesson_id,completed")`). The stale Drizzle schema file (`lib/db/src/schema/p2p.ts`) is NOT authoritative and should not be trusted for real column names — always verify against `information_schema.columns` or working app code.

## More real column names vs. stale Drizzle schema (corrected 2026-07-09)

- `p2p_modules`: real columns are `id, curriculum_id, title, description, order_index, created_at, status` — no `level`, `lesson_count`, `image_url`, `sort_order` (ordering column is `order_index`, not `sort_order`).
- `p2p_lessons`: real columns are `id, module_id, title, subtitle, order_index, status, created_at` — no `content`, `verse_ref`, `verse_text`, `sort_order` (those live in `p2p_lesson_sections`/`p2p_scriptures`; ordering is `order_index`).
- `p2p_discipleship_links`: real columns are `id, mentor_id, disciple_id, assigned_by, active, created_at` — boolean column is `active`, not `is_active`; there is no `started_at`. An API route (`discipleship.ts`) had been written against the wrong names and was silently failing.
**Why:** the Drizzle schema file in `lib/db/src/schema/p2p.ts` is aspirational/stale across most P2P tables, not just profiles — treat it as documentation-only.
**How to apply:** before writing any new SQL trigger/function or API route touching a `p2p_*` table, run `select column_name from information_schema.columns where table_name = '...'` first — every session this has been skipped has cost multiple failed-migration round trips.

## pg_cron requires explicit extension creation on this Supabase project

`select cron.schedule(...)` fails with `schema "cron" does not exist` unless `create extension if not exists pg_cron;` is run first in the same or a prior migration — the extension being "available" (listed in `pg_available_extensions`) does not mean it's enabled.

## Prayer & Testimonies wall (added 2026-07-09)

New tables `p2p_prayer_wall_posts` (post_type request/testimony, nation_code, is_anonymous, visibility global/peer_group, answered_from_post_id self-FK, status open/answered), `p2p_prayer_wall_reactions` (praying/amen, unique per user+post+type), `p2p_prayer_wall_comments`. All have RLS. "Peer group" visibility is defined by a `p2p_is_peer(a,b)` SQL function (active discipleship link either direction, OR same non-null `church_id`) — there was no existing peer-group concept in the schema, so this was invented for this feature; keep it in mind if peer-group semantics are needed elsewhere. Reacting to a post increments the reactor's `servant_score` by 1 via `p2p_increment_servant_score` RPC (SECURITY DEFINER, since profile UPDATE RLS only allows self-updates and reactions need to touch your own row anyway — but the RPC exists so this pattern can be reused for other score-increment actions without duplicating logic). This coexists with the older, narrower `p2p_prayer_requests` table (used by nothing now) — not migrated/removed since it wasn't requested.

## Key design rules

- Canonical rows (English) are NEVER modified by translation saves — translation screens write only to `*_translations` tables.
- `verse_ref` on scriptures is always canonical; only `verse_text` / translation `verse` field is translated.
- Admin curriculum manager screens call Supabase directly (not the Express API) for all CRUD. Express `/api/admin/*` routes exist for external integrations.
