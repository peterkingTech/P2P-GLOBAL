// Learning inside a Family Gathering (Prompt 6) — app side.
//   lib/activeGathering.ts — real module code (publish / clear / newer wins).
//   Gathering screen, lesson panel, picker, My Bible, return bar, lesson
//   screens — source checks for call continuity, permissions and privacy.
// Server rules are tested on the real routes: scripts/studio-db-test/gathering-lesson.mjs.
// Run: node tests/gatheringLearning.test.mjs
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

// ── Active Gathering mirror (real code) ──────────────────────────────────
const js = ts.transpileModule(src("lib/activeGathering.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (n) => (n === "react" ? { useSyncExternalStore: () => null } : {}) });
const G = mod.exports;
const toggle = () => {};
G.setActiveGathering({ sessionId: "A", voiceConnected: true, micMuted: false, toggleMic: toggle });
ok("publishes the Gathering's own state + mic toggle", G.getActiveGathering()?.sessionId === "A" && G.getActiveGathering().toggleMic === toggle);
G.setActiveGathering({ sessionId: "B", voiceConnected: true, micMuted: true, toggleMic: toggle });
G.clearActiveGathering("A");
ok("an old Gathering closing never clears a newer one", G.getActiveGathering()?.sessionId === "B");
G.clearActiveGathering("B");
ok("clears when that Gathering closes", G.getActiveGathering() === null);
ok("the mirror never starts/joins/ends a call", !/agora|useVoiceSpace|leave\(|join\(/i.test(src("lib/activeGathering.ts").replace(/\/\/.*$/gm, "")));

// ── Call continuity ───────────────────────────────────────────────────────
const gs = src("app/family/worship/[sessionId].tsx");
ok("own lesson opens ON TOP of the Gathering (push, never replace)", /router\.push\(\{ pathname: "\/family\/studies\/lesson\/\[lessonId\]"/.test(gs) && /router\.push\(\{ pathname: "\/lesson\/\[id\]"/.test(gs)
  && !/router\.replace\(\{ pathname: "\/lesson/.test(gs));
ok("one voice connection: the screen still has exactly one useVoiceSpace", (gs.match(/useVoiceSpace\(/g) ?? []).length === 1);
for (const f of ["components/family/GatheringLessonPanel.tsx", "components/family/GatheringLessonPicker.tsx", "components/family/MyBibleSheet.tsx", "components/family/GatheringReturnBar.tsx"])
  ok(`${f}: no call engine / voice code`, !/useAgora|createAgoraRtcEngine|useVoiceSpace|leaveWorshipSession|joinWorshipSession/.test(src(f)));
ok("lesson sheet + My Bible are modals over the Gathering (no navigation)", /<Modal visible=\{lessonSheetOpen\}/.test(gs) && /<MyBibleSheet visible=\{bibleOpen\}/.test(gs));
ok("lesson sheet keeps the mic control", /onDone=\{\(\) => setLessonSheetOpen\(false\)\}\s*\n\s*mic=\{\{ connected: voiceSpace\.phase === "connected", muted: voiceSpace\.micMuted, onToggle: voiceSpace\.toggleMic \}\}/.test(gs));
ok("publishes itself while mounted; clears on leave and unmount", /setActiveGathering\(\{ sessionId: session\.id/.test(gs) && /clearActiveGathering\(params\.sessionId\);\r?\n\s*voiceSpace\.leave\(\)/.test(gs)
  && /return \(\) => \{ if \(id\) clearActiveGathering\(id\); \};/.test(gs));
const bar = src("components/family/GatheringReturnBar.tsx");
ok("Return goes BACK to the mounted Gathering (dismissTo), not a new one", /router\.dismissTo\(\{ pathname: "\/family\/worship\/\[sessionId\]"/.test(bar) && !/router\.(push|replace)/.test(bar));
ok("return bar: same mic toggle, labelled", /onPress=\{gathering\.toggleMic\}/.test(bar) && /Unmute microphone/.test(bar) && /Return to the Gathering/.test(bar));
const central = src("app/lesson/[id].tsx");
ok("central lesson: return bar on both views", (central.match(/<GatheringReturnBar \/>/g) ?? []).length === 2);
ok("central lesson: no 'Study Together' (a second call) while a Gathering runs", /\{lessonMeta && !activeGathering && \(/.test(central));
ok("family lesson: return bar", /<GatheringReturnBar \/>/.test(src("app/family/studies/lesson/[lessonId].tsx")));

// ── Choosing a lesson ────────────────────────────────────────────────────
const pick = src("components/family/GatheringLessonPicker.tsx");
ok("sources: journey, Core Foundation, P2P Plans, Family lessons", /"Our journey"/.test(pick) && /"Core Foundation"/.test(pick) && /"P2P Plans"/.test(pick) && /"Family lessons"/.test(pick));
ok("central library via the Learning endpoints (no direct table reads)", /getLibrary\(\)/.test(pick) && /getCurriculumOutline\(id\)/.test(pick) && /getLearningHome\("family", familyId\)/.test(pick) && !/supabase\.from/.test(pick));
ok("family lessons: only published studies and lessons offered", /\.filter\(\(x\) => x\.status === "published"\)/.test(pick) && /\(l\.status \?\? "published"\) === "published"/.test(pick));
ok("existing study-plan LessonPicker left as it was", /onSelect: \(lessonId: string, lessonTitle: string\) => void;/.test(src("components/family/LessonPicker.tsx")));
ok("Guide-only + broadcast so everyone follows", /async function selectLesson\(choice: LessonChoice\) \{\r?\n\s*if \(!session \|\| !isHost\) return;/.test(gs) && /setLessonRef\(updated\.lesson[^\n]*\n\s*broadcastState\(updated\);/.test(gs));
ok("family vs central reference sent to the server", /choice\.kind === "family" \? \{ familyLessonId: choice\.id \} : \{ lessonId: choice\.id \}/.test(gs));
ok("late joiner / reconnect: lesson title fetched when the session's lesson changes", /getWorshipSession\(params\.sessionId!\)\.then\(\(s\) => \{ if \(!cancelled\) setLessonRef\(s\.lesson \?\? null\); \}\)/.test(gs));

// ── Following along / privacy ────────────────────────────────────────────
const panel = src("components/family/GatheringLessonPanel.tsx");
ok("lesson content from the members-only endpoint", /getGatheringLesson\(sessionId\)/.test(panel));
ok("no one's answers shown; says so plainly", !/response|getReflection|submission/i.test(panel) && /stays in your own lesson unless you choose to share it/.test(panel));
ok("lesson video only for someone who may control media (existing sync path)", /onPlayMedia=\{canControl \? playLessonMedia : null\}/.test(gs) && /mediaProvider: "youtube", mediaId: youtubeId/.test(gs));
ok("resources row for everyone: lesson + My Bible", /accessibilityLabel="My Bible\. Read on your own; the group's passage doesn't change"/.test(gs) && /lessonRef \? setLessonSheetOpen\(true\) : setLessonPickerOpen\(true\)/.test(gs));
const bible = src("components/family/MyBibleSheet.tsx");
ok("My Bible: personal, never shares", /Only you see this\. The group's passage doesn't change\./.test(bible) && /onSelect=\{setPassage\}/.test(bible) && /selectLabel="Read"/.test(bible) && !/updateWorshipState/.test(bible));
ok("ScripturePanel still shares by default for the Guide", /selectLabel = "Share with Gathering"/.test(src("components/family/ScripturePanel.tsx")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
