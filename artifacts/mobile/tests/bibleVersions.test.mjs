// Bible Versions & Languages screens, the translation-change scroll fix, and Kingdom Stories
// "Share Your Response" per Comprehensive Check question (owner request 2026-11-09).
//   • versions grouped by language with real counts; search; Audio Available = licensed recorded audio only;
//   • languages: native names (English underneath), counts, Suggested from what the person uses, A–Z index;
//   • choosing a version goes Back; the reader applies it when in front again (no pop-up closing over a
//     re-render), at the same book and chapter, at the selected verses or the verse at the top;
//   • the chapter's blocks are rebuilt only when the NEW text arrives (no scroll target used up on old text);
//   • sharing: one question + its submitted written answer exactly, story + attribution, only on tap, no API.
// Run: node tests/bibleVersions.test.mjs
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
const load = (f, mocks = {}) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Map, Set, Intl, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};
const V = load("lib/bibleVersions.ts", {
  "@/lib/languageNames": { getLanguageName: (c) => ({ de: "German", es: "Spanish", om: "om" })[c] ?? c },
  "@/lib/i18n": { LANGUAGE_DISPLAY: { en: { label: "English", native: "English" }, de: { label: "German", native: "Deutsch" }, es: { label: "Spanish", native: "Español" } } },
  // The real language registry (names, codes and aliases for languages outside the app's own list).
  "@/lib/languageRegistry": load("lib/languageRegistry.ts", { "@/lib/countryNames": load("lib/countryNames.ts") }),
});
const T = (code, language, name, extra = {}) => ({ code, language, name, abbreviation: code.toUpperCase(), isDefault: false, textCopyAllowed: true, ...extra });
const list = [T("kjv", "en", "King James Version"), T("bsb", "en", "Berean Standard Bible"), T("web", "en", "World English Bible"),
  T("lut", "de", "Lutherbibel"), T("rvr", "es", "Reina-Valera", { recordedAudio: true }), T("orm", "om", "Macaafa Qulqulluu", { languageName: "Oromo" })];

// Languages
const langs = V.bibleLanguages(list);
const by = Object.fromEntries(langs.map((l) => [l.code, l]));
ok("languages: one per language with real counts", langs.length === 4 && by.en.count === 3 && by.de.count === 1);
ok("languages: native names, English underneath when different", by.de.native === "Deutsch" && by.de.english === "German" && by.en.english === null && by.es.native === "Español");
ok("languages: a language the app doesn't know uses the server's name", by.om.english === "Oromo" || by.om.native === "Oromo");
ok("languages: audio only where a version has licensed recorded audio", by.es.audio === true && by.en.audio === false && by.de.audio === false);
ok("languages: search by native name, English name or code", V.filterLanguages(langs, "deut")[0]?.code === "de" && V.filterLanguages(langs, "german")[0]?.code === "de" && V.filterLanguages(langs, "es")[0]?.code === "es");
const sug = V.suggestedLanguages(langs, { current: "de", contentLanguage: "es", appLanguage: "fr" });
ok("suggested: what's being read, content language, then English — only languages that have versions", sug.map((l) => l.code).join() === "de,es,en");
ok("A–Z index letters (accents folded; other scripts under #)", V.indexLetter("Español") === "E" && V.indexLetter("Ελληνικά") === "#" && V.indexLetter("Ńdebele") === "N");

// Versions
const all = V.versionSections(list, { current: "lut" });
ok("versions: grouped by language, the one being read first, counts per group", all[0].language.code === "de" && all.find((g) => g.language.code === "en").translations.length === 3);
ok("versions: search across name, abbreviation and language", V.versionSections(list, { query: "berean" }).flatMap((g) => g.translations).map((t) => t.code).join() === "bsb"
  && V.versionSections(list, { query: "deutsch" })[0]?.translations[0].code === "lut");
ok("versions: a chosen language shows only its versions", V.versionSections(list, { language: "en" }).length === 1);
ok("versions: Audio Available = recorded audio only (never invented)", V.versionSections(list, { audioOnly: true }).flatMap((g) => g.translations).map((t) => t.code).join() === "rvr"
  && V.versionSections(list.map((t) => ({ ...t, recordedAudio: false })), { audioOnly: true }).length === 0);
V.chooseTranslation("bsb");
ok("hand-off: the chosen version is taken once", V.takeChosenTranslation() === "bsb" && V.takeChosenTranslation() === null);

// Screens
const versions = src("app/bible/versions.tsx"), languages = src("app/bible/languages.tsx"), reader = src("app/bible/index.tsx");
ok("versions screen: header + Back, search, All / Audio Available, language chooser, sections, tile, speaker only for recorded audio, chevron",
  versions.includes(">Bible Versions<") && versions.includes('placeholder="Search Versions"') && versions.includes('label="Audio Available"') && versions.includes('pathname: "/bible/languages"')
  && versions.includes("<SectionList") && versions.includes("{t.recordedAudio ? <Ionicons name=\"volume-high-outline\"") && versions.includes('name="chevron-forward"'));
