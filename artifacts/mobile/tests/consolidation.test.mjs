// App-wide consolidation (pre-launch duplication removal, 2026-10-30):
//  1. the shared helpers behave exactly like the copies they replaced
//     (lib/alerts, lib/timeFormat) — run for real;
//  2. an audit that the copies don't come back.
// Run: node tests/consolidation.test.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const read = (p) => readFileSync(path.join(root, p), "utf8");

// ── Loader with a switchable react-native mock ──────────────────────────────
const calls = [];
const RN = { Platform: { OS: "ios" }, Alert: { alert: (...a) => calls.push(["Alert.alert", ...a]) } };
const win = { alert: (m) => calls.push(["window.alert", m]), confirm: (m) => { calls.push(["window.confirm", m]); return win.answer; }, answer: true };
const net = { token: "TOK", fetch: null, FormData: class FormData {} };
const MOCKS = {
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: net.token ? { access_token: net.token } : null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "https://api.test/api" },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, String, Number, Array, Object, Date, Error, window: win,
    fetch: (...a) => net.fetch(...a), FormData: net.FormData,
    require: (n) => (n === "react-native" ? RN : n in MOCKS ? MOCKS[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));

// ── 1a. lib/alerts ──────────────────────────────────────────────────────────
const A = load("lib/alerts.ts");
calls.length = 0; RN.Platform.OS = "ios";
A.showAlert("Saved", "All done.");
ok("showAlert native: Alert.alert(title, message)", calls[0][0] === "Alert.alert" && calls[0][1] === "Saved" && calls[0][2] === "All done." && calls[0][3] === undefined);
calls.length = 0; let dismissed = 0;
A.showAlert("Call ended", "Bye", () => dismissed++);
ok("showAlert native with onDismiss: an OK button that runs it", calls[0][3]?.[0]?.text === "OK" && (calls[0][3][0].onPress(), dismissed === 1));
calls.length = 0; RN.Platform.OS = "web"; dismissed = 0;
A.showAlert("Saved", "All done.", () => dismissed++);
ok("showAlert web: browser alert with title + message, then onDismiss", calls[0][0] === "window.alert" && calls[0][1] === "Saved\n\nAll done." && dismissed === 1);
calls.length = 0; A.showAlert("Just a title");
ok("showAlert web without a message: just the title", calls[0][1] === "Just a title");

calls.length = 0; RN.Platform.OS = "ios"; let confirmed = 0;
A.confirmAction("Delete?", "Gone for good.", () => confirmed++, { confirmLabel: "Delete", destructive: true });
const btns = calls[0][3];
ok("confirmAction native: Cancel (cancel style) + labelled destructive button", btns[0].text === "Cancel" && btns[0].style === "cancel" && !btns[0].onPress && btns[1].text === "Delete" && btns[1].style === "destructive");
btns[1].onPress();
ok("confirmAction native: confirm runs the action", confirmed === 1);
calls.length = 0;
A.confirmAction("Leave?", "", () => {}, { cancelLabel: "Stay" });
ok("confirmAction: custom cancel label, default 'Confirm' + default style", calls[0][3][0].text === "Stay" && calls[0][3][1].text === "Confirm" && calls[0][3][1].style === "default");
calls.length = 0; RN.Platform.OS = "web"; confirmed = 0; win.answer = false;
A.confirmAction("Delete?", "Gone.", () => confirmed++);
ok("confirmAction web: Cancel does nothing", calls[0][0] === "window.confirm" && confirmed === 0);
win.answer = true; A.confirmAction("Delete?", "Gone.", () => confirmed++);
ok("confirmAction web: OK runs the action", confirmed === 1);

