// Peer Evaluation Engine (migration 229) on the app side:
//   • the server clock: countdowns follow the SERVER's time on a monotonic
//     clock — changing the phone's clock or time zone doesn't move them;
//     offline it falls back to the last known offset;
//   • days / hours / minutes / seconds and overdue;
//   • notification taps open the right evaluation screen (ids checked);
//   • the client calls the right routes and never sends a replacement,
//     a deadline or an extension;
//   • screens: no transfer / choose-replacement / extension anywhere; identity
//     and privacy wording; the Learning tab entry.
// Run: node tests/peerEvaluation.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const store = new Map();
const load = (rel, mocks, extra = {}) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => { if (m in mocks) return mocks[m]; throw new Error(`unexpected require ${m} in ${rel}`); }, JSON, Date, Math, Number, String, Object, Array, Promise, ...extra });
  return mod.exports;
};
const asyncStorage = { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } } };

// ── Server clock ──────────────────────────────────────────────────────────
const C = load("lib/serverClock.ts", { "@react-native-async-storage/async-storage": asyncStorage }, { globalThis: { performance: { now: () => 0 } } });
const server = Date.parse("2026-11-03T12:00:00Z");
C.syncServerTime(new Date(server).toISOString(), 1000, Date.parse("2026-11-03T09:00:00Z")); // phone 3 h behind
ok("clock: right after a response, server time is the server's", C.serverNowMs(1000, Date.parse("2026-11-03T09:00:00Z")) === server);
ok("clock: counts forward on the monotonic clock", C.serverNowMs(61_000, 0) === server + 60_000);
ok("clock: changing the phone's clock (or time zone) changes nothing", C.serverNowMs(61_000, Date.parse("2030-01-01T00:00:00Z")) === server + 60_000);
ok("clock: the offset is remembered for offline use / restarts", store.get("p2p.serverClock.offsetMs") === String(3 * 3600_000));
C._resetServerClock();
ok("clock: before any response, the phone clock is used (with the remembered offset when known)", C.serverNowMs(0, 5000) === 5000);
const sd = C.splitDuration(2 * 86400_000 + 3 * 3600_000 + 4 * 60_000 + 5000);
ok("countdown: days / hours / minutes / seconds", sd.days === 2 && sd.hours === 3 && sd.minutes === 4 && sd.seconds === 5 && !sd.overdue);
const od = C.splitDuration(-(90 * 60_000));
ok("countdown: after the deadline it shows time overdue", od.overdue && od.hours === 1 && od.minutes === 30);
ok("countdown: exactly 48 h shows 2 days 0:00:00", JSON.stringify(C.splitDuration(48 * 3600_000)) === JSON.stringify({ overdue: false, days: 2, hours: 0, minutes: 0, seconds: 0 }));
const countdown = src("components/evaluation/Countdown.tsx");
ok("countdown component uses the server clock, never the phone's alone", countdown.includes("Date.parse(deadlineAt) - serverNowMs()") && !/new Date\(\)\.getTime\(\)|Date\.now\(\)/.test(countdown));

// ── Notification taps ─────────────────────────────────────────────────────
const push = src("lib/push.ts");
const block = push.slice(push.indexOf("// Peer Evaluation Engine (migration 229)"), push.indexOf("// Daily prayer / journal reminder"));
const route = new Function("notificationType", "data", `${block}; return null;`);
const E = "0e7b6c1a-1234-4abc-9def-0123456789ab";
ok("push: invitation → the invitation screen", route("evaluation_invitation", { assignmentId: E }) === `/evaluation/invitation/${E}`);
ok("push: reassigned / accepted / feedback ready → the evaluation", ["evaluation_reassigned", "evaluation_accepted", "evaluation_feedback_ready", "evaluation_arranging"].every((t) => route(t, { evaluationId: E }) === `/evaluation/${E}`));
ok("push: reminders → the workspace; coordinators → oversight", route("evaluation_reminder", { evaluationId: E }) === `/evaluation/review/${E}` && route("evaluation_escalation", {}) === "/evaluation/admin");
ok("push: a bad id never builds a path", route("evaluation_reassigned", { evaluationId: "../admin" }) === "/evaluation" && route("evaluation_invitation", { assignmentId: "x/y" }) === "/evaluation");
ok("push: the older types keep their old routes", route("evaluation_waiting", {}) === null && route("evaluation_resolved", {}) === null);