ok("versions screen: honest empty state when no recorded audio exists", versions.includes("No Bible version available to P2P Global has licensed recorded audio yet."));
ok("languages screen: header, search, Suggested / All, A–Z index, selected indicator, native + English", languages.includes(">Bible Languages<") && languages.includes('{ value: "suggested", label: "Suggested" }')
  && languages.includes("scrollToLocation(") && languages.includes('name="checkmark-circle"') && languages.includes("{l.native}") && languages.includes("l.english"));
ok("data: only the server's licensed translations (no hard-coded lists or counts)", versions.includes("getTranslations()") && languages.includes("getTranslations()") && !/\b(KJV|ASV|BSB|CEV|AMP)\b/.test(versions + languages));
ok("API: recorded audio flag is the licence rule (never assumed)", readFileSync(path.join(root, "../api-server/src/lib/bibleReader.ts"), "utf8").includes("recordedAudio: canPlayRecordedAudio(r),"));

// Reader: the scroll fix
ok("reader: the version screen replaces the pop-up picker", reader.includes('pathname: "/bible/versions"') && !reader.includes("<TranslationPicker"));
ok("reader: the choice is applied when the reader is in front again", /useFocusEffect\(useCallback\(\(\) => \{\s*const chosen = takeChosenTranslation\(\);/.test(reader));
ok("reader: same book and chapter, at the selected verses or the verse at the top", reader.includes("v: sel.start, ve: sel.end") && reader.includes("at: topVerse()"));
ok("reader: blocks rebuilt and the scroll target set only when the NEW text arrives", /pendingScroll\.current = loc\.v \?\? loc\.at \?\? null;\r?\n\s*setRenderKey\(\(n\) => n \+ 1\);\r?\n\s*setData\(ch\);/.test(reader)
  && !reader.includes("useEffect(() => { pendingScroll.current = loc?.v ?? null; setRenderKey((n) => n + 1); }, [loc]);"));
ok("reader: the scroll offset is tracked on both reading views", (reader.match(/onScroll=\{\(e\) => \{ scrollY\.current = e\.nativeEvent\.contentOffset\.y; \}\}/g) ?? []).length === 2);

// Share Your Response
const S = load("lib/shareResponse.ts", { "react-native": { Platform: { OS: "ios" }, Share: { share: async () => ({ action: "sharedAction" }), dismissedAction: "dismissedAction" } }, "expo-clipboard": { setStringAsync: async () => {} } });
const answer = "  I learned that God was there\n\nbefore everything.  ";
const text = S.responseShareText({ storyTitle: "Creation: The Beginning of Everything", chapterLabel: "Chapter 1: Before Everything", question: "1. What words open the account?", response: answer });
ok("share: story, chapter, the one question, the answer exactly, attribution", text.startsWith("Creation: The Beginning of Everything — Kingdom Stories\nChapter 1: Before Everything\n\nQuestion:\n1. What words open the account?")
  && text.includes("My response:\nI learned that God was there\n\nbefore everything.\n") && text.endsWith("Shared from P2P Global"));
ok("share: only a written, non-empty answer", S.shareableResponse(" ") === null && S.shareableResponse(null) === null && S.shareableResponse("Yes") === "Yes");
const card = src("app/lesson/[id].tsx"), chapter = src("app/kingdom-stories/chapter.tsx");
ok("share: on each check question, only after it is submitted (Kingdom Stories)", card.includes('{kind === "assignment" && shareContext ? (() => {') && card.indexOf("Share Your Response\" icon=\"share-outline\"") > card.indexOf("{submitted ? (")
  && chapter.includes("shareContext={{ storyTitle: story.title, chapterLabel: `Chapter ${ch.chapterNumber}: ${ch.title}` }}"));
// 2026-11-10: every Comprehensive Check — lesson checks and Family/Church checks too; never on reflections.
ok("share: lesson Comprehensive Checks too", card.includes("shareContext={{ storyTitle: content.title, source: COMPREHENSIVE_CHECK }}"));
const custom = src("app/learning/assignment/[assignmentId].tsx");
ok("share: Family Circle / Church Comprehensive Checks — the participant's own written attempts", custom.includes('label="Share Your Response"')
  && /shareResponse\(\{ storyTitle: assignment\.title, source: COMPREHENSIVE_CHECK, question: assignment\.instructions \|\| assignment\.title, response: a\.content \}\)/.test(custom));
ok("share: reflections never get it (private)", !/kind="reflection"[^>]*shareContext/.test(chapter) && card.includes('kind === "assignment" && shareContext'));
const lessonText = S.responseShareText({ storyTitle: "Grace", source: "Comprehensive Check", question: "What is grace?", response: "A gift." });
ok("share: a lesson check names the lesson and 'Comprehensive Check'", lessonText.startsWith("Grace — Comprehensive Check\n\nQuestion:\nWhat is grace?"));
ok("share: never calls the API or changes the submission (device share sheet only)", !/apiRequest|fetch\(|supabase/.test(src("lib/shareResponse.ts")) && src("lib/shareResponse.ts").includes("Share.share("));
ok("share: no evaluator feedback or status in what is shared", !/feedback|evaluation/i.test(S.responseShareText.toString()));

console.log(`bibleVersions (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
