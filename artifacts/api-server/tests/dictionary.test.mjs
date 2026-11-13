// Biblical Dictionary (A–Z) — lib/dictionary.ts and its routes in routes/deepStudy.ts, through Express,
// on the REAL built index (data/dictionary-index.txt, from the STEPBible lexicon + BSB interlinear) and the
// saved real provider responses (tests/fixtures/helloao/study) for word forms — no invented Bible data.
// Covers: A–Z (every letter, real counts, order, paging, empty letters), unified search (English,
// Greek and Hebrew with and without accents/points, Strong's in any form, transliteration, homonym senses,
// Aramaic, language filter, ranking, no duplicates), headword entries (separate lemmas never merged,
// "also translated"), occurrences (counts agree, canonical refs, word forms from the interlinear),
// reference entries (none fabricated), errors.
// Run: node tests/dictionary.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = path.join(root, "tests/fixtures/helloao/study");
const req = createRequire(path.join(root, "package.json"));
const { build } = req("esbuild");
const express = req("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-dictionary-"));
const ROUTES = { "/api/available_datasets.json": "available_datasets.json", "/api/available_commentaries.json": "available_commentaries.json",
  "/api/d/bsb-interlinear/GEN/1.json": "interlinear_GEN_1.json", "/api/d/bsb-interlinear/JHN/1.json": "interlinear_JHN_1.json", "/api/d/bsb-interlinear/DAN/2.json": "interlinear_DAN_2.json" };
const stubFetch = async (url) => { const f = ROUTES[new URL(url).pathname]; const body = f ? JSON.parse(readFileSync(path.join(FX, f), "utf8")) : { error: "not found" };
  return { ok: !!f, status: f ? 200 : 404, json: async () => body }; };
const noDb = { name: "no-db", setup(b) {
  b.onResolve({ filter: /\/supabase$/ }, () => ({ path: "s", namespace: "no-db" }));
  b.onLoad({ filter: /.*/, namespace: "no-db" }, () => ({ contents: "export const supabaseServiceRole = {}; export const verifyCaller = async () => null; export default {};", loader: "js" }));
} };

