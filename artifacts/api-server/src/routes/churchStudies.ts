import { Router } from "express";
import { mountCustomLessonRoutes, visibleLessons } from "../lib/customLessonRoutes";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// Same two role tiers Church Calls already uses (churchCalls.ts) — each
// route file keeps its own local copy rather than sharing a module, per
// this codebase's established convention.
const LEADERSHIP_ROLES = ["senior_pastor", "discipleship_pastor", "small_group_leader"];
const PASTOR_ROLES = ["senior_pastor", "discipleship_pastor"];

async function getChurchMembership(churchId: string, userId: string) {
  const { data } = await db.from("p2p_church_members").select("role, is_active")
    .eq("church_id", churchId).eq("user_id", userId).maybeSingle();
  return data as { role: string; is_active: boolean } | null;
}
async function isActiveChurchMember(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active;
}
async function isChurchLeadership(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active && LEADERSHIP_ROLES.includes(m.role);
}
async function isChurchPastor(churchId: string, userId: string): Promise<boolean> {
  const m = await getChurchMembership(churchId, userId);
  return !!m?.is_active && PASTOR_ROLES.includes(m.role);
}

function mapStudy(row: Record<string, unknown>) {
  return {
    id: row.id, churchId: row.church_id, createdBy: row.created_by,
    title: row.title, description: row.description, status: row.status,
    orderIndex: row.order_index, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// GET /churches/:churchId/studies — leadership sees draft+published+archived;
// an ordinary member sees only 'published'. Mirrors Church Calls' own
// "list is view-gated by membership, not by role" shape.
router.get("/churches/:churchId/studies", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  if (!(await isActiveChurchMember(churchId, userId))) return err(res, "You're not a member of this church", 403);

  const leadership = await isChurchLeadership(churchId, userId);
  let query = db.from("p2p_church_studies").select("*").eq("church_id", churchId).order("order_index", { ascending: true });
  if (!leadership) query = query.eq("status", "published");
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapStudy));
});

// GET /churches/studies/:studyId — study + its lessons, ordered.
router.get("/churches/studies/:studyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_church_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);

  const leadership = await isChurchLeadership(study.church_id as string, userId);
  if (!leadership) {
    if (study.status !== "published") return err(res, "This study is not available", 404);
    if (!(await isActiveChurchMember(study.church_id as string, userId))) return err(res, "You're not a member of this church", 403);
  }

  const { data: lessons } = await db.from("p2p_church_study_lessons").select("*").eq("study_id", study.id as string).order("order_index", { ascending: true });
  // Members see published lessons only; leaders also see drafts and archived ones.
  return ok(res, { study: mapStudy(study as Record<string, unknown>), lessons: visibleLessons((lessons ?? []) as Record<string, unknown>[], leadership), canManage: leadership });
});

// POST /churches/:churchId/studies — leadership only. Title required;
// status always starts 'draft' regardless of what the client sends — a
// study is never accidentally created already visible to participants.
router.post("/churches/:churchId/studies", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title?.trim()) return err(res, "title is required");
  if (!(await isChurchLeadership(churchId, userId))) return err(res, "Only church leadership can create a Church Study", 403);

  const { data: study, error } = await db.from("p2p_church_studies").insert({
    church_id: churchId, created_by: userId, title: title.trim(), description: description?.trim() || null, status: "draft",
  }).select().single();
  if (error || !study) return err(res, error?.message ?? "Failed to create the study", 500);
  return ok(res, mapStudy(study as Record<string, unknown>));
});

// PUT /churches/studies/:studyId — leadership only. Supports editing
// title/description/orderIndex and transitioning status
// (draft/published/archived) — "published" here means "visible within
// this church," never publication to the shared P2P library (Stage 6).
router.put("/churches/studies/:studyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_church_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);
  if (!(await isChurchLeadership(study.church_id as string, userId))) return err(res, "Only church leadership can edit this study", 403);

  const { title, description, status, orderIndex } = req.body as {
    title?: string; description?: string | null; status?: string; orderIndex?: number;
  };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title.trim()) return err(res, "title cannot be empty");
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description?.trim() || null;
  if (orderIndex !== undefined) updates.order_index = orderIndex;
  if (status !== undefined) {
    if (!["draft", "published", "archived"].includes(status)) return err(res, "status must be draft, published, or archived");
    updates.status = status;
  }

  const { data: updated, error } = await db.from("p2p_church_studies").update(updates).eq("id", study.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update the study", 500);
  return ok(res, mapStudy(updated as Record<string, unknown>));
});

// POST /churches/studies/:studyId/archive — narrower than general edit:
// only a church pastor or the study's own creator, matching the Stage 1
// forensic recommendation (leadership creates/edits; pastor-or-creator
// archives).
router.post("/churches/studies/:studyId/archive", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_church_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);

  const isCreator = study.created_by === userId;
  const isPastor = await isChurchPastor(study.church_id as string, userId);
  if (!isCreator && !isPastor) return err(res, "Only a church pastor or this study's creator can archive it", 403);

  const { data: updated, error } = await db.from("p2p_church_studies")
    .update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", study.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to archive the study", 500);
  return ok(res, mapStudy(updated as Record<string, unknown>));
});

// ── Lessons ──────────────────────────────────────────────────────────────
// Every lesson mutation is gated the same way as study edits: church
// leadership only, resolved through the parent study's church_id.

async function loadStudyForLeadershipCheck(studyId: string, userId: string) {
  const { data: study } = await db.from("p2p_church_studies").select("id, church_id").eq("id", studyId).maybeSingle();
  if (!study) return { study: null, authorized: false };
  return { study, authorized: await isChurchLeadership(study.church_id as string, userId) };
}

// Lesson create / edit / status / delete — shared with the other scope
// (lib/customLessonRoutes.ts): drafts, publish/unpublish, archive instead of
// deleting anything ever published, version bump on published edits.
mountCustomLessonRoutes(router, {
  base: "/churches/studies", table: "p2p_church_study_lessons",
  loadForManage: loadStudyForLeadershipCheck, who: "church leadership",
});

export default router;
