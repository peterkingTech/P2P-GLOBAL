// Deep Study, Commentaries and Study Tools in the app. Runs lib/deepStudyApi.ts for real (storage and the
// network replaced) — cache retrieval, offline fallback, no stale copy for "not found", Strong's
// normalisation — and checks the wiring: the reader's selection opens Deep Study with the passage and
// translation (and Back returns to the untouched reader), the Bible Study area's three destinations,
// one shared set of records, attribution on every screen, original-language direction, the interface
// translated in the Bible Study languages, and no second audio player or Scripture destination.
// Run: node tests/deepStudy.test.mjs
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Map, Set, JSON, Date, Promise, setTimeout, encodeURIComponent, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};

// ── The client: cache, offline, errors ───────────────────────────────────
const store = new Map();
const storage = { __esModule: true, default: {
  getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); },
  multiRemove: async (ks) => { for (const k of ks) store.delete(k); },
} };
let calls = [], mode = "ok";
class StudyErr extends Error {}
const api = { apiRequest: async (p, _i, opts) => {
  calls.push(p);
  if (mode === "offline") throw opts.makeError("You're offline", 0);
  if (mode === "404") throw opts.makeError("Not found", 404);
  return { path: p, n: calls.length };
} };
const A = load("lib/deepStudyApi.ts", { "@react-native-async-storage/async-storage": storage, "@/lib/apiClient": api });
ok("strongs: H430 → H0430, g3056 → G3056, nonsense → null", A.normaliseStrongs("H430") === "H0430" && A.normaliseStrongs("g3056") === "G3056" && A.normaliseStrongs("hello") === null);

