// Deep Study, Commentaries and Study Tools — the app's ONE client for study data (api-server
// routes/deepStudy.ts → AO Lab's Free Use Bible API, reviewed resources only). Screens never fetch the
// provider directly, and all three destinations read the same records by the same ids (a word's Strong's
// number, a commentary id + book + chapter), so a word opened in Deep Study is the same entry as in
// Study Tools, and a commentary in Deep Study is the same text as in Commentaries.
//
// Caching: every answer is kept on this device (small, most recent first). A copy younger than 6 hours is
// used straight away; an older copy is shown when the network fails (marked `offline`). Each resource's
// version travels with its data, so a provider update replaces the old copy on the next fetch. Nothing is
// bulk-downloaded: only what someone opens.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiRequest } from "@/lib/apiClient";

export class StudyError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// The saved-copy format. BUMP THIS whenever the server's response shape changes, so screens never read
// a saved answer in an older shape (2026-11-12: v1 copies lacked `credit.origin`). Older copies are removed.
const SCHEMA = 2;
const PREFIX = `p2p.deepstudy.v${SCHEMA}:`;
const INDEX = `p2p.deepstudy.v${SCHEMA}.index`;
let oldCleared = false;
async function clearOlderSchemas() {
  if (oldCleared) return;
  oldCleared = true;
  try {
    for (let v = 1; v < SCHEMA; v++) {
      const idx: string[] = JSON.parse((await AsyncStorage.getItem(`p2p.deepstudy.v${v}.index`)) ?? "[]");
      await AsyncStorage.multiRemove([...idx.map((p) => `p2p.deepstudy.v${v}:${p}`), `p2p.deepstudy.v${v}.index`]);
    }
  } catch { /* best effort: older copies are never read either way */ }
}
const FRESH_MS = 6 * 3600_000;
const MAX_ENTRIES = 80;

type Cached<T> = { at: number; data: T };
const mem = new Map<string, Cached<unknown>>();

async function readCache<T>(path: string): Promise<Cached<T> | null> {
  const m = mem.get(path);
  if (m) return m as Cached<T>;
  try {
    const raw = await AsyncStorage.getItem(PREFIX + path);
    if (!raw) return null;
    const v = JSON.parse(raw) as Cached<T>;
    if (typeof v?.at !== "number") return null;
    mem.set(path, v);
    return v;
  } catch { return null; }
}
async function writeCache<T>(path: string, data: T) {
  const v = { at: Date.now(), data };
  mem.set(path, v);
  try {
    const idx: string[] = JSON.parse((await AsyncStorage.getItem(INDEX)) ?? "[]");
    const next = [path, ...idx.filter((p) => p !== path)];
    const drop = next.splice(MAX_ENTRIES);
    await AsyncStorage.setItem(PREFIX + path, JSON.stringify(v));
    await AsyncStorage.setItem(INDEX, JSON.stringify(next));
    if (drop.length) await AsyncStorage.multiRemove(drop.map((p) => PREFIX + p));
  } catch { /* storage full or unavailable: the memory copy still serves this session */ }
}

/** Fresh-enough cache → network (with the server's own timeout + retry) → older cache when offline. */
async function get<T>(path: string, opts: { refresh?: boolean; persist?: boolean } = {}): Promise<T & { offline?: boolean }> {
  void clearOlderSchemas();
  // Search answers are kept for this session only (memory), so typing never pushes saved entries out.
  if (opts.persist === false) {
    const m = mem.get(path);
    if (m && Date.now() - m.at < FRESH_MS) return m.data as T & { offline?: boolean };
    const data = await apiRequest<T>(`/deep-study${path}`, {}, {
      fallbackError: "Deep Study couldn't load this. Please try again.",
      offlineError: "You're offline — check your connection and try again.",
      makeError: (message, status) => new StudyError(message, status),
    });
    mem.set(path, { at: Date.now(), data });
    return data as T & { offline?: boolean };
  }
  const hit = await readCache<T>(path);
  if (hit && !opts.refresh && Date.now() - hit.at < FRESH_MS) return hit.data as T & { offline?: boolean };
  try {
    const data = await apiRequest<T>(`/deep-study${path}`, {}, {
      fallbackError: "Deep Study couldn't load this. Please try again.",
      offlineError: "You're offline — check your connection and try again.",
      makeError: (message, status) => new StudyError(message, status),
    });
    await writeCache(path, data);
    return data as T & { offline?: boolean };
  } catch (e) {
    // A copy we already have is better than nothing when the network is down (never for "not found").
    if (hit && !(e instanceof StudyError && e.status === 404)) return { ...(hit.data as T), offline: true };
    throw e;
  }
}
const range = (from?: number | null, to?: number | null) => (from ? `?from=${from}&to=${to ?? from}` : "");

