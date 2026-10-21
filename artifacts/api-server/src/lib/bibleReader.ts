import { supabaseServiceRole as db } from "./supabase";
import { BOOK_CODES } from "./bibleService";

// The Bible reader (full chapters, translations, search, related lessons).
// Scripture text comes ONLY from API.Bible for translations marked
// is_licensed_confirmed in p2p_bible_translations — the same licence gate as
// the existing verse/passage routes. Chapters are held in this server's
// memory for a few hours to avoid repeat provider calls; they are NOT written
// to the database (whether our plan permits storing whole chapters is an open
// licence question, so nothing new is persisted). The API key never leaves
// the server.

const API_BIBLE_BASE = "https://api.scripture.api.bible/v1";
const apiKey = () => process.env.API_Bible ?? process.env.API_BIBLE_KEY ?? "";

// Protestant 66-book canon (structure only — no Scripture wording).
export const CANON: { code: string; name: string; chapters: number; testament: "OT" | "NT" }[] = [
  ["GEN", "Genesis", 50], ["EXO", "Exodus", 40], ["LEV", "Leviticus", 27], ["NUM", "Numbers", 36], ["DEU", "Deuteronomy", 34],
  ["JOS", "Joshua", 24], ["JDG", "Judges", 21], ["RUT", "Ruth", 4], ["1SA", "1 Samuel", 31], ["2SA", "2 Samuel", 24],
  ["1KI", "1 Kings", 22], ["2KI", "2 Kings", 25], ["1CH", "1 Chronicles", 29], ["2CH", "2 Chronicles", 36], ["EZR", "Ezra", 10],
  ["NEH", "Nehemiah", 13], ["EST", "Esther", 10], ["JOB", "Job", 42], ["PSA", "Psalms", 150], ["PRO", "Proverbs", 31],
  ["ECC", "Ecclesiastes", 12], ["SNG", "Song of Solomon", 8], ["ISA", "Isaiah", 66], ["JER", "Jeremiah", 52], ["LAM", "Lamentations", 5],
  ["EZK", "Ezekiel", 48], ["DAN", "Daniel", 12], ["HOS", "Hosea", 14], ["JOL", "Joel", 3], ["AMO", "Amos", 9],
  ["OBA", "Obadiah", 1], ["JON", "Jonah", 4], ["MIC", "Micah", 7], ["NAM", "Nahum", 3], ["HAB", "Habakkuk", 3],
  ["ZEP", "Zephaniah", 3], ["HAG", "Haggai", 2], ["ZEC", "Zechariah", 14], ["MAL", "Malachi", 4],
  ["MAT", "Matthew", 28], ["MRK", "Mark", 16], ["LUK", "Luke", 24], ["JHN", "John", 21], ["ACT", "Acts", 28],
  ["ROM", "Romans", 16], ["1CO", "1 Corinthians", 16], ["2CO", "2 Corinthians", 13], ["GAL", "Galatians", 6], ["EPH", "Ephesians", 6],
  ["PHP", "Philippians", 4], ["COL", "Colossians", 4], ["1TH", "1 Thessalonians", 5], ["2TH", "2 Thessalonians", 3], ["1TI", "1 Timothy", 6],
  ["2TI", "2 Timothy", 4], ["TIT", "Titus", 3], ["PHM", "Philemon", 1], ["HEB", "Hebrews", 13], ["JAS", "James", 5],
  ["1PE", "1 Peter", 5], ["2PE", "2 Peter", 3], ["1JN", "1 John", 5], ["2JN", "2 John", 1], ["3JN", "3 John", 1],
  ["JUD", "Jude", 1], ["REV", "Revelation", 22],
].map(([code, name, chapters], i) => ({ code: code as string, name: name as string, chapters: chapters as number, testament: (i < 39 ? "OT" : "NT") as "OT" | "NT" }));
const BY_CODE = new Map(CANON.map((b) => [b.code, b]));
export const bookByCode = (code: string) => BY_CODE.get(String(code ?? "").toUpperCase());

