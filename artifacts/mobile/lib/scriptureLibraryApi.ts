import { apiRequest } from "@/lib/apiClient";
import type { NewRef } from "@/lib/bibleReaderApi";
import type { CollectionCover, CollectionKind } from "@/lib/scriptureCollectionsApi";

// Scripture Listening Library (routes/scriptureLibrary.ts, migration 227):
// the person's own Saved Scriptures details, favourites, listening history and
// where they are in each playlist. All of it is private to them — the server
// never shows it to anyone else, including the owner of a shared playlist.
// Playlists and collections themselves: lib/scriptureCollectionsApi.ts.
// Only references travel; Bible text always comes live from the Bible service.

export type Memorisation = "to_learn" | "practising" | "memorised";
export const MEMORISATION_LABEL: Record<Memorisation, string> = { to_learn: "To learn", practising: "Practising", memorised: "Memorised" };
export type RepeatMode = "off" | "one" | "all";
export type ListenSource = "playlist" | "collection" | "bible" | "search" | "library";

export interface PassageRef {
  translationCode: string; bookCode: string; bookName: string; chapter: number; startVerse: number; endVerse: number; reference: string;
}
export interface SavedScripture extends PassageRef {
  id: string; title: string | null; tags: string[]; memorisation: Memorisation | null; favourite: boolean; savedAt: string; updatedAt: string;
}
export interface Favourites {
  passages: (PassageRef & { id: string; favouritedAt: string })[];
  playlists: { id: string; collectionId: string; kind: CollectionKind; title: string; favouritedAt: string }[];
  collections: { id: string; collectionId: string; kind: CollectionKind; title: string; favouritedAt: string }[];
}
export interface HistoryItem extends PassageRef {
  id: string; source: ListenSource; startedAt: string; completedAt: string | null; listenedSeconds: number | null;
  collection: { id: string; title: string } | null;
}
export interface ResumeState {
  itemId: string | null; partKey: string | null; offset: number; queue: string[]; shuffle: boolean; repeat: RepeatMode; rate: number; updatedAt?: string;
}
export interface SaveResult {
  reference: string;
  saved: string | null;
  favourite: string | null;
  /** One result per playlist/collection — a failure in one never undoes the others. */
  collections: { id: string; status: "added" | "already" | "failed"; error?: string }[];
}

const call = <T,>(path: string, init: RequestInit = {}) =>
  apiRequest<T>(`/scripture-library${path}`, init, { fallbackError: "That didn't work. Please try again." });
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
const qs = (o: Record<string, string | number | boolean | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, v === true ? "1" : String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

// Saved Scriptures
export const listSaved = (o: { q?: string; tag?: string; memorisation?: Memorisation; favourites?: boolean; sort?: "added" | "updated" | "reference"; offset?: number } = {}) =>
  call<{ total: number; nextOffset: number | null; tags: string[]; items: SavedScripture[] }>(`/saved${qs(o)}`);
export const updateSaved = (id: string, patch: { title?: string | null; tags?: string[]; memorisation?: Memorisation | null }) =>
  call<PassageRef & { id: string; title: string | null; tags: string[]; memorisation: Memorisation | null }>(`/saved/${id}`, json("PATCH", patch));
/**
 * One passage into several places at once (Saved by default, Favourites,
 * playlists, collections). Nothing is stored twice; each destination reports back.
 */
export const saveScripture = (ref: NewRef, to: { saved?: boolean; favourite?: boolean; collectionIds?: string[]; allowRepeat?: boolean } = {}) =>
  call<SaveResult>("/save", json("POST", { ref, ...to }));

// Favourites
export const listFavourites = () => call<Favourites>("/favourites");
export const favouritePassage = (ref: NewRef) => call<{ id: string }>("/favourites", json("PUT", { ref }));
export const favouriteCollection = (collectionId: string) => call<{ id: string }>("/favourites", json("PUT", { collectionId }));
/** Removes the favourite only — the passage, playlist or collection stays. */
export const removeFavourite = (id: string) => call<{ removed: true }>(`/favourites/${id}`, { method: "DELETE" });

// Listening history (one entry per passage listened)
export const listHistory = (limit = 30) => call<{ items: HistoryItem[] }>(`/history${qs({ limit })}`);
export const historyStarted = (ref: NewRef, o: { collectionId?: string; itemId?: string; source?: ListenSource } = {}) =>
  call<{ id: string; reused: boolean }>("/history", json("POST", { ref, ...o }));
export const historyCompleted = (id: string, listenedSeconds?: number) => call<{ completed: true }>(`/history/${id}/complete`, json("POST", { listenedSeconds }));
/** Clears listening history only — playlists, saved passages and favourites stay. */
export const clearHistory = () => call<{ cleared: number }>("/history", { method: "DELETE" });

// Resume
export const recentlyPlayed = () => call<{ items: { id: string; kind: CollectionKind; title: string; cover: CollectionCover | null; state: ResumeState }[] }>("/recent");
export const getResume = (collectionId: string) => call<{ state: ResumeState | null }>(`/state/${collectionId}`);
export const saveResume = (collectionId: string, s: Omit<ResumeState, "updatedAt">) => call<{ saved: true }>(`/state/${collectionId}`, json("PUT", s));
