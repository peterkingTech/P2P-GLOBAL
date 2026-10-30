import { getApiUrl } from "./apiUrl";
import { apiRequest } from "@/lib/apiClient";

// Study Together C3 — Group Study Together. Same scoped real-identity
// exception C2's callInvitations.ts introduced: these endpoints verify the
// caller's actual Supabase session server-side, never a body-supplied id.
const post = <T,>(path: string, body?: unknown) =>
  apiRequest<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }, { fallbackError: "Something went wrong." });

export interface GroupStudyParticipant { userId: string; name: string }

export interface CurrentGroupStudy {
  active: boolean;
  callEnded?: boolean;
  sessionId?: string;
  lessonId?: string;
  moduleId?: string | null;
  title?: string | null;
  leaderId?: string;
  currentSectionIndex?: number;
  participants?: GroupStudyParticipant[];
  channelName?: string;
  callType?: string;
  conversationId?: string | null;
}

export async function getCurrentGroupStudy(callId: string): Promise<CurrentGroupStudy> {
  return apiRequest(`/calls/${callId}/study/current`, {}, { fallbackError: "Couldn't load the current study session." });
}

export async function startGroupStudy(callId: string, lessonId: string, moduleId: string, title: string): Promise<{ sessionId: string; leaderId: string }> {
  return post(`/calls/${callId}/study/start`, { lessonId, moduleId, title });
}

export async function joinGroupStudy(callId: string): Promise<{ sessionId: string; leaderId: string; lessonId: string; moduleId: string | null; title: string | null; currentSectionIndex: number }> {
  return post(`/calls/${callId}/study/join`);
}

export async function updateGroupStudySection(callId: string, index: number): Promise<void> {
  await post(`/calls/${callId}/study/section`, { index });
}

// C4.7/C4.3 — reports ANY departed study participant, not just the leader
// (a rank-and-file departure still needs to be cleared from the active
// roster); the server only recomputes a leader when the departure actually
// affects leadership.
export async function reportStudyParticipantDeparted(callId: string, departedUserId: string): Promise<{ sessionId: string; leaderId: string | null; ended: boolean; leaderChanged: boolean }> {
  return post(`/calls/${callId}/study/participant-departed`, { departedUserId });
}

export async function endGroupStudy(callId: string): Promise<void> {
  await post(`/calls/${callId}/study/end`);
}

// Study Together C6 — leader-only, enforced server-side in
// p2p_remove_study_participant (never trust the client's own isLeader flag
// as authorization).
export async function removeStudyParticipant(callId: string, targetUserId: string): Promise<void> {
  await post(`/calls/${callId}/study/participants/${targetUserId}/remove`);
}

export interface GroupStudyProgress { [userId: string]: { status: string; completed: boolean } }

export async function getGroupStudyProgress(callId: string, requesterId: string, lessonId: string): Promise<GroupStudyProgress> {
  const params = new URLSearchParams({ requesterId, lessonId });
  const res = await fetch(`${getApiUrl()}/calls/${callId}/study-progress?${params.toString()}`);
  if (!res.ok) return {};
  const data = await res.json();
  return data.participants ?? {};
}