try {
  ok("index built and present", existsSync(path.join(root, "data/dictionary-index.txt")));
  writeFileSync(path.join(tmp, "entry.ts"), `
    export { default as router } from ${JSON.stringify(path.join(root, "src/routes/deepStudy.ts"))};
    export { setHelloAoFetch } from ${JSON.stringify(path.join(root, "src/lib/bibleProviders/helloao.ts"))};
    export * from ${JSON.stringify(path.join(root, "src/lib/dictionary.ts"))};
  `);
  const out = await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["express"], plugins: [noDb] });
  writeFileSync(path.join(tmp, "m.mjs"), out.outputFiles[0].text);
  const M = await import(pathToFileURL(path.join(tmp, "m.mjs")).href);
  M.setHelloAoFetch(stubFetch);
  const D = M.getDictionary();
  const app = express(); app.use("/deep-study", M.router);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/deep-study`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };

  // ── Index ──
  ok("index: every STEPBible brief-lexicon record (18,085) with provenance", D.records.size === 18085 && D.header.datasets.map((x) => x.id).join() === "stepbible-lexicon,bsb-interlinear" && D.header.books.length === 66);
  const langs = ["hebrew", "aramaic", "greek"].map((l) => [...D.records.values()].filter((r) => r.language === l).length);
  ok("index: Hebrew, Aramaic and Greek records all present", langs.every((n) => n > 0), JSON.stringify(langs));

  // ── A–Z ──
  const ov = await get("/dictionary");
  ok("A–Z: 26 letters + '#', counts are real and add up to every headword", ov.body.letters.length === 27 && ov.body.letters.reduce((a, l) => a + l.count, 0) === ov.body.terms && ov.body.terms === D.sorted.length);
  ok("A–Z: counts differ by letter (nothing evened out)", new Set(ov.body.letters.map((l) => l.count)).size > 10);
  const a1 = await get("/dictionary/browse?letter=A"), a2 = await get(`/dictionary/browse?letter=A&offset=${a1.body.items.length}`);
  ok("A–Z: a letter lists only its words, alphabetically", a1.body.items.every((t) => t.letter === "A") && a1.body.items.every((t, i, xs) => i === 0 || new Intl.Collator("en", { sensitivity: "base", numeric: true }).compare(xs[i - 1].key, t.key) <= 0));
  ok("A–Z: paging continues without repeats", a2.body.items.length > 0 && !a2.body.items.some((t) => a1.body.items.some((u) => u.key === t.key)) && a1.body.total === ov.body.letters.find((l) => l.letter === "A").count);
  const empties = ov.body.letters.filter((l) => !l.count).map((l) => l.letter);
  if (empties.length) { const e = await get(`/dictionary/browse?letter=${encodeURIComponent(empties[0])}`); ok("A–Z: an empty letter answers with no items (not an error)", e.status === 200 && e.body.total === 0); } else ok("A–Z: every letter has words", true);
  ok("A–Z: unknown letter refused", (await get("/dictionary/browse?letter=AB")).status === 400);

  // ── Search ──
  const s = async (q, extra = "") => (await get(`/dictionary/search?q=${encodeURIComponent(q)}${extra}`)).body;
  const love = await s("love");
  ok("English: 'love' → the headword first", love.items[0]?.type === "term" && love.items[0].key === "love");
  const loveTerm = (await get("/dictionary/term/love")).body;
  const ids = loveTerm.records.map((r) => r.strongs);
  ok("English: 'love' leads to ἀγάπη (G0026), ἀγαπάω (G0025) and אָהַב (H0157) as SEPARATE records", ["G0026", "G0025", "H0157"].every((x) => ids.includes(x)) && new Set(ids).size === ids.length);
  ok("English: different lemmas never merged (each keeps its own lemma and Strong's)", loveTerm.records.every((r) => r.lemma && /^[HG]\d{4}$/.test(r.strongs)));
  ok("English: 'also translated love' lists other words the BSB renders 'love', with counts", Array.isArray(loveTerm.renderedAs) && loveTerm.renderedAs.every((r) => r.renderCount > 0 && !ids.includes(r.strongs)));
  const g = await s("ἀγάπη");
  ok("Greek: ἀγάπη → G0026 first (exact original)", g.items[0]?.strongs === "G0026" && g.items[0].rank === 1);
  ok("Greek: unaccented αγαπη finds the same record", (await s("αγαπη")).items[0]?.strongs === "G0026");
  ok("Greek: πιστις (no accents) → πίστις G4102", (await s("πιστις")).items.some((i) => i.strongs === "G4102" && i.rank === 1));
  const h = await s("שָׁלוֹם");
  ok("Hebrew: שָׁלוֹם → H7965 (exact, vowels ignored for matching)", h.items.some((i) => i.strongs === "H7965" && i.rank === 1));
  ok("Hebrew: unpointed שלום finds it too", (await s("שלום")).items.some((i) => i.strongs === "H7965"));
  ok("Hebrew: חֶסֶד → H2617", (await s("חֶסֶד")).items.some((i) => i.strongs.startsWith("H2617")));
  ok("Strong's: G26, g0026 and H160 → the exact records", (await s("G26")).items[0]?.strongs === "G0026" && (await s("g0026")).items[0]?.strongs === "G0026" && (await s("H160")).items[0]?.strongs === "H0160");
  ok("transliteration: agape → G0026 found", (await s("agape")).items.some((i) => i.strongs === "G0026"));
  const aram = await s("king", "&language=aramaic");
  ok("Aramaic: language filter returns Aramaic only (e.g. מֶלֶךְ H4430)", aram.items.length > 0 && aram.items.every((i) => i.type === "term" ? i.languages.some((l) => l.language === "aramaic") : i.language === "aramaic"));
  ok("homonyms: H1254 keeps its lettered senses apart", (D.records.get("H1254")?.senses.length ?? 0) >= 2);
  const all = await s("god");
  ok("no duplicate results", new Set(all.items.map((i) => i.type + (i.key ?? i.strongs))).size === all.items.length);
  ok("ranking: results are in rank order", all.items.every((i, k, xs) => k === 0 || xs[k - 1].rank <= i.rank));
  ok("empty search → no results, no error", (await s("")).total === 0);
  ok("nonsense → empty, not an error", (await s("zzqqxx")).total === 0);

  // ── Records and occurrences ──
  const rec = (await get("/dictionary/record/G26")).body;
  ok("record: G26 → G0026 with its headwords (link back to the dictionary)", rec.record.strongs === "G0026" && rec.terms.some((t) => t.key === "love") && /not counts of an English word/.test(rec.countsNote));
  const occ = (await get("/dictionary/record/H0430/occurrences?limit=5")).body;
  ok("occurrences: counts agree with the record (verses ≤ words)", occ.verses === D.records.get("H0430").refs.split(",").length && occ.verses <= occ.words && occ.words > 2000);
  ok("occurrences: first is Genesis 1:1, canonical book/chapter/verse", occ.items[0].book === "GEN" && occ.items[0].chapter === 1 && occ.items[0].verse === 1 && occ.items[0].bookName === "Genesis");
  ok("occurrences: the ACTUAL word form from the interlinear (אֱלֹהִ֑ים in Gen 1:1)", occ.items[0].forms?.[0]?.text.includes("אֱלֹהִ") && occ.items[0].forms[0].wordId.startsWith("GEN.1.1."));
  const decoded = M.decodeRefs(D.records.get("G0026").refs);
  ok("occurrences: references decode in canonical order", decoded.every((n, i) => i === 0 || decoded[i - 1] < n));
  ok("occurrences: unavailable chapter → forms null (shown as unavailable), never invented", (await get("/dictionary/record/G0026/occurrences?limit=1")).body.items[0].forms === null);
  ok("unknown Strong's → 404", (await get("/dictionary/record/H9999/occurrences")).status === 404 && (await get("/dictionary/record/X1")).status === 404);
  ok("unknown headword → 404", (await get("/dictionary/term/zzqqxx")).status === 404);

  // ── Reference entries, credits ──
  ok("reference entries: none fabricated while no licensed source is approved", M.REFERENCE_SOURCES.length === 0 && ov.body.referenceSources.length === 0);
  ok("credits: STEPBible (CC BY 4.0) and BSB interlinear on every answer", ["stepbible-lexicon", "bsb-interlinear"].every((id) => ov.body.credits.some((c) => c.id === id)) && loveTerm.credits.length === 2 && occ.credits.length === 2);
  server.close();
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`dictionary (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
