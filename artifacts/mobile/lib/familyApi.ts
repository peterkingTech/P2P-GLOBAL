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

// A user may belong to several families at once — "My Family" represents
// all of the user's family relationships, not one single identity.
export interface FamilySummary { family: Family; myRole: FamilyRole; memberCount: number }
export interface MyFamiliesResponse {
  families: FamilySummary[]; pendingInvitations: FamilyInvitation[];
}
export interface FamilyDetailResponse {
  family: Family; members: FamilyMember[]; myRole: FamilyRole;
  canManage: boolean; pendingInvitations: FamilyInvitation[];
  // Non-null when a Gathering is already in progress for this family — lets
  // the UI offer "Join Family Gathering" instead of "Start Gathering".
  activeSessionId: string | null;
}

export function getMyFamilies(): Promise<MyFamiliesResponse> {
  return authedFetch("/family/mine");
}
// One specific family's full detail (roster, caller's role in THIS
// family) — every per-family screen fetches by familyId rather than
// assuming there is only one.
export function getFamilyDetail(familyId: string): Promise<FamilyDetailResponse> {
  return authedFetch(`/family/${familyId}`);
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
  scripture_reference?: WorshipScripture | null;
}
export function getFamilyPrayerRequests(familyId: string): Promise<FamilyPrayerRequest[]> {
  return authedFetch(`/family/${familyId}/prayer-requests`);
}
export function createFamilyPrayerRequest(
  familyId: string, content: string, visibility: "private" | "family", scriptureReference?: WorshipScripture | null
) {
  return authedFetch(`/family/${familyId}/prayer-requests`, { method: "POST", body: JSON.stringify({ content, visibility, scriptureReference }) });
}
export function updateFamilyPrayerRequestStatus(familyId: string, id: string, status: "prayed" | "answered") {
  return authedFetch(`/family/${familyId}/prayer-requests/${id}/status`, { method: "PUT", body: JSON.stringify({ status }) });
}

export type WorshipMode = "worship" | "scripture" | "prayer" | "sharing" | "silent_prayer" | "teaching";
// mediaProvider is the new provider boundary (lib/mediaProviders) — when
// set, mediaId holds that provider's external id and mediaType/mediaUrl
// are unused. When null, mediaType/mediaUrl carry the legacy raw-file
// shape exactly as before this feature — nothing about that path changed.
export type SharedMediaProvider = "youtube";
export type MediaPermission = "guide_only" | "trusted" | "everyone";
// Structured, not a free-text reference — P2P Together Phase 6's explicit
// "prefer storing translation/book/chapter/startVerse/endVerse rather than
// duplicating an entire Bible translation inside the session" requirement.
export interface WorshipScripture {
  translation: string; translationName?: string;
  book: string; chapter: number; startVerse: number; endVerse: number;
}
export interface WorshipSession {
  id: string; familyId: string; hostId: string; status: string; currentMode: WorshipMode;
  mediaProvider: SharedMediaProvider | null;
  mediaType: "video" | "audio" | null; mediaId: string | null; mediaUrl: string | null;
  playbackBasePositionMs: number; playbackBaseServerTime: string; playbackRate: number; isPlaying: boolean;
  currentScripture: WorshipScripture | null;
  channelName: string; startedAt: string | null; endedAt: string | null;
  mediaPermission: MediaPermission; trustedUserIds: string[]; autoAdvance: boolean;
  participants?: { user_id: string; joined_at: string; camera_on: boolean; mic_on: boolean; presence_status: string }[];
  currentFocusPrayerRequestId: string | null;
  lessonId: string | null;
}

