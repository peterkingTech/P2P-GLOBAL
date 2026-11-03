// Scripture Listening Library — the app's own rules as plain functions
// (tests/scriptureLibrary.test.mjs): library filters and sorting, duration
// estimates, what a search query is, exact-phrase checks, shuffle and the
// listening queue. No React, no network.

import type { CollectionCard } from "@/lib/scriptureCollectionsApi";

// ── Library home ────────────────────────────────────────────────────────────
export type LibraryFilter = "all" | "playlists" | "collections" | "shared" | "private" | "favourites";
export type LibrarySort = "updated" | "alpha" | "played" | "mine";
export const LIBRARY_FILTERS: { value: LibraryFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "playlists", label: "Playlists" }, { value: "collections", label: "Collections" },
  { value: "favourites", label: "Favourites" }, { value: "shared", label: "Shared" }, { value: "private", label: "Private" },
];
export const LIBRARY_SORTS: { value: LibrarySort; label: string }[] = [
  { value: "updated", label: "Recently updated" }, { value: "played", label: "Recently played" }, { value: "alpha", label: "A–Z" }, { value: "mine", label: "Created by me" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase();
/** Playlists/collections matching a filter and a search (title, description, tags). */
export function filterCards(cards: CollectionCard[], filter: LibraryFilter, favouriteIds: Set<string>, query = ""): CollectionCard[] {
  const q = fold(query.trim());
  return cards.filter((x) => {
    if (filter === "playlists" && x.kind !== "playlist") return false;
    if (filter === "collections" && x.kind !== "collection") return false;
    if (filter === "shared" && !x.ownerName && !x.shareCount) return false;
    if (filter === "private" && (x.ownerName || x.shareCount)) return false;
    if (filter === "favourites" && !favouriteIds.has(x.id)) return false;
    if (!q) return true;
    return [x.title, x.description ?? "", ...(x.tags ?? [])].some((t) => fold(t).includes(q));
  });
}
/** Sorted copy. "played" uses when I last listened (never-played last); "mine" puts my own first. */
export function sortCards(cards: CollectionCard[], sort: LibrarySort, playedAt: Map<string, string> = new Map()): CollectionCard[] {
  const byUpdated = (a: CollectionCard, b: CollectionCard) => b.updatedAt.localeCompare(a.updatedAt);
  const list = [...cards];
  if (sort === "alpha") return list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
  if (sort === "played") return list.sort((a, b) => (playedAt.get(b.id) ?? "").localeCompare(playedAt.get(a.id) ?? "") || byUpdated(a, b));
  if (sort === "mine") return list.sort((a, b) => Number(!!a.ownerName) - Number(!!b.ownerName) || byUpdated(a, b));
  return list.sort(byUpdated);
}

/**
 * Rough listening time: device voices read about 10 seconds per verse at
 * normal speed. Shown as "about N min" — never as an exact duration.
 */
export function estimateMinutes(items: { startVerse: number; endVerse: number }[], rate = 1): number {
  const verses = items.reduce((n, i) => n + Math.max(1, i.endVerse - i.startVerse + 1), 0);
  return verses ? Math.max(1, Math.round((verses * 10) / 60 / (rate || 1))) : 0;
}

// ── Search ──────────────────────────────────────────────────────────────────
export type QueryKind = { kind: "phrase"; phrase: string } | { kind: "reference" } | { kind: "words"; words: string } | { kind: "empty" };
const QUOTED = /^\s*["“”„«»'‘’](.+?)["“”„«»'‘’]\s*$/;
// "John 3:16", "1 Cor 13", "Psalm 23:1-6", "Jn 3.16", "2 Timothy 3:16–17"
const REF_SHAPE = /^\s*((?:[1-3]|i{1,3})\s*)?([^\d\s:.,;-][^\d:,;]*?)\s*\.?\s*(\d{1,3})(?:\s*[:.]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?\s*$/i;
/**
 * What did the person type? A quoted phrase, a Bible reference (only when the
 * words before the numbers really are a book — "Love 3" is a word search), or
 * words. The server parses references authoritatively; this decides the hint.
 */
export function classifyQuery(raw: string, isBook: (name: string) => boolean): QueryKind {
  const q = raw.trim();
  if (!q) return { kind: "empty" };
  const quoted = q.match(QUOTED);
  if (quoted && quoted[1].trim().length >= 2) return { kind: "phrase", phrase: quoted[1].trim() };
  const m = q.match(REF_SHAPE);
  if (m) {
    const num = (m[1] ?? "").trim().toLowerCase().replace(/^iii$/, "3").replace(/^ii$/, "2").replace(/^i$/, "1");
    const name = `${num ? `${num} ` : ""}${m[2].trim().replace(/\.$/, "")}`;
    if (isBook(name)) return { kind: "reference" };
  }
  return { kind: "words", words: q.replace(/["“”]/g, "").trim() };
}
const plain = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
/** Does the verse text contain the phrase exactly (ignoring case, accents and punctuation)? */
export const containsPhrase = (text: string, phrase: string) => !!plain(phrase) && ` ${plain(text)} `.includes(` ${plain(phrase)} `);

// ── Listening queue ─────────────────────────────────────────────────────────
/**
 * A shuffled listening order: every item once, the one playing now first, so
 * nothing repeats before everything has had its turn. The saved playlist
 * order is never touched — this is only the order of this listening session.
 */
export function shuffleOrder<T>(ids: T[], current: T | null, rand: () => number = Math.random): T[] {
  const rest = ids.filter((x) => x !== current);
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return current != null && ids.includes(current) ? [current, ...rest] : rest;
}
/** Back to the playlist's own order, keeping the passage that's playing. */
export const unshuffle = <T,>(original: T[]) => [...original];

export type QueueOp =
  | { op: "playNext"; id: string; after: string | null }
  | { op: "add"; id: string }
  | { op: "remove"; id: string }
  | { op: "move"; id: string; to: number }
  | { op: "clear"; keep: string | null };
/** Apply a queue change (ids are queue entry ids; each appears at most once). */
export function applyQueueOp(queue: string[], o: QueueOp): string[] {
  const q = queue.filter((x) => x !== ("id" in o ? o.id : null));
  switch (o.op) {
    case "add": return [...q, o.id];
    case "playNext": { const at = o.after ? q.indexOf(o.after) : -1; q.splice(at + 1, 0, o.id); return q; }
    case "remove": return q;
    case "move": { if (!queue.includes(o.id)) return queue; q.splice(Math.max(0, Math.min(o.to, q.length)), 0, o.id); return q; }
    case "clear": return o.keep && queue.includes(o.keep) ? [o.keep] : [];
  }
}

/**
 * Previous: if the passage has been playing a little while (past its first
 * couple of sentences) start it again; otherwise go to the passage before.
 */
export const PREVIOUS_RESTART_AFTER = 2;
export const previousGoesBack = (sentenceInPassage: number) => sentenceInPassage < PREVIOUS_RESTART_AFTER;
