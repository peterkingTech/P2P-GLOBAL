import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { isUuid } from "../lib/groupLearning";
import {
  BUCKET, DOWNLOAD_TTL_SECONDS, LIMITS, FILE_TYPES, TARGET_KINDS, type TargetKind, type Row,
  attachmentsEnabled, notReady, mapRow, validateFile, validCaption, validateDrawing, pathFor, loadRow, canOpen, canOpenTarget,
  rowsForTarget, linkAttachments, cleanupOwner,
} from "../lib/learningAttachments";
import { safeFileName } from "./groupResources";

// Handwriting, photos and PDFs on Comprehensive Check answers (migration 218;
// rules in lib/learningAttachments.ts). Drafts are the owner's alone; frozen
// copies follow the answer they belong to. Core answers: the app links its
// drafts to the answer's (pre-made) id here, THEN saves the answer exactly as
// before. Family/Church answers link inside /learning/work's submit route.
const router = Router();
const ok = (res: Response, data: unknown) => res.json(data);
const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });
const OFF = "Drawings and attachments aren't switched on yet.";

async function caller(req: Request, res: Response) {
  const userId = await verifyCaller(req);
  if (!userId) { err(res, "Please sign in.", 401); return null; }
  return userId;
}
/** For anything that adds work: signed in AND switched on. */
async function writer(req: Request, res: Response) {
  const userId = await caller(req, res); if (!userId) return null;
  if (!attachmentsEnabled()) { err(res, OFF, 503); return null; }
  return userId;
}
/** The caller's own draft (never a frozen copy). */
async function ownDraft(req: Request, res: Response, userId: string) {
  const row = await loadRow(String(req.params.id));
  if (!row || row.owner_id !== userId || row.target_id) { err(res, "Not found", 404); return null; }
  return row;
}

// GET /learning/attachments/status → { enabled, limits }
router.get("/status", async (_req, res) => ok(res, {
  enabled: attachmentsEnabled(),
  limits: { fileBytes: LIMITS.fileBytes, drawingBytes: LIMITS.drawingBytes, pages: LIMITS.pages, drawingsPerAnswer: LIMITS.drawingsPerAnswer, filesPerAnswer: LIMITS.filesPerAnswer },
  fileTypes: Object.keys(FILE_TYPES),
}));

// GET /learning/attachments/mine — my drafts (and a tidy-up of my own leftovers).
router.get("/mine", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const { data, error } = await db.from("p2p_learning_attachments").select("*").eq("owner_id", userId).is("target_id", null).is("deleted_at", null).order("updated_at", { ascending: false }).limit(LIMITS.draftsPerOwner);
  if (error) return notReady(error.code) ? ok(res, { attachments: [] }) : err(res, "Couldn't load your drafts.", 500);
  void cleanupOwner(userId).catch(() => {});
  return ok(res, { attachments: ((data ?? []) as Row[]).map(mapRow) });
});

async function underDraftLimit(userId: string) {
  const { count } = await db.from("p2p_learning_attachments").select("id", { count: "exact", head: true }).eq("owner_id", userId).is("target_id", null).is("deleted_at", null);
  return (count ?? 0) < LIMITS.draftsPerOwner;
}

// POST /learning/attachments/handwriting — { doc, caption? } → a new drawing draft.
router.post("/handwriting", async (req, res) => {
  const userId = await writer(req, res); if (!userId) return;
  const body = (req.body ?? {}) as { doc?: unknown; caption?: unknown };
  const v = validateDrawing(body.doc);
  if (typeof v === "string") return err(res, v);
  const caption = validCaption(body.caption);
  if (caption === false) return err(res, "That description is too long.");
  if (!(await underDraftLimit(userId))) return err(res, "You have too many drafts. Remove some first.", 409);
  const id = randomUUID();
  const path = pathFor(userId, id, "drawing.json");
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, v.json, { contentType: "application/json", upsert: true });
  if (upErr) return err(res, "Couldn't save your drawing. Please try again.", 502);
  const { data, error } = await db.from("p2p_learning_attachments").insert({
    id, owner_id: userId, kind: "handwriting", storage_path: path, file_name: "drawing.json", mime_type: "application/json",
    size_bytes: Buffer.byteLength(v.json), page_count: v.doc.pages.length, caption, status: "ready",
  }).select().single();
  if (error || !data) {
    await db.storage.from(BUCKET).remove([path]);
    return notReady(error?.code) ? err(res, OFF, 503) : err(res, "Couldn't save your drawing. Please try again.", 500);
  }
  return ok(res, mapRow(data as Row));
});

