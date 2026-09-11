import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Every route on the server side (routes/churchCalls.ts) resolves identity
// via verifyCaller() — a real Supabase JWT — never a client-supplied id.
// Exact mirror of lib/familyApi.ts's authedFetch, kept as its own local
// copy rather than a shared import, matching this codebase's existing
// per-feature-file convention.
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

export type ChurchCallPurpose =
  "meeting" | "teaching" | "bible_study" | "prayer" | "leadership" | "small_group" | "fellowship" | "church_gathering" | "other";
export type ChurchCallScope = "church" | "cohort";
export type ChurchCallStatus = "scheduled" | "live" | "ended";

export interface ChurchCallScripture {
  book: string; chapter: number; startVerse: number; endVerse: number; translation: string;
}
export interface ChurchCallMedia { provider: string; id: string; url: string | null }

export interface ChurchCall {
  id: string; churchId: string; hostId: string | null; title: string;
  purpose: ChurchCallPurpose; scope: ChurchCallScope; cohortId: string | null;
  channelName: string | null; status: ChurchCallStatus;
  startedAt: string | null; endedAt: string | null; createdAt: string;
  scheduledStartAt: string | null; expectedDurationMinutes: number | null; description: string | null;
  lessonId: string | null; scriptureReference: ChurchCallScripture | null; media: ChurchCallMedia | null;
  hostSummary: string | null; continuityNotes: string | null;
}

export function startChurchCall(churchId: string, title: string, purpose: ChurchCallPurpose, scope: ChurchCallScope, cohortId?: string): Promise<ChurchCall> {
  return authedFetch(`/churches/${churchId}/calls`, { method: "POST", body: JSON.stringify({ title, purpose, scope, cohortId }) });
}
export function scheduleChurchCall(
  churchId: string, title: string, purpose: ChurchCallPurpose, scope: ChurchCallScope,
  scheduledStartAt: string, expectedDurationMinutes?: number, description?: string, cohortId?: string
): Promise<ChurchCall> {
  return authedFetch(`/churches/${churchId}/calls/schedule`, {
    method: "POST", body: JSON.stringify({ title, purpose, scope, cohortId, scheduledStartAt, expectedDurationMinutes, description }),
  });
}
export function startScheduledChurchCall(callId: string): Promise<ChurchCall> {
  return authedFetch(`/churches/calls/${callId}/start`, { method: "POST" });
}
export function getChurchCalls(churchId: string): Promise<{ live: ChurchCall[]; upcoming: ChurchCall[]; recent: ChurchCall[] }> {
  return authedFetch(`/churches/${churchId}/calls`);
}
export interface ChurchCallParticipant {
  userId: string; name: string; photoUrl: string | null; micDisabledByHost: boolean; videoDisabledByHost: boolean;
}
export interface ChurchCallLessonContext {
  lessonId: string; lessonTitle: string; moduleId: string; moduleTitle: string; curriculumId: string | null; curriculumTitle: string | null;
}
export interface ChurchCallDetail {
  call: ChurchCall; lesson: ChurchCallLessonContext | null; participants: ChurchCallParticipant[];
}
export function getChurchCall(callId: string): Promise<ChurchCallDetail> {
  return authedFetch(`/churches/calls/${callId}`);
}
export function joinChurchCall(callId: string): Promise<ChurchCall> {
  return authedFetch(`/churches/calls/${callId}/join`, { method: "POST" });
}
export function leaveChurchCall(callId: string): Promise<{ left: true }> {
  return authedFetch(`/churches/calls/${callId}/leave`, { method: "POST" });
}
export function endChurchCall(callId: string): Promise<ChurchCall> {
  return authedFetch(`/churches/calls/${callId}/end`, { method: "POST" });
}

// ── Stage 2 — Moderation ─────────────────────────────────────────────────
export function setParticipantMicDisabled(callId: string, userId: string, disabled: boolean): Promise<{ userId: string; micDisabledByHost: boolean }> {
  return authedFetch(`/churches/calls/${callId}/participants/${userId}/mic`, { method: "POST", body: JSON.stringify({ disabled }) });
}
export function setParticipantVideoDisabled(callId: string, userId: string, disabled: boolean): Promise<{ userId: string; videoDisabledByHost: boolean }> {
  return authedFetch(`/churches/calls/${callId}/participants/${userId}/video`, { method: "POST", body: JSON.stringify({ disabled }) });
}
export function removeParticipant(callId: string, userId: string): Promise<{ removed: true }> {
  return authedFetch(`/churches/calls/${callId}/participants/${userId}/remove`, { method: "POST" });
}

