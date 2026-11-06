// Peer Evaluation Engine (migration 229) — the API layer: routes/peerEvaluation.ts
// over HTTP against an in-memory database, with the database engine functions
// (p2p_eval_*) faked, plus the plain rules in lib/peerEvaluation.ts. The engine
// itself (assignment, deadlines, reassignment, concurrency, RLS) is tested on
// real Postgres in the 229 restore rehearsal (scenarios A–G).
//   • identity: an evaluatee never sees an INVITED evaluator; an invited
//     evaluator never sees the evaluatee's name or answers;
//   • only the accepted evaluator gets the workspace; a previous one gets 404;
//   • no route takes a replacement evaluator or an extension; admin routes are
//     admin-only and still let the SYSTEM choose;
//   • feedback validation keeps the check's own questions only; recognitions
//     reward quality and reliability, not volume.
// Run: node tests/peerEvaluation.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmpDir = path.join(root, "tests", `.tmp-eval-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__ev.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  minors: "export const childUserIds = async () => new Set();",
  studyPartnerAuth: "export const getEligibleStudyPartners = async () => new Map();",
  groupLearning: "export const canManageGroupLearning = async () => false; export const isGroupMember = async () => false;",
  pushDispatch: "export const dispatchNotificationNow = async () => {};",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)(supabase|minors|studyPartnerAuth|groupLearning|pushDispatch)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

// ── In-memory database (+ engine RPC fakes that record their calls) ─────────
const T = {};
const rpcCalls = [];
let rpcResult = { ok: true };
function makeDb() {
  return {
    from(table) {
      const q = { op: "select", f: [], payload: null, single: false, lim: null, orders: [], head: false };
      const rows = () => (T[table] ??= []);
      const match = (r) => q.f.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "in" ? v.includes(r[k]) : op === "is" ? (r[k] ?? null) === v : op === "neq" ? r[k] !== v
        : op === "notnull" ? r[k] != null : op === "gte" ? r[k] >= v : op === "contains" ? Object.entries(v).every(([kk, vv]) => r[k]?.[kk] === vv) : true);
      const exec = () => {
        let data;
        if (q.op === "insert") { const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...p })); rows().push(...list); data = list; }
        else if (q.op === "update") { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, q.payload)); data = hit; }
        else { data = rows().filter(match); for (const [k, asc] of [...q.orders].reverse()) data = [...data].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); if (q.lim) data = data.slice(0, q.lim); }
        data = data.map((r) => ({ ...r }));
        if (q.head) return { data: null, count: data.length, error: null };
        return { data: q.single ? data[0] ?? null : data, error: null };
      };
      const c = {
        select(_c, o) { if (o?.head) q.head = true; return c; }, insert(p) { q.op = "insert"; q.payload = p; return c; }, update(p) { q.op = "update"; q.payload = p; return c; },
        eq(k, v) { q.f.push(["eq", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
        is(k, v) { q.f.push(["is", k, v]); return c; }, neq(k, v) { q.f.push(["neq", k, v]); return c; },
        gte(k, v) { q.f.push(["gte", k, v]); return c; }, contains(k, v) { q.f.push(["contains", k, v]); return c; },
        not(k, op, v) { if (op === "is" && v === null) q.f.push(["notnull", k]); return c; },
        order(k, o) { q.orders.push([k, o?.ascending !== false]); return c; }, limit(n) { q.lim = n; return c; },
        maybeSingle() { q.single = true; return c; }, single() { q.single = true; return c; },
        then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
      };
      return c;
    },
    rpc: async (fn, args) => { rpcCalls.push({ fn, args }); return { data: typeof rpcResult === "function" ? rpcResult(fn, args) : rpcResult, error: null }; },
  };
}
globalThis.__ev = { db: makeDb() };

// People, a lesson with a check (2 questions), one submission.
const [L, E1, E2, X, ADMIN] = Array.from({ length: 5 }, () => randomUUID());
T.p2p_profiles = [[L, "Lena Learner", "student"], [E1, "Esi Evaluator", "student"], [E2, "Eli Second", "student"], [X, "Xen Stranger", "student"], [ADMIN, "Ada Admin", "super_admin"]]
  .map(([id, full_name, role]) => ({ id, full_name, role, photo_url: null }));
