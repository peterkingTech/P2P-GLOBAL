import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Kingdom Wins / Testimonies — "Look what God has done." Client bindings
// for routes/kingdomWins.ts. A genuinely independent domain: NOT the
// Prayer Wall, NOT Missions — any authenticated user may author their own
// entry here (unlike Mission Stories, which stay admin-role-gated).
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

export type KingdomEntryType = "kingdom_win" | "testimony";
export type KingdomCategory =
  | "answered_prayer" | "salvation" | "healing" | "freedom" | "provision" | "reconciliation"
  | "spiritual_growth" | "family" | "work_calling" | "evangelism" | "discipleship" | "missions" | "other";
export type KingdomStatus = "draft" | "submitted" | "published" | "rejected" | "removed";
export type KingdomReactionType = "praying" | "amen" | "encourage";

export const KINGDOM_CATEGORY_LABELS: Record<KingdomCategory, string> = {
  answered_prayer: "Answered Prayer", salvation: "Salvation", healing: "Healing", freedom: "Freedom",
  provision: "Provision", reconciliation: "Reconciliation", spiritual_growth: "Spiritual Growth", family: "Family",
  work_calling: "Work & Calling", evangelism: "Evangelism", discipleship: "Discipleship", missions: "Missions", other: "Other",
};

export interface KingdomWin {
  id: string; authorId: string; authorName: string | null; entryType: KingdomEntryType; title: string; body: string;
  lessonLearned: string | null; category: KingdomCategory; scriptureReferenceId: string | null;
  missionStoryId: string | null; missionFieldId: string | null; prayer2RequestId: string | null;
  mediaType: "photo" | "video" | null; mediaPath: string | null; mediaDurationSeconds: number | null;
  isAnonymous: boolean; visibility: "p2p_network" | "private"; status: KingdomStatus;
  createdAt: string; updatedAt: string; submittedAt: string | null; publishedAt: string | null;
  reactionCounts?: Record<string, number>; myReactions?: string[];
}

export function createKingdomWin(input: {
  id?: string; entryType: KingdomEntryType; title: string; body: string; lessonLearned?: string | null;
  category: KingdomCategory; scriptureReferenceId?: string | null; missionStoryId?: string | null; missionFieldId?: string | null;
  prayer2RequestId?: string | null; mediaType?: "photo" | "video" | null; mediaPath?: string | null;
  mediaDurationSeconds?: number | null; isAnonymous?: boolean; visibility?: "p2p_network" | "private"; status?: "draft" | "submitted" | "published";
}): Promise<KingdomWin> {
  return authedFetch("/kingdom-wins", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomWin(id: string, updates: Partial<{
  title: string; body: string; lessonLearned: string | null; category: KingdomCategory; scriptureReferenceId: string | null;
  isAnonymous: boolean; visibility: "p2p_network" | "private"; status: KingdomStatus;
}>): Promise<KingdomWin> {
  return authedFetch(`/kingdom-wins/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function deleteKingdomWin(id: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-wins/${id}`, { method: "DELETE" });
}
export function getMyKingdomWins(): Promise<KingdomWin[]> {
  return authedFetch("/kingdom-wins/mine");
}
export function getKingdomWinsFeed(opts: { category?: KingdomCategory; entryType?: KingdomEntryType; page?: number; limit?: number } = {}): Promise<{ entries: KingdomWin[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (opts.category) q.set("category", opts.category);
  if (opts.entryType) q.set("entryType", opts.entryType);
  q.set("page", String(opts.page ?? 0));
  q.set("limit", String(opts.limit ?? 20));
  return authedFetch(`/kingdom-wins/feed?${q}`);
}
export function getKingdomWin(id: string): Promise<KingdomWin> {
  return authedFetch(`/kingdom-wins/${id}`);
}
export function reactToKingdomWin(id: string, reactionType: KingdomReactionType): Promise<{ reactionCounts: Record<string, number>; myReactions: string[] }> {
  return authedFetch(`/kingdom-wins/${id}/react`, { method: "POST", body: JSON.stringify({ reactionType }) });
}
export function unreactToKingdomWin(id: string, reactionType: KingdomReactionType): Promise<{ reactionCounts: Record<string, number>; myReactions: string[] }> {
  return authedFetch(`/kingdom-wins/${id}/react/${reactionType}`, { method: "DELETE" });
}

// Media upload — identical client-generated-id shape used throughout this
// program (prayer testimonies, mission stories): the id is minted before
// upload so the storage path and the eventual DB row share it.
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
export async function uploadKingdomWinVideo(localUri: string, userId: string): Promise<{ entryId: string; mediaPath: string } | null> {
  try {
    const entryId = generateUUID();
    const rawExtCandidate = localUri.split(".").pop()?.toLowerCase();
    const rawExt = rawExtCandidate && /^[a-z0-9]{2,5}$/.test(rawExtCandidate) ? rawExtCandidate : "mp4";
    const ext = rawExt === "mov" ? "mp4" : rawExt;
    const mediaPath = `${userId}/${entryId}/video.${ext}`;
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-wins-media").upload(mediaPath, arrayBuffer, { contentType: "video/mp4", upsert: false });
    if (error) return null;
    return { entryId, mediaPath };
  } catch {
    return null;
  }
}
export async function uploadKingdomWinPhoto(
  asset: { uri: string; mimeType?: string; fileName?: string | null },
  userId: string
): Promise<{ entryId: string; mediaPath: string } | null> {
  try {
    const { resolveMediaUpload } = await import("@/lib/mediaUpload");
    const { ext, contentType } = resolveMediaUpload(asset);
    const entryId = generateUUID();
    const mediaPath = `${userId}/${entryId}/photo.${ext}`;
    const response = await fetch(asset.uri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage.from("kingdom-wins-media").upload(mediaPath, arrayBuffer, { contentType, upsert: false });
    if (error) return null;
    return { entryId, mediaPath };
  } catch {
    return null;
  }
}
export function getKingdomWinMediaSignedUrl(mediaPath: string): Promise<string | null> {
  return supabase.storage.from("kingdom-wins-media").createSignedUrl(mediaPath, 3600)
    .then(({ data, error }) => (error || !data?.signedUrl ? null : data.signedUrl));
}
