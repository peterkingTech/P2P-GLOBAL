import { Router, type Response } from "express";
import { randomUUID } from "node:crypto";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { GROUP_SCOPES, type GroupScope, isUuid, isGroupMember, canManageGroupLearning } from "../lib/groupLearning";

// Files & Resources for a Family Circle or a Church (migration 209).
// The bucket is private with NO client storage policies: every request here
// re-checks ACTIVE membership of that exact group, then hands out a
// short-lived signed URL for one object. A non-member — including someone who
// just left, or someone guessing ids/paths — gets nothing.
const router = Router();
export const BUCKET = "group-resources";
export const MAX_BYTES = 25 * 1024 * 1024;
export const DOWNLOAD_TTL_SECONDS = 300;
export const ALLOWED_TYPES: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"], "image/png": ["png"], "image/webp": ["webp"], "image/heic": ["heic"],
  "application/pdf": ["pdf"],
  "application/msword": ["doc"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.ms-excel": ["xls"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  "application/vnd.ms-powerpoint": ["ppt"], "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "text/plain": ["txt"], "text/csv": ["csv"], "audio/mpeg": ["mp3"], "audio/mp4": ["m4a", "mp4"], "audio/x-m4a": ["m4a"],
};
const NOT_READY = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);

const ok = (res: Response, data: unknown) => res.json(data);
const err = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });

/** A safe stored file name: letters, digits, dot, dash, underscore; keeps the extension. */
export function safeFileName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").replace(/^\.+/, "").slice(-120);
  return cleaned || "file";
}
/** The type must be allowed AND match the file's extension (no disguised executables). */
export function validateUpload(fileName: string, mimeType: string, sizeBytes: number): string | null {
  const exts = ALLOWED_TYPES[mimeType];
  if (!exts) return "That file type isn't supported. Use images, PDFs, Office documents, text or audio.";
  const ext = (safeFileName(fileName).split(".").pop() ?? "").toLowerCase();
  if (!exts.includes(ext)) return "The file's name doesn't match its type.";
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return "That file is empty.";
  if (sizeBytes > MAX_BYTES) return "Files can be up to 25 MB.";
  return null;
}

async function caller(req: import("express").Request, res: Response) {
  const userId = await verifyCaller(req);
  if (!userId) { err(res, "Please sign in.", 401); return null; }
  return userId;
}
const mapRow = (r: Record<string, unknown>, uploaderName?: string | null) => ({
  id: r.id, scope: r.scope, groupId: r.group_id, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes,
  uploaderId: r.uploader_id, uploaderName: uploaderName ?? null, createdAt: r.created_at,
  lessonId: r.lesson_id ?? null, curriculumId: r.curriculum_id ?? null, gatheringId: r.gathering_id ?? null,
});

async function loadResource(id: string) {
  if (!isUuid(id)) return null;
  const { data } = await db.from("p2p_group_resources").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  return data as Record<string, unknown> | null;
}
/** Minors: a Family "child" can view the family's files but not add them. */
async function canUpload(scope: GroupScope, groupId: string, userId: string): Promise<boolean> {
  if (!(await isGroupMember(scope, groupId, userId))) return false;
  if (scope === "family") {
    const { data } = await db.from("p2p_family_members").select("role").eq("family_id", groupId).eq("user_id", userId).eq("status", "active").maybeSingle();
    return data?.role !== "child";
  }
  return true;
}

// (Declared before /:scope/:groupId so "/<id>/download" isn't read as a group.)
// GET /resources/:id/download — a 5-minute signed link, members only.
router.get("/:id/download", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await loadResource(req.params.id);
  if (!row || row.status !== "ready") return err(res, "Not found", 404);
  if (!(await isGroupMember(row.scope as GroupScope, row.group_id as string, userId))) return err(res, "Only members can open this file.", 403);
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(row.storage_path as string, DOWNLOAD_TTL_SECONDS, { download: row.file_name as string });
  if (error || !data) return err(res, "Couldn't open the file.", 502);
  return ok(res, { url: data.signedUrl, expiresIn: DOWNLOAD_TTL_SECONDS, fileName: row.file_name, mimeType: row.mime_type });
});

