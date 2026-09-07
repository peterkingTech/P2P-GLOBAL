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
export interface WorshipSession {
  id: string; familyId: string; hostId: string; status: string; currentMode: WorshipMode;
  mediaProvider: SharedMediaProvider | null;
  mediaType: "video" | "audio" | null; mediaId: string | null; mediaUrl: string | null;
  playbackBasePositionMs: number; playbackBaseServerTime: string; playbackRate: number; isPlaying: boolean;
  currentScripture: { reference: string; verseIndex?: number } | null;
  channelName: string; startedAt: string | null; endedAt: string | null;
  participants?: { user_id: string; joined_at: string; camera_on: boolean; mic_on: boolean; presence_status: string }[];
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
export interface WorshipHistoryEntry {
  id: string; family_id: string; session_id: string; duration_seconds: number;
  modes_visited: string[]; participant_count: number; scripture_reference: string | null; created_at: string;
}
export function getWorshipHistory(familyId: string): Promise<WorshipHistoryEntry[]> {
  return authedFetch(`/family/worship/history?familyId=${familyId}`);
}

// current playback position derived from the session's server-anchored
// clock — recompute on every render/tick, never persisted per-frame.
export function computeWorshipPositionMs(session: WorshipSession): number {
  if (!session.isPlaying) return session.playbackBasePositionMs;
  const elapsedMs = Date.now() - new Date(session.playbackBaseServerTime).getTime();
  return session.playbackBasePositionMs + elapsedMs * session.playbackRate;
}