import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Every route on the server side (routes/churchStudies.ts) resolves
// identity via verifyCaller() — a real Supabase JWT — never a
// client-supplied id. Exact mirror of lib/churchCallApi.ts's authedFetch,
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

export type CustomStudyStatus = "draft" | "published" | "archived";

export interface CustomStudyMedia { provider: string; id: string; url: string | null }

export interface ChurchStudy {
  id: string; churchId: string; createdBy: string | null;
  title: string; description: string | null; status: CustomStudyStatus;
  orderIndex: number; createdAt: string; updatedAt: string;
}

export interface ChurchStudyLesson {
  id: string; studyId: string; title: string; description: string | null;
  scriptureReferences: unknown[]; teachingMaterial: string | null;
  questions: unknown[]; prayerFocus: string | null; media: CustomStudyMedia | null;
  orderIndex: number; createdAt: string; updatedAt: string;
}

export function getChurchStudies(churchId: string): Promise<ChurchStudy[]> {
  return authedFetch(`/churches/${churchId}/studies`);
}

export function getChurchStudy(studyId: string): Promise<{ study: ChurchStudy; lessons: ChurchStudyLesson[] }> {
  return authedFetch(`/churches/studies/${studyId}`);
}

export function createChurchStudy(churchId: string, title: string, description?: string): Promise<ChurchStudy> {
  return authedFetch(`/churches/${churchId}/studies`, { method: "POST", body: JSON.stringify({ title, description }) });
}

export function updateChurchStudy(
  studyId: string,
  updates: { title?: string; description?: string | null; status?: CustomStudyStatus; orderIndex?: number }
): Promise<ChurchStudy> {
  return authedFetch(`/churches/studies/${studyId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function archiveChurchStudy(studyId: string): Promise<ChurchStudy> {
  return authedFetch(`/churches/studies/${studyId}/archive`, { method: "POST" });
}

export function addChurchStudyLesson(
  studyId: string,
  lesson: {
    title: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
    questions?: unknown[]; prayerFocus?: string | null; orderIndex?: number; media?: CustomStudyMedia | null;
  }
): Promise<ChurchStudyLesson> {
  return authedFetch(`/churches/studies/${studyId}/lessons`, { method: "POST", body: JSON.stringify(lesson) });
}

export function updateChurchStudyLesson(
  studyId: string,
  lessonId: string,
  updates: {
    title?: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
    questions?: unknown[]; prayerFocus?: string | null; media?: CustomStudyMedia | null; orderIndex?: number;
  }
): Promise<ChurchStudyLesson> {
  return authedFetch(`/churches/studies/${studyId}/lessons/${lessonId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function removeChurchStudyLesson(studyId: string, lessonId: string): Promise<{ removed: true }> {
  return authedFetch(`/churches/studies/${studyId}/lessons/${lessonId}`, { method: "DELETE" });
}
