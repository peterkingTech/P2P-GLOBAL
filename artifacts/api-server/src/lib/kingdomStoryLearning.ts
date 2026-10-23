// Kingdom Stories storybook learning (migration 212): each chapter is a lesson
// of the hidden "Kingdom Stories (system)" curriculum, so its reflections,
// Comprehensive Check, submissions, peer review and progress are the Core
// Curriculum ones. This module only READS that state to tell the storybook
// which chapters are open; the database enforces the same rule on every
// submission and progress write (p2p_kingdom_story_chapter_open).
//
// Chapter rule (as Kingdom School / Plans): chapter 1 is open; chapter N opens
// once chapter N-1 is submitted or completed — waiting for a peer review never
// blocks reading on.
import { supabaseServiceRole as db } from "./supabase";

export type ChapterState = "locked" | "available" | "in_progress" | "awaiting_review" | "completed" | "preview";

export interface ChapterLearning {
  lessonId: string | null;
  state: ChapterState;
  /** What is still needed before the next chapter opens. */
  remaining: Array<"comprehensive_check" | "finish_reading">;
  reflectionQuestions: Array<{ id: string; question: string }>;
  check: { assignmentId: string; title: string; questions: Array<{ id: string; question: string }> } | null;
  reflectionsAnswered: number;
}

export interface StoryProgress {
  totalChapters: number;
  completedChapters: number;     // peer-approved (or finished, where a chapter has no check)
  awaitingReviewChapters: number; // check submitted, a fellow peer is reviewing
  currentChapterId: string | null; // first open chapter not yet finished
  started: boolean;
  finished: boolean;              // every chapter submitted or completed
}

type ChapterRow = { id: string; chapterNumber: number; lessonId?: string | null };

