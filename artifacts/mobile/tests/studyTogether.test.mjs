// Tests for Study Together shared studies on the app side (migration 216):
//  1. lib/studyTogetherApi.ts — content routes (each reader's own progress),
//     invitation expiry wording, responses grouped under their question.
//  2. lib/push.ts — shared_study_* notifications open that study (ids validated).
//  3. Source checks — Study Alone / Study Together on stories, the at-your-own-
//     pace link on lessons (the live call card is untouched), the sheet only
//     shows the server's eligible people / led groups, the study screen never
//     marks progress and keeps the composer outside a nested component.
// Run: node tests/studyTogether.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
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

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const anyModule = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? true : k === "default" ? anyModule : host(String(k))) });
const mocks = {
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
  "react-native": { Platform: { OS: "ios" }, StyleSheet: { create: (s) => s } },
};
function load(rel) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => mocks[m] ?? anyModule, console, URLSearchParams, setTimeout, clearTimeout });
  return mod.exports;
}

// 1. API helpers
const api = load("lib/studyTogetherApi.ts");
const SID = "0f8b2c4e-1a2b-4c3d-8e9f-0123456789ab", CH = "1f8b2c4e-1a2b-4c3d-8e9f-0123456789ab";
ok("route: story chapter", JSON.stringify(api.contentRoute({ contentType: "kingdom_story", contentId: SID }, CH)) === JSON.stringify({ pathname: "/kingdom-stories/chapter", params: { id: SID, chapter: CH } }));
ok("route: story without shared chapter", api.contentRoute({ contentType: "kingdom_story", contentId: SID }).pathname === "/kingdom-stories/[id]");
ok("route: lesson", api.contentRoute({ contentType: "lesson", contentId: SID }, CH).pathname === "/lesson/[id]");
const now = Date.parse("2026-10-27T12:00:00Z");
ok("invite: expires in days", api.invitationNote({ expiresAt: "2026-11-05T12:00:00Z" }, now) === "Expires in 9 days.");
ok("invite: tomorrow", api.invitationNote({ expiresAt: "2026-10-28T10:00:00Z" }, now) === "Expires tomorrow.");
ok("invite: expired", api.invitationNote({ expiresAt: "2026-10-26T12:00:00Z" }, now) === "This invitation has expired.");
ok("invite: none", api.invitationNote({ expiresAt: null }, now) === null);
const R = [
  { id: "a", promptId: "p1", sectionId: null, questionIndex: null },
  { id: "b", promptId: null, sectionId: CH, questionIndex: 0 },
  { id: "c", promptId: null, sectionId: CH, questionIndex: 1 },
  { id: "d", promptId: null, sectionId: null, questionIndex: null },
];
ok("responses: by prompt", api.responsesFor(R, { promptId: "p1" }).map((r) => r.id).join() === "a");
ok("responses: by chapter question", api.responsesFor(R, { sectionId: CH, questionIndex: 1 }).map((r) => r.id).join() === "c");
ok("responses: general discussion", api.responsesFor(R, {}).map((r) => r.id).join() === "d");
ok("labels: one peer destination (friends are peers)", api.DESTINATION_LABELS.peer === "A Peer" && !("friends" in api.DESTINATION_LABELS));

// 2. notification routing
const push = load("lib/push.ts");
for (const t of ["shared_study_invite", "shared_study_accepted", "shared_study_declined", "shared_study_started"]) {
  ok(`push: ${t} opens the study`, push.pathForNotification(t, { studyId: SID }) === `/study-together/${SID}`);
}
ok("push: bad id falls back", push.pathForNotification("shared_study_invite", { studyId: "../admin" }) === "/notifications");
ok("push: live study types unchanged", push.pathForNotification("study_invitation_received", { callId: "x" }) === "/notifications");
ok("in-app list routes shared_study_*", src("app/notifications/index.tsx").includes('startsWith("shared_study_")'));

// 3. source checks
const story = src("app/kingdom-stories/[id].tsx");
ok("story: Study Alone + Study Together", story.includes("Study Alone") && story.includes("Study Together") && story.includes("<SharedStudySheet"));
ok("story: not offered on admin preview", /!preview \? \(\s*<TouchableOpacity style=\{\[s\.primaryBtn, s\.studyModeBtn, s\.togetherBtn\]\}/.test(story));
const lesson = src("app/lesson/[id].tsx");
ok("lesson: live Study Together card kept", lesson.includes("setStudyPickerOpen(true)") && lesson.includes("<StudyPartnerPicker"));
ok("lesson: shared study link", lesson.includes("setSharedStudyOpen(true)") && lesson.includes('type: "lesson"'));
const sheet = src("components/study/SharedStudySheet.tsx");
ok("sheet: lists the server's people and led groups", sheet.includes("getStudyDestinations") && !sheet.includes("useData"));
ok("sheet: explains privacy", /own progress and private reflections/.test(sheet));
const screen = src("app/study-together/[id].tsx");
ok("screen: no nested component for the composer", !/<Thread\s+(key|k)=/.test(screen) && screen.includes("function thread("));
ok("screen: never writes progress", !/markChapter|completeLesson|lesson_progress|submit/i.test(screen));
ok("screen: invitee accept/decline", screen.includes('respondToStudy(st.id, "accepted")') && screen.includes('respondToStudy(st.id, "declined")'));
ok("screen: leader-only controls gated", screen.includes("st.me.isLeader && active ?"));
ok("screen: chat shortcut uses the existing direct conversation", screen.includes("p2p_start_direct_conversation"));
ok("my discipleship links Study Together", src("app/my-discipleship/index.tsx").includes('"/study-together"'));

console.log(`studyTogether: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
