// Unified group Learning (Family + Church): the REAL /api/learning routes
// (routes/groupLearning.ts) and the Family "Continue Study" card
// (routes/familyWorship.ts) on the real family migrations + migration 199,
// in PGlite through the lab bundle. Synthetic content and users only.
// Proves: the library is the central published content only; journeys store
// references, pause/resume/switch keep history, one active per group; group
// progress ≠ personal progress (each member's own); only leaders change the
// journey; no cross-group access by guessing ids; members can read their own
// group's rows directly but nobody can write them directly.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/group-learning.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
const U = { shep: id(1), kid: id(2), co: id(3), other: id(4), pastor: id(5), member: id(6) };
const FA = "66666666-6666-4666-8666-000000000001", FB = "66666666-6666-4666-8666-000000000002", CH = "77777777-7777-4777-8777-000000000001";
const C = { core: id(20), plan: id(21), cat: id(22), draft: id(23), hidden: id(24), empty: id(25) };
const M = { m1: id(30), m2: id(31), p1: id(32) };
const L = { a: id(40), b: id(41), c: id(42), unpub: id(43), p1: id(44), p2: id(45) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_curriculums (id uuid primary key, title text, subtitle text, type text, status text, is_visible boolean, parent_category_id uuid, display_order int, cover_image text, thumbnail_url text);
  create table public.p2p_modules (id uuid primary key, curriculum_id uuid references public.p2p_curriculums(id), title text, order_index int);
  create table public.p2p_lessons (id uuid primary key, module_id uuid references public.p2p_modules(id), title text, order_index int, status text);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, completed boolean, status text);
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create table public.p2p_church_studies (id uuid primary key default gen_random_uuid(), church_id uuid, title text, description text, status text, updated_at timestamptz default now());
  create table public.p2p_church_study_lessons (id uuid primary key default gen_random_uuid(), study_id uuid);
  create table public.p2p_church_calls (id uuid primary key default gen_random_uuid(), church_id uuid, status text, lesson_id uuid);
`);
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "117_family_worship_modes_and_history.sql", "118_family_worship_modes_visited.sql", "119_family_worship_media_provider.sql",
  "123_family_worship_media_permissions_queue.sql", "124_family_worship_phase7.sql", "126_family_multi_membership.sql", "135_custom_studies_family.sql"]) await db.exec(mig(f));
// 128/129/137 add columns continue-study reads; add just those here.
await db.exec(`alter table p2p_family_worship_history add column if not exists lesson_id uuid, add column if not exists guide_summary text, add column if not exists continuity_notes text;
  alter table p2p_families add column if not exists study_source text default 'p2p_curriculum', add column if not exists active_study_plan_id uuid;
  create table if not exists p2p_family_worship_session_events (id uuid primary key default gen_random_uuid(), session_id uuid, event_type text, event_data jsonb);`);
await db.exec(mig("199_group_learning_journeys.sql"));
await db.exec(mig("199_group_learning_journeys.sql")); // re-runnable

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'User' from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'The A Family',$2), ($3,'The B Family',$4)`, [FA, U.shep, FB, U.other]);
for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.kid, "teen"], [FA, U.co, "co_shepherd"], [FB, U.other, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_churches values ($1,'Grace')`, [CH]);
await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor'), ($1,$3,'member')`, [CH, U.pastor, U.member]);
// Central library
await db.query(`insert into p2p_curriculums (id,title,type,status,is_visible,parent_category_id,display_order) values
  ($1,'Christian Foundation','core','published',true,null,1), ($2,'Victory Plan','plan','published',null,$3,1), ($3,'Growth','plan_category','published',true,null,1),
  ($4,'Draft Core','core','draft',true,null,2), ($5,'Hidden Plan','plan','published',false,$3,2), ($6,'Empty Core','core','published',true,null,3)`,
  [C.core, C.plan, C.cat, C.draft, C.hidden, C.empty]);
await db.query(`insert into p2p_modules values ($1,$2,'Module 1',1), ($3,$2,'Module 2',2), ($4,$5,'Plan Module',1)`, [M.m1, C.core, M.m2, M.p1, C.plan]);
await db.query(`insert into p2p_lessons values ($1,$2,'Lesson A',1,'published'), ($3,$2,'Lesson B',2,'published'), ($4,$5,'Lesson C',1,'published'), ($6,$2,'Unpublished',3,'draft'),
  ($7,$8,'Plan Lesson 1',1,'published'), ($9,$8,'Plan Lesson 2',2,'published')`, [L.a, M.m1, L.b, L.c, M.m2, L.unpub, L.p1, M.p1, L.p2]);
