import { supabaseServiceRole as db } from "./supabase";
import { type GroupScope, scopeColumn, getActiveJourney, getCurriculumOutline, getGroupCovered } from "./groupLearning";

// Group progress + Gathering summaries (Prompt 8) — read-only views over the
// existing tables: journeys (199), assignments/submissions (201), Gathering
// notes (124 family, 131 church), lesson progress. Nothing here writes, and
// nothing here ever reads private notes, private reflections or drafts.

const lessonCol = (scope: GroupScope) => (scope === "family" ? "family_lesson_id" : "church_lesson_id");
const lessonTable = (scope: GroupScope) => (scope === "family" ? "p2p_family_study_lessons" : "p2p_church_study_lessons");

async function lessonTitles(scope: GroupScope, ids: string[]) {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const { data } = await db.from(lessonTable(scope)).select("id,title").in("id", ids);
  for (const r of (data ?? []) as { id: string; title: string }[]) m.set(r.id, r.title);
  return m;
}

/** Latest attempt per (assignment, user). */
function latestByKey<T extends { assignment_id: string; user_id: string; attempt: number }>(rows: T[]) {
  const m = new Map<string, T>();
  for (const r of rows) {
    const k = `${r.assignment_id}:${r.user_id}`;
    if (!m.has(k) || m.get(k)!.attempt < r.attempt) m.set(k, r);
  }
  return [...m.values()];
}

/**
 * Assignments awaiting action in this group:
 *  - toDo: published assignments the viewer hasn't submitted yet, or that
 *    were returned to them (their OWN state only).
 *  - toReview (leaders only): how many members' latest submissions wait for review.
 * Before migration 201 there are no assignments: both lists are empty.
 */
export async function getWorkStatus(scope: GroupScope, groupId: string, userId: string, canManage: boolean) {
  const empty = { toDo: [] as { assignmentId: string; title: string; lessonId: string; lessonTitle: string | null; dueAt: string | null; state: "not_started" | "returned" }[],
    toReview: [] as { assignmentId: string; title: string; lessonId: string; lessonTitle: string | null; waiting: number }[] };
  const { data: asg, error } = await db.from("p2p_group_assignments").select("id,title,due_at,status,family_lesson_id,church_lesson_id")
    .eq(scopeColumn(scope), groupId).eq("status", "published");
  if (error || !asg?.length) return empty;
  const ids = asg.map((a) => a.id as string);
  const titles = await lessonTitles(scope, [...new Set(asg.map((a) => a[lessonCol(scope)] as string))]);

  const { data: mine } = await db.from("p2p_group_assignment_submissions").select("assignment_id,user_id,attempt,status").eq("user_id", userId).in("assignment_id", ids);
  const myLatest = new Map(latestByKey((mine ?? []) as { assignment_id: string; user_id: string; attempt: number; status: string }[]).map((r) => [r.assignment_id, r]));
  for (const a of asg) {
    const latest = myLatest.get(a.id as string);
    if (latest && latest.status !== "returned") continue;
    const lessonId = a[lessonCol(scope)] as string;
    empty.toDo.push({ assignmentId: a.id as string, title: a.title as string, lessonId, lessonTitle: titles.get(lessonId) ?? null, dueAt: (a.due_at as string | null) ?? null,
      state: latest ? "returned" : "not_started" });
  }
  empty.toDo.sort((x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999"));

  if (canManage) {
    const { data: all } = await db.from("p2p_group_assignment_submissions").select("assignment_id,user_id,attempt,status").in("assignment_id", ids);
    const waiting = new Map<string, number>();
    for (const r of latestByKey((all ?? []) as { assignment_id: string; user_id: string; attempt: number; status: string }[]))
      if (r.status === "submitted") waiting.set(r.assignment_id, (waiting.get(r.assignment_id) ?? 0) + 1);
    for (const a of asg) {
      const n = waiting.get(a.id as string) ?? 0;
      if (!n) continue;
      const lessonId = a[lessonCol(scope)] as string;
      empty.toReview.push({ assignmentId: a.id as string, title: a.title as string, lessonId, lessonTitle: titles.get(lessonId) ?? null, waiting: n });
    }
  }
  return empty;
}

/**
 * Each member's OWN completion of the active journey's lessons — shown only
 * where the existing product already lets the group see it: church
 * leadership, for members who haven't opted out of leadership visibility
 * (p2p_church_members.profile_visible_to_leadership, the same rule as the
 * church member profile). Families have no such rule today, so: null.
 * Counts only — never answers, reflections or drafts.
 */
export async function getMemberJourneyProgress(scope: GroupScope, groupId: string, canManage: boolean) {
  if (scope !== "church" || !canManage) return null;
  const journey = await getActiveJourney(scope, groupId);
  if (!journey) return null;
  const outline = await getCurriculumOutline(journey.curriculum_id);
  if (!outline) return null;
  const lessonIds = outline.lessons.map((l) => l.id);
  const { data: members } = await db.from("p2p_church_members").select("user_id,profile_visible_to_leadership").eq("church_id", groupId).eq("is_active", true);
  const visible = ((members ?? []) as { user_id: string; profile_visible_to_leadership: boolean | null }[]).filter((m) => m.profile_visible_to_leadership !== false).map((m) => m.user_id);
  const hiddenCount = (members ?? []).length - visible.length;
  if (!visible.length || !lessonIds.length) return { total: lessonIds.length, members: [], hiddenCount };
  const [{ data: profiles }, { data: progress }] = await Promise.all([
    db.from("p2p_profiles").select("id,full_name").in("id", visible),
    db.from("p2p_lesson_progress").select("user_id,lesson_id,status,completed").in("user_id", visible).in("lesson_id", lessonIds),
  ]);
  const by = new Map<string, { completed: number; submitted: number }>();
  for (const r of (progress ?? []) as { user_id: string; status: string | null; completed: boolean | null }[]) {
    const c = by.get(r.user_id) ?? { completed: 0, submitted: 0 };
    if (r.status === "completed" || (r.status == null && r.completed)) c.completed++;
    else if (r.status === "submitted") c.submitted++;
    by.set(r.user_id, c);
  }
  const name = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "A member"]));
  return {
    total: lessonIds.length, hiddenCount,
    members: visible.map((u) => ({ userId: u, name: name.get(u) ?? "A member", ...(by.get(u) ?? { completed: 0, submitted: 0 }) }))
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name)),
  };
}

