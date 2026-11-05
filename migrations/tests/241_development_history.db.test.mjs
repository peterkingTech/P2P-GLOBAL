// Development history and Core Foundations progress (migration 241) — database
// scenario tests on a disposable LOCAL database with 239–241 applied.
//   GROWTH_TEST_DATABASE_URL=… GROWTH_TEST_DISPOSABLE=yes PG_MODULE=… node migrations/tests/241_development_history.db.test.mjs
// Covers: both people's stages captured at the start of a relationship and at
// every stage change; Guide transitions (history kept, new start captured,
// credit never transferred); the strictly-higher Guide rule; existing
// relationships marked 'unavailable' (never guessed); append-only checkpoints
// with audited corrections; the wider contribution network (contributors only
// through real evidence, never a title); second-generation connections; Core
// Foundations progress for every lesson and status, from Seed; security.
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
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); } };
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const seed = async (fn) => { await c.query("set session_replication_role = replica"); try { await fn(); } finally { await c.query("set session_replication_role = origin"); } };

// ── What the migration did for existing relationships ───────────────────────
const existing = await one(`select count(*)::int links,
  (select count(*)::int from p2p_mentorship_checkpoints where kind = 'start' and source = 'unavailable' and participant_stage is null and guide_stage is null) unavailable,
  (select count(*)::int from p2p_mentorship_checkpoints where kind = 'baseline' and source = 'recorded') baselines
  from p2p_discipleship_links where status in ('active', 'paused', 'ended')`);
ok("existing relationships: start stages marked unavailable (never guessed from today's stage), plus a baseline recorded now",
  existing.unavailable === existing.links && existing.baselines === (await one("select count(*)::int n from p2p_discipleship_links where status in ('active','paused')")).n, JSON.stringify(existing));

async function person(stage = 1, role = "student") {
  const id = randomUUID();
  await seed(async () => {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `h-${id}@example.invalid`]);
    await c.query(`insert into p2p_profiles (id, email, full_name, username, role, created_at) values ($1, $2, 'History test', $3, $4::user_role, (now() at time zone 'UTC') - interval '400 days')`, [id, `h-${id}@example.invalid`, `h_${id.slice(0, 12)}`, role]);
  });
  await c.query("insert into p2p_growth_status (user_id, stage, stage_since, verification) values ($1, $2, now() - interval '60 days', 'verified')", [id, stage]);
  return id;
}
const setStage = (u, s) => c.query("update p2p_growth_status set stage = $2 where user_id = $1", [u, s]);
async function link(guide, participant) {
  const r = await one(`insert into p2p_discipleship_links (mentor_id, disciple_id, status, active, is_primary, started_at, source) values ($1, $2, 'active', true, true, now(), 'direct') returning id`, [guide, participant]);
  return r.id;
}
const checkpoints = (l) => q("select kind, participant_stage, guide_stage, source, changed_person from p2p_mentorship_checkpoints where link_id = $1 order by at, kind", [l]);
let FEEDBACK_LESSON = (await one(`select l.id from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id join p2p_assignments a on a.lesson_id = l.id where cu.type = 'plan' limit 1`)).id;
/** `who` gives `learner` useful written feedback at `daysAgo` (a verified contribution once recorded). */
async function feedback(who, learner, daysAgo) {
  await seed(() => c.query(`with s as (insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
      select gen_random_uuid(), $1, $3, aq.id, 'text', 'x', now() - make_interval(days => $4) from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $3 limit 1 returning id, lesson_id)
    insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, assigned_at, feedback)
    select id, lesson_id, $1, $2, 'needs_revision', now() - make_interval(days => $4), now() - make_interval(days => $4), 'A clear and specific suggestion that will help you understand this.' from s`, [learner, who, FEEDBACK_LESSON, daysAgo]));
  await c.query("select p2p_growth_sync_evidence($1)", [who]);
}

// ── Start, checkpoints, transitions ─────────────────────────────────────────
const p = await person(1), g1 = await person(3), g2 = await person(5);
const l1 = await link(g1, p);
let cp = await checkpoints(l1);
ok("start: both people's verified stages at the moment the relationship began (Seed, Young Tree)", cp.length === 1 && cp[0].kind === "start" && cp[0].participant_stage === 1 && cp[0].guide_stage === 3 && cp[0].source === "recorded");
await setStage(p, 2);
await setStage(g1, 4);
cp = await checkpoints(l1);
ok("checkpoints: every stage change of either person is recorded with both stages at that time",
  cp.length === 3 && cp[1].participant_stage === 2 && cp[1].guide_stage === 3 && cp[1].changed_person === "participant" && cp[2].participant_stage === 2 && cp[2].guide_stage === 4 && cp[2].changed_person === "guide", JSON.stringify(cp));
