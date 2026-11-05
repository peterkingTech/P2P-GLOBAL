// Universal Peer Evaluation Engine (migration 240) — database scenario tests.
//
// Runs ONLY against a disposable LOCAL database with migrations up to 240
// applied (the rehearsal copy). Refuses anything else. Synthetic people only.
//   GROWTH_TEST_DATABASE_URL=postgres://…@127.0.0.1:…/db GROWTH_TEST_DISPOSABLE=yes \
//   PG_MODULE=<path to pg> node migrations/tests/240_universal_peer_evaluation.db.test.mjs
//
// Covers: exact-resource qualification (passing A never qualifies for B; self-
// approved, failed and evaluator-less passes never qualify); no registration or
// orientation; the submitter and unsafe pairings excluded; availability and
// capacity; matching priority (language, stage, proximity, workload, variety);
// fair rotation; cold start (queued, coverage, optional bootstrap roles that
// step aside once someone qualifies); accepted work never revoked by a rule
// change; individual evaluations per participant; Growth Matrix evidence after
// completion; re-try when someone newly qualifies; Family/Church group
// assignments (off by default; members only; leader review closes it;
// resubmission replaces it); the pending queue under the new rule; security.
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
const ago = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const seed = async (fn) => { await c.query("set session_replication_role = replica"); try { await fn(); } finally { await c.query("set session_replication_role = origin"); } };

// ── Before anything: the queue as the migration left it ─────────────────────
const s0 = await one("select * from p2p_evaluation_settings");
ok("settings: engine on as in production; bootstrap roles empty; group assignments off", s0.engine_enabled === true && s0.bootstrap_roles.length === 0 && s0.group_assignments_enabled === false);
const backfill = await one("select count(*) filter (where resource_id is null)::int missing, count(*) filter (where resource_kind <> 'lesson')::int other from p2p_lesson_evaluations");
ok("every existing evaluation is a lesson resource with its resource filled in", backfill.missing === 0 && backfill.other === 0);
// Fresh start (owner decision): everything that was waiting is closed — history kept, nobody notified, nothing deleted.
const waiting = await one("select count(*) filter (where engine_state in ('queued','invited') or (engine_state is null and status = 'pending'))::int n, count(*) filter (where engine_state = 'cancelled')::int cancelled from p2p_lesson_evaluations");
ok("fresh start: no evaluation is left waiting; the earlier waiting ones are closed as cancelled", waiting.n === 0 && waiting.cancelled > 0, JSON.stringify(waiting));
ok("…each with a 'cancelled' event giving the reason (history kept)", (await one(`select count(*)::int n from p2p_lesson_evaluations e where e.engine_state = 'cancelled'
  and not exists (select 1 from p2p_evaluation_events v where v.evaluation_id = e.id and v.event_type = 'cancelled' and v.detail->>'reason' = 'fresh_start')`)).n === 0);
ok("…nobody was notified by the fresh start", (await one("select count(*)::int n from p2p_notifications where created_at > now() - interval '30 minutes'")).n === 0);
ok("…the learners' answers are untouched (every closed evaluation still has its submission)", (await one("select count(*)::int n from p2p_lesson_evaluations e where e.engine_state = 'cancelled' and e.submission_id is not null and not exists (select 1 from p2p_submissions s where s.id = e.submission_id)")).n === 0);
const sw0 = (await one("select p2p_eval_sweep(500) r")).r;
ok("…and the sweep finds nothing to retry or invite", sw0.retried === 0 && (await one("select count(*)::int n from p2p_evaluation_assignments where status in ('invited','accepted')")).n === 0);
ok("…so coordinators see an empty waiting list", (await q("select * from p2p_eval_coverage")).length === 0);

