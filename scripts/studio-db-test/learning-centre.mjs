// Learning Centre (Universal Learning System, step 1): the REAL
// /api/learning/centre route (routes/learningCentre.ts) over the real family /
// church custom-study migrations + 201 (group Comprehensive Checks), and the
// core peer-review tables (p2p_submissions, p2p_lesson_evaluations, story
// chapters) shaped as production has them. Synthetic users and content only.
// Proves: one view across core, story and family work; only each question's
// latest answer counts (031 rule); sent-back work is "to do"; reviewers get
// counts, never answers; nobody sees anyone else's work; leaving a group hides
// it; drafts never show; nothing is written anywhere.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/learning-centre.mjs
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000011${String(n).padStart(2, "0")}`;
const U = { shep: id(1), ann: id(2), ben: id(3), outsider: id(4), pastor: id(5) };
const FA = "aaaaaaaa-2222-4111-8111-000000000001", FB = "aaaaaaaa-2222-4111-8111-000000000002", CH = "bbbbbbbb-2222-4111-8111-000000000001";
const L1 = "dddddddd-0000-4000-8000-000000000001", L2 = "dddddddd-0000-4000-8000-000000000002", L3 = "dddddddd-0000-4000-8000-000000000003";
const Q = (n) => `eeeeeeee-0000-4000-8000-00000000000${n}`;
const STORY = "ffffffff-0000-4000-8000-000000000001", CHAP = "ffffffff-0000-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text);
  create table public.p2p_lessons (id uuid primary key, title text, module_id uuid); create table public.p2p_curriculums (id uuid primary key);
  create table public.p2p_sessions (id uuid primary key); create table public.p2p_discipleship_links (id uuid primary key);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, status text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
  create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
  create table public.p2p_submissions (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, assignment_question_id uuid, reflection_question_id uuid,
    submission_type text default 'text', text_content text, created_at timestamptz default now());
  create table public.p2p_lesson_evaluations (id uuid primary key default gen_random_uuid(), submission_id uuid, lesson_id uuid, submitter_id uuid, evaluator_id uuid,
    status text default 'pending', feedback text, resolved_at timestamptz, created_at timestamptz default now());
  create table public.p2p_kingdom_stories (id uuid primary key, title text);
  create table public.p2p_kingdom_story_chapters (id uuid primary key, story_id uuid, chapter_number int, lesson_id uuid);
`);
for (const f of ["082_journal_reflections.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql",
  "134_custom_studies_church.sql", "135_custom_studies_family.sql", "199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql",
  "201_lesson_reflections_assignments.sql"]) await db.exec(mig(f));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'Name ' || right(x::text, 2) from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'The Okafors',$2), ($3,'Other family',$4)`, [FA, U.shep, FB, U.outsider]);
for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.ann, "adult"], [FA, U.ben, "adult"], [FB, U.outsider, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_churches values ($1,'Grace')`, [CH]);
await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor')`, [CH, U.pastor]);

// Core: L1 a Kingdom School lesson, L2 a Kingdom Stories chapter, L3 finished.
await db.query(`insert into p2p_lessons (id, title) values ($1,'Who is God?'), ($2,'Creation ch 3'), ($3,'Prayer')`, [L1, L2, L3]);
await db.query(`insert into p2p_kingdom_stories values ($1,'Creation')`, [STORY]);
await db.query(`insert into p2p_kingdom_story_chapters values ($1,$2,3,$3)`, [CHAP, STORY, L2]);
const sub = async (lesson, q, at) => (await db.query(`insert into p2p_submissions (user_id, lesson_id, assignment_question_id, text_content, created_at) values ($1,$2,$3,'Ann''s private answer',$4) returning id`, [U.ann, lesson, q, at])).rows[0].id;
const ev = (s, lesson, status, feedback = null, evaluator = U.ben) => db.query(`insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id, status, feedback, resolved_at)
  values ($1,$2,$3,$4,$5,$6, case when $5 = 'pending' then null else now() end)`, [s, lesson, U.ann, evaluator, status, feedback]);
// L1: q1 sent back once, then answered again (pending) — only the latest counts; q2 approved with a word of feedback.
await ev(await sub(L1, Q(1), "2026-10-01T10:00:00Z"), L1, "needs_revision", "Old note");
await ev(await sub(L1, Q(1), "2026-10-02T10:00:00Z"), L1, "pending");
await ev(await sub(L1, Q(2), "2026-10-02T11:00:00Z"), L1, "approved", "Good use of Psalm 19.");
// L2 (story chapter): sent back.
await ev(await sub(L2, Q(3), "2026-10-03T10:00:00Z"), L2, "needs_revision", "Add a verse that shows this.");
// L3: approved, no feedback.
await ev(await sub(L3, Q(4), "2026-10-03T12:00:00Z"), L3, "approved");

