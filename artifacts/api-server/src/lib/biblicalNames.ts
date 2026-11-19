// BIBLICAL NAMES, TITLES AND DESCRIPTIONS (owner brief 2026-11-18). Serves the VERIFIED data built by
// scripts/build-biblical-names.mjs from data/biblical-names/register.txt:
//   • Scripture wording checked in five public-domain translations (BSB, KJV, ASV, WEB, YLT — bible.helloao.org);
//   • Hebrew / Aramaic / Greek from the STEPBible lexicons (lemma, transliteration, gloss, use count) with the BSB
//     interlinear tagging that shows the word in the primary verse;
//   • Easton's Bible Dictionary links (and excerpts, unchanged).
// "note" and "interp" texts are P2P study notes (owner 2026-11-19: no draft label; fields kept empty for older app builds).
// One canonical record per expression: it can sit in several collections (sections) without being duplicated.
import namesText from "../../data/biblical-names.txt";
import { getArticles } from "./referenceArticles";
import { excerptOf } from "./studyMeaning";

export type Person = "father" | "son" | "spirit" | "god";
export type Kind = "name" | "title" | "description" | "metaphor" | "attribute" | "form" | "devotional" | "worship";
export type Section = "father" | "son" | "spirit" | "god" | "attributes" | "devotional" | "original" | "history";
interface Ref { book: string; chapter: number; start: number; end: number; display: string; testament: "OT" | "NT"; connected: boolean; person: Person | null; matched: string[]; text?: string }
export interface NameEntry {
  id: string; name: string; also: string[]; kind: Kind; persons: Person[]; sections: Exclude<Section, "original" | "history">[];
  primary: (Ref & { texts: Record<string, string> }) | null; refs: Ref[];
  original: { strongs: string; lemma: string; transliteration: string; gloss: string; language: "hebrew" | "aramaic" | "greek"; uses: number; inPrimary: boolean; occurrences: number }[];
  aramaicWord: { source: string; quote: string } | null;
  easton: { id: string; title: string } | null; note: string | null; interp: string | null; issues: string[];
  testaments: ("OT" | "NT")[]; languages: string[]; status: "verified" | "needs_verification" | "no_scripture_wording";
}
interface Data { builtAt: string; sources: { bible: { label: string; name: string; licence: string }[]; lexicon: { id: string; licence: string }[]; easton: { name: string; licence: string } }; counts: Record<string, unknown>; entries: NameEntry[] }
let loaded: Data | null = null;
export const getNames = (): Data => (loaded ??= JSON.parse(namesText) as Data);

