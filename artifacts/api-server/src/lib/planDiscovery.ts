// P2P PLANS — RESOURCE DISCOVERY (owner brief "Unified Plans, Intelligent Resource Discovery", 2026-11-14).
// Pure rules (no database), shared by routes/planDiscovery.ts, the seed builder and the tests.
//
// A subject (a Bible book, a Scripture topic, a Biblical person / event / place / theme record, Core
// Foundations or a Kingdom School course) is connected to EXISTING, PUBLISHED P2P resources only through
// relationships that can be checked:
//   • DIRECT      — an editor said so: a topic's CORE passages, an approved subject–resource relationship,
//                   a subject record's own passages, a published plan with this focus, a course's own lessons,
//                   a story chapter whose NARRATIVE reference is in the chosen book;
//   • SUPPORTING  — Scripture overlap: a story chapter, lesson memory verse, topic passage or plan session
//                   whose reference falls inside one of the subject's passages; a topic's supporting passages;
//   • FURTHER     — passage-based study tools for the subject's passages (commentary, Deep Study) and a
//                   dictionary article whose headword IS the subject's name.
// Never keyword matching: a story with "love" in its title is not a resource about Love unless its Scripture
// overlaps the topic's passages (and then it is SUPPORTING, with the overlap given as the reason).
// Nothing is invented: every item names a real record, and empty sections are simply absent.
import { BOOKS } from "./scriptureTopics";
import { passageDisplay, type Passage, type Resource, type SessionInput } from "./studyPlans";

// ── References ─────────────────────────────────────────────────────────────
const END = 999;
const NAME_TO_CODE = new Map<string, string>([
  ...BOOKS.map((b) => [b.name.toLowerCase(), b.code] as [string, string]),
  ["psalm", "PSA"], ["song of songs", "SNG"], ["canticles", "SNG"],
]);
export const BOOK_BY_CODE = new Map(BOOKS.map((b) => [b.code, b]));
export const bookCodeForName = (name: string) => NAME_TO_CODE.get(String(name ?? "").trim().toLowerCase().replace(/\s+/g, " ")) ?? null;

/** A stretch of Scripture: (c1:v1) to (c2:v2) in one book. v2 = END means "to the end of the chapter". */
export interface Span { book: string; c1: number; v1: number; c2: number; v2: number }
const pos = (c: number, v: number) => c * 1000 + v;
export const overlaps = (a: Span, b: Span) => a.book === b.book && pos(a.c1, a.v1) <= pos(b.c2, b.v2) && pos(b.c1, b.v1) <= pos(a.c2, a.v2);
export const overlapsAny = (a: Span, list: Span[]) => list.some((b) => overlaps(a, b));
export const passageSpan = (p: Passage): Span => ({ book: p.book, c1: p.chapter, v1: p.startVerse ?? 1, c2: p.chapter, v2: p.endVerse ?? (p.startVerse ? p.startVerse : END) });
export function spanDisplay(s: Span): string {
  const name = BOOK_BY_CODE.get(s.book)?.name ?? s.book;
  const whole1 = s.v1 === 1, whole2 = s.v2 === END;
  if (s.c1 === s.c2) return whole1 && whole2 ? `${name} ${s.c1}` : whole2 ? `${name} ${s.c1}:${s.v1}ff` : `${name} ${s.c1}:${s.v1}${s.v2 !== s.v1 ? `-${s.v2}` : ""}`;
  if (whole1 && whole2) return `${name} ${s.c1}-${s.c2}`;
  return `${name} ${s.c1}:${s.v1}-${s.c2}${whole2 ? "" : `:${s.v2}`}`;
}

/** Editorial reference text → spans. Handles what P2P's own story chapters use:
 *  "Genesis 11:27–12:9; Hebrews 11:8–10", "Genesis 16; 21:8–21", "Romans 4:1–5, 18–22", "Isaiah 10–12",
 *  "1 Kings 3:1–15; James 1:5". A part without a book continues the previous book; after a verse
 *  reference, "18–22" is verses of the same chapter. Unreadable parts are returned in `unread` (never guessed). */