// PUT /learning/attachments/handwriting/:id — { doc, caption? } → save my draft again.
router.put("/handwriting/:id", async (req, res) => {
  const userId = await writer(req, res); if (!userId) return;
  const row = await ownDraft(req, res, userId); if (!row) return;
  if (row.kind !== "handwriting") return err(res, "Not found", 404);
  const body = (req.body ?? {}) as { doc?: unknown; caption?: unknown };
  const v = validateDrawing(body.doc);
  if (typeof v === "string") return err(res, v);
  const caption = body.caption === undefined ? row.caption : validCaption(body.caption);
  if (caption === false) return err(res, "That description is too long.");
  const { error: upErr } = await db.storage.from(BUCKET).upload(row.storage_path, v.json, { contentType: "application/json", upsert: true });
  if (upErr) return err(res, "Couldn't save your drawing. Please try again.", 502);
  const { data, error } = await db.from("p2p_learning_attachments").update({
    size_bytes: Buffer.byteLength(v.json), page_count: v.doc.pages.length, caption, updated_at: new Date().toISOString(),
  }).eq("id", row.id).select().single();
  if (error || !data) return err(res, "Couldn't save your drawing. Please try again.", 500);
  return ok(res, mapRow(data as Row));
});

// GET /learning/attachments/:id/content — a drawing's document, for whoever may open it.
router.get("/:id/content", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await loadRow(String(req.params.id));
  if (!row || row.kind !== "handwriting" || !(await canOpen(row, userId))) return err(res, "Not found", 404);
  const { data, error } = await db.storage.from(BUCKET).download(row.storage_path);
  if (error || !data) return err(res, "That drawing couldn't be loaded.", 502);
  try {
    const v = validateDrawing(JSON.parse(await (data as Blob).text()));
    if (typeof v === "string") return err(res, "That drawing couldn't be loaded.", 500);
    return ok(res, { attachment: mapRow(row), doc: v.doc });
  } catch { return err(res, "That drawing couldn't be loaded.", 500); }
});

// GET /learning/attachments/:id/link — a 5-minute link to a photo or PDF, for whoever may open it.
router.get("/:id/link", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await loadRow(String(req.params.id));
  if (!row || row.kind === "handwriting" || row.status !== "ready" || !(await canOpen(row, userId))) return err(res, "Not found", 404);
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path, DOWNLOAD_TTL_SECONDS);
  if (error || !data) return err(res, "That file couldn't be opened.", 502);
  return ok(res, { url: data.signedUrl, expiresIn: DOWNLOAD_TTL_SECONDS, fileName: row.file_name, mimeType: row.mime_type });
});

// POST /learning/attachments/uploads — { fileName, mimeType, sizeBytes, caption? } → a signed upload URL for one path.
router.post("/uploads", async (req, res) => {
  const userId = await writer(req, res); if (!userId) return;
  const { fileName, mimeType, sizeBytes, caption: rawCaption } = (req.body ?? {}) as Record<string, unknown>;
  const problem = validateFile(String(fileName ?? ""), String(mimeType ?? ""), Number(sizeBytes));
  if (problem) return err(res, problem);
  const caption = validCaption(rawCaption);
  if (caption === false) return err(res, "That description is too long.");
  if (!(await underDraftLimit(userId))) return err(res, "You have too many drafts. Remove some first.", 409);
  const id = randomUUID();
  const name = safeFileName(String(fileName));
  const path = pathFor(userId, id, name);
  const { error } = await db.from("p2p_learning_attachments").insert({
    id, owner_id: userId, kind: FILE_TYPES[String(mimeType)].kind, storage_path: path, file_name: name, mime_type: String(mimeType),
    size_bytes: Number(sizeBytes), caption, status: "pending",
  });
  if (error) return notReady(error.code) ? err(res, OFF, 503) : err(res, "Couldn't start the upload.", 500);
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed) { await db.from("p2p_learning_attachments").delete().eq("id", id); return err(res, "Couldn't start the upload.", 502); }
  return ok(res, { attachmentId: id, uploadUrl: signed.signedUrl, token: signed.token, path });
});

// POST /learning/attachments/:id/retry-url — a fresh signed URL for my unfinished upload.
router.post("/:id/retry-url", async (req, res) => {
  const userId = await writer(req, res); if (!userId) return;
  const row = await ownDraft(req, res, userId); if (!row) return;
  if (row.status !== "pending") return err(res, "That upload has already finished.", 409);
  const { data: signed, error } = await db.storage.from(BUCKET).createSignedUploadUrl(row.storage_path, { upsert: true });
  if (error || !signed) return err(res, "Couldn't restart the upload.", 502);
  return ok(res, { attachmentId: row.id, uploadUrl: signed.signedUrl, token: signed.token, path: row.storage_path });
});

