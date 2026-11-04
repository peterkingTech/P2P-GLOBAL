// Peer Evaluation Engine (migration 229) — the API's own rules as plain
// functions (tests/peerEvaluation.test.mjs). The engine itself (who is
// invited, deadlines, reassignment, idempotency, concurrency) lives in the
// database functions p2p_eval_*; these rules decide what each person may SEE
// and validate what they SEND.
//
//   • An evaluatee never sees who was INVITED — only an evaluator who accepted.
//   • An invited evaluator sees what they need to decide (lesson, kind of
//     work, deadline policy) — never the evaluatee's name or answers.
//   • The deadline is 48 hours from the server's acceptance time. No extensions.
//   • Recognition reflects faithful, helpful service — never volume alone,
//     never a public ranking.

export const DEADLINE_HOURS = 48;
export const ORIENTATION_VERSION = 1;

/** What an evaluator agrees to before they can be invited (all are required). */
export const COMMITMENTS = [
  { id: "purpose", text: "I understand that evaluating is serving another person in their growth in God's Word." },
  { id: "deadline", text: "I understand I have at most 48 hours from accepting, and there are no extensions." },
  { id: "reassignment", text: "I understand P2P Global assigns and reassigns evaluations automatically — I can't choose or transfer to anyone." },
  { id: "respect", text: "I will communicate respectfully, truthfully and with encouragement." },
  { id: "privacy", text: "I will protect the evaluatee's information and use it only for this evaluation." },
  { id: "report", text: "If I can't finish, I will report it instead of leaving the evaluation unfinished." },
] as const;
export const COMMITMENT_IDS = COMMITMENTS.map((c) => c.id);
/** All commitments acknowledged? Returns the missing ones. */
export function missingCommitments(raw: unknown): string[] {
  const given = new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  return COMMITMENT_IDS.filter((id) => !given.has(id));
}

export const OUTCOMES = ["passed", "passed_with_recommendations", "revision_required", "further_discussion", "clarification_required"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const QUESTION_STATUSES = ["well_understood", "partially_understood", "needs_clarification", "not_yet_understood"] as const;
export const DIFFERENCE_KINDS = ["clear_misunderstanding", "unsupported_conclusion", "incomplete_explanation", "reasonable_difference"] as const;
export const UNABLE_CATEGORIES = ["health", "family", "time", "competence", "conflict", "technical", "other"] as const;
export const DECLINE_REASONS = ["not_my_area", "no_time", "conflict_of_interest", "other"] as const;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
/**
 * Clean feedback as sent by the evaluator. Question feedback is kept only for
 * the assignment's own questions (no invented criteria). Returns a message
 * when something required is missing.
 */
export function cleanFeedback(raw: unknown, questionIds: string[]): { detail: Record<string, unknown>; summary: string } | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const known = new Set(questionIds);
  const questions: { questionId: string; status: string; note: string; kind: string | null }[] = [];
  if (Array.isArray(r.questions)) {
    for (const q of r.questions as Record<string, unknown>[]) {
      if (typeof q?.questionId !== "string" || !known.has(q.questionId) || questions.some((x) => x.questionId === q.questionId)) continue;
      if (!(QUESTION_STATUSES as readonly unknown[]).includes(q.status)) return "Choose how well each question was understood.";
      questions.push({ questionId: q.questionId, status: String(q.status), note: text(q.note, 2000), kind: (DIFFERENCE_KINDS as readonly unknown[]).includes(q.kind) ? String(q.kind) : null });
    }
  }
  const detail = {
    questions,
    understoodWell: text(r.understoodWell, 3000),
    needsImprovement: text(r.needsImprovement, 3000),
    misunderstandings: text(r.misunderstandings, 3000),
    scriptures: text(r.scriptures, 1000),
    recommendedLessons: text(r.recommendedLessons, 1000),
    nextSteps: text(r.nextSteps, 2000),
    encouragement: text(r.encouragement, 2000),
    comments: text(r.comments, 2000),
  };
  if (!detail.encouragement) return "Please include a word of encouragement.";
  if (!detail.understoodWell && !detail.needsImprovement) return "Say what was understood well or what needs improvement.";
  const summary = [detail.understoodWell, detail.needsImprovement, detail.encouragement].filter(Boolean).join("\n\n").slice(0, 4000);
  return { detail, summary };
}

export type Stage = "arranging" | "invitation_pending" | "in_progress" | "overdue_reassigning" | "feedback_ready" | "revision_required" | "completed";
/** What the evaluatee sees for an evaluation (never who was merely invited). */
export function evaluateeStage(e: { engine_state: string | null; status: string; deadline_at: string | null; outcome: string | null }, now = Date.now()): Stage {
  if (e.engine_state === null) return e.status === "pending" ? "in_progress" : e.status === "needs_revision" ? "revision_required" : "completed";
  if (e.engine_state === "queued") return "arranging";
  if (e.engine_state === "invited") return "invitation_pending";
  if (e.engine_state === "in_progress") return e.deadline_at && Date.parse(e.deadline_at) <= now ? "overdue_reassigning" : "in_progress";
  if (e.engine_state === "completed") return e.status === "needs_revision" ? "revision_required" : "feedback_ready";
  return "completed";
}
/** The evaluatee-friendly story of an evaluation (no identities of invited or previous evaluators). */
export function learnerHistory(events: { event_type: string; created_at: string }[]): { at: string; text: string }[] {
  const map: Record<string, string> = {
    submitted: "Submission received",
    queued: "P2P Global is arranging a qualified evaluator",
    invited: "An evaluator was invited",
    accepted: "An evaluator accepted responsibility",
    declined: "The invited evaluator couldn't take it — another is being invited",
    expired: "The invitation wasn't answered in time — another evaluator is being invited",
    unable: "Your evaluation was reassigned",
    overdue: "Your evaluation was reassigned",
    removed: "Your evaluation was reassigned",
    unavailable: "Your evaluation was reassigned",
    completed: "Feedback is ready",
  };
  const out: { at: string; text: string }[] = [];
  for (const e of events) {
    const t = map[e.event_type];
    if (t && out[out.length - 1]?.text !== t) out.push({ at: e.created_at, text: t });
  }
  return out;
}

