import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { BOOKS, isVisibleLink } from "../lib/scriptureTopics";
import { getArticles, articlesForTitle } from "../lib/referenceArticles";
import { EDITORIAL_FLOW, isUuid, validatePassage, validateResource, type Passage } from "../lib/studyPlans";
import {
  KIND_FOR_TYPE, SUBJECT_TYPES, bookCodeForName, buildJourney, discover, parseRefList, resourceKey,
  type DiscoveryIndex, type IndexedCourse, type IndexedLesson, type IndexedLink, type IndexedPlan, type IndexedStory, type IndexedSubject, type IndexedTopic, type SubjectType,
} from "../lib/planDiscovery";

// P2P PLANS — RESOURCE DISCOVERY (owner brief 2026-11-14; rules: lib/planDiscovery.ts), mounted at /plan-discovery.
//   GET  /types                      which subject types have records (the app hides empty ones)
//   GET  /subjects?type=&q=&offset=  searchable subject list, built from the real records
//   GET  /:type/:key                 everything available for one subject: direct / supporting / further, with reasons
//   POST /journey                    { type, key, chapters? } → a suggested sequence (the person reviews and edits it)
//   Editors (four eyes): GET /editor/subjects · POST /editor/subjects/:id/status { to } · POST /editor/links/:id { decision }
// Reads PUBLISHED records only (approved topic links, published stories / lessons / plans / subjects, approved
// relationships). Nothing is cached per person: the index holds public catalogue data only.

const router = Router();
class DiscoveryError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (res: Response, e: unknown) => {
  if (e instanceof DiscoveryError) return res.status(e.status).json({ error: e.message });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
};
async function caller(req: Request, res: Response): Promise<string | null> {
  const u = await verifyCaller(req);
  if (!u) { res.status(401).json({ error: "Please sign in." }); return null; }
  return u;
}
async function isEditor(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === "admin_content" || role === "super_admin";
}
/** A table this build may not have yet (251 not applied) reads as empty, never as an error. */
const missing = (e: unknown) => ["42P01", "PGRST205", "42703", "PGRST204"].includes(String((e as { code?: string } | null)?.code ?? ""));
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) { if (missing(error)) return []; throw error; }
  return (data ?? []) as T[];
}
async function inChunks<T>(ids: string[], f: (chunk: string[]) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await rows<T>(f(ids.slice(i, i + 150)))));
  return out;
}

// ── The index (public catalogue data only; rebuilt every 10 minutes or when an editor changes something) ──
let cache: { at: number; ix: DiscoveryIndex } | null = null;
const TTL = 10 * 60_000;
export function invalidateDiscovery() { cache = null; }