export function parseRefList(text: string): { spans: Span[]; unread: string[] } {
  const spans: Span[] = [], unread: string[] = [];
  let book: string | null = null, chapter: number | null = null, hadVerses = false;
  const norm = String(text ?? "").replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
  for (const group of norm.split(";")) {
    // "1 Samuel 24 and 26", "Jeremiah 26 and Jeremiah 20:1-13": "and" separates references like a comma.
    for (const rawPiece of group.split(/,| and /)) {
      const piece = rawPiece.trim().replace(/\.$/, "");
      if (!piece) continue;
      let rest = piece;
      const m = /^((?:[1-3] ?)?[A-Za-z][A-Za-z ]*?)\.? (\d.*)$/.exec(piece);
      if (m) {
        const code = bookCodeForName(m[1].replace(/^([1-3])(?=[A-Za-z])/, "$1 "));
        if (!code) { unread.push(piece); continue; }
        book = code; chapter = null; hadVerses = false; rest = m[2];
      }
      if (!book) { unread.push(piece); continue; }
      const max = BOOK_BY_CODE.get(book)!.chapters;
      let s: Span | null = null, r: RegExpExecArray | null;
      if ((r = /^(\d+):(\d+) ?- ?(\d+):(\d+)$/.exec(rest))) s = { book, c1: +r[1], v1: +r[2], c2: +r[3], v2: +r[4] };
      else if ((r = /^(\d+):(\d+) ?- ?(\d+)$/.exec(rest))) s = { book, c1: +r[1], v1: +r[2], c2: +r[1], v2: +r[3] };
      else if ((r = /^(\d+):(\d+)$/.exec(rest))) s = { book, c1: +r[1], v1: +r[2], c2: +r[1], v2: +r[2] };
      // "Genesis 23-25:11": from the start of chapter 23 to 25:11.
      else if ((r = /^(\d+) ?- ?(\d+):(\d+)$/.exec(rest))) s = { book, c1: +r[1], v1: 1, c2: +r[2], v2: +r[3] };
      else if ((r = /^(\d+) ?- ?(\d+)$/.exec(rest))) s = !m && hadVerses && chapter ? { book, c1: chapter, v1: +r[1], c2: chapter, v2: +r[2] } : { book, c1: +r[1], v1: 1, c2: +r[2], v2: END };
      else if ((r = /^(\d+)$/.exec(rest))) s = !m && hadVerses && chapter ? { book, c1: chapter, v1: +r[1], c2: chapter, v2: +r[1] } : { book, c1: +r[1], v1: 1, c2: +r[1], v2: END };
      const valid = s && s.c1 >= 1 && s.c2 <= max && s.c1 <= s.c2 && s.v1 >= 1 && (s.c1 < s.c2 || s.v1 <= s.v2);
      if (!s || !valid) { unread.push(piece); continue; }
      spans.push(s);
      chapter = s.c2; hadVerses = s.v2 !== END || s.v1 !== 1;
    }
  }
  return { spans, unread };
}
/** A span as single-chapter passages (the plan's reference shape). `lastVerse` gives a chapter's last verse. */
export function spanPassages(s: Span, lastVerse: (book: string, chapter: number) => number | null): Passage[] | null {
  const out: Passage[] = [];
  for (let c = s.c1; c <= s.c2; c++) {
    const from = c === s.c1 ? s.v1 : 1, to = c === s.c2 ? s.v2 : END;
    if (from === 1 && to === END) { out.push({ book: s.book, chapter: c }); continue; }
    const last = to === END ? lastVerse(s.book, c) : to;
    if (!last || last < from) return null;
    out.push({ book: s.book, chapter: c, startVerse: from, endVerse: last });
  }
  return out;
}

