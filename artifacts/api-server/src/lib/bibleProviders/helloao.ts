// AO Lab "Free Use Bible API" (https://bible.helloao.org/docs/) — a SECOND
// Bible provider beside API.Bible. Public, no key. Everything here follows the
// published OpenAPI schema (https://bible.helloao.org/openapi.json):
//   GET /api/available_translations.json
//   GET /api/{translation}/books.json
//   GET /api/{translation}/{book}/{chapter}.json
//   GET /api/available_commentaries.json · /api/available_datasets.json
//   GET /api/d/{dataset}/{book}/{chapter}.json   (extension point only)
// Rules:
//   • one fixed, trusted base URL; ids and book/chapter are validated before
//     they are ever put into a URL — no arbitrary fetching;
//   • every response is checked at runtime against the schema we rely on;
//     anything else is "invalid response", never guessed at;
//   • provider text is DATA: it is only ever returned as plain strings;
//   • licences are NOT decided here — see lib/bibleLicence.ts. The catalogue's
//     own licence summary is recorded as AO Lab's statement, nothing more.

export const HELLOAO_BASE = "https://bible.helloao.org";
export const HELLOAO_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOOK_RE = /^[1-3A-Z][A-Z0-9]{2}$/;
const TIMEOUT_MS = 12_000;

export class HelloAoError extends Error {
  constructor(public kind: "network" | "timeout" | "not_found" | "unavailable" | "invalid", message: string, public status = 502) { super(message); }
}

// ── Fetching ────────────────────────────────────────────────────────────────
type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Tests replace the network. */
export function setHelloAoFetch(f: Fetch | null) { fetchImpl = f ?? ((...a) => fetch(...a)); }

async function getJson(pathname: string): Promise<unknown> {
  // `pathname` is built only from validated parts below.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${HELLOAO_BASE}${pathname}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
  } catch (e) {
    throw (e as Error)?.name === "AbortError"
      ? new HelloAoError("timeout", "The Free Use Bible service took too long to answer. Please try again.", 504)
      : new HelloAoError("network", "The Free Use Bible service couldn't be reached. Check your connection and try again.", 502);
  } finally { clearTimeout(timer); }
  if (res.status === 404) throw new HelloAoError("not_found", "That passage isn't in this translation.", 404);
  if (!res.ok) throw new HelloAoError("unavailable", "The Free Use Bible service is unavailable right now. Please try again later.", 502);
  try { return await res.json(); } catch { throw new HelloAoError("invalid", "The Free Use Bible service sent a reply we couldn't read.", 502); }
}

// ── Runtime validation helpers ──────────────────────────────────────────────
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const invalid = (what: string) => new HelloAoError("invalid", `The Free Use Bible service sent an unexpected ${what}.`, 502);

// ── Catalogue ───────────────────────────────────────────────────────────────
/** AO Lab's own licence summary for a translation (their statement; not an approval). */
export interface HelloAoLicence { publicDomain: boolean | null; commercialUse: string | null; attribution: string | null; derivatives: string | null; copyleft: boolean | null }
export interface HelloAoTranslation {
  id: string; name: string; englishName: string; shortName: string; language: string; languageName: string | null; languageEnglishName: string | null;
  textDirection: "ltr" | "rtl"; website: string | null; licenseUrl: string | null; license: HelloAoLicence | null;
  numberOfBooks: number; totalNumberOfChapters: number | null;
}
export function parseTranslation(x: unknown): HelloAoTranslation | null {
  if (!isObj(x)) return null;
  const id = str(x.id), name = str(x.name), language = str(x.language);
  if (!id || !HELLOAO_ID_RE.test(id) || !name || !language) return null;
  const l = isObj(x.license) ? x.license : null;
  return {
    id, name, englishName: str(x.englishName) ?? name, shortName: str(x.shortName) ?? id, language,
    languageName: str(x.languageName), languageEnglishName: str(x.languageEnglishName),
    textDirection: x.textDirection === "rtl" ? "rtl" : "ltr",
    website: str(x.website), licenseUrl: str(x.licenseUrl),
    license: l ? {
      publicDomain: typeof l.publicDomain === "boolean" ? l.publicDomain : null,
      commercialUse: str(l.commercialUse), attribution: str(l.attribution), derivatives: str(l.derivatives),
      copyleft: typeof l.copyleft === "boolean" ? l.copyleft : null,
    } : null,
    numberOfBooks: num(x.numberOfBooks) ?? 0, totalNumberOfChapters: num(x.totalNumberOfChapters),
  };
}
export function parseCatalogue(json: unknown): HelloAoTranslation[] {
  if (!isObj(json) || !Array.isArray(json.translations)) throw invalid("translation list");
  return json.translations.map(parseTranslation).filter((t): t is HelloAoTranslation => !!t);
}

