// Fruit awarded to the right person (migration 259) — database scenario tests on a disposable LOCAL database.
//   GROWTH_TEST_DATABASE_URL=… GROWTH_TEST_DISPOSABLE=yes PG_MODULE=… node migrations/tests/259_fruit_awards.db.test.mjs
// Run it BEFORE 259 to see the bug (learners with a guide cannot submit Module 1) and AFTER 259 for the fix.
// Covers: learners with an active guide; learners without a guide; the guide's Seed Fruit attributed to the guide
// (never the learner) with the right source and audit trail; no duplicate when the guide already holds it; a link
// created after the learner began Module 1; a peer evaluator's approval completing someone else's lesson; peer
// confirmations; and security (no one can award fruit to someone else directly).
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const url = process.env.GROWTH_TEST_DATABASE_URL ?? "";
if (process.env.GROWTH_TEST_DISPOSABLE !== "yes" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error("Refusing: disposable local database only."); process.exit(2); }
const require = createRequire(import.meta.url);
const pg = require(process.env.PG_MODULE || "pg");
const c = new pg.Client({ connectionString: url, ssl: false });
await c.connect();
if ((await c.query("select count(*)::int n from pg_namespace where nspname = 'p2p_staging_guard'")).rows[0].n) { console.error("Refusing: staging."); process.exit(2); }

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log(`ok   ${name}`); } else { fail++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); } };
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const seed = async (fn) => { await c.query("set session_replication_role = replica"); try { await fn(); } finally { await c.query("set session_replication_role = origin"); } };
/** Run `fn` as `who` (auth.uid() = who; null = a server/API context with no signed-in user). Errors are returned, not thrown. */
async function as(who, fn) {
  await c.query("begin");
  try {
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [who ?? ""]);
    await c.query(`set local role ${who ? "authenticated" : "service_role"}`);
    const r = await fn();
    await c.query("commit");
    return { ok: true, r };
  } catch (e) { await c.query("rollback"); return { ok: false, error: e.message }; }
}

// ── A small published curriculum: Module 1 with three lessons (one question each) ──
const CUR = randomUUID(), MOD1 = randomUUID();
const L = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const Q = {}, A = {};
await seed(async () => {
  await c.query("update p2p_curriculums set status = 'archived' where title = 'Core Curriculum (test)'"); // earlier runs on this disposable database
  await c.query("insert into p2p_curriculums (id, title, status) values ($1, 'Core Curriculum (test)', 'published')", [CUR]);
  await c.query("insert into p2p_modules (id, curriculum_id, title, order_index) values ($1, $2, 'Module 1', 1)", [MOD1, CUR]);
  for (const [i, id] of L.entries()) {
    const a = randomUUID(); Q[id] = randomUUID(); A[id] = a;
    await c.query("insert into p2p_lessons (id, module_id, title, order_index, status) values ($1, $2, $3, $4, 'published')", [id, MOD1, `Lesson ${i + 1}`, i + 1]);
    await c.query("insert into p2p_assignments (id, lesson_id) values ($1, $2)", [a, id]);
    await c.query("insert into p2p_assignment_questions (id, assignment_id, display_order) values ($1, $2, 1)", [Q[id], a]);
  }
});

async function person(name, stage = 1, daysOld = 30) {
  const id = randomUUID();
  await seed(async () => {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `f-${id}@example.invalid`]);
    await c.query(`insert into p2p_profiles (id, email, full_name, username, created_at) values ($1, $2, $3, $4, now() - make_interval(days => $5))`,
      [id, `f-${id}@example.invalid`, name, `f_${id.slice(0, 12)}`, daysOld]);
    await c.query("insert into p2p_growth_status (user_id, stage) values ($1, $2)", [id, stage]);
  });
  return id;
}
async function link(guide, learner, session = null) {
  return as(session, () => c.query(`insert into p2p_discipleship_links (mentor_id, disciple_id, status, active, is_primary, started_at, source)
    values ($1, $2, 'active', true, true, now(), 'direct')`, [guide, learner]));
}
const submit = (learner, lesson) => as(learner, () => c.query(
  `insert into p2p_submissions (user_id, lesson_id, assignment_id, assignment_question_id, submission_type, text_content) values ($1, $2, $3, $4, 'text', 'My answer.')`,
  [learner, lesson, A[lesson], Q[lesson]]));
