// Reflections + assignments on custom lessons — app side.
//   lib/lessonWorkApi.ts — real module code (states, sharing wording, paths).
//   components/study/LessonWork.tsx, app/learning/assignment/[assignmentId].tsx,
//   lesson screens, notification routing — source checks.
// Server rules are tested on the real routes: scripts/studio-db-test/lesson-work.mjs.
// Run: node tests/lessonWork.test.mjs
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

const calls = [];
const js = ts.transpileModule(src("lib/lessonWorkApi.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, JSON, Object, Error, Promise,
  fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({}) }; },
  require: (n) => n === "@/contexts/AuthContext" ? { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "TOKEN" } } }) } } } : n === "@/lib/apiUrl" ? { getApiUrl: () => "https://api.test/api" } : {} });
const W = mod.exports;

// ── States + wording ────────────────────────────────────────────────────
const a = (s) => ({ mySubmission: s ? { status: s } : null });
ok("states: Not started / In progress / Submitted / Reviewed / Returned", W.assignmentState(a(null), false) === "Not started" && W.assignmentState(a(null), true) === "In progress"
  && W.assignmentState(a("submitted"), false) === "Submitted" && W.assignmentState(a("reviewed"), false) === "Reviewed" && W.assignmentState(a("returned"), false) === "Returned"
  && W.assignmentState(a("returned"), true) === "In progress");
ok("sharing choices say plainly who can read it; private first", W.VISIBILITY_OPTIONS.map((o) => o.value).join() === "private,leaders,group"
  && /Nobody else can see it/.test(W.VISIBILITY_OPTIONS[0].detail) && /leaders can read it/.test(W.VISIBILITY_OPTIONS[1].detail) && /All current members/.test(W.VISIBILITY_OPTIONS[2].detail));
await W.submitReflection("family", "L1", "Q1", "text", "private");
await W.reviewSubmission("church", "S1", "returned", "fix");
ok("API: signed-in token, scoped paths", calls[0].url === "https://api.test/api/learning/work/family/lessons/L1/reflections" && calls[0].init.headers.Authorization === "Bearer TOKEN"
  && JSON.parse(calls[0].init.body).visibility === "private" && calls[1].url === "https://api.test/api/learning/work/church/submissions/S1/review");

// ── Lesson work block ───────────────────────────────────────────────────
const lw = src("components/study/LessonWork.tsx");
ok("reflections: only reflection questions; private by default", /q\.kind === "reflection" && q\.id/.test(lw) && /useState<ReflectionVisibility>\(latest\?\.visibility \?\? "private"\)/.test(lw));
ok("reflections: 'Who can see this?' radio group with the wording", /Who can see this\?/.test(lw) && /accessibilityRole="radiogroup"/.test(lw) && /accessibilityRole="radio"/.test(lw) && /VISIBILITY_OPTIONS\.map/.test(lw));
ok("reflections: device draft per user/lesson/question, cleared after saving", /draftKey\(profile\.id, `custom:\$\{scope\}:\$\{lessonId\}:reflection:\$\{questionId\}`\)/.test(lw) && /await draft\.clear\(\); setEditing\(false\);/.test(lw));
ok("reflections: changing sharing later goes to the server (and rolls back on failure)", /await setReflectionVisibility\(latest\.id, v\)/.test(lw) && /setVisibility\(latest\.visibility\); notify\("Couldn't change who can see it"/.test(lw));
ok("shared section: only what others chose to share; explains the scope", /Reflections members chose to share/.test(lw) && /getSharedReflections\(scope, lessonId\)/.test(lw));
ok("assignments: state from server + local draft; leaders see draft/archived + submitted counts", /assignmentState\(a, hasDraft\)/.test(lw) && /Draft — members can't see it/.test(lw) && /submitted`/.test(lw));
ok("new Comprehensive Check: title required, due date checked, resubmission toggle, draft or publish", /Give the Comprehensive Check a title\./.test(lw) && /YYYY-MM-DD/.test(lw) && /Allow resubmitting/.test(lw) && /save\("draft"\)/.test(lw) && /save\("published"\)/.test(lw));
ok("no uploads (written answers only)", !/ImagePicker|DocumentPicker|upload/i.test(lw) && !/ImagePicker|DocumentPicker|upload/i.test(src("app/learning/assignment/[assignmentId].tsx")));
ok("sub-components at module level (typing keeps focus)", /^function ReflectionCard\(/m.test(lw) && /^function AssignmentRow\(/m.test(lw) && /^function NewAssignmentModal\(/m.test(lw));

// ── Assignment screen ─────────────────────────────────────────────────
const as = src("app/learning/assignment/[assignmentId].tsx");
ok("submit only when open: first time, after return, or if resubmission allowed", /const canSubmit = !!assignment && assignment\.status === "published" && \(!latest \|\| latest\.status === "returned" \|\| assignment\.allowResubmission\);/.test(as));
ok("all attempts shown with feedback (history kept)", /attempts\.map\(\(a\) =>/.test(as) && /Feedback: \{a\.feedback\}/.test(as));
ok("answer is a device draft until submitted", /draftKey\(profile\.id, `custom:\$\{scope\}:assignment:\$\{assignmentId\}`\)/.test(as) && /await submitAssignment\(scope, assignmentId, draft\.text\); await draft\.clear\(\);/.test(as));
ok("review section only when the server lets you review", /try \{ setReview\(\(await getSubmissionsForReview\(scope, assignmentId\)\)\.submissions\); \} catch \{ setReview\(null\); \}/.test(as) && /\{review !== null && \(/.test(as));
ok("returning work needs feedback", /if \(status === "returned" && !fb\)/.test(as));

// ── Wiring ────────────────────────────────────────────────────────────────
for (const [f, scope] of [["app/family/studies/lesson/[lessonId].tsx", "family"], ["app/church/studies/lesson/[lessonId].tsx", "church"]])
  ok(`${f}: reflections/assignments under the lesson`, new RegExp(`footer=\\{<LessonWork scope="${scope}" lessonId=\\{lesson\\.id\\} questions=\\{lesson\\.questions\\} />\\}`).test(src(f)));
const push = src("lib/push.ts");
ok("notification tap → the assignment (validated id + scope)", /notificationType === "assignment_reviewed" && assignmentId && workScope\) return `\/learning\/assignment\/\$\{assignmentId\}\?s=\$\{workScope\}`/.test(push) && /\/\^\[0-9a-f-\]\{36\}\$\/i\.test\(data\.assignmentId\)/.test(push));
ok("Notification Center uses the same destination", /n\.notificationType === "assignment_reviewed"\) \{/.test(src("app/notifications/index.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
