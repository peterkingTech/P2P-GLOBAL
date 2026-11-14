// P2P PLANS — RESOURCE DISCOVERY client (api-server/src/routes/planDiscovery.ts). Subjects come from the real
// records (Bible books, published Scripture topics, published people / events / places / themes, Core
// Foundations, Kingdom School courses); recommendations are existing, published resources only, each with
// its relevance (direct / supporting / further) and a reason code the app words in the person's language.
import { apiRequest } from "@/lib/apiClient";
import type { Passage, Resource } from "@/lib/studyPlansApi";

export type SubjectType = "bible_book" | "bible_topic" | "biblical_person" | "biblical_event" | "biblical_place" | "theme" | "core_foundations" | "kingdom_school";
export const SUBJECT_TYPES: SubjectType[] = ["bible_book", "bible_topic", "biblical_person", "biblical_event", "biblical_place", "theme", "core_foundations", "kingdom_school"];
export type Relevance = "direct" | "supporting" | "further";
export type Section = "scripture" | "core_foundations" | "kingdom_school" | "kingdom_stories" | "topics" | "subjects" | "deep_study" | "commentaries" | "dictionary" | "plans";
export interface SubjectItem { type: SubjectType; key: string; label: string; hint: string | null }
export type Target = Resource | { kind: "subject" | "plan"; id: string };
export interface Recommendation {
  key: string; section: Section; resource: Target; title: string; subtitle: string | null; relevance: Relevance; essential: boolean;
  reason: { code: string; params?: Record<string, string | number> };
  chapters?: { id: string; number: number; title: string; display: string }[];
}
export interface DiscoverySection { section: Section; total: number; offset: number; items: Recommendation[] }
export interface Discovery { subject: { type: SubjectType; key: string; label: string; summary: string | null }; sections: DiscoverySection[]; counts: Record<Relevance, number> }
export interface JourneySession { title: string; intro: string | null; passages: Passage[]; primaryResource: Resource | null; supporting: Resource[]; reflection: string | null; prayer: string | null;
  essential: boolean; from: string[]; templateQuestions: boolean }
export interface Journey { sessions: JourneySession[]; derivedFrom: { type: "foundations" } | { type: "curriculum"; id: string } | null; note: "foundations" | "course" | "small" | "empty" | null }

const json = (body: unknown): RequestInit => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getSubjectTypes = () => apiRequest<{ types: { type: SubjectType; count: number }[] }>("/plan-discovery/types", {}, { fallbackError: "Couldn't load subjects." });
export const searchSubjects = (type: SubjectType, q = "", offset = 0) =>
  apiRequest<{ items: SubjectItem[]; total: number; offset: number }>(`/plan-discovery/subjects?type=${type}&q=${encodeURIComponent(q)}&offset=${offset}`, {}, { fallbackError: "Couldn't load subjects." });
export const discover = (type: SubjectType, key: string, page?: { section: Section; offset: number }) =>
  apiRequest<Discovery>(`/plan-discovery/${type}/${encodeURIComponent(key)}${page ? `?section=${page.section}&offset=${page.offset}` : ""}`, {}, { fallbackError: "Couldn't load recommendations." });
export const getJourney = (type: SubjectType, key: string, chapters?: { from: number; to: number }) =>
  apiRequest<{ subject: Discovery["subject"]; journey: Journey }>("/plan-discovery/journey", { method: "POST", ...json({ type, key, ...(chapters ? { chapters } : {}) }) }, { fallbackError: "Couldn't prepare a study journey." });
