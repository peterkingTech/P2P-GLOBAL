// Growth Milestone Matrix (migration 239) — database scenario tests.
//
// Runs ONLY against a disposable LOCAL database that has migrations up to 239
// applied (e.g. a restored copy built by the rehearsal scripts). It refuses
// anything that is not on 127.0.0.1/localhost or not explicitly marked
// disposable. It creates synthetic people and records; nothing is cleaned up,
// because the database is thrown away.
//
//   GROWTH_TEST_DATABASE_URL=postgres://…@127.0.0.1:…/db GROWTH_TEST_DISPOSABLE=yes \
//   PG_MODULE=<path to the pg package> node migrations/tests/239_growth_matrix.db.test.mjs
//
// Coverage (letters follow the brief): A four independent dimensions · B every
// threshold · C cumulative totals · D passed vs failed · E duplicate units ·
// F every Kingdom School Foundations lesson · G application dedup · H contribution dedup ·
// I individual vs group counting · J one-to-one and group development · K Guide
// changes · L second generation · M sustained second generation · N six-month
// support · O inactive/departed learners · P pauses and rolling windows · Q legacy
// accounts · R RLS and direct client writes · S older app writes still work ·
// T timezones · U corrections and recalculation · V collective privacy.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const url = process.env.GROWTH_TEST_DATABASE_URL ?? "";
if (process.env.GROWTH_TEST_DISPOSABLE !== "yes" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refusing to run: set GROWTH_TEST_DATABASE_URL to a disposable local database and GROWTH_TEST_DISPOSABLE=yes.");
  process.exit(2);
}
const require = createRequire(import.meta.url);
const pg = require(process.env.PG_MODULE || "pg");
const c = new pg.Client({ connectionString: url, ssl: false });
await c.connect();
if ((await c.query("select count(*)::int n from pg_namespace where nspname = 'p2p_staging_guard'")).rows[0].n) { console.error("Refusing: this looks like staging."); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); } };
const q = async (sql, params = []) => (await c.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const DAY = 86_400_000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const seed = async (fn) => { await c.query("set session_replication_role = replica"); try { await fn(); } finally { await c.query("set session_replication_role = origin"); } };
// A request made with a person's own token (what a phone does).
const asPhone = async (uid, sql, params = []) => {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub: uid, role: "authenticated" }), uid]);
    await c.query("set local role authenticated");
    const r = (await c.query(sql, params)).rows; await c.query("commit"); return { rows: r };
  } catch (e) { await c.query("rollback"); return { error: String(e.message) }; }
};
const asAnon = async (sql) => { await c.query("begin"); try { await c.query("set local role anon"); await c.query(sql); await c.query("rollback"); return {}; } catch (e) { await c.query("rollback"); return { error: e.message }; } };

// ── Content pools from the restored copy ────────────────────────────────────
const settings = await one("select * from p2p_growth_settings");
ok("settings: calculation version 2, draft, promotions OFF, legacy formula frozen",
  settings.calc_version === 2 && settings.thresholds_status === "draft" && settings.promotions_enabled === false && settings.legacy_formula_frozen === true);
// Kingdom School Foundations: every published lesson of every published Kingdom School curriculum.
const core = (await q(`select l.id from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id where l.id in (select p2p_growth_foundation_lessons()) order by coalesce(cu.display_order, 0), cu.created_at, m.order_index, l.order_index`)).map((r) => r.id);
const plan = await q(`select l.id, (select count(*) from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = l.id)::int nq
  from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id
 where cu.type = 'plan' and l.status = 'published' order by l.id limit 600`);
const withQ = plan.filter((p) => p.nq > 0);
let cursor = 0;
const takeLessons = (n) => { const out = withQ.slice(cursor, cursor + n).map((p) => p.id); cursor += n; return out; };
const foundationsByCurriculum = await q(`select cu.title, count(*)::int n from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id
  where l.id in (select p2p_growth_foundation_lessons()) group by cu.title`);
ok("content: Kingdom School Foundations = every published Kingdom School curriculum (Orientation, Gospel & Salvation, Christian Foundation), each lesson with an assessment",
  ["Peer-to-Peer Orientation", "The Gospel & Salvation", "The Christian Foundation"].every((t) => foundationsByCurriculum.some((r) => r.title === t))
  && core.length === foundationsByCurriculum.reduce((a, r) => a + r.n, 0) && core.length > 84
  && (await one(`select count(*)::int n from p2p_growth_learning_units where is_core and lesson_status = 'published' and assessment_questions > 0`)).n === core.length, JSON.stringify(foundationsByCurriculum));
ok("content: draft and archived Kingdom School curricula are not part of Foundations",
  (await one(`select count(*)::int n from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id
    where cu.type = 'core' and cu.status <> 'published' and l.id in (select p2p_growth_foundation_lessons())`)).n === 0);
ok("content: every published lesson-backed unit (Kingdom School, Kingdom Stories, Learning Plans) has an assessment",
  (await one(`select count(*)::int n from p2p_growth_learning_units where lesson_status = 'published' and assessment_questions = 0`)).n === 0);

