// P2P LEARNING PLAN ORGANISER (owner brief 2026-11-19 "Learning Plans, Intelligent Search, Study Deeper").
// Pure rules (no database, no network): what the Bible Study search found for a subject or question
// (lib/studySearch → routes/studyWorkspace.studySearch) and the published records in the discovery index
// (lessons of Core Foundations and Kingdom School, Kingdom Stories, Scripture topics) are organised into a
// PROPOSED learning journey: meaningful stages, each holding ACTUAL resources, each with why it was included and
// where it comes from. Nothing is invented — every item is a real record the search or the index returned; a stage
// with nothing in it is left out; what's missing is named as a gap. Nothing is saved here: the participant reviews,
// edits and confirms in the builder (POST /study-plans only on confirmation).
//
// Seven resource categories: Bible · Core Foundations · Kingdom School · Kingdom Stories · Reference (Easton,
// lexicon) · Deep Study (original language, commentaries, cross-references) · P2P Library (the person's own and
// shared Scripture playlists/collections — never anyone else's private material).
//
// Study Deeper (depth ≥ 1): resources the person already completed in earlier journeys on this subject are left
// out, the order leads with original language, commentary, cross-references and history, and further Scripture is
// drawn from beyond what earlier journeys used. There is no maximum: a deeper journey is offered while genuinely new
// material remains (note "nothing_new" when it doesn't).
import { createHmac, timingSafeEqual } from "node:crypto";
import { passageDisplay, type Passage, type Resource } from "./studyPlans";
import { overlapsAny, passageSpan, type DiscoveryIndex, type Span } from "./planDiscovery";
import { contentWords, stems, type Finding } from "./studySearch";

export const CATEGORIES = ["bible", "core_foundations", "kingdom_school", "kingdom_stories", "reference", "deep_study", "library"] as const;
export type Category = (typeof CATEGORIES)[number];
export const STAGES = ["foundations", "scripture", "learning", "connections", "deeper", "application"] as const;
export type StageKey = (typeof STAGES)[number];
export const STAGE_TITLES: Record<StageKey, string> = {
  foundations: "Foundations and definitions", scripture: "What Scripture says", learning: "Learning in P2P",
  connections: "Biblical connections and context", deeper: "Deeper study", application: "Reflection and application",
};
/** Where an item comes from — shown with it (P2P resource, Bible passage, reference work, organised activity). */
export type Origin = "p2p_resource" | "bible" | "reference" | "activity";
export interface JourneyItem {
  key: string; category: Category; origin: Origin; stage: StageKey; resource: Resource; title: string; subtitle: string | null;
  why: string; source: string;
}
export interface JourneyStage { key: StageKey; title: string; items: JourneyItem[] }
export interface Gap { category: Category | "external"; message: string }
export interface OrganisedJourney {
  question: string; depth: number; stages: JourneyStage[]; gaps: Gap[]; coverage: Record<Category, number>;
  /** Further real resources not in the journey (for "Discover more" and "Replace"). */
  more: JourneyItem[];
  note: "ok" | "small" | "empty" | "nothing_new";
  /** Lessons proposed as electives (opened from this plan without the curriculum's order — see electives token). */
  electiveLessons: string[];
}

// ── Keys (the same shape the builder uses to avoid offering an item twice) ────────────────────────────────────
export function resourceKeyOf(r: Resource): string {
  if ((r.kind === "deep_study" || r.kind === "commentary") && "book" in r) return `${r.kind}:${r.book}.${r.chapter}`;
  const o = r as Resource & Partial<Passage> & { id?: string; slug?: string; strongs?: string; key?: string };
  if ("id" in o && o.id) return `${r.kind}:${o.id}${(o as { chapterId?: string }).chapterId ? `:${(o as { chapterId?: string }).chapterId}` : ""}`;
  if (o.slug) return `${r.kind}:${o.slug}`;
  if (o.strongs) return `${r.kind}:${o.strongs}`;
  if (o.key) return `${r.kind}:${o.key}`;
  return o.book && o.chapter ? `${r.kind}:${passageDisplay({ book: o.book, chapter: o.chapter, ...(o.startVerse ? { startVerse: o.startVerse, endVerse: o.endVerse } : {}) })}` : `${r.kind}:`;
}