// ── 1b. lib/timeFormat ──────────────────────────────────────────────────────
const T = load("lib/timeFormat.ts");
const now = Date.UTC(2026, 9, 30, 12, 0, 0);
const at = (ms) => new Date(now - ms).toISOString();
const MIN = 60e3, HR = 3600e3, DAY = 86400e3;
ok("ago: just now / 5m ago / 3h ago / 2d ago", [T.timeAgo(at(20e3), "ago", { now }), T.timeAgo(at(5 * MIN), "ago", { now }), T.timeAgo(at(3 * HR), "ago", { now }), T.timeAgo(at(2 * DAY + HR), "ago", { now })].join("|") === "just now|5m ago|3h ago|2d ago");
ok("compact: now / 59m / 23h / 40d", [T.timeAgo(at(10e3), "compact", { now }), T.timeAgo(at(59 * MIN), "compact", { now }), T.timeAgo(at(23 * HR + 59 * MIN), "compact", { now }), T.timeAgo(at(40 * DAY), "compact", { now })].join("|") === "now|59m|23h|40d");
ok("days: today / 1 day ago / 4 days ago", [T.timeAgo(at(5 * HR), "days", { now }), T.timeAgo(at(DAY + HR), "days", { now }), T.timeAgo(at(4 * DAY), "days", { now })].join("|") === "today|1 day ago|4 days ago");
ok("long: singular/plural months and years", [T.timeAgo(at(1 * DAY), "long", { now }), T.timeAgo(at(31 * DAY), "long", { now }), T.timeAgo(at(70 * DAY), "long", { now }), T.timeAgo(at(400 * DAY), "long", { now }), T.timeAgo(at(800 * DAY), "long", { now })].join("|") === "1 day ago|1 month ago|2 months ago|1 year ago|2 years ago");
ok("missing / invalid time → the given empty text, never 'NaN'", T.timeAgo(null) === "" && T.timeAgo("not a date") === "" && T.timeAgo(null, "days", { empty: "never active" }) === "never active");
ok("future time never shows a negative age", T.timeAgo(new Date(now + 5 * MIN).toISOString(), "ago", { now }) === "just now");
ok("notification time: rounded, then a date after a week", T.relativeTime(at(30e3), now) === "now" && T.relativeTime(at(90 * MIN), now) === "2h" && /\d/.test(T.relativeTime(at(10 * DAY), now)) && !/d$/.test(T.relativeTime(at(10 * DAY), now)));
ok("notificationModel re-exports the shared relativeTime", load("lib/notificationModel.ts").relativeTime === T.relativeTime);
ok("clock m:ss (voice) and padded mm:ss / hh:mm:ss (calls, players)", T.formatClock(65) === "1:05" && T.formatClock(65, { padded: true }) === "01:05" && T.formatClock(3725, { padded: true }) === "01:02:05" && T.formatClock(NaN) === "0:00" && T.formatClock(-4, { padded: true }) === "00:00");
ok("voicePlayback re-exports the shared clock", load("lib/voicePlayback.ts").formatClock === T.formatClock);
ok("durations: minSec / hourMin / hourMinRounded / words", T.formatDuration(252, "minSec") === "4m 12s" && T.formatDuration(45, "minSec") === "45s" && T.formatDuration(4800, "hourMin") === "1h 20m" && T.formatDuration(2129, "hourMin") === "35m" && T.formatDuration(2130, "hourMinRounded") === "36m" && T.formatDuration(2100, "words") === "35 min" && T.formatDuration(7200, "words") === "2h" && T.formatDuration(4800, "words") === "1h 20m");
ok("secondsBetween: missing end = now, never negative, bad start = 0", T.secondsBetween(at(90e3), null, now) === 90 && T.secondsBetween(new Date(now).toISOString(), at(60e3)) === 0 && T.secondsBetween("x") === 0);
ok("prayer duration keeps its wording", load("lib/prayerTimeDisplay.ts").formatDuration("2026-10-30T10:00:00Z", "2026-10-30T10:35:00Z") === "35 min");