// Personal progress: the teen completed A; the shepherd submitted B.
await db.query(`insert into p2p_lesson_progress (user_id, lesson_id, completed, status) values ($1,$2,true,'completed'), ($3,$4,false,'submitted')`, [U.kid, L.a, U.shep, L.b]);
// Custom family studies: one published, one draft.
await db.query(`insert into p2p_family_studies (family_id, created_by, title, status) values ($1,$2,'Our Psalms','published'), ($1,$2,'Draft Study','draft')`, [FA, U.shep]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "group-learning-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const home = (who, scope = "family", g = FA) => call("GET", `/learning/${scope}/${g}`, who);

try {
  // ── Library ─────────────────────────────────────────────────────────────
  const lib = await call("GET", "/learning/library", U.kid);
  ok("library: published Core Foundation + P2P Plans by category", lib.status === 200 && lib.body.core.map((c) => c.id).join() === C.core
    && lib.body.categories.length === 1 && lib.body.categories[0].plans.map((p) => p.id).join() === C.plan, JSON.stringify(lib.body));
  ok("library: drafts, hidden and empty curricula never offered; counts published lessons only", !JSON.stringify(lib.body).includes(C.draft) && !JSON.stringify(lib.body).includes(C.hidden)
    && !JSON.stringify(lib.body).includes(C.empty) && lib.body.core[0].lessonCount === 3);
  const outline = await call("GET", `/learning/curricula/${C.core}`, U.kid);
  ok("outline: modules and lessons in order, unpublished lessons excluded", outline.status === 200 && outline.body.modules.map((m) => m.lessons.map((l) => l.title).join("/")).join(" | ") === "Lesson A/Lesson B | Lesson C");
  ok("outline: a draft curriculum is 404", (await call("GET", `/learning/curricula/${C.draft}`, U.kid)).status === 404);

  // ── Home + permissions ──────────────────────────────────────────────────
  let h = await home(U.kid);
  ok("member opens Learning: no journey yet; only published custom lessons", h.status === 200 && h.body.activeJourney === null && h.body.canManage === false
    && h.body.customLessons.map((c) => c.title).join() === "Our Psalms", JSON.stringify(h.body));
  ok("leader also sees draft custom lessons", (await home(U.shep)).body.customLessons.length === 2);
  ok("someone from another family: 403", (await home(U.other)).status === 403);
  ok("a member can't choose the group's journey (403)", (await call("POST", `/learning/family/${FA}/journeys`, U.kid, { curriculumId: C.core })).status === 403);
  ok("can't choose unpublished / unknown content", (await call("POST", `/learning/family/${FA}/journeys`, U.shep, { curriculumId: C.draft })).status === 404
    && (await call("POST", `/learning/family/${FA}/journeys`, U.shep, { curriculumId: "x" })).status === 404);

  let r = await call("POST", `/learning/family/${FA}/journeys`, U.co, { curriculumId: C.core });
  ok("Co-Shepherd starts a journey on central content", r.status === 200 && !!r.body.journeyId);
  const journeyCore = r.body.journeyId;
  h = await home(U.kid);
  ok("journey starts at the first lesson; group 0 of 3", h.body.activeJourney?.currentLesson?.id === L.a && h.body.activeJourney.group.covered === 0 && h.body.activeJourney.group.total === 3);
  ok("personal progress is the viewer's own (teen: 1 completed)", h.body.activeJourney.personal.completed === 1 && h.body.activeJourney.personal.submitted === 0);
  ok("…and different for another member (shepherd: 0 completed, 1 submitted)", (await home(U.shep)).body.activeJourney.personal.completed === 0 && (await home(U.shep)).body.activeJourney.personal.submitted === 1);
  ok("no central content copied (references only)", (await db.query(`select count(*)::int n from p2p_lessons`)).rows[0].n === 6
    && Object.keys((await db.query(`select * from p2p_group_learning_journeys limit 1`)).rows[0]).every((k) => !["title", "content", "body"].includes(k)));

  // Covered together → group progress only.
  const progressBefore = (await db.query(`select count(*)::int n from p2p_lesson_progress`)).rows[0].n;
  r = await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/covered`, U.shep, { lessonId: L.a, advance: true });
  ok("mark covered + advance → next lesson", r.status === 200 && r.body.nextLessonId === L.b);
  h = await home(U.kid);
  ok("group progress 1/3; current lesson B", h.body.activeJourney.group.covered === 1 && h.body.activeJourney.currentLesson.id === L.b);
  ok("personal progress untouched by group marks (no p2p_lesson_progress rows written)", (await db.query(`select count(*)::int n from p2p_lesson_progress`)).rows[0].n === progressBefore && h.body.activeJourney.personal.completed === 1);
  ok("a member can't mark covered", (await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/covered`, U.kid, { lessonId: L.b })).status === 403);
  ok("a lesson from another series is refused", (await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/covered`, U.shep, { lessonId: L.p1 })).status === 400
    && (await call("PUT", `/learning/family/${FA}/journeys/${journeyCore}/current-lesson`, U.shep, { lessonId: L.p1 })).status === 400);

  // A finished Gathering that studied a lesson counts as covered together.
  const [sess] = (await db.query(`insert into p2p_family_worship_sessions (family_id, host_id, status, channel_name) values ($1, $2, 'ended', 'family_worship_test') returning id`, [FA, U.shep])).rows;
  await db.query(`insert into p2p_family_worship_history (family_id, session_id, duration_seconds, participant_count, lesson_id) values ($1, $2, 600, 3, $3)`, [FA, sess.id, L.c]);
  ok("a Gathering that studied Lesson C counts toward group progress", (await home(U.kid)).body.activeJourney.group.covered === 2);

  // Continue Study card follows the journey.
  const cs = await call("GET", `/family/worship/continue-study?familyId=${FA}`, U.kid);
  ok("Family Continue Study = the journey's current lesson", cs.status === 200 && cs.body.continueStudy?.nextLessonId === L.b && cs.body.discipleshipJourney.lessons.map((l) => l.status).join() === "done,current,done", JSON.stringify(cs.body));

  // Switch → pause (history kept) → resume.
  r = await call("POST", `/learning/family/${FA}/journeys`, U.shep, { curriculumId: C.plan });
  const journeyPlan = r.body.journeyId;
  h = await home(U.kid);
  ok("switching: new series active, previous one paused (kept in history with its progress)", h.body.activeJourney.curriculum.id === C.plan
    && h.body.history.length === 1 && h.body.history[0].status === "paused" && h.body.history[0].group.covered === 2);
  ok("only one active journey per family", (await db.query(`select count(*)::int n from p2p_group_learning_journeys where family_id = $1 and status = 'active'`, [FA])).rows[0].n === 1);
  r = await call("POST", `/learning/family/${FA}/journeys`, U.shep, { curriculumId: C.core });
  h = await home(U.kid);
  ok("resuming the earlier series reuses it: same journey, same place, progress intact", r.body.resumed === true && r.body.journeyId === journeyCore
    && h.body.activeJourney.currentLesson.id === L.b && h.body.activeJourney.group.covered === 2 && h.body.history[0].id === journeyPlan);
  ok("revisit: jump back to Lesson A", (await call("PUT", `/learning/family/${FA}/journeys/${journeyCore}/current-lesson`, U.shep, { lessonId: L.a })).status === 200
    && (await home(U.kid)).body.activeJourney.currentLesson.id === L.a);
  await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/covered`, U.shep, { lessonId: L.b });
  ok("covering every lesson completes the journey", (await db.query(`select status from p2p_group_learning_journeys where id = $1`, [journeyCore])).rows[0].status === "completed");
  await call("DELETE", `/learning/family/${FA}/journeys/${journeyCore}/covered/${L.b}`, U.shep);
  ok("undo re-opens it", (await db.query(`select status from p2p_group_learning_journeys where id = $1`, [journeyCore])).rows[0].status === "active");
  ok("pause", (await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/pause`, U.shep)).body?.status === "paused" && (await home(U.kid)).body.activeJourney === null);

  // ── Isolation ─────────────────────────────────────────────────────────
  ok("another family's leader can't touch this family's journey (403)", (await call("POST", `/learning/family/${FA}/journeys/${journeyCore}/covered`, U.other, { lessonId: L.a })).status === 403);
  ok("…nor reach it through their own family's path (404 — wrong group)", (await call("PUT", `/learning/family/${FB}/journeys/${journeyCore}/current-lesson`, U.other, { lessonId: L.a })).status === 404);
  ok("bad scope / id → 404", (await call("GET", `/learning/club/${FA}`, U.shep)).status === 404 && (await call("GET", `/learning/family/nope`, U.shep)).status === 404);

  // ── Church scope (same routes) ────────────────────────────────────────
  ok("church member: can view, can't choose", (await home(U.member, "church", CH)).status === 200 && (await call("POST", `/learning/church/${CH}/journeys`, U.member, { curriculumId: C.core })).status === 403);
  r = await call("POST", `/learning/church/${CH}/journeys`, U.pastor, { curriculumId: C.core });
  ok("church leader starts a journey; separate from the family's", r.status === 200 && r.body.journeyId !== journeyCore && (await home(U.member, "church", CH)).body.activeJourney.group.covered === 0);
  ok("non-member of the church: 403", (await home(U.shep, "church", CH)).status === 403);

  // ── Direct database access (RLS) ───────────────────────────────────────
  const as = async (uid, sql, params = []) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return { rows: (await db.query(sql, params)).rows }; } catch (e) { return { error: e.message }; } finally { await db.exec("reset role;"); } };
  const own = await as(U.kid, `select id from p2p_group_learning_journeys where family_id = $1`, [FA]);
  ok("members can read their own family's journeys directly", (own.rows ?? []).length === 2, JSON.stringify(own));
  ok("others read nothing", ((await as(U.other, `select id from p2p_group_learning_journeys where family_id = $1`, [FA])).rows ?? ["x"]).length === 0
    && ((await as(U.other, `select id from p2p_group_lesson_completions`)).rows ?? ["x"]).length === 0);
  ok("nobody writes directly (not even a Shepherd)", !!(await as(U.shep, `insert into p2p_group_lesson_completions (journey_id, lesson_id) values ($1, $2)`, [journeyCore, L.c])).error
    && !!(await as(U.shep, `update p2p_group_learning_journeys set status = 'active' where id = $1`, [journeyPlan])).error);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
