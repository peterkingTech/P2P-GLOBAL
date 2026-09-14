import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Kingdom Stories — P2P-curated EDITORIAL content (migration 152).
// Distinct from Kingdom Wins/P2P Impact (peer-authored testimony): only
// admin_content/super_admin can create or publish. No author identity is
// ever shown to peers — the content is the product, not a creator.
async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? "Request failed");
  return body;
}

export type KingdomStoryContentType = "historical_story" | "person" | "movement" | "event" | "place" | "present_day_story" | "documentary" | "scripture_story";
export type KingdomStoryStatus = "draft" | "review" | "published" | "archived";
export type KingdomStoryMediaType = "image" | "video";

export const CONTENT_TYPE_LABELS: Record<KingdomStoryContentType, string> = {
  historical_story: "Historical Story", person: "Person", movement: "Movement", event: "Event", place: "Place",
  present_day_story: "Present-Day Story", documentary: "Documentary", scripture_story: "Scripture Story",
};

export interface KingdomStoryCategory {
  id: string; slug: string; title: string; description: string | null; displayOrder: number; status: "draft" | "published" | "archived";
}
export interface KingdomStoryMedia {
  id: string; mediaType: KingdomStoryMediaType; mediaPath: string; caption: string | null;
  displayOrder: number; isCover: boolean; durationSeconds: number | null;
}
export interface KingdomStorySource {
  id: string; title: string; publisher: string | null; url: string | null; citation: string | null;
  sourceType: string | null; displayOrder: number;
}
export interface KingdomStory {
  id: string; title: string; subtitle: string | null; categoryId: string;
  category?: { slug: string; title: string } | null;
  contentType: KingdomStoryContentType | null; body: string;
  historicalPeriod: string | null; startYear: number | null; endYear: number | null;
  location: string | null; people: string | null; learningSection: string | null; reflection: string | null;
  scriptureReferenceId: string | null;
  relatedMissionFieldId: string | null; relatedMissionStoryId: string | null; relatedCurriculumId: string | null;
  relatedKingdomWinId: string | null; relatedStoryId: string | null;
  related?: {
    missionField?: { id: string; slug: string; title: string };
    missionStory?: { id: string; title: string };
    curriculum?: { id: string; title: string };
    kingdomWin?: { id: string; title: string };
    story?: { id: string; title: string; status: string };
  };
  isFeatured: boolean; status: KingdomStoryStatus; editorId: string | null;
  createdAt: string; updatedAt: string; publishedAt: string | null; archivedAt: string | null;
  media?: KingdomStoryMedia[]; sources?: KingdomStorySource[];
}

export function getKingdomStoryCategories(): Promise<KingdomStoryCategory[]> {
  return authedFetch("/kingdom-stories/categories");
}
export function getKingdomStoriesFeed(opts: { category?: string; featured?: boolean; page?: number; limit?: number } = {}): Promise<{ stories: KingdomStory[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (opts.category) q.set("category", opts.category);
  if (opts.featured) q.set("featured", "true");
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  return authedFetch(`/kingdom-stories/feed?${q}`);
}
export function getKingdomStory(id: string): Promise<KingdomStory> {
  return authedFetch(`/kingdom-stories/${id}`);
}

// ── Admin (admin_content / super_admin only) ────────────────────────────────
export function getKingdomStoriesAdminList(status?: KingdomStoryStatus): Promise<KingdomStory[]> {
  return authedFetch(`/kingdom-stories/admin/list${status ? `?status=${status}` : ""}`);
}
export function createKingdomStory(input: Partial<KingdomStory> & { title: string; body: string; categoryId: string }): Promise<KingdomStory> {
  return authedFetch("/kingdom-stories", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStory(id: string, updates: Partial<KingdomStory>): Promise<KingdomStory> {
  return authedFetch(`/kingdom-stories/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteKingdomStory(id: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${id}`, { method: "DELETE" });
}
export function addKingdomStoryMedia(storyId: string, input: { id?: string; mediaType: KingdomStoryMediaType; mediaPath: string; caption?: string; displayOrder?: number; isCover?: boolean; durationSeconds?: number }): Promise<KingdomStoryMedia> {
  return authedFetch(`/kingdom-stories/${storyId}/media`, { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStoryMedia(storyId: string, mediaId: string, updates: Partial<{ caption: string; displayOrder: number; isCover: boolean }>): Promise<KingdomStoryMedia> {
  return authedFetch(`/kingdom-stories/${storyId}/media/${mediaId}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteKingdomStoryMedia(storyId: string, mediaId: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/media/${mediaId}`, { method: "DELETE" });
}
export function addKingdomStorySource(storyId: string, input: { title: string; publisher?: string; url?: string; citation?: string; sourceType?: string; displayOrder?: number }): Promise<KingdomStorySource> {
  return authedFetch(`/kingdom-stories/${storyId}/sources`, { method: "POST", body: JSON.stringify(input) });
}
export function deleteKingdomStorySource(storyId: string, sourceId: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-stories/${storyId}/sources/${sourceId}`, { method: "DELETE" });
}
export function createKingdomStoryCategory(input: { slug: string; title: string; description?: string; displayOrder?: number }): Promise<KingdomStoryCategory> {
  return authedFetch("/kingdom-stories/admin/categories", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomStoryCategory(id: string, updates: Partial<{ title: string; description: string; displayOrder: number; status: "draft" | "published" | "archived" }>): Promise<KingdomStoryCategory> {
  return authedFetch(`/kingdom-stories/admin/categories/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}

// ── Media upload — same client-generated-id shape used throughout this app,
// but path-scoped by STORY id, not user id (editorial content has no
// per-user ownership).
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export async function uploadKingdomStoryImage(storyId: string, asset: { uri: string; mimeType?: string; fileName?: string | null }): Promise<{ mediaId: string; mediaPath: string } | null> {
  try {
    const { resolveMediaUpload } = await import("@/lib/mediaUpload");
    const { ext, contentType } = resolveMediaUpload(asset);
    const mediaId = generateUUID();
    const mediaPath = `${storyId}/${mediaId}.${ext}`;
    const response = await fetch(asset.uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-stories-media").upload(mediaPath, arrayBuffer, { contentType, upsert: false });
    if (error) return null;
    return { mediaId, mediaPath };
  } catch {
    return null;
  }
}
export async function uploadKingdomStoryVideo(storyId: string, localUri: string): Promise<{ mediaId: string; mediaPath: string } | null> {
  try {
    const mediaId = generateUUID();
    const rawExt = localUri.split(".").pop()?.toLowerCase();
    const ext = rawExt && /^[a-z0-9]{2,5}$/.test(rawExt) ? (rawExt === "mov" ? "mp4" : rawExt) : "mp4";
    const mediaPath = `${storyId}/${mediaId}.${ext}`;
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-stories-media").upload(mediaPath, arrayBuffer, { contentType: "video/mp4", upsert: false });
    if (error) return null;
    return { mediaId, mediaPath };
  } catch {
    return null;
  }
}
export function getKingdomStoryMediaSignedUrl(mediaPath: string): Promise<string | null> {
  return supabase.storage.from("kingdom-stories-media").createSignedUrl(mediaPath, 3600)
    .then(({ data, error }) => (error || !data?.signedUrl ? null : data.signedUrl));
}
