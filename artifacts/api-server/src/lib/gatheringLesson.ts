import { supabaseServiceRole as db } from "./supabase";
import { mapCustomLesson } from "./customLessons";

// The lesson a Gathering is about (Prompts 6–7) — a Family Gathering
// (p2p_family_worship_sessions) or a Church Gathering (p2p_church_calls).
// A Gathering stores only a reference: lesson_id (a central Core Foundation /
// P2P Plan lesson) or the group's own lesson (family_lesson_id, migration
// 202; church_lesson_id, migration 204). Content is read from the source
// tables when someone opens it — never copied into the session — and never
// includes anyone's answers.

export type GatheringLessonKind = "central" | "family" | "church";
type Scope = "family" | "church";

const SCOPES = {
  family: { groupCol: "family_id", customCol: "family_lesson_id", lessons: "p2p_family_study_lessons", studies: "p2p_family_studies" },
  church: { groupCol: "church_id", customCol: "church_lesson_id", lessons: "p2p_church_study_lessons", studies: "p2p_church_studies" },
} as const;

/** True once the scope's migration is live (the row carries the column). */
export function supportsCustomLessons(scope: Scope, row: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(row, SCOPES[scope].customCol);
}
export const supportsFamilyLessons = (session: Record<string, unknown>) => supportsCustomLessons("family", session);

/**
 * A group's own lesson may be linked to (and opened from) its Gathering only
 * when it belongs to that same family/church and every member could already
 * see it: its study and the lesson itself are published.
 */
export async function loadCustomLessonForGathering(scope: Scope, groupId: string, lessonId: string) {
  const t = SCOPES[scope];
  const { data: row } = await db.from(t.lessons).select("*").eq("id", lessonId).maybeSingle();
  if (!row) return { error: "That lesson wasn't found" as const };
  const { data: study } = await db.from(t.studies).select(`id,${t.groupCol},title,status`).eq("id", row.study_id as string).maybeSingle();
  if (!study || (study as Record<string, unknown>)[t.groupCol] !== groupId) return { error: "That lesson wasn't found" as const };
  const lesson = mapCustomLesson(row as Record<string, unknown>);
  if (study.status !== "published" || lesson.status !== "published") {
    return { error: "Only a published lesson can be used in a Gathering" as const };
  }
  return { lesson, study: study as { id: string; title: string; status: string } };
}
export const loadFamilyLessonForGathering = (familyId: string, lessonId: string) => loadCustomLessonForGathering("family", familyId, lessonId);

function customOf(row: Record<string, unknown>): { scope: Scope; id: string; groupId: string } | null {
  for (const scope of ["family", "church"] as const) {
    const t = SCOPES[scope];
    if (row[t.customCol]) return { scope, id: row[t.customCol] as string, groupId: row[t.groupCol] as string };
  }
  return null;
}

/** Title for display (session state, history). Null if no longer available. */
export async function gatheringLessonRef(row: Record<string, unknown>): Promise<{ kind: GatheringLessonKind; id: string; title: string; studyId: string | null } | null> {
  const custom = customOf(row);
  if (custom) {
    const r = await loadCustomLessonForGathering(custom.scope, custom.groupId, custom.id);
    if (r.error !== undefined) return null;
    return { kind: custom.scope, id: r.lesson.id as string, title: r.lesson.title as string, studyId: r.study.id };
  }
  if (row.lesson_id) {
    const { data } = await db.from("p2p_lessons").select("id,title,status").eq("id", row.lesson_id as string).maybeSingle();
    if (!data || data.status !== "published") return null;
    return { kind: "central", id: data.id as string, title: data.title as string, studyId: null };
  }
  return null;
}

/**
 * The follow-along view of the Gathering's lesson for any member: lesson text,
 * Scripture references and questions. Read-only, no responses of anyone.
 */
export async function gatheringLessonView(row: Record<string, unknown>) {
  const custom = customOf(row);
  if (custom) {
    const r = await loadCustomLessonForGathering(custom.scope, custom.groupId, custom.id);
    if (r.error !== undefined) return null;
    const l = r.lesson;
    return {
      kind: custom.scope, id: l.id as string, title: l.title as string, context: r.study.title, studyId: r.study.id,
      description: (l.description as string | null) ?? null,
      sections: l.teachingMaterial ? [{ title: null, content: l.teachingMaterial as string }] : [],
      scripture: l.scriptureReferences, questions: l.questions.map((q) => ({ id: q.id, text: q.text, kind: q.kind })),
      prayerFocus: (l.prayerFocus as string | null) ?? null, media: l.media, resources: l.resources,
    };
  }
  if (row.lesson_id) {
    const { data: lesson } = await db.from("p2p_lessons").select("id,title,module_id,status").eq("id", row.lesson_id as string).maybeSingle();
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
