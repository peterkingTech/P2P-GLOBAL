// Bible Compare (Phase 3).
//   lib/bibleCompare.ts — real code (synthetic data).
//   components/bible/CompareView.tsx, CompareSheet.tsx — rendered with mocks.
//   app/bible/index.tsx — source checks for the reader integration.
// Guarantees: only licensed translations (the server's list) can be compared,
// at most four at once; every translation is fetched through the licensed
// chapter API and never stored; a missing verse or chapter is shown as
// missing — never filled from another translation; leaving compare keeps
// the reader on the verse being looked at.
// Run: node tests/bibleCompare.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buttonDouble } from "./helpers/buttonDouble.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = { View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"), Modal: host("Modal"),
  ActivityIndicator: host("ActivityIndicator"), StyleSheet: { create: (s) => s, hairlineWidth: 1 }, Platform: { OS: "ios" } };
const store = new Map();
const env = { state: null };
const mocks = {
  // The shared button system renders as a labelled tappable (tests/helpers/buttonDouble.mjs).
  "@/components/ui": buttonDouble(React, RN),
  react: { ...React, useState: (init) => [env.state && typeof init === "object" && init !== null && !Array.isArray(init) && Object.keys(init).length === 0 ? env.state : (typeof init === "function" ? init() : init), () => {}],
    useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }) },
  "react-native": RN,
  "@expo/vector-icons": { Ionicons: host("Ionicons") },
  "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } } },
  "@/contexts/ThemeContext": { useTheme: () => ({ colors: new Proxy({}, { get: () => "#000" }), resolvedMode: "light" }) },
  "@/lib/bibleReaderApi": { BibleApiError: class extends Error {}, SCRIPTURE_FONT: "Georgia", getChapter: async () => { throw new Error("not in test"); } },
  "@/lib/colorUtils": { withAlpha: () => "#0000" },
  "@/lib/languageNames": { getLanguageName: (c) => ({ fr: "French", de: "German" })[c] ?? c },
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Promise, Math, JSON, Number, String, Array, Object, Map, Set, Error,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
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
const textOf = (t) => findAll(t, (n) => n.type === RN.Text).map((x) => [].concat(x.props.children).flat(Infinity).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");

const L = [{ code: "KJV", name: "King James Version", language: "en", isDefault: true }, { code: "JND", name: "Bible J.N. Darby", language: "fr", isDefault: true },
  { code: "LUT", name: "German Luther Bible 1912", language: "de", isDefault: true }, { code: "RVR09", name: "Reina Valera 1909", language: "es", isDefault: true },
  { code: "BLT", name: "Biblia Livre", language: "pt", isDefault: true }];
const C = load("lib/bibleCompare.ts");
ok("compare: licensed only, unique, never the one being read, at most 3 more",
  JSON.stringify(C.sanitizeCompare("KJV", ["KJV", "NIV", "JND", "JND", "LUT", "RVR09", "BLT"], L)) === '["JND","LUT","RVR09"]' && C.MAX_TRANSLATIONS === 4);
ok("compare: junk stored value ignored", C.sanitizeCompare("KJV", "oops", L).length === 0);
C.saveCompare(["JND", "LUT"]);
ok("compare: remembered on this device only", JSON.parse(store.get("p2p.bible.compare.v1")).codes.join() === "JND,LUT");
const ch = (code, n, skip = []) => ({ verses: Array.from({ length: n }, (_, i) => i + 1).filter((v) => !skip.includes(v)).map((v) => ({ verse: v, text: `${code} ${v}`, paragraph: 0, poetry: false })), translation: { code, name: code } });
const rows = C.alignVerses(["KJV", "JND", "LUT"], { KJV: { status: "ok", chapter: ch("KJV", 3) }, JND: { status: "ok", chapter: ch("JND", 3, [2]) }, LUT: { status: "loading" } });
ok("compare: one row per verse, cells in the chosen order", rows.length === 3 && rows[0].cells.map((x) => x.code).join() === "KJV,JND,LUT" && rows[0].cells[0].text === "KJV 1");
ok("compare: a verse missing in a translation stays missing (never substituted)", rows[1].cells[1].text === null && rows[1].cells[1].state === "ok");
ok("compare: a translation still loading has no text yet", rows[0].cells[2].text === null && rows[0].cells[2].state === "loading");
ok("layout: side by side only when each column is comfortable", C.compareColumns(700, 2) === 2 && C.compareColumns(380, 2) === 1 && C.compareColumns(1000, 4) === 1 && C.compareColumns(1300, 4) === 4 && C.compareColumns(320, 1) === 1);

// ── CompareView ─────────────────────────────────────────────────────────────
const View = load("components/bible/CompareView.tsx").default;
const props = (o) => ({ bookCode: "JHN", chapter: 3, primary: ch("KJV", 2), others: ["JND"], translations: L, fontSize: 18, lineHeight: 30, verseNumbers: true, selected: { start: 2, end: 2 }, onTapVerse: () => {}, ...o });
env.state = { JND: { status: "ok", chapter: ch("JND", 2, [2]) } };
let t = expand(React.createElement(View, props({ width: 700 })));
ok("view: wide screen → translations side by side", /KJV 1/.test(textOf(t)) && /JND 1/.test(textOf(t)) && /Not in this translation/.test(textOf(t)) && /reading/.test(textOf(t)));
const rowsOn = findAll(t, (n) => n.type === RN.TouchableOpacity && /^Verse \d+ in 2 translations$/.test(n.props.accessibilityLabel ?? ""));
ok("view: every verse row selectable; the selected one marked", rowsOn.length === 2 && rowsOn[1].props.accessibilityState.selected === true && rowsOn[0].props.accessibilityState.selected === false);
t = expand(React.createElement(View, props({ width: 360 })));
ok("view: phone → stacked under each verse, labelled by translation", findAll(t, (n) => n.type === RN.Text && n.props.children === "JND").length >= 2);
env.state = { JND: { status: "error", message: "You're offline.", httpStatus: 0 } };
t = expand(React.createElement(View, props({ width: 700 })));
ok("view: a failing translation says so and offers retry; the others still show", /You're offline\./.test(textOf(t)) && /KJV 1/.test(textOf(t))
  && !!findAll(t, (n) => n.type === RN.TouchableOpacity && n.props.accessibilityLabel === "Try loading JND again").length);
env.state = { JND: { status: "error", message: "Not available in this translation.", httpStatus: 404 } };
t = expand(React.createElement(View, props({ width: 700 })));
ok("view: not in this translation → no pointless retry", /Not available in this translation\./.test(textOf(t)) && !findAll(t, (n) => n.props?.accessibilityLabel === "Try loading JND again").length);
env.state = null;

// ── CompareSheet ────────────────────────────────────────────────────────────
const Sheet = load("components/bible/CompareSheet.tsx").default;
t = expand(React.createElement(Sheet, { visible: true, onClose: () => {}, translations: L, primary: "KJV", selected: ["JND", "LUT", "RVR09"], onApply: () => {} }));
const boxes = findAll(t, (n) => n.type === RN.TouchableOpacity && n.props.accessibilityRole === "checkbox");
ok("sheet: lists the other licensed translations, the 4th is disabled when 3 are chosen", boxes.length === 4 && boxes.find((b) => /BLT/.test(b.props.accessibilityLabel)).props.disabled === true);
ok("sheet: stop comparing offered", !!findAll(t, (n) => n.props?.accessibilityLabel === "Stop comparing").length);

// ── Reader integration ──────────────────────────────────────────────────────
const reader = src("app/bible/index.tsx"), view = src("components/bible/CompareView.tsx");
ok("reader: compare button and menu entry", /accessibilityLabel=\{compare\.length \? `Comparing \$\{compare\.length \+ 1\} translations\. Change` : "Compare translations"\}/.test(reader) && /label=\{compare\.length \? "Compare translations \(on\)" : "Compare translations"\}/.test(reader));
ok("reader: back to single reading stays on the verse being looked at", /if \(!codes\.length && loc && sel\) setLoc\(\{ \.\.\.loc, v: sel\.start, ve: sel\.end \}\);/.test(reader));
ok("reader: tapping a verse in compare uses the normal selection (highlight / note / save)", /selected=\{sel\} onTapVerse=\{tapVerse\}/.test(reader));
ok("reader: same previous/next chapter controls in compare", (reader.match(/\{footerEl\}/g) ?? []).length === 2);
ok("licensed text only: each translation through the chapter API, nothing stored", /getChapter\(bookCode, chapter, code, ac\.signal\)/.test(view) && !/AsyncStorage/.test(view));
ok("primary chapter reused (no second request for it)", /primary: BibleChapter;\s+\/\/ already loaded by the reader/.test(view) && /\[primary\.translation\.code\]: \{ status: "ok", chapter: primary \}/.test(view));

console.log(`bible compare: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
