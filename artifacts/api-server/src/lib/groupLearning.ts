import { supabaseServiceRole as db } from "./supabase";

// Group learning (Family + Church) — shared by routes/groupLearning.ts and
// the Family "Continue Study" card (routes/familyWorship.ts). Content always
// comes from the CENTRAL P2P library (p2p_curriculums / p2p_modules /
// p2p_lessons, published only); groups store references (migration 199).

export type GroupScope = "family" | "church";
export const GROUP_SCOPES: readonly GroupScope[] = ["family", "church"];
const CHURCH_LEADERSHIP = ["senior_pastor", "discipleship_pastor", "small_group_leader"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
export const scopeColumn = (scope: GroupScope) => (scope === "family" ? "family_id" : "church_id");

/** Active member of THIS family / church (never "the user's group"). */
export async function isGroupMember(scope: GroupScope, groupId: string, userId: string): Promise<boolean> {
  if (scope === "family") {
    const { data } = await db.from("p2p_family_members").select("id").eq("family_id", groupId).eq("user_id", userId).eq("status", "active").maybeSingle();
    return !!data;
  }
  const { data } = await db.from("p2p_church_members").select("id").eq("church_id", groupId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  return !!data;
}

/** Who may choose / change the group's learning: Family Shepherd or Co-Shepherd; church leadership. */
export async function canManageGroupLearning(scope: GroupScope, groupId: string, userId: string): Promise<boolean> {
  if (scope === "family") {
    const { data: fam } = await db.from("p2p_families").select("shepherd_id").eq("id", groupId).maybeSingle();
    if (fam?.shepherd_id === userId) return true;
    const { data } = await db.from("p2p_family_members").select("role").eq("family_id", groupId).eq("user_id", userId).eq("status", "active").maybeSingle();
    return data?.role === "co_shepherd";
  }
  const { data } = await db.from("p2p_church_members").select("role").eq("church_id", groupId).eq("user_id", userId).eq("is_active", true).maybeSingle();
  return !!data && CHURCH_LEADERSHIP.includes(data.role as string);
}

/** May this person review a group Comprehensive Check's submissions: a group leader, or its creator while still a member. */
export async function canReviewGroupAssignment(scope: GroupScope, a: Record<string, unknown>, userId: string): Promise<boolean> {
  const groupId = a[scopeColumn(scope)] as string;
  if (await canManageGroupLearning(scope, groupId, userId)) return true;
  return a.created_by === userId && (await isGroupMember(scope, groupId, userId));
}

export interface OutlineLesson { id: string; title: string; moduleId: string; moduleTitle: string }
export interface CurriculumOutline {
  curriculum: { id: string; title: string; subtitle: string | null; type: string; coverImage: string | null };
  modules: { id: string; title: string; lessons: { id: string; title: string }[] }[];
  lessons: OutlineLesson[]; // flattened, in study order
}

/** A published central curriculum (core or plan) with its published lessons in order; null if not selectable. */
export async function getCurriculumOutline(curriculumId: string): Promise<CurriculumOutline | null> {
  if (!isUuid(curriculumId)) return null;
  const { data: cur } = await db.from("p2p_curriculums").select("id,title,subtitle,type,status,is_visible,cover_image,thumbnail_url").eq("id", curriculumId).maybeSingle();
  if (!cur || cur.status !== "published" || cur.is_visible === false || !["core", "plan"].includes(cur.type as string)) return null;
  const { data: mods } = await db.from("p2p_modules").select("id,title,order_index").eq("curriculum_id", curriculumId).order("order_index", { ascending: true });
  const modules = (mods ?? []) as { id: string; title: string; order_index: number }[];
  const { data: les } = modules.length
    ? await db.from("p2p_lessons").select("id,title,module_id,order_index").in("module_id", modules.map((m) => m.id)).eq("status", "published")
    : { data: [] as { id: string; title: string; module_id: string; order_index: number }[] };
  const byModule = new Map<string, { id: string; title: string; order_index: number }[]>();
  for (const l of (les ?? []) as { id: string; title: string; module_id: string; order_index: number }[]) {
    const list = byModule.get(l.module_id) ?? [];
    list.push(l);
    byModule.set(l.module_id, list);
  }
  const outlineModules = modules.map((m) => ({
    id: m.id, title: m.title,
    lessons: (byModule.get(m.id) ?? []).sort((a, b) => a.order_index - b.order_index).map((l) => ({ id: l.id, title: l.title })),
  })).filter((m) => m.lessons.length > 0);
  return {
    curriculum: { id: cur.id as string, title: cur.title as string, subtitle: (cur.subtitle as string | null) ?? null, type: cur.type as string,
      coverImage: (cur.thumbnail_url as string | null) ?? (cur.cover_image as string | null) ?? null },
    modules: outlineModules,
    lessons: outlineModules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: l.title, moduleId: m.id, moduleTitle: m.title }))),
  };
}

