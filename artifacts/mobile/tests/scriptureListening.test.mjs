// Scripture Listening Library — playback and the app's own rules (Phases 2–8):
//   • the ONE shared engine (lib/listen/engine) with a playlist: plays on from
//     passage to passage, Repeat this passage / all, the Previous rule, the
//     lock-screen hooks (now playing, prepare the next sentence, release on
//     Stop, remote buttons) — and nothing changes for other content;
//   • the audio-file driver (lib/listen/fileSpeech) with fake native module and
//     player: speak → file → play → done, lock screen with the OFFICIAL artwork,
//     lock-screen / headphone pause and play, iOS next/previous, calls and
//     Background playback off fall back to device speech, files deleted;
//   • library rules (filters, sort, estimate, search kinds, exact phrase,
//     shuffle, queue changes) and listening reminders (nothing personal,
//     approved routes only);
//   • source checks: one player, official artwork, reader actions kept.
// Run: node tests/scriptureListening.test.mjs
import { readFileSync, existsSync } from "node:fs";
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
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };

const C = load("lib/listen/chunking.ts");
const V = load("lib/listen/voices.ts");
const P = load("lib/listen/pronounce.ts", { "@/lib/bibleBooks": load("lib/bibleBooks.ts") });
const E = load("lib/listen/engine.ts", { "./chunking": C, "./voices": V, "./pronounce": P });
const voices = [{ identifier: "en1", name: "Ava", language: "en-US", quality: "Enhanced" }];

function rig(extra = {}) {
  const said = []; let stops = 0; const events = [];
  const driver = {
    speak: (text, o) => said.push({ text, o }), stop: () => { stops++; }, getVoices: async () => voices,
    prepare: (text) => events.push(["prepare", text]), nowPlaying: (info) => events.push(["now", info]), release: () => events.push(["release"]),
    setRemote: (c) => events.push(["remote", c]), ...extra,
  };
  const store = new Map();
  const st = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, remove: async (k) => { store.delete(k); } };
  const eng = E.createListenEngine(driver, st, () => 1000, { replayDelaySeconds: 1 });
  return { eng, said, events, get stops() { return stops; }, last: () => said[said.length - 1] };
}
// Two passages, two sentences each (+ a heading sentence).
const playlist = (over = {}) => ({
  key: "collection:p1", owner: "scripture-collection", kind: "playlist", title: "Morning with God", language: "en", highlight: "part",
  sections: [
    { id: "a", title: "John 3:16", parts: [{ key: "a:heading", text: "John 3, verse 16." }, { key: "a:16", text: "For God so loved the world. He gave his only Son." }] },
    { id: "b", title: "Psalms 23:1", parts: [{ key: "b:heading", text: "Psalm 23, verse 1." }, { key: "b:1", text: "The Lord is my shepherd. I shall not want." }] },
  ], ...over,
});
const chunksOf = (eng, section) => eng.getState().chunks.map((c, i) => [c, i]).filter(([c]) => c.section === section).map(([, i]) => i);
const finish = async (r) => { r.last().o.onDone(); await flush(); };

