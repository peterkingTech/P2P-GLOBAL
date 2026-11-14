// P2P PLANS — the pure rules of the one plan system (owner brief 2026-11-14; tables: proposal 249).
// A plan ORGANISES existing resources; it never holds Bible text, lessons or stories. Everything here is
// pure (no database), so the route and the tests share exactly the same rules:
//   • references: Scripture passages and existing P2P resources, validated and normalised;
//   • questions: prepared study questions — a learning aid, never an examination;
//   • scheduling: spread the remaining sessions over the chosen duration and pace, and say plainly when
//     that would be too much per day (with a suggested schedule). A schedule never changes content;
//   • progress: counts of completed sessions, the current and next session. No percentages, no streaks,
//     nothing awarded — the Growth Matrix keeps its own evidence rules.
import { BOOKS } from "./scriptureTopics";

export const FOCUS_TYPES = ["bible_book", "bible_topic", "biblical_person", "biblical_event", "theme", "core_foundations", "kingdom_school", "kingdom_stories", "deep_study"] as const;
export type FocusType = (typeof FOCUS_TYPES)[number];
export const COLLECTIONS = ["bible_books", "topical", "life_of_jesus", "biblical_history", "core_foundations", "kingdom_school", "kingdom_stories", "deep_study"] as const;
export const PACES = ["daily", "five_weekly", "three_weekly", "weekly", "flexible"] as const;
export type Pace = (typeof PACES)[number];
export const DURATIONS = ["daily", "weekly", "monthly", "quarterly", "half_year", "yearly", "custom"] as const;
export type DurationKey = (typeof DURATIONS)[number];
/** Calendar days for the fixed durations ("daily" = one session per study day; "custom" = the person's own). */
export const DURATION_DAYS: Record<Exclude<DurationKey, "daily" | "custom">, number> = { weekly: 7, monthly: 30, quarterly: 91, half_year: 182, yearly: 365 };
export const QUESTION_KINDS = ["observe", "context", "interpret", "consider", "apply"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];
export const RESOURCE_KINDS = ["bible_passage", "lesson", "kingdom_story", "scripture_topic", "deep_study", "word_study", "commentary", "dictionary_term", "curriculum"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];
export const EDITORIAL_FLOW: Record<string, string[]> = {
  draft: ["under_review", "archived"], under_review: ["draft", "approved"], approved: ["published", "draft"], published: ["archived"], archived: ["draft"],
};
/** More sessions than this on one study day is too much; the schedule is refused with a suggestion. */
export const MAX_PER_DAY = 3;
const MAX_DAYS = 3660;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
const intIn = (v: unknown, lo: number, hi: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? (v as number) : null);
const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : null);

export interface Passage { book: string; chapter: number; startVerse?: number; endVerse?: number }
/** A Scripture reference (USFM book code), never text. Verse ranges stay inside one chapter. */
export function validatePassage(p: unknown): Passage | null {
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  const book = BY_CODE.get(String(o.book ?? "").toUpperCase());
  if (!book) return null;
  const chapter = intIn(o.chapter, 1, book.chapters);
  if (!chapter) return null;
  if (o.startVerse === undefined && o.endVerse === undefined) return { book: book.code, chapter };
  const s = intIn(o.startVerse, 1, 200), e = o.endVerse === undefined ? s : intIn(o.endVerse, 1, 200);
  if (!s || !e || e < s) return null;
  return { book: book.code, chapter, startVerse: s, endVerse: e };
}
export function passageDisplay(p: Passage): string {
  const name = BY_CODE.get(p.book)?.name ?? p.book;
  return p.startVerse ? `${name} ${p.chapter}:${p.startVerse}${p.endVerse && p.endVerse !== p.startVerse ? `-${p.endVerse}` : ""}` : `${name} ${p.chapter}`;
}

export type Resource =
  | ({ kind: "bible_passage" } & Passage)
  | { kind: "lesson" | "kingdom_story" | "curriculum"; id: string; chapterId?: string }
  | { kind: "scripture_topic"; slug: string }
  | ({ kind: "deep_study" | "commentary" } & Passage)
  | { kind: "word_study"; strongs: string }
  | { kind: "dictionary_term"; key: string };
