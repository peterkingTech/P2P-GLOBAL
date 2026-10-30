import { apiRequest } from "@/lib/apiClient";

// Study Together — shared (asynchronous) studies (migration 216,
// routes/studyTogether.ts). The live in-call Study Together (lib/callStart,
// StudyTogetherOverlay) is separate and unchanged; a shared study links to
// the existing chat and call screens when people want to talk live.
// Every check (who you may invite, group leadership, blocks, membership)
// happens on the server; this file only calls it.

const authedFetch = (path: string, init?: RequestInit) => apiRequest(path, init, {
  base: "/study-together", fallbackError: "Something went wrong. Please try again.",
  makeError: (message, status, b) => Object.assign(new Error(message), { status, studyId: (b.studyId as string | undefined) ?? null }),
});
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
/** A Family Circle / Church custom study the reader's group has published (opens the group's own study screen). */
export interface GroupLessonCard { id: string; kind: "family" | "church"; title: string; description: string | null; groupId: string; groupName: string | null; updatedAt: string }
export interface MyStudies { invitations: StudyCard[]; active: StudyCard[]; concluded: StudyCard[]; groupLessons?: GroupLessonCard[] }
export const getMyStudies = (): Promise<MyStudies> => authedFetch("/mine");

// ── The Study Together hub: one collection over the real records ─────────────
export type HubFilter = "all" | "kingdom_story" | "lesson" | "group_lessons";
export const HUB_FILTER_LABELS: Record<HubFilter, string> = { all: "All", kingdom_story: "Kingdom Stories", lesson: "Kingdom School", group_lessons: "Family & Church studies" };
export interface HubItem { key: string; kind: "shared" | "group_lesson"; filter: Exclude<HubFilter, "all">; title: string; typeLabel: string; where: string; when: string; concluded: boolean; route: { pathname: string; params: Record<string, string> } }

/** Every study the reader can open, newest activity first — references only, nothing copied. */
export function hubItems(d: MyStudies): HubItem[] {
  const shared = (x: StudyCard, concluded: boolean): HubItem => ({
    key: `s:${x.id}`, kind: "shared", filter: x.contentType, title: x.title,
    typeLabel: x.contentType === "kingdom_story" ? "Kingdom Story" : "Kingdom School lesson",
    where: x.destination.type === "peer" ? (x.isHost ? "With the peers you invited" : `With ${x.host.name}`) : `${DESTINATION_LABELS[x.destination.type]}${x.destination.name ? ` · ${x.destination.name}` : ""}`,
    when: x.lastOpenedAt ?? x.updatedAt, concluded, route: { pathname: "/study-together/[id]", params: { id: x.id } },
  });
  const group = (g: GroupLessonCard): HubItem => ({
    key: `g:${g.kind}:${g.id}`, kind: "group_lesson", filter: "group_lessons", title: g.title,
    typeLabel: g.kind === "family" ? "Family Circle study" : "Church study", where: g.groupName ?? (g.kind === "family" ? "Your Family Circle" : "Your church"),
    when: g.updatedAt, concluded: false,
    route: g.kind === "family" ? { pathname: "/family/studies/[studyId]", params: { studyId: g.id } } : { pathname: "/church/studies/[studyId]", params: { studyId: g.id } },
  });
  const t = (v: string) => new Date(v).getTime() || 0;
  return [...d.active.map((x) => shared(x, false)), ...(d.groupLessons ?? []).map(group), ...d.concluded.map((x) => shared(x, true))]
    .sort((a, b) => Number(a.concluded) - Number(b.concluded) || t(b.when) - t(a.when));
}
/** Only the filters that have something behind them (never an empty, pretend category). */
export function hubFilters(items: HubItem[]): HubFilter[] {
  return ["all", ...(["kingdom_story", "lesson", "group_lessons"] as const).filter((f) => items.some((i) => i.filter === f))];
}
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
