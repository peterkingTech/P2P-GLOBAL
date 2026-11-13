// Deep Study audio through P2P Listen (owner brief 2026-11-12). Runs the real modules:
//   • lib/listen/originalLanguage.ts — what may be spoken for Hebrew / Aramaic / Greek, and how it's labelled;
//     the generated-audio cache identity (stable; changes with text, version, language, voice, settings);
//   • lib/listen/studyContent.ts — commentary, lexicon, people/places and cross-reference listening;
//   • lib/listen/engine.ts speakSnippet — one word through the SAME speech session (a playing narration
//     pauses and resumes; no voice for the language → "no_voice", never an English voice reading Hebrew).
// Plus wiring: no second audio player, the shared ListenPlayer on every study screen, real Genesis 1:1
// and John 1:1 words from the saved provider fixtures.
// Run: node tests/studyAudio.test.mjs
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
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, console, Map, Set, JSON, Number, String, Math, Array, Object, Date, Error,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

const O = load("lib/listen/originalLanguage.ts");
const S = load("lib/listen/studyContent.ts", { "./originalLanguage": O });
const C = load("lib/listen/chunking.ts");
const V = load("lib/listen/voices.ts");
const P = load("lib/listen/pronounce.ts", { "@/lib/bibleBooks": load("lib/bibleBooks.ts") });
const E = load("lib/listen/engine.ts", { "./chunking": C, "./voices": V, "./pronounce": P });

// Real words (saved provider responses used by the API tests).
const fx = (f) => JSON.parse(readFileSync(path.join(root, "../api-server/tests/fixtures/helloao/study", f), "utf8"));
const gen11 = fx("interlinear_GEN_1.json").chapter.content[0].words;
const jhn11 = fx("interlinear_JHN_1.json").chapter.content[0].words;
const dan2 = fx("interlinear_DAN_2.json").chapter.content.flatMap((v) => v.words);
const bara = gen11.find((w) => w.strongs === "H1254"), logos = jhn11.find((w) => w.strongs === "G3056"), aram = dan2.find((w) => w.language === "aramaic");

