// BIBLICAL DICTIONARY (A–Z) — search, alphabetical browsing and occurrence lookup over ONE canonical
// lexical identity: the Strong's-numbered records of the STEPBible Brief Lexicons that Deep Study and
// Study Tools already use. Nothing here is a second lexicon: the index (data/dictionary-index.txt, built
// by scripts/build-dictionary-index.mjs from the same provider) holds only ids, lemmas, transliterations,
// short glosses and where each lemma occurs in the BSB interlinear. Full definitions are always the live
// lexicon entry (GET /deep-study/lexicon/:strongs).
//
// Two kinds of index rows, never mixed:
//   • record — one original-language lexical record (Hebrew, Aramaic or Greek), by Strong's number;
//   • term   — an English headword (from the lexicon's own glosses) that leads to every record glossed
//              with it — so "love" lists ἀγάπη, ἀγαπάω, φιλέω, אָהַב … SEPARATELY, never merged.
// Historical/theological reference ARTICLES (Pharisees, Septuagint …) are a third, separate entry type
// from a licensed reference source (lib/referenceArticles.ts — Easton's 1897, public domain); search lists
// them alongside, labelled, never merged into a record or a term.
import indexText from "../../data/dictionary-index.txt";
import { normaliseStrongs, plainScript } from "./bibleProviders/helloaoStudy";
import { articleSummary, searchArticles, type Articles } from "./referenceArticles";

export type Lang = "hebrew" | "aramaic" | "greek";
const LANG: Record<string, Lang> = { h: "hebrew", a: "aramaic", g: "greek" };
export interface DictRecord {
  id: string; language: Lang; lemma: string; transliteration: string; gloss: string; partOfSpeech: string;
  /** Lettered senses (H1254A "to create", H1254B "to fatten") — homonyms kept apart. */
  senses: { id: string; gloss: string }[];
  /** Words in the BSB interlinear tagged with this Strong's number (every form of the lemma). */
  words: number;
  /** How the BSB renders it in context, most frequent first (a translation choice, not a definition). */
  renderings: { text: string; count: number }[];
  /** Languages of the verses it occurs in (e.g. a Hebrew lemma used in the Aramaic of Daniel). */
  occurrenceLanguages: Lang[];
  refs: string;
  /** search keys */
  plain: string; latin: string;
}
export interface Term { key: string; display: string; letter: string; ids: string[] }
export interface Dictionary {
  header: { builtAt: string; datasets: { id: string; sha256: string; licenseUrl: string; licenseNotes: string }[]; books: string[]; counts: Record<string, number> };
  records: Map<string, DictRecord>;
  terms: Map<string, Term>;
  /** terms in alphabetical order (English collation) */
  sorted: Term[];
}

/** Latin-script search key: lower case, accents and transliteration marks removed (agapē → agape, ba.ra' → bara). */
export const latinKey = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[.'ʼʾʿ`´‘’\-]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const HEBREW = /[֐-׿]/, GREEK = /[Ͱ-Ͽἀ-῿]/;
const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** English headwords from one gloss: variants split on , ; : — ("to love: lover" → love, lover), a
 *  leading "to " dropped ("to create" → "create") and a leading article dropped ("a bag" → "bag"), so
 *  words file under their own letter. */
export function headwords(gloss: string): string[] {
  return gloss.split(/[;,:]|\s—\s/).map((g) => g.replace(/\(.*?\)|\[.*?\]/g, "").trim().replace(/^to\s+/i, "").replace(/^(a|an|the)\s+/i, "").trim())
    .filter((g) => g.length > 0 && g.length <= 40 && /\p{L}/u.test(g));
}

export function buildDictionary(text: string): Dictionary {
  const { header, records } = JSON.parse(text) as { header: Dictionary["header"]; records: unknown[][] };
  const recs = new Map<string, DictRecord>(), terms = new Map<string, Term>();
  for (const r of records) {
    const [id, lang, lemma, translit, gloss, pos, senses, words, refs, renders, occLangs] = r as [string, string, string, string, string, string, string, number, string, string, string];
    const language = LANG[lang]; if (!language) continue;
    const rec: DictRecord = {
      id, language, lemma, transliteration: translit, gloss, partOfSpeech: pos,
      senses: senses ? senses.split("|").map((s) => { const [suf, g] = s.split("="); return { id: suf === "-" ? id : id + suf, gloss: g ?? "" }; }) : [],
      words, refs, occurrenceLanguages: [...occLangs].map((c) => LANG[c]).filter(Boolean),
      renderings: renders ? renders.split("|").map((x) => { const i = x.lastIndexOf(":"); return { text: x.slice(0, i), count: Number(x.slice(i + 1)) }; }) : [],
      plain: plainScript(lemma), latin: latinKey(translit),
    };
    recs.set(id, rec);
    for (const g of new Set([gloss, ...rec.senses.map((s) => s.gloss)].flatMap(headwords))) {
      const key = latinKey(g); if (!key) continue;
      let t = terms.get(key);
      if (!t) terms.set(key, (t = { key, display: g, letter: /^[a-z]/.test(key) ? key[0].toUpperCase() : "#", ids: [] }));
      if (!t.ids.includes(id)) t.ids.push(id);
    }
  }
  const sorted = [...terms.values()].sort((a, b) => collator.compare(a.key, b.key));
  return { header, records: recs, terms, sorted };
}

let loaded: Dictionary | null = null;
/** Parsed once, on first use (the index ships inside the server bundle). */
export const getDictionary = () => (loaded ??= buildDictionary(indexText));

// ── A–Z ─────────────────────────────────────────────────────────────────────
export const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "#"];
export function letterCounts(d: Dictionary) {
  const c = new Map<string, number>(); for (const t of d.sorted) c.set(t.letter, (c.get(t.letter) ?? 0) + 1);
  return LETTERS.map((letter) => ({ letter, count: c.get(letter) ?? 0 }));
}
export function browse(d: Dictionary, letter: string, offset = 0, limit = 50) {
  const all = d.sorted.filter((t) => t.letter === letter);
  return { letter, total: all.length, offset, items: all.slice(offset, offset + limit).map((t) => termSummary(d, t)) };
}