async function buildIndex(): Promise<DiscoveryIndex> {
  // Scripture topics and their approved / published passages.
  const topicRows = await rows<{ id: string; slug: string; title: string }>(db.from("p2p_prayer_topics").select("id,slug,title,status").eq("status", "published"));
  const tLinks = await inChunks<{ topic_id: string; role: string; display_order: number; editorial_status: string | null; editorial_title: string | null; scripture_id: string }>(topicRows.map((t) => t.id),
    (c) => db.from("p2p_topic_scriptures").select("topic_id,role,display_order,editorial_status,editorial_title,scripture_id").in("topic_id", c));
  const refRows = await inChunks<{ id: string; book: string; chapter: number; start_verse: number | null; end_verse: number | null }>([...new Set(tLinks.map((l) => l.scripture_id))],
    (c) => db.from("p2p_scripture_references").select("id,book,chapter,start_verse,end_verse").in("id", c));
  const refById = new Map(refRows.map((r) => [r.id, r]));
  const topics: IndexedTopic[] = topicRows.map((t) => ({ slug: t.slug, title: t.title, passages: tLinks.filter((l) => l.topic_id === t.id && isVisibleLink(l)).flatMap((l) => {
    const r = refById.get(l.scripture_id); const code = r ? bookCodeForName(r.book) : null;
    const p = code ? validatePassage({ book: code, chapter: r!.chapter, ...(r!.start_verse ? { startVerse: r!.start_verse, endVerse: r!.end_verse ?? r!.start_verse } : {}) }) : null;
    return p ? [{ passage: p, core: l.role === "core", title: l.editorial_title, order: l.display_order ?? 0 }] : [];
  }) })).filter((t) => t.passages.length);

  // Kingdom Stories: published stories, their chapters' own Scripture references.
  const storyRows = await rows<{ id: string; title: string; subtitle: string | null }>(db.from("p2p_kingdom_stories").select("id,title,subtitle,status").eq("status", "published"));
  const chRows = await inChunks<{ id: string; story_id: string; chapter_number: number; title: string; scripture_refs: string | null }>(storyRows.map((s) => s.id),
    (c) => db.from("p2p_kingdom_story_chapters").select("id,story_id,chapter_number,title,scripture_refs").in("story_id", c));
  const stories: IndexedStory[] = storyRows.map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle, chapters: chRows.filter((c) => c.story_id === s.id).sort((a, b) => a.chapter_number - b.chapter_number).map((c) => {
    const { spans } = parseRefList(c.scripture_refs ?? "");
    // The NARRATIVE references: the chapter's own book (its first reference's book); the rest are supporting verses.
    const narrative = spans.length ? spans.filter((x) => x.book === spans[0].book) : [];
    return { id: c.id, number: c.chapter_number, title: c.title, spans, narrative };
  }) }));

  // Lessons with memory verses, and which course they belong to.
  const blocks = await rows<{ lesson_id: string; content: { reference?: string } | null }>(db.from("p2p_lesson_blocks").select("lesson_id,content").eq("block_type", "memory_verse"));
  const lessonRows = await inChunks<{ id: string; title: string; status: string | null; module_id: string }>([...new Set(blocks.map((b) => b.lesson_id))], (c) => db.from("p2p_lessons").select("id,title,status,module_id").in("id", c));
  const coreCourses = await rows<{ id: string; title: string; type: string }>(db.from("p2p_curriculums").select("id,title,type,status").eq("status", "published").eq("type", "core"));
  const modRows = await inChunks<{ id: string; curriculum_id: string; title: string; order_index: number }>([...new Set([...lessonRows.map((l) => l.module_id)])], (c) => db.from("p2p_modules").select("id,curriculum_id,title,order_index").in("id", c));
  const curIds = [...new Set(modRows.map((m) => m.curriculum_id))];
  const curRows = await inChunks<{ id: string; title: string; type: string; status: string }>(curIds, (c) => db.from("p2p_curriculums").select("id,title,type,status").in("id", c));
  const modById = new Map(modRows.map((m) => [m.id, m])), curById = new Map(curRows.map((c) => [c.id, c]));
  const lessons: IndexedLesson[] = lessonRows.filter((l) => (l.status ?? "published") === "published").flatMap((l) => {
    const cur = curById.get(modById.get(l.module_id)?.curriculum_id ?? "");
    if (!cur || cur.status !== "published" || (cur.type !== "core" && cur.type !== "plan")) return [];
    const verses = blocks.filter((b) => b.lesson_id === l.id).flatMap((b) => parseRefList(String(b.content?.reference ?? "")).spans.map((span) => ({ span, display: String(b.content?.reference ?? "") })));
    return verses.length ? [{ id: l.id, title: l.title, curriculumId: cur.id, curriculumTitle: cur.title, foundations: cur.type === "core", verses }] : [];
  });
  // Core Foundations courses with their lessons in curriculum order (module order, then lesson order).
  const courses: IndexedCourse[] = [];
  for (const c of coreCourses) courses.push({ id: c.id, title: c.title, foundations: true, lessons: await courseLessons(c.id) });

  // Published official plans and their session references.
  const planRows = await rows<{ id: string; title: string; focus_type: string; focus_ref: Record<string, unknown>; focus_label: string; derived_from: { type: string; id?: string } | null }>(
    db.from("p2p_study_plans").select("id,title,focus_type,focus_ref,focus_label,derived_from,origin,editorial_status").eq("origin", "p2p").eq("editorial_status", "published"));
  const sessRows = await inChunks<{ plan_id: string; passages: Passage[] | null; retired_at?: string | null }>(planRows.map((p) => p.id), (c) => db.from("p2p_study_plan_sessions").select("*").in("plan_id", c));
  const plans: IndexedPlan[] = planRows.map((p) => ({ id: p.id, title: p.title, focusType: p.focus_type, focusRef: p.focus_ref ?? {}, focusLabel: p.focus_label, derived: p.derived_from,
    spans: sessRows.filter((s) => s.plan_id === p.id && !s.retired_at).flatMap((s) => (s.passages ?? []).map((x) => ({ book: x.book, c1: x.chapter, v1: x.startVerse ?? 1, c2: x.chapter, v2: x.endVerse ?? (x.startVerse ?? 999) }))) }));

  // Subject records and approved relationships (migration 251; empty until it is applied).
  const subjects: IndexedSubject[] = (await rows<{ id: string; slug: string; kind: IndexedSubject["kind"]; name: string; summary: string | null; passages: unknown[] }>(
    db.from("p2p_study_subjects").select("id,slug,kind,name,summary,passages,editorial_status").eq("editorial_status", "published")))
    .map((s) => ({ id: s.id, slug: s.slug, kind: s.kind, name: s.name, summary: s.summary, passages: (s.passages ?? []).map(validatePassage).filter((p): p is Passage => !!p) }));
  const links: IndexedLink[] = (await rows<{ subject_type: IndexedLink["subjectType"]; subject_key: string; resource: unknown; relation: IndexedLink["relation"]; reason: string }>(
    db.from("p2p_subject_resource_links").select("subject_type,subject_key,resource,relation,reason,editorial_status").eq("editorial_status", "approved")))
    .flatMap((l) => { const r = validateResource(l.resource); return r ? [{ subjectType: l.subject_type, subjectKey: l.subject_key, resource: r, resourceKey: resourceKey(r), relation: l.relation, reason: l.reason }] : []; });
  // A linked lesson or story must still be published to be shown.
  const liveStories = new Set(stories.map((s) => s.id));
  const linkedLessons = links.filter((l) => l.resource.kind === "lesson").map((l) => (l.resource as { id: string }).id);
  const liveLessons = new Set((await inChunks<{ id: string; status: string | null }>(linkedLessons, (c) => db.from("p2p_lessons").select("id,status").in("id", c))).filter((l) => (l.status ?? "published") === "published").map((l) => l.id));
  const liveLinks = links.filter((l) => l.resource.kind === "kingdom_story" ? liveStories.has((l.resource as { id: string }).id) : l.resource.kind === "lesson" ? liveLessons.has((l.resource as { id: string }).id) : true);

  let articles: ReturnType<typeof getArticles> | null = null;
  try { articles = getArticles(); } catch { articles = null; }
  const article = (title: string) => {
    if (!articles) return null;
    const hit = articlesForTitle(articles, title).find((a) => a.title.toLowerCase() === title.toLowerCase()) ?? null;
    return hit ? { id: hit.id, title: hit.title } : null;
  };
  return { topics, stories, lessons, plans, subjects, links: liveLinks, courses, article };
}
/** A course's published lessons in curriculum order. */
async function courseLessons(curriculumId: string): Promise<IndexedCourse["lessons"]> {
  const mods = await rows<{ id: string; title: string; order_index: number }>(db.from("p2p_modules").select("id,title,order_index").eq("curriculum_id", curriculumId).order("order_index", { ascending: true }));
  const les = await inChunks<{ id: string; title: string; module_id: string; order_index: number; status: string | null }>(mods.map((m) => m.id),
    (c) => db.from("p2p_lessons").select("id,title,module_id,order_index,status").in("module_id", c).order("order_index", { ascending: true }));
  return mods.flatMap((m) => les.filter((l) => l.module_id === m.id && (l.status ?? "published") === "published").sort((a, b) => a.order_index - b.order_index).map((l) => ({ id: l.id, title: l.title, group: m.title })));
}
async function index(): Promise<DiscoveryIndex> {
  if (cache && Date.now() - cache.at < TTL) return cache.ix;
  const ix = await buildIndex();
  cache = { at: Date.now(), ix };
  return ix;
}
/** The index, plus one Kingdom School course with its lessons (courses are many; each is read when chosen). */
async function indexFor(type: SubjectType, key: string): Promise<DiscoveryIndex> {
  const ix = await index();
  if (type !== "kingdom_school") return ix;
  if (!isUuid(key)) throw new DiscoveryError(404, "That subject isn't available.");
  const { data } = await db.from("p2p_curriculums").select("id,title,type,status").eq("id", key).maybeSingle();
  const c = data as { id: string; title: string; type: string; status: string } | null;
  if (!c || c.status !== "published" || c.type !== "plan") throw new DiscoveryError(404, "That subject isn't available.");
  return { ...ix, courses: [...ix.courses, { id: c.id, title: c.title, foundations: false, lessons: await courseLessons(c.id) }] };
}
const readType = (v: unknown): SubjectType => {
  if (!(SUBJECT_TYPES as readonly string[]).includes(String(v))) throw new DiscoveryError(400, "Choose what you'd like to study.");
  return v as SubjectType;
};
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "");

