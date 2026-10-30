import { apiRequest } from "@/lib/apiClient";

// Learning Centre — one view of my Comprehensive Checks across Kingdom
// School, Kingdom Stories, Family Circle and Church (routes/learningCentre.ts).
// Read-only: every item opens the screen where that work already lives
// (the lesson, the story chapter, the group check, peer review); nothing
// here submits, reviews or marks progress.

export type WorkSource = "core" | "story" | "family" | "church";
export type WorkState = "not_started" | "returned" | "revision_requested" | "awaiting_review" | "completed" | "reviewed";
export interface WorkItem {
  key: string;
  source: WorkSource;
  title: string;
  context: string | null;
  state: WorkState;
  dueAt: string | null;
  at: string | null;
  feedback: string | null;
  waiting?: number;
  route: { pathname: string; params: Record<string, string> };
}
export interface LearningOverview { toDo: WorkItem[]; awaitingReview: WorkItem[]; feedback: WorkItem[]; toReview: WorkItem[] }

export function getLearningOverview(): Promise<LearningOverview> {
  return apiRequest<LearningOverview>("/learning/centre/overview", {}, { fallbackError: "Couldn't load your learning. Please try again." });
}

export const SOURCE_LABEL: Record<WorkSource, string> = {
  core: "Kingdom School", story: "Kingdom Stories", family: "Family Circle", church: "Church",
};

/** Words for a state — never only a colour or an icon. */
export const STATE_LABEL: Record<WorkState, string> = {
  not_started: "Not started",
  returned: "Returned — please revise",
  revision_requested: "Revision requested",
  awaiting_review: "Waiting for review",
  completed: "Approved",
  reviewed: "Reviewed",
};

export const needsAction = (s: WorkState) => s === "returned" || s === "revision_requested";

/** "Due today", "Due tomorrow", "Due in 3 days", "Due 4 Nov", "Overdue · 2 Nov". */
export function dueLabel(dueAt: string | null, now: Date = new Date()): string | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const days = Math.round((day(d) - day(now)) / 86400000);
  const date = d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (d.getTime() < now.getTime() && days <= 0) return days === 0 ? "Due today" : `Overdue · ${date}`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days < 7) return `Due in ${days} days`;
  return `Due ${date}`;
}

/** How many things wait for me (to do + to review) — for a badge. */
export const actionCount = (o: LearningOverview | null) => (o ? o.toDo.length + o.toReview.reduce((n, x) => n + (x.waiting ?? 1), 0) : 0);
