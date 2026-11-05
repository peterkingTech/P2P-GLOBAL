# P2P Global — Growth Milestone Matrix Review

*Design and inspection only (2026-11-05). Nothing in the application, database or thresholds has been changed. Promotions stay **off**.*

---

## 1. Executive summary

**Where things stand:**
- **Already live:** the growth engine (migrations 235–237, live since 2026-11-04) works out each person's stage from dated evidence across four dimensions.
- **Draft, and too narrow:** its matrix is still a **draft**, and it has two weaknesses:
  1. Discipleship is required **only** for Forest Builder.
  2. "Spiritual fruit" is mostly counted activity. Prayer and Scripture *views* even count, and nothing a person confirms about another is used.

**This review proposes a revised framework in which:**
- **All four dimensions** (consistency, learning, spiritual fruit, discipleship impact) **are required at every stage**, rising gradually.
- **Consistency** means **time in the current stage** *plus* **recent, sustained active weeks**, never account age or one busy week. Reaching Forest Builder takes at least about **16 months**.
- **Learning** counts only **completed** lessons and modules, and **answers a peer has reviewed and approved**.
- **Spiritual fruit** has three separate kinds of evidence:
  1. spiritual **disciplines** (automatic);
  2. **application** (reflections and assignments);
  3. **confirmation by another person**, using the existing peer-confirmation system, which already exists and is tied to real interactions.

  Software never claims to measure someone's walk with God.
- **Discipleship impact** grows from *being willing to be guided* (Dormant Seed) to *guiding a disciple who keeps growing for six months* (Forest Builder). The early stages never depend on someone else accepting an invitation.

**Supported today vs needed:** about half of the proposed requirements can be measured now. The rest need a **small, focused data change** (§11): new evidence counts in the existing engine, rolling time windows, peer confirmations, one new confirmation type and a calculation version bump. No new tracking or monitoring is involved.

**Recommendation:** approve the framework in principle, then approve a separate implementation phase (§13). **Keep promotions off** until that phase is finished and rehearsed.

---

## 2. Biblical and product principles

1. **Everyone is learning from someone and helping someone grow.** Being guided and helping others both appear at *every* stage, in forms that suit a person's maturity.
2. **Fruit is the Spirit's work, not a score** (Galatians 5:22–23; John 15:4–5).
   - The system recognises *evidence that people can see* (faithfulness in practice, application of the Word, service that others confirm).
   - It never claims to measure love, faith or the Holy Spirit.
   - A stage is a **discipleship indicator**, not a statement of anyone's spiritual worth (1 Samuel 16:7).
3. **Faithful over time** (Psalm 1:3; Galatians 6:9; Luke 16:10). Growth is seasons of rootedness, not bursts of activity.
4. **Doers of the Word** (James 1:22). Learning counts when it is understood and applied, not when it is opened.
5. **Multiplication** (2 Timothy 2:2; Matthew 28:19). Forest Builder guides someone who keeps growing. Forest of Nations is what disciples become *together*.
6. **No dimension makes up for another.** For example, a hundred lessons can't replace fruit, and many disciples can't replace one's own growth.
7. **Humility and privacy** (Matthew 6:1–6). No public rankings, no leaderboards, and no exposure of private reflections, prayers, messages or evaluations.

---

## 3. Revised personal growth matrix

Stage 1 is the starting point: its requirements describe *beginning well*, and are shown on the journey screen as first steps. Each later stage requires **every** requirement in **all four** dimensions, plus all of the previous stage's.

### Stage 1 — Dormant Seed 🌰 *(John 12:24)*
| Dimension | First steps (shown as "your first steps", not a gate) |
|---|---|
| Consistency | Has begun: completed the welcome journey |
| Learning | Has started the first Core Curriculum lesson |
| Spiritual fruit | A first day in Scripture or prayer (a devotional completed, a prayer offered, or a reflection answered) |
| Discipleship | **Willing to be guided:** has asked for a Peer Guide, *or* has joined a Family, Church or Study Together group |