/** An existing P2P resource, by reference (its own id / slug / Strong's number). A note says why it belongs. */
export function validateResource(r: unknown): (Resource & { note?: string; title?: string }) | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  const extra = { ...(text(o.note, 300) ? { note: text(o.note, 300)! } : {}), ...(text(o.title, 200) ? { title: text(o.title, 200)! } : {}) };
  switch (o.kind) {
    case "bible_passage": case "deep_study": case "commentary": { const p = validatePassage(o); return p ? { kind: o.kind, ...p, ...extra } : null; }
    case "lesson": case "curriculum": return isUuid(o.id) ? { kind: o.kind, id: o.id, ...extra } : null;
    case "kingdom_story": return isUuid(o.id) && (o.chapterId === undefined || isUuid(o.chapterId)) ? { kind: "kingdom_story", id: o.id, ...(o.chapterId ? { chapterId: o.chapterId as string } : {}), ...extra } : null;
    case "scripture_topic": return typeof o.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(o.slug) && o.slug.length <= 80 ? { kind: "scripture_topic", slug: o.slug, ...extra } : null;
    case "word_study": return typeof o.strongs === "string" && /^[HG]\d{1,5}[a-z]?$/.test(o.strongs) ? { kind: "word_study", strongs: o.strongs, ...extra } : null;
    case "dictionary_term": return typeof o.key === "string" && /^[a-z0-9][a-z0-9_-]{0,79}$/.test(o.key) ? { kind: "dictionary_term", key: o.key, ...extra } : null;
  }
  return null;
}
export interface Question { kind: QuestionKind; text: string }
export function validateQuestion(q: unknown): Question | null {
  if (!q || typeof q !== "object") return null;
  const o = q as Record<string, unknown>;
  const t = text(o.text, 500);
  return QUESTION_KINDS.includes(o.kind as QuestionKind) && t ? { kind: o.kind as QuestionKind, text: t } : null;
}

export interface SessionInput { title: string; intro: string | null; passages: Passage[]; primaryResource: Resource | null; supporting: Resource[]; questions: Question[]; reflection: string | null; prayer: string | null }
/** One session as a participant or editor submitted it; null + a reason when it can't be saved. */
export function validateSession(s: unknown): { ok: true; value: SessionInput } | { ok: false; error: string } {
  if (!s || typeof s !== "object") return { ok: false, error: "A session is missing." };
  const o = s as Record<string, unknown>;
  const title = text(o.title, 200);
  if (!title) return { ok: false, error: "Every session needs a title." };
  const rawPassages = Array.isArray(o.passages) ? o.passages : [];
  const passages = rawPassages.map(validatePassage);
  if (passages.some((p) => !p) || passages.length > 10) return { ok: false, error: `"${title}": a Scripture reference isn't valid.` };
  const primaryResource = o.primaryResource == null ? null : validateResource(o.primaryResource);
  if (o.primaryResource != null && !primaryResource) return { ok: false, error: `"${title}": the main resource isn't valid.` };
  if (!passages.length && !primaryResource) return { ok: false, error: `"${title}": add a Bible passage or a resource to study.` };
  const rawSupport = Array.isArray(o.supporting) ? o.supporting : [];
  const supporting = rawSupport.map(validateResource);
  if (supporting.some((r) => !r) || supporting.length > 12) return { ok: false, error: `"${title}": a supporting resource isn't valid.` };
  const rawQ = Array.isArray(o.questions) ? o.questions : [];
  const questions = rawQ.map(validateQuestion);
  if (questions.some((q) => !q) || questions.length > 12) return { ok: false, error: `"${title}": a study question isn't valid.` };
  const opt = (v: unknown, max: number) => (v == null || v === "" ? null : text(v, max));
  const intro = opt(o.intro, 2000), reflection = opt(o.reflection, 1000), prayer = opt(o.prayer, 1000);
  if ((o.intro && !intro) || (o.reflection && !reflection) || (o.prayer && !prayer)) return { ok: false, error: `"${title}": some text is too long.` };
  return { ok: true, value: { title, intro, passages: passages as Passage[], primaryResource, supporting: supporting as Resource[], questions: questions as Question[], reflection, prayer } };
}

/** Supporting resources must relate to the main focus: a Scripture-led plan may add any P2P resource that
 *  helps with its passages, but a session can't be built only from unrelated resources (no passage and a
 *  supporting list but no main resource). Returns the kinds used, for the plan details page. */
export function resourceKinds(sessions: Pick<SessionInput, "passages" | "primaryResource" | "supporting">[]): { primary: ResourceKind[]; supporting: ResourceKind[] } {
  const primary = new Set<ResourceKind>(), supporting = new Set<ResourceKind>();
  for (const s of sessions) {
    if (s.passages.length) primary.add("bible_passage");
    if (s.primaryResource) primary.add(s.primaryResource.kind);
    for (const r of s.supporting) supporting.add(r.kind);
  }
  return { primary: [...primary], supporting: [...supporting] };
}

