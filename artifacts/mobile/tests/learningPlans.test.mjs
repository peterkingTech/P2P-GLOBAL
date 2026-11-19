// Learning Plans (owner brief 2026-11-19), the app side: plan reminders (real module, with a fake notification
// scheduler and storage), the builder's confirm-only saving, Study Deeper visibility, electives, My Plans.
// Run: node tests/learningPlans.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
function load(file, mocks = {}) {
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, console, Map, Set, JSON, Number, String, Math, Array, Object, Date, Error, RegExp,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}

// ── Reminders (§7): the real module, with a fake scheduler ──
const store = new Map();
let scheduled = [];
const N = {
  SchedulableTriggerInputTypes: { DATE: "date", WEEKLY: "weekly" },
  getAllScheduledNotificationsAsync: async () => scheduled.map((x) => ({ identifier: x.identifier })),
  cancelScheduledNotificationAsync: async (id) => { scheduled = scheduled.filter((x) => x.identifier !== id); },
  getPermissionsAsync: async () => ({ status: "granted" }),
  requestPermissionsAsync: async () => ({ status: "granted" }),
  scheduleNotificationAsync: async (x) => { scheduled.push(x); },
};
const R = load("lib/planReminders.ts", {
  "react-native": { Platform: { OS: "ios" } }, "expo-notifications": N,
  "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } } },
  "@/lib/offline": { getOfflineUser: () => "user-1" },
});
const PLAN = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const tomorrow = (() => { const d = new Date(Date.now() + 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
const rep = { id: "r1", planId: PLAN, planTitle: "Who is the Holy Spirit?", kind: "repeat", time: "07:30", days: [1, 3, 5], date: null, paused: false };
const once = { id: "r2", planId: PLAN, planTitle: "Who is the Holy Spirit?", kind: "once", time: "20:00", days: [], date: tomorrow, paused: false };
await R.savePlanReminders([rep, once]);
ok("create: a repeating reminder on chosen days + a one-off date/time", scheduled.length === 4 && scheduled.filter((x) => x.trigger.type === "weekly").length === 3 && scheduled.some((x) => x.trigger.type === "date"));
ok("each notification names the plan and opens THAT plan", scheduled.every((x) => x.content.body.includes("Who is the Holy Spirit?") && x.content.data.route === `/study-plan/${PLAN}` && x.content.data.notificationType === "plan_reminder"));
await R.savePlanReminders([rep, once]);
ok("no duplicates: saving again replaces, never adds", scheduled.length === 4 && new Set(scheduled.map((x) => x.identifier)).size === 4);
await R.savePlanReminders([{ ...rep, time: "08:15", days: [0] }, once]);
ok("edit: the new schedule replaces the old one", scheduled.length === 2 && scheduled.some((x) => x.trigger.hour === 8 && x.trigger.minute === 15 && x.trigger.weekday === 1));
await R.savePlanReminders([{ ...rep, paused: true }, once]);
ok("pause: nothing delivered for a paused reminder", scheduled.length === 1);
await R.savePlanReminders([rep, once]);
ok("resume: delivered again", scheduled.length === 4);
await R.savePlanReminders([rep]);
ok("delete: no further delivery", scheduled.length === 3 && !scheduled.some((x) => x.trigger.type === "date"));
ok("a past one-off reminder is never scheduled", R.plannedPlanTriggers([{ ...once, date: "2020-01-01" }]).length === 0);
ok("local time zone: weekly triggers are wall-clock hour/minute; one-off is a local date-time", R.plannedPlanTriggers([rep])[0].hour === 7 && R.plannedPlanTriggers([once])[0].at.getHours() === 20);
await R.savePlanReminders([rep, { ...rep, id: "r3", planId: OTHER, planTitle: "Salvation" }]);
await R.reconcilePlanReminders(new Map([[PLAN, "paused"]]));
const after = await R.loadPlanReminders();
ok("completed / left / deleted plan: its reminders stop (removed)", !after.some((r) => r.planId === OTHER));
ok("paused plan: reminders held, not delivered", after.every((r) => r.planPaused) && scheduled.length === 0);
await R.reconcilePlanReminders(new Map([[PLAN, "active"]]));
ok("resumed plan: reminders delivered again", scheduled.length === 3);
ok("never automatic: reminders exist only when the participant adds them", src("components/plans/PlanReminders.tsx").includes("startNew") && !/savePlanReminders\(\[/.test(src("app/study-plan/[id].tsx")));
ok("notification routing only to a plan screen", /notificationType === "plan_reminder"/.test(src("lib/push.ts")) && src("lib/push.ts").includes("study-plan\\/[0-9a-f]{8}"));
ok("normalise: bad stored data is dropped, never guessed", R.normalizePlanReminders([{ id: "x", planId: "nope" }, { id: "y", planId: PLAN, kind: "once" }]).length === 0);

// ── Builder (§1, §4): natural focus, starting point never restricts, nothing saved before confirmation ──
const builder = src("app/plans/builder.tsx");
ok("focus: the subject or question in the participant's own words", builder.includes('plansOrganiser.focusLabel", { defaultValue: "What would you like to learn?" }'));
ok("starting points: any subject / a Bible book / Core Foundations / Kingdom School (no Bible Topic)", builder.includes('(["any", "bible_book", "core_foundations", "kingdom_school"] as const)') && src("components/plans/SubjectPicker.tsx").includes('x !== "bible_topic"'));
ok("discovery runs the organiser; review is the journey with stages", builder.includes("organise({ q: question, start: startPoint, deeperOf })") && builder.includes("<JourneyReview data={organised} proposal={proposal} onChange={setProposal} />"));
const createCalls = builder.match(/createPlan\(/g) ?? [];
ok("a proposed plan is only saved by the participant's explicit actions (create / save draft)", createCalls.length === 2 && builder.includes("async function finish(") && builder.includes("async function saveDraft("));
ok("the organiser itself saves nothing", !/createPlan|updatePlan|startPlan/.test(src("components/plans/JourneyReview.tsx") + src("lib/planOrganiserApi.ts")));
const review = src("components/plans/JourneyReview.tsx");
ok("review: preview, reorder, replace, remove, add more, find something else, why + source", ["Preview", "move(i, -1)", "move(i, 1)", "setReplacing", "remove(i)", "Discover more", "searchMore", "{p.why}", "Source"].every((x) => review.includes(x)));
ok("Study Deeper is NOT in search or the proposed journey", !/Study Deeper|deeperOf/.test(review) && !/Study Deeper/.test(src("app/study/index.tsx")) && !/Study Deeper/.test(src("app/plans/index.tsx")));
const detail = src("app/study-plan/[id].tsx");
ok("Study Deeper only on a COMPLETED plan, opening a new journey for review", detail.includes('{me && me.run.status === "completed" ? (') && detail.includes('pathname: "/plans/builder", params: { deeperOf: p.id'));
ok("deeper journeys stay linked to the earlier one (continuity)", detail.includes("Earlier journey on this subject"));
ok("reminders on every active/paused plan, none on a completed plan", detail.includes('{me.run.status !== "completed" ? <PlanReminders planId={p.id} planTitle={p.title} /> : null}'));
const home = src("app/plans/index.tsx");
ok("My Plans: progress bar, completed state, reminders kept in step with plans", home.includes("barFill") && home.includes("reconcilePlanReminders(status)") && home.includes('p2pPlans.status.completed'));
ok("search → prepare a learning plan for any subject", home.includes('pathname: "/plans/builder", params: { q: studyQ.trim() }'));

console.log(`learningPlans (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
