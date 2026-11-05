# Growth Milestone Matrix (calculation version 2)

Migration `239_growth_milestone_matrix.sql`, written 2026-11-05. **Not applied.** Promotions stay **off**.

Milestones record observable participation, assessed learning, practical application, and contribution on P2P Global. They never measure a person's relationship with God, their faith, or their worth.

## What is authoritative

| Concern | Single source |
|---|---|
| Thresholds | `p2p_growth_matrix`, calculation version 2. Changed only by `p2p_growth_set_threshold`, only while the matrix is a draft, always with a reason; every change is logged in `p2p_growth_matrix_changes`. |
| Evidence | `p2p_growth_evidence`, an append-only ledger written only by `p2p_growth_sync_evidence` from trusted records. |
| Evidence kinds | `p2p_growth_evidence_types`: the dimension of each kind, whether it counts toward a total, whether it marks a week as active, and whether it needs review. |
| Calculation | `p2p_growth_facts` → `p2p_growth_evaluate` → `p2p_growth_recalculate`. This is the only code that changes a stage. |
| Tunables | `p2p_growth_settings`. |

The API (`lib/growthStages.ts`) and the app hold **no thresholds of their own**. A test enforces this (`growthMatrixMigration.test.mjs`).

## The four dimensions

Every requirement in every dimension must be met. A surplus in one dimension never makes up for a shortfall in another.

### Consistency
- **Active week:** a week with at least one meaningful piece of evidence. Weeks and months use the participant's local date *at the time of the event*.
- **What counts as meaningful:**
  - answers submitted;
  - reflections submitted;
  - passed assessments;
  - practical actions and contributions;
  - group learning attended for 10 minutes or more;
  - completed Scripture listening of 60 seconds or more;
  - prayer participation **recorded by the server**.
- **What never counts:** views, sign-ins, `last_active_at`, phone-written activity events.
- **Pauses:**
  - A mostly-paused week with no activity is skipped, so the rolling window reaches further back.
  - Paused days are not counted toward time at a stage.
  - Limits: at most 92 days per pause and 90 days per year.
  - A pause can be backdated by at most a week.
  - Pause history is kept.

### Learning (assessed learning only)
- **The unit:** the learning unit is the **lesson**, whatever the resource: a Kingdom School lesson, a Kingdom Stories chapter (any category), or a Learning Plan session.
- **When a unit counts:** once, when **every** question of its assessment has a latest answer approved by a peer evaluator. That approval must not be self-approved, must not be by the learner, and must not come from an evaluation with a substantiated quality concern.
- **Recorded but never credited:** attempts and answers returned for revision.
- **Retries:** passing again adds nothing.
- **Lessons without an assessment** earn nothing. Administrators see them in **Learning units and assessments**. Today every published lesson has an assessment: 2,014 units, including all 84 Core lessons.
- **Forest Builder** also needs **every published Core Curriculum lesson** passed (expected: 84). Other pathways cannot substitute.

### Application (verified practical actions, existing workflows only)
- **Practical answers:** an answer to an assessment question that an administrator marked practical (`is_practical`), approved by a peer. Counted once per question.
- **Group assignments:** a Family or Church group assignment reviewed by someone else. Counted once per assignment.
- **Confirmed actions:** a service or compassion action confirmed by the other person. Counted once per confirmer per 30 days.
- **Not introduced:** forms, diaries, uploads or self-reports. No private content is read.

### Service & Contribution
- **What counts:**
  - **Feedback:** useful written feedback given as an evaluator (20 characters or more, or structured feedback).
  - **Facilitation:** leading a live study session, hosting a Family learning gathering, or hosting a Study Together study. Each counts as **one** event for the facilitator, with at least one other participant for 10 minutes or more (or responding). It never counts once per attendee.
  - **Confirmed support:** support confirmed by the person helped, once per confirmer per 30 days.
- **Never double-counted:** a confirmation of an evaluation or of a session already credited adds nothing.
- **Never counted:** attendance alone, group creation, assigning a Guide, or messages alone.
- **Beneficiaries:** recorded separately in `p2p_growth_evidence_beneficiaries`, with a stable pseudonymous `learner_key`.

## The matrix

| | Seed → Sprout | → Young Tree | → Fruitful Tree | → Forest Builder |
|---|---|---|---|---|
| Consistency | 30 days · 4 active weeks · 2 months | 3 months at Sprout · 10 of latest 16 weeks · 3 months | 6 months at Young Tree · 18 of latest 26 weeks | 6 months at Fruitful Tree · 18 of latest 26 weeks |
| Learning | 10 units | 20 | 50 | 100 + all Core Curriculum lessons |
| Application | 10 actions | 20 | 50 | 100 |
| Service & Contribution | 10 contributions | 20 | 50, plus one learner helped over 3 months who developed, plus a second-generation contribution | 100, plus one learner helped over 6 months who developed, plus second-generation contributions sustained over 3 months |

