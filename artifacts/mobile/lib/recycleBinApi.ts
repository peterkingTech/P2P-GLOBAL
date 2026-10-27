import { authedFetch } from "@/lib/adminFetch";

// P2P Admin Recycle Bin (API: /admin/recycle-bin, migration 214). Deleting
// supported admin content moves it here with everything that depends on it;
// it can be restored, or permanently deleted by a super admin. The server
// and database decide who may do what; the screen only offers what applies.

export type RecycleType =
  | "curriculum" | "module" | "lesson" | "lesson_block"
  | "kingdom_story" | "kingdom_story_chapter" | "kingdom_story_media" | "kingdom_story_source" | "kingdom_story_topic" | "kingdom_story_collection"
  | "prayer_topic" | "prayer_path" | "prayer_path_step"
  | "mission_field" | "mission_story" | "mission_prayer_point";
export type RecycleStatus = "in_bin" | "restored" | "purged";
export interface Person { id: string; name: string }
export interface RecycleEntry {
  id: string; contentType: RecycleType; typeLabel: string; contentId: string; title: string;
  parentLabel: string | null; parentType: string | null; parentId: string | null;
  originalStatus: string | null; status: RecycleStatus; counts: Record<string, number>; fileCount: number;
  deletedBy: Person | null; deletedAt: string; restoredBy: Person | null; restoredAt: string | null; restoreWarnings: string[];
  purgedBy: Person | null; purgedAt: string | null;
  preview?: Record<string, unknown> | null;
}
export interface RecycleList { items: RecycleEntry[]; total: number; page: number; pageSize: number; types: { value: RecycleType; label: string }[]; deleters: Person[]; canPurge: boolean }
export interface DeletePreview { title: string; counts: Record<string, number>; links: number; files: number; blocked: string | null }
export const PURGE_CONFIRMATION = "PERMANENTLY DELETE";

export class RecycleApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try { res = await authedFetch(`/admin/recycle-bin${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new RecycleApiError("Can't reach the server. Check your connection and try again.", 0); }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new RecycleApiError(body?.error ?? "Something went wrong.", res.status, body?.code);
  return body as T;
}
const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
};

export const listRecycleBin = (p: { status?: RecycleStatus; type?: RecycleType | ""; q?: string; deletedBy?: string; page?: number }) =>
  call<RecycleList>(qs({ status: p.status, type: p.type, q: p.q, deletedBy: p.deletedBy, page: p.page }));
export const getRecycleEntry = (id: string) => call<RecycleEntry>(`/${id}`);
export const previewMoveToBin = (type: RecycleType, id: string) => call<DeletePreview>("/preview", { method: "POST", body: JSON.stringify({ type, id }) });
export const moveToBin = (type: RecycleType, id: string) => call<{ entryId: string }>("", { method: "POST", body: JSON.stringify({ type, id }) });
export const restoreEntry = (id: string) => call<{ restored: true; warnings: string[] }>(`/${id}/restore`, { method: "POST" });
export const purgeEntry = (id: string, confirm: string) =>
  call<{ removedFiles: number; keptFiles: number; fileErrors: number }>(`/${id}/purge`, { method: "POST", body: JSON.stringify({ confirm }) });

// Readable names for what a deletion includes (counts are per table).
const TABLE_LABELS: Record<string, [string, string]> = {
  p2p_curriculums: ["curriculum", "curricula"], p2p_modules: ["module", "modules"], p2p_lessons: ["lesson", "lessons"],
  p2p_lesson_blocks: ["content block", "content blocks"], p2p_lesson_sections: ["section", "sections"], p2p_scriptures: ["Scripture", "Scriptures"],
  p2p_reflection_questions: ["reflection question", "reflection questions"], p2p_assignments: ["assignment", "assignments"],
  p2p_assignment_questions: ["assignment question", "assignment questions"], p2p_submissions: ["learner answer", "learner answers"],
  p2p_lesson_evaluations: ["evaluation", "evaluations"], p2p_lesson_progress: ["progress record", "progress records"],
  p2p_user_highlights: ["learner highlight", "learner highlights"], p2p_kingdom_stories: ["story", "stories"],
  p2p_kingdom_story_chapters: ["chapter", "chapters"], p2p_kingdom_story_media: ["image", "images"], p2p_kingdom_story_sources: ["source", "sources"],
  p2p_kingdom_story_topics: ["topic", "topics"], p2p_kingdom_story_collections: ["collection", "collections"],
  p2p_kingdom_story_collection_items: ["collection entry", "collection entries"], p2p_kingdom_story_saves: ["reader save", "reader saves"],
  p2p_kingdom_story_views: ["reading record", "reading records"], p2p_prayer_topics: ["prayer topic", "prayer topics"], p2p_prayer_paths: ["prayer path", "prayer paths"],
  p2p_prayer_path_steps: ["path step", "path steps"], p2p_prayer_path_progress: ["learner progress record", "learner progress records"],
  p2p_mission_fields: ["mission field", "mission fields"], p2p_mission_stories: ["mission story", "mission stories"],
  p2p_mission_prayer_points: ["prayer point", "prayer points"],
};
/** "1 lesson, 12 learner answers, 3 evaluations" — the item itself first. */
export function describeCounts(counts: Record<string, number>, max = 6): string {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => {
    const l = TABLE_LABELS[t] ?? [t.replace(/^p2p_/, "").replace(/_/g, " "), t.replace(/^p2p_/, "").replace(/_/g, " ")];
    return `${n} ${n === 1 ? l[0] : l[1]}`;
  });
  return parts.length > max ? `${parts.slice(0, max).join(", ")} and more` : parts.join(", ");
}

/** The message shown when an admin confirms a delete. */
export function moveToBinMessage(what: string, preview?: DeletePreview | null): string {
  const inc = preview ? describeCounts(preview.counts) : "";
  return `"${what}" will be moved to the Recycle Bin${inc ? ` with everything that belongs to it (${inc})` : ""}. It disappears from the app now and can be restored from Admin → Recycle Bin.`;
}
