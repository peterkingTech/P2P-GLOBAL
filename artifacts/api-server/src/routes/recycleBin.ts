import { Router } from "express";
import { supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";
import {
  RECYCLE_TYPE_LABELS, isRecycleType, recycleTypesFor, previewDelete, moveToBin, restoreFromBin, purgeFromBin, sendRecycleError,
  type RecycleType,
} from "../lib/recycleBin";

// P2P Admin Recycle Bin (migration 214), mounted at /admin/recycle-bin.
// Admins see and act on the content types their role may delete; the
// database re-checks every action. Permanent deletion is super_admin only and
// needs the typed confirmation. Snapshots never leave the server: the list
// shows titles, counts and a short preview of the item itself.

const router = Router();
router.use(requireAdmin);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PURGE_CONFIRMATION = "PERMANENTLY DELETE";
const actor = (req: import("express").Request) => ({ id: (req as any).adminUserId as string, role: (req as any).adminRole as string });

const LIST_COLS = "id,content_type,content_id,title,parent_label,parent_type,parent_id,original_status,status,counts,storage_paths,deleted_by,deleted_at,restored_by,restored_at,restore_warnings,purged_by,purged_at";
async function names(ids: (string | null)[]) {
  const uniq = [...new Set(ids.filter(Boolean))] as string[];
  if (!uniq.length) return new Map<string, string>();
  const { data } = await db.from("p2p_profiles").select("id,full_name,username").in("id", uniq);
  return new Map((data ?? []).map((p: any) => [p.id as string, (p.full_name as string) || (p.username ? `@${p.username}` : "An admin")]));
}
function mapEntry(r: any, who: Map<string, string>) {
  return {
    id: r.id, contentType: r.content_type, typeLabel: RECYCLE_TYPE_LABELS[r.content_type as RecycleType] ?? r.content_type,
    contentId: r.content_id, title: r.title, parentLabel: r.parent_label, parentType: r.parent_type, parentId: r.parent_id,
    originalStatus: r.original_status, status: r.status, counts: r.counts ?? {}, fileCount: (r.storage_paths ?? []).length,
    deletedBy: r.deleted_by ? { id: r.deleted_by, name: who.get(r.deleted_by) ?? "An admin" } : null, deletedAt: r.deleted_at,
    restoredBy: r.restored_by ? { id: r.restored_by, name: who.get(r.restored_by) ?? "An admin" } : null, restoredAt: r.restored_at,
    restoreWarnings: r.restore_warnings ?? [],
    purgedBy: r.purged_by ? { id: r.purged_by, name: who.get(r.purged_by) ?? "An admin" } : null, purgedAt: r.purged_at,
  };
}

// GET /admin/recycle-bin?type=&q=&deletedBy=&from=&to=&status=in_bin|restored|purged&page=&pageSize=
router.get("/", async (req, res) => {
  const me = actor(req);
  const allowed = recycleTypesFor(me.role);
  const type = String(req.query.type ?? "");
  if (type && !isRecycleType(type)) return res.status(400).json({ error: "Unknown content type." });
  const types = type ? allowed.filter((t) => t === type) : allowed;
  const status = String(req.query.status ?? "in_bin");
  if (!["in_bin", "restored", "purged"].includes(status)) return res.status(400).json({ error: "status must be in_bin, restored or purged" });
  const page = Math.max(0, Number(req.query.page ?? 0) || 0), pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
  const typeOptions = allowed.map((t) => ({ value: t, label: RECYCLE_TYPE_LABELS[t] }));
  if (!types.length) return res.json({ items: [], total: 0, page, pageSize, types: typeOptions, canPurge: me.role === "super_admin" });
  let query = db.from("p2p_recycle_bin").select(LIST_COLS, { count: "exact" }).eq("status", status).in("content_type", types)
    .order(status === "restored" ? "restored_at" : status === "purged" ? "purged_at" : "deleted_at", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  const q = String(req.query.q ?? "").trim();
  if (q) query = query.ilike("title", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`).slice(0, 100)}%`);
  const deletedBy = String(req.query.deletedBy ?? "");
  if (deletedBy) { if (!UUID_RE.test(deletedBy)) return res.status(400).json({ error: "invalid deletedBy" }); query = query.eq("deleted_by", deletedBy); }
  for (const [k, op] of [["from", "gte"], ["to", "lte"]] as const) {
    const v = String(req.query[k] ?? "");
    if (v) { if (Number.isNaN(Date.parse(v))) return res.status(400).json({ error: `invalid ${k} date` }); query = (query as any)[op]("deleted_at", new Date(v).toISOString()); }
  }
  const { data, count, error } = await query;
  if (error) return res.status(error.code === "42P01" || error.code === "PGRST205" ? 503 : 500).json({ error: error.code === "42P01" || error.code === "PGRST205" ? "The Recycle Bin isn't set up on this server yet." : "Couldn't load the Recycle Bin." });
  const who = await names((data ?? []).flatMap((r: any) => [r.deleted_by, r.restored_by, r.purged_by]));
  // Admins who deleted something here, for the filter.
  const { data: dels } = await db.from("p2p_recycle_bin").select("deleted_by").eq("status", status).in("content_type", types).not("deleted_by", "is", null).limit(500);
  const delWho = await names((dels ?? []).map((r: any) => r.deleted_by));
  return res.json({
    items: (data ?? []).map((r) => mapEntry(r, who)), total: count ?? 0, page, pageSize, types: typeOptions,
    deleters: [...delWho].map(([id, name]) => ({ id, name })), canPurge: me.role === "super_admin",
  });
});

// GET /admin/recycle-bin/:id — one entry with a short preview of the item itself.
router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  const me = actor(req);
  const { data } = await db.from("p2p_recycle_bin").select(`${LIST_COLS},snapshot`).eq("id", req.params.id).maybeSingle();
  if (!data || !recycleTypesFor(me.role).includes(data.content_type as RecycleType)) return res.status(404).json({ error: "Not found" });
  const root = (data.snapshot as { t: string; rows: Record<string, unknown>[] }[] | null)?.[0]?.rows?.find((r) => r.id === data.content_id) ?? null;
  const pick = (r: Record<string, unknown> | null) => r && Object.fromEntries(
    ["title", "subtitle", "summary", "description", "caption", "status", "chapter_number", "step_order", "media_type", "created_at"]
      .filter((k) => r[k] !== undefined && r[k] !== null).map((k) => [k, typeof r[k] === "string" ? (r[k] as string).slice(0, 400) : r[k]]));
  const who = await names([data.deleted_by, data.restored_by, data.purged_by]);
  return res.json({ ...mapEntry(data, who), preview: pick(root) });
});