export interface AssignmentRow { status: string; accepted_at: string | null; deadline_at: string | null; ended_at: string | null; end_reason: string | null }
export interface QualityRow { helpfulness: number; clarity: number; respectfulness: number; encouragement: number; relevance: number; helped_understand: boolean; substantiated: boolean | null; concern: boolean }
/** An evaluator's service record — counts and quality, never a rank. */
export function serviceRecord(assignments: AssignmentRow[], quality: QualityRow[]) {
  const accepted = assignments.filter((a) => a.accepted_at).length;
  const completed = assignments.filter((a) => a.status === "completed");
  const onTime = completed.filter((a) => a.deadline_at && a.ended_at && Date.parse(a.ended_at) <= Date.parse(a.deadline_at)).length;
  const avg = (k: keyof QualityRow) => (quality.length ? quality.reduce((n, q) => n + Number(q[k]), 0) / quality.length : null);
  return {
    invited: assignments.length,
    accepted,
    completed: completed.length,
    onTime,
    onTimeRate: completed.length ? onTime / completed.length : null,
    missedDeadlines: assignments.filter((a) => a.status === "overdue").length,
    declined: assignments.filter((a) => a.status === "declined").length,
    expired: assignments.filter((a) => a.status === "expired").length,
    unableReports: assignments.filter((a) => a.status === "unable").length,
    ratings: quality.length,
    helpfulness: avg("helpfulness"), clarity: avg("clarity"), respectfulness: avg("respectfulness"), encouragement: avg("encouragement"), relevance: avg("relevance"),
    helpedUnderstandRate: quality.length ? quality.filter((q) => q.helped_understand).length / quality.length : null,
    substantiatedConcerns: quality.filter((q) => q.substantiated === true).length,
  };
}
export type ServiceRecord = ReturnType<typeof serviceRecord>;

/** Recognitions for faithful service — quality and reliability, never volume alone. */
export function recognitions(r: ServiceRecord): { id: string; title: string; reason: string }[] {
  const out: { id: string; title: string; reason: string }[] = [];
  const clean = r.substantiatedConcerns === 0;
  if (r.completed >= 5 && (r.onTimeRate ?? 0) >= 0.9 && clean) out.push({ id: "faithful_service", title: "Faithful Service", reason: "Evaluations completed faithfully and on time." });
  if (r.completed >= 5 && r.onTime === r.completed && r.missedDeadlines === 0) out.push({ id: "timely_evaluator", title: "Timely Evaluator", reason: "Every evaluation finished within the 48 hours." });
  if (r.ratings >= 3 && (r.encouragement ?? 0) >= 4.5 && (r.respectfulness ?? 0) >= 4.5 && clean) out.push({ id: "encouraging_guide", title: "Encouraging Guide", reason: "Evaluatees found your feedback encouraging and respectful." });
  if (r.ratings >= 5 && (r.helpedUnderstandRate ?? 0) >= 0.8 && clean) out.push({ id: "growth_builder", title: "Growth Builder", reason: "Your feedback helped people understand." });
  const quality = [r.helpfulness, r.clarity, r.respectfulness, r.encouragement, r.relevance].filter((x): x is number => x !== null);
  if (r.completed >= 20 && quality.length === 5 && quality.every((x) => x >= 4.2) && (r.onTimeRate ?? 0) >= 0.9 && clean) out.push({ id: "mentor_in_service", title: "Mentor in Service", reason: "Sustained, helpful and reliable service." });
  return out;
}

/** Repeated missed deadlines or substantiated concerns suggest a private, human review — never automatic suspension. */
export const needsReview = (r: ServiceRecord) => r.missedDeadlines >= 3 || r.substantiatedConcerns >= 2 || (r.accepted >= 4 && (r.onTimeRate ?? 1) < 0.5);

/** Ratings 1–5, all required. */
export function cleanQuality(raw: unknown): { helpfulness: number; clarity: number; respectfulness: number; encouragement: number; relevance: number; helped_understand: boolean; comment: string | null; concern: boolean } | string {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (k: string) => (Number.isInteger(r[k]) && (r[k] as number) >= 1 && (r[k] as number) <= 5 ? (r[k] as number) : null);
  const vals = { helpfulness: n("helpfulness"), clarity: n("clarity"), respectfulness: n("respectfulness"), encouragement: n("encouragement"), relevance: n("relevance") };
  if (Object.values(vals).some((v) => v === null)) return "Please answer each question (1 to 5).";
  if (typeof r.helpedUnderstand !== "boolean") return "Did the feedback help you understand?";
  return { ...(vals as Record<keyof typeof vals, number>), helped_understand: r.helpedUnderstand, comment: text(r.comment, 1000) || null, concern: r.concern === true };
}
