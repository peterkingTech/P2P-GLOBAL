import { Router } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { computeReportStats } from "../lib/adminReports";
import { parsePlanPdf, type ParsedLesson, type ParsedPlan } from "../lib/planPdfParser";
import { validateUsername, formatUsername } from "../lib/username";

const router = Router();

// All admin routes require an authenticated peer_guide, church_leader, regional_admin, moderator, or super_admin
router.use(requireAdmin);

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res: any, data: unknown) { return res.json(data); }
function err(res: any, msg: string, status = 500) {
  return res.status(status).json({ error: msg });
}

// ── Languages ─────────────────────────────────────────────────────────────────

router.get("/languages", async (_req, res) => {
  const { data, error } = await supabase
    .from("p2p_languages")
    .select("*")
    .order("name");
  if (error) return err(res, error.message);
  return ok(res, data ?? []);
});

// ── Full Tree ─────────────────────────────────────────────────────────────────
// Returns all curricula > modules > lessons (regardless of status)

router.get("/tree", async (_req, res) => {
  const [
    { data: curricula, error: cErr },
    { data: modules, error: mErr },
    { data: lessons, error: lErr },
  ] = await Promise.all([
    supabase.from("p2p_curriculums").select("*").order("created_at"),
    supabase.from("p2p_modules").select("*").order("order_index"),
    supabase.from("p2p_lessons").select("id,module_id,title,subtitle,status,order_index").order("order_index"),
  ]);
  if (cErr || mErr || lErr) return err(res, (cErr ?? mErr ?? lErr)!.message);

  const modulesMap: Record<string, any[]> = {};
  for (const m of (modules ?? []) as any[]) {
    const cid = m.curriculum_id ?? "__none__";
    (modulesMap[cid] ??= []).push({ ...m, lessons: [] });
  }

  const lessonsMap: Record<string, any[]> = {};
  for (const l of (lessons ?? []) as any[]) {
    const mid = l.module_id ?? "__none__";
    (lessonsMap[mid] ??= []).push(l);
  }
  // attach lessons to modules
  for (const arr of Object.values(modulesMap)) {
    for (const m of arr) m.lessons = lessonsMap[m.id] ?? [];
  }

  const tree = ((curricula ?? []) as any[]).map((c) => ({
    ...c,
    modules: modulesMap[c.id] ?? [],
  }));

  return ok(res, tree);
});

// ── Translation Coverage ──────────────────────────────────────────────────────

router.get("/lesson/:id/translation-coverage", async (req, res) => {
  const { id } = req.params;
  const { data: langs } = await supabase.from("p2p_languages").select("code");
  const total = (langs ?? []).length;

  // Check new unified table first, then legacy table
  const [{ data: newTrans }, { data: legacyTrans }] = await Promise.all([
    supabase
      .from("p2p_content_translations")
      .select("language_code")
      .eq("content_type", "lesson")
      .eq("content_id", id),
    supabase
      .from("p2p_lesson_translations")
      .select("language_code")
      .eq("lesson_id", id),
  ]);

  const done = new Set([
    ...(newTrans ?? []).map((t: any) => t.language_code),
    ...(legacyTrans ?? []).map((t: any) => t.language_code),
  ]).size;

  return ok(res, { total, done, label: `${done} of ${total} languages` });
});

// ── Curriculum CRUD ───────────────────────────────────────────────────────────

router.post("/curriculum", async (req, res) => {
  const { title, description, status = "draft" } = req.body;
  if (!title?.trim()) return err(res, "Title is required", 400);
  const { data, error } = await supabase
    .from("p2p_curriculums")
    .insert({ title: title.trim(), description, status })
    .select()
    .single();
  if (error) return err(res, error.message);
  return res.status(201).json(data);
});

