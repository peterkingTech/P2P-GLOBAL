// Church Gathering + lesson (Prompt 7): the REAL /api church call routes
// (routes/churchCalls.ts + lib/gatheringLesson.ts) on the real church call
// migrations, before and after migration 204, in PGlite through the lab
// bundle. Synthetic content and users only.
// Proves: only the call host or a church pastor links a lesson (a small-group
// leader or member can't — no new permissions); a central lesson (Core
// Foundation / P2P Plan) or the church's own PUBLISHED lesson, never another
// church's or a draft; one lesson at a time; any active member — including a
// late joiner — can open the lesson content, people from another church or
// former members can't; nothing is copied into the call; before 204 the
// deployed API refuses church lessons cleanly and central lessons keep working.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/church-gathering-lesson.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000010${String(n).padStart(2, "0")}`;
const U = { pastor: id(1), sgl: id(2), member: id(3), late: id(4), former: id(5), otherPastor: id(6) };
const CH = "77777777-7777-4777-8777-000000000011", CH2 = "77777777-7777-4777-8777-000000000012";
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
  create table public.p2p_curriculums (id uuid primary key, title text, subtitle text, type text, status text, is_visible boolean, parent_category_id uuid, display_order int, cover_image text, thumbnail_url text);
  create table public.p2p_modules (id uuid primary key, curriculum_id uuid references public.p2p_curriculums(id), title text, order_index int);
  create table public.p2p_lessons (id uuid primary key, module_id uuid references public.p2p_modules(id), title text, order_index int, status text);
  create table public.p2p_lesson_sections (id uuid primary key default gen_random_uuid(), lesson_id uuid, title text, content text, section_order int);
  create table public.p2p_reflection_questions (id uuid primary key default gen_random_uuid(), lesson_id uuid, question text, display_order int);
  create table public.p2p_reflection_responses (id uuid primary key default gen_random_uuid(), user_id uuid, question_id uuid, response text);
  create table public.p2p_sessions (id uuid primary key); create table public.p2p_discipleship_links (id uuid primary key);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, status text, completed boolean);
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true, profile_visible_to_leadership boolean default true);
  create table public.p2p_church_cohorts (id uuid primary key default gen_random_uuid(), church_id uuid, name text, leader_id uuid, status text default 'active');
  create table public.p2p_church_cohort_members (id uuid primary key default gen_random_uuid(), cohort_id uuid, user_id uuid, status text default 'active');
  create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
  create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
`);
for (const f of ["082_journal_reflections.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql", "130_church_calls.sql", "131_church_calls_experience.sql",
  "133_church_calls_scheduled_started_at_fix.sql", "134_custom_studies_church.sql", "135_custom_studies_family.sql", "199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql", "201_lesson_reflections_assignments.sql"]) await db.exec(mig(f));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'User' from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_churches values ($1,'Grace'), ($2,'Hope')`, [CH, CH2]);
for (const [c, u, r, act] of [[CH, U.pastor, "senior_pastor", true], [CH, U.sgl, "small_group_leader", true], [CH, U.member, "member", true], [CH, U.late, "member", true],
  [CH, U.former, "member", false], [CH2, U.otherPastor, "senior_pastor", true]])
  await db.query(`insert into p2p_church_members (church_id, user_id, role, is_active) values ($1,$2,$3,$4)`, [c, u, r, act]);