**Definitions:**
- **"Over N months":** contributions in N different calendar months, with the first and last at least (N − 1) × 28 days apart.
- **"Developed":** the learner passed at least 3 learning units after the support began.
- **"Second generation":** that learner's own verified contribution to someone other than the original contributor.
- **If a learner leaves:** their last verified development level is kept (`p2p_growth_learner_development`).
- **Guide changes:** each Guide keeps only their own verified contributions. Credit is never inherited or transferred, and relationship history is never deleted.

## Guides

- **Eligibility:** `p2p_growth_guide_eligibility` reports, for every active or paused relationship, whether the Guide's stage is strictly higher than the participant's.
- **Enforcement:** blocking a new or resumed relationship with an ineligible Guide is controlled by `enforce_guide_stage`, now **on by default** (see "Mentorship history" below). Existing relationships are never ended by it.
- **No artificial promotions:** Guides are never promoted to preserve a relationship.

## Integrity changes for phone writes (older builds keep working)

No client permission was revoked. A trigger now applies to requests made with a person's own token:

| Table | What changes |
|---|---|
| Answers | The time is set by the server; they can't be re-targeted. |
| Evaluations | The resolution time is set by the server. The submitter, submission, lesson and `self_approved` can't be changed. |
| Peer confirmations | A confirmer can only confirm or decline, at the server's time. |
| Family gatherings and participants | Start, end, join and leave times are set by the server. |
| Activity events | `origin` is `client` or `server`, set by the database. A phone can't relabel or backdate an event. Older rows are `unknown` and never count. |

The engine ignores `p2p_lesson_progress.completed`, plan enrolments, and phone-written activity, so those can't earn credit even though older builds still write them.

## Previous formulas

- **Legacy branch removed:** the branch in `p2p_growth_recalculate` that raised stages from `growth_level` is gone.
- **Old triggers frozen:** the 010/088 `growth_level` triggers are frozen (`legacy_formula_frozen = true`).
- **Mirror only:** `growth_level`, which older builds read, now only follows the official stage upward when a promotion happens.
- **Legacy stages kept:** stages marked `legacy_unverified` are kept and are never lowered. `p2p_growth_reconcile_legacy()` re-checks them from trusted history, and that never raises anyone.
- **Remaining visualisation:** the 113 `tree_growth_score` triggers still feed the Living Tree drawing only. They never decide a stage.

## Forest of Nations

- **Source:** `p2p_growth_collective()` provides milestone counts and monthly participation totals.
- **Small groups suppressed:** any group with fewer than 5 people (`collective_min_cell`) is shown as "<5".
- **Countries:** counted only for people who explicitly opted in (`share_country_in_collective`, default off), and only where a country has at least 5 such people.
- **Not consent:** `show_country_on_profile` (default on) is not treated as consent.

## Rehearsal results (disposable local copy of the 2026-11-04 production backup, with 232 → 239 applied)

- **Migration:** applies in about 2–3 seconds. It re-checked 42 people and recorded 359 evidence records from trusted history.
- **Stages:** **no stage changed** (14 verified Seed; 28 legacy kept). No `growth_level` changed.
- **Backfilled learning:** only **10 learning units, for 2 people**. 50 of the 111 historical approvals were self-approved, and 6 had no evaluator.
- **Backfilled feedback:** no peer feedback qualified as "useful feedback", because every historical peer approval had feedback under 20 characters.
- **Core audit:** 84 published Core lessons, all with an assessment of 4–10 questions.
- **Performance:** a recalculation takes about 80 ms per person. The queue worker processed 117 people with 0 errors.

## Applying (owner approval required at every step)

1. Back up production with the guarded procedure (fresh `pg_dump`, checksummed).
2. Run the restore rehearsal on that backup: apply 232 → 239, then run `migrations/tests/239_growth_matrix.db.test.mjs` against the disposable copy. Expect 0 failures.
3. **Apply 239 before the API deploy.** Railway deploys `main` automatically, so apply the migration first, then push.
4. Verify:
   - `select calc_version, thresholds_status, promotions_enabled, legacy_formula_frozen from p2p_growth_settings` returns `2, draft, false, true`;
   - stage and `growth_level` counts are unchanged;
   - the queue has no errors.
5. Push → the API deploys. Older app builds keep working (same response shape, new fields added).
6. App build for the new milestone screen and Admin Centre panels (needs approval).
7. Owner reviews the matrix in the Admin Centre, approves it, then decides separately whether to switch promotions on.
8. Optional owner decisions:
   - mark practical questions;
   - decide whether to keep `enforce_guide_stage` on (the default);
   - set evidence types to `requires_review`;
   - enable exceptions (each needs two administrators).

