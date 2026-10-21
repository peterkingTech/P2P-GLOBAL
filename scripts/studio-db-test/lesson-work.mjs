// Reflections + assignments on custom lessons: the REAL /api/learning/work
// routes (routes/lessonWork.ts) on the real journal migration (082), family +
// church custom-study migrations (115/116/126/134/135) and 199 + 200 + 201, in
// PGlite through the lab bundle. Synthetic users and content only.
// Proves: reflections are private by default and shared only as the writer
// chooses (leaders vs group), never to other groups, never after the writer
// leaves; answers are kept as a journal chain; assignments: drafts hidden,
// attempts never overwritten, resubmission rules, review/return with feedback,
// only reviewers see submissions, notifications carry no content; lesson
// progress untouched; direct DB reads/writes stay locked down.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/lesson-work.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, "0")}`;
const U = { shep: id(1), ann: id(2), ben: id(3), co: id(4), outsider: id(5), pastor: id(6), cmember: id(7) };
const FA = "aaaaaaaa-1111-4111-8111-000000000001", FB = "aaaaaaaa-1111-4111-8111-000000000002", CH = "bbbbbbbb-1111-4111-8111-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text);
  create table public.p2p_lessons (id uuid primary key); create table public.p2p_curriculums (id uuid primary key);
  create table public.p2p_sessions (id uuid primary key); create table public.p2p_discipleship_links (id uuid primary key);
  create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, status text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
  create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
`);
for (const f of ["082_journal_reflections.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql",
  "134_custom_studies_church.sql", "135_custom_studies_family.sql", "199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql",
  "201_lesson_reflections_assignments.sql", "201_lesson_reflections_assignments.sql"]) await db.exec(mig(f));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'Name ' || right(x::text, 2) from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'A',$2), ($3,'B',$4)`, [FA, U.shep, FB, U.outsider]);
for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.ann, "adult"], [FA, U.ben, "adult"], [FA, U.co, "co_shepherd"], [FB, U.outsider, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_churches values ($1,'Grace')`, [CH]);
await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor'), ($1,$3,'member')`, [CH, U.pastor, U.cmember]);
// A published family study with one published lesson (1 discussion + 1 reflection question) and one draft lesson.
const RQ = "cccccccc-1111-4111-8111-000000000001", DQ = "cccccccc-1111-4111-8111-000000000002";
const [study] = (await db.query(`insert into p2p_family_studies (family_id, created_by, title, status) values ($1,$2,'Psalms','published') returning id`, [FA, U.shep])).rows;
const [lesson] = (await db.query(`insert into p2p_family_study_lessons (study_id, title, questions, status, published_at, version) values ($1,'Psalm 23',$2,'published',now(),3) returning id`,
  [study.id, JSON.stringify([{ id: DQ, text: "What does a shepherd do?", kind: "discussion" }, { id: RQ, text: "Where do you need rest?", kind: "reflection" }])])).rows;
const [draftLesson] = (await db.query(`insert into p2p_family_study_lessons (study_id, title, questions, status) values ($1,'Draft',$2,'draft') returning id`, [study.id, JSON.stringify([{ id: RQ, text: "x", kind: "reflection" }])])).rows;

