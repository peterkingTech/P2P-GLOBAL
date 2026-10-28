// Kingdom Stories storybook routes (migration 212) end-to-end on PGlite with
// the REAL migrations 152 + 188 + 210 + 211 + 212, the REAL story/Studio
// routes, and minimal stand-ins for the Core Curriculum learning tables
// (production column names; their peer-review triggers are tested on a
// production copy by the restore test). Synthetic data only.
//   • Draft = editor preview; "Prepare activities" builds the learning rows.
//   • Publishing (through the Studio gate) builds them too.
//   • Readers: chapter 1 open; later chapters locked AND withheld by the server
//     until the previous chapter is submitted or completed; the database also
//     refuses submissions/progress for a locked chapter.
//   • A chapter without a Comprehensive Check is finished by reading it.
//   • Editors see every chapter; image attribution fields validated.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/storybook-routes.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const expectErr = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
await setupBase(db, read("152_kingdom_stories.sql"));
await db.exec(read("188_publishing_studio_foundation.sql"));
await db.exec(read("210_kingdom_story_catalogue.sql"));
await db.exec(read("211_kingdom_story_chapter_assignment_media.sql"));
// Stand-ins for the Core Curriculum tables 212 builds on (production columns).
await db.exec(`
  alter table public.p2p_curriculums add column if not exists type text not null default 'core',
    add column if not exists description text, add column if not exists is_visible boolean default true, add column if not exists admin_notes text;
  create table public.p2p_modules (id uuid primary key default gen_random_uuid(), curriculum_id uuid references public.p2p_curriculums(id),
    title text, description text, order_index int, status text default 'draft', created_at timestamptz default now());
  create table public.p2p_lessons (id uuid primary key default gen_random_uuid(), module_id uuid references public.p2p_modules(id),
    title text, subtitle text, order_index int, status text default 'draft', created_at timestamptz default now());
  create table public.p2p_reflection_questions (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), question text, display_order int);
  create table public.p2p_assignments (id uuid primary key default gen_random_uuid(), lesson_id uuid references public.p2p_lessons(id), title text, instructions text);
  create table public.p2p_assignment_questions (id uuid primary key default gen_random_uuid(), assignment_id uuid references public.p2p_assignments(id) on delete cascade, question text, display_order int);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid references public.p2p_lessons(id),
    completed boolean default false, progress_percent int, updated_at timestamptz default now(), status text not null default 'not_started', unique (user_id, lesson_id));
  create table public.p2p_submissions (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid not null references public.p2p_lessons(id) on delete cascade,
    reflection_question_id uuid references public.p2p_reflection_questions(id) on delete set null, assignment_id uuid references public.p2p_assignments(id) on delete set null,
    assignment_question_id uuid, submission_type text, text_content text, created_at timestamptz default now());
`);
await db.exec(read("212_kingdom_story_learning.sql"));
const q = async (sql, p) => (await db.query(sql, p)).rows;
await q(`insert into auth.users (id) select id from p2p_profiles on conflict do nothing`);

