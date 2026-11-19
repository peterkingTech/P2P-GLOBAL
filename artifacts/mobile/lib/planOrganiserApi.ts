// The Learning Plan organiser (api-server routes/studyWorkspace POST /organise, lib/planOrganiser): a subject or
// question → a PROPOSED learning journey made of actual P2P resources. Nothing is saved until the participant confirms
// it in the builder. Also: whether a lesson may open from an organised plan out of its curriculum's order.
import { apiRequest } from "@/lib/apiClient";
import type { Passage, Resource } from "@/lib/studyPlansApi";

export type OrganiserCategory = "bible" | "core_foundations" | "kingdom_school" | "kingdom_stories" | "reference" | "deep_study" | "library";
export type StageKey = "foundations" | "scripture" | "learning" | "connections" | "deeper" | "application";
export type Origin = "p2p_resource" | "bible" | "reference" | "activity";
export interface JourneyItem { key: string; category: OrganiserCategory; origin: Origin; stage: StageKey; resource: Resource; title: string; subtitle: string | null; why: string; source: string }
export interface ProposedSession {
  title: string; intro: string; passages: Passage[]; primaryResource: Resource | null; supporting: Resource[]; questions: { kind: string; text: string }[];
  stage: StageKey; itemKey: string; category: OrganiserCategory; origin: Origin; why: string; source: string;
}
export interface Organised {
  journey: { question: string; depth: number; stages: { key: StageKey; title: string; items: JourneyItem[] }[]; gaps: { category: string; message: string }[]; coverage: Record<OrganiserCategory, number>; more: JourneyItem[]; note: "ok" | "small" | "empty" | "nothing_new"; electiveLessons: string[] };
  sessions: ProposedSession[];
  token: string;
  lineage: { deeperOf: string; root: string; depth: number } | null;
}
export type StartPoint = { type: "bible_book" | "core_foundations" | "kingdom_school"; key: string; label: string } | null;

export const organise = (b: { q: string; start?: StartPoint; deeperOf?: string | null; t?: string | null }) =>
  apiRequest<Organised>("/study-workspace/organise", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: b.q, ...(b.start ? { start: { type: b.start.type, key: b.start.key } } : {}), ...(b.deeperOf ? { deeperOf: b.deeperOf } : {}), ...(b.t ? { t: b.t } : {}) }),
  }, { fallbackError: "We couldn't prepare a learning journey right now. Please try again." });

/** May this lesson open from one of my organised plans (an elective), whatever the curriculum's order? */
export const electiveAccess = (lessonId: string) =>
  apiRequest<{ allowed: boolean; planId?: string; planTitle?: string }>(`/study-plans/electives/${lessonId}`, {}, { fallbackError: "" });

/** A proposed session as the plan stores it (display-only fields removed). */
export function toPlanSession(p: ProposedSession) {
  return { title: p.title, intro: p.intro, passages: p.passages, primaryResource: p.primaryResource, supporting: p.supporting, questions: p.questions as { kind: "observe" | "context" | "interpret" | "consider" | "apply"; text: string }[] };
}
/** A discovered item as a proposed session (for "Add" / "Replace" from further discoveries). */
export function sessionFromItem(i: JourneyItem, stageTitle: string): ProposedSession {
  const r = i.resource as Resource & Partial<Passage>;
  const passage = r.kind === "bible_passage";
  return { title: i.title.slice(0, 200), intro: `${stageTitle}. ${i.why} Source: ${i.source}.`.slice(0, 2000),
    passages: passage ? [{ book: r.book!, chapter: r.chapter!, ...(r.startVerse ? { startVerse: r.startVerse, endVerse: r.endVerse } : {}) }] : [],
    primaryResource: passage ? null : i.resource, supporting: [], questions: [], stage: i.stage, itemKey: i.key, category: i.category, origin: i.origin, why: i.why, source: i.source };
}
