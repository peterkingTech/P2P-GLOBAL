import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Every route on the server side (routes/familyStudyPlans.ts) resolves
// identity via verifyCaller() — a real Supabase JWT — never a
// client-supplied id. Exact mirror of lib/familyStudyApi.ts's authedFetch,
// kept as its own local copy per this codebase's existing convention.
async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body;
}

export type StudyPlanStatus = "draft" | "published" | "archived";
export type FamilyStudySource = "p2p_curriculum" | "custom_study_plan";

export interface FamilyStudyPlan {
  id: string; familyId: string; createdBy: string | null;
  title: string; description: string | null; status: StudyPlanStatus;
  createdAt: string; updatedAt: string;
}

// A plan item is a REFERENCE to an existing p2p_lessons row — lessonTitle
// is included for display only, never authored/stored here. `done` reflects
// the family's own Gathering history coverage of that lesson, not any one
// member's personal progress (see routes/familyStudyPlans.ts's comment).
export interface FamilyStudyPlanItem {
  itemId: string; lessonId: string; orderIndex: number;
  lessonTitle: string; lessonStatus: string | null;
  done?: boolean;
}

export interface FamilyStudyPlanDetail {
  plan: FamilyStudyPlan;
  items: FamilyStudyPlanItem[];
  progress: { completed: number; total: number; currentItemId: string | null };
}

export function getFamilyStudyPlans(familyId: string): Promise<FamilyStudyPlan[]> {
  return authedFetch(`/family/${familyId}/study-plans`);
}

export function getFamilyStudyPlan(planId: string): Promise<FamilyStudyPlanDetail> {
  return authedFetch(`/family/study-plans/${planId}`);
}

export function createFamilyStudyPlan(familyId: string, title: string, description?: string): Promise<FamilyStudyPlan> {
  return authedFetch(`/family/${familyId}/study-plans`, { method: "POST", body: JSON.stringify({ title, description }) });
}

export function updateFamilyStudyPlan(planId: string, updates: { title?: string; description?: string | null }): Promise<FamilyStudyPlan> {
  return authedFetch(`/family/study-plans/${planId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function publishFamilyStudyPlan(planId: string): Promise<FamilyStudyPlan> {
  return authedFetch(`/family/study-plans/${planId}/publish`, { method: "POST" });
}

export function archiveFamilyStudyPlan(planId: string): Promise<FamilyStudyPlan> {
  return authedFetch(`/family/study-plans/${planId}/archive`, { method: "POST" });
}

export function addFamilyStudyPlanLesson(planId: string, lessonId: string): Promise<FamilyStudyPlanItem> {
  return authedFetch(`/family/study-plans/${planId}/items`, { method: "POST", body: JSON.stringify({ lessonId }) });
}

export function removeFamilyStudyPlanLesson(planId: string, itemId: string): Promise<{ removed: true }> {
  return authedFetch(`/family/study-plans/${planId}/items/${itemId}`, { method: "DELETE" });
}

export function reorderFamilyStudyPlan(planId: string, itemIds: string[]): Promise<FamilyStudyPlanItem[]> {
  return authedFetch(`/family/study-plans/${planId}/reorder`, { method: "PUT", body: JSON.stringify({ itemIds }) });
}

export function setFamilyStudySource(
  familyId: string,
  updates: { studySource?: FamilyStudySource; activeStudyPlanId?: string | null }
): Promise<{ familyId: string; studySource: FamilyStudySource; activeStudyPlanId: string | null }> {
  return authedFetch(`/family/${familyId}/study-source`, { method: "PUT", body: JSON.stringify(updates) });
}
