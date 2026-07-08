---
name: P2P RLS Gaps
description: Many p2p_* tables have Row Level Security enabled but no policies defined, causing silent empty reads and hard-fail writes.
---

## Pattern (found 2026-07-08)

Several `p2p_*` tables (curriculum content: curriculums, modules, lessons, lesson_sections,
scriptures, reflection_questions, assignments, languages, and their translation tables) had
`rowsecurity = true` but **zero policies** defined in Postgres.

**Effect:**
- SELECT queries silently return an empty result set (no error) — looks like "no data yet" in the UI.
- INSERT/UPDATE/DELETE hard-fail with `new row violates row-level security policy for table "..."`.

**Why:** whoever created these tables enabled RLS (correct default) but never added policies, so by
default nothing is accessible. This is different from a missing role/permission bug — it silently
masks itself as an empty-state UI until someone tries to write.

**Fix pattern applied (see `migrations/004_content_rls_policies.sql`):** a `p2p_is_admin()` SQL
function checks `p2p_profiles.role != 'student'` for `auth.uid()`. Then per table: SELECT allowed
for any `authenticated` user, INSERT/UPDATE/DELETE gated on `p2p_is_admin()`.

**Also found:** a `p2p_admin_roles` table exists in the DB (separate from `p2p_profiles.role`) but is
completely empty and unused — the app's actual authorization source of truth is `p2p_profiles.role`.
Don't build new admin-gating logic against `p2p_admin_roles` without first confirming it's actually
populated/wired up somewhere; as of this writing it's dead schema.

**How to apply:** if a new table is added and admin screens report RLS errors, or list screens show
"no data yet" while inserts fail, check `pg_policies` for that table before debugging app code —
it's very likely a missing-policy issue, not an app logic bug.

## Same gap found in `p2p_lesson_progress` / `p2p_enrollments` (2026-07-08)

Same zero-policy pattern hit these two tables when wiring real lesson progress tracking. Fixed in
`migrations/005_lesson_progress_rls.sql` (self-access SELECT/INSERT/UPDATE + admin SELECT). Also
had to add a missing `UNIQUE(user_id, lesson_id)` constraint on `p2p_lesson_progress`
(`migrations/006_lesson_progress_unique_constraint.sql`) — Supabase `.upsert(..., { onConflict })`
silently fails to dedupe without a matching unique/exclusion constraint on those columns.
**How to apply:** before using `.upsert()` with `onConflict` on any p2p_* table, confirm a real
unique constraint exists on those columns, not just an assumption from the app model.