const tmp = mkdtempSync(path.join(os.tmpdir(), "ks-storybook-"));
const { app } = await bundleApp({ apiRoot, tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const five = (p) => [1, 2, 3, 4, 5].map((i) => `${p} ${i}`);
const READER = U.P;

try {
  const cat = (await q(`select id from p2p_kingdom_story_categories where slug = 'biblical-history'`))[0].id;
  const created = await call("POST", "/kingdom-stories", U.A, { title: "Synthetic book", categoryId: cat, body: "Central theme: Synthetic.\n\nPrimary Scripture: John 3:16\n\nIntro." });
  const sid = created.body?.id;
  ok("editor creates a draft", created.status === 200 && !!sid, JSON.stringify(created.body).slice(0, 200));
  const mk = async (n, withCheck) => (await call("POST", `/kingdom-stories/${sid}/chapters`, U.A, {
    title: `Chapter title ${n}`, narrative: `Narrative ${n}. Hebrews 11:31 says so.`, scriptureRefs: "Joshua 2; Joshua 6:22–25",
    lessons: five(`Lesson ${n}`), reflections: five(`Question ${n}`), ...(withCheck ? { assignmentTitle: `Check ${n}`, assignment: `Task ${n}` } : {}) })).body;
  const c1 = await mk(1, true), c2 = await mk(2, true), c3 = await mk(3, false);
  ok("three chapters", !!(c1?.id && c2?.id && c3?.id));
  await call("POST", `/kingdom-stories/${sid}/media`, U.A, { mediaType: "image", mediaPath: `${sid}/pdf/c2.jpg`, caption: "Image: example.org", chapterId: c2.id });

  // Draft: editor preview.
  const prev = await call("GET", `/kingdom-stories/${sid}`, U.A);
  ok("draft: editor sees every chapter as a preview", prev.body?.chapters?.every((c) => c.learning?.state === "preview" && c.narrative.length > 0), JSON.stringify(prev.body?.chapters?.map((c) => c.learning?.state)));
  ok("draft: readers can't open it", (await call("GET", `/kingdom-stories/${sid}`, READER)).status === 404);
  ok("students can't prepare activities", [401, 403].includes((await call("POST", `/kingdom-stories/${sid}/learning/sync`, READER)).status));
  const sync = await call("POST", `/kingdom-stories/${sid}/learning/sync`, U.A);
  ok("Prepare activities: 3 lessons, 15 reflection questions, 2 Comprehensive Checks", sync.status === 200 && sync.body.lessons === 3 && sync.body.reflection_questions === 15 && sync.body.comprehensive_checks === 2, JSON.stringify(sync.body));
  const sys = (await q(`select status, type from p2p_curriculums where type = 'kingdom_story'`));
  ok("system curriculum stays a hidden draft", sys.length === 1 && sys[0].status === "draft");
  const chk1 = (await q(`select a.title, aq.question from p2p_assignments a join p2p_assignment_questions aq on aq.assignment_id = a.id join p2p_kingdom_story_chapters c on c.lesson_id = a.lesson_id where c.id = $1`, [c1.id]))[0];
  ok("Comprehensive Check carries the chapter's title and task", chk1?.title === "Check 1" && chk1?.question === "Task 1");

  // Publish through the Studio gate.
  const approve = async () => {
    const s = await call("POST", `/studio/items/kingdom_story/${sid}/review`, U.A, { to: "in_review", version: (await q(`select version from p2p_studio_items where source_id=$1`, [sid]))[0]?.version ?? 1 });
    return call("POST", `/studio/items/kingdom_story/${sid}/review`, U.B, { to: "approved", version: s.body?.version });
  };
  ok("studio approval", (await approve()).status === 200);
  // Edit after sync, before publish: publishing re-syncs.
  await call("PUT", `/kingdom-stories/${sid}/chapters/${c2.id}`, U.A, { assignment: "Task 2, revised" });
  await q(`update p2p_studio_items set review_state='draft', approved_fingerprint=null where source_id=$1`, [sid]);
  await approve();
  const pub = await call("PUT", `/kingdom-stories/${sid}`, U.A, { status: "published" });
  ok("published", pub.status === 200 && pub.body?.status === "published", JSON.stringify(pub.body).slice(0, 200));
  ok("publishing brought the activities in line (revised task)", (await q(`select aq.question from p2p_assignment_questions aq join p2p_assignments a on a.id = aq.assignment_id join p2p_kingdom_story_chapters c on c.lesson_id = a.lesson_id where c.id = $1`, [c2.id]))[0]?.question === "Task 2, revised");
  ok("a live story can't be re-synced", (await call("POST", `/kingdom-stories/${sid}/learning/sync`, U.A)).status === 409);

  // Reader: chapter 1 open, 2 and 3 locked and withheld.
  const r1 = (await call("GET", `/kingdom-stories/${sid}`, READER)).body;
  const by = (b) => Object.fromEntries(b.chapters.map((c) => [c.chapterNumber, c]));
  let ch = by(r1);
  ok("reader: chapter 1 available with its text and activities", ch[1].learning.state === "available" && ch[1].narrative.includes("Narrative 1") && ch[1].learning.reflectionQuestions.length === 5 && ch[1].learning.check?.questions.length === 1);
  ok("reader: chapter 2 locked — title only, no text, questions or check", ch[2].learning.state === "locked" && ch[2].title === "Chapter title 2" && ch[2].narrative === "" && ch[2].lessons.length === 0 && ch[2].reflections.length === 0 && ch[2].assignment === null && ch[2].learning.check === null && ch[2].learning.reflectionQuestions.length === 0);
  ok("reader: chapter 3 locked", ch[3].learning.state === "locked");
  ok("reader: progress from real states", r1.progress.totalChapters === 3 && r1.progress.completedChapters === 0 && !r1.progress.started && r1.progress.currentChapterId === c1.id, JSON.stringify(r1.progress));
  ok("reader: chapter images still listed for the contents", r1.media.some((m) => m.chapterId === c2.id));

  // Database refuses a locked chapter.
  const l2 = ch[2].lessonId ?? (await q(`select lesson_id from p2p_kingdom_story_chapters where id=$1`, [c2.id]))[0].lesson_id;
  const l1 = ch[1].lessonId;
  ok("database: no submission to a locked chapter", /previous chapter/i.test((await expectErr(q(`insert into p2p_submissions (user_id, lesson_id, submission_type, text_content) values ($1, $2, 'text', 'x')`, [READER, l2]))) ?? ""));
  ok("database: no progress written past a locked chapter", /previous chapter/i.test((await expectErr(q(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1, $2, 'completed', true)`, [READER, l2]))) ?? ""));
  ok("finish refused for a chapter with a Comprehensive Check", (await call("POST", `/kingdom-stories/${sid}/chapters/${c1.id}/finish`, READER)).status === 409);
  ok("finish refused for a locked chapter", (await call("POST", `/kingdom-stories/${sid}/chapters/${c3.id}/finish`, READER)).status === 403);

  // Chapter 1: a reflection, then the Comprehensive Check submitted (awaiting a peer).
  await q(`insert into p2p_submissions (user_id, lesson_id, reflection_question_id, submission_type, text_content) select $1, $2, id, 'text', 'Private reflection' from p2p_reflection_questions where lesson_id = $2 order by display_order limit 1`, [READER, l1]);
  ch = by((await call("GET", `/kingdom-stories/${sid}`, READER)).body);
  ok("after a reflection: chapter 1 in progress, chapter 2 still locked", ch[1].learning.state === "in_progress" && ch[1].learning.reflectionsAnswered === 1 && ch[2].learning.state === "locked");
  await q(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1, $2, 'submitted', false)`, [READER, l1]);
  const r2 = (await call("GET", `/kingdom-stories/${sid}`, READER)).body;
  ch = by(r2);
  ok("check submitted: chapter 1 awaiting peer review, chapter 2 opens (a review never blocks)", ch[1].learning.state === "awaiting_review" && ch[2].learning.state === "available" && ch[2].narrative.includes("Narrative 2") && ch[3].learning.state === "locked");
  ok("progress: 1 awaiting review, current = chapter 2", r2.progress.awaitingReviewChapters === 1 && r2.progress.currentChapterId === c2.id && r2.progress.started);
  await q(`update p2p_lesson_progress set status = 'completed', completed = true where user_id = $1 and lesson_id = $2`, [READER, l1]);
  await q(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1, $2, 'submitted', false)`, [READER, l2]);
  ok("chapter 3 (no check) finished by reading", (await call("POST", `/kingdom-stories/${sid}/chapters/${c3.id}/finish`, READER)).status === 200);
  const r3 = (await call("GET", `/kingdom-stories/${sid}`, READER)).body;
  ok("story finished: 2 completed + 1 awaiting review", r3.progress.finished && r3.progress.completedChapters === 2 && r3.progress.awaitingReviewChapters === 1, JSON.stringify(r3.progress));
  const feed = (await call("GET", "/kingdom-stories/feed?category=biblical-history", READER)).body;
  const card = feed.stories.find((x) => x.id === sid);
  ok("story card progress for this reader", card?.myProgress?.totalChapters === 3 && card?.myProgress?.doneChapters === 3 && card?.myProgress?.started);
  const other = (await call("GET", "/kingdom-stories/feed?category=biblical-history", U.M)).body.stories.find((x) => x.id === sid);
  ok("another person's card shows their own (empty) progress", other?.myProgress?.doneChapters === 0 && !other?.myProgress?.started);
  ok("another reader still starts at chapter 1 (progress is per person)", by((await call("GET", `/kingdom-stories/${sid}`, U.M)).body)[2].learning.state === "locked");
  ok("editors see a locked chapter in full", by((await call("GET", `/kingdom-stories/${sid}`, U.S)).body)[3].narrative.includes("Narrative 3"));

  // Image attribution.
  const mid = (await q(`select id from p2p_kingdom_story_media where story_id = $1 limit 1`, [sid]))[0].id;
  await q(`update p2p_kingdom_stories set status = 'draft' where id = $1`, [sid]).catch(() => {});
  const live = (await q(`select status from p2p_kingdom_stories where id=$1`, [sid]))[0].status === "published";
  if (live) await call("PUT", `/kingdom-stories/${sid}`, U.A, { status: "draft" });
  const putImg = await call("PUT", `/kingdom-stories/${sid}/media/${mid}`, U.A, { altText: "Two scouts on a roof under flax", imageKind: "ai_generated", licenseNote: "Used with permission" });
  ok("image attribution saved", putImg.status === 200 && putImg.body.altText === "Two scouts on a roof under flax" && putImg.body.imageKind === "ai_generated", JSON.stringify(putImg.body).slice(0, 200));
  ok("unknown image kind rejected", (await call("PUT", `/kingdom-stories/${sid}/media/${mid}`, U.A, { imageKind: "photo" })).status === 400);
  ok("students can't change image details", [401, 403].includes((await call("PUT", `/kingdom-stories/${sid}/media/${mid}`, READER, { altText: "x" })).status));
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nstorybook routes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
