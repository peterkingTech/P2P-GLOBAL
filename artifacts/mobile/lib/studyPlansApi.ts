// P2P PLANS — the app's client for /study-plans (api-server/src/routes/studyPlans.ts). One plan system that
// organises existing resources; nothing here holds Bible text, lessons or stories.
import { apiRequest } from "@/lib/apiClient";

export type FocusType = "bible_book" | "bible_topic" | "biblical_person" | "biblical_event" | "theme" | "core_foundations" | "kingdom_school" | "kingdom_stories" | "deep_study";
export type Collection = "bible_books" | "topical" | "life_of_jesus" | "biblical_history" | "core_foundations" | "kingdom_school" | "kingdom_stories" | "deep_study";
export type Pace = "daily" | "five_weekly" | "three_weekly" | "weekly" | "flexible";
export type DurationKey = "daily" | "weekly" | "monthly" | "quarterly" | "half_year" | "yearly" | "custom";
export type QuestionKind = "observe" | "context" | "interpret" | "consider" | "apply";
export type ResourceKind = "bible_passage" | "lesson" | "kingdom_story" | "scripture_topic" | "deep_study" | "word_study" | "commentary" | "dictionary_term" | "curriculum";
export interface Passage { book: string; chapter: number; startVerse?: number; endVerse?: number }
export type Resource = { kind: ResourceKind; id?: string; chapterId?: string; slug?: string; strongs?: string; key?: string; note?: string; title?: string; label?: string | null; display?: string } & Partial<Passage>;

export interface PlanCard {
  id: string; slug: string | null; title: string; description: string | null; focusType: FocusType; focusLabel: string; kind: "scripture" | "structured" | "mixed";
  collection: Collection | null; origin: "p2p" | "participant"; official: boolean; editorialStatus: string; language: string; derived: boolean;
  suggestedPace: Pace; suggestedDays: number | null; togetherSuitable: boolean; objectives: string[];
  sessionCount?: number | null; questionsIncluded?: boolean; supportingKinds?: ResourceKind[]; primaryKinds?: ResourceKind[]; saved?: boolean; mine?: boolean; canEdit?: boolean; editor?: boolean;
}
export interface PlanSession {
  id: string; position: number; title: string; group: string | null; intro: string | null; passages: (Passage & { display: string })[]; primaryResource: Resource | null;
  supporting: Resource[]; questions: { kind: QuestionKind; text: string }[]; reflection: string | null; prayer: string | null; derived: boolean; lessonState?: "passed" | "completed" | "open";
}
export interface PlanRun {
  id: string; planId: string; mode: "individual" | "together"; sharedStudyId: string | null; durationKey: DurationKey; targetDays: number; pace: Pace;
  startDate: string; anchorDate: string; status: "active" | "paused" | "completed" | "left"; pausedAt: string | null; completedAt: string | null; showQuestions: boolean;
}
export interface PlanDetail {
  plan: PlanCard; sessions: PlanSession[]; note: string;
  me: { run: PlanRun; progress: { completed: number; total: number; currentId: string | null; nextId: string | null; finished: boolean };
    schedule: { id: string; position: number; dueDate: string | null; done: boolean }[]; completedAt: Record<string, string> } | null;
}
export interface RunItem { run: PlanRun; plan: PlanCard; progress: { completed: number; total: number; finished: boolean };
  current: { id: string; title: string; position: number; dueDate: string | null } | null; next: { id: string; title: string; position: number; dueDate: string | null } | null }
export interface MyPlans { active: RunItem[]; paused: RunItem[]; completed: RunItem[]; created: PlanCard[]; saved: PlanCard[] }
export interface ScheduleProblem { error: string; perDay?: number; suggestion?: { durationKey: DurationKey; days: number } | null }
export interface PlanInput { title: string; description?: string | null; focusType: FocusType; focusLabel?: string; focusRef?: Record<string, unknown>; suggestedPace?: Pace; suggestedDays?: number | null;
  objectives?: string[]; sessions: { id?: string; title: string; intro?: string | null; passages: Passage[]; primaryResource?: Resource | null; supporting?: Resource[]; questions?: { kind: QuestionKind; text: string }[]; reflection?: string | null; prayer?: string | null }[] }

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getPlans = (f: { collection?: Collection; focus?: FocusType; q?: string } = {}) => {
  const qs = Object.entries(f).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return apiRequest<{ plans: PlanCard[] }>(`/study-plans${qs ? `?${qs}` : ""}`, {}, { fallbackError: "Couldn't load plans." });
};
export const getMyPlans = () => apiRequest<MyPlans>("/study-plans/mine", {}, { fallbackError: "Couldn't load your plans." });
export const getPlan = (id: string) => apiRequest<PlanDetail>(`/study-plans/${id}`, {}, { fallbackError: "Couldn't load this plan." });
export const createPlan = (p: PlanInput) => apiRequest<{ id: string }>("/study-plans", { method: "POST", ...json(p) }, { fallbackError: "Couldn't create the plan." });
export const updatePlan = (id: string, p: PlanInput) => apiRequest<{ id: string }>(`/study-plans/${id}`, { method: "PUT", ...json(p) }, { fallbackError: "Couldn't save the plan." });
export const archivePlan = (id: string) => apiRequest(`/study-plans/${id}`, { method: "DELETE" }, { fallbackError: "Couldn't archive the plan." });
export const savePlan = (id: string, save: boolean) => apiRequest(`/study-plans/${id}/save`, { method: save ? "POST" : "DELETE" }, { fallbackError: "Couldn't update your saved plans." });
export const startPlan = (id: string, b: { mode: "individual" | "together"; durationKey: DurationKey; customDays?: number; pace: Pace; startDate: string; sharedStudyId?: string; acceptSchedule?: boolean }) =>
  apiRequest<{ run: PlanRun; perDay: number }>(`/study-plans/${id}/start`, { method: "POST", ...json(b) }, { fallbackError: "Couldn't start the plan.", makeError: scheduleError });
export const updateRun = (runId: string, b: { action?: "pause" | "resume" | "leave"; durationKey?: DurationKey; customDays?: number; pace?: Pace; showQuestions?: boolean; acceptSchedule?: boolean }) =>
  apiRequest<{ run: PlanRun }>(`/study-plans/runs/${runId}`, { method: "PATCH", ...json(b) }, { fallbackError: "Couldn't update the plan.", makeError: scheduleError });
export const setSessionDone = (runId: string, sessionId: string, done: boolean) =>
  apiRequest<{ progress: { completed: number; total: number; finished: boolean } }>(`/study-plans/runs/${runId}/sessions/${sessionId}`, { method: done ? "POST" : "DELETE" }, { fallbackError: "Couldn't update the session." });

/** Keeps the server's schedule suggestion on the error (a 422 explains and suggests; it never silently changes). */
function scheduleError(message: string, status: number, body: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { status, perDay: body?.perDay, suggestion: body?.suggestion ?? null, runId: body?.runId });
}
