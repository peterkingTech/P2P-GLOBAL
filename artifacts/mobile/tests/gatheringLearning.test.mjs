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
ok("Return goes BACK to the mounted Gathering (dismissTo), not a new one", /router\.dismissTo\(gathering!\.returnTo as any\)/.test(bar) && !/router\.(push|replace)/.test(bar)
  && /returnTo: \{ pathname: "\/family\/worship\/\[sessionId\]", params: \{ sessionId: session\.id \} \}/.test(gs));
ok("return bar: same mic toggle, labelled", /onPress=\{gathering\.toggleMic\}/.test(bar) && /Unmute microphone/.test(bar) && /Return to the Gathering/.test(bar));
const central = src("app/lesson/[id].tsx");
ok("central lesson: return bar on both views", (central.match(/<GatheringReturnBar \/>/g) ?? []).length === 2);
ok("central lesson: no 'Study Together' (a second call) while a Gathering runs", /\{lessonMeta && !activeGathering && \(/.test(central));
ok("family lesson: return bar", /<GatheringReturnBar \/>/.test(src("app/family/studies/lesson/[lessonId].tsx")));

// ── Choosing a lesson ────────────────────────────────────────────────────
const pick = src("components/family/GatheringLessonPicker.tsx");
ok("sources: journey, Core Foundation, P2P Plans, Family lessons", /"Our journey"/.test(pick) && /"Core Foundation"/.test(pick) && /"P2P Plans"/.test(pick) && /"Family lessons"/.test(pick));
ok("central library via the Learning endpoints (no direct table reads)", /getLibrary\(\)/.test(pick) && /getCurriculumOutline\(id\)/.test(pick) && /getLearningHome\(scope, groupId\)/.test(pick) && !/supabase\.from/.test(pick));
ok("family lessons: only published studies and lessons offered", /\.filter\(\(x\) => x\.status === "published"\)/.test(pick) && /\(l\.status \?\? "published"\) === "published"/.test(pick));
ok("existing study-plan LessonPicker left as it was", /onSelect: \(lessonId: string, lessonTitle: string\) => void;/.test(src("components/family/LessonPicker.tsx")));
ok("Guide-only + broadcast so everyone follows", /async function selectLesson\(choice: LessonChoice\) \{\r?\n\s*if \(!session \|\| !isHost\) return;/.test(gs) && /setLessonRef\(updated\.lesson[^\n]*\n\s*broadcastState\(updated\);/.test(gs));
ok("family vs central reference sent to the server", /choice\.kind === "family" \? \{ familyLessonId: choice\.id \} : \{ lessonId: choice\.id \}/.test(gs));
ok("late joiner / reconnect: lesson title fetched when the session's lesson changes", /getWorshipSession\(params\.sessionId!\)\.then\(\(s\) => \{ if \(!cancelled\) setLessonRef\(s\.lesson \?\? null\); \}\)/.test(gs));

// ── Following along / privacy ────────────────────────────────────────────
const panel = src("components/family/GatheringLessonPanel.tsx");
ok("lesson content from the members-only endpoint (Family or Church)", /\(gathering\.kind === "church" \? getChurchCallLesson\(gathering\.id\) : getGatheringLesson\(gathering\.id\)\)/.test(panel));
ok("no one's answers shown; says so plainly", !/response|getReflection|submission/i.test(panel) && /stays in your own lesson unless you choose to share it/.test(panel));
ok("lesson video only for someone who may control media (existing sync path)", /onPlayMedia=\{canControl \? playLessonMedia : null\}/.test(gs) && /mediaProvider: "youtube", mediaId: youtubeId/.test(gs));
ok("resources row for everyone: lesson + My Bible", /accessibilityLabel="My Bible\. Read on your own; the group's passage doesn't change"/.test(gs) && /lessonRef \? setLessonSheetOpen\(true\) : setLessonPickerOpen\(true\)/.test(gs));
const bible = src("components/family/MyBibleSheet.tsx");
ok("My Bible: personal, never shares", /Only you see this\. The group's passage doesn't change\./.test(bible) && /onSelect=\{read\}/.test(bible) && /function read\(p: WorshipScripture\) \{\n    setPassage\(p\);/.test(bible) && /selectLabel="Read"/.test(bible) && !/updateWorshipState/.test(bible));
ok("ScripturePanel still shares by default for the Guide", /selectLabel = "Share with Gathering"/.test(src("components/family/ScripturePanel.tsx")));

// ── Church Gathering (Prompt 7): the same pieces, no copies ─────────────
const cc = src("app/call/church.tsx");
ok("church call reuses the shared lesson picker/panel, My Bible, ScripturePanel, FocusBar", /from "@\/components\/family\/GatheringLessonPicker"/.test(cc) && /from "@\/components\/family\/GatheringLessonPanel"/.test(cc)
  && /from "@\/components\/family\/MyBibleSheet"/.test(cc) && /from "@\/components\/family\/ScripturePanel"/.test(cc) && /from "@\/components\/focus\/FocusBar"/.test(cc));
ok("church call: still one call engine (one useAgoraEngine, no voice-space)", (cc.match(/useAgoraEngine\(/g) ?? []).length === 1 && !/useVoiceSpace/.test(cc));
ok("church picker scoped to this church; church lessons via their own call", /<GatheringLessonPicker visible=\{lessonPickerOpen\}.*scope="church" groupId=\{detail\.call\.churchId\}/.test(cc)
  && /if \(choice\.kind === "church"\) await setChurchCallChurchLesson\(params\.callId, choice\.id\);/.test(cc));
ok("church lesson panel reads the church endpoint", /gathering=\{\{ kind: "church", id: detail\.call\.id \}\}/.test(cc));
ok("no more pasting lesson IDs or typing Scripture fields", !/Lesson ID|lessonIdInput|scriptureBook|placeholder="Book"/.test(cc) && /<ScripturePanel currentScripture=\{sharedPassage\} isGuide onSelect=\{shareScripture\} \/>/.test(cc));
ok("everyone: Lesson, shared Passage (read-only) and My Bible", /accessibilityLabel="Read the shared passage"/.test(cc) && /<ScripturePanel currentScripture=\{sharedPassage\} isGuide=\{false\}/.test(cc)
  && /accessibilityLabel="My Bible\. Read on your own; the group's passage doesn't change"/.test(cc));
ok("host changes reach everyone live (context_changed → reload), older apps ignore it", /\| "context_changed" \| "call_ended";/.test(cc) && /case "context_changed":\r?\n\s*load\(\);/.test(cc)
  && (cc.match(/sendSignal\("context_changed"\)/g) ?? []).length === 4); // passage, lesson, video, play/pause
ok("own lesson opens on top; Return comes back to this call (same params)", /router\.push\(\{ pathname: "\/church\/studies\/lesson\/\[lessonId\]"/.test(cc)
  && /returnTo: \{ pathname: "\/call\/church", params: \{ callId: params\.callId, channelName: params\.channelName/.test(cc));
ok("mirror cleared on leave and unmount; sheets keep the call's own mic", /if \(params\.callId\) clearActiveGathering\(params\.callId\);/.test(cc) && /return \(\) => \{ if \(id\) clearActiveGathering\(id\); \};/.test(cc)
  && /const mic = \{ connected: !!token, muted: muted \|\| micDisabledByHost, onToggle: toggleMute \};/.test(cc));
ok("hooks run before the loading guard (no conditional hooks)", cc.indexOf("const toggleMuteRef = useRef(toggleMute);") < cc.indexOf("if (loading || !detail) {"));
ok("church lesson screen: return bar", /<GatheringReturnBar \/>/.test(src("app/church/studies/lesson/[lessonId].tsx")));
const ch = src("app/church/index.tsx");
ok("church home: Learning entry for leaders and members (same unified Learning home as Family)",
  (ch.match(/pathname: "\/learning\/\[scope\]\/\[groupId\]", params: \{ scope: "church", groupId: userChurch\.id \}/g) ?? []).length === 2);
// Synced Media in the Church Gathering = the Family Gathering's player + clock.
ok("church media uses the Family SharedMedia player (no second sync engine)", /import SharedMedia from "@\/components\/family\/SharedMedia";/.test(cc)
  && (cc.match(/<SharedMedia\b/g) ?? []).length === 2 && !/createAudioPlayer|useVideoPlayer|YouTubePlayer/.test(cc));
const cApi = src("lib/churchCallApi.ts");
ok("adapter feeds only the media + clock fields the player reads", /export function churchCallMediaSession\(call: ChurchCall\): WorshipSession/.test(cApi)
  && /isPlaying: !!call\.isPlaying, playbackBasePositionMs: call\.playbackBasePositionMs \?\? 0/.test(cApi));
ok("only the host gets play/pause/link controls; position from the shared clock", /canControl=\{isHost\}/.test(cc)
  && /computeWorshipPositionMs\(churchCallMediaSession\(detail\.call\)\)/.test(cc) && /setChurchCallPlayback\(params\.callId, \{ isPlaying: !detail\.call\.isPlaying, positionMs \}\)/.test(cc));
ok("expanded media replaces the inline player (never two players at once)", /\{detail\.call\.media && !mediaExpanded && \(/.test(cc) && /<Modal visible=\{mediaExpanded && !!detail\.call\.media\}/.test(cc));
ok("ending takes everyone to the summary (host + call_ended signal)", /sendSignal\("call_ended"\);/.test(cc)
  && (cc.match(/router\.replace\(\{ pathname: "\/church\/call-summary", params: \{ callId: params\.callId \} \} as any\)/g) ?? []).length === 2);
const sum = src("app/church/call-summary.tsx");
ok("summary opens the lesson studied (church or central)", /pathname: "\/church\/studies\/lesson\/\[lessonId\]"/.test(sum) && /pathname: "\/lesson\/\[id\]"/.test(sum)
  && /summary\.lessonRef\?\.title \?\? summary\.study\?\.lessonTitle/.test(sum));
// ── Prompt 8: progress + what a Gathering leaves behind ──────────────────
const fu = src("components/study/GatheringFollowUp.tsx");
ok("one follow-up section for both summaries (shared notes, assignments, next time)",
  /<GatheringFollowUp followUp=\{summary\} scope="family" \/>/.test(src("app/family/gathering-summary.tsx")) && /<GatheringFollowUp followUp=\{summary\} scope="church" \/>/.test(sum));
ok("summary says private notes/reflections stay private; shows only shared notes", /Private notes and reflections stay private\./.test(fu) && /followUp\.sharedNotes/.test(fu) && !/private/i.test(fu.replace(/\/\/.*$/gm, "").replace(/Private notes and reflections stay private\./, "")));
ok("next time opens the central lesson by reference", /pathname: "\/lesson\/\[id\]", params: \{ id: next\.lesson!\.id \}/.test(fu));
ok("family summary opens a family lesson studied", /pathname: "\/family\/studies\/lesson\/\[lessonId\]", params: \{ lessonId: summary\.lessonRef!\.id/.test(src("app/family/gathering-summary.tsx")));
const lh = src("app/learning/[scope]/[groupId].tsx");
ok("learning home: 'Waiting on you' (own to-do + leaders' review counts) opens the assignment", /Waiting on you/.test(lh) && /data\.work!\.toDo\.map/.test(lh) && /data\.work!\.toReview\.map/.test(lh)
  && (lh.match(/pathname: "\/learning\/assignment\/\[assignmentId\]"/g) ?? []).length === 2);
ok("learning home: member progress only when the server sends it (church leaders), counts only, says so", /data\.memberProgress && data\.memberProgress\.members\.length > 0/.test(lh)
  && /Members \(leaders only\)/.test(lh) && /never their answers/.test(lh) && /chosen not to share with leadership/.test(lh));
ok("family: ending opens the summary for everyone (Guide via the end result, others via history)",
  /const ended = await endWorshipSession\(session\.id\);/.test(gs) && /finishToSummary\(ended\?\.historyId \?\? null\);/.test(gs)
  && (gs.match(/showAlert\("Gathering ended", "This session has ended\."\);\r?\n\s*finishToSummary\(\);/g) ?? []).length === 2
  && /router\.replace\(\{ pathname: "\/family\/gathering-summary", params: \{ historyId: hid, familyId \} \} as any\)/.test(gs)
  && /h\.session_id === params\.sessionId/.test(gs));
ok("children aren't shown media controls (server refuses them too)", /canControlMedia\(session, profile\?\.id\) && myFamilyRole !== "child"/.test(gs));
// ── Prompt 10 polish ──────────────────────────────────────────────────────
const rl = src("app/_layout.tsx");
ok("native headers follow the app theme (no white bar above a dark screen)", /headerStyle: \{ backgroundColor: themeColors\.lightCream \}/.test(rl) && /color: themeColors\.textDark/.test(rl));
ok("the Gathering header names the Gathering (mode badge shows the resource)", /title="Family Gathering"/.test(gs) && !/title="Study Workspace"/.test(gs));
ok("church call summary follows the theme (no fixed light palette)", /const \{ colors \} = useTheme\(\);/.test(sum) && !/import colors from "@\/constants\/colors"/.test(sum));
const chHome = src("app/church/index.tsx");
ok("church overview: a failed load says so with Try again (no endless spinner)", /groveState === "failed"/.test(chHome) && /Try again/.test(chHome));
ok("church call controls are labelled for screen readers; 44pt targets", /accessibilityLabel="Leave the gathering"/.test(cc) && /accessibilityLabel="Open chat"/.test(cc)
  && /iconBtnSmall: \{ width: 44, height: 44/.test(cc) && /reactionBtn: \{ width: 44, height: 44/.test(cc) && !/name: "You", isSelf: true/.test(cc));
// Mute mode really mutes (it used to only say so).
ok("Mute mode mutes my mic only if it was on, and restores only what it muted", /const silent = session\?\.currentMode === "silent_prayer";/.test(gs)
  && /if \(silent && !mutedByModeRef\.current && !voiceSpace\.micMuted\) \{\r?\n\s*mutedByModeRef\.current = true;\r?\n\s*voiceSpace\.toggleMic\(\);/.test(gs)
  && /\} else if \(!silent && mutedByModeRef\.current\) \{\r?\n\s*mutedByModeRef\.current = false;\r?\n\s*if \(voiceSpace\.micMuted\) voiceSpace\.toggleMic\(\);/.test(gs)
  && /\}, \[session\?\.currentMode\]\);/.test(gs));
ok("Mute mode says what is true (you can unmute to speak)", /Your microphone is muted — tap the mic if you need to speak\./.test(gs) && !/Microphones are muted\./.test(gs));
ok("the mute hook runs before the loading guard (no conditional hooks)", gs.indexOf("const mutedByModeRef = useRef(false);") < gs.indexOf("if (loading || !session) {"));
// Church: "muted / camera off by the host" is real after a rejoin or reload too.
ok("church: host locks are applied to the engine on join and when they load (not just shown)",
  /onJoinChannelSuccess: \(\) => applyHostLocks\(\),/.test(cc)
  && /if \(hostLocksRef\.current\.mic\) \{ setMuted\(true\); engine\?\.muteLocalAudioStream\(true\); \}/.test(cc)
  && /if \(hostLocksRef\.current\.video\) \{ setCameraOn\(false\); engine\?\.enableLocalVideo\(false\); \}/.test(cc)
  && /useEffect\(\(\) => \{ applyHostLocks\(\); \}, \[micDisabledByHost, videoDisabledByHost\]\);/.test(cc)
  && cc.indexOf("useEffect(() => { applyHostLocks(); }") < cc.indexOf("if (loading || !detail) {"));
ok("picker labels follow the group", /scope === "church" \? "Church lessons" : "Family lessons"/.test(pick) && /ownStudies\(scope, groupId\)/.test(pick));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
