// Client for /study-workspace (api-server/src/routes/studyWorkspace.ts): Deep Study History (personal studies)
// and per-person "read" marks on playlist passages. Writes go through the offline queue (lib/offline) so they
// are kept when there is no connection and sent exactly once when it returns.
import { apiRequest } from "@/lib/apiClient";

export type StudyKind = "deep_study" | "my_plan" | "topic_study";
export interface SavedStudy {
  id: string; kind: StudyKind; title: string; focus: Record<string, unknown>; state: StudyState; notes: string | null; folder: string | null; version: number;
  createdAt: string; updatedAt: string; lastOpenedAt: string; clientKey: string | null;
}
/** What a study keeps: the search, chosen sources, saved findings and temporary study highlights. */
export interface StudyState {
  q?: string;
  /** Saved findings — references only, with why they were kept. */
  findings?: { key: string; kind: string; ref: Record<string, unknown>; title: string; why?: string; note?: string; savedAt: string }[];
  /** Temporary study highlights (never written into the person's Bible highlights unless they choose to). */
  studyHighlights?: { book: string; chapter: number; startVerse: number; endVerse: number; group?: string; /** The person's own area ("Identity and nature"). */ area?: string | null }[];
  /** Where the person stopped (section and position). */
  position?: { section?: string; scroll?: number };
  filters?: string[];
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const listStudies = (f: { q?: string; kind?: StudyKind; folder?: string } = {}) => {
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return apiRequest<{ studies: SavedStudy[]; folders: string[] }>(`/study-workspace/studies${qs ? `?${qs}` : ""}`, {}, { fallbackError: "Couldn't load your studies." });
};
export const getStudy = (id: string) => apiRequest<{ study: SavedStudy }>(`/study-workspace/studies/${id}`, {}, { fallbackError: "Couldn't open this study." });
export const createStudy = (b: { clientKey: string; kind: StudyKind; title: string; focus: Record<string, unknown>; state?: StudyState; notes?: string | null; folder?: string | null }) =>
  apiRequest<{ study: SavedStudy; existing?: boolean }>("/study-workspace/studies", json("POST", b), { fallbackError: "Couldn't save the study." });
export const updateStudy = (id: string, b: { baseVersion?: number; title?: string; state?: StudyState; notes?: string | null; folder?: string | null; focus?: Record<string, unknown> }) =>
  apiRequest<{ study: SavedStudy }>(`/study-workspace/studies/${id}`, json("PATCH", b), { fallbackError: "Couldn't save the study.", makeError: conflictError });
export const markStudyOpened = (id: string) => apiRequest(`/study-workspace/studies/${id}/opened`, json("POST"), { fallbackError: "" }).catch(() => null);
export const deleteStudy = (id: string) => apiRequest(`/study-workspace/studies/${id}`, json("DELETE"), { fallbackError: "Couldn't delete the study." });

export const getCollectionReads = (collectionId: string) => apiRequest<{ reads: Record<string, string> }>(`/study-workspace/collections/${collectionId}/reads`, {}, { fallbackError: "" });
export const setPassageRead = (itemId: string, read: boolean) => apiRequest(`/study-workspace/collections/items/${itemId}/read`, json(read ? "POST" : "DELETE"), { fallbackError: "Couldn't update that." });

/** A 409 keeps the server's current copy, so the screen can merge instead of overwriting. */
function conflictError(message: string, status: number, body: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { status, current: body?.current ?? null });
}

// ── Study workspace search (My Plan) — api-server/src/lib/studySearch.ts ──
// "themes" (Biblical Themes) removed 2026-11-18 (owner).
export type StudyGroup = "scriptures" | "stories" | "definitions" | "greek_hebrew" | "commentaries" | "cross_references" | "history" | "mine";
export const STUDY_GROUPS: StudyGroup[] = ["scriptures", "stories", "definitions", "greek_hebrew", "commentaries", "cross_references", "history", "mine"];
export interface Finding {
  key: string; group: StudyGroup; title: string; subtitle: string | null; kind: string; ref: Record<string, unknown>;
  match: "direct" | "conceptual" | "background"; why: { code: string; params?: Record<string, string | number> }; source: string;
}
export interface StudyResults { q: string; findings: Finding[]; counts: Record<StudyGroup, number>; topics: string[]; bibleTotal: number | null; bibleNote: string | null;
  /** Connected concepts (Easton cross-references, lexicon renderings) — each can be searched in turn. */
  concepts?: string[];
  /** What it means: a definition for each word and for the words together (sources only; absent for a reference). */
  meaning?: Meaning | null;
  /** Biblical names, titles and descriptions the search names, or the collection to open (absent for a reference). */
  names?: import("@/lib/biblicalNamesApi").NamesForSearch | null }
export interface MeaningVerse { reference: string; text: string; book: string; chapter: number; verse: number }
export interface MeaningArticle { id: string; title: string; excerpt: string; source: string; via: "word" | "root" | "phrase" }
export interface Meaning {
  terms: { term: string; article: MeaningArticle | null; original: { strongs: string; lemma: string; transliteration: string; gloss: string; language: string; uses: number }[];
    originalSource: string; dictionaryKey: string | null; verses: MeaningVerse[]; verseTotal: number | null; translation: string | null; searchedAs: string }[];
  together: { phrase: string; article: MeaningArticle | null; sentences: { text: string; article: string; articleId: string; source: string }[];
    verses: MeaningVerse[]; translation: string | null; searchedAs: string } | null;
}
export const searchStudy = (q: string, t?: string) =>
  apiRequest<StudyResults>(`/study-workspace/search?q=${encodeURIComponent(q)}${t ? `&t=${encodeURIComponent(t)}` : ""}`, {}, { fallbackError: "Couldn't search right now." });
