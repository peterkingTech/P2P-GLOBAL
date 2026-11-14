# P2P Plans — one plan system

**Status (2026-11-14):** committed and deployed (API); migrations 249 + 250 applied to production 14:38 UTC. The 4 prepared plans are drafts until editors approve and publish them. The app screens need an app build.

- Tables: `migrations/249_p2p_plans.sql`.
- Prepared plans (drafts awaiting review): `migrations/250_p2p_plans_prepared_drafts.sql` and `docs/p2p-plans-review.md`.

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

## Discovery, the builder and groups (2026-11-14; migrations 251 + 252 applied to production 18:12 UTC — the 20 subjects are drafts awaiting two editors)

- **Discovery** (`api-server/src/lib/planDiscovery.ts`, `routes/planDiscovery.ts` at `/plan-discovery`): a subject (Bible book, Scripture topic, person / event / place / theme record, Core Foundations, a Kingdom School course) → published resources only.
  - **Direct:** an editor's link, a topic's core passages, a subject's own passages, a plan with the same focus, a course's own lessons, a story whose *narrative* is in the chosen book.
  - **Supporting:** Scripture overlap. This covers a story chapter that *retells* one of the subject's passages, a lesson memory verse in it, and a topic's supporting passages.
  - **Further:** commentary and Deep Study for the subject's passages, the dictionary article with the same headword, and stories that only *quote* a verse.
  - Never keyword matching. Every item carries a reason code.
- **Subjects** (people and events) are editorial records (`p2p_study_subjects`, `p2p_subject_resource_links`, both with four eyes). Proposal 252 seeds 20 drafts from P2P's own stories (`scripts/build-study-subjects.mjs`, review guide `docs/study-subjects-review.md`).
- **Builder** (`app/plans/builder.tsx`), five steps:
  1. focus;
  2. content (P2P's journey, or your own picks; Scripture through the Bible reader's `pick=plan` mode);
  3. supporting resources;
  4. schedule and study mode;
  5. review.

  It also handles drafts, and creates are retry-safe through a `clientKey`.
- **Versions:** editing never deletes a session; it is retired. Each run keeps `required_session_ids`, so sessions added later are optional for that run.
- **Groups:**
  - **Routes:** `/study-plans/groups/*` and `POST /study-plans/:id/groups`.
  - **App screens:** `app/plans/group.tsx` and `app/plans/together.tsx`.
  - **Rules:** one active plan per group, completed plans kept as history, and new private groups made atomically by `p2p_create_plan_group`.

## Tests

- API rules and routes: `api-server/tests/studyPlans.test.mjs`
- App logic and screens: `mobile/tests/p2pPlans.test.mjs`
- Migrations 249 and 250 on PGlite: scratchpad `pgtest/run249.mjs`
- Browser render checks: scratchpad `pw/pl_tail.mjs`