export function formatScriptureReference(s: WorshipScripture): string {
  const verses = s.startVerse === s.endVerse ? `${s.startVerse}` : `${s.startVerse}-${s.endVerse}`;
  return `${s.book} ${s.chapter}:${verses}${s.translationName ? ` (${s.translation})` : ""}`;
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
  isPlaying?: boolean; positionMs?: number; playbackRate?: number; currentScripture?: WorshipScripture | null;
  focusPrayerRequestId?: string | null; lessonId?: string | null;
}): Promise<WorshipSession> {
  return authedFetch(`/family/worship/sessions/${sessionId}/state`, { method: "PUT", body: JSON.stringify(patch) });
}
// Prayer participation ("I'm praying") — persists via the existing
// participant row (presence_status), so a late joiner/reconnect sees it
// on their next GET; the worship screen also broadcasts it for instant
// delivery to already-connected clients, same dual-path as chat.
export function updateWorshipPresence(sessionId: string, presenceStatus: "joined" | "listening" | "praying" | "away") {
  return authedFetch(`/family/worship/sessions/${sessionId}/presence`, { method: "PUT", body: JSON.stringify({ presenceStatus }) });
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
  media_provider: string | null; media_id: string | null; prayer_request_count: number; notes_count: number;
  guide_id: string | null; started_at: string | null; ended_at: string | null; guide_summary: string | null;
  lesson_id: string | null; continuity_notes: string | null; lesson_title: string | null;
}

// Family Gathering Session Summary — a derived read of the same completed-
// session facts p2p_family_worship_history/session_events already hold;
// never a second copy of message/note/prayer-request content (see
// familyWorship.ts's GET /worship/history/:historyId comment).
export interface WorshipSessionSummary {
  id: string; familyId: string; sessionId: string;
  durationSeconds: number; startedAt: string | null; endedAt: string | null; modesVisited: string[];
  guide: { id: string; name: string; photoUrl: string | null } | null;
  guideSummary: string | null;
  continuityNotes: string | null;
  study: { lessonId: string; lessonTitle: string; moduleTitle: string; curriculumTitle: string | null } | null;
  participants: { userId: string; name: string; photoUrl: string | null }[];
  participation: { participantCount: number; contributorCount: number };
  scripture: { references: string[] };
  media: { items: { provider: string; id: string }[] };
  prayer: {
    requestCount: number; contributorCount: number; scriptureLinkedCount: number; answeredCount: number;
    answeredPrayers: { id: string; content: string }[];
  };
  share: { messageCount: number; contributorCount: number };
  notes: { authorCount: number };
  timeline: { type: string; data: Record<string, unknown> | null; at: string }[];
}
export function getWorshipSessionSummary(historyId: string): Promise<WorshipSessionSummary> {
  return authedFetch(`/family/worship/history/${historyId}`);
}
export function updateGuideSummary(historyId: string, summary: string): Promise<{ ok: true }> {
  return authedFetch(`/family/worship/history/${historyId}/guide-summary`, { method: "PUT", body: JSON.stringify({ summary }) });
}
export function updateContinuityNotes(historyId: string, notes: string): Promise<{ ok: true }> {
  return authedFetch(`/family/worship/history/${historyId}/continuity-notes`, { method: "PUT", body: JSON.stringify({ notes }) });
}

// ── Stage 2: Discipleship Continuity ────────────────────────────────────
// Both derived purely from existing p2p_family_worship_history/session_events
// plus the existing curriculum tables (p2p_curriculums/modules/lessons) —
// see familyWorship.ts's GET /worship/continue-study and /worship/journey.
export interface ContinueStudyResponse {
  previousGathering: {
    historyId: string; createdAt: string; durationSeconds: number; participantCount: number;
    scriptureReferences: string[]; guideSummary: string | null; continuityNotes: string | null;
    lessonTitle: string | null; moduleTitle: string | null; curriculumTitle: string | null;
  } | null;
  continueStudy: {
    curriculumTitle: string | null; previousLessonId: string; previousLessonTitle: string;
    nextLessonId: string; nextLessonTitle: string; nextModuleTitle: string | null;
  } | null;
  discipleshipJourney: {
    curriculumTitle: string | null;
    lessons: { id: string; title: string; status: "done" | "current" | "upcoming" }[];
  } | null;
}
export function getContinueStudy(familyId: string): Promise<ContinueStudyResponse> {
  return authedFetch(`/family/worship/continue-study?familyId=${familyId}`);
}
export interface FamilyJourneyResponse {
  gatheringCount: number;
  lessonsCoveredCount: number;
  scripture: { count: number; references: string[] };
  media: { count: number; items: { provider: string; id: string }[] };
  prayer: { count: number; answeredCount: number; recentAnswered: { id: string; content: string }[] };
}
export function getFamilyJourney(familyId: string): Promise<FamilyJourneyResponse> {
  return authedFetch(`/family/worship/journey?familyId=${familyId}`);
}