router.get("/types", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const ix = await index();
    const { count } = await db.from("p2p_curriculums").select("id", { count: "exact", head: true }).eq("status", "published").eq("type", "plan");
    const counts: Record<SubjectType, number> = { bible_book: BOOKS.length, bible_topic: ix.topics.length, core_foundations: ix.courses.some((c) => c.foundations) ? 1 : 0, kingdom_school: count ?? 0,
      biblical_person: 0, biblical_event: 0, biblical_place: 0, theme: 0 };
    for (const s of ix.subjects) for (const [t, k] of Object.entries(KIND_FOR_TYPE)) if (k === s.kind) counts[t as SubjectType]++;
    return res.json({ types: SUBJECT_TYPES.map((type) => ({ type, count: counts[type] })) });
  } catch (e) { return fail(res, e); }
});

router.get("/subjects", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const type = readType(req.query.type);
    const q = fold(String(req.query.q ?? "").slice(0, 80)).trim();
    const offset = Math.max(0, Math.min(10_000, Number(req.query.offset) || 0));
    const ix = await index();
    let items: { type: SubjectType; key: string; label: string; hint: string | null }[] = [];
    if (type === "bible_book") items = BOOKS.map((b, i) => ({ type, key: b.code, label: b.name, hint: i < 39 ? "OT" : "NT" }));
    else if (type === "bible_topic") items = ix.topics.map((t) => ({ type, key: t.slug, label: t.title, hint: String(t.passages.length) })).sort((a, b) => a.label.localeCompare(b.label));
    else if (type === "core_foundations") items = ix.courses.some((c) => c.foundations) ? [{ type, key: "foundations", label: "Core Foundations", hint: String(ix.courses.filter((c) => c.foundations).reduce((n, c) => n + c.lessons.length, 0)) }] : [];
    else if (type === "kingdom_school") {
      const all = await rows<{ id: string; title: string; is_visible: boolean | null }>(db.from("p2p_curriculums").select("id,title,is_visible").eq("status", "published").eq("type", "plan").order("title", { ascending: true }));
      items = all.filter((c) => c.is_visible !== false).map((c) => ({ type, key: c.id, label: c.title, hint: null }));
    } else items = ix.subjects.filter((s) => s.kind === KIND_FOR_TYPE[type]).map((s) => ({ type, key: s.id, label: s.name, hint: s.summary })).sort((a, b) => a.label.localeCompare(b.label));
    if (q) items = items.filter((i) => fold(i.label).includes(q));
    return res.json({ items: items.slice(offset, offset + 50), total: items.length, offset });
  } catch (e) { return fail(res, e); }
});

