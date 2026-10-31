// Listen — the shared device text-to-speech player (lib/listen/*,
// components/listen/ListenPlayer.tsx) and its four integrations.
//   Real module code (transpiled; the speech engine and storage are fakes):
//     chunking + position mapping, voice/language matching, and the engine's
//     play / pause / resume / stop, repeated requests, cancellation of old
//     speech, section moves, completion, saved positions, missing text,
//     unsupported languages, speech errors and screen hand-off.
//   Source checks (rendering needs a device): every screen uses the ONE
//   shared player, listening never completes learning, no audio files/URLs.
// Run: node tests/listen.test.mjs
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, console, Map, Set, JSON, Number, String, Math, Array, Object, Date, Error,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const C = load("lib/listen/chunking.ts");
const V = load("lib/listen/voices.ts");
const P = load("lib/listen/pronounce.ts", { "@/lib/bibleBooks": load("lib/bibleBooks.ts") });
const E = load("lib/listen/engine.ts", { "./chunking": C, "./voices": V, "./pronounce": P });

// ── Pronunciation (spoken copy only) ────────────────────────────────────────
const say = (t, l = "en") => P.prepareSpeech(t, l);
ok("LORD in a Bible verse → 'Lord' (not spelled out)", say("The LORD is my shepherd; I shall not want.") === "The Lord is my shepherd; I shall not want.");
ok("LORD God / LORD'S / GOD → normal words", say("And the LORD God formed man. The LORD'S house. GOD said") === "And the Lord God formed man. The Lord's house. God said");
ok("'Lord' in ordinary text is left exactly as written", say("The Lord be with you, my lord.") === "The Lord be with you, my lord.");
ok("a whole sentence in capitals → words", say("THE CALL OF ABRAHAM") === "The Call Of Abraham" && say("HE IS RISEN!") === "He Is Risen!");
ok("ordinary capitalised words inside a sentence → words", say("He is NOT here, for he has RISEN.") === "He is Not here, for he has Risen." && say("The HOLY SPIRIT and SELF-CONTROL") === "The Holy Spirit and Self-Control");
ok("'I AM THAT I AM' read as words", say("I AM THAT I AM.") === "I Am That I Am.");
ok("real abbreviations keep their letters (NIV, KJV, USA, AD, 10 AM, P2P, Part II)", say("Read the NIV and KJV in the USA around AD 70, at 10 AM, with P2P, Part II.") === "Read the NIV and KJV in the USA around AD 70, at 10 AM, with P2P, Part II.");
ok("Scripture references → chapter / verse(s), book abbreviations expanded", say("See John 3:16–18 and 1 Cor 13:4, Gen. 1:1.") === "See John chapter 3, verses 16 to 18 and First Corinthians chapter 13, verse 4, Genesis chapter 1, verse 1.");
ok("book written in full is said as written; whole chapters and times untouched", say("Psalm 23:1. Psalm 23. We meet at 10:30.") === "Psalm chapter 23, verse 1. Psalm 23. We meet at 10:30.");
ok("names and theological terms unchanged in normal case", say("Abraham, Melchizedek, justification and sanctification in Christ Jesus.") === "Abraham, Melchizedek, justification and sanctification in Christ Jesus.");
ok("written abbreviations → words (e.g., cf., v.)", say("Read Acts 2:38, e.g. in the ESV; cf. v. 39.") === "Read Acts chapter 2, verse 38, for example, in the ESV; compare verse 39.");
ok("German: HERR/HERRN, references, 'um 10:30 Uhr' kept, z. B.", say("Der HERR ist mein Hirte. Gott der HERRN. Siehe Johannes 3:16 und um 10:30 Uhr, z. B. heute.", "de")
  === "Der Herr ist mein Hirte. Gott der Herrn. Siehe Johannes Kapitel 3, Vers 16 und um 10:30 Uhr, zum Beispiel heute.");
ok("German: no English replacements applied (e.g. 'e.g.' and English book names untouched)", say("Lies e.g. Gen. 1:1", "de") === "Lies e.g. Gen. Kapitel 1, Vers 1" && say("DAS IST NICHT GUT", "de") === "Das Ist Nicht Gut");
ok("French: L'ÉTERNEL → L'Éternel; versets", say("L'ÉTERNEL est mon berger. Voir Jean 3:16-17.", "fr") === "L'Éternel est mon berger. Voir Jean chapitre 3, versets 16 à 17.");
ok("Spanish / Portuguese / Swahili divine names", say("El SEÑOR es mi pastor.", "es") === "El Señor es mi pastor." && say("O SENHOR é o meu pastor.", "pt") === "O Senhor é o meu pastor." && say("BWANA ndiye mchungaji wangu.", "sw") === "Bwana ndiye mchungaji wangu.");
ok("other languages: capitals become words, references left as written (no foreign words added)", say("OLUWA ni oluso-agutan mi. Johanu 3:16", "yo") === "Oluwa ni oluso-agutan mi. Johanu 3:16" && say("ГОСПОДЬ — Пастырь мой. Иоанна 3:16", "ru") === "Господь — Пастырь мой. Иоанна 3:16");
ok("scripts without capitals are untouched", say("الرب راعيّ فلا يعوزني شيء.", "ar") === "الرب راعيّ فلا يعوزني شيء.");
ok("punctuation and sentence ends kept (pauses stay)", say("LORD, hear me! Why? Because; HE loves.") === "Lord, hear me! Why? Because; He loves.");
ok("empty text is safe", say("") === "" && say("   ") === "");
{
  const verse = "In the beginning GOD created the heaven and the earth. And the LORD God said, Let there be light.";
  const big = Array.from({ length: 12 }, () => verse).join(" ");
  const sections = [{ id: "v", title: "", parts: [{ key: "1", text: big }] }];
  const before = JSON.stringify(sections);
  const spoken = C.buildChunks(sections, 200, (t) => P.prepareSpeech(t, "en"));
  ok("long text: several segments, each normalised (no LORD/GOD left)", spoken.length > 3 && spoken.every((c) => !/\bLORD\b|\bGOD\b/.test(c.text) && /Lord|God/.test(c.text)));
  ok("displayed text unchanged; segments still map into it", JSON.stringify(sections) === before && spoken.every((c) => /\bGOD\b|\bLORD\b|^[^A-Z]*$/.test(big.slice(c.start, c.end)) || big.slice(c.start, c.end).length > 0));
  ok("segment ranges point at the original (capitalised) words", spoken.some((c) => big.slice(c.start, c.end).includes("LORD")));
}
const L = load("lib/listen/lessonContent.ts", { "./labels": load("lib/listen/labels.ts") });