// ── Engine: playlists ───────────────────────────────────────────────────────
{
  const r = rig();
  const remote = r.events.find((e) => e[0] === "remote")?.[1];
  ok("engine: lock-screen / headphone buttons are wired into the same engine", !!remote && ["play", "pause", "next", "previous"].every((k) => typeof remote[k] === "function"));
  await r.eng.play(playlist(), "start"); await flush();
  const now = r.events.filter((e) => e[0] === "now");
  ok("now playing: passage as title, playlist as album, P2P Global as artist", now.length === 1 && now[0][1].title === "John 3:16" && now[0][1].album === "Morning with God" && now[0][1].artist === "P2P Global");
  ok("the next sentence is prepared while this one plays (no gap)", r.events.some((e) => e[0] === "prepare" && e[1].startsWith("For God")));
  const aChunks = chunksOf(r.eng, 0);
  while (r.eng.getState().section === 0) await finish(r);
  ok("a playlist plays on into the next passage by itself", r.eng.getState().section === 1 && r.eng.getState().status === "playing");
  ok("now playing follows the passage", r.events.filter((e) => e[0] === "now").pop()[1].title === "Psalms 23:1");
  // Previous: early in a passage → the one before; later → restart this one.
  r.eng.previousSection(); await flush();
  ok("Previous at the start of a passage goes to the passage before", r.eng.getState().section === 0 && r.eng.getState().chunk === aChunks[0]);
  await finish(r); await finish(r);
  r.eng.previousSection(); await flush();
  ok("Previous later in a passage starts that passage again", r.eng.getState().section === 0 && r.eng.getState().chunk === aChunks[0]);
  // Repeat this passage.
  r.eng.setRepeat("one");
  for (let i = 0; i < aChunks.length; i++) await finish(r);
  ok("Repeat this passage: loops within the passage", r.eng.getState().section === 0 && r.eng.getState().chunk === aChunks[0] && r.eng.getState().status === "playing");
  // Repeat all: after the last passage, back to the first.
  r.eng.setRepeat("all");
  r.eng.nextSection(); await flush();
  while (r.eng.getState().section === 1) await finish(r);
  ok("Repeat all: after the last passage it starts again from the first", r.eng.getState().section === 0 && r.eng.getState().status === "playing");
  r.eng.setRepeat("off");
  r.eng.nextSection(); await flush();
  while (r.eng.getState().status === "playing" && r.eng.getState().section === 1) await finish(r);
  ok("Repeat off: the playlist finishes after its last passage", r.eng.getState().status === "completed");
  r.eng.setRepeat("bogus");
  ok("repeat accepts only off / one / all", r.eng.getState().repeat === "off");
  r.eng.stop();
  ok("Stop releases the audio and lock screen", r.events.some((e) => e[0] === "release") && r.eng.getState().status === "idle");
}
{
  // Other content is unchanged: never moves on by itself, Repeat ignored.
  const r = rig();
  await r.eng.play(playlist({ kind: "story", key: "story:1" }), "start"); await flush();
  r.eng.setRepeat("all");
  while (r.eng.getState().status === "playing") await finish(r);
  ok("non-playlist content still finishes and stops (Repeat doesn't apply)", r.eng.getState().status === "completed");
  ok("non-playlist lock screen: content title + subtitle", r.events.find((e) => e[0] === "now")[1].title === "Morning with God");
}
{
  // A driver without the optional hooks keeps working exactly as before.
  const said = [];
  const eng = E.createListenEngine({ speak: (t, o) => said.push({ t, o }), stop() {}, getVoices: async () => voices }, { get: async () => null, set: async () => {}, remove: async () => {} });
  await eng.play(playlist(), "start"); await flush();
  said[said.length - 1].o.onDone(); await flush();
  ok("device speech (no lock-screen hooks) still plays playlists", eng.getState().status === "playing" && said.length === 2);
  eng.stop();
}

