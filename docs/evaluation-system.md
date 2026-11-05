# Peer Evaluation System

Authorised human peers review a learner's lesson check (Comprehensive Check) to help them understand and apply God's Word. P2P Global, not the evaluator, decides who evaluates. There is no AI evaluator.

## Phase 0 audit (2026-11-03): what already existed

| Area | What existed | Decision |
|---|---|---|
| Evaluations | `p2p_lesson_evaluations` (migration 007 and later): one row per submission; `status` pending / approved / needs_revision drives lesson progress, credit, fruit and resubmission | **Kept as THE evaluation record.** 229 adds lifecycle columns. |
| Submissions | `p2p_submissions` (per question; `assignment_id`) | **Unchanged.** Never copied, edited or deleted. |
| Assignment | A trigger named an evaluator immediately (anyone who completed the lesson). When nobody qualified, the submission was auto-approved ("first through this lesson"). A pg_cron job reassigned after 72 h. | **Kept for legacy rows and while the engine is off.** The engine replaces it when switched on. |
| Production use (read-only) | 86 pending (56 over 72 h, never reassigned), 113 resolved, 3 evaluators ever, 1 in 90 days | **Safe rollout required:** engine off until evaluators are oriented. |
| Messaging | `p2p_conversations` / `members` / `messages`, with RLS by membership | **Reused:** `conversation_type = 'evaluation'` plus `evaluation_id`. |
| Notifications | `p2p_notifications`, then push dispatch; categories in `lib/notificationCategories.ts`; tap routing in `lib/push.ts` | **Reused:** 9 new types. |
| Scheduling | pg_cron (production) | **Reused:** `p2p-evaluation-sweep` every 5 minutes. |
| Roles | `user_role` enum: student, peer_guide, church_leader, super_admin, admin_supervisor… | Reviewers: anyone who completed the lesson, or `peer_guide` / `church_leader` for chosen subjects. Coordinators: `super_admin` / `admin_supervisor`. |
| Safeguarding | `p2p_minor_contact_allowed`, `p2p_user_blocks`, `p2p_account_status` | **Reused** in every eligibility check. |
| Availability | None | **Created:** `p2p_evaluator_profiles`. |

## Lifecycle (`engine_state`)

```
submitted ─▶ queued ─(eligible evaluator)─▶ invited ─(accept)─▶ in_progress ─(submit)─▶ completed
               ▲                               │                     │
               │ (no one eligible, backoff)    │ decline / expiry    │ unable / 48 h passed / restricted / admin
               └───────────────────────────────┴─────────────────────┘
                          the system picks the next evaluator (never the evaluator)
```

- **Queued:** no eligible evaluator right now. Retries back off (15 min, doubling up to 6 h). The evaluatee is told once that an evaluator is being arranged; coordinators are told once.
- **Invited:** one assignment is active. The invitation window is configurable (default 3 h). The evaluatee doesn't see who was invited.
- **In progress:** `accepted_at` is the server's time and `deadline_at = accepted_at + 48 h` exactly (a database check enforces this). Reminders are sent at 24, 12 and 6 hours left.
- **Completed:** the outcome maps onto the existing model. Passed (with or without recommendations) becomes `approved`. Revision, further discussion or clarification becomes `needs_revision`, and the learner resubmits as today.

### Edge cases

| Case | What happens |
|---|---|
| No eligible evaluator | Stays queued; retries back off; the evaluatee is told it's being arranged; coordinators are told; nobody is ever falsely shown as assigned. |
| Invitation not answered | The sweep expires it and invites the next eligible person (never someone already tried). |
| Declined | The next person is invited at once. |
| Accepted evaluator becomes ineligible (restricted, account inactive, safeguarding) | The sweep replaces them. |
| "Report inability to complete" (reason category required) | The assignment ends, the evaluator loses access, and the system picks the next evaluator. |
| 48 h passed | The sweep reassigns immediately. The evaluator is told privately (no automatic suspension). The evaluatee is told. Escalation goes to coordinators if still unresolved at 12 h and 24 h. |
| Concurrent operations | The evaluation row is locked (`FOR UPDATE`); a unique index allows one active assignment per evaluation; queued work uses `SKIP LOCKED`; a second caller finds the work done. |
| Duplicate notifications | Every notification has an idempotency key in `p2p_evaluation_events`; a repeat is a no-op. |
| Push delivery failure | The existing pipeline (`pushed_at`, cron retries). The in-app notification row exists either way. |

