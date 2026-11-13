import { Router, type Response } from "express";
import { HelloAoError } from "../lib/bibleProviders/helloao";
import {
  getCommentaryBookIntroduction, getCommentaryBooks, getCommentaryChapter, getCrossReferences, getInterlinear, getLexiconEntry,
  getPeoplePlaces, getStudyCatalogue, sectionsFor, searchLexicon, type CatalogueEntry,
} from "../lib/bibleProviders/helloaoStudy";
import { STUDY_RESOURCES, creditFor, directionFor, isEligible, languageLabel, originalDirection } from "../lib/studyResources";
import { bookByCode } from "../lib/bibleReader";
import { normaliseStrongs } from "../lib/bibleProviders/helloaoStudy";
import { LETTERS, REFERENCE_SOURCES, browse, getDictionary, letterCounts, occurrencePage, recordView, search, termEntry } from "../lib/dictionary";
import { articleLetters, articleSummary, articleView, articlesForTitle, browseArticles, getArticles } from "../lib/referenceArticles";

// Deep Study, Commentaries and Study Tools — ONE set of study records for all three destinations in the
// app (the same interlinear words, lexicon entries, commentary sections and cross references, by the same
// stable ids). Read-only and public like the Bible reader; nothing is stored. Only resources that P2P
// Global has reviewed (lib/studyResources.ts) are ever returned, each with its attribution and licence.
//   GET /deep-study/resources                              — the reviewed commentaries and tools (live catalogue ∩ reviewed)
//   GET /deep-study/interlinear/:book/:chapter?from&to     — original-language words, verse by verse
//   GET /deep-study/lexicon/search?q&language              — Strong's number or Hebrew/Greek lemma
//   GET /deep-study/lexicon/:strongs?book&chapter          — one entry, all senses (+ where it occurs in that chapter)
//   GET /deep-study/cross-references/:book/:chapter?from&to&limit
//   GET /deep-study/people-places/:book/:chapter?from&to
//   GET /deep-study/commentaries/:id                       — details + real book coverage
//   GET /deep-study/commentaries/:id/:book/introduction
//   GET /deep-study/commentaries/:id/:book/:chapter?from&to
//   GET /deep-study/compare/:book/:chapter?from&to&ids     — every chosen commentary on the same passage

const router = Router();

function fail(res: Response, e: unknown) {
  if (e instanceof HelloAoError) return res.status(e.status).json({ error: e.message, kind: e.kind });
  return res.status(500).json({ error: "Deep Study couldn't load this. Please try again.", kind: "error" });
}
const ok = (res: Response, body: unknown) => { res.set("Cache-Control", "public, max-age=3600"); return res.json(body); };

/** :book/:chapter (checked against the 66-book canon the reader uses) plus an optional verse range (defaults to the whole chapter). */
function passage(p: Record<string, string>, q: Record<string, unknown>) {
  const b = bookByCode(String(p.book ?? "")), chapter = Number(p.chapter);
  if (!b || !Number.isInteger(chapter) || chapter < 1 || chapter > b.chapters) return null;
  const book = b.code;
  const from = Number(q.from), to = Number(q.to);
  const f = Number.isInteger(from) && from >= 1 && from <= 200 ? from : 1;
  const t = Number.isInteger(to) && to >= f && to <= 200 ? to : (Number.isInteger(from) && from >= 1 ? f : 200);
  return { book, chapter, from: f, to: t };
}
const bad = (res: Response) => res.status(400).json({ error: "Choose a book and chapter.", kind: "bad_request" });

function resourceView(e: CatalogueEntry) {
  const r = STUDY_RESOURCES[e.id];
  return {
    id: e.id, kind: r.kind, name: r.name, author: r.author, website: e.website,
    language: languageLabel(e.language, e.languageEnglishName), languageCode: e.language,
    // Direction from the language itself (the catalogue marks some English commentaries "rtl").
    direction: directionFor(e.language), declaredDirection: e.declaredDirection,
    coverage: { books: e.numberOfBooks, chapters: e.totalNumberOfChapters, verses: e.totalNumberOfVerses, words: e.totalNumberOfWords, references: e.totalNumberOfReferences, entries: e.totalNumberOfLexicon },
    version: (e.sha256 ?? "v").slice(0, 16), credit: creditFor(e.id, e.licenseNotes ?? e.licenseNotice),
  };
}

