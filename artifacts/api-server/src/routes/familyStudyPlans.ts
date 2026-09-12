import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// Mirrors family.ts's own getMembership/isShepherdOrCoShepherd exactly —
// family authorization stays row-scoped to the specific family_id being
// acted on, never "the user's family" (a user may belong to several).
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

function mapPlan(row: Record<string, unknown>) {
  return {
    id: row.id, familyId: row.family_id, createdBy: row.created_by,
    title: row.title, description: row.description, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function resolveLessonSummary(lessonId: string) {
  const { data: lesson } = await db.from("p2p_lessons").select("id,title,status,module_id").eq("id", lessonId).maybeSingle();
  if (!lesson) return null;
  const { data: mod } = await db.from("p2p_modules").select("id,title,curriculum_id").eq("id", lesson.module_id as string).maybeSingle();
  const curriculumTitle = mod
    ? (await db.from("p2p_curriculums").select("title").eq("id", mod.curriculum_id as string).maybeSingle()).data?.title ?? null
    : null;
  return {
    id: lesson.id as string, title: lesson.title as string, status: lesson.status as string,
    moduleTitle: mod?.title ?? null, curriculumTitle,
  };
}

async function loadPlanItemsWithLessons(planId: string) {
  const { data: items } = await db.from("p2p_family_study_plan_items").select("*").eq("plan_id", planId).order("order_index", { ascending: true });
  const lessonIds = (items ?? []).map((i) => i.lesson_id as string);
  const lessonMap = new Map<string, Record<string, unknown>>();
  if (lessonIds.length) {
    const { data: lessons } = await db.from("p2p_lessons").select("id,title,status,module_id").in("id", lessonIds);
    for (const l of lessons ?? []) lessonMap.set(l.id as string, l as Record<string, unknown>);
  }
  return (items ?? []).map((item) => {
    const lesson = lessonMap.get(item.lesson_id as string);
    return {
      itemId: item.id, lessonId: item.lesson_id, orderIndex: item.order_index,
      lessonTitle: lesson?.title ?? "(lesson unavailable)", lessonStatus: lesson?.status ?? null,
    };
  });
}

// GET /family/:familyId/study-plans
router.get("/:familyId/study-plans", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  if (!(await getMembership(userId, familyId))) return err(res, "You're not a member of this Family Gathering", 403);

  const canManage = await isShepherdOrCoShepherd(familyId, userId);
  let query = db.from("p2p_family_study_plans").select("*").eq("family_id", familyId).order("created_at", { ascending: false });
  if (!canManage) query = query.eq("status", "published");
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapPlan));
});

// GET /family/study-plans/:planId — plan + ordered items, each marked
// done/current/upcoming the SAME way the existing family Discipleship
// Journey view already does: by whether a family Gathering
// (p2p_family_worship_history.lesson_id) ever covered that lesson — never
// gated on any one member's personal p2p_lesson_progress. This is what lets
// it compose with Gathering continuity (familyWorship.ts) instead of
// showing a second, contradictory notion of "done."
router.get("/study-plans/:planId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_family_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);

  const canManage = await isShepherdOrCoShepherd(plan.family_id as string, userId);
  if (!canManage) {
    if (plan.status !== "published") return err(res, "This study plan is not available", 404);
    if (!(await getMembership(userId, plan.family_id as string))) return err(res, "You're not a member of this Family Gathering", 403);
  }

  const items = await loadPlanItemsWithLessons(plan.id as string);
  const lessonIds = items.map((i) => i.lessonId as string);
  const { data: coveredRows } = lessonIds.length
    ? await db.from("p2p_family_worship_history").select("lesson_id").eq("family_id", plan.family_id as string).in("lesson_id", lessonIds)
    : { data: [] as { lesson_id: string }[] };
  const coveredIds = new Set((coveredRows ?? []).map((r) => r.lesson_id as string));

  let completedCount = 0;
  let currentItemId: string | null = null;
  const withProgress = items.map((item) => {
    const done = coveredIds.has(item.lessonId as string);
    if (done) completedCount += 1;
    if (!done && currentItemId === null) currentItemId = item.itemId as string;
    return { ...item, done };
  });

  return ok(res, {
    plan: mapPlan(plan as Record<string, unknown>),
    items: withProgress,
    progress: { completed: completedCount, total: items.length, currentItemId },
  });
});

