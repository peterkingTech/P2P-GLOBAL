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