// POST /admin/recycle-bin/preview { type, id } — what moving it would include (changes nothing).
router.post("/preview", async (req, res) => {
  const { type, id } = req.body as { type?: string; id?: string };
  if (!isRecycleType(type) || !id || !UUID_RE.test(id)) return res.status(400).json({ error: "type and id are required" });
  try { return res.json(await previewDelete(actor(req).id, type, id)); } catch (e) { return sendRecycleError(res, e); }
});

// POST /admin/recycle-bin { type, id } — move to the Recycle Bin.
router.post("/", async (req, res) => {
  const { type, id } = req.body as { type?: string; id?: string };
  if (!isRecycleType(type) || !id || !UUID_RE.test(id)) return res.status(400).json({ error: "type and id are required" });
  try { return res.status(201).json(await moveToBin(actor(req).id, type, id)); } catch (e) { return sendRecycleError(res, e); }
});

router.post("/:id/restore", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  try { return res.json(await restoreFromBin(actor(req).id, req.params.id)); } catch (e) { return sendRecycleError(res, e); }
});

// POST /admin/recycle-bin/:id/purge { confirm: "PERMANENTLY DELETE" } — super_admin only.
router.post("/:id/purge", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: "Not found" });
  if (actor(req).role !== "super_admin") return res.status(403).json({ error: "Only a super admin can permanently delete." });
  if ((req.body as { confirm?: string })?.confirm !== PURGE_CONFIRMATION) return res.status(400).json({ error: `Type ${PURGE_CONFIRMATION} to confirm.` });
  try { return res.json(await purgeFromBin(actor(req).id, req.params.id)); } catch (e) { return sendRecycleError(res, e); }
});

export default router;