### Stage 2 — Sprout 🌱 *(Psalm 1:3)*
| Dimension | Requirements |
|---|---|
| Consistency | At least **30 days** since the journey began · **4 different active weeks** · active in **2 different months** |
| Learning | **3 lessons completed** · **2 reflections** answered |
| Spiritual fruit | **Disciplines** on **6 different days** spread over at least 4 weeks (meaningful kinds only, see §6) |
| Discipleship | **Receiving guidance:** an active Peer Guide relationship for **2+ weeks**, *or* taking part in a group study on **2+ separate weeks* · plus **1 act of encouragement to a peer** (an encouraging approval, prayer for a peer, or a confirmed encouragement) |

### Stage 3 — Young Tree 🌿 *(Colossians 2:7)*
| Dimension | Requirements |
|---|---|
| Consistency | **3 months in Sprout** · **10 active weeks in the last 16** · active in **3 different months** |
| Learning | **First full Core Curriculum module** · **3 different assignment answers approved by a peer** |
| Spiritual fruit | Disciplines on **20 different days over at least 3 months** · **1 peer confirmation** (encouragement, compassion, service, fellowship, unity or global) from someone else |
| Discipleship | **Still being guided** (active Peer Guide or ongoing group for 8+ of the last 12 weeks) · **contributing to someone else's growth:** **2 peer evaluations given** *or* co-learning in a Study Together on **4+ separate weeks** |

### Stage 4 — Fruitful Tree 🌳 *(Matthew 7:20)*
| Dimension | Requirements |
|---|---|
| Consistency | **6 months in Young Tree** · **18 active weeks in the last 26** · **no gap longer than 6 weeks** in the last 6 months (one recorded pause allowed, see §7) |
| Learning | **3 Core Curriculum modules** · **8 approved assignment answers** · **1 evaluation of their own work** with constructive feedback received and acted on (a revised answer approved) *or* 10 approved answers |
| Spiritual fruit | Disciplines on **40 days over 6 months** · **3 confirmations from at least 2 different people**, at least one for **service, compassion or encouragement** · **1 recognised fruit** in the *faithfulness* or *community* categories |
| Discipleship | **Sustained service:** **6 peer evaluations given** (none flagged for poor quality) *or* **co-mentoring** an active disciple for **3+ months** · still in a guided relationship or group |

### Stage 5 — Forest Builder 🌲 *(Matthew 28:19)* — highest personal stage
| Dimension | Requirements |
|---|---|
| Consistency | **6 months in Fruitful Tree** · **18 active weeks in the last 26** (still growing personally, not resting on past growth) |
| Learning | **The whole Core Curriculum** completed · **12 approved assignment answers** in total |
| Spiritual fruit | Disciplines on **30 days in the last 6 months** · **5 confirmations from at least 3 different people over at least 6 months** |
| Discipleship | **Guiding at least one disciple** (as primary mentor or co-mentor) in an **active relationship for 6+ months**, where **the disciple keeps growing:** dated learning in **3+ different months** of the relationship, *and* has either moved up a stage since the relationship began **or** confirmed "my Peer Guide has helped me grow" (a new confirmation type, §11). Paused time doesn't count toward the six months. |

### Stage 6 — Forest of Nations 🌍 *(Revelation 21:24)* — **collective, never personal** (§8)

---

## 4. The four dimensions, stage by stage

### Consistency
- **Three separate measures:**
  - **time in stage** (`p2p_growth_status.stage_since`), which stops anyone rushing;
  - **recent active weeks** (a rolling window), which shows the habit is current;
  - **spread across months, and no long gap,** which shows it is sustained.
- **Account age never counts.** A person who joined two years ago and was active one week still has one active week.
- **What counts as an active week:** a week with *meaningful* activity, meaning an answer, a lesson or module completed, an evaluation given, a journal entry, or a meaningful prayer or Scripture event (§6). Signing in or viewing a screen doesn't count.
- **The thresholds:** they rise from 4 active weeks (Sprout) through 10 of the last 16 (about 60% of weeks) to 18 of the last 26 (about 70%). A sustainable rhythm, not perfection. Weeks off for life, illness or travel still allow progress.

