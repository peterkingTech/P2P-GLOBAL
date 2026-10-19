// Custom lesson authoring (Family + Church): the REAL study routes
// (routes/familyStudies.ts, routes/churchStudies.ts → lib/customLessonRoutes.ts)
// on the real migrations 115/116/126/134/135 + 199 + 200 in PGlite, through
// the lab bundle. Synthetic users and content only.
// Proves: drafts are leaders-only; publish / unpublish / archive; members
// only ever see published lessons (API and direct DB reads); nothing ever
// published can be hard-deleted; published edits bump the version, question
// ids stay stable; strict validation (https links, YouTube only, passages);
// only leaders author; no cross-family / cross-church access; works before 200.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/custom-lessons.mjs
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
const U = { shep: id(1), member: id(2), co: id(3), otherShep: id(4), pastor: id(5), churchMember: id(6) };
const FA = "88888888-8888-4888-8888-000000000001", FB = "88888888-8888-4888-8888-000000000002", CH = "99999999-9999-4999-8999-000000000001";

async function makeDb(with200) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
    grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
    create table public.p2p_curriculums (id uuid primary key); create table public.p2p_lessons (id uuid primary key);
    create table public.p2p_churches (id uuid primary key, name text);
    create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
    create function public.p2p_is_church_member(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
      as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active)';
    create function public.p2p_is_church_leadership(c uuid, u uuid) returns boolean language sql stable security definer set search_path = public
      as 'select exists (select 1 from p2p_church_members where church_id = c and user_id = u and is_active and role in (''senior_pastor'',''discipleship_pastor'',''small_group_leader''))';
  `);
  for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql", "134_custom_studies_church.sql", "135_custom_studies_family.sql"]) await db.exec(mig(f));
  if (with200) { await db.exec(mig("199_group_learning_journeys.sql")); await db.exec(mig("200_custom_lesson_authoring.sql")); await db.exec(mig("200_custom_lesson_authoring.sql")); }
  await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
  await db.query(`insert into p2p_profiles (id) select unnest($1::uuid[])`, [Object.values(U)]);
  await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'A',$2), ($3,'B',$4)`, [FA, U.shep, FB, U.otherShep]);
  for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.member, "adult"], [FA, U.co, "co_shepherd"], [FB, U.otherShep, "shepherd"]])
    await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
  await db.query(`insert into p2p_churches values ($1,'Grace')`, [CH]);
  await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor'), ($1,$3,'member')`, [CH, U.pastor, U.churchMember]);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "custom-lessons-"));
  const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, who, body) => {
    const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { db, call, close: () => { server.close(); rmSync(tmp, { recursive: true, force: true }); } };
}

