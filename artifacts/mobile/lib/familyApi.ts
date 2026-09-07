import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Every route on the server side (routes/family.ts, routes/familyWorship.ts)
// resolves identity via verifyCaller() — a real Supabase JWT — never a
// client-supplied id. This is the one place that attaches it, mirroring
// the exact pattern already used by DataContext.tsx's getMyNotifications().
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

export type FamilyRole = "shepherd" | "co_shepherd" | "adult" | "teen" | "child";

export interface FamilyMember {
  id: string; familyId: string; userId: string; role: FamilyRole; status: string;
  joinedAt: string; name: string; avatarUrl: string | null; username: string | null;
}
export interface Family { id: string; name: string; shepherdId: string; createdAt: string }
export interface FamilyInvitation { id: string; family_id: string; invited_by: string; invited_user_id: string; role: FamilyRole; status: string; created_at: string }
export interface MyFamilyResponse {
  family: Family | null; members: FamilyMember[]; myRole: FamilyRole | null;
  canManage?: boolean; pendingInvitations: FamilyInvitation[];
}

export function getMyFamily(): Promise<MyFamilyResponse> {
  return authedFetch("/family/mine");
}
export function createFamily(name: string): Promise<Family> {
  return authedFetch("/family", { method: "POST", body: JSON.stringify({ name }) });
}
export function inviteToFamily(familyId: string, username: string, role?: FamilyRole) {
  return authedFetch(`/family/${familyId}/invite`, { method: "POST", body: JSON.stringify({ username, role }) });
}
export function respondToFamilyInvitation(invitationId: string, action: "accept" | "decline") {
  return authedFetch(`/family/invitations/${invitationId}/respond`, { method: "POST", body: JSON.stringify({ action }) });
}
export function updateFamilyMemberRole(familyId: string, userId: string, role: FamilyRole) {
  return authedFetch(`/family/${familyId}/members/${userId}/role`, { method: "PUT", body: JSON.stringify({ role }) });
}
export function removeFamilyMember(familyId: string, userId: string) {
  return authedFetch(`/family/${familyId}/members/${userId}`, { method: "DELETE" });
}