// ── Audio-file driver ───────────────────────────────────────────────────────
const F = load("lib/listen/fileSpeech.ts", {
  "react-native": { Platform: { OS: "ios" } },
  "expo-modules-core": { requireOptionalNativeModule: () => null },
  "expo-audio": { createAudioPlayer: () => { throw new Error("not in tests"); }, setAudioModeAsync: async () => {} },
  "expo-asset": { Asset: { fromModule: () => ({ downloadAsync: async () => ({ localUri: "file:///bundle/icon.png" }) }) } },
  "@/assets/images/icon.png": 1,
});
function fileRig({ inCall = false, synthFails = false } = {}) {
  const log = []; let n = 0; let remoteCb = null;
  const native = {
    synthesize: async (text, language, voice, rate) => { log.push(["synth", text, language, voice, rate]); if (synthFails) throw new Error("no"); return { uri: `file:///cache/p2p-speech/${++n}.caf`, durationMs: 900 }; },
    remove: (uri) => log.push(["remove", uri]), clearAll: () => log.push(["clearAll"]),
    setTrackCommands: (on) => log.push(["trackCommands", on]), trackCommandsSupported: () => true,
    addListener: (_e, cb) => { remoteCb = cb; return { remove() {} }; },
  };
  const listeners = [];
  const player = {
    playing: false,
    addListener: (_e, cb) => listeners.push(cb),
    replace: (s) => log.push(["replace", s.uri]), play() { this.playing = true; log.push(["play"]); }, pause() { this.playing = false; log.push(["pause"]); },
    setActiveForLockScreen: (a, m, o) => log.push(["lockScreen", a, m, o]), updateLockScreenMetadata: (m) => log.push(["lockMeta", m]), clearLockScreenControls: () => log.push(["clearLock"]),
    emit: (st) => listeners.forEach((l) => l({ isLoaded: true, playbackState: "ready", didJustFinish: false, playing: false, ...st })),
  };
  const fallbackSaid = [];
  const fallback = { speak: (t, o) => fallbackSaid.push(t), stop: () => log.push(["fallbackStop"]), getVoices: async () => voices, capabilities: { seekSeconds: false, duration: false, timing: "sentence" } };
  const d = F.createFileSpeechDriver(fallback, { native, createPlayer: () => player, setAudioMode: async (m) => log.push(["mode", m]), artwork: async () => "file:///bundle/icon.png", inCall: () => inCall });
  const remote = { calls: [], play() { this.calls.push("play"); }, pause() { this.calls.push("pause"); }, next() { this.calls.push("next"); }, previous() { this.calls.push("previous"); } };
  d.setRemote(remote);
  return { d, log, player, fallbackSaid, remote, fire: (c) => remoteCb?.({ command: c }) };
}
{
  ok("no native module (Expo Go / web / older build) → plain device speech, unchanged", F.createFileSpeechDriver({ speak() {}, stop() {}, getVoices: async () => [] }, { native: null }).prepare === undefined);
  const f = fileRig();
  let done = 0, started = 0;
  f.d.nowPlaying({ title: "John 3:16", album: "Morning with God", artist: "P2P Global", artwork: 99 });
  f.d.speak("For God so loved the world.", { language: "en-US", voice: "en1", rate: 1.25, background: true, onDone: () => done++, onStart: () => started++ });
  await flush();
  ok("speak: the phone's voice → an audio file (language, voice, speed kept)", JSON.stringify(f.log.find((x) => x[0] === "synth")) === JSON.stringify(["synth", "For God so loved the world.", "en-US", "en1", 1.25]));
  ok("…played through one player in the background session (no mixing)", f.log.some((x) => x[0] === "mode" && x[1].shouldPlayInBackground && x[1].interruptionMode === "doNotMix") && f.log.some((x) => x[0] === "replace") && f.log.some((x) => x[0] === "play") && started === 1);
  const lock = f.log.find((x) => x[0] === "lockScreen");
  ok("lock screen: passage title, playlist as album, P2P Global, the OFFICIAL artwork file (not the content's picture)", !!lock && lock[1] === true && lock[2].title === "John 3:16" && lock[2].albumTitle === "Morning with God" && lock[2].artist === "P2P Global" && lock[2].artworkUrl === "file:///bundle/icon.png");
  ok("lock screen: no ±10 s buttons (Scripture moves by passage); next/previous switched on", lock[3].showSeekForward === false && lock[3].showSeekBackward === false && f.log.some((x) => x[0] === "trackCommands" && x[1] === true));
  f.player.emit({ didJustFinish: true });
  ok("finished file → the engine is told (and the file deleted)", done === 1 && f.log.some((x) => x[0] === "remove" && x[1].endsWith("/1.caf")));
  f.player.emit({ didJustFinish: true });
  ok("a repeated finish event never advances twice", done === 1);
  // Lock-screen pause / play, headphones, a phone call.
  f.d.speak("He gave his only Son.", { language: "en-US", rate: 1, background: true, onDone: () => done++ });
  await flush();
  f.player.playing = false; f.player.emit({ playing: false });
  ok("paused from the lock screen / headphones unplugged / a call → the engine pauses", f.remote.calls.at(-1) === "pause");
  f.player.emit({ playing: true });
  ok("play from the lock screen → the engine resumes", f.remote.calls.at(-1) === "play");
  f.fire("next"); f.fire("previous");
  ok("next / previous (iOS) → the engine's next / previous passage", f.remote.calls.slice(-2).join() === "next,previous");
  f.d.stop();
  ok("engine pause → player paused (the lock screen stays, with Play)", f.log.at(-1)[0] === "pause" && !f.log.some((x) => x[0] === "clearLock"));
  const n0 = f.log.filter((x) => x[0] === "synth").length;
  f.d.prepare("Next sentence.", { language: "en-US", rate: 1 });
  f.d.speak("Next sentence.", { language: "en-US", rate: 1, background: true });
  await flush();
  ok("a prepared sentence isn't made twice", f.log.filter((x) => x[0] === "synth").length === n0 + 1);
  f.d.release();
  ok("Stop: lock screen cleared, track buttons off, every file deleted", f.log.some((x) => x[0] === "clearLock") && f.log.some((x) => x[0] === "trackCommands" && x[1] === false) && f.log.some((x) => x[0] === "clearAll"));
}
{
  const f = fileRig({ inCall: true });
  f.d.speak("During a call.", { language: "en", rate: 1, background: true });
  await flush();
  ok("during a call: device speech, the audio session untouched", f.fallbackSaid[0] === "During a call." && !f.log.some((x) => x[0] === "mode" || x[0] === "synth"));
  const g = fileRig();
  g.d.speak("Background off.", { language: "en", rate: 1, background: false });
  await flush();
  ok("Background playback off: device speech", g.fallbackSaid[0] === "Background off." && !g.log.some((x) => x[0] === "synth"));
  const h = fileRig({ synthFails: true });
  h.d.speak("No file.", { language: "en", rate: 1, background: true });
  await flush();
  ok("a file that can't be made → spoken directly instead (never silent)", h.fallbackSaid[0] === "No file.");
}