// Small in-memory caches with in-flight de-duplication (catalogue / books: 12 h).
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = load();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => { if (memo.get(key)?.p === p) memo.delete(key); });   // failures aren't remembered
  if (memo.size > 400) memo.delete(memo.keys().next().value as string);
  return p;
}
export const clearHelloAoCache = () => memo.clear();

export const getHelloAoCatalogue = () => cached("catalogue", 12 * 3600_000, async () => parseCatalogue(await getJson("/api/available_translations.json")));

// ── Books ───────────────────────────────────────────────────────────────────
export interface HelloAoBook { id: string; name: string; numberOfChapters: number }
export function parseBooks(json: unknown): HelloAoBook[] {
  if (!isObj(json) || !Array.isArray(json.books)) throw invalid("book list");
  return json.books.flatMap((b) => {
    if (!isObj(b)) return [];
    const id = str(b.id), n = num(b.numberOfChapters);
    return id && BOOK_RE.test(id) && n && n > 0 ? [{ id, name: str(b.commonName) ?? str(b.name) ?? id, numberOfChapters: n }] : [];
  });
}
export function getHelloAoBooks(translationId: string) {
  if (!HELLOAO_ID_RE.test(translationId)) return Promise.reject(new HelloAoError("not_found", "That translation isn't available.", 404));
  return cached(`books:${translationId}`, 12 * 3600_000, async () => parseBooks(await getJson(`/api/${translationId}/books.json`)));
}

// ── Chapters ────────────────────────────────────────────────────────────────
// Normalised into the reader's existing model (lib/bibleReader.ts Chapter):
// verses (number, text, paragraph, poetry), headings (before a verse), plus
// footnotes and — only where a reviewed licence allows it — audio links.
export interface NormalisedVerse { verse: number; text: string; paragraph: number; poetry: boolean; wordsOfJesus?: boolean }
export interface NormalisedFootnote { verse: number | null; caller: string | null; text: string }
export interface HelloAoAudio { reader: string; url: string; timings: number[] | null }
export interface NormalisedChapter {
  verses: NormalisedVerse[];
  headings: { beforeVerse: number; text: string }[];
  footnotes: NormalisedFootnote[];
  previous: { bookCode: string; chapter: number } | null;
  next: { bookCode: string; chapter: number } | null;
  audio: HelloAoAudio[];
}

const AUDIO_HOST = "https://audio.bible.helloao.org/";
// Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Myanmar).
const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
function ref(x: unknown): { bookCode: string; chapter: number } | null {
  if (!isObj(x)) return null;
  const b = str(x.book), c = num(x.chapter);
  return b && BOOK_RE.test(b) && c && Number.isInteger(c) && c >= 1 ? { bookCode: b, chapter: c } : null;
}