// ── Seeding helpers ─────────────────────────────────────────────────────────
async function person({ lang = "en", app = "en", country = null, tz = null, role = "student", stage = 1, city = null, region = null, lat = null, lon = null } = {}) {
  const id = randomUUID();
  await seed(async () => {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `e-${id}@example.invalid`]);
    await c.query(`insert into p2p_profiles (id, email, full_name, username, created_at, content_language, app_language, country_code, timezone, role)
      values ($1, $2, 'Eval test', $3, (now() at time zone 'UTC') - interval '400 days', $4, $5, $6, $7, $8::user_role)`, [id, `e-${id}@example.invalid`, `e_${id.slice(0, 12)}`, lang, app, country, tz, role]);
    await c.query("insert into p2p_growth_status (user_id, stage, stage_since, verification) values ($1, $2, now() - interval '30 days', 'verified')", [id, stage]);
    await c.query("update p2p_profiles set city = $2, region = $3, latitude = $4, longitude = $5 where id = $1", [id, city, region, lat, lon]);
  });
  return id;
}
const lessons = (await q(`select l.id, a.id as assignment_id, (select count(*) from p2p_assignment_questions aq where aq.assignment_id = a.id)::int nq
  from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id join p2p_assignments a on a.lesson_id = l.id
 where cu.type = 'plan' and l.status = 'published' order by l.id limit 200`)).filter((x) => x.nq > 0);
let cursor = 0;
const lesson = () => lessons[cursor++];
const evaluatorX = await person();
/** `user` independently passes `L` (every question approved by a peer), recorded in the ledger. */
async function independentlyPass(user, L, { selfApproved = false, evaluator = evaluatorX, status = "approved", daysAgo = 19 } = {}) {
  await seed(() => c.query(`with s as (
      insert into p2p_submissions (id, user_id, lesson_id, assignment_id, assignment_question_id, submission_type, text_content, created_at)
      select gen_random_uuid(), $1, $2, aq.assignment_id, aq.id, 'text', 'answer', now() - make_interval(days => $7) - interval '1 hour' from p2p_assignment_questions aq where aq.assignment_id = $3
      returning id)
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, created_at, assigned_at, self_approved, feedback)
    select s.id, $2, $1, $4, $5, now() - make_interval(days => $7), now() - make_interval(days => $7), now() - make_interval(days => $7), $6, 'ok' from s`,
    [user, L.id, L.assignment_id, selfApproved ? user : evaluator, status, selfApproved, daysAgo]));
  await c.query("select p2p_growth_sync_evidence($1)", [user]);
}
/** A live submission (one answer) through the real trigger → the engine creates and advances an evaluation. */
// Made exactly as the app does: with the participant's own token (RLS and every existing trigger apply).
async function submit(user, L) {
  await c.query("begin");
  let sub;
  try {
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub: user, role: "authenticated" }), user]);
    await c.query("set local role authenticated");
    sub = (await c.query(`insert into p2p_submissions (user_id, lesson_id, assignment_id, assignment_question_id, submission_type, text_content)
      select $1, $2, aq.assignment_id, aq.id, 'text', 'my answer' from p2p_assignment_questions aq where aq.assignment_id = $3 order by aq.id limit 1 returning id`, [user, L.id, L.assignment_id])).rows[0];
    await c.query("commit");
  } catch (e) { await c.query("rollback"); throw e; }
  return (await one("select * from p2p_lesson_evaluations where submission_id = $1", [sub.id]));
}
const invitedOrCandidates = async (evalId) => [(await active(evalId))?.evaluator_id, ...(await candidates(evalId)).map((x) => x.user_id)].filter(Boolean);
const active = async (evalId) => one("select * from p2p_evaluation_assignments where evaluation_id = $1 and status in ('invited','accepted')", [evalId]);
const candidates = async (evalId) => q("select * from p2p_eval_candidates($1, 50)", [evalId]);