router.get("/resources", async (_req, res) => {
  try {
    const cat = await getStudyCatalogue();
    const shown = cat.filter((e) => isEligible(e.id));
    return ok(res, {
      commentaries: shown.filter((e) => e.kind === "commentary").map(resourceView),
      datasets: shown.filter((e) => e.kind === "dataset").map(resourceView),
      // In the live catalogue but not yet reviewed: never shown, only counted (so the gap is visible).
      pendingReview: cat.filter((e) => !isEligible(e.id)).map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
    });
  } catch (e) { return fail(res, e); }
});

router.get("/interlinear/:book/:chapter", async (req, res) => {
  const p = passage(req.params, req.query); if (!p) return bad(res);
  try {
    const { version, verses } = await getInterlinear(p.book, p.chapter);
    const inRange = verses.filter((v) => v.verse >= p.from && v.verse <= p.to);
    const withWords = inRange.filter((v) => v.words.length > 0);
    return ok(res, {
      ...p, version, credit: creditFor("bsb-interlinear", "The Berean Standard Bible and its interlinear tables are in the public domain. Changes were made to the data to fit the Free Use Bible API format."),
      alignment: "Words follow the original-language order and are aligned to the Berean Standard Bible. Your chosen translation may word a verse differently.",
      verses: withWords.map((v) => ({ verse: v.verse, direction: originalDirection(v.words[0]?.language ?? ""), words: v.words })),
      // Verses with no original-language words here (e.g. Matthew 17:21, which the Berean text does not include).
      versesWithoutWords: inRange.filter((v) => !v.words.length).map((v) => v.verse),
      missingNote: inRange.some((v) => !v.words.length) ? "Some verses have no original-language words in this interlinear, because the Berean Standard Bible text it follows does not include them. Other translations may include these verses." : null,
      available: withWords.length > 0,
    });
  } catch (e) {
    if (e instanceof HelloAoError && e.kind === "not_found") return ok(res, { ...p, verses: [], available: false, credit: creditFor("bsb-interlinear") });
    return fail(res, e);
  }
});

router.get("/lexicon/search", async (req, res) => {
  const q = String(req.query.q ?? "").slice(0, 60), language = req.query.language ? String(req.query.language) : null;
  try {
    const r = await searchLexicon(q, language);
    return ok(res, { ...r, credit: creditFor("stepbible-lexicon", "The Translators Brief lexicons of Extended Strongs (TBESH and TBESG) are by STEPBible.org / Tyndale House, Cambridge, and are licensed under CC BY 4.0. Changes were made to the data to fit the Free Use Bible API format."),
      note: "Search by Strong's number (H1254, G3056) or by Hebrew or Greek letters. English meanings are inside each entry." });
  } catch (e) { return fail(res, e); }
});

router.get("/lexicon/:strongs", async (req, res) => {
  try {
    const { version, entry, requestedSense } = await getLexiconEntry(String(req.params.strongs));
    if (!entry) return res.status(404).json({ error: "This Strong's number has no entry in the brief lexicons.", kind: "not_found" });
    // Where the word occurs in the chapter it was opened from (the same interlinear records, by Strong's number).
    let occurrences: { verse: number; wordId: string; text: string; transliteration: string | null; gloss: string | null }[] | null = null;
    const p = req.query.book ? passage({ book: String(req.query.book), chapter: String(req.query.chapter ?? "") }, {}) : null;
    if (p) {
      try {
        const { verses } = await getInterlinear(p.book, p.chapter);
        occurrences = verses.flatMap((v) => v.words.filter((w) => w.strongs === entry.id).map((w) => ({ verse: v.verse, wordId: w.id, text: w.text, transliteration: w.transliteration, gloss: w.gloss })));
      } catch { occurrences = null; }
    }
    return ok(res, {
      version, entry: { ...entry, direction: originalDirection(entry.language ?? "") }, requestedSense, occurrences,
      credit: creditFor("stepbible-lexicon", "The Translators Brief lexicons of Extended Strongs (TBESH and TBESG) are by STEPBible.org / Tyndale House, Cambridge, and are licensed under CC BY 4.0. Changes were made to the data to fit the Free Use Bible API format."),
      note: "A brief lexicon: short definitions to help study, not a complete critical dictionary. Every sense is shown; which one a verse uses is for the reader to weigh.",
    });
  } catch (e) { return fail(res, e); }
});

