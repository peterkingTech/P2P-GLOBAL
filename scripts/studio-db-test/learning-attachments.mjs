// Learning attachments (migration 218): the REAL 218 SQL and the REAL
// /api/learning/attachments + /api/learning/work routes in PGlite (lab
// bundle, in-memory storage). Synthetic users and content only.
// Proves: the table stays closed to clients even with Supabase's default
// grants; off switch; drawings are validated and rebuilt (data, never
// markup); drafts are owner-only; core answers link BEFORE they're saved and
// only to Comprehensive Check questions; frozen copies can't be changed and
// follow their answer (learner, its peer evaluator — nobody else); group
// answers: leaders / creator only, never other members or other families,
// not after leaving; failed linking leaves no attempt; resubmission keeps
// earlier files; leftovers are cleaned; progress and reviews untouched.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/learning-attachments.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000012${String(n).padStart(2, "0")}`;
const U = { ann: id(1), ben: id(2), cara: id(3), shep: id(4), outsider: id(5), pastor: id(6) };
const FA = "aaaaaaaa-3333-4111-8111-000000000001", FB = "aaaaaaaa-3333-4111-8111-000000000002", CH = "bbbbbbbb-3333-4111-8111-000000000001";
const L1 = "dddddddd-1111-4000-8000-000000000001", ASG = "dddddddd-1111-4000-8000-000000000002";
const QA = "eeeeeeee-1111-4000-8000-000000000001", RQ = "eeeeeeee-1111-4000-8000-000000000002";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  -- Supabase's default privileges: ALL on new tables to the client roles (what 218 must undo).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
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
  create table public.p2p_assignments (id uuid primary key, lesson_id uuid, title text);
  create table public.p2p_assignment_questions (id uuid primary key, assignment_id uuid, question text);
  create table public.p2p_submissions (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid, assignment_question_id uuid, reflection_question_id uuid,
    submission_type text default 'text', text_content text, created_at timestamptz default now());
  create table public.p2p_lesson_evaluations (id uuid primary key default gen_random_uuid(), submission_id uuid, lesson_id uuid, submitter_id uuid, evaluator_id uuid,
    status text default 'pending', feedback text, resolved_at timestamptz, created_at timestamptz default now());
`);
for (const f of ["082_journal_reflections.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql",
  "134_custom_studies_church.sql", "135_custom_studies_family.sql", "199_group_learning_journeys.sql", "200_custom_lesson_authoring.sql",
  "201_lesson_reflections_assignments.sql"]) await db.exec(mig(f));
await db.exec(mig("218_learning_attachments.sql"));
await db.exec(mig("218_learning_attachments.sql")); // re-runnable

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'Name ' || right(x::text, 2) from unnest($1::uuid[]) x`, [Object.values(U)]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1,'A',$2), ($3,'B',$4)`, [FA, U.shep, FB, U.outsider]);
for (const [f, u, r] of [[FA, U.shep, "shepherd"], [FA, U.ann, "adult"], [FA, U.ben, "adult"], [FB, U.outsider, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_churches values ($1,'Grace')`, [CH]);
await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor')`, [CH, U.pastor]);
await db.query(`insert into p2p_lessons (id, title) values ($1,'Who is God?')`, [L1]);
await db.query(`insert into p2p_assignments values ($1,$2,'Comprehensive Check')`, [ASG, L1]);
await db.query(`insert into p2p_assignment_questions values ($1,$2,'Draw what you learned')`, [QA, ASG]);
const [study] = (await db.query(`insert into p2p_family_studies (family_id, created_by, title, status) values ($1,$2,'Psalms','published') returning id`, [FA, U.shep])).rows;
const [fl] = (await db.query(`insert into p2p_family_study_lessons (study_id, title, questions, status, published_at) values ($1,'Psalm 23','[]','published',now()) returning id`, [study.id])).rows;
const [gasg] = (await db.query(`insert into p2p_group_assignments (family_lesson_id, family_id, title, status, created_by) values ($1,$2,'Draw the shepherd','published',$3) returning id`, [fl.id, FA, U.shep])).rows;

