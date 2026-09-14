import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// "Pray the Word" Stage 1/2 — client bindings for routes/prayerTopics.ts
// (mounted at /prayer/topics, /prayer/admin/*). Scripture TEXT is never
// returned from here — only structured references. Resolve display text
// separately via lib/bibleApi.ts's existing /bible/* endpoints.
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

export interface PrayerTopic {
  id: string; slug: string; title: string; description: string | null;
  displayOrder: number; status: "draft" | "published" | "archived"; parentTopicId: string | null;
  createdAt: string; updatedAt: string;
}
export interface ScriptureReference {
  id: string; book: string; chapter: number; startVerse: number; endVerse: number;
  translationCode: string | null; referenceDisplay: string;
  role?: "core" | "supporting"; displayOrder?: number; editorialNote?: string | null;
}
// Enhancement Stage 2 — sequential lock/progression, one row per
// (user, topic), mirroring Prayer Paths' own progress shape exactly.
export interface TopicProgress {
  id: string; userId: string; topicId: string; status: "in_progress" | "completed";
  currentScriptureOrder: number; startedAt: string; completedAt: string | null; updatedAt: string;
}
export interface PrayerTopicDetail extends PrayerTopic {
  scriptures: ScriptureReference[];
  myProgress: TopicProgress | null;
}

export function getTopics(): Promise<PrayerTopic[]> {
  return authedFetch("/prayer/topics");
}
export function getTopic(slug: string): Promise<PrayerTopicDetail> {
  return authedFetch(`/prayer/topics/${slug}`);
}
// Marks the scripture at `completedScriptureOrder` (1-based position in
// the topic's own scripture list) as completed. The server rejects any
// value other than exactly current+1 — this call cannot be used to skip
// ahead, regardless of what value the client sends.
export function updateTopicProgress(topicId: string, completedScriptureOrder: number): Promise<TopicProgress> {
  return authedFetch(`/prayer/topics/${topicId}/progress`, { method: "PUT", body: JSON.stringify({ completedScriptureOrder }) });
}
export function getScriptureReference(id: string): Promise<ScriptureReference> {
  return authedFetch(`/prayer/scriptures/${id}`);
}

// Admin-only get-or-create for a canonical reference row — shared across
// every feature that lets an authorized contributor attach a Scripture
// (Pray the Word's own admin tooling, and Missions Stage 3 story
// authoring), so there is exactly one place that creates these rows.
export function createOrFindScriptureReference(input: {
  book: string; chapter: number; startVerse: number; endVerse: number; referenceDisplay: string; translationCode?: string | null;
}): Promise<ScriptureReference> {
  return authedFetch("/prayer/admin/scriptures", { method: "POST", body: JSON.stringify(input) });
}

// "Philippians 4:6-7" / "John 3:16" -> structured fields, or null if it
// doesn't parse. Deliberately simple (single-chapter, single book) —
// matches the same shape bibleService.ts's own parseVerseRef expects.
export function parseScriptureInput(raw: string): { book: string; chapter: number; startVerse: number; endVerse: number; referenceDisplay: string } | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d\s+)?([a-zA-Z]+(?:\s+[a-zA-Z]+)*)\s+(\d+):(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const book = `${(match[1] ?? "").trim()} ${match[2]}`.trim();
  const chapter = parseInt(match[3], 10);
  const startVerse = parseInt(match[4], 10);
  const endVerse = match[5] ? parseInt(match[5], 10) : startVerse;
  if (endVerse < startVerse) return null;
  return { book, chapter, startVerse, endVerse, referenceDisplay: trimmed };
}