const LESSON = randomUUID(), MOD = randomUUID(), CUR = randomUUID(), ASG = randomUUID(), Q1 = randomUUID(), Q2 = randomUUID(), SUB = randomUUID();
T.p2p_curriculums = [{ id: CUR, title: "The Gospel" }];
T.p2p_modules = [{ id: MOD, curriculum_id: CUR }];
T.p2p_lessons = [{ id: LESSON, title: "Grace", module_id: MOD }];
T.p2p_assignments = [{ id: ASG, lesson_id: LESSON, title: "Grace check", instructions: "Answer both." }];
T.p2p_assignment_questions = [{ id: Q1, assignment_id: ASG, question: "What is grace?", display_order: 1 }, { id: Q2, assignment_id: ASG, question: "Ephesians 2:8?", display_order: 2 }];
const t0 = new Date(Date.now() - 3600_000).toISOString();
T.p2p_submissions = [
  { id: SUB, user_id: L, lesson_id: LESSON, assignment_id: ASG, assignment_question_id: Q1, submission_type: "text", text_content: "Unearned favour", media_url: null, created_at: t0 },
  { id: randomUUID(), user_id: L, lesson_id: LESSON, assignment_id: ASG, assignment_question_id: Q2, submission_type: "text", text_content: "Saved by grace through faith", media_url: null, created_at: t0 },
];
T.p2p_notes = [{ id: randomUUID(), user_id: L, body: "PRIVATE JOURNAL" }];
const EV = randomUUID(), A1 = randomUUID();
T.p2p_lesson_evaluations = [{ id: EV, submission_id: SUB, lesson_id: LESSON, resource_kind: "lesson", resource_id: LESSON, context: "kingdom_school", group_submission_id: null, submitter_id: L, evaluator_id: null, status: "pending", feedback: null, assigned_at: t0, created_at: t0, resolved_at: null, self_approved: false,
  engine_state: "invited", current_assignment_id: A1, accepted_at: null, deadline_at: null, outcome: null, feedback_detail: null, queued_since: t0 }];
T.p2p_evaluation_assignments = [{ id: A1, evaluation_id: EV, evaluator_id: E1, attempt: 1, status: "invited", match_detail: { basis: "passed_this_resource", language: "same_content_language" }, invited_at: t0, invite_expires_at: new Date(Date.now() + 3600_000).toISOString(), accepted_at: null, deadline_at: null, ended_at: null, end_reason: null, draft: null }];
T.p2p_evaluation_events = [{ evaluation_id: EV, event_type: "submitted", created_at: t0 }, { evaluation_id: EV, event_type: "invited", created_at: t0, actor_id: E1 }];
T.p2p_evaluation_settings = [{ id: true, engine_enabled: true, invitation_window_minutes: 180, default_capacity: 2, orientation_version: 1 }];

let server, base;
const call = async (method, p, user, body) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json, text: JSON.stringify(json) };
};

