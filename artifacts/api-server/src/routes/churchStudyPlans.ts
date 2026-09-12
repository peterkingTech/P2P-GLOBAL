import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// Same two role tiers churchStudies.ts/churchCalls.ts already use — each
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

function mapPlan(row: Record<string, unknown>) {
  return {
    id: row.id, churchId: row.church_id, createdBy: row.created_by,
    title: row.title, description: row.description, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

// A lesson reference in a plan — always resolved against the real,
// existing p2p_lessons/p2p_modules/p2p_curriculums tables (never a
// duplicate/authored copy). "eligible" mirrors LessonPicker.tsx's own
// convention: only a currently-published lesson may be added.
async function resolveLessonSummary(lessonId: string) {
  const { data: lesson } = await db.from("p2p_lessons").select("id,title,status,module_id,order_index").eq("id", lessonId).maybeSingle();
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
  const { data: items } = await db.from("p2p_church_study_plan_items").select("*").eq("plan_id", planId).order("order_index", { ascending: true });
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

// GET /churches/:churchId/study-plans — leadership sees draft+published+archived;
// an ordinary member sees only 'published'.
router.get("/churches/:churchId/study-plans", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  if (!(await isActiveChurchMember(churchId, userId))) return err(res, "You're not a member of this church", 403);

  const leadership = await isChurchLeadership(churchId, userId);
  let query = db.from("p2p_church_study_plans").select("*").eq("church_id", churchId).order("created_at", { ascending: false });
  if (!leadership) query = query.eq("status", "published");
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map(mapPlan));
});

// GET /churches/study-plans/:planId — plan + ordered lesson items + this
// caller's own progress on each referenced lesson (never a duplicate
// progress table — read straight from p2p_lesson_progress).
router.get("/churches/study-plans/:planId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_church_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);

  const leadership = await isChurchLeadership(plan.church_id as string, userId);
  if (!leadership) {
    if (plan.status !== "published") return err(res, "This study plan is not available", 404);
    if (!(await isActiveChurchMember(plan.church_id as string, userId))) return err(res, "You're not a member of this church", 403);
  }

  const items = await loadPlanItemsWithLessons(plan.id as string);
  const lessonIds = items.map((i) => i.lessonId as string);
  const { data: progressRows } = lessonIds.length
    ? await db.from("p2p_lesson_progress").select("lesson_id,completed,status").eq("user_id", userId).in("lesson_id", lessonIds)
    : { data: [] as { lesson_id: string; completed: boolean; status: string }[] };
  const progressByLesson = new Map((progressRows ?? []).map((p) => [p.lesson_id as string, p]));

  let completedCount = 0;
  let currentItemId: string | null = null;
  const withProgress = items.map((item) => {
    const p = progressByLesson.get(item.lessonId as string);
    const done = !!p?.completed;
    if (done) completedCount += 1;
    if (!done && currentItemId === null) currentItemId = item.itemId as string;
    return { ...item, done, progressStatus: p?.status ?? "not_started" };
  });

  return ok(res, {
    plan: mapPlan(plan as Record<string, unknown>),
    items: withProgress,
    progress: { completed: completedCount, total: items.length, currentItemId },
  });
});

// POST /churches/:churchId/study-plans — leadership only. Always starts
// 'draft' regardless of what the client sends.
router.post("/churches/:churchId/study-plans", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { churchId } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title?.trim()) return err(res, "title is required");
  if (!(await isChurchLeadership(churchId, userId))) return err(res, "Only church leadership can create a Custom Study Plan", 403);

  const { data: plan, error } = await db.from("p2p_church_study_plans").insert({
    church_id: churchId, created_by: userId, title: title.trim(), description: description?.trim() || null, status: "draft",
  }).select().single();
  if (error || !plan) return err(res, error?.message ?? "Failed to create the study plan", 500);
  return ok(res, mapPlan(plan as Record<string, unknown>));
});

// PUT /churches/study-plans/:planId — leadership only. Title/description
// only — publishing/archiving go through their own endpoints below so
// publish validation always runs.
router.put("/churches/study-plans/:planId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_church_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);
  if (!(await isChurchLeadership(plan.church_id as string, userId))) return err(res, "Only church leadership can edit this study plan", 403);

  const { title, description } = req.body as { title?: string; description?: string | null };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) {
    if (!title.trim()) return err(res, "title cannot be empty");
    updates.title = title.trim();
  }
  if (description !== undefined) updates.description = description?.trim() || null;

  const { data: updated, error } = await db.from("p2p_church_study_plans").update(updates).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to update the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// POST /churches/study-plans/:planId/publish — leadership only. A plan