## Security

- **New tables are API-only** (RLS on, no client policies or grants). Engine functions are callable only by the service role.
- **`trg_p2p_eval_guard`:** no client can create engine rows or change who evaluates, deadlines or engine columns. An evaluator on an older app can still resolve their accepted evaluation before the deadline, and it becomes a proper completion.
- **Identity:** `evaluator_id` is filled only on acceptance, so the evaluatee never sees who was merely invited. An invited evaluator sees the lesson and what's expected, but no name or answers.
- **Losing access:** a previous evaluator loses the submission (existing RLS on `evaluator_id`), the workspace (API) and the discussion (membership removed; history kept).
- **What the workspace shows:** only that check's answers, never journals, reflections or notes.

## No extensions, no transfers

There is no extension field, status, notification or route, and no "transfer" or "choose replacement" control. The deadline is always 48 h, and only the engine changes who evaluates. An administrator can trigger a reassignment (with a reason), and the system still chooses who is next.

## Rollout

Migration 229 starts with `engine_enabled = false`, so nothing changes. To switch it on:

1. Apply 229.
2. Ask evaluators to complete the orientation (My Evaluations → Evaluating).
3. Turn the engine on in Evaluation oversight → Settings.

Legacy pending rows keep the old 72-hour sweep. Moving them into the engine is a separate, explicit step that hasn't been built yet.

## Universal engine and exact-resource qualification (migration 240, written 2026-11-05, not applied)

One engine now evaluates every independently assessed resource:

- **Lesson-backed resources:** Kingdom School lessons, Kingdom Stories chapters (any category) and Bible Study Plan sessions, wherever they are studied: alone, in the Learning Centre, in Study Together, in a Family or a Church. Each participant's answers remain their own submission, evaluation and credit. There is never a group grade.
- **Family and Church custom-lesson assignments:** only when *group assignments* is switched on (default **off**, because it changes a family-private workflow). They are evaluated only by current members of that same Family or Church. The leader's own review keeps working and closes the engine evaluation. A resubmission replaces an attempt that is still waiting.

### Who is invited

- **Qualification:** a person may evaluate a resource only if they passed **that exact resource** through an independent evaluation.
  - **Lessons:** the Growth Matrix ledger's `learning.assessment_passed` for that lesson. That means peer-approved, never self-approved, never by the learner, and never from an evaluation with a substantiated concern.
  - **Group assignments:** their own submission to that assignment, reviewed by someone else.
- **No cross-qualification:** passing lesson A never qualifies anyone for lesson B, another chapter, plan or feature.
- **No sign-up:** there is no registration, orientation gate or volunteer list.
  - The commitments are shown on the invitation and recorded on acceptance.
  - The orientation screen remains an optional guide and the place to set availability.
- **Retired routes:** reviewer roles with chosen subjects, and `lesson_progress.completed` (which a client can write), no longer qualify anyone.
- **Safeguarding (unchanged):** never the submitter; active accounts only; no blocks either way; the minor-contact rules; not restricted; available and under capacity; never someone already tried for that evaluation.

### Matching (`p2p_eval_candidates`)

Qualification has one definition, `p2p_eval_qualified_pool(kind, resource)`, which everything reads.

Among the qualified, the score combines these factors, in priority order:

