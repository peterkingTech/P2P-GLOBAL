import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalTimelineEntry } from "@/contexts/data/types";

// My Discipleship Journal: every Personal Reflection the person has answered in
// a Kingdom School lesson or a Kingdom Stories chapter (both are stored as
// p2p_submissions on a lesson — a story chapter's lesson lives in the hidden
// Kingdom Stories system course, type 'kingdom_story'). Only the person's own
// answers (RLS: users read their own submissions); the latest answer per
// question. Family / Church lesson reflections are already in the Journal
// (p2p_journal_reflections), so they aren't repeated here.

const MAX = 500;
const pick = <T,>(rows: unknown): T[] => (Array.isArray(rows) ? (rows as T[]) : []);
const chunks = <T,>(list: T[], size = 150): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
async function inChunks<T>(ids: string[], load: (part: string[]) => PromiseLike<{ data: unknown }>): Promise<T[]> {
  const parts = await Promise.all(chunks(Array.from(new Set(ids.filter(Boolean)))).map((p) => load(p)));
  return parts.flatMap((r) => pick<T>(r.data));
}

const duration = (s: number | null) => (s ? ` (${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")})` : "");

export async function getLessonReflectionEntries(supabase: SupabaseClient, userId: string): Promise<JournalTimelineEntry[]> {
  const { data, error } = await supabase.from("p2p_submissions")
    .select("id,lesson_id,reflection_question_id,submission_type,text_content,duration_seconds,created_at")
    .eq("user_id", userId).not("reflection_question_id", "is", null)
    .order("created_at", { ascending: false }).limit(MAX);
  if (error) return [];
  type Sub = { id: string; lesson_id: string; reflection_question_id: string; submission_type: string | null; text_content: string | null; duration_seconds: number | null; created_at: string };
  // Latest answer per question.
  const seen = new Set<string>();
  const subs = pick<Sub>(data).filter((s) => (seen.has(s.reflection_question_id) ? false : (seen.add(s.reflection_question_id), true)));
  if (!subs.length) return [];

  type Q = { id: string; question: string };
  type L = { id: string; title: string; module_id: string };
  type M = { id: string; curriculum_id: string };
  type C = { id: string; title: string; type: string | null };
  type Ch = { lesson_id: string; id: string; story_id: string; chapter_number: number; title: string | null };
  type St = { id: string; title: string };
  const [questions, lessons] = await Promise.all([
    inChunks<Q>(subs.map((s) => s.reflection_question_id), (p) => supabase.from("p2p_reflection_questions").select("id,question").in("id", p)),
    inChunks<L>(subs.map((s) => s.lesson_id), (p) => supabase.from("p2p_lessons").select("id,title,module_id").in("id", p)),
  ]);
  const modules = await inChunks<M>(lessons.map((l) => l.module_id), (p) => supabase.from("p2p_modules").select("id,curriculum_id").in("id", p));
  const courses = await inChunks<C>(modules.map((m) => m.curriculum_id), (p) => supabase.from("p2p_curriculums").select("id,title,type").in("id", p));
  const qById = new Map(questions.map((q) => [q.id, q.question]));
  const lById = new Map(lessons.map((l) => [l.id, l]));
  const mById = new Map(modules.map((m) => [m.id, m]));
  const cById = new Map(courses.map((c) => [c.id, c]));
  const courseOf = (lessonId: string) => { const l = lById.get(lessonId); const m = l ? mById.get(l.module_id) : null; return m ? cById.get(m.curriculum_id) ?? null : null; };

  // Story chapters behind Kingdom Stories lessons (story title + chapter number).
  const storyLessonIds = subs.map((s) => s.lesson_id).filter((id) => courseOf(id)?.type === "kingdom_story");
  const chapters = storyLessonIds.length
    ? await inChunks<Ch>(storyLessonIds, (p) => supabase.from("p2p_kingdom_story_chapters").select("lesson_id,id,story_id,chapter_number,title").in("lesson_id", p)).catch(() => [] as Ch[])
    : [];
  const stories = chapters.length ? await inChunks<St>(chapters.map((c) => c.story_id), (p) => supabase.from("p2p_kingdom_stories").select("id,title").in("id", p)).catch(() => [] as St[]) : [];
  const chByLesson = new Map(chapters.map((c) => [c.lesson_id, c]));
  const stById = new Map(stories.map((s) => [s.id, s.title]));

  return subs.map((s): JournalTimelineEntry => {
    const lesson = lById.get(s.lesson_id);
    const course = courseOf(s.lesson_id);
    const chapter = chByLesson.get(s.lesson_id);
    const isStory = course?.type === "kingdom_story";
    const answer = s.text_content?.trim() || (s.submission_type === "audio" ? `🎙 Voice reflection${duration(s.duration_seconds)}` : s.submission_type === "video" ? `🎥 Video reflection${duration(s.duration_seconds)}` : "Reflection");
    const title = isStory
      ? [chapter ? stById.get(chapter.story_id) : null, chapter ? `Chapter ${chapter.chapter_number}` : lesson?.title].filter(Boolean).join(" · ")
      : [course?.title, lesson?.title].filter(Boolean).join(" · ");
    return {
      type: "lesson_reflection", id: s.id, at: s.created_at,
      label: isStory ? "Kingdom Stories" : "Kingdom School",
      title: title || "Personal Reflection",
      prompt: qById.get(s.reflection_question_id),
      preview: answer,
      route: isStory && chapter
        ? { pathname: "/kingdom-stories/chapter", params: { id: chapter.story_id, chapter: chapter.id } }
        : { pathname: "/lesson/[id]", params: { id: s.lesson_id } },
    };
  });
}