// ── Library rules ───────────────────────────────────────────────────────────
const LR = load("lib/libraryRules.ts");
const card = (o) => ({ id: o.id, kind: "playlist", title: o.id, description: null, itemCount: 1, updatedAt: "2026-11-01", isCopy: false, originOwnerName: null, ...o });
const cards = [card({ id: "Morning", tags: ["Prayer"] }), card({ id: "Promises", kind: "collection", shareCount: 2, updatedAt: "2026-11-03" }), card({ id: "Family", ownerName: "Ben", updatedAt: "2026-10-01" })];
const ids = (l) => l.map((x) => x.id).join();
ok("filter: playlists / collections / shared / private / favourites", ids(LR.filterCards(cards, "playlists", new Set())) === "Morning,Family" && ids(LR.filterCards(cards, "collections", new Set())) === "Promises"
  && ids(LR.filterCards(cards, "shared", new Set())) === "Promises,Family" && ids(LR.filterCards(cards, "private", new Set())) === "Morning" && ids(LR.filterCards(cards, "favourites", new Set(["Family"]))) === "Family");
ok("search: title, description and tags; accents and case ignored", ids(LR.filterCards(cards, "all", new Set(), "prayer")) === "Morning" && ids(LR.filterCards([card({ id: "Prière" })], "all", new Set(), "PRIERE")) === "Prière");
ok("sort: updated / A–Z / played / created by me", ids(LR.sortCards(cards, "updated")) === "Promises,Morning,Family" && ids(LR.sortCards(cards, "alpha")) === "Family,Morning,Promises"
  && ids(LR.sortCards(cards, "played", new Map([["Family", "2026-11-03T10:00"]]))) === "Family,Promises,Morning" && LR.sortCards(cards, "mine").at(-1).id === "Family");