/**
 * "Next time": where the group's active journey continues — the current
 * lesson unless it has been covered (marked, or studied in a Gathering),
 * then the next uncovered lesson in order. A reference only.
 */
export async function getResumeLesson(scope: GroupScope, groupId: string) {
  const journey = await getActiveJourney(scope, groupId);
  if (!journey) return null;
  const outline = await getCurriculumOutline(journey.curriculum_id);
  if (!outline) return null;
  const covered = await getGroupCovered(scope, groupId, journey.id, outline.lessons.map((l) => l.id));
  const start = Math.max(0, outline.lessons.findIndex((l) => l.id === journey.current_lesson_id));
  const next = outline.lessons.slice(start).find((l) => !covered.has(l.id)) ?? outline.lessons.find((l) => !covered.has(l.id)) ?? null;
  return {
    curriculum: { id: outline.curriculum.id, title: outline.curriculum.title },
    lesson: next ? { id: next.id, title: next.title, moduleTitle: next.moduleTitle } : null,
    covered: outline.lessons.filter((l) => covered.has(l.id)).length, total: outline.lessons.length,
  };
}

/** Notes participants chose to share in this Gathering ('shared' only — never private ones). */
export async function getSharedGatheringNotes(scope: GroupScope, gatheringId: string) {
  const { data } = scope === "family"
    ? await db.from("p2p_family_worship_notes").select("author_id,content,created_at").eq("session_id", gatheringId).eq("visibility", "shared").order("created_at", { ascending: true })
    : await db.from("p2p_church_call_notes").select("author_id,content,created_at").eq("call_id", gatheringId).eq("visibility", "shared").order("created_at", { ascending: true });
  const rows = (data ?? []) as { author_id: string; content: string; created_at: string }[];
  const authors = [...new Set(rows.map((r) => r.author_id))];
  const { data: profiles } = authors.length ? await db.from("p2p_profiles").select("id,full_name").in("id", authors) : { data: [] };
  const name = new Map(((profiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? "Someone"]));
  return rows.map((r) => ({ authorName: name.get(r.author_id) ?? "Someone", content: r.content, at: r.created_at }));
}

/** Assignments published for this group while the Gathering ran (follow-up actions). */
export async function getAssignmentsCreatedDuring(scope: GroupScope, groupId: string, startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return [];
  const { data, error } = await db.from("p2p_group_assignments").select("id,title,due_at,family_lesson_id,church_lesson_id,created_at")
    .eq(scopeColumn(scope), groupId).eq("status", "published").gte("created_at", startedAt).lte("created_at", endedAt);
  if (error || !data?.length) return [];
  const titles = await lessonTitles(scope, [...new Set(data.map((a) => a[lessonCol(scope)] as string))]);
  return data.map((a) => ({ assignmentId: a.id as string, title: a.title as string, dueAt: (a.due_at as string | null) ?? null,
    lessonId: a[lessonCol(scope)] as string, lessonTitle: titles.get(a[lessonCol(scope)] as string) ?? null }));
}