ok("…earlier checkpoints never change when stages change later", cp[0].participant_stage === 1 && cp[0].guide_stage === 3);
await feedback(g1, p, 0);
await c.query("update p2p_discipleship_links set status = 'ended', active = false, is_primary = false, ended_at = now(), end_reason = 'test' where id = $1", [l1]);
cp = await checkpoints(l1);
ok("transition: the ended relationship keeps its history and records both stages at the end", cp.at(-1).kind === "end" && cp.at(-1).participant_stage === 2 && cp.at(-1).guide_stage === 4);
const l2 = await link(g2, p);
cp = await checkpoints(l2);
ok("transition: the new relationship captures both starting stages (Sprout, Forest Builder)", cp[0].kind === "start" && cp[0].participant_stage === 2 && cp[0].guide_stage === 5);
const h = (await one("select p2p_development_history($1) h", [p])).h;
ok("history: both Guides visible — current and previous — with their checkpoints", h.guides.length === 2 && h.guides.some((x) => x.guideId === g1 && x.status === "ended" && x.checkpoints.length === 4) && h.guides.some((x) => x.guideId === g2 && x.status === "active"));
ok("history: contributions stay with the Guide who made them (never transferred to the new Guide)",
  h.guides.find((x) => x.guideId === g1).contributions === 1 && h.guides.find((x) => x.guideId === g2).contributions === 0);
const hg = (await one("select p2p_development_history($1) h", [g1])).h;
ok("history (as Guide): the people they guided, with the same checkpoints", hg.guiding.length === 1 && hg.guiding[0].participantId === p && hg.guiding[0].checkpoints.length === 4);

// The strictly-higher rule (on by default).
const same = await person(2);
let err = null;
try { await link(same, p); } catch (e) { err = e.message; }
ok("the designated Peer Guide must be at a strictly higher verified stage (rule on by default)", /P2P_GUIDE_STAGE/.test(err ?? ""), err ?? "allowed");

// ── Wider contribution network ──────────────────────────────────────────────
const pastor = await person(4, "church_leader"), titled = await person(5, "church_leader");
await feedback(pastor, p, 1);
const h2 = (await one("select p2p_development_history($1) h", [p])).h;
ok("contributors: a Pastor who verifiably helped appears — without becoming a designated Guide", h2.contributors.some((x) => x.personId === pastor && x.wasDesignatedGuide === false && x.contributions === 1));
ok("contributors: a title alone gives no place in anyone's history", !h2.contributors.some((x) => x.personId === titled));
ok("contributors: designated Guides who helped are marked as such", h2.contributors.some((x) => x.personId === g1 && x.wasDesignatedGuide === true));
// Second generation: p helps someone else.
const next = await person(1);
await feedback(p, next, 0);
const hg1 = (await one("select p2p_development_history($1) h", [g1])).h;
ok("generations: the people a contributor helped, and whether they went on to help others", hg1.helped.some((x) => x.personId === p && x.helpsOthers === true));

// ── Append-only with audited corrections ────────────────────────────────────
const first = await one("select id from p2p_mentorship_checkpoints where link_id = $1 and kind = 'start'", [l1]);
err = null;
try { await c.query("update p2p_mentorship_checkpoints set participant_stage = 5 where id = $1", [first.id]); } catch (e) { err = e.message; }
ok("checkpoints are permanent", /permanent/.test(err ?? ""));
const corr = (await one("select p2p_mentorship_correct($1, 1, 3, $2, 'Verified against the relationship records with both people') id", [first.id, pastor])).id;
ok("a correction is a new, audited checkpoint pointing at the original", !!(await one("select 1 from p2p_mentorship_checkpoints where id = $1 and kind = 'correction' and corrects_checkpoint_id = $2 and actor_id = $3", [corr, first.id, pastor])));

// ── Core Foundations Curriculum progress, from Seed ─────────────────────────
const core = await q(`select l.id, (select count(*) from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = l.id)::int nq
  from p2p_lessons l join p2p_modules m on m.id = l.module_id join p2p_curriculums cu on cu.id = m.curriculum_id
 where l.id in (select p2p_growth_foundation_lessons()) order by coalesce(cu.display_order, 0), cu.created_at, m.order_index, l.order_index`);
