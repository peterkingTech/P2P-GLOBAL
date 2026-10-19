import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Mirrors lib/churchStudyApi.ts's authedFetch exactly, kept as its own
// local copy per this codebase's existing convention.
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

export interface FamilyStudy {
  id: string; familyId: string; createdBy: string | null;
  title: string; description: string | null; status: CustomStudyStatus;
  orderIndex: number; createdAt: string; updatedAt: string;
}

export interface FamilyStudyLesson {
  id: string; studyId: string; title: string; description: string | null;
  scriptureReferences: unknown[]; teachingMaterial: string | null;
  questions: unknown[]; prayerFocus: string | null; media: CustomStudyMedia | null;
  orderIndex: number; createdAt: string; updatedAt: string;
  // Authoring (migration 200): per-lesson status, version, tags, links.
  status?: "draft" | "published" | "archived"; publishedAt?: string | null; version?: number;
  tags?: string[]; resources?: { title: string; url: string }[];
}

export function getFamilyStudies(familyId: string): Promise<FamilyStudy[]> {
  return authedFetch(`/family/${familyId}/studies`);
}

export function getFamilyStudy(studyId: string): Promise<{ study: FamilyStudy; lessons: FamilyStudyLesson[]; canManage?: boolean }> {
  return authedFetch(`/family/studies/${studyId}`);
}

export function createFamilyStudy(familyId: string, title: string, description?: string): Promise<FamilyStudy> {
  return authedFetch(`/family/${familyId}/studies`, { method: "POST", body: JSON.stringify({ title, description }) });
}

export function updateFamilyStudy(
  studyId: string,
  updates: { title?: string; description?: string | null; status?: CustomStudyStatus; orderIndex?: number }
): Promise<FamilyStudy> {
  return authedFetch(`/family/studies/${studyId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function archiveFamilyStudy(studyId: string): Promise<FamilyStudy> {
  return authedFetch(`/family/studies/${studyId}/archive`, { method: "POST" });
}

export function addFamilyStudyLesson(
  studyId: string,
  lesson: {
    title: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
    questions?: unknown[]; prayerFocus?: string | null; orderIndex?: number; media?: CustomStudyMedia | null;
    tags?: string[]; resources?: { title: string; url: string }[]; status?: "published";
  }
): Promise<FamilyStudyLesson> {
  return authedFetch(`/family/studies/${studyId}/lessons`, { method: "POST", body: JSON.stringify(lesson) });
}

export function updateFamilyStudyLesson(
  studyId: string,
  lessonId: string,
  updates: {
    title?: string; description?: string | null; scriptureReferences?: unknown[]; teachingMaterial?: string | null;
    questions?: unknown[]; prayerFocus?: string | null; media?: CustomStudyMedia | null; orderIndex?: number;
    tags?: string[]; resources?: { title: string; url: string }[];
  }
): Promise<FamilyStudyLesson> {
  return authedFetch(`/family/studies/${studyId}/lessons/${lessonId}`, { method: "PUT", body: JSON.stringify(updates) });
}

export function removeFamilyStudyLesson(studyId: string, lessonId: string): Promise<{ removed: true }> {
  return authedFetch(`/family/studies/${studyId}/lessons/${lessonId}`, { method: "DELETE" });
}

// Draft / published / archived for one lesson (leaders only; server-enforced).
export function setFamilyStudyLessonStatus(studyId: string, lessonId: string, status: "draft" | "published" | "archived"): Promise<FamilyStudyLesson> {
  return authedFetch(`/family/studies/${studyId}/lessons/${lessonId}/status`, { method: "POST", body: JSON.stringify({ status }) });
}