/** "John 3", "Jn 3:16", "1 Cor 13:4-7" → structured reference (or null). */
export function parseReference(raw: string): { bookCode: string; chapter: number; startVerse: number | null; endVerse: number | null } | null {
  const m = String(raw ?? "").trim().replace(/\s+/g, " ").match(/^((?:[1-3]\s?)?[A-Za-z]+(?:\s(?:of\s)?[A-Za-z]+)*)\.?\s+(\d{1,3})(?::(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?)?$/);
  if (!m) return null;
  const name = m[1].toLowerCase().replace(/^([1-3])(?=[a-z])/, "$1 ");
  const code = BOOK_CODES[name] ?? BOOK_CODES[name.replace(/\s/g, "")];
  const book = code ? bookByCode(code) : undefined;
  if (!book) return null;
  const chapter = Number(m[2]);
  if (chapter < 1 || chapter > book.chapters) return null;
  const startVerse = m[3] ? Number(m[3]) : null;
  const endVerse = m[4] ? Number(m[4]) : startVerse;
  if (startVerse !== null && (startVerse < 1 || (endVerse ?? startVerse) < startVerse)) return null;
  return { bookCode: book.code, chapter, startVerse, endVerse };
}

// ── Translations (licence-gated) ────────────────────────────────────────────
type TRow = { translation_code: string; translation_name: string; language: string; is_default_for_language: boolean; license_notes: string | null; api_bible_id: string | null };
let tCache: { at: number; rows: TRow[] } | null = null;
export async function licensedTranslations(): Promise<TRow[]> {
  if (tCache && Date.now() - tCache.at < 5 * 60_000) return tCache.rows;
  const { data, error } = await db.from("p2p_bible_translations")
    .select("translation_code,translation_name,language,is_default_for_language,license_notes,api_bible_id")
    .eq("is_licensed_confirmed", true).order("language").order("translation_code");
  if (error) throw new Error("Couldn't load translations");
  tCache = { at: Date.now(), rows: ((data ?? []) as TRow[]).filter((r) => r.api_bible_id) };
  return tCache.rows;
}
/** Copying verse text is offered only for public-domain translations (licence notes say so). */
export const textCopyAllowed = (r: Pick<TRow, "license_notes">) => /public domain/i.test(r.license_notes ?? "");
export const publicTranslation = (r: TRow) => ({
  code: r.translation_code, name: r.translation_name, language: r.language, isDefault: r.is_default_for_language, textCopyAllowed: textCopyAllowed(r),
});

export class BibleError extends Error { status: number; constructor(message: string, status: number) { super(message); this.status = status; } }

async function providerGet(path: string): Promise<{ data: any; meta?: any }> {
  const key = apiKey();
  if (!key) throw new BibleError("The Bible isn't available right now.", 503);
  const res = await fetch(`${API_BIBLE_BASE}${path}`, { headers: { "api-key": key }, signal: AbortSignal.timeout(12_000) });
  if (res.status === 404) throw new BibleError("That passage isn't available in this translation.", 404);
  if (res.status === 429) throw new BibleError("The Bible is busy right now — please try again in a moment.", 429);
  if (!res.ok) throw new BibleError("The Bible couldn't be loaded. Please try again.", 502);
  return (await res.json()) as { data: any; meta?: any };
}

// ── Chapters ────────────────────────────────────────────────────────────────
export interface ChapterVerse { verse: number; text: string; paragraph: number; poetry: boolean }
export interface Chapter {
  translation: { code: string; name: string; textCopyAllowed: boolean };
  book: { code: string; name: string; chapters: number };
  chapter: number;
  verses: ChapterVerse[];
  headings: { beforeVerse: number; text: string }[];
  copyright: string | null;
  previous: { bookCode: string; chapter: number } | null;
  next: { bookCode: string; chapter: number } | null;
}
const HEADING_STYLES = /^(s\d?|ms\d?|mr|r|d|sp|cl)$/;
// KJV source text carries "¶" paragraph marks; the reader shows paragraphs itself.
const PILCROW = /¶\s*/g;

/** Turn API.Bible's JSON chapter content into verses + headings (no other formatting). */
export function parseChapterContent(content: unknown[]): { verses: ChapterVerse[]; headings: { beforeVerse: number; text: string }[] } {
  const verses = new Map<number, ChapterVerse>();
  const headings: { beforeVerse: number; text: string }[] = [];
  let paragraph = 0;
  let pendingHeading: string[] = [];
  const walkText = (node: any, onText: (t: string, verseId: string | null) => void) => {
    if (!node) return;
    if (typeof node.text === "string") onText(node.text, node.attrs?.verseId ?? null);
    if (node.name === "note") return;
    for (const child of Array.isArray(node.items) ? node.items : []) if (child?.name !== "verse") walkText(child, onText);
  };
  for (const para of Array.isArray(content) ? content : []) {
    const style = String((para as any)?.attrs?.style ?? "");
    if (HEADING_STYLES.test(style)) {
      const parts: string[] = [];
      walkText(para, (t) => parts.push(t));
      const text = parts.join("").replace(/\s+/g, " ").trim();
      if (text) pendingHeading.push(text);
      continue;
    }
    paragraph++;
    walkText(para, (t, verseId) => {
      const n = verseId ? Number(String(verseId).split(".")[2]) : NaN;
      if (!Number.isInteger(n) || n < 1) return;
      const existing = verses.get(n);
      if (!existing) {
        if (pendingHeading.length) { headings.push({ beforeVerse: n, text: pendingHeading.join(" — ") }); pendingHeading = []; }
        verses.set(n, { verse: n, text: t, paragraph, poetry: /^q/.test(style) });
      } else existing.text += (existing.paragraph !== paragraph && /^q/.test(style) ? "\n" : "") + t;
    });
  }
  return {
    verses: [...verses.values()].sort((a, b) => a.verse - b.verse).map((v) => ({ ...v, text: v.text.replace(PILCROW, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim() })),
    headings,
  };
}

const chapterCache = new Map<string, { at: number; value: Chapter }>();
const CHAPTER_TTL = 6 * 60 * 60_000;
const CHAPTER_MAX = 400;

export async function getChapter(bookCode: string, chapter: number, translationCode: string): Promise<Chapter> {
  const book = bookByCode(bookCode);
  if (!book) throw new BibleError("Unknown book", 400);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) throw new BibleError(`${book.name} has ${book.chapters} chapter${book.chapters === 1 ? "" : "s"}`, 400);
  const t = (await licensedTranslations()).find((r) => r.translation_code === translationCode);
  if (!t) throw new BibleError("That translation isn't available", 404);
  const key = `${t.translation_code}:${book.code}.${chapter}`;
  const hit = chapterCache.get(key);
  if (hit && Date.now() - hit.at < CHAPTER_TTL) return hit.value;

  const params = new URLSearchParams({ "content-type": "json", "include-notes": "false", "include-titles": "true",
    "include-chapter-numbers": "false", "include-verse-numbers": "false", "include-verse-spans": "false" });
  const json = await providerGet(`/bibles/${t.api_bible_id}/chapters/${book.code}.${chapter}?${params}`);
  const parsed = parseChapterContent(json.data?.content ?? []);
  if (!parsed.verses.length) throw new BibleError("That passage isn't available in this translation.", 404);
  const step = (x: any) => {
    const b = x?.bookId ? bookByCode(String(x.bookId)) : undefined;
    const n = Number(x?.number);
    return b && Number.isInteger(n) && n >= 1 ? { bookCode: b.code, chapter: n } : null;
  };
  const value: Chapter = {
    translation: { code: t.translation_code, name: t.translation_name, textCopyAllowed: textCopyAllowed(t) },
    book: { code: book.code, name: book.name, chapters: book.chapters }, chapter,
    verses: parsed.verses, headings: parsed.headings,
    copyright: (json.data?.copyright as string | undefined)?.trim() || null,
    previous: step(json.data?.previous), next: step(json.data?.next),
  };
  if (chapterCache.size >= CHAPTER_MAX) chapterCache.delete(chapterCache.keys().next().value as string);
  chapterCache.set(key, { at: Date.now(), value });
  return value;
}

// ── Search ──────────────────────────────────────────────────────────────────
export async function searchBible(q: string, translationCode: string, offset: number) {
  const query = String(q ?? "").trim();
  if (query.length < 2) throw new BibleError("Type at least 2 characters", 400);
  if (query.length > 120) throw new BibleError("That search is too long", 400);
  const ref = parseReference(query);
  if (ref) return { kind: "reference" as const, reference: ref, results: [], total: 0 };
  const t = (await licensedTranslations()).find((r) => r.translation_code === translationCode);
  if (!t) throw new BibleError("That translation isn't available", 404);
  const params = new URLSearchParams({ query, limit: "20", offset: String(Math.max(0, Math.min(1000, offset | 0))), sort: "relevance" });
  const json = await providerGet(`/bibles/${t.api_bible_id}/search?${params}`);
  const verses = (json.data?.verses ?? []) as { id?: string; bookId?: string; reference?: string; text?: string }[];
  return {
    kind: "text" as const, reference: null, total: Number(json.data?.total ?? 0),
    results: verses.map((v) => {
      const [bk, ch, vs] = String(v.id ?? "").split(".");
      const book = bookByCode(bk);
      return book ? { bookCode: book.code, chapter: Number(ch), verse: Number(vs), reference: `${book.name} ${ch}:${vs}`, text: String(v.text ?? "").replace(PILCROW, "").replace(/\s+/g, " ").trim() } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x && Number.isInteger(x.chapter) && Number.isInteger(x.verse)),
  };
}

// ── Related official lessons/plans (from real lesson Scripture references) ─
let refIndex: { at: number; byChapter: Map<string, Set<string>> } | null = null;
async function scriptureIndex() {
  if (refIndex && Date.now() - refIndex.at < 10 * 60_000) return refIndex.byChapter;
  const byChapter = new Map<string, Set<string>>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("p2p_scriptures").select("lesson_id,reference").not("lesson_id", "is", null).range(from, from + 999);
    if (error) throw new Error("Couldn't read lesson references");
    for (const r of (data ?? []) as { lesson_id: string; reference: string | null }[]) {
      for (const part of String(r.reference ?? "").split(/[;,](?=\s*(?:[1-3]\s?)?[A-Za-z])/)) {
        const ref = parseReference(part.trim()) ?? parseReference(part.trim().replace(/[a-z]$/, ""));
        if (!ref) continue;
        const k = `${ref.bookCode}.${ref.chapter}`;
        if (!byChapter.has(k)) byChapter.set(k, new Set());
        byChapter.get(k)!.add(r.lesson_id);
      }
    }
    if ((data ?? []).length < 1000) break;
  }
  refIndex = { at: Date.now(), byChapter };
  return byChapter;
}

/** Published official lessons whose own Scripture references point at this chapter. */
export async function relatedLessons(bookCode: string, chapter: number) {
  const book = bookByCode(bookCode);
  if (!book || !Number.isInteger(chapter)) throw new BibleError("Unknown passage", 400);
  const ids = [...((await scriptureIndex()).get(`${book.code}.${chapter}`) ?? [])].slice(0, 200);
  if (!ids.length) return [];
  const { data: lessons } = await db.from("p2p_lessons").select("id,title,module_id,status").in("id", ids).eq("status", "published");
  const moduleIds = [...new Set((lessons ?? []).map((l) => l.module_id as string))];
  const { data: modules } = moduleIds.length ? await db.from("p2p_modules").select("id,title,curriculum_id").in("id", moduleIds) : { data: [] };
  const curIds = [...new Set((modules ?? []).map((m) => m.curriculum_id as string))];
  const { data: curs } = curIds.length ? await db.from("p2p_curriculums").select("id,title,type,status").in("id", curIds).eq("status", "published") : { data: [] };
  const modBy = new Map((modules ?? []).map((m) => [m.id as string, m]));
  const curBy = new Map((curs ?? []).map((c) => [c.id as string, c]));
  return (lessons ?? []).flatMap((l) => {
    const mod = modBy.get(l.module_id as string);
    const cur = mod ? curBy.get(mod.curriculum_id as string) : undefined;
    if (!mod || !cur) return [];
    return [{ lessonId: l.id as string, lessonTitle: l.title as string, moduleTitle: mod.title as string,
      curriculumId: cur.id as string, curriculumTitle: cur.title as string, kind: cur.type === "plan" ? "plan" as const : "core" as const }];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.curriculumTitle.localeCompare(b.curriculumTitle));
}
export function _resetBibleReaderCachesForTests() { tCache = null; chapterCache.clear(); refIndex = null; }