export function normaliseChapter(json: unknown): NormalisedChapter {
  if (!isObj(json) || !isObj(json.chapter) || !Array.isArray(json.chapter.content)) throw invalid("chapter");
  const verses = new Map<number, NormalisedVerse>();
  const headings: { beforeVerse: number; text: string }[] = [];
  let pendingHeading: string[] = [];
  let paragraph = 1;
  const pushHeading = (beforeVerse: number) => { if (pendingHeading.length) { headings.push({ beforeVerse, text: pendingHeading.join(" — ") }); pendingHeading = []; } };
  // Inline pieces of a verse (or Hebrew subtitle): strings, formatted text, inline headings, line breaks, footnote refs.
  const inline = (items: unknown[], onHeading: (t: string) => void) => {
    let text = "", poetry = false, jesus = false, afterNote = false;
    // The source drops the space where a footnote marker sat between two words
    // ("only" {note} "Son"): restore one — never in scripts written without spaces.
    const join = (piece: string) => {
      if (afterNote && /[\p{L}\p{N},;:.!?’”)]$/u.test(text) && /^[\p{L}\p{N}“‘(]/u.test(piece) && !NO_SPACE_SCRIPT.test(text.slice(-1) + piece[0])) text += " ";
      text += piece; afterNote = false;
    };
    for (const it of items) {
      if (typeof it === "string") join(it);
      else if (isObj(it) && typeof it.text === "string") {
        if (typeof it.poem === "number") { poetry = true; if (text && !text.endsWith("\n")) text += "\n"; afterNote = false; }
        if (it.wordsOfJesus === true) jesus = true;
        join(it.text);
      } else if (isObj(it) && typeof it.heading === "string") onHeading(it.heading);
      else if (isObj(it) && it.lineBreak === true) { if (text && !text.endsWith("\n")) text += "\n"; afterNote = false; }
      else if (isObj(it) && typeof it.noteId === "number") afterNote = true;   // the notes themselves come from chapter.footnotes
    }
    return { text, poetry, jesus };
  };
  for (const c of json.chapter.content) {
    if (!isObj(c)) continue;
    if (c.type === "heading" && Array.isArray(c.content)) {
      const t = c.content.filter((x): x is string => typeof x === "string").join(" ").trim();
      if (t) pendingHeading.push(t);
    } else if (c.type === "hebrew_subtitle" && Array.isArray(c.content)) {
      const t = inline(c.content, () => {}).text.replace(/\s+/g, " ").trim();
      if (t) pendingHeading.push(t);
    } else if (c.type === "line_break") {
      if (typeof c.paragraph === "string") paragraph++;
    } else if (c.type === "verse" && Array.isArray(c.content)) {
      const n = num(c.number);
      if (!n || !Number.isInteger(n) || n < 1) continue;
      const parts = inline(c.content, (h) => { pendingHeading.push(h); });
      const existing = verses.get(n);
      if (!existing) {
        pushHeading(n);
        verses.set(n, { verse: n, text: parts.text, paragraph, poetry: parts.poetry, ...(parts.jesus ? { wordsOfJesus: true } : {}) });
      } else existing.text += parts.text;
    }
  }
  const footnotes: NormalisedFootnote[] = (Array.isArray(json.chapter.footnotes) ? json.chapter.footnotes : []).flatMap((f) => {
    if (!isObj(f) || typeof f.text !== "string") return [];
    const v = isObj(f.reference) ? num(f.reference.verse) : null;
    return [{ verse: v && Number.isInteger(v) ? v : null, caller: str(f.caller), text: f.text.replace(/\s+/g, " ").trim() }];
  });
  // Audio: only links on AO Lab's own audio host, with the matching per-reader timings.
  const timings = isObj(json.thisChapterAudioTimings) ? json.thisChapterAudioTimings : {};
  const audio: HelloAoAudio[] = isObj(json.thisChapterAudioLinks)
    ? Object.entries(json.thisChapterAudioLinks).flatMap(([reader, url]) => {
      if (typeof url !== "string" || !url.startsWith(AUDIO_HOST) || !/^[A-Za-z0-9_-]{1,40}$/.test(reader)) return [];
      const t = (timings as Record<string, unknown>)[reader];
      return [{ reader, url, timings: Array.isArray(t) && t.every((x) => typeof x === "number") ? (t as number[]) : null }];
    })
    : [];
  return {
    verses: [...verses.values()].sort((a, b) => a.verse - b.verse).map((v) => ({ ...v, text: v.text.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim() })),
    headings, footnotes,
    previous: ref(json.previousChapterReference), next: ref(json.nextChapterReference),
    audio,
  };
}

