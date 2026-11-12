// Deep Study resources from AO Lab's "Free Use Bible API" (https://bible.helloao.org/docs/): the BSB
// interlinear, STEPBible brief lexicons, OpenBible cross references, Theographic people/places/events and
// the commentaries. ONE place that talks to the provider for study data — screens never fetch it directly.
//
// Endpoints (as documented and as the live API answers, checked 2026-11-12):
//   GET /api/available_datasets.json · /api/available_commentaries.json   — the live catalogue (never hardcoded)
//   GET /api/d/bsb-interlinear/{BOOK}/{CHAPTER}.json                      — words: text, transliteration, parsing, strongs, gloss
//   GET /api/d/stepbible-lexicon/lexicon.json                             — index: id, language, name (18,085 entries)
//   GET /api/d/stepbible-lexicon/lexicon/{STRONGS}.json                   — one entry with ALL its senses
//   GET /api/d/open-cross-ref/{BOOK}/{CHAPTER}.json                       — scored cross references (lib/bibleProviders/helloao.ts)
//   GET /api/d/theographic/{BOOK}/{CHAPTER}.json                          — people, places, events with their verses
//   GET /api/c/{COMMENTARY}/books.json · /api/c/{COMMENTARY}/{BOOK}/{CHAPTER}.json
// Strong's numbers: the interlinear and the lexicon both use zero-padded ids ("H0430", "G0746"); "H430"
// returns 404. Input is normalised to that form. Lexicon senses carry letter suffixes (H1254A "to create",
// H1254B "to fatten"); the interlinear does not, so a word opens its whole entry with every sense — the
// app never guesses which sense a particular occurrence uses.
// Same safety rules as the Bible adapter: fixed base URL, validated ids, runtime-checked responses,
// provider text returned as plain strings only, failures never cached. Licences: lib/studyResources.ts.

import { BOOK_RE, HelloAoError, cached, getHelloAoCrossReferences, getJson } from "./helloao";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const invalid = (what: string) => new HelloAoError("invalid", `The study service sent an unexpected ${what}.`, 502);
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HOUR = 3600_000;

/** One retry for a temporary failure (network, timeout, provider unavailable) — never for "not found" or bad data. */
export async function withRetry<T>(load: () => Promise<T>, waitMs = 400): Promise<T> {
  try { return await load(); } catch (e) {
    if (!(e instanceof HelloAoError) || !["network", "timeout", "unavailable"].includes(e.kind)) throw e;
    await new Promise((r) => setTimeout(r, waitMs));
    return load();
  }
}
const fetchJson = (path: string) => withRetry(() => getJson(path));

const checkChapter = (book: string, chapter: number) => {
  if (!BOOK_RE.test(book) || !Number.isInteger(chapter) || chapter < 1 || chapter > 150) throw new HelloAoError("not_found", "That passage isn't available.", 404);
};

