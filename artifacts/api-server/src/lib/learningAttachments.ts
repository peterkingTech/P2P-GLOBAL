import { randomUUID } from "node:crypto";
import { supabaseServiceRole as db } from "./supabase";
import { type GroupScope, isUuid, canReviewGroupAssignment } from "./groupLearning";
import { safeFileName } from "../routes/groupResources";

// Learning attachments (migration 218) — handwriting, images and PDFs on
// Comprehensive Check answers. Same security model as group resources (209):
// a private bucket with no client storage policies; every request is checked
// here, then the API returns content or a 5-minute signed link.
//
//   draft        — no target: the OWNER only (open, edit, delete).
//   frozen copy  — made when an answer is submitted, linked to one submission
//                  (core p2p_submissions or group p2p_group_assignment_submissions).
//                  Never edited or deleted by the learner. Opened by whoever
//                  may see that answer today: the learner, the answer's
//                  assigned peer evaluator (core), or the group's reviewers
//                  (current Shepherd / Co-Shepherd, church leadership, or the
//                  check's creator while still a member).
// A frozen copy whose submission doesn't exist is never shown to anyone, and
// is cleaned up after a day. Reflections can't be linked (checks only).
// Nothing here changes submissions, reviews or progress.

export const BUCKET = "learning-work";
export const DOWNLOAD_TTL_SECONDS = 300;
export const LIMITS = {
  fileBytes: 25 * 1024 * 1024, drawingBytes: 2 * 1024 * 1024, pages: 20, strokesPerPage: 3000, pointsPerStroke: 5000,
  totalPoints: 200000, drawingsPerAnswer: 3, filesPerAnswer: 5, caption: 500, draftsPerOwner: 200,
};
export const PAGE = { width: 1000, height: 1414 };
export const FILE_TYPES: Record<string, { kind: "image" | "pdf"; exts: string[] }> = {
  "image/jpeg": { kind: "image", exts: ["jpg", "jpeg"] }, "image/png": { kind: "image", exts: ["png"] },
  "image/webp": { kind: "image", exts: ["webp"] }, "application/pdf": { kind: "pdf", exts: ["pdf"] },
};
/** The words an answer carries when it was given only as a drawing / file (older apps show these). */
export const ATTACHED_ONLY = "(Answer given as a drawing or file — open it in the latest P2P app to see it.)";
export type TargetKind = "core_submission" | "group_submission";
export const TARGET_KINDS: readonly TargetKind[] = ["core_submission", "group_submission"];
const STALE_MS = 24 * 60 * 60 * 1000;
const NOT_READY = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

/** Switched on per environment (LEARNING_ATTACHMENTS=on). Off: nothing new can be added; existing work stays readable. */
export const attachmentsEnabled = () => String(process.env.LEARNING_ATTACHMENTS ?? "").trim().toLowerCase() === "on";
export const notReady = (code: unknown) => NOT_READY.has(String(code));

export type Row = {
  id: string; owner_id: string; kind: "handwriting" | "image" | "pdf"; storage_path: string; file_name: string; mime_type: string;
  size_bytes: number | null; page_count: number | null; caption: string | null; status: "pending" | "ready";
  target_kind: TargetKind | null; target_id: string | null; source_attachment_id: string | null;
  created_at: string; updated_at: string; deleted_at: string | null;
};

export const mapRow = (r: Row) => ({
  id: r.id, kind: r.kind, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes, pageCount: r.page_count,
  caption: r.caption, status: r.status, submitted: !!r.target_id, createdAt: r.created_at, updatedAt: r.updated_at,
});
/** Counts only — safe to show beside an answer. */
export const attachmentSummary = (rows: Row[]) => ({
  drawings: rows.filter((r) => r.kind === "handwriting").length, files: rows.filter((r) => r.kind !== "handwriting").length,
});

/** Images and PDFs only; the type must match the extension. */
export function validateFile(fileName: string, mimeType: string, sizeBytes: number): string | null {
  const t = FILE_TYPES[mimeType];
  if (!t) return "Add a photo (JPEG, PNG, WebP) or a PDF.";
  const ext = (safeFileName(fileName).split(".").pop() ?? "").toLowerCase();
  if (!t.exts.includes(ext)) return "The file's name doesn't match its type.";
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return "That file is empty.";
  if (sizeBytes > LIMITS.fileBytes) return "Files can be up to 25 MB.";
  return null;
}

export const validCaption = (v: unknown): string | null | false => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t.length > LIMITS.caption ? false : (t || null);
};

