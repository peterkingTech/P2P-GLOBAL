// Country flag system for language selection (owner brief 2026-11-13): ONE language registry
// (lib/languageRegistry.ts) with a representative flag per language, shared components (LanguageFlag,
// LanguageOption) and every language selector using them.
//   • every language the app knows (app languages, content languages, name tables, admin lists, voice
//     ISO codes, unused locale files, DB-only codes, dictionary keys) has one entry — IDs unchanged;
//   • no duplicate entries; every country is a real ISO code or deliberately null (with a review note);
//   • search by native name, English name, ID, ISO code and alias; one result per language;
//   • flags only in language-selection interfaces (never in Bible text or ordinary content).
// Run: node tests/languageFlags.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");
const cache = {};
function load(f) {
  if (cache[f]) return cache[f];
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, resolveJsonModule: true } }).outputText;
  const mod = { exports: {} };
  const req = (n) => {
    if (n === "@/lib/countryNames") return load("lib/countryNames.ts");
    if (n === "@/lib/languageRegistry") return load("lib/languageRegistry.ts");
    if (n === "@/locales/en.json") return JSON.parse(src("locales/en.json"));
    if (n === "i18next") return { __esModule: true, default: { use() { return this; }, init() {}, hasResourceBundle: () => false, addResourceBundle() {}, changeLanguage() {} } };
    if (n === "react-i18next") return { initReactI18next: {} };
    throw new Error(`require ${n} in ${f}`);
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, Intl, Math, JSON, String, Number, Object, Array, Map, Set, Error, Promise });
  return (cache[f] = mod.exports);
}
const R = load("lib/languageRegistry.ts");
const I = load("lib/i18n.ts");
const flagOf = (cc) => String.fromCodePoint(...[...cc].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));