// ── Catalogue ───────────────────────────────────────────────────────────────
export interface CatalogueEntry {
  id: string; kind: "dataset" | "commentary"; name: string; englishName: string | null; website: string | null;
  licenseUrl: string | null; licenseNotes: string | null; licenseNotice: string | null;
  language: string | null; languageEnglishName: string | null; declaredDirection: string | null; sha256: string | null;
  numberOfBooks: number | null; totalNumberOfChapters: number | null; totalNumberOfVerses: number | null;
  totalNumberOfWords: number | null; totalNumberOfReferences: number | null; totalNumberOfLexicon: number | null;
}
function parseEntries(json: unknown, key: "datasets" | "commentaries"): CatalogueEntry[] {
  if (!isObj(json) || !Array.isArray(json[key])) throw invalid(`${key} list`);
  return (json[key] as unknown[]).flatMap((r) => {
    if (!isObj(r) || !str(r.id) || !ID_RE.test(String(r.id))) return [];
    return [{
      id: String(r.id), kind: key === "datasets" ? "dataset" as const : "commentary" as const, name: str(r.name) ?? String(r.id), englishName: str(r.englishName), website: str(r.website),
      licenseUrl: str(r.licenseUrl), licenseNotes: str(r.licenseNotes), licenseNotice: str(r.licenseNotice),
      language: str(r.language), languageEnglishName: str(r.languageEnglishName), declaredDirection: str(r.textDirection), sha256: str(r.sha256),
      numberOfBooks: num(r.numberOfBooks), totalNumberOfChapters: num(r.totalNumberOfChapters), totalNumberOfVerses: num(r.totalNumberOfVerses),
      totalNumberOfWords: num(r.totalNumberOfWords), totalNumberOfReferences: num(r.totalNumberOfReferences), totalNumberOfLexicon: num(r.totalNumberOfLexicon),
    }];
  });
}
export const getStudyCatalogue = () => cached("study:catalogue", 6 * HOUR, async () => {
  const [d, c] = await Promise.all([fetchJson("/api/available_datasets.json"), fetchJson("/api/available_commentaries.json")]);
  return [...parseEntries(d, "datasets"), ...parseEntries(c, "commentaries")];
});
/** The resource's current version (its catalogue checksum) — part of every cache key, so a provider update is picked up. */
export async function versionOf(id: string): Promise<string> {
  const e = (await getStudyCatalogue()).find((x) => x.id === id);
  if (!e) throw new HelloAoError("not_found", "That study resource isn't available.", 404);
  return (e.sha256 ?? "v").slice(0, 16);
}

// ── Strong's numbers ────────────────────────────────────────────────────────
/** "h430", "H0430", "G3056", "H1254a" → { id: "H0430", sense: "H1254A" | null } (zero-padded, as the provider uses). */
export function normaliseStrongs(input: string | null | undefined): { id: string; sense: string | null } | null {
  const m = String(input ?? "").trim().match(/^([HGhg])0*(\d{1,4})([A-Za-z])?$/);
  if (!m || Number(m[2]) === 0) return null;
  const id = `${m[1].toUpperCase()}${m[2].padStart(4, "0")}`;
  return { id, sense: m[3] ? `${id}${m[3].toUpperCase()}` : null };
}
const STRONGS_IN_TEXT = /\b([HG])(\d{1,4})([A-Z])?\b/g;

// ── Interlinear ─────────────────────────────────────────────────────────────
export interface InterlinearWord {
  /** Stable id: BOOK.chapter.verse.position (original-language order). */
  id: string; pos: number; bsbPos: number | null; language: "hebrew" | "aramaic" | "greek" | string;
  text: string; transliteration: string | null; parsing: string | null; parsingFull: string | null; strongs: string | null; gloss: string | null;
}
export interface InterlinearVerse { verse: number; words: InterlinearWord[] }
export function parseInterlinear(json: unknown, book: string, chapter: number): InterlinearVerse[] {
  if (!isObj(json) || !isObj(json.chapter) || !Array.isArray(json.chapter.content)) throw invalid("interlinear chapter");
  return json.chapter.content.flatMap((v) => {
    if (!isObj(v) || !num(v.verse) || !Array.isArray(v.words)) return [];
    const verse = Number(v.verse);
    const words = (v.words as unknown[]).flatMap((w) => {
      if (!isObj(w) || !num(w.pos) || !str(w.text)) return [];
      const s = normaliseStrongs(str(w.strongs));
      return [{
        id: `${book}.${chapter}.${verse}.${w.pos}`, pos: Number(w.pos), bsbPos: num(w.bsbPos), language: str(w.language) ?? "unknown",
        text: String(w.text), transliteration: str(w.transliteration), parsing: str(w.parsing), parsingFull: str(w.parsingFull),
        strongs: s?.id ?? null, gloss: str(w.gloss),
      }];
    }).sort((a, b) => a.pos - b.pos);
    return [{ verse, words }];
  });
}
export async function getInterlinear(book: string, chapter: number): Promise<{ version: string; verses: InterlinearVerse[] }> {
  checkChapter(book, chapter);
  const version = await versionOf("bsb-interlinear");
  return cached(`study:interlinear@${version}:${book}.${chapter}`, 12 * HOUR, async () => ({ version, verses: parseInterlinear(await fetchJson(`/api/d/bsb-interlinear/${book}/${chapter}.json`), book, chapter) }));
}

