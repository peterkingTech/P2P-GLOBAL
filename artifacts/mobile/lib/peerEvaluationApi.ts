import { apiRequest } from "@/lib/apiClient";
import { syncServerTime } from "@/lib/serverClock";

// Peer Evaluation Engine (routes/peerEvaluation.ts, migration 229). P2P
// Global — not the phone, not the evaluator — chooses evaluators, records the
// acceptance time and the 48-hour deadline, and reassigns. Every response
// carries the server's time, which keeps countdowns honest (lib/serverClock).

export type Stage = "arranging" | "invitation_pending" | "in_progress" | "overdue_reassigning" | "reassigned" | "feedback_ready" | "revision_required" | "completed";
export type Outcome = "passed" | "passed_with_recommendations" | "revision_required" | "further_discussion" | "clarification_required";
export type QuestionStatus = "well_understood" | "partially_understood" | "needs_clarification" | "not_yet_understood";
export type DifferenceKind = "clear_misunderstanding" | "unsupported_conclusion" | "incomplete_explanation" | "reasonable_difference";
export type UnableCategory = "health" | "family" | "time" | "competence" | "conflict" | "technical" | "other";

// The learner-facing lifecycle (the server sends the same wording as statusLabel).
export const STAGE_LABEL: Record<Stage, string> = {
  arranging: "Searching for a qualified evaluator",
  invitation_pending: "Assigned — waiting for the evaluator to accept",
  in_progress: "Under evaluation",
  overdue_reassigning: "Reassigned — the evaluator's time ran out",
  reassigned: "Reassigned to another qualified evaluator",
  feedback_ready: "Approved — feedback ready",
  revision_required: "Returned for correction",
  completed: "Completed",
};
export const OUTCOME_LABEL: Record<Outcome, string> = {
  passed: "Passed", passed_with_recommendations: "Passed with recommendations", revision_required: "Revision required",
  further_discussion: "Further discussion recommended", clarification_required: "Clarification required",
};
export const QUESTION_STATUS_LABEL: Record<QuestionStatus, string> = {
  well_understood: "Well understood", partially_understood: "Partially understood", needs_clarification: "Needs clarification", not_yet_understood: "Not yet understood",
};
export const DIFFERENCE_LABEL: Record<DifferenceKind, string> = {
  clear_misunderstanding: "A clear misunderstanding", unsupported_conclusion: "A conclusion the lesson doesn't support",
  incomplete_explanation: "An incomplete explanation", reasonable_difference: "A reasonable difference of interpretation",
};
export const UNABLE_LABEL: Record<UnableCategory, string> = {
  health: "Health", family: "Family or personal matter", time: "Not enough time", competence: "Outside what I'm prepared to evaluate",
  conflict: "Conflict of interest", technical: "Technical problem", other: "Something else",
};