// ── Views ───────────────────────────────────────────────────────────────────
const LANG_ORDER: Lang[] = ["hebrew", "aramaic", "greek"];
export function recordView(r: DictRecord) {
  const { refs: _r, plain: _p, latin: _l, ...rest } = r;
  return { ...rest, strongs: r.id, verses: countVerses(r.refs) };
}
export function termSummary(d: Dictionary, t: Term) {
  const recs = t.ids.map((id) => d.records.get(id)!).filter(Boolean);
  return { type: "term" as const, key: t.key, display: t.display, letter: t.letter, records: recs.length,
    languages: LANG_ORDER.map((l) => ({ language: l, count: recs.filter((r) => r.language === l).length })).filter((x) => x.count),
    preview: recs.sort(byUse).slice(0, 3).map((r) => ({ id: r.id, language: r.language, lemma: r.lemma, transliteration: r.transliteration })) };
}
const byUse = (a: DictRecord, b: DictRecord) => b.words - a.words || a.id.localeCompare(b.id);

/** One headword: every record glossed with it (kept separate), plus records the BSB RENDERS with that word. */
export function termEntry(d: Dictionary, key: string) {
  const t = d.terms.get(latinKey(key)); if (!t) return null;
  const records = t.ids.map((id) => d.records.get(id)!).filter(Boolean)
    .sort((a, b) => LANG_ORDER.indexOf(a.language) - LANG_ORDER.indexOf(b.language) || byUse(a, b));
  const k = t.key, own = new Set(t.ids);
  const renderedAs = [...d.records.values()].flatMap((r) => {
    if (own.has(r.id)) return [];
    const hit = r.renderings.find((x) => latinKey(x.text) === k);
    return hit ? [{ ...recordView(r), renderCount: hit.count }] : [];
  }).sort((a, b) => b.renderCount - a.renderCount).slice(0, 12);
  return { key: t.key, display: t.display, letter: t.letter, records: records.map(recordView), renderedAs };
}

// ── Search ──────────────────────────────────────────────────────────────────
export type SearchItem = (ReturnType<typeof termSummary> | (ReturnType<typeof recordView> & { type: "record" }) | (ReturnType<typeof articleSummary> & { mentions?: number })) & { rank: number; matched: string };
/**
 * One search box for every method: Strong's number, Hebrew/Aramaic or Greek letters (points and accents
 * ignored for matching, kept for display), transliteration, and English headwords. Ranking (brief §5):
 * 1 exact original-language, 2 exact Strong's, 3 exact English gloss, 4 exact transliteration or BSB
 * rendering, 5 starts-with, 6 contains; reference articles also 7 (named in an article's text). Each
 * record, term or article appears once.
 */