// ── Lexicon ─────────────────────────────────────────────────────────────────
export interface LexiconSense { id: string; language: string | null; lemma: string | null; transliteration: string | null; partOfSpeech: string | null; gloss: string | null; definition: string | null }
export interface LexiconEntry { id: string; language: string | null; senses: LexiconSense[]; relatedStrongs: string[] }
export function parseLexiconEntry(json: unknown): LexiconEntry {
  if (!isObj(json) || !isObj(json.entry) || !str(json.entry.id) || !Array.isArray(json.entry.senses)) throw invalid("lexicon entry");
  const e = json.entry;
  const senses = (e.senses as unknown[]).flatMap((s) => isObj(s) && str(s.id) ? [{
    id: String(s.id), language: str(s.language), lemma: str(s.lemma), transliteration: str(s.transliteration),
    partOfSpeech: str(s.partOfSpeech), gloss: str(s.gloss), definition: str(s.definition),
  }] : []);
  const self = normaliseStrongs(String(e.id))?.id;
  // Other Strong's numbers named in the definitions ("Aramaic of me.lekh … H4428") become links — exact ids only.
  const related = new Set<string>();
  for (const s of senses) for (const m of (s.definition ?? "").matchAll(STRONGS_IN_TEXT)) { const n = normaliseStrongs(m[0])?.id; if (n && n !== self) related.add(n); }
  return { id: self ?? String(e.id), language: str(e.language), senses, relatedStrongs: [...related] };
}
export async function getLexiconEntry(strongs: string): Promise<{ version: string; entry: LexiconEntry | null; requestedSense: string | null }> {
  const s = normaliseStrongs(strongs);
  if (!s) throw new HelloAoError("not_found", "That isn't a Strong's number (for example H1254 or G3056).", 404);
  const version = await versionOf("stepbible-lexicon");
  const entry = await cached(`study:lex@${version}:${s.id}`, 24 * HOUR, async () => {
    try { return parseLexiconEntry(await fetchJson(`/api/d/stepbible-lexicon/lexicon/${s.id}.json`)); }
    catch (e) { if (e instanceof HelloAoError && e.kind === "not_found") return null; throw e; }
  });
  return { version, entry, requestedSense: s.sense };
}

