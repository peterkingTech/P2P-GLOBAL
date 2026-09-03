import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRole as supabase } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";
import { getTranslation, translateAndStore, withTimeout, type StoredTranslation } from "../lib/translationEngine";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Same fix as lib/translationEngine.ts / routes/translations.ts — the shared
// anon-key `supabase` client above is RLS-blocked from several curriculum
// tables (authenticated-only SELECT policies), so lesson content reads need
// a service-role client.
const supabaseRead = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

// PostgREST's .in() filter is serialized into the request URL, which has a
// real length limit — a plain, un-chunked .in() over ~150+ UUIDs (each ~36
// chars) can silently return zero rows past that point instead of erroring,
// which is exactly what happened here once the Plans catalog grew past ~140
// rows (every lessonCount silently came back 0). Chunk any .in() call whose
// id list scales with catalog size, not just ones already known to be large.
const SUPABASE_IN_CHUNK_SIZE = 100;
function chunkIds(ids: string[], size = SUPABASE_IN_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
async function selectInChunks<T = Record<string, unknown>>(
  table: string,
  columns: string,
  column: string,
  ids: string[],
  extraFilter?: (query: any) => any
): Promise<T[]> {
  if (!ids.length) return [];
  const results: T[] = [];
  for (const c of chunkIds(ids)) {
    let query = supabaseRead.from(table).select(columns).in(column, c);
    if (extraFilter) query = extraFilter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}.${column} IN chunk failed: ${error.message}`);
    results.push(...((data ?? []) as T[]));
  }
  return results;
}

interface LessonContentBase {
  id: unknown;
  moduleId: unknown;
  title: unknown;
  subtitle: unknown;
  sortOrder: unknown;
  sections: { id: string; title: string; content: string }[];
  scriptures: { id: string; reference: string; verse: string }[];
  questions: { id: string; question: string }[];
}

// Merges a cached/fresh translation into the English lesson shape.
//
// Translations are stored as ONE concatenated body blob and a newline-joined
// discussion-question blob (see buildTranslatableFromBlocks in
// translationEngine.ts) — that shape doesn't preserve the original section-
// by-section boundaries, so the translated body is shown as a single merged
// section rather than split back into the original section titles/breaks.
// Discussion questions ARE kept as individual, separately-submittable
// entries (their real DB ids/FKs must survive translation) by zipping the
// translated lines back onto the English questions in order; if the line
// count doesn't match (e.g. a question was added after the cached
// translation was made), the English question text is kept rather than
// risk mismatched translations.
function mergeTranslatedLesson(base: LessonContentBase, translation: StoredTranslation) {
  const merged = { ...base };
  if (translation.title) merged.title = translation.title;
  if (translation.subtitle) merged.subtitle = translation.subtitle;

  const metadata = translation.metadata ?? {};
  const translatedBody = typeof metadata.content === "string" ? metadata.content.trim() : "";
  if (translatedBody) {
    merged.sections = [{ id: "translated", title: "", content: translatedBody }];
  }

  const translatedQuestions = typeof metadata.discussion_questions === "string" ? metadata.discussion_questions : "";
  if (translatedQuestions) {
    const lines = translatedQuestions.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === base.questions.length) {
      merged.questions = base.questions.map((q, i) => ({ ...q, question: lines[i] }));
    }
  }

  return merged;
}

function mapModule(row: Record<string, unknown>, completedLessons = 0) {
  return {
    id: row.id,
    curriculumId: row.curriculum_id ?? null,
    title: row.title,
    description: row.description ?? null,
    level: row.level ?? 1,
    lessonCount: row.lesson_count ?? 0,
    imageUrl: row.image_url ?? null,
    sortOrder: row.sort_order ?? 0,
    completedLessons,
  };
}

function mapLesson(row: Record<string, unknown>, isCompleted = false) {
  return {
    id: row.id,
    moduleId: row.module_id ?? null,
    title: row.title,
    content: row.content ?? null,
    verseRef: row.verse_ref ?? null,
    verseText: row.verse_text ?? null,
    sortOrder: row.sort_order ?? 0,
    isCompleted,
    createdAt: row.created_at,
  };
}

// GET /curriculum — list published curriculums
router.get("/curriculum", async (_req, res) => {
  const { data, error } = await supabase
    .from("p2p_curriculums")
    .select("*")
    .eq("is_published", true)
    .order("created_at", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  return res.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description ?? null,
      imageUrl: r.image_url ?? null,
      isPublished: r.is_published ?? false,
      createdAt: r.created_at,
    }))
  );
});

// GET /curriculum/:curriculumId/modules
router.get("/curriculum/:curriculumId/modules", async (req, res) => {
  const { curriculumId } = req.params;
  const { data, error } = await supabase
    .from("p2p_modules")
    .select("*")
    .eq("curriculum_id", curriculumId)
    .order("order_index", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map((r) => mapModule(r)));
});

// GET /modules — all modules
router.get("/modules", async (_req, res) => {
  const { data, error } = await supabase
    .from("p2p_modules")
    .select("*")
    .order("order_index", { ascending: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map((r) => mapModule(r)));
});

// GET /modules/:moduleId — module with its lessons
router.get("/modules/:moduleId", async (req, res) => {
  const { moduleId } = req.params;

  const [{ data: moduleData, error: modErr }, { data: lessonsData, error: lesErr }] =
    await Promise.all([
      supabase.from("p2p_modules").select("*").eq("id", moduleId).single(),
      supabase
        .from("p2p_lessons")
        .select("*")
        .eq("module_id", moduleId)
        .order("order_index", { ascending: true }),
    ]);

  if (modErr || !moduleData) {
    return res.status(404).json({ error: "Module not found" });
  }

  const lessons = ((lessonsData ?? []) as Record<string, unknown>[]).map((l) =>
    mapLesson(l)
  );

  return res.json({
    ...mapModule(moduleData as Record<string, unknown>),
    lessons,
  });
});

// GET /lessons/:lessonId?language=xx
//
// English (or no language param) returns the lesson's real content
// (sections/scriptures/questions — the same tables the mobile lesson screen
// already reads directly). A non-English language additionally:
//   1. Checks p2p_content_translations for a cached translation.
//   2. If cached, merges it in and returns immediately (served_from_cache: true).
//   3. If not cached, translates now via translateAndStore (25s timeout),
//      stores the result, and returns it (served_from_cache: false).
//   4. On any translation failure (including timeout), falls back to the
//      English content with translation_available: false and a
//      translation_error message — the user is never blocked from reading
//      the lesson.
router.get("/lessons/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  const language = ((req.query.language as string) || "en").trim();

  const [{ data: lesson }, { data: sections }, { data: scriptures }, { data: questions }] =
    await Promise.all([
      supabaseRead.from("p2p_lessons").select("id,module_id,title,subtitle,order_index").eq("id", lessonId).maybeSingle(),
      supabaseRead.from("p2p_lesson_sections").select("id,title,content,section_order").eq("lesson_id", lessonId).order("section_order", { ascending: true }),
      supabaseRead.from("p2p_scriptures").select("id,reference,verse,display_order").eq("lesson_id", lessonId).order("display_order", { ascending: true }),
      supabaseRead.from("p2p_reflection_questions").select("id,question,display_order").eq("lesson_id", lessonId).order("display_order", { ascending: true }),
    ]);

  if (!lesson) {
    return res.status(404).json({ error: "Lesson not found" });
  }

  const base: LessonContentBase = {
    id: lesson.id,
    moduleId: lesson.module_id ?? null,
    title: lesson.title,
    subtitle: lesson.subtitle ?? null,
    sortOrder: lesson.order_index ?? 0,
    sections: ((sections ?? []) as Record<string, unknown>[]).map((s) => ({
      id: s.id as string, title: (s.title as string) ?? "", content: (s.content as string) ?? "",
    })),
    scriptures: ((scriptures ?? []) as Record<string, unknown>[]).map((s) => ({
      id: s.id as string, reference: s.reference as string, verse: s.verse as string,
    })),
    questions: ((questions ?? []) as Record<string, unknown>[]).map((q) => ({
      id: q.id as string, question: q.question as string,
    })),
  };

  if (language === "en") {
    return res.json(base);
  }

  try {
    // adminMode=true — this endpoint IS the review gate for on-demand
    // translations; there's no separate human-approval step in this flow.
    const cached = await getTranslation("lesson", lessonId, language, true);
    if (cached) {
      return res.json({ ...mergeTranslatedLesson(base, cached), translation_available: true, served_from_cache: true });
    }

    const fresh = await withTimeout(
      translateAndStore("lesson", lessonId, language, { triggeredBy: "on-demand" }),
      25_000
    );
    return res.json({ ...mergeTranslatedLesson(base, fresh), translation_available: true, served_from_cache: false });
  } catch (e: any) {
    return res.json({ ...base, translation_available: false, translation_error: e.message ?? "Translation failed" });
  }
});

// ── Unified Plans API ─────────────────────────────────────────────────────────
// Plans are p2p_curriculums rows with type='plan' — the SAME modules/lessons
// tables as core curriculum (see migration 041_unify_plans_system.sql). The
// separate p2p_plans/p2p_plan_modules/p2p_plan_lessons system this used to
// mean was dropped in that migration; there is no second system anymore.

function mapPlan(row: Record<string, unknown>, moduleCount = 0, lessonCount = 0, fallbackImageUrl: string | null = null) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    subtitle: row.subtitle ?? null,
    // p2p_curriculums' real image column is `cover_image` (not
    // `cover_image_url` — that name belongs to p2p_modules, which is a
    // separate, already-existing column there). `cover_image` itself has
    // never actually been set for the pre-existing plans (Victory, Media
    // Mandate) — their real cover art was seeded onto each module's legacy
    // `image_url` column instead, so fall back to that until an admin sets
    // a dedicated plan-level cover image.
    coverImageUrl: (row.cover_image as string | null) ?? fallbackImageUrl,
    thumbnailUrl: row.thumbnail_url ?? null,
    colorTheme: row.color_theme ?? "#1D9E75",
    tags: row.tags ?? [],
    isFeatured: row.is_featured ?? false,
    difficultyLevel: row.difficulty_level ?? "beginner",
    estimatedWeeks: row.estimated_weeks ?? null,
    teachingCreditName: row.teaching_credit_name ?? null,
    teachingCreditRole: row.teaching_credit_role ?? null,
    teachingCreditChurch: row.teaching_credit_church ?? null,
    teachingCreditLocation: row.teaching_credit_location ?? null,
    teachingCreditYoutube: row.teaching_credit_youtube ?? null,
    teachingCreditInstagram: row.teaching_credit_instagram ?? null,
    status: row.status,
    displayOrder: row.display_order ?? null,
    moduleCount,
    lessonCount,
  };
}

function mapPlanModule(row: Record<string, unknown>) {
  return {
    id: row.id,
    curriculumId: row.curriculum_id ?? null,
    title: row.title,
    description: row.description ?? null,
    // Same legacy-column fallback as mapPlan() above — `cover_image_url`
    // (new) is unset for existing modules; their real thumbnail lives on
    // the pre-existing `image_url` column.
    coverImageUrl: (row.cover_image_url as string | null) ?? (row.image_url as string | null) ?? null,
    colorTheme: row.color_theme ?? null,
    sortOrder: row.order_index ?? 0,
    status: row.status,
  };
}

function mapPlanLesson(row: Record<string, unknown>) {
  return {
    id: row.id,
    moduleId: row.module_id ?? null,
    title: row.title,
    subtitle: row.subtitle ?? null,
    sortOrder: row.order_index ?? 0,
    status: row.status,
  };
}

// GET /plans — list all published plans
router.get("/plans", async (_req, res) => {
  const { data: plans, error } = await supabaseRead
    .from("p2p_curriculums")
    .select("*")
    .eq("type", "plan")
    .eq("status", "published")
    .order("is_featured", { ascending: false })
    .order("display_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const planIds = (plans ?? []).map((p) => p.id as string);
  const modules = await selectInChunks<{ id: string; curriculum_id: string; image_url: string | null; order_index: number }>(
    "p2p_modules", "id,curriculum_id,image_url,order_index", "curriculum_id", planIds
  );
  modules.sort((a, b) => a.order_index - b.order_index);
  const moduleIds = modules.map((m) => m.id);
  const lessons = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds);

  const moduleCountByPlan = new Map<string, number>();
  const moduleToPlanId = new Map<string, string>();
  const fallbackImageByPlan = new Map<string, string>();
  for (const m of (modules ?? []) as Record<string, unknown>[]) {
    const planId = m.curriculum_id as string;
    moduleCountByPlan.set(planId, (moduleCountByPlan.get(planId) ?? 0) + 1);
    moduleToPlanId.set(m.id as string, planId);
    // Ordered ascending above, so the first module seen per plan is its
    // earliest one — same "first module's image" fallback as the detail route.
    if (!fallbackImageByPlan.has(planId) && m.image_url) fallbackImageByPlan.set(planId, m.image_url as string);
  }
  const lessonCountByPlan = new Map<string, number>();
  for (const l of (lessons ?? []) as Record<string, unknown>[]) {
    const planId = moduleToPlanId.get(l.module_id as string);
    if (planId) lessonCountByPlan.set(planId, (lessonCountByPlan.get(planId) ?? 0) + 1);
  }

  return res.json(
    (plans ?? []).map((p) => mapPlan(
      p as Record<string, unknown>,
      moduleCountByPlan.get(p.id as string) ?? 0,
      lessonCountByPlan.get(p.id as string) ?? 0,
      fallbackImageByPlan.get(p.id as string) ?? null
    ))
  );
});

// ── Plan Categories ──────────────────────────────────────────────────────────
// Categories are p2p_curriculums rows with type='plan_category' (migration
// 054_plan_categories.sql) — 10 top-level collections that group the
// individual topic plans (type='plan') via parent_category_id. Field names
// below follow this file's existing camelCase convention (mapPlan etc.), not
// the snake_case originally sketched for this feature.

// GET /plans/categories — the 10 top-level category collections
router.get("/plans/categories", async (_req, res) => {
  const { data: categories, error } = await supabaseRead
    .from("p2p_curriculums")
    .select("*")
    .eq("type", "plan_category")
    .eq("status", "published")
    // is_visible=false is the admin "Hidden" toggle (Plan Category Management)
    // — the category still exists and is manageable in admin, just excluded
    // from what users see here. Pre-migration rows have is_visible=NULL,
    // which the `neq` filter would incorrectly exclude, so OR in "is null".
    .or("is_visible.eq.true,is_visible.is.null")
    .order("display_order", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });

  const categoryIds = (categories ?? []).map((c) => c.id as string);
  const { data: plans } = categoryIds.length
    ? await supabaseRead
        .from("p2p_curriculums")
        .select("id,parent_category_id")
        .eq("type", "plan")
        .in("parent_category_id", categoryIds)
    : { data: [] as { id: string; parent_category_id: string | null }[] };

  const planToCategory = new Map<string, string>();
  const planCountByCategory = new Map<string, number>();
  for (const p of (plans ?? []) as Record<string, unknown>[]) {
    const catId = p.parent_category_id as string | null;
    if (!catId) continue;
    planToCategory.set(p.id as string, catId);
    planCountByCategory.set(catId, (planCountByCategory.get(catId) ?? 0) + 1);
  }
  const planIds = Array.from(planToCategory.keys());

  const modules = await selectInChunks<{ id: string; curriculum_id: string }>("p2p_modules", "id,curriculum_id", "curriculum_id", planIds);
  const moduleToPlan = new Map<string, string>();
  for (const m of modules) moduleToPlan.set(m.id, m.curriculum_id);
  const moduleIds = Array.from(moduleToPlan.keys());

  const lessons = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds);
  const totalLessonsByCategory = new Map<string, number>();
  for (const l of (lessons ?? []) as Record<string, unknown>[]) {
    const planId = moduleToPlan.get(l.module_id as string);
    const catId = planId ? planToCategory.get(planId) : undefined;
    if (catId) totalLessonsByCategory.set(catId, (totalLessonsByCategory.get(catId) ?? 0) + 1);
  }

  return res.json(
    (categories ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description ?? null,
      category: (c.tags as string[] | null)?.[0] ?? null,
      colorTheme: c.color_theme ?? "#1D9E75",
      coverImage: c.cover_image ?? null,
      displayOrder: c.display_order ?? null,
      planCount: planCountByCategory.get(c.id as string) ?? 0,
      totalLessons: totalLessonsByCategory.get(c.id as string) ?? 0,
    }))
  );
});

// ── Sequential plan locking ──────────────────────────────────────────────────
// A plan is "complete" for a user once every one of its lessons is marked
// completed in p2p_lesson_progress — the same definition GET
// /plans/completed/:userId already uses via getUserPlanProgressMap's percent
// field, just checked for one specific plan here instead of filtering all of
// them. Plans unlock one at a time within a category via unlock_after_plan_id
// (migration 055_plan_locking.sql); a plan with no unlock_after_plan_id
// (topic 1 in every category, plus every pre-restructure plan) is never locked.
function planIsComplete(
  progressMap: Map<string, { percent: number; completedLessons: number; totalLessons: number; lastActivityAt: string | null }>,
  planId: string
): boolean {
  const p = progressMap.get(planId);
  return !!p && p.totalLessons > 0 && p.percent === 100;
}

function resolveLockStatus(
  unlockAfterPlanId: string | null,
  progressMap: Map<string, { percent: number; completedLessons: number; totalLessons: number; lastActivityAt: string | null }> | null,
  titleById: Map<string, string>,
  manuallyUnlocked?: boolean
): { locked: boolean; unlockMessage: string | null } {
  // Admin override (Plan Category Management "Toggle Lock") always wins,
  // regardless of prerequisite completion.
  if (manuallyUnlocked) return { locked: false, unlockMessage: null };
  if (!unlockAfterPlanId) return { locked: false, unlockMessage: null };
  // No user context to check against — default to locked rather than
  // silently granting access to sequential content.
  if (!progressMap) return { locked: true, unlockMessage: null };
  const complete = planIsComplete(progressMap, unlockAfterPlanId);
  if (complete) return { locked: false, unlockMessage: null };
  const prereqTitle = titleById.get(unlockAfterPlanId) ?? "the previous plan";
  return { locked: true, unlockMessage: `Complete "${prereqTitle}" to unlock this plan` };
}

// GET /plans/search?q=&userId= — full-text-ish search across plan titles,
// module titles, and lesson titles. Results are plans (never bare modules/
// lessons), ordered exact-title-match first, then partial-title-match, then
// "content" matches (the query only hit inside a module/lesson title).
// Capped at 50. Lock status is included per result when userId is given.
// Must be registered before /plans/:planId, or Express matches "search" as
// a planId (same reason /plans/categories precedes it too).
router.get("/plans/search", async (req, res) => {
  const q = ((req.query.q as string) ?? "").trim();
  const userId = req.query.userId as string | undefined;
  if (!q) return res.json([]);

  const { data: titleMatches, error: titleErr } = await supabaseRead
    .from("p2p_curriculums")
    .select("id")
    .eq("type", "plan")
    .eq("status", "published")
    .ilike("title", `%${q}%`);
  if (titleErr) return res.status(500).json({ error: titleErr.message });

  const { data: moduleMatches } = await supabaseRead
    .from("p2p_modules")
    .select("curriculum_id")
    .ilike("title", `%${q}%`)
    .limit(300);

  const { data: lessonMatches } = await supabaseRead
    .from("p2p_lessons")
    .select("module_id")
    .ilike("title", `%${q}%`)
    .limit(300);
  const lessonModuleIds = Array.from(new Set((lessonMatches ?? []).map((l) => l.module_id as string)));
  const lessonModules = await selectInChunks<{ id: string; curriculum_id: string }>("p2p_modules", "id,curriculum_id", "id", lessonModuleIds);

  const contentMatchPlanIds = new Set<string>([
    ...(moduleMatches ?? []).map((m) => m.curriculum_id as string),
    ...lessonModules.map((m) => m.curriculum_id),
  ]);
  const titleMatchPlanIds = new Set((titleMatches ?? []).map((p) => p.id as string));

  const allCandidateIds = Array.from(new Set([...titleMatchPlanIds, ...contentMatchPlanIds])).slice(0, 200);
  if (!allCandidateIds.length) return res.json([]);

  const candidatePlans = await selectInChunks("p2p_curriculums", "*", "id", allCandidateIds).then((rows) =>
    rows.filter((p) => p.type === "plan" && p.status === "published")
  );

  const categoryIds = Array.from(new Set((candidatePlans ?? []).map((p) => p.parent_category_id as string | null).filter((id): id is string => !!id)));
  const { data: categories } = categoryIds.length
    ? await supabaseRead.from("p2p_curriculums").select("id,title,color_theme").in("id", categoryIds)
    : { data: [] as { id: string; title: string; color_theme: string | null }[] };
  const categoryById = new Map((categories ?? []).map((c) => [c.id as string, c]));

  const counts = await getPlanModuleLessonCounts(allCandidateIds);
  const progressMap = userId ? await getUserPlanProgressMap(userId) : null;
  const titleById = new Map((candidatePlans ?? []).map((p) => [p.id as string, p.title as string]));

  const qLower = q.toLowerCase();
  const results = (candidatePlans ?? []).map((p) => {
    const planId = p.id as string;
    const titleLower = (p.title as string).toLowerCase();
    const matchType: "exact" | "partial" | "content" = titleLower === qLower ? "exact" : titleMatchPlanIds.has(planId) ? "partial" : "content";
    const category = p.parent_category_id ? categoryById.get(p.parent_category_id as string) : null;
    const { locked, unlockMessage } = resolveLockStatus(p.unlock_after_plan_id as string | null, progressMap, titleById, p.manually_unlocked as boolean | undefined);
    return {
      id: planId,
      title: p.title,
      topicNumber: p.topic_number ?? null,
      categoryId: category?.id ?? null,
      categoryTitle: category?.title ?? null,
      categoryColorTheme: category?.color_theme ?? "#1D9E75",
      moduleCount: counts.moduleCountByPlan.get(planId) ?? 0,
      lessonCount: counts.lessonCountByPlan.get(planId) ?? 0,
      locked,
      unlockMessage,
      matchType,
    };
  });

  const matchRank = { exact: 0, partial: 1, content: 2 } as const;
  results.sort((a, b) => matchRank[a.matchType] - matchRank[b.matchType] || (a.title as string).localeCompare(b.title as string));

  return res.json(results.slice(0, 50));
});

// GET /plans/categories/:categoryId/plans — topic plans inside a category, ordered by topic_number
router.get("/plans/categories/:categoryId/plans", async (req, res) => {
  const { categoryId } = req.params;
  const userId = req.query.userId as string | undefined;
  const { data: plans, error } = await supabaseRead
    .from("p2p_curriculums")
    .select("*")
    .eq("type", "plan")
    .eq("status", "published")
    .eq("parent_category_id", categoryId)
    .order("topic_number", { ascending: true, nullsFirst: false });
  if (error) return res.status(500).json({ error: error.message });

  const planIds = (plans ?? []).map((p) => p.id as string);
  const counts = await getPlanModuleLessonCounts(planIds);
  const progressMap = userId ? await getUserPlanProgressMap(userId) : null;
  const titleById = new Map((plans ?? []).map((p) => [p.id as string, p.title as string]));

  return res.json(
    (plans ?? []).map((p) => {
      const { locked, unlockMessage } = resolveLockStatus(p.unlock_after_plan_id as string | null, progressMap, titleById, p.manually_unlocked as boolean | undefined);
      const progress = progressMap?.get(p.id as string);
      return {
        id: p.id,
        title: p.title,
        description: p.description ?? null,
        subtitle: p.subtitle ?? null,
        topicNumber: p.topic_number ?? null,
        moduleCount: counts.moduleCountByPlan.get(p.id as string) ?? 0,
        lessonCount: counts.lessonCountByPlan.get(p.id as string) ?? 0,
        difficultyLevel: p.difficulty_level ?? "beginner",
        estimatedWeeks: p.estimated_weeks ?? null,
        locked,
        unlockMessage,
        progressPercent: progress?.percent ?? 0,
      };
    })
  );
});

// GET /plans/:planId — a single plan with all modules and lessons. Pass
// ?userId= to get real lock enforcement — a locked plan returns 403 with
// enough info (previousPlanId/Title) to link back to its prerequisite,
// rather than the full plan body.
router.get("/plans/:planId", async (req, res) => {
  const { planId } = req.params;
  const userId = req.query.userId as string | undefined;
  const { data: plan } = await supabaseRead
    .from("p2p_curriculums")
    .select("*")
    .eq("id", planId)
    .eq("type", "plan")
    .maybeSingle();
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const unlockAfterId = plan.unlock_after_plan_id as string | null;
  if (unlockAfterId && !plan.manually_unlocked) {
    const progressMap = userId ? await getUserPlanProgressMap(userId) : null;
    const prereqComplete = progressMap ? planIsComplete(progressMap, unlockAfterId) : false;
    if (!prereqComplete) {
      const { data: prevPlan } = await supabaseRead.from("p2p_curriculums").select("id,title").eq("id", unlockAfterId).maybeSingle();
      return res.status(403).json({
        locked: true,
        title: plan.title,
        unlockMessage: prevPlan ? `Complete "${prevPlan.title}" to unlock this plan` : "Complete the previous plan to unlock this plan",
        previousPlanId: prevPlan?.id ?? null,
        previousPlanTitle: prevPlan?.title ?? null,
      });
    }
  }

  let categoryInfo: { id: string; title: string; colorTheme: string } | null = null;
  if (plan.parent_category_id) {
    const { data: category } = await supabaseRead
      .from("p2p_curriculums")
      .select("id,title,color_theme")
      .eq("id", plan.parent_category_id as string)
      .maybeSingle();
    if (category) categoryInfo = { id: category.id as string, title: category.title as string, colorTheme: (category.color_theme as string) ?? "#1D9E75" };
  }

  const { data: modules } = await supabaseRead
    .from("p2p_modules")
    .select("*")
    .eq("curriculum_id", planId)
    .order("order_index", { ascending: true });
  const moduleIds = (modules ?? []).map((m) => m.id as string);
  const { data: lessons } = moduleIds.length
    ? await supabaseRead
        .from("p2p_lessons")
        .select("id,module_id,title,subtitle,order_index,status")
        .in("module_id", moduleIds)
        .order("order_index", { ascending: true })
    : { data: [] as Record<string, unknown>[] };

  const lessonsByModule = new Map<string, ReturnType<typeof mapPlanLesson>[]>();
  for (const l of (lessons ?? []) as Record<string, unknown>[]) {
    const moduleId = l.module_id as string;
    const arr = lessonsByModule.get(moduleId) ?? [];
    arr.push(mapPlanLesson(l));
    lessonsByModule.set(moduleId, arr);
  }

  const mappedModules = (modules ?? []).map((m) => ({
    ...mapPlanModule(m as Record<string, unknown>),
    lessons: lessonsByModule.get(m.id as string) ?? [],
  }));
  const totalLessons = mappedModules.reduce((a, m) => a + m.lessons.length, 0);
  // modules is already ordered by order_index ascending, so its first
  // entry's image is the same "first module's image" fallback used in
  // GET /plans above.
  const fallbackImageUrl = (modules ?? [])[0]?.image_url as string | undefined ?? null;

  return res.json({
    ...mapPlan(plan as Record<string, unknown>, mappedModules.length, totalLessons, fallbackImageUrl),
    locked: false,
    topicNumber: plan.topic_number ?? null,
    category: categoryInfo,
    modules: mappedModules,
  });
});

// GET /plans/:planId/progress/:userId
router.get("/plans/:planId/progress/:userId", async (req, res) => {
  const { planId, userId } = req.params;

  const { data: modules } = await supabaseRead.from("p2p_modules").select("id").eq("curriculum_id", planId);
  const moduleIds = (modules ?? []).map((m) => m.id as string);
  if (!moduleIds.length) return res.json({ percent: 0, completedLessons: 0, totalLessons: 0, modules: [] });

  const lessons = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds);
  const lessonIds = lessons.map((l) => l.id as string);
  const progress = await selectInChunks<{ lesson_id: string; completed: boolean }>(
    "p2p_lesson_progress", "lesson_id,completed", "lesson_id", lessonIds,
    (q) => q.eq("user_id", userId)
  );

  const completedSet = new Set(progress.filter((p) => p.completed).map((p) => p.lesson_id as string));
  const lessonIdsByModule = new Map<string, string[]>();
  for (const l of (lessons ?? []) as Record<string, unknown>[]) {
    const moduleId = l.module_id as string;
    const arr = lessonIdsByModule.get(moduleId) ?? [];
    arr.push(l.id as string);
    lessonIdsByModule.set(moduleId, arr);
  }

  const moduleStatus = moduleIds.map((moduleId) => {
    const ids = lessonIdsByModule.get(moduleId) ?? [];
    const completedCount = ids.filter((id) => completedSet.has(id)).length;
    return { moduleId, lessonCount: ids.length, completedCount, isComplete: ids.length > 0 && completedCount === ids.length };
  });

  const totalLessons = lessonIds.length;
  const completedLessons = completedSet.size;
  const percent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return res.json({ percent, completedLessons, totalLessons, modules: moduleStatus });
});

// ── Saved / Active / Completed plans ──────────────────────────────────────────
// No requireAdmin/JWT here — same trust model GET /plans/:planId/progress/:userId
// above already uses in this file: userId is a trusted path/body param, not
// derived from a bearer token. The mobile client only ever calls these with
// the current signed-in user's own id.

// POST /plans/:planId/save — bookmark a plan for later
router.post("/plans/:planId/save", async (req, res) => {
  const { planId } = req.params;
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { error } = await supabaseRead
    .from("p2p_plan_saves")
    .upsert({ user_id: userId, plan_id: planId }, { onConflict: "user_id,plan_id", ignoreDuplicates: true });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ saved: true });
});

// DELETE /plans/:planId/save — remove a bookmark
router.delete("/plans/:planId/save", async (req, res) => {
  const { planId } = req.params;
  const userId = (req.query.userId as string) || (req.body as { userId?: string })?.userId;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { error } = await supabaseRead
    .from("p2p_plan_saves")
    .delete()
    .eq("user_id", userId)
    .eq("plan_id", planId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ saved: false });
});

// GET /plans/saved/:userId — bookmarked plans, most recently saved first
router.get("/plans/saved/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data: saves } = await supabaseRead
    .from("p2p_plan_saves")
    .select("plan_id,saved_at")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });
  const planIds = (saves ?? []).map((s) => s.plan_id as string);
  if (!planIds.length) return res.json([]);

  const plans = await selectInChunks<Record<string, unknown>>("p2p_curriculums", "*", "id", planIds);
  const savedAtByPlan = new Map((saves ?? []).map((s) => [s.plan_id as string, s.saved_at as string]));
  const counts = await getPlanModuleLessonCounts(planIds);

  const ordered = planIds
    .map((id) => (plans ?? []).find((p) => p.id === id))
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => ({
      ...mapPlan(p, counts.moduleCountByPlan.get(p.id as string) ?? 0, counts.lessonCountByPlan.get(p.id as string) ?? 0, counts.fallbackImageByPlan.get(p.id as string) ?? null),
      savedAt: savedAtByPlan.get(p.id as string) ?? null,
    }));
  return res.json(ordered);
});

// Shared helper: module/lesson counts + first-module cover image fallback for
// a set of plan ids — same computation GET /plans (list) already does, pulled
// out so the saved/active/completed endpoints below can reuse it.
async function getPlanModuleLessonCounts(planIds: string[]) {
  const moduleCountByPlan = new Map<string, number>();
  const lessonCountByPlan = new Map<string, number>();
  const fallbackImageByPlan = new Map<string, string>();
  const moduleToPlanId = new Map<string, string>();
  if (!planIds.length) return { moduleCountByPlan, lessonCountByPlan, fallbackImageByPlan, moduleToPlanId };

  const modules = await selectInChunks<{ id: string; curriculum_id: string; image_url: string | null; order_index: number }>(
    "p2p_modules", "id,curriculum_id,image_url,order_index", "curriculum_id", planIds
  );
  modules.sort((a, b) => a.order_index - b.order_index);
  for (const m of modules) {
    const planId = m.curriculum_id;
    moduleCountByPlan.set(planId, (moduleCountByPlan.get(planId) ?? 0) + 1);
    moduleToPlanId.set(m.id, planId);
    if (!fallbackImageByPlan.has(planId) && m.image_url) fallbackImageByPlan.set(planId, m.image_url);
  }
  const moduleIds = Array.from(moduleToPlanId.keys());
  const lessons = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds);
  for (const l of lessons) {
    const planId = moduleToPlanId.get(l.module_id);
    if (planId) lessonCountByPlan.set(planId, (lessonCountByPlan.get(planId) ?? 0) + 1);
  }
  return { moduleCountByPlan, lessonCountByPlan, fallbackImageByPlan, moduleToPlanId };
}

// Shared helper: per-plan completion percent + last lesson-progress activity
// timestamp for every published plan, for a given user. Same percent-complete
// math as GET /plans/:planId/progress/:userId, just computed across all plans
// in one pass instead of one plan at a time.
async function getUserPlanProgressMap(userId: string) {
  const { data: plans } = await supabaseRead.from("p2p_curriculums").select("id").eq("type", "plan").eq("status", "published");
  const planIds = (plans ?? []).map((p) => p.id as string);
  const result = new Map<string, { percent: number; completedLessons: number; totalLessons: number; lastActivityAt: string | null }>();
  if (!planIds.length) return result;

  const modules = await selectInChunks<{ id: string; curriculum_id: string }>("p2p_modules", "id,curriculum_id", "curriculum_id", planIds);
  const moduleToPlanId = new Map<string, string>();
  for (const m of modules) moduleToPlanId.set(m.id, m.curriculum_id);
  const moduleIds = Array.from(moduleToPlanId.keys());

  const lessons = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds);
  const lessonToPlanId = new Map<string, string>();
  const totalLessonsByPlan = new Map<string, number>();
  for (const l of lessons) {
    const planId = moduleToPlanId.get(l.module_id);
    if (!planId) continue;
    lessonToPlanId.set(l.id, planId);
    totalLessonsByPlan.set(planId, (totalLessonsByPlan.get(planId) ?? 0) + 1);
  }
  const lessonIds = Array.from(lessonToPlanId.keys());

  const progress: { lesson_id: string; completed: boolean; updated_at: string | null }[] = [];
  for (const c of chunkIds(lessonIds)) {
    const { data, error } = await supabaseRead
      .from("p2p_lesson_progress")
      .select("lesson_id,completed,updated_at")
      .eq("user_id", userId)
      .in("lesson_id", c);
    if (error) throw new Error(`p2p_lesson_progress IN chunk failed: ${error.message}`);
    progress.push(...((data ?? []) as { lesson_id: string; completed: boolean; updated_at: string | null }[]));
  }

  const completedByPlan = new Map<string, number>();
  const lastActivityByPlan = new Map<string, string>();
  for (const p of (progress ?? []) as Record<string, unknown>[]) {
    const planId = lessonToPlanId.get(p.lesson_id as string);
    if (!planId) continue;
    if (p.completed) completedByPlan.set(planId, (completedByPlan.get(planId) ?? 0) + 1);
    const updatedAt = p.updated_at as string | null;
    if (updatedAt && (!lastActivityByPlan.has(planId) || updatedAt > lastActivityByPlan.get(planId)!)) {
      lastActivityByPlan.set(planId, updatedAt);
    }
  }

  for (const planId of planIds) {
    const totalLessons = totalLessonsByPlan.get(planId) ?? 0;
    const completedLessons = completedByPlan.get(planId) ?? 0;
    const percent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
    result.set(planId, { percent, completedLessons, totalLessons, lastActivityAt: lastActivityByPlan.get(planId) ?? null });
  }
  return result;
}

// GET /plans/active/:userId — plans currently in progress (0% < percent < 100%),
// most recently active first
router.get("/plans/active/:userId", async (req, res) => {
  const { userId } = req.params;
  const progressMap = await getUserPlanProgressMap(userId);
  const activePlanIds = Array.from(progressMap.entries())
    .filter(([, p]) => p.completedLessons > 0 && p.percent < 100)
    .sort(([, a], [, b]) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .map(([planId]) => planId);
  if (!activePlanIds.length) return res.json([]);

  const plans = await selectInChunks<Record<string, unknown>>("p2p_curriculums", "*", "id", activePlanIds);
  const counts = await getPlanModuleLessonCounts(activePlanIds);
  const ordered = activePlanIds
    .map((id) => (plans ?? []).find((p) => p.id === id))
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => {
      const progress = progressMap.get(p.id as string)!;
      return {
        ...mapPlan(p, counts.moduleCountByPlan.get(p.id as string) ?? 0, counts.lessonCountByPlan.get(p.id as string) ?? 0, counts.fallbackImageByPlan.get(p.id as string) ?? null),
        progressPercent: progress.percent,
        lastActivityAt: progress.lastActivityAt,
      };
    });
  return res.json(ordered);
});

// GET /plans/completed/:userId — plans finished (100%)
router.get("/plans/completed/:userId", async (req, res) => {
  const { userId } = req.params;
  const progressMap = await getUserPlanProgressMap(userId);
  const completedPlanIds = Array.from(progressMap.entries())
    .filter(([, p]) => p.totalLessons > 0 && p.percent === 100)
    .sort(([, a], [, b]) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""))
    .map(([planId]) => planId);
  if (!completedPlanIds.length) return res.json([]);

  const plans = await selectInChunks<Record<string, unknown>>("p2p_curriculums", "*", "id", completedPlanIds);
  const counts = await getPlanModuleLessonCounts(completedPlanIds);
  const ordered = completedPlanIds
    .map((id) => (plans ?? []).find((p) => p.id === id))
    .filter((p): p is Record<string, unknown> => !!p)
    .map((p) => {
      const progress = progressMap.get(p.id as string)!;
      return {
        ...mapPlan(p, counts.moduleCountByPlan.get(p.id as string) ?? 0, counts.lessonCountByPlan.get(p.id as string) ?? 0, counts.fallbackImageByPlan.get(p.id as string) ?? null),
        completedAt: progress.lastActivityAt,
      };
    });
  return res.json(ordered);
});

// ── Recommendation engine ────────────────────────────────────────────────────
// Scoring weights. Goal/life-stage/life-situation/topic matching is done
// against plan.tags (and title/description as a broader fallback) since
// today's schema has no dedicated goal/life-stage taxonomy columns on
// p2p_curriculums — tags is the same freeform field the Plans hub's "Browse
// by Category" already treats as a loose taxonomy (see plans/index.tsx).
const REC_GOAL_WEIGHT = 10;
const REC_LIFE_STAGE_WEIGHT = 5;
const REC_LIFE_SITUATION_WEIGHT = 5;
const REC_TOPIC_WEIGHT = 4;
const REC_DURATION_WEIGHT = 3;
const REC_FORMAT_WEIGHT = 2;
const REC_FOUNDATION_WEIGHT = 1;
const REC_AGE_WEIGHT = 1;

// Learning format preference -> the same tag keywords formatBadgeFromTags()
// (plans/index.tsx) looks for, so "recommended format" scoring and the
// visible format badge stay in sync.
const FORMAT_PREFERENCE_TAGS: Record<string, string[]> = {
  peer_guide: ["peer-guide", "peer_guide"],
  group_circle: ["group", "group-circle"],
  solo: ["solo"],
};

// Age range -> difficulty nudge. There is no per-plan age-targeting metadata
// in this schema, so this is a deliberately soft, honest heuristic (younger
// ranges lean toward beginner content, older ranges toward more advanced) —
// it only ever adds a small amount of score, never filters anything out.
const AGE_RANGE_DIFFICULTY_HINT: Record<string, string> = {
  "13-17": "beginner",
  "18-24": "beginner",
  "55+": "advanced",
};

// Weekly time availability -> preferred plan length, for the duration-match signal.
const WEEKLY_TIME_TO_WEEKS: Record<string, (weeks: number | null) => boolean> = {
  under_1h: (w) => !!w && w <= 3,
  "1_2h": (w) => !!w && w >= 2 && w <= 6,
  "3_5h": (w) => !!w && w >= 4 && w <= 10,
  unlimited: () => true,
};

function textIncludesAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => n.trim() && h.includes(n.toLowerCase().trim()));
}

// GET /plans/recommended/:userId — top 6 scored recommendations with reasons
router.get("/plans/recommended/:userId", async (req, res) => {
  const { userId } = req.params;

  const [{ data: goalsRow }, progressMap] = await Promise.all([
    supabaseRead.from("p2p_user_goals").select("*").eq("user_id", userId).maybeSingle(),
    getUserPlanProgressMap(userId),
  ]);

  const { data: plans } = await supabaseRead.from("p2p_curriculums").select("*").eq("type", "plan").eq("status", "published");
  const candidates = (plans ?? []).filter((p) => {
    const progress = progressMap.get(p.id as string);
    if (!progress) return true;
    // Exclude anything already completed or currently in progress — this
    // feed is for discovering something new, not re-surfacing active work.
    // "Do Again" on a completed plan is a separate, explicit user action
    // from the Completed tab, not something the recommendation feed offers.
    return progress.totalLessons === 0 || (progress.percent < 100 && progress.completedLessons === 0);
  });

  const goals: string[] = (goalsRow?.goals as string[] | undefined) ?? [];
  const topicInterests: string[] = (goalsRow?.topic_interests as string[] | undefined) ?? [];
  const lifeStage: string | null = goalsRow?.life_stage ?? null;
  const lifeSituation: string | null = goalsRow?.life_situation ?? null;
  const weeklyTime: string | null = goalsRow?.weekly_time ?? null;
  const learningFormat: string | null = goalsRow?.learning_format ?? null;
  const ageRange: string | null = goalsRow?.age_range ?? null;
  const ageDifficultyHint = ageRange ? AGE_RANGE_DIFFICULTY_HINT[ageRange] ?? null : null;
  const foundationDifficulty = (() => {
    // Low-weight signal: someone deep into the Foundation core curriculum is
    // nudged toward intermediate/advanced electives; someone just starting
    // is nudged toward beginner ones. Best-effort, not a hard filter.
    const completedFoundationModules = Array.from(progressMap.values()).filter((p) => p.percent === 100).length;
    return completedFoundationModules >= 6 ? "advanced" : completedFoundationModules >= 2 ? "intermediate" : "beginner";
  })();

  const scored = candidates.map((p) => {
    const record = p as Record<string, unknown>;
    const tags = ((record.tags as string[]) ?? []).map((t) => t.toLowerCase());
    const searchable = [record.title as string, record.description as string, ...tags].filter(Boolean).join(" ");
    let score = 0;
    const matchedReasons: { weight: number; text: string }[] = [];

    if (goals.length && textIncludesAny(searchable, goals)) {
      score += REC_GOAL_WEIGHT;
      matchedReasons.push({ weight: REC_GOAL_WEIGHT, text: "Matches your goals" });
    }
    if (lifeStage && textIncludesAny(searchable, [lifeStage.replace(/_/g, " ")])) {
      score += REC_LIFE_STAGE_WEIGHT;
      matchedReasons.push({ weight: REC_LIFE_STAGE_WEIGHT, text: "Great for your life stage" });
    }
    if (lifeSituation && textIncludesAny(searchable, [lifeSituation.replace(/_/g, " ")])) {
      score += REC_LIFE_SITUATION_WEIGHT;
      matchedReasons.push({ weight: REC_LIFE_SITUATION_WEIGHT, text: "Popular with people in similar situations" });
    }
    if (topicInterests.length && textIncludesAny(searchable, topicInterests)) {
      score += REC_TOPIC_WEIGHT;
      matchedReasons.push({ weight: REC_TOPIC_WEIGHT, text: "Matches your interests" });
    }
    if (weeklyTime && WEEKLY_TIME_TO_WEEKS[weeklyTime]?.(record.estimated_weeks as number | null)) {
      score += REC_DURATION_WEIGHT;
      matchedReasons.push({ weight: REC_DURATION_WEIGHT, text: "Fits the time you have each week" });
    }
    if (record.difficulty_level === foundationDifficulty) {
      score += REC_FOUNDATION_WEIGHT;
      matchedReasons.push({ weight: REC_FOUNDATION_WEIGHT, text: "A good next step for where you are" });
    }
    const formatMatches = learningFormat && FORMAT_PREFERENCE_TAGS[learningFormat]
      ? FORMAT_PREFERENCE_TAGS[learningFormat].some((tag) => tags.includes(tag))
      : false;
    if (formatMatches) {
      score += REC_FORMAT_WEIGHT;
      matchedReasons.push({ weight: REC_FORMAT_WEIGHT, text: "Matches how you like to learn" });
    }
    // Age range never filters anything — it only ever nudges score slightly
    // toward a difficulty level, per Prompt 6 ("low weight... never filters").
    if (ageDifficultyHint && record.difficulty_level === ageDifficultyHint) {
      score += REC_AGE_WEIGHT;
    }
    if (record.is_featured) score += 0.5; // tie-breaker only, matches the featured-placeholder used before goals exist

    const bestReason = matchedReasons.sort((a, b) => b.weight - a.weight)[0];
    return { plan: record, score, reason: bestReason?.text ?? "Featured on Kingdom School", matchesPreferredFormat: formatMatches };
  });

  const top6 = scored
    .filter((s) => s.score > 0 || !goalsRow) // if no goals set yet, fall back to featured/all order below
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const planIds = top6.map((s) => s.plan.id as string);
  const counts = await getPlanModuleLessonCounts(planIds);
  const result = top6.map((s) => ({
    ...mapPlan(s.plan, counts.moduleCountByPlan.get(s.plan.id as string) ?? 0, counts.lessonCountByPlan.get(s.plan.id as string) ?? 0, counts.fallbackImageByPlan.get(s.plan.id as string) ?? null),
    matchReason: s.reason,
    matchesPreferredFormat: s.matchesPreferredFormat,
  }));
  return res.json(result);
});

// ── Admin: Plans CRUD ──────────────────────────────────────────────────────────

const PLAN_FIELD_MAP: Record<string, string> = {
  title: "title", description: "description", subtitle: "subtitle",
  coverImageUrl: "cover_image", thumbnailUrl: "thumbnail_url", colorTheme: "color_theme",
  tags: "tags", isFeatured: "is_featured", difficultyLevel: "difficulty_level",
  estimatedWeeks: "estimated_weeks", teachingCreditName: "teaching_credit_name",
  teachingCreditRole: "teaching_credit_role", teachingCreditChurch: "teaching_credit_church",
  teachingCreditLocation: "teaching_credit_location", teachingCreditYoutube: "teaching_credit_youtube",
  teachingCreditInstagram: "teaching_credit_instagram", status: "status", displayOrder: "display_order",
};

// Admin writes use supabaseRead (service-role, despite the name — same
// client already used for reads above) rather than the plain anon-key
// `supabase` import: p2p_curriculums/p2p_modules/p2p_lessons RLS write
// policies require auth.uid() to satisfy p2p_is_admin(), which an anon-key
// client with no forwarded user session can never do — same fix already
// applied to translationEngine.ts/translations.ts for the same reason.

// POST /admin/plans — create
router.post("/admin/plans", requireAdmin, async (req, res) => {
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title || !title.trim()) return res.status(400).json({ error: "title is required" });

  const { data, error } = await supabaseRead
    .from("p2p_curriculums")
    .insert({ title: title.trim(), description: description?.trim() || null, type: "plan", status: "draft" })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(mapPlan(data as Record<string, unknown>));
});

// PUT /admin/plans/:planId — update (any field, including teaching credit)
router.put("/admin/plans/:planId", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const body = req.body as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(PLAN_FIELD_MAP)) {
    if (body[field] !== undefined) update[column] = body[field];
  }
  if (!Object.keys(update).length) return res.status(400).json({ error: "No fields to update" });

  const { data, error } = await supabaseRead
    .from("p2p_curriculums")
    .update(update)
    .eq("id", planId)
    .eq("type", "plan")
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(mapPlan(data as Record<string, unknown>));
});

// DELETE /admin/plans/:planId — soft delete (status='archived'), never hard delete
router.delete("/admin/plans/:planId", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { error } = await supabaseRead
    .from("p2p_curriculums")
    .update({ status: "archived" })
    .eq("id", planId)
    .eq("type", "plan");
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ archived: true });
});

// POST /admin/plans/:planId/modules — add a module to a plan
router.post("/admin/plans/:planId/modules", requireAdmin, async (req, res) => {
  const { planId } = req.params;
  const { title, description } = req.body as { title?: string; description?: string };
  if (!title || !title.trim()) return res.status(400).json({ error: "title is required" });

  const { data: sibs } = await supabaseRead.from("p2p_modules").select("order_index").eq("curriculum_id", planId);
  const orderIndex = (sibs ?? []).length ? Math.max(...(sibs as { order_index: number }[]).map((s) => s.order_index)) + 1 : 0;

  const { data, error } = await supabaseRead
    .from("p2p_modules")
    .insert({ curriculum_id: planId, title: title.trim(), description: description?.trim() || null, status: "draft", order_index: orderIndex })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(mapPlanModule(data as Record<string, unknown>));
});

// POST /admin/plans/:planId/modules/:moduleId/lessons — add a lesson
router.post("/admin/plans/:planId/modules/:moduleId/lessons", requireAdmin, async (req, res) => {
  const { moduleId } = req.params;
  const { title } = req.body as { title?: string };
  if (!title || !title.trim()) return res.status(400).json({ error: "title is required" });

  const { data: sibs } = await supabaseRead.from("p2p_lessons").select("order_index").eq("module_id", moduleId);
  const orderIndex = (sibs ?? []).length ? Math.max(...(sibs as { order_index: number }[]).map((s) => s.order_index)) + 1 : 0;

  const { data, error } = await supabaseRead
    .from("p2p_lessons")
    .insert({ module_id: moduleId, title: title.trim(), status: "draft", order_index: orderIndex })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(mapPlanLesson(data as Record<string, unknown>));
});

export default router;