// with no title or zero lessons can never be published.
router.post("/churches/study-plans/:planId/publish", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_church_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);
  if (!(await isChurchLeadership(plan.church_id as string, userId))) return err(res, "Only church leadership can publish this study plan", 403);
  if (!(plan.title as string)?.trim()) return err(res, "This study plan needs a title before it can be published");

  const { count } = await db.from("p2p_church_study_plan_items").select("id", { count: "exact", head: true }).eq("plan_id", plan.id as string);
  if (!count) return err(res, "Add at least one lesson before publishing this study plan");

  const { data: updated, error } = await db.from("p2p_church_study_plans")
    .update({ status: "published", updated_at: new Date().toISOString() }).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to publish the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// POST /churches/study-plans/:planId/archive — pastor or the plan's own
// creator, matching churchStudies.ts's convention.
router.post("/churches/study-plans/:planId/archive", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: plan } = await db.from("p2p_church_study_plans").select("*").eq("id", req.params.planId).maybeSingle();
  if (!plan) return err(res, "Study plan not found", 404);

  const isCreator = plan.created_by === userId;
  const isPastor = await isChurchPastor(plan.church_id as string, userId);
  if (!isCreator && !isPastor) return err(res, "Only a church pastor or this plan's creator can archive it", 403);

  const { data: updated, error } = await db.from("p2p_church_study_plans")
    .update({ status: "archived", updated_at: new Date().toISOString() }).eq("id", plan.id as string).select().single();
  if (error || !updated) return err(res, error?.message ?? "Failed to archive the study plan", 500);
  return ok(res, mapPlan(updated as Record<string, unknown>));
});

// ── Items (lesson references) ───────────────────────────────────────────

async function loadPlanForLeadershipCheck(planId: string, userId: string) {
  const { data: plan } = await db.from("p2p_church_study_plans").select("id, church_id").eq("id", planId).maybeSingle();
  if (!plan) return { plan: null, authorized: false };
  return { plan, authorized: await isChurchLeadership(plan.church_id as string, userId) };
}

// POST /churches/study-plans/:planId/items — add an EXISTING, published
// lesson by id. Never accepts lesson content — only a lessonId reference.
router.post("/churches/study-plans/:planId/items", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId } = req.params;
  const { lessonId } = req.body as { lessonId?: string };
  if (!lessonId) return err(res, "lessonId is required");

  const { plan, authorized } = await loadPlanForLeadershipCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only church leadership can add lessons to this study plan", 403);

  const lesson = await resolveLessonSummary(lessonId);
  if (!lesson) return err(res, "That lesson could not be found", 404);
  if (lesson.status !== "published") return err(res, "Only published lessons can be added to a Custom Study Plan", 400);

  const { count } = await db.from("p2p_church_study_plan_items").select("id", { count: "exact", head: true }).eq("plan_id", planId);
  const { data: item, error } = await db.from("p2p_church_study_plan_items")
    .insert({ plan_id: planId, lesson_id: lessonId, order_index: count ?? 0 }).select().single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return err(res, "This lesson is already in the plan", 409);
    return err(res, error.message, 500);
  }
  return ok(res, { itemId: item.id, lessonId: item.lesson_id, orderIndex: item.order_index, lessonTitle: lesson.title, lessonStatus: lesson.status });
});

// DELETE /churches/study-plans/:planId/items/:itemId
router.delete("/churches/study-plans/:planId/items/:itemId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId, itemId } = req.params;
  const { plan, authorized } = await loadPlanForLeadershipCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only church leadership can remove lessons from this study plan", 403);

  const { error } = await db.from("p2p_church_study_plan_items").delete().eq("id", itemId).eq("plan_id", planId);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// PUT /churches/study-plans/:planId/reorder — body { itemIds: string[] },
// the full ordered list of this plan's item ids. Rewrites order_index
// 0..n-1 in that order; rejects if any id doesn't belong to this plan (no
// malformed/partial ordering allowed).
router.put("/churches/study-plans/:planId/reorder", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { planId } = req.params;
  const { itemIds } = req.body as { itemIds?: string[] };
  if (!Array.isArray(itemIds) || itemIds.length === 0) return err(res, "itemIds must be a non-empty array");

  const { plan, authorized } = await loadPlanForLeadershipCheck(planId, userId);
  if (!plan) return err(res, "Study plan not found", 404);
  if (!authorized) return err(res, "Only church leadership can reorder this study plan", 403);

  const { data: existing } = await db.from("p2p_church_study_plan_items").select("id").eq("plan_id", planId);
  const existingIds = new Set((existing ?? []).map((r) => r.id as string));
  if (existingIds.size !== itemIds.length || !itemIds.every((id) => existingIds.has(id))) {
    return err(res, "itemIds must be exactly the plan's current items, each listed once");
  }

  for (let i = 0; i < itemIds.length; i++) {
    const { error } = await db.from("p2p_church_study_plan_items").update({ order_index: i }).eq("id", itemIds[i]);
    if (error) return err(res, error.message, 500);
  }
  return ok(res, await loadPlanItemsWithLessons(planId));
});

export default router;