// ── Drawing documents (version 1) ───────────────────────────────────────────
// Data only — never markup. Every value is checked and the document is
// rebuilt from the checked values, so nothing unexpected is ever stored.
export type Stroke = { tool: "pen" | "pencil" | "highlighter"; color: string; width: number; points: number[][] };
export type Page = { background: "blank" | "lined" | "grid"; strokes: Stroke[] };
export type DrawingDoc = { version: 1; pages: Page[] };
const TOOLS = ["pen", "pencil", "highlighter"];
const BACKGROUNDS = ["blank", "lined", "grid"];
const COLOR = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function validateDrawing(raw: unknown): { doc: DrawingDoc; json: string } | string {
  const d = raw as { version?: unknown; pages?: unknown };
  if (!d || typeof d !== "object" || d.version !== 1) return "That drawing couldn't be read.";
  if (!Array.isArray(d.pages) || d.pages.length < 1 || d.pages.length > LIMITS.pages) return `A drawing can have 1 to ${LIMITS.pages} pages.`;
  let total = 0;
  const pages: Page[] = [];
  for (const p of d.pages as Array<Record<string, unknown>>) {
    if (!p || typeof p !== "object") return "That drawing couldn't be read.";
    const background = (BACKGROUNDS.includes(p.background as string) ? p.background : "blank") as Page["background"];
    if (!Array.isArray(p.strokes) || p.strokes.length > LIMITS.strokesPerPage) return "A page has too many strokes.";
    const strokes: Stroke[] = [];
    for (const s of p.strokes as Array<Record<string, unknown>>) {
      if (!s || typeof s !== "object" || !TOOLS.includes(s.tool as string) || typeof s.color !== "string" || !COLOR.test(s.color) || !num(s.width, 0.5, 40)) return "That drawing couldn't be read.";
      if (!Array.isArray(s.points) || s.points.length < 1 || s.points.length > LIMITS.pointsPerStroke) return "A stroke is too long.";
      const points: number[][] = [];
      for (const pt of s.points as unknown[]) {
        if (!Array.isArray(pt) || pt.length < 2 || pt.length > 3 || !num(pt[0], 0, PAGE.width) || !num(pt[1], 0, PAGE.height) || (pt.length === 3 && !num(pt[2], 0, 1))) return "That drawing couldn't be read.";
        points.push(pt.length === 3 ? [round1(pt[0] as number), round1(pt[1] as number), Math.round((pt[2] as number) * 100) / 100] : [round1(pt[0] as number), round1(pt[1] as number)]);
      }
      total += points.length;
      if (total > LIMITS.totalPoints) return "That drawing is too large.";
      strokes.push({ tool: s.tool as Stroke["tool"], color: (s.color as string).toLowerCase(), width: round1(s.width as number), points });
    }
    pages.push({ background, strokes });
  }
  const doc: DrawingDoc = { version: 1, pages };
  const json = JSON.stringify(doc);
  if (Buffer.byteLength(json) > LIMITS.drawingBytes) return "That drawing is too large (2 MB).";
  return { doc, json };
}

// ── Rows, paths, storage ────────────────────────────────────────────────────
export const pathFor = (ownerId: string, id: string, fileName: string) => `${ownerId}/${id}/${fileName}`;

export async function loadRow(id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const { data } = await db.from("p2p_learning_attachments").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Row | null) ?? null;
}

async function submissionOf(kind: TargetKind, id: string): Promise<{ user_id: string; assignment_id?: string } | null> {
  if (kind === "core_submission") {
    const { data } = await db.from("p2p_submissions").select("id,user_id").eq("id", id).maybeSingle();
    return (data as { user_id: string } | null) ?? null;
  }
  const { data } = await db.from("p2p_group_assignment_submissions").select("id,user_id,assignment_id").eq("id", id).maybeSingle();
  return (data as { user_id: string; assignment_id: string } | null) ?? null;
}

/**
 * May this person open the files of this submission? The same people who may
 * see the answer today — and only once the answer really exists.
 */
export async function canOpenTarget(kind: TargetKind, targetId: string, userId: string): Promise<boolean> {
  const sub = await submissionOf(kind, targetId);
  if (!sub) return false;
  if (sub.user_id === userId) return true;
  if (kind === "core_submission") {
    const { data } = await db.from("p2p_lesson_evaluations").select("id").eq("submission_id", targetId).eq("evaluator_id", userId).limit(1);
    return !!(data ?? []).length;
  }
  const { data: asg } = await db.from("p2p_group_assignments").select("*").eq("id", sub.assignment_id as string).maybeSingle();
  if (!asg) return false;
  const scope: GroupScope = asg.family_id ? "family" : "church";
  return canReviewGroupAssignment(scope, asg as Record<string, unknown>, userId);
}

/** One attachment: a draft is its owner's alone; a frozen copy follows its submission (and its owner must be the answer's author). */
export async function canOpen(row: Row, userId: string): Promise<boolean> {
  if (row.deleted_at) return false;
  if (!row.target_kind || !row.target_id) return row.owner_id === userId;
  const sub = await submissionOf(row.target_kind, row.target_id);
  if (!sub || sub.user_id !== row.owner_id) return false;
  return canOpenTarget(row.target_kind, row.target_id, userId);
}

/** The frozen files of one submission (rows), whether or not the caller may see them — callers check canOpenTarget. */
export async function rowsForTarget(kind: TargetKind, ids: string[]): Promise<Row[]> {
  if (!ids.length) return [];
  const { data } = await db.from("p2p_learning_attachments").select("*").eq("target_kind", kind).in("target_id", ids).is("deleted_at", null).order("created_at", { ascending: true });
  return (data ?? []) as Row[];
}

