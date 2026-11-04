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
      const q = { op: "select", f: [], payload: null, single: false, lim: null, orders: [] };
      const rows = () => (T[table] ??= []);
      const match = (r) => q.f.every(([op, k, v]) => op === "eq" ? r[k] === v : op === "in" ? v.includes(r[k]) : true);
      const exec = () => {
        let data;
        if (q.op === "insert") { const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...p })); rows().push(...list); data = list; }
        else if (q.op === "update") { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, q.payload)); data = hit; }
        else { data = rows().filter(match); for (const [k, asc] of [...q.orders].reverse()) data = [...data].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); if (q.lim) data = data.slice(0, q.lim); }
        data = data.map((r) => ({ ...r }));
        return { data: q.single ? data[0] ?? null : data, error: null };
      };
      const c = {
        select() { return c; }, insert(p) { q.op = "insert"; q.payload = p; return c; }, update(p) { q.op = "update"; q.payload = p; return c; },
        eq(k, v) { q.f.push(["eq", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
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
T.p2p_lesson_evaluations = [{ id: EV, submission_id: SUB, lesson_id: LESSON, submitter_id: L, evaluator_id: null, status: "pending", feedback: null, assigned_at: t0, created_at: t0, resolved_at: null, self_approved: false,
  engine_state: "invited", current_assignment_id: A1, accepted_at: null, deadline_at: null, outcome: null, feedback_detail: null, queued_since: t0 }];
T.p2p_evaluation_assignments = [{ id: A1, evaluation_id: EV, evaluator_id: E1, attempt: 1, status: "invited", invited_at: t0, invite_expires_at: new Date(Date.now() + 3600_000).toISOString(), accepted_at: null, deadline_at: null, ended_at: null, end_reason: null, draft: null }];
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
  ok("evaluatee list: stage 'invitation pending', NO evaluator named while only invited; server time included", mine.body.items[0].stage === "invitation_pending" && mine.body.items[0].evaluator === null && !mine.text.includes("Esi") && !!mine.body.serverNow);
  const detail = await call("GET", `/e/${EV}`, L);
  ok("evaluatee detail: no invited identity, friendly history, no feedback yet", detail.body.role === "evaluatee" && detail.body.evaluator === null && !detail.text.includes("Esi") && detail.body.feedback === null && detail.body.history.length === 2);
  const inv = await call("GET", `/e/invitations/${A1}`, E1);
  ok("invitation: lesson, kind, expected work, 48-hour policy — no evaluatee name or answers", inv.status === 200 && inv.body.lessonTitle === "Grace" && inv.body.questionCount === 2 && /48 hours/.test(inv.body.deadlinePolicy)
    && !inv.text.includes("Lena") && !inv.text.includes("Unearned") && !inv.text.includes("PRIVATE"));
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
  const self = await call("PUT", "/e/me/evaluator", X, { available: false, capacity: 3, standing: "good" });
  ok("availability is self-service; standing (restriction) is not", self.status === 200 && T.p2p_evaluator_profiles.find((p) => p.user_id === X).available === false && T.p2p_evaluator_profiles.find((p) => p.user_id === X).standing === undefined);
  const prof = await call("GET", "/e/me/evaluator", X);
  ok("my evaluator profile: oriented, commitments, 48 hours, private record", prof.body.oriented === true && prof.body.deadlineHours === 48 && prof.body.commitments.length === 6 && prof.body.record.completed === 0);

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
  const routeSrc = readFileSync(path.join(root, "src/routes/peerEvaluation.ts"), "utf8");
  ok("no transfer / choose-replacement / extension route exists", !/router\.(post|put)\([^)]*(transfer|replacement|extension|choose)/i.test(routeSrc));
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`peerEvaluation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