router.put("/curriculum/:id", async (req, res) => {
  const { title, description, status } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  const { data, error } = await supabase
    .from("p2p_curriculums")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

router.delete("/curriculum/:id", async (req, res) => {
  const { error } = await supabase.from("p2p_curriculums").delete().eq("id", req.params.id);
  if (error) return err(res, error.message);
  return res.status(204).send();
});

// ── Module CRUD ───────────────────────────────────────────────────────────────

router.post("/module", async (req, res) => {
  const { curriculum_id, title, description, status = "draft", sort_order = 0 } = req.body;
  if (!title?.trim()) return err(res, "Title is required", 400);
  if (!curriculum_id) return err(res, "curriculum_id is required", 400);
  const { data, error } = await supabase
    .from("p2p_modules")
    .insert({ curriculum_id, title: title.trim(), description, status, sort_order })
    .select()
    .single();
  if (error) return err(res, error.message);
  return res.status(201).json(data);
});

router.put("/module/:id", async (req, res) => {
  const { title, description, status, sort_order, curriculum_id } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (status !== undefined) updates.status = status;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (curriculum_id !== undefined) updates.curriculum_id = curriculum_id;
  const { data, error } = await supabase
    .from("p2p_modules")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

router.delete("/module/:id", async (req, res) => {
  const { error } = await supabase.from("p2p_modules").delete().eq("id", req.params.id);
  if (error) return err(res, error.message);
  return res.status(204).send();
});

// Reorder module — PATCH /admin/module/:id/reorder { sort_order }
router.patch("/module/:id/reorder", async (req, res) => {
  const { sort_order } = req.body;
  const { data, error } = await supabase
    .from("p2p_modules")
    .update({ sort_order })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

// ── Lesson CRUD ───────────────────────────────────────────────────────────────

router.post("/lesson", async (req, res) => {
  const { module_id, title, subtitle, status = "draft", sort_order = 0 } = req.body;
  if (!title?.trim()) return err(res, "Title is required", 400);
  if (!module_id) return err(res, "module_id is required", 400);
  const { data, error } = await supabase
    .from("p2p_lessons")
    .insert({ module_id, title: title.trim(), subtitle, status, sort_order })
    .select()
    .single();
  if (error) return err(res, error.message);
  return res.status(201).json(data);
});

router.put("/lesson/:id", async (req, res) => {
  const { title, subtitle, status, sort_order, module_id } = req.body;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (subtitle !== undefined) updates.subtitle = subtitle;
  if (status !== undefined) updates.status = status;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (module_id !== undefined) updates.module_id = module_id;
  const { data, error } = await supabase
    .from("p2p_lessons")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

router.delete("/lesson/:id", async (req, res) => {
  const { error } = await supabase.from("p2p_lessons").delete().eq("id", req.params.id);
  if (error) return err(res, error.message);
  return res.status(204).send();
});

router.patch("/lesson/:id/reorder", async (req, res) => {
  const { sort_order } = req.body;
  const { data, error } = await supabase
    .from("p2p_lessons")
    .update({ sort_order })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

// ── Lesson Content (sections / scriptures / questions / assignments) ───────────

router.get("/lesson/:id/content", async (req, res) => {
  const { id } = req.params;
  const [
    { data: sections },
    { data: scriptures },
    { data: questions },
    { data: assignments },
  ] = await Promise.all([
    supabase.from("p2p_lesson_sections").select("*").eq("lesson_id", id).order("sort_order"),
    supabase.from("p2p_scriptures").select("*").eq("lesson_id", id).order("sort_order"),
    supabase.from("p2p_reflection_questions").select("*").eq("lesson_id", id).order("sort_order"),
    supabase.from("p2p_assignments").select("*").eq("lesson_id", id).order("sort_order"),
  ]);
  return ok(res, {
    sections: sections ?? [],
    scriptures: scriptures ?? [],
    questions: questions ?? [],
    assignments: assignments ?? [],
  });
});

// PUT /admin/lesson/:id/content — full upsert of all content
router.put("/lesson/:id/content", async (req, res) => {
  const { id } = req.params;
  const { sections = [], scriptures = [], questions = [], assignments = [] } = req.body;

  try {
    // Sections: delete existing then re-insert
    await supabase.from("p2p_lesson_sections").delete().eq("lesson_id", id);
    if (sections.length) {
      const rows = sections.map((s: any, i: number) => ({
        id: s.id ?? undefined,
        lesson_id: id,
        title: s.title ?? null,
        content: s.content ?? "",
        sort_order: i,
      }));
      await supabase.from("p2p_lesson_sections").upsert(rows);
    }

    await supabase.from("p2p_scriptures").delete().eq("lesson_id", id);
    if (scriptures.length) {
      const rows = scriptures.map((s: any, i: number) => ({
        id: s.id ?? undefined,
        lesson_id: id,
        verse_ref: s.verse_ref ?? "",
        verse_text: s.verse_text ?? "",
        sort_order: i,
      }));
      await supabase.from("p2p_scriptures").upsert(rows);
    }

    await supabase.from("p2p_reflection_questions").delete().eq("lesson_id", id);
    if (questions.length) {
      const rows = questions.map((q: any, i: number) => ({
        id: q.id ?? undefined,
        lesson_id: id,
        question: q.question ?? "",
        sort_order: i,
      }));
      await supabase.from("p2p_reflection_questions").upsert(rows);
    }

    await supabase.from("p2p_assignments").delete().eq("lesson_id", id);
    if (assignments.length) {
      const rows = assignments.map((a: any, i: number) => ({
        id: a.id ?? undefined,
        lesson_id: id,
        title: a.title ?? "",
        instructions: a.instructions ?? "",
        sort_order: i,
      }));
      await supabase.from("p2p_assignments").upsert(rows);
    }

    return ok(res, { ok: true });
  } catch (e: any) {
    return err(res, e.message ?? "Failed to save content");
  }
});

// ── Lesson Translations ───────────────────────────────────────────────────────

// GET /admin/lesson/:id/translations/:lang
router.get("/lesson/:id/translations/:lang", async (req, res) => {
  const { id, lang } = req.params;
  const [
    { data: lessonTrans },
    { data: sections },
    { data: scriptures },
    { data: questions },
    // Get IDs first then fetch translations
  ] = await Promise.all([
    supabase.from("p2p_lesson_translations").select("*").eq("lesson_id", id).eq("language_code", lang).maybeSingle(),
    supabase.from("p2p_lesson_sections").select("id,title,content,sort_order").eq("lesson_id", id).order("sort_order"),
    supabase.from("p2p_scriptures").select("id,verse_ref,verse_text,sort_order").eq("lesson_id", id).order("sort_order"),
    supabase.from("p2p_reflection_questions").select("id,question,sort_order").eq("lesson_id", id).order("sort_order"),
  ]);

  // Fetch translation rows for each content item
  const sectionIds = (sections ?? []).map((s: any) => s.id);
  const scriptureIds = (scriptures ?? []).map((s: any) => s.id);
  const questionIds = (questions ?? []).map((q: any) => q.id);

  const [{ data: strans }, { data: scrtrans }, { data: qtrans }] = await Promise.all([
    sectionIds.length
      ? supabase.from("p2p_lesson_section_translations").select("*").in("section_id", sectionIds).eq("language_code", lang)
      : Promise.resolve({ data: [] }),
    scriptureIds.length
      ? supabase.from("p2p_scripture_translations").select("*").in("scripture_id", scriptureIds).eq("language_code", lang)
      : Promise.resolve({ data: [] }),
    questionIds.length
      ? supabase.from("p2p_reflection_question_translations").select("*").in("question_id", questionIds).eq("language_code", lang)
      : Promise.resolve({ data: [] }),
  ]);

  const stMap = Object.fromEntries((strans ?? []).map((t: any) => [t.section_id, t]));
  const scrMap = Object.fromEntries((scrtrans ?? []).map((t: any) => [t.scripture_id, t]));
  const qMap = Object.fromEntries((qtrans ?? []).map((t: any) => [t.question_id, t]));

  return ok(res, {
    lesson: lessonTrans ?? null,
    sections: (sections ?? []).map((s: any) => ({
      ...s,
      translation: stMap[s.id] ?? null,
    })),
    scriptures: (scriptures ?? []).map((s: any) => ({
      ...s,
      translation: scrMap[s.id] ?? null,
    })),
    questions: (questions ?? []).map((q: any) => ({
      ...q,
      translation: qMap[q.id] ?? null,
    })),
  });
});

// PUT /admin/lesson/:id/translations/:lang — upsert all translations at once
router.put("/lesson/:id/translations/:lang", async (req, res) => {
  const { id, lang } = req.params;
  const { lesson, sections = [], scriptures = [], questions = [] } = req.body;

  try {
    if (lesson) {
      await supabase.from("p2p_lesson_translations").upsert({
        lesson_id: id,
        language_code: lang,
        title: lesson.title ?? "",
        subtitle: lesson.subtitle ?? null,
      }, { onConflict: "lesson_id,language_code" });
    }

    for (const s of sections) {
      if (!s.id) continue;
      await supabase.from("p2p_lesson_section_translations").upsert({
        section_id: s.id,
        language_code: lang,
        title: s.title ?? null,
        content: s.content ?? "",
      }, { onConflict: "section_id,language_code" });
    }

    for (const s of scriptures) {
      if (!s.id) continue;
      await supabase.from("p2p_scripture_translations").upsert({
        scripture_id: s.id,
        language_code: lang,
        verse: s.verse ?? "",
      }, { onConflict: "scripture_id,language_code" });
    }

    for (const q of questions) {
      if (!q.id) continue;
      await supabase.from("p2p_reflection_question_translations").upsert({
        question_id: q.id,
        language_code: lang,
        question: q.question ?? "",
      }, { onConflict: "question_id,language_code" });
    }

    return ok(res, { ok: true });
  } catch (e: any) {
    return err(res, e.message ?? "Failed to save translations");
  }
});

// ── Registrations ─────────────────────────────────────────────────────────────

router.get("/registrations", async (req, res) => {
  const { status, search, page = "1" } = req.query as Record<string, string>;
  const pageNum = Math.max(1, parseInt(page, 10));
  const pageSize = 20;

  let query = supabase
    .from("p2p_registration_profiles")
    .select("id,full_name,email,location_city,location_country,faith_journey_stage,follow_up_status,submitted_at")
    .order("submitted_at", { ascending: false })
    .range((pageNum - 1) * pageSize, pageNum * pageSize - 1);

  if (status && status !== "all") query = query.eq("follow_up_status", status);
  if (search) query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return err(res, error.message);
  return ok(res, data ?? []);
});

router.get("/registrations/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("p2p_registration_profiles")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error) return err(res, error.message, 404);
  return ok(res, data);
});

router.patch("/registrations/:id", async (req, res) => {
  const { follow_up_status, admin_notes } = req.body;
  const updates: Record<string, unknown> = {};
  if (follow_up_status !== undefined) updates.follow_up_status = follow_up_status;
  if (admin_notes !== undefined) updates.admin_notes = admin_notes;
  const { data, error } = await supabase
    .from("p2p_registration_profiles")
    .update(updates)
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) return err(res, error.message);
  return ok(res, data);
});

// ── PDF Plan Importer ───────────────────────────────────────────────────────

// p2p_curriculums/p2p_modules/p2p_lessons (and the lesson-content tables
// below) RLS write policies require auth.uid() to satisfy p2p_is_admin() —
// same fix already applied in curriculum.ts/translationEngine.ts — so writes
// here use a service-role client, not the anon-key `supabase` import above.
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Same 10-category slug->color mapping used by the one-off 144-plan bulk
// import script, kept in sync so plans imported either way look consistent.
const CATEGORY_COLORS: Record<string, string> = {
  faith_kingdom: "#1D4E2B",
  ministry_leadership: "#2C3E6B",
  spiritual_growth: "#1D9E75",
  family_relationships: "#8B4513",
  identity_salvation: "#4B0082",
  marketplace_purpose: "#B8860B",
  prayer: "#1A237E",
  holy_spirit: "#4A90D9",
  healing_freedom: "#C0392B",
  church_community: "#2E7D32",
};

// POST /admin/plans/upload-pdf — parse only, no writes. Lets the admin
// preview (and edit) the extracted structure before anything is inserted.
router.post("/plans/upload-pdf", upload.single("pdf"), async (req, res) => {
  if (!req.file) return err(res, "No file uploaded (expected field name 'pdf')", 400);
  try {
    const plan = await parsePlanPdf(req.file.buffer, req.file.originalname);
    return ok(res, plan);
  } catch (e) {
    return err(res, e instanceof Error ? e.message : "Failed to parse PDF", 400);
  }
});

function splitMemoryVerse(combined: string): { reference: string; text: string } {
  const m = /^"([\s\S]*)"\s*—\s*(.*)$/.exec(combined.trim());
  if (m) return { text: m[1].trim(), reference: m[2].trim() };
  return { text: combined.trim(), reference: "" };
}

type NewBlock = {
  lesson_id: string;
  block_type: string;
  content: Record<string, unknown>;
  order_index: number;
  is_required: boolean;
  is_submittable: boolean;
};

// Builds both the p2p_lesson_blocks rows (read exclusively by the admin
// Block Editor) and the p2p_lesson_sections/p2p_scriptures/
// p2p_reflection_questions/p2p_assignments(+questions) rows (read
// exclusively by the real learner-facing lesson screen) from one parsed
// lesson — these are two disconnected systems in this codebase, so an
// imported plan needs both populated to be functional in either place.
function buildLessonBlocks(lessonId: string, lesson: ParsedLesson): NewBlock[] {
  const blocks: NewBlock[] = [];
  let order = 0;

  if (lesson.memoryVerse.trim()) {
    const { reference, text } = splitMemoryVerse(lesson.memoryVerse);
    blocks.push({
      lesson_id: lessonId,
      block_type: "memory_verse",
      content: { reference, text, translation: "" },
      order_index: order++,
      is_required: true,
      is_submittable: false,
    });
  }

  if (lesson.content.trim()) {
    blocks.push({
      lesson_id: lessonId,
      block_type: "paragraph",
      content: { text: lesson.content.trim() },
      order_index: order++,
      is_required: false,
      is_submittable: false,
    });
  }

  const questions = lesson.discussionQuestions.split("\n").map((q) => q.trim()).filter(Boolean);
  for (const question of questions) {
    blocks.push({
      lesson_id: lessonId,
      block_type: "reflection_question",
      content: { question },
      order_index: order++,
      is_required: true,
      is_submittable: true,
    });
  }

  const assignmentItems = lesson.lifeAssignment.split("\n").map((a) => a.trim()).filter(Boolean);
  if (assignmentItems.length) {
    blocks.push({
      lesson_id: lessonId,
      block_type: "assignment",
      content: {
        title: "Life Application",
        instructions: "",
        due_after_days: 7,
        questions: assignmentItems.map((question) => ({ question })),
      },
      order_index: order++,
      is_required: true,
      is_submittable: true,
    });
  }

  if (lesson.checkpoint.trim()) {
    blocks.push({
      lesson_id: lessonId,
      block_type: "checkpoint",
      content: { text: lesson.checkpoint.trim() },
      order_index: order++,
      is_required: false,
      is_submittable: false,
    });
  }

  return blocks;
}

// Cleans up everything created so far for a partially-imported plan — same
// try/track/cleanup-on-failure pattern used by the 144-plan bulk import
// script. FK cascades from p2p_lessons downward are not guaranteed here, so
// each table is cleared explicitly.
async function rollbackImport(curriculumId: string, lessonIds: string[], assignmentIds: string[]) {
  if (assignmentIds.length) {
    await supabaseWrite.from("p2p_assignment_questions").delete().in("assignment_id", assignmentIds);
  }
  if (lessonIds.length) {
    await supabaseWrite.from("p2p_lesson_blocks").delete().in("lesson_id", lessonIds);
    await supabaseWrite.from("p2p_assignments").delete().in("lesson_id", lessonIds);
    await supabaseWrite.from("p2p_reflection_questions").delete().in("lesson_id", lessonIds);
    await supabaseWrite.from("p2p_scriptures").delete().in("lesson_id", lessonIds);
    await supabaseWrite.from("p2p_lesson_sections").delete().in("lesson_id", lessonIds);
    await supabaseWrite.from("p2p_lessons").delete().in("id", lessonIds);
  }
  await supabaseWrite.from("p2p_modules").delete().eq("curriculum_id", curriculumId);
  await supabaseWrite.from("p2p_curriculums").delete().eq("id", curriculumId);
}

// POST /admin/plans/confirm-import — actually inserts the (possibly
// admin-edited) parsed plan as a draft.
router.post("/plans/confirm-import", async (req, res) => {
  const plan = req.body as ParsedPlan & { parentCategoryId?: string | null; topicNumber?: number | null };
  const title = plan?.title?.trim();
  if (!title) return err(res, "title is required", 400);
  if (!Array.isArray(plan.modules) || plan.modules.length === 0) {
    return err(res, "At least one module is required", 400);
  }

  const { data: existing, error: dupErr } = await supabaseWrite
    .from("p2p_curriculums")
    .select("id")
    .eq("type", "plan")
    .eq("title", title)
    .maybeSingle();
  if (dupErr) return err(res, dupErr.message);
  if (existing) return err(res, `A plan titled "${title}" already exists`, 409);

  const colorTheme = CATEGORY_COLORS[plan.category] ?? "#1D9E75";
  const description = plan.lectureIntro?.trim()
    ? [plan.description?.trim(), plan.lectureIntro.trim()].filter(Boolean).join("\n\n")
    : plan.description?.trim() || null;

  const { data: curriculum, error: curErr } = await supabaseWrite
    .from("p2p_curriculums")
    .insert({
      title,
      description,
      subtitle: plan.subtitle?.trim() || null,
      type: "plan",
      status: "draft",
      tags: plan.category ? [plan.category] : [],
      color_theme: colorTheme,
      parent_category_id: plan.parentCategoryId ?? null,
      topic_number: plan.topicNumber ?? null,
    })
    .select()
    .single();
  if (curErr || !curriculum) return err(res, curErr?.message ?? "Failed to create plan");

  const curriculumId = curriculum.id as string;
  const createdLessonIds: string[] = [];
  const createdAssignmentIds: string[] = [];

  try {
    for (const [modIdx, mod] of plan.modules.entries()) {
      const { data: moduleRow, error: modErr } = await supabaseWrite
        .from("p2p_modules")
        .insert({ curriculum_id: curriculumId, title: mod.title, status: "draft", order_index: mod.orderIndex ?? modIdx })
        .select()
        .single();
      if (modErr || !moduleRow) throw new Error(modErr?.message ?? `Failed to create module "${mod.title}"`);

      for (const [lesIdx, lesson] of mod.lessons.entries()) {
        const { data: lessonRow, error: lesErr } = await supabaseWrite
          .from("p2p_lessons")
          .insert({ module_id: moduleRow.id, title: lesson.title, status: "draft", order_index: lesson.orderIndex ?? lesIdx })
          .select()
          .single();
        if (lesErr || !lessonRow) throw new Error(lesErr?.message ?? `Failed to create lesson "${lesson.title}"`);
        const lessonId = lessonRow.id as string;
        createdLessonIds.push(lessonId);

        // Real learner-facing content tables.
        if (lesson.content.trim()) {
          const { error } = await supabaseWrite
            .from("p2p_lesson_sections")
            .insert({ lesson_id: lessonId, section_order: 1, section_type: "teaching", title: null, content: lesson.content.trim() });
          if (error) throw new Error(error.message);
        }
        if (lesson.memoryVerse.trim()) {
          const { reference, text } = splitMemoryVerse(lesson.memoryVerse);
          const { error } = await supabaseWrite
            .from("p2p_scriptures")
            .insert({ lesson_id: lessonId, reference, verse: text, display_order: 1 });
          if (error) throw new Error(error.message);
        }
        const questions = lesson.discussionQuestions.split("\n").map((q) => q.trim()).filter(Boolean);
        if (questions.length) {
          const { error } = await supabaseWrite
            .from("p2p_reflection_questions")
            .insert(questions.map((question, i) => ({ lesson_id: lessonId, question, display_order: i + 1 })));
          if (error) throw new Error(error.message);
        }
        const assignmentItems = lesson.lifeAssignment.split("\n").map((a) => a.trim()).filter(Boolean);
        if (assignmentItems.length) {
          const { data: assignmentRow, error: asnErr } = await supabaseWrite
            .from("p2p_assignments")
            .insert({ lesson_id: lessonId, title: "Life Application", instructions: "", due_after_days: 7 })
            .select()
            .single();
          if (asnErr || !assignmentRow) throw new Error(asnErr?.message ?? "Failed to create assignment");
          createdAssignmentIds.push(assignmentRow.id as string);
          const { error: aqErr } = await supabaseWrite
            .from("p2p_assignment_questions")
            .insert(assignmentItems.map((question, i) => ({ assignment_id: assignmentRow.id, question, display_order: i + 1 })));
          if (aqErr) throw new Error(aqErr.message);
        }

        // Admin Block Editor's content system.
        const blocks = buildLessonBlocks(lessonId, lesson);
        if (blocks.length) {
          const { error } = await supabaseWrite.from("p2p_lesson_blocks").insert(blocks);
          if (error) throw new Error(error.message);
        }
      }
    }
  } catch (e) {
    await rollbackImport(curriculumId, createdLessonIds, createdAssignmentIds);
    return err(res, e instanceof Error ? e.message : "Import failed, changes rolled back");
  }

  return ok(res, { id: curriculumId });
});

// ── Plan Category Management ─────────────────────────────────────────────────
// Same URL-length reasoning as curriculum.ts's selectInChunks (see that file's
// comment) — chunk any .in() call whose id list scales with catalog size.
const ADMIN_IN_CHUNK_SIZE = 100;
function chunkIdsAdmin(ids: string[], size = ADMIN_IN_CHUNK_SIZE): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}
async function selectInChunksAdmin<T = Record<string, unknown>>(table: string, columns: string, column: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return [];
  const results: T[] = [];
  for (const c of chunkIdsAdmin(ids)) {
    const { data, error } = await supabaseWrite.from(table).select(columns).in(column, c);
    if (error) throw new Error(`${table}.${column} IN chunk failed: ${error.message}`);
    results.push(...((data ?? []) as T[]));
  }
  return results;
}

function slugifyCategoryTitle(title: string): string {
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function mapAdminCategory(c: Record<string, unknown>, planCount: number) {
  return {
    id: c.id,
    title: c.title,
    description: c.description ?? null,
    category: (c.tags as string[] | null)?.[0] ?? null,
    colorTheme: c.color_theme ?? "#1D9E75",
    icon: c.icon ?? null,
    displayOrder: c.display_order ?? null,
    planCount,
    status: c.status,
    isVisible: c.is_visible ?? true,
  };
}

function mapAdminPlan(p: Record<string, unknown>) {
  return {
    id: p.id,
    title: p.title,
    description: p.description ?? null,
    subtitle: p.subtitle ?? null,
    status: p.status,
    parentCategoryId: p.parent_category_id ?? null,
    topicNumber: p.topic_number ?? null,
    colorTheme: p.color_theme ?? "#1D9E75",
    tags: p.tags ?? [],
    isLocked: !!p.unlock_after_plan_id && !p.manually_unlocked,
    manuallyUnlocked: p.manually_unlocked ?? false,
    isVisible: p.is_visible ?? true,
    isFeaturedInCategory: p.is_featured_in_category ?? false,
    adminNotes: p.admin_notes ?? null,
    icon: p.icon ?? null,
    createdAt: p.created_at,
  };
}

// Rebuilds the sequential unlock_after_plan_id chain for every plan in a
// category, ordered by topic_number — topic 1 always unlocked, each later
// topic points at the one immediately before it. Does not touch
// manually_unlocked, which is an independent override checked at read time
// (see resolveLockStatus in curriculum.ts).
async function recalculateLockChain(categoryId: string) {
  const { data: plans } = await supabaseWrite
    .from("p2p_curriculums")
    .select("id,topic_number")
    .eq("type", "plan")
    .eq("parent_category_id", categoryId)
    .order("topic_number", { ascending: true, nullsFirst: false });
  if (!plans || !plans.length) return;
  let previousId: string | null = null;
  for (const p of plans) {
    const { error } = await supabaseWrite.from("p2p_curriculums").update({ unlock_after_plan_id: previousId }).eq("id", p.id as string);
    if (error) throw new Error(error.message);
    previousId = p.id as string;
  }
}

// GET /admin/plan-categories — all categories with live plan counts
router.get("/plan-categories", async (_req, res) => {
  const { data: categories, error } = await supabaseWrite
    .from("p2p_curriculums")
    .select("*")
    .eq("type", "plan_category")
    .order("display_order", { ascending: true, nullsFirst: false });
  if (error) return err(res, error.message);

  const categoryIds = (categories ?? []).map((c) => c.id as string);
  const plans = categoryIds.length
    ? await selectInChunksAdmin<{ parent_category_id: string }>("p2p_curriculums", "id,parent_category_id", "parent_category_id", categoryIds)
    : [];
  const planCountByCategory = new Map<string, number>();
  for (const p of plans) {
    planCountByCategory.set(p.parent_category_id, (planCountByCategory.get(p.parent_category_id) ?? 0) + 1);
  }

  return ok(res, (categories ?? []).map((c) => mapAdminCategory(c as Record<string, unknown>, planCountByCategory.get(c.id as string) ?? 0)));
});

// POST /admin/plan-categories — create a new category
router.post("/plan-categories", async (req, res) => {
  const { title, description, color_theme, icon } = req.body as { title?: string; description?: string; color_theme?: string; icon?: string };
  if (!title?.trim()) return err(res, "title is required", 400);
  const slug = slugifyCategoryTitle(title);
  if (!slug) return err(res, "title must contain at least one letter or number", 400);

  const { data: existing } = await supabaseWrite.from("p2p_curriculums").select("id").eq("type", "plan_category").contains("tags", [slug]).maybeSingle();
  if (existing) return err(res, `A category for "${title.trim()}" (slug "${slug}") already exists`, 409);

  const { data: maxRow } = await supabaseWrite
    .from("p2p_curriculums").select("display_order").eq("type", "plan_category")
    .order("display_order", { ascending: false }).limit(1).maybeSingle();
  const nextOrder = ((maxRow?.display_order as number) ?? 0) + 1;

  const { data, error } = await supabaseWrite
    .from("p2p_curriculums")
    .insert({
      title: title.trim(),
      description: description?.trim() || null,
      type: "plan_category",
      status: "published",
      tags: [slug],
      color_theme: color_theme || "#1D9E75",
      icon: icon || null,
      display_order: nextOrder,
    })
    .select()
    .single();
  if (error || !data) return err(res, error?.message ?? "Failed to create category");
  return ok(res, mapAdminCategory(data as Record<string, unknown>, 0));
});

// PUT /admin/plan-categories/:categoryId — update a category
router.put("/plan-categories/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  const { title, description, color_theme, icon, display_order, status } = req.body as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (color_theme !== undefined) updates.color_theme = color_theme;
  if (icon !== undefined) updates.icon = icon;
  if (display_order !== undefined) updates.display_order = display_order;
  if (status !== undefined) updates.status = status;
  if (!Object.keys(updates).length) return err(res, "No fields to update", 400);

  const { data, error } = await supabaseWrite
    .from("p2p_curriculums").update(updates).eq("id", categoryId).eq("type", "plan_category").select().single();
  if (error || !data) return err(res, error?.message ?? "Category not found");

  const { count } = await supabaseWrite.from("p2p_curriculums").select("id", { count: "exact", head: true }).eq("type", "plan").eq("parent_category_id", categoryId);
  return ok(res, mapAdminCategory(data as Record<string, unknown>, count ?? 0));
});

// DELETE /admin/plan-categories/:categoryId — only when empty
router.delete("/plan-categories/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  const { count } = await supabaseWrite.from("p2p_curriculums").select("id", { count: "exact", head: true }).eq("type", "plan").eq("parent_category_id", categoryId);
  if (count && count > 0) {
    return err(res, `This category contains ${count} plan${count === 1 ? "" : "s"}. Move or delete them before removing the category.`, 400);
  }
  const { error } = await supabaseWrite.from("p2p_curriculums").delete().eq("id", categoryId).eq("type", "plan_category");
  if (error) return err(res, error.message);
  return ok(res, { deleted: true });
});

// PUT /admin/plan-categories/reorder — batch display_order update
router.put("/plan-categories/reorder", async (req, res) => {
  const items = req.body as { id: string; display_order: number }[];
  if (!Array.isArray(items) || !items.length) return err(res, "Body must be a non-empty array of { id, display_order }", 400);
  for (const item of items) {
    if (!item.id || typeof item.display_order !== "number") return err(res, "Each item needs id and display_order", 400);
    const { error } = await supabaseWrite.from("p2p_curriculums").update({ display_order: item.display_order }).eq("id", item.id).eq("type", "plan_category");
    if (error) return err(res, error.message);
  }
  return ok(res, { updated: items.length });
});

// GET /admin/plan-categories/:categoryId/stats
router.get("/plan-categories/:categoryId/stats", async (req, res) => {
  const { categoryId } = req.params;
  const { data: plans } = await supabaseWrite
    .from("p2p_curriculums").select("id,title,topic_number").eq("type", "plan").eq("parent_category_id", categoryId);
  const planIds = (plans ?? []).map((p) => p.id as string);
  if (!planIds.length) {
    return ok(res, { usersEnrolled: 0, lessonsCompleted: 0, mostReachedTopic: null, avgCompletionWeeks: null });
  }

  const enrollments = await selectInChunksAdmin<{ user_id: string; plan_id: string; status: string; enrolled_at: string; completed_at: string | null }>(
    "p2p_plan_enrollments", "user_id,plan_id,status,enrolled_at,completed_at", "plan_id", planIds
  );
  const usersEnrolled = new Set(enrollments.map((e) => e.user_id)).size;

  const modules = await selectInChunksAdmin<{ id: string; curriculum_id: string }>("p2p_modules", "id,curriculum_id", "curriculum_id", planIds);
  const moduleToPlan = new Map(modules.map((m) => [m.id, m.curriculum_id]));
  const moduleIds = Array.from(moduleToPlan.keys());
  const lessons = moduleIds.length ? await selectInChunksAdmin<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", moduleIds) : [];
  const lessonToPlan = new Map(lessons.map((l) => [l.id, moduleToPlan.get(l.module_id) as string]));
  const lessonIds = Array.from(lessonToPlan.keys());

  const progressRows = lessonIds.length
    ? await selectInChunksAdmin<{ lesson_id: string; completed: boolean }>("p2p_lesson_progress", "lesson_id,completed", "lesson_id", lessonIds)
    : [];
  const completedRows = progressRows.filter((p) => p.completed);
  const lessonsCompleted = completedRows.length;

  const completedByPlan = new Map<string, number>();
  for (const p of completedRows) {
    const planId = lessonToPlan.get(p.lesson_id);
    if (planId) completedByPlan.set(planId, (completedByPlan.get(planId) ?? 0) + 1);
  }
  let mostReachedTopic: { title: string; topicNumber: number | null } | null = null;
  let maxCompleted = 0;
  for (const p of plans ?? []) {
    const c = completedByPlan.get(p.id as string) ?? 0;
    if (c > maxCompleted) { maxCompleted = c; mostReachedTopic = { title: p.title as string, topicNumber: (p.topic_number as number | null) ?? null }; }
  }

  const completedEnrollments = enrollments.filter((e) => e.status === "completed" && e.completed_at);
  let avgCompletionWeeks: number | null = null;
  if (completedEnrollments.length) {
    const totalDays = completedEnrollments.reduce((sum, e) => {
      const days = (new Date(e.completed_at as string).getTime() - new Date(e.enrolled_at).getTime()) / (1000 * 60 * 60 * 24);
      return sum + Math.max(0, days);
    }, 0);
    avgCompletionWeeks = Math.round((totalDays / completedEnrollments.length / 7) * 10) / 10;
  }

  return ok(res, { usersEnrolled, lessonsCompleted, mostReachedTopic, avgCompletionWeeks });
});

// GET /admin/plans/uncategorized
router.get("/plans/uncategorized", async (_req, res) => {
  const { data, error } = await supabaseWrite
    .from("p2p_curriculums").select("*").eq("type", "plan").is("parent_category_id", null).order("created_at", { ascending: true });
  if (error) return err(res, error.message);
  return ok(res, (data ?? []).map((p) => mapAdminPlan(p as Record<string, unknown>)));
});

// PUT /admin/plans/:planId/move-category
router.put("/plans/:planId/move-category", async (req, res) => {
  const { planId } = req.params;
  const { category_id } = req.body as { category_id?: string };
  if (!category_id) return err(res, "category_id is required", 400);

  const { data: plan } = await supabaseWrite.from("p2p_curriculums").select("id,parent_category_id").eq("id", planId).eq("type", "plan").maybeSingle();
  if (!plan) return err(res, "Plan not found", 404);
  const sourceCategoryId = plan.parent_category_id as string | null;
  if (sourceCategoryId === category_id) return err(res, "Plan is already in that category", 400);

  const { count } = await supabaseWrite.from("p2p_curriculums").select("id", { count: "exact", head: true }).eq("type", "plan").eq("parent_category_id", category_id);
  const newTopicNumber = (count ?? 0) + 1;

  const { error: updateErr } = await supabaseWrite
    .from("p2p_curriculums").update({ parent_category_id: category_id, topic_number: newTopicNumber }).eq("id", planId);
  if (updateErr) return err(res, updateErr.message);

  try {
    if (sourceCategoryId) await recalculateLockChain(sourceCategoryId);
    await recalculateLockChain(category_id);
  } catch (e) {
    return err(res, e instanceof Error ? e.message : "Moved, but failed to recalculate lock chains");
  }

  return ok(res, { id: planId, parentCategoryId: category_id, topicNumber: newTopicNumber });
});

// PUT /admin/plans/:planId/reorder — change position within its category
router.put("/plans/:planId/reorder", async (req, res) => {
  const { planId } = req.params;
  const { new_topic_number } = req.body as { new_topic_number?: number };
  if (!new_topic_number || new_topic_number < 1) return err(res, "new_topic_number must be a positive integer", 400);

  const { data: plan } = await supabaseWrite.from("p2p_curriculums").select("id,parent_category_id").eq("id", planId).eq("type", "plan").maybeSingle();
  if (!plan || !plan.parent_category_id) return err(res, "Plan not found or has no category", 404);
  const categoryId = plan.parent_category_id as string;

  const { data: siblings } = await supabaseWrite
    .from("p2p_curriculums").select("id,topic_number").eq("type", "plan").eq("parent_category_id", categoryId)
    .order("topic_number", { ascending: true, nullsFirst: false });
  if (!siblings) return err(res, "Failed to load category plans");

  const orderedIds = siblings.filter((s) => s.id !== planId).map((s) => s.id as string);
  const clampedPos = Math.min(Math.max(1, new_topic_number), orderedIds.length + 1);
  orderedIds.splice(clampedPos - 1, 0, planId);

  for (let i = 0; i < orderedIds.length; i++) {
    const { error } = await supabaseWrite.from("p2p_curriculums").update({ topic_number: i + 1 }).eq("id", orderedIds[i]);
    if (error) return err(res, error.message);
  }

  try {
    await recalculateLockChain(categoryId);
  } catch (e) {
    return err(res, e instanceof Error ? e.message : "Reordered, but failed to recalculate lock chain");
  }

  return ok(res, { id: planId, newTopicNumber: clampedPos });
});

// PUT /admin/plans/:planId/toggle-lock — manual override
router.put("/plans/:planId/toggle-lock", async (req, res) => {
  const { planId } = req.params;
  const { is_locked } = req.body as { is_locked?: boolean };
  if (typeof is_locked !== "boolean") return err(res, "is_locked (boolean) is required", 400);

  // is_locked:false means "manually unlock" (sets the override on);
  // is_locked:true means "re-apply sequential lock" (clears the override).
  const { data, error } = await supabaseWrite
    .from("p2p_curriculums").update({ manually_unlocked: !is_locked }).eq("id", planId).eq("type", "plan").select().single();
  if (error || !data) return err(res, error?.message ?? "Plan not found");
  return ok(res, mapAdminPlan(data as Record<string, unknown>));
});

// POST /admin/plans/:planId/duplicate — full copy (modules, lessons, all
// content tables + block-editor blocks), title suffixed "(Copy)", draft
// status, appended as the next topic in the same category.
router.post("/plans/:planId/duplicate", async (req, res) => {
  const { planId } = req.params;
  const { data: original } = await supabaseWrite.from("p2p_curriculums").select("*").eq("id", planId).eq("type", "plan").maybeSingle();
  if (!original) return err(res, "Plan not found", 404);

  let newTopicNumber: number | null = null;
  if (original.parent_category_id) {
    const { count } = await supabaseWrite.from("p2p_curriculums").select("id", { count: "exact", head: true }).eq("type", "plan").eq("parent_category_id", original.parent_category_id as string);
    newTopicNumber = (count ?? 0) + 1;
  }

  const { data: newPlan, error: insErr } = await supabaseWrite
    .from("p2p_curriculums")
    .insert({
      title: `${original.title} (Copy)`,
      description: original.description,
      subtitle: original.subtitle,
      type: "plan",
      status: "draft",
      tags: original.tags,
      color_theme: original.color_theme,
      difficulty_level: original.difficulty_level,
      estimated_weeks: original.estimated_weeks,
      parent_category_id: original.parent_category_id,
      topic_number: newTopicNumber,
      icon: original.icon,
    })
    .select()
    .single();
  if (insErr || !newPlan) return err(res, insErr?.message ?? "Failed to duplicate plan");
  const newPlanId = newPlan.id as string;

  try {
    const { data: modules } = await supabaseWrite.from("p2p_modules").select("*").eq("curriculum_id", planId).order("order_index");
    for (const mod of modules ?? []) {
      const { data: newModule, error: modErr } = await supabaseWrite
        .from("p2p_modules")
        .insert({ curriculum_id: newPlanId, title: mod.title, description: mod.description, status: "draft", order_index: mod.order_index })
        .select().single();
      if (modErr || !newModule) throw new Error(modErr?.message ?? `Failed to duplicate module "${mod.title}"`);

      const { data: lessons } = await supabaseWrite.from("p2p_lessons").select("*").eq("module_id", mod.id).order("order_index");
      for (const lesson of lessons ?? []) {
        const { data: newLesson, error: lesErr } = await supabaseWrite
          .from("p2p_lessons")
          .insert({ module_id: newModule.id, title: lesson.title, subtitle: lesson.subtitle, status: "draft", order_index: lesson.order_index })
          .select().single();
        if (lesErr || !newLesson) throw new Error(lesErr?.message ?? `Failed to duplicate lesson "${lesson.title}"`);

        const [{ data: sections }, { data: scriptures }, { data: questions }, { data: assignments }, { data: blocks }] = await Promise.all([
          supabaseWrite.from("p2p_lesson_sections").select("*").eq("lesson_id", lesson.id),
          supabaseWrite.from("p2p_scriptures").select("*").eq("lesson_id", lesson.id),
          supabaseWrite.from("p2p_reflection_questions").select("*").eq("lesson_id", lesson.id),
          supabaseWrite.from("p2p_assignments").select("*").eq("lesson_id", lesson.id),
          supabaseWrite.from("p2p_lesson_blocks").select("*").eq("lesson_id", lesson.id),
        ]);
        if (sections?.length) {
          const { error } = await supabaseWrite.from("p2p_lesson_sections").insert(sections.map((s) => ({ lesson_id: newLesson.id, section_order: s.section_order, section_type: s.section_type, title: s.title, content: s.content })));
          if (error) throw new Error(error.message);
        }
        if (scriptures?.length) {
          const { error } = await supabaseWrite.from("p2p_scriptures").insert(scriptures.map((s) => ({ lesson_id: newLesson.id, reference: s.reference, verse: s.verse, display_order: s.display_order })));
          if (error) throw new Error(error.message);
        }
        if (questions?.length) {
          const { error } = await supabaseWrite.from("p2p_reflection_questions").insert(questions.map((q) => ({ lesson_id: newLesson.id, question: q.question, display_order: q.display_order })));
          if (error) throw new Error(error.message);
        }
        if (blocks?.length) {
          const { error } = await supabaseWrite.from("p2p_lesson_blocks").insert(blocks.map((b) => ({ lesson_id: newLesson.id, block_type: b.block_type, content: b.content, order_index: b.order_index, is_required: b.is_required, is_submittable: b.is_submittable })));
          if (error) throw new Error(error.message);
        }
        for (const a of assignments ?? []) {
          const { data: newAssignment, error: asnErr } = await supabaseWrite
            .from("p2p_assignments").insert({ lesson_id: newLesson.id, title: a.title, instructions: a.instructions, due_after_days: a.due_after_days }).select().single();
          if (asnErr || !newAssignment) throw new Error(asnErr?.message ?? "Failed to duplicate assignment");
          const { data: aqs } = await supabaseWrite.from("p2p_assignment_questions").select("*").eq("assignment_id", a.id);
          if (aqs?.length) {
            const { error } = await supabaseWrite.from("p2p_assignment_questions").insert(aqs.map((q) => ({ assignment_id: newAssignment.id, question: q.question, display_order: q.display_order })));
            if (error) throw new Error(error.message);
          }
        }
      }
    }
  } catch (e) {
    // Best-effort cleanup — remove the partially-duplicated plan rather than
    // leave a broken half-copy sitting in the catalog.
    const { data: partialModules } = await supabaseWrite.from("p2p_modules").select("id").eq("curriculum_id", newPlanId);
    const partialModuleIds = (partialModules ?? []).map((m) => m.id as string);
    if (partialModuleIds.length) {
      const partialLessons = await selectInChunksAdmin<{ id: string }>("p2p_lessons", "id", "module_id", partialModuleIds);
      const partialLessonIds = partialLessons.map((l) => l.id);
      if (partialLessonIds.length) {
        await supabaseWrite.from("p2p_lesson_blocks").delete().in("lesson_id", partialLessonIds);
        await supabaseWrite.from("p2p_lesson_sections").delete().in("lesson_id", partialLessonIds);
        await supabaseWrite.from("p2p_scriptures").delete().in("lesson_id", partialLessonIds);
        await supabaseWrite.from("p2p_reflection_questions").delete().in("lesson_id", partialLessonIds);
        await supabaseWrite.from("p2p_assignments").delete().in("lesson_id", partialLessonIds);
        await supabaseWrite.from("p2p_lessons").delete().in("id", partialLessonIds);
      }
      await supabaseWrite.from("p2p_modules").delete().in("id", partialModuleIds);
    }
    await supabaseWrite.from("p2p_curriculums").delete().eq("id", newPlanId);
    return err(res, e instanceof Error ? e.message : "Duplication failed, changes rolled back");
  }

  return ok(res, { id: newPlanId, title: newPlan.title });
});

// ── Username Management ──────────────────────────────────────────────────────

function mapReserved(row: Record<string, unknown>) {
  return {
    id: row.id,
    username: row.username,
    reason: row.reason ?? null,
    reservedBy: row.reserved_by ?? null,
    reservedAt: row.reserved_at,
    isActive: row.is_active ?? true,
  };
}

// GET /admin/reserved-usernames
router.get("/reserved-usernames", async (_req, res) => {
  const { data, error } = await supabaseWrite
    .from("p2p_reserved_usernames").select("*").eq("is_active", true).order("username");
  if (error) return err(res, error.message);
  return ok(res, (data ?? []).map(mapReserved));
});

// POST /admin/reserved-usernames — { username, reason }
router.post("/reserved-usernames", async (req, res) => {
  const { username, reason } = req.body as { username?: string; reason?: string };
  if (!username) return err(res, "username is required", 400);
  const validation = validateUsername(username);
  if (!validation.valid) return err(res, validation.error ?? "Invalid username format", 400);
  const clean = formatUsername(username);

  const { data: takenBy } = await supabaseWrite
    .from("p2p_profiles").select("id,full_name,email").ilike("username", clean).maybeSingle();
  if (takenBy) return err(res, `@${clean} is already taken by an existing account`, 409);

  const { data, error } = await supabaseWrite
    .from("p2p_reserved_usernames")
    .upsert({ username: clean, reason: reason ?? null, is_active: true }, { onConflict: "username" })
    .select()
    .single();
  if (error || !data) return err(res, error?.message ?? "Failed to reserve username");
  return res.status(201).json(mapReserved(data as Record<string, unknown>));
});

// DELETE /admin/reserved-usernames/:username
router.delete("/reserved-usernames/:username", async (req, res) => {
  const { error } = await supabaseWrite
    .from("p2p_reserved_usernames").delete().ilike("username", req.params.username);
  if (error) return err(res, error.message);
  return res.status(204).send();
});

// GET /admin/username-search?q= — searches ALL profiles including private
// ones (unlike the public GET /profiles/search, which filters those out).
router.get("/username-search", async (req, res) => {
  const { q } = req.query as { q?: string };
  if (!q || q.trim().length < 2) return ok(res, []);
  const query = q.trim().replace(/^@/, "");

  const { data, error } = await supabaseWrite
    .from("p2p_profiles")
    .select("id,username,full_name,email,country,role,profile_visibility,created_at")
    .or(`username.ilike.%${query}%,full_name.ilike.%${query}%,email.ilike.%${query}%`)
    .limit(25);
  if (error) return err(res, error.message);
  return ok(res, (data ?? []).map((p) => ({
    userId: p.id,
    username: p.username ?? null,
    fullName: p.full_name ?? null,
    email: p.email ?? null,
    country: p.country ?? null,
    role: p.role ?? "student",
    isPrivate: p.profile_visibility === "private",
    createdAt: p.created_at,
  })));
});

// POST /admin/force-username-change/:userId — flags the account so the
// client shows a mandatory username-setup screen on next load (see
// mobile's app/_layout.tsx auth gate — Step 16).
router.post("/force-username-change/:userId", async (req, res) => {
  const { data, error } = await supabaseWrite
    .from("p2p_profiles").update({ username_change_required: true }).eq("id", req.params.userId).select("id").maybeSingle();
  if (error) return err(res, error.message);
  if (!data) return err(res, "Profile not found", 404);
  return ok(res, { ok: true });
});

// GET /admin/flagged-usernames — accounts currently flagged for a forced
// username change (set via force-username-change above, or the Step 16
// admin/seed backfill). There's no separate "flag" table — the boolean on
// p2p_profiles IS the flag, so this tab is just that filter.
router.get("/flagged-usernames", async (_req, res) => {
  const { data, error } = await supabaseWrite
    .from("p2p_profiles")
    .select("id,username,full_name,email,role,created_at")
    .eq("username_change_required", true)
    .order("created_at", { ascending: false });
  if (error) return err(res, error.message);
  return ok(res, (data ?? []).map((p) => ({
    userId: p.id, username: p.username ?? null, fullName: p.full_name ?? null,
    email: p.email ?? null, role: p.role ?? "student", createdAt: p.created_at,
  })));
});

// POST /admin/dismiss-username-flag/:userId — clears the forced-change flag
// without requiring the user to actually change their username.
router.post("/dismiss-username-flag/:userId", async (req, res) => {
  const { data, error } = await supabaseWrite
    .from("p2p_profiles").update({ username_change_required: false }).eq("id", req.params.userId).select("id").maybeSingle();
  if (error) return err(res, error.message);
  if (!data) return err(res, "Profile not found", 404);
  return ok(res, { ok: true });
});

// ── Identity verification review ─────────────────────────────────────────────
// Narrower than the blanket requireAdmin() gate above (which also lets
// peer_guide through) — reviewing someone's selfie/video is more sensitive
// than the other admin actions in this file, so it's scoped to the same
// moderator+ set p2p_content_flags already uses (migrations/013_moderation.sql,
// matched by RLS in migration 065).
const VERIFICATION_REVIEWER_ROLES = ["moderator", "church_leader", "regional_admin", "super_admin"];
const VERIFICATION_DECLINE_REAPPLY_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_REVOKE_REAPPLY_MS = 30 * 24 * 60 * 60 * 1000;
const VERIFICATION_DELETE_AFTER_APPROVAL_MS = 48 * 60 * 60 * 1000;

async function requireVerificationReviewer(req: any, res: any): Promise<string | null> {
  const adminUserId = req.adminUserId as string;
  const { data: profile } = await supabaseWrite.from("p2p_profiles").select("role").eq("id", adminUserId).maybeSingle();
  if (!profile || !VERIFICATION_REVIEWER_ROLES.includes(profile.role as string)) {
    err(res, "Verification review requires moderator, church_leader, regional_admin, or super_admin role", 403);
    return null;
  }
  return adminUserId;
}

async function notifyUser(userId: string, title: string, message: string, notificationType: string) {
  await supabaseWrite.from("p2p_notifications").insert({ user_id: userId, title, message, notification_type: notificationType });
}

// GET /admin/verification/queue — pending applications, oldest first.
router.get("/verification/queue", async (req, res) => {
  if (!(await requireVerificationReviewer(req, res))) return;

  const { data: applications, error } = await supabaseWrite
    .from("p2p_verification_applications")
    .select("id, user_id, method, submitted_at, attempt_number")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });
  if (error) return err(res, error.message);

  const userIds = Array.from(new Set((applications ?? []).map((a) => a.user_id as string)));
  const { data: profiles } = userIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id, username, full_name, photo_url, country, created_at").in("id", userIds)
    : { data: [] as { id: string; username: string | null; full_name: string | null; photo_url: string | null; country: string | null; created_at: string }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return ok(res, (applications ?? []).map((a) => {
    const p = profileById.get(a.user_id as string);
    const accountAgeDays = p ? Math.floor((Date.now() - new Date(p.created_at as string).getTime()) / (24 * 60 * 60 * 1000)) : null;
    return {
      applicationId: a.id, userId: a.user_id,
      username: p?.username ?? null, displayName: p?.full_name ?? null, photoUrl: p?.photo_url ?? null, country: p?.country ?? null,
      method: a.method, submittedAt: a.submitted_at, attemptNumber: a.attempt_number, accountAgeDays,
    };
  }));
});

// GET /admin/verification/queue/:applicationId — full detail + a 1-hour
// signed URL for the submitted selfie/video.
router.get("/verification/queue/:applicationId", async (req, res) => {
  if (!(await requireVerificationReviewer(req, res))) return;

  const { data: application, error } = await supabaseWrite
    .from("p2p_verification_applications")
    .select("*")
    .eq("id", req.params.applicationId)
    .maybeSingle();
  if (error) return err(res, error.message);
  if (!application) return err(res, "Application not found", 404);

  const { data: profile } = await supabaseWrite
    .from("p2p_profiles")
    .select("id, username, full_name, photo_url, country, created_at")
    .eq("id", application.user_id)
    .maybeSingle();

  let submissionUrl: string | null = null;
  if (application.submission_path) {
    const { data: signed } = await supabaseWrite.storage
      .from("verification-submissions")
      .createSignedUrl(application.submission_path as string, 3600);
    submissionUrl = signed?.signedUrl ?? null;
  }

  const accountAgeDays = profile ? Math.floor((Date.now() - new Date(profile.created_at as string).getTime()) / (24 * 60 * 60 * 1000)) : null;

  return ok(res, {
    applicationId: application.id, userId: application.user_id,
    username: profile?.username ?? null, displayName: profile?.full_name ?? null,
    profilePhotoUrl: application.profile_photo_url ?? profile?.photo_url ?? null,
    country: profile?.country ?? null, accountAgeDays,
    method: application.method, submissionUrl, status: application.status,
    submittedAt: application.submitted_at, attemptNumber: application.attempt_number,
  });
});

// POST /admin/verification/approve/:applicationId — { notes? }
router.post("/verification/approve/:applicationId", async (req, res) => {
  const adminUserId = await requireVerificationReviewer(req, res);
  if (!adminUserId) return;
  const { notes } = req.body as { notes?: string };

  const { data: application } = await supabaseWrite
    .from("p2p_verification_applications").select("id, user_id, status").eq("id", req.params.applicationId).maybeSingle();
  if (!application) return err(res, "Application not found", 404);
  if (application.status !== "pending") return err(res, "This application has already been reviewed", 409);

  const now = new Date();
  await supabaseWrite.from("p2p_verification_applications").update({
    status: "approved", reviewed_by: adminUserId, reviewed_at: now.toISOString(),
    face_match_notes: notes ?? null, delete_after: new Date(now.getTime() + VERIFICATION_DELETE_AFTER_APPROVAL_MS).toISOString(),
  }).eq("id", application.id);

  await supabaseWrite.from("p2p_profiles").update({
    is_verified: true, verification_status: "approved", verification_approved_at: now.toISOString(),
    verification_reviewed_by: adminUserId, verification_reviewed_at: now.toISOString(),
  }).eq("id", application.user_id);

  await supabaseWrite.from("p2p_verification_history").insert({ user_id: application.user_id, action: "approved", action_by: adminUserId });
  await notifyUser(
    application.user_id as string, "🎉 You are now verified on P2P Global",
    "Your blue tick ✓ is now visible on your profile and everywhere your username appears.",
    "verification_approved"
  );

  return ok(res, { success: true });
});

const DECLINE_REASONS = ["face_mismatch", "image_unclear", "no_note_visible", "note_incorrect", "suspected_fake", "other"];

// POST /admin/verification/decline/:applicationId — { reason }
router.post("/verification/decline/:applicationId", async (req, res) => {
  const adminUserId = await requireVerificationReviewer(req, res);
  if (!adminUserId) return;
  const { reason } = req.body as { reason?: string };
  if (!reason || !DECLINE_REASONS.includes(reason)) return err(res, `reason must be one of: ${DECLINE_REASONS.join(", ")}`, 400);

  const { data: application } = await supabaseWrite
    .from("p2p_verification_applications").select("id, user_id, status, submission_path").eq("id", req.params.applicationId).maybeSingle();
  if (!application) return err(res, "Application not found", 404);
  if (application.status !== "pending") return err(res, "This application has already been reviewed", 409);

  const now = new Date();
  const canReapplyAt = new Date(now.getTime() + VERIFICATION_DECLINE_REAPPLY_MS).toISOString();

  if (application.submission_path) {
    await supabaseWrite.storage.from("verification-submissions").remove([application.submission_path as string]);
  }
  await supabaseWrite.from("p2p_verification_applications").update({
    status: "declined", reviewed_by: adminUserId, reviewed_at: now.toISOString(), decline_reason: reason,
    submission_path: null, submission_deleted_at: now.toISOString(),
  }).eq("id", application.id);

  await supabaseWrite.from("p2p_profiles").update({
    verification_status: "declined", verification_decline_reason: reason, can_reapply_at: canReapplyAt,
    verification_reviewed_by: adminUserId, verification_reviewed_at: now.toISOString(),
  }).eq("id", application.user_id);

  await supabaseWrite.from("p2p_verification_history").insert({ user_id: application.user_id, action: "declined", action_by: adminUserId, reason });
  await notifyUser(
    application.user_id as string, "Verification update",
    "We were unable to approve your verification. Tap to see the reason and reapply options.",
    "verification_declined"
  );

  return ok(res, { success: true });
});

// POST /admin/verification/revoke/:userId — { reason }
router.post("/verification/revoke/:userId", async (req, res) => {
  const adminUserId = await requireVerificationReviewer(req, res);
  if (!adminUserId) return;
  const { reason } = req.body as { reason?: string };
  if (!reason || !reason.trim()) return err(res, "reason is required", 400);

  const { data: profile } = await supabaseWrite.from("p2p_profiles").select("id, is_verified").eq("id", req.params.userId).maybeSingle();
  if (!profile) return err(res, "Profile not found", 404);

  const canReapplyAt = new Date(Date.now() + VERIFICATION_REVOKE_REAPPLY_MS).toISOString();
  await supabaseWrite.from("p2p_profiles").update({
    is_verified: false, verification_status: "revoked", can_reapply_at: canReapplyAt,
  }).eq("id", req.params.userId);

  await supabaseWrite.from("p2p_verification_history").insert({ user_id: req.params.userId, action: "revoked", action_by: adminUserId, reason });
  await notifyUser(
    req.params.userId, "Verification status update",
    "Your verification badge has been removed. Tap for details.",
    "verification_revoked"
  );

  return ok(res, { success: true });
});

// POST /admin/verification/grant/:userId — manual grant, no application
// (known ministry leaders, founding members, special cases).
router.post("/verification/grant/:userId", async (req, res) => {
  const adminUserId = await requireVerificationReviewer(req, res);
  if (!adminUserId) return;

  const { data: profile } = await supabaseWrite.from("p2p_profiles").select("id").eq("id", req.params.userId).maybeSingle();
  if (!profile) return err(res, "Profile not found", 404);

  const now = new Date();
  await supabaseWrite.from("p2p_profiles").update({
    is_verified: true, verification_status: "approved", verification_method: "manual_grant",
    verification_approved_at: now.toISOString(), verification_reviewed_by: adminUserId, verification_reviewed_at: now.toISOString(),
  }).eq("id", req.params.userId);

  await supabaseWrite.from("p2p_verification_history").insert({ user_id: req.params.userId, action: "granted", action_by: adminUserId });
  await notifyUser(
    req.params.userId, "🎉 You are now verified on P2P Global",
    "Your blue tick ✓ is now visible on your profile and everywhere your username appears.",
    "verification_approved"
  );

  return ok(res, { success: true });
});

// GET /admin/verification/history/:userId
router.get("/verification/history/:userId", async (req, res) => {
  if (!(await requireVerificationReviewer(req, res))) return;

  const { data, error } = await supabaseWrite
    .from("p2p_verification_history")
    .select("id, action, action_by, reason, created_at")
    .eq("user_id", req.params.userId)
    .order("created_at", { ascending: false });
  if (error) return err(res, error.message);

  return ok(res, data ?? []);
});

// GET /admin/verification/history — global feed across all users (History
// tab), as opposed to the per-user endpoint above (used by the review
// screen's "view this user's history" drill-in).
router.get("/verification/history", async (req, res) => {
  if (!(await requireVerificationReviewer(req, res))) return;
  const { q } = req.query as { q?: string };

  const { data, error } = await supabaseWrite
    .from("p2p_verification_history")
    .select("id, user_id, action, action_by, reason, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return err(res, error.message);

  const userIds = Array.from(new Set((data ?? []).flatMap((h) => [h.user_id as string, h.action_by as string | null]).filter(Boolean) as string[]));
  const { data: profiles } = userIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id, username, full_name").in("id", userIds)
    : { data: [] as { id: string; username: string | null; full_name: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  let rows = (data ?? []).map((h) => ({
    id: h.id, userId: h.user_id,
    username: profileById.get(h.user_id as string)?.username ?? null,
    displayName: profileById.get(h.user_id as string)?.full_name ?? null,
    action: h.action,
    actionByUsername: h.action_by ? profileById.get(h.action_by as string)?.username ?? null : null,
    reason: h.reason, createdAt: h.created_at,
  }));

  if (q && q.trim()) {
    const needle = q.trim().replace(/^@/, "").toLowerCase();
    rows = rows.filter((r) => r.username?.toLowerCase().includes(needle) || r.displayName?.toLowerCase().includes(needle));
  }

  return ok(res, rows);
});

// GET /admin/verification/stats
router.get("/verification/stats", async (req, res) => {
  if (!(await requireVerificationReviewer(req, res))) return;

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [totalVerified, pending, approvedThisWeek, declinedThisWeek, allApplications, allApproved, allDeclined, allRevoked] = await Promise.all([
    supabaseWrite.from("p2p_profiles").select("id", { count: "exact", head: true }).eq("is_verified", true),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }).eq("status", "approved").gte("reviewed_at", weekAgo),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }).eq("status", "declined").gte("reviewed_at", weekAgo),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabaseWrite.from("p2p_verification_applications").select("id", { count: "exact", head: true }).eq("status", "declined"),
    supabaseWrite.from("p2p_verification_history").select("id", { count: "exact", head: true }).eq("action", "revoked"),
  ]);

  const { data: reviewedTimings } = await supabaseWrite
    .from("p2p_verification_applications")
    .select("submitted_at, reviewed_at")
    .not("reviewed_at", "is", null)
    .limit(500);
  const hours = (reviewedTimings ?? []).map((r) => (new Date(r.reviewed_at as string).getTime() - new Date(r.submitted_at as string).getTime()) / (60 * 60 * 1000));
  const avgReviewHours = hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : 0;

  const totalApplicationsAllTime = allApplications.count ?? 0;
  return ok(res, {
    totalVerified: totalVerified.count ?? 0,
    pendingApplications: pending.count ?? 0,
    approvedThisWeek: approvedThisWeek.count ?? 0,
    declinedThisWeek: declinedThisWeek.count ?? 0,
    avgReviewHours,
    totalApplicationsAllTime,
    totalApprovalsAllTime: allApproved.count ?? 0,
    totalDeclinesAllTime: allDeclined.count ?? 0,
    totalRevocationsAllTime: allRevoked.count ?? 0,
    verificationRate: totalApplicationsAllTime ? Math.round(((allApproved.count ?? 0) / totalApplicationsAllTime) * 100) : 0,
  });
});

// ── Help Request → Conversation linking ──────────────────────────────────────
// Called right after "Message them"/"Call" on the Help Requests screen
// creates (or reuses) a DM via p2p_start_direct_conversation() — that RPC
// knows nothing about the help request itself, so this stamps the
// conversation with the metadata the crisis thread banner (messages/[id].tsx)
// and feedback flow key off. Client can't do this directly: p2p_conversations
// has no UPDATE RLS policy for these columns (only messages_update_pin, for
// pinning), by design — this is a privileged admin action.
router.post("/help-requests/:id/link-conversation", async (req, res) => {
  const { id } = req.params;
  const { conversationId } = req.body as { conversationId?: string };
  if (!conversationId) return err(res, "conversationId is required", 400);

  const { data: helpRequest } = await supabaseWrite
    .from("p2p_help_requests").select("id, created_at").eq("id", id).maybeSingle();
  if (!helpRequest) return err(res, "Help request not found", 404);

  const { error } = await supabaseWrite
    .from("p2p_conversations")
    .update({
      conversation_type: "help_request",
      crisis_type: "help_request",
      help_request_id: helpRequest.id,
      crisis_submitted_at: helpRequest.created_at,
      is_pinned_by_system: true,
    })
    .eq("id", conversationId);
  if (error) return err(res, error.message, 500);

  return ok(res, { ok: true });
});

// ── Admin hierarchy (migration 069) ──────────────────────────────────────────
// admin_zone options mirror the CHECK constraint on p2p_profiles.admin_zone.
const ADMIN_ZONES = ["europe", "africa", "asia", "americas", "oceania", "middle_east"];
// Roles this endpoint is allowed to grant — deliberately excludes
// super_admin and admin_supervisor per the spec ("appointed directly in DB
// for security"), even though req.adminRole === 'super_admin' already
// bypasses every requireRole check in this file.
const APPOINTABLE_ROLES = [
  "admin_zone", "admin_national", "admin_content", "admin_translation",
  "admin_moderation", "admin_verification", "admin_help", "admin_username",
  "admin_finance", "admin_marketing", "admin_church", "peer_guide", "church_leader",
  "regional_admin", "moderator",
];

async function logAdminActivity(params: {
  adminId: string; adminRole: string; actionType: string;
  targetUserId?: string | null; targetResourceId?: string | null; targetResourceType?: string | null;
  actionDetail?: Record<string, unknown>; durationSeconds?: number | null;
}) {
  await supabaseWrite.from("p2p_admin_activity_log").insert({
    admin_id: params.adminId, admin_role: params.adminRole, action_type: params.actionType,
    target_user_id: params.targetUserId ?? null, target_resource_id: params.targetResourceId ?? null,
    target_resource_type: params.targetResourceType ?? null, action_detail: params.actionDetail ?? {},
    duration_seconds: params.durationSeconds ?? null,
  });
  await supabaseWrite.from("p2p_profiles").update({ admin_last_active_at: new Date().toISOString() }).eq("id", params.adminId);
}

// POST /admin/activity/log — generic, client-callable action logger. Always
// self-attributed to the calling admin (req.adminUserId/req.adminRole from
// requireAdmin's verified JWT) — a client can log its own admin's actions,
// never spoof another admin's.
router.post("/activity/log", async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const adminRole = (req as any).adminRole as string;
  const { actionType, targetUserId, targetResourceId, targetResourceType, actionDetail } = req.body as {
    actionType?: string; targetUserId?: string; targetResourceId?: string; targetResourceType?: string; actionDetail?: Record<string, unknown>;
  };
  if (!actionType) return err(res, "actionType is required", 400);
  await logAdminActivity({ adminId, adminRole, actionType, targetUserId, targetResourceId, targetResourceType, actionDetail });
  return ok(res, { ok: true });
});

// POST /admin/appointments/create — super_admin only
router.post("/appointments/create", requireRole("super_admin"), async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const { username, role, admin_zone, admin_country, reason } = req.body as {
    username?: string; role?: string; admin_zone?: string; admin_country?: string; reason?: string;
  };
  if (!username || !role || !reason?.trim()) return err(res, "username, role, and reason are required", 400);
  if (!APPOINTABLE_ROLES.includes(role)) return err(res, `role must be one of: ${APPOINTABLE_ROLES.join(", ")}`, 400);
  if (admin_zone && !ADMIN_ZONES.includes(admin_zone)) return err(res, `admin_zone must be one of: ${ADMIN_ZONES.join(", ")}`, 400);

  const { data: target } = await supabaseWrite
    .from("p2p_profiles").select("id, role, is_verified").eq("username", username.trim().toLowerCase()).maybeSingle();
  if (!target) return err(res, "No user found with that username", 404);
  if (target.role !== "student") return err(res, "This user already has an elevated role", 409);

  const { data: updated, error } = await supabaseWrite
    .from("p2p_profiles")
    .update({
      role, admin_zone: admin_zone ?? null, admin_country: admin_country ?? null,
      admin_appointed_by: adminId, admin_appointed_at: new Date().toISOString(),
      admin_appointment_reason: reason.trim(), admin_is_active: true,
    })
    .eq("id", target.id)
    .select("id, username, full_name, role")
    .single();
  if (error || !updated) return err(res, error?.message ?? "Failed to appoint admin", 500);

  await logAdminActivity({
    adminId, adminRole: (req as any).adminRole, actionType: "admin_appointed",
    targetUserId: target.id, actionDetail: { role, admin_zone, admin_country },
  });
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: target.id,
    title: "You've been appointed as an admin",
    message: `You have been appointed as ${role.replace(/^admin_/, "").replace(/_/g, " ")} on P2P Global. Your admin dashboard is now active.`,
    notification_type: "admin_appointed",
    data: { role },
  });

  return ok(res, updated);
});