// ── Chunking ───────────────────────────────────────────────────────────────
const sentence = (i) => `This is sentence number ${i}, which carries a little weight of meaning for the reader.`;
const long = Array.from({ length: 30 }, (_, i) => sentence(i)).join(" ");
const ranges = C.splitRanges(long, 200);
ok("long text: several chunks, none over the limit", ranges.length > 5 && ranges.every(([s, e]) => e - s <= 200));
ok("long text: chunks end at sentence boundaries", ranges.slice(0, -1).every(([, e]) => /[.!?]$/.test(long.slice(0, e))));
ok("long text: every word kept, in order, none split", ranges.map(([s, e]) => long.slice(s, e)).join(" ").split(/\s+/).join(" ") === long.split(/\s+/).join(" "));
const noStops = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
const r2 = C.splitRanges(noStops, 60);
ok("no punctuation: splits at spaces, never inside a word", r2.every(([s, e]) => !/\w/.test(noStops[s - 1] ?? " ") && !/\w/.test(noStops[e] ?? " ")));
ok("one giant word: hard split, nothing lost", C.splitRanges("x".repeat(500), 200).reduce((a, [s, e]) => a + e - s, 0) === 500);
ok("speakable: layout marks and spacing tidied, words unchanged", C.speakable("  In the ¶ beginning *was*\n\n the Word ") === "In the beginning was the Word");
ok("empty / missing / whitespace text → no chunks", C.buildChunks([{ id: "a", title: "", parts: [{ key: "1", text: "" }, { key: "2", text: "   " }, { key: "3", text: null }] }]).length === 0);
const secs = [
  { id: "s0", title: "One", parts: [{ key: "1", text: "In the beginning God created the heavens and the earth." }] },
  { id: "s1", title: "Two", parts: [{ key: "2", text: long }] },
  { id: "s2", title: "Three", parts: [{ key: "3", text: "And God saw that it was good." }] },
];
const chunks = C.buildChunks(secs, 200);
ok("chunks keep their section, part and range in the original text", chunks.every((c) => long.includes(c.text) || secs[c.section].parts[c.part].text.slice(c.start, c.end).replace(/\s+/g, " ").trim() === c.text));
ok("chunkIndexFor maps a part + offset back to its chunk", chunks[C.chunkIndexFor(chunks, "2", 300)].start <= 300 && chunks[C.chunkIndexFor(chunks, "2", 300)].end > 300 && C.chunkIndexFor(chunks, "nope") === -1);
ok("resumeOffset: back to the start of the reported word", C.resumeOffset("And God saw that it was good.", 10) === 8 && C.resumeOffset("abc", null) === 0);

// ── Voices / language ─────────────────────────────────────────────────────
const voices = [
  { identifier: "en1", name: "Ava", language: "en-US", quality: "Enhanced" },
  { identifier: "en2", name: "Dan", language: "en-GB", quality: "Default" },
  { identifier: "fr1", name: "Amelie", language: "fr-FR", quality: "Default" },
];
ok("baseLanguage: en_US / eng / EN → en", V.baseLanguage("en_US") === "en" && V.baseLanguage("eng") === "en" && V.baseLanguage("EN") === "en");
ok("voicesFor: only the content's language, enhanced first", V.voicesFor("en", voices).map((v) => v.identifier).join() === "en1,en2");
ok("chooseVoice: saved preference honoured within the language", V.chooseVoice("en", voices, "en2", null).voice === "en2");
ok("chooseVoice: no matching voice → unavailable (no silent fallback)", V.chooseVoice("yo", voices, null, null).kind === "unavailable");
ok("chooseVoice: explicit other-language choice is an override, said as such", V.chooseVoice("yo", voices, null, "fr1").kind === "override");
ok("chooseVoice: engine reported no voices → language tag only", JSON.stringify(V.chooseVoice("en", [], null, null)) === JSON.stringify({ kind: "match", language: "en", voice: null }));

// ── Engine ─────────────────────────────────────────────────────────────────
function rig(deviceVoices = voices, opts = { replayDelaySeconds: 1 }) {
  const said = []; let stops = 0;
  const driver = {
    speak: (text, o) => said.push({ text, o }),
    stop: () => { stops++; },
    getVoices: async () => deviceVoices,
  };
  const store = new Map();
  const st = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, remove: async (k) => { store.delete(k); } };
  const eng = E.createListenEngine(driver, st, () => 1000, opts);
  return { eng, said, store, get stops() { return stops; }, last: () => said[said.length - 1] };
}
const content = (over = {}) => ({ key: "k1", owner: "screenA", title: "T", language: "en", sections: secs, ...over });