// ── The index the discovery reads (built by the route from published records) ──
export interface IndexedTopic { slug: string; title: string; passages: { passage: Passage; core: boolean; title: string | null; order: number }[] }
export interface IndexedStory { id: string; title: string; subtitle: string | null; chapters: { id: string; number: number; title: string; spans: Span[]; narrative: Span[] }[] }
export interface IndexedLesson { id: string; title: string; curriculumId: string; curriculumTitle: string; foundations: boolean; verses: { span: Span; display: string }[] }
export interface IndexedPlan { id: string; title: string; focusType: string; focusRef: Record<string, unknown>; focusLabel: string; spans: Span[]; derived: { type: string; id?: string } | null }
export interface IndexedSubject { id: string; slug: string; kind: SubjectKind; name: string; summary: string | null; passages: Passage[] }
export interface IndexedLink { subjectType: "subject" | "bible_topic" | "bible_book" | "curriculum"; subjectKey: string; resource: Resource; resourceKey: string; relation: Relevance; reason: string }
export interface IndexedCourse { id: string; title: string; foundations: boolean; lessons: { id: string; title: string; group: string | null }[] }
export interface DiscoveryIndex {
  topics: IndexedTopic[]; stories: IndexedStory[]; lessons: IndexedLesson[]; plans: IndexedPlan[]; subjects: IndexedSubject[]; links: IndexedLink[];
  courses: IndexedCourse[]; article: (title: string) => { id: string; title: string } | null;
}
export const SUBJECT_KINDS = ["person", "event", "place", "theme"] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];
export const SUBJECT_TYPES = ["bible_book", "bible_topic", "biblical_person", "biblical_event", "biblical_place", "theme", "core_foundations", "kingdom_school"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];
export const KIND_FOR_TYPE: Partial<Record<SubjectType, SubjectKind>> = { biblical_person: "person", biblical_event: "event", biblical_place: "place", theme: "theme" };

export type Relevance = "direct" | "supporting" | "further";
export const SECTIONS = ["scripture", "core_foundations", "kingdom_school", "kingdom_stories", "topics", "subjects", "deep_study", "commentaries", "dictionary", "plans"] as const;
export type Section = (typeof SECTIONS)[number];
/** Why an item was recommended — a code the app words in the person's language, with its details. */
export interface Reason { code: string; params?: Record<string, string | number> }
/** What a recommendation opens: a plan resource, or a subject record / a prepared plan (navigation only). */
export type Target = Resource | { kind: "subject" | "plan"; id: string };
export interface Recommendation {
  key: string; section: Section; resource: Target; title: string; subtitle: string | null; relevance: Relevance; essential: boolean; reason: Reason;
  /** For a story: the chapters that matched (so a session can open the right chapter). */
  chapters?: { id: string; number: number; title: string; display: string; spans: Span[] }[];
  /** The Scripture this item shares with the subject — used to place it beside the right session. */
  relatesTo?: Span[];
}
export interface Discovery { subject: { type: SubjectType; key: string; label: string; summary: string | null }; items: Recommendation[]; focus: Span[]; scripture: { passage: Passage; core: boolean; title: string | null }[] }

const RANK: Record<Relevance, number> = { direct: 0, supporting: 1, further: 2 };
const keyOf = (r: Target) => ("id" in r ? `${r.kind}:${r.id}` : "slug" in r ? `${r.kind}:${r.slug}` : "strongs" in r ? `${r.kind}:${r.strongs}` : "key" in r ? `${r.kind}:${r.key}` : `${r.kind}:${passageDisplay(r as Passage)}`);
export const resourceKey = keyOf;

export function subjectLabel(type: SubjectType, key: string, ix: DiscoveryIndex): { label: string; summary: string | null } | null {
  if (type === "bible_book") { const b = BOOK_BY_CODE.get(key); return b ? { label: b.name, summary: null } : null; }
  if (type === "bible_topic") { const t = ix.topics.find((x) => x.slug === key); return t ? { label: t.title, summary: null } : null; }
  if (type === "core_foundations") return { label: "Core Foundations", summary: null };
  if (type === "kingdom_school") { const c = ix.courses.find((x) => x.id === key && !x.foundations); return c ? { label: c.title, summary: null } : null; }
  const kind = KIND_FOR_TYPE[type];
  const s = ix.subjects.find((x) => (x.id === key || x.slug === key) && x.kind === kind);
  return s ? { label: s.name, summary: s.summary } : null;
}