const fruits = (u) => q("select fruit_key, source_id, source_type from p2p_user_fruits where user_id = $1 order by fruit_key", [u]);
const has = async (u, k) => (await fruits(u)).filter((f) => f.fruit_key === k);

// ── 1. A learner WITH an active guide submits a Module 1 lesson ──────────────
const guide = await person("Guide", 3), learner = await person("Learner with a guide", 1);
await link(guide, learner);
const s1 = await submit(learner, L[0]);
ok("with a guide: the learner's Module 1 submission is saved", s1.ok, s1.error);
ok("with a guide: the submission row exists", (await one("select count(*)::int n from p2p_submissions where user_id = $1 and lesson_id = $2", [learner, L[0]])).n === 1);
const seedG = await has(guide, "seed_fruit");
ok("attribution: the guide (not the learner) receives the Seed Fruit", seedG.length === 1, JSON.stringify(await fruits(guide)));
ok("attribution: the Seed Fruit's source is the learner's Module 1 lesson", seedG[0]?.source_id === L[0] && seedG[0]?.source_type === "peer_action", JSON.stringify(seedG));
ok("attribution: the learner does not receive the guide's Seed Fruit", (await has(learner, "seed_fruit")).length === 0);
ok("attribution: the learner receives their own First Steps Fruit", (await has(learner, "first_steps_fruit")).length === 1, JSON.stringify(await fruits(learner)));
ok("attribution: the guide does not receive the learner's First Steps Fruit", (await has(guide, "first_steps_fruit")).length === 0);
ok("audit: the award is logged against the guide",
  (await one("select count(*)::int n from p2p_fruit_audit_log where user_id = $1 and fruit_key = 'seed_fruit' and event_type = 'awarded' and trigger_source_id = $2", [guide, L[0]])).n === 1);
ok("notification: the guide is told about their Seed Fruit",
  (await one("select count(*)::int n from p2p_notifications where user_id = $1 and notification_type = 'fruit_awarded'", [guide])).n === 1);

// ── 2. A learner WITHOUT a guide ─────────────────────────────────────────────
const solo = await person("Learner without a guide", 1);
const before = (await one("select count(*)::int n from p2p_user_fruits where fruit_key = 'seed_fruit'")).n;
const s2 = await submit(solo, L[0]);
ok("without a guide: the Module 1 submission is saved", s2.ok, s2.error);
ok("without a guide: First Steps Fruit for the learner", (await has(solo, "first_steps_fruit")).length === 1);
ok("without a guide: no Seed Fruit is awarded to anyone", (await one("select count(*)::int n from p2p_user_fruits where fruit_key = 'seed_fruit'")).n === before);

// ── 3. The guide already holds the Seed Fruit: a second learner submits ──────
const learner3 = await person("Second learner, same guide", 1);
await link(guide, learner3);
const s3 = await submit(learner3, L[0]);
ok("guide already holds it: the second learner's submission is saved", s3.ok, s3.error);
ok("guide already holds it: still exactly one Seed Fruit, never a duplicate", (await has(guide, "seed_fruit")).length === 1);
ok("guide already holds it: logged as already held",
  (await one("select count(*)::int n from p2p_fruit_audit_log where user_id = $1 and fruit_key = 'seed_fruit' and event_type = 'already_held'", [guide])).n >= 1);

// ── 4. A guide is linked AFTER the learner began Module 1 (server/API context) ─
const early = await person("Learner who began alone", 1), guide2 = await person("Later guide", 3);
await submit(early, L[0]);
const s4 = await link(guide2, early, null);
ok("later link: connecting a guide to a learner who already began Module 1 succeeds", s4.ok, s4.error);
ok("later link: that guide receives the Seed Fruit", (await has(guide2, "seed_fruit")).length === 1, JSON.stringify(await fruits(guide2)));

