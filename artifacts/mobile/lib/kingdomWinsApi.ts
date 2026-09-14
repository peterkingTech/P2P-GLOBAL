import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Kingdom Wins / Testimonies — "Look what God has done." Client bindings
// for routes/kingdomWins.ts. A genuinely independent domain: NOT the
// Prayer Wall, NOT Missions — any authenticated user may author their own
// entry here (unlike Mission Stories, which stay admin-role-gated).
// P2P Impact (entryType 'p2p_impact') lives in this same table/API as a
// content classification, not a separate system — see migration 151.
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

export type KingdomEntryType = "kingdom_win" | "testimony" | "p2p_impact";
export type KingdomCategory =
  | "answered_prayer" | "salvation" | "healing" | "freedom" | "provision" | "reconciliation"
  | "spiritual_growth" | "family" | "work_calling" | "evangelism" | "discipleship" | "missions" | "other";
export type ImpactTheme =
  | "bible_study" | "prayer" | "discipleship" | "spiritual_growth" | "peer_relationships" | "family" | "church"
  | "mission" | "evangelism" | "scripture" | "faith" | "hope" | "healing" | "forgiveness" | "obedience"
  | "identity_in_christ" | "knowing_god" | "leadership" | "serving" | "unity" | "encouragement";
export type KingdomStatus = "draft" | "submitted" | "published" | "rejected" | "removed" | "archived";
export type KingdomReactionType = "praying" | "amen" | "encourage";

export const KINGDOM_CATEGORY_LABELS: Record<KingdomCategory, string> = {
  answered_prayer: "Answered Prayer", salvation: "Salvation", healing: "Healing", freedom: "Freedom",
  provision: "Provision", reconciliation: "Reconciliation", spiritual_growth: "Spiritual Growth", family: "Family",
  work_calling: "Work & Calling", evangelism: "Evangelism", discipleship: "Discipleship", missions: "Missions", other: "Other",
};

export const IMPACT_THEME_LABELS: Record<ImpactTheme, string> = {
  bible_study: "Bible Study", prayer: "Prayer", discipleship: "Discipleship", spiritual_growth: "Spiritual Growth",
  peer_relationships: "Peer Relationships", family: "Family", church: "Church", mission: "Mission",
  evangelism: "Evangelism", scripture: "Scripture", faith: "Faith", hope: "Hope", healing: "Healing",
  forgiveness: "Forgiveness", obedience: "Obedience", identity_in_christ: "Identity in Christ",
  knowing_god: "Knowing God", leadership: "Leadership", serving: "Serving", unity: "Unity", encouragement: "Encouragement",
};

export interface GuidedSections {
  before?: string; journey?: string; whatGodDid?: string; today?: string; encouragement?: string;
}

export interface KingdomWin {
  id: string; authorId: string | null; authorName: string | null; entryType: KingdomEntryType; title: string; body: string;
  lessonLearned: string | null; category: KingdomCategory; impactThemes: ImpactTheme[]; guidedSections: GuidedSections | null;
  scriptureReferenceId: string | null; missionStoryId: string | null; missionFieldId: string | null; prayer2RequestId: string | null;
  mediaType: "photo" | "video" | null; mediaPath: string | null; mediaDurationSeconds: number | null;
  isAnonymous: boolean; visibility: "p2p_network" | "private"; status: KingdomStatus; moderationNote: string | null;
  consentConfirmedAt: string | null; createdAt: string; updatedAt: string; submittedAt: string | null;
  publishedAt: string | null; archivedAt: string | null;
  reactionCounts?: Record<string, number>; myReactions?: string[];
}

export function createKingdomWin(input: {
  id?: string; entryType: KingdomEntryType; title: string; body?: string; guidedSections?: GuidedSections; lessonLearned?: string | null;
  category: KingdomCategory; impactThemes?: ImpactTheme[]; scriptureReferenceId?: string | null; missionStoryId?: string | null; missionFieldId?: string | null;
  prayer2RequestId?: string | null; mediaType?: "photo" | "video" | null; mediaPath?: string | null;
  mediaDurationSeconds?: number | null; isAnonymous?: boolean; visibility?: "p2p_network" | "private";
  status?: "draft" | "submitted" | "published"; consentConfirmed?: boolean;
}): Promise<KingdomWin> {
  return authedFetch("/kingdom-wins", { method: "POST", body: JSON.stringify(input) });
}
export function updateKingdomWin(id: string, updates: Partial<{
  title: string; body: string; guidedSections: GuidedSections; lessonLearned: string | null; category: KingdomCategory;
  impactThemes: ImpactTheme[]; scriptureReferenceId: string | null; isAnonymous: boolean;
  visibility: "p2p_network" | "private"; status: KingdomStatus; consentConfirmed: boolean;
}>): Promise<KingdomWin> {
  return authedFetch(`/kingdom-wins/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function archiveKingdomWin(id: string): Promise<KingdomWin> {
  return authedFetch(`/kingdom-wins/${id}`, { method: "PUT", body: JSON.stringify({ status: "archived" }) });
}
export function deleteKingdomWin(id: string): Promise<{ removed: true }> {
  return authedFetch(`/kingdom-wins/${id}`, { method: "DELETE" });
}
export function getMyKingdomWins(): Promise<KingdomWin[]> {
  return authedFetch("/kingdom-wins/mine");
}
export function getKingdomWinsFeed(opts: { category?: KingdomCategory; entryType?: KingdomEntryType; impactTheme?: ImpactTheme; page?: number; limit?: number } = {}): Promise<{ entries: KingdomWin[]; total: number; page: number; pageSize: number }> {
  const q = new URLSearchParams();
  if (opts.category) q.set("category", opts.category);
  if (opts.entryType) q.set("entryType", opts.entryType);
  if (opts.impactTheme) q.set("impactTheme", opts.impactTheme);
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

// ── Admin moderation (P2P Impact review queue) ──────────────────────────────
export function getKingdomWinsAdminQueue(status: "submitted" | "published" | "rejected" | "archived" = "submitted"): Promise<KingdomWin[]> {
  return authedFetch(`/kingdom-wins/admin/queue?status=${status}`);
}
export function moderateKingdomWin(id: string, action: "approve" | "reject" | "archive", note?: string): Promise<KingdomWin> {
  return authedFetch(`/kingdom-wins/${id}/moderate`, { method: "POST", body: JSON.stringify({ action, note }) });
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