await db.query(`insert into p2p_curriculums (id,title,type,status,is_visible,display_order) values ($1,'Christian Foundation','core','published',true,1), ($2,'Victory Plan','plan','published',true,1)`, [C.core, C.plan]);
await db.query(`insert into p2p_modules values ($1,$2,'Module 1',1), ($3,$4,'Plan Module',1)`, [M.m1, C.core, M.p1, C.plan]);
await db.query(`insert into p2p_lessons values ($1,$2,'Lesson A',1,'published'), ($3,$4,'Plan Lesson 1',1,'published'), ($5,$2,'Draft lesson',2,'draft')`, [L.a, M.m1, L.p1, M.p1, L.draft]);
await db.query(`insert into p2p_lesson_sections (lesson_id,title,content,section_order) values ($1,'Intro','CENTRAL TEACHING TEXT',1)`, [L.a]);
const [{ id: Q1 }] = (await db.query(`insert into p2p_reflection_questions (lesson_id,question,display_order) values ($1,'What stood out?',1) returning id`, [L.a])).rows;
await db.query(`insert into p2p_reflection_responses (user_id, question_id, response) values ($1,$2,'PRIVATE ANSWER')`, [U.member, Q1]);
const study = async (ch, title, status) => (await db.query(`insert into p2p_church_studies (church_id, created_by, title, status) values ($1,$2,$3,$4) returning id`, [ch, ch === CH ? U.pastor : U.otherPastor, title, status])).rows[0].id;
const SA = await study(CH, "Sermon Series", "published"), SD = await study(CH, "Draft Series", "draft"), SB = await study(CH2, "Hope Series", "published");
const lesson = async (s, title, status) => (await db.query(`insert into p2p_church_study_lessons (study_id, title, teaching_material, scripture_references, questions, status)
  values ($1,$2,'CHURCH TEACHING TEXT','[{"book":"John","chapter":3,"startVerse":16,"endVerse":17,"translation":null}]','[{"id":"q1","text":"What does love look like here?","kind":"discussion"}]',$3) returning id`, [s, title, status])).rows[0].id;
const CL = { pub: await lesson(SA, "Week 1: Love", "published"), draft: await lesson(SA, "Unfinished", "draft"), inDraftStudy: await lesson(SD, "Hidden", "published"), otherChurch: await lesson(SB, "Hope Lesson", "published") };