/**
 * Freeze the owner's ready drafts as copies linked to ONE submission that
 * doesn't exist yet (its id is decided before it is saved). All or nothing:
 * if any copy fails, the copies made so far are removed. The drafts stay.
 */
export async function linkAttachments(o: { ownerId: string; targetKind: TargetKind; targetId: string; ids: string[]; captions?: Record<string, unknown> }): Promise<{ rows: Row[] } | { error: string; status: number }> {
  const ids = [...new Set(o.ids)];
  if (!ids.length) return { rows: [] };
  if (!ids.every(isUuid) || !isUuid(o.targetId)) return { error: "Those attachments couldn't be found.", status: 404 };
  if (await submissionOf(o.targetKind, o.targetId)) return { error: "That answer has already been sent; attachments can't be added to it.", status: 409 };
  const { count: already } = await db.from("p2p_learning_attachments").select("id", { count: "exact", head: true }).eq("target_kind", o.targetKind).eq("target_id", o.targetId);
  if (already) return { error: "Attachments were already added to this answer.", status: 409 };
  const { data } = await db.from("p2p_learning_attachments").select("*").in("id", ids).is("deleted_at", null);
  const drafts = (data ?? []) as Row[];
  if (drafts.length !== ids.length || drafts.some((r) => r.owner_id !== o.ownerId || r.target_id)) return { error: "Those attachments couldn't be found.", status: 404 };
  if (drafts.some((r) => r.status !== "ready")) return { error: "Wait for every upload to finish, then send.", status: 409 };
  if (drafts.filter((r) => r.kind === "handwriting").length > LIMITS.drawingsPerAnswer) return { error: `Add up to ${LIMITS.drawingsPerAnswer} drawings to one answer.`, status: 400 };
  if (drafts.filter((r) => r.kind !== "handwriting").length > LIMITS.filesPerAnswer) return { error: `Add up to ${LIMITS.filesPerAnswer} photos or PDFs to one answer.`, status: 400 };

  const made: Row[] = [];
  const undo = async () => {
    if (!made.length) return;
    await db.storage.from(BUCKET).remove(made.map((r) => r.storage_path));
    await db.from("p2p_learning_attachments").delete().in("id", made.map((r) => r.id));
  };
  for (const d of ids.map((id) => drafts.find((r) => r.id === id)!)) {
    const id = randomUUID();
    const path = pathFor(o.ownerId, id, d.file_name);
    const { error: cErr } = await db.storage.from(BUCKET).copy(d.storage_path, path);
    if (cErr) { await undo(); return { error: "Couldn't attach your work. Please try again.", status: 502 }; }
    const cap = o.captions && Object.prototype.hasOwnProperty.call(o.captions, d.id) ? validCaption(o.captions[d.id]) : d.caption;
    const { data: row, error } = await db.from("p2p_learning_attachments").insert({
      id, owner_id: o.ownerId, kind: d.kind, storage_path: path, file_name: d.file_name, mime_type: d.mime_type, size_bytes: d.size_bytes,
      page_count: d.page_count, caption: cap === false ? d.caption : cap, status: "ready", target_kind: o.targetKind, target_id: o.targetId, source_attachment_id: d.id,
    }).select().single();
    if (error || !row) { await db.storage.from(BUCKET).remove([path]); await undo(); return { error: "Couldn't attach your work. Please try again.", status: 500 }; }
    made.push(row as Row);
  }
  return { rows: made };
}

/** Remove frozen copies of a submission that was never saved (same request, or cleanup). */
export async function discardLinked(kind: TargetKind, targetId: string): Promise<void> {
  const rows = await rowsForTarget(kind, [targetId]);
  if (!rows.length) return;
  await db.storage.from(BUCKET).remove(rows.map((r) => r.storage_path));
  await db.from("p2p_learning_attachments").delete().in("id", rows.map((r) => r.id));
}

/**
 * Tidy one owner's leftovers older than a day: uploads that never finished,
 * and frozen copies whose answer was never saved. Never touches a frozen copy
 * whose answer exists, and never another person's rows.
 */
export async function cleanupOwner(ownerId: string, now = Date.now()): Promise<number> {
  const before = new Date(now - STALE_MS).toISOString();
  const { data } = await db.from("p2p_learning_attachments").select("*").eq("owner_id", ownerId).is("deleted_at", null).lt("created_at", before);
  const stale: Row[] = [];
  for (const r of (data ?? []) as Row[]) {
    if (!r.target_id) { if (r.status === "pending") stale.push(r); continue; }
    if (!(await submissionOf(r.target_kind!, r.target_id))) stale.push(r);
  }
  if (!stale.length) return 0;
  await db.storage.from(BUCKET).remove(stale.map((r) => r.storage_path));
  await db.from("p2p_learning_attachments").delete().in("id", stale.map((r) => r.id));
  return stale.length;
}
