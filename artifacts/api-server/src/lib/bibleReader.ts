import { supabaseServiceRole as db } from "./supabase";
import { BOOK_CODES } from "./bibleService";
import { attributionOf, canCache, canPlayRecordedAudio, isServable, providerOf, textCopyAllowed as licenceTextCopyAllowed, type TranslationRow } from "./bibleLicence";
import { getHelloAoBooks, getHelloAoCatalogue, getHelloAoChapter, HelloAoError, type HelloAoTranslation } from "./bibleProviders/helloao";
import { CURATED_TRANSLATIONS } from "./bibleProviders/helloaoRegistry";

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
// Two providers: API.Bible (existing rows) and AO Lab's Free Use Bible API
// (only after a person has approved the translation's own licence). Every rule
// is in lib/bibleLicence.ts. `select("*")` so this works before and after
// migration 225 adds the licence columns.
type TRow = TranslationRow;
let tCache: { at: number; rows: TRow[] } | null = null;
export async function licensedTranslations(): Promise<TRow[]> {
  if (tCache && Date.now() - tCache.at < 5 * 60_000) return tCache.rows;
  const { data, error } = await db.from("p2p_bible_translations")
    .select("*").eq("is_licensed_confirmed", true).order("language").order("translation_code");
  if (error) throw new Error("Couldn't load translations");
  const rows = ((data ?? []) as TRow[]).filter(isServable);
  // Language names for every language a translation uses (the app knows only its own interface languages).
  const { data: langs } = await db.from("p2p_languages").select("code,name_en");
  const names = new Map(((langs ?? []) as { code: string; name_en: string | null }[]).map((l) => [l.code, l.name_en]));
  const all = [...rows, ...(await previewRows(rows))];
  tCache = { at: Date.now(), rows: all.map((r) => ({ ...r, language_name: r.language_name ?? names.get(r.language) ?? null })) };
  return tCache.rows;
}
export const clearTranslationCache = () => { tCache = null; };

// Local machine only: HELLOAO_PREVIEW=BSB,arb_vdv shows those AO Lab
// translations BEFORE review so the integration can be tried. Ignored on the
// deployed server (Railway always sets its project variables) — real use needs
// an approved licence row.
const onDeployedServer = () => !!(process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID);
async function previewRows(existing: TRow[]): Promise<TRow[]> {
  const ids = (process.env.HELLOAO_PREVIEW ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || onDeployedServer()) return [];
  const have = new Set(existing.map((r) => r.provider_translation_id).filter(Boolean));
  // HELLOAO_PREVIEW=curated: the whole APPROVED curated library (helloaoRegistry.ts) with its recorded licence details.
  if (ids.includes("curated")) {
    return CURATED_TRANSLATIONS.filter((c) => c.status === "approved" && !have.has(c.id)).map((c) => ({
      translation_code: `AO-${c.id}`.slice(0, 40), translation_name: c.name, language: c.lang, is_default_for_language: false,
      license_notes: c.licence, api_bible_id: null, provider: "helloao", provider_translation_id: c.id, abbreviation: c.abbreviation,
      text_direction: c.textDirection, copyright_notice: c.copyright, licence_name: c.licence, licence_url: c.licenceUrl, attribution: c.attribution,
      source_url: c.source, description: c.coverageLabel, coverage: c.coverage, is_curated: true, selection_rationale: c.rationale,
      permits_sharing: c.licence === "Public domain", language_name: c.languageName, preview: true,
    }));
  }
  const catalogue = await getHelloAoCatalogue().catch(() => [] as HelloAoTranslation[]);
  return catalogue.filter((t) => ids.includes(t.id) && !have.has(t.id)).map((t) => ({
    translation_code: `AO-${t.id}`.slice(0, 40), translation_name: `${t.englishName} (preview — licence not yet approved)`,
    language: languageForPreview(t.language), is_default_for_language: false, license_notes: null, api_bible_id: null,
    provider: "helloao", provider_translation_id: t.id, abbreviation: t.shortName, text_direction: t.textDirection,
    licence_url: t.licenseUrl, source_url: t.website, attribution: null, licence_name: null, preview: true,
  }));
}
// Preview only: AO Lab uses ISO 639-3 codes; map the app's languages, else keep the code.
const ISO3: Record<string, string> = { eng: "en", deu: "de", fra: "fr", spa: "es", por: "pt", swh: "sw", ita: "it", nld: "nl", arb: "ar", hin: "hi", cmn: "zh", rus: "ru", pol: "pl", tur: "tr", ukr: "uk", vie: "vi", ind: "id", kor: "ko", jpn: "ja", pes: "fa", urd: "ur", ben: "bn", tam: "ta", tel: "te", tha: "th", heb: "he", yor: "yo", ibo: "ig", hau: "ha", zul: "zu", ron: "ro", tgl: "tl", twi: "tw" };
const languageForPreview = (iso3: string) => ISO3[iso3] ?? iso3;