// ── Seeding helpers (synthetic people and records) ──────────────────────────
const people = [];
async function person({ daysAgo = 400, tz = "UTC", country = null } = {}) {
  const id = randomUUID();
  await seed(() => c.query("insert into auth.users (id, email) values ($1, $2)", [id, `t-${id}@example.invalid`]));
  await seed(() => c.query(`insert into p2p_profiles (id, email, full_name, username, created_at, timezone, country)
     values ($1, $2, 'Test person', $3, (now() at time zone 'UTC') - make_interval(days => $4), $5, $6)`, [id, `t-${id}@example.invalid`, `t_${id.slice(0, 12)}`, daysAgo, tz, country]));
  people.push(id);
  return id;
}
/** Answers every assessment question of `lessons` and has `evaluator` resolve them. */
async function answer(user, lessons, evaluator, at, { status = "approved", selfApproved = false, feedback = "" } = {}) {
  await seed(() => c.query(`with s as (
      insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
      select gen_random_uuid(), $1, a.lesson_id, aq.id, 'text', 'answer', $3::timestamptz - interval '1 hour'
        from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = any($2::uuid[])
      returning id, lesson_id)
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, created_at, assigned_at, feedback, self_approved)
    select s.id, s.lesson_id, $1, $4, $5, $3::timestamptz, $3::timestamptz - interval '30 minutes', $3::timestamptz - interval '30 minutes', $6, $7 from s`,
    [user, lessons, at, evaluator, status, feedback, selfApproved]));
}
const FEEDBACK_LESSON = takeLessons(1)[0];
/** `contributor` gives useful written feedback on one answer of `learner`'s, at each time. */
async function feedback(contributor, learner, times) {
  for (const at of times) {
    await seed(() => c.query(`with s as (
        insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
        select gen_random_uuid(), $1, a.lesson_id, aq.id, 'text', 'answer', $3::timestamptz - interval '1 hour'
          from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $4 order by aq.display_order nulls last, aq.id limit 1
        returning id, lesson_id)
      insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, created_at, assigned_at, feedback)
      select s.id, s.lesson_id, $1, $2, 'needs_revision', $3::timestamptz, $3::timestamptz, $3::timestamptz,
             'A clear, specific suggestion that helps this learner understand the passage better.' from s`, [learner, contributor, at, FEEDBACK_LESSON]));
  }
}
async function listen(user, times) {
  for (const at of times) {
    await seed(() => c.query(`insert into p2p_scripture_listening_history (user_id, translation_code, book_code, chapter, start_verse, end_verse, source, started_at, completed_at, listened_seconds)
      values ($1, 'BSB', 'JHN', 1, 1, 10, 'playlist', $2::timestamptz - interval '5 minutes', $2::timestamptz, 300)`, [user, at]));
  }
}
async function confirm(actor, confirmer, type, at, sourceType = "message", sourceId = null) {
  const id = randomUUID();
  await seed(() => c.query(`insert into p2p_peer_confirmations (id, confirmation_type, actor_user_id, confirmer_user_id, source_type, source_id, confirmation_status, created_at, confirmed_at)
    values ($1, $2, $3, $4, $5, $6, 'confirmed', $7::timestamptz - interval '1 hour', $7::timestamptz)`, [id, type, actor, confirmer, sourceType, sourceId, at]));
  return id;
}
async function studySession(leader, participants, at, minutes = 30, participantMinutes = minutes) {
  const id = randomUUID();
  await seed(async () => {
    await c.query(`insert into p2p_study_sessions (id, call_log_id, channel_name, lesson_id, leader_id, created_by, status, started_at, ended_at)
      values ($1, gen_random_uuid(), 'test', $2, $3, $3, 'ended', $4::timestamptz - make_interval(mins => $5), $4::timestamptz)`, [id, FEEDBACK_LESSON, leader, at, minutes]);
    for (const p of [leader, ...participants]) {
      await c.query(`insert into p2p_study_session_participants (study_session_id, user_id, joined_at, left_at)
        values ($1, $2, $3::timestamptz - make_interval(mins => $4), $3::timestamptz)`, [id, p, at, p === leader ? minutes : participantMinutes]);
    }
  });
  return id;
}
const sync = async (u) => (await one("select p2p_growth_sync_evidence($1) n", [u])).n;
const recalc = async (u) => (await one("select p2p_growth_recalculate($1, 'test') r", [u])).r;
const evaluate = async (u) => (await one("select p2p_growth_evaluate($1) e", [u])).e;
const facts = async (u) => { await sync(u); return (await evaluate(u)).facts; };
const req = (ev, stage, key) => ev.stages.find((s) => s.stage === stage).requirements.find((r) => r.key === key);
const setStage = async (u, stage, sinceDaysAgo, verification = "verified") => {
  await c.query(`insert into p2p_growth_status (user_id, stage, stage_since, verification) values ($1, $2, now() - make_interval(days => $3), $4)
    on conflict (user_id) do update set stage = excluded.stage, stage_since = excluded.stage_since, verification = excluded.verification`, [u, stage, sinceDaysAgo, verification]);
};
const evidenceCount = async (u, type) => (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1 and evidence_type = $2 and voided_at is null", [u, type])).n;
// The Wednesday, k weeks back, in UTC (always a past or present moment).
const week = (k) => { const d = new Date(); const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return new Date(Math.min(monday - k * 7 * DAY + 2 * DAY + 12 * 3600_000, Date.now() - 3600_000)).toISOString(); };

// ── B. The authoritative thresholds, exactly as approved in the brief ───────
const M = Object.fromEntries((await q("select stage, fact_key, min_value::float v, param from p2p_growth_matrix where calc_version = 2")).map((r) => [`${r.stage}.${r.fact_key}`, [r.v, r.param]]));
const expected = {
  "2.journey_days": [30, null], "2.active_weeks": [4, null], "2.active_months": [2, null], "2.learning_units": [10, null], "2.application_actions": [10, null], "2.contributions": [10, null],
  "3.days_in_stage": [90, null], "3.active_weeks_window": [10, 16], "3.active_months": [3, null], "3.learning_units": [20, null], "3.application_actions": [20, null], "3.contributions": [20, null],
  "4.days_in_stage": [180, null], "4.active_weeks_window": [18, 26], "4.learning_units": [50, null], "4.application_actions": [50, null], "4.contributions": [50, null],
  "4.learners_supported_developed": [1, 3], "4.second_generation_contributors": [1, null],
  "5.days_in_stage": [180, null], "5.active_weeks_window": [18, 26], "5.learning_units": [100, null], "5.core_curriculum_complete": [1, null],
  "5.application_actions": [100, null], "5.contributions": [100, null], "5.learners_supported_developed": [1, 6], "5.second_generation_sustained": [1, 3],
};
ok("B: the matrix holds exactly the 27 approved requirements", Object.keys(M).length === 27 && Object.entries(expected).every(([k, v]) => JSON.stringify(M[k]) === JSON.stringify(v)),
  JSON.stringify(Object.entries(expected).filter(([k, v]) => JSON.stringify(M[k]) !== JSON.stringify(v))));
ok("B: every stage asks for all four dimensions", (await q("select stage, count(distinct dimension)::int d from p2p_growth_matrix where calc_version = 2 group by 1")).every((r) => r.d === 4));

// ── A/B/C. A complete Sprout, and the same person one short in each dimension ─
const E1 = await person(); // a peer evaluator
const confirmers = [];
for (let i = 0; i < 12; i++) confirmers.push(await person());
const learnerX = await person();
async function sproutKit({ units = 10, actions = 10, contributions = 10, weeks = [6, 5, 3, 1] } = {}) {
  const u = await person({ daysAgo: 120 });
  await listen(u, weeks.map(week));
  await answer(u, takeLessons(units), E1, ago(9));
  for (let i = 0; i < actions; i++) await confirm(u, confirmers[i], "service", ago(8));
  await feedback(u, learnerX, Array.from({ length: contributions }, (_, i) => ago(7 + i * 0.01)));
  return u;
}
// Weeks 6,5,3,1 back: two calendar months are guaranteed by including a week > 4 weeks back.
const sprout = await sproutKit({ weeks: [7, 6, 3, 1] });
let ev = (await recalc(sprout), await evaluate(sprout));
ok("A/B: complete Sprout evidence — every Sprout requirement met, eligible for Sprout", ev.eligible_stage === 2 && ev.stages[0].requirements.every((r) => r.met),
  JSON.stringify(ev.stages[0].requirements.filter((r) => !r.met)));
ok("C: totals are cumulative lifetime counts (10 / 10 / 10)", ev.facts.learning_units === 10 && ev.facts.application_actions === 10 && ev.facts.contributions === 10, JSON.stringify(ev.facts));
for (const [dim, opts] of [["learning", { units: 9 }], ["application", { actions: 9 }], ["service", { contributions: 9 }]]) {
  const u = await sproutKit({ ...opts, weeks: [7, 6, 3, 1] });
  const e = (await recalc(u), await evaluate(u));
  const unmet = e.stages[0].requirements.filter((r) => !r.met);
  ok(`A/B: one short in ${dim} (9 of 10) — not eligible; nothing else compensates`, e.eligible_stage === 1 && unmet.length === 1 && unmet[0].dimension === dim, JSON.stringify(unmet));
}
{
  const u = await sproutKit({ units: 50, actions: 12, contributions: 0, weeks: [7, 6, 3, 1] });
  const e = (await recalc(u), await evaluate(u));
  ok("A: 50 learning units cannot replace contributions", e.eligible_stage === 1 && !req(e, 2, "contributions").met && req(e, 2, "learning_units").met);
  const u2 = await sproutKit({ weeks: [1] });
  const e2 = (await recalc(u2), await evaluate(u2));
  ok("A/B: consistency short (1 active week, recent start) — not eligible despite every other dimension", e2.eligible_stage === 1
    && !req(e2, 2, "active_weeks").met && req(e2, 2, "learning_units").met && req(e2, 2, "contributions").met);
}

// ── D/E. Passed vs failed, retries and duplicates; self-approval ────────────
{
  const u = await person();
  const [L] = takeLessons(1);
  await answer(u, [L], E1, ago(20), { status: "needs_revision", feedback: "short" });
  let f = await facts(u);
  ok("D: an assessment returned for revision earns no unit; the attempt and the revision are recorded", f.learning_units === 0
    && (await evidenceCount(u, "learning.assessment_failed")) > 0 && (await evidenceCount(u, "learning.assessment_attempted")) > 0);
  await answer(u, [L], E1, ago(10));
  f = await facts(u);
  ok("D: after a retry is passed, the unit counts", f.learning_units === 1);
  await answer(u, [L], E1, ago(5));
  await answer(u, [L], E1, ago(2));
  f = await facts(u);
  ok("E: passing the same assessment again adds no unit", f.learning_units === 1 && (await evidenceCount(u, "learning.assessment_passed")) === 1);
  ok("U: recording is idempotent (a second pass over the same records adds nothing)", (await sync(u)) === 0);

  const s = await person();
  await answer(s, takeLessons(3), s, ago(5), { selfApproved: true, feedback: "First through this lesson — unevaluated, auto-approved." });
  const s2 = await person();
  await answer(s2, takeLessons(2), s2, ago(5));
  const s3 = await person();
  await answer(s3, takeLessons(2), null, ago(5));
  ok("D: self-approved, self-evaluated and evaluator-less approvals earn no learning credit",
    (await facts(s)).learning_units === 0 && (await facts(s2)).learning_units === 0 && (await facts(s3)).learning_units === 0);
  const half = await person();
  const [L2] = takeLessons(1);
  await seed(() => c.query(`with s as (insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
      select gen_random_uuid(), $1, a.lesson_id, aq.id, 'text', 'x', now() - interval '3 days' from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id
       where a.lesson_id = $2 order by aq.id limit 1 returning id, lesson_id)
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, assigned_at) select id, lesson_id, $1, $3, 'approved', now() - interval '2 days', now() - interval '2 days' from s`, [half, L2, E1]));
  ok("D: one approved answer out of several questions is not a passed assessment", (await facts(half)).learning_units === 0);
}

// ── Negative: opening content, client completion rows and views earn nothing ─
{
  const v = await person();
  const lessons = takeLessons(20);
  for (const L of lessons) {
    const r = await asPhone(v, "insert into p2p_lesson_progress (user_id, lesson_id, completed, progress_percent) values ($1, $2, true, 100) on conflict (user_id, lesson_id) do update set completed = true", [v, L]);
    if (r.error) { ok("S: an older build can still record lesson progress", false, r.error); break; }
  }
  const story = await one("select id from p2p_kingdom_stories limit 1");
  if (story) await seed(() => c.query("insert into p2p_kingdom_story_views (user_id, story_id) values ($1, $2) on conflict do nothing", [v, story.id]));
  for (const t of ["scripture_opened", "prayer_topic_viewed", "prayer_scripture_viewed", "prayer_offered", "plan_completed"]) {
    await asPhone(v, "insert into p2p_user_activity_events (user_id, event_type) values ($1, $2)", [v, t]);
  }
  const f = await facts(v);
  ok("S: older-build writes still succeed (lesson progress rows exist)", (await one("select count(*)::int n from p2p_lesson_progress where user_id = $1 and completed", [v])).n === 20);
  ok("Negative: completion rows, story views and phone-written activity earn no credit and no active week",
    f.learning_units === 0 && f.active_weeks === 0 && (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1", [v])).n === 0, JSON.stringify(f.provenance));
}

// ── G. Application deduplication ────────────────────────────────────────────
{
  const u = await person();
  const [L] = takeLessons(1);
  await c.query("update p2p_assignment_questions set is_practical = true where assignment_id in (select id from p2p_assignments where lesson_id = $1)", [L]);
  const nq = (await one("select count(*)::int n from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $1", [L])).n;
  await answer(u, [L], E1, ago(10));
  await answer(u, [L], E1, ago(4));
  let f = await facts(u);
  ok("G: each practical question counts once, however often it is answered and approved", f.application_actions === nq, `${f.application_actions} vs ${nq}`);
  ok("G: …and the lesson is still exactly one learning unit (not duplicated by being practical)", f.learning_units === 1);
  const asg = randomUUID();
  await seed(async () => {
    for (const attempt of [1, 2]) await c.query(`insert into p2p_group_assignment_submissions (assignment_id, user_id, attempt, content, status, reviewed_by, reviewed_at, submitted_at)
      values ($1, $2, $3, 'done', 'reviewed', $4, now() - make_interval(days => $5), now() - make_interval(days => $5 + 1))`, [asg, u, attempt, E1, 6 - attempt]);
    await c.query(`insert into p2p_group_assignment_submissions (assignment_id, user_id, content, status, reviewed_by, reviewed_at) values (gen_random_uuid(), $1, 'mine', 'reviewed', $1, now() - interval '1 day')`, [u]);
  });
  await confirm(u, confirmers[0], "service", ago(9));
  await confirm(u, confirmers[0], "compassion", ago(3));
  await confirm(u, confirmers[0], "service", ago(45));
  f = await facts(u);
  ok("G: a reviewed group assignment counts once (two attempts), never when self-reviewed; one confirmer counts once per 30 days",
    f.application_actions === nq + 1 + 2, `${f.application_actions} vs ${nq + 3}`);
}

// ── H/I/J. Contributions: dedup, group sessions, development ────────────────
{
  const leader = await person();
  const attendees = [];
  for (let i = 0; i < 5; i++) attendees.push(await person());
  const s1 = await studySession(leader, attendees, ago(40));
  await studySession(leader, attendees, ago(20));
  await studySession(leader, attendees, ago(10), 30, 3);   // attendees only stayed 3 minutes
  await studySession(leader, [], ago(5));                  // nobody came
  const f = await facts(leader);
  ok("I: a group session counts ONCE for its facilitator, never per attendee (2 qualifying sessions → 2)", f.contributions === 2, String(f.contributions));
  ok("I: the people supported are recorded separately (5 per session)", (await one(`select count(*)::int n from p2p_growth_evidence_beneficiaries b join p2p_growth_evidence e on e.id = b.evidence_id where e.user_id = $1`, [leader])).n === 10);
  const fa = await facts(attendees[0]);
  ok("I: attendance alone is never a contribution (it is participation, for consistency only)", fa.contributions === 0 && (await evidenceCount(attendees[0], "consistency.group_learning_attended")) === 2 && fa.active_weeks >= 1);
  ok("J: attending is not development — no attendee 'developed' just by being there", (await facts(leader)).support.learners_developed === 0);

  // H: a confirmation of an evaluation or of a session already counted adds nothing; distinct periods do.
  const helper = await person(), helped = await person();
  await feedback(helper, helped, [ago(30)]);
  const evalId = (await one("select id from p2p_lesson_evaluations where evaluator_id = $1 limit 1", [helper])).id;
  await confirm(helper, helped, "encouragement", ago(29), "evaluation_feedback", evalId);
  await confirm(leader, attendees[0], "fellowship", ago(39), "session", s1);
  await confirm(helper, helped, "encouragement", ago(20), "message");
  await confirm(helper, helped, "encouragement", ago(19), "message");
  await confirm(helper, helped, "encouragement", ago(1), "message");
  ok("H: the evaluation counts once (its confirmation is not a second credit); one confirmer counts once per 30 days",
    (await facts(helper)).contributions === 1 + 2, String((await facts(helper)).contributions));
  ok("H: a confirmation of a session the facilitator already earned credit for adds nothing", (await facts(leader)).contributions === 2);

  // J: one-to-one and group-based support with development.
  const mentor = await person(), learner = await person(), stalled = await person();
  await feedback(mentor, learner, [ago(100), ago(70), ago(40)]);
  await feedback(mentor, stalled, [ago(100), ago(70), ago(40)]);
  await answer(learner, takeLessons(3), E1, ago(30));
  const fm = await facts(mentor);
  ok("J: one-to-one support over 3 months + the learner passed 3 units afterwards → a developed learner; the stalled learner is not",
    fm.support.by_months["3"] === 1 && fm.support.learners_supported === 2 && fm.support.learners_developed === 1, JSON.stringify(fm.support));
  const facilitator = await person(), p1 = await person(), p2 = await person();
  for (const d of [100, 70, 40]) await studySession(facilitator, [p1, p2], ago(d));
  await answer(p1, takeLessons(3), E1, ago(20));
  const ff = await facts(facilitator);
  ok("J: group-based support counts too, but only the participant with evidenced development is counted", ff.support.by_months["3"] === 1 && ff.support.learners_developed === 1, JSON.stringify(ff.support));
  const early = await person(), late = await person();
  await answer(late, takeLessons(3), E1, ago(120));      // learned BEFORE the support began
  await feedback(early, late, [ago(100), ago(70), ago(40)]);
  ok("J: learning that happened before the support began is not the supporter's development evidence", (await facts(early)).support.learners_developed === 0);
}

// ── K. Guide changes, historical credit, Guide stage eligibility ────────────
{
  const g1 = await person(), g2 = await person(), k1 = await person();
  await seed(async () => {
    await c.query(`insert into p2p_discipleship_links (id, mentor_id, disciple_id, status, active, is_primary, started_at, ended_at, created_at)
      values (gen_random_uuid(), $1, $2, 'ended', false, false, now() - interval '200 days', now() - interval '100 days', now() - interval '200 days')`, [g1, k1]);
    await c.query(`insert into p2p_discipleship_links (id, mentor_id, disciple_id, status, active, is_primary, started_at, created_at)
      values (gen_random_uuid(), $1, $2, 'active', true, true, now() - interval '99 days', now() - interval '99 days')`, [g2, k1]);
  });
  await feedback(g1, k1, [ago(190), ago(160), ago(130)]);
  await feedback(g2, k1, [ago(80), ago(50)]);
  const f1 = await facts(g1), f2 = await facts(g2);
  ok("K: after a Guide change the previous Guide keeps their verified historical contributions (3); the new Guide has only their own (2)",
    f1.contributions === 3 && f2.contributions === 2);
  ok("K: the ended relationship stays in the history (never deleted or reset)", (await one("select count(*)::int n from p2p_discipleship_links where disciple_id = $1", [k1])).n === 2);
  await setStage(g2, 1, 30); await setStage(k1, 1, 30);
  const elig = await one("select eligible from p2p_growth_guide_eligibility where guide_id = $1 and participant_id = $2", [g2, k1]);
  ok("K: a Guide at the same milestone as the participant is reported as not eligible", elig && elig.eligible === false);
  await c.query("update p2p_growth_settings set enforce_guide_stage = true");
  const g3 = await person(), k3 = await person();
  await setStage(g3, 1, 30); await setStage(k3, 1, 30);
  let err = null;
  try { await c.query(`insert into p2p_discipleship_links (mentor_id, disciple_id, status, active, started_at, source) values ($1, $2, 'active', true, now(), 'direct')`, [g3, k3]); } catch (e) { err = e.message; }
  ok("K: with the rule switched on, a same-stage Guide cannot be designated", /P2P_GUIDE_STAGE/.test(err ?? ""), err ?? "no error");
  await setStage(g3, 3, 30);
  err = null;
  try { await c.query(`insert into p2p_discipleship_links (mentor_id, disciple_id, status, active, started_at, source) values ($1, $2, 'active', true, now(), 'direct')`, [g3, k3]); } catch (e) { err = e.message; }
  ok("K: a Guide at a strictly higher milestone can be designated", !err, err ?? "");
  await c.query("update p2p_growth_settings set enforce_guide_stage = true");
}

// ── L/M/N. Second generation and sustained support (facts) ─────────────────
{
  const a = await person(), l = await person(), m = await person();
  await feedback(a, l, [ago(150), ago(120), ago(90)]);
  await answer(l, takeLessons(3), E1, ago(80));
  let f = await facts(a);
  ok("L: a developed learner who has not helped anyone yet → no second-generation contribution", f.support.second_generation === 0);
  await feedback(l, a, [ago(60)]);
  f = await facts(a);
  ok("L: the learner helping the original contributor back does not count (it must be another participant)", f.support.second_generation === 0);
  await feedback(l, m, [ago(50)]);
  f = await facts(a);
  ok("L: the learner's verified contribution to another participant → second generation", f.support.second_generation === 1);

  const c6 = await person(), l6 = await person(), m6 = await person();
  await feedback(c6, l6, [ago(165), ago(135), ago(105), ago(75), ago(45)]);   // 5 months
  await answer(l6, takeLessons(3), E1, ago(40));
  await feedback(l6, m6, [ago(100), ago(70)]);                                 // onward: 2 months
  f = await facts(c6);
  ok("N: support in 5 months is not 6 months", f.support.by_months["6"] === 0 && f.support.by_months["3"] === 1);
  await feedback(c6, l6, [ago(195)]);
  f = await facts(c6);
  ok("N: support across 6 months (spanning more than 5) meets the six-month requirement", f.support.by_months["6"] === 1, JSON.stringify(f.support));
  ok("M: onward contributions in 2 months do not sustain 3 months", f.support.second_generation_sustained["3"] === 0);
  await feedback(l6, m6, [ago(40)]);
  f = await facts(c6);
  ok("M: onward contributions in 3 months (spanning 2+) sustain second generation", f.support.second_generation_sustained["3"] === 1, JSON.stringify(f.support));
}

// ── F/O. Forest Builder in full; Core Curriculum cannot be replaced; departed learner ─
let FB, FL;
{
  FB = await person({ daysAgo: 500 }); FL = await person({ daysAgo: 500 });
  const M2 = await person({ daysAgo: 500 });
  await setStage(FB, 4, 200);
  await listen(FB, Array.from({ length: 22 }, (_, k) => week(k)));
  await answer(FB, core, E1, ago(100));
  const practical = [];
  let practicalQuestions = 0;
  while (practicalQuestions < 100) { const [L] = takeLessons(1); practical.push(L); practicalQuestions += withQ.find((p) => p.id === L).nq; }
  await c.query("update p2p_assignment_questions set is_practical = true where assignment_id in (select id from p2p_assignments where lesson_id = any($1::uuid[]))", [practical]);
  await answer(FB, practical, E1, ago(90));
  await feedback(FB, FL, Array.from({ length: 100 }, (_, i) => ago(210 - i * 2)));
  await answer(FL, takeLessons(3), E1, ago(150));
  await feedback(FL, M2, [ago(120), ago(90), ago(60)]);
  const res = await recalc(FB);
  ev = await evaluate(FB);
  const s5 = ev.stages.find((s) => s.stage === 5);
  ok("F: complete Forest Builder evidence — every requirement in all four dimensions met", s5.met && ev.eligible_stage === 5, JSON.stringify(s5.requirements.filter((r) => !r.met)));
  ok("F: promotions are OFF, so nobody moves (eligible is reported, the stage stays)", res.stage === 4 && res.promoted === false);
  ok(`F: Kingdom School Foundations reported as ${core.length} of ${core.length}`, req(ev, 5, "core_curriculum_complete").have === core.length && req(ev, 5, "core_curriculum_complete").need === core.length);

  const oneCore = await one("select id from p2p_growth_evidence where user_id = $1 and evidence_type = 'learning.assessment_passed' and unit_key = $2", [FB, `lesson:${core[0]}`]);
  await c.query("select p2p_growth_review_evidence($1, $2, 'void', 'Test: one Core lesson withdrawn')", [oneCore.id, E1]);
  ev = await evaluate(FB);
  ok("F: with one Core lesson missing, 100+ other units cannot replace it", ev.facts.learning_units >= 100 && !req(ev, 5, "core_curriculum_complete").met && ev.eligible_stage === 4);
  await c.query("select p2p_growth_review_evidence($1, $2, 'restore', 'Test: restored')", [oneCore.id, E1]);
  ev = await evaluate(FB);
  ok("U: restoring the corrected evidence restores eligibility (corrections are reversible)", ev.eligible_stage === 5);
  ok("U: every correction is in the review history", (await one("select count(*)::int n from p2p_growth_evidence_reviews where evidence_id = $1", [oneCore.id])).n === 2);

  // O: the learner leaves P2P Global — the contributor's verified history stands.
  let delErr = null;
  try { await c.query("delete from p2p_profiles where id = $1", [FL]); } catch (e) { delErr = e.message; }
  ok("O: a learner's account can be removed (their own evidence goes with it)", !delErr, delErr ?? "");
  ev = await evaluate(FB);
  const dev = await one("select learner_id, developed, onward_months from p2p_growth_learner_development where contributor_id = $1", [FB]);
  ok("O: after the learner left, the contributor keeps the learner's last verified development level and still qualifies",
    dev && dev.learner_id === null && dev.developed === true && dev.onward_months >= 3 && ev.eligible_stage === 5 && ev.facts.contributions >= 100, JSON.stringify(dev));
}

// ── P. Pauses and rolling windows ──────────────────────────────────────────
{
  const u = await person();
  await listen(u, [5, 6, 7, 8, 9, 10, 11, 12, 13].map(week));   // 9 of the latest 16 weeks
  let w = (await facts(u)).active_weeks_window["16"];
  ok("P: 9 active weeks within the latest 16 — below 10", w === 9, String(w));
  const mon = (k) => { const d = new Date(week(k)); return new Date(d.getTime() - 2 * DAY).toISOString().slice(0, 10); };
  await c.query("insert into p2p_growth_pauses (user_id, starts_on, planned_end_on, reason, created_by) values ($1, $2::date, $3::date, 'health', $1)", [u, mon(3), mon(0)]);
  await listen(u, [week(17)]);
  w = (await facts(u)).active_weeks_window["16"];
  ok("P: paused weeks are skipped, so the window reaches further back (the pause never counts against anyone)", w === 10, String(w));
  ok("P: a pause never erases evidence", (await evidenceCount(u, "consistency.scripture_listening")) === 10);

  const s = await person();
  await setStage(s, 2, 100);
  await c.query("insert into p2p_growth_pauses (user_id, starts_on, planned_end_on, reason) values ($1, current_date - 60, current_date - 41, 'family')", [s]);
  const fs = await facts(s);
  ok("P: paused days are not counted as time at the stage (100 days − 20 paused = 80)", fs.days_in_stage === 80 && fs.paused_days_in_stage === 20, JSON.stringify([fs.days_in_stage, fs.paused_days_in_stage]));
  ok("P: …so 3 months at Sprout is not yet met", !req(await evaluate(s), 3, "days_in_stage").met);

  const r = await person();
  const pid = (await one("select p2p_growth_pause_start($1, current_date, current_date + 30, 'travel') id", [r])).id;
  let err = null;
  try { await c.query("select p2p_growth_pause_start($1, current_date + 10, current_date + 20, 'travel')", [r]); } catch (e) { err = e.message; }
  ok("P: overlapping pauses are refused", /overlaps/.test(err ?? ""));
  err = null;
  try { await c.query("select p2p_growth_pause_start($1, current_date + 40, current_date + 140, 'travel')", [r]); } catch (e) { err = e.message; }
  ok("P: one pause is at most three months", /three months/.test(err ?? ""));
  err = null;
  try { await c.query("select p2p_growth_pause_start($1, current_date + 40, current_date + 100, 'travel')", [r]); } catch (e) { err = e.message; }
  ok("P: pauses total at most 90 days a year", /at most 90 days/.test(err ?? ""), err ?? "");
  err = null;
  try { await c.query("select p2p_growth_pause_start($1, current_date - 30, current_date - 20, 'travel')", [r]); } catch (e) { err = e.message; }
  ok("P: a pause cannot be backdated more than a week", /a week in the past/.test(err ?? ""));
  await c.query("select p2p_growth_pause_end($1, $2)", [r, pid]);
  const hist = await one("select planned_end_on, ended_on, ended_at from p2p_growth_pauses where id = $1", [pid]);
  ok("P: ending a pause early keeps its history (planned end and actual end)", hist.ended_at !== null && hist.planned_end_on > hist.ended_on);
}

// ── Q. Legacy accounts; previous formulas can no longer promote ────────────
{
  const legacy = await one("select user_id, stage from p2p_growth_status where verification = 'legacy_unverified' order by stage desc limit 1");
  if (!legacy) ok("Q: a legacy account exists in the copy", false);
  else {
    const before = await one("select growth_level from p2p_profiles where id = $1", [legacy.user_id]);
    await recalc(legacy.user_id);
    let st = await one("select stage, verification from p2p_growth_status where user_id = $1", [legacy.user_id]);
    ok("Q: a legacy-unverified person keeps their stage and label after recalculation", st.stage === legacy.stage && st.verification === "legacy_unverified");
    const low = await person();
    await setStage(low, 1, 30);
    await c.query("update p2p_profiles set growth_level = 200 where id = $1", [low]);
    await recalc(low);
    st = await one("select stage from p2p_growth_status where user_id = $1", [low]);
    ok("Q: a high old growth_level can no longer raise the stage (the 236 legacy branch is gone)", st.stage === 1);
    // The old lesson trigger no longer writes growth_level.
    const lv = await person(); await setStage(lv, 1, 30);
    const mod = await one(`select m.id, array_agg(l.id) ls from p2p_modules m join p2p_lessons l on l.module_id = m.id where l.id in (select p2p_growth_foundation_lessons()) group by m.id having count(*) <= 4 limit 1`);
    for (const L of mod.ls) await c.query("insert into p2p_lesson_progress (user_id, lesson_id, completed, status, progress_percent) values ($1, $2, true, 'completed', 100) on conflict (user_id, lesson_id) do update set completed = true, status = 'completed'", [lv, L]).catch(() => {});
    const gl = await one("select growth_level from p2p_profiles where id = $1", [lv]);
    await recalc(lv);
    ok("Q: completing a whole module through the old path does not raise growth_level or the stage", gl.growth_level === 0 && (await one("select stage from p2p_growth_status where user_id = $1", [lv])).stage === 1, JSON.stringify(gl));
    ok("Q: nobody's growth_level was changed by 239", (await one("select growth_level from p2p_profiles where id = $1", [legacy.user_id])).growth_level === before.growth_level);
  }
}

// ── Promotions (switched on only inside this disposable copy) ──────────────
{
  let err = null;
  try { await c.query("update p2p_growth_settings set promotions_enabled = true"); } catch (e) { err = e.message; }
  ok("Promotions cannot be switched on while the matrix is a draft", /promote_approved/.test(err ?? ""));
  const t = await one("select p2p_growth_set_threshold($1, 2, 'learning_units', 11, 'Test change') r", [E1]);
  ok("Thresholds change only centrally, with a logged reason", t.r.old === 10 && (await one("select count(*)::int n from p2p_growth_matrix_changes where actor_id = $1", [E1])).n === 1);
  await c.query("select p2p_growth_set_threshold($1, 2, 'learning_units', 10, 'Test change undone')", [E1]);
  await c.query("update p2p_growth_settings set thresholds_status = 'approved', approved_at = now()");
  err = null;
  try { await c.query("select p2p_growth_set_threshold($1, 2, 'learning_units', 1, 'sneaky')", [E1]); } catch (e) { err = e.message; }
  ok("An approved matrix cannot be edited", /only change while the matrix is a draft/.test(err ?? ""));
  await c.query("update p2p_growth_settings set promotions_enabled = true");
  const notesBefore = (await one("select count(*)::int n from p2p_notifications where user_id = $1", [sprout])).n;
  const r1 = await recalc(sprout);
  const r2 = await recalc(sprout);
  const h = await q("select to_stage, kind, calc_version from p2p_growth_history where user_id = $1", [sprout]);
  const n = await q("select title, message from p2p_notifications where user_id = $1 and notification_type = 'growth_stage_reached'", [sprout]);
  ok("Promotion: eligible → Sprout once; history, one notification, never twice", r1.promoted && r1.stage === 2 && !r2.promoted && h.length === 1 && h[0].kind === "automatic" && h[0].calc_version === 2
    && (await one("select count(*)::int n from p2p_notifications where user_id = $1", [sprout])).n === notesBefore + 1, JSON.stringify(h));
  ok("Promotion notification speaks of recorded participation, never spiritual growth", n.length === 1 && /Milestone reached: Sprout/.test(n[0].title) && !/grown|spiritual|faith/i.test(n[0].message + n[0].title));
  const fbr = await recalc(FB);
  const fbr2 = await recalc(FB);
  ok("Promotion: one stage at a time (Fruitful Tree → Forest Builder), the stage never goes down", fbr.stage === 5 && fbr2.stage === 5);
  const legacy = await one("select user_id, stage from p2p_growth_status where verification = 'legacy_unverified' order by stage desc limit 1");
  const lr = await recalc(legacy.user_id);
  ok("Q: with promotions on, a legacy stage is kept and not raised by any old formula", lr.stage === legacy.stage);
  await c.query("update p2p_growth_settings set promotions_enabled = false, thresholds_status = 'draft', approved_at = null");
}

// ── R. Security: no phone access; client writes cannot fabricate evidence ───
{
  const u = await person(), other = await person();
  const denied = (r) => !!r.error && /permission denied|row-level security/i.test(r.error);
  const checks = [
    ["read the evidence ledger", await asPhone(u, "select * from p2p_growth_evidence limit 1")],
    ["write evidence", await asPhone(u, "insert into p2p_growth_evidence (user_id) values ($1)", [u])],
    ["read the matrix", await asPhone(u, "select * from p2p_growth_matrix limit 1")],
    ["change a threshold", await asPhone(u, "update p2p_growth_matrix set min_value = 0")],
    ["read pauses", await asPhone(u, "select * from p2p_growth_pauses")],
    ["read learner development", await asPhone(u, "select * from p2p_growth_learner_development")],
    ["record evidence", await asPhone(u, "select p2p_growth_sync_evidence($1)", [u])],
    ["recalculate", await asPhone(u, "select p2p_growth_recalculate($1)", [u])],
    ["review evidence", await asPhone(u, "select p2p_growth_review_evidence(gen_random_uuid(), $1, 'approve', 'mine')", [u])],
    ["start a pause directly", await asPhone(u, "select p2p_growth_pause_start($1, current_date, current_date + 5, 'other')", [u])],
    ["read the collective function", await asPhone(u, "select p2p_growth_collective()")],
    ["call stage points", await asPhone(u, "select p2p_growth_stage_points(3)")],
    ["update own status", await asPhone(u, "update p2p_growth_status set stage = 5")],
  ];
  for (const [what, r] of checks) ok(`R: a phone cannot ${what}`, denied(r), r.error ?? "allowed");
  ok("R: anonymous callers cannot call stage points", !!(await asAnon("select p2p_growth_stage_points(3)")).error);

  const sub = await asPhone(u, "insert into p2p_submissions (user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at) select $1, a.lesson_id, aq.id, 'text', 'x', '2020-01-01' from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $2 limit 1 returning created_at", [u, FEEDBACK_LESSON]);
  ok("R: a phone cannot backdate an answer (the server's time is kept)", !sub.error && Date.now() - new Date(sub.rows[0].created_at).getTime() < 60_000, sub.error ?? JSON.stringify(sub.rows));
  const evt = await asPhone(u, "insert into p2p_user_activity_events (user_id, event_type, created_at) values ($1, 'prayer_offered', '2020-01-01') returning id, origin, created_at", [u]);
  ok("R: a phone-written activity event is labelled client and gets the server's time", !evt.error && evt.rows[0].origin === "client" && new Date(evt.rows[0].created_at).getFullYear() >= 2026, evt.error ?? "");
  const evtId = evt.rows?.[0]?.id ?? (await one("select id from p2p_user_activity_events where user_id = $1 limit 1", [u]))?.id;
  await asPhone(u, "update p2p_user_activity_events set origin = 'server', created_at = '2020-01-01' where id = $1", [evtId]);
  const evt2 = (await one("select origin, created_at from p2p_user_activity_events where id = $1", [evtId])) ?? { origin: "missing", created_at: "2020-01-01" };
  ok("R: a phone cannot relabel or backdate its event afterwards", evt2.origin === "client" && new Date(evt2.created_at).getFullYear() >= 2026);
  ok("R: phone-written prayer activity is never evidence", (await facts(u)).active_weeks === 1 /* the attempt above */ && (await evidenceCount(u, "consistency.server_activity")) === 0);
  await seed(() => c.query("insert into p2p_user_activity_events (user_id, event_type, origin, created_at) values ($1, 'prayer_offered', 'server', now() - interval '3 days')", [other]));
  ok("R: server-recorded prayer participation counts for consistency only", (await facts(other)).active_weeks === 1 && (await facts(other)).contributions === 0);

  const conf = await confirm(other, u, "service", ago(1));
  await c.query("update p2p_peer_confirmations set confirmation_status = 'pending', confirmed_at = null where id = $1", [conf]);
  const cu = await asPhone(u, "update p2p_peer_confirmations set confirmation_status = 'confirmed', actor_user_id = $2, confirmed_at = '2020-01-01' where id = $1 returning actor_user_id, confirmed_at", [conf, u]);
  ok("R: a confirmer can confirm but cannot re-target the credit or backdate it", !cu.error && cu.rows[0].actor_user_id === other && new Date(cu.rows[0].confirmed_at).getFullYear() >= 2026, cu.error ?? JSON.stringify(cu.rows));

  const learnerR = await person();
  await seed(() => c.query(`with s as (insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
      select gen_random_uuid(), $1, a.lesson_id, aq.id, 'text', 'x', now() - interval '1 day' from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $2 limit 1 returning id, lesson_id)
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at) select id, lesson_id, $1, $3, 'pending', now() from s`, [learnerR, FEEDBACK_LESSON, u]));
  const evRow = await one("select id from p2p_lesson_evaluations where evaluator_id = $1 and status = 'pending'", [u]);
  const eu = await asPhone(u, "update p2p_lesson_evaluations set status = 'approved', feedback = 'Good', resolved_at = '2020-01-01', submitter_id = $2, self_approved = true where id = $1 returning resolved_at, submitter_id, self_approved", [evRow.id, other]);
  ok("R: an evaluator (older app) resolves at the server's time and cannot re-target or relabel the evaluation", !eu.error && new Date(eu.rows[0].resolved_at).getFullYear() >= 2026
    && eu.rows[0].submitter_id === learnerR && eu.rows[0].self_approved === false, eu.error ?? JSON.stringify(eu.rows));

  let e1 = null, e2 = null;
  const anyEv = await one("select id from p2p_growth_evidence where user_id = $1 limit 1", [FB]);
  try { await c.query("delete from p2p_growth_evidence where id = $1", [anyEv.id]); } catch (e) { e1 = e.message; }
  try { await c.query("update p2p_growth_evidence set occurred_at = now() - interval '900 days' where id = $1", [anyEv.id]); } catch (e) { e2 = e.message; }
  ok("U: evidence can never be deleted or rewritten, even by the database owner outside a review", /never deleted/.test(e1 ?? "") && /append-only/.test(e2 ?? ""));
  let e3 = null;
  try { await c.query("select p2p_growth_review_evidence($1, $2, 'void', 'self')", [anyEv.id, FB]); } catch (e) { e3 = e.message; }
  ok("U: nobody reviews their own evidence", /their own evidence/.test(e3 ?? ""));
}

// ── U. Substantiated quality concern voids the dependent evidence ──────────
{
  const cu = await person(), lu = await person();
  await feedback(cu, lu, [ago(10)]);
  ok("U: useful feedback counts as a contribution", (await facts(cu)).contributions === 1);
  const e = await one("select id from p2p_lesson_evaluations where evaluator_id = $1", [cu]);
  await seed(() => c.query(`insert into p2p_evaluation_quality (evaluation_id, evaluatee_id, evaluator_id, helpfulness, clarity, respectfulness, encouragement, relevance, helped_understand, concern, substantiated)
    values ($1, $2, $3, 1, 1, 1, 1, 1, false, true, true)`, [e.id, lu, cu]));
  ok("U: a substantiated concern voids it (with a review), and the total drops", (await facts(cu)).contributions === 0
    && (await one("select count(*)::int n from p2p_growth_evidence_reviews r join p2p_growth_evidence g on g.id = r.evidence_id where g.user_id = $1 and r.action = 'auto_void'", [cu])).n === 1);
}

// ── T. Timezones: local date at event time, never rewritten ────────────────
{
  const u = await person({ tz: "Pacific/Auckland" });
  await listen(u, ["2026-01-04T11:30:00Z"]);   // Sunday in UTC, Monday 00:30 in Auckland
  await sync(u);
  const a = await one("select local_date::text d, time_zone from p2p_growth_evidence where user_id = $1", [u]);
  ok("T: the local date is the participant's at event time (Auckland: Monday 5 January)", a.d === "2026-01-05" && a.time_zone === "Pacific/Auckland", JSON.stringify(a));
  await c.query("update p2p_profiles set timezone = 'America/Los_Angeles' where id = $1", [u]);
  await listen(u, ["2026-01-04T05:00:00Z"]);
  await recalc(u);
  const rows = await q("select local_date::text d, time_zone from p2p_growth_evidence where user_id = $1 order by occurred_at", [u]);
  ok("T: a later timezone change never rewrites history (and new events use the new zone)", rows.length === 2 && rows[1].d === "2026-01-05" && rows[1].time_zone === "Pacific/Auckland" && rows[0].d === "2026-01-03" && rows[0].time_zone === "America/Los_Angeles", JSON.stringify(rows));
  const bad = await person({ tz: "Not/AZone" });
  await listen(bad, [ago(1)]);
  ok("T: an invalid timezone falls back to UTC instead of failing", (await sync(bad)) === 1);
}

// ── V. Collective privacy ──────────────────────────────────────────────────
{
  const col = (await one("select p2p_growth_collective() c")).c;
  ok("V: stage counts below the minimum group are suppressed", col.stages.every((s) => s.people === null || s.people >= col.minimumGroup) && col.stages.some((s) => s.suppressed));
  ok("V: months with fewer than the minimum participants are suppressed", col.months.every((m) => m.suppressed || m.participants >= col.minimumGroup));
  ok("V: no names, ids or per-person histories in the collective view", !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(col)));
  const before = col.countries;
  const four = [];
  for (let i = 0; i < 4; i++) { const p = await person({ country: "Testland" }); four.push(p); }
  await c.query("update p2p_profiles set share_country_in_collective = true where id = any($1::uuid[])", [four]);
  ok("V: a country with fewer than the minimum opted-in people is not counted", (await one("select p2p_growth_collective() c")).c.countries === before);
  const fifth = await person({ country: "Testland" });
  ok("V: show_country_on_profile alone (the default) is not consent for the collective view", (await one("select p2p_growth_collective() c")).c.countries === before);
  await c.query("update p2p_profiles set share_country_in_collective = true where id = $1", [fifth]);
  ok("V: a country counts once the minimum number of people opted in", (await one("select p2p_growth_collective() c")).c.countries === before + 1);
}

// ── Queue: new sources queue a recalculation ───────────────────────────────
{
  const l = await person(), p = await person();
  const sid = randomUUID();
  await seed(async () => {
    await c.query(`insert into p2p_study_sessions (id, call_log_id, channel_name, lesson_id, leader_id, created_by, status, started_at) values ($1, gen_random_uuid(), 't', $2, $3, $3, 'active', now() - interval '40 minutes')`, [sid, FEEDBACK_LESSON, l]);
    await c.query(`insert into p2p_study_session_participants (study_session_id, user_id, joined_at) values ($1, $2, now() - interval '35 minutes')`, [sid, p]);
  });
  await c.query("delete from p2p_growth_queue where user_id = any($1::uuid[])", [[l, p]]);
  await c.query("update p2p_study_sessions set status = 'ended', ended_at = now() where id = $1", [sid]);
  ok("Queue: ending a study session queues the facilitator and participants", (await one("select count(*)::int n from p2p_growth_queue where user_id = any($1::uuid[])", [[l, p]])).n === 2);
  const n = (await one("select p2p_growth_process_queue(500) n")).n;
  ok("Queue: the worker processes the queue without errors", n >= 2 && (await one("select count(*)::int n from p2p_growth_queue where last_error is not null")).n === 0);
}

console.log(`239 growth matrix (database): ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
