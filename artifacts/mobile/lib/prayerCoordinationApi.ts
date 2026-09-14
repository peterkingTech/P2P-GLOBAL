import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Prayer 2.0 — client bindings for routes/prayerCoordination.ts (mounted at
// /prayer). Deliberately separate from the legacy lib/prayerApi-style
// direct-Supabase calls the old wall/journal/library use — this feature
// always goes through the authenticated API, never a raw client query,
// since every mutation needs server-side ownership/authorization checks.
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

export type PrayerRequestVisibility = "open" | "private";
export type PrayerMode = "pray_for_me" | "pray_with_me" | "both";
export type PrayerRequestStatus = "open" | "answered" | "cancelled" | "expired";

export type ProgressNoteType = "still_praying" | "god_is_answering" | "partially_answered" | "no_longer_needed";

export interface PrayerCoordRequest {
  id: string; userId: string; title: string; prayerPoint: string;
  category: string | null; scriptureReference: unknown; isAnonymous: boolean;
  visibility: PrayerRequestVisibility; prayerMode: PrayerMode; status: PrayerRequestStatus;
  expiresAt: string | null; createdAt: string; updatedAt: string;
  progressNote: string | null; progressNoteType: ProgressNoteType | null;
  progressUpdatedAt: string | null; answerNote: string | null;
  missionId: string | null;
  // Missions Stage 4 — explicit, nullable pointer into the NEW mission
  // domain (never a duplicate of the story/field row).
  missionStoryId: string | null; missionFieldId: string | null;
}

export function createPrayerRequest(input: {
  title: string; prayerPoint: string; category?: string | null; scriptureReference?: unknown;
  isAnonymous?: boolean; visibility?: PrayerRequestVisibility; prayerMode?: PrayerMode; expiresAt?: string | null;
  missionId?: string | null; missionStoryId?: string | null; missionFieldId?: string | null;
}): Promise<PrayerCoordRequest> {
  return authedFetch("/prayer/requests", { method: "POST", body: JSON.stringify(input) });
}
export function getMyPrayerRequests(): Promise<PrayerCoordRequest[]> {
  return authedFetch("/prayer/requests/mine");
}
export interface OpenPrayerRequest extends PrayerCoordRequest { ownerName: string | null }
export function getOpenPrayerRequests(): Promise<OpenPrayerRequest[]> {
  return authedFetch("/prayer/requests/open");
}
export function getPrayerRequest(id: string): Promise<PrayerCoordRequest> {
  return authedFetch(`/prayer/requests/${id}`);
}
export function updatePrayerRequest(id: string, updates: Partial<{
  title: string; prayerPoint: string; category: string | null; scriptureReference: unknown;
  isAnonymous: boolean; visibility: PrayerRequestVisibility; prayerMode: PrayerMode; expiresAt: string | null;
}>): Promise<PrayerCoordRequest> {
  return authedFetch(`/prayer/requests/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function cancelPrayerRequest(id: string): Promise<PrayerCoordRequest> {
  return authedFetch(`/prayer/requests/${id}/cancel`, { method: "POST" });
}
export function followUpOnRequest(id: string, noteType: ProgressNoteType, note?: string): Promise<PrayerCoordRequest> {
  return authedFetch(`/prayer/requests/${id}/follow-up`, { method: "POST", body: JSON.stringify({ noteType, note }) });
}
export function markRequestAnswered(id: string, answerNote?: string): Promise<PrayerCoordRequest> {
  return authedFetch(`/prayer/requests/${id}/answer`, { method: "POST", body: JSON.stringify({ answerNote }) });
}

export type CommitmentStatus = "active" | "completed" | "continued" | "released";
export interface PrayerCommitment {
  id: string; userId: string; requestId: string; status: CommitmentStatus;
  reminderAt: string | null; createdAt: string; updatedAt: string;
}
export function commitToPray(requestId: string, reminderAt?: string | null): Promise<PrayerCommitment> {
  return authedFetch(`/prayer/requests/${requestId}/commit`, { method: "POST", body: JSON.stringify({ reminderAt }) });
}
export function getMyCommitments(): Promise<PrayerCommitment[]> {
  return authedFetch("/prayer/commitments/mine");
}
export function updateCommitment(id: string, status: CommitmentStatus): Promise<PrayerCommitment> {
  return authedFetch(`/prayer/commitments/${id}`, { method: "PUT", body: JSON.stringify({ status }) });
}

export type AvailabilityRecurrence = "once" | "weekly";

export interface PrayerAvailability {
  id: string; userId: string; timezone: string; recurrence: AvailabilityRecurrence;
  specificDate: string | null; dayOfWeek: number | null; startTime: string; endTime: string;
  visibility: PrayerRequestVisibility; isActive: boolean; createdAt: string; updatedAt: string;
}

export function createAvailability(input: {
  timezone: string; recurrence: AvailabilityRecurrence; specificDate?: string; dayOfWeek?: number;
  startTime: string; endTime: string; visibility?: PrayerRequestVisibility;
}): Promise<PrayerAvailability> {
  return authedFetch("/prayer/availability", { method: "POST", body: JSON.stringify(input) });
}
export function getMyAvailability(): Promise<PrayerAvailability[]> {
  return authedFetch("/prayer/availability/mine");
}
export function updateAvailability(id: string, updates: Partial<{
  startTime: string; endTime: string; visibility: PrayerRequestVisibility; timezone: string;
}>): Promise<PrayerAvailability> {
  return authedFetch(`/prayer/availability/${id}`, { method: "PUT", body: JSON.stringify(updates) });
}
export function toggleAvailability(id: string): Promise<PrayerAvailability> {
  return authedFetch(`/prayer/availability/${id}/toggle`, { method: "POST" });
}
export function deleteAvailability(id: string): Promise<{ removed: true }> {
  return authedFetch(`/prayer/availability/${id}`, { method: "DELETE" });
}

export interface AvailableNowMatch {
  userId: string; displayName: string; availabilityId: string; timezone: string; availableUntil: string;
}
export function getAvailableNow(): Promise<AvailableNowMatch[]> {
  return authedFetch("/prayer/availability/available-now");
}

export type InvitationStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface PrayerInvitation {
  id: string; requesterId: string; recipientId: string; requestId: string | null;
  proposedStartAt: string; proposedEndAt: string; message: string | null;
  status: InvitationStatus; respondedAt: string | null; createdAt: string; updatedAt: string;
  // Best-effort display-only fields (the other party's most recently used
  // availability timezone, if any) — never authoritative, never used for
  // scheduling logic, only to show "their local time" next to the
  // viewer's own device-accurate local time.
  requesterTimezone: string | null; recipientTimezone: string | null;
  requesterName: string | null; recipientName: string | null;
}

export function createInvitation(input: {
  recipientId: string; requestId?: string | null; proposedStartAt: string; proposedEndAt: string; message?: string;
}): Promise<PrayerInvitation> {
  return authedFetch("/prayer/invitations", { method: "POST", body: JSON.stringify(input) });
}
export function getMyInvitations(): Promise<PrayerInvitation[]> {
  return authedFetch("/prayer/invitations/mine");
}
export function getInvitation(id: string): Promise<PrayerInvitation> {
  return authedFetch(`/prayer/invitations/${id}`);
}
export function acceptInvitation(id: string): Promise<{ invitation: PrayerInvitation; gathering: PrayerGathering }> {
  return authedFetch(`/prayer/invitations/${id}/accept`, { method: "POST" });
}
export function declineInvitation(id: string): Promise<PrayerInvitation> {
  return authedFetch(`/prayer/invitations/${id}/decline`, { method: "POST" });
}
export function cancelInvitation(id: string): Promise<PrayerInvitation> {
  return authedFetch(`/prayer/invitations/${id}/cancel`, { method: "POST" });
}

export type GatheringStatus = "scheduled" | "starting" | "live" | "completed" | "cancelled" | "expired";

export interface PrayerGathering {
  id: string; invitationId: string; hostId: string; recipientId: string; requestId: string | null;
  scheduledStartAt: string; scheduledEndAt: string; status: GatheringStatus;
  prayerFocus: string | null; scriptureReference: unknown; channelName: string | null; callLogId: string | null;
  actualStartAt: string | null; actualEndAt: string | null; createdAt: string; updatedAt: string;
  hostTimezone: string | null; recipientTimezone: string | null;
}
export interface PrayerGatheringParticipant {
  id: string; userId: string; role: "host" | "participant"; status: "invited" | "joined" | "left";
  joinedAt: string | null; leftAt: string | null; displayName: string;
}

export function getMyGatherings(): Promise<PrayerGathering[]> {
  return authedFetch("/prayer/gatherings/mine");
}
export function getGathering(id: string): Promise<{ gathering: PrayerGathering; participants: PrayerGatheringParticipant[] }> {
  return authedFetch(`/prayer/gatherings/${id}`);
}
export function cancelGathering(id: string): Promise<PrayerGathering> {
  return authedFetch(`/prayer/gatherings/${id}/cancel`, { method: "POST" });
}
// Called only from a REAL Agora callback (onJoinChannelSuccess / leave),
// never from a button click alone — see app/call/prayer.tsx.
export function joinGathering(id: string): Promise<PrayerGathering> {
  return authedFetch(`/prayer/gatherings/${id}/join`, { method: "POST" });
}
export function leaveGathering(id: string): Promise<PrayerGathering> {
  return authedFetch(`/prayer/gatherings/${id}/leave`, { method: "POST" });
}
