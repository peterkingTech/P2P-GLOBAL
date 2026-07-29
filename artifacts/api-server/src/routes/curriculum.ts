import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
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

export default router;
