// Prompt 9 security audit of the Family/Church redesign: every endpoint the
// redesign added (and the changed Gathering/summary reads), attacked directly
// with real HTTP requests — no sign-in, another family, another church, a
// former member, a plain member doing leader-only things, and guessed /
// cross-scope ids — plus direct database reads as a signed-in outsider.
// Nothing here relies on hidden buttons. Real migrations, real routes, PGlite.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/redesign-security.mjs
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
const U = {
  shepA: id(1), memA: id(2), formerA: id(3), shepB: id(4),
  pastorX: id(5), memX: id(6), formerX: id(7), pastorY: id(8), nobody: id(9),
};
const FA = "66666666-6666-4666-8666-000000000031", FB = "66666666-6666-4666-8666-000000000032";
const CX = "77777777-7777-4777-8777-000000000031", CY = "77777777-7777-4777-8777-000000000032";
const C = { core: id(20) }, M = { m1: id(30) }, L = { a: id(40) };

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
for (const f of ["082_journal_reflections.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "117_family_worship_modes_and_history.sql", "118_family_worship_modes_visited.sql",
  "119_family_worship_media_provider.sql", "123_family_worship_media_permissions_queue.sql", "124_family_worship_phase7.sql", "126_family_multi_membership.sql",
  "130_church_calls.sql", "131_church_calls_experience.sql", "133_church_calls_scheduled_started_at_fix.sql", "134_custom_studies_church.sql", "135_custom_studies_family.sql"]) await db.exec(mig(f));
await db.exec(`alter table p2p_family_worship_history add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null,
    add column if not exists guide_summary text, add column if not exists continuity_notes text, add column if not exists guide_id uuid,
    add column if not exists started_at timestamptz, add column if not exists ended_at timestamptz, add column if not exists notes_count int, add column if not exists prayer_request_count int;
  alter table p2p_family_worship_sessions add column if not exists lesson_id uuid references p2p_lessons(id) on delete set null;
  create table if not exists p2p_family_worship_session_events (id uuid primary key default gen_random_uuid(), session_id uuid, family_id uuid, event_type text, event_data jsonb, created_at timestamptz default now());`);
for (const f of ["199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql", "201_lesson_reflections_assignments.sql", "202_gathering_family_lesson.sql",
  "203_family_roster_policy_recursion.sql", "204_church_call_church_lesson.sql", "205_church_call_media_sync.sql"]) await db.exec(mig(f));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'User' from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'A',$2), ($3,'B',$4)`, [FA, U.shepA, FB, U.shepB]);
for (const [f, u, r, st] of [[FA, U.shepA, "shepherd", "active"], [FA, U.memA, "adult", "active"], [FA, U.formerA, "adult", "left"], [FB, U.shepB, "shepherd", "active"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role, status) values ($1,$2,$3,$4)`, [f, u, r, st]);
await db.query(`insert into p2p_churches values ($1,'X'), ($2,'Y')`, [CX, CY]);
for (const [c, u, r, act] of [[CX, U.pastorX, "senior_pastor", true], [CX, U.memX, "member", true], [CX, U.formerX, "member", false], [CY, U.pastorY, "senior_pastor", true]])
  await db.query(`insert into p2p_church_members (church_id, user_id, role, is_active) values ($1,$2,$3,$4)`, [c, u, r, act]);
