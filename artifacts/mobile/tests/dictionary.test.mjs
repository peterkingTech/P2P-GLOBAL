// Biblical Dictionary (A–Z) in the app: the listening content (real module), the client calls, the three
// screens and their wiring — one canonical record per Strong's number (the dictionary opens the SAME
// lexicon entry Study Tools and Deep Study use), the shared P2P Listen player (no second player), the
// normal Bible reader untouched, translated interface text in all 8 languages, Hebrew/Aramaic shown
// right-to-left, and no reference article invented.
// Run: node tests/dictionary.test.mjs
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
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, JSON, Number, String, Math, Array, Object, Map, Set,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}

// ── Listening content (real module) ──
const SC = load("lib/listen/studyContent.ts", { "./originalLanguage": { speakableGreek: (s) => s, speakableHebrew: (s) => s } });
const term = { key: "love", display: "love", records: [
  { id: "G0026", language: "greek", transliteration: "agapē", gloss: "love", partOfSpeech: "N-F", words: 116, verses: 106 },
  { id: "H0157", language: "hebrew", transliteration: "a.hev", gloss: "to love", partOfSpeech: "V", words: 217, verses: 197 },
] };
const secs = SC.dictionarySections(term, "STEPBible … CC BY 4.0");
const text = secs.flatMap((x) => x.parts.map((p) => p.text)).join(" ");
ok("listen: one section per original word (kept separate), headword first, source last", secs.length === 4 && secs[0].title === "love" && secs[3].title === "Source" && /STEPBible/.test(secs[3].parts[0].text));
ok("listen: words read by transliteration — never original letters in an English voice", text.includes("agapē") && text.includes("a.hev") && !/[֐-׿Ͱ-Ͽ]/.test(text));
ok("listen: real counts and the lexicon gloss are read, labelled", text.includes("Used 116 times in 106 verses") && text.includes("Lexicon gloss: love"));
ok("listen: nothing to read → no sections", SC.dictionarySections({ key: "x", display: "x", records: [] }, null).length === 0);

// ── Client ──
const api = src("lib/deepStudyApi.ts");
ok("client: every dictionary call goes through the ONE study client (/deep-study/dictionary…)", ["/dictionary\"", "/dictionary/browse?", "/dictionary/search?", "/dictionary/term/", "/dictionary/record/"].every((p) => api.includes(p)));
ok("client: search answers are session-only (typing never evicts saved entries)", /dictionarySearch[\s\S]{0,300}persist: false/.test(api) && api.includes("if (opts.persist === false)"));