router.get("/cross-references/:book/:chapter", async (req, res) => {
  const p = passage(req.params, req.query); if (!p) return bad(res);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
  try {
    const { version, verses } = await getCrossReferences(p.book, p.chapter);
    return ok(res, {
      ...p, version, credit: creditFor("open-cross-ref", "Changes were made to the data to fit the Free Use Bible API format."),
      verses: verses.filter((v) => v.verse >= p.from && v.verse <= p.to).map((v) => ({
        verse: v.verse, total: v.references.length,
        references: [...v.references].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, limit),
      })),
    });
  } catch (e) {
    if (e instanceof HelloAoError && e.kind === "not_found") return ok(res, { ...p, verses: [], credit: creditFor("open-cross-ref") });
    return fail(res, e);
  }
});

router.get("/people-places/:book/:chapter", async (req, res) => {
  const p = passage(req.params, req.query); if (!p) return bad(res);
  try {
    const { version, items } = await getPeoplePlaces(p.book, p.chapter);
    return ok(res, { ...p, version, credit: creditFor("theographic", "Changes were made to the data to fit the Free Use Bible API format."),
      items: items.map((i) => ({ ...i, verses: i.verses.filter((v) => v >= p.from && v <= p.to) })).filter((i) => i.verses.length) });
  } catch (e) { return fail(res, e); }
});

router.get("/commentaries/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!isEligible(id) || STUDY_RESOURCES[id].kind !== "commentary") return res.status(404).json({ error: "That commentary isn't available.", kind: "not_found" });
  try {
    const cat = await getStudyCatalogue();
    const e = cat.find((x) => x.id === id);
    if (!e) return res.status(404).json({ error: "That commentary isn't in the provider's catalogue right now.", kind: "not_found" });
    const { books } = await getCommentaryBooks(id);
    return ok(res, { ...resourceView(e), books });
  } catch (e) { return fail(res, e); }
});

router.get("/commentaries/:id/:book/introduction", async (req, res) => {
  const id = String(req.params.id), book = String(req.params.book).toUpperCase();
  if (!isEligible(id) || STUDY_RESOURCES[id].kind !== "commentary" || !bookByCode(book)) return res.status(404).json({ error: "Not available.", kind: "not_found" });
  try {
    const introduction = await getCommentaryBookIntroduction(id, book);
    return ok(res, { id, book, introduction, credit: creditFor(id) });
  } catch (e) { return fail(res, e); }
});

router.get("/commentaries/:id/:book/:chapter", async (req, res) => {
  const id = String(req.params.id);
  if (!isEligible(id) || STUDY_RESOURCES[id].kind !== "commentary") return res.status(404).json({ error: "That commentary isn't available.", kind: "not_found" });
  const p = passage(req.params, req.query); if (!p) return bad(res);
  const whole = req.query.from === undefined;
  try {
    const c = await getCommentaryChapter(id, p.book, p.chapter);
    return ok(res, { ...p, id, version: c.version, covered: c.covered, introduction: c.introduction,
      sections: whole ? c.sections : sectionsFor(c.sections, p.from, p.to), credit: creditFor(id) });
  } catch (e) { return fail(res, e); }
});

router.get("/compare/:book/:chapter", async (req, res) => {
  const p = passage(req.params, req.query); if (!p) return bad(res);
  try {
    const cat = await getStudyCatalogue();
    const wanted = req.query.ids ? new Set(String(req.query.ids).split(",").map((s) => s.trim())) : null;
    const list = cat.filter((e) => e.kind === "commentary" && isEligible(e.id) && (!wanted || wanted.has(e.id)));
    const results = await Promise.all(list.map(async (e) => {
      try {
        const c = await getCommentaryChapter(e.id, p.book, p.chapter);
        const sections = sectionsFor(c.sections, p.from, p.to);
        // Some commentaries put their notes on a chapter's opening verses in the chapter introduction
        // (e.g. Jamieson-Fausset-Brown on John 1:1): include it, labelled, when the passage starts before
        // the first section.
        const firstStart = c.sections[0]?.start ?? Infinity;
        const introduction = c.covered && c.introduction && p.from < firstStart ? c.introduction : null;
        return { ...resourceView(e), status: !c.covered ? "not_covered" : sections.length || introduction ? "ok" : "no_entry", sections, introduction };
      } catch (err) {
        return { ...resourceView(e), status: "unavailable", sections: [], introduction: null, error: err instanceof HelloAoError ? err.message : "Couldn't load this commentary." };
      }
    }));
    return ok(res, { ...p, commentaries: results });
  } catch (e) { return fail(res, e); }
});

