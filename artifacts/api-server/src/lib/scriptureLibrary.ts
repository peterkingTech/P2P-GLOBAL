// Scripture Listening Library — every rule as a plain function
// (tests/scriptureLibrary.test.mjs). Migration 227 adds the data; routes/
// scriptureLibrary.ts and routes/scriptureCollections.ts apply these rules.
//
//   • A passage's identity is its reference (translation, book, chapter,
//     verses) — the same key 220 uses (refKey) — so one Scripture saved,
//     favourited and placed in several playlists is never duplicated.
//   • Titles, tags, memorisation, favourites, history and resume state are
//     private to their owner. Nothing here is ever shown to anyone else.
//   • History is one row per passage listened: a repeated "start" for the same
//     passage soon after reuses the open row instead of adding another.

import { refKey, type ItemRef } from "./scriptureAccess";

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 30;
export const MEMORISATION = ["to_learn", "practising", "memorised"] as const;
export type Memorisation = (typeof MEMORISATION)[number];
export const COVER_KINDS = ["artwork", "colour", "image"] as const;
export type CoverKind = (typeof COVER_KINDS)[number];
export const REPEAT_MODES = ["off", "one", "all"] as const;
export type RepeatMode = (typeof REPEAT_MODES)[number];
export const RATES = [0.75, 1, 1.25, 1.5] as const;
export const SOURCES = ["playlist", "collection", "bible", "search", "library"] as const;
export type Source = (typeof SOURCES)[number];
/** A "start" for the same passage within this window continues the open history row. */
export const HISTORY_REUSE_MS = 10 * 60_000;
export const MAX_QUEUE = 200;

/** Tags: trimmed, single-spaced, case-insensitively unique, at most 20 of 30 characters. Null = not a list. */
export function cleanTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH);
    const key = tag.toLocaleLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}

/** A personal title: trimmed, at most 120 characters; empty clears it. */
export function cleanTitle(raw: unknown): string | null {
  if (raw === null) return null;
  const t = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  return t ? t.slice(0, 120) : null;
}

/** Memorisation status, or null to clear; undefined when the value isn't allowed. */
export function memorisation(raw: unknown): Memorisation | null | undefined {
  if (raw === null) return null;
  return (MEMORISATION as readonly unknown[]).includes(raw) ? (raw as Memorisation) : undefined;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
// An uploaded cover lives in the app's existing storage under the owner's own folder.
const IMAGE_PATH = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/;
/**
 * A cover: built-in artwork or a theme colour (by name — never a raw colour),
 * or the owner's own uploaded image (a path inside their own folder).
 * null = the default cover. Returns a message when it isn't valid.
 */
export function cleanCover(raw: unknown, ownerId: string): { kind: CoverKind; ref: string } | null | string {
  if (raw === null) return null;
  const c = raw as { kind?: unknown; ref?: unknown } | undefined;
  const kind = c?.kind, ref = typeof c?.ref === "string" ? c.ref.trim() : "";
  if (!(COVER_KINDS as readonly unknown[]).includes(kind)) return "Choose a cover.";
  if (kind === "image") return IMAGE_PATH.test(ref) && ref.startsWith(`${ownerId}/`) ? { kind: "image", ref } : "That image can't be used as a cover.";
  return SLUG.test(ref) ? { kind: kind as CoverKind, ref } : "Choose a cover.";
}

/** Which of these references are already in the list (by reference identity). */
export function alreadyIn(existing: ItemRef[], incoming: ItemRef[]): Set<string> {
  const have = new Set(existing.map(refKey));
  return new Set(incoming.map(refKey).filter((k) => have.has(k)));
}
/**
 * Duplicate prevention when adding to a playlist/collection: a passage that's
 * already there (or repeated in the same request) is skipped unless the person
 * explicitly chose to add a repeat.
 */
export function planAdd<T extends ItemRef>(existing: ItemRef[], incoming: T[], allowRepeat: boolean): { add: T[]; skipped: T[] } {
  if (allowRepeat) return { add: incoming, skipped: [] };
  const seen = new Set(existing.map(refKey));
  const add: T[] = [], skipped: T[] = [];
  for (const r of incoming) {
    const k = refKey(r);
    if (seen.has(k)) skipped.push(r); else { seen.add(k); add.push(r); }
  }
  return { add, skipped };
}

/** Should this "start" continue an open history row instead of adding one? */
export function reuseHistoryRow(open: { started_at: string; completed_at: string | null } | null | undefined, now = Date.now()): boolean {
  if (!open || open.completed_at) return false;
  const t = Date.parse(open.started_at);
  return Number.isFinite(t) && now - t >= 0 && now - t < HISTORY_REUSE_MS;
}
/** Seconds listened, clamped to what actually elapsed (never more than the wall clock allows). */
export function listenedSeconds(raw: unknown, startedAt: string, now = Date.now()): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const elapsed = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  return Math.min(Math.floor(n), elapsed, 86_400);
}

