// REFERENCE ARTICLES of the Biblical Dictionary — historical and theological entries (Pharisees,
// Sanhedrin, Septuagint, Covenant, Tabernacle …) from Easton's Bible Dictionary (1897), public domain
// (data/reference-easton.txt, built and licence-checked by scripts/build-reference-index.mjs).
//
// A separate entry type, never mixed with the lexical records (lib/dictionary.ts): an article has its own
// source and attribution, its own text (unchanged from the edition), the Scripture passages it cites, and —
// only where the lexicon itself says so — the original-language words whose lexicon gloss is the article's
// headword ("Covenant" → בְּרִית, διαθήκη). Nothing here is written by P2P or generated.
import articlesText from "../../data/reference-easton.txt";
import { bookByCode } from "./bibleReader";
import { latinKey, recordView, type Dictionary } from "./dictionary";

export type Segment = string | ["r", string | null, string] | ["s", string | null, string] | ["i", string];
export interface Article { id: string; key: string; title: string; letter: string; paragraphs: Segment[][]; plain: string; titleKey: string }
interface Source { id: string; name: string; author: string; edition: string; module: { name: string; version: string; date: string; from: string; url: string; download: string; sha256: string };
  textSource: string; licence: string; notice: string; verified: { on: string; at: string[] } }
export interface Articles { source: Source; builtAt: string; counts: Record<string, number>; list: Article[]; byId: Map<string, Article>; byTitle: Map<string, Article[]> }

const textOf = (p: Segment[]) => p.map((s) => (typeof s === "string" ? s : s[0] === "i" ? s[1] : s[2])).join("");
export function buildArticles(text: string): Articles {
  const { header, articles } = JSON.parse(text) as { header: { source: Source; builtAt: string; counts: Record<string, number> }; articles: [string, string, string, Segment[][]][] };
  const list = articles.map(([id, key, title, paragraphs]) => {
    const titleKey = latinKey(title);
    return { id, key, title, paragraphs, letter: /^[a-z]/.test(titleKey) ? titleKey[0].toUpperCase() : "#", titleKey, plain: paragraphs.map(textOf).join("\n") };
  });
  const byTitle = new Map<string, Article[]>();
  for (const a of list) byTitle.set(a.titleKey, [...(byTitle.get(a.titleKey) ?? []), a]);
  return { source: header.source, builtAt: header.builtAt, counts: header.counts, list, byId: new Map(list.map((a) => [a.id, a])), byTitle };
}
let loaded: Articles | null = null;
export const getArticles = () => (loaded ??= buildArticles(articlesText));

/** Spellings the EDITION ITSELF gives: Easton heads the entry "Sanhedrim" and writes "More correctly Sanhedrin". */
const EDITION_SPELLINGS: Record<string, string> = { sanhedrin: "sanhedrim" };
/** Headword forms tried for one query: as typed, the edition's own spelling, and singular/plural (Easton files "Pharisees"). */
export function titleForms(k: string): string[] {
  const forms = new Set([k, EDITION_SPELLINGS[k] ?? k, `${k}s`, `${k}es`]);
  if (k.endsWith("es")) forms.add(k.slice(0, -2));
  if (k.endsWith("s")) forms.add(k.slice(0, -1));
  return [...forms].filter(Boolean);
}
export function articlesForTitle(a: Articles, q: string): Article[] {
  const k = latinKey(q); if (!k) return [];
  return titleForms(k).flatMap((f) => a.byTitle.get(f) ?? []).filter((x, i, all) => all.indexOf(x) === i);
}

// ── Views ───────────────────────────────────────────────────────────────────
export function articleSummary(x: Article) {
  const preview = x.plain.replace(/\s+/g, " ").trim();
  return { type: "article" as const, id: x.id, title: x.title, letter: x.letter, source: "easton",
    preview: preview.length > 160 ? `${preview.slice(0, 157).replace(/\s+\S*$/, "")}…` : preview };
}
export function articleLetters(a: Articles, letters: string[]) {
  const c = new Map<string, number>(); for (const x of a.list) c.set(x.letter, (c.get(x.letter) ?? 0) + 1);
  return letters.map((letter) => ({ letter, count: c.get(letter) ?? 0 }));
}
export function browseArticles(a: Articles, letter: string, offset = 0, limit = 50) {
  const all = a.list.filter((x) => x.letter === letter);
  return { letter, total: all.length, offset, items: all.slice(offset, offset + limit).map(articleSummary) };
}