// PUT /admin/appointments/:userId/remove — super_admin only
router.put("/appointments/:userId/remove", requireRole("super_admin"), async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const userId = req.params.userId as string;
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return err(res, "reason is required", 400);

  const { data: target } = await supabaseWrite.from("p2p_profiles").select("id, role").eq("id", userId).maybeSingle();
  if (!target) return err(res, "User not found", 404);

  const { error } = await supabaseWrite
    .from("p2p_profiles")
    .update({ role: "student", admin_zone: null, admin_country: null, admin_appointment_reason: null, admin_is_active: true })
    .eq("id", userId);
  if (error) return err(res, error.message, 500);

  await logAdminActivity({
    adminId, adminRole: (req as any).adminRole, actionType: "admin_removed",
    targetUserId: userId, actionDetail: { previousRole: target.role, reason: reason.trim() },
  });
  await supabaseWrite.from("p2p_notifications").insert({
    user_id: userId, title: "Your admin role has been removed",
    message: "Your admin access on P2P Global has been removed.",
    notification_type: "admin_removed", data: {},
  });

  return ok(res, { ok: true });
});

// PUT /admin/appointments/:userId/suspend — super_admin only (deactivates
// without removing the role, per spec — the role/zone/country stay intact)
router.put("/appointments/:userId/suspend", requireRole("super_admin"), async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const userId = req.params.userId as string;
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return err(res, "reason is required", 400);

  const { data: target } = await supabaseWrite.from("p2p_profiles").select("id, admin_is_active").eq("id", userId).maybeSingle();
  if (!target) return err(res, "User not found", 404);

  const nextActive = !target.admin_is_active; // toggle: suspend if active, reinstate if already suspended
  const { error } = await supabaseWrite.from("p2p_profiles").update({ admin_is_active: nextActive }).eq("id", userId);
  if (error) return err(res, error.message, 500);

  await logAdminActivity({
    adminId, adminRole: (req as any).adminRole, actionType: nextActive ? "admin_reinstated" : "admin_suspended",
    targetUserId: userId, actionDetail: { reason: reason.trim() },
  });

  return ok(res, { ok: true, adminIsActive: nextActive });
});

