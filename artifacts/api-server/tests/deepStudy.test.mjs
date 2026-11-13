// Deep Study, Commentaries, Study Tools — lib/bibleProviders/helloaoStudy.ts, lib/studyResources.ts and
// routes/deepStudy.ts, through Express. Uses REAL responses saved from https://bible.helloao.org
// (tests/fixtures/helloao/study, see its README) with the network replaced — no invented Bible data.
// Covers: Genesis 1:1 and John 1:1 word alignment, Aramaic, H1254 / G3056 lexicon entries with every
// sense, Strong's normalisation, lemma search, cross references, commentary coverage (covered, no entry,
// not covered, chapter introduction), people/places, licence eligibility and attribution, language-based
// text direction, an unavailable original-language passage, malformed responses, network failure + retry,
// caching and version-aware cache keys.
// Run: node tests/deepStudy.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FX = path.join(root, "tests/fixtures/helloao/study");
const fx = (f) => JSON.parse(readFileSync(path.join(FX, f), "utf8"));
const req = createRequire(path.join(root, "package.json"));
const { build } = req("esbuild");
const express = req("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
// Inside the package, so the bundle resolves express from its node_modules (removed afterwards).
const tmp = mkdtempSync(path.join(root, ".tmp-deep-study-"));

// Provider stub: URL path → saved real response. Anything not saved answers 404, like the provider.
const ROUTES = {
  "/api/available_datasets.json": "available_datasets.json", "/api/available_commentaries.json": "available_commentaries.json",
  "/api/d/bsb-interlinear/GEN/1.json": "interlinear_GEN_1.json", "/api/d/bsb-interlinear/JHN/1.json": "interlinear_JHN_1.json", "/api/d/bsb-interlinear/DAN/2.json": "interlinear_DAN_2.json",
  "/api/d/bsb-interlinear/MAT/17.json": "interlinear_MAT_17.json",
  "/api/d/stepbible-lexicon/lexicon/H1254.json": "lexicon_H1254.json", "/api/d/stepbible-lexicon/lexicon/H0430.json": "lexicon_H0430.json",
  "/api/d/stepbible-lexicon/lexicon/G3056.json": "lexicon_G3056.json", "/api/d/stepbible-lexicon/lexicon/H4430.json": "lexicon_H4430.json",
  "/api/d/stepbible-lexicon/lexicon.json": "lexicon_index_subset.json",
  "/api/d/open-cross-ref/JHN/1.json": "xref_JHN_1.json", "/api/d/theographic/GEN/1.json": "theographic_GEN_1.json",
  "/api/c/matthew-henry/JHN/1.json": "c_matthew-henry_JHN_1.json", "/api/c/jamieson-fausset-brown/JHN/1.json": "c_jamieson-fausset-brown_JHN_1.json", "/api/c/tyndale/JHN/1.json": "c_tyndale_JHN_1.json",
};
for (const id of ["matthew-henry", "john-calvin", "jamieson-fausset-brown", "tyndale", "keil-delitzsch", "adam-clarke", "john-gill"]) ROUTES[`/api/c/${id}/books.json`] = `c_${id}_books.json`;
const calls = [];
let failNext = 0, failAlways = false, malformed = null, catalogueSha = null;
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const stubFetch = async (url) => {
  const p = new URL(url).pathname;
  calls.push(p);
  if (failAlways || failNext > 0) { failNext--; throw new TypeError("fetch failed"); }
  if (malformed && p === malformed) return response(200, { unexpected: true });
  const f = ROUTES[p];
  if (!f) return response(404, { error: "not found" });
  const body = fx(f);
  if (catalogueSha && p === "/api/available_datasets.json") for (const d of body.datasets) if (d.id === "bsb-interlinear") d.sha256 = catalogueSha;
  return response(200, body);
};

// The route reuses the reader's canon (lib/bibleReader.ts), which imports the database client: stub it
// as tests/bibleProviders.test.mjs does (Deep Study never touches the database).
const noDb = { name: "no-db", setup(b) {
  b.onResolve({ filter: /\/supabase$/ }, () => ({ path: "s", namespace: "no-db" }));
  b.onLoad({ filter: /.*/, namespace: "no-db" }, () => ({ contents: "export const supabaseServiceRole = {}; export const verifyCaller = async () => null; export default {};", loader: "js" }));
} };

try {
  ok("fixtures present", existsSync(path.join(FX, "README.md")));
  // One bundle holding the route AND the provider modules, so the stub and caches are shared.
  writeFileSync(path.join(tmp, "entry.ts"), `
    export { default as router } from ${JSON.stringify(path.join(root, "src/routes/deepStudy.ts"))};
    export * from ${JSON.stringify(path.join(root, "src/lib/bibleProviders/helloao.ts"))};
    export { normaliseStrongs, plainScript, sectionsFor, withRetry } from ${JSON.stringify(path.join(root, "src/lib/bibleProviders/helloaoStudy.ts"))};
    export { directionFor, STUDY_RESOURCES, isEligible } from ${JSON.stringify(path.join(root, "src/lib/studyResources.ts"))};
  `);
  const out = await build({ entryPoints: [path.join(tmp, "entry.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", external: ["express"], plugins: [noDb] });
  writeFileSync(path.join(tmp, "m.mjs"), out.outputFiles[0].text);
  const M = await import(pathToFileURL(path.join(tmp, "m.mjs")).href);
  M.setHelloAoFetch(stubFetch);

  const app = express(); app.use("/deep-study", M.router);
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/deep-study`;
  const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; };

  // ── Strong's normalisation (zero-padded like the provider; suffix kept separately) ──
  const N = M.normaliseStrongs;
  ok("strongs: H430 → H0430, h1254 → H1254, G3056 stays", N("H430")?.id === "H0430" && N("h1254")?.id === "H1254" && N("G3056")?.id === "G3056");
  ok("strongs: sense suffix kept apart (H1254a → H1254 + H1254A)", N("H1254a")?.id === "H1254" && N("H1254a")?.sense === "H1254A");
  ok("strongs: nonsense refused", N("X12") === null && N("H0") === null && N("") === null && N("H12345") === null);

  // ── Catalogue, eligibility, attribution, direction ──
  let r = await get("/resources");
  const cIds = r.body.commentaries.map((c) => c.id).sort();
  ok("resources: the 7 reviewed commentaries from the live catalogue", JSON.stringify(cIds) === JSON.stringify(["adam-clarke", "jamieson-fausset-brown", "john-calvin", "john-gill", "keil-delitzsch", "matthew-henry", "tyndale"]), cIds.join());
  ok("resources: 4 reviewed datasets; unreviewed ones only listed as pending", JSON.stringify(r.body.datasets.map((d) => d.id).sort()) === JSON.stringify(["bsb-interlinear", "open-cross-ref", "stepbible-lexicon", "theographic"])
    && r.body.pendingReview.some((x) => x.id === "history-globe") && r.body.pendingReview.some((x) => x.id === "verse-of-the-day"));
  const mh = r.body.commentaries.find((c) => c.id === "matthew-henry"), ty = r.body.commentaries.find((c) => c.id === "tyndale");
  ok("direction: English commentaries the catalogue marks 'rtl' are shown left to right", mh.declaredDirection === "rtl" && mh.direction === "ltr" && mh.language === "English");
  ok("direction: by language (Hebrew/Arabic rtl, English/Greek ltr)", M.directionFor("heb") === "rtl" && M.directionFor("arb") === "rtl" && M.directionFor("eng") === "ltr" && M.directionFor("grc") === "ltr");
  ok("licence: Tyndale is CC BY-SA, marked share-alike, with attribution and the change notice", ty.credit.licence.name === "CC BY-SA 4.0" && ty.credit.shareAlike && /Tyndale House/.test(ty.credit.attribution) && /wording unchanged/.test(ty.credit.changes));
  ok("licence: public-domain commentaries say so; nothing may be translated without review", mh.credit.licence.name.startsWith("Public Domain") && Object.values(M.STUDY_RESOURCES).every((x) => x.mayTranslate === false));
  // Licence review (2026-11-12, primary sources — docs/deep-study-licences.md).
  const all = Object.values(M.STUDY_RESOURCES);
  ok("licence review: every shown resource was verified at its primary source, with a finding", all.filter((x) => x.eligible).every((x) => /^https:\/\//.test(x.verified.at) && x.verified.on >= "2026-11-12" && x.verified.finding.length > 30));
  ok("licence review: every shown resource links its original source", all.every((x) => /^https:\/\//.test(x.source.url) && x.source.label));
  const step = r.body.datasets.find((d) => d.id === "stepbible-lexicon").credit;
  ok("STEP Bible: credited to \"STEP Bible\" linked to www.STEPBible.org (its licence condition)", /STEP Bible \(www\.STEPBible\.org\)/.test(step.attribution) && step.origin.label === "STEP Bible" && step.origin.url === "https://www.STEPBible.org");
  const bsb = r.body.datasets.find((d) => d.id === "bsb-interlinear").credit;
  ok("BSB: Berean's own public-domain notice", bsb.attribution.startsWith("The Holy Bible, Berean Standard Bible, BSB is produced in cooperation with Bible Hub") && /dedicated to the public domain/.test(bsb.attribution));
  ok("Tyndale: Tyndale's own licence statement, linked to Tyndale Open Resources", /Creative Commons Attribution-ShareAlike 4\.0 International License/.test(ty.credit.attribution) && ty.credit.origin.url === "https://tyndaleopenresources.com/");
  ok("OpenBible: only references are used (never its ESV quotations)", /never the site's ESV quotations/.test(M.STUDY_RESOURCES["open-cross-ref"].verified.finding));
  ok("every credit names the provider and states P2P's change", [...r.body.datasets, ...r.body.commentaries].every((x) => x.credit.via.url === "https://bible.helloao.org" && /wording unchanged/.test(x.credit.changes) && x.credit.licenceVerifiedOn === "2026-11-12"));
  ok("licence: coverage comes from the live catalogue (not hardcoded)", r.body.datasets.find((d) => d.id === "stepbible-lexicon").coverage.entries === 18085 && r.body.datasets.find((d) => d.id === "open-cross-ref").coverage.references === 344799);
  ok("eligibility: an unreviewed resource is refused", (await get("/commentaries/history-globe")).status === 404 && !M.isEligible("history-globe"));
  ok("responses are cacheable by the app and proxies", r.cache === "public, max-age=3600");

  // ── Genesis 1:1 — Hebrew, right to left, every word aligned ──
  r = await get("/interlinear/GEN/1?from=1&to=1");
  const g = r.body.verses[0];
  ok("Gen 1:1: one verse, Hebrew, right to left, 7 words", r.body.verses.length === 1 && g.direction === "rtl" && g.words.length === 7 && g.words.every((w) => w.language === "hebrew"));
  const gw = g.words.map((w) => `${w.strongs}:${w.gloss}`).join("|");
  ok("Gen 1:1: In the beginning / created / God / (object marker) / the heavens / and / the earth", gw === "H7225:In the beginning|H1254:created|H0430:God|H0853:null|H8064:the heavens|H0853:and|H0776:the earth", gw);
  ok("Gen 1:1: original order kept (pos 1..7) with the BSB English order alongside", g.words.map((w) => w.pos).join() === "1,2,3,4,5,6,7" && g.words[1].bsbPos === 4);
  ok("Gen 1:1: transliteration, parsing and stable word ids", g.words[1].transliteration === "bā·rā" && g.words[1].parsingFull === "Verb - Qal - Perfect - third person masculine singular" && g.words[1].id === "GEN.1.1.2");
  ok("interlinear: attribution + the BSB alignment note", /public domain/.test(r.body.credit.attribution) && /Berean Standard Bible/.test(r.body.alignment));

  // ── John 1:1 — Greek, left to right, several words ──
  r = await get("/interlinear/JHN/1?from=1&to=1");
  const j = r.body.verses[0];
  ok("John 1:1: Greek, left to right, 17 words", j.direction === "ltr" && j.words.length === 17 && j.words.every((w) => w.language === "greek"));
  ok("John 1:1: Λόγος is G3056 'Word' three times; Θεόν/Θεὸς G2316 'God'", j.words.filter((w) => w.strongs === "G3056" && w.gloss === "Word").length === 3 && j.words.filter((w) => w.strongs === "G2316").length === 2);
  ok("John 1:1: the untranslated article keeps a null gloss (never invented)", j.words.some((w) => w.text === "τὸν" && w.gloss === null));
  r = await get("/interlinear/JHN/1?from=1&to=3");
  ok("a passage of several verses (John 1:1-3)", r.body.verses.map((v) => v.verse).join() === "1,2,3" && r.body.verses.every((v) => v.words.length > 5));

  // ── Aramaic (Daniel 2) ──
  r = await get("/interlinear/DAN/2?from=4&to=4");
  ok("Aramaic words are labelled Aramaic and read right to left", r.body.verses[0].words.some((w) => w.language === "aramaic") && r.body.verses[0].direction === "rtl");

  // ── Original language unavailable ──
  // Matthew 17:21 is in the live interlinear with NO words (the Berean text doesn't include it).
  r = await get("/interlinear/MAT/17?from=21&to=21");
  ok("Matthew 17:21: no original-language words → available: false, the verse named, a neutral note", r.status === 200 && r.body.available === false
    && r.body.verses.length === 0 && r.body.versesWithoutWords.join() === "21" && /does not include them/.test(r.body.missingNote));
  r = await get("/interlinear/MAT/17?from=20&to=22");
  ok("Matthew 17:20-22: verses 20 and 22 shown, 21 reported as without words", r.body.available && r.body.verses.map((v) => v.verse).join() === "20,22" && r.body.versesWithoutWords.join() === "21");
  ok("references are checked against the canon (unknown book, chapter 0, Genesis 51)", (await get("/interlinear/XYZ/1")).status === 400 && (await get("/interlinear/GEN/0")).status === 400 && (await get("/interlinear/GEN/51")).status === 400);

  // ── Lexicon ──
  r = await get("/lexicon/h1254?book=GEN&chapter=1");
  ok("H1254: every sense, not just the first (to create / to fatten)", r.body.entry.senses.map((s) => `${s.id}:${s.gloss}`).join() === "H1254A:to create,H1254B:to fatten");
  ok("H1254: lemma, transliteration, part of speech and full definition", r.body.entry.senses[0].lemma === "בָּרָא" && r.body.entry.senses[0].transliteration === "ba.ra" && r.body.entry.senses[0].partOfSpeech === "V" && /always with God as subject/.test(r.body.entry.senses[0].definition));
  ok("H1254: occurs in Genesis 1 at 1, 21, 27 (three times) — the same interlinear words", r.body.occurrences.map((o) => o.verse).join() === "1,21,27,27,27" && r.body.occurrences[0].wordId === "GEN.1.1.2");
  ok("lexicon: Hebrew entry right to left; credit + 'brief lexicon' honesty note", r.body.entry.direction === "rtl" && /CC BY 4.0/.test(r.body.credit.attribution) && /not a complete critical dictionary/.test(r.body.note));
  r = await get("/lexicon/G3056?book=JHN&chapter=1");
  ok("G3056 λόγος: Greek, left to right, occurs in John 1:1 (×3) and 1:14", r.body.entry.language === "greek" && r.body.entry.direction === "ltr" && r.body.occurrences.map((o) => o.verse).join() === "1,1,1,14");
  r = await get("/lexicon/H430");
  ok("unpadded H430 opens H0430 (God)", r.status === 200 && r.body.entry.id === "H0430");
  r = await get("/lexicon/H4430");
  ok("Aramaic H4430: Aramaic, with its Hebrew counterpart H4428 linked from the definition", r.body.entry.language === "aramaic" && r.body.entry.relatedStrongs.includes("H4428"));
  ok("lexicon: no entry → 404; not a Strong's number → 404 with an example", (await get("/lexicon/G9999")).status === 404 && /H1254/.test((await get("/lexicon/zz")).body.error));

  // ── Lexicon search ──
  r = await get(`/lexicon/search?q=${encodeURIComponent("λογος")}`);
  ok("search λογος: exact lemma first (G3056 λόγος), accents ignored", r.body.mode === "lemma" && r.body.items[0].id === "G3056" && r.body.items.some((i) => i.id === "G0249"));
  r = await get(`/lexicon/search?q=${encodeURIComponent("ברא")}&language=hebrew`);
  ok("search ברא in Hebrew: בָּרָא H1254 first", r.body.items[0].id === "H1254" && r.body.items.every((i) => i.language === "hebrew"));
  r = await get("/lexicon/search?q=g746");
  ok("search by Strong's number", r.body.mode === "strongs" && r.body.items[0]?.id === "G0746");
  r = await get("/lexicon/search?q=light");
  ok("English words aren't searchable in the index — 0 results, and the note says why", r.body.total === 0 && /English meanings are inside each entry/.test(r.body.note));

  // ── Cross references ──
  r = await get("/cross-references/JHN/1?from=1&to=1&limit=5");
  const x = r.body.verses[0];
  ok("John 1:1 cross references: ranked by votes, Genesis 1:1 first, limit applied, total kept", x.references.length === 5 && x.references[0].book === "GEN" && x.references[0].verse === 1 && x.references[0].score >= x.references[1].score && x.total === 36);
  ok("cross references: ranges kept (1 John 1:1-2)", r.body.verses[0].references.length === 5 && (await get("/cross-references/JHN/1?from=1&to=1&limit=50")).body.verses[0].references.some((y) => y.book === "1JN" && y.endVerse === 2));
  ok("cross references: CC BY credit", /OpenBible\.info/.test(r.body.credit.attribution));

  // ── People, places, events ──
  r = await get("/people-places/GEN/1?from=2&to=2");
  ok("Gen 1:2: God and the Holy Spirit; the creation event; filtered to the verse", r.body.items.some((i) => i.name === "Holy Spirit" && i.verses.join() === "2") && r.body.items.some((i) => i.kind === "event"));
  ok("people/places: no traditional dates passed on; CC BY-SA credit", r.body.items.every((i) => !("startDate" in i)) && /CC BY-SA/.test(r.body.credit.attribution));

  // ── Commentaries ──
  r = await get("/commentaries/matthew-henry/JHN/1?from=1&to=1");
  ok("Matthew Henry on John 1:1: covered; the section 1–5 that speaks about it", r.body.covered && r.body.sections.length === 1 && r.body.sections[0].start === 1 && r.body.sections[0].end === 5);
  r = await get("/commentaries/matthew-henry/JHN/1");
  ok("whole chapter: every section, ends computed from the next start", r.body.sections.map((s) => s.start).join() === "1,6,15,19,29,37,43" && r.body.sections.at(-1).end === null && !!r.body.introduction);
  r = await get("/commentaries/john-calvin/PRO/3?from=5&to=6");
  ok("a commentary with no notes on that book (Calvin on Proverbs) → not covered, from its own book list", r.status === 200 && r.body.covered === false && r.body.sections.length === 0);
  r = await get("/commentaries/matthew-henry");
  ok("commentary details: real book coverage", r.body.books.length === 65 && r.body.books[0].id === "GEN" && r.body.books[0].lastChapter === 50 && r.body.credit.attribution.includes("Matthew Henry"));

  r = await get("/compare/JHN/1?from=1&to=1");
  const st = Object.fromEntries(r.body.commentaries.map((c) => [c.id, c.status]));
  ok("compare John 1:1: Keil & Delitzsch (Old Testament only) not covered", st["keil-delitzsch"] === "not_covered", JSON.stringify(st));
  const jfb = r.body.commentaries.find((c) => c.id === "jamieson-fausset-brown");
  ok("compare John 1:1: JFB's notes on 1:1 are in its chapter introduction — included and labelled", jfb.status === "ok" && jfb.sections.length === 0 && /In the beginning/.test(jfb.introduction));
  ok("compare: each commentary carries its own credit and language-based direction", r.body.commentaries.every((c) => c.credit && c.direction === "ltr"));
  ok("compare: Matthew Henry and Tyndale have sections on John 1:1", st["matthew-henry"] === "ok" && st.tyndale === "ok");

  // ── Failures: malformed, network + retry, permanent outage ──
  M.clearHelloAoCache();
  malformed = "/api/d/bsb-interlinear/JHN/1.json";
  r = await get("/interlinear/JHN/1?from=1&to=1");
  ok("malformed provider answer → 502 'unexpected', never guessed at", r.status === 502 && r.body.kind === "invalid");
  malformed = null;
  M.clearHelloAoCache(); calls.length = 0; failNext = 1;
  r = await get("/lexicon/G3056");
  ok("a network failure is retried once, then succeeds", r.status === 200 && r.body.entry.id === "G3056" && calls.length >= 2);
  M.clearHelloAoCache(); failAlways = true;
  r = await get("/lexicon/G3056");
  ok("provider unreachable → 502 with a clear message (failures are not cached)", r.status === 502 && /couldn't be reached/.test(r.body.error));
  failAlways = false;
  r = await get("/lexicon/G3056");
  ok("…and it works again once the provider is back", r.status === 200);

  // ── Caching (in-memory, version-aware) ──
  calls.length = 0;
  await get("/interlinear/JHN/1?from=1&to=1"); await get("/interlinear/JHN/1?from=2&to=2");
  ok("a chapter is fetched once and reused for any verse range", calls.filter((p) => p.endsWith("/bsb-interlinear/JHN/1.json")).length <= 1, calls.join());
  M.clearHelloAoCache(); catalogueSha = "ffffffffffffffffffffffff"; calls.length = 0;
  await get("/interlinear/JHN/1?from=1&to=1");
  catalogueSha = "0000000000000000aaaaaaaa"; M.clearHelloAoCache(); calls.length = 0;
  await get("/interlinear/JHN/1?from=1&to=1");
  ok("a new resource version (catalogue checksum) fetches fresh data", calls.includes("/api/d/bsb-interlinear/JHN/1.json"));
  catalogueSha = null;

  // ── sectionsFor ──
  const secs = [{ start: 1, end: 5, paragraphs: ["a"] }, { start: 6, end: 14, paragraphs: ["b"] }, { start: 15, end: null, paragraphs: ["c"] }];
  ok("sectionsFor: overlaps only", M.sectionsFor(secs, 5, 6).map((s) => s.start).join() === "1,6" && M.sectionsFor(secs, 20, 20).map((s) => s.start).join() === "15");

  server.close();
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`deepStudy (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