// ── Biblical Dictionary (A–Z) — the same Strong's-numbered lexical records (lib/dictionary.ts) ──
//   GET /deep-study/dictionary                         — letters (real counts), sources, coverage
//   GET /deep-study/dictionary/browse?letter&offset&limit
//   GET /deep-study/dictionary/search?q&language&offset&limit
//   GET /deep-study/dictionary/term/:key               — an English headword and every record behind it
//   GET /deep-study/dictionary/record/:strongs         — one record's index data + its headwords
//   GET /deep-study/dictionary/record/:strongs/occurrences?offset&limit — verses, with the word form in each
//   GET /deep-study/dictionary/articles?letter&offset&limit — reference articles (Easton's 1897), A–Z
//   GET /deep-study/dictionary/article/:id             — one reference article, its passages and related words
const LEXICON_CREDIT = "The Translators Brief lexicons of Extended Strongs (TBESH and TBESG) are by STEPBible.org / Tyndale House, Cambridge, and are licensed under CC BY 4.0. Changes were made to the data to fit the Free Use Bible API format.";
const BSB_CREDIT = "The Berean Standard Bible and its interlinear tables are in the public domain. Changes were made to the data to fit the Free Use Bible API format.";
function dictionary(res: Response) {
  try { return getDictionary(); }
  catch { res.status(503).json({ error: "The dictionary isn't available right now.", kind: "unavailable" }); return null; }
}
const dictCredits = () => [creditFor("stepbible-lexicon", LEXICON_CREDIT), creditFor("bsb-interlinear", BSB_CREDIT)];
/** Reference articles are optional: without their index the dictionary still works, just without articles. */
function articles() { try { return getArticles(); } catch { return null; } }
const ARTICLE_NOTE = "A reference article from Easton's Bible Dictionary (1897), shown as published. It was written in 1897 and has not been revised since, so its dates, places and scholarship reflect that time. It is a separate source from the Hebrew and Greek lexicon.";
const int = (v: unknown, d: number, max: number) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : d; };
const dictLang = (v: unknown) => (["hebrew", "aramaic", "greek"].includes(String(v)) ? (String(v) as "hebrew" | "aramaic" | "greek") : null);

