import { apiRequest } from "@/lib/apiClient";
import { WEB_APP_URL } from "@/lib/sharing";
import type { NewRef } from "@/lib/bibleReaderApi";

// Scripture collections and listening playlists (routes/scriptureCollections.ts,
// migration 220). Private until the owner shares them; every permission is
// enforced by the server — the app only shows what the server allows.
// Only references travel; Bible text always comes live from the Bible service.

export type CollectionKind = "collection" | "playlist";
export type Permission = "view" | "copy" | "collaborate";
export type TargetType = "peer" | "family" | "church" | "circle" | "group" | "study";

export const PERMISSION_LABEL: Record<Permission, string> = { view: "View and Listen", copy: "Save a Copy", collaborate: "Collaborative Editing" };
export const PERMISSION_HELP: Record<Permission, string> = {
  view: "They can read and listen.",
  copy: "They can also save their own copy and add passages to their collections.",
  collaborate: "They can also add, remove and reorder passages.",
};
export const TARGET_LABEL: Record<TargetType, string> = { peer: "Person", family: "Family Circle", church: "Church", circle: "Circle", group: "Group", study: "Study Together" };

/** A playlist/collection cover (migration 227): built-in artwork or a theme colour by name, or the owner's own image. null = default. */
export interface CollectionCover { kind: "artwork" | "colour" | "image"; ref: string; /** Your own photo: a short-lived link (migration 228). */ url?: string }

export interface CollectionCard {
  id: string; kind: CollectionKind; title: string; description: string | null; itemCount: number; /** Verses in all its passages (listening time). */ verseCount?: number; updatedAt: string;
  isCopy: boolean; originOwnerName: string | null;
  shareCount?: number;
  ownerName?: string; sharedByName?: string; permission?: Permission | null;
  /** Migration 227 — absent from older servers. */
  cover?: CollectionCover | null; tags?: string[];
}
export interface CollectionItem {
  id: string; translationCode: string; bookCode: string; bookName: string; chapter: number; startVerse: number; endVerse: number;
  reference: string; sharedNote: string | null; addedBy: string | null; addedByName: string | null;
}
export interface CollectionShare { id: string; targetType: TargetType; permission: Permission; canReshare: boolean; viaLink: boolean; name: string; sharedByName: string | null; sharedAt: string | null }
export interface CollectionLink { id: string; permission: Permission; maxUses: number | null; uses: number; expiresAt: string | null; createdAt: string; state: "ok" | "revoked" | "expired" | "full" }
export interface CollectionDetail {
  id: string; kind: CollectionKind; title: string; description: string | null; revision: number; updatedAt: string;
  createdAt?: string; cover?: CollectionCover | null; tags?: string[];
  /** The wide photo across the top of the page (migration 228). */
  header?: { url: string } | null;
  owner: { id: string; name: string; photoUrl: string | null };
  /** original = I made it · copy = my personal copy · shared = someone shared it with me */
  status: "original" | "copy" | "shared";
  access: { role: "owner" | "recipient"; permission: Permission; canReshare: boolean };
  sharedByName: string | null;
  origin: { id: string; title: string; ownerName: string; available: boolean; changed: boolean } | null;
  items: CollectionItem[];
  shares: CollectionShare[];
  links: CollectionLink[];
  activity: { actorName: string; action: string; detail: Record<string, unknown>; at: string }[];
}
export interface ShareTargets {
  people: { id: string; name: string; photoUrl: string | null; relationship: string }[];
  groups: { type: TargetType; id: string; name: string }[];
}

const call = <T,>(path: string, init: RequestInit = {}) =>
  apiRequest<T>(`/scripture-collections${path}`, init, { fallbackError: "That didn't work. Please try again." });
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listCollections = () => call<{ mine: CollectionCard[]; shared: CollectionCard[] }>("");
export const createCollection = (kind: CollectionKind, title: string, refs: NewRef[] = [], description?: string) =>
  call<{ id: string }>("", json("POST", { kind, title, description, refs }));
export const getCollection = (id: string) => call<CollectionDetail>(`/${id}`);
export const renameCollection = (id: string, title: string, revision: number, description?: string | null) => call<{ revision: number }>(`/${id}`, json("PATCH", { title, description, revision }));
export const deleteCollection = (id: string) => call<{ deleted: true }>(`/${id}`, { method: "DELETE" });
/** Appends passages. One that's already there is skipped (`skipped`) unless `allowRepeat` — the person's explicit choice. */
export const addToCollection = (id: string, refs: NewRef[], sharedNote?: string, allowRepeat = false) =>
  call<{ revision: number; added?: number; skipped?: number }>(`/${id}/items`, json("POST", { refs, sharedNote, allowRepeat }));
