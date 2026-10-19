import { Router } from "express";
import { mountCustomLessonRoutes, visibleLessons } from "../lib/customLessonRoutes";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// Mirrors family.ts's own getMembership/isShepherdOrCoShepherd exactly —
// no new helper functions invented, and (per the Stage 1 forensic report)
// family authorization stays row-scoped to the specific family_id being
// acted on, never "the user's family," since a user may belong to several.
async function getMembership(userId: string, familyId: string) {
  const { data } = await db
    .from("p2p_family_members").select("*").eq("user_id", userId).eq("family_id", familyId).eq("status", "active").maybeSingle();
  return data as Record<string, unknown> | null;
}
async function isShepherdOrCoShepherd(familyId: string, userId: string): Promise<boolean> {
  const { data: family } = await db.from("p2p_families").select("shepherd_id").eq("id", familyId).maybeSingle();
  if (family?.shepherd_id === userId) return true;
  const { data: member } = await db
    .from("p2p_family_members").select("role").eq("family_id", familyId).eq("user_id", userId).eq("status", "active").maybeSingle();
  return member?.role === "co_shepherd";
}

function mapStudy(row: Record<string, unknown>) {
  return {
    id: row.id, familyId: row.family_id, createdBy: row.created_by,
    title: row.title, description: row.description, status: row.status,
    orderIndex: row.order_index, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// GET /family/:familyId/studies — Shepherd/Co-Shepherd sees
// draft+published+archived; any other active member sees only 'published'.
router.get("/:familyId/studies", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  if (!(await getMembership(userId, familyId))) return err(res, "You're not a member of this Family Gathering", 403);

  const canManage = await isShepherdOrCoShepherd(familyId, userId);
  let query = db.from("p2p_family_studies").select("*").eq("family_id", familyId).order("order_index", { ascending: true });
  if (!canManage) query = query.eq("status", "published");
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapStudy));
});

// GET /family/studies/:studyId — study + its lessons, ordered.
router.get("/studies/:studyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_family_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);

  const canManage = await isShepherdOrCoShepherd(study.family_id as string, userId);
  if (!canManage) {
    if (study.status !== "published") return err(res, "This study is not available", 404);
    if (!(await getMembership(userId, study.family_id as string))) return err(res, "You're not a member of this Family Gathering", 403);
  }

  const { data: lessons } = await db.from("p2p_family_study_lessons").select("*").eq("study_id", study.id as string).order("order_index", { ascending: true });
  // Members see published lessons only; leaders also see drafts and archived ones.
  return ok(res, { study: mapStudy(study as Record<string, unknown>), lessons: visibleLessons((lessons ?? []) as Record<string, unknown>[], canManage), canManage });
});

// POST /family/:familyId/studies — Shepherd/Co-Shepherd only. Always
// starts 'draft', matching Church Studies' own "never accidentally
// visible" rule.
router.post("/:familyId/studies", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title?.trim()) return err(res, "title is required");
  if (!(await isShepherdOrCoShepherd(familyId, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can create a Family Study", 403);

  const { data: study, error } = await db.from("p2p_family_studies").insert({
    family_id: familyId, created_by: userId, title: title.trim(), description: description?.trim() || null, status: "draft",
  }).select().single();
  if (error || !study) return err(res, error?.message ?? "Failed to create the study", 500);
  return ok(res, mapStudy(study as Record<string, unknown>));
});

// PUT /family/studies/:studyId — Shepherd/Co-Shepherd only.
router.put("/studies/:studyId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_family_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);
  if (!(await isShepherdOrCoShepherd(study.family_id as string, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can edit this study", 403);

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

  const { data: updated, error } = await db.from("p2p_family_studies").update(updates).eq("id", study.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update the study", 500);
  return ok(res, mapStudy(updated as Record<string, unknown>));
});

// POST /family/studies/:studyId/archive — Shepherd/Co-Shepherd or the
// study's own creator.
router.post("/studies/:studyId/archive", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: study } = await db.from("p2p_family_studies").select("*").eq("id", req.params.studyId).maybeSingle();
  if (!study) return err(res, "Study not found", 404);

  const isCreator = study.created_by === userId;
  const canManage = await isShepherdOrCoShepherd(study.family_id as string, userId);
  if (!isCreator && !canManage) return err(res, "Only the Family Shepherd, a Co-Shepherd, or this study's creator can archive it", 403);

  const { data: updated, error } = await db.from("p2p_family_studies")
    .update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", study.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to archive the study", 500);
  return ok(res, mapStudy(updated as Record<string, unknown>));
});

// ── Lessons ──────────────────────────────────────────────────────────────

async function loadStudyForManageCheck(studyId: string, userId: string) {
  const { data: study } = await db.from("p2p_family_studies").select("id, family_id").eq("id", studyId).maybeSingle();
  if (!study) return { study: null, authorized: false };
  return { study, authorized: await isShepherdOrCoShepherd(study.family_id as string, userId) };
}

// Lesson create / edit / status / delete — shared with the other scope
// (lib/customLessonRoutes.ts): drafts, publish/unpublish, archive instead of
// deleting anything ever published, version bump on published edits.
mountCustomLessonRoutes(router, {
  base: "/studies", table: "p2p_family_study_lessons",
  loadForManage: loadStudyForManageCheck, who: "the Family Shepherd or a Co-Shepherd",
});

export default router;
