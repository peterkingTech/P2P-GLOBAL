// Gathering + lesson (Prompt 6): the REAL /api/family/worship routes
// (routes/familyWorship.ts + lib/gatheringLesson.ts) on the real family
// migrations, before and after migration 202, in PGlite through the lab
// bundle. Synthetic content and users only.
// Proves: only the Guide links a lesson; a central lesson (Core Foundation /
// P2P Plan) or the family's own PUBLISHED lesson, never another family's or a
// draft; one lesson at a time; any member — including a late joiner — can
// open the lesson content, outsiders can't; nothing is copied into the
// session; the link is kept in history at the end; before 202 the deployed
// API refuses family lessons cleanly and central lessons keep working.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/gathering-lesson.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;
const U = { shep: id(1), teen: id(2), late: id(3), other: id(4) };
const FA = "66666666-6666-4666-8666-000000000011", FB = "66666666-6666-4666-8666-000000000012";
const C = { core: id(20), plan: id(21) }, M = { m1: id(30), p1: id(31) };
const L = { a: id(40), p1: id(41), draft: id(42) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_push_tokens (id uuid primary key default gen_random_uuid(), user_id uuid, token text);
  create table public.p2p_curriculums (id uuid primary key, title text, subtitle text, type text, status text, is_visible boolean, parent_category_id uuid, display_order int, cover_image text, thumbnail_url text);
  create table public.p2p_modules (id uuid primary key, curriculum_id uuid references public.p2p_curriculums(id), title text, order_index int);
  create table public.p2p_lessons (id uuid primary key, module_id uuid references public.p2p_modules(id), title text, order_index int, status text);
  create table public.p2p_lesson_sections (id uuid primary key default gen_random_uuid(), lesson_id uuid, title text, content text, section_order int);
  create table public.p2p_reflection_questions (id uuid primary key default gen_random_uuid(), lesson_id uuid, question text, display_order int);
  create table public.p2p_reflection_responses (id uuid primary key default gen_random_uuid(), user_id uuid, question_id uuid, response text);
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
  create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
`);
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "117_family_worship_modes_and_history.sql", "118_family_worship_modes_visited.sql", "119_family_worship_media_provider.sql",
  "123_family_worship_media_permissions_queue.sql", "124_family_worship_phase7.sql", "126_family_multi_membership.sql", "134_custom_studies_church.sql", "135_custom_studies_family.sql"]) await db.exec(mig(f));
// 122 (messages), 128/129 (summary columns, events) — just the parts the routes read/write.
await db.exec(`alter table p2p_family_worship_history add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null,
    add column if not exists guide_summary text, add column if not exists continuity_notes text, add column if not exists guide_id uuid,
    add column if not exists started_at timestamptz, add column if not exists ended_at timestamptz, add column if not exists notes_count int, add column if not exists prayer_request_count int;
  alter table p2p_family_worship_sessions add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null;
  create table if not exists p2p_family_worship_session_events (id uuid primary key default gen_random_uuid(), session_id uuid, family_id uuid, event_type text, event_data jsonb, created_at timestamptz default now());
  create table if not exists p2p_family_worship_notes (id uuid primary key default gen_random_uuid(), session_id uuid);`);
await db.exec(mig("199_group_learning_journeys.sql"));
await db.exec(mig("200_custom_lesson_authoring.sql"));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'User' from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'The A Family',$2), ($3,'The B Family',$4)`, [FA, U.shep, FB, U.other]);
for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.teen, "teen"], [FA, U.late, "adult"], [FB, U.other, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_curriculums (id,title,type,status,is_visible,display_order) values ($1,'Christian Foundation','core','published',true,1), ($2,'Victory Plan','plan','published',true,1)`, [C.core, C.plan]);
await db.query(`insert into p2p_modules values ($1,$2,'Module 1',1), ($3,$4,'Plan Module',1)`, [M.m1, C.core, M.p1, C.plan]);
await db.query(`insert into p2p_lessons values ($1,$2,'Lesson A',1,'published'), ($3,$4,'Plan Lesson 1',1,'published'), ($5,$2,'Draft lesson',2,'draft')`, [L.a, M.m1, L.p1, M.p1, L.draft]);
await db.query(`insert into p2p_lesson_sections (lesson_id,title,content,section_order) values ($1,'Intro','CENTRAL TEACHING TEXT',1)`, [L.a]);
const [{ id: Q1 }] = (await db.query(`insert into p2p_reflection_questions (lesson_id,question,display_order) values ($1,'What stood out?',1) returning id`, [L.a])).rows;
await db.query(`insert into p2p_reflection_responses (user_id, question_id, response) values ($1,$2,'PRIVATE ANSWER')`, [U.teen, Q1]);
// Family studies: A has a published study with a published + a draft lesson, and a draft study; B has its own.
const study = async (fam, title, status) => (await db.query(`insert into p2p_family_studies (family_id, created_by, title, status) values ($1,$2,$3,$4) returning id`, [fam, fam === FA ? U.shep : U.other, title, status])).rows[0].id;
const SA = await study(FA, "Our Psalms", "published"), SD = await study(FA, "Draft Study", "draft"), SB = await study(FB, "B Study", "published");
const lesson = async (s, title, status) => (await db.query(`insert into p2p_family_study_lessons (study_id, title, teaching_material, scripture_references, questions, status)
  values ($1,$2,'FAMILY TEACHING TEXT','[{"book":"Psalms","chapter":23,"startVerse":1,"endVerse":3,"translation":null}]','[{"id":"q1","text":"Who is your shepherd?","kind":"discussion"}]',$3) returning id`, [s, title, status])).rows[0].id;
const FL = { pub: await lesson(SA, "Psalm 23", "published"), draft: await lesson(SA, "Unfinished", "draft"), inDraftStudy: await lesson(SD, "Hidden", "published"), otherFamily: await lesson(SB, "B Lesson", "published") };

const tmp = mkdtempSync(path.join(os.tmpdir(), "gathering-lesson-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const state = (sid, who, body) => call("PUT", `/family/worship/sessions/${sid}/state`, who, body);

try {
  // ── Before migration 202 (what production runs until it's applied) ───────
  let r = await call("POST", "/family/worship/start", U.shep, { familyId: FA });
  ok("Guide starts a Gathering", r.status === 200 && !!r.body.id, JSON.stringify(r.body));
  const S1 = r.body.id;
  await call("POST", `/family/worship/sessions/${S1}/join`, U.teen);
  ok("before 202: a family lesson is refused cleanly (503), nothing written",
    (await state(S1, U.shep, { familyLessonId: FL.pub })).status === 503);
  r = await state(S1, U.shep, { lessonId: L.a });
  ok("before 202: Guide links a central lesson; title comes back for everyone", r.status === 200 && r.body.lessonId === L.a && r.body.lesson?.title === "Lesson A" && r.body.lesson?.kind === "central", JSON.stringify(r.body));
  r = await call("GET", `/family/worship/sessions/${S1}/lesson`, U.teen);
  ok("a member opens the lesson: sections + questions, context", r.status === 200 && r.body.lesson?.sections?.[0]?.content === "CENTRAL TEACHING TEXT"
    && r.body.lesson.questions[0].text === "What stood out?" && r.body.lesson.context === "Christian Foundation · Module 1", JSON.stringify(r.body));
  ok("never anyone's answers", !JSON.stringify(r.body).includes("PRIVATE ANSWER"));

  // ── Migration 202 ─────────────────────────────────────────────────────────
  await db.exec(mig("202_gathering_family_lesson.sql"));
  await db.exec(mig("202_gathering_family_lesson.sql"));
  ok("202 applies and re-runs; existing link kept", (await db.query(`select lesson_id, family_lesson_id from p2p_family_worship_sessions where id = $1`, [S1])).rows[0].lesson_id === L.a);

  ok("a member who isn't the Guide can't link a lesson (403)", (await state(S1, U.teen, { familyLessonId: FL.pub })).status === 403
    && (await state(S1, U.teen, { lessonId: L.p1 })).status === 403);
  ok("can't link a draft family lesson (400)", (await state(S1, U.shep, { familyLessonId: FL.draft })).status === 400);
  ok("can't link a lesson whose study is a draft (400)", (await state(S1, U.shep, { familyLessonId: FL.inDraftStudy })).status === 400);
  ok("can't link another family's lesson (404)", (await state(S1, U.shep, { familyLessonId: FL.otherFamily })).status === 404);
  ok("can't link an unpublished central lesson (404)", (await state(S1, U.shep, { lessonId: L.draft })).status === 404);
  ok("one lesson at a time (both kinds → 400)", (await state(S1, U.shep, { lessonId: L.a, familyLessonId: FL.pub })).status === 400);

  r = await state(S1, U.shep, { familyLessonId: FL.pub });
  ok("Guide links the family's own published lesson; the central link is cleared", r.status === 200 && r.body.familyLessonId === FL.pub && r.body.lessonId === null
    && r.body.lesson?.kind === "family" && r.body.lesson.title === "Psalm 23" && r.body.lesson.studyId === SA, JSON.stringify(r.body));
  const ev = (await db.query(`select event_data from p2p_family_worship_session_events where session_id = $1 and event_type = 'lesson_attached' order by created_at`, [S1])).rows;
  ok("timeline records which lesson (reference + title only)", ev.length === 2 && ev[1].event_data.familyLessonId === FL.pub && ev[1].event_data.lessonTitle === "Psalm 23");

  // Late joiner: joins after the lesson was chosen.
  await call("POST", `/family/worship/sessions/${S1}/join`, U.late);
  r = await call("GET", `/family/worship/sessions/${S1}`, U.late);
  ok("late joiner: session carries the current lesson", r.status === 200 && r.body.lesson?.id === FL.pub && r.body.lesson.title === "Psalm 23");
  r = await call("GET", `/family/worship/sessions/${S1}/lesson`, U.late);
  ok("late joiner opens the family lesson: teaching, Scripture refs, questions", r.status === 200 && r.body.lesson?.sections[0].content === "FAMILY TEACHING TEXT"
    && r.body.lesson.scripture[0].book === "Psalms" && r.body.lesson.questions[0].text === "Who is your shepherd?" && r.body.lesson.context === "Our Psalms", JSON.stringify(r.body));
  ok("someone from another family can't open it (403)", (await call("GET", `/family/worship/sessions/${S1}/lesson`, U.other)).status === 403
    && (await call("GET", `/family/worship/sessions/${S1}`, U.other)).status === 403);

  const row = (await db.query(`select to_jsonb(s) j from p2p_family_worship_sessions s where id = $1`, [S1])).rows[0].j;
  ok("session stores only references — no lesson or Bible text copied", !JSON.stringify(row).includes("TEACHING TEXT") && !JSON.stringify(row).includes("shepherd?"));
  ok("database refuses both lesson kinds on one session", await db.query(`update p2p_family_worship_sessions set lesson_id = $2 where id = $1`, [S1, L.a]).then(() => false, () => true));

  // Other state changes leave the lesson alone; switching back clears the family link.
  r = await state(S1, U.shep, { currentMode: "scripture", currentScripture: { translation: "WEB", book: "Psalms", chapter: 23, startVerse: 1, endVerse: 3 } });
  ok("changing mode/passage keeps the lesson", r.status === 200 && r.body.familyLessonId === FL.pub);
  r = await state(S1, U.shep, { lessonId: L.p1 });
  ok("Guide switches to a P2P Plan lesson; family link cleared", r.status === 200 && r.body.lessonId === L.p1 && r.body.familyLessonId === null && r.body.lesson?.title === "Plan Lesson 1");
  r = await state(S1, U.shep, { familyLessonId: FL.pub });

  // Unpublished afterwards → members get "not available", not the content.
  await db.query(`update p2p_family_study_lessons set status = 'draft' where id = $1`, [FL.pub]);
  r = await call("GET", `/family/worship/sessions/${S1}/lesson`, U.teen);
  ok("lesson unpublished mid-Gathering: members no longer get its content", r.status === 200 && r.body.lesson === null);
  await db.query(`update p2p_family_study_lessons set status = 'published' where id = $1`, [FL.pub]);

  // Prompt 8: the family's journey + notes taken in the Gathering.
  r = await call("POST", `/learning/family/${FA}/journeys`, U.shep, { curriculumId: C.core });
  ok("Shepherd starts the family's journey (Core Foundation)", r.status === 200, JSON.stringify(r.body));
  ok("a member shares a next step; a private note stays private",
    (await call("POST", `/family/worship/sessions/${S1}/notes`, U.teen, { content: "Next: read Psalm 23 each night", visibility: "shared" })).status === 200
    && (await call("POST", `/family/worship/sessions/${S1}/notes`, U.teen, { content: "PRIVATE NOTE just for me", visibility: "private" })).status === 200);

  // End → history keeps the link; the history list shows the title.
  r = await call("POST", `/family/worship/sessions/${S1}/end`, U.shep);
  ok("Guide ends the Gathering", r.status === 200);
  const endedHistoryId = r.body.historyId;
  const h = (await db.query(`select lesson_id, family_lesson_id from p2p_family_worship_history where session_id = $1`, [S1])).rows[0];
  ok("history snapshot keeps the family lesson reference", h?.family_lesson_id === FL.pub && h.lesson_id === null, JSON.stringify(h));
  r = await call("GET", `/family/worship/history?familyId=${FA}`, U.teen);
  ok("history list shows the family lesson's title", r.status === 200 && r.body[0]?.lesson_title === "Psalm 23", JSON.stringify(r.body?.[0]));
  const HID = r.body[0].id;
  ok("ending returns this Gathering's summary id (the app opens it straight away)", endedHistoryId === HID, `${endedHistoryId} vs ${HID}`);
  r = await call("POST", `/family/worship/sessions/${S1}/end`, U.shep);
  ok("ending again is harmless and returns the same summary", r.status === 200 && r.body.historyId === HID);
  r = await call("GET", `/family/worship/history/${HID}`, U.late);
  ok("summary: the family lesson studied, with its study (to open)", r.status === 200 && r.body.lessonRef?.kind === "family" && r.body.lessonRef.id === FL.pub && r.body.lessonRef.studyId === SA, JSON.stringify(r.body?.lessonRef));
  ok("summary: the note shared — and never the private one", r.body.sharedNotes?.length === 1 && r.body.sharedNotes[0].content === "Next: read Psalm 23 each night"
    && !JSON.stringify(r.body).includes("PRIVATE NOTE"), JSON.stringify(r.body.sharedNotes));
  ok("summary: no assignments were given (before 201 here: empty, not an error)", Array.isArray(r.body.assignmentsCreated) && r.body.assignmentsCreated.length === 0);
  ok("summary: next time continues the family's journey (reference only)", r.body.nextTime?.curriculum.id === C.core && r.body.nextTime.lesson?.id === L.a, JSON.stringify(r.body.nextTime));
  ok("summary: another family can't read it (403)", (await call("GET", `/family/worship/history/${HID}`, U.other)).status === 403);
  ok("summary: never anyone's answers", !JSON.stringify(r.body).includes("PRIVATE ANSWER"));

  // Progress is never touched by linking/opening.
  ok("no personal progress or answers written", (await db.query(`select count(*)::int n from p2p_reflection_responses`)).rows[0].n === 1);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