// ── Scheduling ──────────────────────────────────────────────────────────────
const dayMs = 86400000;
const toDate = (iso: string) => new Date(iso + "T00:00:00Z");
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (isoDate: string, n: number) => iso(new Date(toDate(isoDate).getTime() + n * dayMs));
export const isIsoDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(toDate(v).getTime()) && iso(toDate(v)) === v;
/** Is this a study day for the pace? (Mon–Fri for five a week; Mon/Wed/Fri for three; the start's weekday for weekly.) */
function studyDay(isoDate: string, pace: Pace, anchor: string): boolean {
  const wd = toDate(isoDate).getUTCDay();
  if (pace === "daily") return true;
  if (pace === "five_weekly") return wd >= 1 && wd <= 5;
  if (pace === "three_weekly") return wd === 1 || wd === 3 || wd === 5;
  if (pace === "weekly") return wd === toDate(anchor).getUTCDay();
  return false;
}
/** The study days in [anchor, anchor + days). */
export function studyDates(anchor: string, days: number, pace: Pace): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.min(days, MAX_DAYS); i++) { const d = addDays(anchor, i); if (studyDay(d, pace, anchor)) out.push(d); }
  return out;
}
/** The fewest calendar days that give `sessions` sessions at most `perDay` a study day. */
export function minDays(sessions: number, pace: Pace, perDay = 1, anchor = "2026-01-05"): number {
  if (pace === "flexible" || sessions <= 0) return Math.max(1, sessions);
  const need = Math.ceil(sessions / perDay);
  let found = 0;
  for (let i = 0; i < MAX_DAYS; i++) { if (studyDay(addDays(anchor, i), pace, anchor) && ++found >= need) return i + 1; }
  return MAX_DAYS;
}
/** Calendar days for a duration choice. */
export function durationDays(key: DurationKey, sessions: number, pace: Pace, customDays?: number | null, anchor?: string): number | null {
  if (key === "custom") return intIn(customDays, 1, MAX_DAYS);
  if (key === "daily") return minDays(sessions, pace, 1, anchor);
  return DURATION_DAYS[key];
}

export interface Feasibility { ok: boolean; studyDays: number; perDay: number; suggestion: { durationKey: DurationKey; days: number } | null }
/** Can `sessions` fit into `days` at this pace without overwhelming anyone? */
export function feasibility(sessions: number, days: number, pace: Pace, anchor: string): Feasibility {
  if (pace === "flexible") return { ok: true, studyDays: 0, perDay: 0, suggestion: null };
  const sd = studyDates(anchor, days, pace).length;
  const perDay = sd ? Math.ceil(sessions / sd) : sessions;
  if (perDay <= MAX_PER_DAY && sd > 0) return { ok: true, studyDays: sd, perDay, suggestion: null };
  // Suggest the shortest standard duration that keeps it to two sessions a study day, else a custom length.
  const need = minDays(sessions, pace, 2, anchor);
  const std = (Object.entries(DURATION_DAYS) as [DurationKey, number][]).find(([, d]) => d >= need);
  return { ok: false, studyDays: sd, perDay, suggestion: std ? { durationKey: std[0], days: std[1] } : { durationKey: "custom", days: need } };
}

export interface ScheduledSession { id: string; position: number; dueDate: string | null; done: boolean }
/** Due dates for the sessions still to do, laid out from the anchor (the start, or the day the person
 *  resumed / adjusted). Done sessions keep no date; missed days never remove anything. Flexible → no dates. */
export function schedule(sessions: { id: string; position: number }[], done: Set<string>, opts: { anchor: string; days: number; pace: Pace }): ScheduledSession[] {
  const ordered = [...sessions].sort((a, b) => a.position - b.position);
  const remaining = ordered.filter((s) => !done.has(s.id));
  const dates = opts.pace === "flexible" ? [] : studyDates(opts.anchor, opts.days, opts.pace);
  const due = new Map<string, string>();
  if (dates.length) remaining.forEach((s, i) => due.set(s.id, dates[Math.min(dates.length - 1, Math.floor((i * dates.length) / remaining.length))]));
  return ordered.map((s) => ({ id: s.id, position: s.position, dueDate: due.get(s.id) ?? null, done: done.has(s.id) }));
}

export interface Progress { completed: number; total: number; currentId: string | null; nextId: string | null; finished: boolean }
/** Counts only. "Current" = the first session not yet done; "next" = the one after it. */
export function progressOf(sessions: { id: string; position: number }[], done: Set<string>): Progress {
  const ordered = [...sessions].sort((a, b) => a.position - b.position);
  const open = ordered.filter((s) => !done.has(s.id));
  const completed = ordered.length - open.length;
  return { completed, total: ordered.length, currentId: open[0]?.id ?? null, nextId: open[1]?.id ?? null, finished: ordered.length > 0 && open.length === 0 };
}