// ── 5. Someone else approves the learner's lesson (the learner is 400 days into P2P) ─
// The submission is waiting for review; the approval comes from the evaluator's own session (the app) or from the
// API with no signed-in user (the Peer Evaluation Engine, p2p_eval_submit). Either way it is not the learner's session.
async function waiting(learner, evaluator, lesson) {
  const sub = randomUUID(), ev = randomUUID();
  await seed(async () => {
    await c.query(`insert into p2p_submissions (id, user_id, lesson_id, assignment_id, assignment_question_id, submission_type, text_content) values ($1, $2, $3, $4, $5, 'text', 'My answer.')`, [sub, learner, lesson, A[lesson], Q[lesson]]);
    await c.query(`insert into p2p_lesson_evaluations (id, submission_id, lesson_id, submitter_id, evaluator_id, status, assigned_at) values ($1, $2, $3, $4, $5, 'pending', now())`, [ev, sub, lesson, learner, evaluator]);
    await c.query(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed, progress_percent) values ($1, $2, 'submitted', false, 50)`, [learner, lesson]);
  });
  return ev;
}
const approve = (session, ev) => as(session, () => c.query(`update p2p_lesson_evaluations set status = 'approved', resolved_at = now(),
  feedback = 'Clear, specific and grounded in the passage — well done.' where id = $1`, [ev]));
for (const [label, viaApi] of [["evaluator's session", false], ["API (no signed-in user)", true]]) {
  const veteran = await person(`Learner of 400 days (${label})`, 2, 400), evaluator = await person("Peer evaluator", 3);
  const ev = await waiting(veteran, evaluator, L[0]);
  const r = await approve(viaApi ? null : evaluator, ev);
  ok(`approval via the ${label}: approving another person's lesson succeeds`, r.ok, r.error);
  ok(`approval via the ${label}: the learner's lesson is completed`, (await one("select status from p2p_lesson_progress where user_id = $1 and lesson_id = $2", [veteran, L[0]]))?.status === "completed");
  ok(`approval via the ${label}: the learner's Endurance Fruit goes to the learner`, (await has(veteran, "endurance_fruit")).length === 1, JSON.stringify(await fruits(veteran)));
  ok(`approval via the ${label}: the evaluator receives none of the learner's fruit`, (await fruits(evaluator)).length === 0, JSON.stringify(await fruits(evaluator)));
}

// ── 6. A peer confirms someone else's compassion ─────────────────────────────
const actor = await person("Prayed with a peer", 2), confirmer = await person("Peer who was prayed with", 2);
const conf = randomUUID();
await seed(() => c.query(`insert into p2p_peer_confirmations (id, confirmation_type, actor_user_id, confirmer_user_id, confirmation_status, source_type, source_id)
  values ($1, 'compassion', $2, $3, 'pending', 'prayer', $4)`, [conf, actor, confirmer, randomUUID()]));
const s6 = await as(confirmer, () => c.query("select p2p_process_confirmation($1) r", [conf]));
ok("confirmation: confirming another person's compassion succeeds", s6.ok, s6.error);
ok("confirmation: the Compassion Fruit goes to the person who prayed", (await has(actor, "compassion_fruit")).length === 1);
ok("confirmation: the confirmer receives none", (await has(confirmer, "compassion_fruit")).length === 0);

// ── 7. Security: nobody can award fruit to someone else directly ─────────────
const mallory = await person("Another user", 1);
const s7 = await as(mallory, () => c.query("select p2p_award_fruit($1, 'service_fruit', 'x', 'x', null, '{}'::jsonb)", [actor]));
ok("security: awarding fruit to someone else via the app RPC is refused", !s7.ok && /not_authorized/.test(s7.error), s7.error);
const s8 = await as(mallory, () => c.query("select p2p_award_fruit($1, 'nonexistent_test_fruit', 'x', 'x', null, '{}'::jsonb) r", [mallory]));
ok("security: the app RPC still works for your own account", s8.ok && s8.r.rows[0].r === false, s8.error);
const priv = (role, fn) => one("select has_function_privilege($1, $2, 'execute') p", [role, fn]).then((r) => r.p);
const SYS = "public.p2p_award_fruit_system(uuid, text, text, text, uuid, jsonb, text)";
const sysExists = (await one("select to_regprocedure($1) is not null e", [SYS])).e;
ok("security: the engine's award function exists and is closed to signed-in and anonymous users",
  sysExists && !(await priv("authenticated", SYS)) && !(await priv("anon", SYS)));
ok("security: an eligibility sweep cannot be run directly for someone else",
  !(await priv("authenticated", "public.p2p_check_fruit_eligibility(uuid, text, uuid)")) && !(await priv("anon", "public.p2p_check_fruit_eligibility(uuid, text, uuid)")));
const s9 = await as(mallory, () => c.query("select p2p_award_fruit_system($1, 'service_fruit', 'x', 'x', null, '{}'::jsonb)", [mallory]));
ok("security: calling the engine's award function directly is refused", !s9.ok);

console.log(`\n${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