export function search(d: Dictionary, qRaw: string, opts: { language?: Lang | null; offset?: number; limit?: number; articles?: Articles | null } = {}) {
  const q = qRaw.normalize("NFC").trim().slice(0, 60);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 30)), offset = Math.max(0, opts.offset ?? 0);
  const best = new Map<string, SearchItem>();
  const add = (key: string, item: SearchItem) => { const b = best.get(key); if (!b || item.rank < b.rank) best.set(key, item); };
  const rec = (r: DictRecord, rank: number, matched: string) => add("r:" + r.id, { type: "record", ...recordView(r), rank, matched });
  const langOk = (r: DictRecord) => !opts.language || r.language === opts.language;
  let mode: "strongs" | "hebrew" | "greek" | "english" | "empty" = "english";
  if (!q) mode = "empty";
  else if (normaliseStrongs(q)) {
    mode = "strongs";
    const s = normaliseStrongs(q)!; const r = d.records.get(s.id); if (r) rec(r, 2, "strongs");
  } else if (HEBREW.test(q) || GREEK.test(q)) {
    mode = HEBREW.test(q) ? "hebrew" : "greek";
    const p = plainScript(q);
    if (p) for (const r of d.records.values()) {
      if (!langOk(r) || (mode === "hebrew") !== (r.language !== "greek")) continue;
      if (r.plain === p) rec(r, 1, "original"); else if (r.plain.startsWith(p)) rec(r, 5, "original"); else if (p.length >= 2 && r.plain.includes(p)) rec(r, 6, "original");
    }
  } else {
    const k = latinKey(q);
    if (k) {
      for (const t of d.terms.values()) {
        if (opts.language && !t.ids.some((id) => d.records.get(id)?.language === opts.language)) continue;
        const rank = t.key === k ? 3 : t.key.startsWith(k) ? 5 : k.length >= 3 && t.key.includes(k) ? 6 : 0;
        if (rank) add("t:" + t.key, { ...termSummary(d, t), rank, matched: "english" });
      }
      for (const r of d.records.values()) {
        if (!langOk(r)) continue;
        if (r.latin === k) rec(r, 4, "transliteration");
        else if (r.renderings.some((x) => latinKey(x.text) === k)) rec(r, 4, "rendering");
        else if (k.length >= 2 && r.latin.startsWith(k)) rec(r, 5, "transliteration");
      }
      // Reference articles: English only, and not when a Hebrew/Aramaic/Greek filter is chosen.
      if (opts.articles && !opts.language) for (const h of searchArticles(opts.articles, q)) add("a:" + h.a.id, { ...articleSummary(h.a), rank: h.rank, matched: h.matched, mentions: h.mentions });
    }
  }
  // A record already listed under an exactly-matching headword isn't repeated as a row of its own.
  const underExact = new Set([...best.values()].flatMap((i) => (i.type === "term" && i.rank === 3 ? d.terms.get(i.key)?.ids ?? [] : [])));
  for (const [k, i] of best) if (i.type === "record" && i.rank > 3 && underExact.has(i.strongs)) best.delete(k);
  // Within a rank: records by how often they are used, then headwords, then reference articles (those
  // naming the word most often first).
  const weight = (i: SearchItem) => (i.type === "term" ? 0 : i.type === "article" ? 1 - (i.mentions ?? 0) / 1e4 : -(i as { words: number }).words);
  const name = (i: SearchItem) => (i.type === "term" ? i.display : i.type === "article" ? i.title : i.lemma);
  const all = [...best.values()].sort((a, b) => a.rank - b.rank || weight(a) - weight(b) || collator.compare(name(a), name(b)));
  return { q, mode, total: all.length, offset, items: all.slice(offset, offset + limit) };
}

// ── Occurrences ─────────────────────────────────────────────────────────────
export function decodeRefs(enc: string): number[] {
  if (!enc) return [];
  let acc = 0; return enc.split(",").map((x) => (acc += parseInt(x, 36)));
}
const countVerses = (enc: string) => (enc ? enc.split(",").length : 0);
/** A page of the verses a lemma occurs in (canonical book / chapter / verse). */
export function occurrencePage(d: Dictionary, id: string, offset = 0, limit = 25) {
  const r = d.records.get(id); if (!r) return null;
  const all = decodeRefs(r.refs);
  const page = all.slice(offset, offset + Math.min(50, Math.max(1, limit))).map((n) => ({
    book: d.header.books[Math.floor(n / 1_000_000) - 1] ?? null, chapter: Math.floor(n / 1000) % 1000, verse: n % 1000,
  })).filter((x) => !!x.book) as { book: string; chapter: number; verse: number }[];
  return { id, words: r.words, verses: all.length, offset, items: page };
}

/** Licensed sources for historical/theological reference articles (each verified at its primary source). */
export const REFERENCE_SOURCES: { id: string; name: string; status: "approved" | "pending_licence_review" }[] = [
  { id: "easton", name: "Easton's Bible Dictionary (1897)", status: "approved" },
];