/** Learning state of every chapter of one story for one reader. */
export async function chapterLearning(story: { id: string; status: string }, chapters: ChapterRow[], userId: string, preview: boolean): Promise<{ byChapter: Map<string, ChapterLearning>; progress: StoryProgress }> {
  const lessonIds = chapters.map((c) => c.lessonId).filter((x): x is string => !!x);
  const [rq, asg, prog, subs] = lessonIds.length ? await Promise.all([
    db.from("p2p_reflection_questions").select("id,lesson_id,question,display_order").in("lesson_id", lessonIds).order("display_order", { ascending: true }),
    db.from("p2p_assignments").select("id,lesson_id,title").in("lesson_id", lessonIds),
    db.from("p2p_lesson_progress").select("lesson_id,status,completed").eq("user_id", userId).in("lesson_id", lessonIds),
    db.from("p2p_submissions").select("lesson_id,reflection_question_id,assignment_question_id").eq("user_id", userId).in("lesson_id", lessonIds),
  ]) : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }] as any[];

  const reflections = new Map<string, Array<{ id: string; question: string }>>();
  for (const r of (rq.data ?? []) as any[]) (reflections.get(r.lesson_id) ?? reflections.set(r.lesson_id, []).get(r.lesson_id)!).push({ id: r.id, question: r.question });
  const checks = new Map<string, ChapterLearning["check"]>();
  const asgIds = ((asg.data ?? []) as any[]).map((a) => a.id as string);
  const { data: aqs } = asgIds.length
    ? await db.from("p2p_assignment_questions").select("id,assignment_id,question,display_order").in("assignment_id", asgIds).order("display_order", { ascending: true })
    : { data: [] as any[] };
  for (const a of (asg.data ?? []) as any[]) {
    const qs = ((aqs ?? []) as any[]).filter((x) => x.assignment_id === a.id).map((x) => ({ id: x.id, question: x.question }));
    checks.set(a.lesson_id, { assignmentId: a.id, title: a.title || "Comprehensive Check", questions: qs });
  }
  const progressBy = new Map<string, string>();
  for (const p of (prog.data ?? []) as any[]) progressBy.set(p.lesson_id, p.completed ? "completed" : p.status);
  const answered = new Map<string, Set<string>>();
  const touched = new Set<string>();
  for (const s of (subs.data ?? []) as any[]) {
    touched.add(s.lesson_id);
    if (s.reflection_question_id) (answered.get(s.lesson_id) ?? answered.set(s.lesson_id, new Set()).get(s.lesson_id)!).add(s.reflection_question_id);
  }

  const byChapter = new Map<string, ChapterLearning>();
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);
  // No learning rows at all (migration 212 not applied, or a story published
  // before it): reading only — every chapter open, nothing tracked or locked.
  const linked = lessonIds.length > 0;
  let prevDone = true;
  let completed = 0, awaiting = 0, current: string | null = null, started = false;
  for (const ch of ordered) {
    const lid = ch.lessonId ?? null;
    const p = lid ? progressBy.get(lid) : undefined;
    const done = p === "completed" || p === "submitted";
    const open = preview || !linked || prevDone || done || (lid ? touched.has(lid) : false);
    let state: ChapterState;
    if (preview || story.status !== "published") state = "preview";
    else if (!linked) state = "available";
    else if (p === "completed") state = "completed";
    else if (p === "submitted") state = "awaiting_review";
    else if (!open) state = "locked";
    else if (lid && touched.has(lid)) state = "in_progress";
    else state = "available";
    const check = lid ? checks.get(lid) ?? null : null;
    const remaining: ChapterLearning["remaining"] = state === "locked" || state === "preview" || done || !lid ? [] : [check ? "comprehensive_check" : "finish_reading"];
    byChapter.set(ch.id, {
      lessonId: lid, state, remaining,
      reflectionQuestions: lid ? reflections.get(lid) ?? [] : [],
      check, reflectionsAnswered: lid ? answered.get(lid)?.size ?? 0 : 0,
    });
    if (p === "completed") completed++;
    if (p === "submitted") awaiting++;
    if (p || (lid && touched.has(lid))) started = true;
    if (!current && open && !done) current = ch.id;
    prevDone = done;
  }
  return {
    byChapter,
    progress: {
      totalChapters: ordered.length, completedChapters: completed, awaitingReviewChapters: awaiting,
      currentChapterId: current ?? (ordered.length && completed + awaiting < ordered.length ? ordered[0].id : null),
      started, finished: ordered.length > 0 && completed + awaiting === ordered.length,
    },
  };
}

/** Reading progress for many stories at once (story cards). */
export async function storiesProgress(storyIds: string[], userId: string): Promise<Map<string, { totalChapters: number; doneChapters: number; started: boolean }>> {
  const out = new Map<string, { totalChapters: number; doneChapters: number; started: boolean }>();
  if (!storyIds.length) return out;
  const { data: chs } = await db.from("p2p_kingdom_story_chapters").select("story_id,lesson_id").in("story_id", storyIds);
  const lessonToStory = new Map<string, string>();
  for (const id of storyIds) out.set(id, { totalChapters: 0, doneChapters: 0, started: false });
  for (const c of (chs ?? []) as any[]) {
    out.get(c.story_id)!.totalChapters++;
    if (c.lesson_id) lessonToStory.set(c.lesson_id, c.story_id);
  }
  if (!lessonToStory.size) return out;
  const { data: prog } = await db.from("p2p_lesson_progress").select("lesson_id,status,completed").eq("user_id", userId).in("lesson_id", [...lessonToStory.keys()]);
  for (const p of (prog ?? []) as any[]) {
    const s = out.get(lessonToStory.get(p.lesson_id)!)!;
    s.started = true;
    if (p.completed || p.status === "submitted" || p.status === "completed") s.doneChapters++;
  }
  return out;
}

/** Fields a reader must not receive for a locked chapter (its title stays visible). */
export function lockChapter<T extends Record<string, any>>(ch: T): T {
  return {
    ...ch, narrative: "", people: null, places: null, dates: null, scriptureRefs: null,
    evidence: { documented: null, testimony: null, tradition: null, disputed: null },
    lessons: [], reflections: [], assignment: null, sources: [],
  };
}
