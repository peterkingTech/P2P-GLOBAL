import { Router } from "express";
import { getWorkStatus, getMemberJourneyProgress } from "../lib/groupProgress";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import {
  GROUP_SCOPES, type GroupScope, type JourneyRow, isUuid, scopeColumn, isGroupMember, canManageGroupLearning,
  getCurriculumOutline, getActiveJourney, summarizeJourney, getGroupCovered,
} from "../lib/groupLearning";

// Unified group Learning for Family Circles and Churches (migration 199).
// Viewing: active members of THAT family / church. Choosing or changing what
// the group studies, and marking lessons covered together: Family Shepherd /
// Co-Shepherd, church leadership (lib/groupLearning canManageGroupLearning).
// Central P2P content is only ever referenced, never copied or edited here.
const router = Router();
const ok = (res: import("express").Response, data: unknown) => res.json(data);
const err = (res: import("express").Response, message: string, status = 400) => res.status(status).json({ error: message });

// GET /learning/library — the central P2P library: Core Foundation curricula
// and P2P Plans grouped by category (published, not hidden), with lesson counts.
router.get("/library", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: rows, error } = await db.from("p2p_curriculums")
    .select("id,title,subtitle,type,parent_category_id,display_order,cover_image,thumbnail_url,is_visible,status")
    .in("type", ["core", "plan", "plan_category"]).eq("status", "published");
  if (error) return err(res, error.message, 500);
  const visible = ((rows ?? []) as Record<string, unknown>[]).filter((r) => r.is_visible !== false);
  const selectable = visible.filter((r) => r.type === "core" || r.type === "plan").map((r) => r.id as string);
  const { data: mods } = selectable.length ? await db.from("p2p_modules").select("id,curriculum_id").in("curriculum_id", selectable) : { data: [] };
  const moduleCurriculum = new Map(((mods ?? []) as { id: string; curriculum_id: string }[]).map((m) => [m.id, m.curriculum_id]));
  const { data: les } = moduleCurriculum.size
    ? await db.from("p2p_lessons").select("module_id").in("module_id", [...moduleCurriculum.keys()]).eq("status", "published")
    : { data: [] };
  const lessonCount = new Map<string, number>();
  for (const l of (les ?? []) as { module_id: string }[]) {
    const c = moduleCurriculum.get(l.module_id);
    if (c) lessonCount.set(c, (lessonCount.get(c) ?? 0) + 1);
  }
  const card = (r: Record<string, unknown>) => ({
    id: r.id, title: r.title, subtitle: r.subtitle ?? null, type: r.type,
    coverImage: (r.thumbnail_url as string | null) ?? (r.cover_image as string | null) ?? null,
    lessonCount: lessonCount.get(r.id as string) ?? 0,
  });
  const byOrder = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    ((a.display_order as number | null) ?? 9999) - ((b.display_order as number | null) ?? 9999) || String(a.title).localeCompare(String(b.title));
  const core = visible.filter((r) => r.type === "core").sort(byOrder).map(card).filter((c) => c.lessonCount > 0);
  const categories = visible.filter((r) => r.type === "plan_category").sort(byOrder).map((cat) => ({
    id: cat.id, title: cat.title,
    plans: visible.filter((p) => p.type === "plan" && p.parent_category_id === cat.id).sort(byOrder).map(card).filter((c) => c.lessonCount > 0),
  })).filter((c) => c.plans.length > 0);
  return ok(res, { core, categories });
});

// GET /learning/curricula/:curriculumId — modules + lessons, in order (published only).
router.get("/curricula/:curriculumId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const outline = await getCurriculumOutline(req.params.curriculumId);
  if (!outline) return err(res, "Not found", 404);
  return ok(res, { curriculum: outline.curriculum, modules: outline.modules });
});

function parseScope(req: import("express").Request): { scope: GroupScope; groupId: string } | null {
  const scope = req.params.scope as GroupScope;
  const groupId = req.params.groupId;
  if (!GROUP_SCOPES.includes(scope) || !isUuid(groupId)) return null;
  return { scope, groupId };
}

async function loadJourney(scope: GroupScope, groupId: string, journeyId: string): Promise<JourneyRow | null> {
  if (!isUuid(journeyId)) return null;
  const { data } = await db.from("p2p_group_learning_journeys").select("*").eq("id", journeyId).eq(scopeColumn(scope), groupId).maybeSingle();
  return (data as JourneyRow | null) ?? null;
}

