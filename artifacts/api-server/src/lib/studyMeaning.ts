// WHAT IT MEANS — definitions at the top of a My Plan search (owner 2026-11-18: "the lordship of Jesus" must show
// what Lordship means, who Jesus is, and both together; "grace of God" → grace, God, and the grace of God).
// Definitions ONLY, never generated text (owner: "I don't need an AI summary, just add definitions"):
//   • each word: the Easton's Bible Dictionary entry for it (or, said plainly, for its root: Lordship → "Lord"),
//     its main Hebrew / Greek words from the STEPBible lexicons, and the first verses that contain it;
//   • together: Easton's entry for the whole phrase when the edition has one ("Kingdom of God", "Holy Ghost"),
//     the sentences in those entries that join the words (Easton on Grace: "(3.) God's forgiving mercy …"), and
//     verses in which all the words stand together — each with its source.
import { articlesForTitle, searchArticles, type Article, type Articles } from "./referenceArticles";
import { latinKey, type Dictionary } from "./dictionary";
import { stems } from "./studySearch";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]s\b/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
/** Words that never carry the subject of a search ("what does the Bible say about grace" → grace). */
const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "at", "by", "for", "from", "with", "and", "or", "but", "is", "are", "was", "be", "being", "been", "am",
  "what", "who", "whom", "why", "how", "when", "where", "which", "does", "do", "did", "can", "could", "should", "would", "will", "shall", "may", "must",
  "my", "me", "i", "we", "us", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its", "they", "them", "their", "this", "that", "these", "those",
  "about", "mean", "means", "meaning", "say", "says", "said", "teach", "teaches", "bible", "scripture", "scriptures", "verse", "verses", "tell", "show", "all",
  "into", "as", "so", "than", "then", "there", "here", "also", "not", "no", "yes", "according", "concerning", "regarding"]);
/** The edition's own headword for a phrase people type differently (Easton files the Holy Spirit as "Holy Ghost"). */
const EDITION_NAMES: Record<string, string> = { "holy spirit": "holy ghost", "spirit of god": "holy ghost", "lords supper": "lord s supper" };
const SOURCE_EASTON = "Easton's Bible Dictionary (1897, public domain)";
const SOURCE_LEX = "STEPBible lexicons (TBESH / TBESG, CC BY 4.0)";

/** The subject words of a search, in order (max 4): "the lordship of Jesus" → lordship, jesus. */
export function meaningTerms(q: string): string[] {
  const out: string[] = [];
  for (const w of fold(q).split(" ")) if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !out.includes(w)) out.push(w);
  return out.slice(0, 4);
}
/** Forms of a word that count as the same word in a sentence or verse (lordship ↔ lord, sins ↔ sin). */
export function formsOf(term: string): string[] {
  const f = new Set([term, ...stems(term), `${term}s`, `${term}es`]);
  if (term.endsWith("y")) f.add(`${term.slice(0, -1)}ies`);
  return [...f].filter((x) => x.length >= 3);
}
const hasForm = (words: Set<string>, term: string) => formsOf(term).some((f) => words.has(f));

const segText = (p: Article["paragraphs"][number]) => p.map((s) => (typeof s === "string" ? s : s[0] === "i" ? s[1] : s[2])).join("").replace(/\s+/g, " ").trim();
/** The opening of an entry: whole paragraphs from the start, skipping one-line notes about other people of the same
 *  name ("(1.) Joshua, the son of Nun"), up to ~450 characters, cut at a sentence end. Text unchanged from the edition. */
export function excerptOf(a: Article, max = 650): string {
  const paras = a.paragraphs.map(segText).filter(Boolean);
  const body = paras.filter((p) => p.length >= 100);
  const use = body.length ? body : paras;
  let out = "";
  for (const p of use) { if (out && out.length + p.length > max) break; out = out ? `${out} ${p}` : p; if (out.length >= 450) break; }
  if (out.length > max) { const cut = out.slice(0, max); const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("). ")); out = end > 200 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`; }
  return out;
}
/** Sentences of an entry (abbreviations such as "Heb.", "Gen. 6:8", "comp.", "R.V." and "(1.)" kept intact; a
 *  numbered sense "(3.) …" starts its own sentence). */
export function sentencesOf(a: Article): string[] {
  const out: string[] = [];
  for (const p of a.paragraphs.map(segText)) {
    const parts = p.split(/(?<=[.!?]|[.!?]”)\s+(?=[A-Z“(])/);
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur} ${part}` : part;
      const lastWord = cur.split(" ").at(-1) ?? "";
      const abbrev = /^(\(?[A-Z][a-z]{0,3}\.|[a-z]{1,4}\.|[A-Z]\.[A-Z]\.|\(\d+\.\)|q\.v\.|i\.e\.|viz\.:?|comp\.)$/.test(lastWord) && !/^[a-z]{5,}\.$/.test(lastWord);
      if (!abbrev) { out.push(cur); cur = ""; }
    }
    if (cur) out.push(cur);
  }
  return out.flatMap((s) => s.split(/\s(?=\(\d+\.\)\s)/)).map((s) => s.trim())
    // never a scrap of references ("(Matt. 13:41; 20:21) = …") as a sentence of its own
    .filter((s) => s.length >= 12 && (!s.startsWith("(") || /^\(\d+\.\)/.test(s)) && /[a-z]{3,}/.test(s.replace(/\([^)]*\)/g, "")));
}

