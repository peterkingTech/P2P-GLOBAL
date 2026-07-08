import { Router } from "express";
import { supabase } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";

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
    supabase.from("p2p_modules").select("*").order("sort_order"),
    supabase.from("p2p_lessons").select("id,module_id,title,subtitle,status,sort_order").order("sort_order"),
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
  const { data: langs } = await supabase.from("p2p_languages").select("code").eq("is_default", false);
  const total = (langs ?? []).length;

  const { data: trans } = await supabase
    .from("p2p_lesson_translations")
    .select("language_code")
    .eq("lesson_id", id);

  const done = new Set((trans ?? []).map((t: any) => t.language_code)).size;
  return ok(res, { total, done, label: `${done} of ${total + 1} languages` });
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

export default router;