const seedP = await person(1), peer = await person(2);
const answerAll = async (u, L, status, { selfApproved = false, engine = null } = {}) => seed(() => c.query(`with s as (
    insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, submission_type, text_content, created_at)
    select gen_random_uuid(), $1, $2, aq.id, 'text', 'x', now() - interval '3 days' from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $2 returning id)
  insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, resolved_at, assigned_at, self_approved, engine_state)
  select id, $2, $1, $3, $4, case when $4 = 'pending' then null else now() - interval '2 days' end, now() - interval '2 days', $5, $6 from s`, [u, L, selfApproved ? u : peer, status, selfApproved, engine]));
await answerAll(seedP, core[0].id, "approved");
await answerAll(seedP, core[1].id, "approved");
await answerAll(seedP, core[1].id, "approved");          // passing again
await answerAll(seedP, core[2].id, "pending", { engine: "queued" });
await answerAll(seedP, core[3].id, "needs_revision");
await answerAll(seedP, core[4].id, "approved", { selfApproved: true });
await answerAll(seedP, core[5].id, "pending", { engine: "cancelled" });
const partial = core.find((x, i) => i > 5 && x.nq > 1);
await seed(() => c.query(`insert into p2p_submissions (user_id, lesson_id, assignment_question_id, submission_type, text_content)
  select $1, $2, aq.id, 'text', 'x' from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id where a.lesson_id = $2 limit 1`, [seedP, partial.id]));
await c.query("select p2p_growth_sync_evidence($1)", [seedP]);
const prog = await q("select * from p2p_core_curriculum_progress($1)", [seedP]);
const st = Object.fromEntries(prog.map((r) => [r.lesson_id, r.status]));
ok("a Seed participant sees every Kingdom School Foundations lesson, across every published Kingdom School curriculum", prog.length === core.length && core.length > 84
  && new Set(prog.map((r) => r.curriculum_title)).size >= 3 && prog.some((r) => r.curriculum_title === "Peer-to-Peer Orientation") && prog.some((r) => r.curriculum_title === "The Christian Foundation"));
ok("statuses: passed, awaiting evaluation, returned for correction, not yet passed (self-approved), in progress, not started",
  st[core[0].id] === "passed" && st[core[1].id] === "passed" && st[core[2].id] === "awaiting_evaluation" && st[core[3].id] === "returned"
  && st[core[4].id] === "not_yet_passed" && st[partial.id] === "in_progress" && st[core.at(-1).id] === "not_started", JSON.stringify([0, 1, 2, 3, 4].map((i) => st[core[i].id])));
ok("fresh start: a lesson whose waiting evaluation was closed reads 'answer again' (never 'awaiting evaluation')", st[core[5].id] === "answer_again");
ok("only independently passed lessons count; passing again never double-counts", prog.filter((r) => r.status === "passed").length === 2);
const facts = (await one("select p2p_growth_evaluate($1) e", [seedP])).e.facts;
ok(`Foundations (2 / ${core.length}) is one figure, distinct from general learning units — the same pass is one evidence event`,
  facts.core_lessons_passed === 2 && facts.core_lessons_total === core.length && facts.learning_units >= 2
  && (await one("select count(*)::int n from p2p_growth_evidence where user_id = $1 and evidence_type = 'learning.assessment_passed'", [seedP])).n === 2);
const ev = (await one("select p2p_growth_evaluate($1) e", [seedP])).e;
const fb = ev.stages.find((s) => s.stage === 5).requirements;
ok("the all-Foundations gate is only the additional Forest Builder requirement (no other stage asks for it)",
  fb.some((r) => r.key === "core_curriculum_complete" && r.need === core.length && r.have === 2 && !r.met) && ev.stages.filter((s) => s.stage < 5).every((s) => !s.requirements.some((r) => r.key === "core_curriculum_complete")));

// ── Security ────────────────────────────────────────────────────────────────
for (const [what, sql] of [["read checkpoints", "select * from p2p_mentorship_checkpoints"], ["read someone's history", `select p2p_development_history('${p}')`],
  ["read Core progress directly", `select * from p2p_core_curriculum_progress('${p}')`], ["write a checkpoint", `select p2p_mentorship_checkpoint('${l1}', 'baseline')`]]) {
  await c.query("begin");
  let e2 = null;
  try { await c.query("set local role authenticated"); await c.query(sql); } catch (x) { e2 = x.message; }
  await c.query("rollback");
  ok(`security: a phone cannot ${what}`, /permission denied/.test(e2 ?? ""));
}

console.log(`241 development history (database): ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
