# P2P Plans — one plan system

**Status (2026-11-14):** built and tested locally. Nothing is committed, deployed or migrated.

- The tables are a proposal: `docs/proposals/249_p2p_plans_PROPOSED.sql`.
- The prepared plans are drafts awaiting review: `docs/proposals/250_p2p_plans_prepared_drafts_PROPOSED.sql` and `docs/p2p-plans-review.md`.

## The idea

A plan organises existing resources. It never contains them.

Every plan has **one main focus**:

- a Bible book
- a topic
- a person
- an event
- a theme
- Core Foundations
- Kingdom School
- Kingdom Stories
- Deep Study

Each plan also has **sessions**. A session points at:

- Bible passages, by reference only;
- or an existing resource, by its own id. These include lessons, Kingdom Stories, Scripture topics, Deep Study, commentaries, word studies, dictionary terms and learning-plan curriculums.

A session can also have **supporting resources**. Supporting resources must help with that session's passage or lesson.

## Where things live

| Piece | File |
|---|---|
| Rules (references, questions, scheduling, progress) | `artifacts/api-server/src/lib/studyPlans.ts` |
| API, mounted at `/study-plans` | `artifacts/api-server/src/routes/studyPlans.ts` |
| Together | Study Together, with content type `study_plan` (`lib/sharedStudy.ts`, `routes/studyTogether.ts`) |
| Prepared plans (source) | `artifacts/api-server/data/study-plans/*.json`, built by `scripts/build-study-plans.mjs` |
| App: home | `app/plans/index.tsx` |
| App: details, start and your progress | `app/study-plan/[id].tsx` |
| App: session | `app/study-plan/session.tsx` |
| App: builder | `app/plans/builder.tsx` |
| App: client and helpers | `lib/studyPlansApi.ts`, `lib/studyPlansUi.ts` |
| The Learning Centre's existing topic plans | `app/plans/learning.tsx`. Moved here unchanged; `/plans` is now the P2P Plans home. |

## Rules that must stay true

- **Scripture plans:**
  - A passage opens the existing Bible reader, which keeps the person's translation, audio and highlighting.
  - No Bible text is stored.
- **Study questions:**
  - Questions are shown by default.
  - Show and Hide are display settings only.
  - Nothing is ever submitted or examined.
- **Structured plans** (`derived_from`):
  - The sessions are the real lessons, read live in curriculum order.
  - A session is complete only through the lesson's own records: an independently evaluated assessment pass, or lesson progress marked complete.
- **Progress:**
  - Each person has their own run: duration, pace, start, status, and whether questions are shown.
  - Opening a session completes nothing.
  - Pausing keeps every completion.
  - Resuming or changing the schedule lays out the remaining sessions from today.
  - There is no "late", no streaks and no points.
- **Growth Matrix:** plans write **no** evidence. Completing a session is a plan record only.
- **Together:**
  - Together uses a Study Together shared study for membership, invitations and discussion.
  - Every person still has their own run.
  - One person's completion never counts for anyone else.
- **Editorial workflow for official plans:** draft → under review → approved (by a *different* editor) → published → archived.
- **Participant plans:**
  - They are private.
  - They are shown as the person's own.
  - They can never be published as official P2P curriculum. The database enforces this.
- **Schedules:**
  - Too many sessions on one study day is refused with a 422 that explains why and suggests a longer schedule.
  - The person can keep their choice knowingly.

## Tests

- API rules and routes: `api-server/tests/studyPlans.test.mjs`
- App logic and screens: `mobile/tests/p2pPlans.test.mjs`
- Migrations 249 and 250 on PGlite: scratchpad `pgtest/run249.mjs`
- Browser render checks: scratchpad `pw/pl_tail.mjs`