// ── Shared / Private / Scripture-linked Notes ───────────────────────────────────
// Deliberately minimal — see components/family/NotesPanel.tsx.
export interface WorshipNote {
  id: string; sessionId: string; authorId: string; authorName: string;
  visibility: "shared" | "private"; content: string; scriptureReference: WorshipScripture | null;
  createdAt: string; updatedAt: string;
}
export function getWorshipNotes(sessionId: string): Promise<WorshipNote[]> {
  return authedFetch(`/family/worship/sessions/${sessionId}/notes`);
}
export function createWorshipNote(
  sessionId: string, content: string, visibility: "shared" | "private", scriptureReference?: WorshipScripture | null
): Promise<WorshipNote> {
  return authedFetch(`/family/worship/sessions/${sessionId}/notes`, { method: "POST", body: JSON.stringify({ content, visibility, scriptureReference }) });
}
export function deleteWorshipNote(sessionId: string, noteId: string) {
  return authedFetch(`/family/worship/sessions/${sessionId}/notes/${noteId}`, { method: "DELETE" });
}
export function getWorshipHistory(familyId: string): Promise<WorshipHistoryEntry[]> {
  return authedFetch(`/family/worship/history?familyId=${familyId}`);
}

// Bible endpoints (routes/bible.ts) are deliberately public — no auth
// middleware, same as the app's existing pre-Together Scripture lookups —
// so these use plain fetch, not authedFetch.
export interface BibleTranslation { translation_code: string; translation_name: string; provider: string; is_licensed_confirmed: boolean }
export async function getBibleTranslations(languageCode: string): Promise<BibleTranslation[]> {
  const res = await fetch(`${getApiUrl()}/bible/translations?lang=${encodeURIComponent(languageCode)}`);
  if (!res.ok) return [];
  return res.json();
}
export interface BiblePassage { translationCode: string; translationName: string; book: string; chapter: number; verses: { verse: number; text: string }[] }
export async function getBiblePassage(book: string, chapter: number, startVerse: number, endVerse: number, translationCode: string): Promise<BiblePassage> {
  const res = await fetch(`${getApiUrl()}/bible/passage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book, chapter, startVerse, endVerse, translationCode }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Couldn't load that passage");
  return body;
}

// P2P Together Phase 7 — Conversation's "Scripture references / media
// references / questions" ride the messages table's context column
// (reserved since migration 122, unused until now).
export type MessageContext =
  | ({ type: "scripture" } & WorshipScripture)
  | { type: "media"; mediaProvider: SharedMediaProvider; mediaId: string; positionMs: number }
  | { type: "question" };

export interface WorshipMessage {
  id: string; sessionId: string; userId: string; authorName: string; content: string; context: MessageContext | null; createdAt: string;
}
export function getWorshipMessages(sessionId: string): Promise<WorshipMessage[]> {
  return authedFetch(`/family/worship/sessions/${sessionId}/messages`);
}
export function sendWorshipMessage(sessionId: string, content: string, context?: MessageContext | null): Promise<WorshipMessage> {
  return authedFetch(`/family/worship/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify({ content, context }) });
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