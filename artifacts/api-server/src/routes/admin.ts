import { Router } from "express";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";
import { parsePlanPdf, type ParsedLesson, type ParsedPlan } from "../lib/planPdfParser";

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
  const plan = req.body as ParsedPlan;
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

export default router;