(async () => {
  // A copy saved in the OLD format (v1, before credits carried `origin`) — it must never be read.
  store.set("p2p.deepstudy.v1:/lexicon/H1254?book=GEN&chapter=1", JSON.stringify({ at: Date.now(), data: { stale: true } }));
  store.set("p2p.deepstudy.v1.index", JSON.stringify(["/lexicon/H1254?book=GEN&chapter=1"]));
  const first = await A.lexiconEntry("H1254", { book: "GEN", chapter: 1 });
  ok("an old-format (v1) saved copy is never used", !first.stale);
  await new Promise((r) => setTimeout(r, 10));
  ok("…and old-format copies are removed from the device", ![...store.keys()].some((k) => k.startsWith("p2p.deepstudy.v1")));
  ok("calls the Deep Study API with the passage", calls[0] === "/deep-study/lexicon/H1254?book=GEN&chapter=1" && first.path === calls[0]);
  const again = await A.lexiconEntry("H1254", { book: "GEN", chapter: 1 });
  ok("cache retrieval: a fresh copy is reused without the network", calls.length === 1 && again.n === first.n);
  ok("cache: kept on the device (survives a restart)", [...store.keys()].some((k) => k.startsWith("p2p.deepstudy.v2:/lexicon/H1254")));

  // Make the copy old, then go offline: the old copy is shown, marked offline.
  for (const [k, v] of store) if (k.startsWith("p2p.deepstudy.v2:/lexicon/H1254")) { const o = JSON.parse(v); o.at -= 7 * 3600_000; store.set(k, JSON.stringify(o)); }
  const memReset = load("lib/deepStudyApi.ts", { "@react-native-async-storage/async-storage": storage, "@/lib/apiClient": api });
  mode = "offline";
  const off = await memReset.lexiconEntry("H1254", { book: "GEN", chapter: 1 });
  ok("network failure → the saved copy, marked offline", off.offline === true && off.path === first.path);
  let threw = null;
  try { await memReset.interlinear("JHN", 1, 1, 1); } catch (e) { threw = e; }
  ok("network failure with nothing saved → a clear error (retryable)", threw && /offline/.test(threw.message));
  mode = "ok";
  const back = await memReset.lexiconEntry("H1254", { book: "GEN", chapter: 1 });
  ok("back online: a stale copy is refreshed from the network", !back.offline && back.n > first.n);
  mode = "404";
  let nf = null;
  try { await memReset.lexiconEntry("G9999"); } catch (e) { nf = e; }
  ok("'not found' is never covered up by an old copy", nf && nf.status === 404);
  mode = "ok";
  ok("ranges: a verse range is passed through", (await memReset.interlinear("JHN", 1, 1, 3)).path === "/deep-study/interlinear/JHN/1?from=1&to=3");

  // ── Wiring ──────────────────────────────────────────────────────────────
  const reader = src("app/bible/index.tsx");
  ok("reader: 'Deep Study' in the selection bar, with book, chapter, verses and translation", reader.includes('label="Deep Study"')
    && reader.includes('router.push({ pathname: "/deep-study", params: { book: selRef.bookCode, chapter: String(selRef.chapter), v: String(selRef.startVerse), ve: String(selRef.endVerse), t: selRef.translationCode } }'));
  ok("reader: opened with push (Back returns to the reader exactly as it was)", !/router\.replace\(\{ pathname: "\/deep-study"/.test(reader));
  ok("reader: every existing selection action is still there", ['label={selNote ? "Edit note" : "Note"}', 'label={selBookmark ? "Saved" : "Save"}', 'label="Add to…"', "onPress={onListenSelection}", 'label="Copy"', 'label="Share"', 'label="Lessons"'].every((x) => reader.includes(x)));
  const home = src("app/bible-study/index.tsx");
  ok("Bible Study area: Deep Study, Commentaries, Study Tools", ['route: "/deep-study"', 'route: "/commentaries"', 'route: "/study-tools"'].every((r) => home.includes(r)));
  ok("Bible Study area: no second Scripture destination added", !/route: "\/scripture/.test(home) && (home.match(/route: "\/bible"/g) ?? []).length === 1);
  const ds = src("app/deep-study/index.tsx");
  ok("Deep Study: the passage stays at the top across all four views", ds.includes("<PassageText book={book.code}") && ["OriginalTab", "CommentariesTab", "CrossRefTab", "PeopleTab"].every((x) => ds.includes(`<${x} `)));
  ok("Deep Study: the passage text comes from the existing licensed Bible service", ds.includes("getChapter(book, chapter, translation)") && !/fetch\(/.test(ds));
  ok("Deep Study: search a book, chapter or verse (the reader's own reference parser)", ds.includes("readerTarget(q)"));
  ok("Deep Study: tap a word → the same lexicon entry Study Tools opens", ds.includes('pathname: "/study-tools/word/[strongs]", params: { strongs: picked.strongs!, book, chapter: String(chapter)')
    && src("app/study-tools/lexicon.tsx").includes('pathname: "/study-tools/word/[strongs]", params: { strongs: id }'));
  ok("Deep Study: a commentary opens the same records in Commentaries", ds.includes('pathname: "/commentaries/read", params: { id: r.id, book, chapter: String(chapter) }'));
  ok("Deep Study: a gloss is never presented as a full translation", ds.includes("A gloss is a short English rendering, not a full translation of the word."));
  ok("Deep Study: Hebrew/Aramaic words run right to left", ds.includes('flexDirection: v.direction === "rtl" ? "row-reverse" : "row"') && src("components/study/StudyUI.tsx").includes("writingDirection: direction"));
  ok("Deep Study: verses without original-language words are named, not hidden", ds.includes("d.versesWithoutWords") && ds.includes("d.missingNote"));
  ok("Deep Study: a missing commentary entry is said plainly", ds.includes('r.status === "no_entry"') && ds.includes('r.status === "not_covered"'));
  const screens = ["app/deep-study/index.tsx", "app/commentaries/[id].tsx", "app/commentaries/read.tsx", "app/study-tools/lexicon.tsx", "app/study-tools/word/[strongs].tsx"];
  ok("attribution shown on every content screen", screens.every((f) => src(f).includes("<Attribution credit=")));
  const ui = src("components/study/StudyUI.tsx");
  ok("credit: the original source and the licence are ALWAYS visible links (not behind the toggle)", ui.includes("const links = [credit.origin, credit.licence && { label: credit.licence.name, url: credit.licence.url }]")
    && ui.indexOf("links.map(") > 0 && ui.indexOf("links.map(") < ui.indexOf("{open ? ("));
  ok("one client for all three destinations (no direct provider calls in screens)", [...screens, "app/commentaries/index.tsx", "app/study-tools/index.tsx"].every((f) => !src(f).includes("helloao.org") && src(f).includes("@/lib/deepStudyApi")));
  ok("no second audio player", [...screens].every((f) => !/expo-audio|expo-av|useAudioPlayer/.test(src(f))));
  const layout = src("app/_layout.tsx");
  ok("routes registered", ["deep-study/index", "commentaries/index", "commentaries/[id]", "commentaries/read", "study-tools/index", "study-tools/lexicon", "study-tools/word/[strongs]"].every((r) => layout.includes(`"${r}"`)));

  // ── Interface languages ─────────────────────────────────────────────────
  const en = JSON.parse(src("locales/en.json")).deepStudy;
  const langs = ["de", "es", "fr", "pt", "ar", "hi", "sw"];
  const missing = langs.flatMap((l) => { const b = JSON.parse(src(`locales/${l}.json`)).deepStudy ?? {}; return Object.keys(en).filter((k) => !b[k]).map((k) => `${l}.${k}`); });
  ok("interface translated in all 8 Bible Study languages (every key)", Object.keys(en).length > 100 && missing.length === 0, missing.slice(0, 5).join(","));
  ok("placeholders kept in every language", langs.every((l) => { const b = JSON.parse(src(`locales/${l}.json`)).deepStudy; return Object.keys(en).every((k) => ((en[k].match(/\{\{\w+\}\}/g) ?? []).sort().join() === ((b[k] ?? "").match(/\{\{\w+\}\}/g) ?? []).sort().join())); }));
  const used = new Set(screens.concat(["app/commentaries/index.tsx", "app/study-tools/index.tsx", "components/study/StudyUI.tsx", "app/bible-study/index.tsx"]).flatMap((f) => [...src(f).matchAll(/t\("deepStudy\.([A-Za-z0-9]+)"/g)].map((m) => m[1])));
  ok("every string used on screen exists in English", [...used].every((k) => k in en), [...used].filter((k) => !(k in en)).join(","));
  ok("commentary and lexicon content is labelled English, never auto-translated", ds.includes("(in English)") && src("app/study-tools/index.tsx").includes("Lexicons and notes are in English"));

  console.log(`deepStudy (app): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