// GET /learning/:scope/:groupId — the Learning home.
router.get("/:scope/:groupId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await isGroupMember(s.scope, s.groupId, userId))) return err(res, "You're not a member of this group", 403);
  const canManage = await canManageGroupLearning(s.scope, s.groupId, userId);

  const { data: journeyRows, error: jErr } = await db.from("p2p_group_learning_journeys").select("*")
    .eq(scopeColumn(s.scope), s.groupId).order("updated_at", { ascending: false });
  const journeys = (jErr ? [] : (journeyRows ?? [])) as JourneyRow[];
  const active = journeys.find((j) => j.status === "active") ?? null;
  const activeSummary = active ? await summarizeJourney(s.scope, s.groupId, active, userId) : null;
  const history = [];
  for (const j of journeys.filter((x) => x.status !== "active")) {
    const outline = await getCurriculumOutline(j.curriculum_id);
    if (!outline) continue; // unpublished since: not offered, but the row is kept
    const covered = await getGroupCovered(s.scope, s.groupId, j.id, outline.lessons.map((l) => l.id));
    history.push({ id: j.id, status: j.status, pausedAt: j.paused_at, completedAt: j.completed_at, curriculum: outline.curriculum,
      group: { covered: outline.lessons.filter((l) => covered.has(l.id)).length, total: outline.lessons.length } });
  }

  // Our Custom Lessons — the group's own studies (custom content, never central).
  const table = s.scope === "family" ? "p2p_family_studies" : "p2p_church_studies";
  const lessonTable = s.scope === "family" ? "p2p_family_study_lessons" : "p2p_church_study_lessons";
  let studiesQ = db.from(table).select("id,title,description,status,updated_at").eq(scopeColumn(s.scope), s.groupId).order("updated_at", { ascending: false });
  studiesQ = canManage ? studiesQ.neq("status", "archived") : studiesQ.eq("status", "published");
  const { data: studies } = await studiesQ;
  const studyIds = ((studies ?? []) as { id: string }[]).map((x) => x.id);
  // Members count published lessons only (lesson status, migration 200; before it every lesson counted).
  let lessonRows: { study_id: string; status?: string }[] = [];
  if (studyIds.length) {
    const withStatus = await db.from(lessonTable).select("study_id,status").in("study_id", studyIds);
    lessonRows = (withStatus.error ? (await db.from(lessonTable).select("study_id").in("study_id", studyIds)).data ?? [] : withStatus.data ?? []) as typeof lessonRows;
  }
  const counts = new Map<string, number>();
  for (const l of lessonRows) if (canManage || l.status === undefined || l.status === "published") counts.set(l.study_id, (counts.get(l.study_id) ?? 0) + 1);

  return ok(res, {
    scope: s.scope, groupId: s.groupId, canManage,
    activeJourney: activeSummary,
    history,
    customLessons: ((studies ?? []) as Record<string, unknown>[]).map((x) => ({ id: x.id, title: x.title, description: x.description ?? null, status: x.status, lessonCount: counts.get(x.id as string) ?? 0 })),
    // Assignments awaiting action: the viewer's own to-do; leaders also see
    // how many submissions wait for review (Prompt 8).
    work: await getWorkStatus(s.scope, s.groupId, userId, canManage),
    // Each member's own journey completion — church leadership only, for
    // members visible to leadership; null everywhere else (no such rule).
    memberProgress: await getMemberJourneyProgress(s.scope, s.groupId, canManage),
  });
});

// POST /learning/:scope/:groupId/journeys — { curriculumId } — start (or
// resume) studying a central curriculum/plan together. The current active
// journey is paused, never deleted.
router.post("/:scope/:groupId/journeys", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await canManageGroupLearning(s.scope, s.groupId, userId))) return err(res, "Only the group's leaders can choose what you study together", 403);
  const outline = await getCurriculumOutline(String((req.body as { curriculumId?: string })?.curriculumId ?? ""));
  if (!outline || !outline.lessons.length) return err(res, "That lesson series isn't available", 404);
  const col = scopeColumn(s.scope);
  const now = new Date().toISOString();

  const current = await getActiveJourney(s.scope, s.groupId);
  if (current?.curriculum_id === outline.curriculum.id) return ok(res, { journeyId: current.id, resumed: false });
  if (current) {
    const { error } = await db.from("p2p_group_learning_journeys").update({ status: "paused", paused_at: now, updated_at: now }).eq("id", current.id);
    if (error) return err(res, error.message, 500);
  }
  const { data: existing } = await db.from("p2p_group_learning_journeys").select("*").eq(col, s.groupId).eq("curriculum_id", outline.curriculum.id).maybeSingle();
  if (existing) {
    const { error } = await db.from("p2p_group_learning_journeys").update({ status: "active", paused_at: null, updated_at: now }).eq("id", existing.id as string);
    if (error) return err(res, error.message, 500);
    return ok(res, { journeyId: existing.id, resumed: true });
  }
  const { data: created, error } = await db.from("p2p_group_learning_journeys").insert({
    [col]: s.groupId, curriculum_id: outline.curriculum.id, current_lesson_id: outline.lessons[0].id, status: "active", started_by: userId,
  }).select("id").single();
  if (error || !created) return err(res, error?.message ?? "Couldn't start", 500);
  return ok(res, { journeyId: created.id, resumed: false });
});