/** "JHN.7.48" / "ACT.23.6-8" / "GEN.1.1-2.3" / "GEN.15" → where it opens and how it reads. */
export function scriptureRef(ref: string) {
  const m = ref.match(/^([1-3A-Z]{3})\.(\d+)(?:\.(\d+)(?:-(\d+)(?:\.(\d+))?)?)?$/); if (!m) return null;
  const book = m[1], chapter = Number(m[2]), verse = m[3] ? Number(m[3]) : null;
  const endChapter = m[5] ? Number(m[4]) : null, endVerse = m[5] ? Number(m[5]) : m[4] ? Number(m[4]) : null;
  const name = bookByCode(book)?.name ?? book;
  const label = verse === null ? `${name} ${chapter}` : `${name} ${chapter}:${verse}${endChapter ? `–${endChapter}:${endVerse}` : endVerse ? `–${endVerse}` : ""}`;
  return { ref, book, chapter, verse, endChapter, endVerse, label };
}

/** One article: its paragraphs as published, the passages it cites (in the order cited, once each), its
 *  see-also articles, and the lexicon words glossed with its headword (kept apart from the article text). */
export function articleView(a: Articles, id: string, d: Dictionary | null) {
  const x = a.byId.get(id); if (!x) return null;
  const segs = x.paragraphs.flat();
  const cited = [...new Set(segs.flatMap((s) => (Array.isArray(s) && s[0] === "r" && s[1] ? [s[1]] : [])))];
  const seeIds = [...new Set(segs.flatMap((s) => (Array.isArray(s) && s[0] === "s" && s[1] && s[1] !== x.id ? [s[1]] : [])))];
  const lexical = d ? titleForms(x.titleKey).flatMap((f) => d.terms.get(f) ? [d.terms.get(f)!] : []).filter((t, i, all) => all.indexOf(t) === i) : [];
  return {
    type: "article" as const, id: x.id, title: x.title, letter: x.letter, paragraphs: x.paragraphs,
    scripture: cited.map(scriptureRef).filter(Boolean),
    seeAlso: seeIds.map((s) => a.byId.get(s)).filter(Boolean).map((s) => ({ id: s!.id, title: s!.title })),
    relatedWords: lexical.map((t) => ({ key: t.key, display: t.display,
      records: t.ids.map((rid) => d!.records.get(rid)).filter(Boolean).map((r) => { const v = recordView(r!); return { strongs: v.strongs, language: v.language, lemma: v.lemma, transliteration: v.transliteration, gloss: v.gloss }; }) })),
  };
}

/** Article hits for the dictionary search: 3 headword (as typed, the edition's spelling, singular/plural),
 *  5 headword starts with, 6 headword contains, 7 named in an article's text (whole word, ≥ 4 letters;
 *  the 25 articles naming it most often, most first — "targum" → Version, which describes the Targums). */
export function searchArticles(a: Articles, q: string) {
  const k = latinKey(q); if (!k) return [];
  const forms = new Set(titleForms(k)), hits = new Map<string, { a: Article; rank: number; matched: string; mentions: number }>();
  const add = (x: Article, rank: number, matched: string, mentions = 0) => { const h = hits.get(x.id); if (!h || rank < h.rank) hits.set(x.id, { a: x, rank, matched, mentions }); };
  const word = k.length >= 4 ? new RegExp(`\\b${k.replace(/[^a-z0-9 ]/g, "")}s?\\b`, "gi") : null;
  const named: { x: Article; n: number }[] = [];
  for (const x of a.list) {
    if (forms.has(x.titleKey)) add(x, 3, "article");
    else if (x.titleKey.startsWith(k)) add(x, 5, "article");
    else if (k.length >= 3 && x.titleKey.includes(k)) add(x, 6, "article");
    else if (word) { const n = x.plain.match(word)?.length ?? 0; if (n) named.push({ x, n }); }
  }
  for (const { x, n } of named.sort((p, q) => q.n - p.n).slice(0, 25)) add(x, 7, "article_text", n);
  return [...hits.values()];
}
