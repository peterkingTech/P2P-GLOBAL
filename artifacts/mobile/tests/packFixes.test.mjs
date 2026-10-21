// App-side tests for the 2026-10-21 fix pack (Prompts 1–10 + exact Bible
// highlighting). Real module code (transpiled; React Native / Expo / Supabase
// mocked) for the pure logic, and source checks for wiring that needs a
// device to observe. Device-only behaviour is listed in the final report.
// Run: node tests/packFixes.test.mjs
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, setInterval, clearInterval, console, Map, Set, JSON, Number, String, Math, Array, Object, Date, RegExp, Error, Symbol,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}
const store = new Map();
const AsyncStorage = { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } } };

// ── Prompt 1: pushes addressed to another account are never shown ──
// (lib/push.ts has native deps — its guard is checked by source; the API test covers delivery.)
{
  const s = src("lib/push.ts");
  ok("P1: push handler hides a push whose recipientId isn't the signed-in account", /isForAnotherAccount\(notification\.request\.content\.data[^)]*, currentRecipientId\)\) \{\s*return \{ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false/.test(s));
  ok("P1: isForAnotherAccount only hides when both ids are known and differ", /typeof to === "string" && !!signedInUserId && to !== signedInUserId/.test(s));
  ok("P1: registration sends the phone's native token (optional)", /getDevicePushTokenAsync\(\)/.test(s) && /\.\.\.\(nativeToken \? \{ nativeToken \} : \{\}\)/.test(s));
  ok("P1: the app tells the push layer who is signed in", /setPushRecipient\(isAuthenticated \? profile\?\.id \?\? null : null\)/.test(src("app/_layout.tsx")));
}

