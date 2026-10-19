import { supabaseServiceRole as db } from "./supabase";
import { mapCustomLesson } from "./customLessons";

// The lesson a Family Gathering is about (Prompt 6). A Gathering stores only
// a reference: lesson_id (a central Core Foundation / P2P Plan lesson,
// migration 129) or family_lesson_id (the family's own lesson, migration
// 202). Content is read from the source tables when someone opens it — never
// copied into the session — and never includes anyone's answers.

export type GatheringLessonKind = "central" | "family";

/** True once migration 202 is live (the session row carries the column). */
export function supportsFamilyLessons(session: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(session, "family_lesson_id");
}

/**
 * A family lesson may be linked to (and opened from) a Gathering only when it
 * belongs to that same family and every member could already see it: its
 * study and the lesson itself are published.
 */
export async function loadFamilyLessonForGathering(familyId: string, lessonId: string) {
  const { data: row } = await db.from("p2p_family_study_lessons").select("*").eq("id", lessonId).maybeSingle();
  if (!row) return { error: "That lesson wasn't found" as const };
  const { data: study } = await db.from("p2p_family_studies").select("id,family_id,title,status").eq("id", row.study_id as string).maybeSingle();
  if (!study || study.family_id !== familyId) return { error: "That lesson wasn't found" as const };
  const lesson = mapCustomLesson(row as Record<string, unknown>);
  if (study.status !== "published" || lesson.status !== "published") {
    return { error: "Only a published lesson can be used in a Gathering" as const };
  }
  return { lesson, study };
}

/** Title for display (session state, history). Null if no longer available. */
export async function gatheringLessonRef(session: Record<string, unknown>): Promise<{ kind: GatheringLessonKind; id: string; title: string; studyId: string | null } | null> {
  if (session.family_lesson_id) {
    const r = await loadFamilyLessonForGathering(session.family_id as string, session.family_lesson_id as string);
    if (r.error !== undefined) return null;
    return { kind: "family", id: r.lesson.id as string, title: r.lesson.title as string, studyId: r.study.id as string };
  }
  if (session.lesson_id) {
    const { data } = await db.from("p2p_lessons").select("id,title,status").eq("id", session.lesson_id as string).maybeSingle();
    if (!data || data.status !== "published") return null;
    return { kind: "central", id: data.id as string, title: data.title as string, studyId: null };
  }
  return null;
}

/**
 * The follow-along view of the Gathering's lesson for any member: lesson text,
 * Scripture references and questions. Read-only, no responses of anyone.
 */
export async function gatheringLessonView(session: Record<string, unknown>) {
  if (session.family_lesson_id) {
    const r = await loadFamilyLessonForGathering(session.family_id as string, session.family_lesson_id as string);
    if (r.error !== undefined) return null;
    const l = r.lesson;
    return {
      kind: "family" as const, id: l.id as string, title: l.title as string, context: r.study.title as string, studyId: r.study.id as string,
      description: (l.description as string | null) ?? null,
      sections: l.teachingMaterial ? [{ title: null, content: l.teachingMaterial as string }] : [],
      scripture: l.scriptureReferences, questions: l.questions.map((q) => ({ id: q.id, text: q.text, kind: q.kind })),
      prayerFocus: (l.prayerFocus as string | null) ?? null, media: l.media, resources: l.resources,
    };
  }
  if (session.lesson_id) {
    const { data: lesson } = await db.from("p2p_lessons").select("id,title,module_id,status").eq("id", session.lesson_id as string).maybeSingle();
    if (!lesson || lesson.status !== "published") return null;
    const [{ data: sections }, { data: questions }, { data: mod }] = await Promise.all([
      db.from("p2p_lesson_sections").select("title,content,section_order").eq("lesson_id", lesson.id as string).order("section_order", { ascending: true }),
      db.from("p2p_reflection_questions").select("id,question,display_order").eq("lesson_id", lesson.id as string).order("display_order", { ascending: true }),
      db.from("p2p_modules").select("title,curriculum_id").eq("id", lesson.module_id as string).maybeSingle(),
    ]);
    const { data: cur } = mod?.curriculum_id
      ? await db.from("p2p_curriculums").select("title").eq("id", mod.curriculum_id as string).maybeSingle()
      : { data: null };
    return {
      kind: "central" as const, id: lesson.id as string, title: lesson.title as string,
      context: [cur?.title, mod?.title].filter(Boolean).join(" · ") || null, studyId: null,
      description: null,
      sections: (sections ?? []).map((s) => ({ title: (s.title as string | null) ?? null, content: (s.content as string | null) ?? "" })),
      scripture: [], questions: (questions ?? []).map((q) => ({ id: q.id as string, text: q.question as string, kind: "reflection" as const })),
      prayerFocus: null, media: null, resources: [],
    };
  }
  return null;
}
