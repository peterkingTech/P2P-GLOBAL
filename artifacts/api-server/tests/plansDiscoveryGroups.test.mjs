// P2P PLANS — discovery + groups + versions (owner brief "Unified Plans, Intelligent Resource Discovery and
// Study Together", 2026-11-14; migration 251). Real code: lib/planDiscovery.ts, routes/planDiscovery.ts,
// routes/studyPlans.ts and lib/sharedStudy.ts (private groups), over HTTP, with an in-memory database.
// Covers the brief's acceptance list §22: B (discovery), C (recommendations), E (drafts, retries), F (questions
// stay optional), G (groups from plans, private), H (the exact group-continuation scenario), I (privacy,
// retries, no Growth Matrix writes) and versioning (§13 / §15).
// Run: node tests/plansDiscoveryGroups.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmpDir = path.join(root, "tests", `.tmp-pdg-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });

// ── TEST DATA (invented) ──
const U = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const [OWNER, BEN, CAT, DAN, LATE, OUT, ED1, ED2] = [1, 2, 3, 4, 5, 6, 7, 8].map(U);
const LOVE_T = U(100), REF = (n) => U(110 + n);
const RUTH = U(200), LOVESTORY = U(201), DRAFTSTORY = U(202), NICO = U(203), DAVIDSTORY = U(204);
const CORE = U(300), KS = U(301), M1 = U(310), M2 = U(311), L1 = U(320), L2 = U(321), L3 = U(322);
const DAVID = U(400), GOLIATH = U(401), PUBPLAN = U(500), CITES = U(205);
const T = {
  p2p_profiles: [OWNER, BEN, CAT, DAN, LATE, OUT].map((id) => ({ id, role: "member", full_name: "Member" })).concat([{ id: ED1, role: "admin_content" }, { id: ED2, role: "admin_content" }]),
  p2p_prayer_topics: [{ id: LOVE_T, slug: "love", title: "Love", status: "published" }, { id: U(101), slug: "hidden", title: "Hidden", status: "draft" }],
  p2p_topic_scriptures: [
    { topic_id: LOVE_T, role: "core", display_order: 1, editorial_status: "published", editorial_title: "Love is patient", scripture_id: REF(1) },
    { topic_id: LOVE_T, role: "core", display_order: 2, editorial_status: null, editorial_title: null, scripture_id: REF(2) },
    { topic_id: LOVE_T, role: "supporting", display_order: 3, editorial_status: "published", editorial_title: null, scripture_id: REF(3) },
    { topic_id: LOVE_T, role: "supporting", display_order: 4, editorial_status: "needs_review", editorial_title: null, scripture_id: REF(4) },
  ],
  p2p_scripture_references: [
    { id: REF(1), book: "1 Corinthians", chapter: 13, start_verse: 4, end_verse: 7 }, { id: REF(2), book: "John", chapter: 3, start_verse: 16, end_verse: 16 },
    { id: REF(3), book: "Romans", chapter: 8, start_verse: 38, end_verse: 39 }, { id: REF(4), book: "1 John", chapter: 4, start_verse: 7, end_verse: 12 },
  ],
  p2p_kingdom_stories: [
    { id: RUTH, title: "Ruth: Loyalty and Redemption", subtitle: null, status: "published" }, { id: LOVESTORY, title: "A Love Story", subtitle: null, status: "published" },
    { id: DRAFTSTORY, title: "John's love (draft)", subtitle: null, status: "review" }, { id: NICO, title: "Nicodemus at Night", subtitle: null, status: "published" },
    { id: DAVIDSTORY, title: "David: A Heart After God", subtitle: null, status: "published" },
    { id: CITES, title: "Abraham and Isaac", subtitle: null, status: "published" },
  ],
  p2p_kingdom_story_chapters: [
    { id: U(210), story_id: RUTH, chapter_number: 1, title: "Where you go", scripture_refs: "Ruth 1:1–22; Psalm 68:5–6" },
    { id: U(211), story_id: RUTH, chapter_number: 2, title: "The field", scripture_refs: "Ruth 2" },
    { id: U(212), story_id: LOVESTORY, chapter_number: 1, title: "Jacob and Rachel", scripture_refs: "Genesis 29:1–30" },
    { id: U(213), story_id: DRAFTSTORY, chapter_number: 1, title: "x", scripture_refs: "John 3:16" },
    { id: U(214), story_id: NICO, chapter_number: 1, title: "Born again", scripture_refs: "John 3:1–21; Romans 8:38" },
    { id: U(215), story_id: DAVIDSTORY, chapter_number: 1, title: "Goliath", scripture_refs: "1 Samuel 17; Psalm 18:1–3" },
    { id: U(216), story_id: CITES, chapter_number: 1, title: "The mountain", scripture_refs: "Genesis 22:1–19; John 3:16" },
  ],
  p2p_lesson_blocks: [
    { lesson_id: L1, block_type: "memory_verse", content: { reference: "1 Corinthians 13:4" } }, { lesson_id: L2, block_type: "memory_verse", content: { reference: "Ruth 1:16" } },
    { lesson_id: L3, block_type: "memory_verse", content: { reference: "John 3:16" } },
  ],
  p2p_lessons: [{ id: L1, title: "Love that serves", status: "published", module_id: M1, order_index: 1 }, { id: L2, title: "Loyal love", status: "published", module_id: M2, order_index: 1 },
    { id: L3, title: "Unpublished lesson", status: "draft", module_id: M1, order_index: 2 }],
  p2p_modules: [{ id: M1, curriculum_id: CORE, title: "Week 1", order_index: 1 }, { id: M2, curriculum_id: KS, title: "Part 1", order_index: 1 }],
  p2p_curriculums: [{ id: CORE, title: "The Gospel & Salvation", type: "core", status: "published" }, { id: KS, title: "Family & Relationships", type: "plan", status: "published", is_visible: true }],
  p2p_study_subjects: [
    { id: DAVID, slug: "david", kind: "person", name: "David", summary: "Shepherd and king", passages: [{ book: "1SA", chapter: 16 }, { book: "1SA", chapter: 17 }], editorial_status: "published" },
    { id: GOLIATH, slug: "goliath", kind: "person", name: "Goliath", summary: null, passages: [{ book: "1SA", chapter: 17 }], editorial_status: "draft" },
  ],
  p2p_subject_resource_links: [
    { id: U(410), subject_type: "subject", subject_key: DAVID, resource: { kind: "kingdom_story", id: DAVIDSTORY }, relation: "direct", reason: "Tells David's story", editorial_status: "approved", created_by: ED1 },
    { id: U(411), subject_type: "subject", subject_key: DAVID, resource: { kind: "kingdom_story", id: NICO }, relation: "direct", reason: "Wrong link awaiting review", editorial_status: "needs_review", created_by: ED1 },
    { id: U(412), subject_type: "bible_topic", subject_key: "love", resource: { kind: "lesson", id: L2 }, relation: "direct", reason: "Teaches loyal love", editorial_status: "needs_review", created_by: ED1 },
  ],
  p2p_study_plans: [{ id: PUBPLAN, slug: null, title: "Love in 1 John", description: null, focus_type: "bible_topic", focus_ref: { topicSlug: "love" }, focus_label: "Love", plan_kind: "scripture", collection: "topical",
    derived_from: null, language: "en", origin: "p2p", owner_id: null, editorial_status: "published", objectives: [], suggested_pace: "daily", suggested_days: 30, together_suitable: true, version: 1, is_draft: false }],
  p2p_study_plan_sessions: [{ id: U(510), plan_id: PUBPLAN, position: 1, title: "1 John 4", intro: null, passages: [{ book: "1JN", chapter: 4 }], primary_resource: null, supporting: [], questions: [], reflection: null, prayer: null }],
  p2p_study_plan_enrollments: [], p2p_study_plan_completions: [], p2p_study_plan_versions: [], p2p_plan_saves: [],
  p2p_shared_studies: [], p2p_shared_study_members: [], p2p_conversations: [], p2p_conversation_members: [], p2p_group_events: [],
  p2p_growth_evidence: [], p2p_lesson_progress: [], p2p_notifications: [],
  p2p_families: [], p2p_family_members: [], p2p_church_members: [], p2p_peer_circles: [], p2p_peer_circle_members: [], p2p_groups: [], p2p_group_members: [],
};
const writes = [];
let seq = 900;
const DEFAULTS = { p2p_shared_studies: { status: "active" }, p2p_study_plans: { version: 1, is_draft: false }, p2p_study_plan_sessions: { retired_at: null } };
function unique(name, v) {
  if (name === "p2p_study_plan_enrollments" && T[name].some((x) => x.user_id === v.user_id && x.plan_id === v.plan_id && ["active", "paused"].includes(x.status))) return true;
  if (name === "p2p_shared_studies" && v.content_type === "study_plan" && v.destination_id && v.status === "active"
    && T[name].some((x) => x.content_type === "study_plan" && x.status === "active" && x.destination_type === v.destination_type && x.destination_id === v.destination_id)) return true;
  if (name === "p2p_study_plans" && v.client_key && T[name].some((x) => x.created_by === v.created_by && x.client_key === v.client_key)) return true;
  if (name === "p2p_study_plan_completions" && T[name].some((x) => x.enrollment_id === v.enrollment_id && x.session_id === v.session_id)) return true;
  return false;
}
const db = {
  from(name) {
    const f = []; let cols = null, ord = null, lim = null, op = null, payload = null, counting = false;
    const match = (r) => f.every((p) => p(r));
    const rows = () => { const r = (T[name] ?? []).filter(match); if (ord) r.sort((a, b) => (a[ord.c] < b[ord.c] ? -1 : a[ord.c] > b[ord.c] ? 1 : 0) * (ord.asc ? 1 : -1)); return lim ? r.slice(0, lim) : r; };
    const pick = (r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r });
    const run = () => {
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]).map((v) => ({ id: v.id ?? U(++seq), created_at: new Date(Date.now() + seq).toISOString(), updated_at: "2026-11-14T10:00:00Z", ...(DEFAULTS[name] ?? {}), ...v }));
        if (list.some((v) => unique(name, v))) return { data: null, error: { code: "23505" } };
        T[name] = T[name] ?? []; T[name].push(...list); writes.push([name, "insert", list]); return { data: list, error: null };
      }
      if (op === "update") { const r = (T[name] ?? []).filter(match); r.forEach((x) => Object.assign(x, payload)); writes.push([name, "update", payload]); return { data: r, error: null }; }
      if (op === "delete") { const before = T[name].length; T[name] = T[name].filter((x) => !match(x)); writes.push([name, "delete", before - T[name].length]); return { data: null, error: null }; }
      const all = rows();
      return { data: all.map(pick), error: null, count: counting ? all.length : null };
    };
    const q = {
      select(c, o) { if (!op) cols = c && c !== "*" ? c.split(",").map((x) => x.trim()) : null; if (o?.count) counting = true; return q; },
      order(c, o) { ord = { c, asc: o?.ascending !== false }; return q; }, limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; }, neq(c, v) { f.push((r) => r[c] !== v); return q; }, in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
      insert(v) { op = "insert"; payload = v; return q; }, update(v) { op = "update"; payload = v; return q; }, delete() { op = "delete"; return q; },
      async single() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      async maybeSingle() { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    return q;
  },
  async rpc(fn, a) {
    if (fn === "p2p_core_curriculum_progress") return { data: [], error: null };
    if (fn === "p2p_create_plan_group") {
      // Mirrors migration 251's function: one group + admin + event + the plan's study, or the earlier result.
      const had = a.p_client_key && T.p2p_shared_studies.find((s) => s.host_id === a.p_owner && s.client_key === a.p_client_key);
      if (had) return { data: [{ group_id: had.destination_id, study_id: had.id, existing: true }], error: null };
      const plan = T.p2p_study_plans.find((p) => p.id === a.p_plan);
      if (!plan) return { data: null, error: { code: "P0002" } };
      const g = { id: U(++seq), type: "group", conversation_type: "private_group", name: a.p_name, description: a.p_description, created_by: a.p_owner, archived_at: null, posting: "everyone" };
      T.p2p_conversations.push(g); T.p2p_conversation_members.push({ conversation_id: g.id, user_id: a.p_owner, role: "admin" });
      T.p2p_group_events.push({ target_type: "group", target_id: g.id, actor_id: a.p_owner, event: "created" });
      const st = { id: U(++seq), content_type: "study_plan", content_id: plan.id, title: plan.title, host_id: a.p_owner, destination_type: "private_group", destination_id: g.id, status: "active", plan_schedule: a.p_schedule, client_key: a.p_client_key, created_at: new Date(Date.now() + seq).toISOString(), concluded_at: null };
      T.p2p_shared_studies.push(st); T.p2p_shared_study_members.push({ study_id: st.id, user_id: a.p_owner, role: "host", status: "accepted" });
      writes.push(["rpc", fn, a]);
      return { data: [{ group_id: g.id, study_id: st.id, existing: false }], error: null };
    }
    return { data: null, error: null };
  },
};
globalThis.__pdgDb = db;
const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__pdgDb; export const supabaseRead = globalThis.__pdgDb; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  studyPartnerAuth: "export const getEligibleStudyPartners = async () => new Map();",
  minors: "export const childUserIds = async () => new Set();",
  groupLearning: "export const canManageGroupLearning = async () => false; export const isGroupMember = async () => false;",
  pushDispatch: "export const dispatchNotificationNow = async () => {};",
  referenceArticles: `const A = [{ id: 'love', title: 'Love' }, { id: 'david', title: 'David' }];
    export const getArticles = () => ({ byId: new Map(A.map((a) => [a.id, a])) });
    export const articlesForTitle = (_a, t) => A.filter((a) => a.title.toLowerCase() === String(t).toLowerCase());`,
};
const mockPlugin = { name: "mocks", setup(b) {
  for (const m of Object.keys(mocks)) {
    b.onResolve({ filter: new RegExp(`(^|/)${m}$`) }, () => ({ path: m, namespace: "mock" }));
    b.onLoad({ filter: new RegExp(`^${m}$`), namespace: "mock" }, () => ({ loader: "js", contents: mocks[m] }));
  }
} };