{
  const r = rig();
  const p = r.eng.play(content(), "start");
  ok("play: loading while voices load", r.eng.getState().status === "loading");
  await p; await flush();
  ok("play: playing, one utterance with the first chunk", r.eng.getState().status === "playing" && r.said.length === 1 && r.said[0].text.startsWith("In the beginning"));
  ok("play: content language + matched voice + rate passed", r.said[0].o.language === "en" && r.said[0].o.voice === "en1" && r.said[0].o.rate === 1);
  r.said[0].o.onDone();
  ok("done → next chunk (next section)", r.eng.getState().chunk === 1 && r.eng.getState().section === 1 && r.said.length === 2);
  r.last().o.onBoundary({ charIndex: 30 });
  r.eng.pause();
  const pausedAt = r.eng.getState();
  ok("pause: status paused, speech stopped, place kept", pausedAt.status === "paused" && pausedAt.chunk === 1 && r.stops > 0);
  const old = r.last();
  old.o.onDone();
  ok("pause: the stopped utterance's late 'done' is ignored (no jump)", r.eng.getState().status === "paused" && r.eng.getState().chunk === 1);
  r.eng.resume();
  ok("resume: same chunk, from the last reported word — not the start of the chapter", r.eng.getState().chunk === 1 && r.last().text.length < old.text.length && old.text.endsWith(r.last().text));
  ok("listening position saved (part + offset, never the text)", (() => { const p = JSON.parse(r.store.get("p2p.listen.v1.pos:k1")); return p.partKey === "2" && !("text" in p); })());
  r.eng.nextSection();
  ok("next section → first chunk of section 3", r.eng.getState().section === 2 && r.last().text.startsWith("And God saw"));
  r.eng.previousSection();
  ok("previous section from its start → section 2's first chunk", r.eng.getState().section === 1 && r.eng.getState().chunk === 1);
  r.eng.setRate(1.5);
  ok("speed: applied by restarting the current chunk, remembered", r.last().o.rate === 1.5 && JSON.parse(r.store.get("p2p.listen.v1.prefs")).rate === 1.5 && r.eng.getState().chunk === 1);
  r.eng.stop();
  ok("stop: idle, content cleared", r.eng.getState().status === "idle" && r.eng.getState().content === null);
  const n = r.said.length;
  r.said[n - 1].o.onDone();
  ok("stop: old speech can't restart anything", r.said.length === n && r.eng.getState().status === "idle");
}

{
  const r = rig();
  const a = r.eng.play(content({ key: "A" }), "start");
  const b = r.eng.play(content({ key: "B", sections: [secs[2]] }), "start");
  await Promise.all([a, b]); await flush();
  ok("repeated play requests: only the latest content speaks, once", r.said.length === 1 && r.said[0].text.startsWith("And God saw") && r.eng.getState().content.key === "B");
  await r.eng.play(content({ key: "C" }), "start"); await flush();
  const prev = r.said[0];
  prev.o.onDone(); prev.o.onError(new Error("late"));
  ok("replacing content cancels the old utterance's callbacks", r.eng.getState().content.key === "C" && r.eng.getState().status === "playing" && r.eng.getState().chunk === 0);
}

{
  const r = rig();
  let opened = 0;
  await r.eng.play(content({ key: "end", sections: [secs[0]], next: { label: "Genesis 2", open: () => { opened++; } } }), "start"); await flush();
  r.last().o.onDone();
  await new Promise((res) => setTimeout(res, 1200));
  ok("last sentence done → completed, position cleared, NEVER moves on to the next chapter", r.eng.getState().status === "completed" && !r.store.has("p2p.listen.v1.pos:end") && opened === 0 && r.said.length === 1);
  r.eng.resume();
  ok("completed → resume plays again from the start", r.eng.getState().status === "playing" && r.eng.getState().chunk === 0);
}

// ── Sentences, tap-to-listen, modes of presentation ────────────────────────
{
  const sents = C.sentenceRanges("In the beginning, e.g. at the start, God spoke. Read 1 Cor. 13 with Dr. Luke! Then what? Amen.");
  const txt = "In the beginning, e.g. at the start, God spoke. Read 1 Cor. 13 with Dr. Luke! Then what? Amen.";
  ok("one utterance per sentence; abbreviations don't end a sentence", sents.map(([a, b]) => txt.slice(a, b).trim()).join("|") === "In the beginning, e.g. at the start, God spoke.|Read 1 Cor. 13 with Dr. Luke!|Then what?|Amen.");
  const verse = [{ id: "v", title: "", parts: [{ key: "16", text: "For God so loved the world. That he gave his only Son." }] }];
  const ch = C.buildChunks(verse);
  ok("a verse with two sentences → two utterances, both mapped to the verse", ch.length === 2 && ch.every((x) => x.partKey === "16") && ch[1].start > ch[0].end - 1);
  const r = rig();
  await r.eng.play(content({ key: "tap", sections: verse, highlight: "part", kind: "bible" }), "start"); await flush();
  const s = r.eng.getState();
  ok("state carries the displayed sections and where each sentence sits (for highlighting)", s.content.sections === verse && s.chunks.length === 2 && s.chunks[1].partKey === "16" && s.content.highlight === "part");
  ok("device speech: no seconds-seeking, no duration — sentence timing only", s.capabilities.seekSeconds === false && s.capabilities.duration === false && s.capabilities.timing === "sentence");
  r.eng.seekChunk(1);
  ok("tap a sentence → listens from it", r.eng.getState().chunk === 1 && r.last().text === "That he gave his only Son.");
  r.eng.previousSentence();
  ok("back one sentence", r.eng.getState().chunk === 0);
  r.eng.nextSentence();
  ok("forward one sentence", r.eng.getState().chunk === 1);
  ok("pressing Listen opens Read & Listen", r.eng.getState().presented === true);
  r.eng.dismiss();
  ok("closing the screen keeps playing (the mini player stays)", r.eng.getState().presented === false && r.eng.getState().status === "playing");
  r.eng.present();
  ok("the mini player reopens it, same session and place", r.eng.getState().presented === true && r.eng.getState().chunk === 1);
  r.eng.release("screenA", "pause");
  ok("leaving the screen pauses and closes the player", r.eng.getState().status === "paused" && r.eng.getState().presented === false);
  r.eng.stop();
  ok("stop closes it", r.eng.getState().presented === false && r.eng.getState().status === "idle");
}

