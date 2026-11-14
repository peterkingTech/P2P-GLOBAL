// P2P PLANS — pure helpers for the plan screens. Every resource opens its EXISTING screen (the Bible reader,
// Kingdom School lesson, Kingdom Stories, Scripture topic, Deep Study, Study Tools, dictionary) by its own id;
// nothing here copies or renders content. The server (/study-plans) remains the authority for schedules and
// progress — the estimate below is only a preview while choosing.
import { CANON, bibleRoute, readerTarget } from "@/lib/bibleReaderApi";
import type { Collection, DurationKey, FocusType, Pace, Passage, PlanCard, PlanInput, Resource } from "@/lib/studyPlansApi";

export const COLLECTIONS: Collection[] = ["bible_books", "topical", "life_of_jesus", "biblical_history", "core_foundations", "kingdom_school", "kingdom_stories", "deep_study"];
export const FOCUS_TYPES: FocusType[] = ["bible_book", "bible_topic", "biblical_person", "biblical_event", "theme", "core_foundations", "kingdom_school", "kingdom_stories", "deep_study"];
export const DURATIONS: DurationKey[] = ["daily", "weekly", "monthly", "quarterly", "half_year", "yearly", "custom"];
export const PACES: Pace[] = ["daily", "five_weekly", "three_weekly", "weekly", "flexible"];
const DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 91, half_year: 182, yearly: 365 };
const PER_WEEK: Record<Pace, number> = { daily: 7, five_weekly: 5, three_weekly: 3, weekly: 1, flexible: 0 };

type Route = { pathname: string; params: Record<string, string> };
/** Where a resource opens — always the existing screen, with the resource's own id. */
export function resourceRoute(r: Resource): Route | null {
  const p = (x: Resource) => ({ book: String(x.book), chapter: String(x.chapter), ...(x.startVerse ? { v: String(x.startVerse), ve: String(x.endVerse ?? x.startVerse) } : {}) });
  switch (r.kind) {
    case "bible_passage": return r.book && r.chapter ? bibleRoute({ book: r.book, chapter: r.chapter, ...(r.startVerse ? { v: r.startVerse, ve: r.endVerse ?? r.startVerse } : {}) }) : null;
    case "lesson": return r.id ? { pathname: "/lesson/[id]", params: { id: r.id } } : null;
    case "kingdom_story": return r.id ? (r.chapterId ? { pathname: "/kingdom-stories/chapter", params: { id: r.id, chapter: r.chapterId } } : { pathname: "/kingdom-stories/[id]", params: { id: r.id } }) : null;
    case "scripture_topic": return r.slug ? { pathname: "/bible-study/topic/[slug]", params: { slug: r.slug } } : null;
    case "deep_study": return r.book && r.chapter ? { pathname: "/deep-study", params: p(r) } : null;
    case "commentary": return r.book && r.chapter ? { pathname: "/deep-study", params: { ...p(r), tab: "commentaries" } } : null;
    case "word_study": return r.strongs ? { pathname: "/study-tools/word/[strongs]", params: { strongs: r.strongs } } : null;
    case "dictionary_term": return r.key ? { pathname: "/dictionary/term/[key]", params: { key: r.key } } : null;
    case "curriculum": return r.id ? { pathname: "/plan/[id]", params: { id: r.id } } : null;
  }
  return null;
}
/** A passage opens in the existing Bible reader (the reader keeps the person's chosen translation). */
export const passageRoute = (p: Passage) => resourceRoute({ kind: "bible_passage", ...p });
export function passageText(p: Passage): string {
  const name = CANON.find((b) => b.code === p.book)?.name ?? p.book;
  return p.startVerse ? `${name} ${p.chapter}:${p.startVerse}${p.endVerse && p.endVerse !== p.startVerse ? `-${p.endVerse}` : ""}` : `${name} ${p.chapter}`;
}
/** "Romans 8:1-11", "Rom 8", "1 John 4:7-12" → a reference (or null). */
export function parseReference(input: string): Passage | null {
  const t = readerTarget(input);
  if (!t) return null;
  return t.v ? { book: t.book, chapter: t.chapter, startVerse: t.v, endVerse: t.ve ?? t.v } : { book: t.book, chapter: t.chapter };
}
/** One session per chapter of a book (the quickest Bible-book plan). */
export function chapterSessions(book: string, from = 1, to?: number): PlanInput["sessions"] {
  const b = CANON.find((x) => x.code === book);
  if (!b) return [];
  const last = Math.min(b.chapters, to ?? b.chapters), first = Math.max(1, Math.min(from, last));
  return Array.from({ length: last - first + 1 }, (_, i) => ({ title: `${b.name} ${first + i}`, passages: [{ book: b.code, chapter: first + i }] }));
}

/** A preview only (the server decides): calendar days, study days and sessions per study day. */
export function estimate(sessions: number, duration: DurationKey, pace: Pace, customDays?: number | null): { days: number | null; perDay: number | null; tooMuch: boolean } {
  if (pace === "flexible") return { days: duration === "custom" ? customDays ?? null : DAYS[duration] ?? null, perDay: null, tooMuch: false };
  const days = duration === "custom" ? (customDays && customDays > 0 ? customDays : null) : duration === "daily" ? Math.ceil((sessions / PER_WEEK[pace]) * 7) : DAYS[duration];
  if (!days) return { days: null, perDay: null, tooMuch: false };
  const studyDays = Math.max(1, Math.floor((days / 7) * PER_WEEK[pace]));
  const perDay = Math.ceil(sessions / studyDays);
  return { days, perDay, tooMuch: perDay > 3 };
}
/** Neutral wording for a session's planned date — never "late", "missed" or a streak. */
export function dueKey(dueDate: string | null, today: string): { key: "dueToday" | "dueOn" | "noDate"; date?: string } {
  if (!dueDate) return { key: "noDate" };
  return dueDate === today ? { key: "dueToday" } : { key: "dueOn", date: dueDate };
}
/** The catalogue grouped into discovery collections (one system; collections are only shelves). */
export function shelves(plans: PlanCard[]): { collection: Collection | "mine"; plans: PlanCard[] }[] {
  const out: { collection: Collection | "mine"; plans: PlanCard[] }[] = [];
  for (const c of COLLECTIONS) { const list = plans.filter((p) => p.official && p.collection === c); if (list.length) out.push({ collection: c, plans: list }); }
  const mine = plans.filter((p) => !p.official);
  if (mine.length) out.push({ collection: "mine", plans: mine });
  return out;
}
/** Search and focus filter, keeping the server's order. */
export function filterPlans(plans: PlanCard[], f: { focus?: FocusType | null; q?: string; together?: boolean }): PlanCard[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "");
  const words = norm(f.q ?? "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return plans.filter((p) => (!f.focus || p.focusType === f.focus) && (!f.together || p.togetherSuitable)
    && words.every((w) => norm(`${p.title} ${p.description ?? ""} ${p.focusLabel}`).includes(w)));
}
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