// POST /learning/attachments/:id/complete — the server checks the object exists, with a plausible size.
router.post("/:id/complete", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await ownDraft(req, res, userId); if (!row) return;
  if (row.status !== "pending") return ok(res, mapRow(row));
  const dir = row.storage_path.slice(0, row.storage_path.lastIndexOf("/"));
  const name = row.storage_path.slice(row.storage_path.lastIndexOf("/") + 1);
  const { data: listed } = await db.storage.from(BUCKET).list(dir, { search: name });
  const obj = ((listed ?? []) as { name: string; metadata?: { size?: number } }[]).find((o) => o.name === name);
  if (!obj) return err(res, "The upload didn't finish. Please try again.", 409);
  const size = Number(obj.metadata?.size ?? row.size_bytes);
  if (!size || size > LIMITS.fileBytes) {
    await db.storage.from(BUCKET).remove([row.storage_path]);
    await db.from("p2p_learning_attachments").delete().eq("id", row.id);
    return err(res, "Files can be up to 25 MB.");
  }
  const { data } = await db.from("p2p_learning_attachments").update({ status: "ready", size_bytes: size, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
  return ok(res, mapRow((data ?? row) as Row));
});

// PATCH /learning/attachments/:id — { caption } on my draft.
router.patch("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await ownDraft(req, res, userId); if (!row) return;
  const caption = validCaption((req.body ?? {}).caption);
  if (caption === false) return err(res, "That description is too long.");
  const { data } = await db.from("p2p_learning_attachments").update({ caption, updated_at: new Date().toISOString() }).eq("id", row.id).select().single();
  return ok(res, mapRow((data ?? row) as Row));
});

// DELETE /learning/attachments/:id — my draft only (sent work can't be removed).
router.delete("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await ownDraft(req, res, userId); if (!row) return;
  await db.storage.from(BUCKET).remove([row.storage_path]);
  await db.from("p2p_learning_attachments").update({ deleted_at: new Date().toISOString() }).eq("id", row.id);
  return ok(res, { removed: true });
});

// POST /learning/attachments/link — core answers, BEFORE the answer is saved:
// { submissionId, lessonId, assignmentQuestionId, attachmentIds, captions? }.
// Only a Comprehensive Check question of that lesson (never a reflection).
router.post("/link", async (req, res) => {
  const userId = await writer(req, res); if (!userId) return;
  const b = (req.body ?? {}) as { submissionId?: string; lessonId?: string; assignmentQuestionId?: string; attachmentIds?: unknown; captions?: Record<string, unknown> };
  if (!isUuid(b.submissionId) || !isUuid(b.lessonId) || !isUuid(b.assignmentQuestionId) || !Array.isArray(b.attachmentIds)) return err(res, "Missing answer details.");
  const { data: q } = await db.from("p2p_assignment_questions").select("id,assignment_id").eq("id", b.assignmentQuestionId).maybeSingle();
  const { data: a } = q ? await db.from("p2p_assignments").select("id,lesson_id").eq("id", q.assignment_id as string).maybeSingle() : { data: null };
  if (!q || !a || a.lesson_id !== b.lessonId) return err(res, "Attachments can only be added to a Comprehensive Check answer.", 400);
  const r = await linkAttachments({ ownerId: userId, targetKind: "core_submission", targetId: b.submissionId, ids: b.attachmentIds as string[], captions: b.captions });
  if ("error" in r) return err(res, r.error, r.status);
  return ok(res, { submissionId: b.submissionId, attachments: r.rows.map(mapRow) });
});

// GET /learning/attachments/for?kind=core_submission|group_submission&ids=a,b — the
// files of answers the caller may see (others are simply left out).
router.get("/for", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const kind = String(req.query.kind ?? "") as TargetKind;
  const ids = [...new Set(String(req.query.ids ?? "").split(",").filter(isUuid))].slice(0, 50);
  if (!TARGET_KINDS.includes(kind)) return err(res, "Unknown answer type.");
  const out: Record<string, ReturnType<typeof mapRow>[]> = {};
  const rows = await rowsForTarget(kind, ids).catch(() => [] as Row[]);
  for (const id of ids) {
    const mine = rows.filter((r) => r.target_id === id);
    if (!mine.length || !(await canOpenTarget(kind, id, userId))) continue;
    // Only files made by the answer's author ever show with it.
    const author = await authorOf(kind, id);
    const shown = mine.filter((r) => r.owner_id === author);
    if (shown.length) out[id] = shown.map(mapRow);
  }
  return ok(res, { attachments: out });
});

async function authorOf(kind: TargetKind, id: string) {
  const { data } = await db.from(kind === "core_submission" ? "p2p_submissions" : "p2p_group_assignment_submissions").select("user_id").eq("id", id).maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

export default router;