// ── Listen Again and Auto Listen Again ─────────────────────────────────────
{
  const two = [secs[0], secs[2]];
  const r = rig();
  await r.eng.play(content({ key: "again", sections: two }), "start"); await flush();
  r.eng.setRate(1.25);
  r.last().o.onDone();
  ok("Listen Again (while playing): back to the beginning, same voice and speed", (r.eng.listenAgain(), r.eng.getState().chunk === 0 && r.last().o.rate === 1.25 && r.last().o.voice === "en1" && r.last().text.startsWith("In the beginning")));
  r.last().o.onDone(); r.last().o.onDone();
  ok("finished without Auto Listen Again → stops, no replay", r.eng.getState().status === "completed" && r.eng.getState().replayCountdown === null);
  const before = r.said.length;
  r.eng.listenAgain();
  ok("Listen Again after finishing restarts from the beginning", r.said.length === before + 1 && r.eng.getState().chunk === 0 && r.eng.getState().status === "playing");
}

{
  let opened = 0;
  const r = rig();
  await r.eng.play(content({ key: "auto", sections: [secs[0]], next: { label: "Next", open: () => { opened++; } } }), "start"); await flush();
  const n0 = r.said.length;
  r.eng.setAutoAgain(true);
  ok("turning Auto Listen Again on doesn't restart what's playing", r.said.length === n0 && r.eng.getState().autoAgain === true && JSON.parse(r.store.get("p2p.listen.v1.prefs")).autoAgain === true);
  r.last().o.onDone();
  ok("first finish → a visible countdown before replaying", r.eng.getState().status === "completed" && r.eng.getState().replayCountdown === 1 && r.said.length === n0);
  await new Promise((res) => setTimeout(res, 1150));
  ok("…then the same content plays once more from the beginning", r.eng.getState().status === "playing" && r.eng.getState().replayed === true && r.eng.getState().chunk === 0 && r.said.length === n0 + 1 && r.last().text.startsWith("In the beginning"));
  r.last().o.onDone();
  await new Promise((res) => setTimeout(res, 1150));
  ok("second finish → stops: once only, no loop, never the next item", r.eng.getState().status === "completed" && r.eng.getState().replayCountdown === null && r.said.length === n0 + 1 && opened === 0);
  await r.eng.play(content({ key: "auto2", sections: [secs[0]] }), "start"); await flush();
  ok("a new item resets the one-replay allowance", r.eng.getState().replayed === false);
  r.last().o.onDone();
  r.eng.cancelReplay();
  await new Promise((res) => setTimeout(res, 1150));
  ok("'Don't replay' cancels the pending replay", r.eng.getState().status === "completed" && r.eng.getState().replayCountdown === null && r.eng.getState().replayed === false);
  r.eng.listenAgain(); r.last().o.onDone();
  r.eng.stop();
  await new Promise((res) => setTimeout(res, 1150));
  ok("stopping during the countdown → no replay later (no stray timer)", r.eng.getState().status === "idle");
  await r.eng.play(content({ key: "auto3", sections: [secs[0]] }), "start"); await flush();
  r.eng.setAutoAgain(false);
  r.last().o.onDone();
  ok("Auto Listen Again off → no countdown", r.eng.getState().replayCountdown === null && r.eng.getState().status === "completed");
}

// ── Read & Listen screen preferences (this phone) ──────────────────────────
{
  const U = load("lib/listen/uiPrefs.ts");
  const mem = new Map();
  const store = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => { mem.set(k, v); } };
  const a = U.createUiPrefs(store); await a.ready;
  ok("first time: Read & Listen", a.get().mode === "read-listen");
  a.update({ mode: "audio" });
  const b = U.createUiPrefs(store); await b.ready;
  ok("the last chosen mode is remembered (Audio Only next time)", b.get().mode === "audio");
  ok("bad stored values fall back safely", U.cleanUi({ mode: "loud", textScale: 9, highlight: "yes" }).mode === "read-listen" && U.cleanUi({ textScale: 9 }).textScale === 1);
  ok("three modes, named plainly", U.LISTEN_MODES.map((m) => m.label).join("|") === "Read & Listen|Audio Only|Read Along");
}

{
  const r = rig();
  r.store.set("p2p.listen.v1.pos:saved", JSON.stringify({ partKey: "3", offset: 0, updatedAt: 1 }));
  await r.eng.play(content({ key: "saved", resumeGroup: "bible", meta: { book: "GEN", chapter: 1 } }), "saved"); await flush();
  ok("saved position restored (resumes at the saved part)", r.last().text.startsWith("And God saw"));
  const last = await r.eng.lastListened("bible");
  ok("'last listened' kept per group with the screen's details", last.key === "saved" && last.partKey === "3" && last.meta.book === "GEN");
  await r.eng.play(content({ key: "saved" }), { partKey: "1" }); await flush();
  ok("start at a chosen part (Listen from this verse)", r.last().text.startsWith("In the beginning"));
  r.eng.seekPart("3");
  ok("seekPart while playing", r.eng.getState().partKey === "3");
}

