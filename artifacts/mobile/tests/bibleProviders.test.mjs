// Bible: a second provider (AO Lab Free Use Bible API) on the app side —
// the translation picker's search / language filter / source labels, the
// reader's right-to-left text and footnotes, and that nothing about saved
// references or Listen depends on the provider (codes are unique; Listen reads
// the displayed chapter). Server rules: api-server/tests/bibleProviders.test.mjs.
// Run: node tests/bibleProviders.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const anyModule = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? true : () => null) });
const mocks = { "@/lib/languageNames": { getLanguageName: (c) => ({ ar: "Arabic", de: "German", fr: "French", ja: "Japanese" }[c] ?? c) } };
const load = (rel) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => mocks[m] ?? anyModule, console, Map, Set });
  return mod.exports;
};

// Picker helpers
const P = load("components/bible/TranslationPicker.tsx");
const T = [
  { code: "KJV", name: "King James Version", language: "en", isDefault: true, textCopyAllowed: true, provider: "api.bible", providerName: "API.Bible", abbreviation: "KJV" },
  { code: "AO-eng_kjv", name: "King James Version", language: "en", isDefault: false, textCopyAllowed: true, provider: "helloao", providerName: "Free Use Bible API (AO Lab)", abbreviation: "KJV" },
  { code: "AMP", name: "Amplified Bible", language: "en", isDefault: false, textCopyAllowed: false, provider: "api.bible", abbreviation: "AMP" },
  { code: "LUT", name: "German Luther Bible 1912", language: "de", isDefault: true, textCopyAllowed: true },
  { code: "AO-fra_lsg", name: "Louis Segond 1910", language: "fr", isDefault: false, textCopyAllowed: false, provider: "helloao", abbreviation: "LSG" },
  { code: "AO-arb_vdv", name: "Van Dyck Bible", language: "ar", isDefault: false, textCopyAllowed: false, provider: "helloao", abbreviation: "VDV", textDirection: "rtl" },
];
const names = (l) => l.map((t) => t.code).join(",");
ok("search by name", names(P.filterTranslations(T, "luther", null)) === "LUT");
ok("search by abbreviation", names(P.filterTranslations(T, "lsg", null)) === "AO-fra_lsg");
ok("search by language name", names(P.filterTranslations(T, "arabic", null)) === "AO-arb_vdv");
ok("search ignores accents and case", names(P.filterTranslations([{ code: "X", name: "Biblia Livre Para Todos — Português", language: "pt", isDefault: false, textCopyAllowed: false }], "PORTUGUES", null)) === "X");
ok("filter by language", names(P.filterTranslations(T, "", "en")) === "KJV,AO-eng_kjv,AMP");
ok("search + language together", names(P.filterTranslations(T, "king", "en")) === "KJV,AO-eng_kjv");
const shared = P.sharedAcrossProviders(T);
ok("the same translation from two sources is detected (rows then say where each comes from)", shared.has("en:kjv") && !shared.has("en:amp") && shared.size === 1);

// Picker source checks
const picker = src("components/bible/TranslationPicker.tsx");
ok("picker: search box + language chips only when there are many translations", picker.includes("const many = translations.length > 8;") && picker.includes('accessibilityLabel="Search translations"') && picker.includes('accessibilityLabel="Filter by language"'));
ok("picker: source shown for AO Lab rows and for duplicates; preview marked", picker.includes('|| t.provider === "helloao"') && picker.includes("preview, licence not yet approved"));
ok("picker: the chosen translation's credit line is shown", picker.includes("{selected && t.attribution ?"));
ok("picker: choosing only calls onSelect (never changes the app language)", picker.includes("onPress={() => onSelect(t.code)}") && !/i18n|setAppLanguage|changeLanguage/.test(picker));

// Reader
const reader = src("app/bible/index.tsx");
ok("reader: right-to-left scripts read right to left (from the translation, or its language for older servers)", reader.includes('(translation?.textDirection ?? data?.translation.textDirection) === "rtl" || ["ar", "fa", "ur", "he"].includes(translation?.language ?? "")') && reader.includes("rtl && styles.rtl") && reader.includes('rtl: { writingDirection: "rtl", textAlign: "right" }'));
ok("reader: the source's footnotes are listed under the chapter", reader.includes("data.footnotes?.length ?") && reader.includes('accessibilityLabel="Footnotes"'));
ok("reader: one reader for every provider (no provider branches in the screen)", !/helloao|AO Lab/.test(reader));
const api = src("lib/bibleReaderApi.ts");
ok("client model: provider fields optional (older servers keep working); footnotes optional", /provider\?: "api\.bible" \| "helloao"/.test(api) && api.includes("footnotes?: { verse: number | null; caller: string | null; text: string }[];"));
// Saved references, highlights, notes and Listen key on the translation CODE (unique across providers).
ok("saved references keep their own translation code", src("lib/listen/bibleContent.ts").includes("bible:${d.translation.code}:${d.book.code}.${d.chapter}") && api.includes("translationCode: string; bookCode: string; chapter: number; startVerse: number; endVerse: number"));

// Curated library: coverage, language names, New Testament-only book list
const T2 = [...T, { code: "AO-tsn_bib", name: "Open Tswana Living NT", language: "tn", languageName: "Tswana", isDefault: false, textCopyAllowed: false, provider: "helloao", abbreviation: "TSN", coverage: "nt", coverageLabel: "New Testament only" }];
ok("search finds a language the app has no name for, by the server's name", names(P.filterTranslations(T2, "tswana", null)) === "AO-tsn_bib");
const picker2 = src("components/bible/TranslationPicker.tsx");
ok("picker: anything that isn't a complete Bible says so (e.g. New Testament only)", picker2.includes('{t.coverage && t.coverage !== "bible" && t.coverageLabel ? <Text style={styles.coverage}>{t.coverageLabel}</Text> : null}'));
ok("picker: language headings/chips use the server's language names", picker2.includes("<Text style={styles.group}>{nameOf(lang)}</Text>") && picker2.includes("label={nameOf(l)}"));
const books = src("components/bible/BookChapterPicker.tsx");
ok("book picker: a New Testament-only translation lists only New Testament books (no OT tab)",
  books.includes("const inTranslation = CANON.filter((b) => testaments.includes(b.testament));") && books.includes("!query && testaments.length > 1 &&")
  && reader.includes('testaments={translation?.coverage === "nt" ? ["NT"] : translation?.coverage === "ot" ? ["OT"] : undefined}'));

console.log(`bibleProviders (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
