// Scripture Listening Library — playback and the app's own rules (Phases 2–8):
//   • the ONE shared engine (lib/listen/engine) with a playlist: plays on from
//     passage to passage, Repeat this passage / all, the Previous rule — and
//     nothing changes for other content;
//   • direct device speech: each sentence is spoken straight from the text
//     (no audio files, no preparation, no downloads);
//   • library rules (filters, sort, estimate, search kinds, exact phrase,
//     shuffle, queue changes) and listening reminders (nothing personal,
//     approved routes only);
//   • source checks: one player speaking directly, reader actions kept.
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
    speak: (text, o) => said.push({ text, o }), stop: () => { stops++; }, getVoices: async () => voices, ...extra,
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
  await r.eng.play(playlist(), "start"); await flush();
  ok("Listen starts speaking at once: the heading straight from the text, no preparation", r.said.length === 1 && r.said[0].text.startsWith("John 3, verse 16") && r.eng.getState().status === "playing");
  await finish(r);
  ok("each sentence follows the moment the one before finishes (one utterance at a time)", r.said.length === 2 && r.said[1].text.startsWith("For God so loved the world"));
  const aChunks = chunksOf(r.eng, 0);
  while (r.eng.getState().section === 0) await finish(r);
  ok("a playlist plays on into the next passage by itself", r.eng.getState().section === 1 && r.eng.getState().status === "playing");
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
  ok("Stop ends the session", r.eng.getState().status === "idle" && r.stops > 0);
}
{
  // Other content is unchanged: never moves on by itself, Repeat ignored.
  const r = rig();
  await r.eng.play(playlist({ kind: "story", key: "story:1" }), "start"); await flush();
  r.eng.setRepeat("all");
  while (r.eng.getState().status === "playing") await finish(r);
  ok("non-playlist content still finishes and stops (Repeat doesn't apply)", r.eng.getState().status === "completed");
}
{
  // The plain device-speech driver shape (speak / stop / voices) is all the engine needs.
  const said = [];
  const eng = E.createListenEngine({ speak: (t, o) => said.push({ t, o }), stop() {}, getVoices: async () => voices }, { get: async () => null, set: async () => {}, remove: async () => {} });
  await eng.play(playlist(), "start"); await flush();
  said[said.length - 1].o.onDone(); await flush();
  ok("device speech plays playlists", eng.getState().status === "playing" && said.length === 2);
  eng.stop();
}

{
  const r = rig();
  await r.eng.play(playlist(), "start"); await flush();
  const first = r.said[0];
  r.eng.nextSection(); await flush();
  const n = r.said.length;
  first.o.onDone(); first.o.onDone(); await flush();
  ok("an interrupted sentence's late 'done' never advances or speaks twice", r.said.length === n && r.eng.getState().section === 1);
  r.eng.pause(); await flush();
  ok("pause stops the voice (no speech left running)", r.eng.getState().status === "paused" && r.stops > 0);
  r.eng.resume(); await flush();
  ok("resume speaks again from the same passage", r.said.length === n + 1 && r.eng.getState().section === 1 && r.eng.getState().status === "playing");
  r.eng.stop();
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
const index = src("lib/listen/index.ts"), session = src("lib/listen/playlistSession.ts"), engineSrc = src("lib/listen/engine.ts");
ok("one player: the shared engine speaks with the device voice directly; nothing else creates a speech engine", index.includes("export const listen = createListenEngine(deviceSpeech, {") && !/createListenEngine\(/.test(session) && !/createAudioPlayer/.test(session));
ok("device speech speaks straight from the text (expo-speech), never via audio files", /Speech\.speak\(text, \{/.test(index) && !/synthesize|\.caf\b|FileSystem|createAudioPlayer|fileSpeech/.test(index));
ok("the audio-file pipeline is gone: no file driver, no speech-to-file native module", !existsSync(path.join(root, "lib/listen/fileSpeech.ts")) && !existsSync(path.join(root, "modules/p2p-speech-audio")));
ok("the engine has no sentence preparation, Now Playing or lock-screen button hooks (no misleading controls)", !/prepare\?\(|nowPlaying|setRemote|RemoteControls|publishNowPlaying/.test(engineSrc));
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