{
  const r = rig();
  const verses = [{ id: "1", title: "Verse 1", parts: [{ key: "1", text: "The LORD is my shepherd; I shall not want." }] }];
  await r.eng.play(content({ key: "ps23", sections: verses }), "start"); await flush();
  ok("engine: the voice is sent the prepared words, the content stays as displayed", r.said[0].text === "The Lord is my shepherd; I shall not want." && verses[0].parts[0].text.includes("LORD"));
  const de = rig([{ identifier: "de1", name: "Anna", language: "de-DE" }]);
  await de.eng.play(content({ key: "de", language: "de", sections: [{ id: "1", title: "", parts: [{ key: "1", text: "Der HERR ist mein Hirte." }] }] }), "start"); await flush();
  ok("engine: preparation follows the content's language", de.said[0].text === "Der Herr ist mein Hirte.");
}

{
  const r = rig();
  await r.eng.play(content({ key: "empty", sections: [{ id: "x", title: "", parts: [{ key: "1", text: "" }] }] })); await flush();
  ok("missing text → error 'empty', nothing spoken", r.eng.getState().status === "error" && r.eng.getState().error.kind === "empty" && r.said.length === 0);
}

{
  const r = rig();
  await r.eng.play(content({ key: "yo", language: "yo" }), "start"); await flush();
  const s = r.eng.getState();
  ok("unsupported language → explained, nothing spoken, all voices offered", s.status === "error" && s.error.kind === "unavailable_language" && r.said.length === 0 && s.allVoices.length === 3 && s.voices.length === 0);
  r.eng.setVoice("fr1");
  ok("explicit other voice → speaks with it, marked as the person's choice", r.said.length === 1 && r.said[0].o.voice === "fr1" && r.eng.getState().voice.kind === "override");
  ok("an explicit other-language choice isn't saved as that language's voice", !r.store.has("p2p.listen.v1.prefs") || !JSON.parse(r.store.get("p2p.listen.v1.prefs")).voices.yo);
}

{
  const r = rig();
  await r.eng.play(content({ key: "err" }), "start"); await flush();
  r.last().o.onError(new Error("engine busy"));
  ok("speech error → error state with the message, speech stopped", r.eng.getState().status === "error" && /engine busy/.test(r.eng.getState().error.message));
  r.eng.resume();
  ok("after a speech error, resume tries the same place again", r.eng.getState().status === "playing" && r.eng.getState().chunk === 0);
}

{
  const r = rig();
  await r.eng.play(content({ key: "nav", owner: "bible" }), "start"); await flush();
  r.eng.release("lesson", "pause");
  ok("another screen leaving doesn't touch this speech", r.eng.getState().status === "playing");
  r.eng.release("bible", "pause");
  ok("owner screen loses focus → paused (place kept)", r.eng.getState().status === "paused");
  r.eng.release("bible", "stop");
  ok("owner screen closes → stopped", r.eng.getState().status === "idle");
}

{
  const r = rig();
  let thrown = false;
  r.eng.stop(); r.eng.pause(); r.eng.resume(); r.eng.nextSection(); r.eng.previousSection(); r.eng.seekPart("1"); r.eng.toggle();
  ok("controls with nothing loaded are safe no-ops", !thrown && r.said.length === 0 && r.eng.getState().status === "idle");
}

// ── Content builders + spoken signposts ─────────────────────────────────────
const LB = load("lib/listen/labels.ts");
const localeLabels = (lng) => {
  const json = JSON.parse(src(`locales/${lng}.json`));
  return LB.labelsFrom((key) => key.split(".").reduce((o, k) => (o == null ? o : o[k]), json));
};
const EN = localeLabels("en"), DE = localeLabels("de"), YO = localeLabels("yo");
ok("labels come from the app's own translations (same words as the screens)", EN.personalReflections === "Personal Reflections" && EN.check === "Comprehensive Check" && EN.lesson === "Lesson" && EN.overview === "Overview"
  && EN.chapter(1) === "Chapter 1" && EN.question(2) === "Question 2" && EN.storyLessons === "Story Lessons" && EN.lessonItem(3) === "Lesson 3");
ok("labels in German come from de.json", DE.chapter(3) === "Kapitel 3" && DE.question(1) === "Frage 1" && DE.lesson === "Lektion");
ok("a language without a translation gets no label (never English mixed in)", YO.chapter(1) === null && YO.question(1) === null && LB.NO_LABELS.check === null);

const L2 = load("lib/listen/lessonContent.ts", { "./labels": LB });
const lesson = L2.lessonListenSections({
  title: "Faith", scriptures: [{ id: "a", reference: "Hebrews 11:1", text: "Now faith is…" }, { id: "b", reference: "Romans 10:17", text: null }],
  sections: [{ id: "s", title: "What faith is", content: "Para one.\n\nPara two." }],
}, EN);
ok("lesson: announced 'Lesson: <title>', then 'Scripture', then each section with its heading", lesson.length === 2 && lesson[0].parts.map((p) => p.text).slice(0, 2).join("|") === "Lesson: Faith.|Scripture."
  && lesson[1].parts.map((p) => p.text).join("|") === "What faith is.|Para one.|Para two.");