ok("estimate: about 10 s a verse, at least 1 minute, faster at 1.5×", LR.estimateMinutes([{ startVerse: 1, endVerse: 6 }]) === 1 && LR.estimateMinutes(Array(12).fill({ startVerse: 1, endVerse: 5 })) === 10 && LR.estimateMinutes(Array(12).fill({ startVerse: 1, endVerse: 5 }), 1.5) === 7 && LR.estimateMinutes([]) === 0);
const BOOKS = ["john", "psalm", "psalms", "1 cor", "1 corinthians", "romans", "jn", "2 timothy", "song of songs"];
const isBook = (n) => BOOKS.includes(n.toLowerCase());
const kind = (q) => LR.classifyQuery(q, isBook).kind;
ok("search kinds: references", ["John 3:16", "Romans 8:28", "Psalm 23:1-6", "1 Cor 13", "Jn 3.16", "2 Timothy 3:16–17", "Song of Songs 2:4", "john 3"].every((q) => kind(q) === "reference"), ["John 3:16", "Romans 8:28", "Psalm 23:1-6", "1 Cor 13", "Jn 3.16", "2 Timothy 3:16–17", "Song of Songs 2:4", "john 3"].map(kind).join());
ok("search kinds: words are never mistaken for a reference", ["faith", "hope", "Love 3", "peace be with you", "forgiveness"].every((q) => kind(q) === "words"));
ok("search kinds: quoted phrases (straight or curly quotes)", LR.classifyQuery('"The Lord is my shepherd"', isBook).phrase === "The Lord is my shepherd" && LR.classifyQuery("“For God so loved the world”", isBook).kind === "phrase" && kind("  ") === "empty");
ok("exact phrase: case, accents and punctuation ignored; whole words only", LR.containsPhrase("The LORD is my shepherd; I shall not want.", "the lord is my shepherd") && !LR.containsPhrase("The Lord is my shepherds", "my shepherd I") && !LR.containsPhrase("shepherd", "herd"));
let seed = 3; const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
const order = LR.shuffleOrder(["a", "b", "c", "d", "e"], "c", rand);
ok("shuffle: the passage playing stays first, every passage exactly once", order[0] === "c" && [...order].sort().join() === "a,b,c,d,e");
ok("queue: play next / add / remove / move / clear (keeps what's playing)", LR.applyQueueOp(["a", "b", "c"], { op: "playNext", id: "c", after: "a" }).join() === "a,c,b"
  && LR.applyQueueOp(["a"], { op: "add", id: "z" }).join() === "a,z" && LR.applyQueueOp(["a", "b"], { op: "remove", id: "a" }).join() === "b"
  && LR.applyQueueOp(["a", "b", "c"], { op: "move", id: "c", to: 0 }).join() === "c,a,b" && LR.applyQueueOp(["a", "b", "c"], { op: "clear", keep: "b" }).join() === "b"
  && LR.applyQueueOp(["a", "b"], { op: "move", id: "zz", to: 0 }).join() === "a,b");