// ── Exact-resource qualification ────────────────────────────────────────────
const A = lesson(), B = lesson();
const passedA = await person(), passedB = await person(), selfA = await person(), failedA = await person(), learner = await person();
await independentlyPass(passedA, A);
await independentlyPass(passedB, B);
await independentlyPass(selfA, A, { selfApproved: true });
await independentlyPass(failedA, A, { status: "needs_revision" });
let ev = await submit(learner, A);
const cA = await invitedOrCandidates(ev.id);
ok("a submission enters the one engine automatically (no registration anywhere)", ev.engine_state !== null && ev.resource_kind === "lesson" && ev.resource_id === A.id && ev.context === "learning_plan");
ok("qualified: only the person who independently passed THIS lesson", cA.includes(passedA) && !cA.includes(passedB), JSON.stringify(cA.length));
ok("passing another lesson never qualifies; self-approved and failed attempts never qualify", !cA.includes(passedB) && !cA.includes(selfA) && !cA.includes(failedA));
let asg = await active(ev.id);
ok("the qualified person is invited at once, with the reasons recorded (no location)", asg?.evaluator_id === passedA && asg.match_detail.basis === "passed_this_resource" && !/country|"[A-Z]{2}"|timezone/.test(JSON.stringify(asg.match_detail).replace(/"proximity":"\w+"/, "")), JSON.stringify(asg?.match_detail));
ok("no evaluator profile or orientation was needed", !(await one("select 1 from p2p_evaluator_profiles where user_id = $1", [passedA])));
const acc = (await one("select p2p_eval_accept($1, $2) r", [asg.id, passedA])).r;
ok("accepting works without orientation; the commitments are recorded with the acceptance", acc.ok === true && !!(await one("select orientation_acknowledged_at from p2p_evaluator_profiles where user_id = $1", [passedA])).orientation_acknowledged_at);
const done = (await one("select p2p_eval_submit($1, $2, 'passed', '{}'::jsonb, 'Clear answer, well grounded in the passage you studied.') r", [ev.id, passedA])).r;
ok("completion: approved through the existing outcome model", done.ok === true && (await one("select status, engine_state from p2p_lesson_evaluations where id = $1", [ev.id])).status === "approved");
await c.query("select p2p_growth_sync_evidence($1)", [passedA]);
ok("Growth Matrix: the evaluator's useful feedback is appended to the ledger as a contribution", (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1 and evidence_type = 'service.learning_feedback' and source_id = $2", [passedA, ev.id])).n === 1);

// The submitter never evaluates their own work, even if qualified.
const again = await submit(passedA, A);
ok("the submitter never evaluates their own submission, even when qualified", !(await candidates(again.id)).some((x) => x.user_id === passedA));

// ── Individual credit: two participants of one study session, two evaluations ─
{
  const C = lesson(); const m1 = await person(), m2 = await person(), q1 = await person();
  await independentlyPass(q1, C);
  const e1 = await submit(m1, C), e2 = await submit(m2, C);
  ok("each participant's answer is their own evaluation (never a group grade)", e1.id !== e2.id && e1.submitter_id === m1 && e2.submitter_id === m2);
}

// ── Safety, availability, capacity ──────────────────────────────────────────
{
  const D = lesson();
  const blocked = await person(), restricted = await person(), away = await person(), full = await person(), fine = await person(), sub = await person();
  for (const u of [blocked, restricted, away, full, fine]) await independentlyPass(u, D);
  await seed(async () => {
    await c.query("insert into p2p_user_blocks (blocker_id, blocked_id) values ($1, $2)", [sub, blocked]);
    await c.query("insert into p2p_evaluator_profiles (user_id, standing, restriction_reason) values ($1, 'restricted', 'test')", [restricted]);
    await c.query("insert into p2p_evaluator_profiles (user_id, available, unavailable_until) values ($1, false, null)", [away]);
    await c.query("insert into p2p_evaluator_profiles (user_id, capacity) values ($1, 1)", [full]);
  });
  // `full` already holds one invitation elsewhere.
  const other = lesson(); await independentlyPass(full, other); const o = await submit(await person(), other);
  ok("(setup) the busy person holds an invitation", (await active(o.id))?.evaluator_id === full);
  const e = await submit(sub, D);
  const ids = await invitedOrCandidates(e.id);
  ok("blocked, restricted, unavailable and at-capacity people are never invited or offered", !ids.includes(blocked) && !ids.includes(restricted) && !ids.includes(away) && !ids.includes(full),
    JSON.stringify({ blocked: ids.includes(blocked), restricted: ids.includes(restricted), away: ids.includes(away), full: ids.includes(full) }));
  ok("…while the eligible, available person is", ids.includes(fine));
}

// ── Matching priority ───────────────────────────────────────────────────────
{
  const E = lesson();
  const sub = await person({ lang: "de", app: "de", country: "GH", tz: "Africa/Accra", stage: 1 });
  const sameLang = await person({ lang: "de", app: "en" });
  const sameApp = await person({ lang: "en", app: "de" });
  const twoAhead = await person({ lang: "en", app: "en", stage: 3 });
  const nearby = await person({ lang: "en", app: "en", country: "GH" });
  const similarTz = await person({ lang: "en", app: "en", tz: "Europe/London" });
  const none = await person({ lang: "en", app: "en" });
  for (const u of [sameLang, sameApp, twoAhead, nearby, similarTz, none]) await independentlyPass(u, E);
  // Hold the engine: compute the ranking first (the trigger already invited the top one).
  const e = await submit(sub, E);
  const first = (await active(e.id))?.evaluator_id;
  const ranked = (await candidates(e.id)).map((x) => x.user_id);
  const order = [first, ...ranked];
  const at = (u) => order.indexOf(u);
  ok("language first: same content language is invited before anyone else", first === sameLang, JSON.stringify(order.map((u) => [sameLang, sameApp, twoAhead, nearby, similarTz, none].indexOf(u))));
  ok("then same country / same app language, then one or two stages ahead, then similar time zone, then the rest",
    at(sameApp) < at(similarTz) && at(nearby) < at(similarTz) && at(twoAhead) < at(similarTz) && at(similarTz) < at(none), JSON.stringify(order.map((u) => [sameLang, sameApp, twoAhead, nearby, similarTz, none].indexOf(u))));
  const md = (await active(e.id)).match_detail;
  ok("the recorded reasons say why — never where", md.language === "same_content_language" && md.proximity === "international_or_unknown" && !JSON.stringify(md).includes("GH"));
}

// ── Fair workload: equally suitable people take turns ───────────────────────
{
  const F = lesson();
  const p = [await person(), await person(), await person()];
  for (const u of p) await independentlyPass(u, F);
  const invited = [];
  for (let i = 0; i < 3; i++) invited.push((await active((await submit(await person(), F)).id))?.evaluator_id);
  ok("fair rotation: three submissions, three different evaluators (nobody overloaded)", new Set(invited).size === 3 && invited.every((u) => p.includes(u)), JSON.stringify(invited));
}

// ── Cold start, bootstrap roles, and stepping aside ─────────────────────────
{
  const G = lesson();
  const sub = await person(), guide = await person({ role: "peer_guide" });
  const e = await submit(sub, G);
  ok("cold start: nobody has passed this lesson → queued, not invited, listed for coordinators", e.engine_state === "queued" && !(await active(e.id))
    && (await one("select has_qualified_people from p2p_eval_coverage where resource_id = $1", [G.id]))?.has_qualified_people === false);
  ok("…and a role alone never qualifies while bootstrap roles are off", !(await candidates(e.id)).length);
  await c.query("update p2p_evaluation_settings set bootstrap_roles = array['peer_guide']");
  await c.query("update p2p_lesson_evaluations set next_attempt_at = now() where id = $1", [e.id]);
  await c.query("select p2p_eval_sweep(50)");
  let a = await active(e.id);
  ok("owner-enabled bootstrap: a configured role may evaluate a resource NOBODY has passed — labelled bootstrap", a?.evaluator_id === guide && a.match_detail.basis === "bootstrap", JSON.stringify(a?.match_detail));
  await c.query("select p2p_eval_accept($1, $2)", [a.id, guide]);
  const passer = await person();
  await independentlyPass(passer, G);
  await c.query("select p2p_eval_sweep(50)");
  a = await active(e.id);
  ok("accepted work is never taken away when the rules change (the bootstrap evaluator keeps it)", a?.evaluator_id === guide && a.status === "accepted");
  const e2 = await submit(await person(), G);
  ok("once someone has independently passed it, bootstrap roles step aside for new evaluations", (await active(e2.id))?.evaluator_id === passer && !(await candidates(e2.id)).some((x) => x.user_id === guide));
  await c.query("update p2p_evaluation_settings set bootstrap_roles = '{}'");
}

// ── Re-try as soon as someone newly qualifies ───────────────────────────────
{
  const H = lesson(); const sub = await person();
  const e = await submit(sub, H);
  await c.query("update p2p_lesson_evaluations set next_attempt_at = now() + interval '6 hours' where id = $1", [e.id]);
  await independentlyPass(await person(), H);
  const nx = await one("select next_attempt_at <= now() due from p2p_lesson_evaluations where id = $1", [e.id]);
  ok("when someone newly passes the resource, waiting evaluations are re-tried at the next sweep", nx.due === true);
  await c.query("select p2p_eval_sweep(50)");
  ok("…and the sweep invites them", !!(await active(e.id)));
}

// ── Family / Church group assignments ───────────────────────────────────────
{
  const fam = randomUUID(), asgId = randomUUID(), other = randomUUID();
  const shepherd = await person(), m1 = await person(), m2 = await person(), outsider = await person();
  await seed(async () => {
    await c.query("insert into p2p_families (id, name, shepherd_id) values ($1, 'Test family', $2)", [fam, shepherd]);
    for (const u of [shepherd, m1, m2]) await c.query("insert into p2p_family_members (family_id, user_id, role, status) values ($1, $2, 'adult', 'active')", [fam, u]);
    await c.query("insert into p2p_group_assignments (id, family_lesson_id, family_id, title, status) values ($1, gen_random_uuid(), $2, 'Serve a neighbour this week', 'published')", [asgId, fam]);
    // m2 and the outsider both "passed" this assignment (reviewed by someone else).
    await c.query("insert into p2p_group_assignment_submissions (assignment_id, user_id, content, status, reviewed_by, reviewed_at) values ($1, $2, 'done', 'reviewed', $3, now() - interval '5 days')", [asgId, m2, shepherd]);
    await c.query("insert into p2p_group_assignment_submissions (assignment_id, user_id, content, status, reviewed_by, reviewed_at) values ($1, $2, 'done', 'reviewed', $3, now() - interval '5 days')", [asgId, outsider, shepherd]);
  });
  const g0 = await one("insert into p2p_group_assignment_submissions (assignment_id, user_id, content) values ($1, $2, 'my work') returning id", [asgId, m1]);
  ok("group assignments: off by default — the leader's review stays the only path", !(await one("select 1 from p2p_lesson_evaluations where group_submission_id = $1", [g0.id])));
  await c.query("update p2p_evaluation_settings set group_assignments_enabled = true");
  const g1 = await one("insert into p2p_group_assignment_submissions (assignment_id, user_id, attempt, content) values ($1, $2, 2, 'my work again') returning id", [asgId, m1]);
  const ge = await one("select * from p2p_lesson_evaluations where group_submission_id = $1", [g1.id]);
  ok("switched on: a group submission enters the same engine as a group-assignment resource", ge?.resource_kind === "group_assignment" && ge.resource_id === asgId && ge.context === "family" && ge.lesson_id === null);
  const ga = await active(ge.id);
  ok("…evaluated only by a current member of that Family who passed that exact assignment (never an outsider)", ga?.evaluator_id === m2 && !(await candidates(ge.id)).some((x) => x.user_id === outsider));
  await c.query("select p2p_eval_accept($1, $2)", [ga.id, m2]);
  await c.query("select p2p_eval_submit($1, $2, 'passed', '{}'::jsonb, 'You put the lesson into practice thoughtfully and clearly.')", [ge.id, m2]);
  const gs = await one("select status, reviewed_by from p2p_group_assignment_submissions where id = $1", [g1.id]);
  ok("…completion marks the group submission reviewed by the evaluator", gs.status === "reviewed" && gs.reviewed_by === m2);
  await c.query("select p2p_growth_sync_evidence($1)", [m1]);
  ok("…and the Growth Matrix records the participant's verified practical action (append-only, once)", (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1 and evidence_type = 'application.group_practical_reviewed'", [m1])).n === 1);
  // Leader review outside the engine closes the engine evaluation; resubmission replaces an open one.
  const asg2 = randomUUID();
  await seed(() => c.query("insert into p2p_group_assignments (id, family_lesson_id, family_id, title, status) values ($1, gen_random_uuid(), $2, 'Pray with someone', 'published')", [asg2, fam]));
  const h1 = await one("insert into p2p_group_assignment_submissions (assignment_id, user_id, content) values ($1, $2, 'first') returning id", [asg2, m1]);
  const h1e = await one("select id, engine_state from p2p_lesson_evaluations where group_submission_id = $1", [h1.id]);
  const h2 = await one("insert into p2p_group_assignment_submissions (assignment_id, user_id, attempt, content) values ($1, $2, 2, 'second') returning id", [asg2, m1]);
  ok("…a resubmission replaces the earlier attempt still waiting (history kept)", (await one("select engine_state from p2p_lesson_evaluations where id = $1", [h1e.id])).engine_state === "cancelled"
    && (await one("select count(*)::int n from p2p_evaluation_events where evaluation_id = $1 and event_type = 'cancelled'", [h1e.id])).n === 1);
  await c.query("update p2p_group_assignment_submissions set status = 'reviewed', reviewed_by = $2, reviewed_at = now() where id = $1", [h2.id, shepherd]);
  ok("…the leader's own review closes the engine evaluation", (await one("select engine_state from p2p_lesson_evaluations where group_submission_id = $1", [h2.id])).engine_state === "cancelled");
  await c.query("update p2p_evaluation_settings set group_assignments_enabled = false");
  void other;
}

// ── Progressive geography: nearby → city → region → country → anywhere ──────
{
  const P = lesson();
  const sub = await person({ lang: "en", country: "GH", city: "Accra", region: "Greater Accra", lat: 5.6037, lon: -0.187 });
  const far = await person({ lang: "en", country: "JP" });
  const country = await person({ lang: "en", country: "GH", city: "Tamale", region: "Northern" });
  const region = await person({ lang: "en", country: "GH", city: "Tema", region: "Greater Accra" });
  const city = await person({ lang: "en", country: "GH", city: "accra ", region: "Greater Accra" });
  const near = await person({ lang: "en", country: "GH", lat: 5.65, lon: -0.2 });
  for (const u of [far, country, region, city, near]) await independentlyPass(u, P);
  const e = await submit(sub, P);
  const order = await invitedOrCandidates(e.id);
  const pos = (u) => order.indexOf(u);
  ok("geography widens progressively: nearby, then same city, same region, same country, then the wider world", pos(near) < pos(city) && pos(city) < pos(region) && pos(region) < pos(country) && pos(country) < pos(far),
    JSON.stringify([near, city, region, country, far].map(pos)));
  ok("…and someone qualified on the other side of the world is still eligible", pos(far) >= 0);
  const rs = await q("select reasons from p2p_eval_candidates($1, 10)", [e.id]);
  ok("…the reasons name the tier only — never a city, region, country or coordinates", rs.every((r) => !/Accra|Tema|Tamale|Greater|Northern|GH|JP|5\.6|0\.18/.test(JSON.stringify(r.reasons))));
}

// ── Recent performance and newcomers ─────────────────────────────────────────
{
  const Q = lesson();
  const sub = await person();
  const reliable = await person(), missed = await person(), newcomer = await person();
  for (const u of [reliable, missed, newcomer]) await independentlyPass(u, Q);
  // Both veterans have history; one missed a deadline recently. The newcomer was never invited.
  const otherEval = (await submit(await person(), lesson())).id;
  await seed(async () => {
    for (const [u, status, att] of [[reliable, "completed", 1], [missed, "overdue", 2]]) {
      await c.query(`insert into p2p_evaluation_assignments (evaluation_id, evaluator_id, attempt, status, invited_at, invite_expires_at, accepted_at, deadline_at, ended_at)
        values ($1, $2, $3 + 10, $4, now() - interval '20 days', now() - interval '19 days', now() - interval '20 days', now() - interval '18 days', now() - interval '18 days')`, [otherEval, u, att, status]);
    }
  });
  const e = await submit(sub, Q);
  const order = await invitedOrCandidates(e.id);
  ok("fairness: a newly qualified person (never invited) is offered first; a missed deadline lowers priority", order[0] === newcomer && order.indexOf(reliable) < order.indexOf(missed), JSON.stringify([newcomer, reliable, missed].map((u) => order.indexOf(u))));
}

// ── Reciprocal approvals: detected, penalised, reviewable ─────────────────────
{
  const R1 = lesson(), R2 = lesson();
  const a = await person(), b = await person(), other = await person();
  await independentlyPass(a, R1, { evaluator: b });
  await independentlyPass(b, R2, { evaluator: a });
  const pair = await one("select * from p2p_eval_reciprocal_pairs where (person_a = $1 and person_b = $2) or (person_a = $2 and person_b = $1)", [a, b]);
  ok("integrity: a pair who approved each other's work is listed for review", !!pair && pair.a_approved_b > 0 && pair.b_approved_a > 0);
  await independentlyPass(other, R1);
  const e = await submit(b, R1);
  const order = await invitedOrCandidates(e.id);
  ok("…and the engine prefers someone else over a reciprocal partner", order.indexOf(other) < order.indexOf(a), JSON.stringify([other, a].map((u) => order.indexOf(u))));
  await c.query("insert into p2p_eval_integrity_reviews (pair_key, decision, note, actor_id) values ($1, 'no_concern', 'Same study group, reviewed and fine', $2)", [pair.pair_key, other]);
  let err = null;
  try { await c.query("update p2p_eval_integrity_reviews set decision = 'concern_raised' where pair_key = $1", [pair.pair_key]); } catch (x) { err = x.message; }
  ok("…reviews are permanent (audited)", /permanent/.test(err ?? ""));
}

// ── Assessment versions: a material revision restarts qualification ─────────
{
  const V = lesson();
  const before = await person(), after = await person();
  await independentlyPass(before, V);
  const ver = (await one("select p2p_assessment_record_revision('lesson', $1, $2, 'Questions rewritten for the new edition') v", [V.id, before])).v;
  await independentlyPass(after, V, { daysAgo: 0 });
  const e = await submit(await person(), V);
  const order = await invitedOrCandidates(e.id);
  ok("versions: after a material revision, only people who passed the revised assessment qualify", ver === 2 && order.includes(after) && !order.includes(before), JSON.stringify(order.length));
  await c.query("select p2p_growth_sync_evidence($1)", [before]);
  ok("…while the earlier pass keeps its learning credit (append-only)", (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1 and unit_key = $2 and evidence_type = 'learning.assessment_passed' and voided_at is null", [before, `lesson:${V.id}`])).n === 1);
  ok("…and a repeated pass never creates a second qualification", (await q("select * from p2p_eval_qualified_pool('lesson', $1)", [V.id])).filter((r) => r.user_id === after).length === 1);
}

// ── Operations summary for administrators ───────────────────────────────────
{
  const o = (await one("select p2p_eval_operations() o")).o;
  ok("operations: qualified evaluators, resources, pending, unassigned, expiries, reassignments, timings, workload, reciprocal pairs",
    ["qualifiedEvaluators", "resourcesWithQualifiedPeople", "pending", "unassigned", "expired30d", "reassigned30d", "medianHoursToAccept", "medianHoursToComplete", "workload", "reciprocalPairs"].every((k) => k in o) && o.qualifiedEvaluators > 0);
}

// ── Security: phones can't see or drive the engine ──────────────────────────
{
  const u = await person();
  const asPhone = async (sql) => {
    await c.query("begin");
    try {
      await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub: u, role: "authenticated" }), u]);
      await c.query("set local role authenticated");
      await c.query(sql); await c.query("rollback"); return null;
    } catch (e) { await c.query("rollback"); return e.message; }
  };
  for (const [what, sql] of [["see candidates", "select * from p2p_eval_candidates(gen_random_uuid())"], ["see coverage", "select * from p2p_eval_coverage"],
    ["check qualification", `select p2p_eval_independently_qualified('${u}', 'lesson', gen_random_uuid())`], ["cancel an evaluation", "select p2p_eval_cancel(gen_random_uuid(), 'x')"],
    ["see reciprocal pairs", "select * from p2p_eval_reciprocal_pairs"], ["record a revision", `select p2p_assessment_record_revision('lesson', gen_random_uuid(), '${u}', 'my revision')`],
    ["see operations", "select p2p_eval_operations()"]]) {
    ok(`security: a phone cannot ${what}`, /permission denied/.test((await asPhone(sql)) ?? ""));
  }
}

console.log(`240 universal peer evaluation (database): ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