try {
  // ── Pure rules: references ──
  const lib = await build({ entryPoints: [path.join(root, "src/lib/planDiscovery.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const lf = path.join(tmpDir, "lib.mjs"); writeFileSync(lf, lib.outputFiles[0].text);
  const D = await import(pathToFileURL(lf).href);
  const p1 = D.parseRefList("Genesis 11:27–12:9; Hebrews 11:8–10");
  ok("refs: a range across chapters, then another book", p1.spans.length === 2 && p1.spans[0].c1 === 11 && p1.spans[0].v1 === 27 && p1.spans[0].c2 === 12 && p1.spans[0].v2 === 9 && p1.spans[1].book === "HEB");
  const p2 = D.parseRefList("Genesis 16; 21:8–21");
  ok("refs: a part without a book continues the book", p2.spans.length === 2 && p2.spans[1].book === "GEN" && p2.spans[1].c1 === 21 && p2.spans[1].v1 === 8);
  const p3 = D.parseRefList("Romans 4:1–5, 18–22");
  ok("refs: '18–22' after a verse reference = verses of the same chapter", p3.spans[1].c1 === 4 && p3.spans[1].v1 === 18 && p3.spans[1].v2 === 22);
  const p4 = D.parseRefList("Isaiah 10–12; Psalm 34; Song of Songs 8:6");
  ok("refs: chapter ranges, 'Psalm', 'Song of Songs'", p4.spans[0].c1 === 10 && p4.spans[0].c2 === 12 && p4.spans[1].book === "PSA" && p4.spans[2].book === "SNG" && !p4.unread.length);
  const p5 = D.parseRefList("1 Samuel 24 and 26; Genesis 23–25:11");
  ok("refs: 'and' separates references; '23–25:11' runs from chapter 23 to 25:11", p5.spans.length === 3 && p5.spans[1].c1 === 26 && p5.spans[2].c1 === 23 && p5.spans[2].v1 === 1 && p5.spans[2].c2 === 25 && p5.spans[2].v2 === 11 && !p5.unread.length);
  ok("refs: unreadable parts are reported, never guessed", D.parseRefList("Hezekiah 3:1; Genesis 99").unread.length === 2);
  ok("refs: overlap is exact", D.overlaps(D.parseRefList("John 3:16").spans[0], D.parseRefList("John 3:1-21").spans[0]) && !D.overlaps(D.parseRefList("John 3:22").spans[0], D.parseRefList("John 3:1-21").spans[0]));
  ok("refs: a cross-chapter span becomes single-chapter passages", JSON.stringify(D.spanPassages(p1.spans[0], () => 32)) === JSON.stringify([{ book: "GEN", chapter: 11, startVerse: 27, endVerse: 32 }, { book: "GEN", chapter: 12, startVerse: 1, endVerse: 9 }]));

  // ── Routes ──
  const bundle = async (entry, name) => { const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
    const f = path.join(tmpDir, name); writeFileSync(f, out.outputFiles[0].text); return (await import(pathToFileURL(f).href)).default; };
  const app = express(); app.use(express.json());
  app.use("/plan-discovery", await bundle("src/routes/planDiscovery.ts", "pd.mjs"));
  app.use("/study-plans", await bundle("src/routes/studyPlans.ts", "sp.mjs"));
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, u = OWNER, body) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(u ? { "x-test-user": u } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };

  // B. SUBJECT DISCOVERY
  ok("signed out → 401", (await call("GET", "/plan-discovery/types", null)).status === 401);
  const types = Object.fromEntries((await call("GET", "/plan-discovery/types")).body.types.map((t) => [t.type, t.count]));
  ok("types: all 66 books, published topics, published people only; empty types report 0 (the app hides them)", types.bible_book === 66 && types.bible_topic === 1 && types.biblical_person === 1 && types.biblical_event === 0 && types.kingdom_school === 1 && types.core_foundations === 1, JSON.stringify(types));
  const books = (await call("GET", "/plan-discovery/subjects?type=bible_book&q=")).body;
  ok("subjects: every book in the canon is listed (paged, searchable)", books.total === 66 && (await call("GET", "/plan-discovery/subjects?type=bible_book&q=john")).body.items.map((i) => i.key).join() === "JHN,1JN,2JN,3JN");
  ok("subjects: people from published records only (David, not the draft Goliath)", (await call("GET", "/plan-discovery/subjects?type=biblical_person")).body.items.map((i) => i.label).join() === "David");
  const love = (await call("GET", "/plan-discovery/bible_topic/love")).body;
  const items = love.sections.flatMap((s) => s.items);
  const find = (k) => items.find((i) => i.key === k);
  ok("Love: the topic's core passages are DIRECT", find("bible_passage:1 Corinthians 13:4-7")?.relevance === "direct" && find("bible_passage:John 3:16")?.relevance === "direct");
  ok("Love: a supporting passage is SUPPORTING; a passage still under review is not shown", find("bible_passage:Romans 8:38-39")?.relevance === "supporting" && !find("bible_passage:1 John 4:7-12"));
  ok("Love: a story whose Scripture overlaps is SUPPORTING, with the overlap as its reason", find(`kingdom_story:${NICO}`)?.relevance === "supporting" && find(`kingdom_story:${NICO}`).reason.code === "storyOverlap" && find(`kingdom_story:${NICO}`).reason.params.passage.includes("John 3"));
  ok("Love: 'A Love Story' (keyword only, no shared Scripture) is NOT recommended", !find(`kingdom_story:${LOVESTORY}`));
  ok("Love: a story that only QUOTES a topic verse is further exploration, not supporting", find(`kingdom_story:${CITES}`)?.relevance === "further" && find(`kingdom_story:${CITES}`).reason.code === "storyCites");
  ok("Love: unpublished story and lesson are not exposed", !find(`kingdom_story:${DRAFTSTORY}`) && !find(`lesson:${L3}`));
  ok("Love: a Core Foundations lesson with a memory verse in the passage is SUPPORTING, in its own section", find(`lesson:${L1}`)?.relevance === "supporting" && find(`lesson:${L1}`).section === "core_foundations");
  ok("Love: a published plan with this focus is DIRECT", find(`plan:${PUBPLAN}`)?.relevance === "direct");
  ok("Love: commentaries, Deep Study and the dictionary are FURTHER EXPLORATION", find("commentary:1 Corinthians 13")?.relevance === "further" && find("deep_study:John 3")?.relevance === "further" && find("reference_article:love")?.relevance === "further");
  ok("Love: an editor's proposed link isn't used before it is approved", !find(`lesson:${L2}`));
  ok("Love: every item says why", items.every((i) => i.reason?.code));
  const david = (await call("GET", `/plan-discovery/biblical_person/${DAVID}`)).body;
  const dItems = david.sections.flatMap((s) => s.items);
  ok("David: his passages and his approved story are DIRECT", dItems.find((i) => i.key === "bible_passage:1 Samuel 16")?.relevance === "direct" && dItems.find((i) => i.key === `kingdom_story:${DAVIDSTORY}`)?.relevance === "direct");
  ok("David: an unapproved link and unrelated stories are not shown", !dItems.some((i) => i.key === `kingdom_story:${NICO}`) && !dItems.some((i) => i.key === `kingdom_story:${RUTH}`));
  ok("an unpublished subject and an unknown key are unavailable", (await call("GET", `/plan-discovery/biblical_person/${GOLIATH}`)).status === 404 && (await call("GET", "/plan-discovery/bible_topic/nope")).status === 404);
  const ruth = (await call("GET", "/plan-discovery/bible_book/RUT")).body.sections.flatMap((s) => s.items);
  ok("Ruth (book): the Ruth story's narrative is DIRECT; Love topic not (no Ruth passages)", ruth.find((i) => i.key === `kingdom_story:${RUTH}`)?.relevance === "direct" && !ruth.some((i) => i.key === "scripture_topic:love"));
  ok("Ruth (book): a Kingdom School lesson with a memory verse in Ruth is SUPPORTING", ruth.find((i) => i.key === `lesson:${L2}`)?.relevance === "supporting" && ruth.find((i) => i.key === `lesson:${L2}`).section === "kingdom_school");
  const ks = (await call("GET", `/plan-discovery/kingdom_school/${KS}`)).body.sections.flatMap((s) => s.items);
  ok("Kingdom School subject: the course and its own lessons are DIRECT", ks.find((i) => i.key === `curriculum:${KS}`)?.relevance === "direct" && ks.find((i) => i.key === `lesson:${L2}`)?.relevance === "direct");

  // Newly approved relationships become discoverable without code changes (four eyes).
  ok("an editor can't approve their own proposed link", (await call("POST", `/plan-discovery/editor/links/${U(412)}`, ED1, { decision: "approve" })).status === 409);
  ok("participants can't review links", (await call("POST", `/plan-discovery/editor/links/${U(412)}`, BEN, { decision: "approve" })).status === 403);
  ok("a second editor approves it", (await call("POST", `/plan-discovery/editor/links/${U(412)}`, ED2, { decision: "approve" })).status === 200);
  const love2 = (await call("GET", "/plan-discovery/bible_topic/love")).body.sections.flatMap((s) => s.items);
  ok("…and it is discovered at once as DIRECT, with the editor's reason", love2.find((i) => i.key === `lesson:${L2}`)?.relevance === "direct" && love2.find((i) => i.key === `lesson:${L2}`).reason.params.text === "Teaches loyal love");
  ok("subjects: four eyes on publishing too", (await call("POST", `/plan-discovery/editor/subjects/${GOLIATH}/status`, ED1, { to: "under_review" })).status === 200
    && (await call("POST", `/plan-discovery/editor/subjects/${GOLIATH}/status`, ED1, { to: "approved" })).status === 409);

  // C. RECOMMENDED JOURNEY
  const j = (await call("POST", "/plan-discovery/journey", OWNER, { type: "bible_topic", key: "love" })).body.journey;
  ok("journey: one session per DIRECT passage, then direct lessons — nothing invented", j.sessions.length === 3 && j.sessions[0].passages[0].book === "1CO" && j.sessions[1].passages[0].book === "JHN" && j.sessions[2].primaryResource?.id === L2, JSON.stringify(j.sessions.map((s) => s.title)));
  ok("journey: supporting items sit beside the passage they share", j.sessions[1].supporting.some((r) => r.kind === "kingdom_story" && r.id === NICO && r.chapterId === U(214)) && j.sessions[0].supporting.some((r) => r.kind === "lesson" && r.id === L1));
  ok("journey: passage sessions ask the app for its (localised) study questions; nothing stored yet", j.sessions[0].templateQuestions === true && !("questions" in j.sessions[0]));
  const jr = (await call("POST", "/plan-discovery/journey", OWNER, { type: "bible_book", key: "RUT" })).body.journey;
  ok("journey (book): a session per chapter, the story chapter beside its chapter", jr.sessions.length === 4 && jr.sessions[0].supporting.some((r) => r.id === RUTH && r.chapterId === U(210)));
  ok("journey (Core Foundations): follows the real curriculum (no copied sessions)", JSON.stringify((await call("POST", "/plan-discovery/journey", OWNER, { type: "core_foundations", key: "foundations" })).body.journey.derivedFrom) === '{"type":"foundations"}');
  ok("exploring creates nothing", !writes.some(([t, op]) => t === "p2p_study_plans" && op === "insert"));

  // E. BUILDER: drafts and retries
  const sessionsLove = [{ title: "1 Corinthians 13:4-7", passages: [{ book: "1CO", chapter: 13, startVerse: 4, endVerse: 7 }], questions: [{ kind: "observe", text: "What does love do?" }] },
    { title: "John 3:16", passages: [{ book: "JHN", chapter: 3, startVerse: 16, endVerse: 16 }] }, { title: "1 John 4", passages: [{ book: "1JN", chapter: 4 }] }];
  let r = await call("POST", "/study-plans", OWNER, { title: "Love (draft)", focusType: "bible_topic", focusLabel: "Love", draft: true, sessions: [] });
  ok("a draft can be saved before it has sessions", r.status === 201 && T.p2p_study_plans.find((p) => p.id === r.body.id).is_draft === true);
  const draftId = r.body.id;
  ok("a draft can't be started", (await call("POST", `/study-plans/${draftId}/start`, OWNER, { durationKey: "monthly", pace: "daily" })).status === 409);
  ok("drafts are listed separately in My Plans", (await call("GET", "/study-plans/mine")).body.drafts.some((p) => p.id === draftId));
  r = await call("PUT", `/study-plans/${draftId}`, OWNER, { title: "Love in 30 days", focusType: "bible_topic", focusLabel: "Love", focusRef: { topicSlug: "love" }, draft: false, sessions: sessionsLove });
  ok("finishing the draft makes it a plan", r.status === 200 && T.p2p_study_plans.find((p) => p.id === draftId).is_draft === false);
  const LOVEPLAN = draftId;
  const c1 = await call("POST", "/study-plans", OWNER, { title: "Hope", focusType: "theme", clientKey: "hope-key-0001", sessions: [{ title: "Romans 5", passages: [{ book: "ROM", chapter: 5 }] }] });
  const c2 = await call("POST", "/study-plans", OWNER, { title: "Hope", focusType: "theme", clientKey: "hope-key-0001", sessions: [{ title: "Romans 5", passages: [{ book: "ROM", chapter: 5 }] }] });
  ok("the same create sent twice makes ONE plan", c1.status === 201 && c2.body.id === c1.body.id && c2.body.existing === true && T.p2p_study_plans.filter((p) => p.title === "Hope").length === 1);
  const HOPE = c1.body.id;
  ok("Core Foundations as the participant's own plan follows the real curriculum (no copied lessons)", (await call("POST", "/study-plans", OWNER, { title: "Foundations in a year", focusType: "core_foundations", derivedFrom: { type: "foundations" } })).status === 201
    && (await call("POST", "/study-plans", OWNER, { title: "x", focusType: "core_foundations", derivedFrom: { type: "foundations" }, sessions: sessionsLove })).status === 400);

  // H. THE GROUP CONTINUES AFTER ITS PLAN (brief §22 H, exactly)
  const sched = { durationKey: "monthly", pace: "daily" };
  r = await call("POST", `/study-plans/${LOVEPLAN}/groups`, OWNER, { name: "Growing Together", description: "We study together", schedule: sched, clientKey: "grp-key-0001" });
  ok("1. create a group from the plan (prefilled from it, private group)", r.status === 201 && r.body.groupType === "private_group");
  const GID = r.body.groupId, STUDY1 = r.body.studyId;
  const again = await call("POST", `/study-plans/${LOVEPLAN}/groups`, OWNER, { name: "Growing Together", schedule: sched, clientKey: "grp-key-0001" });
  ok("   a repeated tap returns the same group (no duplicate group)", again.status === 200 && again.body.groupId === GID && T.p2p_conversations.length === 1);
  ok("   someone else can't make a group from a private plan", (await call("POST", `/study-plans/${LOVEPLAN}/groups`, BEN, { name: "Mine" })).status === 404);
  ok("2. the ACTUAL plan is attached (no copy)", T.p2p_shared_studies.find((s) => s.id === STUDY1).content_id === LOVEPLAN && T.p2p_study_plans.filter((p) => p.title.startsWith("Love in 30")).length === 1);
  for (const u of [BEN, CAT, DAN]) T.p2p_conversation_members.push({ conversation_id: GID, user_id: u, role: "member" });
  ok("3. an outsider can't see the group or its plans", (await call("GET", `/study-plans/groups/private_group/${GID}`, OUT)).status === 404);
  const runIds = {};
  for (const u of [OWNER, BEN, CAT, DAN]) {
    const s = await call("POST", `/study-plans/${LOVEPLAN}/start`, u, { mode: "together", sharedStudyId: STUDY1 });
    runIds[u] = s.body?.run?.id;
  }
  ok("   members follow it with the group's schedule by default", Object.values(runIds).every(Boolean) && T.p2p_study_plan_enrollments.filter((e) => e.shared_study_id === STUDY1).every((e) => e.duration_key === "monthly" && e.pace === "daily"));
  ok("   an outsider can't join the group's run", (await call("POST", `/study-plans/${LOVEPLAN}/start`, OUT, { mode: "together", sharedStudyId: STUDY1, durationKey: "monthly", pace: "daily" })).status >= 403);
  const loveSessions = T.p2p_study_plan_sessions.filter((s) => s.plan_id === LOVEPLAN && !s.retired_at).sort((a, b) => a.position - b.position);
  for (const s of loveSessions) await call("POST", `/study-plans/runs/${runIds[OWNER]}/sessions/${s.id}`, OWNER);
  for (const s of loveSessions.slice(0, 2)) await call("POST", `/study-plans/runs/${runIds[BEN]}/sessions/${s.id}`, BEN);
  await call("POST", `/study-plans/runs/${runIds[CAT]}/sessions/${loveSessions[0].id}`, CAT);
  await call("POST", `/study-plans/runs/${runIds[BEN]}/sessions/${loveSessions[0].id}`, BEN); // a retry
  ok("4. different progress per member; a repeated completion is recorded once", T.p2p_study_plan_completions.filter((c) => c.enrollment_id === runIds[BEN]).length === 2
    && T.p2p_study_plan_completions.filter((c) => c.enrollment_id === runIds[CAT]).length === 1 && T.p2p_study_plan_completions.filter((c) => c.enrollment_id === runIds[DAN]).length === 0);
  ok("   one member finishing never completes anyone else", T.p2p_study_plan_enrollments.find((e) => e.id === runIds[OWNER]).status === "completed" && T.p2p_study_plan_enrollments.find((e) => e.id === runIds[BEN]).status === "active");
  let g = (await call("GET", `/study-plans/groups/private_group/${GID}`, BEN)).body;
  ok("   the group shows counts only; each person sees their own progress", g.active.overview.following === 4 && g.active.overview.finished === 1 && g.active.mine.completed === 2
    && !JSON.stringify(g).includes(CAT) && !JSON.stringify(g).includes(DAN));
  ok("5. only a leader completes the group's plan", (await call("POST", `/study-plans/groups/private_group/${GID}/plans/${STUDY1}/complete`, BEN)).status === 403
    && (await call("POST", `/study-plans/groups/private_group/${GID}/plans/${STUDY1}/complete`, OWNER)).status === 200);
  g = (await call("GET", `/study-plans/groups/private_group/${GID}`, BEN)).body;
  ok("6. the plan moves into Completed Plans", g.active === null && g.history.length === 1 && g.history[0].status === "concluded" && g.history[0].plan.id === LOVEPLAN);
  ok("7. the group remains active", !T.p2p_conversations.find((c) => c.id === GID).archived_at && T.p2p_conversation_members.filter((m) => m.conversation_id === GID).length === 4);
  ok("   nothing starts by itself after completion", T.p2p_shared_studies.filter((s) => s.destination_id === GID && s.status === "active").length === 0);
  const progressBefore = JSON.stringify(T.p2p_study_plan_completions.filter((c) => c.plan_id === LOVEPLAN).map((c) => [c.enrollment_id, c.session_id]).sort());
  ok("8. members can't choose the next plan (permissions)", (await call("POST", `/study-plans/groups/private_group/${GID}/plans`, BEN, { planId: HOPE })).status === 403);
  r = await call("POST", `/study-plans/groups/private_group/${GID}/plans`, OWNER, { planId: HOPE, schedule: { durationKey: "weekly", pace: "daily" }, clientKey: "attach-hope-1" });
  ok("9. a leader attaches and starts another plan", r.status === 201);
  const STUDY2 = r.body.studyId;
  ok("   a retried attach returns the same study", (await call("POST", `/study-plans/groups/private_group/${GID}/plans`, OWNER, { planId: HOPE, clientKey: "attach-hope-1" })).body.studyId === STUDY2);
  ok("   one active plan at a time", (await call("POST", `/study-plans/groups/private_group/${GID}/plans`, OWNER, { planId: PUBPLAN })).status === 409);
  g = (await call("GET", `/study-plans/groups/private_group/${GID}`, BEN)).body;
  ok("10. the previous plan stays available in history", g.active.plan.id === HOPE && g.history.length === 1 && g.history[0].plan.id === LOVEPLAN && g.history[0].mine.completed === 2);
  ok("    members can revisit the completed plan", (await call("GET", `/study-plans/${LOVEPLAN}`, CAT)).status === 200);
  ok("11. previous individual progress is unchanged", JSON.stringify(T.p2p_study_plan_completions.filter((c) => c.plan_id === LOVEPLAN).map((c) => [c.enrollment_id, c.session_id]).sort()) === progressBefore);
  const benHope = await call("POST", `/study-plans/${HOPE}/start`, BEN, { mode: "together", sharedStudyId: STUDY2 });
  const benHopeDetail = (await call("GET", `/study-plans/${HOPE}`, BEN)).body;
  ok("12. the new plan starts with its own individual progress", benHope.status === 201 && benHopeDetail.me.progress.completed === 0 && benHope.body.run.durationKey === "weekly");
  T.p2p_conversation_members.push({ conversation_id: GID, user_id: LATE, role: "member" });
  g = (await call("GET", `/study-plans/groups/private_group/${GID}`, LATE)).body;
  ok("13. a member joining later is not marked as having completed earlier plans", g.history[0].mine === null && g.active.mine === null && !T.p2p_study_plan_enrollments.some((e) => e.user_id === LATE));
  ok("    …and sees the current plan, and can join it", (await call("POST", `/study-plans/${HOPE}/start`, LATE, { mode: "together", sharedStudyId: STUDY2 })).status === 201);

  // Versions: an edit never changes anyone's history.
  const benRun = T.p2p_study_plan_enrollments.find((e) => e.id === runIds[BEN]);
  ok("a run records what was required when the person started", Array.isArray(benRun.required_session_ids) && benRun.required_session_ids.length === 3 && benRun.plan_version === 1);
  const kept = loveSessions.slice(0, 2).map((s) => ({ id: s.id, title: s.title, passages: s.passages, questions: s.questions ?? [] }));
  r = await call("PUT", `/study-plans/${LOVEPLAN}`, OWNER, { title: "Love in 30 days", focusType: "bible_topic", focusLabel: "Love", sessions: [...kept, { title: "John 15", passages: [{ book: "JHN", chapter: 15 }] }] });
  ok("editing: a removed session is retired (not deleted); the version goes up and is recorded", r.status === 200 && r.body.version === 2 && T.p2p_study_plan_sessions.find((s) => s.id === loveSessions[2].id)?.retired_at
    && T.p2p_study_plan_versions.some((v) => v.plan_id === LOVEPLAN && v.version === 2 && v.changes.retired.includes(loveSessions[2].id)));
  const ownerView = (await call("GET", `/study-plans/${LOVEPLAN}`, OWNER)).body;
  ok("…the owner's finished run keeps its 3 sessions and stays completed", ownerView.me.progress.completed === 3 && ownerView.me.progress.total === 3 && ownerView.sessions.some((s) => s.retired) && ownerView.sessions.some((s) => s.addedLater));
  const benView = (await call("GET", `/study-plans/${LOVEPLAN}`, BEN)).body;
  ok("…Ben's run still counts 2 of 3; the new session is optional for him", benView.me.progress.completed === 2 && benView.me.progress.total === 3);
  ok("…the plan itself now shows the new list to newcomers", (await call("GET", `/study-plans/${LOVEPLAN}`, DAN)).body.plan.sessionCount === 3);

  // F + I. Questions stay optional; privacy; no Growth Matrix writes
  ok("hiding questions changes nothing but the display", (await call("PATCH", `/study-plans/runs/${runIds[CAT]}`, CAT, { showQuestions: false })).status === 200 && T.p2p_study_plan_completions.filter((c) => c.enrollment_id === runIds[CAT]).length === 1);
  ok("someone else's run is never visible or changeable", (await call("POST", `/study-plans/runs/${runIds[BEN]}/sessions/${loveSessions[0].id}`, CAT)).status === 404);
  ok("groups I lead: only those, with their active plan", (await call("GET", "/study-plans/groups/mine", OWNER)).body.groups.some((x) => x.id === GID && x.activePlan?.planId === HOPE)
    && !(await call("GET", "/study-plans/groups/mine", BEN)).body.groups.some((x) => x.id === GID));
  ok("NO Growth Matrix evidence is written by plans, groups or discovery", !writes.some(([t]) => /growth/.test(t)) && T.p2p_growth_evidence.length === 0);
  server.close();
} catch (e) { fail++; console.log("FAIL crashed", e); }
rmSync(tmpDir, { recursive: true, force: true });
console.log(`plansDiscoveryGroups (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