export interface FamilyPrayerRequest {
  id: string; family_id: string; user_id: string; content: string;
  visibility: "private" | "family"; status: "open" | "prayed" | "answered"; created_at: string;
}
export function getFamilyPrayerRequests(familyId: string): Promise<FamilyPrayerRequest[]> {
  return authedFetch(`/family/${familyId}/prayer-requests`);
}
export function createFamilyPrayerRequest(familyId: string, content: string, visibility: "private" | "family") {
  return authedFetch(`/family/${familyId}/prayer-requests`, { method: "POST", body: JSON.stringify({ content, visibility }) });
}
export function updateFamilyPrayerRequestStatus(familyId: string, id: string, status: "prayed" | "answered") {
  return authedFetch(`/family/${familyId}/prayer-requests/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export type WorshipMode = "worship" | "scripture" | "prayer" | "sharing" | "silent_prayer" | "thanksgiving";
// mediaProvider is the new provider boundary (lib/mediaProviders) — when
// set, mediaId holds that provider's external id and mediaType/mediaUrl
// are unused. When null, mediaType/mediaUrl carry the legacy raw-file
// shape exactly as before this feature — nothing about that path changed.
export type SharedMediaProvider = "youtube";
export type MediaPermission = "guide_only" | "trusted" | "everyone";
export interface WorshipSession {
  id: string; familyId: string; hostId: string; status: string; currentMode: WorshipMode;
  mediaProvider: SharedMediaProvider | null;
  mediaType: "video" | "audio" | null; mediaId: string | null; mediaUrl: string | null;
  playbackBasePositionMs: number; playbackBaseServerTime: string; playbackRate: number; isPlaying: boolean;
  currentScripture: { reference: string; verseIndex?: number } | null;
  channelName: string; startedAt: string | null; endedAt: string | null;
  mediaPermission: MediaPermission; trustedUserIds: string[]; autoAdvance: boolean;
  participants?: { user_id: string; joined_at: string; camera_on: boolean; mic_on: boolean; presence_status: string }[];
}

// Client-side mirror of the server's canControlMedia() — used only to
// decide which controls to SHOW. The server re-checks this independently
// on every mutating call (familyWorship.ts), so this can never be the only
// gate; it's a UX convenience, not the actual security boundary.
export function canControlMedia(session: Pick<WorshipSession, "hostId" | "mediaPermission" | "trustedUserIds">, userId: string | undefined): boolean {
  if (!userId) return false;
  if (session.hostId === userId) return true;
  if (session.mediaPermission === "everyone") return true;
  if (session.mediaPermission === "trusted") return session.trustedUserIds.includes(userId);
  return false;
}

export function startFamilyWorship(familyId: string): Promise<WorshipSession> {
  return authedFetch("/family/worship/start", { method: "POST", body: JSON.stringify({ familyId }) });
}
export function getWorshipSession(sessionId: string): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}`);
}
export function joinWorshipSession(sessionId: string): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/join`, { method: "POST" });
}
export function leaveWorshipSession(sessionId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/leave`, { method: "POST" });
}
export function updateWorshipState(sessionId: string, patch: {
  status?: string; currentMode?: WorshipMode; mediaProvider?: SharedMediaProvider | null;
  mediaType?: "video" | "audio" | null; mediaId?: string | null; mediaUrl?: string | null;
  isPlaying?: boolean; positionMs?: number; playbackRate?: number; currentScripture?: { reference: string; verseIndex?: number } | null;
}): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/state`, { method: "PUT", body: JSON.stringify(patch) });
}
export function transferWorshipHost(sessionId: string, newHostId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/transfer-host`, { method: "POST", body: JSON.stringify({ newHostId }) });
}
export function endWorshipSession(sessionId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/end`, { method: "POST" });
}
export function updateMediaPermission(sessionId: string, patch: { mediaPermission?: MediaPermission; autoAdvance?: boolean }): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/media-permission`, { method: "PUT", body: JSON.stringify(patch) });
}
export function setTrustedParticipant(sessionId: string, userId: string, trusted: boolean): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/trusted`, { method: "POST", body: JSON.stringify({ userId, trusted }) });
}

export interface WorshipQueueItem {
  id: string; sessionId: string; mediaProvider: SharedMediaProvider; mediaId: string;
  title: string | null; thumbnailUrl: string | null; addedBy: string; addedByName: string; position: number; createdAt: string;
}
export function getWorshipQueue(sessionId: string): Promise<WorshipQueueItem[]> {
  return authedFetch(`/family/worship/sessions/${sessionId}/queue`);
}
export function addToWorshipQueue(sessionId: string, item: { mediaProvider: SharedMediaProvider; mediaId: string; title?: string; thumbnailUrl?: string | null }): Promise<WorshipQueueItem> {
  return authedFetch(`/family/worship/sessions/${sessionId}/queue`, { method: "POST", body: JSON.stringify(item) });
}
export function removeFromWorshipQueue(sessionId: string, itemId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/queue/${itemId}`, { method: "DELETE" });
}
export function reorderWorshipQueue(sessionId: string, orderedItemIds: string[]): Promise<WorshipQueueItem[]> {
  return authedFetch(`/family/worship/sessions/${sessionId}/queue/reorder`, { method: "PUT", body: JSON.stringify({ orderedItemIds }) });
}
export function playNextInWorshipQueue(sessionId: string): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/queue/next`, { method: "POST" });
}
export interface WorshipHistoryEntry {
  id: string; family_id: string; session_id: string; duration_seconds: number;
  modes_visited: string[]; participant_count: number; scripture_reference: string | null; created_at: string;
}
export function getWorshipHistory(familyId: string): Promise<WorshipHistoryEntry[]> {
  return authedFetch(`/family/worship/history?familyId=${familyId}`);
}

export interface WorshipMessage {
  id: string; sessionId: string; userId: string; authorName: string; content: string; context: unknown | null; createdAt: string;
}
export function getWorshipMessages(sessionId: string): Promise<WorshipMessage[]> {
  return authedFetch(`/family/worship/sessions/${sessionId}/messages`);
}
export function sendWorshipMessage(sessionId: string, content: string): Promise<WorshipMessage> {
  return authedFetch(`/family/worship/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}
export function removeWorshipParticipant(sessionId: string, userId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/remove`, { method: "POST", body: JSON.stringify({ userId }) });
}

// The one place the server-anchored-clock formula is written — both
// computeWorshipPositionMs below and YouTubePlayer's own drift-correction
// loop call this, so there's a single source of truth for "expected
// position right now" rather than two copies that could drift apart.
export function computePositionFromClock(
  basePositionMs: number, baseServerTimeIso: string, playbackRate: number, isPlaying: boolean
): number {
  if (!isPlaying) return basePositionMs;
  const elapsedMs = Date.now() - new Date(baseServerTimeIso).getTime();
  return basePositionMs + elapsedMs * playbackRate;
}

// current playback position derived from the session's server-anchored
// clock — recompute on every render/tick, never persisted per-frame.
export function computeWorshipPositionMs(session: WorshipSession): number {
  return computePositionFromClock(session.playbackBasePositionMs, session.playbackBaseServerTime, session.playbackRate, session.isPlaying);
}