// ── Types (as the server returns them) ──────────────────────────────────────
export interface Credit {
  id: string; name: string; author: string; attribution: string; licence: { name: string; url: string }; shareAlike: boolean;
  providerNotice: string | null; changes: string; note: string | null;
  /** The original source — always shown as a link (STEPBible requires "STEP Bible" linked to www.STEPBible.org).
   *  Optional at the type level: an older server or saved copy may not have it, and screens must not crash. */
  origin?: { label: string; url: string };
  via?: { label: string; url: string };
  licenceVerifiedOn?: string;
}
export interface StudyResource {
  id: string; kind: string; name: string; author: string; website: string | null; language: string; languageCode: string | null;
  direction: "ltr" | "rtl"; coverage: { books: number | null; chapters: number | null; verses: number | null; words: number | null; references: number | null; entries: number | null };
  version: string; credit: Credit;
}
export interface InterlinearWord { id: string; pos: number; bsbPos: number | null; language: string; text: string; transliteration: string | null; parsing: string | null; parsingFull: string | null; strongs: string | null; gloss: string | null }
export interface Interlinear {
  book: string; chapter: number; from: number; to: number; available: boolean; alignment?: string; credit: Credit;
  verses: { verse: number; direction: "ltr" | "rtl"; words: InterlinearWord[] }[];
  /** Verses with no original-language words in this interlinear (e.g. Matthew 17:21), and why. */
  versesWithoutWords?: number[]; missingNote?: string | null; offline?: boolean;
}
export interface LexiconSense { id: string; language: string | null; lemma: string | null; transliteration: string | null; partOfSpeech: string | null; gloss: string | null; definition: string | null }
export interface LexiconEntry {
  entry: { id: string; language: string | null; direction: "ltr" | "rtl"; senses: LexiconSense[]; relatedStrongs: string[] };
  requestedSense: string | null; occurrences: { verse: number; wordId: string; text: string; transliteration: string | null; gloss: string | null }[] | null;
  credit: Credit; note: string; offline?: boolean;
}
export interface LexiconSearch { mode: "strongs" | "lemma" | "browse"; total: number; items: { id: string; language: string; name: string }[]; credit: Credit; note: string }
export interface CrossRefs { from: number; to: number; credit: Credit; verses: { verse: number; total: number; references: { book: string; chapter: number; verse: number; endVerse: number | null; score: number | null }[] }[]; offline?: boolean }
export interface PeoplePlaces { credit: Credit; items: { id: string; name: string; kind: "person" | "place" | "event"; detail: string | null; verses: number[] }[]; offline?: boolean }
export interface CommentarySection { start: number; end: number | null; paragraphs: string[] }
export interface CommentaryBook { id: string; name: string; order: number | null; firstChapter: number; lastChapter: number; chapters: number; verses: number | null; hasIntroduction: boolean }
export interface CommentaryDetail extends StudyResource { books: CommentaryBook[] }
export interface CommentaryChapter { id: string; book: string; chapter: number; covered: boolean; introduction: string | null; sections: CommentarySection[]; credit: Credit; offline?: boolean }
export interface CompareResult extends StudyResource { status: "ok" | "no_entry" | "not_covered" | "unavailable"; sections: CommentarySection[]; introduction: string | null; error?: string }

// ── Calls ───────────────────────────────────────────────────────────────────
export const studyResources = () => get<{ commentaries: StudyResource[]; datasets: StudyResource[]; pendingReview: { id: string; name: string; kind: string }[] }>("/resources");
export const interlinear = (book: string, chapter: number, from?: number | null, to?: number | null) => get<Interlinear>(`/interlinear/${book}/${chapter}${range(from, to)}`);
export const lexiconEntry = (strongs: string, at?: { book: string; chapter: number } | null) =>
  get<LexiconEntry>(`/lexicon/${encodeURIComponent(strongs)}${at ? `?book=${at.book}&chapter=${at.chapter}` : ""}`);