/**
 * Lessons this group has covered TOGETHER in a journey: lessons marked
 * covered (p2p_group_lesson_completions) plus lessons a finished Gathering
 * (family) / church call studied. Personal progress is never used here.
 */
export async function getGroupCovered(scope: GroupScope, groupId: string, journeyId: string, lessonIds: string[]): Promise<Set<string>> {
  const covered = new Set<string>();
  const { data: marks } = await db.from("p2p_group_lesson_completions").select("lesson_id").eq("journey_id", journeyId);
  for (const m of (marks ?? []) as { lesson_id: string }[]) covered.add(m.lesson_id);
  if (lessonIds.length) {
    const { data: sessions } = scope === "family"
      ? await db.from("p2p_family_worship_history").select("lesson_id").eq("family_id", groupId).in("lesson_id", lessonIds)
      : await db.from("p2p_church_calls").select("lesson_id").eq("church_id", groupId).eq("status", "ended").in("lesson_id", lessonIds);
    for (const s of (sessions ?? []) as { lesson_id: string | null }[]) if (s.lesson_id) covered.add(s.lesson_id);
  }
  return covered;
}

/** The caller's OWN lesson progress within these lessons (kept separate from group progress). */
export async function getPersonalProgress(userId: string, lessonIds: string[]): Promise<{ completed: number; submitted: number }> {
  if (!lessonIds.length) return { completed: 0, submitted: 0 };
  const { data } = await db.from("p2p_lesson_progress").select("lesson_id,status,completed").eq("user_id", userId).in("lesson_id", lessonIds);
  let completed = 0, submitted = 0;
  for (const r of (data ?? []) as { status: string | null; completed: boolean | null }[]) {
    if (r.status === "completed" || (r.status == null && r.completed)) completed++;
    else if (r.status === "submitted") submitted++;
  }
  return { completed, submitted };
}

export type JourneyRow = {
  id: string; family_id: string | null; church_id: string | null; curriculum_id: string; current_lesson_id: string | null;
  status: "active" | "paused" | "completed"; started_by: string | null; started_at: string; paused_at: string | null; completed_at: string | null; updated_at: string;
};

export async function getActiveJourney(scope: GroupScope, groupId: string): Promise<JourneyRow | null> {
  const { data, error } = await db.from("p2p_group_learning_journeys").select("*").eq(scopeColumn(scope), groupId).eq("status", "active").maybeSingle();
  if (error) return null; // before migration 199: no journeys
  return (data as JourneyRow | null) ?? null;
}

/** Everything a Learning home / Continue card needs about one journey. */
export async function summarizeJourney(scope: GroupScope, groupId: string, journey: JourneyRow, userId: string) {
  const outline = await getCurriculumOutline(journey.curriculum_id);
  if (!outline) return null;
  const ids = outline.lessons.map((l) => l.id);
  const covered = await getGroupCovered(scope, groupId, journey.id, ids);
  const current = outline.lessons.find((l) => l.id === journey.current_lesson_id)
    ?? outline.lessons.find((l) => !covered.has(l.id)) ?? null;
  const personal = await getPersonalProgress(userId, ids);
  return {
    id: journey.id, status: journey.status, startedAt: journey.started_at, pausedAt: journey.paused_at, completedAt: journey.completed_at,
    curriculum: outline.curriculum,
    currentLesson: current ? { id: current.id, title: current.title, moduleTitle: current.moduleTitle } : null,
    group: { covered: ids.filter((id) => covered.has(id)).length, total: ids.length, coveredLessonIds: ids.filter((id) => covered.has(id)) },
    personal: { completed: personal.completed, submitted: personal.submitted, total: ids.length },
    modules: outline.modules,
  };
}
