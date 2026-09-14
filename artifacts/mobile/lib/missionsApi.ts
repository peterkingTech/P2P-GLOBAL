import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";
import type { ScriptureReference } from "@/lib/prayerTopicsApi";

// Missions — client bindings for routes/missions.ts. A genuinely new,
// independent content domain: never reads from p2p_missions (legacy,
// still used elsewhere) or p2p_prayer_wall_posts.
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

export type MissionFocusTag =
  | "evangelism" | "discipleship" | "church_planting" | "bible_translation" | "youth" | "children"
  | "education" | "compassion" | "medical_missions" | "community_development" | "refugees"
  | "persecuted_church" | "unreached_peoples" | "cross_cultural_missions" | "leadership_development" | "digital_missions";

export const MISSION_FOCUS_LABELS: Record<MissionFocusTag, string> = {
  evangelism: "Evangelism", discipleship: "Discipleship", church_planting: "Church Planting",
  bible_translation: "Bible Translation", youth: "Youth", children: "Children", education: "Education",
  compassion: "Compassion", medical_missions: "Medical Missions", community_development: "Community Development",
  refugees: "Refugees", persecuted_church: "Persecuted Church", unreached_peoples: "Unreached Peoples",
  cross_cultural_missions: "Cross-Cultural Missions", leadership_development: "Leadership Development", digital_missions: "Digital Missions",
};

export type MissionStoryType = "story" | "testimony" | "update" | "growth_story" | "scripture_reflection";
export type MissionStatus = "draft" | "pending" | "published" | "archived" | "removed";

export interface MissionField {
  id: string; slug: string; title: string; country: string; region: string | null; context: string | null;
  description: string | null; missionFocus: MissionFocusTag[]; status: "draft" | "published" | "archived";
  displayOrder: number; createdAt: string; updatedAt: string;
}
export interface MissionStory {
  id: string; authorId: string; authorName?: string; storyType: MissionStoryType; title: string;
  summary: string | null; body: string; missionFieldId: string | null; missionField?: MissionField;
  missionFocus: MissionFocusTag[]; scriptureReferenceId: string | null; mediaType: "video" | null;
  mediaPath: string | null; mediaDurationSeconds: number | null; status: MissionStatus;
  createdAt: string; updatedAt: string; publishedAt: string | null;
}
export interface MissionPrayerPoint {
  id: string; title: string; description: string; scriptureReferenceId: string | null;
  missionStoryId: string | null; missionFieldId: string | null; status: string; createdAt: string; updatedAt: string;
}
export interface MissionFieldDetail extends MissionField { stories: MissionStory[]; prayerPoints: MissionPrayerPoint[] }
export interface MissionStoryDetail extends MissionStory { prayerPoints: MissionPrayerPoint[]; relatedStories: { id: string; title: string; summary: string | null; story_type: string }[] }

export function getFocusTags(): Promise<MissionFocusTag[]> {
  return authedFetch("/missions/focus-tags");
}
export function getMissionFields(focus?: MissionFocusTag): Promise<MissionField[]> {
  return authedFetch(`/missions/fields${focus ? `?focus=${focus}` : ""}`);
}
export function getMissionField(slug: string): Promise<MissionFieldDetail> {
  return authedFetch(`/missions/fields/${slug}`);
}
export function getMissionStories(opts: { fieldSlug?: string; focus?: MissionFocusTag; storyType?: MissionStoryType; page?: number; limit?: number } = {}): Promise<{ stories: MissionStory[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (opts.fieldSlug) q.set("fieldSlug", opts.fieldSlug);
  if (opts.focus) q.set("focus", opts.focus);
  if (opts.storyType) q.set("storyType", opts.storyType);
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  return authedFetch(`/missions/stories?${q}`);
}
export function getMissionStory(id: string): Promise<MissionStoryDetail> {
  return authedFetch(`/missions/stories/${id}`);
}
export function getMissionPrayerPoints(opts: { storyId?: string; fieldId?: string }): Promise<MissionPrayerPoint[]> {
  const q = new URLSearchParams();
  if (opts.storyId) q.set("storyId", opts.storyId);
  if (opts.fieldId) q.set("fieldId", opts.fieldId);
  return authedFetch(`/missions/prayer-points?${q}`);
}

export function saveMissionStory(storyId: string): Promise<{ id: string; storyId: string; savedAt: string }> {
  return authedFetch("/missions/saved-stories", { method: "POST", body: JSON.stringify({ storyId }) });
}
export function unsaveMissionStory(storyId: string): Promise<{ removed: true }> {
  return authedFetch(`/missions/saved-stories/${storyId}`, { method: "DELETE" });
}
export function getSavedMissionStories(): Promise<{ id: string; savedAt: string; story: MissionStory | null }[]> {
  return authedFetch("/missions/saved-stories");
}

export function getMyMissionStories(): Promise<MissionStory[]> {
  return authedFetch("/missions/mine/stories");
}
export function createMissionStory(input: {
  id?: string; storyType: MissionStoryType; title: string; summary?: string | null; body: string;
  missionFieldId?: string | null; missionFocus?: MissionFocusTag[]; scriptureReferenceId?: string | null;
  mediaType?: "video" | null; mediaPath?: string | null; mediaDurationSeconds?: number | null; status?: MissionStatus;
}): Promise<MissionStory> {
  return authedFetch("/missions/stories", { method: "POST", body: JSON.stringify(input) });
}
export function updateMissionStory(id: string, updates: Partial<{
  title: string; summary: string | null; body: string; missionFieldId: string | null; missionFocus: MissionFocusTag[];
  scriptureReferenceId: string | null; status: MissionStatus;
}>): Promise<MissionStory> {
  return authedFetch(`/missions/stories/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteMissionStory(id: string): Promise<{ removed: true }> {
  return authedFetch(`/missions/stories/${id}`, { method: "DELETE" });
}

// Video upload — mirrors uploadTestimonyVideo's exact shape (client
// generates the id up front so the storage path and the DB row can match).
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export async function uploadMissionStoryVideo(localUri: string, userId: string): Promise<{ storyId: string; mediaPath: string } | null> {
  try {
    const storyId = generateUUID();
    const rawExtCandidate = localUri.split(".").pop()?.toLowerCase();
    const rawExt = rawExtCandidate && /^[a-z0-9]{2,5}$/.test(rawExtCandidate) ? rawExtCandidate : "mp4";
    const ext = rawExt === "mov" ? "mp4" : rawExt;
    const mediaPath = `${userId}/${storyId}/video.${ext}`;
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("mission-media").upload(mediaPath, arrayBuffer, { contentType: "video/mp4", upsert: false });
    if (error) return null;
    return { storyId, mediaPath };
  } catch {
    return null;
  }
}
export function getMissionMediaSignedUrl(mediaPath: string): Promise<string | null> {
  return supabase.storage.from("mission-media").createSignedUrl(mediaPath, 3600)
    .then(({ data, error }) => (error || !data?.signedUrl ? null : data.signedUrl));
}
