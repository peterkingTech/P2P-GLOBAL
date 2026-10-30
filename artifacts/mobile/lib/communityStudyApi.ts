import { apiRequest } from "@/lib/apiClient";

// Custom studies and study plans for a community — a Family Circle or a
// Church. Both communities use the same endpoints under their own prefix
// (/family/… and /churches/…); the server resolves who is calling from the
// session (verifyCaller) and enforces membership and leadership separately
// for each, so family and church records never mix. lib/familyStudyApi,
// lib/churchStudyApi and their *StudyPlanApi siblings are the named views of
// this one implementation.

export type CommunityScope = "family" | "church";
const PREFIX: Record<CommunityScope, string> = { family: "/family", church: "/churches" };

export type CustomStudyStatus = "draft" | "published" | "archived";
export interface CustomStudyMedia { provider: string; id: string; url: string | null }

export interface CommunityStudyBase {
  id: string; createdBy: string | null;
  title: string; description: string | null; status: CustomStudyStatus;
  orderIndex: number; createdAt: string; updatedAt: string;
}

export interface CommunityStudyLesson {
  id: string; studyId: string; title: string; description: string | null;
  scriptureReferences: unknown[]; teachingMaterial: string | null;
  questions: unknown[]; prayerFocus: string | null; media: CustomStudyMedia | null;
  orderIndex: number; createdAt: string; updatedAt: string;
  // Authoring (migration 200): per-lesson status, version, tags, links.
  status?: "draft" | "published" | "archived"; publishedAt?: string | null; version?: number;
  tags?: string[]; resources?: { title: string; url: string }[];
}

export type NewStudyLesson = {
  title: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
  questions?: unknown[]; prayerFocus?: string | null; orderIndex?: number; media?: CustomStudyMedia | null;
  tags?: string[]; resources?: { title: string; url: string }[]; status?: "published";
};
export type StudyLessonUpdates = {
  title?: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
  questions?: unknown[]; prayerFocus?: string | null; media?: CustomStudyMedia | null; orderIndex?: number;
  tags?: string[]; resources?: { title: string; url: string }[];
};

/** Custom studies for one kind of community. `S` is that community's study record type. */
export function communityStudyApi<S extends CommunityStudyBase>(scope: CommunityScope) {
  const p = PREFIX[scope];
  return {
    getStudies: (ownerId: string): Promise<S[]> => apiRequest(`${p}/${ownerId}/studies`),
    getStudy: (studyId: string): Promise<{ study: S; lessons: CommunityStudyLesson[]; canManage?: boolean }> => apiRequest(`${p}/studies/${studyId}`),
    createStudy: (ownerId: string, title: string, description?: string): Promise<S> =>
      apiRequest(`${p}/${ownerId}/studies`, { method: "POST", body: JSON.stringify({ title, description }) }),
    updateStudy: (studyId: string, updates: { title?: string; description?: string | null; status?: CustomStudyStatus; orderIndex?: number }): Promise<S> =>
      apiRequest(`${p}/studies/${studyId}`, { method: "PUT", body: JSON.stringify(updates) }),
    archiveStudy: (studyId: string): Promise<S> => apiRequest(`${p}/studies/${studyId}/archive`, { method: "POST" }),
    addLesson: (studyId: string, lesson: NewStudyLesson): Promise<CommunityStudyLesson> =>
      apiRequest(`${p}/studies/${studyId}/lessons`, { method: "POST", body: JSON.stringify(lesson) }),
    updateLesson: (studyId: string, lessonId: string, updates: StudyLessonUpdates): Promise<CommunityStudyLesson> =>
      apiRequest(`${p}/studies/${studyId}/lessons/${lessonId}`, { method: "PUT", body: JSON.stringify(updates) }),
    removeLesson: (studyId: string, lessonId: string): Promise<{ removed: true }> =>
      apiRequest(`${p}/studies/${studyId}/lessons/${lessonId}`, { method: "DELETE" }),
    // Draft / published / archived for one lesson (leaders only; server-enforced).
    setLessonStatus: (studyId: string, lessonId: string, status: "draft" | "published" | "archived"): Promise<CommunityStudyLesson> =>
      apiRequest(`${p}/studies/${studyId}/lessons/${lessonId}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  };
}

// ── Study plans (an ordered list of references to existing P2P lessons) ────
export type StudyPlanStatus = "draft" | "published" | "archived";
export interface CommunityStudyPlanBase {
  id: string; createdBy: string | null;
  title: string; description: string | null; status: StudyPlanStatus;
  createdAt: string; updatedAt: string;
}
// A plan item is a REFERENCE to an existing p2p_lessons row — lessonTitle is
// for display only, never authored/stored here. `done` reflects the
// community's own coverage of that lesson, not one member's personal progress.
export interface CommunityStudyPlanItem {
  itemId: string; lessonId: string; orderIndex: number;
  lessonTitle: string; lessonStatus: string | null;
  done?: boolean; progressStatus?: string;
}
export interface CommunityStudyPlanDetail<P extends CommunityStudyPlanBase> {
  plan: P;
  items: CommunityStudyPlanItem[];
  progress: { completed: number; total: number; currentItemId: string | null };
}

export function communityStudyPlanApi<P extends CommunityStudyPlanBase>(scope: CommunityScope) {
  const p = PREFIX[scope];
  return {
    getPlans: (ownerId: string): Promise<P[]> => apiRequest(`${p}/${ownerId}/study-plans`),
    getPlan: (planId: string): Promise<CommunityStudyPlanDetail<P>> => apiRequest(`${p}/study-plans/${planId}`),
    createPlan: (ownerId: string, title: string, description?: string): Promise<P> =>
      apiRequest(`${p}/${ownerId}/study-plans`, { method: "POST", body: JSON.stringify({ title, description }) }),
    updatePlan: (planId: string, updates: { title?: string; description?: string | null }): Promise<P> =>
      apiRequest(`${p}/study-plans/${planId}`, { method: "PUT", body: JSON.stringify(updates) }),
    publishPlan: (planId: string): Promise<P> => apiRequest(`${p}/study-plans/${planId}/publish`, { method: "POST" }),
    archivePlan: (planId: string): Promise<P> => apiRequest(`${p}/study-plans/${planId}/archive`, { method: "POST" }),
    addLesson: (planId: string, lessonId: string): Promise<CommunityStudyPlanItem> =>
      apiRequest(`${p}/study-plans/${planId}/items`, { method: "POST", body: JSON.stringify({ lessonId }) }),
    removeLesson: (planId: string, itemId: string): Promise<{ removed: true }> =>
      apiRequest(`${p}/study-plans/${planId}/items/${itemId}`, { method: "DELETE" }),
    reorder: (planId: string, itemIds: string[]): Promise<CommunityStudyPlanItem[]> =>
      apiRequest(`${p}/study-plans/${planId}/reorder`, { method: "PUT", body: JSON.stringify({ itemIds }) }),
  };
}