ok("lesson: a verse not in the lesson's language → only its reference is read", lesson[0].parts[3].text === "Romans 10:17.");
ok("lesson with no text → nothing to listen to (nothing invented)", L2.lessonListenSections({ title: "Empty", scriptures: [], sections: [] }, EN).length === 0);
const groups = [
  { id: "discussion", kind: "reflections", title: "Personal Reflections", questions: [{ id: "q1", question: "What is faith?" }, { id: "q2", question: "  " }, { id: "q3", question: "Where do you see it?" }] },
  { id: "check", kind: "check", title: "Comprehensive Check", name: "Comprehensive Check", questions: [{ id: "c1", question: "Explain Hebrews 11 in your words." }] },
  { id: "empty", kind: "reflections", title: "Nothing", questions: [] },
];
const withQs = L2.lessonListenSections({ title: "Faith", scriptures: [], sections: [{ id: "s", title: "", content: "Body." }], questionGroups: groups }, EN);
ok("lesson: 'Personal Reflections' and 'Comprehensive Check' announced, each question numbered; blanks skipped",
  withQs.map((s) => s.title).join("|") === "Lesson|Lesson|Personal Reflections|Comprehensive Check"
  && withQs[2].parts.map((p) => p.text).join("|") === "Personal Reflections.|Question 1. What is faith?|Question 2. Where do you see it?"
  && withQs[3].parts.map((p) => p.text).join("|") === "Comprehensive Check.|Question 1. Explain Hebrews 11 in your words.");
const named = L2.questionSections([{ id: "check", kind: "check", title: "Check", name: "Faith in Action", questions: [{ id: "c", question: "Do it." }] }], EN);
ok("a check with its own title: label then its name", named[0].parts[0].text === "Comprehensive Check. Faith in Action.");
const deQs = L2.lessonListenSections({ title: "Glaube", scriptures: [], sections: [{ id: "s", title: "", content: "Text." }], questionGroups: groups }, DE);
ok("German lesson: German signposts (from de.json)", deQs[0].parts[0].text === "Lektion: Glaube." && deQs[2].parts[1].text === "Frage 1. What is faith?" && deQs[2].parts[0].text === `${DE.personalReflections}.`);
const yoQs = L2.lessonListenSections({ title: "Ìgbàgbọ́", scriptures: [], sections: [{ id: "s", title: "", content: "Ọ̀rọ̀." }], questionGroups: groups }, YO);
ok("untranslated language: only what yo.json has, and numbers — no English words", yoQs[0].parts[0].text === `${YO.lesson}: Ìgbàgbọ́.` && yoQs[2].parts[0].text === "1. What is faith?" && !yoQs.some((s) => s.parts.some((p) => /Question|Chapter|Scripture|Personal/.test(p.text))));
ok("audio says 'Personal Reflections' — never the screens' 'discussion questions' wording", EN.personalReflections === "Personal Reflections" && DE.personalReflections === "Persönliche Reflexionen" && YO.personalReflections === null
  && /personalReflections: s\("listen\.personalReflections"\)/.test(src("lib/listen/labels.ts")) && !/discussionQuestions/.test(src("lib/listen/labels.ts").replace(/\/\/.*$/gm, "")));
ok("question builders take questions only (no answer/submission fields)", !/answer|submission|response|draft/i.test(src("lib/listen/lessonContent.ts").replace(/\/\/.*$/gm, "")));

const SB = load("lib/storybook.ts", { "@/lib/bibleReaderApi": { readerTarget: () => null }, "@/lib/listen/lessonContent": L2, "@/lib/listen/labels": LB });
const chs = SB.chapterListenSections({ chapterNumber: 2, title: "The Call", narrative: "Opening words.\n\nThe journey:\n\n1. They left.\n\nReflection: Think about it, and pray as you go.", lessons: ["Obey.", "", "Trust."] }, undefined, EN);
ok("story chapter: 'Chapter 2: <title>', narrative by sub-heading, 'Story Lessons' with 'Lesson 1…'", chs.map((s) => s.title).join("|") === "Chapter title|The story|The journey|Story Lessons"
  && chs[0].parts[0].text === "Chapter 2: The Call."
  && chs[2].parts.map((p) => p.text).join("|") === "The journey|1. They left.|Reflection: Think about it, and pray as you go."
  && chs[3].parts.map((p) => p.text).join("|") === "Story Lessons.|Lesson 1. Obey.|Lesson 2. Trust.");
const chq = SB.chapterListenSections({ chapterNumber: 1, title: "A", narrative: "Text.", lessons: [] },
  { reflections: [{ id: "r1", question: "What stood out?" }, { id: "r2", question: "How will you respond?" }], check: { title: "Comprehensive Check", questions: [{ id: "c", question: "Retell the chapter." }] } }, EN);
ok("story chapter: 'Personal Reflections' and 'Comprehensive Check' announced, questions numbered, read last", chq.slice(-2).map((s) => s.parts.map((p) => p.text).join("|")).join(" / ")
  === "Personal Reflections.|Question 1. What stood out?|Question 2. How will you respond? / Comprehensive Check.|Question 1. Retell the chapter.");
ok("story introduction: announced 'Introduction'; overview lines left out; none → nothing", SB.introListenSections({ title: "Ruth", subtitle: null, body: "Central theme: Loyalty\n\nIt began in Moab." }, EN)[0].parts.map((p) => p.text).join("|") === "Introduction.|Ruth.|It began in Moab."
  && SB.introListenSections({ title: "X", subtitle: null, body: "Central theme: Y" }, EN).length === 0);
const bibleSrc = src("app/bible/index.tsx");
ok("Bible: each passage starts with where it is ('John, Chapter 3' / 'John 3:16–18'), verse text unchanged", /function bibleAnnouncement/.test(bibleSrc) && /\.\.\.bibleAnnouncement\(d, language, part\)/.test(bibleSrc)
  && /`\$\{d\.book\.name\} \$\{chapter\}\.`/.test(bibleSrc) && /if \(!chapter\) return \[\]/.test(bibleSrc));