const tmp = mkdtempSync(path.join(os.tmpdir(), "lesson-work-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/learning/work`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const L = `/family/lessons/${lesson.id}`;
const shared = async (who) => ((await call("GET", `${L}/reflections/shared`, who)).body?.reflections ?? []).map((r) => r.author.id);

try {
  // ── Reflections ────────────────────────────────────────────────────────
  ok("only reflection questions can be answered here", (await call("POST", `${L}/reflections`, U.ann, { questionId: DQ, content: "x" })).status === 400);
  ok("a draft lesson isn't answerable by members", (await call("POST", `/family/lessons/${draftLesson.id}/reflections`, U.ann, { questionId: RQ, content: "x" })).status === 404);
  ok("another family can't reach the lesson", (await call("POST", `${L}/reflections`, U.outsider, { questionId: RQ, content: "x" })).status === 403);
  let r = await call("POST", `${L}/reflections`, U.ann, { questionId: RQ, content: "  I need rest at work.  " });
  ok("Ann answers — private by default", r.status === 200 && r.body.visibility === "private");
  const journal = (await db.query(`select * from p2p_journal_reflections where user_id = $1`, [U.ann])).rows[0];
  ok("it's a journal entry: question as prompt, lesson + question + version linked, chain root = itself", journal.prompt === "Where do you need rest?" && journal.content === "I need rest at work."
    && journal.family_lesson_id === lesson.id && journal.question_id === RQ && journal.lesson_version === 3 && journal.root_id === journal.id);
  ok("private: neither the Shepherd nor Ben sees it", !(await shared(U.shep)).includes(U.ann) && !(await shared(U.ben)).includes(U.ann));
  ok("Ann sees her own answer", (await call("GET", `${L}/reflections/mine`, U.ann)).body.reflections[0]?.content === "I need rest at work.");

  await call("PUT", `/reflections/${journal.id}/visibility`, U.ann, { visibility: "leaders" });
  ok("shared with leaders: Shepherd and Co-Shepherd see it; Ben doesn't", (await shared(U.shep)).includes(U.ann) && (await shared(U.co)).includes(U.ann) && !(await shared(U.ben)).includes(U.ann));
  r = await call("POST", `${L}/reflections`, U.ann, { questionId: RQ, content: "Updated: rest on Sundays.", visibility: "group" });
  const chain = (await db.query(`select id, root_id, parent_id, visibility from p2p_journal_reflections where user_id = $1 order by created_at`, [U.ann])).rows;
  ok("re-answering continues the chain (history kept), visibility follows the latest choice", chain.length === 2 && chain[1].root_id === chain[0].id && chain[1].parent_id === chain[0].id && chain.every((c) => c.visibility === "group"));
  const benView = (await call("GET", `${L}/reflections/shared`, U.ben)).body.reflections;
  ok("shared with the group: Ben sees only the latest answer", benView.length === 1 && benView[0].content === "Updated: rest on Sundays." && benView[0].author.id === U.ann);
  await call("POST", `${L}/reflections`, U.ann, { questionId: RQ, content: "Keeping this one to myself.", visibility: "private" });
  ok("going back to private hides the whole chain (no older answer left shared)", !(await shared(U.ben)).includes(U.ann) && !(await shared(U.shep)).includes(U.ann));
  ok("nobody can change someone else's sharing (404, existence not revealed)", (await call("PUT", `/reflections/${journal.id}/visibility`, U.shep, { visibility: "group" })).status === 404);
  await call("PUT", `/reflections/${journal.id}/visibility`, U.ann, { visibility: "group" });
  await db.query(`update p2p_family_members set status = 'left' where family_id = $1 and user_id = $2`, [FA, U.ann]);
  ok("once the writer leaves the family, their shared reflection is no longer shown", !(await shared(U.ben)).includes(U.ann));
  await db.query(`update p2p_family_members set status = 'active' where family_id = $1 and user_id = $2`, [FA, U.ann]);
  const asUser = async (uid, sql, params = []) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return (await db.query(sql, params)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec("reset role;"); } };
  ok("journal rows stay owner-only in the database (Ben and the Shepherd read none of Ann's)", (await asUser(U.ben, `select id from p2p_journal_reflections where user_id = $1`, [U.ann])).length === 0
    && (await asUser(U.shep, `select id from p2p_journal_reflections where user_id = $1`, [U.ann])).length === 0);

  // ── Assignments ────────────────────────────────────────────────────────
  ok("a member can't create assignments", (await call("POST", `${L}/assignments`, U.ann, { title: "x" })).status === 403);
  ok("validation: due date, https links", (await call("POST", `${L}/assignments`, U.co, { title: "x", dueAt: "soon" })).status === 400
    && (await call("POST", `${L}/assignments`, U.co, { title: "x", resources: [{ url: "http://x.y" }] })).status === 400);
  r = await call("POST", `${L}/assignments`, U.co, { title: "Write a psalm", instructions: "Six lines.", dueAt: "2026-11-01T18:00:00Z", allowResubmission: false });
  const asg = r.body;
  ok("Co-Shepherd creates a draft assignment", r.status === 200 && asg.status === "draft" && asg.allowResubmission === false);
  ok("members don't see drafts", (await call("GET", `${L}/assignments`, U.ann)).body.assignments.length === 0
    && (await call("GET", `/family/assignments/${asg.id}/submissions/mine`, U.ann)).status === 404);
  await call("PUT", `/family/assignments/${asg.id}`, U.co, { status: "published" });
  ok("published: members see it, not started", (await call("GET", `${L}/assignments`, U.ann)).body.assignments[0]?.mySubmission === null);

  ok("empty answer refused", (await call("POST", `/family/assignments/${asg.id}/submissions`, U.ann, { content: "  " })).status === 400);
  r = await call("POST", `/family/assignments/${asg.id}/submissions`, U.ann, { content: "The Lord is my shepherd…" });
  ok("Ann submits attempt 1", r.status === 200 && r.body.attempt === 1 && r.body.status === "submitted");
  ok("no resubmission while it's not returned (this assignment doesn't allow it)", (await call("POST", `/family/assignments/${asg.id}/submissions`, U.ann, { content: "again" })).status === 409);
  ok("members can't see others' submissions (403)", (await call("GET", `/family/assignments/${asg.id}/submissions`, U.ben)).status === 403);
  const subs = (await call("GET", `/family/assignments/${asg.id}/submissions`, U.shep)).body;
  ok("leader sees the latest attempt per member", subs.submissions.length === 1 && subs.submissions[0].author.id === U.ann && subs.submissions[0].attempts === 1);
  ok("returning work needs feedback", (await call("POST", `/family/submissions/${r.body.id}/review`, U.shep, { status: "returned" })).status === 400);
  ok("another family's Shepherd can't review (404)", (await call("POST", `/family/submissions/${r.body.id}/review`, U.outsider, { status: "reviewed" })).status === 404);
  const notesBefore = (await db.query(`select count(*)::int n from p2p_notifications`)).rows[0].n;
  ok("Shepherd returns it with feedback", (await call("POST", `/family/submissions/${r.body.id}/review`, U.shep, { status: "returned", feedback: "Add a closing line." })).body?.status === "returned");
  const note = (await db.query(`select * from p2p_notifications order by created_at desc limit 1`)).rows[0];
  ok("Ann is notified — no answer or feedback text in the notification", (await db.query(`select count(*)::int n from p2p_notifications`)).rows[0].n === notesBefore + 1 && note.user_id === U.ann
    && note.notification_type === "assignment_reviewed" && !JSON.stringify(note).includes("closing line") && !JSON.stringify(note).includes("shepherd…"));
  r = await call("POST", `/family/assignments/${asg.id}/submissions`, U.ann, { content: "…and I will dwell in His house." });
  ok("returned → Ann resubmits as attempt 2; attempt 1 kept with its feedback", r.body.attempt === 2
    && (await call("GET", `/family/assignments/${asg.id}/submissions/mine`, U.ann)).body.attempts.map((a) => `${a.attempt}:${a.status}:${a.feedback ?? ""}`).join("|") === "1:returned:Add a closing line.|2:submitted:");
  await db.query(`update p2p_family_members set role = 'adult' where family_id = $1 and user_id = $2`, [FA, U.co]);
  ok("the assignment's creator can still review after stepping down as Co-Shepherd", (await call("GET", `/family/assignments/${asg.id}/submissions`, U.co)).status === 200);
  ok("…but not after leaving the family", await (async () => { await db.query(`update p2p_family_members set status = 'left' where family_id = $1 and user_id = $2`, [FA, U.co]); const s = (await call("GET", `/family/assignments/${asg.id}/submissions`, U.co)).status; await db.query(`update p2p_family_members set status = 'active' where family_id = $1 and user_id = $2`, [FA, U.co]); return s !== 200; })());
  ok("lesson completion untouched by reflections / assignments", (await db.query(`select count(*)::int n from p2p_lesson_progress`)).rows[0].n === 0);

  // Direct database access
  const own = await asUser(U.ann, `select id from p2p_group_assignment_submissions`);
  ok("direct DB: Ann reads only her own submissions; Ben reads none of hers", Array.isArray(own) && own.length === 2 && (await asUser(U.ben, `select id from p2p_group_assignment_submissions`)).length === 0);
  ok("direct DB: no one can write submissions or assignments directly", !!(await asUser(U.ann, `insert into p2p_group_assignment_submissions (assignment_id, user_id, content) values ($1, $2, 'x')`, [asg.id, U.ann])).error
    && !!(await asUser(U.shep, `update p2p_group_assignments set status = 'archived'`)).error);
  ok("direct DB: other families don't see the assignment", (await asUser(U.outsider, `select id from p2p_group_assignments`)).length === 0 && (await asUser(U.ben, `select id from p2p_group_assignments`)).length === 1);

  // ── Church scope ───────────────────────────────────────────────────────
  const [cs] = (await db.query(`insert into p2p_church_studies (church_id, created_by, title, status) values ($1,$2,'Sermon','published') returning id`, [CH, U.pastor])).rows;
  const [cl] = (await db.query(`insert into p2p_church_study_lessons (study_id, title, questions, status) values ($1,'Week 1',$2,'published') returning id`, [cs.id, JSON.stringify([{ id: RQ, text: "Apply it", kind: "reflection" }])])).rows;
  const ca = (await call("POST", `/church/lessons/${cl.id}/assignments`, U.pastor, { title: "Memorise", status: "published" })).body;
  ok("church: leader publishes, member submits, family members can't reach it", ca.status === "published"
    && (await call("POST", `/church/assignments/${ca.id}/submissions`, U.cmember, { content: "Done" })).status === 200
    && (await call("POST", `/church/assignments/${ca.id}/submissions`, U.ann, { content: "x" })).status === 404);
  ok("church: family-scoped path can't reach a church assignment", (await call("GET", `/family/assignments/${ca.id}/submissions/mine`, U.cmember)).status === 404);

  // ── Learning home: "Waiting on you" (Prompt 8) ──────────────────────────
  const home = async (who, scope = "family", g = FA) => {
    const res = await fetch(base.replace("/learning/work", `/learning/${scope}/${g}`), { headers: { authorization: `Bearer ${who}` } });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  let h = await home(U.ben);
  ok("to-do: a member who hasn't submitted sees the assignment (not started), with its lesson", h.status === 200 && h.body.work.toDo.length === 1
    && h.body.work.toDo[0].assignmentId === asg.id && h.body.work.toDo[0].state === "not_started" && h.body.work.toDo[0].lessonTitle === "Psalm 23", JSON.stringify(h.body?.work));
  ok("to-review: members get none", h.body.work.toReview.length === 0);
  ok("whoever set an assignment isn't asked to do it", !(await home(U.co)).body.work.toDo.some((a) => a.assignmentId === asg.id));
  ok("to-do: a member whose latest attempt is submitted has nothing to do", (await home(U.ann)).body.work.toDo.length === 0);
  h = await home(U.shep);
  ok("to-review: the Shepherd sees 1 submission waiting (latest attempt only)", h.body.work.toReview.length === 1 && h.body.work.toReview[0].waiting === 1, JSON.stringify(h.body.work));
  const annLatest = (await call("GET", `/family/assignments/${asg.id}/submissions/mine`, U.ann)).body.attempts.at(-1);
  await call("POST", `/family/submissions/${annLatest.id}/review`, U.shep, { status: "returned", feedback: "One more line." });
  ok("returned work comes back to the member's to-do (state: returned)", (await home(U.ann)).body.work.toDo[0]?.state === "returned");
  ok("…and leaves the Shepherd's review list", (await home(U.shep)).body.work.toReview.length === 0);
  ok("no answers or feedback in the home payload", !JSON.stringify((await home(U.shep)).body.work).includes("dwell") && !JSON.stringify((await home(U.ann)).body.work).includes("One more line"));
  ok("family: no per-member progress (no visibility rule for it)", (await home(U.shep)).body.memberProgress === null);
  ok("another family can't read this home (403)", (await home(U.outsider)).status === 403);
  h = await home(U.pastor, "church", CH);
  ok("church: pastor sees the member's submission waiting; member has nothing to do", h.body.work.toReview[0]?.assignmentId === ca.id && h.body.work.toReview[0].waiting === 1
    && (await home(U.cmember, "church", CH)).body.work.toDo.length === 0, JSON.stringify(h.body.work));
  ok("church: no journey → no member progress", h.body.memberProgress === null);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
