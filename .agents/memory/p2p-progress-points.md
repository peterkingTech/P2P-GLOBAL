---
name: P2P Progress & Points System
description: Unlock/approval split logic, points currency structure, servant→service rename, dashboard screen, and what still needs the DB migration.
---

## Unlock split (Item 2) — app code only, no DDL needed
- Submission (pending eval) unlocks NEXT regular lesson immediately.
- `evaluationStatus === "pending"` is tracked via `p2p_lesson_evaluations` and already fetched in DataContext `loadCurriculum`.
- `allPrevCompleted` tracker gates the LAST lesson in each module — it stays locked until all prior lessons are `completed=true` (approved), not just submitted.
- Same logic applied to Plans via `plan/[id].tsx` + `p2p_plan_lesson_evaluations` fetch.
- % complete and Living Tree points only change on `completed=true` (approval).

## Points currency (Item 3)
- `wisdom_points` column already exists in `p2p_profiles` DB.
- `servant_score` column exists; renamed to `service_score` in app code (UserProfile interface); DB column rename is in migration 026 (needs manual run).
- AuthContext: field is now `serviceScore` (reads `servant_score` column until migration runs) + new `wisdomPoints` field.
- Points spec: core lesson approved = +10 wisdom_points; plan lesson approved = +15 wisdom_points; reflection submitted = +5 wisdom_points (instant); evaluator resolves = +5 service_score.
- All point triggers are in `migrations/026_service_score_wisdom_points.sql` — must be run manually in Supabase SQL Editor.

## Evaluator accountability (Item 4)
- 72-hour auto-reassignment already exists via `p2p_reassign_stale_evaluations()` (pg_cron, hourly).
- Reassignment notification SQL is in migration 026 (commented template, requires verifying existing function body first).
- Zero deduction on reassignment — original evaluator simply forfeits unearned credit.

## Dashboard screen (Item 5)
- New screen at `app/progress.tsx` — grouped: Needs Revision (urgent), To Review (link to evaluations.tsx), Awaiting Evaluation, Recent Approvals, Plans In Progress.
- Entry points: "My Progress" row in `profile.tsx` + "My Progress" tile in `index.tsx` (home tab More section).
- Count badge shown in header of progress screen.
- Home tab already has eval card with count badge (pendingEvaluations).

## DB migration
- File: `migrations/026_service_score_wisdom_points.sql`
- Must be run manually in Supabase SQL Editor.
- After running: update `AuthContext.tsx` mapProfileRow from `row.servant_score` → `row.service_score` and remove backward-compat note.
- Also update DataContext `p2p_increment_servant_score` RPC call → `p2p_increment_service_score`.

**Why:** Keeping unlock/approval split in app code avoids new DB columns. DB migration isolated to triggers and column rename for clarity.
