import type { ScriptureReference } from "@/lib/prayerTopicsApi";
import { apiRequest } from "@/lib/apiClient";

// "Pray the Word" Stage 3 — client bindings for routes/prayerPaths.ts.

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
  return apiRequest("/prayer/paths");
}
export function getPrayerPath(slug: string): Promise<PrayerPathDetail> {
  return apiRequest(`/prayer/paths/${slug}`);
}
export function updatePathProgress(pathId: string, currentStepOrder: number): Promise<PrayerPathProgress> {
  return apiRequest(`/prayer/paths/${pathId}/progress`, { method: "PUT", body: JSON.stringify({ currentStepOrder }) });
}