// ── 1c. lib/apiClient ───────────────────────────────────────────────────────
const C = load("lib/apiClient.ts");
let seen = null, reply = { ok: true, status: 200, body: { hello: 1 } };
net.fetch = async (url, init) => { seen = { url, init }; if (reply.throws) throw reply.throws; return { ok: reply.ok, status: reply.status, json: async () => reply.body }; };
const r1 = await C.apiRequest("/things", { method: "POST", body: "{}" }, { base: "/feature" });
ok("apiRequest: base + path, JSON header, Bearer token, parsed body", seen.url === "https://api.test/api/feature/things" && seen.init.headers["Content-Type"] === "application/json" && seen.init.headers.Authorization === "Bearer TOK" && r1.hello === 1 && seen.init.method === "POST");
await C.apiRequest("/upload", { method: "POST", body: new net.FormData() });
ok("apiRequest: FormData keeps fetch's own multipart header", !("Content-Type" in seen.init.headers) && seen.init.headers.Authorization === "Bearer TOK");
await C.apiRequest("/x", { headers: { "Content-Type": "text/plain", "X-Extra": "1" } });
ok("apiRequest: caller headers win and are kept", seen.init.headers["Content-Type"] === "text/plain" && seen.init.headers["X-Extra"] === "1");
net.token = null; await C.apiRequest("/x");
ok("apiRequest signed out: no Authorization header (server answers 401)", !("Authorization" in seen.init.headers));
net.token = "TOK";
reply = { ok: false, status: 403, body: { error: "Not a member", code: "not_member" } };
let err = await C.apiRequest("/x").catch((e) => e);
ok("failed response: server's message + status", err instanceof Error && err.message === "Not a member" && err.status === 403);
err = await C.apiRequest("/x", {}, { makeError: (m, s, b) => Object.assign(new Error(m), { status: s, code: b.code }) }).catch((e) => e);
ok("failed response: feature error builder gets the body fields", err.code === "not_member" && err.status === 403);
reply = { ok: false, status: 500, body: {} };
err = await C.apiRequest("/x", {}, { fallbackError: "Couldn't load." }).catch((e) => e);
ok("failed response without server text: the feature's fallback message", err.message === "Couldn't load." && err.status === 500);
reply = { throws: Object.assign(new Error("net down"), { name: "TypeError" }) };
err = await C.apiRequest("/x").catch((e) => e);
ok("network failure without offlineError: fetch's own error passes through", err.message === "net down");
err = await C.apiRequest("/x", {}, { offlineError: "You're offline." }).catch((e) => e);
ok("network failure with offlineError: that message, status 0", err.message === "You're offline." && err.status === 0);
reply = { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) };
err = await C.apiRequest("/x", {}, { offlineError: "You're offline." }).catch((e) => e);
ok("cancelled request (AbortError) is never turned into 'offline'", err.name === "AbortError");
reply = { ok: true, status: 200, body: {} };
await C.apiFetch("/raw", { method: "DELETE" });
ok("apiFetch: raw request with the token, no forced JSON header", seen.url === "https://api.test/api/raw" && seen.init.headers.Authorization === "Bearer TOK" && !("Content-Type" in seen.init.headers));