export type PhotoSlot = "cover" | "header";
/**
 * Your own photo (owner only): the server gives a one-off upload link to a
 * path it chooses, the photo is uploaded, then the server checks it arrived
 * (and its size) before using it. Photos are private: people see them only
 * while they can see the playlist.
 */
export async function uploadPhoto(id: string, slot: PhotoSlot, photo: { uri: string; mimeType: string }) {
  const blob = await (await fetch(photo.uri)).blob();
  const start = await call<{ uploadUrl: string; path: string }>(`/${id}/photos`, json("POST", { slot, mimeType: photo.mimeType, sizeBytes: blob.size }));
  const res = await fetch(start.uploadUrl, { method: "PUT", headers: { "Content-Type": photo.mimeType, "x-upsert": "false" }, body: blob });
  if (!res.ok) throw Object.assign(new Error("The upload failed — check your connection and try again."), { status: res.status });
  return call<{ revision: number }>(`/${id}/photos/complete`, json("POST", { slot, path: start.path }));
}
/** Remove your own cover or header photo (back to the default). */
export const removePhoto = (id: string, slot: PhotoSlot) => call<{ revision: number }>(`/${id}/photos/${slot}`, { method: "DELETE" });

/** Cover and tags (owner). `cover: null` restores the default cover. */
export const updateCollectionLook = (id: string, revision: number, look: { cover?: CollectionCover | null; tags?: string[] }) =>
  call<{ revision: number }>(`/${id}`, json("PATCH", { ...look, revision }));
export const removeFromCollection = (id: string, itemId: string, revision: number) => call<{ revision: number }>(`/${id}/items/${itemId}`, json("DELETE", { revision }));
export const reorderCollection = (id: string, itemIds: string[], revision: number) => call<{ revision: number }>(`/${id}/order`, json("PUT", { itemIds, revision }));
export const setSharedNote = (id: string, itemId: string, sharedNote: string | null) => call<{ revision: number }>(`/${id}/items/${itemId}/note`, json("PUT", { sharedNote }));
export const copyCollection = (id: string, opts: { kind?: CollectionKind; itemIds?: string[]; title?: string } = {}) => call<{ id: string }>(`/${id}/copy`, json("POST", opts));
export const originChanges = (id: string) => call<{ available: boolean; title?: string; newItems: CollectionItem[] }>(`/${id}/origin`);
export const shareTargets = () => call<ShareTargets>("/share-targets");
export const shareCollection = (id: string, targets: { type: TargetType; id: string }[], permission: Permission, canReshare: boolean) =>
  call<{ shared: number }>(`/${id}/shares`, json("POST", { targets, permission, canReshare }));
export const revokeShare = (id: string, shareId: string) => call<{ revoked: true }>(`/${id}/shares/${shareId}`, { method: "DELETE" });
export const leaveCollection = (id: string) => call<{ left: true }>(`/${id}/leave`, { method: "POST" });
export const createLink = (id: string, permission: "view" | "copy", expiresInDays: number | null, maxUses: number | null) =>
  call<{ id: string; token: string }>(`/${id}/links`, json("POST", { permission, expiresInDays, maxUses }));
export const revokeLink = (id: string, linkId: string, removeJoined: boolean) => call<{ revoked: true }>(`/${id}/links/${linkId}`, json("DELETE", { removeJoined }));
export const redeemLink = (token: string) => call<{ id: string }>("/links/redeem", json("POST", { token }));

/** The public link for a code: a view-only preview page on the website that leads to the app. */
export const collectionLinkUrl = (token: string) => `${WEB_APP_URL}/c/${token}`;

/** Item → the shape the Bible reader and Listen use. */
export const itemRef = (i: CollectionItem): NewRef => ({ translationCode: i.translationCode, bookCode: i.bookCode, chapter: i.chapter, startVerse: i.startVerse, endVerse: i.endVerse });

const ACTION_TEXT: Record<string, string> = {
  created: "created this", renamed: "renamed this", deleted: "deleted this", added: "added passages", removed: "removed a passage",
  reordered: "changed the order", note_changed: "changed a shared note", shared: "shared this", share_revoked: "removed someone's access",
  copied: "saved a copy", copied_from: "made this copy", left: "left", link_created: "created a link", link_revoked: "turned off a link",
  joined_via_link: "joined through a link",
};
/** "Ben added passages: John 3:16" — for the activity history. */
export function activityLine(a: CollectionDetail["activity"][number]): string {
  const what = ACTION_TEXT[a.action] ?? a.action.replace(/_/g, " ");
  const refs = Array.isArray(a.detail?.references) ? `: ${(a.detail.references as string[]).join(", ")}` : typeof a.detail?.reference === "string" ? `: ${a.detail.reference}` : "";
  return `${a.actorName} ${what}${refs}`;
}