// ── Stage 2 — Chat ────────────────────────────────────────────────────────
export interface ChurchCallMessage { id: string; callId: string; userId: string; authorName: string; content: string; createdAt: string }
export function getChurchCallMessages(callId: string): Promise<ChurchCallMessage[]> {
  return authedFetch(`/churches/calls/${callId}/messages`);
}
export function sendChurchCallMessage(callId: string, content: string): Promise<ChurchCallMessage> {
  return authedFetch(`/churches/calls/${callId}/messages`, { method: "POST", body: JSON.stringify({ content }) });
}

// ── Stage 4 — Notes ───────────────────────────────────────────────────────
export interface ChurchCallNote { id: string; callId: string; authorId: string; authorName: string; visibility: "shared" | "private"; content: string; createdAt: string }
export function getChurchCallNotes(callId: string): Promise<ChurchCallNote[]> {
  return authedFetch(`/churches/calls/${callId}/notes`);
}
export function addChurchCallNote(callId: string, content: string, visibility?: "shared" | "private"): Promise<ChurchCallNote> {
  return authedFetch(`/churches/calls/${callId}/notes`, { method: "POST", body: JSON.stringify({ content, visibility }) });
}

// ── Stage 4 — Scripture / Lesson / Media ─────────────────────────────────
export function setChurchCallScripture(callId: string, scripture: ChurchCallScripture): Promise<{ scriptureReference: ChurchCallScripture }> {
  return authedFetch(`/churches/calls/${callId}/scripture`, { method: "PUT", body: JSON.stringify(scripture) });
}
export function setChurchCallLesson(callId: string, lessonId: string | null): Promise<{ lesson: ChurchCallLessonContext | null }> {
  return authedFetch(`/churches/calls/${callId}/lesson`, { method: "PUT", body: JSON.stringify({ lessonId }) });
}
export function setChurchCallMedia(callId: string, media: { provider: string; id: string; url?: string } | null): Promise<{ media: ChurchCallMedia | null }> {
  return authedFetch(`/churches/calls/${callId}/media`, { method: "PUT", body: JSON.stringify(media ?? {}) });
}

// ── Stage 5 — Summary, Continuity, Journey ───────────────────────────────
export function setChurchCallHostSummary(callId: string, summary: string): Promise<{ ok: true }> {
  return authedFetch(`/churches/calls/${callId}/host-summary`, { method: "PUT", body: JSON.stringify({ summary }) });
}
export function setChurchCallContinuityNotes(callId: string, notes: string): Promise<{ ok: true }> {
  return authedFetch(`/churches/calls/${callId}/continuity-notes`, { method: "PUT", body: JSON.stringify({ notes }) });
}
export interface ChurchCallSummary {
  overview: { churchId: string; title: string; purpose: ChurchCallPurpose; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; host: { id: string; name: string; photoUrl: string | null } | null };
  participation: { participantCount: number; participants: { userId: string; name: string; photoUrl: string | null }[] };
  scripture: { reference: ChurchCallScripture | null; label: string | null };
  study: ChurchCallLessonContext | null;
  media: { provider: string; id: string } | null;
  discussion: { messageCount: number; contributorCount: number };
  notes: { authorCount: number };
  hostSummary: string | null; continuityNotes: string | null;
  timeline: { type: string; data: Record<string, unknown> | null; at: string }[];
}
export function getChurchCallSummary(callId: string): Promise<ChurchCallSummary> {
  return authedFetch(`/churches/calls/${callId}/summary`);
}
export function getChurchCallContinuity(churchId: string): Promise<{ previousCall: ChurchCall | null; nextScheduledCall: ChurchCall | null }> {
  return authedFetch(`/churches/${churchId}/calls/continue`);
}
export function getChurchCallJourney(churchId: string): Promise<{ totalCalls: number; byPurpose: Record<string, number>; scriptureReferences: string[]; lessonsCoveredCount: number }> {
  return authedFetch(`/churches/${churchId}/calls/journey`);
}

export const CHURCH_CALL_PURPOSE_LABELS: Record<ChurchCallPurpose, string> = {
  meeting: "Meeting", teaching: "Teaching", bible_study: "Bible Study", prayer: "Prayer",
  leadership: "Leadership", small_group: "Small Group", fellowship: "Fellowship",
  church_gathering: "Church Gathering", other: "Other",
};
