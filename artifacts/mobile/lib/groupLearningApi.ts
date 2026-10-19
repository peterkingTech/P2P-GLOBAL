import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Unified group Learning for Family Circles and Churches
// (api-server routes/groupLearning.ts, migration 199). Identity always comes
// from the signed-in session on the server; the scope/group id here only says
// WHICH group, and the server checks membership and role for it.

export type GroupScope = "family" | "church";

export class LearningApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new LearningApiError((body as { error?: string }).error ?? "Request failed", res.status);
  return body as T;
}

export interface LibraryItem { id: string; title: string; subtitle: string | null; type: "core" | "plan"; coverImage: string | null; lessonCount: number }
export interface Library { core: LibraryItem[]; categories: { id: string; title: string; plans: LibraryItem[] }[] }
export interface OutlineModule { id: string; title: string; lessons: { id: string; title: string }[] }
export interface CurriculumOutline { curriculum: { id: string; title: string; subtitle: string | null; type: string; coverImage: string | null }; modules: OutlineModule[] }

export interface JourneySummary {
  id: string; status: "active" | "paused" | "completed"; startedAt: string; pausedAt: string | null; completedAt: string | null;
  curriculum: CurriculumOutline["curriculum"];
  currentLesson: { id: string; title: string; moduleTitle: string } | null;
  /** Lessons covered TOGETHER (marked covered, or studied in a Gathering / church call). */
  group: { covered: number; total: number; coveredLessonIds: string[] };
  /** The signed-in person's OWN lesson progress in this series (never the group's). */
  personal: { completed: number; submitted: number; total: number };
  modules: OutlineModule[];
}
export interface JourneyHistoryItem {
  id: string; status: "paused" | "completed"; pausedAt: string | null; completedAt: string | null;
  curriculum: CurriculumOutline["curriculum"]; group: { covered: number; total: number };
}
export interface CustomLessonSummary { id: string; title: string; description: string | null; status: "draft" | "published"; lessonCount: number }
export interface LearningHome {
  scope: GroupScope; groupId: string; canManage: boolean;
  activeJourney: JourneySummary | null; history: JourneyHistoryItem[]; customLessons: CustomLessonSummary[];
}

export const getLibrary = () => authedFetch<Library>("/learning/library");
export const getCurriculumOutline = (curriculumId: string) => authedFetch<CurriculumOutline>(`/learning/curricula/${curriculumId}`);
export const getLearningHome = (scope: GroupScope, groupId: string) => authedFetch<LearningHome>(`/learning/${scope}/${groupId}`);
export const startJourney = (scope: GroupScope, groupId: string, curriculumId: string) =>
  authedFetch<{ journeyId: string; resumed: boolean }>(`/learning/${scope}/${groupId}/journeys`, { method: "POST", body: JSON.stringify({ curriculumId }) });
export const pauseJourney = (scope: GroupScope, groupId: string, journeyId: string) =>
  authedFetch<{ status: string }>(`/learning/${scope}/${groupId}/journeys/${journeyId}/pause`, { method: "POST" });
export const setCurrentLesson = (scope: GroupScope, groupId: string, journeyId: string, lessonId: string) =>
  authedFetch<{ currentLessonId: string }>(`/learning/${scope}/${groupId}/journeys/${journeyId}/current-lesson`, { method: "PUT", body: JSON.stringify({ lessonId }) });
export const markCovered = (scope: GroupScope, groupId: string, journeyId: string, lessonId: string, advance: boolean) =>
  authedFetch<{ covered: boolean; nextLessonId: string | null; completed: boolean }>(`/learning/${scope}/${groupId}/journeys/${journeyId}/covered`, { method: "POST", body: JSON.stringify({ lessonId, advance }) });
export const unmarkCovered = (scope: GroupScope, groupId: string, journeyId: string, lessonId: string) =>
  authedFetch<{ covered: boolean }>(`/learning/${scope}/${groupId}/journeys/${journeyId}/covered/${lessonId}`, { method: "DELETE" });

/** Where a group's own (custom) study opens — existing screens per scope. */
export function customStudyPath(scope: GroupScope, groupId: string, studyId: string) {
  return scope === "family"
    ? { pathname: "/family/studies/[studyId]", params: { studyId, familyId: groupId } }
    : { pathname: "/church/studies/[studyId]", params: { studyId } };
}
/** The existing screen for managing a group's custom studies and study plans. */
export function manageCustomPath(scope: GroupScope, groupId: string) {
  return scope === "family" ? { pathname: "/family/studies", params: { familyId: groupId } } : { pathname: "/church/studies", params: {} };
}