/** One chapter, validated and normalised. Callers cache (lib/bibleReader.ts chapter cache). */
export async function getHelloAoChapter(translationId: string, bookCode: string, chapter: number): Promise<NormalisedChapter> {
  if (!HELLOAO_ID_RE.test(translationId) || !BOOK_RE.test(bookCode) || !Number.isInteger(chapter) || chapter < 1 || chapter > 150) {
    throw new HelloAoError("not_found", "That passage isn't in this translation.", 404);
  }
  const ch = normaliseChapter(await getJson(`/api/${translationId}/${bookCode}/${chapter}.json`));
  if (!ch.verses.length) throw new HelloAoError("not_found", "That passage isn't in this translation.", 404);
  return ch;
}

// ── Future study resources (extension point; no screens yet) ────────────────
// Commentaries and datasets carry their OWN licences (see docs/bible-providers.md):
// third-party commentary must never be presented as P2P teaching, and each
// needs its attribution shown wherever it is used.
export interface HelloAoResource { id: string; name: string; language: string | null; licenseUrl: string | null; licenseNotes: string | null; website: string | null }
const parseResources = (json: unknown, key: "commentaries" | "datasets"): HelloAoResource[] => {
  if (!isObj(json) || !Array.isArray(json[key])) throw invalid(`${key} list`);
  return (json[key] as unknown[]).flatMap((r) => {
    if (!isObj(r) || !str(r.id) || !HELLOAO_ID_RE.test(String(r.id))) return [];
    return [{ id: String(r.id), name: str(r.name) ?? String(r.id), language: str(r.language), licenseUrl: str(r.licenseUrl), licenseNotes: str(r.licenseNotes), website: str(r.website) }];
  });
};
export const getHelloAoCommentaries = () => cached("commentaries", 12 * 3600_000, async () => parseResources(await getJson("/api/available_commentaries.json"), "commentaries"));
export const getHelloAoDatasets = () => cached("datasets", 12 * 3600_000, async () => parseResources(await getJson("/api/available_datasets.json"), "datasets"));

/** Cross references for one chapter from a dataset such as "open-cross-ref" (verse → scored references). */
export interface CrossReference { verse: number; references: { book: string; chapter: number; verse: number; endVerse: number | null; score: number | null }[] }
export async function getHelloAoCrossReferences(datasetId: string, bookCode: string, chapter: number): Promise<CrossReference[]> {
  if (!HELLOAO_ID_RE.test(datasetId) || !BOOK_RE.test(bookCode) || !Number.isInteger(chapter) || chapter < 1 || chapter > 150) throw new HelloAoError("not_found", "Not available.", 404);
  const json = await getJson(`/api/d/${datasetId}/${bookCode}/${chapter}.json`);
  if (!isObj(json) || !isObj(json.chapter) || !Array.isArray(json.chapter.content)) throw invalid("dataset chapter");
  return json.chapter.content.flatMap((v) => {
    if (!isObj(v) || !num(v.verse) || !Array.isArray(v.references)) return [];
    return [{ verse: Number(v.verse), references: v.references.flatMap((r) => isObj(r) && str(r.book) && BOOK_RE.test(String(r.book)) && num(r.chapter) && num(r.verse)
      ? [{ book: String(r.book), chapter: Number(r.chapter), verse: Number(r.verse), endVerse: num(r.endVerse), score: num(r.score) }] : []) }];
  });
}