try {
  // ── Rules ────────────────────────────────────────────────────────────────
  const R = await bundle("src/lib/peerEvaluation.ts", "rules.mjs");
  ok("rules: all six commitments are required", R.missingCommitments([]).length === 6 && R.missingCommitments(R.COMMITMENT_IDS).length === 0 && R.missingCommitments(["purpose", "deadline"]).length === 4);
  ok("rules: the deadline is 48 hours; nothing about extensions anywhere", R.DEADLINE_HOURS === 48 && !/extension/i.test(readFileSync(path.join(root, "src/lib/peerEvaluation.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/no extensions/gi, "")));
  const fb = R.cleanFeedback({ questions: [{ questionId: Q1, status: "well_understood", note: "Yes" }, { questionId: "invented", status: "well_understood" }, { questionId: Q1, status: "not_yet_understood" }], understoodWell: "Grace", encouragement: "Keep going" }, [Q1, Q2]);
  ok("rules: feedback keeps only the check's own questions (no invented criteria), each once", typeof fb === "object" && fb.detail.questions.length === 1 && fb.detail.questions[0].questionId === Q1);
  ok("rules: encouragement is required; a bad status is refused", typeof R.cleanFeedback({ understoodWell: "x" }, []) === "string" && typeof R.cleanFeedback({ questions: [{ questionId: Q1, status: "wrong" }], understoodWell: "x", encouragement: "y" }, [Q1]) === "string");
  ok("rules: a reasonable difference of interpretation can be named (not marked wrong)", R.cleanFeedback({ questions: [{ questionId: Q1, status: "partially_understood", kind: "reasonable_difference" }], understoodWell: "x", encouragement: "y" }, [Q1]).detail.questions[0].kind === "reasonable_difference");
  const now = Date.now();
  ok("rules: evaluatee stages", R.evaluateeStage({ engine_state: "queued", status: "pending" }) === "arranging" && R.evaluateeStage({ engine_state: "invited", status: "pending" }) === "invitation_pending"
    && R.evaluateeStage({ engine_state: "in_progress", status: "pending", deadline_at: new Date(now + 1000).toISOString() }) === "in_progress"
    && R.evaluateeStage({ engine_state: "in_progress", status: "pending", deadline_at: new Date(now - 1000).toISOString() }) === "overdue_reassigning"
    && R.evaluateeStage({ engine_state: "completed", status: "needs_revision" }) === "revision_required" && R.evaluateeStage({ engine_state: null, status: "approved" }) === "completed");
  const hist = R.learnerHistory([{ event_type: "submitted", created_at: "1" }, { event_type: "invited", created_at: "2" }, { event_type: "declined", created_at: "3" }, { event_type: "invited", created_at: "4" }, { event_type: "notified", created_at: "5" }, { event_type: "overdue", created_at: "6" }]);
  ok("rules: the learner's history is friendly and never names anyone", hist.length === 5 && !hist.some((h) => /Esi|E1|notified/.test(h.text)) && hist.some((h) => h.text === "Your evaluation was reassigned"));
  const done = (onTime) => ({ status: "completed", accepted_at: "2026-01-01T00:00:00Z", deadline_at: "2026-01-03T00:00:00Z", ended_at: onTime ? "2026-01-02T00:00:00Z" : "2026-01-04T00:00:00Z", end_reason: "completed" });
  const good = { helpfulness: 5, clarity: 5, respectfulness: 5, encouragement: 5, relevance: 5, helped_understand: true, substantiated: null, concern: false };
  const many = R.serviceRecord(Array(30).fill(done(true)), []);
  ok("rules: recognition is never for volume alone (30 on-time, no quality feedback → no 'Encouraging Guide')", !R.recognitions(many).some((r) => r.id === "encouraging_guide" || r.id === "growth_builder" || r.id === "mentor_in_service"));
  const rec = R.serviceRecord(Array(6).fill(done(true)), Array(6).fill(good));
  ok("rules: faithful, encouraging service is recognised", ["faithful_service", "timely_evaluator", "encouraging_guide", "growth_builder"].every((id) => R.recognitions(rec).some((r) => r.id === id)));
  ok("rules: a substantiated concern removes recognition; repeated issues suggest a human review (never automatic suspension)",
    R.recognitions(R.serviceRecord(Array(6).fill(done(true)), [...Array(5).fill(good), { ...good, substantiated: true }])).length <= 1
    && R.needsReview(R.serviceRecord([...Array(3).fill({ status: "overdue", accepted_at: "x", deadline_at: "x", ended_at: "x", end_reason: "deadline_passed" })], [])) && !R.needsReview(R.serviceRecord([{ status: "overdue", accepted_at: "x", deadline_at: "x", ended_at: "x" }], [])));
  ok("rules: quality ratings 1–5 required", typeof R.cleanQuality({ helpfulness: 6 }) === "string" && typeof R.cleanQuality({ helpfulness: 5, clarity: 5, respectfulness: 5, encouragement: 5, relevance: 5, helpedUnderstand: true }) === "object");

  // ── Routes ───────────────────────────────────────────────────────────────
  const express = createRequire(path.join(root, "package.json"))("express");
  const { default: router } = await bundle("src/routes/peerEvaluation.ts", "route.mjs");
  const app = express(); app.use(express.json()); app.use("/e", router);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  ok("signed out → 401", (await call("GET", "/e/mine")).status === 401);
  // While only INVITED.
  const mine = await call("GET", "/e/mine", L);
  ok("evaluatee list: a plain status label from the lifecycle (Assigned — waiting to accept)", mine.body.items[0].statusLabel === "Assigned — waiting for the evaluator to accept");
  ok("evaluatee list: stage 'invitation pending', NO evaluator named while only invited; server time included", mine.body.items[0].stage === "invitation_pending" && mine.body.items[0].evaluator === null && !mine.text.includes("Esi") && !!mine.body.serverNow);
  const detail = await call("GET", `/e/${EV}`, L);
  ok("evaluatee detail: no invited identity, friendly history, no feedback yet", detail.body.role === "evaluatee" && detail.body.evaluator === null && !detail.text.includes("Esi") && detail.body.feedback === null && detail.body.history.length === 2);
  const inv = await call("GET", `/e/invitations/${A1}`, E1);
  ok("invitation: lesson, kind, expected work, 48-hour policy — no evaluatee name or answers", inv.status === 200 && inv.body.lessonTitle === "Grace" && inv.body.questionCount === 2 && /48 hours/.test(inv.body.deadlinePolicy)
    && !inv.text.includes("Lena") && !inv.text.includes("Unearned") && !inv.text.includes("PRIVATE"));
  ok("invitation: says why — the exact lesson they passed independently — and the commitments agreed on acceptance (no separate orientation)",
    /passed this exact lesson through an independent evaluation/.test(inv.body.competence) && inv.body.commitments.length === 6);
  ok("invitation: never reveals the matching reasons (language, proximity) to anyone", !/same_content_language|proximity/.test(inv.text));
  ok("invitation: only the invited person can open it", (await call("GET", `/e/invitations/${A1}`, E2)).status === 404 && (await call("GET", `/e/invitations/${A1}`, L)).status === 404);
  ok("an invited evaluator has no workspace before accepting", (await call("GET", `/e/${EV}`, E1)).status === 404);
  ok("strangers see nothing", (await call("GET", `/e/${EV}`, X)).status === 404);

  // Accept → the engine records time and deadline.
  rpcResult = (fn) => (fn === "p2p_eval_accept" ? { ok: true, acceptedAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 48 * 3600_000).toISOString() } : { ok: true });
  const acc = await call("POST", `/e/invitations/${A1}/accept`, E1);
  ok("accept: goes to the engine with the signed-in user (the phone sends no time or deadline)", acc.status === 200 && rpcCalls.at(-1).fn === "p2p_eval_accept" && rpcCalls.at(-1).args.p_user === E1 && Object.keys(rpcCalls.at(-1).args).length === 2);
  // Simulate what the engine did.
  const accAt = new Date().toISOString(), dl = new Date(Date.now() + 48 * 3600_000).toISOString();
  Object.assign(T.p2p_lesson_evaluations[0], { engine_state: "in_progress", evaluator_id: E1, accepted_at: accAt, deadline_at: dl });
  Object.assign(T.p2p_evaluation_assignments[0], { status: "accepted", accepted_at: accAt, deadline_at: dl });
  const mine2 = await call("GET", "/e/mine", L);
  ok("after acceptance the evaluatee sees who it is, and the server deadline", mine2.body.items[0].evaluator?.name === "Esi Evaluator" && mine2.body.items[0].deadlineAt === dl);
  const ws = await call("GET", `/e/${EV}`, E1);
  ok("workspace: the accepted evaluator sees the check, its questions and THIS check's answers — never private notes", ws.body.role === "evaluator" && ws.body.questions.length === 2 && ws.body.questions[0].answer.text === "Unearned favour"
    && ws.body.evaluatee.name === "Lena Learner" && !ws.text.includes("PRIVATE"));
  // Engine errors become clear messages.
  rpcResult = { ok: false, error: "expired" };
  const late = await call("POST", `/e/invitations/${A1}/accept`, E2);
  ok("engine refusals become clear messages", late.status === 409 && /expired/.test(late.body.error));
  rpcResult = { ok: true };
  // Inability: a category is required; no "replacement" is ever passed on.
  ok("inability: a reason category is required", (await call("POST", `/e/assignments/${A1}/unable`, E1, {})).status === 400);
  await call("POST", `/e/assignments/${A1}/unable`, E1, { category: "family", note: "Sorry", replacementId: E2, evaluatorId: E2 });
  ok("inability: the request can't steer who is next (no replacement reaches the engine)", rpcCalls.at(-1).fn === "p2p_eval_report_unable" && !JSON.stringify(rpcCalls.at(-1).args).includes(E2));
  // Submit: validated, only the accepted evaluator.
  ok("submit: only the accepted evaluator", (await call("POST", `/e/${EV}/submit`, E2, { outcome: "passed", feedback: { understoodWell: "x", encouragement: "y" } })).status === 404);
  ok("submit: feedback without encouragement is refused before the engine", (await call("POST", `/e/${EV}/submit`, E1, { outcome: "passed", feedback: { understoodWell: "x" } })).status === 400);
  await call("POST", `/e/${EV}/submit`, E1, { outcome: "passed_with_recommendations", feedback: { questions: [{ questionId: Q1, status: "well_understood" }, { questionId: "fake", status: "well_understood" }], understoodWell: "Grace", encouragement: "Well done" } });
  ok("submit: reaches the engine with cleaned feedback", rpcCalls.at(-1).fn === "p2p_eval_submit" && rpcCalls.at(-1).args.p_detail.questions.length === 1 && rpcCalls.at(-1).args.p_outcome === "passed_with_recommendations");
  // Reassigned → the previous evaluator loses access.
  Object.assign(T.p2p_lesson_evaluations[0], { engine_state: "invited", evaluator_id: null, accepted_at: null, deadline_at: null });
  ok("after reassignment the previous evaluator has no workspace", (await call("GET", `/e/${EV}`, E1)).status === 404);
  // Completed → feedback, rating once.
  Object.assign(T.p2p_lesson_evaluations[0], { engine_state: "completed", evaluator_id: E2, status: "approved", outcome: "passed", feedback: "Well done", feedback_detail: { understoodWell: "Grace", encouragement: "Well done", questions: [] } });
  const d2 = await call("GET", `/e/${EV}`, L);
  ok("evaluatee: feedback once complete; rating offered", d2.body.feedback?.outcome === "passed" && d2.body.canRate === true);
  ok("rating: only the evaluatee", (await call("POST", `/e/${EV}/quality`, E2, { helpfulness: 5, clarity: 5, respectfulness: 5, encouragement: 5, relevance: 5, helpedUnderstand: true })).status === 404);
  ok("rating: saved once", (await call("POST", `/e/${EV}/quality`, L, { helpfulness: 5, clarity: 4, respectfulness: 5, encouragement: 5, relevance: 4, helpedUnderstand: true })).status === 200
    && (await call("POST", `/e/${EV}/quality`, L, { helpfulness: 5, clarity: 4, respectfulness: 5, encouragement: 5, relevance: 4, helpedUnderstand: true })).status === 409 && T.p2p_evaluation_quality[0].evaluator_id === E2);

  // Orientation and availability.
  ok("orientation: every commitment required", (await call("POST", "/e/me/orientation", X, { commitments: ["purpose"] })).status === 400);
  ok("orientation: recorded with the version", (await call("POST", "/e/me/orientation", X, { commitments: ["purpose", "deadline", "reassignment", "respect", "privacy", "report"] })).status === 200 && T.p2p_evaluator_profiles.find((p) => p.user_id === X).orientation_version === 1);
  const FRESH = randomUUID();
  T.p2p_profiles.push({ id: FRESH, full_name: "Fay Fresh", role: "student", photo_url: null });
  ok("availability: nobody is paused until they pause themselves (no profile yet → open, as the engine matches)", (await call("GET", "/e/me/evaluator", FRESH)).body.available === true && !T.p2p_evaluator_profiles?.some((p) => p.user_id === FRESH));
  const self = await call("PUT", "/e/me/evaluator", X, { available: false, capacity: 3, standing: "good" });
  ok("availability: someone who paused shows as paused", (await call("GET", "/e/me/evaluator", X)).body.available === false);
  ok("availability is self-service; standing (restriction) is not", self.status === 200 && T.p2p_evaluator_profiles.find((p) => p.user_id === X).available === false && T.p2p_evaluator_profiles.find((p) => p.user_id === X).standing === undefined);
  const prof = await call("GET", "/e/me/evaluator", X);
  ok("my evaluator profile: no orientation gate (older builds see oriented), commitments, 48 hours, private record", prof.body.oriented === true && prof.body.deadlineHours === 48 && prof.body.commitments.length === 6 && prof.body.record.completed === 0);
  const FAILED_LESSON = randomUUID(), VOIDED_LESSON = randomUUID();
  T.p2p_growth_evidence = [
    { id: randomUUID(), user_id: E2, evidence_type: "learning.assessment_passed", verification: "verified", voided_at: null, source_table: "p2p_lessons", source_id: LESSON },
    // The same lesson passed again never counts twice.
    { id: randomUUID(), user_id: E2, evidence_type: "learning.assessment_passed", verification: "verified", voided_at: null, source_table: "p2p_lessons", source_id: LESSON },
    // An attempt that didn't pass, and a voided pass, never qualify.
    { id: randomUUID(), user_id: E2, evidence_type: "learning.assessment_attempted", verification: "verified", voided_at: null, source_table: "p2p_lessons", source_id: FAILED_LESSON },
    { id: randomUUID(), user_id: E2, evidence_type: "learning.assessment_passed", verification: "verified", voided_at: t0, source_table: "p2p_lessons", source_id: VOIDED_LESSON },
  ];
  T.p2p_growth_learning_units = [{ lesson_id: LESSON, title: "Grace", curriculum_title: "The Gospel" }, { lesson_id: FAILED_LESSON, title: "Faith", curriculum_title: "The Gospel" }, { lesson_id: VOIDED_LESSON, title: "Hope", curriculum_title: "The Gospel" }];
  T.p2p_group_assignment_submissions = [{ id: randomUUID(), user_id: E2, status: "reviewed", reviewed_by: ADMIN }, { id: randomUUID(), user_id: E2, status: "reviewed", reviewed_by: E2 }];
  const p2 = await call("GET", "/e/me/evaluator", E2);
  ok("my evaluator profile: how invitations work, and how many exact resources I've passed independently (self-reviews never count)", p2.body.qualifiedResources === 2 && /that same one/.test(p2.body.howInvited));
  ok("my evaluator profile: the exact resources listed by identity — once each; failed and voided ones never qualify", p2.body.qualified.length === 1 && p2.body.qualified[0].resourceId === LESSON
    && p2.body.qualified[0].title === "Grace" && p2.body.qualified[0].within === "The Gospel" && !p2.text.includes("Faith") && !p2.text.includes("Hope"));
  ok("my evaluator profile: someone who passed nothing is not yet qualified", (await call("GET", "/e/me/evaluator", X)).body.qualified.length === 0);
  const noSignup = await call("PUT", "/e/me/evaluator", L, { available: false });
  ok("availability needs no sign-up: a first change simply creates the profile", noSignup.status === 200 && T.p2p_evaluator_profiles.find((p) => p.user_id === L).available === false);

  // A Family / Church group assignment through the same engine.
  const GA = randomUUID(), GS = randomUUID(), GEV = randomUUID(), GA1 = randomUUID();
  T.p2p_group_assignments = [{ id: GA, title: "Serve a neighbour", instructions: "Do it, then tell us how.", family_id: randomUUID(), church_id: null }];
  T.p2p_group_assignment_submissions.push({ id: GS, assignment_id: GA, user_id: L, content: "I helped my neighbour carry shopping.", submitted_at: t0, status: "submitted" });
  T.p2p_lesson_evaluations.push({ id: GEV, submission_id: null, lesson_id: null, resource_kind: "group_assignment", resource_id: GA, group_submission_id: GS, context: "family", submitter_id: L, evaluator_id: null, status: "pending",
    feedback: null, assigned_at: t0, created_at: t0, resolved_at: null, self_approved: false, engine_state: "invited", current_assignment_id: GA1, accepted_at: null, deadline_at: null, outcome: null, feedback_detail: null, queued_since: t0 });
  T.p2p_evaluation_assignments.push({ id: GA1, evaluation_id: GEV, evaluator_id: E2, attempt: 1, status: "invited", invited_at: t0, invite_expires_at: new Date(Date.now() + 3600_000).toISOString(), match_detail: { basis: "passed_this_resource" } });
  const gi = await call("GET", `/e/invitations/${GA1}`, E2);
  ok("group assignment invitation: the assignment, its kind, why (same group, same assignment) — no name or work", gi.status === 200 && gi.body.kind === "Group assignment" && gi.body.lessonTitle === "Serve a neighbour"
    && /same assignment/.test(gi.body.competence) && !gi.text.includes("Lena") && !gi.text.includes("shopping"));
  Object.assign(T.p2p_lesson_evaluations.at(-1), { engine_state: "in_progress", evaluator_id: E2, accepted_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 48 * 3600_000).toISOString() });
  const gw = await call("GET", `/e/${GEV}`, E2);
  ok("group assignment workspace: the instructions and that one piece of work", gw.body.role === "evaluator" && gw.body.resourceKind === "group_assignment" && gw.body.instructions === "Do it, then tell us how."
    && gw.body.overallAnswer[0].text.includes("shopping") && gw.body.questions.length === 0 && !gw.text.includes("PRIVATE"));
  await call("POST", `/e/${GEV}/submit`, E2, { outcome: "passed", feedback: { understoodWell: "You served well", encouragement: "Keep going" } });
  ok("group assignment submit: reaches the same engine", rpcCalls.at(-1).fn === "p2p_eval_submit" && rpcCalls.at(-1).args.p_eval === GEV);
  const gm = await call("GET", "/e/mine", L);
  ok("the learner's list names each resource correctly, lesson or group assignment", gm.body.items.some((i) => i.lessonTitle === "Serve a neighbour" && i.resourceKind === "group_assignment") && gm.body.items.some((i) => i.lessonTitle === "Grace"));

  // Oversight.
  ok("admin routes: everyone else gets 403", (await call("GET", "/e/admin/overview", E1)).status === 403 && (await call("POST", `/e/admin/evaluations/${EV}/reassign`, L, { reason: "x" })).status === 403 && (await call("PUT", "/e/admin/settings", E1, { engineEnabled: false })).status === 403);
  const ov = await call("GET", "/e/admin/overview", ADMIN);
  ok("admin overview: counts and health", ov.status === 200 && typeof ov.body.counts.arranging === "number" && "health" in ov.body);
  await call("POST", `/e/admin/evaluations/${EV}/reassign`, ADMIN, { reason: "Evaluator asked to step back", evaluatorId: E2 });
  ok("admin reassign: a reason is required and the SYSTEM picks (no evaluator passed)", rpcCalls.at(-1).fn === "p2p_eval_admin_reassign" && !JSON.stringify(rpcCalls.at(-1).args).includes(E2) && (await call("POST", `/e/admin/evaluations/${EV}/reassign`, ADMIN, {})).status === 400);
  await call("PUT", "/e/admin/settings", ADMIN, { engineEnabled: false, deadlineHours: 72 });
  ok("settings: there is no deadline setting (72 h is ignored)", !("deadline_hours" in T.p2p_evaluation_settings[0]) && T.p2p_evaluation_settings[0].engine_enabled === false);
  ok("restriction needs a clear reason", (await call("PUT", `/e/admin/evaluators/${X}`, ADMIN, { standing: "restricted" })).status === 400
    && (await call("PUT", `/e/admin/evaluators/${X}`, ADMIN, { standing: "restricted", reason: "Repeated concerns, reviewed with them" })).status === 200 && T.p2p_evaluator_profiles.find((p) => p.user_id === X).standing === "restricted");
  T.p2p_eval_coverage = [{ resource_kind: "lesson", resource_id: LESSON, context: "kingdom_school", title: "Grace", waiting: 3, waiting_since: t0, has_qualified_people: false }];
  ok("coverage: admins only", (await call("GET", "/e/admin/coverage", E1)).status === 403);
  const cov = await call("GET", "/e/admin/coverage", ADMIN);
  ok("coverage: resources waiting with nobody qualified yet", cov.status === 200 && cov.body.items[0].title === "Grace" && cov.body.items[0].hasQualifiedPeople === false && cov.body.items[0].waiting === 3);
  ok("settings: bootstrap roles only from the list", (await call("PUT", "/e/admin/settings", ADMIN, { bootstrapRoles: ["student"] })).status === 400);
  await call("PUT", "/e/admin/settings", ADMIN, { bootstrapRoles: ["peer_guide"], groupAssignmentsEnabled: true });
  ok("settings: cold-start roles and group assignments are owner switches", JSON.stringify(T.p2p_evaluation_settings[0].bootstrap_roles) === '["peer_guide"]' && T.p2p_evaluation_settings[0].group_assignments_enabled === true);
  rpcResult = (fn) => (fn === "p2p_eval_candidates" ? [{ user_id: E2, score: 6, basis: "passed_this_resource", reasons: { language: "same_content_language", proximity: "same_country" } }] : { ok: true });
  const adm = await call("GET", `/e/admin/evaluations/${EV}`, ADMIN);
  ok("admin evaluation view: who the engine would invite next and why (reasons only, never a place)", adm.body.nextCandidates[0].name === "Eli Second" && adm.body.nextCandidates[0].reasons.proximity === "same_country" && !/GH|Ghana|Accra/.test(adm.text));
  rpcResult = { ok: true };

  // Lifecycle: an evaluation whose invitation expired and was handed on reads "Reassigned".
  const REV = randomUUID();
  T.p2p_lesson_evaluations.push({ id: REV, submission_id: SUB, lesson_id: LESSON, resource_kind: "lesson", resource_id: LESSON, submitter_id: L, evaluator_id: null, status: "pending", self_approved: false,
    engine_state: "invited", created_at: t0, assigned_at: t0, deadline_at: null, outcome: null });
  T.p2p_evaluation_assignments.push({ id: randomUUID(), evaluation_id: REV, evaluator_id: E1, attempt: 1, status: "expired", invited_at: t0, invite_expires_at: t0 });
  const mineR = await call("GET", "/e/mine", L);
  ok("lifecycle: an expired-and-handed-on evaluation reads 'Reassigned'", mineR.body.items.find((i) => i.id === REV)?.statusLabel === "Reassigned to another qualified evaluator" && mineR.body.items.find((i) => i.id === REV)?.stage === "reassigned");

  // Operations, integrity reviews and material revisions (administrators only).
  rpcResult = (fn) => (fn === "p2p_eval_operations" ? { qualifiedEvaluators: 4, pending: 3, unassigned: 1, workload: [{ activeEvaluations: 1, people: 2 }], reciprocalPairs: 1 } : fn === "p2p_assessment_record_revision" ? 2 : { ok: true });
  ok("operations: administrators only", (await call("GET", "/e/admin/operations", E1)).status === 403);
  const ops = await call("GET", "/e/admin/operations", ADMIN);
  ok("operations: qualified evaluators, pending, unassigned, workload, reciprocal pairs", ops.body.qualifiedEvaluators === 4 && ops.body.workload[0].people === 2);
  const PK = "0123456789abcdef0123456789abcdef";
  T.p2p_eval_reciprocal_pairs = [{ pair_key: PK, person_a: E1, person_b: E2, a_approved_b: 2, b_approved_a: 3, last_at: t0 }];
  const integ = await call("GET", "/e/admin/integrity", ADMIN);
  ok("integrity: reciprocal approval pairs listed for review, by name, awaiting a decision", integ.body.items[0].people.includes("Esi Evaluator") && integ.body.items[0].needsReview === true && integ.body.items[0].approvals.join() === "2,3");
  ok("integrity: a decision needs an explanation", (await call("POST", `/e/admin/integrity/${PK}/review`, ADMIN, { decision: "no_concern" })).status === 400);
  await call("POST", `/e/admin/integrity/${PK}/review`, ADMIN, { decision: "no_concern", note: "Same Family; reviewed both evaluations" });
  ok("integrity: the review is recorded (append-only table) with who decided", T.p2p_eval_integrity_reviews?.[0]?.actor_id === ADMIN && T.p2p_eval_integrity_reviews[0].decision === "no_concern");
  ok("revision: administrators only, with a description", (await call("POST", "/e/admin/resources/revision", E1, { kind: "lesson", resourceId: LESSON, reason: "New questions" })).status === 403
    && (await call("POST", "/e/admin/resources/revision", ADMIN, { kind: "lesson", resourceId: LESSON })).status === 400);
  const rv = await call("POST", "/e/admin/resources/revision", ADMIN, { kind: "lesson", resourceId: LESSON, reason: "Questions rewritten for the new edition" });
  ok("revision: recorded through the database; the new assessment version comes back", rv.body.version === 2 && rpcCalls.at(-1).fn === "p2p_assessment_record_revision" && rpcCalls.at(-1).args.p_actor === ADMIN);
  rpcResult = { ok: true };

  // Readiness: whether peer evaluation is running — separate from a person understanding it.
  const tick = () => new Promise((r) => setTimeout(r, 50));
  ok("status: signed out → 401", (await call("GET", "/e/status")).status === 401);
  T.p2p_evaluation_settings[0].engine_enabled = false;
  const stOff = await call("GET", "/e/status", L);
  ok("status: engine off → running the earlier way (coordinators), never 'unavailable'", stOff.status === 200 && stOff.body.state === "coordinators" && /coordinators/.test(stOff.body.message));
  ok("status: plain words only — no counts, people or internals", Object.keys(stOff.body).join() === "state,message" && !/Esi|Eli|sweep|\b\d+\b/.test(stOff.body.message));
  T.p2p_evaluation_settings[0].engine_enabled = true;
  T.p2p_notifications = [];
  const stLate = await call("GET", "/e/status", L);
  await tick();
  const alerts = () => T.p2p_notifications.filter((n) => n.notification_type === "evaluation_escalation" && n.data?.kind === "service_unavailable");
  ok("status: engine on but the sweep has stopped → unavailable (never falsely ready)", stLate.body.state === "unavailable" && /temporarily unavailable/.test(stLate.body.message));
  ok("status: unavailable alerts the administrators — only them", alerts().length === 1 && alerts()[0].user_id === ADMIN && alerts()[0].data.reason === "sweep_stopped");
  await call("GET", "/e/status", E1); await tick();
  ok("status: the alert isn't repeated on every request", alerts().length === 1);
  T.p2p_evaluation_events.push({ evaluation_id: null, event_type: "sweep", created_at: new Date().toISOString() });
  ok("status: engine on and the sweep recent → ready", (await call("GET", "/e/status", L)).body.state === "ready");
  const realFrom = globalThis.__ev.db.from;
  globalThis.__ev.db.from = (t) => t === "p2p_evaluation_settings" ? { select() { return this; }, maybeSingle() { return this; }, then(res) { res({ data: null, error: { message: "down" } }); } } : realFrom(t);
  const stErr = await call("GET", "/e/status", L);
  globalThis.__ev.db.from = realFrom;
  ok("status: a database error → unavailable (distinct from 'no invitations')", stErr.status === 200 && stErr.body.state === "unavailable");

  ok("readiness: administrators only", (await call("GET", "/e/admin/readiness", E1)).status === 403);
  // One invitation delivered (its notification names that assignment), one not.
  const DELIVERED = randomUUID(), MISSING = randomUUID();
  T.p2p_evaluation_assignments.push({ id: DELIVERED, evaluation_id: REV, evaluator_id: E1, attempt: 2, status: "invited", invited_at: t0 }, { id: MISSING, evaluation_id: REV, evaluator_id: E2, attempt: 2, status: "invited", invited_at: t0 });
  T.p2p_notifications.push({ id: randomUUID(), user_id: E1, notification_type: "evaluation_invitation", data: { evaluationId: REV, assignmentId: DELIVERED } },
    { id: randomUUID(), user_id: E2, notification_type: "evaluation_invitation", data: { evaluationId: REV, assignmentId: DELIVERED } });
  const invitedNow = T.p2p_evaluation_assignments.filter((a) => a.status === "invited");
  const expectUndelivered = invitedNow.filter((a) => !T.p2p_notifications.some((n) => n.notification_type === "evaluation_invitation" && n.user_id === a.evaluator_id && n.data?.assignmentId === a.id)).length;
  rpcResult = (fn, args) => fn === "p2p_eval_operations" ? { qualifiedEvaluators: 4, resourcesWithQualifiedPeople: 2, pending: 3, unassigned: 1, expired30d: 2, reassigned30d: 1 }
    : fn === "p2p_eval_can_evaluate" ? args.p_user !== L
    : fn === "p2p_eval_qualified_pool" ? [{ user_id: E2 }] : { ok: true };
  const rd = await call("GET", "/e/admin/readiness", ADMIN);
  ok("readiness: service health and counts (qualified, pending, expired, reassigned)", rd.status === 200 && rd.body.state === "ready" && rd.body.counts.qualifiedEvaluators === 4 && rd.body.counts.pending === 3 && rd.body.counts.expired30d === 2 && rd.body.counts.reassigned30d === 1);
  ok("readiness: matching failures and coverage gaps (waiting with nobody qualified)", rd.body.counts.matchingFailures === 3 && rd.body.coverageGaps[0].title === "Grace" && rd.body.coverageGaps[0].waiting === 3);
  ok("readiness: undelivered invitations = invited with no notification for that assignment", rd.body.counts.undeliveredInvitations === expectUndelivered && expectUndelivered >= 1 && expectUndelivered === invitedNow.length - 1);
  const chk = Object.fromEntries(rd.body.checks.map((k) => [k.key, k]));
  ok("readiness: live checks — the engine refuses self-evaluation; matching finds people for the exact resource", chk.no_self.ok === true && rpcCalls.some((r) => r.fn === "p2p_eval_can_evaluate" && r.args.p_user === L)
    && chk.matching.ok === true && rpcCalls.some((r) => r.fn === "p2p_eval_qualified_pool" && r.args.p_resource === LESSON) && chk.engine.ok === true && chk.sweep.ok === true && chk.service.ok === true);
  rpcResult = (fn) => fn === "p2p_eval_can_evaluate" ? true : fn === "p2p_eval_qualified_pool" ? [] : {};
  const rdBad = await call("GET", "/e/admin/readiness", ADMIN);
  const bad = Object.fromEntries(rdBad.body.checks.map((k) => [k.key, k]));
  ok("readiness: a broken rule is reported, never hidden", bad.no_self.ok === false && bad.matching.ok === false);
  ok("readiness: no private answers or journal text", !rd.text.includes("Unearned favour") && !rd.text.includes("PRIVATE") && !rd.text.includes("shopping"));
  rpcResult = { ok: true };
  const routeSrc = readFileSync(path.join(root, "src/routes/peerEvaluation.ts"), "utf8");
  ok("no volunteer / evaluator-application / sign-up route exists", !/router\.(post|put)\([^)]*(volunteer|apply|application|signup|sign-up|register)/i.test(routeSrc));
  ok("/status is declared before /:id (so 'status' is never read as an evaluation id)", routeSrc.indexOf('router.get("/status"') > 0 && routeSrc.indexOf('router.get("/status"') < routeSrc.indexOf('router.get("/:id"'));
  ok("no transfer / choose-replacement / extension route exists", !/router\.(post|put)\([^)]*(transfer|replacement|extension|choose)/i.test(routeSrc));
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`peerEvaluation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