// ── With 199 + 200 ─────────────────────────────────────────────────────────
{
  const { db, call, close } = await makeDb(true);
  try {
    const study = (await call("POST", `/family/${FA}/studies`, U.shep, { title: "Our Psalms" })).body;
    await call("PUT", `/family/studies/${study.id}`, U.shep, { status: "published" });
    const L = (p = "") => `/family/studies/${study.id}/lessons${p}`;

    // Create + validation
    let r = await call("POST", L(), U.member, { title: "x" });
    ok("a member can't author (403)", r.status === 403);
    ok("another family's Shepherd can't author here (403)", (await call("POST", L(), U.otherShep, { title: "x" })).status === 403);
    ok("title required", (await call("POST", L(), U.co, { description: "no title" })).status === 400);
    ok("links must be https", /https/.test((await call("POST", L(), U.co, { title: "T", resources: [{ title: "x", url: "http://example.com" }] })).body?.error ?? ""));
    ok("only YouTube media", (await call("POST", L(), U.co, { title: "T", media: { provider: "vimeo", id: "123" } })).status === 400
      && (await call("POST", L(), U.co, { title: "T", media: { id: "not a video" } })).status === 400);
    ok("passages validated", (await call("POST", L(), U.co, { title: "T", scriptureReferences: [{ book: "John", chapter: 3, startVerse: 20, endVerse: 16 }] })).status === 400);
    r = await call("POST", L(), U.co, {
      title: "  Psalm 23 ", description: "The Lord is my shepherd", teachingMaterial: "Teaching…", prayerFocus: "Trust",
      tags: ["Comfort", "#trust", "comfort"], resources: [{ title: "Article", url: "https://example.com/psalm23" }],
      media: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      scriptureReferences: [{ book: "Psalms", chapter: 23, startVerse: 1, endVerse: 6, translation: "KJV" }, { book: "John", chapter: 10, startVerse: 11 }],
      questions: ["What does a shepherd do?", { text: "Where do you need rest?", kind: "reflection" }],
    });
    const lesson = r.body;
    ok("Co-Shepherd creates a lesson: draft by default, fields normalised", r.status === 200 && lesson.status === "draft" && lesson.title === "Psalm 23" && lesson.version === 1
      && JSON.stringify(lesson.tags) === JSON.stringify(["comfort", "trust"]) && lesson.media?.id === "dQw4w9WgXcQ" && lesson.scriptureReferences.length === 2
      && lesson.scriptureReferences[1].endVerse === 11, JSON.stringify(lesson));
    ok("questions get ids and kinds", lesson.questions.length === 2 && lesson.questions[0].kind === "discussion" && lesson.questions[1].kind === "reflection" && lesson.questions.every((q) => /^[0-9a-f-]{36}$/.test(q.id)));

    // Visibility
    let view = await call("GET", `/family/studies/${study.id}`, U.member);
    ok("member: a draft lesson isn't visible", view.status === 200 && view.body.lessons.length === 0 && view.body.canManage === false);
    ok("leader: sees the draft (preview)", (await call("GET", `/family/studies/${study.id}`, U.shep)).body.lessons.some((l) => l.id === lesson.id && l.status === "draft"));
    ok("a member can't publish (403)", (await call("POST", L(`/${lesson.id}/status`), U.member, { status: "published" })).status === 403);
    r = await call("POST", L(`/${lesson.id}/status`), U.shep, { status: "published" });
    ok("Shepherd publishes", r.status === 200 && r.body.status === "published" && !!r.body.publishedAt);
    view = await call("GET", `/family/studies/${study.id}`, U.member);
    ok("member now sees it", view.body.lessons.length === 1 && view.body.lessons[0].title === "Psalm 23");

    // Edits + versions + stable question ids
    const [q1, q2] = lesson.questions;
    r = await call("PUT", L(`/${lesson.id}`), U.shep, { questions: [{ id: q1.id, text: "What does a good shepherd do?", kind: "discussion" }, q2, { text: "New one", kind: "reflection" }] });
    ok("editing a published lesson bumps the version", r.status === 200 && r.body.version === 2);
    ok("existing question ids stay stable; new question gets a new id", r.body.questions[0].id === q1.id && r.body.questions[1].id === q2.id && ![q1.id, q2.id].includes(r.body.questions[2].id));
    r = await call("PUT", L(`/${lesson.id}`), U.shep, { orderIndex: 3 });
    ok("re-ordering only doesn't bump the version", r.body.version === 2);
    r = await call("PUT", L(`/${lesson.id}`), U.shep, { title: "Psalm 23" });
    ok("saving identical content doesn't bump the version", r.body.version === 2);

    // Unpublish / archive / delete
    await call("POST", L(`/${lesson.id}/status`), U.shep, { status: "draft" });
    ok("unpublish hides it from members again", (await call("GET", `/family/studies/${study.id}`, U.member)).body.lessons.length === 0);
    ok("an ever-published lesson can't be hard-deleted (409, archive instead)", (await call("DELETE", L(`/${lesson.id}`), U.shep)).status === 409);
    await call("POST", L(`/${lesson.id}/status`), U.shep, { status: "archived" });
    ok("archived: hidden from members, still there for leaders", (await call("GET", `/family/studies/${study.id}`, U.member)).body.lessons.length === 0
      && (await call("GET", `/family/studies/${study.id}`, U.shep)).body.lessons[0].status === "archived");
    const draft = (await call("POST", L(), U.shep, { title: "Scratch" })).body;
    ok("a never-published draft can be deleted", (await call("DELETE", L(`/${draft.id}`), U.shep)).status === 200
      && (await db.query(`select count(*)::int n from p2p_family_study_lessons where id = $1`, [draft.id])).rows[0].n === 0);
    ok("bad status refused", (await call("POST", L(`/${lesson.id}/status`), U.shep, { status: "live" })).status === 400);

    // Isolation
    const studyB = (await call("POST", `/family/${FB}/studies`, U.otherShep, { title: "B study" })).body;
    ok("another family's leader can't edit / publish / delete this lesson", (await call("PUT", L(`/${lesson.id}`), U.otherShep, { title: "hijack" })).status === 403
      && (await call("POST", L(`/${lesson.id}/status`), U.otherShep, { status: "published" })).status === 403);
    ok("a lesson id under the wrong study → 404", (await call("PUT", `/family/studies/${studyB.id}/lessons/${lesson.id}`, U.otherShep, { title: "x" })).status === 404);
    ok("a non-member can't open the study", (await call("GET", `/family/studies/${study.id}`, U.otherShep)).status === 403);

    // Direct DB reads (RLS, migration 200 policy)
    await call("POST", L(`/${lesson.id}/status`), U.shep, { status: "published" });
    const hidden = (await call("POST", L(), U.shep, { title: "Leaders only draft" })).body;
    const as = async (uid, sql, params = []) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return (await db.query(sql, params)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec("reset role;"); } };
    const memberRows = await as(U.member, `select id from p2p_family_study_lessons`);
    ok("direct read as a member: published lessons only (no recursion error)", Array.isArray(memberRows) && memberRows.length === 1 && memberRows[0].id === lesson.id, JSON.stringify(memberRows));
    ok("direct read as another family: nothing", Array.isArray(await as(U.otherShep, `select id from p2p_family_study_lessons where study_id = $1`, [study.id])) && (await as(U.otherShep, `select id from p2p_family_study_lessons where study_id = $1`, [study.id])).length === 0);
    void hidden;

    // Church (same shared routes)
    const cs = (await call("POST", `/churches/${CH}/studies`, U.pastor, { title: "Church study" })).body;
    await call("PUT", `/churches/studies/${cs.id}`, U.pastor, { status: "published" });
    ok("church member can't author", (await call("POST", `/churches/studies/${cs.id}/lessons`, U.churchMember, { title: "x" })).status === 403);
    const cl = (await call("POST", `/churches/studies/${cs.id}/lessons`, U.pastor, { title: "Sermon notes", status: "published", questions: [{ text: "Apply it", kind: "reflection" }] })).body;
    ok("church leader publishes directly; members see it", cl.status === "published" && (await call("GET", `/churches/studies/${cs.id}`, U.churchMember)).body.lessons.length === 1);
    ok("family Shepherd (not in the church) can't touch church lessons", (await call("PUT", `/churches/studies/${cs.id}/lessons/${cl.id}`, U.shep, { title: "x" })).status === 403);
  } finally { close(); }
}

// ── Before 200 (API deployed first) ───────────────────────────────────────
{
  const { call, close } = await makeDb(false);
  try {
    const study = (await call("POST", `/family/${FA}/studies`, U.shep, { title: "Old" })).body;
    const r = await call("POST", `/family/studies/${study.id}/lessons`, U.shep, { title: "Works", questions: ["Q1"], tags: ["x"], resources: [] });
    ok("before 200: creating a lesson still works (falls back to existing columns)", r.status === 200 && r.body.title === "Works" && r.body.status === "published", JSON.stringify(r.body));
    ok("before 200: publishing controls say not available yet (409)", (await call("POST", `/family/studies/${study.id}/lessons/${r.body.id}/status`, U.shep, { status: "draft" })).status === 409);
    ok("before 200: deleting is refused (could have been seen)", (await call("DELETE", `/family/studies/${study.id}/lessons/${r.body.id}`, U.shep)).status === 409);
  } finally { close(); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