// ── From a search finding to a plan resource (only shapes the plan validator accepts) ─────────────────────────
function resourceFrom(f: Finding): Resource | null {
  const r = f.ref as Record<string, unknown>;
  const p = (): Passage | null => (typeof r.book === "string" && Number.isInteger(r.chapter) ? { book: r.book, chapter: r.chapter as number, ...(Number.isInteger(r.startVerse) ? { startVerse: r.startVerse as number, endVerse: (Number.isInteger(r.endVerse) ? r.endVerse : r.startVerse) as number } : {}) } : null);
  switch (f.kind) {
    case "bible_passage": { const x = p(); return x ? { kind: "bible_passage", ...x } : null; }
    case "deep_study": { const x = p(); return x ? { kind: "deep_study", ...x } : null; }
    case "commentary": { const x = p(); return x ? { kind: "commentary", book: x.book, chapter: x.chapter } : null; }
    case "kingdom_story": return typeof r.id === "string" ? { kind: "kingdom_story", id: r.id, ...(typeof r.chapterId === "string" ? { chapterId: r.chapterId } : {}) } : null;
    case "reference_article": return typeof r.id === "string" ? { kind: "reference_article", id: r.id } : null;
    case "dictionary_term": return typeof r.key === "string" ? { kind: "dictionary_term", key: r.key } : null;
    default: return null;
  }
}
function categoryOf(f: Finding): Category {
  if (f.kind === "bible_passage") return "bible";
  if (f.kind === "kingdom_story") return "kingdom_stories";
  if (f.kind === "reference_article" || f.kind === "dictionary_term") return "reference";
  return "deep_study";
}
function stageOf(f: Finding): StageKey {
  switch (f.group) {
    case "definitions": return "foundations";
    case "greek_hebrew": return f.kind === "dictionary_term" ? "foundations" : "deeper";
    case "scriptures": return "scripture";
    case "stories": case "history": case "cross_references": return "connections";
    case "commentaries": return "deeper";
    default: return "connections";
  }
}
const WHY: Record<string, (p: Record<string, string | number>) => string> = {
  referenceTyped: () => "The passage you asked about.",
  originalWordsOf: (p) => `The original-language words of ${p.passage}.`,
};
function whyOf(f: Finding): string {
  const fn = WHY[f.why.code];
  if (fn) return fn(f.why.params ?? {});
  switch (f.group) {
    case "scriptures": return f.match === "direct" ? "Scripture that speaks about this directly." : "Scripture an editor connected to this subject.";
    case "definitions": return "A definition of the subject's key words.";
    case "greek_hebrew": return "The original-language words behind the subject.";
    case "commentaries": return "A commentary on a passage at the heart of this subject.";
    case "cross_references": return "Passages that connect with the key Scripture.";
    case "stories": return "A Kingdom Story whose Scripture covers this subject.";
    case "history": return "Historical and cultural background.";
    default: return "Connected to your search.";
  }
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface OrganiseInput {
  question: string;
  /** routes/studyWorkspace.studySearch(...) for the question (and, merged, for the starting point's label). */
  findings: Finding[];
  ix: Pick<DiscoveryIndex, "lessons" | "stories">;
  /** The person's own (and shared-with-them) Scripture playlists/collections that match. */
  library?: { id: string; title: string; subtitle: string | null }[];
  /** A chosen starting point (book, Core Foundations, a course) — widens, never restricts, the search. */
  start?: { type: "bible_book"; book: string } | { type: "core_foundations" } | { type: "kingdom_school"; curriculumId: string } | null;
  /** Biblical names, titles and descriptions the search named (YHWH, Adonai, Kyrios…) — each with its verified verse. */
  names?: { id: string; name: string; primary: { display: string; book: string; chapter: number; start: number; end: number } | null }[];
  /** Resource keys the person already completed in earlier journeys on this subject (Study Deeper). */
  exclude?: Set<string>;
  depth?: number;
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const CAPS: Record<StageKey, number> = { foundations: 8, scripture: 6, learning: 6, connections: 5, deeper: 5, application: 1 };

export function organise(inp: OrganiseInput): OrganisedJourney {
  const depth = Math.max(0, Math.floor(inp.depth ?? 0));
  const exclude = inp.exclude ?? new Set<string>();
  const all: JourneyItem[] = [];
  const seen = new Set<string>();
  const qWords = (() => { const cw = contentWords(inp.question); const base = cw.length ? cw : fold(inp.question).split(" ").filter((w) => w.length >= 3); return [...new Set(base.flatMap((w) => [w, ...stems(w)]).filter((w) => w.length >= 3))]; })();
  const mentions = (text: string | null) => { if (!text) return true; const t = ` ${fold(text)}`; return qWords.some((w) => t.includes(` ${w}`)); };
  const add = (it: JourneyItem) => { if (seen.has(it.key) || exclude.has(it.key)) return; seen.add(it.key); all.push(it); };

  // 1. Everything the Bible Study search found (Bible, Reference, Deep Study, Kingdom Stories).
  for (const f of inp.findings) {
    if (f.group === "mine") continue; // the person's notes stay private; their playlists come in through `library`
    if (f.group === "scriptures" && f.match === "direct" && f.why.code !== "referenceTyped" && !mentions(f.subtitle)) continue;
    const res = resourceFrom(f);
    if (!res) continue;
    const category = categoryOf(f);
    add({ key: resourceKeyOf(res), category, origin: category === "bible" ? "bible" : category === "reference" ? "reference" : "p2p_resource", stage: stageOf(f), resource: res,
      title: f.title, subtitle: f.subtitle, why: whyOf(f), source: f.source });
  }
  // 1b. Biblical names and titles (verified in Scripture; P2P Biblical Names): each one's own verse.
  for (const n of inp.names ?? []) {
    if (!n.primary) continue;
    const res: Resource = { kind: "bible_passage", book: n.primary.book, chapter: n.primary.chapter, startVerse: n.primary.start, endVerse: n.primary.end };
    const it: JourneyItem = { key: resourceKeyOf(res), category: "bible", origin: "bible", stage: "foundations", resource: res, title: `${n.name} — ${n.primary.display}`, subtitle: null,
      why: `“${n.name}”: a biblical name or title connected with this subject, where Scripture uses it.`, source: "P2P Biblical Names (verified in Scripture)" };
    // A verse already found as plain Scripture becomes this name entry (more useful), not a second item.
    const at = all.findIndex((x) => x.key === it.key);
    if (at >= 0) all.splice(at, 1, it); else add(it);
  }
  // 2. Lessons (Core Foundations, Kingdom School): their Scripture overlaps the passages found, or their title names
  //    the subject's main words (never a lone generic word). Starting point = that course's lessons first.
  const spans: Span[] = all.filter((i) => i.resource.kind === "bible_passage").map((i) => passageSpan(i.resource as Passage));
  const words = qWords.filter((w) => w.length >= 4);
  const titleHit = (t: string) => { const ft = ` ${fold(t)} `; return words.find((w) => ft.includes(` ${w}`)) ?? null; };
  const lessonItems: JourneyItem[] = [];
  for (const l of inp.ix.lessons) {
    const byTitle = titleHit(l.title);
    const shared = l.verses.find((v) => overlapsAny(v.span, spans));
    const inStart = inp.start?.type === "kingdom_school" ? l.curriculumId === inp.start.curriculumId : inp.start?.type === "core_foundations" ? l.foundations : false;
    if (!byTitle && !shared && !inStart) continue;
    const res: Resource = { kind: "lesson", id: l.id };
    lessonItems.push({ key: resourceKeyOf(res), category: l.foundations ? "core_foundations" : "kingdom_school", origin: "p2p_resource", stage: "learning", resource: res,
      title: l.title, subtitle: l.curriculumTitle,
      why: byTitle ? `A lesson on “${byTitle}” in ${l.curriculumTitle}.` : shared ? `Studies ${shared.display}, a key passage for this subject.` : `Part of ${l.curriculumTitle}, your starting point.`,
      source: l.foundations ? "Core Foundations" : `Kingdom School · ${l.curriculumTitle}` });
  }
  // Title matches first, then Scripture overlap, then the starting point's own lessons.
  lessonItems.sort((a, b) => rankLesson(a) - rankLesson(b));
  for (const it of lessonItems) add(it);
  // 3. Kingdom Stories whose chapters overlap the passages (when the search didn't already bring them).
  for (const st of inp.ix.stories) for (const ch of st.chapters) {
    if (!overlapsAny(ch.narrative.length ? ch.narrative[0] : ch.spans[0] ?? { book: "", c1: 0, v1: 0, c2: 0, v2: 0 }, spans) || !ch.spans.length) continue;
    const res: Resource = { kind: "kingdom_story", id: st.id, chapterId: ch.id };
    add({ key: resourceKeyOf(res), category: "kingdom_stories", origin: "p2p_resource", stage: "connections", resource: res, title: `${st.title}: ${ch.title}`, subtitle: st.subtitle,
      why: "A Kingdom Story told from the same Scripture.", source: "Kingdom Stories" });
  }
  // 4. P2P Library: the person's own and shared Scripture playlists/collections that match.
  for (const c of inp.library ?? []) {
    const res = { kind: "scripture_collection", id: c.id } as unknown as Resource;
    add({ key: `scripture_collection:${c.id}`, category: "library", origin: "p2p_resource", stage: "scripture", resource: res, title: c.title, subtitle: c.subtitle,
      why: "From your Scripture library.", source: "My Scripture Library" });
  }
  // 5. A starting book: its passages found by the search come first in Scripture (it never limits anything).
  const startBook = inp.start?.type === "bible_book" ? inp.start.book : null;

  // ── Stages ──
  const order: StageKey[] = depth > 0 ? ["foundations", "deeper", "connections", "scripture", "learning", "application"] : ["foundations", "scripture", "learning", "connections", "deeper", "application"];
  const byStage = new Map<StageKey, JourneyItem[]>(STAGES.map((k) => [k, []]));
  const deeperFirst = (a: JourneyItem, b: JourneyItem) => (depth > 0 ? (a.resource.kind === "deep_study" ? -1 : 0) - (b.resource.kind === "deep_study" ? -1 : 0) : 0);
  // Biblical names and titles lead the foundations (YHWH, Adonai, Kyrios before dictionary entries).
  const isName = (i: JourneyItem) => (i.source.startsWith("P2P Biblical Names") ? 1 : 0);
  const pool = [...all].sort((a, b) => isName(b) - isName(a) || (startBook ? Number(bookOf(b) === startBook) - Number(bookOf(a) === startBook) : 0) || deeperFirst(a, b));
  const more: JourneyItem[] = [];
  for (const it of pool) {
    const list = byStage.get(it.stage)!;
    // Names share the foundations with definitions: at most 5, so the dictionary's own entries still have room.
    if (isName(it) && list.filter(isName).length >= 5) { more.push(it); continue; }
    if (list.length < CAPS[it.stage] + (depth > 0 && (it.stage === "deeper" || it.stage === "connections") ? 2 : 0)) list.push(it); else more.push(it);
  }
  // Reflection and application: the key passage, with P2P's study questions (an organised activity — the
  // questions are P2P's own prompts, not teaching; the passage is real Scripture).
  const key = byStage.get("scripture")![0];
  if (key) byStage.set("application", [{ ...key, key: `activity:${key.key}`, origin: "activity", stage: "application", title: `Reflect: ${key.title}`, why: "Time to reflect on what you've learned and how it shapes your life.", source: "P2P study questions" }]);
  const stages: JourneyStage[] = order.map((k) => ({ key: k, title: STAGE_TITLES[k], items: byStage.get(k)! })).filter((s) => s.items.length > 0);
  // Never an application stage on its own.
  const real = stages.filter((s) => s.key !== "application");
  const coverage = Object.fromEntries(CATEGORIES.map((c) => [c, real.flatMap((s) => s.items).filter((i) => i.category === c).length])) as Record<Category, number>;
  const gaps: Gap[] = [];
  if (!coverage.bible) gaps.push({ category: "bible", message: "No Scripture passage was found for these exact words. Try a key word or a passage reference." });
  if (!coverage.core_foundations && !coverage.kingdom_school) gaps.push({ category: "kingdom_school", message: "P2P has no lesson on this subject yet." });
  if (!coverage.reference) gaps.push({ category: "reference", message: "No dictionary or reference article was found for this subject." });
  if (!coverage.deep_study) gaps.push({ category: "deep_study", message: "No commentary or original-language study was found yet." });
  if (real.length && !coverage.kingdom_stories) gaps.push({ category: "kingdom_stories", message: "No Kingdom Story covers this Scripture yet." });
  const electiveLessons = real.flatMap((s) => s.items).filter((i) => i.resource.kind === "lesson").map((i) => (i.resource as { id: string }).id);
  const total = real.reduce((n, s) => n + s.items.length, 0);
  const note: OrganisedJourney["note"] = total === 0 ? (depth > 0 ? "nothing_new" : "empty") : total < 4 ? "small" : "ok";
  return { question: inp.question, depth, stages: total ? stages : [], gaps, coverage, more: more.slice(0, 40), note, electiveLessons };
}
const bookOf = (i: JourneyItem) => (i.resource as Partial<Passage>).book ?? null;
const rankLesson = (i: JourneyItem) => (i.why.startsWith("A lesson on") ? 0 : i.why.startsWith("Studies") ? 1 : 2);

// ── Proposal → plan sessions (the builder shows and edits these; nothing saved until confirmed) ───────────────
export interface ProposedSession { title: string; intro: string; passages: Passage[]; primaryResource: Resource | null; supporting: Resource[]; questions: { kind: string; text: string }[]; stage: StageKey; itemKey: string; category: Category; origin: Origin; why: string; source: string }
export function sessionsFrom(j: OrganisedJourney): ProposedSession[] {
  const out: ProposedSession[] = [];
  for (const st of j.stages) for (const it of st.items) {
    const r = it.resource as Resource & Partial<Passage>;
    const isPassage = r.kind === "bible_passage";
    const questions = it.origin === "activity" ? [
      { kind: "observe", text: `What does this passage say about ${j.question.replace(/[?.!]+$/, "")}?` },
      { kind: "context", text: "Who is speaking, to whom, and what is happening around this passage?" },
      { kind: "apply", text: "What will you do differently this week because of what you have learned?" },
    ] : [];
    out.push({ title: it.title.slice(0, 200), intro: `${st.title}. ${it.why} Source: ${it.source}.`.slice(0, 2000),
      passages: isPassage ? [{ book: r.book!, chapter: r.chapter!, ...(r.startVerse ? { startVerse: r.startVerse, endVerse: r.endVerse } : {}) }] : [],
      primaryResource: isPassage ? null : it.resource, supporting: [], questions, stage: st.key, itemKey: it.key, category: it.category, origin: it.origin, why: it.why, source: it.source });
  }
  return out;
}

// ── Electives token: which lessons THIS proposal offered, signed, so a saved plan can open them out of the
//    curriculum's order (only these lessons, only from this plan) — a participant can't grant it to themselves. ──
const secret = () => process.env.PLAN_ORGANISER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "p2p-local-organiser";
export function signElectives(userId: string, lessonIds: string[], nowMs = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, l: [...new Set(lessonIds)].sort(), e: nowMs + 7 * 86400_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function readElectives(token: unknown, userId: string, nowMs = Date.now()): string[] {
  if (typeof token !== "string" || token.length > 20_000) return [];
  const [body, sig] = token.split(".");
  if (!body || !sig) return [];
  const want = createHmac("sha256", secret()).update(body).digest();
  let got: Buffer; try { got = Buffer.from(sig, "base64url"); } catch { return []; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return [];
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u: string; l: string[]; e: number };
    return o.u === userId && o.e > nowMs && Array.isArray(o.l) ? o.l.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