// GET /admin/appointments/list — super_admin + admin_supervisor
router.get("/appointments/list", requireRole("admin_supervisor"), async (_req, res) => {
  const { data: admins, error } = await supabaseWrite
    .from("p2p_profiles")
    .select("id, username, full_name, role, admin_zone, admin_country, admin_is_active, admin_appointed_at, admin_last_active_at")
    .neq("role", "student")
    .order("admin_appointed_at", { ascending: false, nullsFirst: false });
  if (error) return err(res, error.message, 500);

  const adminIds = (admins ?? []).map((a) => a.id as string);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ data: weekActivity }, { data: feedback }] = await Promise.all([
    adminIds.length
      ? supabaseWrite.from("p2p_admin_activity_log").select("admin_id").in("admin_id", adminIds).gte("created_at", weekAgo)
      : Promise.resolve({ data: [] as { admin_id: string }[] }),
    adminIds.length
      ? supabaseWrite.from("p2p_admin_interaction_feedback").select("admin_user_id, rating").in("admin_user_id", adminIds)
      : Promise.resolve({ data: [] as { admin_user_id: string; rating: number | null }[] }),
  ]);
  const casesByAdmin = new Map<string, number>();
  for (const a of weekActivity ?? []) casesByAdmin.set(a.admin_id, (casesByAdmin.get(a.admin_id) ?? 0) + 1);
  const ratingsByAdmin = new Map<string, number[]>();
  for (const f of feedback ?? []) {
    if (f.rating == null) continue;
    const arr = ratingsByAdmin.get(f.admin_user_id) ?? [];
    arr.push(f.rating);
    ratingsByAdmin.set(f.admin_user_id, arr);
  }

  return ok(res, (admins ?? []).map((a) => {
    const ratings = ratingsByAdmin.get(a.id as string) ?? [];
    return {
      id: a.id, username: a.username, fullName: a.full_name, role: a.role,
      adminZone: a.admin_zone, adminCountry: a.admin_country, adminIsActive: a.admin_is_active,
      adminAppointedAt: a.admin_appointed_at, lastActiveAt: a.admin_last_active_at,
      casesThisWeek: casesByAdmin.get(a.id as string) ?? 0,
      avgRating: ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null,
    };
  }));
});