**Rollback:** see the end of the migration. Nothing is deleted. Re-running the 236 function definitions restores version 1, and the new tables can stay unused.

## Known gaps (the app does not yet capture the evidence)

- **Bible reading:** the Reader stores nothing on the server, so reading time and chapters can't count.
- **Listening:** only Scripture playlist listening is recorded on the server.
- **Church calls and peer-circle sessions:** no attendance-quality record, so they don't count yet.
- **Family/Church group lesson completions** are marked by one person, so they don't count as anyone's evidence.
- **No practical questions are marked yet,** so Application is 0 for everyone until administrators mark them.
- **Contribution confirmations** depend on people using the existing peer-confirmation prompts.
- **Evaluator capacity:** there is one evaluator profile and 87 evaluations pending. Waiting for an evaluator delays learning credit.

## Stage objectives, visible progress and Core Foundations (written 2026-11-05)

### Stage objectives

`lib/growthStages.ts` `STAGE_OBJECTIVES`. They are shown on the milestone screen. They describe what each stage develops and **add no requirement**.

| Stage | Objective |
|---|---|
| Seed | Establish your foundation |
| Sprout | Develop and strengthen |
| Young Tree | Become established and help others |
| Fruitful Tree | Develop others who develop others |
| Forest Builder | Build lasting generational impact (including every Kingdom School Foundations lesson) |

Forest of Nations is shown as a collective objective, never an individual stage.

### Progress display

- **Format:** each requirement is shown as `have / need — percent` with its own bar and what remains, e.g. "8 more learning units to go".
- **No averaging:** percentages belong to one requirement and are never averaged across dimensions. Each dimension opens on its own, and eligibility shows only when every requirement is met.
- **Zero requirements:** a requirement of zero reads 100%.

### Kingdom School Foundations (the Core Foundations Curriculum)

**Definition (owner decision, 2026-11-05):** Foundations is **everything in Kingdom School Foundations**.
- It means every published lesson in every published Kingdom School curriculum (`type = 'core'`), via `p2p_growth_foundation_lessons()`.
- Today that is **188 lessons**:

  | Curriculum | Lessons |
  |---|---|
  | Peer-to-Peer Orientation | 6 |
  | The Gospel & Salvation | 84 |
  | The Christian Foundation | 98 |

- Lessons published later in Foundations are included automatically. Draft and archived curricula are not part of it.

**How it shows and counts:**
- `GET /growth/me/core-foundations` and `p2p_core_curriculum_progress` show every lesson, grouped by curriculum then module, visible from Seed.
- **Statuses:**
  - Passed (independently evaluated);
  - Awaiting evaluation;
  - Returned for correction;
  - Answer again (closed at the fresh start);
  - Not yet passed (e.g. an older self-approval);
  - Assessment submitted;
  - In progress;
  - Not started.
- **The Forest Builder gate:** all Foundations lessons are required, but only for Forest Builder, as a requirement separate from general learning units. The matrix minimum is 1; the need is however many Foundations lessons are published.
- **One pass, two requirements:** the same pass is one evidence event that counts toward both.

### Mentorship history (migration 241)

- **Checkpoints:** `p2p_mentorship_checkpoints` is append-only. It records both people's verified stage at the start of every designated relationship, at every stage change of either person while it lasts, and at its end. Records are written as things happen and never reconstructed.
- **Existing relationships** (8 in the backup) have a start record marked *unavailable*, plus a *baseline* recorded now.
- **Corrections** are new checkpoints that point at the original.
- **History view:** `GET /genealogy/history/:personId` (and the Development history screen) shows:
  - Guides, current and previous, with checkpoints and the contributions made inside each relationship (never transferred);
  - everyone who verifiably helped, Pastors and Shepherds included only through evidence;
  - the people helped, and whether they now help others.

  You can open your own history, and the history of anyone in your relationships or lineage. Names follow each person's privacy settings.
- **Guide rule:** `enforce_guide_stage` is now **on by default**. A designated Guide must be at a strictly higher stage than the participant when a relationship becomes active. Smart Match only offers such Guides. Existing relationships are never ended by the rule.

### Study Together

- **Coverage:** every lesson screen already offers it (Kingdom School, Bible Study Plans, Learning Centre, and Family and Church lessons), as do Kingdom Stories stories.
- **Chapters:** a single story chapter can now be studied together, starting at that exact chapter.
- **Resource identity:** each study reports its exact resource (feature, lesson id, chapter, version).
- **Individual credit:** studying together never completes anyone's assessment.