export interface LexiconIndexItem { id: string; language: string; name: string }
/** Letters only, no vowel points, accents or cantillation — for matching typed Hebrew/Greek. */
export const plainScript = (s: string) => s.normalize("NFD").replace(/[̀-֑ͯ-ׇ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, "").toLowerCase().trim();
export function parseLexiconIndex(json: unknown): LexiconIndexItem[] {
  if (!isObj(json) || !Array.isArray(json.lexicon)) throw invalid("lexicon index");
  return (json.lexicon as unknown[]).flatMap((x) => isObj(x) && str(x.id) && str(x.language) ? [{ id: String(x.id), language: String(x.language), name: str(x.name) ?? "" }] : []);
}
const getLexiconIndex = async () => {
  const version = await versionOf("stepbible-lexicon");
  return cached(`study:lexindex@${version}`, 24 * HOUR, async () => {
    const items = parseLexiconIndex(await fetchJson("/api/d/stepbible-lexicon/lexicon.json"));
    return { version, items: items.map((i) => ({ ...i, plain: plainScript(i.name) })) };
  });
};
/**
 * Search the lexicon index: a Strong's number (exact), or Hebrew/Greek lemma letters (accents ignored).
 * The index holds ids and lemmas only — English glosses are in each entry, so English words can't be searched here.
 */
export async function searchLexicon(q: string, language: string | null, limit = 40): Promise<{ version: string; total: number; items: LexiconIndexItem[]; mode: "strongs" | "lemma" | "browse" }> {
  const { version, items } = await getLexiconIndex();
  const lang = language && ["hebrew", "aramaic", "greek"].includes(language) ? language : null;
  const pool = lang ? items.filter((i) => i.language === lang) : items;
  const s = normaliseStrongs(q);
  if (s) { const hit = items.filter((i) => i.id === s.id); return { version, total: hit.length, items: hit.map(({ id, language, name }) => ({ id, language, name })), mode: "strongs" }; }
  const p = plainScript(q);
  // Exact lemma first, then lemmas starting with the letters, then any containing them.
  const rank = (i: { plain: string }) => (i.plain === p ? 0 : i.plain.startsWith(p) ? 1 : 2);
  const found = p ? pool.filter((i) => i.plain.includes(p)).sort((a, b) => rank(a) - rank(b)) : pool;
  return { version, total: found.length, items: found.slice(0, limit).map(({ id, language, name }) => ({ id, language, name })), mode: p ? "lemma" : "browse" };
}

// ── Cross references ────────────────────────────────────────────────────────
export async function getCrossReferences(book: string, chapter: number) {
  checkChapter(book, chapter);
  const version = await versionOf("open-cross-ref");
  return cached(`study:xref@${version}:${book}.${chapter}`, 12 * HOUR, async () => ({ version, verses: await withRetry(() => getHelloAoCrossReferences("open-cross-ref", book, chapter)) }));
}

// ── People, places, events (Theographic) ────────────────────────────────────
export interface MetaItem { id: string; name: string; kind: "person" | "place" | "event"; detail: string | null; verses: number[] }
export function parseTheographic(json: unknown): MetaItem[] {
  if (!isObj(json) || !isObj(json.chapter)) throw invalid("people and places chapter");
  const ch = json.chapter;
  const list = (k: "people" | "places" | "events", kind: MetaItem["kind"], detail: (x: Record<string, unknown>) => string | null) =>
    (Array.isArray(ch[k]) ? ch[k] as unknown[] : []).flatMap((x) => isObj(x) && str(x.id) && str(x.name) && Array.isArray(x.verses)
      ? [{ id: String(x.id), name: String(x.name), kind, detail: detail(x), verses: (x.verses as unknown[]).filter((n): n is number => typeof n === "number") }] : []);
  // Event dates are deliberately not passed on (one traditional chronology; see lib/studyResources.ts).
  return [...list("people", "person", (x) => str(x.gender)), ...list("places", "place", (x) => str(x.featureType)), ...list("events", "event", () => null)];
}
export async function getPeoplePlaces(book: string, chapter: number) {
  checkChapter(book, chapter);
  const version = await versionOf("theographic");
  return cached(`study:theo@${version}:${book}.${chapter}`, 12 * HOUR, async () => {
    try { return { version, items: parseTheographic(await fetchJson(`/api/d/theographic/${book}/${chapter}.json`)) }; }
    catch (e) { if (e instanceof HelloAoError && e.kind === "not_found") return { version, items: [] as MetaItem[] }; throw e; }
  });
}

// ── Commentaries ────────────────────────────────────────────────────────────
export interface CommentaryBook { id: string; name: string; order: number | null; firstChapter: number; lastChapter: number; chapters: number; verses: number | null; hasIntroduction: boolean }
export function parseCommentaryBooks(json: unknown): CommentaryBook[] {
  if (!isObj(json) || !Array.isArray(json.books)) throw invalid("commentary book list");
  return (json.books as unknown[]).flatMap((b) => {
    if (!isObj(b) || !str(b.id) || !BOOK_RE.test(String(b.id))) return [];
    const first = num(b.firstChapterNumber) ?? 1, last = num(b.lastChapterNumber) ?? num(b.numberOfChapters) ?? first;
    return [{ id: String(b.id), name: str(b.commonName) ?? str(b.name) ?? String(b.id), order: num(b.order), firstChapter: first, lastChapter: last,
      chapters: num(b.numberOfChapters) ?? last - first + 1, verses: num(b.totalNumberOfVerses), hasIntroduction: !!str(b.introduction)?.trim() }];
  });
}
const checkCommentary = (id: string) => { if (!ID_RE.test(id)) throw new HelloAoError("not_found", "That commentary isn't available.", 404); };
export async function getCommentaryBooks(id: string) {
  checkCommentary(id);
  const version = await versionOf(id);
  return cached(`study:cbooks@${version}:${id}`, 12 * HOUR, async () => ({ version, books: parseCommentaryBooks(await fetchJson(`/api/c/${id}/books.json`)) }));
}
export async function getCommentaryBookIntroduction(id: string, book: string): Promise<string | null> {
  checkCommentary(id);
  if (!BOOK_RE.test(book)) return null;
  const version = await versionOf(id);
  const json = await cached(`study:cbooksraw@${version}:${id}`, HOUR, () => fetchJson(`/api/c/${id}/books.json`));
  const b = isObj(json) && Array.isArray(json.books) ? (json.books as unknown[]).find((x) => isObj(x) && x.id === book) : null;
  return isObj(b) ? str(b.introduction) : null;
}

/** A commentary section begins at `start` and runs to the verse before the next section (or the chapter's end). */
export interface CommentarySection { start: number; end: number | null; paragraphs: string[] }
export function parseCommentaryChapter(json: unknown): { introduction: string | null; sections: CommentarySection[] } {
  if (!isObj(json) || !isObj(json.chapter) || !Array.isArray(json.chapter.content)) throw invalid("commentary chapter");
  const items = (json.chapter.content as unknown[]).flatMap((c) => {
    if (!isObj(c) || c.type !== "verse" || !num(c.number) || !Array.isArray(c.content)) return [];
    const paragraphs = (c.content as unknown[]).flatMap((p) => typeof p === "string" ? p.split(/\n{2,}/) : []).map((p) => p.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim()).filter(Boolean);
    return paragraphs.length ? [{ start: Number(c.number), paragraphs }] : [];
  }).sort((a, b) => a.start - b.start);
  const sections = items.map((s, i) => ({ start: s.start, end: i + 1 < items.length ? Math.max(s.start, items[i + 1].start - 1) : null, paragraphs: s.paragraphs }));
  return { introduction: str(json.chapter.introduction)?.trim() || null, sections };
}
/** The sections that speak about any verse in [from, to]. */
export function sectionsFor(sections: CommentarySection[], from: number, to: number): CommentarySection[] {
  return sections.filter((s) => s.start <= to && (s.end === null || s.end >= from));
}
/**
 * One commentary on one chapter, or `covered: false` when the commentary has no notes on that book or
 * chapter (its real coverage, from its own book list — never assumed).
 */
export async function getCommentaryChapter(id: string, book: string, chapter: number) {
  checkCommentary(id); checkChapter(book, chapter);
  const { version, books } = await getCommentaryBooks(id);
  const b = books.find((x) => x.id === book);
  if (!b || chapter < b.firstChapter || chapter > b.lastChapter) return { version, covered: false as const, introduction: null, sections: [] as CommentarySection[] };
  return cached(`study:cch@${version}:${id}:${book}.${chapter}`, 12 * HOUR, async () => {
    try { return { version, covered: true as const, ...parseCommentaryChapter(await fetchJson(`/api/c/${id}/${book}/${chapter}.json`)) }; }
    catch (e) { if (e instanceof HelloAoError && e.kind === "not_found") return { version, covered: false as const, introduction: null, sections: [] as CommentarySection[] }; throw e; }
  });
}