// ── Screens ──
const index = src("app/dictionary/index.tsx"), entry = src("app/dictionary/term/[key].tsx"), occ = src("app/dictionary/occurrences/[strongs].tsx"), word = src("app/study-tools/word/[strongs].tsx");
ok("A–Z: letters from real counts, empty letters disabled, selection announced", index.includes("overview?.letters") && index.includes("disabled={!count}") && index.includes("accessibilityState={{ selected: L === letter, disabled: !count }}"));
ok("A–Z: position kept for the session (letter, search, language)", index.includes("const saved = {") && index.includes("saved.letter = letter; saved.q = q; saved.language = language;"));
ok("search: debounced, late answers ignored, paged with onEndReached", index.includes("searching ? 300 : 0") && index.includes("if (n !== seq.current) return;") && index.includes("onEndReached={loadMore}"));
ok("search: one box for English, Hebrew, Aramaic, Greek, transliteration and Strong's (labelled)", /Search the dictionary by English word, Hebrew, Aramaic or Greek letters, transliteration or Strong's number/.test(index));
ok("entry: each original word separate, by language, never merged", entry.includes('const ORDER: DictLanguage[] = ["hebrew", "aramaic", "greek"]') && entry.includes("{list.map((r) => card(r))}"));
ok("entry: lexicon gloss vs BSB renderings kept apart, real counts explained", entry.includes("Lexicon gloss") && entry.includes("BSB renders it") && entry.includes("every form, BSB interlinear"));
ok("entry: says when no Aramaic word has the gloss (none invented)", entry.includes("No Aramaic word in the lexicon has this gloss."));
ok("entry: opens the CANONICAL lexicon entry (same record as Study Tools / Deep Study)", entry.includes('pathname: "/study-tools/word/[strongs]"') && index.includes('pathname: "/study-tools/word/[strongs]"'));
ok("entry: pronunciation via the shared PronounceButton (labelled device voice; Aramaic refused there)", entry.includes("<PronounceButton text={r.lemma} language={r.language} />"));
ok("audio: the shared P2P Listen player only (no second player, no audio library)", [entry].every((f) => f.includes('import ListenPlayer from "@/components/listen/ListenPlayer"') && f.includes("useListenOwner(OWNER)") && f.includes("listen.play(")) && ![index, entry, occ].some((f) => /expo-av|expo-audio|new Audio\(/.test(f)));
ok("occurrences: actual word form per verse; Bible reader, Deep Study and Commentaries for each", occ.includes("i.forms.map(") && occ.includes("`/bible?book=${i.book}&chapter=${i.chapter}&v=${i.verse}`") && occ.includes('pathname: "/deep-study"') && occ.includes('study(i, "commentaries")'));
ok("occurrences: a missing form is said, not invented", occ.includes("The word form couldn't be loaded for this verse."));
ok("word page: 'Across the Bible' from the same record, links into the dictionary", word.includes("dictionaryRecord(String(p.strongs))") && word.includes('pathname: "/dictionary/term/[key]"') && word.includes('pathname: "/dictionary/occurrences/[strongs]"'));
ok("word page: related entries labelled honestly (not claimed as same root)", word.includes("does not by itself mean the words share a root"));
ok("RTL: Hebrew/Aramaic shown right-to-left, Greek left-to-right", [index, entry, occ].every((f) => f.includes('=== "greek" ? "ltr" : "rtl"')));
ok("reference articles: none shown until a licensed source is approved (stated)", index.includes("dictionary.referencePending") && !/type: "reference"/.test(index + entry));
ok("no AI teacher wording", ![index, entry, occ].some((f) => /\bAI\b|artificial intelligence|tutor|mentor/i.test(f)));

// ── Navigation ──
const layout = src("app/_layout.tsx"), hub = src("app/bible-study/index.tsx"), tools = src("app/study-tools/index.tsx");
ok("routes registered (own headers)", ['"dictionary/index"', '"dictionary/term/[key]"', '"dictionary/occurrences/[strongs]"'].every((r) => layout.includes(r)));
ok("reachable without a passage: Bible Study hub (under Deep Study) and Study Tools", /route: "\/deep-study" \},\s*\{ icon: "text-outline", title: t\("dictionary\.title"/.test(hub) && tools.includes('go: () => router.push("/dictionary" as any)'));
ok("normal Bible reader untouched by the dictionary", !src("app/bible/index.tsx").includes("dictionary"));

// ── Languages ──
const en = JSON.parse(src("locales/en.json")).dictionary;
const used = new Set([...[index, entry, occ, word, hub, tools, src("lib/dictionaryLabels.ts")].join("\n").matchAll(/t\("dictionary\.([A-Za-z0-9]+)"/g)].map((m) => m[1]));
ok("every dictionary string used in code exists in English", [...used].every((k) => en?.[k]), [...used].filter((k) => !en?.[k]).join(","));
const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
// Words genuinely spelled the same in that language (checked by hand), not untranslated text.
const SAME = { fr: ["occurrences"] };
for (const lang of ["de", "es", "fr", "pt", "ar", "hi", "sw"]) {
  const d = JSON.parse(src(`locales/${lang}.json`)).dictionary ?? {};
  const bad = Object.keys(en).filter((k) => !d[k] || (d[k] === en[k] && !(SAME[lang] ?? []).includes(k)) || ph(d[k]) !== ph(en[k]));
  ok(`${lang}: all ${Object.keys(en).length} strings, translated, placeholders kept`, !bad.length, bad.join(","));
}
ok("server index file present for the API", existsSync(path.resolve(root, "../api-server/data/dictionary-index.txt")));

console.log(`dictionary (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