export const SECTIONS: { key: Section; title: string }[] = [
  { key: "father", title: "Names of God the Father" }, { key: "son", title: "Names and Titles of Jesus Christ" },
  { key: "spirit", title: "Names and Titles of the Holy Spirit" }, { key: "god", title: "Names of God (persons not distinguished, or context-dependent)" },
  { key: "attributes", title: "Biblical Descriptions and Attributes of God" }, { key: "devotional", title: "Devotional and Worship Expressions" },
  { key: "original", title: "Names in the Original Languages" }, { key: "history", title: "Historical and Cultural Background" },
];
const KIND_ORDER: Kind[] = ["name", "title", "form", "description", "attribute", "metaphor", "devotional", "worship"];
const inSection = (e: NameEntry, s: Section) => s === "original" ? e.original.length > 0 || !!e.aramaicWord : s === "history" ? !!e.easton || !!e.note : (e.sections as string[]).includes(s);
const fold = (s: string) => ` ${s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[’‘'`]/g, "").replace(/[^a-z0-9α-ωא-ת]+/g, " ").trim()} `;
const canon = (e: NameEntry) => (e.primary ? (e.primary.testament === "OT" ? 0 : 1) * 1e9 : 3e9) + (e.primary ? BOOK_INDEX(e.primary.book) * 1e6 + e.primary.chapter * 1e3 + e.primary.start : 0);
const BOOKS = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"];
const BOOK_INDEX = (b: string) => BOOKS.indexOf(b);

/** The short form used in lists and in the search panel. */
export function summary(e: NameEntry) {
  return { id: e.id, name: e.name, kind: e.kind, persons: e.persons, sections: SECTIONS.filter((s) => inSection(e, s.key)).map((s) => s.key),
    original: e.original.slice(0, 3).map((o) => ({ lemma: o.lemma, transliteration: o.transliteration, language: o.language, strongs: o.strongs })),
    primary: e.primary ? { display: e.primary.display, book: e.primary.book, chapter: e.primary.chapter, start: e.primary.start, end: e.primary.end, testament: e.primary.testament } : null,
    testaments: e.testaments, languages: e.languages, status: e.status, interpretive: false }; // badge removed (owner 2026-11-19)
}

export interface CollectionQuery { section?: Section | null; person?: Person | null; language?: string | null; testament?: "OT" | "NT" | null; kind?: Kind | null; interpretive?: boolean; q?: string | null; sort?: "canon" | "language" | "category" | "alpha" }
/** A collection with filters and sorting. Facets count only what the current section holds, so the screen shows
 *  only filters that have entries. */
export function collection(cq: CollectionQuery) {
  const all = getNames().entries;
  const base = cq.section ? all.filter((e) => inSection(e, cq.section!)) : all;
  const qf = cq.q ? fold(cq.q) : null;
  const list = base.filter((e) => (!cq.person || e.persons.includes(cq.person)) && (!cq.language || e.languages.includes(cq.language))
    && (!cq.testament || e.testaments.includes(cq.testament)) && (!cq.kind || e.kind === cq.kind) && (!cq.interpretive || !!e.interp)
    && (!qf || fold([e.name, ...e.also, ...e.original.map((o) => `${o.lemma} ${o.transliteration}`)].join(" ")).includes(qf.trim())));
  const sort = cq.sort ?? "canon";
  const langRank = (e: NameEntry) => (e.languages.includes("hebrew") ? 0 : e.languages.includes("aramaic") ? 1 : e.languages.includes("greek") ? 2 : 3);
  list.sort((a, b) => sort === "alpha" ? a.name.localeCompare(b.name)
    : sort === "language" ? langRank(a) - langRank(b) || canon(a) - canon(b)
    : sort === "category" ? KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name)
    : canon(a) - canon(b) || a.name.localeCompare(b.name));
  const count = (f: (e: NameEntry) => boolean) => base.filter(f).length;
  const facets = {
    person: (["father", "son", "spirit", "god"] as Person[]).map((p) => ({ key: p, count: count((e) => e.persons.includes(p)) })).filter((x) => x.count),
    language: ["hebrew", "aramaic", "greek"].map((l) => ({ key: l, count: count((e) => e.languages.includes(l)) })).filter((x) => x.count),
    testament: (["OT", "NT"] as const).map((t) => ({ key: t, count: count((e) => e.testaments.includes(t)) })).filter((x) => x.count),
    kind: KIND_ORDER.map((k) => ({ key: k, count: count((e) => e.kind === k) })).filter((x) => x.count),
    interpretive: 0, // filter removed (owner 2026-11-19)
  };
  return { section: cq.section ?? null, title: SECTIONS.find((s) => s.key === cq.section)?.title ?? "All biblical names, titles and descriptions", total: list.length,
    sectionTotal: base.length, entries: list.map(summary), facets, sections: SECTIONS.map((s) => ({ ...s, count: all.filter((e) => inSection(e, s.key)).length })), about: about() };
}

/** Sources and coverage — what the collection rests on, and that it is not claimed to be exhaustive. */
export function about() {
  const d = getNames();
  return { builtAt: d.builtAt, sources: d.sources, counts: d.counts,
    coverage: "Every entry is checked against the Bible text and the lexicon; the collection grows as P2P editors add verified entries. It is not claimed to be exhaustive.",
    notesStatus: "" };
}

/** One entry in full: Easton excerpt, related names (same original word, same Easton article, same verse, or
 *  named in each other's "also"), and the draft-note label. */
export function entry(id: string) {
  const all = getNames().entries;
  const e = all.find((x) => x.id === id);
  if (!e) return null;
  const strongs = new Set(e.original.map((o) => o.strongs));
  const own = new Set([e.name, ...e.also].map((x) => fold(x).trim()));
  const related = all.filter((x) => x.id !== e.id).map((x) => {
    let why: string | null = null;
    if (x.original.some((o) => strongs.has(o.strongs) && !["H0430", "H3068", "G2316", "G2962", "G4151", "G3962", "H0410", "G5207"].includes(o.strongs))) why = "sameWord";
    else if (e.easton && x.easton?.id === e.easton.id) why = "sameArticle";
    else if (e.primary && x.primary && x.primary.book === e.primary.book && x.primary.chapter === e.primary.chapter && x.primary.start === e.primary.start) why = "sameVerse";
    else if ([x.name, ...x.also].some((n) => own.has(fold(n).trim()))) why = "sameName";
    return why ? { ...summary(x), why } : null;
  }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 16);
  let eastonExcerpt: string | null = null;
  try { const a = e.easton ? getArticles().byId.get(e.easton.id) : null; eastonExcerpt = a ? excerptOf(a, 900) : null; } catch { eastonExcerpt = null; }
  return { ...e, sections: SECTIONS.filter((s) => inSection(e, s.key)).map((s) => s.key), eastonExcerpt, related,
    noteLabel: "", sources: getNames().sources };
}

// ── Search (My Plan / Bible Study) ───────────────────────────────────────────────────────────────────────────────
const COLLECTION_QUERIES: [RegExp, Section][] = [
  [/^(the )?(names?|titles?)( and titles?)? (of|for) (jesus|christ|jesus christ|the son|the messiah)$/, "son"],
  [/^(the )?(names?|titles?)( and titles?)? (of|for) (the )?(holy spirit|holy ghost|spirit)$/, "spirit"],
  [/^(the )?(names?|titles?)( and titles?)? (of|for) (god the father|the father)$/, "father"],
  [/^(the )?(names?|titles?)( and titles?)? (of|for) (god|the lord|yahweh)$/, "father"],
  [/^(the )?(attributes?|descriptions?|character) of god$/, "attributes"],
  [/^(devotional|worship) (names?|expressions?|titles?)( of god)?$/, "devotional"],
];
const SUBJECTS: [RegExp, Section[]][] = [
  [/^(god|the lord|lord|god the father|the father|father|almighty god|yahweh|jehovah|yhwh)$/, ["father", "god"]],
  [/^(jesus|christ|jesus christ|the lord jesus|lord jesus|the son|son of god|messiah)$/, ["son"]],
  [/^(holy spirit|the holy spirit|holy ghost|the holy ghost|spirit of god|the spirit)$/, ["spirit"]],
];
/** What the search panel shows: entries the search NAMES (exact name or rendering first), and — when the search is
 *  God / Jesus / the Holy Spirit or "Names of …" — the collection to open, with its first entries. */
export function namesForSearch(q: string) {
  const fq = fold(q).trim();
  if (fq.length < 2) return null;
  const all = getNames().entries;
  const col = COLLECTION_QUERIES.find(([re]) => re.test(fq))?.[1] ?? null;
  const subject = SUBJECTS.find(([re]) => re.test(fq))?.[1] ?? null;
  const ranked = all.map((e) => {
    const names = [e.name, ...e.also].map((x) => fold(x).trim());
    const name = fold(e.name).trim();
    // A one-word name inside the search counts only in a longer question ("the lordship of Jesus" → Jesus), never in
    // a two-word subject ("Holy Spirit" is not "Holy"; "Way Maker" is not "Maker").
    const qWords = fq.split(" ").length;
    const rank = name === fq ? 0 : names.includes(fq) ? 1 : names.some((n) => n.length >= 4 && ` ${fq} `.includes(` ${n} `) && (n.includes(" ") || qWords >= 3)) ? 2
      : fq.length >= 4 && names.some((n) => ` ${n} `.includes(` ${fq} `)) ? 3
      : e.original.some((o) => fold(o.transliteration).trim().replace(/ /g, "") === fq.replace(/ /g, "") || fold(o.lemma).trim() === fq) ? 1 : 9;
    return { e, rank };
  }).filter((x) => x.rank < 2 || (x.rank < 9 && !(col || subject)) // God / Jesus / Holy Spirit: exact names, plus language FORMS / names of that person
    || (x.rank === 3 && !!subject && (x.e.kind === "form" || x.e.kind === "name") && subject.some((s) => x.e.sections.includes(s as never)))).sort((a, b) => a.rank - b.rank || canon(a.e) - canon(b.e)); // God / Jesus / Holy Spirit: exact names here, the rest in the collection
  const sections = col ? [col] : subject;
  if (!ranked.length && !sections) return null;
  const inCollection = sections ? all.filter((e) => sections.some((s) => inSection(e, s))).sort((a, b) => canon(a) - canon(b)) : [];
  return {
    matches: ranked.slice(0, 12).map((x) => summary(x.e)),
    collection: sections ? { section: sections[0], sections, title: SECTIONS.find((s) => s.key === sections[0])!.title, total: inCollection.length,
      preview: inCollection.filter((e) => !ranked.slice(0, 12).some((r) => r.e.id === e.id)).slice(0, 8).map(summary),
      devotional: sections.includes("devotional") ? 0 : all.filter((e) => e.sections.includes("devotional") && sections.some((s) => (e.sections as string[]).includes(s) || e.persons.some((p) => (s === "son" ? p === "son" : s === "spirit" ? p === "spirit" : p === "god" || p === "father")))).length }
      : null,
    openCollection: !!col,
  };
}