// POST /family/:familyId/study-plans — Shepherd/Co-Shepherd only.
router.post("/:familyId/study-plans", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title?.trim()) return err(res, "title is required");
  if (!(await isShepherdOrCoShepherd(familyId, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can create a Custom Study Plan", 403);

  const { data: plan, error } = await db.from("p2p_family_study_plans").insert({
    family_id: familyId, created_by: userId, title: title.trim(), description: description?.trim() || null, status: "draft",
  }).select().single();
  if (error || !plan) return err(res, error?.message ?? "Failed to create the study plan", 500);
  return ok(res, mapPlan(plan as Record<string, unknown>));
});

// PUT /family/study-plans/:planId — Shepherd/Co-Shepherd only.
router.put("/study-plans/:planId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_family_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);
  if (!(await isShepherdOrCoShepherd(plan.family_id as string, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can edit this study plan", 403);

  const { title, description } = req.body as { title?: string; description?: string | null };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title.trim()) return err(res, "title cannot be empty");
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description?.trim() || null;

  const { data: updated, error } = await db.from("p2p_family_study_plans").update(updates).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// POST /family/study-plans/:planId/publish
router.post("/study-plans/:planId/publish", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_family_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);
  if (!(await isShepherdOrCoShepherd(plan.family_id as string, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can publish this study plan", 403);
  if (!(plan.title as string)?.trim()) return err(res, "This study plan needs a title before it can be published");

  const { count } = await db.from("p2p_family_study_plan_items").select("id", { count: "exact", head: true }).eq("plan_id", plan.id as string);
  if (!count) return err(res, "Add at least one lesson before publishing this study plan");

  const { data: updated, error } = await db.from("p2p_family_study_plans")
    .update({ status: "published", updated_at: new Date().toISOString() }).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to publish the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// POST /family/study-plans/:planId/archive — Shepherd/Co-Shepherd or the
// plan's own creator.
router.post("/study-plans/:planId/archive", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_family_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);

  const isCreator = plan.created_by === userId;
  const canManage = await isShepherdOrCoShepherd(plan.family_id as string, userId);
  if (!isCreator && !canManage) return err(res, "Only the Family Shepherd, a Co-Shepherd, or this plan's creator can archive it", 403);

  const { data: updated, error } = await db.from("p2p_family_study_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to archive the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// ── Items (lesson references) ───────────────────────────────────────────

async function loadPlanForManageCheck(planId: string, userId: string) {
  const { data: plan } = await db.from("p2p_family_study_plans").select("id, family_id").eq("id", planId).maybeSingle();
  if (!plan) return { plan: null, authorized: false };
  return { plan, authorized: await isShepherdOrCoShepherd(plan.family_id as string, userId) };
}

router.post("/study-plans/:planId/items", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId } = req.params;
  const { lessonId } = req.body as { lessonId?: string };
  if (!lessonId) return err(res, "lessonId is required");

  const { plan, authorized } = await loadPlanForManageCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only the Family Shepherd or a Co-Shepherd can add lessons to this study plan", 403);

  const lesson = await resolveLessonSummary(lessonId);
  if (!lesson) return err(res, "That lesson could not be found", 404);
  if (lesson.status !== "published") return err(res, "Only published lessons can be added to a Custom Study Plan", 400);

  const { count } = await db.from("p2p_family_study_plan_items").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  const { data: item, error } = await db.from("p2p_family_study_plan_items")
    .insert({ plan_id: planId, lesson_id: lessonId, order_index: count ?? 0 }).select().single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return err(res, "This lesson is already in the plan", 409);
    return err(res, error.message, 500);
  }
  return ok(res, { itemId: item.id, lessonId: item.lesson_id, orderIndex: item.order_index, lessonTitle: lesson.title, lessonStatus: lesson.status });
});

router.delete("/study-plans/:planId/items/:itemId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId, itemId } = req.params;
  const { plan, authorized } = await loadPlanForManageCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only the Family Shepherd or a Co-Shepherd can remove lessons from this study plan", 403);

  const { error } = await db.from("p2p_family_study_plan_items").delete().eq("id", itemId).eq("plan_id", planId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

router.put("/study-plans/:planId/reorder", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId } = req.params;
  const { itemIds } = req.body as { itemIds?: string[] };
  if (!Array.isArray(itemIds) || itemIds.length === 0) return err(res, "itemIds must be a non-empty array");

  const { plan, authorized } = await loadPlanForManageCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only the Family Shepherd or a Co-Shepherd can reorder this study plan", 403);

  const { data: existing } = await db.from("p2p_family_study_plan_items").select("id").eq("plan_id", planId);
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  if (existingIds.size !== itemIds.length || !itemIds.every((id) => existingIds.has(id))) {
    return err(res, "itemIds must be exactly the plan's current items, each listed once");
  }

  for (let i = 0; i < itemIds.length; i++) {
    const { error } = await db.from("p2p_family_study_plan_items").update({ order_index: i }).eq("id", itemIds[i]);
    if (error) return err(res, error.message, 500);
  }
  return ok(res, await loadPlanItemsWithLessons(planId));
});

// ── Study source setting ────────────────────────────────────────────────
// PUT /family/:familyId/study-source — Shepherd/Co-Shepherd only. Persists
// which source Family Study uses (default stays 'p2p_curriculum' — this
// route is the only way it ever changes). Switching to 'custom_study_plan'
// with an activeStudyPlanId requires that plan to belong to THIS family and
// be published — never a draft, never another family's plan.
router.put("/:familyId/study-source", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { familyId } = req.params;
  if (!(await isShepherdOrCoShepherd(familyId, userId))) return err(res, "Only the Family Shepherd or a Co-Shepherd can change the study source", 403);

  const { studySource, activeStudyPlanId } = req.body as { studySource?: string; activeStudyPlanId?: string | null };
  const updates: Record<string, unknown> = {};
  if (studySource !== undefined) {
    if (!["p2p_curriculum", "custom_study_plan"].includes(studySource)) return err(res, "studySource must be p2p_curriculum or custom_study_plan");
    updates.study_source = studySource;
  }
  if (activeStudyPlanId !== undefined) {
    if (activeStudyPlanId) {
      const { data: plan } = await db.from("p2p_family_study_plans").select("id,family_id,status").eq("id", activeStudyPlanId).maybeSingle();
      if (!plan || plan.family_id !== familyId) return err(res, "That study plan does not belong to this family", 404);
      if (plan.status !== "published") return err(res, "Only a published study plan can be selected");
    }
    updates.active_study_plan_id = activeStudyPlanId;
  }
  if (Object.keys(updates).length === 0) return err(res, "Nothing to update");

  const { data: updated, error } = await db.from("p2p_families").update(updates).eq("id", familyId).select("id,study_source,active_study_plan_id").single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update the study source", 500);
  return ok(res, { familyId: updated.id, studySource: updated.study_source, activeStudyPlanId: updated.active_study_plan_id });
});

export default router;
