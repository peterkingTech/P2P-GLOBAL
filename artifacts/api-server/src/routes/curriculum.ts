import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

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
    .order("sort_order", { ascending: true });

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
    .order("sort_order", { ascending: true });

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
        .order("sort_order", { ascending: true }),
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

// GET /lessons/:lessonId
router.get("/lessons/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  const { data, error } = await supabase
    .from("p2p_lessons")
    .select("*")
    .eq("id", lessonId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Lesson not found" });
  }
  return res.json(mapLesson(data as Record<string, unknown>));
});

export default router;
