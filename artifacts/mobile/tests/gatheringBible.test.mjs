// Family Circle / Church Gathering Bible (Phase 2).
//   lib/gatheringBible.ts — real code, Bible API mocked (synthetic data).
//   components/family/ScripturePanel.tsx — rendered with mocks + source checks.
// Guarantees: licensed chapter API only (one request per chapter), whole
// chapter is the main action, verse ranges checked against the real chapter,
// a member's reading translation is personal and never changes the shared
// passage, substitutions are never silent.
// Run: node tests/gatheringBible.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = { View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"), TextInput: host("TextInput"),
  Modal: host("Modal"), ActivityIndicator: host("ActivityIndicator"), StyleSheet: { create: (s) => s }, Platform: { select: (o) => o.default ?? o.ios } };
const api = { calls: [], next: null };
class BibleApiError extends Error { constructor(m, s) { super(m); this.status = s; } }
const bibleReaderApi = {
  BibleApiError, getChapter: (b, c, t) => { api.calls.push(`${t}:${b}:${c}`); return api.next(b, c, t); },
  getTranslations: async () => ({ translations: TRANSLATIONS }), bibleRoute: (x) => x,
  bookByName: (n) => ({ John: { code: "JHN", name: "John", chapters: 21 }, Psalms: { code: "PSA", name: "Psalms", chapters: 150 } })[n],
  bookByCode: () => undefined,
};
const TRANSLATIONS = [
  { code: "KJV", name: "King James Version", language: "en", isDefault: true, textCopyAllowed: true },
  { code: "JND", name: "Bible J.N. Darby", language: "fr", isDefault: true, textCopyAllowed: true },
];
const env = { onSelect: [] };
const mocks = {
  react: { ...React, useState: (init) => [typeof init === "function" ? init() : init, () => {}], useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }) },
  "react-native": RN,
  "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } },
  "@/lib/bibleReaderApi": bibleReaderApi,
  "@/lib/familyApi": {},
  "expo-router": { router: { push: () => {} } },
  "@/hooks/useLayout": { useSheetWidth: () => ({}) },
  "@/lib/bibleReadingPrefs": { useBibleReadingPrefs: () => ({ prefs: { fontSize: 19 }, update: () => {} }), DEFAULT_PREFS: { fontSize: 19 }, FONT_MIN: 15, FONT_MAX: 30 },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} }; cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Promise, Math, JSON, Number, String, Array, Object, Map, Error,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));

// ── Logic ───────────────────────────────────────────────────────────────────
const G = load("lib/gatheringBible.ts");
const chapterOf = (n) => ({ verses: Array.from({ length: n }, (_, i) => ({ verse: i + 1, text: `v${i + 1}`, paragraph: 0, poetry: false })), translation: { code: "KJV", name: "King James Version", textCopyAllowed: true }, copyright: null });
api.next = async () => chapterOf(36);
const [a, b] = await Promise.all([G.cachedChapter("JHN", 3, "KJV"), G.cachedChapter("JHN", 3, "KJV")]);
ok("one request per chapter + translation (picker and passage share it)", api.calls.length === 1 && a === b);
await G.cachedChapter("JHN", 3, "JND");
ok("another translation is its own request", api.calls.length === 2);
api.next = async () => { throw new BibleApiError("busy", 429); };
await G.cachedChapter("JHN", 4, "KJV").catch(() => {});
api.next = async () => chapterOf(54);
const retried = await G.cachedChapter("JHN", 4, "KJV");
ok("a failed request is retried next time (not cached)", retried.verses.length === 54 && api.calls.length === 4);

const r1 = G.checkVerseRange("16", "18", 36), r2 = G.checkVerseRange("16", "", 36), r3 = G.checkVerseRange("40", "41", 36), r4 = G.checkVerseRange("10", "5", 36), r5 = G.checkVerseRange("30", "99", 36), r6 = G.checkVerseRange("x", "2", 36);
ok("verse range: valid range kept", r1.ok && r1.start === 16 && r1.end === 18);
ok("verse range: single verse when the end is empty", r2.ok && r2.end === 16);
ok("verse range: beyond the chapter explained with its real length", !r3.ok && r3.error === "This chapter has 36 verses.");
ok("verse range: reversed and non-numbers refused", !r4.ok && /comes before/.test(r4.error) && !r6.ok);
ok("verse range: end clipped to the last verse", r5.ok && r5.end === 36);
ok("whole chapter = 1..verse count", JSON.stringify(G.fullChapterRange(36)) === '{"start":1,"end":36}');
ok("labels: whole chapter vs verses", G.passageLabel({ book: "John", chapter: 3, startVerse: 1, endVerse: 36 }, 36) === "John 3"
  && G.passageLabel({ book: "John", chapter: 3, startVerse: 16, endVerse: 18 }, 36) === "John 3:16-18" && G.passageLabel({ book: "John", chapter: 3, startVerse: 16, endVerse: 16 }, 36) === "John 3:16");