router.get("/dictionary", (_req, res) => {
  const d = dictionary(res); if (!d) return;
  const languages = (["hebrew", "aramaic", "greek"] as const).map((l) => ({ language: l, records: [...d.records.values()].filter((r) => r.language === l).length }));
  return ok(res, {
    letters: letterCounts(d), terms: d.sorted.length, records: d.records.size, languages,
    builtAt: d.header.builtAt, datasets: d.header.datasets.map((x) => ({ id: x.id, version: x.sha256.slice(0, 16) })),
    referenceSources: REFERENCE_SOURCES, credits: dictCredits(),
    articles: (() => { const a = articles(); return a ? { total: a.list.length, letters: articleLetters(a, LETTERS), credit: creditFor("easton"), note: ARTICLE_NOTE } : null; })(),
    note: "Headwords are the English glosses of the STEPBible brief lexicons. A gloss is a short meaning, not a full interpretation: each original word keeps its own entry, and its meaning in a verse depends on the verse.",
  });
});
router.get("/dictionary/browse", (req, res) => {
  const d = dictionary(res); if (!d) return;
  const letter = String(req.query.letter ?? "A").toUpperCase();
  if (!LETTERS.includes(letter)) return res.status(400).json({ error: "Choose a letter.", kind: "bad_request" });
  return ok(res, browse(d, letter, int(req.query.offset, 0, 100000), int(req.query.limit, 50, 100) || 50));
});
router.get("/dictionary/search", (req, res) => {
  const d = dictionary(res); if (!d) return;
  return ok(res, search(d, String(req.query.q ?? ""), { language: dictLang(req.query.language), offset: int(req.query.offset, 0, 100000), limit: int(req.query.limit, 30, 50) || 30, articles: articles() }));
});
router.get("/dictionary/term/:key", (req, res) => {
  const d = dictionary(res); if (!d) return;
  const t = termEntry(d, String(req.params.key).slice(0, 60));
  if (!t) return res.status(404).json({ error: "That word isn't in the dictionary.", kind: "not_found" });
  const a = articles();
  return ok(res, { ...t, credits: dictCredits(), articles: a ? articlesForTitle(a, t.key).map(articleSummary) : [],
    renderedNote: "Also translated with this word in the Berean Standard Bible: these original words have other dictionary meanings, but the BSB renders them this way in some verses." });
});
router.get("/dictionary/record/:strongs", (req, res) => {
  const d = dictionary(res); if (!d) return;
  const s = normaliseStrongs(String(req.params.strongs)); const r = s ? d.records.get(s.id) : null;
  if (!r) return res.status(404).json({ error: "This Strong's number has no entry in the brief lexicons.", kind: "not_found" });
  const terms = d.sorted.filter((t) => t.ids.includes(r.id)).map((t) => ({ key: t.key, display: t.display }));
  return ok(res, { record: recordView(r), terms, credits: dictCredits(),
    countsNote: "Counts come from the BSB interlinear: every word tagged with this Strong's number, in any form. They are not counts of an English word in any one translation." });
});
router.get("/dictionary/record/:strongs/occurrences", async (req, res) => {
  const d = dictionary(res); if (!d) return;
  const s = normaliseStrongs(String(req.params.strongs));
  const page = s ? occurrencePage(d, s.id, int(req.query.offset, 0, 100000), int(req.query.limit, 25, 50) || 25) : null;
  if (!page) return res.status(404).json({ error: "This Strong's number has no entry in the brief lexicons.", kind: "not_found" });
  // The word form in each verse, from the same (cached) interlinear chapters Deep Study uses.
  const chapters = new Map<string, Awaited<ReturnType<typeof getInterlinear>> | null>();
  for (const it of page.items) {
    const k = `${it.book}.${it.chapter}`;
    if (!chapters.has(k)) chapters.set(k, await getInterlinear(it.book, it.chapter).catch(() => null));
  }
  const items = page.items.map((it) => {
    const ch = chapters.get(`${it.book}.${it.chapter}`);
    const words = ch ? ch.verses.find((v) => v.verse === it.verse)?.words.filter((w) => w.strongs === page.id) ?? [] : null;
    return { ...it, bookName: bookByCode(it.book)?.name ?? it.book, forms: words?.map((w) => ({ wordId: w.id, text: w.text, transliteration: w.transliteration, parsing: w.parsing, gloss: w.gloss, language: w.language })) ?? null };
  });
  return ok(res, { ...page, items, credits: dictCredits(),
    note: "Each verse where this lemma appears in the BSB interlinear, with the actual word form used there." });
});

router.get("/dictionary/articles", (req, res) => {
  const a = articles(); if (!a) return res.status(503).json({ error: "Reference articles aren't available right now.", kind: "unavailable" });
  const letter = String(req.query.letter ?? "A").toUpperCase();
  if (!LETTERS.includes(letter)) return res.status(400).json({ error: "Choose a letter.", kind: "bad_request" });
  return ok(res, { ...browseArticles(a, letter, int(req.query.offset, 0, 100000), int(req.query.limit, 50, 100) || 50), credit: creditFor("easton") });
});
router.get("/dictionary/article/:id", (req, res) => {
  const a = articles(); if (!a) return res.status(503).json({ error: "Reference articles aren't available right now.", kind: "unavailable" });
  let d: ReturnType<typeof getDictionary> | null = null; try { d = getDictionary(); } catch { d = null; }
  const v = articleView(a, String(req.params.id).slice(0, 80).toLowerCase(), d);
  if (!v) return res.status(404).json({ error: "That article isn't in the dictionary.", kind: "not_found" });
  return ok(res, { ...v, credit: creditFor("easton"), credits: d ? dictCredits() : [], note: ARTICLE_NOTE,
    relatedNote: "Original-language words whose lexicon gloss is this article's headword. The lexicon, not the article, makes this link." });
});

export default router;