### Learning
- **A lesson only counts when it is *completed*** (`p2p_lesson_progress.completed`). For lessons with assignments, completion follows the outcome of the peer evaluation (`trg_apply_evaluation_outcome`), so a click alone never counts.
- **"Approved answers"** are answers a peer evaluator approved (`p2p_lesson_evaluations.status = 'approved'`, the submitter's own work, not self-approved). They are the most reliable signal of understanding the system has, and a human makes the judgement.
- **Modules** use `p2p_module_fully_completed`. "Core" means the active Core Curriculum.
- **Fruitful Tree also values responding to correction** (a revised answer approved after feedback), which reflects teachability (Proverbs 9:9). An equivalent path through approved answers ensures nobody is penalised simply for never being asked to revise.

### Spiritual fruit
Three kinds of evidence are kept separate, and **each later stage needs more than one kind**:

1. **Disciplines** (automatic): different days with a *meaningful* prayer or Scripture event, a reflection answer or a journal entry. Viewing a prayer topic or a Scripture page doesn't count. The engine never reads what someone wrote.
2. **Application** (the person's own submissions): reflections and assignment answers, with the approved ones counted under Learning.
3. **Confirmation by another person:** the **existing peer-confirmation system**, which recognises fruit through others' eyes:
   - Someone the person actually interacted with confirms an act of encouragement, compassion, service, fellowship, unity or global care. The interaction must be real: evaluation feedback, prayer, a session or a message (a database rule).
   - A person can't confirm themselves.
   - Confirmations count only from **different** people, so no friend can inflate them.
   - Confirmations are **never shown to others or ranked**. They are private encouragement, and they count only as evidence.
4. **Recognised fruit** (the existing fruit catalog) is supporting evidence at Fruitful Tree. Only fruit from the *faithfulness* or *community* categories counts, because those reflect sustained character or service rather than a single event.

Nobody is promoted for ticking "I showed patience". Self-reported virtues are never evidence.

### Discipleship impact
See §5.

---

## 5. How discipleship impact develops

| Stage | What it represents | Why it's fair |
|---|---|---|
| **Dormant Seed** | *Willing to be guided:* asking for a Peer Guide, or joining a Family, Church or Study Together group | Entirely in the person's own hands; nobody has to accept anything |
| **Sprout** | *Receiving guidance and beginning to encourage:* an active Peer Guide relationship **or** a group study, plus one act of encouragement to someone else | The group-study path means **nobody is held back because no mentor accepted them**. Encouragement is within anyone's reach |
| **Young Tree** | *Contributing to another's growth:* evaluating peers' work, or learning alongside others in Study Together, **while still being guided** | Evaluations are offered by the system (the engine invites oriented evaluators), so opportunity doesn't depend on popularity |
| **Fruitful Tree** | *Sustained service:* several careful evaluations (none flagged), or co-mentoring a disciple for 3+ months, while still being guided | Quality counts: evaluations flagged for poor quality don't count |
| **Forest Builder** | *Multiplication:* guiding a disciple for 6+ months **who keeps growing** and, where they choose, says so | Impact is judged by **the disciple's growth**, not the mentor's own claims |

**Why this rewards genuine participation, not the number of relationships:**
- **Only relationships that count:** a request, an invitation, a pending or paused relationship, or an ordinary peer connection is **never** discipleship impact. Only **active** time counts, and paused periods are excluded.
- **One is enough:** every requirement asks for **one** sustained relationship. More disciples never help; collecting them gains nothing.
- **The disciple's growth is the evidence:** their dated learning and stage, which they already share with their mentor's view of the lineage at stage level only. **Mentors never see** a disciple's reflections, journal, prayers, messages or evaluation details. The disciple's confirmation is optional, private and given by the disciple alone.
- **Co-mentoring is recognised,** consistent with the existing Aquila & Priscilla fruit.
- **Being guided remains required** through Fruitful Tree. Everyone keeps learning from someone.

---

## 6. Evidence and verification

**Key:**
- **A** = measured automatically today
- **S** = from the person's own submission today
- **H** = needs confirmation or review by another person
- **N** = not measurable today

| Requirement | Kind | Source today | Status |
|---|---|---|---|
| Welcome journey done | A | `p2p_profiles.onboarding_journey_completed_at` | ✅ |
| Time in current stage | A | `p2p_growth_status.stage_since` | ⚠️ the field exists, but isn't yet one of the engine's evidence counts |
| Active weeks / months, recent window, longest gap | A | dated answers, completions, evaluations given, journal entries and activity events | ⚠️ total weeks and months exist; **rolling windows and gaps need adding** |
| Lessons / modules / Core modules / whole Core Curriculum | A | `p2p_lesson_progress`, `p2p_module_fully_completed`, `p2p_active_curriculum_id` | ✅ (whole curriculum: needs a count) |
| Reflections / assignment answers | S | `p2p_submissions` (counted, never read) | ✅ |
| Answers approved by a peer | H | `p2p_lesson_evaluations` (submitter, approved, not self-approved) | ⚠️ data present; **needs adding** |
| Revised answer approved after feedback | H | evaluations: a needs-revision outcome followed by approval | ⚠️ derivable; **needs adding** |
| Disciplines (meaningful days) | A | `p2p_user_activity_events` | ⚠️ the engine counts *views*; **should count only:** `scripture_devotional_completed`, `prayer_offered`, `prayer_path_completed`, `prayer_gathering_completed`, `peer_prayer_supported`, plus reflections and journal entries |
| Peer confirmations from different people | H | `p2p_peer_confirmations` (confirmed, by type and source) | ⚠️ data present (4 confirmed); **needs adding** |
| Recognised fruit by category | A/H | `p2p_user_fruits` + `p2p_fruits_catalog.category` | ⚠️ engine counts all fruit; **needs filtering by category** |
| Asked for a Peer Guide / in a group | A | discipleship requests; Family, Church and Study Together membership | ⚠️ **needs adding** |
| Being guided for X weeks / ongoing group | A | relationship start, pause and end dates (233); group activity | ⚠️ **needs adding** |
| Encouragement to a peer | A/H | `peer_encouraged` events; confirmed encouragement | ⚠️ **needs adding** |
| Evaluations given (not flagged) | A/H | `p2p_lesson_evaluations` (as evaluator) + `p2p_evaluation_quality` | ⚠️ count exists; **quality filter needs adding** |
| Co-mentoring for 3+ months | A | relationships (non-primary active mentor, active time) | ⚠️ **needs adding** |
| Disciple guided for 6+ months, excluding paused time | A | relationship history (233) | ⚠️ the current rule uses 90 days and ignores pauses; **needs revising** |
| The disciple keeps growing (learning in 3+ months, or moved up a stage) | A | the disciple's dated evidence + growth history | ⚠️ partly present; **needs revising** |
| "My Peer Guide has helped me grow" | H | — | ❌ **N:** needs one new confirmation type (§11) |

**Missing evidence never counts and never lowers anyone:** the person's checklist simply shows "not yet".

---

## 7. Minimum time and consistency

| To reach | Minimum time | Active weeks | Sustained |
|---|---|---|---|
| Sprout | 30 days since beginning | 4 different weeks | 2 different months |
| Young Tree | 3 months in Sprout | 10 of the last 16 | 3 different months |
| Fruitful Tree | 6 months in Young Tree | 18 of the last 26 | no gap over 6 weeks in 6 months |
| Forest Builder | 6 months in Fruitful Tree | 18 of the last 26 | + 6 months guiding a disciple |

- **The quickest possible path** to Forest Builder is about **16 months**, which fits "a demanding, sustainable journey".
- **Grace:** one **declared pause** (a paused relationship, or a future "season of rest" setting) of up to 8 weeks is left out of the gap and window calculations, so illness, bereavement or travel doesn't reset anyone. Pausing is the person's own choice and needs no reason.
- **Nobody is ever lowered by inactivity.** It only delays the *next* stage, because the recent-weeks requirement looks at current faithfulness.

---

## 8. Forest of Nations — collective framework

Forest of Nations is what P2P Global's disciples **are together**. It's never a personal stage or a label for a person.

**What it would show (totals only):**
1. Active discipleship relationships (active, not paused).
2. People actively growing: anyone in an active relationship with meaningful activity in the last 30 days.
3. Branches with ongoing discipleship: lineages with at least one relationship active in the last 60 days.
4. Generations represented (levels of people, as today).
5. Sustained multiplication: relationships begun each month, and how many are still active after 6 months.
6. Reach: nations and communities, counted **only** where people chose to show their country.

**Privacy rules:**
- No names or ids, ever.
- No figure is shown for a group of **fewer than 5 people**; small groups are merged into "other".
- No list of the "largest" lineages, and no mentor counts per person.
- Countries come only from `show_country_on_profile`.

**What it already does:** the live `/genealogy/collective` route and the new **Global** tab show items 1, 3 (as generations) and 6 (countries) plus the spread of stages.
- **To add:** items 2, 5 and the small-group rule.
- **Old "Forest of Nations" labels:** the two people who were shown that label keep a note in their growth record. It stays separate from their personal stage, Forest Builder.

---

## 9. Legacy users

- **Nothing is rewritten.** The 28 people marked *legacy, not yet verified* keep their displayed stage. The engine also already raises the stage quietly when the old formula moves `growth_level` up.
- **How the revised matrix affects them:** once approved and implemented (as **calculation version 2**), the engine evaluates everyone against it:
  - If someone meets their current stage's requirements, they become **verified**, with nothing announced.
  - If they meet the **next** stage's requirements, they move up **only when promotions are switched on**.
  - If they don't yet meet their current stage, they **keep it**, marked legacy, with the reason, and their checklist shows what remains.
- **History is kept:** all existing records, including legacy-import rows, stay. New entries record `calc_version = 2`.
- **No automatic promotions** happen when the matrix changes: promotions stay off until you approve the matrix and switch them on.
- **Forest of Nations notes** stay in `legacy_note`, separate from the personal stage.

---

## 10. Current implementation gaps

1. **The draft matrix** asks for discipleship only at Forest Builder. Dormant Seed has no requirements at all, because the requirements table covers stages 2–5 only.
2. **Prayer and Scripture *views*** (`prayer_topic_viewed`, `prayer_scripture_viewed`) count as disciplines and as activity.
3. **No time-in-stage, rolling window or gap measures:** the engine only counts days since the first activity and total weeks and months.
4. **Peer confirmations, peer-approved answers, revised answers and fruit categories are not used,** although the data exists.
5. **The requirements table can't express "either … or"** (for example, a Peer Guide *or* a group). The smallest fix is to calculate such alternatives inside the evidence function as a single count.
6. **The Forest Builder rule** uses 90 days, ignores paused time, and judges the disciple's growth on three answers or completions.
7. **Fruit is never awarded for accepted relationships:** `p2p_award_fruit` requires the person receiving it to be the caller, and relationships become active through an update the fruit trigger ignores.
8. **Undated completions:** `p2p_lesson_progress` has no completion date. Only completions logged since migration 010 have dates.
9. **Small data so far:** 24 lessons completed, 4 confirmed confirmations and 8 relationships. Under the revised matrix almost everyone will remain at their current stage for months, which is intended but should be explained warmly in the app.
10. **Admins can approve the matrix, but not edit it,** from the Admin Centre. Edits currently need a reviewed migration.
11. **The phone-callable helper** `p2p_growth_stage_points` (no data). Revoke it in the next migration.

---

## 11. Smallest responsible changes (a later, separate phase)

1. **Evidence (one migration, additive):** extend the evidence function with:
   - time in stage;
   - active weeks in the last 16 and 26 weeks;
   - the longest gap in 6 months, with one declared pause excluded;
   - meaningful-discipline days in rolling windows, using the meaningful event types only;
   - answers approved by a peer, and a revised answer approved;
   - confirmations from different people, by type and time;
   - fruit by category;
   - asked for a Peer Guide or joined a group;
   - weeks being guided, or in an ongoing group;
   - encouragement given;
   - evaluations given and not flagged;
   - months co-mentoring;
   - the strongest qualifying disciple: active, not-paused months plus whether the disciple keeps growing.
2. **Requirements:** add the revised matrix as **calculation version 2** (keeping version 1 for history), and allow stage 1 "first steps" for display only.
3. **One confirmation type:** add `guidance` to `p2p_peer_confirmations` (the disciple affirms their Peer Guide; `source_type` session or message). Optional, private, and only the disciple can give it.
4. **Fix fruit awarding** for accepted relationships, running from the server instead of depending on who made the change.
5. **The journey screen** already shows checklists. It would show the revised items grouped by dimension, add "Your first steps" for Dormant Seed, and include a short, warm explanation that growth takes seasons.
6. **Admin editing of the matrix,** with an audited reason (optional).
7. **Collective view:** people actively growing, sustained multiplication, and the small-group rule.

**Not proposed:** no new tracking, no reading of private content, no location tracking, no rankings, and no self-rated virtues.

---

## 12. Risks, fairness and privacy

| Risk | How it's addressed |
|---|---|
| Treating a stage as spiritual worth | The wording is always "a discipleship indicator"; no public stage comparisons and no leaderboards; stages are visible only as people choose (`show_progress_publicly`) |
| Early stages depending on others' choices | Group-study alternatives; requests count as willingness; the evaluation engine offers opportunities fairly |
| Gaming through bursts or invented relationships | Time in stage, rolling windows and gap limits; only one sustained relationship counts; paused time excluded; confirmations only from different people; flagged evaluations excluded |
| Friends confirming each other | A confirmation needs a real interaction source; one counts per person; spread over time; never shown publicly |
| Pressure on mentors or disciples | The disciple's confirmation is optional; ending a relationship never lowers anyone |
| Privacy of reflections, prayers, messages, evaluations | Only counts and dates are used; mentors see stages, not content; the collective view needs groups of at least 5 |
| Life seasons (illness, grief, travel) | A declared pause; no downgrades; only the next stage waits |
| Accessibility and literacy | Group study and audio-supported learning count equally; nothing relies on writing long texts |
| Overclaiming | The app never says it measures the Spirit's work; "fruit" means evidence others can see, humbly recognised |

---

## 13. Recommendations for approval

1. **Approve the framework in principle:** all four dimensions at every stage; time in stage plus recent consistency; three kinds of fruit evidence; discipleship from *willing to be guided* to *multiplication*; Forest of Nations collective only.
2. **Confirm or adjust the thresholds in §3 and §7.** The main ones are 30 days, 3, 6 and 6 months; active weeks 4 / 10 of 16 / 18 of 26 / 18 of 26; and confirmations 1 / 3 from 2 people / 5 from 3 people.
3. **Approve one new confirmation type** (`guidance`) and the declared pause.
4. **Authorise a separate implementation phase** (§11): local build, then a rehearsal on a production copy, then your review.
5. **Keep promotions off** until that phase is applied and the revised matrix is approved in the Admin Centre.

---

### At a glance: supported today, required, and a separate phase
| | |
|---|---|
| **Already supported** | Dated activity, completed lessons and modules, reflection and assignment counts, evaluations given, relationship states and start dates (233), multiple mentors with a primary, growth status and history, celebrations, notifications, legacy handling, collective totals, privacy rules, and the peer-confirmation and fruit-catalog data |
| **The revised matrix requires** | Time in stage; rolling windows and gaps; meaningful-only discipline events; answers approved by a peer and responding to correction; confirmations from different people; fruit categories; guided time and group participation; encouragement; unflagged evaluations; co-mentoring time; a disciple keeping on growing over 6 months excluding pauses |
| **Needs a separate phase** | Everything in §11: evidence additions, calculation version 2, the `guidance` confirmation type, fixing fruit for accepted relationships, the journey screen's first steps, optional admin editing, and collective additions. Then a rehearsal, your approval, and switching promotions on |