const tmp = mkdtempSync(path.join(os.tmpdir(), "church-gathering-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const setLesson = (cid, who, body) => call("PUT", `/churches/calls/${cid}/lesson`, who, body);

try {
  let r = await call("POST", `/churches/${CH}/calls`, U.pastor, { title: "Sunday Study", purpose: "bible_study", scope: "church" });
  ok("pastor starts a Church Gathering", r.status === 200 && !!r.body?.id, `${r.status} ${JSON.stringify(r.body)}`);
  const CID = r.body.id;
  ok("a plain member can't start a church-wide Gathering (existing rule)", (await call("POST", `/churches/${CH}/calls`, U.member, { title: "x", purpose: "meeting", scope: "church" })).status === 403);
  await call("POST", `/churches/calls/${CID}/join`, U.member);

  // ── Before 204 ──
  ok("before 204: a church lesson is refused cleanly (503)", (await setLesson(CID, U.pastor, { churchLessonId: CL.pub })).status === 503);
  r = await setLesson(CID, U.pastor, { lessonId: L.a });
  ok("before 204: host links a central lesson; old + new shapes returned", r.status === 200 && r.body.lesson?.lessonTitle === "Lesson A" && r.body.lessonRef?.kind === "central", JSON.stringify(r.body));
  r = await call("GET", `/churches/calls/${CID}/lesson`, U.member);
  ok("a member opens the lesson: sections, questions, context", r.status === 200 && r.body.lesson?.sections[0].content === "CENTRAL TEACHING TEXT"
    && r.body.lesson.questions[0].text === "What stood out?" && r.body.lesson.context === "Christian Foundation · Module 1", JSON.stringify(r.body));
  ok("never anyone's answers", !JSON.stringify(r.body).includes("PRIVATE ANSWER"));

  // ── 204 ──
  await db.exec(mig("204_church_call_church_lesson.sql"));
  await db.exec(mig("204_church_call_church_lesson.sql"));
  ok("204 applies and re-runs; existing link kept", (await db.query(`select lesson_id from p2p_church_calls where id = $1`, [CID])).rows[0].lesson_id === L.a);

  ok("a member can't link a lesson (403)", (await setLesson(CID, U.member, { churchLessonId: CL.pub })).status === 403);
  ok("a small-group leader who isn't host or pastor can't either (no new permissions)", (await setLesson(CID, U.sgl, { lessonId: L.p1 })).status === 403);
  ok("another church's pastor can't (403)", (await setLesson(CID, U.otherPastor, { lessonId: L.p1 })).status === 403);
  ok("draft church lesson refused (400)", (await setLesson(CID, U.pastor, { churchLessonId: CL.draft })).status === 400);
  ok("lesson in a draft study refused (400)", (await setLesson(CID, U.pastor, { churchLessonId: CL.inDraftStudy })).status === 400);
  ok("another church's lesson refused (404) — guessing an id doesn't work", (await setLesson(CID, U.pastor, { churchLessonId: CL.otherChurch })).status === 404);
  ok("both kinds at once refused (400)", (await setLesson(CID, U.pastor, { lessonId: L.a, churchLessonId: CL.pub })).status === 400);
  ok("unpublished central lesson refused (404)", (await setLesson(CID, U.pastor, { lessonId: L.draft })).status === 404);

  r = await setLesson(CID, U.pastor, { churchLessonId: CL.pub });
  ok("host links the church's own published lesson; central link cleared", r.status === 200 && r.body.lessonRef?.kind === "church" && r.body.lessonRef.title === "Week 1: Love" && r.body.lessonRef.studyId === SA
    && (await db.query(`select lesson_id, church_lesson_id from p2p_church_calls where id = $1`, [CID])).rows[0].lesson_id === null, JSON.stringify(r.body));
  const ev = (await db.query(`select event_data from p2p_church_call_events where call_id = $1 and event_type = 'lesson_attached' order by created_at`, [CID])).rows;
  ok("timeline records the reference + title only", ev.length === 2 && ev[1].event_data.churchLessonId === CL.pub && ev[1].event_data.lessonTitle === "Week 1: Love");

  // Late joiner.
  await call("POST", `/churches/calls/${CID}/join`, U.late);
  r = await call("GET", `/churches/calls/${CID}`, U.late);
  ok("late joiner: call detail carries the lesson (title for everyone)", r.status === 200 && r.body.lessonRef?.id === CL.pub && r.body.call.churchLessonId === CL.pub);
  r = await call("GET", `/churches/calls/${CID}/lesson`, U.late);
  ok("late joiner opens the church lesson: teaching, Scripture, questions", r.status === 200 && r.body.lesson?.sections[0].content === "CHURCH TEACHING TEXT"
    && r.body.lesson.scripture[0].book === "John" && r.body.lesson.questions[0].text === "What does love look like here?" && r.body.lesson.context === "Sermon Series" && r.body.lesson.kind === "church", JSON.stringify(r.body));
  ok("another church's pastor can't open it (403)", (await call("GET", `/churches/calls/${CID}/lesson`, U.otherPastor)).status === 403);
  ok("a former (inactive) member can't open it (403)", (await call("GET", `/churches/calls/${CID}/lesson`, U.former)).status === 403);

  const row = (await db.query(`select to_jsonb(c) j from p2p_church_calls c where id = $1`, [CID])).rows[0].j;
  ok("the call stores only references — no lesson text copied", !JSON.stringify(row).includes("TEACHING TEXT") && !JSON.stringify(row).includes("love look like"));
  ok("database refuses both lesson kinds on one call", await db.query(`update p2p_church_calls set lesson_id = $2 where id = $1`, [CID, L.a]).then(() => false, () => true));

  // Scripture/media keep working and leave the lesson alone.
  r = await call("PUT", `/churches/calls/${CID}/scripture`, U.pastor, { book: "John", chapter: 3, startVerse: 16, endVerse: 17, translation: "WEB" });
  ok("host shares a passage; lesson unchanged", r.status === 200 && (await db.query(`select church_lesson_id from p2p_church_calls where id = $1`, [CID])).rows[0].church_lesson_id === CL.pub);
  ok("a member can't share a passage (403, existing rule)", (await call("PUT", `/churches/calls/${CID}/scripture`, U.member, { book: "John", chapter: 1, startVerse: 1, translation: "WEB" })).status === 403);

  r = await setLesson(CID, U.pastor, { lessonId: L.p1 });
  ok("switch to a P2P Plan lesson clears the church link", r.status === 200 && r.body.lessonRef?.title === "Plan Lesson 1"
    && (await db.query(`select church_lesson_id from p2p_church_calls where id = $1`, [CID])).rows[0].church_lesson_id === null);
  await setLesson(CID, U.pastor, { churchLessonId: CL.pub });
  await db.query(`update p2p_church_study_lessons set status = 'draft' where id = $1`, [CL.pub]);
  r = await call("GET", `/churches/calls/${CID}/lesson`, U.member);
  ok("lesson unpublished mid-Gathering: members no longer get its content", r.status === 200 && r.body.lesson === null);
  await db.query(`update p2p_church_study_lessons set status = 'published' where id = $1`, [CL.pub]);

  // ── Media sync (migration 205): the Family Gathering's clock ──
  const playback = (who, body) => call("PUT", `/churches/calls/${CID}/playback`, who, body);
  r = await call("PUT", `/churches/calls/${CID}/media`, U.pastor, { provider: "youtube", id: "dQw4w9WgXcQ" });
  ok("before 205: host can still attach a video", r.status === 200 && r.body.media?.id === "dQw4w9WgXcQ");
  ok("before 205: playback refused cleanly (503)", (await playback(U.pastor, { isPlaying: true })).status === 503);
  r = await call("GET", `/churches/calls/${CID}`, U.member);
  ok("before 205: call detail says media sync isn't available", r.body.call.mediaSync === false && r.body.call.isPlaying === false);
  await db.exec(mig("205_church_call_media_sync.sql"));
  await db.exec(mig("205_church_call_media_sync.sql"));
  ok("205 applies and re-runs; existing call paused at 0", (await db.query(`select is_playing, playback_base_position_ms from p2p_church_calls where id = $1`, [CID])).rows[0].is_playing === false);
  r = await call("PUT", `/churches/calls/${CID}/media`, U.pastor, { provider: "youtube", id: "aaaaaaaaaaa" });
  let d = (await call("GET", `/churches/calls/${CID}`, U.late)).body.call;
  ok("setting a video starts it for everyone from 0 (clock anchored now)", d.mediaSync === true && d.isPlaying === true && d.playbackBasePositionMs === 0
    && Math.abs(Date.now() - Date.parse(d.playbackBaseServerTime)) < 10000 && d.media.id === "aaaaaaaaaaa", JSON.stringify(d));
  r = await playback(U.pastor, { isPlaying: false, positionMs: 42500 });
  ok("host pauses at 42.5s; everyone's detail carries the same anchor", r.status === 200 && r.body.isPlaying === false && r.body.playbackBasePositionMs === 42500);
  d = (await call("GET", `/churches/calls/${CID}`, U.member)).body.call;
  ok("a member reads the same paused position", d.isPlaying === false && d.playbackBasePositionMs === 42500);
  r = await playback(U.pastor, { isPlaying: true });
  ok("resume keeps the position and re-anchors the clock", r.status === 200 && r.body.isPlaying === true && r.body.playbackBasePositionMs === 42500);
  ok("a member can't control playback (403)", (await playback(U.member, { isPlaying: false })).status === 403);
  ok("a small-group leader who isn't host/pastor can't either (403)", (await playback(U.sgl, { isPlaying: false })).status === 403);
  ok("another church's pastor can't (403)", (await playback(U.otherPastor, { isPlaying: false })).status === 403);
  ok("bad input refused (400)", (await playback(U.pastor, { positionMs: -5 })).status === 400 && (await playback(U.pastor, { isPlaying: "yes" })).status === 400);
  await call("PUT", `/churches/calls/${CID}/media`, U.pastor, {});
  ok("removing the video stops playback; playing with no video is refused", (await db.query(`select is_playing from p2p_church_calls where id = $1`, [CID])).rows[0].is_playing === false
    && (await playback(U.pastor, { isPlaying: true })).status === 400);
  await call("PUT", `/churches/calls/${CID}/media`, U.pastor, { provider: "youtube", id: "aaaaaaaaaaa" });

  // ── Prompt 8: what the Gathering leaves behind + member progress ──
  r = await call("POST", `/learning/church/${CH}/journeys`, U.pastor, { curriculumId: C.core });
  ok("pastor starts the church's journey (Core Foundation)", r.status === 200, JSON.stringify(r.body));
  ok("a member shares a note; another private one stays private",
    (await call("POST", `/churches/calls/${CID}/notes`, U.member, { content: "Next step: pray for our city daily", visibility: "shared" })).status === 200
    && (await call("POST", `/churches/calls/${CID}/notes`, U.member, { content: "PRIVATE NOTE about my struggle", visibility: "private" })).status === 200);
  r = await call("POST", `/learning/work/church/lessons/${CL.pub}/assignments`, U.pastor, { title: "Memorise John 3:16", status: "published" });
  ok("pastor gives a follow-up assignment during the Gathering", r.status === 200 && r.body.status === "published", JSON.stringify(r.body));
  const asgId = r.body.id;
  await call("POST", `/learning/work/church/lessons/${CL.pub}/assignments`, U.pastor, { title: "DRAFT IDEA", status: "draft" });
  await db.query(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1,$2,'completed',true)`, [U.member, L.a]);
  await db.query(`update p2p_church_members set profile_visible_to_leadership = false where church_id = $1 and user_id = $2`, [CH, U.late]);
  const home = (who) => call("GET", `/learning/church/${CH}`, who);
  let h = await home(U.pastor);
  ok("leaders: each visible member's own completion of the series (counts only)", h.status === 200 && h.body.memberProgress?.total === 1
    && h.body.memberProgress.members.find((m) => m.userId === U.member)?.completed === 1, JSON.stringify(h.body.memberProgress));
  ok("leaders: a member who opted out of leadership visibility isn't listed (counted as hidden)", !h.body.memberProgress.members.some((m) => m.userId === U.late) && h.body.memberProgress.hiddenCount === 1);
  ok("members never get other members' progress", (await home(U.member)).body.memberProgress === null && (await home(U.sgl)).body.memberProgress !== null);
  ok("member's own to-do lists the new assignment", (await home(U.member)).body.work.toDo.some((a) => a.assignmentId === asgId));

  // ── Summary: the lesson studied (church-owned) is there to open ──
  r = await call("POST", `/churches/calls/${CID}/end`, U.pastor);
  ok("host ends the Gathering", r.status === 200);
  r = await call("GET", `/churches/calls/${CID}/summary`, U.member);
  ok("summary: a member sees the church lesson studied (to open), the passage and the video", r.status === 200 && r.body.lessonRef?.kind === "church" && r.body.lessonRef.id === CL.pub
    && r.body.lessonRef.studyId === SA && r.body.scripture.label === "John 3:16-17" && r.body.media?.id === "aaaaaaaaaaa", JSON.stringify(r.body).slice(0, 400));
  ok("summary: shared notes only (private note never copied)", r.body.sharedNotes?.length === 1 && r.body.sharedNotes[0].content === "Next step: pray for our city daily"
    && !JSON.stringify(r.body).includes("PRIVATE NOTE"), JSON.stringify(r.body.sharedNotes));
  ok("summary: the follow-up assignment given during the Gathering (never drafts)", r.body.assignmentsCreated?.length === 1 && r.body.assignmentsCreated[0].assignmentId === asgId
    && r.body.assignmentsCreated[0].lessonTitle === "Week 1: Love" && !JSON.stringify(r.body).includes("DRAFT IDEA"), JSON.stringify(r.body.assignmentsCreated));
  ok("summary: next time continues the journey at its next lesson (a reference)", r.body.nextTime?.curriculum.id === C.core && r.body.nextTime.lesson?.id === L.a && r.body.nextTime.total === 1, JSON.stringify(r.body.nextTime));
  ok("summary: never anyone's answers; another church can't read it", !JSON.stringify(r.body).includes("PRIVATE ANSWER")
    && (await call("GET", `/churches/calls/${CID}/summary`, U.otherPastor)).status === 403);
  r = await setLesson(CID, U.pastor, { lessonId: null });
  ok("host clears the lesson", r.status === 200 && r.body.lessonRef === null);
  ok("no personal progress or answers written", (await db.query(`select count(*)::int n from p2p_reflection_responses`)).rows[0].n === 1);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