const S = () => globalThis.__labStorage ?? { objects: {} };
const tmp = mkdtempSync(path.join(os.tmpdir(), "learning-attachments-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const root = `http://127.0.0.1:${server.address().port}/api/learning`;
const call = async (method, p, who, body) => {
  const r = await fetch(root + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const A = (p) => `/attachments${p}`;
const page = (strokes = [{ tool: "pen", color: "#112233", width: 3, points: [[10, 10, 0.5], [20.04, 30]] }]) => ({ background: "lined", strokes });
const doc = (pages = [page()]) => ({ version: 1, pages });
const asUser = async (uid, sql, params = []) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return (await db.query(sql, params)).rows; } catch (e) { return { error: e.message }; } finally { await db.exec("reset role;"); } };
const counts = async () => JSON.stringify((await db.query(`select (select count(*) from p2p_lesson_progress) p, (select count(*) from p2p_notifications) n`)).rows[0]);

try {
  const before = await counts();
  // ── Database: closed to clients ─────────────────────────────────────────
  const b = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'learning-work'`)).rows[0];
  ok("bucket: private, 25 MB, images/PDF/JSON only", b?.public === false && Number(b.file_size_limit) === 26214400 && b.allowed_mime_types.length === 5);
  const priv = (await db.query(`select has_table_privilege('authenticated','public.p2p_learning_attachments','select') s, has_table_privilege('anon','public.p2p_learning_attachments','insert') i,
    has_table_privilege('service_role','public.p2p_learning_attachments','select,insert,update,delete') sr, (select count(*)::int from pg_policies where tablename = 'p2p_learning_attachments') pols,
    (select relrowsecurity from pg_class where oid = 'public.p2p_learning_attachments'::regclass) rls`)).rows[0];
  ok("table: RLS on, no client policies, default grants revoked, API has full access", priv.rls && priv.pols === 0 && !priv.s && !priv.i && priv.sr, JSON.stringify(priv));
  ok("a signed-in client can't read the table directly", !!(await asUser(U.ann, `select * from p2p_learning_attachments`)).error);

  // ── Off switch ──────────────────────────────────────────────────────────
  delete process.env.LEARNING_ATTACHMENTS;
  ok("switched off: status says so, nothing can be added", (await call("GET", A("/status"), U.ann)).body.enabled === false
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc() })).status === 503 && (await call("POST", A("/uploads"), U.ann, { fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 10 })).status === 503);
  process.env.LEARNING_ATTACHMENTS = "on";
  ok("signed out → 401", (await call("POST", A("/handwriting"), null, { doc: doc() })).status === 401);

  // ── Drawings ────────────────────────────────────────────────────────────
  ok("bad drawings refused: wrong version, no pages, 21 pages, point off the page, bad colour, unknown tool",
    (await call("POST", A("/handwriting"), U.ann, { doc: { version: 2, pages: [page()] } })).status === 400
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc([]) })).status === 400
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc(Array.from({ length: 21 }, () => page())) })).status === 400
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc([page([{ tool: "pen", color: "#000000", width: 2, points: [[5000, 1]] }])]) })).status === 400
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc([page([{ tool: "pen", color: "red", width: 2, points: [[1, 1]] }])]) })).status === 400
    && (await call("POST", A("/handwriting"), U.ann, { doc: doc([page([{ tool: "laser", color: "#000000", width: 2, points: [[1, 1]] }])]) })).status === 400);
  const tricky = { version: 1, extra: "<script>x</script>", pages: [{ background: "lined", onload: "x", strokes: [{ tool: "pen", color: "#AABBCC", width: 3, points: [[10.123, 20.987, 0.555]], href: "javascript:x" }] }] };
  let r = await call("POST", A("/handwriting"), U.ann, { doc: tricky, caption: "My drawing of creation" });
  const d1 = r.body;
  ok("Ann saves a drawing draft", r.status === 200 && d1.kind === "handwriting" && d1.pageCount === 1 && d1.submitted === false && d1.caption === "My drawing of creation", JSON.stringify(r.body));
  const stored = S().objects[`learning-work/${U.ann}/${d1.id}/drawing.json`]?.body ?? "";
  ok("stored as rebuilt data only: unknown keys and markup dropped, numbers rounded", !/script|onload|javascript|extra/.test(stored) && stored.includes('"color":"#aabbcc"') && stored.includes("[10.1,21,0.56]"), stored);
  ok("only Ann can open her draft", (await call("GET", A(`/${d1.id}/content`), U.ann)).body?.doc?.pages?.length === 1
    && (await call("GET", A(`/${d1.id}/content`), U.ben)).status === 404 && (await call("GET", A(`/${d1.id}/content`), U.shep)).status === 404);
  ok("only Ann can change or remove it", (await call("PUT", A(`/handwriting/${d1.id}`), U.ben, { doc: doc() })).status === 404 && (await call("DELETE", A(`/${d1.id}`), U.ben)).status === 404);
  ok("big drawings travel in the body (over the default 100 KB limit)", (await call("PUT", A(`/handwriting/${d1.id}`), U.ann, { doc: doc([page(Array.from({ length: 60 }, () => ({ tool: "pen", color: "#000000", width: 2, points: Array.from({ length: 200 }, (_, i) => [i, i]) })))]) })).status === 200);
  await call("PUT", A(`/handwriting/${d1.id}`), U.ann, { doc: doc([page(), page()]) });
  ok("Ann's drafts list shows it (2 pages now)", (await call("GET", A("/mine"), U.ann)).body.attachments.some((x) => x.id === d1.id && x.pageCount === 2)
    && (await call("GET", A("/mine"), U.ben)).body.attachments.length === 0);

  // ── Files ───────────────────────────────────────────────────────────────
  ok("files: only photos and PDFs, type must match name, 25 MB",
    (await call("POST", A("/uploads"), U.ann, { fileName: "a.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sizeBytes: 10 })).status === 400
    && (await call("POST", A("/uploads"), U.ann, { fileName: "a.exe", mimeType: "image/jpeg", sizeBytes: 10 })).status === 400
    && (await call("POST", A("/uploads"), U.ann, { fileName: "a.jpg", mimeType: "image/jpeg", sizeBytes: 26 * 1024 * 1024 })).status === 400);
  r = await call("POST", A("/uploads"), U.ann, { fileName: "../../My Notes.jpg", mimeType: "image/jpeg", sizeBytes: 1200 });
  const up = r.body;
  ok("upload: signed URL for one server-made path under Ann's folder", r.status === 200 && up.path === `${U.ann}/${up.attachmentId}/My_Notes.jpg`, JSON.stringify(r.body));
  ok("complete before the file arrives → 409", (await call("POST", A(`/${up.attachmentId}/complete`), U.ann)).status === 409);
  ok("retry gives a fresh URL for the same path", (await call("POST", A(`/${up.attachmentId}/retry-url`), U.ann)).body?.path === up.path);
  S().objects[`learning-work/${up.path}`] = { size: 1200, body: "jpeg" };
  ok("complete: checked and ready", (await call("POST", A(`/${up.attachmentId}/complete`), U.ann)).body?.status === "ready");
  ok("a 5-minute link for Ann; nobody else", (await call("GET", A(`/${up.attachmentId}/link`), U.ann)).body?.url?.includes("ttl=300") && (await call("GET", A(`/${up.attachmentId}/link`), U.ben)).status === 404);
  const pending = (await call("POST", A("/uploads"), U.ann, { fileName: "b.pdf", mimeType: "application/pdf", sizeBytes: 50 })).body;

  // ── Core answer: link first, then the existing insert ──────────────────
  const SUB = "99999999-0000-4000-8000-000000000001";
  ok("never to a reflection / another lesson's question", (await call("POST", A("/link"), U.ann, { submissionId: SUB, lessonId: L1, assignmentQuestionId: RQ, attachmentIds: [d1.id] })).status === 400);
  ok("an unfinished upload can't be sent", (await call("POST", A("/link"), U.ann, { submissionId: SUB, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d1.id, pending.attachmentId] })).status === 409);
  ok("someone else's draft can't be sent", (await call("POST", A("/link"), U.ben, { submissionId: SUB, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d1.id] })).status === 404);
  r = await call("POST", A("/link"), U.ann, { submissionId: SUB, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d1.id, up.attachmentId], captions: { [up.attachmentId]: "Page from my notebook" } });
  ok("Ann links her drawing + photo to the answer she's about to save", r.status === 200 && r.body.attachments.length === 2 && r.body.attachments.every((x) => x.submitted), JSON.stringify(r.body));
  const frozen = r.body.attachments;
  ok("before the answer exists, nobody can open the copies (not even Ann)", (await call("GET", A(`/${frozen[0].id}/content`), U.ann)).status === 404
    && Object.keys((await call("GET", A(`/for?kind=core_submission&ids=${SUB}`), U.ann)).body.attachments).length === 0);
  ok("a second link to the same answer is refused", (await call("POST", A("/link"), U.ann, { submissionId: SUB, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d1.id] })).status === 409);
  // The app now saves the answer exactly as before (client insert); the evaluator trigger names Ben.
  await db.query(`insert into p2p_submissions (id, user_id, lesson_id, assignment_question_id, text_content) values ($1,$2,$3,$4,'(Answer given as a drawing…)')`, [SUB, U.ann, L1, QA]);
  await db.query(`insert into p2p_lesson_evaluations (submission_id, lesson_id, submitter_id, evaluator_id) values ($1,$2,$3,$4)`, [SUB, L1, U.ann, U.ben]);
  const forAs = async (who, kind, ids) => (await call("GET", A(`/for?kind=${kind}&ids=${ids.join(",")}`), who)).body.attachments;
  ok("after saving: Ann and her peer evaluator see both files", (await forAs(U.ann, "core_submission", [SUB]))[SUB]?.length === 2 && (await forAs(U.ben, "core_submission", [SUB]))[SUB]?.length === 2);
  ok("the evaluator opens the drawing; a stranger, the Shepherd and a church leader can't", (await call("GET", A(`/${frozen[0].id}/content`), U.ben)).body?.doc?.pages?.length === 2
    && (await call("GET", A(`/${frozen[0].id}/content`), U.cara)).status === 404 && (await call("GET", A(`/${frozen[0].id}/content`), U.shep)).status === 404
    && !(await forAs(U.cara, "core_submission", [SUB]))[SUB] && !(await forAs(U.pastor, "core_submission", [SUB]))[SUB]);
  ok("caption chosen at send time kept on the copy", (await forAs(U.ann, "core_submission", [SUB]))[SUB].some((x) => x.caption === "Page from my notebook"));
  ok("sent copies can't be edited or removed (even by Ann)", (await call("PUT", A(`/handwriting/${frozen[0].id}`), U.ann, { doc: doc() })).status === 404
    && (await call("DELETE", A(`/${frozen[0].id}`), U.ann)).status === 404 && (await call("PATCH", A(`/${frozen[1].id}`), U.ann, { caption: "x" })).status === 404);
  await call("PUT", A(`/handwriting/${d1.id}`), U.ann, { doc: doc([page()]) });
  ok("editing the draft later doesn't change what was sent", (await call("GET", A(`/${frozen[0].id}/content`), U.ben)).body.doc.pages.length === 2
    && (await call("GET", A(`/${d1.id}/content`), U.ann)).body.doc.pages.length === 1);
  ok("files can't be added to an answer after it was sent", (await call("POST", A("/link"), U.ann, { submissionId: SUB, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d1.id] })).status === 409);

  // ── Family answers through /learning/work ──────────────────────────────
  const W = (p) => `/work${p}`;
  const d2 = (await call("POST", A("/handwriting"), U.ann, { doc: doc() })).body;
  ok("a stranger's attachment can't ride on Ben's answer — and no attempt is left behind", (await call("POST", W(`/family/assignments/${gasg.id}/submissions`), U.ben, { content: "", attachmentIds: [d2.id] })).status === 404
    && (await db.query(`select count(*)::int n from p2p_group_assignment_submissions where user_id = $1`, [U.ben])).rows[0].n === 0);
  ok("nothing typed and nothing attached → refused", (await call("POST", W(`/family/assignments/${gasg.id}/submissions`), U.ann, { content: " " })).status === 400);
  r = await call("POST", W(`/family/assignments/${gasg.id}/submissions`), U.ann, { content: "", attachmentIds: [d2.id] });
  const g1 = r.body;
  ok("Ann answers with only a drawing: the attempt carries words for older apps", r.status === 200 && g1.attempt === 1 && /drawing or file/.test(g1.content), JSON.stringify(r.body));
  ok("the Shepherd (reviewer) sees it; Ben (member), another family and a church leader don't", (await forAs(U.shep, "group_submission", [g1.id]))[g1.id]?.length === 1
    && !(await forAs(U.ben, "group_submission", [g1.id]))[g1.id] && !(await forAs(U.outsider, "group_submission", [g1.id]))[g1.id] && !(await forAs(U.pastor, "group_submission", [g1.id]))[g1.id]);
  await db.query(`update p2p_group_assignment_submissions set status = 'returned', feedback = 'Add the still waters.' where id = $1`, [g1.id]);
  await call("PUT", A(`/handwriting/${d2.id}`), U.ann, { doc: doc([page(), page(), page()]) });
  const g2 = (await call("POST", W(`/family/assignments/${gasg.id}/submissions`), U.ann, { content: "Revised", attachmentIds: [d2.id] })).body;
  const both = await forAs(U.shep, "group_submission", [g1.id, g2.id]);
  ok("resubmission: attempt 2 has its own copy; attempt 1's file is kept as it was", g2.attempt === 2 && both[g1.id]?.[0].pageCount === 1 && both[g2.id]?.[0].pageCount === 3);
  await db.query(`update p2p_family_members set status = 'left' where family_id = $1 and user_id = $2`, [FA, U.shep]);
  await db.query(`update p2p_families set shepherd_id = $2 where id = $1`, [FA, U.ben]); // leadership handed on
  ok("after the Shepherd leaves, they can't open it any more; Ann still can", !(await forAs(U.shep, "group_submission", [g1.id]))[g1.id] && (await forAs(U.ann, "group_submission", [g1.id]))[g1.id]?.length === 1);
  ok("limit: at most 3 drawings on one answer", await (async () => {
    const ids = []; for (let i = 0; i < 4; i++) ids.push((await call("POST", A("/handwriting"), U.cara, { doc: doc() })).body.id);
    return (await call("POST", A("/link"), U.cara, { submissionId: "99999999-0000-4000-8000-000000000002", lessonId: L1, assignmentQuestionId: QA, attachmentIds: ids })).status === 400;
  })());

  // ── Leftovers ───────────────────────────────────────────────────────────
  const GHOST = "99999999-0000-4000-8000-000000000003";
  const d3 = (await call("POST", A("/handwriting"), U.ann, { doc: doc() })).body;
  await call("POST", A("/link"), U.ann, { submissionId: GHOST, lessonId: L1, assignmentQuestionId: QA, attachmentIds: [d3.id] }); // the app never saved this answer
  await db.query(`update p2p_learning_attachments set created_at = now() - interval '2 days' where owner_id = $1`, [U.ann]);
  await call("GET", A("/mine"), U.ann);
  await new Promise((res) => setTimeout(res, 300));
  const left = (await db.query(`select target_id, status from p2p_learning_attachments where owner_id = $1`, [U.ann])).rows;
  ok("cleanup: unsaved answers' copies and unfinished uploads go; sent work and drafts stay",
    !left.some((x) => x.target_id === GHOST) && !left.some((x) => x.status === "pending") && left.filter((x) => x.target_id === SUB).length === 2 && left.some((x) => !x.target_id));
  ok("progress and notifications untouched", (await counts()) === before);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`learning-attachments: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