| Priority | Factor | Points |
|---|---|---|
| 1 | Language: same content language | +8 |
| 1 | Language: same app language | +4 |
| 2 | Geography: nearby (≤ 50 km, from voluntarily shared coordinates) | +4 |
| 2 | Geography: same city | +3.5 |
| 2 | Geography: same region | +3 |
| 2 | Geography: same country | +2 |
| 2 | Geography: a time zone within 3 hours | +1 |
| 2 | Geography: anywhere else in the world | 0 (still eligible) |
| 3 | Stage: 1–2 stages ahead | +1.5 |
| 3 | Stage: further ahead | +0.75 |
| 3 | Stage: same stage | +0.25 |
| 4 | Workload: each open evaluation | −2 |
| 4 | Workload: each invitation this week | −1 |
| 4 | Workload: each completion in the last 30 days | −0.5 |
| 4 | Performance: each missed deadline in the last 90 days | −2 |
| 4 | Performance: each expired invitation in the last 30 days | −0.5 |
| 4 | Fairness: never invited before | +0.5 |
| 5 | Variety: evaluated this learner in the last 90 days | −1 |
| 5 | Integrity: a reciprocal partner (the learner recently approved this person's work) | −3 |

- **Stage is a preference only, never a condition.** Peer Guides get no priority.
- **Capacity and availability are hard limits.**
- **Reasons are recorded as labels only**, e.g. `same_city`, never the city itself.

### Assessment versions

- **Recording a revision:** an administrator records a **material** revision of an assessment (`p2p_assessment_revisions`, append-only, with a reason). Evaluation oversight → an evaluation's history → "This assessment was materially revised".
- **Effect:** earlier passes keep their learning credit, but only a pass of the revised version qualifies someone to evaluate it.
- **Duplicates:** passing again never creates a second qualification.

### Integrity

- **Reciprocal pairs:** `p2p_eval_reciprocal_pairs` lists pairs who approved each other's work in the last 180 days.
- **Review:** a coordinator records a decision with a note in `p2p_eval_integrity_reviews`, which is append-only. Nothing happens automatically.
- **Matching:** reciprocal partners are avoided.

### Operations

`p2p_eval_operations()` (Evaluation oversight) reports:
- qualified evaluators, and the resources they cover;
- pending and unassigned evaluations;
- expiries and reassignments in the last 30 days;
- median hours to accept and to complete;
- workload distribution;
- reciprocal pairs awaiting review.

### Learner-facing statuses

| Status | When |
|---|---|
| Searching for a qualified evaluator | Queued |
| Assigned — waiting for the evaluator to accept | Invited |
| Under evaluation | Accepted |
| Approved — feedback ready | Passed |
| Returned for correction | Revision required |
| Reassigned | An invitation expired or was declined, or the evaluator stepped away or ran out of time |

The server sends the label as `statusLabel`.

### Cold start

When nobody has independently passed a resource yet, its evaluations stay queued and are listed under **Who can evaluate what** in Evaluation oversight.

- **Optional bootstrap (owner decision; it departs from the strict "only someone who passed it" rule):** the owner may set *cold-start reviewers* (`bootstrap_roles`, default empty). Those roles may then be invited **only** for resources nobody has passed independently. These invitations are labelled `bootstrap`.
- **Stepping aside:** once anyone qualifies, bootstrap reviewers are no longer invited for that resource.
- **No early re-checks are lost:** when someone newly passes a resource, waiting evaluations of it are re-tried at the next sweep.

### Fresh start for pending evaluations (owner decision, 2026-11-05)

Migration 240 closes every evaluation still **waiting** when it runs (queued or invited) as `cancelled`, with the reason `fresh_start`. In the 2026-11-04 backup that is 86 in the engine, plus 1 older row: Peer-to-Peer Orientation and one Kingdom Stories chapter, from 5 learners.

- **Kept:**
  - Nothing is deleted. Each evaluation keeps its history and gains a `cancelled` event.
  - The learners' answers and lesson progress are untouched.
  - Nobody is notified.
  - Work an evaluator had already accepted would not be touched (there was none).
- **In the app (new build):**
  - A question whose answer's evaluation was closed shows as unanswered, so the learner answers it again and the engine evaluates the new answer from scratch.
  - The lesson no longer shows "awaiting review".
  - Foundations progress shows "Answer the check again for a fresh evaluation".
- **Older builds** keep showing "waiting" for those lessons until they update.

### Safety of the change

- Accepted work is never taken away by the rule change. The sweep checks accepted evaluations for safety only, and open invitations for full eligibility.
- The migration sends no notifications and deletes nothing.

### Tests

- `migrations/tests/240_universal_peer_evaluation.db.test.mjs`: 54 checks on a restored copy.
- API: `peerEvaluation.test.mjs`.
- App: `peerEvaluation.test.mjs`.