export interface ResumeState { itemId: string | null; partKey: string | null; offset: number; queue: string[]; shuffle: boolean; repeat: RepeatMode; rate: number }
/**
 * Resume state as sent by the app, checked against the playlist's real items:
 * the current item and every queue entry must belong to it (unknown ids are
 * dropped); a queue may not list an item twice unless the playlist itself
 * repeats it. Returns a message when it can't be used.
 */
export function cleanResume(raw: unknown, itemIds: string[]): ResumeState | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const known = new Set(itemIds);
  const itemId = typeof r.itemId === "string" && known.has(r.itemId) ? r.itemId : null;
  const partKey = typeof r.partKey === "string" && r.partKey.length <= 200 ? r.partKey : null;
  const offset = Number.isInteger(r.offset) && (r.offset as number) >= 0 && (r.offset as number) <= 100_000 ? (r.offset as number) : 0;
  const rate = (RATES as readonly number[]).includes(Number(r.rate)) ? Number(r.rate) : 1;
  const repeat = (REPEAT_MODES as readonly unknown[]).includes(r.repeat) ? (r.repeat as RepeatMode) : "off";
  const allowed = new Map<string, number>();
  for (const id of itemIds) allowed.set(id, (allowed.get(id) ?? 0) + 1);
  const queue: string[] = [];
  if (Array.isArray(r.queue)) {
    if (r.queue.length > MAX_QUEUE) return "That listening queue is too long.";
    for (const id of r.queue) {
      if (typeof id !== "string" || !allowed.get(id)) continue;
      allowed.set(id, allowed.get(id)! - 1);
      queue.push(id);
    }
  }
  return { itemId, partKey, offset, queue, shuffle: r.shuffle === true, repeat, rate };
}

/** A favourite target: a playlist/collection id, or a complete passage reference. */
export type FavouriteTarget = { kind: "collection"; collectionId: string } | { kind: "passage"; ref: ItemRef };
export const favouriteKey = (t: FavouriteTarget) => (t.kind === "collection" ? `c:${t.collectionId}` : `p:${refKey(t.ref)}`);

// ── Your own photos (migration 228) ─────────────────────────────────────────
/** Private bucket; every view is a short-lived signed link for someone who can see the playlist. */
export const PHOTO_BUCKET = "scripture-library-images";
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_VIEW_SECONDS = 60 * 60;
export const PHOTO_SLOTS = ["cover", "header"] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** Is this upload allowed? Returns a message when it isn't. */
export function photoProblem(slot: unknown, mimeType: unknown, sizeBytes: unknown): string | null {
  if (!(PHOTO_SLOTS as readonly unknown[]).includes(slot)) return "Choose the cover or the header photo.";
  if (typeof mimeType !== "string" || !PHOTO_TYPES[mimeType]) return "Choose a photo (JPEG, PNG, WebP or HEIC).";
  const n = Number(sizeBytes);
  if (!Number.isFinite(n) || n <= 0) return "That photo couldn't be read.";
  if (n > PHOTO_MAX_BYTES) return "Photos can be up to 8 MB.";
  return null;
}
/** Server-generated object path: <owner>/<slot>-<collection>-<random>.<ext> (fits the 227/228 path checks). */
export const photoPath = (ownerId: string, slot: PhotoSlot, collectionId: string, mimeType: string, random: string) =>
  `${ownerId}/${slot}-${collectionId}-${random.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)}.${PHOTO_TYPES[mimeType]}`;
/** Does this path belong to this owner's photo for this playlist and slot? (No guessing other paths.) */
export function photoPathBelongs(path: unknown, ownerId: string, slot: PhotoSlot, collectionId: string): boolean {
  if (typeof path !== "string" || path.length > 200) return false;
  const prefix = `${ownerId}/${slot}-${collectionId}-`;
  return path.startsWith(prefix) && /^[A-Za-z0-9]{1,24}\.(jpg|png|webp|heic)$/.test(path.slice(prefix.length));
}