// ── Listening reminders ─────────────────────────────────────────────────────
const LRm = load("lib/listeningReminders.ts", { "react-native": { Platform: { OS: "ios" } }, "expo-notifications": {}, "@react-native-async-storage/async-storage": { default: {} } });
const uuid = "0e7b6c1a-1234-4abc-9def-0123456789ab";
const rem = LRm.normalizeReminders([{ id: "r1", kind: "listen", enabled: true, time: "07:00", days: [1, 1, 9, 3], collectionId: uuid }, { id: "r1", kind: "listen" }, { id: "BAD ID" }, { id: "r2", kind: "memorise", enabled: true, time: "25:99", days: [0] }]);
ok("reminders: cleaned (days 0–6 once, bad ids/duplicates dropped, bad time → default)", rem.length === 2 && rem[0].days.join() === "1,3" && rem[1].time === "07:00");
ok("reminders: weekly triggers per day with stable ids", JSON.stringify(LRm.plannedTriggers(rem).map((p) => [p.identifier, p.weekday])) === JSON.stringify([["p2p-listen-r1-1", 2], ["p2p-listen-r1-3", 4], ["p2p-listen-r2-0", 1]]));
ok("reminders: open the playlist / the Library / the memorisation list only", LRm.reminderRoute(rem[0]) === `/scripture-collections/${uuid}` && LRm.reminderRoute({ kind: "listen", collectionId: "x" }) === "/library" && LRm.reminderRoute(rem[1]) === "/library/memorise");
ok("reminders: the text is never personal (no passage, no playlist name)", !/Morning with God|John|Psalm|\d+:\d+/.test(JSON.stringify([LRm.reminderText({ kind: "listen" }), LRm.reminderText({ kind: "memorise" })])));
const pushSrc = src("lib/push.ts");
const reSrc = pushSrc.match(/if \(notificationType === "listening_reminder"\) \{[\s\S]*?return (\/\^.*?\/i)\.test\(route\)/)[1];
const allowed = new Function(`return ${reSrc}`)();
ok("a reminder tap goes only to approved places (the real regex from lib/push.ts)", allowed.test("/library") && allowed.test("/library/memorise") && allowed.test(`/scripture-collections/${uuid}`)
  && !allowed.test("/scripture-collections/x") && !allowed.test("/admin") && !allowed.test("https://evil.example") && !allowed.test("/library/../admin"));

// ── Source checks ───────────────────────────────────────────────────────────
const fileSpeech = src("lib/listen/fileSpeech.ts"), index = src("lib/listen/index.ts"), session = src("lib/listen/playlistSession.ts");
ok("one player: the shared engine gets the file driver; nothing else creates a speech engine", index.includes("createListenEngine(createFileSpeechDriver(deviceSpeech,") && !/createListenEngine\(/.test(session) && !/createAudioPlayer/.test(session));
ok("lock-screen artwork is the Listen player's official artwork file, unchanged", fileSpeech.includes('const OFFICIAL_ARTWORK = require("@/assets/images/icon.png");') && src("components/listen/ListenPlayer.tsx").includes('const APP_ICON = require("@/assets/images/icon.png");'));
ok("files are temporary and removed; licensed text never stored", fileSpeech.includes("mod.clearAll()") && !/AsyncStorage|FileSystem\.write/.test(fileSpeech));
ok("native module: iOS + Android, linked from modules/", ["modules/p2p-speech-audio/expo-module.config.json", "modules/p2p-speech-audio/ios/P2PSpeechAudioModule.swift", "modules/p2p-speech-audio/android/src/main/java/expo/modules/p2pspeechaudio/P2PSpeechAudioModule.kt"].every((f) => existsSync(path.join(root, f))));
ok("nothing auto-plays after a restart: resume is only ever a tap", !/AppState|useEffect\([^)]*resumePlaylist/.test(session) && src("app/library/index.tsx").includes("onPress={() => resume(continueItem.id)}"));
const reader = src("app/bible/index.tsx");
ok("Bible reader keeps every action (Note, Save, Listen, Copy, Share, Lessons) and adds Add to…", ['label={selNote ? "Edit note" : "Note"}', 'label={selBookmark ? "Saved" : "Save"}', 'label="Add to…"', 'label="Copy"', 'label="Share"', 'label="Lessons"'].every((x) => reader.includes(x)));
for (const f of ["app/library/index.tsx", "app/library/saved.tsx", "app/library/favourites.tsx", "app/library/history.tsx", "app/library/add.tsx", "app/library/memorise.tsx", "app/library/reminders.tsx", "components/library/SaveScriptureSheet.tsx", "components/library/CoverPicker.tsx", "components/listen/PlaylistControls.tsx"]) {
  const s = src(f);
  ok(`${f}: theme colours only (no raw colours beyond white / error red / scrims)`, !(s.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).some((h) => !["#fff", "#FFF", "#C0392B"].includes(h)), (s.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).join());
  ok(`${f}: accessible (labels on controls)`, (s.match(/accessibilityLabel=/g) ?? []).length >= 2);
}
ok("covers never use the P2P logo; the logo stays the lock-screen artwork", !/logo\.png|icon\.png/.test(src("constants/libraryCovers.ts")) && !/logo\.png|icon\.png/.test(src("components/library/CoverArt.tsx")));

console.log(`scriptureListening (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
