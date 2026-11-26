# Learners with a guide can't submit Module 1: fix proposed in migration 259

**Status:** proposed. Nothing is applied to production, committed or deployed; that waits for the owner's approval.

## What the learner sees

A learner with an active peer guide submits a Module 1 lesson, and the submission fails with `not_authorized`. Learners without a guide can submit normally.

## Root cause

Migration 097 (22 July 2026) added a guard to `p2p_award_fruit`: refuse any `p_user_id` other than `auth.uid()`. The goal was to stop someone calling the function directly from the app to award fruit to somebody else.

But the fruit engine also calls `p2p_award_fruit` **internally**, inside other database functions, to award fruit to someone other than the person whose session is running. Each of those calls hits the guard. The exception rolls back the whole action that triggered it.

| What the user does | Session (`auth.uid()`) | Fruit awarded to | Result before 259 |
|---|---|---|---|
| A learner submits a Module 1 lesson | learner | **guide** (Seed Fruit) | the submission fails |
| A peer evaluator approves a lesson in the app | evaluator | **learner** (Rooted, Module, Endurance…) | the approval fails once a fruit is due |
| The Peer Evaluation Engine approves (API) | none | **learner** | fails the same way |
| A guide is linked to a learner who already began Module 1 | API or other person | **guide** (Seed), **co-guide** (Aquila & Priscilla) | the link fails |
| A peer confirms compassion, service, fellowship or encouragement | confirmer | **the other person** | the confirmation fails |

Engine functions that call `p2p_award_fruit`, with 44 call sites between them:
- `p2p_check_fruit_eligibility`
- `p2p_check_mentor_fruit_eligibility`
- `p2p_check_seed_and_comentor_fruit` (a trigger)
- `p2p_check_teacher_fruit`
- `p2p_check_global_fruit`
- `p2p_process_confirmation`
- `p2p_handle_session_completion` (a trigger)
- `p2p_process_circle_evaluation`

Evaluator approvals haven't failed for real learners yet, because no real learner is past 180 days (the Endurance Fruit threshold). From that day on, every peer approval of their lessons would fail.

## The fix (migration 259)

No table changes and no data changes.

1. **`p2p_award_fruit_system`** contains the award logic, unchanged, without the caller check. Only the engine's own functions and `service_role` can execute it, not `anon` or `authenticated`.
2. **`p2p_award_fruit`**, which the app calls, keeps the "own account only" guard and then calls `p2p_award_fruit_system`. Its signature and results are the same as before.
3. The 8 engine functions call `p2p_award_fruit_system` instead. The migration is generated from their **live** definitions, so only the 44 call sites change.
4. `p2p_check_fruit_eligibility` and `p2p_check_global_fruit` are engine-only (no app or API caller). Migration 259 revokes direct execution, so nobody can run an eligibility sweep for someone else. For example, someone could otherwise award a guide's Seed Fruit without a real submission.

**Migration requirements:** a guarded apply with a backup of the 10 function definitions first (`pg_get_functiondef`). No new grants are needed for tables. **Rollback:** re-create the 10 functions from the backup, then drop `p2p_award_fruit_system`.

## Tests

`migrations/tests/259_fruit_awards.db.test.mjs` runs on a disposable **local** database and refuses to run anywhere else. Locally, it was built from the production schema (structure only, no rows).

Before 259: 11 passed, 22 failed. The run reproduced the reported bug and the other four paths, all with `not_authorized`.
After 259: **33 passed, 0 failed.**

| Area | What's covered |
|---|---|
| Learner with an active guide | The Module 1 submission is saved, and the learner gets their own First Steps Fruit. |
| Attribution | The guide gets the Seed Fruit, never the learner. Its source is the learner's lesson, and the audit row and notification are the guide's. |
| Learner without a guide | The submission is saved, and nobody gets a Seed Fruit. |
| Guide already holds the Seed Fruit | A second learner's submission is saved. There's no duplicate, and the award is logged as already held. |
| Guide linked after the learner began Module 1 | The link succeeds, and the guide gets the Seed Fruit. |
| Approval by the evaluator's session or by the API | Succeeds. The lesson is completed, the learner's fruit goes to the learner, and the evaluator gets none. |
| Peer confirmation | Succeeds. The person who prayed gets the Compassion Fruit, and the confirmer gets none. |
| Security | Awarding fruit to someone else through the app is still refused. Your own award still works. The engine's award function and the eligibility sweep can't be called directly. |

Run it with:

```
GROWTH_TEST_DATABASE_URL=postgres://…@127.0.0.1:…/… GROWTH_TEST_DISPOSABLE=yes PG_MODULE=… node migrations/tests/259_fruit_awards.db.test.mjs
```