// Family: a lesson with a published check (due), a published check Ann answers, and a draft.
const [study] = (await db.query(`insert into p2p_family_studies (family_id, created_by, title, status) values ($1,$2,'Psalms','published') returning id`, [FA, U.shep])).rows;
const [fl] = (await db.query(`insert into p2p_family_study_lessons (study_id, title, questions, status, published_at) values ($1,'Psalm 23','[]','published',now()) returning id`, [study.id])).rows;
const asg = async (title, status, due = null) => (await db.query(`insert into p2p_group_assignments (family_lesson_id, family_id, title, status, due_at, created_by) values ($1,$2,$3,$4,$5,$6) returning id`, [fl.id, FA, title, status, due, U.shep])).rows[0].id;
const A1 = await asg("Write a psalm", "published", "2026-11-10T18:00:00Z");
const A2 = await asg("Memorise verse 1", "published");
await asg("Unfinished idea", "draft");
await db.query(`insert into p2p_group_assignment_submissions (assignment_id, user_id, attempt, content) values ($1,$2,1,'The Lord is my shepherd')`, [A2, U.ann]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "learning-centre-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/learning/centre`;
const get = async (who) => { const r = await fetch(`${base}/overview`, { headers: who ? { authorization: `Bearer ${who}` } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };
const counts = async () => JSON.stringify((await db.query(`select (select count(*) from p2p_submissions) s, (select count(*) from p2p_lesson_evaluations) e,
  (select count(*) from p2p_lesson_progress) p, (select count(*) from p2p_notifications) n, (select count(*) from p2p_group_assignment_submissions) g`)).rows[0]);

try {
  const before = await counts();
  ok("signed out → 401", (await get(null)).status === 401);

  let { status, body: ann } = await get(U.ann);
  ok("Ann's overview loads", status === 200 && Array.isArray(ann.toDo), JSON.stringify(ann));
  const keys = (list) => list.map((x) => x.key).sort().join(",");
  const story = ann.toDo.find((x) => x.key === `core:${L2}`);
  ok("story chapter sent back → to do, opens the chapter", story?.source === "story" && story.state === "revision_requested" && story.context === "Creation · Chapter 3"
    && story.route.pathname === "/kingdom-stories/chapter" && story.route.params.id === STORY && story.route.params.chapter === CHAP, JSON.stringify(story));
  const l1 = ann.awaitingReview.find((x) => x.key === `core:${L1}`);
  ok("only the latest answer counts: L1 waits for review (the old sent-back answer is superseded)", l1?.state === "awaiting_review" && !ann.toDo.some((x) => x.key === `core:${L1}`)
    && l1.route.pathname === "/lesson/[id]" && l1.context === "Who is God?");
  ok("finished lesson with no feedback isn't listed", ![...ann.toDo, ...ann.awaitingReview, ...ann.feedback].some((x) => x.key.includes(L3)));
  const fbL1 = ann.feedback.find((x) => x.key === `core:${L1}`);
  ok("feedback received: the reviewer's words on the latest answers only", fbL1?.feedback === "Good use of Psalm 19." && !JSON.stringify(ann).includes("Old note"));
  ok("family: the open check is to do (with its due date); the draft never shows", ann.toDo.some((x) => x.key === `family:${A1}` && x.state === "not_started" && x.dueAt && x.context === "The Okafors · Psalm 23")
    && !JSON.stringify(ann).includes("Unfinished idea"));
  ok("family: the answered check waits for review", ann.awaitingReview.some((x) => x.key === `family:${A2}` && x.route.params.s === "family"));
  ok("sent-back work comes first in to do", ann.toDo[0].state === "revision_requested");
  ok("Ann reviews nothing", ann.toReview.length === 0);
  ok("no answer text anywhere in the overview", !JSON.stringify(ann).includes("private answer") && !JSON.stringify(ann).includes("my shepherd"));

  const ben = (await get(U.ben)).body;
  ok("Ben (peer reviewer) sees counts of reviews waiting — never Ann's answers", ben.toReview.length === 1 && ben.toReview[0].waiting === 1 && ben.toReview[0].route.pathname === "/evaluations"
    && !JSON.stringify(ben).includes("private answer"));
  ok("Ben sees none of Ann's own work or feedback", ![...ben.awaitingReview, ...ben.feedback].length && !ben.toDo.some((x) => x.key.startsWith("core:")));
  const shep = (await get(U.shep)).body;
  ok("the Shepherd: one answer waiting on 'Memorise verse 1'; isn't asked to do checks they set", shep.toReview.some((x) => x.key === `review:family:${A2}` && x.waiting === 1) && shep.toDo.length === 0);
  const outsider = (await get(U.outsider)).body;
  ok("another family sees nothing of this one", [...outsider.toDo, ...outsider.awaitingReview, ...outsider.feedback, ...outsider.toReview].length === 0);
  ok("a church leader with no checks: empty, not an error", (await get(U.pastor)).body.toDo.length === 0);

  // The Shepherd returns Ann's answer with feedback (as the real route would).
  await db.query(`update p2p_group_assignment_submissions set status = 'returned', feedback = 'Say it from memory next time.', reviewed_by = $1, reviewed_at = now() where assignment_id = $2`, [U.shep, A2]);
  ann = (await get(U.ann)).body;
  ok("returned → back in to do, and its feedback shows", ann.toDo.some((x) => x.key === `family:${A2}` && x.state === "returned")
    && ann.feedback.some((x) => x.key === `fb:family:${A2}` && x.feedback === "Say it from memory next time."));

  await db.query(`update p2p_family_members set status = 'left' where family_id = $1 and user_id = $2`, [FA, U.ann]);
  ann = (await get(U.ann)).body;
  ok("after leaving the family, its checks and feedback are gone; core work stays", !JSON.stringify(ann).includes(A1) && !JSON.stringify(ann).includes(A2) && ann.toDo.some((x) => x.key === `core:${L2}`));

  ok("read-only: no submissions, reviews, progress, notifications or attempts written", (await counts()) === before);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`learning-centre: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