/** Everything available for one subject, classified, with a reason each. null = no such (published) subject. */
export function discover(type: SubjectType, key: string, ix: DiscoveryIndex): Discovery | null {
  const named = subjectLabel(type, key, ix);
  if (!named) return null;
  const items = new Map<string, Recommendation>();
  const add = (r: Recommendation) => {
    const had = items.get(r.key);
    // The strongest classification wins (an editor's link beats an overlap); the first reason at that level stays.
    if (!had || RANK[r.relevance] < RANK[had.relevance]) items.set(r.key, { ...r, essential: r.relevance === "direct" });
  };
  let focus: Span[] = [];
  const scripture: Discovery["scripture"] = [];
  let subjectKey = key, linkType: IndexedLink["subjectType"] | null = null;

  if (type === "bible_book") {
    const b = BOOK_BY_CODE.get(key)!;
    focus = [{ book: b.code, c1: 1, v1: 1, c2: b.chapters, v2: END }];
    add({ key: `book:${b.code}`, section: "scripture", resource: { kind: "bible_passage", book: b.code, chapter: 1 }, title: b.name, subtitle: null, relevance: "direct", essential: true, reason: { code: "bookChapters", params: { count: b.chapters } } });
    linkType = "bible_book";
  } else if (type === "bible_topic") {
    const t = ix.topics.find((x) => x.slug === key)!;
    for (const p of [...t.passages].sort((a, b) => Number(b.core) - Number(a.core) || a.order - b.order)) {
      scripture.push({ passage: p.passage, core: p.core, title: p.title });
      focus.push(passageSpan(p.passage));
      add({ key: keyOf({ kind: "bible_passage", ...p.passage }), section: "scripture", resource: { kind: "bible_passage", ...p.passage }, title: passageDisplay(p.passage), subtitle: p.title,
        relevance: p.core ? "direct" : "supporting", essential: p.core, reason: { code: p.core ? "topicCore" : "topicSupporting", params: { topic: t.title } } });
    }
    add({ key: `scripture_topic:${t.slug}`, section: "topics", resource: { kind: "scripture_topic", slug: t.slug }, title: t.title, subtitle: null, relevance: "direct", essential: true, reason: { code: "topicItself" } });
    linkType = "bible_topic";
  } else if (type === "core_foundations" || type === "kingdom_school") {
    const courses = type === "core_foundations" ? ix.courses.filter((c) => c.foundations) : ix.courses.filter((c) => c.id === key);
    for (const c of courses) {
      add({ key: `curriculum:${c.id}`, section: c.foundations ? "core_foundations" : "kingdom_school", resource: { kind: "curriculum", id: c.id }, title: c.title, subtitle: null, relevance: "direct", essential: true,
        reason: { code: c.foundations ? "foundationsCourse" : "courseItself", params: { lessons: c.lessons.length } } });
      if (type === "kingdom_school") for (const l of c.lessons)
        add({ key: `lesson:${l.id}`, section: "kingdom_school", resource: { kind: "lesson", id: l.id }, title: l.title, subtitle: l.group, relevance: "direct", essential: true, reason: { code: "courseLesson", params: { course: c.title } } });
      // The course's own memory verses tell us its Scripture; stories and topics on the same passages support it.
      const ids = new Set(c.lessons.map((l) => l.id));
      for (const l of ix.lessons) if (ids.has(l.id)) focus.push(...l.verses.map((v) => v.span));
    }
    subjectKey = type === "core_foundations" ? "foundations" : key; linkType = "curriculum";
  } else {
    const kind = KIND_FOR_TYPE[type]!;
    const s = ix.subjects.find((x) => (x.id === key || x.slug === key) && x.kind === kind)!;
    for (const p of s.passages) {
      scripture.push({ passage: p, core: true, title: null });
      focus.push(passageSpan(p));
      add({ key: keyOf({ kind: "bible_passage", ...p }), section: "scripture", resource: { kind: "bible_passage", ...p }, title: passageDisplay(p), subtitle: null, relevance: "direct", essential: true, reason: { code: "subjectPassage", params: { subject: s.name } } });
    }
    subjectKey = s.id; linkType = "subject";
  }

  // Editorial relationships (approved only — the route never loads anything else).
  for (const l of ix.links.filter((x) => x.subjectType === linkType && x.subjectKey === subjectKey))
    add({ key: l.resourceKey, section: sectionFor(l.resource, ix), resource: l.resource, title: titleFor(l.resource, ix) ?? l.reason, subtitle: null, relevance: l.relation, essential: l.relation === "direct", reason: { code: "editorial", params: { text: l.reason } } });

  // Kingdom Stories: chapters whose Scripture overlaps the focus. A chapter's NARRATIVE references (the
  // passage it retells) are stronger evidence than the extra verses it quotes: a story that only CITES one of
  // the subject's verses is further exploration, not a supporting resource.
  for (const st of ix.stories) {
    const told = st.chapters.filter((ch) => ch.narrative.some((sp) => overlapsAny(sp, focus)));
    const cited = st.chapters.filter((ch) => !told.includes(ch) && ch.spans.some((sp) => overlapsAny(sp, focus)));
    const hits = told.length ? told : cited;
    if (!hits.length) continue;
    const chapters = hits.map((ch) => { const shared = (told.length ? ch.narrative : ch.spans).filter((sp) => overlapsAny(sp, focus)); return { id: ch.id, number: ch.number, title: ch.title, display: shared.map(spanDisplay).join("; "), spans: shared }; });
    const relevance: Relevance = !told.length ? "further" : type === "bible_book" ? "direct" : "supporting";
    add({ key: `kingdom_story:${st.id}`, section: "kingdom_stories", resource: { kind: "kingdom_story", id: st.id, chapterId: hits[0].id }, title: st.title, subtitle: st.subtitle,
      relevance, essential: relevance === "direct", chapters, relatesTo: chapters.flatMap((c) => c.spans),
      reason: relevance === "direct" ? { code: "storyNarrative", params: { book: named.label, chapters: hits.length } }
        : relevance === "supporting" ? { code: "storyOverlap", params: { chapter: hits[0].number, passage: chapters[0].display } }
        : { code: "storyCites", params: { chapter: hits[0].number, passage: chapters[0].display } } });
  }
  // Lessons: memory verses inside the focus (Core Foundations and Kingdom School keep their own sections).
  for (const l of ix.lessons) {
    const v = l.verses.find((x) => overlapsAny(x.span, focus));
    if (!v || type === "kingdom_school" && ix.courses.find((c) => c.id === key)?.lessons.some((x) => x.id === l.id)) continue;
    add({ key: `lesson:${l.id}`, section: l.foundations ? "core_foundations" : "kingdom_school", resource: { kind: "lesson", id: l.id }, title: l.title, subtitle: l.curriculumTitle,
      relevance: "supporting", essential: false, relatesTo: [v.span], reason: { code: "lessonVerse", params: { passage: v.display } } });
  }
  // Scripture topics whose passages are in the focus (not for a topic itself — that is the subject).
  if (type !== "bible_topic") for (const t of ix.topics) {
    const n = t.passages.filter((p) => overlapsAny(passageSpan(p.passage), focus)).length;
    if (n) add({ key: `scripture_topic:${t.slug}`, section: "topics", resource: { kind: "scripture_topic", slug: t.slug }, title: t.title, subtitle: null, relevance: "supporting", essential: false, reason: { code: "topicPassages", params: { count: n } } });
  }
  // Subject records (people / events / places / themes) whose passages are in the focus.
  if (linkType !== "subject") for (const s of ix.subjects) {
    const n = s.passages.filter((p) => overlapsAny(passageSpan(p), focus)).length;
    if (n) add({ key: `subject:${s.id}`, section: "subjects", resource: { kind: "subject", id: s.id }, title: s.name, subtitle: null, relevance: type === "bible_topic" ? "further" : "supporting", essential: false,
      reason: { code: "subjectInFocus", params: { kind: s.kind, count: n } } });
  }
  // Published plans: same focus (direct) or sessions in the focus (supporting).
  for (const p of ix.plans) {
    const sameFocus = (type === "bible_book" && p.focusType === "bible_book" && p.focusRef.book === key)
      || (type === "bible_topic" && p.focusType === "bible_topic" && (p.focusRef.topicSlug === key || p.focusRef.slug === key))
      || (type === "core_foundations" && p.derived?.type === "foundations") || (type === "kingdom_school" && p.derived?.type === "curriculum" && p.derived.id === key)
      || (!!KIND_FOR_TYPE[type] && (p.focusRef.subjectId === subjectKey));
    const n = sameFocus ? 0 : p.spans.filter((sp) => overlapsAny(sp, focus)).length;
    if (sameFocus || n) add({ key: `plan:${p.id}`, section: "plans", resource: { kind: "plan", id: p.id }, title: p.title, subtitle: p.focusLabel,
      relevance: sameFocus ? "direct" : "supporting", essential: false, reason: sameFocus ? { code: "planFocus" } : { code: "planPassages", params: { count: n } } });
  }
  // Further exploration: study tools for the subject's own passages (first few chapters), and the dictionary.
  const chapters: Passage[] = [];
  for (const sp of (type === "bible_book" ? [{ ...focus[0], c2: 1 }] : focus.slice(0, 40))) if (!chapters.some((c) => c.book === sp.book && c.chapter === sp.c1)) chapters.push({ book: sp.book, chapter: sp.c1 });
  if (type !== "core_foundations" && type !== "kingdom_school") for (const c of chapters.slice(0, 6)) {
    const d = passageDisplay(c);
    const sp = [passageSpan(c)];
    add({ key: `commentary:${d}`, section: "commentaries", resource: { kind: "commentary", ...c }, title: d, subtitle: null, relevance: "further", essential: false, relatesTo: sp, reason: { code: "commentaryOn", params: { passage: d } } });
    add({ key: `deep_study:${d}`, section: "deep_study", resource: { kind: "deep_study", ...c }, title: d, subtitle: null, relevance: "further", essential: false, relatesTo: sp, reason: { code: "deepStudyOn", params: { passage: d } } });
  }
  const art = type === "core_foundations" || type === "kingdom_school" ? null : ix.article(named.label);
  if (art) add({ key: `reference_article:${art.id}`, section: "dictionary", resource: { kind: "reference_article", id: art.id }, title: art.title, subtitle: "Easton's Bible Dictionary",
    relevance: "further", essential: false, reason: { code: "dictionaryHeadword", params: { term: named.label } } });

  const order = (r: Recommendation) => SECTIONS.indexOf(r.section) * 10 + RANK[r.relevance];
  return { subject: { type, key, label: named.label, summary: named.summary }, focus, scripture, items: [...items.values()].sort((a, b) => order(a) - order(b)) };
}
function sectionFor(r: Target, ix: DiscoveryIndex): Section {
  switch (r.kind) {
    case "bible_passage": return "scripture";
    case "lesson": return ix.lessons.find((l) => l.id === (r as { id: string }).id)?.foundations ? "core_foundations" : "kingdom_school";
    case "curriculum": return ix.courses.find((c) => c.id === (r as { id: string }).id)?.foundations ? "core_foundations" : "kingdom_school";
    case "kingdom_story": return "kingdom_stories";
    case "scripture_topic": return "topics";
    case "commentary": return "commentaries";
    case "deep_study": case "word_study": return "deep_study";
    default: return "dictionary";
  }
}
function titleFor(r: Target, ix: DiscoveryIndex): string | null {
  const id = (r as { id?: string }).id;
  if (r.kind === "kingdom_story") return ix.stories.find((s) => s.id === id)?.title ?? null;
  if (r.kind === "lesson") return ix.lessons.find((l) => l.id === id)?.title ?? ix.courses.flatMap((c) => c.lessons).find((l) => l.id === id)?.title ?? null;
  if (r.kind === "curriculum") return ix.courses.find((c) => c.id === id)?.title ?? null;
  if (r.kind === "scripture_topic") return ix.topics.find((t) => t.slug === (r as { slug: string }).slug)?.title ?? null;
  if ("book" in r) return passageDisplay(r as Passage);
  return null;
}

