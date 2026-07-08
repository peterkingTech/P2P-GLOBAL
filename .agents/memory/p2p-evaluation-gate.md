---
name: P2P Peer-Evaluation Gate
description: How lesson completion is gated behind peer evaluation approval — status vocabulary, self-approval edge case, and where completion actually gets flipped.
---

## Status vocabulary

`p2p_lesson_evaluations.status` is `'pending' | 'approved' | 'needs_revision'` (NOT `'revision_requested'` — that was the first name tried and was renamed everywhere: DB check constraint, credit trigger, and all mobile code/types).

## Completion is DB-driven, not client-driven

`p2p_lesson_progress.completed` is flipped by a `SECURITY DEFINER` trigger (`p2p_apply_evaluation_outcome`, fires on insert/update of `p2p_lesson_evaluations.status = 'approved'`) — never by client code. This is required because the evaluator (who approves) has no RLS permission to write to the *submitter's* progress row; only a security-definer trigger running as an elevated role can do it.
**Why:** client-side "resolveEvaluation" can only ever touch rows the acting user owns under RLS; cross-user side effects of an approval must happen in the DB, not the app.
**How to apply:** any future cross-user side effect (e.g. awarding points to someone other than the acting user) should be a DB trigger, not an app-layer write.

## Self-approval edge case

If `p2p_pick_evaluator` finds no one who has completed the lesson yet (first learner through), the assignment trigger inserts the evaluation row already `status='approved', self_approved=true, evaluator_id=submitter_id`, with a feedback note "First through this lesson — unevaluated, auto-approved." The notify-evaluator trigger only fires `when new.status = 'pending'`, so self-approval correctly sends no notification.

## Test lesson/user notes

Real test accounts in this project: `test1@gmail.com` (student, id `d11a6127-...`) and `officialezepetervictor@gmail.com` (super_admin, id `6310e094-...`). Both have accumulated real completed-lesson progress from manual testing — always query `p2p_lesson_progress` for a lesson before assuming "nobody has completed this" when picking a test lesson for the self-approval path.