router.post("/journey", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const type = readType(b.type), key = String(b.key ?? "").slice(0, 120);
    const d = discover(type, key, await indexFor(type, key));
    if (!d) throw new DiscoveryError(404, "That subject isn't available.");
    const ch = b.chapters as { from?: number; to?: number } | undefined;
    const j = buildJourney(d, ch && Number.isInteger(ch.from) && Number.isInteger(ch.to) ? { chapters: { from: ch.from!, to: ch.to! } } : {});
    return res.json({ subject: d.subject, journey: j });
  } catch (e) { return fail(res, e); }
});

// ── Editors: subjects and relationships (four eyes; nothing reaches participants until published / approved) ──
router.get("/editor/subjects", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new DiscoveryError(403, "Only content editors can review subjects.");
    const subjects = await rows<Record<string, unknown>>(db.from("p2p_study_subjects").select("*").order("name", { ascending: true }));
    const links = await rows<Record<string, unknown>>(db.from("p2p_subject_resource_links").select("*").neq("editorial_status", "archived"));
    return res.json({ subjects, links });
  } catch (e) { return fail(res, e); }
});
router.post("/editor/subjects/:id/status", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new DiscoveryError(403, "Only content editors can change a subject's status.");
    if (!isUuid(req.params.id)) throw new DiscoveryError(404, "That subject isn't available.");
    const { data } = await db.from("p2p_study_subjects").select("id,editorial_status,submitted_by").eq("id", req.params.id).maybeSingle();
    const s = data as { id: string; editorial_status: string; submitted_by: string | null } | null;
    if (!s) throw new DiscoveryError(404, "That subject isn't available.");
    const to = String((req.body ?? {}).to ?? "");
    if (!(EDITORIAL_FLOW[s.editorial_status] ?? []).includes(to)) throw new DiscoveryError(409, `A subject can't move from ${s.editorial_status} to ${to || "that status"}.`);
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { editorial_status: to, updated_at: now };
    if (to === "under_review") Object.assign(patch, { submitted_by: userId, reviewed_by: null, reviewed_at: null });
    if (to === "approved") {
      if (!s.submitted_by || s.submitted_by === userId) throw new DiscoveryError(409, "Another editor must approve this subject (not the person who submitted it).");
      Object.assign(patch, { reviewed_by: userId, reviewed_at: now });
    }
    if (to === "published") Object.assign(patch, { published_at: now });
    if (to === "draft") Object.assign(patch, { reviewed_by: null, reviewed_at: null });
    const { error } = await db.from("p2p_study_subjects").update(patch).eq("id", s.id);
    if (error) throw error;
    invalidateDiscovery();
    return res.json({ id: s.id, status: to });
  } catch (e) { return fail(res, e); }
});
router.post("/editor/links/:id", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    if (!(await isEditor(userId))) throw new DiscoveryError(403, "Only content editors can review relationships.");
    if (!isUuid(req.params.id)) throw new DiscoveryError(404, "That relationship isn't available.");
    const { data } = await db.from("p2p_subject_resource_links").select("id,created_by,editorial_status").eq("id", req.params.id).maybeSingle();
    const l = data as { id: string; created_by: string | null; editorial_status: string } | null;
    if (!l) throw new DiscoveryError(404, "That relationship isn't available.");
    const decision = String((req.body ?? {}).decision ?? "");
    if (decision === "approve") {
      if (l.created_by === userId) throw new DiscoveryError(409, "Another editor must approve this relationship.");
      const { error } = await db.from("p2p_subject_resource_links").update({ editorial_status: "approved", reviewed_by: userId, reviewed_at: new Date().toISOString() }).eq("id", l.id);
      if (error) throw error;
    } else if (decision === "archive") {
      const { error } = await db.from("p2p_subject_resource_links").update({ editorial_status: "archived" }).eq("id", l.id);
      if (error) throw error;
    } else throw new DiscoveryError(400, "Approve or archive.");
    invalidateDiscovery();
    return res.json({ id: l.id, decision });
  } catch (e) { return fail(res, e); }
});

router.get("/:type/:key", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const type = readType(req.params.type), key = String(req.params.key).slice(0, 120);
    const d = discover(type, key, await indexFor(type, key));
    if (!d) throw new DiscoveryError(404, "That subject isn't available.");
    // Large results are paged per section (?section=&offset=); every section reports its total.
    const PAGE = 40;
    const section = String(req.query.section ?? ""), offset = Math.max(0, Number(req.query.offset) || 0);
    const sections = [...new Set(d.items.map((i) => i.section))].map((s) => {
      const all = d.items.filter((i) => i.section === s);
      const from = s === section ? offset : 0;
      return { section: s, total: all.length, offset: from, items: all.slice(from, from + PAGE) };
    }).filter((s) => !section || s.section === section);
    return res.json({ subject: d.subject, sections, counts: { direct: d.items.filter((i) => i.relevance === "direct").length, supporting: d.items.filter((i) => i.relevance === "supporting").length, further: d.items.filter((i) => i.relevance === "further").length } });
  } catch (e) { return fail(res, e); }
});

export default router;