// ── 2. Audit: the copies stay gone ──────────────────────────────────────────
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(p)) files.push(p); } };
["app", "components", "lib", "hooks", "contexts"].forEach((d) => walk(path.join(root, d)));
const rel = (f) => path.relative(root, f).split(path.sep).join("/");
const offenders = (re, allow = []) => files.filter((f) => !allow.includes(rel(f)) && re.test(readFileSync(f, "utf8"))).map(rel);
const show = (xs) => xs.slice(0, 8).join(", ") + (xs.length > 8 ? ` …(+${xs.length - 8})` : "");
let x;
x = offenders(/function (showAlert|notify|showInfo|showError|showAdminError|alertLocked)\s*\(\s*title/, ["lib/alerts.ts"]);
ok("no local alert helpers (use lib/alerts)", x.length === 0, show(x));
x = offenders(/window\.(alert|confirm)\(/, ["lib/alerts.ts"]);
ok("no direct browser alert/confirm outside lib/alerts", x.length === 0, show(x));
x = offenders(/function (timeAgo|formatDuration|formatClock|formatTime)\s*\(\s*(iso|totalSeconds|seconds|ms|startedAt)\b/, ["lib/timeFormat.ts"]);
ok("no local time-ago / duration / clock helpers (use lib/timeFormat)", x.length === 0, show(x));
x = offenders(/const ago = \(/);
ok("no inline 'ago' helpers", x.length === 0, show(x));
x = offenders(/Authorization: `Bearer/, ["lib/apiClient.ts"]);
ok("no hand-built Authorization headers (use lib/apiClient)", x.length === 0, show(x));
ok("the old admin fetch helper is gone", !existsSync(path.join(root, "lib/adminFetch.ts")));

// ── 3. Navigation: one destination per feature, old routes redirect ────────
const redirects = {
  "app/curriculum.tsx": "/kingdom-school",
  "app/messages/index.tsx": "/(tabs)/messages",
  "app/hall-of-faith.tsx": "/graduates",
  "app/session/[id].tsx": "/my-discipleship",
  "app/settings/app-style.tsx": "/settings/appearance",
  "app/settings/style-details.tsx": "/settings/appearance",
};
for (const [file, to] of Object.entries(redirects)) {
  const s = read(file);
  ok(`old route ${file} redirects to ${to} (no dead end, no second copy)`, s.includes("<Redirect") && s.includes(`"${to}"`) && s.split("\n").length < 20);
}
const famCalls = read("app/family/calls.tsx");
ok("old family calls route → that family's Members (same call flow)", famCalls.includes("<Redirect") && famCalls.includes('pathname: "/family/members", params: { familyId: fid }'));
x = offenders(/router\.(push|replace)\(\s*["'`]\/curriculum["'`?]/);
ok("nothing links to the old Foundations list", x.length === 0, show(x));
ok("church + family studies open Kingdom School (one shared studies screen)", read("components/community/CommunityStudiesScreen.tsx").includes('router.push("/kingdom-school"')
  && read("app/church/studies/index.tsx").includes('<CommunityStudiesScreen scope="church" />') && read("app/family/studies/index.tsx").includes('<CommunityStudiesScreen scope="family" />'));
// Family Circle and Church study screens: one implementation each, scope explicit.
for (const [route, comp] of [["studies/index", "CommunityStudiesScreen"], ["studies/[studyId]", "CommunityStudyScreen"], ["studies/lesson/[lessonId]", "CommunityLessonScreen"], ["study-plans/[planId]", "CommunityStudyPlanScreen"]]) {
  for (const scope of ["family", "church"]) {
    const s = read(`app/${scope}/${route}.tsx`);
    ok(`${scope}/${route} is the shared ${comp} (${scope} scope)`, s.includes(`<${comp} scope="${scope}" />`) && s.split("\n").length < 12);
  }
}
const sApi = read("lib/communityStudyApi.ts");
ok("study APIs: one implementation, family → /family, church → /churches", /family: "\/family", church: "\/churches"/.test(sApi) && /communityStudyApi<ChurchStudy>\("church"\)/.test(read("lib/churchStudyApi.ts")) && /communityStudyApi<FamilyStudy>\("family"\)/.test(read("lib/familyStudyApi.ts")));
ok("only a family chooses a Gathering study source", /scope === "family" && canManage && \(/.test(read("components/community/CommunityStudiesScreen.tsx")) && /scope === "family" && manageable && plan\.status === "published"/.test(read("components/community/CommunityStudyPlanScreen.tsx")));
ok("prayer completion: 'Study Together' opens Study Together", /label: "Study Together", route: "\/study-together"/.test(read("app/prayer/complete/[id].tsx")));
ok("buttons say where they go (Pray the Word, Kingdom School)", read("app/prayer/study/[scriptureId].tsx").includes('label="Explore Pray the Word" onPress={() => router.push("/prayer/pray-the-word"') && read("app/missions/learn.tsx").includes('label="Explore Kingdom School" onPress={() => router.push("/kingdom-school"'));
ok("search: Learning Plans open the plan, Foundations open the journey", read("../api-server/src/routes/search.ts").includes('route: c.type === "plan" ? `/plan/${c.id}` : `/curriculum/${c.id}`'));
ok("Bible / Notes / Highlights: one home (Bible Study), not repeated on Learning or Kingdom School", !/"\/notes"|"\/highlights"|"\/bible"/.test(read("app/(tabs)/learn.tsx")) && !/"\/notes"|"\/highlights"|"\/bible"/.test(read("app/kingdom-school.tsx")) && /route: "\/notes"/.test(read("app/bible-study/index.tsx")));
const appearance = read("app/settings/appearance.tsx");
ok("Appearance is one screen: mode, App Style (preview) and decoration level", appearance.includes("<SegmentedControl options={MODES} value={mode} onChange={setMode}") && appearance.includes("<StylePreviewModal") && appearance.includes("setIllustrationLevel(lvl.id)") && !appearance.includes('"/settings/app-style"'));

// ── 4. Later stages ──────────────────────────────────────────────────────────
ok("dates: long / medium / dateTime styles; missing → the empty text", /2026/.test(T.formatDate("2026-10-30T12:00:00Z", "long")) && /2026/.test(T.formatDate("2026-10-30T12:00:00Z", "medium")) && T.formatDate(null, "dateTime", { empty: "—" }) === "—" && T.formatDate("bad") === "");
ok("dates: todayTime shows a time today and a date otherwise", T.formatDate(new Date(now - 60e3).toISOString(), "todayTime", { now }).includes(":") && !T.formatDate(new Date(now - 3 * DAY).toISOString(), "todayTime", { now }).includes(":"));
x = offenders(/^function formatDate\(/m, ["lib/timeFormat.ts"]);
ok("no local formatDate copies", x.length === 0, show(x));

const LH = load("lib/learningHome.ts");
const mods = [{ id: "a", isLocked: false, lessonCount: 0, completedLessons: 0 }, { id: "b", isLocked: true, lessonCount: 5, completedLessons: 0 }, { id: "c", isLocked: false, lessonCount: 4, completedLessons: 4 }, { id: "d", isLocked: false, lessonCount: 6, completedLessons: 2 }];
ok("Continue: one rule — first unlocked, non-empty, unfinished module", LH.currentModule(mods)?.id === "d" && LH.currentModule([]) === null && LH.currentModule(undefined) === null);
ok("Continue: a story is in progress once started and until every chapter is done", LH.isStoryInProgress({ myProgress: { totalChapters: 6, doneChapters: 2, started: true } }) && !LH.isStoryInProgress({ myProgress: { totalChapters: 6, doneChapters: 6, started: true } }) && !LH.isStoryInProgress({ myProgress: null }));
x = offenders(/\.find\(\(\w\) => !\w\.isLocked && \w\.completedLessons < \w\.lessonCount\)/, []);
ok("no screen keeps its own 'current module' rule", x.length === 0, show(x));

for (const f of ["app/kingdom-school.tsx", "app/kingdom-stories/index.tsx", "app/community.tsx"]) ok(`Study Together reachable from ${f}`, read(f).includes("<StudyTogetherLink"));
ok("Study Together reachable from Bible Study, Family and Church hubs", read("app/bible-study/index.tsx").includes('route: "/study-together"') && read("app/family/[familyId].tsx").includes('router.push("/study-together"') && read("app/church/index.tsx").includes('router.push("/study-together"'));
ok("Home: one My Community entry that opens the overview", read("app/(tabs)/index.tsx").includes('title="My Community"') && read("app/(tabs)/index.tsx").includes('go("/community")'));
const conn = read("app/connect/index.tsx");
ok("old /connect hub redirects to Discover; Discover has every people path", conn.includes("<Redirect") && conn.includes('"/(tabs)/discover"') && ["/connect/discover", "/connect/groups", "/connect/smart-match", "/connect/by-username?type=peer_guide", "/connect/invite", "/connect/by-username", "/connections"].every((r) => read("app/(tabs)/discover.tsx").includes(`route: "${r}"`)));
for (const f of ["app/call/audio.tsx", "app/call/video.tsx"]) ok(`${f}: shared "No answer" view, own handlers`, read(f).includes("<CallNoAnswerView") && !/UNANSWERED_LABEL: Record/.test(read(f)) && read(f).includes("onCallAgain={handleCallAgain}"));
ok("one video player (feature players removed)", ["KingdomStoryVideoPlayer", "KingdomWinVideoPlayer", "MissionVideoPlayer", "TestimonyVideoPlayer"].every((n) => !existsSync(path.join(root, `components/${n}.tsx`))) && offenders(/<VideoPlayer /).length === 4);
const ctxSrc = read("contexts/DataContext.tsx");
ok("DataContext: data shapes moved out, still re-exported", ctxSrc.includes('export * from "./data/learningModel";') && ctxSrc.includes('export * from "./data/types";') && !/^export interface Module \{/m.test(ctxSrc) && /^export interface Module \{/m.test(read("contexts/data/learningModel.ts")));

console.log(`consolidation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
