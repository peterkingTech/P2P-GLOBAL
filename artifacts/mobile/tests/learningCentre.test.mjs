// Tests for the Learning Centre (Universal Learning System, step 1):
//  1. lib/learningCentreApi.ts — state words, due-date wording, action count.
//  2. Source checks — the screen and widget only read and link to existing
//     screens (no submit / review / progress writes), every row opens the
//     server-given route, entry points from Kingdom School and My P2P, and
//     the API route is mounted before the /learning group routes.
// The server side is proven on the real route in
// scripts/studio-db-test/learning-centre.mjs.
// Run: node tests/learningCentre.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");

function load(rel, mocks) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => (m === "@/lib/apiClient" ? load("lib/apiClient.ts", mocks) : mocks[m] ?? {}), console, Date, Number, fetch: (...x) => globalThis.fetch(...x) });
  return mod.exports;
}
let lastUrl = null, lastHeaders = null, reply = { ok: true, body: { toDo: [], awaitingReview: [], feedback: [], toReview: [] } };
const api = load("lib/learningCentreApi.ts", {
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
});
globalThis.fetch = async (url, init) => { lastUrl = url; lastHeaders = init?.headers; return { ok: reply.ok, json: async () => reply.body }; };

// 1. API + helpers
const o = await api.getLearningOverview();
ok("calls the overview route with the session token", lastUrl === "http://test/api/learning/centre/overview" && lastHeaders?.Authorization === "Bearer tok");
ok("returns the four lists", Array.isArray(o.toDo) && Array.isArray(o.toReview));
reply = { ok: false, body: { error: "Unauthorized" } };
ok("errors surface as a message", await api.getLearningOverview().then(() => false, (e) => e.message === "Unauthorized"));
for (const st of ["not_started", "returned", "revision_requested", "awaiting_review", "completed", "reviewed"]) ok(`state has words: ${st}`, typeof api.STATE_LABEL[st] === "string" && api.STATE_LABEL[st].length > 3);
ok("sources named as people know them", api.SOURCE_LABEL.core === "Kingdom School" && api.SOURCE_LABEL.story === "Kingdom Stories" && api.SOURCE_LABEL.family === "Family Circle" && api.SOURCE_LABEL.church === "Church");
ok("needs action: returned / revision requested only", api.needsAction("returned") && api.needsAction("revision_requested") && !api.needsAction("awaiting_review"));
const now = new Date(2026, 9, 28, 12, 0, 0);
ok("due: none", api.dueLabel(null, now) === null && api.dueLabel("nope", now) === null);
ok("due: later today", api.dueLabel(new Date(2026, 9, 28, 18).toISOString(), now) === "Due today");
ok("due: earlier today still 'today'", api.dueLabel(new Date(2026, 9, 28, 8).toISOString(), now) === "Due today");
ok("due: tomorrow", api.dueLabel(new Date(2026, 9, 29, 9).toISOString(), now) === "Due tomorrow");
ok("due: in 3 days", api.dueLabel(new Date(2026, 9, 31, 9).toISOString(), now) === "Due in 3 days");
ok("due: overdue", api.dueLabel(new Date(2026, 9, 25, 9).toISOString(), now).startsWith("Overdue"));
ok("due: far off shows the date", /^Due \S/.test(api.dueLabel(new Date(2026, 11, 20).toISOString(), now)) && !/in \d+ days/.test(api.dueLabel(new Date(2026, 11, 20).toISOString(), now)));
ok("action count = to do + people waiting for my review", api.actionCount({ toDo: [{}, {}], toReview: [{ waiting: 3 }, {}], awaitingReview: [{}], feedback: [] }) === 6 && api.actionCount(null) === 0);

// 2. Source checks
const screen = src("app/learning/index.tsx");
ok("screen exists at /learning", existsSync(path.join(root, "app/learning/index.tsx")));
ok("screen: rows open the server-given route", screen.includes("pathname: x.route.pathname, params: x.route.params"));
ok("screen: read-only (no submit, review, progress or Supabase writes)", !/submitContent|\/review|\.insert\(|\.update\(|\.upsert\(|method: "POST"|markLessonComplete/.test(screen));
ok("screen: words for every state, loading / error / empty states", screen.includes("STATE_LABEL[x.state]") && screen.includes("ActivityIndicator") && screen.includes("Try again") && screen.includes("Nothing waiting for you"));
ok("screen: feedback shown only in the feedback section", screen.includes('section === "feedback" && x.feedback'));
ok("screen: uses the product word Comprehensive Checks", screen.includes("COMPREHENSIVE_CHECKS"));
const learn = src("app/(tabs)/learn.tsx");
// The Learning tab (Learning Centre landing) and the Kingdom School screen both open My Learning.
const school = src("app/kingdom-school.tsx");
ok("Kingdom School links to the Learning Centre (existing cards kept)", learn.includes('router.push("/learning" as any)') && school.includes('router.push("/learning" as any)') && school.includes("<KingdomSchoolCards"));
const widgets = src("components/myp2p/MyP2PWidgets.tsx");
ok("My P2P: Comprehensive Checks widget wired", widgets.includes("function LearningWidget") && widgets.includes('case "learning": return <LearningWidget'));
ok("My P2P widget: read-only", !/LearningWidget[\s\S]*?(submit|\.insert\(|\.update\()[\s\S]*?export function MyP2PWidget/.test(widgets));
const myp2p = load("lib/myP2P.ts", { "@react-native-async-storage/async-storage": { default: {} } });
ok("widget registered + in the default layout; older saved layouts gain it", myp2p.DEFAULT_LAYOUT.order.includes("learning")
  && myp2p.normalizeLayout({ order: ["journey", "journal"] }).order.includes("learning"));
const apiIndex = readFileSync(path.join(root, "../api-server/src/routes/index.ts"), "utf8");
ok("API: /learning/centre mounted before the /learning group routes", apiIndex.indexOf('"/learning/centre"') > -1 && apiIndex.indexOf('"/learning/centre"') < apiIndex.indexOf('router.use("/learning", '));
const lib = readFileSync(path.join(root, "../api-server/src/lib/learningCentre.ts"), "utf8");
ok("API: read-only (no writes in the read model)", !/\.(insert|update|upsert|delete)\(/.test(lib));
ok("API: never selects answer text", !/text_content|content[,"]/.test(lib.replace(/\/\/.*$/gm, "")));

console.log(`learningCentre: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