// GET /resources/:scope/:groupId — this group's files (members only).
router.get("/:scope/:groupId", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const scope = req.params.scope as GroupScope; const groupId = req.params.groupId;
  if (!GROUP_SCOPES.includes(scope) || !isUuid(groupId)) return err(res, "Not found", 404);
  if (!(await isGroupMember(scope, groupId, userId))) return err(res, "Only members can see this group's files.", 403);
  const { data, error } = await db.from("p2p_group_resources").select("*").eq("scope", scope).eq("group_id", groupId)
    .eq("status", "ready").is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
  if (error) return NOT_READY.has(String(error.code)) ? ok(res, { available: false, items: [], canUpload: false, canManage: false }) : err(res, "Couldn't load files.", 500);
  const rows = (data ?? []) as Record<string, unknown>[];
  const ids = [...new Set(rows.map((r) => r.uploader_id).filter(Boolean))] as string[];
  const { data: profiles } = ids.length ? await db.from("p2p_profiles").select("id,full_name").in("id", ids) : { data: [] };
  const names = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
  return ok(res, {
    available: true,
    canUpload: await canUpload(scope, groupId, userId),
    canManage: await canManageGroupLearning(scope, groupId, userId),
    items: rows.map((r) => mapRow(r, names.get(r.uploader_id as string))),
  });
});

// POST /resources/:scope/:groupId/uploads — start an upload: validate, create
// a pending row, and return a signed upload URL for exactly one server-chosen path.
router.post("/:scope/:groupId/uploads", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const scope = req.params.scope as GroupScope; const groupId = req.params.groupId;
  if (!GROUP_SCOPES.includes(scope) || !isUuid(groupId)) return err(res, "Not found", 404);
  if (!(await canUpload(scope, groupId, userId))) return err(res, "You can't add files to this group.", 403);
  const { fileName, mimeType, sizeBytes, lessonId, curriculumId, gatheringId } = (req.body ?? {}) as Record<string, unknown>;
  const problem = validateUpload(String(fileName ?? ""), String(mimeType ?? ""), Number(sizeBytes));
  if (problem) return err(res, problem, 400);
  const id = randomUUID();
  const name = safeFileName(String(fileName));
  const path = `${scope}/${groupId}/${id}/${name}`;
  const { error } = await db.from("p2p_group_resources").insert({
    id, scope, group_id: groupId, uploader_id: userId, storage_path: path, file_name: name, mime_type: String(mimeType),
    size_bytes: Number(sizeBytes), status: "pending",
    lesson_id: isUuid(lessonId) ? lessonId : null, curriculum_id: isUuid(curriculumId) ? curriculumId : null, gathering_id: isUuid(gatheringId) ? gatheringId : null,
  });
  if (error) return NOT_READY.has(String(error.code)) ? err(res, "Files aren't available yet.", 503) : err(res, "Couldn't start the upload.", 500);
  const { data: signed, error: sErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (sErr || !signed) {
    await db.from("p2p_group_resources").delete().eq("id", id);
    return err(res, "Couldn't start the upload.", 502);
  }
  return ok(res, { resourceId: id, uploadUrl: signed.signedUrl, token: signed.token, path });
});

// POST /resources/:id/complete — the uploader confirms; the server checks the
// object really exists with a plausible size before listing it.
router.post("/:id/complete", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await loadResource(req.params.id);
  if (!row || row.uploader_id !== userId || row.status !== "pending") return err(res, "Not found", 404);
  if (!(await isGroupMember(row.scope as GroupScope, row.group_id as string, userId))) return err(res, "You're no longer a member of this group.", 403);
  const path = row.storage_path as string;
  const dir = path.slice(0, path.lastIndexOf("/"));
  const { data: listed } = await db.storage.from(BUCKET).list(dir, { search: path.slice(path.lastIndexOf("/") + 1) });
  const obj = (listed ?? [])[0] as { metadata?: { size?: number } } | undefined;
  if (!obj) return err(res, "The upload didn't finish. Please try again.", 409);
  const size = Number(obj.metadata?.size ?? row.size_bytes);
  if (size > MAX_BYTES) { await db.storage.from(BUCKET).remove([path]); await db.from("p2p_group_resources").delete().eq("id", row.id); return err(res, "Files can be up to 25 MB.", 400); }
  await db.from("p2p_group_resources").update({ status: "ready", size_bytes: size }).eq("id", row.id);
  return ok(res, { ready: true });
});

// DELETE /resources/:id — the uploader, or the group's Shepherd/Co-Shepherd /
// church leadership. Removes the object; the row is soft-deleted.
router.delete("/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const row = await loadResource(req.params.id);
  if (!row) return err(res, "Not found", 404);
  const scope = row.scope as GroupScope, groupId = row.group_id as string;
  if (!(await isGroupMember(scope, groupId, userId))) return err(res, "Not found", 404);
  const isUploader = row.uploader_id === userId;
  if (!isUploader && !(await canManageGroupLearning(scope, groupId, userId))) return err(res, "Only the person who added it or the group's leaders can remove this file.", 403);
  await db.storage.from(BUCKET).remove([row.storage_path as string]);
  const { error } = await db.from("p2p_group_resources").update({ deleted_at: new Date().toISOString() }).eq("id", row.id);
  if (error) return err(res, "Couldn't remove the file.", 500);
  return ok(res, { removed: true });
});

export default router;