(async () => {
  // ── What may be spoken ──
  const h = O.pronunciationPlan(bara.text, "hebrew");
  ok("Hebrew: the ORIGINAL SCRIPT is spoken (never the transliteration)", /[א-ת]/.test(h.speak) && !h.speak.includes("bā") && h.speechLanguage === "he-IL");
  ok("Hebrew: vowel points kept, cantillation removed (only from what the voice receives)", /[ְ-ּ]/.test(h.speak) && !/[֑-֯]/.test(h.speak) && /[֑-֯]/.test(bara.text));
  ok("Hebrew: labelled Modern Israeli Hebrew, device voice, NOT verified", /Modern Israeli Hebrew/.test(h.convention) && /not verified/.test(h.convention) && h.verified === false && h.source === "device_tts");
  const g = O.pronunciationPlan(logos.text, "greek");
  ok("Greek: original script with its accents; labelled Modern Greek, not reconstructed Koine", g.speak === "Λόγος" && g.speechLanguage === "el-GR" && /not a reconstructed Koine/.test(g.convention));
  const a = O.pronunciationPlan(aram.text, "aramaic");
  ok("Aramaic: NEVER read with a Hebrew voice — no audio, with the reason", a.speechLanguage === null && a.speak === "" && /not read with a Hebrew voice/.test(a.unavailableReason));
  // ── Sounds-like fallback (owner 2026-11-13: "Hear it" always plays) ──
  const SL = [["agapē", "greek", "ah-gah-pay"], ["Christos", "greek", "khree-stohs"], ["anthrōpos", "greek", "ahn-throh-pohs"], ["angelos", "greek", "ahn-geh-lohs"],
    ["Pharisaiōn", "greek", "fah-ree-sigh-ohn"], ["sha.lom", "hebrew", "shah-lohm"], ["che.sed", "hebrew", "kheh-sehd"], ["bə·rê·šîṯ", "hebrew", "buh-ray-sheet"],
    ["’ĕ·lō·hîm", "hebrew", "eh-loh-heem"], ["miz·mō·wr", "hebrew", "meez-mohr"], ["wə·ḥō·šeḵ", "hebrew", "wuh-khoh-shehkh"]];
  const bad = SL.filter(([t, l, want]) => O.soundsLike(t, l) !== want);
  ok("sounds-like spelling from both transliteration styles (lexicon + BSB interlinear)", !bad.length, bad.map(([t, l]) => `${t} → ${O.soundsLike(t, l)}`).join(", "));
  ok("sounds-like: nothing without a transliteration; never original letters", O.soundsLike("", "greek") === null && O.soundsLike(null, "hebrew") === null && O.soundsLike("λόγος", "greek") === null);
  const hp = O.pronunciationPlan(bara.text, "hebrew", bara.transliteration), ap = O.pronunciationPlan(aram.text, "aramaic", aram.transliteration);
  ok("plan: own-language voice first, English sounds-like fallback (Aramaic too, still never a Hebrew voice)",
    hp.speechLanguage === "he-IL" && /^[a-z -]+$/.test(hp.soundsLike) && hp.fallbackLanguage === "en" && ap.speechLanguage === null && /^[a-z -]+$/.test(ap.soundsLike));
  // The meteg (U+05BD, a vowel-point mark affecting stress) is KEPT: vowel information is never silently removed.
ok("maqaf joins become a space; sof pasuq and cantillation removed; meteg kept", O.speakableHebrew("וְאֵ֥ת־הָאָֽרֶץ׃") === "וְאֵת הָאָֽרֶץ");
  ok("labels never claim a human recording for computer speech", O.audioSourceLabel("device_tts").includes("computer-generated") && !/person/.test(O.audioSourceLabel("device_tts")) && O.audioSourceLabel("ai_tts") === "AI-generated voice");
  ok("continuous original-language reading is OFF until reviewed; single words on", O.ORIGINAL_AUDIO.continuous === false && O.ORIGINAL_AUDIO.words === true);

  // ── Generated-audio cache identity (for a future approved generating provider) ──
  const base = { sourceId: "lexicon:H1254", contentVersion: "13c6a962", text: "to create", language: "en", provider: "elevenlabs", voice: "Jon", settings: { model: "v4", speed: 1 } };
  const k = O.audioCacheKey(base);
  ok("cache key: identical inputs → identical key (never generated twice)", k === O.audioCacheKey({ ...base, settings: { speed: 1, model: "v4" } }));
  ok("cache key: changes with text, version, language, voice, provider, convention or settings",
    [{ text: "to fatten" }, { contentVersion: "x" }, { language: "de" }, { voice: "Alexander" }, { provider: "other" }, { convention: "koine" }, { settings: { model: "v4", speed: 0.8 } }]
      .every((d) => O.audioCacheKey({ ...base, ...d }) !== k));

  // ── Listening content ──
  const cs = S.commentarySections({ id: "matthew-henry", name: "Matthew Henry", chapter: 1, attribution: "Matthew Henry … public domain.", introduction: "Intro one.\n\nIntro two.", sections: [{ start: 1, end: 5, paragraphs: ["First.", "Second."] }] });
  ok("commentary: introduction, each section announced, paragraphs as shown, credit last", cs.length === 3 && cs[0].parts.length === 3 && cs[1].parts[0].text === "Matthew Henry, on verse 1:1 to 5." && cs[1].parts[2].text === "Second." && cs[2].parts[0].text.startsWith("Source: Matthew Henry"));
  ok("commentary: nothing to read → nothing (no empty session)", S.commentarySections({ id: "x", name: "X", chapter: 1, sections: [] }).length === 0);
  const lx = S.lexiconSections({ id: "H1254", languageName: "Hebrew", attribution: "STEP Bible", senses: [{ id: "H1254A", transliteration: "ba.ra", gloss: "to create", partOfSpeech: "V", definition: "1) to create" }, { id: "H1254B", transliteration: "ba.ra", gloss: "to fatten", partOfSpeech: "V", definition: null }] });
  ok("lexicon: number, every sense (gloss, part of speech, definition), credit", lx[0].parts[0].text === "Strong's H 1254, Hebrew. 2 senses." && lx[1].parts[0].text === "Sense 1, ba.ra: to create." && lx[2].parts[0].text === "Sense 2, ba.ra: to fatten." && lx.at(-1).parts[0].text === "Source: STEP Bible");
  const pp = S.peopleSections([{ name: "God", kind: "person", verses: [1, 2] }, { name: "Creation of all things", kind: "event", verses: [1] }], 1, "Theographic");
  ok("people/places: grouped as on screen, with their verses", pp[0].parts[1].text === "God, in verses 1:1, 1:2." && pp[1].title === "Events");
  const xr = S.crossRefSections([{ verse: 1, references: ["Genesis 1:1", "John 17:5"] }], 1, "OpenBible.info");
  ok("cross references: the related passages by name", xr[0].parts[0].text === "Verse 1:1 is connected with Genesis 1:1; John 17:5.");
  const og = S.originalSections([{ verse: 1, words: gen11 }], 1);
  ok("continuous original (built, gated): Hebrew verse in the original script", og.language === "he" && og.sections[0].parts[0].text.startsWith("בְּרֵאשִׁית"));
  ok("continuous original: a passage with Aramaic is never read (no Hebrew voice for Aramaic)", S.originalSections([{ verse: 4, words: [dan2.find((w) => w.language === "hebrew"), aram] }], 2).language === null);

  // ── speakSnippet: the same speech session ──
  const voices = [{ identifier: "en1", name: "Ava", language: "en-US", quality: "Enhanced" }, { identifier: "he1", name: "Carmit", language: "he-IL", quality: "Default" }, { identifier: "el1", name: "Melina", language: "el-GR", quality: "Default" }];
  const said = []; let stops = 0;
  const driver = { speak: (text, o) => said.push({ text, o }), stop: () => { stops++; }, getVoices: async () => voices };
  const store = new Map();
  const st = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, remove: async (k) => { store.delete(k); } };
  const eng = E.createListenEngine(driver, st, () => 1000, { replayDelaySeconds: 1 });
  const p1 = eng.speakSnippet(h.speak, { language: "he-IL", rate: 0.85 });
  await flush();
  ok("word: spoken with the HEBREW voice, the original script, the chosen speed", said.length === 1 && said[0].o.voice === "he1" && said[0].text === h.speak && said[0].o.rate === 0.85);
  said[0].o.onDone();
  const r1 = await p1;
  ok("word: reports what was heard (voice name and language)", r1.result === "spoken" && r1.voice.name === "Carmit" && r1.voice.language === "he-IL");
  // A narration is playing → the word pauses it, then it carries on.
  await eng.play({ key: "k", owner: "deep-study", kind: "study", title: "T", language: "en", sections: [{ id: "s", title: "S", parts: [{ key: "p", text: "First sentence here. Second sentence here." }] }] }, "start");
  await flush();
  const before = said.length;
  ok("a narration is playing", eng.getState().status === "playing");
  const p2 = eng.speakSnippet(g.speak, { language: "el-GR" });
  await flush();
  ok("word during a narration: the narration pauses (one speech session, never two)", eng.getState().status === "paused" && said.at(-1).o.voice === "el1" && stops > 0);
  said.at(-1).o.onDone();
  await p2; await flush();
  ok("…and the narration carries on afterwards", eng.getState().status === "playing" && said.length === before + 2 && said.at(-1).o.voice === "en1");
  // No voice for the language → nothing is spoken.
  const r3 = await eng.speakSnippet("Ἐν", { language: "grc" });
  const r4 = await E.createListenEngine({ ...driver, getVoices: async () => [voices[0]] }, st, () => 1000, {}).speakSnippet(h.speak, { language: "he-IL" });
  ok("no device voice for the language → 'no_voice'; an English voice never reads Hebrew", r4.result === "no_voice" && r3.result === "no_voice");

  // ── Wiring ──
  const ui = src("components/study/StudyUI.tsx");
  ok("pronunciation goes through P2P Listen (listen.speakSnippet), with Replay and Slower", ui.includes("listen.speakSnippet(plan.speak, { language: plan.speechLanguage, rate })") && ui.includes('"deepStudy.replay"') && ui.includes('"deepStudy.slower"'));
  ok("no own-language voice → the sounds-like spelling in the English voice, labelled an approximation", ui.includes('r.result === "no_voice" && plan.soundsLike') && ui.includes("listen.speakSnippet(plan.soundsLike, { language: plan.fallbackLanguage, rate })") && ui.includes('"deepStudy.approxGreek"') && ui.includes('"deepStudy.approxHebrew"') && ui.includes('"deepStudy.approxAramaic"') && ui.includes('"deepStudy.soundsLike"'));
  ok("pronunciation label always shown (device voice, unverified)", ui.includes('"deepStudy.conventionHebrew"') && ui.includes('"deepStudy.conventionGreek"'));
  const screens = { "app/deep-study/index.tsx": "deep-study", "app/study-tools/word/[strongs].tsx": "study-word", "app/commentaries/read.tsx": "commentary" };
  for (const [f, owner] of Object.entries(screens)) {
    const s = src(f);
    ok(`${f}: the shared player (ListenPlayer + useListenOwner "${owner}")`, s.includes("import ListenPlayer from \"@/components/listen/ListenPlayer\"") && (s.includes(`useListenOwner("${owner}")`) || s.includes("useListenOwner(LISTEN_OWNER)")) && /<ListenPlayer owner=/.test(s));
    ok(`${f}: no second audio player`, !/expo-av|expo-audio|useAudioPlayer|new Audio\(/.test(s));
  }
  const ds = src("app/deep-study/index.tsx");
  ok("Deep Study: word detail has pronunciation; commentaries, cross references and people can be heard", ds.includes("<PronounceButton text={picked.text} language={picked.language} transliteration={picked.transliteration} />")
    && ds.includes("commentarySections(") && ds.includes("crossRefSections(") && ds.includes("peopleSections("));
  ok("study listening is read in English and says so", ds.includes('language: "en"') && ds.includes('"deepStudy.readInEnglish"'));
  ok("engine: study is a content kind; other kinds unchanged", /export type ListenKind = "bible" \| "story" \| "story-intro" \| "lesson" \| "plan" \| "playlist" \| "study";/.test(src("lib/listen/engine.ts")));

  console.log(`studyAudio (app): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
