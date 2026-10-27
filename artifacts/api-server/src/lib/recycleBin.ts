import type { Response } from "express";
import { supabaseServiceRole as db } from "./supabase";

// P2P Admin Recycle Bin (migration 214). Every admin "delete" of supported
// content goes through moveToBin: the database captures the item with
// everything depending on it and removes it in one transaction; restore puts
// it back. The SQL functions re-check the actor's role (the API's role checks
// stay in front of them too). Only the service role can call them.

export const RECYCLE_TYPES = [
  "curriculum", "module", "lesson", "lesson_block",
  "kingdom_story", "kingdom_story_chapter", "kingdom_story_media", "kingdom_story_source", "kingdom_story_topic", "kingdom_story_collection",
  "prayer_topic", "prayer_path", "prayer_path_step",
  "mission_field", "mission_story", "mission_prayer_point",
] as const;
export type RecycleType = (typeof RECYCLE_TYPES)[number];

export const RECYCLE_TYPE_LABELS: Record<RecycleType, string> = {
  curriculum: "Curriculum / plan", module: "Module", lesson: "Lesson", lesson_block: "Lesson content block",
  kingdom_story: "Kingdom Story", kingdom_story_chapter: "Story chapter", kingdom_story_media: "Story image",
  kingdom_story_source: "Story source", kingdom_story_topic: "Story topic", kingdom_story_collection: "Story collection",
  prayer_topic: "Prayer topic", prayer_path: "Prayer path", prayer_path_step: "Prayer path step",
  mission_field: "Mission field", mission_story: "Mission story", mission_prayer_point: "Mission prayer point",
};

// Mirrors p2p_recycle_type() in migration 214 (the database is the authority).
const SCHOOL = ["peer_guide", "church_leader", "regional_admin", "admin_content", "super_admin"];
const STORIES = ["admin_content", "super_admin"];
const TYPE_ROLES: Record<RecycleType, string[] | null> = {
  curriculum: SCHOOL, module: SCHOOL, lesson: SCHOOL, lesson_block: SCHOOL,
  kingdom_story: STORIES, kingdom_story_chapter: STORIES, kingdom_story_media: STORIES, kingdom_story_source: STORIES, kingdom_story_topic: STORIES, kingdom_story_collection: STORIES,
  prayer_topic: null, prayer_path: null, prayer_path_step: null, mission_field: null, mission_story: null, mission_prayer_point: null,
};
/** Types this admin role may delete and restore (null = any admin role, as those routes use requireAdmin). */
export function recycleTypesFor(role: string | undefined): RecycleType[] {
  if (!role) return [];
  return RECYCLE_TYPES.filter((t) => { const r = TYPE_ROLES[t]; return r === null || r.includes(role); });
}
export const isRecycleType = (t: unknown): t is RecycleType => typeof t === "string" && (RECYCLE_TYPES as readonly string[]).includes(t);

const MESSAGES: Record<string, { status: number; message: string }> = {
  recycle_forbidden: { status: 403, message: "Your role cannot do this for this kind of content." },
  recycle_not_found: { status: 404, message: "That item no longer exists." },
  recycle_unknown_type: { status: 400, message: "Unknown content type." },
  recycle_live_story: { status: 409, message: "This story is live. Unpublish it first, then move it to the Recycle Bin." },
  recycle_system_content: { status: 409, message: "This holds learners' Kingdom Stories progress and cannot be deleted." },
  recycle_conflict: { status: 409, message: "It can't be restored: an item with the same identity exists again. Nothing was changed." },
  recycle_missing_parent: { status: 409, message: "It can't be restored yet: what it belongs to is gone (restore that first from the Recycle Bin). Nothing was changed." },
  recycle_not_in_bin: { status: 409, message: "This item is no longer in the Recycle Bin (already restored or permanently deleted)." },
  recycle_too_deep: { status: 409, message: "This item is too deeply nested to move safely. Nothing was changed." },
  studio_live_edit_blocked: { status: 409, message: "A live Kingdom Story links to this. Unpublish that story first. Nothing was changed." },
  kingdom_story_learning_kept: { status: 409, message: "This holds learners' Kingdom Stories progress and cannot be deleted." },
  kingdom_story_system_curriculum: { status: 409, message: "This holds learners' Kingdom Stories progress and cannot be deleted." },
};

export class RecycleError extends Error {
  constructor(public key: string, public status: number, message: string, public detail?: string) { super(message); }
}
function toError(e: { message?: string; details?: string; code?: string } | null): RecycleError {
  const key = Object.keys(MESSAGES).find((k) => (e?.message ?? "").includes(k));
  if (key) return new RecycleError(key, MESSAGES[key].status, MESSAGES[key].message, e?.details ?? undefined);
  return new RecycleError("recycle_failed", 500, "The Recycle Bin couldn't complete this. Nothing was changed.");
}
export function sendRecycleError(res: Response, e: unknown) {
  const r = e instanceof RecycleError ? e : toError(e as { message?: string });
  return res.status(r.status).json({ error: r.message, code: r.key, ...(r.detail ? { detail: r.detail } : {}) });
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw toError(error);
  return data as T;
}

export const previewDelete = (actor: string, type: RecycleType, id: string) =>
  rpc<{ title: string; counts: Record<string, number>; links: number; files: number; blocked: string | null }>("p2p_recycle_preview", { p_actor: actor, p_type: type, p_id: id });
export const moveToBin = (actor: string, type: RecycleType, id: string) =>
  rpc<{ entryId: string; counts: Record<string, number> }>("p2p_recycle_delete", { p_actor: actor, p_type: type, p_id: id });
export const restoreFromBin = (actor: string, entryId: string) =>
  rpc<{ restored: boolean; contentType: RecycleType; contentId: string; warnings: string[] }>("p2p_recycle_restore", { p_actor: actor, p_entry: entryId });

/** Permanent deletion: the snapshot is dropped, then files nothing else uses are removed from storage. */
export async function purgeFromBin(actor: string, entryId: string): Promise<{ removedFiles: number; keptFiles: number; fileErrors: number }> {
  const r = await rpc<{ files: { bucket: string; path: string }[]; keptFiles: number }>("p2p_recycle_purge", { p_actor: actor, p_entry: entryId });
  const byBucket = new Map<string, string[]>();
  for (const f of r.files ?? []) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  let fileErrors = 0;
  for (const [bucket, paths] of byBucket) {
    const { error } = await db.storage.from(bucket).remove(paths);
    if (error) fileErrors += paths.length;
  }
  return { removedFiles: (r.files ?? []).length - fileErrors, keptFiles: r.keptFiles ?? 0, fileErrors };
}