export interface MyEvaluation {
  id: string; lessonId: string; lessonTitle: string; curriculum: string | null; submittedAt: string; stage: Stage; engine: boolean;
  acceptedAt: string | null; deadlineAt: string | null; evaluator: { name: string; photoUrl: string | null } | null; outcome: Outcome | null;
}
export interface ReviewCard {
  assignmentId: string; evaluationId: string; status: string; lessonTitle: string; curriculum: string | null;
  invitedAt: string; inviteExpiresAt: string; acceptedAt: string | null; deadlineAt: string | null; endedAt: string | null; evaluateeName: string | null; outcome: Outcome | null;
}
export interface FeedbackDetail {
  questions: { questionId: string; status: QuestionStatus; note: string; kind: DifferenceKind | null }[];
  understoodWell: string; needsImprovement: string; misunderstandings: string; scriptures: string; recommendedLessons: string; nextSteps: string; encouragement: string; comments: string;
}
export interface EvaluateeView {
  role: "evaluatee"; id: string; lessonTitle: string; curriculum: string | null; checkTitle: string | null; submittedAt: string; acceptedAt: string | null; deadlineAt: string | null;
  stage: Stage; evaluator: { name: string; photoUrl: string | null } | null; history: { at: string; text: string }[]; engine: boolean; discussionId: string | null;
  feedback: { outcome: Outcome; summary: string | null; detail: FeedbackDetail | null; questions: { id: string; question: string }[] } | null; canRate: boolean; canDiscuss: boolean;
}
export interface WorkspaceView {
  role: "evaluator"; id: string; assignmentId: string | null; state: string; lessonTitle: string; curriculum: string | null; checkTitle: string | null; submittedAt: string;
  acceptedAt: string | null; deadlineAt: string | null; evaluatee: { name: string; photoUrl: string | null }; instructions: string | null;
  questions: { id: string; question: string; answer: { type: string; text: string | null; mediaUrl: string | null } | null }[];
  overallAnswer: { type: string; text: string | null; mediaUrl: string | null }[]; draft: Partial<FeedbackDetail> & { outcome?: Outcome } | null; draftSavedAt: string | null;
  submitted: { outcome: Outcome; detail: FeedbackDetail; summary: string } | null; discussionId: string | null;
}
export interface Invitation {
  assignmentId: string; status: string; inviteExpiresAt: string; lessonTitle: string; curriculum: string | null; kind: string; checkTitle: string | null; questionCount: number;
  answerFormat: string; expectedWork: string; competence: string; deadlinePolicy: string; safeguarding: string;
  /** Agreed by accepting (240: there is no separate orientation or sign-up). */
  commitments?: string[];
}
export interface EvaluatorProfile {
  /** Always true since 240 (no orientation gate); kept for older builds. */
  oriented: boolean; guideRead?: boolean; qualifiedResources?: number; howInvited?: string; available: boolean; unavailableUntil: string | null; capacity: number; categories: string[]; standing: "good" | "under_review" | "restricted"; restrictionReason: string | null;
  commitments: { id: string; text: string }[]; deadlineHours: number; invitationWindowMinutes: number; engineEnabled: boolean;
  record: { invited: number; accepted: number; completed: number; onTime: number; onTimeRate: number | null; missedDeadlines: number; declined: number; expired: number; unableReports: number; ratings: number; helpedUnderstandRate: number | null };
  recognitions: { id: string; title: string; reason: string }[];
}

const call = async <T,>(path: string, init: RequestInit = {}) => {
  const r = await apiRequest<T & { serverNow?: string }>(`/evaluation${path}`, init, { fallbackError: "That didn't work. Please try again." });
  if (r && typeof r === "object" && typeof (r as { serverNow?: string }).serverNow === "string") syncServerTime((r as { serverNow: string }).serverNow);
  return r as T;
};
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const getEvaluatorProfile = () => call<EvaluatorProfile>("/me/evaluator");
export const acknowledgeOrientation = (commitments: string[]) => call<{ oriented: true }>("/me/orientation", json("POST", { commitments }));
export const updateAvailability = (p: { available?: boolean; unavailableUntil?: string | null; capacity?: number; categories?: string[] }) => call<{ saved: true }>("/me/evaluator", json("PUT", p));
export const myEvaluations = () => call<{ items: MyEvaluation[] }>("/mine");
export const reviewing = () => call<{ invitations: ReviewCard[]; inProgress: ReviewCard[]; history: ReviewCard[] }>("/reviewing");
export const getEvaluation = (id: string) => call<EvaluateeView | WorkspaceView>(`/${id}`);
export const getInvitation = (assignmentId: string) => call<Invitation>(`/invitations/${assignmentId}`);
export const acceptInvitation = (assignmentId: string) => call<{ ok: true; acceptedAt: string; deadlineAt: string }>(`/invitations/${assignmentId}/accept`, { method: "POST" });
export const declineInvitation = (assignmentId: string, reason: string) => call<{ declined: true }>(`/invitations/${assignmentId}/decline`, json("POST", { reason }));
/** Report inability to complete. There is no way to choose or transfer to someone else — P2P Global reassigns. */
export const reportUnable = (assignmentId: string, category: UnableCategory, note?: string) => call<{ reported: true }>(`/assignments/${assignmentId}/unable`, json("POST", { category, note }));
export const saveDraft = (assignmentId: string, draft: unknown) => call<{ ok: true; savedAt: string }>(`/assignments/${assignmentId}/draft`, json("PUT", { draft }));
export const submitEvaluation = (id: string, outcome: Outcome, feedback: Partial<FeedbackDetail>) => call<{ ok: true; status: string }>(`/${id}/submit`, json("POST", { outcome, feedback }));
export const openDiscussion = (id: string) => call<{ conversationId: string }>(`/${id}/discussion`, { method: "POST" });
export const rateEvaluation = (id: string, q: { helpfulness: number; clarity: number; respectfulness: number; encouragement: number; relevance: number; helpedUnderstand: boolean; comment?: string; concern?: boolean }) =>
  call<{ thanks: true }>(`/${id}/quality`, json("POST", q));