export const searchLexicon = (q: string, language?: string | null) => get<LexiconSearch>(`/lexicon/search?q=${encodeURIComponent(q)}${language ? `&language=${language}` : ""}`);
export const crossReferences = (book: string, chapter: number, from?: number | null, to?: number | null) => get<CrossRefs>(`/cross-references/${book}/${chapter}${range(from, to)}`);
export const peoplePlaces = (book: string, chapter: number, from?: number | null, to?: number | null) => get<PeoplePlaces>(`/people-places/${book}/${chapter}${range(from, to)}`);
export const commentaryDetail = (id: string) => get<CommentaryDetail>(`/commentaries/${id}`);
export const commentaryIntroduction = (id: string, book: string) => get<{ introduction: string | null; credit: Credit }>(`/commentaries/${id}/${book}/introduction`);
export const commentaryChapter = (id: string, book: string, chapter: number, from?: number | null, to?: number | null) => get<CommentaryChapter>(`/commentaries/${id}/${book}/${chapter}${range(from, to)}`);
export const compareCommentaries = (book: string, chapter: number, from?: number | null, to?: number | null) => get<{ commentaries: CompareResult[]; offline?: boolean }>(`/compare/${book}/${chapter}${range(from, to)}`);

// ── Biblical Dictionary (A–Z) — the same Strong's-numbered records (api-server lib/dictionary.ts) ──
export type DictLanguage = "hebrew" | "aramaic" | "greek";
export interface DictRecord {
  id: string; strongs: string; language: DictLanguage; lemma: string; transliteration: string; gloss: string; partOfSpeech: string;
  senses: { id: string; gloss: string }[]; words: number; verses: number;
  renderings: { text: string; count: number }[]; occurrenceLanguages: DictLanguage[];
}
export interface DictTermSummary {
  type: "term"; key: string; display: string; letter: string; records: number;
  languages: { language: DictLanguage; count: number }[]; preview: { id: string; language: DictLanguage; lemma: string; transliteration: string }[];
}
export type DictSearchItem = (DictTermSummary | (DictRecord & { type: "record" })) & { rank: number; matched: string };
export interface DictOverview {
  letters: { letter: string; count: number }[]; terms: number; records: number; languages: { language: DictLanguage; records: number }[];
  builtAt: string; referenceSources: { id: string; name: string; status: string }[]; credits: Credit[]; note: string;
}
export interface DictTerm { key: string; display: string; letter: string; records: DictRecord[]; renderedAs: (DictRecord & { renderCount: number })[]; renderedNote: string; credits: Credit[] }
export interface DictRecordDetail { record: DictRecord; terms: { key: string; display: string }[]; countsNote: string; credits: Credit[] }
export interface DictOccurrences {
  id: string; words: number; verses: number; offset: number; note: string; credits: Credit[];
  items: { book: string; bookName: string; chapter: number; verse: number; forms: { wordId: string; text: string; transliteration: string | null; parsing: string | null; gloss: string | null; language: string }[] | null }[];
}
export const dictionaryOverview = () => get<DictOverview>("/dictionary");
export const dictionaryBrowse = (letter: string, offset = 0) => get<{ letter: string; total: number; offset: number; items: DictTermSummary[] }>(`/dictionary/browse?letter=${encodeURIComponent(letter)}&offset=${offset}&limit=50`);
export const dictionarySearch = (q: string, language?: DictLanguage | null, offset = 0) =>
  get<{ q: string; mode: string; total: number; offset: number; items: DictSearchItem[] }>(`/dictionary/search?q=${encodeURIComponent(q)}${language ? `&language=${language}` : ""}&offset=${offset}&limit=30`, { persist: false });
export const dictionaryTerm = (key: string) => get<DictTerm>(`/dictionary/term/${encodeURIComponent(key)}`);
export const dictionaryRecord = (strongs: string) => get<DictRecordDetail>(`/dictionary/record/${encodeURIComponent(strongs)}`);
export const dictionaryOccurrences = (strongs: string, offset = 0) => get<DictOccurrences>(`/dictionary/record/${encodeURIComponent(strongs)}/occurrences?offset=${offset}&limit=25`);

/** "H1254", "h430", "G3056" → the zero-padded id the provider uses ("H0430"), or null. */
export function normaliseStrongs(input: string): string | null {
  const m = input.trim().match(/^([HGhg])0*(\d{1,4})[A-Za-z]?$/);
  return m && Number(m[2]) > 0 ? `${m[1].toUpperCase()}${m[2].padStart(4, "0")}` : null;
}
export const languageName = (l: string | null | undefined) => (l === "hebrew" ? "Hebrew" : l === "aramaic" ? "Aramaic" : l === "greek" ? "Greek" : l ?? "");
