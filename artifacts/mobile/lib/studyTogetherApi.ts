import { supabase } from "@/contexts/AuthContext";
import { getApiUrl } from "@/lib/apiUrl";

// Study Together — shared (asynchronous) studies (migration 216,
// routes/studyTogether.ts). The live in-call Study Together (lib/callStart,
// StudyTogetherOverlay) is separate and unchanged; a shared study links to
// the existing chat and call screens when people want to talk live.
// Every check (who you may invite, group leadership, blocks, membership)
// happens on the server; this file only calls it.

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${getApiUrl()}/study-together${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const b = body as { error?: string; studyId?: string };
    throw Object.assign(new Error(b.error ?? "Something went wrong. Please try again."), { status: res.status, studyId: b.studyId ?? null });
  }
  return body;
}
const post = (path: string, body?: unknown) => authedFetch(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export type StudyContentType = "kingdom_story" | "lesson";
export type StudyDestination = "peer" | "family" | "church" | "circle" | "group";
export type PeerRelationship = "peer_guide" | "disciple" | "connection" | "friend";

export const DESTINATION_LABELS: Record<StudyDestination, string> = {
  peer: "A Peer", family: "Family Circle", church: "Church", circle: "Circle", group: "Group",
};
export const RELATIONSHIP_LABELS: Record<PeerRelationship, string> = {
  peer_guide: "Your Peer Guide", disciple: "Your disciple", friend: "P2P connection", connection: "In your group",
};

export interface StudyPerson { id: string; name: string; photoUrl: string | null; relationship: PeerRelationship }
export interface LedGroup { type: StudyDestination; id: string; name: string }
export interface StudyCard {
  id: string; title: string; contentType: StudyContentType; contentId: string; status: "active" | "concluded";
  destination: { type: StudyDestination; id: string | null; name: string | null };
  host: { id: string; name: string }; isHost: boolean;
  myStatus: string | null; invitedAt: string | null; expiresAt: string | null; lastOpenedAt: string | null; updatedAt: string;
}
export interface StudySection { id: string; number: number; title: string; questions: string[] }
export interface StudyPrompt { id: string; sectionId: string | null; body: string; createdAt: string }
export interface StudyResponse { id: string; promptId: string | null; sectionId: string | null; questionIndex: number | null; body: string; createdAt: string; userId: string; name: string; mine: boolean }
export interface StudyMember { userId: string; name: string; photoUrl: string | null; role: "host" | "member"; status: string; lastOpenedAt: string | null }
export interface SharedStudy {
  id: string; title: string; subtitle: string | null; status: "active" | "concluded"; contentType: StudyContentType; contentId: string; contentAvailable: boolean;
  destination: { type: StudyDestination; id: string | null; name: string | null };
  host: { id: string; name: string; photoUrl: string | null };
  me: { isHost: boolean; isLeader: boolean; canParticipate: boolean; invited: boolean; status: string | null; expiresAt: string | null };
  sections: StudySection[]; currentSectionId: string | null;
  prompts: StudyPrompt[]; responses: StudyResponse[]; members: StudyMember[];
  participation: { joined: number; openedThisWeek: number; sharedResponses: number; groupSize: number | null } | null;
  createdAt: string; updatedAt: string; concludedAt: string | null;
}

export const getStudyDestinations = (): Promise<{ people: StudyPerson[]; groups: LedGroup[]; maxPeople: number }> => authedFetch("/destinations");
export const startSharedStudy = (input: { contentType: StudyContentType; contentId: string; destination: StudyDestination; groupId?: string; userIds?: string[]; prompt?: string }): Promise<{ id: string; existing?: boolean; invited?: number }> => post("", input);
export const getMyStudies = (): Promise<{ invitations: StudyCard[]; active: StudyCard[]; concluded: StudyCard[] }> => authedFetch("/mine");
export const getSharedStudy = (id: string): Promise<SharedStudy> => authedFetch(`/${id}`);
export const respondToStudy = (id: string, response: "accepted" | "declined") => post(`/${id}/respond`, { response });
export const inviteToStudy = (id: string, userIds: string[]) => post(`/${id}/invite`, { userIds });
export const cancelStudyInvite = (id: string, userId: string) => post(`/${id}/cancel-invite`, { userId });
export const leaveStudy = (id: string) => post(`/${id}/leave`);
export const concludeStudy = (id: string) => post(`/${id}/conclude`);
export const reopenStudy = (id: string) => post(`/${id}/reopen`);
export const setStudyPosition = (id: string, sectionId: string | null) => authedFetch(`/${id}/position`, { method: "PUT", body: JSON.stringify({ sectionId }) });
export const addStudyPrompt = (id: string, body: string, sectionId: string | null) => post(`/${id}/prompts`, { body, sectionId });
export const removeStudyPrompt = (id: string, promptId: string) => authedFetch(`/${id}/prompts/${promptId}`, { method: "DELETE" });
export const postStudyResponse = (id: string, input: { body: string; promptId?: string | null; sectionId?: string | null; questionIndex?: number | null }) => post(`/${id}/responses`, input);
export const removeStudyResponse = (id: string, responseId: string) => authedFetch(`/${id}/responses/${responseId}`, { method: "DELETE" });
export const markStudyOpened = (id: string) => post(`/${id}/opened`).catch(() => null);

/** Where "Open the story / lesson" goes — each person reads with their own progress. */
export function contentRoute(s: { contentType: StudyContentType; contentId: string }, sectionId?: string | null): { pathname: string; params: Record<string, string> } {
  if (s.contentType === "lesson") return { pathname: "/lesson/[id]", params: { id: s.contentId } };
  return sectionId
    ? { pathname: "/kingdom-stories/chapter", params: { id: s.contentId, chapter: sectionId } }
    : { pathname: "/kingdom-stories/[id]", params: { id: s.contentId } };
}

/** "Invited 2 days ago · expires in 12 days" style status for an invitation. */
export function invitationNote(card: { expiresAt: string | null }, now = Date.now()): string | null {
  if (!card.expiresAt) return null;
  const days = Math.ceil((new Date(card.expiresAt).getTime() - now) / 86400000);
  if (days <= 0) return "This invitation has expired.";
  return days === 1 ? "Expires tomorrow." : `Expires in ${days} days.`;
}

/** Responses grouped under the question they answer (chapter question or leader prompt). */
export function responsesFor(all: StudyResponse[], q: { promptId?: string; sectionId?: string; questionIndex?: number }): StudyResponse[] {
  if (q.promptId) return all.filter((r) => r.promptId === q.promptId);
  return all.filter((r) => !r.promptId && r.sectionId === (q.sectionId ?? null) && r.questionIndex === (q.questionIndex ?? null));
}