/** Copying verse text: API.Bible public-domain translations, or AO Lab ones whose licence permits sharing. */
export const textCopyAllowed = (r: TRow) => licenceTextCopyAllowed(r);
export const publicTranslation = (r: TRow) => ({
  code: r.translation_code, name: r.translation_name, language: r.language, isDefault: r.is_default_for_language, textCopyAllowed: textCopyAllowed(r),
  // Additions (older app versions ignore them):
  provider: providerOf(r) === "helloao" ? "helloao" : "api.bible",
  providerName: providerOf(r) === "helloao" ? "Free Use Bible API (AO Lab)" : "API.Bible",
  abbreviation: r.abbreviation ?? r.translation_code,
  textDirection: r.text_direction === "rtl" ? "rtl" : "ltr",
  attribution: attributionOf(r),
  licenceUrl: providerOf(r) === "helloao" ? r.licence_url ?? null : null,
  preview: r.preview === true,
  languageName: r.language_name ?? null,
  // How much Scripture it has (recorded for AO Lab translations; API.Bible ones are complete Bibles).
  coverage: r.coverage ?? null,
  coverageLabel: r.coverage ? r.description ?? null : null,
  // Recorded audio: only when the provider supplies it AND the reviewed licence permits it (never assumed).
  recordedAudio: canPlayRecordedAudio(r),
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
/** `through`: the last verse this text covers, when a translation joins verses (The Message: "1–2"). */
export interface ChapterVerse { verse: number; text: string; paragraph: number; poetry: boolean; through?: number }
export interface Chapter {
  translation: { code: string; name: string; textCopyAllowed: boolean; provider?: string; textDirection?: "ltr" | "rtl" };
  book: { code: string; name: string; chapters: number };
  chapter: number;
  verses: ChapterVerse[];
  headings: { beforeVerse: number; text: string }[];
  copyright: string | null;
  previous: { bookCode: string; chapter: number } | null;
  next: { bookCode: string; chapter: number } | null;
  /** AO Lab: the source's footnotes (API.Bible chapters are requested without notes). */
  footnotes?: { verse: number | null; caller: string | null; text: string }[];
  /** AO Lab: recorded audio — present ONLY when its licence was reviewed and permits it. */
  audio?: { reader: string; url: string; timings: number[] | null }[];
}
const HEADING_STYLES = /^(s\d?|ms\d?|mr|r|d|sp|cl)$/;
// KJV source text carries "¶" paragraph marks; the reader shows paragraphs itself.
const PILCROW = /¶\s*/g;
// Verse ids: BOOK.CHAPTER.VERSE[letter], optionally "-BOOK.CHAPTER.VERSE[letter]" for joined verses.
const VERSE_ID = /^[1-3A-Z][A-Z0-9]{2}\.\d+\.(\d+)[a-z]?(?:-[1-3A-Z][A-Z0-9]{2}\.\d+\.(\d+)[a-z]?)?$/;

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
      // "JHN.3.16", "JHN.3.29a", or a joined range "JHN.3.1-JHN.3.2" (paraphrases such as The Message).
      const id = verseId ? VERSE_ID.exec(String(verseId)) : null;
      const n = id ? Number(id[1]) : NaN;
      if (!Number.isInteger(n) || n < 1) return;
      const end = id?.[2] ? Number(id[2]) : n;
      const existing = verses.get(n);
      if (!existing) {
        if (pendingHeading.length) { headings.push({ beforeVerse: n, text: pendingHeading.join(" — ") }); pendingHeading = []; }
        verses.set(n, { verse: n, text: t, paragraph, poetry: /^q/.test(style), ...(end > n ? { through: end } : {}) });
      } else {
        existing.text += (existing.paragraph !== paragraph && /^q/.test(style) ? "\n" : "") + t;
        if (end > (existing.through ?? existing.verse)) existing.through = end;
      }
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
const helloAoPending = new Map<string, Promise<Chapter>>();

/** An AO Lab chapter in the reader's model; provider failures become BibleErrors (the user's choice is never switched). */
async function helloAoChapter(t: TRow, book: { code: string; name: string; chapters: number }, chapter: number): Promise<Chapter> {
  try {
    const c = await getHelloAoChapter(String(t.provider_translation_id), book.code, chapter);
    return {
      translation: { code: t.translation_code, name: t.translation_name, textCopyAllowed: textCopyAllowed(t), provider: "helloao", textDirection: t.text_direction === "rtl" ? "rtl" : "ltr" },
      book: { code: book.code, name: book.name, chapters: book.chapters }, chapter,
      verses: c.verses.map(({ wordsOfJesus: _w, ...v }) => v), headings: c.headings,
      copyright: attributionOf(t),
      previous: c.previous && bookByCode(c.previous.bookCode) ? c.previous : null,
      next: c.next && bookByCode(c.next.bookCode) ? c.next : null,
      footnotes: c.footnotes,
      ...(canPlayRecordedAudio(t) && c.audio.length ? { audio: c.audio } : {}),
    };
  } catch (e) {
    if (e instanceof HelloAoError) throw new BibleError(e.message, e.status);
    throw new BibleError("The Bible couldn't be loaded. Please try again.", 502);
  }
}

/** The books a translation actually has (AO Lab translations may be incomplete); API.Bible: the full canon. */
export async function booksFor(translationCode: string) {
  const t = translationCode ? (await licensedTranslations()).find((r) => r.translation_code === translationCode) : null;
  if (!t || providerOf(t) !== "helloao") return CANON;
  try {
    const have = new Map((await getHelloAoBooks(String(t.provider_translation_id))).map((b) => [b.id, b.numberOfChapters]));
    return CANON.filter((b) => have.has(b.code));
  } catch (e) {
    if (e instanceof HelloAoError) throw new BibleError(e.message, e.status);
    throw e;
  }
}

export async function getChapter(bookCode: string, chapter: number, translationCode: string): Promise<Chapter> {
  const book = bookByCode(bookCode);
  if (!book) throw new BibleError("Unknown book", 400);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.chapters) throw new BibleError(`${book.name} has ${book.chapters} chapter${book.chapters === 1 ? "" : "s"}`, 400);
  const t = (await licensedTranslations()).find((r) => r.translation_code === translationCode);
  if (!t) throw new BibleError("That translation isn't available", 404);
  // Cache keys carry the provider, so the two providers never share entries.
  const key = `${providerOf(t)}:${t.translation_code}:${book.code}.${chapter}`;
  const hit = chapterCache.get(key);
  if (hit && Date.now() - hit.at < CHAPTER_TTL) return hit.value;
  if (providerOf(t) === "helloao") {
    const pending = helloAoPending.get(key);
    if (pending) return pending;   // identical requests at the same time share one provider call
    const p = helloAoChapter(t, book, chapter).finally(() => helloAoPending.delete(key));
    helloAoPending.set(key, p);
    const value = await p;
    // Kept in memory only if this translation's licence permits caching.
    if (canCache(t)) {
      if (chapterCache.size >= CHAPTER_MAX) chapterCache.delete(chapterCache.keys().next().value as string);
      chapterCache.set(key, { at: Date.now(), value });
    }
    return value;
  }

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
  // AO Lab offers no search; references (above) still work in every translation.
  if (providerOf(t) === "helloao") throw new BibleError("Word search isn't available for this translation yet. Search by reference (e.g. John 3:16), or switch translation to search words.", 400);
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

// ── Exact-text highlight ranges ─────────────────────────────────────────────
// A highlight covers (startVerse, startOffset) up to (endVerse, endOffset),
// end EXCLUSIVE; offsets are character positions in the verse text as served
// by getChapter(). A null startOffset means "from the verse's start" and a
// null endOffset "to the verse's end" (whole verses — the original model).
export interface HlRange { sv: number; so: number | null; ev: number; eo: number | null }
const startKey = (r: HlRange) => [r.sv, r.so ?? 0] as const;
const endKey = (r: HlRange) => [r.ev, r.eo ?? Number.POSITIVE_INFINITY] as const;
const lt = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
/** Two ranges share at least one character. */
export function rangesOverlap(a: HlRange, b: HlRange): boolean {
  return lt(startKey(a), endKey(b)) && lt(startKey(b), endKey(a));
}
/**
 * `existing` minus `cut`: the 0, 1 or 2 pieces of an older highlight that a
 * new highlight (or an erase) doesn't cover — so its untouched words keep
 * their colour instead of the whole highlight disappearing.
 */
export function subtractRange(existing: HlRange, cut: HlRange): HlRange[] {
  if (!rangesOverlap(existing, cut)) return [existing];
  const pieces: HlRange[] = [];
  // Left piece: existing.start → cut.start (exclusive).
  if (lt(startKey(existing), startKey(cut))) {
    const left: HlRange = (cut.so ?? 0) === 0
      ? { sv: existing.sv, so: existing.so, ev: cut.sv - 1, eo: null }
      : { sv: existing.sv, so: existing.so, ev: cut.sv, eo: cut.so };
    if (left.ev >= left.sv && lt(startKey(left), endKey(left))) pieces.push(left);
  }
  // Right piece: cut.end (exclusive) → existing.end.
  if (lt(endKey(cut), endKey(existing))) {
    const right: HlRange = cut.eo == null
      ? { sv: cut.ev + 1, so: null, ev: existing.ev, eo: existing.eo }
      : { sv: cut.ev, so: cut.eo, ev: existing.ev, eo: existing.eo };
    if (right.ev >= right.sv && lt(startKey(right), endKey(right))) pieces.push(right);
  }
  return pieces;
}
