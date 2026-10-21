import { Platform } from "react-native";
import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import { BIBLE_BOOKS } from "@/lib/bibleBooks";

// The Bible reader's client (api-server routes/bibleReader.ts). Scripture
// text always comes from the server (licensed API.Bible translations only);
// nothing here holds Bible wording. Study data (highlights, notes, saved
// passages) is the signed-in person's own — identity comes from the token.

export class BibleApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function call<T>(path: string, init?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new BibleApiError("You're offline — check your connection and try again.", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new BibleApiError((body as { error?: string }).error ?? "Something went wrong. Please try again.", res.status);
  return body as T;
}

// ── Canon (structure only: names, USFM codes, chapter counts) ───────────────
const CODES = ["GEN", "EXO", "LEV", "NUM", "DEU", "JOS", "JDG", "RUT", "1SA", "2SA", "1KI", "2KI", "1CH", "2CH", "EZR", "NEH", "EST", "JOB", "PSA", "PRO",
  "ECC", "SNG", "ISA", "JER", "LAM", "EZK", "DAN", "HOS", "JOL", "AMO", "OBA", "JON", "MIC", "NAM", "HAB", "ZEP", "HAG", "ZEC", "MAL",
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP", "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS",
  "1PE", "2PE", "1JN", "2JN", "3JN", "JUD", "REV"];
export interface CanonBook { code: string; name: string; chapters: number; testament: "OT" | "NT" }
export const CANON: CanonBook[] = BIBLE_BOOKS.map((b, i) => ({ code: CODES[i], name: b.name, chapters: b.chapters, testament: i < 39 ? "OT" : "NT" }));
const byCode = new Map(CANON.map((b) => [b.code, b]));
const byName = new Map(CANON.map((b) => [b.name.toLowerCase(), b]));
export const bookByCode = (code: string | null | undefined) => (code ? byCode.get(code.toUpperCase()) : undefined);
/** Book from a display name ("Psalms", "Psalm", "1 Corinthians"). */
export function bookByName(name: string | null | undefined): CanonBook | undefined {
  const n = String(name ?? "").trim().toLowerCase();
  return byName.get(n) ?? byName.get(n.replace(/^psalm$/, "psalms")) ?? (n.length >= 3 ? CANON.find((b) => b.name.toLowerCase().startsWith(n)) : undefined);
}
export function formatRef(book: CanonBook | undefined, chapter: number, sv?: number | null, ev?: number | null) {
  if (!book) return "";
  if (!sv) return `${book.name} ${chapter}`;
  return `${book.name} ${chapter}:${sv}${ev && ev > sv ? `–${ev}` : ""}`;
}
/** A lesson/Gathering reference ("John 3:16-18", "Psalm 23") → where the reader should open. */
export function readerTarget(raw: string | null | undefined): { book: string; chapter: number; v?: number; ve?: number } | null {
  const m = String(raw ?? "").trim().match(/^((?:[1-3]\s?)?[A-Za-z]+(?:\s(?:of\s)?[A-Za-z]+)*)\.?\s+(\d{1,3})(?::(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?)?/);
  if (!m) return null;
  const book = bookByName(m[1].replace(/^([1-3])(?=[A-Za-z])/, "$1 "));
  const chapter = Number(m[2]);
  if (!book || chapter < 1 || chapter > book.chapters) return null;
  return { book: book.code, chapter, ...(m[3] ? { v: Number(m[3]), ve: Number(m[4] ?? m[3]) } : {}) };
}
/** Expo Router params to open the reader on a passage. */
export function bibleRoute(t: { book: string; chapter: number; v?: number; ve?: number; translation?: string | null }) {
  return { pathname: "/bible", params: { book: t.book, chapter: String(t.chapter), ...(t.v ? { v: String(t.v), ve: String(t.ve ?? t.v) } : {}), ...(t.translation ? { t: t.translation } : {}) } };
}

// Scripture reading face: the platform's own serif (no new font dependency).
export const SCRIPTURE_FONT = Platform.select({ ios: "Georgia", android: "serif", default: "Georgia, 'Times New Roman', serif" });

// ── Reading ─────────────────────────────────────────────────────────────────
export interface BibleTranslation { code: string; name: string; language: string; isDefault: boolean; textCopyAllowed: boolean }
export interface ChapterVerse { verse: number; text: string; paragraph: number; poetry: boolean }
export interface BibleChapter {
  translation: { code: string; name: string; textCopyAllowed: boolean };
  book: { code: string; name: string; chapters: number };
  chapter: number; verses: ChapterVerse[]; headings: { beforeVerse: number; text: string }[];
  copyright: string | null;
  previous: { bookCode: string; chapter: number } | null; next: { bookCode: string; chapter: number } | null;
}
export const getTranslations = () => call<{ translations: BibleTranslation[] }>("/bible/reader/translations");
const chapterCache = new Map<string, BibleChapter>();
export async function getChapter(book: string, chapter: number, t: string, signal?: AbortSignal): Promise<BibleChapter> {
  const key = `${t}:${book}.${chapter}`;
  const hit = chapterCache.get(key);
  if (hit) return hit;
  const c = await call<BibleChapter>(`/bible/reader/chapter?book=${encodeURIComponent(book)}&chapter=${chapter}&t=${encodeURIComponent(t)}`, { signal });
  if (chapterCache.size > 60) chapterCache.delete(chapterCache.keys().next().value as string);
  chapterCache.set(key, c);
  return c;
}
export interface SearchResult { bookCode: string; chapter: number; verse: number; reference: string; text: string }
export const searchBible = (q: string, t: string, offset: number, signal?: AbortSignal) =>
  call<{ kind: "reference" | "text"; reference: { bookCode: string; chapter: number; startVerse: number | null; endVerse: number | null } | null; results: SearchResult[]; total: number }>(
    `/bible/reader/search?q=${encodeURIComponent(q)}&t=${encodeURIComponent(t)}&offset=${offset}`, { signal });
export interface RelatedLesson { lessonId: string; lessonTitle: string; moduleTitle: string; curriculumId: string; curriculumTitle: string; kind: "core" | "plan" }
export const getRelatedLessons = (book: string, chapter: number) => call<{ lessons: RelatedLesson[] }>(`/bible/reader/related?book=${book}&chapter=${chapter}`);

// ── My study data ────────────────────────────────────────────────────────────
// "underline" is a style (no fill) — for readers who prefer it, and readable in any theme.
export const HIGHLIGHT_COLORS = ["gold", "green", "blue", "rose", "violet", "underline"] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];
export interface PassageRef { translationCode: string; bookCode: string; bookName: string; chapter: number; startVerse: number; endVerse: number; reference: string }
/** startOffset/endOffset: exact characters within the start/end verse (null = whole-verse edge). */
export interface Highlight extends PassageRef { id: string; color: HighlightColor; startOffset: number | null; endOffset: number | null }
export interface BibleNote extends PassageRef { id: string; title: string | null; body: string; updatedAt: string }
export interface Bookmark extends PassageRef { id: string }
export type NewRef = { translationCode: string; bookCode: string; chapter: number; startVerse: number; endVerse: number };
export const getMyChapter = (t: string, book: string, chapter: number) =>
  call<{ available: boolean; highlights: Highlight[]; notes: BibleNote[]; bookmarks: Bookmark[] }>(`/bible/me/chapter?t=${encodeURIComponent(t)}&book=${book}&chapter=${chapter}`);
export type Offsets = { startOffset: number | null; endOffset: number | null };
/** Highlights EXACTLY the given text; overlapped older highlights keep their parts outside it. */
export const addHighlight = (r: NewRef, color: HighlightColor, off?: Offsets) =>
  call<Highlight & { replaced: Highlight[]; pieces: Highlight[] }>("/bible/me/highlights", { method: "POST", body: JSON.stringify({ ...r, ...(off ?? {}), color }) });
/** Removes highlighting from exactly the given text (the rest stays). */
export const eraseHighlight = (r: NewRef, off?: Offsets) =>
  call<{ replaced: Highlight[]; pieces: Highlight[] }>("/bible/me/highlights/erase", { method: "POST", body: JSON.stringify({ ...r, ...(off ?? {}) }) });
/** Undo: delete these (own) highlights and re-create those. */
export const restoreHighlights = (remove: string[], add: (NewRef & Offsets & { color: HighlightColor })[]) =>
  call<{ created: Highlight[] }>("/bible/me/highlights/restore", { method: "POST", body: JSON.stringify({ remove, add }) });
export const recolorHighlight = (id: string, color: HighlightColor) => call<Highlight>(`/bible/me/highlights/${id}`, { method: "PUT", body: JSON.stringify({ color }) });
export const removeHighlight = (id: string) => call<{ removed: true }>(`/bible/me/highlights/${id}`, { method: "DELETE" });
export const addNote = (r: NewRef, title: string | null, body: string) => call<BibleNote>("/bible/me/notes", { method: "POST", body: JSON.stringify({ ...r, title, body }) });
export const updateNote = (id: string, title: string | null, body: string) => call<BibleNote>(`/bible/me/notes/${id}`, { method: "PUT", body: JSON.stringify({ title, body }) });
export const deleteNote = (id: string) => call<{ removed: true }>(`/bible/me/notes/${id}`, { method: "DELETE" });
export const saveBookmark = (r: NewRef) => call<Bookmark>("/bible/me/bookmarks", { method: "POST", body: JSON.stringify(r) });
export const removeBookmark = (id: string) => call<{ removed: true }>(`/bible/me/bookmarks/${id}`, { method: "DELETE" });
export const getLibrary = (kind: "notes" | "highlights" | "saved", offset: number) =>
  call<{ available: boolean; items: (Highlight | BibleNote | Bookmark)[]; hasMore: boolean }>(`/bible/me/library?kind=${kind}&offset=${offset}`);

/**
 * Highlight colours, readable on the current P2P theme: a light wash under
 * dark text in light mode, a deeper translucent wash under light text in
 * dark mode. The swatch is the solid colour for the picker.
 */
export function highlightPalette(mode: "light" | "dark"): Record<HighlightColor, { wash: string; swatch: string; label: string }> {
  const dark = mode === "dark";
  return {
    gold: { wash: dark ? "rgba(212,160,23,0.32)" : "rgba(250,204,21,0.38)", swatch: "#D4A017", label: "Gold" },
    green: { wash: dark ? "rgba(52,168,83,0.30)" : "rgba(134,239,172,0.55)", swatch: "#34A853", label: "Green" },
    blue: { wash: dark ? "rgba(66,133,244,0.32)" : "rgba(147,197,253,0.55)", swatch: "#4285F4", label: "Blue" },
    rose: { wash: dark ? "rgba(236,72,153,0.30)" : "rgba(249,168,212,0.55)", swatch: "#EC4899", label: "Rose" },
    violet: { wash: dark ? "rgba(139,92,246,0.32)" : "rgba(196,181,253,0.6)", swatch: "#8B5CF6", label: "Violet" },
    // No fill: an underline in the reading colour (see the reader's run style).
    underline: { wash: "transparent", swatch: dark ? "#E5E7EB" : "#374151", label: "Underline" },
  };
}