// ── "Let P2P organise my study" ─────────────────────────────────────────────
export interface JourneySession extends Omit<SessionInput, "questions"> { essential: boolean; from: string[]; templateQuestions: boolean }
export interface Journey { sessions: JourneySession[]; derivedFrom: { type: "foundations" } | { type: "curriculum"; id: string } | null; note: string | null }
const MAX_JOURNEY = 60;
/** A suggested sequence built ONLY from the discovery's items. Scripture-led subjects get one session per
 *  direct passage (with the supporting items that share that passage beside it), then the directly related
 *  stories; a book gets a session per chapter; Core Foundations and a course follow the curriculum itself.
 *  Smaller when little is available — never padded with weak matches. The person reviews everything. */
export function buildJourney(d: Discovery, opts: { chapters?: { from: number; to: number } } = {}): Journey {
  const t = d.subject.type;
  if (t === "core_foundations") return { sessions: [], derivedFrom: { type: "foundations" }, note: "foundations" };
  if (t === "kingdom_school") return { sessions: [], derivedFrom: { type: "curriculum", id: d.subject.key }, note: "course" };
  const support = (passage: Passage): Resource[] => {
    const sp = passageSpan(passage);
    const out: Resource[] = [];
    for (const r of d.items) {
      if (r.relevance === "further" && r.section !== "commentaries") continue;
      if (r.section === "kingdom_stories" && r.chapters) {
        const ch = r.chapters.find((c) => c.spans.some((s) => overlaps(s, sp)));
        if (ch) out.push({ kind: "kingdom_story", id: (r.resource as { id: string }).id, chapterId: ch.id, note: `${r.title} — chapter ${ch.number}`.slice(0, 300) } as Resource);
      } else if (r.resource.kind === "lesson" && r.relatesTo?.some((x) => overlaps(x, sp))) out.push({ kind: "lesson", id: (r.resource as { id: string }).id, note: r.title.slice(0, 300) } as Resource);
      else if (r.section === "commentaries" && (r.resource as Passage).book === passage.book && (r.resource as Passage).chapter === passage.chapter) out.push(r.resource as Resource);
    }
    return out.slice(0, 4);
  };
  const sessions: JourneySession[] = [];
  if (t === "bible_book") {
    const b = BOOK_BY_CODE.get(d.subject.key)!;
    const from = Math.max(1, opts.chapters?.from ?? 1), to = Math.min(b.chapters, opts.chapters?.to ?? b.chapters);
    for (let c = from; c <= to && sessions.length < MAX_JOURNEY * 3; c++) {
      const p = { book: b.code, chapter: c };
      sessions.push({ title: `${b.name} ${c}`, intro: null, passages: [p], primaryResource: null, supporting: support(p), reflection: null, prayer: null, essential: true, from: ["bookChapters"], templateQuestions: true });
    }
    return { sessions, derivedFrom: null, note: null };
  }
  for (const s of d.scripture.filter((x) => x.core).slice(0, MAX_JOURNEY)) {
    const display = passageDisplay(s.passage);
    sessions.push({ title: s.title ? `${display} — ${s.title}`.slice(0, 200) : display, intro: null, passages: [s.passage], primaryResource: null, supporting: support(s.passage), reflection: null, prayer: null,
      essential: true, from: [t === "bible_topic" ? "topicCore" : "subjectPassage"], templateQuestions: true });
  }
  // Directly related stories and lessons become their own sessions (they are the subject, not a side note).
  for (const r of d.items.filter((x) => x.relevance === "direct" && (x.resource.kind === "kingdom_story" || x.resource.kind === "lesson")).slice(0, 20))
    sessions.push({ title: r.title.slice(0, 200), intro: null, passages: [], primaryResource: { kind: r.resource.kind as "kingdom_story" | "lesson", id: (r.resource as { id: string }).id },
      supporting: [], reflection: null, prayer: null, essential: true, from: [r.reason.code], templateQuestions: false });
  return { sessions, derivedFrom: null, note: sessions.length ? (sessions.length < 4 ? "small" : null) : "empty" };
}