// ── Coverage: every language the app knows ──
const appLangs = ["en", "de", "es", "fr", "pt", "it", "nl", "pl", "ro", "el", "ru", "uk", "tr", "ar", "he", "fa", "hi", "bn", "ur", "ta", "te", "zh", "zh-TW", "ja", "ko", "th", "vi", "id", "ms", "sw", "ha", "yo", "ig", "tl", "zu", "tw"];
ok("app language IDs unchanged (same 36, same order)", JSON.stringify([...I.SUPPORTED_LANGUAGES]) === JSON.stringify(appLangs));
ok("old Bible-study list kept unchanged (reference only)", JSON.stringify([...I.BIBLE_STUDY_LANGUAGES]) === JSON.stringify(["en", "de", "es", "fr", "pt", "ar", "hi", "sw"]));
// Owner decision 2026-11-14: Content Language = the same languages as App Language; the Bible keeps its own choice.
const settingsSrc = src("app/settings/language.tsx");
ok("Settings: Content Language offers exactly the app languages (same list, same IDs)", settingsSrc.includes("const CONTENT_LANGUAGES = LANGUAGES;") && !settingsSrc.includes("BIBLE_STUDY_LANGUAGES") && settingsSrc.includes('(langPickerOpen === "app" ? LANGUAGES : CONTENT_LANGUAGES)'));
const mig = readFileSync(path.resolve(root, "../../migrations/246_content_language_any_app_language.sql"), "utf8");
ok("migration 246 removes only the Bible-translation trigger (the language FK stays)", mig.includes("DROP TRIGGER IF EXISTS p2p_validate_content_language_trigger ON public.p2p_profiles;") && mig.includes("DROP FUNCTION IF EXISTS public.p2p_validate_content_language();") && !/DROP CONSTRAINT|DELETE|UPDATE p2p_profiles SET/i.test(mig.replace(/^--.*$/gm, "")));
ok("the Bible never depends on the content language (only a suggestion order in Bible Languages)", !/contentLanguage/.test(src("app/bible/index.tsx")) && /prefs.contentLanguage/.test(src("lib/bibleVersions.ts")));
const nameTable = Object.keys(load("lib/languageNames.ts").LANGUAGE_NAMES);
const voiceIso3 = [...src("lib/listen/voices.ts").match(/const ISO3[^{]*\{([\s\S]*?)\};/)[1].matchAll(/(\w+): "(\w+)"/g)].flatMap((m) => [m[1], m[2]]);
const adminCodes = [...src("app/admin/translation-review.tsx").match(/const LANG_NAMES[^{]*\{([\s\S]*?)\};/)[1].matchAll(/(\w+): "/g)].map((m) => m[1]);
const intakeCodes = [...src("app/(auth)/intake.tsx").match(/const FALLBACK_LANGUAGES[\s\S]*?\];/)[0].matchAll(/code: "([\w-]+)"/g)].map((m) => m[1]);
const unusedLocales = ["af", "da", "no", "pa", "sv"].filter((c) => existsSync(path.join(root, `locales/${c}.json`)));
const dbOnly = ["am", "cs", "mr", "pcm"];
const dictionary = ["hebrew", "aramaic", "greek"];
// Every language the curated Bible library can send (api-server helloaoRegistry.ts "lang" + "isoLanguage").
const reg = readFileSync(path.resolve(root, "../api-server/src/lib/bibleProviders/helloaoRegistry.ts"), "utf8");
const bibleLib = [...new Set([...reg.matchAll(/"(?:lang|isoLanguage)": "([a-zA-Z-]+)"/g)].map((x) => x[1]))];
const brief = ["ig", "yo", "ha", "tw", "ee", "gaa", "wo", "am", "om", "so", "rw", "rn", "zu", "xh", "sn", "lg", "ln", "ny", "mg", "sw"];
const everyCode = [...new Set([...appLangs, ...nameTable, ...voiceIso3, ...adminCodes, ...intakeCodes, ...unusedLocales, ...dbOnly, ...dictionary, ...brief, ...bibleLib])];
const missing = everyCode.filter((c) => !R.languageEntry(c));
ok(`every language code the app uses has a registry entry (${everyCode.length} codes)`, !missing.length, missing.join(","));
ok(`every curated Bible library language (${bibleLib.length} codes) has an entry`, bibleLib.length > 40 && bibleLib.every((c) => R.languageEntry(c)), bibleLib.filter((c) => !R.languageEntry(c)).join(","));
ok("unused locale files and DB-only languages are covered too", unusedLocales.length === 5 && [...unusedLocales, ...dbOnly].every((c) => R.languageEntry(c)));

// ── Integrity ──
const ids = R.LANGUAGES.map((e) => e.id);
ok("no duplicate entries (one per language)", new Set(ids).size === ids.length && new Set(R.LANGUAGES.map((e) => e.english)).size === R.LANGUAGES.length);
ok("each entry's id is the app's existing code (lookup by id returns itself)", R.LANGUAGES.every((e) => R.languageEntry(e.id) === e));
ok("every country is a real ISO 3166 code with a flag — or deliberately null, with a review note", R.LANGUAGES.every((e) => (e.country ? /^[A-Z]{2}$/.test(e.country) && R.languageFlag(e.id) === flagOf(e.country) : R.REVIEW_NOTES[e.id])));
ok("every mapping marked for review explains why", R.LANGUAGES.filter((e) => e.review).every((e) => R.REVIEW_NOTES[e.id]?.length > 30) && Object.keys(R.REVIEW_NOTES).every((k) => R.languageEntry(k)?.review));
ok("native and English names for every entry; RTL marked for Arabic, Hebrew, Persian, Urdu, Aramaic", R.LANGUAGES.every((e) => e.native && e.english) && ["ar", "he", "fa", "ur", "arc"].every((c) => R.languageEntry(c).rtl) && !R.languageEntry("en").rtl);
ok("the app's LANGUAGE_DISPLAY flags come from the registry (one source)", appLangs.every((c) => I.LANGUAGE_DISPLAY[c].flag === R.languageFlag(c)) && !/flag: "/.test(src("lib/i18n.ts")));

// ── The brief's representative mappings ──
const expect = { ig: "NG", yo: "NG", ha: "NG", tw: "GH", ee: "GH", gaa: "GH", wo: "SN", am: "ET", om: "ET", so: "SO", rw: "RW", rn: "BI", zu: "ZA", xh: "ZA", sn: "ZW", lg: "UG", ln: "CD", ny: "MW", mg: "MG", sw: "KE",
  en: "GB", de: "DE", fr: "FR", es: "ES", pt: "PT", it: "IT", nl: "NL", ar: "SA", he: "IL", el: "GR", ru: "RU", zh: "CN", ja: "JP", ko: "KR", hi: "IN", bn: "BD" };
const wrong = Object.entries(expect).filter(([c, cc]) => R.languageEntry(c).country !== cc).map(([c]) => c);
ok("the brief's mappings (Igbo/Yoruba/Hausa 🇳🇬, Twi/Ewe/Ga 🇬🇭, English 🇬🇧, Portuguese 🇵🇹 …)", !wrong.length, wrong.join(","));
ok("Aramaic: no representative country → no flag (none invented)", R.languageEntry("aramaic").country === null && R.languageFlag("aramaic") === null);

// ── IDs from other systems resolve to the same entry (never a second one) ──
ok("ISO 639-3 / 639-2B codes", R.languageEntry("deu") === R.languageEntry("de") && R.languageEntry("ger") === R.languageEntry("de") && R.languageEntry("swh") === R.languageEntry("sw") && R.languageEntry("ibo") === R.languageEntry("ig"));
ok("device voice tags (region dropped, case and _ ignored)", R.languageEntry("en-US") === R.languageEntry("en") && R.languageEntry("EN_gb") === R.languageEntry("en") && R.languageEntry("pt-BR") === R.languageEntry("pt"));
ok("Traditional Chinese stays its own entry", R.languageEntry("zh_TW").id === "zh-TW" && R.languageEntry("zh-Hant").id === "zh-TW" && R.languageEntry("zh-CN").id === "zh");
ok("dictionary keys", R.languageEntry("hebrew").id === "he" && R.languageEntry("greek").id === "el" && R.languageEntry("aramaic").id === "arc");
ok("unknown codes → no entry and no flag (callers keep their own name)", R.languageEntry("xx") === null && R.languageFlag("qqq") === null && R.languageFlag(null) === null);

// ── Search ──
const m = (id, q) => R.languageMatches(id, q);
ok("search: native name (Deutsch, 日本語, Yorùbá without accents)", m("de", "Deutsch") && m("ja", "日本語") && m("yo", "yoruba"));
ok("search: English name (German, Persian)", m("de", "german") && m("fa", "Persian"));
ok("search: ID and ISO codes (de, deu, swh)", m("de", "de") && m("de", "deu") && m("sw", "swh"));
ok("search: aliases (Farsi, Tagalog, Akan, Mandarin, Chewa)", m("fa", "farsi") && m("tl", "Tagalog") && m("tw", "akan") && m("zh", "mandarin") && m("ny", "chewa"));
ok("search: no false match", !m("de", "French") && !m("en", "Twi"));

// ── Components ──
const flag = src("components/language/LanguageFlag.tsx"), opt = src("components/language/LanguageOption.tsx");
ok("LanguageFlag: registry flag; decorative (hidden from screen readers); same width when none", flag.includes("languageFlag(language)") && flag.includes("accessibilityElementsHidden") && flag.includes('importantForAccessibility="no-hide-descendants"') && flag.includes("width: size * 1.25"));
ok("LanguageFlag: web draws flags with Noto Color Emoji (Windows has none); phones use native emoji", flag.includes("family=Noto+Color+Emoji") && flag.includes('Platform.OS !== "web"'));
ok("LanguageOption: flag + native name (+ English), own writing direction, theme colours, accessible", opt.includes("<LanguageFlag language={language}") && opt.includes('writingDirection: e?.rtl ? "rtl" : "ltr"') && opt.includes("colors.text") && opt.includes("accessibilityState={{ selected: !!selected }}"));
ok("FilterChip: optional leading element (used for flags)", src("components/ui/Chip.tsx").includes("{leading}"));

// ── Every selector ──
const uses = (f, ...needles) => needles.every((n) => src(f).includes(n));
ok("onboarding: trigger and every option", uses("app/(auth)/onboarding.tsx", "<LanguageFlag language={selectedLang.code}", "<LanguageFlag language={lang.code}"));
ok("Settings: current values + searchable list of LanguageOption rows", uses("app/settings/language.tsx", "<LanguageFlag language={profile?.appLanguage", "<LanguageFlag language={profile?.contentLanguage", "<LanguageOption", "languageMatches(l.code, query)", 't("languages.search"'));
ok("Bible Languages: flag per language; search via registry aliases; translated placeholder", uses("app/bible/languages.tsx", "<LanguageFlag language={l.code}", 't("languages.search"') && uses("lib/bibleVersions.ts", "languageMatches(l.code, query)", "languageMatches(t.language,"));
ok("Bible Versions: language button and each language section", uses("app/bible/versions.tsx", "<LanguageFlag language={lang.code}", "<LanguageFlag language={section.language.code}"));
ok("Translation picker: language chips and group headers; search via aliases", uses("components/bible/TranslationPicker.tsx", "leading={<LanguageFlag language={l}", "<LanguageFlag language={lang}", "languageMatches(t.language, query)"));
ok("Compare sheet: each translation's language", uses("components/bible/CompareSheet.tsx", "<LanguageFlag language={t.language}"));
ok("P2P Listen: the voice language header and other-language voices (voice logic unchanged)", uses("components/listen/ListenPlayer.tsx", "<LanguageFlag language={content.language}", "<LanguageFlag language={v.language}", "listen.setVoice(v.identifier)"));
ok("Dictionary and Lexicon filters (Aramaic chip without a flag)", uses("app/dictionary/index.tsx", "leading={k && languageFlag(k) ? <LanguageFlag") && uses("app/study-tools/lexicon.tsx", "leading={k && languageFlag(k) ? <LanguageFlag", "dictLanguageLabel(t, k)"));
ok("Intake: primary and other languages", (src("app/(auth)/intake.tsx").match(/<LanguageFlag language=\{l\.code\}/g) || []).length === 2);
ok("Admin: translation coverage, target-language picker (registry, not the DB column) and review filter", uses("app/admin/translations.tsx", "<LanguageFlag language={lang.code}", "<LanguageFlag language={l.code}") && !src("app/admin/translations.tsx").includes("{l.flag_emoji}") && uses("app/admin/translation-review.tsx", "<LanguageFlag language={l}"));
ok("no flags in Scripture text or ordinary content", !["app/bible/index.tsx", "components/bible/ReadAlongText.tsx", "app/dictionary/term/[key].tsx", "app/deep-study/index.tsx"].filter((f) => existsSync(path.join(root, f))).some((f) => src(f).includes("LanguageFlag")));

// ── Localisation ──
const L36 = appLangs;
const bad = L36.filter((c) => { const j = JSON.parse(src(`locales/${c}.json`)).languages; return !j?.search || !j?.noMatch || (c !== "en" && j.search === "Search languages"); });
ok("new labels in the translation system — all 36 app languages", !bad.length, bad.join(","));

console.log(`languageFlags (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