const own = G.readingTranslation("KJV", "JND", TRANSLATIONS), shared = G.readingTranslation("KJV", null, TRANSLATIONS),
  gone = G.readingTranslation("NIV", null, TRANSLATIONS), badPersonal = G.readingTranslation("KJV", "NIV", TRANSLATIONS);
ok("reading translation: a member's own choice is used and explained", own.code === "JND" && own.personal && /You're reading in JND\. The Guide shared KJV\./.test(own.note));
ok("reading translation: otherwise the Guide's", shared.code === "KJV" && !shared.personal && shared.note === null);
ok("reading translation: unavailable → licensed default, never silently", gone.code === "KJV" && /NIV isn't available — shown in KJV\./.test(gone.note));
ok("reading translation: an unlicensed personal choice is ignored", badPersonal.code === "KJV");

// ── Panel ───────────────────────────────────────────────────────────────────
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
  if (typeof node.type === "symbol") return expand(node.props?.children);
  const children = node.props?.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === RN.Modal && !node.props.visible) return out;
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const labels = (t) => findAll(t, (n) => n.type === RN.TouchableOpacity).map((b) => b.props.accessibilityLabel).filter(Boolean);
const Panel = load("components/family/ScripturePanel.tsx").default;
const passage = { book: "John", chapter: 3, startVerse: 1, endVerse: 36, translation: "KJV" };
const guide = labels(expand(React.createElement(Panel, { currentScripture: passage, isGuide: true, onSelect: (s) => env.onSelect.push(s) })));
ok("Guide: book and chapter buttons, whole chapter by default, share action", guide.includes("Book: John. Change book") && guide.includes("Chapter 3. Change chapter")
  && guide.includes("Whole chapter") && guide.includes("Choose verses") && guide.includes("Share full chapter with the Gathering"), guide.join(" | "));
ok("Guide: previous / next chapter", guide.includes("Previous chapter") && guide.includes("Next chapter"));
const member = labels(expand(React.createElement(Panel, { currentScripture: passage, isGuide: false, onSelect: () => {} })));
ok("member: no picker (can't change the shared passage)", !member.includes("Share full chapter with the Gathering") && !member.includes("Book: John. Change book"));
const myBible = labels(expand(React.createElement(Panel, { currentScripture: passage, isGuide: true, selectLabel: "Read", onSelect: () => {} })));
ok("My Bible: reads (never shares)", myBible.includes("Read full chapter") && !myBible.some((l) => /Gathering/.test(l)));

const sp = src("components/family/ScripturePanel.tsx");
ok("the member's translation is personal: kept on the device, never passed to onSelect",
  /AsyncStorage\.setItem\(READ_TRANSLATION_KEY, next\)/.test(sp) && /function chooseReadTranslation\(code: string\) \{[^}]*setReadCode\(next\);/.test(sp) && !/function chooseReadTranslation[\s\S]{0,300}onSelect\(/.test(sp));
ok("only members get 'Read in' (the Guide and My Bible's picker keep their own choice)", /const showReadIn = !!currentScripture && !isGuide && translations\.length > 1;/.test(sp)
  && /readingTranslation\(currentScripture\.translation, isGuide \? null : readCode, list, DEFAULT_LANGUAGE\)/.test(sp));
ok("chapter grid and Old/New Testament book list", /choose a chapter/.test(sp) && /"Old Testament" : "New Testament"/.test(sp));
ok("text size control (shared with the Bible reader's setting)", /accessibilityLabel="Larger text"/.test(sp) && /useBibleReadingPrefs\(\)/.test(sp));
ok("verse ranges validated before sharing", /const r = checkVerseRange\(startVerse, endVerse, pickerVerses\);\r?\n    if \(!r\.ok\) \{ setRangeError\(r\.error\); return; \}/.test(sp));
ok("only licensed text: chapter API through the shared cache, no stored Bible text", /cachedChapter\(/.test(sp) && !/AsyncStorage\.setItem\([^)]*verses/.test(sp));
const mb = src("components/family/MyBibleSheet.tsx");
ok("My Bible continues where you last read (device position shared with the reader)", /loadPosition\(\)\.then/.test(mb) && /savePosition\(\{ translation: p\.translation, book: b\.code, chapter: p\.chapter \}\)/.test(mb));

console.log(`gathering bible: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