ok("Bible: the heading part is not a verse (verse marker unaffected)", /key: "heading"/.test(bibleSrc) && /Number\(listening!\.partKey\)/.test(bibleSrc));
ok("plan overview announced 'Overview' in its language", /spokenLabels\(plan\.textLanguage \?\? "en"\)\.overview/.test(src("app/plan/[id].tsx")));
ok("screens pass labels for the text's language", /spokenLabels\(textLanguage\)/.test(src("app/lesson/[id].tsx")) && /spokenLabels\("en"\), story\.title\)/.test(src("app/kingdom-stories/chapter.tsx")) && /introListenSections\(story, spokenLabels\("en"\)\)/.test(src("app/kingdom-stories/[id].tsx")));

// ── Source checks: one shared player, wired into the four areas ─────────────
const screens = { bible: "app/bible/index.tsx", story: "app/kingdom-stories/chapter.tsx", "story-intro": "app/kingdom-stories/[id].tsx", lesson: "app/lesson/[id].tsx", plan: "app/plan/[id].tsx" };
for (const [owner, f] of Object.entries(screens)) {
  const s = src(f);
  ok(`${f}: shared player, owned by the screen`, s.includes(`useListenOwner("${owner}")`) && s.includes(`<ListenPlayer owner="${owner}"`) && /from "@\/lib\/listen"/.test(s));
  ok(`${f}: no direct speech/audio package, no audio URLs`, !/from "expo-speech"|expo-av|expo-audio|\.mp3|\.m4a|audioUrl/i.test(s));
}
const engineSrc = src("lib/listen/engine.ts") + src("lib/listen/index.ts") + src("components/listen/ListenPlayer.tsx");
ok("listening never touches learning progress (no completion/progress calls)", !/markLessonComplete|completeLesson|finishKingdomStoryChapter|handleComplete|DataContext|useData|p2p_lesson_progress|supabase/.test(engineSrc));
ok("Listen handlers in screens don't complete anything", [src(screens.lesson).match(/const onListen = [\s\S]*?\n  \};/)?.[0] ?? "x", src(screens.story).match(/const onListen = [\s\S]*?\n  \};/)?.[0] ?? "x"].every((h) => !/complete|finish|submit/i.test(h)));
ok("only lib/listen imports expo-speech", /from "expo-speech"/.test(src("lib/listen/index.ts")));
ok("pause on leaving the screen / app background; stop on close", /useFocusEffect\([\s\S]*release\(owner, "pause"\)/.test(src("lib/listen/index.ts")) && /AppState\.addEventListener[\s\S]*release\(owner, "pause"\)[\s\S]*release\(owner, "stop"\)/.test(src("lib/listen/index.ts")));
ok("iOS: system-managed audio session (calls interrupt speech normally)", /useApplicationAudioSession: false/.test(src("lib/listen/index.ts")));
const bible = src(screens.bible);
ok("Bible: voice language from the translation; none known → not offered", /translations\?\.find\(\(t\) => t\.code === d\.translation\.code\)\?\.language/.test(bible) && /if \(!language\) return null/.test(bible));
ok("Bible: one verse per part (no verse numbers or headings spoken)", /parts: \[\{ key: String\(v\.verse\), text: v\.text \}\]/.test(bible));
ok("Bible: never moves to the next chapter by itself; Listen from a selected verse", !/continueToNext/.test(bible + src("lib/listen/engine.ts")) && /listen\.seekPart\(String\(sel\.start\)\)/.test(bible));
ok("Bible: the verse being read is marked at verse level only (no word timing)", /speakingVerse === v\.verse/.test(bible) && !/onBoundary/.test(bible));
ok("player: speed, voice, sections, stop, accessible labels", /Speaking speed/.test(engineSrc) && /setVoice/.test(engineSrc) && /accessibilityLabel="Stop listening"/.test(engineSrc) && /Previous part/.test(engineSrc));
ok("player: says plainly it's the phone's own voice (no narrator persona)", /Read aloud by your phone's own voice/.test(engineSrc)
  && !/\bAI\b|narrator|teacher|mentor/i.test(src("components/listen/ListenPlayer.tsx").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));

// ── Branded listening screen ──────────────────────────────────────────────
const player = src("components/listen/ListenPlayer.tsx");
ok("branding: reuses the official logo and app icon (no new logo files)", /require\("@\/assets\/images\/logo\.png"\)/.test(player) && /require\("@\/assets\/images\/icon\.png"\)/.test(player)
  && !/require\("@\/assets\/(?!images\/(logo|icon)\.png)/.test(player));
ok("branding: background from the person's theme (light/dark), logo as a faint watermark", /useTheme\(\)/.test(player) && /resolvedMode === "dark"/.test(player)
  && /<LinearGradient colors=\{\[c\.lightCream, withAlpha\(c\.accentGreen/.test(player) && /opacity: dark \? 0\.06 : 0\.045/.test(player));
ok("branding: decorative images hidden from screen readers; controls stay labelled", /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/.test(player) && /pointerEvents="none"/.test(player) && /accessibilityLabel=\{mainLabel\}/.test(player));
ok("branding: works in portrait and landscape, safe areas respected", /supportedOrientations=\{\["portrait", "landscape"\]\}/.test(player) && /const landscape = width > height/.test(player) && /insets\.left \+ 18/.test(player));
ok("branding: no extra animation libraries or loops", !/Animated\.|reanimated|loop\(/.test(player));
ok("mini player shows the app icon artwork", /<AppArtwork size=\{36\}/.test(player));

// ── Read & Listen screen ──────────────────────────────────────────────────
const reader = src("components/listen/ReadAlongText.tsx");
ok("three modes on one playback: switching only changes the view", /SegmentedControl accessibilityLabel="Listening mode" value=\{mode\} onChange=\{\(v\) => listenUi\.update\(\{ mode: v as ListenMode \}\)\}/.test(player)
  && !/listenUi\.update[^\n]*listen\.(play|stop|listenAgain)/.test(player));
ok("Read & Listen highlights and follows; Read Along has its own switches", /highlight=\{mode === "read-listen" \? true : ui\.highlight\}/.test(player) && /follow=\{mode === "read-listen" \? true : ui\.highlight && ui\.autoScroll\}/.test(player)
  && /label="Highlight"/.test(player) && /label="Auto-scroll"/.test(player));
ok("Audio Only: artwork (content's own, else the app icon), title, progress, controls — no text", /mode === "audio" \?/.test(player) && /content\.artwork \?\? null/.test(player) && /resizeMode="contain"/.test(player));
ok("reading view: current sentence (or verse) highlighted by weight + wash, not colour alone", /now: \{[^}]*fontWeight: "700", backgroundColor: withAlpha\(c\.accentGreen/.test(reader) && /unit === "part" \|\| i === curChunk/.test(reader));
ok("reading view: follows gently (only outside the comfortable middle)", /viewH \* 0\.18/.test(reader) && /viewH \* 0\.6/.test(reader) && /animated: true/.test(reader));
ok("reading view: hand scrolling pauses following (never the audio) and offers 'Return to current reading'", /onScrollBeginDrag=\{\(\) => \{ if \(follow\) setDetached\(true\); \}\}/.test(reader)
  && /accessibilityLabel="Return to current reading"/.test(reader) && !/listen\.(pause|stop)/.test(reader));
ok("reading view: tap a sentence/verse to listen from it", /onPress=\{\(\) => listen\.seekChunk\(i\)\}/.test(reader) && /accessibilityHint="Listen from here"/.test(reader));
ok("reading view: shows the content's own words (never the spoken copy), Bible verse numbers", /p\.text\.slice\(start, end\)/.test(reader) && !/prepareSpeech/.test(reader) && /s\.verseNum/.test(reader));
ok("text size adjustable; remembered on this phone", /accessibilityLabel="Smaller text"/.test(player) && /accessibilityLabel="Larger text"/.test(player) && /textScale/.test(src("lib/listen/uiPrefs.ts")));
ok("controls: previous/next part, sentence back/forward, big play — no fake ±10 s or times for device speech",
  /accessibilityLabel="Back one sentence"/.test(player) && /accessibilityLabel="Forward one sentence"/.test(player) && /accessibilityLabel="Previous part"/.test(player) && !/10 ?s(ec|econds)?\b|elapsed|remaining/i.test(player.replace(/\/\/.*$/gm, "")));
ok("Listen Again and Auto Listen Again (with its plain description)", /label="Listen Again"/.test(player) && /Auto Listen Again/.test(player) && /Plays this once more from the beginning when it finishes\./.test(player) && /listen\.setAutoAgain\(v\)/.test(player));
ok("finished: replay countdown with 'Don't replay', then the next learning step as buttons", /Listening again in \{st\.replayCountdown\}/.test(player) && /listen\.cancelReplay\(\)/.test(player) && /content\.completionActions/.test(player));
const lessonSrc = src("app/lesson/[id].tsx"), chapterSrc = src("app/kingdom-stories/chapter.tsx");
ok("lesson: 'Continue to Personal Reflections' / 'Comprehensive Check' scroll there — nothing submitted or completed",
  /label: "Continue to Personal Reflections"[^\n]*scrollToLessonPart\("reflections"\)/.test(lessonSrc) && /label: "Continue to Comprehensive Check"[^\n]*scrollToLessonPart\("check"\)/.test(lessonSrc)
  && !/completionActions[\s\S]{0,600}(handleComplete|markLessonComplete|submit)/.test(lessonSrc));
ok("story chapter: same next steps; chapter announced with the story's name", /label: "Continue to Personal Reflections"[^\n]*scrollToSection\("reflection"\)/.test(chapterSrc) && /scrollToSection\("check"\)/.test(chapterSrc)
  && !/completionActions[\s\S]{0,700}finishKingdomStoryChapter/.test(chapterSrc));
const storyTitled = SB.chapterListenSections({ chapterNumber: 2, title: "The Call", narrative: "Text.", lessons: [] }, undefined, EN, "Ruth");
ok("story chapter announcement: 'Ruth. Chapter 2: The Call.'", storyTitled[0].parts.map((p) => p.text).join(" ") === "Ruth. Chapter 2: The Call.");
ok("Bible: 'Proverbs Chapter 1' for every chapter, including one chosen next in the player", /`\$\{d\.book\.name\} \$\{chapter\}\.`/.test(bibleSrc) && /autoListen\.current = "start"; go\(to\.bookCode, to\.chapter\)/.test(bibleSrc));
ok("Bible: verse-level highlighting, Bible artwork, 'Return to reading' / 'Choose another passage'", /highlight: "part"/.test(bibleSrc) && /artwork: BIBLE_COVER/.test(bibleSrc) && /"Return to reading"/.test(bibleSrc) && /"Choose another passage"/.test(bibleSrc));
ok("every screen's Listen opens Read & Listen (and reopens it while listening)", ["app/bible/index.tsx", "app/kingdom-stories/chapter.tsx", "app/kingdom-stories/[id].tsx", "app/lesson/[id].tsx", "app/plan/[id].tsx"].every((f) => /return listen\.present\(\)/.test(src(f))));
ok("narration source is swappable (not tied to expo-speech) and honest about its abilities", /capabilities\?: NarrationCapabilities/.test(src("lib/listen/engine.ts")) && !/expo-speech/.test(src("lib/listen/engine.ts").replace(/\/\/.*$/gm, "")));
ok("numbers are left for the voice to read", say("The 12 tribes and 3 days, 40 years.") === "The 12 tribes and 3 days, 40 years.");

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