// POST /learning/:scope/:groupId/journeys/:journeyId/pause
router.post("/:scope/:groupId/journeys/:journeyId/pause", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await canManageGroupLearning(s.scope, s.groupId, userId))) return err(res, "Only the group's leaders can change this", 403);
  const j = await loadJourney(s.scope, s.groupId, req.params.journeyId);
  if (!j) return err(res, "Not found", 404);
  if (j.status !== "active") return ok(res, { status: j.status });
  const now = new Date().toISOString();
  const { error } = await db.from("p2p_group_learning_journeys").update({ status: "paused", paused_at: now, updated_at: now }).eq("id", j.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { status: "paused" });
});

// PUT /learning/:scope/:groupId/journeys/:journeyId/current-lesson — { lessonId } (revisit / jump)
router.put("/:scope/:groupId/journeys/:journeyId/current-lesson", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await canManageGroupLearning(s.scope, s.groupId, userId))) return err(res, "Only the group's leaders can change this", 403);
  const j = await loadJourney(s.scope, s.groupId, req.params.journeyId);
  if (!j) return err(res, "Not found", 404);
  const lessonId = String((req.body as { lessonId?: string })?.lessonId ?? "");
  const outline = await getCurriculumOutline(j.curriculum_id);
  if (!outline?.lessons.some((l) => l.id === lessonId)) return err(res, "That lesson isn't part of this series", 400);
  const { error } = await db.from("p2p_group_learning_journeys").update({ current_lesson_id: lessonId, updated_at: new Date().toISOString() }).eq("id", j.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { currentLessonId: lessonId });
});

// POST /learning/:scope/:groupId/journeys/:journeyId/covered — { lessonId, advance? }
// "We covered this lesson together" (group progress only). advance=true moves
// the group to the next lesson; covering the last one completes the journey.
router.post("/:scope/:groupId/journeys/:journeyId/covered", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await canManageGroupLearning(s.scope, s.groupId, userId))) return err(res, "Only the group's leaders can mark lessons covered", 403);
  const j = await loadJourney(s.scope, s.groupId, req.params.journeyId);
  if (!j) return err(res, "Not found", 404);
  if (j.status !== "active") return err(res, "Resume this series first", 409);
  const { lessonId, advance } = req.body as { lessonId?: string; advance?: boolean };
  const outline = await getCurriculumOutline(j.curriculum_id);
  const index = outline?.lessons.findIndex((l) => l.id === lessonId) ?? -1;
  if (!outline || index < 0) return err(res, "That lesson isn't part of this series", 400);
  const { error } = await db.from("p2p_group_lesson_completions").upsert({ journey_id: j.id, lesson_id: lessonId, marked_by: userId }, { onConflict: "journey_id,lesson_id", ignoreDuplicates: true });
  if (error) return err(res, error.message, 500);
  const covered = await getGroupCovered(s.scope, s.groupId, j.id, outline.lessons.map((l) => l.id));
  const allDone = outline.lessons.every((l) => covered.has(l.id));
  const now = new Date().toISOString();
  const next = outline.lessons.slice(index + 1).find((l) => !covered.has(l.id)) ?? null;
  const update: Record<string, unknown> = { updated_at: now };
  if (advance && next) update.current_lesson_id = next.id;
  if (allDone) { update.status = "completed"; update.completed_at = now; }
  await db.from("p2p_group_learning_journeys").update(update).eq("id", j.id);
  return ok(res, { covered: true, nextLessonId: advance ? next?.id ?? null : null, completed: allDone });
});

// DELETE /learning/:scope/:groupId/journeys/:journeyId/covered/:lessonId — undo a mistaken mark.
router.delete("/:scope/:groupId/journeys/:journeyId/covered/:lessonId", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const s = parseScope(req);
  if (!s) return err(res, "Not found", 404);
  if (!(await canManageGroupLearning(s.scope, s.groupId, userId))) return err(res, "Only the group's leaders can change this", 403);
  const j = await loadJourney(s.scope, s.groupId, req.params.journeyId);
  if (!j) return err(res, "Not found", 404);
  const { error } = await db.from("p2p_group_lesson_completions").delete().eq("journey_id", j.id).eq("lesson_id", req.params.lessonId);
  if (error) return err(res, error.message, 500);
  if (j.status === "completed") {
    // Re-open it — as active only if the group isn't already studying something else.
    const other = await getActiveJourney(s.scope, s.groupId);
    const now = new Date().toISOString();
    await db.from("p2p_group_learning_journeys").update(other ? { status: "paused", paused_at: now, completed_at: null, updated_at: now } : { status: "active", completed_at: null, updated_at: now }).eq("id", j.id);
  }
  return ok(res, { covered: false });
});

export default router;
