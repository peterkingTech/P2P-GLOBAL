import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import type { ScriptureReference } from "@/lib/prayerTopicsApi";

// "Pray the Word" Stage 3 — client bindings for routes/prayerPaths.ts.
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

export interface PrayerPath {
  id: string; slug: string; title: string; description: string | null; topicId: string | null;
  estimatedMinutes: number | null; status: "draft" | "published" | "archived"; displayOrder: number;
  createdAt: string; updatedAt: string; scriptureCount?: number;
}
export interface PrayerPathStep {
  id: string; pathId: string; scriptureId: string; stepOrder: number;
  reflectPrompt: string | null; prayPrompt: string | null; respondPrompt: string | null;
  scripture?: ScriptureReference;
}
export interface PrayerPathProgress {
  id: string; userId: string; pathId: string; status: "in_progress" | "completed";
  currentStepOrder: number; startedAt: string; completedAt: string | null; updatedAt: string;
}
export interface PrayerPathDetail extends PrayerPath {
  steps: PrayerPathStep[];
  myProgress: PrayerPathProgress | null;
}

export function getPrayerPaths(): Promise<PrayerPath[]> {
  return authedFetch("/prayer/paths");
}
export function getPrayerPath(slug: string): Promise<PrayerPathDetail> {
  return authedFetch(`/prayer/paths/${slug}`);
}
export function updatePathProgress(pathId: string, currentStepOrder: number): Promise<PrayerPathProgress> {
  return authedFetch(`/prayer/paths/${pathId}/progress`, { method: "PUT", body: JSON.stringify({ currentStepOrder }) });
}
