import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import type { ScriptureReference } from "@/lib/prayerTopicsApi";

// "Pray the Word" Stage 5 — client bindings for routes/prayerLibrary.ts.
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

export interface SavedScripture { id: string; savedAt: string; topicId: string | null; scripture: ScriptureReference | null }
export interface SavedPrayer { id: string; savedAt: string; prayer: { id: string; category: string; title: string; prayerText: string; scriptureReference: string | null } | null }
export interface SavedPath { id: string; savedAt: string; path: { id: string; slug: string; title: string; description: string | null; estimatedMinutes: number | null } | null }
export interface AnsweredJournalEntry { id: string; prayerText: string; category: string | null; answeredAt: string | null; answerNotes: string | null; scriptureReferenceId: string | null; topicId: string | null }
export interface RecentActivity { eventType: string; metadata: Record<string, unknown>; at: string }

export function saveScripture(scriptureId: string, topicId?: string | null): Promise<SavedScripture> {
  return authedFetch("/prayer/saved-scriptures", { method: "POST", body: JSON.stringify({ scriptureId, topicId }) });
}
export function unsaveScripture(scriptureId: string): Promise<{ removed: true }> {
  return authedFetch(`/prayer/saved-scriptures/${scriptureId}`, { method: "DELETE" });
}
export function getSavedScriptures(): Promise<SavedScripture[]> {
  return authedFetch("/prayer/saved-scriptures");
}

export function savePrayer(prayerLibraryId: string): Promise<{ id: string; prayerLibraryId: string; savedAt: string }> {
  return authedFetch("/prayer/saved-prayers", { method: "POST", body: JSON.stringify({ prayerLibraryId }) });
}
export function unsavePrayer(prayerLibraryId: string): Promise<{ removed: true }> {
  return authedFetch(`/prayer/saved-prayers/${prayerLibraryId}`, { method: "DELETE" });
}
export function getSavedPrayers(): Promise<SavedPrayer[]> {
  return authedFetch("/prayer/saved-prayers");
}

export function savePath(pathId: string): Promise<{ id: string; pathId: string; savedAt: string }> {
  return authedFetch("/prayer/saved-paths", { method: "POST", body: JSON.stringify({ pathId }) });
}
export function unsavePath(pathId: string): Promise<{ removed: true }> {
  return authedFetch(`/prayer/saved-paths/${pathId}`, { method: "DELETE" });
}
export function getSavedPaths(): Promise<SavedPath[]> {
  return authedFetch("/prayer/saved-paths");
}

export function getAnsweredPrayers(): Promise<AnsweredJournalEntry[]> {
  return authedFetch("/prayer/library/answered");
}

export type LoggableEvent = "prayer_topic_viewed" | "prayer_scripture_viewed" | "prayer_path_started" | "scripture_devotional_completed";
export function logPrayerActivity(eventType: LoggableEvent, metadata: Record<string, unknown>): Promise<{ logged: true }> {
  return authedFetch("/prayer/activity", { method: "POST", body: JSON.stringify({ eventType, metadata }) });
}
export function getRecentPrayerActivity(): Promise<RecentActivity[]> {
  return authedFetch("/prayer/recent");
}