// Authorised oversight
export const adminOverview = () => call<Record<string, any>>("/admin/overview");
export const adminHistory = (id: string) => call<Record<string, any>>(`/admin/evaluations/${id}`);
/** The system — not the administrator — chooses who is next. */
export const adminReassign = (id: string, reason: string) => call<{ ok: true; next: string }>(`/admin/evaluations/${id}/reassign`, json("POST", { reason }));
export const adminEvaluators = () => call<{ items: Record<string, any>[] }>("/admin/evaluators");
export const adminSetStanding = (userId: string, p: { standing?: "good" | "under_review" | "restricted"; reason?: string; available?: boolean }) => call<{ saved: true }>(`/admin/evaluators/${userId}`, json("PUT", p));
export const adminConcerns = () => call<{ items: Record<string, any>[] }>("/admin/concerns");
export const adminReviewConcern = (evaluationId: string, substantiated: boolean, note?: string) => call<{ saved: true }>(`/admin/concerns/${evaluationId}`, json("PUT", { substantiated, note }));
export const adminSettings = (p: { engineEnabled?: boolean; invitationWindowMinutes?: number; defaultCapacity?: number; bootstrapRoles?: string[]; groupAssignmentsEnabled?: boolean }) => call<{ saved: true }>("/admin/settings", json("PUT", p));
/** Resources waiting for an evaluator, and whether anyone has passed them independently yet. */
export const adminCoverage = () => call<{ items: { resourceKind: string; resourceId: string; context: string | null; title: string; waiting: number; waitingSince: string | null; hasQualifiedPeople: boolean }[] }>("/admin/coverage");
export const adminSweep = () => call<Record<string, number>>("/admin/sweep", { method: "POST" });
export const adminOperations = () => call<{ qualifiedEvaluators: number; resourcesWithQualifiedPeople: number; pending: number; unassigned: number; expired30d: number; reassigned30d: number;
  medianHoursToAccept: number | null; medianHoursToComplete: number | null; workload: { activeEvaluations: number; people: number }[]; reciprocalPairs: number }>("/admin/operations");
export const adminIntegrity = () => call<{ items: { pairKey: string; people: string[]; approvals: number[]; lastAt: string; review: { decision: string; note: string; at: string } | null; needsReview: boolean }[] }>("/admin/integrity");
export const adminIntegrityReview = (pairKey: string, decision: "no_concern" | "concern_raised" | "evidence_voided", note: string) => call<{ saved: true }>(`/admin/integrity/${pairKey}/review`, json("POST", { decision, note }));
/** A MATERIAL revision of an assessment: earlier passes keep their credit but no longer qualify evaluators for the new version. */
export const adminRecordRevision = (kind: "lesson" | "group_assignment", resourceId: string, reason: string) => call<{ version: number }>("/admin/resources/revision", json("POST", { kind, resourceId, reason }));