// ── Client ────────────────────────────────────────────────────────────────
const sent = [];
const A = load("lib/peerEvaluationApi.ts", {
  "@/lib/apiClient": { apiRequest: async (p, init = {}) => { sent.push({ path: p, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined }); return { serverNow: "2026-11-03T12:00:00Z" }; } },
  "@/lib/serverClock": { syncServerTime: (iso) => sent.push({ synced: iso }) },
});
await A.acceptInvitation("a1");
ok("client: accept sends nothing but the request (no time, no deadline) and syncs the server clock", sent[0].path === "/evaluation/invitations/a1/accept" && sent[0].body === undefined && sent[1].synced === "2026-11-03T12:00:00Z");
await A.reportUnable("a1", "family", "note");
ok("client: report inability → category + note only", sent.at(-2).path === "/evaluation/assignments/a1/unable" && JSON.stringify(Object.keys(sent.at(-2).body).sort()) === JSON.stringify(["category", "note"]));
await A.adminReassign("e1", "Needs a new evaluator");
ok("client: admin reassign → a reason only (the system picks who is next)", JSON.stringify(Object.keys(sent.at(-2).body)) === JSON.stringify(["reason"]));
await A.submitEvaluation("e1", "passed", { encouragement: "x" });
ok("client: submit → outcome + feedback", sent.at(-2).path === "/evaluation/e1/submit" && sent.at(-2).body.outcome === "passed");