// ── Prompt 2: opening a chat clears only that chat ──
{
  const C = load("lib/conversationNotifications.ts", {
    "react-native": { Platform: { OS: "ios" } }, "expo-notifications": {}, "@react-native-async-storage/async-storage": AsyncStorage,
    "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }, "@/lib/apiUrl": { getApiUrl: () => "" },
  });
  const n = (id, type, conv) => ({ request: { identifier: id, content: { data: { notificationType: type, conversationId: conv } } } });
  const presented = [n("a", "new_message", "c1"), n("b", "new_message", "c1"), n("c", "new_message", "c2"), n("d", "incoming_call", "c1"), n("e", "prayer_request", undefined)];
  ok("P2: only this chat's message notifications are dismissed", JSON.stringify(C.conversationNotificationIds(presented, "c1")) === JSON.stringify(["a", "b"]));
  ok("P2: other chats, calls and other types untouched", C.conversationNotificationIds(presented, "c2").join() === "c" && C.conversationNotificationIds(presented, "zzz").length === 0);
  const chat = src("app/messages/[id].tsx");
  ok("P2: the chat clears its notifications after it has loaded", /\.eq\("user_id", user\.id\);\s*\/\/ The chat opened[^]*?void clearConversationNotifications\(id,/.test(chat));
  ok("P2: messages arriving in the open, focused chat keep it read (debounced)", /markOpenChatReadRef\.current\(\)/.test(chat) && /AppState\.currentState !== "active" \|\| !focusedRef\.current/.test(chat));
  ok("P2: the open chat gets no new tray entries", /isForeground && d\?\.notificationType === "new_message" && openConversationId && d\.conversationId === openConversationId/.test(src("lib/push.ts")));
  ok("P2: failed server mark-reads are retried on sign-in / app return", /flushPendingConversationReads\(\)/.test(src("app/_layout.tsx")));
}

// ── Prompt 3: rotation keeps the same player mounted ──
{
  const R = load("lib/mediaRotation.ts", { "@react-native-async-storage/async-storage": AsyncStorage });
  const L = R.rotatedPlayerLength(390, 844);
  ok("P3: rotated player fits the phone (long side ≤ height, short side ≤ width)", L <= 844 - 120 && L * 9 / 16 <= 390, String(L));
  const sm = src("components/family/SharedMedia.tsx");
  ok("P3: both wrapper views always rendered — only styles change (no remount)", /<View style=\{rotated \? \{ height: length[^}]*\} : undefined\}>\s*<View style=\{rotated \? \{ width: length, transform: \[\{ rotate: "90deg" \}\] \} : undefined\}>\s*<SyncedMediaPlayer/.test(sm));
  ok("P3: status bar hidden only while rotated; controls hidden while rotated", /\{rotated \? <StatusBar hidden \/> : null\}/.test(sm) && /canControl && !rotated/.test(sm));
  const fam = src("app/family/worship/[sessionId].tsx");
  ok("P3: leaving full screen always returns to portrait (Family)", /if \(focused !== "media"\) setMediaRotated\(false\)/.test(fam) && /rotate=\{focused === "media" \?/.test(fam));
  ok("P3: leaving full screen always returns to portrait (Church)", /if \(!mediaExpanded\) setMediaRotated\(false\)/.test(src("app/call/church.tsx")));
  ok("P3: no app-wide orientation change", !/expo-screen-orientation|lockAsync/.test(sm + fam + src("app/call/church.tsx")) && /"orientation": "portrait"/.test(src("app.json")));
}

// ── Prompt 4: audio controls are per-phone and clearly labelled ──
{
  const R = load("lib/mediaRotation.ts", { "@react-native-async-storage/async-storage": AsyncStorage });
  ok("P4: sound levels clamp to 0–1 with sane defaults", JSON.stringify(R.clampSound({ media: 3, voices: -1 })) === JSON.stringify({ media: 1, voices: 0 }) && JSON.stringify(R.clampSound(null)) === JSON.stringify({ media: 1, voices: 1 }));
  ok("P4: voices level maps to Agora 0–100", R.voicesPlaybackLevel(0.5) === 50 && R.voicesPlaybackLevel(2) === 100);
  const ch = src("app/call/church.tsx");
  ok("P4: Church media uses this phone's level (no longer fixed at 1)", (ch.match(/mediaVolume=\{sound\.media\}/g) ?? []).length === 2 && !/mediaVolume=\{1\}/.test(ch));
  ok("P4: Church voices use local playback volume only (adjustPlaybackSignalVolume)", /adjustPlaybackSignalVolume\?\.\(voicesPlaybackLevel\(sound\.voices\)\)/.test(ch) && !/adjustRecordingSignalVolume/.test(ch));
  ok("P4: labels say what each control changes and that only you hear it", /Only you hear these changes/.test(ch) && /Media \(the shared video or audio\)/.test(src("components/family/AudioBalance.tsx")) && /Voices \(everyone speaking\)/.test(src("components/family/AudioBalance.tsx")));
}

// ── Prompt 5: Gathering Scripture uses the licensed chapter API, honest errors ──
{
  const sp = src("components/family/ScripturePanel.tsx");
  ok("P5: passage loaded via the chapter API (not per-verse /bible/passage)", /await getChapter\(b\.code, currentScripture\.chapter, t\)/.test(sp) && !/getBiblePassage\(/.test(sp));
  ok("P5: errors distinguish offline / not set up / busy / not in translation", /status === 0/.test(sp) && /status === 503/.test(sp) && /status === 429/.test(sp) && /status === 404/.test(sp));
  ok("P5: retry offered; reference shared, text fetched", /Try again/.test(sp) && /onSelect\(\{ translation: translationCode, translationName, book, chapter, startVerse: start, endVerse: end \}\)/.test(sp));
  ok("P5: 'Read the full chapter' opens the reader on top (push), off inside My Bible", /router\.push\(bibleRoute\(/.test(sp) && /showOpenInBible=\{false\}/.test(src("components/family/MyBibleSheet.tsx")));
}

// ── Prompt 7 ──
{
  ok("P7: Gathering chat links to the permanent Family chat", /groupChat=\{familyConversationId \?/.test(src("app/family/worship/[sessionId].tsx")));
  const ch = src("app/call/church.tsx");
  ok("P7: Church Gathering has Notes (existing endpoints) and a Church chat link for that church only", /<NotesPanel visible=\{notesOpen\}/.test(ch) && /churchConversationId && userChurch\?\.id === detail\.call\.churchId/.test(ch));
}

// ── Prompt 8: locked lessons explain themselves ──
{
  const K = load("lib/lessonLocks.ts");
  const L = (id, order, extra = {}) => ({ id, moduleId: "m2", title: `L${id}`, order, isCompleted: false, isLocked: false, ...extra });
  const mod = { id: "m2", title: "Module 2", isLocked: false };
  const lessons = [L("1", 1, { isCompleted: true }), L("2", 2, { evaluationStatus: "pending" }), L("3", 3), L("4", 4, { isLocked: true }), L("R", 999, { isLocked: true })];
  const e4 = K.explainLessonLock({ lesson: lessons[3], module: mod, moduleLessons: lessons });
  ok("P8: a locked lesson names the previous lesson to finish", e4.locked && /Finish "L3"/.test(e4.headline) && e4.remaining.length === 1 && e4.remaining[0].lesson.id === "3");
  const eR = K.explainLessonLock({ lesson: lessons[4], module: mod, moduleLessons: lessons });
  ok("P8: the review lesson counts every unapproved earlier lesson (incl. one in review)", /3 lessons left/.test(eR.headline) && eR.remaining.map((r) => r.state).join() === "awaiting_review,open,locked" && eR.reasons.some((r) => /peer reviewer approves/.test(r)));
  const prevMod = { id: "m1", title: "Module 1", isLocked: false };
  const prevLessons = [{ ...L("a", 1, { isCompleted: true }), moduleId: "m1" }, { ...L("b", 2), moduleId: "m1" }];
  const eM = K.explainLessonLock({ lesson: { ...lessons[0], isLocked: true }, module: { ...mod, isLocked: true }, moduleLessons: lessons, previousModule: prevMod, previousModuleLessons: prevLessons });
  ok("P8: a locked module explains the previous module's progress (1 of 2)", /Finish "Module 1"/.test(eM.headline) && eM.reasons.some((r) => /1 of 2 lessons complete — 1 to go/.test(r)) && eM.next.lessonId === "b");
  ok("P8: Continue goes to the next ELIGIBLE lesson (never a locked one)", K.nextAction([mod], lessons).lessonId === "3");
  ok("P8: a returned-for-revision lesson comes first", K.nextAction([mod], [...lessons, L("x", 0, { evaluationStatus: "needs_revision" })]).kind === "fix_revision");
  ok("P8: only waiting for review → says so", K.nextAction([mod], [L("1", 1, { isCompleted: true }), L("2", 2, { evaluationStatus: "pending" })]).kind === "wait_for_review");
  ok("P8: everything complete → done", K.nextAction([mod], [L("1", 1, { isCompleted: true })]).kind === "done");
  ok("P8: an open lesson isn't reported as locked", K.explainLessonLock({ lesson: lessons[2], module: mod, moduleLessons: lessons }).locked === false);
  const mExp = K.explainModuleLock({ title: "Module 3", isLocked: true }, { id: "m2", title: "Module 2", completedLessons: 2, lessonCount: 5, submittedLessons: 3 });
  ok("P8: module outline explanation from real counts", /2 of 5 complete — 3 to go/.test(mExp.reasons.join(" ")) && /1 submitted lesson is waiting/.test(mExp.reasons.join(" ")) && mExp.openModuleId === "m2");
  ok("P8: progress counts approved lessons only", K.progressSummary(lessons).completed === 1 && K.progressSummary(lessons).awaiting === 1 && K.progressSummary(lessons).pct === 20);
  ok("P8: locked rows explain on tap (no silent no-op), rules unchanged", /locked \? setLockSheet\(explainFor\(lesson\)\)/.test(src("app/module/[id].tsx")) && /if \(m\.isLocked\) \{ setLockFor\(m\); return; \}/.test(src("app/curriculum/[id].tsx")));
}

// ── Prompt 9: reminders ──
{
  const scheduled = [];
  let perm = "granted";
  const Notif = {
    SchedulableTriggerInputTypes: { WEEKLY: "weekly", TIME_INTERVAL: "timeInterval" },
    getAllScheduledNotificationsAsync: async () => scheduled.map((x) => ({ identifier: x.identifier })),
    cancelScheduledNotificationAsync: async (id) => { const i = scheduled.findIndex((x) => x.identifier === id); if (i >= 0) scheduled.splice(i, 1); },
    getPermissionsAsync: async () => ({ status: perm, canAskAgain: true }),
    requestPermissionsAsync: async () => ({ status: perm }),
    scheduleNotificationAsync: async (r) => { scheduled.push(r); return r.identifier; },
  };
  const SR = load("lib/studyReminders.ts", { "react-native": { Platform: { OS: "ios" } }, "@react-native-async-storage/async-storage": AsyncStorage, "expo-notifications": Notif });
  const base = { ...SR.DEFAULT_REMINDERS, enabled: true, days: [1, 3, 5], time: "06:30", goalMinutes: 20, focus: ["bible"] };
  ok("P9: settings are validated (bad days/time/goal/focus fixed)", JSON.stringify(SR.normalizeSettings({ enabled: true, days: [9, 1, 1, -2], time: "25:99", goalMinutes: 1000, focus: ["x"] })) === JSON.stringify({ enabled: true, days: [1], time: "07:00", goalMinutes: 240, focus: ["core"] }));
  const plan = SR.plannedReminders(base);
  ok("P9: one weekly reminder per chosen day at the local time (Sun=1)", plan.length === 3 && plan[0].weekday === 2 && plan[0].hour === 6 && plan[0].minute === 30 && plan.every((p) => p.identifier.startsWith("p2p-study-")));
  let r = await SR.applyReminderSchedule(base);
  ok("P9: scheduled", r.status === "scheduled" && scheduled.length === 3 && scheduled.every((x) => x.trigger.type === "weekly"));
  r = await SR.applyReminderSchedule(base);
  ok("P9: re-applying never duplicates", scheduled.length === 3);
  ok("P9: tapping opens the chosen study destination; content never claims completion", scheduled[0].content.data.route === "/bible" && scheduled[0].content.data.notificationType === "study_reminder" && !/complete/i.test(scheduled[0].content.body));
  r = await SR.applyReminderSchedule({ ...base, enabled: false });
  ok("P9: turning reminders off removes them all", r.status === "off" && scheduled.length === 0);
  perm = "denied";
  r = await SR.applyReminderSchedule(base, true);
  ok("P9: permission denied → nothing scheduled, reported", r.status === "permission_denied" && scheduled.length === 0);
  perm = "granted";
  await SR.applyReminderSchedule(base);
  await SR.syncStudyReminders(null);
  ok("P9: signing out clears this phone's study reminders", scheduled.length === 0);
  ok("P9: snooze adds ONE extra reminder (replacing an earlier snooze)", (await SR.snoozeStudyReminder(base, 60)) && (await SR.snoozeStudyReminder(base, 30)) && scheduled.filter((x) => x.identifier === "p2p-study-snooze").length === 1);
  ok("P9: goal progress is transparent", SR.goalProgress(12, 20).label === "12 of 20 minutes today" && SR.goalProgress(25, 20).met === true && SR.goalProgress(25, 20).pct === 100);
  ok("P9: routes are restricted", SR.reminderRoute(["plans"]) === "/plans" && SR.reminderRoute(["core", "bible"]) === "/(tabs)/learn");
  ok("P9: notification taps only open approved routes", /\["\/bible", "\/plans", "\/\(tabs\)\/learn"\]\.includes\(route\) \? route : "\/\(tabs\)\/learn"/.test(src("lib/push.ts")));
  const T = load("lib/studyTime.ts", { react: { useEffect() {}, useRef: (v) => ({ current: v }) }, "react-native": { AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) } }, "@react-native-async-storage/async-storage": AsyncStorage });
  let st = T.addStudyMs({}, "2026-10-21", 15000);
  st = T.addStudyMs(st, "2026-10-21", 600000);
  ok("P9: study time adds per local day; one tick never over-counts (capped)", st["2026-10-21"] === 15000 + 20000);
  let many = {}; for (let d = 1; d <= 40; d++) many = T.addStudyMs(many, `2026-09-${String(d).padStart(2, "0")}`, 1000);
  ok("P9: only the last 30 days are kept", Object.keys(many).length === 30);
  ok("P9: day key is the phone's local date", /^\d{4}-\d{2}-\d{2}$/.test(T.localDayKey(new Date(2026, 9, 21, 23, 59))) && T.localDayKey(new Date(2026, 9, 21, 23, 59)) === "2026-10-21");
  ok("P9: time counted only while lesson/Bible is focused", /useStudyTimeTracker\(user\?\.id, lessonFocused\)/.test(src("app/lesson/[id].tsx")) && /useStudyTimeTracker\(profile\?\.id, screenFocused\)/.test(src("app/bible/index.tsx")));
  ok("P9: the old no-op 'Reminder Day' is replaced by the real reminders screen", !/REMINDER_DAYS\.map/.test(src("app/settings/kingdom-school.tsx")) && /\/settings\/study-reminders/.test(src("app/settings/kingdom-school.tsx")));
}

// ── Prompt 10: client side of Files & Resources ──
{
  const G = load("lib/groupResourcesApi.ts", { "@/contexts/AuthContext": { supabase: {} }, "@/lib/apiUrl": { getApiUrl: () => "" } });
  ok("P10: file kinds and sizes shown plainly", G.fileKind("application/pdf") === "pdf" && G.fileKind("image/png") === "image" && G.formatBytes(1536) === "2 KB" && G.formatBytes(3 * 1024 * 1024) === "3.0 MB");
  const screen = src("app/resources/[scope]/[groupId].tsx");
  ok("P10: upload progress, cancel and retry", /Cancel upload of/.test(screen) && /Retry/.test(screen) && /xhr\.upload\.onprogress/.test(src("lib/groupResourcesApi.ts")));
  ok("P10: delete shown only to the uploader or group leaders (server enforces too)", /const canDelete = mine \|\| perm\.canManage/.test(screen));
  ok("P10: privacy stated", /Only members of this \{groupLabel\} can see and open these files/.test(screen));
  ok("P10: the app never touches the bucket directly", !/storage\.from\(/.test(screen + src("lib/groupResourcesApi.ts")));
}

// ── Exact Bible highlighting ──
{
  const R = load("lib/bibleRanges.ts");
  const verses = [{ verse: 16, text: "For God so loved the world, that he gave his only begotten Son." }, { verse: 17, text: "For God sent not his Son into the world to condemn the world." }];
  const len = (v) => verses.find((x) => x.verse === v)?.text.length ?? 0;
  const t16 = R.tokenize(verses[0].text);
  ok("HL: words and separators tokenised; punctuation never a word", t16.filter((t) => t.word).map((t) => t.text).slice(0, 5).join() === "For,God,so,loved,the" && !t16.some((t) => t.word && /[,.]/.test(t.text)));
  ok("HL: tokens cover the text exactly once", t16.map((t) => t.text).join("") === verses[0].text);
  const world = t16.find((t) => t.text === "world");
  const wr = R.wordRange(16, world);
  const runs = R.verseRuns(16, verses[0].text, [{ color: "gold", ...R.rangeToStored(wr, len) }], null, len);
  ok("HL: a one-word highlight colours exactly that word — the comma after it is not coloured", runs.find((r) => r.color === "gold")?.text === "world" && runs.map((r) => r.text).join("") === verses[0].text);
  const two = [{ color: "gold", startVerse: 16, endVerse: 16, startOffset: 4, endOffset: 7 }, { color: "blue", startVerse: 16, endVerse: 16, startOffset: 11, endOffset: 16 }];
  const r2 = R.verseRuns(16, verses[0].text, two, null, len);
  ok("HL: two highlights in one sentence stay separate and inline", r2.filter((r) => r.color).map((r) => `${r.color}:${r.text}`).join("|") === "gold:God|blue:loved" && r2.map((r) => r.text).join("") === verses[0].text);
  const sel = R.phraseRange({ verse: 16, t: t16.find((t) => t.text === "loved") }, { verse: 17, t: R.tokenize(verses[1].text).find((t) => t.text === "sent") });
  ok("HL: a phrase across verses keeps exact word edges (no silent widening)", R.rangeText(verses, sel) === "loved the world, that he gave his only begotten Son. For God sent");
  const stored = R.rangeToStored(sel, len);
  ok("HL: stored as verse + offsets; whole-verse edges become null", stored.startVerse === 16 && stored.startOffset === 11 && stored.endVerse === 17 && stored.endOffset === 12);
  ok("HL: whole-verse selection stores null offsets (the original verse highlight)", JSON.stringify(R.rangeToStored({ start: { verse: 16, offset: 0 }, end: { verse: 16, offset: len(16) } }, len)) === JSON.stringify({ startVerse: 16, endVerse: 16, startOffset: null, endOffset: null }));
  const sRange = R.sentenceRange(verses, { verse: 17, offset: 9 });
  ok("HL: sentence mode selects the whole sentence incl. its full stop", R.rangeText(verses, sRange) === "For God sent not his Son into the world to condemn the world.");
  const grown = R.nudgeRange(verses, wr, "end", 1);
  ok("HL: extend the end by one word", R.rangeText(verses, grown) === "world, that");
  ok("HL: shrinking never empties the selection", JSON.stringify(R.nudgeRange(verses, wr, "end", -1)) === JSON.stringify(wr) || R.rangeText(verses, R.nudgeRange(verses, wr, "end", -1)).length > 0);
  const clamp = R.verseRuns(16, "Short text.", [{ color: "gold", startVerse: 16, endVerse: 16, startOffset: 6, endOffset: 500 }], null, () => 11);
  ok("HL: an offset beyond a (changed) verse is clamped, never crashes or spills", clamp.map((r) => r.text).join("") === "Short text." && clamp.find((r) => r.color)?.text === "text.");
  const selRuns = R.verseRuns(16, verses[0].text, [], wr, len);
  ok("HL: the selection is shown on exactly the selected characters", selRuns.filter((r) => r.selected).map((r) => r.text).join() === "world");
  const reader = src("app/bible/index.tsx");
  ok("HL: modes Word / Phrase / Sentence / Verse / Passage, chosen before or during selection", ["verse", "word", "phrase", "sentence", "passage"].every((m) => reader.includes(`key: "${m}"`)) && /Select by: /.test(reader) && /setModeSheet\(true\)/.test(reader));
  ok("HL: runs are inline Text (background or underline only — no layout styles)", /const runStyle = /.test(reader) && !/runStyle[^]*?(padding|margin|lineHeight|display)[^]*?const fontSize/.test(reader.slice(reader.indexOf("const runStyle"), reader.indexOf("const fontSize"))));
  ok("HL: copy uses the exact selected text, only when the licence allows", /return rangeText\(verseList, range\)/.test(reader) && /textCopyAllowed \? `“\$\{selectedText\(\)\}” — \$\{selLabel\}` : selLabel/.test(reader));
  ok("HL: undo after highlight / remove", /setUndo\(\{ remove: \[r\.id, \.\.\.r\.pieces\.map/.test(reader) && /restoreHighlights\(undo\.remove, undo\.add\)/.test(reader));
  ok("HL: long-press a verse switches to word selection", /onLongPress=\{textMode \? undefined : \(\) => chooseMode\("word"\)\}/.test(reader));
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