export type ArticleRef = { id: string; title: string; excerpt: string; source: string;
  /** "root" = no entry for the word itself, this is the entry for its root (Lordship → Lord); "phrase" = an entry that starts with the word. */
  via: "word" | "root" | "phrase" };
/** Easton's entry for one word: the word itself, then its root, then the shortest entry that starts with it. */
export function articleFor(arts: Articles, term: string): ArticleRef | null {
  const pick = (list: Article[], via: ArticleRef["via"]) => {
    const a = [...list].sort((x, y) => y.plain.length - x.plain.length)[0];
    return a ? { id: a.id, title: a.title, excerpt: excerptOf(a), source: SOURCE_EASTON, via } : null;
  };
  const own = articlesForTitle(arts, term);
  if (own.length) return pick(own, "word");
  for (const st of stems(term)) { if (st.length < 3 || !/(ship|ness|ment|ing|ed|s)$/.test(term)) continue; const r = articlesForTitle(arts, st); if (r.length) return pick(r, "root"); }
  // The noun the edition files it under (holy → Holiness).
  for (const n of [`${term.replace(/y$/, "i")}ness`, `${term}ness`]) { const r = articlesForTitle(arts, n); if (r.length) return pick(r, "root"); }
  const starts = searchArticles(arts, term).filter((h) => h.rank === 5).map((h) => h.a).sort((x, y) => x.title.length - y.title.length);
  return starts[0] ? pick([starts[0]], "phrase") : null;
}

export type OriginalWord = { strongs: string; lemma: string; transliteration: string; gloss: string; language: string; uses: number };
/** The main Hebrew / Greek words for an English word (exact headword in the lexicon, most used first; up to 3). */
export function originalWordsFor(d: Dictionary, term: string): { key: string | null; words: OriginalWord[] } {
  for (const f of [term, ...stems(term)]) {
    const t = d.terms.get(latinKey(f));
    if (!t) continue;
    const words = t.ids.map((id) => d.records.get(id)).filter((r): r is NonNullable<typeof r> => !!r && r.words > 0)
      .sort((a, b) => b.words - a.words).slice(0, 3)
      .map((r) => ({ strongs: r.id, lemma: r.lemma, transliteration: r.transliteration, gloss: r.gloss, language: r.language, uses: r.words }));
    if (words.length) return { key: t.key, words };
  }
  return { key: null, words: [] };
}

export type Verse = { reference: string; text: string; book: string; chapter: number; verse: number };
export type VerseSearch = { translation: string; total: number; searchedAs: string; results: { bookCode: string; chapter: number; verse: number; reference: string; text: string }[] } | null;
/** How far apart the words stand in a verse (fewest words between the first and last of them); 0 = one word. */
export function spread(text: string, terms: string[]): number {
  const w = fold(text).split(" ");
  const at = terms.map((t) => w.flatMap((x, i) => (formsOf(t).includes(x) ? [i] : [])));
  if (terms.length < 2 || at.some((a) => !a.length)) return 0;
  let best = Infinity;
  for (const i of at[0]) { const far = at.slice(1).map((a) => Math.min(...a.map((j) => Math.abs(j - i)))); best = Math.min(best, Math.max(...far)); }
  return best;
}
const versesOf = (vs: VerseSearch, max: number, mustHave: string[] = [], phrase = "", also: string[] = []): Verse[] => (vs?.results ?? [])
  .filter((r) => { const w = new Set(fold(r.text).split(" ")); return mustHave.every((t) => hasForm(w, t)); })
  // the exact phrase first ("the grace of God", "holy Spirit"), then the words standing closest together
  // ("Christ Jesus the Lord" before a verse that names them far apart), then the search's own order
  .map((r, i) => ({ r, i, exact: [phrase, ...also].some((ph) => !!ph && ` ${fold(r.text)} `.includes(` ${ph} `)), near: Math.min(spread(r.text, mustHave), 6) }))
  .sort((a, b) => Number(b.exact) - Number(a.exact) || a.near - b.near || a.i - b.i).map((x) => x.r)
  .slice(0, max).map((r) => ({ reference: r.reference, text: r.text, book: r.bookCode, chapter: r.chapter, verse: r.verse }));