// ── Screens ───────────────────────────────────────────────────────────────
const screens = ["app/evaluation/index.tsx", "app/evaluation/[id].tsx", "app/evaluation/invitation/[assignmentId].tsx", "app/evaluation/review/[id].tsx", "app/evaluation/orientation.tsx", "app/evaluation/admin.tsx", "lib/peerEvaluationApi.ts"];
ok("all evaluation screens exist", screens.every((f) => existsSync(path.join(root, f))));
const all = screens.map(src).join("\n");
// Only ever mentioned as what ISN'T possible — never offered as an action or a route.
const actions = (all.match(/label=\{?["'`][^"'`]*["'`]/g) ?? []).join("\n") + "\n" + (all.match(/call<[^>]*>\(`[^`]*`/g) ?? []).join("\n");
ok("no transfer, choose-replacement or extension action anywhere in the UI or client", !/transfer|replacement|extension|extend/i.test(actions), actions.match(/.*(transfer|replacement|extension|extend).*/i)?.[0]);
ok("the UI states plainly there are no extensions and no transfers", /no extensions/i.test(all) && /can't choose or transfer/i.test(src("constants/evaluationGuidance.ts")));
ok("no 72-hour deadline anywhere", !/72[- ]?h/i.test(all));
const review = src("app/evaluation/review/[id].tsx");
ok("workspace: Report inability to complete (category required), confirmed submit, autosaved draft", review.includes("Report inability to complete") && review.includes("disabled={!unable.category}") && review.includes("Submit feedback") && review.includes("saveDraft("));
ok("workspace: fairness guidance and the responsibility reminder with Scripture", review.includes("FAIRNESS_GUIDE") && review.includes("RESPONSIBILITY_REMINDER") && review.includes("SERVICE_SCRIPTURES[2]"));
const detail = src("app/evaluation/[id].tsx");
ok("evaluatee: reassignment message reassures that the submission is safe; never asks to resubmit for an evaluator's failure", detail.includes("Your original submission and progress are safe") && !/resubmit because|submit again because/i.test(detail));
const guide = src("constants/evaluationGuidance.ts");
ok("orientation: the five Scriptures and the orientation message", ["1 Peter 4:10", "Galatians 6:2", "Colossians 3:23–24", "Matthew 20:26–28", "2 Timothy 2:2"].every((r) => guide.includes(r)) && guide.includes("You are not merely reviewing an assignment."));
const noComments = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
ok("orientation: no guilt or pressure language", !/you must|shame|guilt|you are failing|disappoint/i.test(noComments(guide + src("app/evaluation/orientation.tsx"))));
ok("Learning tab: My Evaluations tile (no new main tab)", src("app/(tabs)/learn.tsx").includes("<LearningHub") && src("components/LearningHub.tsx").includes('route: "/evaluation"') && !existsSync(path.join(root, "app/(tabs)/evaluation.tsx")));
for (const f of screens.filter((x) => x.startsWith("app/"))) {
  const s = src(f);
  ok(`${f}: theme colours only`, !(s.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).some((h) => !["#fff", "#FFF", "#C0392B"].includes(h)));
  ok(`${f}: accessibility labels`, (s.match(/accessibilityLabel=/g) ?? []).length >= 1 || (s.match(/accessibilityRole=/g) ?? []).length >= 2);
}

// No duplicates: each review and each result lives in exactly one place.
const dc = src("contexts/DataContext.tsx");
ok("direct review list excludes engine evaluations (no review in two places)", dc.includes(`.eq("evaluator_id", uid).eq("status", "pending").is("engine_state", null)`));
const old = src("app/evaluations.tsx");
ok("Review submissions screen: directly assigned reviews only — no learner tabs, no Circle reviews",
  !old.includes("getMySubmissions") && !old.includes("CircleEvaluationCard") && !old.includes("/circles/") && !old.includes("Recently Approved") && old.includes("My Evaluations"));
const home = src("app/(tabs)/index.tsx");
ok("Home: the waiting badge opens My Evaluations; the general entry lives in Learning", !home.includes(`go("/evaluations")`) && !home.includes(`router.push("/evaluations")`)
  && src("components/LearningHub.tsx").includes('route: "/evaluation"') && home.includes(`pathname: "/evaluation", params: { tab: "serving" }`));
const mine = src("app/evaluation/index.tsx");
ok("My Evaluations: opens on Evaluating from Home; directly assigned reviews counted and linked", mine.includes(`params.tab === "serving"`) && mine.includes("pendingEvaluations.length") && mine.includes(`router.push("/evaluations" as any)`));
const m231 = readFileSync(path.join(root, "../../migrations/231_combine_evaluation_waiting_notices.sql"), "utf8");
ok("231: waiting notices combine per evaluator within 10 minutes; engine rows untouched", m231.includes("interval '10 minutes'") && m231.includes("if new.engine_state is not null then") && m231.includes("lesson evaluations waiting") && !/\bdelete\b|\bdrop\b|\btruncate\b/i.test(m231.replace(/--.*$/gm, "")));

// ── 240: one universal engine, exact-resource qualification, no sign-up ──
const m240 = readFileSync(path.join(root, "../../migrations/240_universal_peer_evaluation.sql"), "utf8");
const m240code = m240.replace(/--.*$/gm, "");
ok("240: qualification is the exact resource passed independently (ledger), never lesson_progress, roles or categories",
  m240code.includes("g.unit_key = 'lesson:' || p_resource") && !/lesson_progress/.test(m240code.slice(m240code.indexOf("p2p_eval_can_evaluate"), m240code.indexOf("p2p_eval_tz_offset_hours"))) && !/categories|reviewer_roles|orientation_acknowledged_at is null/.test(m240code.slice(m240code.indexOf("create or replace function public.p2p_eval_can_evaluate"), m240code.indexOf("-- ── Matching"))));
ok("240: matching weighs language, stage, proximity, workload and variety — and records reasons without locations",
  ["lang_pts", "stage_pts", "near_pts", "2 * r.active", "r.invited_week", "r.missed", "r.last_invited is null", "recently_paired", "r.reciprocal", "p2p_eval_distance_km"].every((k) => m240code.includes(k)) && m240code.includes("'proximity', case when"));
ok("240: accepted work is checked for safety only; open invitations for full eligibility", m240code.includes("a.status = 'accepted' and not p2p_eval_can_continue"));
ok("240: cold-start roles default OFF and step aside once anyone qualifies; group assignments default OFF",
  m240code.includes("bootstrap_roles           text[]  not null default '{}'") && m240code.includes("group_assignments_enabled boolean not null default false") && m240code.includes("p2p_eval_resource_has_qualified(p_eval)"));
ok("240: the migration sends no notifications and deletes nothing", !/insert into (public\.)?p2p_notifications|delete from|drop table|truncate/i.test(m240code.slice(m240code.indexOf("update public.p2p_lesson_evaluations set next_attempt_at = now() where engine_state = 'queued'"))) && !/drop table|truncate/i.test(m240code));
const serveHome = src("app/evaluation/index.tsx");
ok("app: no orientation gate — the Serve panel explains how invitations work", !serveHome.includes("Start orientation") && serveHome.includes("How you're invited to evaluate") && serveHome.includes("No sign-up is needed"));
ok("app: the invitation shows the commitments agreed by accepting", src("app/evaluation/invitation/[assignmentId].tsx").includes("By accepting, you agree:"));
const oversight = src("app/evaluation/admin.tsx");
ok("app oversight: who can evaluate what (coverage), next in line, and the two owner switches", ["adminCoverage()", "Who can evaluate what", "nextCandidates", "groupAssignmentsEnabled", "bootstrapRoles"].every((k) => oversight.includes(k)));

console.log(`peerEvaluation (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
