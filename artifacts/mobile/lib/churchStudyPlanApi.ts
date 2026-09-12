import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Every route on the server side (routes/churchStudyPlans.ts) resolves
// identity via verifyCaller() — a real Supabase JWT — never a
// client-supplied id. Exact mirror of lib/churchStudyApi.ts's authedFetch,
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

export interface ChurchStudyPlan {
  id: string; churchId: string; createdBy: string | null;
  title: string; description: string | null; status: StudyPlanStatus;
  createdAt: string; updatedAt: string;
}

// A plan item is a REFERENCE to an existing p2p_lessons row — lessonTitle
// is included for display only, never authored/stored here.
export interface ChurchStudyPlanItem {
  itemId: string; lessonId: string; orderIndex: number;
  lessonTitle: string; lessonStatus: string | null;
  done?: boolean; progressStatus?: string;
}

export interface ChurchStudyPlanDetail {
  plan: ChurchStudyPlan;
  items: ChurchStudyPlanItem[];
  progress: { completed: number; total: number; currentItemId: string | null };
}

export function getChurchStudyPlans(churchId: string): Promise<ChurchStudyPlan[]> {
  return authedFetch(`/churches/${churchId}/study-plans`);
}

export function getChurchStudyPlan(planId: string): Promise<ChurchStudyPlanDetail> {
  return authedFetch(`/churches/study-plans/${planId}`);
}

export function createChurchStudyPlan(churchId: string, title: string, description?: string): Promise<ChurchStudyPlan> {
  return authedFetch(`/churches/${churchId}/study-plans`, { method: "POST", body: JSON.stringify({ title, description }) });
}

export function updateChurchStudyPlan(planId: string, updates: { title?: string; description?: string | null }): Promise<ChurchStudyPlan> {
  return authedFetch(`/churches/study-plans/${planId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function publishChurchStudyPlan(planId: string): Promise<ChurchStudyPlan> {
  return authedFetch(`/churches/study-plans/${planId}/publish`, { method: "POST" });
}

export function archiveChurchStudyPlan(planId: string): Promise<ChurchStudyPlan> {
  return authedFetch(`/churches/study-plans/${planId}/archive`, { method: "POST" });
}

export function addChurchStudyPlanLesson(planId: string, lessonId: string): Promise<ChurchStudyPlanItem> {
  return authedFetch(`/churches/study-plans/${planId}/items`, { method: "POST", body: JSON.stringify({ lessonId }) });
}

export function removeChurchStudyPlanLesson(planId: string, itemId: string): Promise<{ removed: true }> {
  return authedFetch(`/churches/study-plans/${planId}/items/${itemId}`, { method: "DELETE" });
}

export function reorderChurchStudyPlan(planId: string, itemIds: string[]): Promise<ChurchStudyPlanItem[]> {
  return authedFetch(`/churches/study-plans/${planId}/reorder`, { method: "PUT", body: JSON.stringify({ itemIds }) });
}