export interface TermMeaning {
  term: string; article: ArticleRef | null; original: OriginalWord[]; originalSource: string; dictionaryKey: string | null;
  verses: Verse[]; verseTotal: number | null; translation: string | null; searchedAs: string;
}
export interface Together {
  phrase: string;
  /** Easton's entry for the whole phrase, when the edition has one. */
  article: ArticleRef | null;
  /** Sentences in these entries that join the words — exactly as the edition has them. */
  sentences: { text: string; article: string; articleId: string; source: string }[];
  /** Verses in which every word stands together. */
  verses: Verse[]; translation: string | null; searchedAs: string;
}
export interface Meaning { terms: TermMeaning[]; together: Together | null }

/** Easton's entry for the longest run of the search's own words that the edition has as a headword ("kingdom of god"). */
export function phraseArticle(arts: Articles, q: string): ArticleRef | null {
  const words = fold(q).split(" ").filter((w) => !["the", "a", "an", "what", "is", "does", "mean", "meaning"].includes(w));
  for (let len = Math.min(5, words.length); len >= 2; len--) for (let i = 0; i + len <= words.length; i++) {
    const span = words.slice(i, i + len);
    if (STOP.has(span[0]) || STOP.has(span[len - 1])) continue;
    const phrase = span.join(" ");
    const list = articlesForTitle(arts, EDITION_NAMES[phrase] ?? phrase);
    if (list.length) { const a = list[0]; return { id: a.id, title: a.title, excerpt: excerptOf(a, 900), source: SOURCE_EASTON, via: "word" }; }
  }
  return null;
}

/** Builds the definitions (pure: the route supplies the data and the verse searches). */
export function buildMeaning(inp: { q: string; articles: Articles; dict: Dictionary; termVerses: Record<string, VerseSearch>; togetherVerses: VerseSearch }): Meaning | null {
  const terms = meaningTerms(inp.q);
  if (!terms.length) return null;
  const out: TermMeaning[] = terms.map((term) => {
    const ow = originalWordsFor(inp.dict, term);
    const vs = inp.termVerses[term] ?? null;
    return { term, article: articleFor(inp.articles, term), original: ow.words, originalSource: SOURCE_LEX, dictionaryKey: ow.key,
      verses: versesOf(vs, 3), verseTotal: vs ? vs.total : null, translation: vs?.translation ?? null, searchedAs: vs?.searchedAs ?? term };
  });
  let together: Together | null = null;
  if (terms.length >= 2 || phraseArticle(inp.articles, inp.q)) {
    const phrase = phraseArticle(inp.articles, inp.q);
    const sentences: Together["sentences"] = [];
    const seen = new Set<string>();
    const fromArticle = (a: Article, own: string | null) => {
      for (const sx of sentencesOf(a)) {
        const w = new Set(fold(sx).split(" "));
        // A sentence joins the words when it names every OTHER word of the search (and, for a phrase entry, any of them).
        const others = terms.filter((t) => t !== own);
        if (!others.length || !others.every((t) => hasForm(w, t)) || seen.has(sx)) continue;
        seen.add(sx);
        sentences.push({ text: sx.length > 360 ? `${sx.slice(0, 357).replace(/\s+\S*$/, "")}…` : sx, article: a.title, articleId: a.id, source: SOURCE_EASTON });
        if (sentences.length >= 5) return;
      }
    };
    // The phrase entry is shown whole; the joining sentences come from the entries for each word.
    for (const tm of out) if (tm.article && tm.article.id !== phrase?.id && sentences.length < 5) { const a = inp.articles.byId.get(tm.article.id); if (a) fromArticle(a, tm.term); }
    const tv = inp.togetherVerses;
    // "the lordship of Jesus" is confessed as "Jesus Christ is Lord" (Phil. 2:11): those verses first too.
    const root = /(ship|ness|ment)$/.test(terms[0] ?? "") ? stems(terms[0])[0] : null;
    const confess = root && terms.length === 2 ? [`is ${root}`] : [];
    together = { phrase: inp.q.trim(), article: phrase, sentences,
      verses: versesOf(tv, 5, terms.length >= 2 ? terms : [], fold(inp.q).split(" ").filter((w, i, a) => !(STOP.has(w) && (i === 0 || i === a.length - 1))).join(" "), confess),
      translation: tv?.translation ?? null, searchedAs: tv?.searchedAs ?? inp.q.trim() };
  }
  return { terms: out, together };
}
/** The Bible-text query that finds the words together: the search as typed, then its subject words (roots if needed). */
export function togetherQueries(q: string): string[] {
  const terms = meaningTerms(q);
  // Only true word-building endings give a root (lordship → lord, forgiveness → forgive); never "jesus" → "jesu".
  const roots = terms.map((t) => (/(ship|ness|ment)$/.test(t) ? stems(t).find((s) => s.length >= 3) ?? t : t));
  // "the lordship of Jesus" is said in Scripture as "Jesus … is Lord": the subject, then "is", then the root.
  const confess = terms.length === 2 && roots[0] !== terms[0] ? [`${terms[1]} is ${roots[0]}`] : [];
  return [q.trim(), ...confess, terms.join(" "), roots.join(" ")].filter((x, i, a) => x.length >= 2 && a.indexOf(x) === i);
}