// GET /admin/activity/live — super_admin + admin_supervisor, cursor-paginated
// by created_at (descending — pass the oldest row's created_at back as
// ?cursor= to fetch the next page).
router.get("/activity/live", requireRole("admin_supervisor"), async (req, res) => {
  const { cursor, adminId, actionType } = req.query as { cursor?: string; adminId?: string; actionType?: string };
  let query = supabaseWrite
    .from("p2p_admin_activity_log")
    .select("id, admin_id, admin_role, action_type, target_user_id, action_detail, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (cursor) query = query.lt("created_at", cursor);
  if (adminId) query = query.eq("admin_id", adminId);
  if (actionType) query = query.eq("action_type", actionType);
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);

  const adminIds = Array.from(new Set((data ?? []).map((r) => r.admin_id as string)));
  const { data: admins } = adminIds.length
    ? await supabaseWrite.from("p2p_profiles").select("id, full_name").in("id", adminIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((admins ?? []).map((a) => [a.id as string, a.full_name as string]));

  return ok(res, (data ?? []).map((r) => ({
    id: r.id, adminId: r.admin_id, adminName: nameById.get(r.admin_id as string) ?? "Someone",
    adminRole: r.admin_role, actionType: r.action_type, targetUserId: r.target_user_id,
    actionDetail: r.action_detail, createdAt: r.created_at,
  })));
});

// GET /admin/activity/my-stats — any admin, own activity only. Stats are
// computed from whatever's actually been logged via logAdminActivity/
// POST /admin/activity/log — real numbers, but only as complete as the
// call sites that log activity (currently: appointments, help-request
// resolution; not yet every admin action in this 1500+ line file).
router.get("/activity/my-stats", async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const adminRole = (req as any).adminRole as string;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: myConvos } = await supabaseWrite.from("p2p_conversation_members").select("conversation_id").eq("user_id", adminId);
  const myConvoIds = (myConvos ?? []).map((m) => m.conversation_id as string);

  const [{ data: weekActivity }, { data: feedback }, { data: openConvos }] = await Promise.all([
    supabaseWrite.from("p2p_admin_activity_log").select("action_type, created_at").eq("admin_id", adminId).gte("created_at", weekAgo),
    supabaseWrite.from("p2p_admin_interaction_feedback").select("rating").eq("admin_user_id", adminId),
    myConvoIds.length
      ? supabaseWrite.from("p2p_conversations").select("id, resolved_at").eq("conversation_type", "help_request").is("resolved_at", null).in("id", myConvoIds)
      : Promise.resolve({ data: [] as { id: string; resolved_at: string | null }[] }),
  ]);

  const casesHandled = (weekActivity ?? []).filter((a) => a.action_type === "case_resolved").length;
  const ratings = (feedback ?? []).map((f) => f.rating).filter((r): r is number => r != null);
  const avgFeedbackRating = ratings.length ? Math.round((ratings.reduce((s, r) => s + r, 0) / ratings.length) * 10) / 10 : null;

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());

  return ok(res, {
    role: adminRole,
    casesHandled,
    avgResponseMinutes: null,
    avgFeedbackRating,
    openCases: (openConvos ?? []).length,
    weekLabel: `Week of ${weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
  });
});

// ── Admin reports ─────────────────────────────────────────────────────────────
// Shared with the cron jobs in lib/adminReports.ts (generateWeeklyReportDrafts
// uses the exact same computation so a submitted report's stats always match
// what the auto-generated draft showed).

// POST /admin/reports/submit — any admin
router.post("/reports/submit", async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const adminRole = (req as any).adminRole as string;
  const { reportPeriod, periodStart, periodEnd, adminNotes } = req.body as {
    reportPeriod?: "weekly" | "monthly" | "annual"; periodStart?: string; periodEnd?: string; adminNotes?: string;
  };
  if (!reportPeriod || !periodStart || !periodEnd) return err(res, "reportPeriod, periodStart, and periodEnd are required", 400);

  const stats = await computeReportStats(adminId, periodStart, periodEnd);
  const { data, error } = await supabaseWrite
    .from("p2p_admin_reports")
    .insert({
      admin_id: adminId, admin_role: adminRole, report_period: reportPeriod,
      period_start: periodStart, period_end: periodEnd, stats, admin_notes: adminNotes?.trim() || null,
      submitted_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) return err(res, error?.message ?? "Failed to submit report", 500);

  await logAdminActivity({ adminId, adminRole, actionType: "report_submitted", targetResourceId: data.id, targetResourceType: "admin_report" });

  const { data: supervisors } = await supabaseWrite.from("p2p_profiles").select("id").in("role", ["super_admin", "admin_supervisor"]);
  if (supervisors?.length) {
    await supabaseWrite.from("p2p_notifications").insert(
      supervisors.map((s) => ({
        user_id: s.id, title: "New admin report submitted",
        message: `A ${reportPeriod} report has been submitted for review.`,
        notification_type: "admin_report_submitted", data: { reportId: data.id, adminId },
      }))
    );
  }

  return ok(res, { id: data.id });
});

// GET /admin/reports/my-reports — any admin
router.get("/reports/my-reports", async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const { data, error } = await supabaseWrite
    .from("p2p_admin_reports").select("*").eq("admin_id", adminId).order("period_start", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, data ?? []);
});

// GET /admin/reports/all — super_admin + admin_supervisor + admin_zone
router.get("/reports/all", requireRole("admin_supervisor", "admin_zone"), async (req, res) => {
  const { role, period } = req.query as { role?: string; period?: string };
  let query = supabaseWrite.from("p2p_admin_reports").select("*").order("submitted_at", { ascending: false, nullsFirst: false });
  if (role) query = query.eq("admin_role", role);
  if (period) query = query.eq("report_period", period);
  const { data, error } = await query;
  if (error) return err(res, error.message, 500);
  return ok(res, data ?? []);
});

// ── Church Discipleship Portal admin — admin_church + super_admin only ───────
// Completely free for every church: no tiers, no subscriptions, no payment
// processing anywhere in this section.
function mapAdminChurch(row: Record<string, unknown>, memberCount: number) {
  return {
    id: row.id, name: row.name, city: row.city ?? null, country: row.country,
    status: row.status, isVerified: row.is_verified ?? false, verifiedAt: row.verified_at ?? null,
    contactEmail: row.contact_email ?? null, contactName: row.contact_name ?? null, website: row.website ?? null,
    createdAt: row.created_at, memberCount,
  };
}

// GET /admin/churches — search/filter, all statuses.
router.get("/churches", requireRole("admin_church"), async (req, res) => {
  const { search, verified, country } = req.query as { search?: string; verified?: string; country?: string };
  let query = supabaseWrite.from("p2p_churches").select("*").order("created_at", { ascending: false });
  if (verified === "true") query = query.eq("is_verified", true);
  if (verified === "false") query = query.eq("is_verified", false);
  if (country) query = query.eq("country", country);
  const { data: churches, error } = await query;
  if (error) return err(res, error.message, 500);

  let rows = churches ?? [];
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    rows = rows.filter((c) => `${c.name} ${c.country} ${c.city ?? ""}`.toLowerCase().includes(q));
  }

  const churchIds = rows.map((c) => c.id as string);
  const { data: memberRows } = churchIds.length
    ? await supabaseWrite.from("p2p_church_members").select("church_id").eq("is_active", true).in("church_id", churchIds)
    : { data: [] as { church_id: string }[] };
  const countByChurch = new Map<string, number>();
  for (const m of memberRows ?? []) countByChurch.set(m.church_id as string, (countByChurch.get(m.church_id as string) ?? 0) + 1);

  return ok(res, rows.map((c) => mapAdminChurch(c as Record<string, unknown>, countByChurch.get(c.id as string) ?? 0)));
});

// GET /admin/churches/stats — portal-wide statistics.
router.get("/churches/stats", requireRole("admin_church"), async (_req, res) => {
  const [{ count: totalChurches }, { count: verifiedChurches }, { count: totalMembers }, { data: countryRows }] = await Promise.all([
    supabaseWrite.from("p2p_churches").select("id", { count: "exact", head: true }),
    supabaseWrite.from("p2p_churches").select("id", { count: "exact", head: true }).eq("is_verified", true),
    supabaseWrite.from("p2p_church_members").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabaseWrite.from("p2p_churches").select("country"),
  ]);
  const nationsWithChurches = new Set((countryRows ?? []).map((c) => c.country)).size;

  return ok(res, {
    totalChurches: totalChurches ?? 0, verifiedChurches: verifiedChurches ?? 0,
    totalChurchMembers: totalMembers ?? 0, nationsWithChurches,
  });
});

// PUT /admin/churches/:id/verify — { verified: boolean }
router.put("/churches/:id/verify", requireRole("admin_church"), async (req, res) => {
  const adminId = (req as any).adminUserId as string;
  const id = req.params.id as string;
  const { verified } = req.body as { verified?: boolean };

  const { data, error } = await supabaseWrite
    .from("p2p_churches")
    .update({ is_verified: verified !== false, verified_at: verified !== false ? new Date().toISOString() : null, verified_by: verified !== false ? adminId : null })
    .eq("id", id)
    .select("*").single();
  if (error || !data) return err(res, error?.message ?? "Church not found", 404);

  await logAdminActivity({
    adminId, adminRole: (req as any).adminRole, actionType: verified !== false ? "church_verified" : "church_unverified",
    targetResourceId: id, targetResourceType: "church",
  });

  return ok(res, mapAdminChurch(data as Record<string, unknown>, 0));
});

export default router;