await db.query(`insert into p2p_curriculums (id,title,type,status,is_visible,display_order) values ($1,'Christian Foundation','core','published',true,1)`, [C.core]);
await db.query(`insert into p2p_modules values ($1,$2,'Module 1',1)`, [M.m1, C.core]);
await db.query(`insert into p2p_lessons values ($1,$2,'Lesson A',1,'published')`, [L.a, M.m1]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "redesign-security-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const headers = { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) };
  const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const denied = (s) => s === 401 || s === 403 || s === 404;
const RQ = "cccccccc-2222-4222-8222-000000000001";

try {
  // ── Build real content through the API as the rightful owners ──────────
  const famStudy = (await call("POST", `/family/${FA}/studies`, U.shepA, { title: "Psalms" })).body;
  await call("PUT", `/family/studies/${famStudy.id}`, U.shepA, { status: "published" });
  const famLesson = (await call("POST", `/family/studies/${famStudy.id}/lessons`, U.shepA, { title: "Psalm 23", teachingMaterial: "FAMILY SECRET TEACHING",
    questions: [{ id: RQ, text: "Where do you need rest?", kind: "reflection" }] })).body;
  await call("POST", `/family/studies/${famStudy.id}/lessons/${famLesson.id}/status`, U.shepA, { status: "published" });
  const famDraft = (await call("POST", `/family/studies/${famStudy.id}/lessons`, U.shepA, { title: "DRAFT LESSON" })).body;
  const chStudy = (await call("POST", `/churches/${CX}/studies`, U.pastorX, { title: "Series" })).body;
  await call("PUT", `/churches/studies/${chStudy.id}`, U.pastorX, { status: "published" });
  const chLesson = (await call("POST", `/churches/studies/${chStudy.id}/lessons`, U.pastorX, { title: "Week 1", teachingMaterial: "CHURCH SECRET TEACHING" })).body;
  await call("POST", `/churches/studies/${chStudy.id}/lessons/${chLesson.id}/status`, U.pastorX, { status: "published" });
  ok("setup: owners created + published family and church lessons through the API", !!famLesson?.id && !!famDraft?.id && !!chLesson?.id, JSON.stringify({ famStudy, famLesson, chStudy, chLesson }).slice(0, 400));

  const W = "/learning/work";
  const ref = (await call("POST", `${W}/family/lessons/${famLesson.id}/reflections`, U.memA, { questionId: RQ, content: "MY PRIVATE REFLECTION", visibility: "private" })).body;
  const fAsg = (await call("POST", `${W}/family/lessons/${famLesson.id}/assignments`, U.shepA, { title: "Family task", status: "published" })).body;
  const fSub = (await call("POST", `${W}/family/assignments/${fAsg.id}/submissions`, U.memA, { content: "MY SUBMISSION TEXT" })).body;
  const cAsg = (await call("POST", `${W}/church/lessons/${chLesson.id}/assignments`, U.pastorX, { title: "Church task", status: "published" })).body;
  const cSub = (await call("POST", `${W}/church/assignments/${cAsg.id}/submissions`, U.memX, { content: "CHURCH SUBMISSION TEXT" })).body;
  ok("setup: reflection, assignments and submissions exist", !!ref?.id && !!fAsg?.id && !!fSub?.id && !!cAsg?.id && !!cSub?.id);

  const session = (await call("POST", "/family/worship/start", U.shepA, { familyId: FA })).body;
  await call("POST", `/family/worship/sessions/${session.id}/join`, U.memA);
  await call("PUT", `/family/worship/sessions/${session.id}/state`, U.shepA, { familyLessonId: famLesson.id });
  await call("POST", `/family/worship/sessions/${session.id}/notes`, U.memA, { content: "PRIVATE GATHERING NOTE", visibility: "private" });
  const churchCall = (await call("POST", `/churches/${CX}/calls`, U.pastorX, { title: "Study", purpose: "bible_study", scope: "church" })).body;
  await call("PUT", `/churches/calls/${churchCall.id}/lesson`, U.pastorX, { churchLessonId: chLesson.id });
  await call("PUT", `/churches/calls/${churchCall.id}/media`, U.pastorX, { provider: "youtube", id: "aaaaaaaaaaa" });

  // ── 0. Positive controls: the rightful people DO get through (so the
  // refusals below are real access decisions, not broken endpoints) ──────
  const allowed = [
    [U.memA, "GET", `/learning/family/${FA}`], [U.memA, "GET", `${W}/family/lessons/${famLesson.id}/reflections/shared`],
    [U.memA, "GET", `${W}/family/lessons/${famLesson.id}/assignments`], [U.shepA, "GET", `${W}/family/assignments/${fAsg.id}/submissions`],
    [U.memA, "GET", `/family/worship/sessions/${session.id}/lesson`], [U.memA, "GET", `/family/studies/${famStudy.id}`],
    [U.memX, "GET", `/learning/church/${CX}`], [U.memX, "GET", `/churches/calls/${churchCall.id}/lesson`], [U.memX, "GET", `/churches/calls/${churchCall.id}`],
    [U.pastorX, "GET", `${W}/church/assignments/${cAsg.id}/submissions`], [U.pastorX, "PUT", `/churches/calls/${churchCall.id}/playback`, { isPlaying: true }],
    [U.memA, "GET", "/learning/library"],
  ];
  const blocked = [];
  for (const [who, m, p, b] of allowed) { const r = await call(m, p, who, b); if (r.status !== 200) blocked.push(`${m} ${p} → ${r.status}`); }
  ok(`positive controls: all ${allowed.length} rightful requests succeed`, blocked.length === 0, blocked.join(" | "));

  // ── 1. No sign-in: every new endpoint refuses ───────────────────────────
  const anonProbes = [
    ["GET", "/learning/library"], ["GET", `/learning/curricula/${C.core}`], ["GET", `/learning/family/${FA}`], ["POST", `/learning/family/${FA}/journeys`],
    ["GET", `${W}/family/lessons/${famLesson.id}/reflections/mine`], ["GET", `${W}/family/lessons/${famLesson.id}/reflections/shared`],
    ["GET", `${W}/family/lessons/${famLesson.id}/assignments`], ["GET", `${W}/family/assignments/${fAsg.id}/submissions`],
    ["GET", `/family/worship/sessions/${session.id}/lesson`], ["GET", `/churches/calls/${churchCall.id}/lesson`],
    ["PUT", `/churches/calls/${churchCall.id}/playback`], ["PUT", "/churches/current"], ["POST", `/family/studies/${famStudy.id}/lessons`],
  ];
  const anonOpen = [];
  for (const [m, p] of anonProbes) { const r = await call(m, p, null, m === "GET" ? undefined : {}); if (r.status !== 401) anonOpen.push(`${m} ${p} → ${r.status}`); }
  ok(`no sign-in: all ${anonProbes.length} new endpoints answer 401`, anonOpen.length === 0, anonOpen.join(" | "));

  // ── 2. Another family / former member can't reach Family A by id ────────
  for (const who of [U.shepB, U.formerA, U.pastorX]) {
    const label = who === U.shepB ? "another family's Shepherd" : who === U.formerA ? "a former member" : "a church pastor (no family role)";
    const probes = [
      ["GET", `/learning/family/${FA}`], ["POST", `/learning/family/${FA}/journeys`, { curriculumId: C.core }],
      ["GET", `${W}/family/lessons/${famLesson.id}/reflections/shared`], ["GET", `${W}/family/lessons/${famLesson.id}/reflections/mine`],
      ["POST", `${W}/family/lessons/${famLesson.id}/reflections`, { questionId: RQ, content: "x" }],
      ["GET", `${W}/family/lessons/${famLesson.id}/assignments`], ["POST", `${W}/family/lessons/${famLesson.id}/assignments`, { title: "x" }],
      ["GET", `${W}/family/assignments/${fAsg.id}/submissions`], ["GET", `${W}/family/assignments/${fAsg.id}/submissions/mine`],
      ["POST", `${W}/family/assignments/${fAsg.id}/submissions`, { content: "x" }], ["POST", `${W}/family/submissions/${fSub.id}/review`, { status: "reviewed" }],
      ["PUT", `${W}/family/assignments/${fAsg.id}`, { title: "hijack" }],
      ["GET", `/family/worship/sessions/${session.id}/lesson`], ["GET", `/family/worship/sessions/${session.id}`],
      ["PUT", `/family/worship/sessions/${session.id}/state`, { familyLessonId: famLesson.id }],
      ["GET", `/family/studies/${famStudy.id}`], ["POST", `/family/studies/${famStudy.id}/lessons`, { title: "x" }],
      ["PUT", `/family/studies/${famStudy.id}/lessons/${famLesson.id}`, { title: "hijack" }],
      ["POST", `/family/studies/${famStudy.id}/lessons/${famLesson.id}/status`, { status: "archived" }],
      ["DELETE", `/family/studies/${famStudy.id}/lessons/${famDraft.id}`],
    ];
    const leaks = [];
    for (const [m, p, b] of probes) { const r = await call(m, p, who, b); if (!denied(r.status)) leaks.push(`${m} ${p} → ${r.status}`); }
    ok(`${label}: all ${probes.length} Family A requests refused`, leaks.length === 0, leaks.join(" | "));
  }
  ok("a reflection can't be re-shared by someone else guessing its id", denied((await call("PUT", `${W}/reflections/${ref.id}/visibility`, U.shepA, { visibility: "group" })).status)
    && denied((await call("PUT", `${W}/reflections/${ref.id}/visibility`, U.shepB, { visibility: "group" })).status));

  // ── 3. Another church / former member can't reach Church X ─────────────
  for (const who of [U.pastorY, U.formerX, U.shepA]) {
    const label = who === U.pastorY ? "another church's pastor" : who === U.formerX ? "a former church member" : "a family Shepherd (no church role)";
    const probes = [
      ["GET", `/learning/church/${CX}`], ["POST", `/learning/church/${CX}/journeys`, { curriculumId: C.core }],
      ["GET", `${W}/church/lessons/${chLesson.id}/assignments`], ["GET", `${W}/church/assignments/${cAsg.id}/submissions`],
      ["POST", `${W}/church/submissions/${cSub.id}/review`, { status: "reviewed" }], ["POST", `${W}/church/assignments/${cAsg.id}/submissions`, { content: "x" }],
      ["GET", `/churches/calls/${churchCall.id}`], ["GET", `/churches/calls/${churchCall.id}/lesson`], ["GET", `/churches/calls/${churchCall.id}/summary`],
      ["PUT", `/churches/calls/${churchCall.id}/lesson`, { lessonId: L.a }], ["PUT", `/churches/calls/${churchCall.id}/playback`, { isPlaying: true }],
      ["PUT", `/churches/calls/${churchCall.id}/media`, { provider: "youtube", id: "bbbbbbbbbbb" }],
      ["GET", `/churches/studies/${chStudy.id}`], ["PUT", `/churches/studies/${chStudy.id}/lessons/${chLesson.id}`, { title: "hijack" }],
      ["PUT", "/churches/current", { churchId: CX }],
    ];
    const leaks = [];
    for (const [m, p, b] of probes) { const r = await call(m, p, who, b); if (!denied(r.status)) leaks.push(`${m} ${p} → ${r.status}`); }
    ok(`${label}: all ${probes.length} Church X requests refused`, leaks.length === 0, leaks.join(" | "));
  }

  // ── 4. Plain members can't do leader-only things in their OWN group ────
  const leaderOnly = [
    [U.memA, "POST", `/learning/family/${FA}/journeys`, { curriculumId: C.core }], [U.memA, "POST", `${W}/family/lessons/${famLesson.id}/assignments`, { title: "x" }],
    [U.memA, "GET", `${W}/family/assignments/${fAsg.id}/submissions`], [U.memA, "POST", `${W}/family/submissions/${fSub.id}/review`, { status: "reviewed" }],
    [U.memA, "POST", `/family/studies/${famStudy.id}/lessons`, { title: "x" }], [U.memA, "PUT", `/family/worship/sessions/${session.id}/state`, { lessonId: L.a }],
    [U.memX, "POST", `/learning/church/${CX}/journeys`, { curriculumId: C.core }], [U.memX, "POST", `${W}/church/lessons/${chLesson.id}/assignments`, { title: "x" }],
    [U.memX, "GET", `${W}/church/assignments/${cAsg.id}/submissions`], [U.memX, "PUT", `/churches/calls/${churchCall.id}/lesson`, { lessonId: L.a }],
    [U.memX, "PUT", `/churches/calls/${churchCall.id}/playback`, { isPlaying: false }], [U.memX, "PUT", `/churches/studies/${chStudy.id}/lessons/${chLesson.id}`, { title: "x" }],
  ];
  const escalations = [];
  for (const [who, m, p, b] of leaderOnly) { const r = await call(m, p, who, b); if (!denied(r.status)) escalations.push(`${m} ${p} → ${r.status}`); }
  ok(`plain members: all ${leaderOnly.length} leader-only actions refused`, escalations.length === 0, escalations.join(" | "));

  // ── 5. Cross-scope / guessed ids (right person, wrong path) ─────────────
  const cross = [
    [U.memX, "GET", `${W}/church/assignments/${fAsg.id}/submissions/mine`], [U.memA, "GET", `${W}/family/assignments/${cAsg.id}/submissions/mine`],
    [U.pastorX, "POST", `${W}/church/submissions/${fSub.id}/review`, { status: "reviewed" }], [U.shepA, "POST", `${W}/family/submissions/${cSub.id}/review`, { status: "reviewed" }],
    [U.memA, "GET", `${W}/family/lessons/${chLesson.id}/assignments`], [U.memX, "GET", `${W}/church/lessons/${famLesson.id}/assignments`],
    [U.pastorX, "PUT", `/churches/calls/${churchCall.id}/lesson`, { churchLessonId: famLesson.id }],
    [U.shepA, "PUT", `/family/worship/sessions/${session.id}/state`, { familyLessonId: chLesson.id }],
    [U.shepA, "PUT", `/family/worship/sessions/${session.id}/state`, { familyLessonId: famDraft.id }],
  ];
  const crossLeaks = [];
  for (const [who, m, p, b] of cross) { const r = await call(m, p, who, b); if (r.status < 400) crossLeaks.push(`${m} ${p} → ${r.status}`); }
  ok(`cross-scope/guessed ids: all ${cross.length} refused`, crossLeaks.length === 0, crossLeaks.join(" | "));

  // ── 6. Privacy: what members CAN read never carries private content ────
  const sharedRefs = (await call("GET", `${W}/family/lessons/${famLesson.id}/reflections/shared`, U.shepA)).body;
  ok("a private reflection is invisible to the Shepherd", !JSON.stringify(sharedRefs).includes("MY PRIVATE REFLECTION"));
  const memLesson = (await call("GET", `/family/worship/sessions/${session.id}/lesson`, U.memA)).body;
  ok("the Gathering lesson view carries content, never answers or submissions", memLesson?.lesson?.title === "Psalm 23" && !/MY PRIVATE REFLECTION|MY SUBMISSION TEXT/.test(JSON.stringify(memLesson)));
  ok("members don't see draft family lessons", !JSON.stringify((await call("GET", `/family/studies/${famStudy.id}`, U.memA)).body).includes("DRAFT LESSON"));
  ok("a member's home lists their own work only, without others' submissions", !/SUBMISSION TEXT|PRIVATE/.test(JSON.stringify((await call("GET", `/learning/family/${FA}`, U.memA)).body)));
  await call("POST", `/family/worship/sessions/${session.id}/end`, U.shepA);
  const hid = (await call("GET", `/family/worship/history?familyId=${FA}`, U.memA)).body?.[0]?.id;
  const famSummary = await call("GET", `/family/worship/history/${hid}`, U.memA);
  ok("the Family summary never copies the private note, reflection or submission", famSummary.status === 200 && !/PRIVATE GATHERING NOTE|MY PRIVATE REFLECTION|MY SUBMISSION TEXT/.test(JSON.stringify(famSummary.body)));
  ok("another family can't read that summary by id (403)", denied((await call("GET", `/family/worship/history/${hid}`, U.shepB)).status) && denied((await call("GET", `/family/worship/history/${hid}`, U.formerA)).status));
  await call("POST", `/churches/calls/${churchCall.id}/end`, U.pastorX);
  const chSummary = await call("GET", `/churches/calls/${churchCall.id}/summary`, U.memX);
  ok("the Church summary never carries submissions", chSummary.status === 200 && !/CHURCH SUBMISSION TEXT/.test(JSON.stringify(chSummary.body)));

  // ── 7. Direct database reads as a signed-in outsider (RLS) ─────────────
  const asUser = async (uid, sql) => {
    await db.query("begin");
    try { await db.query(`select set_config('test.uid', $1, true)`, [uid]); await db.query("set local role authenticated"); return { rows: (await db.query(sql)).rows }; }
    catch (e) { return { error: e.code ?? String(e.message) }; } finally { await db.query("rollback"); }
  };
  const rlsLeaks = [];
  for (const [table, who] of [["p2p_group_assignments", U.shepB], ["p2p_group_assignment_submissions", U.shepB], ["p2p_group_assignment_submissions", U.shepA],
    ["p2p_journal_reflections", U.shepA], ["p2p_journal_reflections", U.shepB], ["p2p_group_learning_journeys", U.pastorY], ["p2p_family_study_lessons", U.shepB],
    ["p2p_church_study_lessons", U.pastorY], ["p2p_family_worship_sessions", U.shepB], ["p2p_family_worship_history", U.shepB], ["p2p_family_worship_notes", U.shepA]]) {
    const r = await asUser(who, `select to_jsonb(t) j from public.${table} t`);
    const txt = JSON.stringify(r.rows ?? []);
    if (/MY PRIVATE REFLECTION|MY SUBMISSION TEXT|CHURCH SUBMISSION TEXT|FAMILY SECRET TEACHING|CHURCH SECRET TEACHING|PRIVATE GATHERING NOTE/.test(txt) || (table.includes("worship") && who === U.shepB && (r.rows ?? []).length))
      rlsLeaks.push(`${table} as ${who.slice(-2)}: ${txt.slice(0, 120)}`);
  }
  ok("direct database reads: no outsider (or Shepherd) reads another's private/other-group rows", rlsLeaks.length === 0, rlsLeaks.join(" | "));
  // Writes: an insert must error; an update must error or change 0 rows (RLS hides every row).
  const writes = [];
  for (const sql of [`insert into public.p2p_group_learning_journeys (family_id, curriculum_id) values ('${FA}', '${C.core}') returning 1`,
    `insert into public.p2p_group_assignments (family_lesson_id, family_id, title) values ('${famLesson.id}', '${FA}', 'x') returning 1`,
    `update public.p2p_group_assignment_submissions set status = 'reviewed' returning 1`,
    `update public.p2p_journal_reflections set visibility = 'group' where user_id = '${U.memA}' returning 1`]) {
    const r = await asUser(U.shepA, sql);
    if (!r.error && (r.rows ?? []).length > 0) writes.push(`${sql.slice(0, 70)} → ${(r.rows ?? []).length} rows`);
  }
  ok("direct database writes (journeys, assignments, submissions, someone else's reflection) are refused even for a Shepherd", writes.length === 0, writes.join(" | "));
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
