// Regression tests for the 2026-10-21 fix pack, on the REAL API routes over
// PGlite (lab bundle). Synthetic data only; no network (API.Bible stubbed,
// storage in memory).
//   • Prompt 5 — POST /bible/passage: without the API key only cached verses
//     can be served; an uncached passage now says "not set up" (503) instead
//     of "not found" (why Psalm 23 worked and Genesis 1 didn't).
//   • Prompt 6 — GET /learning/library at production scale (572 modules,
//     1,787 lessons): batched + paged queries list every curriculum.
//   • Prompt 10 — Files & Resources (migration 209): members only, type/size
//     validation, server-chosen paths, upload confirmation, 5-minute signed
//     download links, deletion rights, cross-group denial, and access ending
//     when someone leaves.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/pack-fixes.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp, makeTranslator } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { shep: id(1), adult: id(2), child: id(3), otherFam: id(4), pastor: id(5), churchMember: id(6), outsider: id(7) };
const FAM = id(100), FAM2 = id(101), CH = id(200);

// API.Bible stub (only its host).
const realFetch = globalThis.fetch;
const providerCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.scripture.api.bible/")) return realFetch(url, init);
  providerCalls.push(u);
  const m = u.match(/\/verses\/([A-Z0-9]+)\.(\d+)\.(\d+)\?/);
  if (m) return new Response(JSON.stringify({ data: { content: `  Verse text ${m[1]} ${m[2]}:${m[3]}  ` } }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("{}", { status: 404 });
};
delete process.env.API_BIBLE_KEY; delete process.env.API_Bible;

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
  create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
  create table public.p2p_families (id uuid primary key, name text, shepherd_id uuid);
  create table public.p2p_family_members (id uuid primary key default gen_random_uuid(), family_id uuid, user_id uuid, role text, status text default 'active');
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create table public.p2p_bible_translations (id uuid primary key default gen_random_uuid(), language text, translation_code text, translation_name text,
    is_default_for_language boolean, provider text, api_bible_id text, license_notes text, is_licensed_confirmed boolean);
  create table public.p2p_bible_verses_cache (translation_code text, book text, chapter int, verse int, verse_text text, fetched_at timestamptz, primary key (translation_code, book, chapter, verse));
  create table public.p2p_curriculums (id uuid primary key, title text, subtitle text, type text, status text, is_visible boolean default true,
    parent_category_id uuid, display_order int, cover_image text, thumbnail_url text);
  create table public.p2p_modules (id uuid primary key, curriculum_id uuid, title text, order_index int);
  create table public.p2p_lessons (id uuid primary key, module_id uuid, title text, order_index int, status text);
`);
for (const [name, uid] of Object.entries(U)) await db.query(`insert into p2p_profiles (id, full_name) values ($1,$2)`, [uid, name]);
await db.query(`insert into p2p_families values ($1,'Mensah',$2),($3,'Owusu',$4)`, [FAM, U.shep, FAM2, U.otherFam]);
for (const [f, u, r] of [[FAM, U.shep, "shepherd"], [FAM, U.adult, "adult"], [FAM, U.child, "child"], [FAM2, U.otherFam, "shepherd"]])
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1,$2,$3)`, [f, u, r]);
await db.query(`insert into p2p_church_members (church_id, user_id, role) values ($1,$2,'senior_pastor'),($1,$3,'member')`, [CH, U.pastor, U.churchMember]);
await db.query(`insert into p2p_bible_translations (language, translation_code, translation_name, is_default_for_language, provider, api_bible_id, license_notes, is_licensed_confirmed)
  values ('en','KJV','King James Version',true,'api_bible','kjv-id','Public domain',true)`);
await db.query(`insert into p2p_bible_verses_cache values ('KJV','PSA',23,1,'The LORD is my shepherd; I shall not want.', now())`);

// Library at production scale: 3 Core + 140 Plans in 10 categories, 572 modules, 1,787 published lessons (+ drafts).
let n = 10_000;
const curr = [];
for (let i = 0; i < 3; i++) curr.push({ id: id(n++), type: "core", status: "published", parent: null });
curr.push({ id: id(n++), type: "core", status: "draft", parent: null });
const cats = Array.from({ length: 10 }, () => ({ id: id(n++), type: "plan_category", status: "published", parent: null }));
for (let i = 0; i < 140; i++) curr.push({ id: id(n++), type: "plan", status: "published", parent: cats[i % 10].id });
await db.query(`insert into p2p_curriculums (id, title, type, status, parent_category_id, display_order) select (x->>'id')::uuid, 'C ' || (x->>'id'), x->>'type', x->>'status', nullif(x->>'parent','')::uuid, 1 from jsonb_array_elements($1::jsonb) x`,
  [JSON.stringify([...curr, ...cats].map((c) => ({ ...c, parent: c.parent ?? "" })))]);
const selectable = curr.filter((c) => c.status === "published");
const modules = [];
for (let i = 0; i < 572; i++) modules.push({ id: id(n++), c: selectable[i % selectable.length].id });
await db.query(`insert into p2p_modules (id, curriculum_id, title, order_index) select (x->>'id')::uuid, (x->>'c')::uuid, 'M', 1 from jsonb_array_elements($1::jsonb) x`, [JSON.stringify(modules)]);
const lessons = [];
for (let i = 0; i < 1787; i++) lessons.push({ id: id(n++), m: modules[i % modules.length].id, s: "published" });
for (let i = 0; i < 4; i++) lessons.push({ id: id(n++), m: modules[i].id, s: "draft" });
await db.query(`insert into p2p_lessons (id, module_id, title, order_index, status) select (x->>'id')::uuid, (x->>'m')::uuid, 'L', 1, x->>'s' from jsonb_array_elements($1::jsonb) x`, [JSON.stringify(lessons)]);

const m209 = readFileSync(path.join(repo, "migrations/209_group_resources.sql"), "utf8");
await db.exec(m209); await db.exec(m209);

const tmp = mkdtempSync(path.join(os.tmpdir(), "pack-fixes-"));
const src = (f) => JSON.stringify(path.join(repo, "artifacts/api-server/src/routes", f).replace(/\\/g, "/"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db,
  extraRoutes: `import bibleRoutes from ${src("bible.ts")};\nimport resources from ${src("groupResources.ts")};\napp.use("/api/bible", express.json(), bibleRoutes);\napp.use("/api/resources", express.json(), resources);` });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await realFetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const S = () => globalThis.__labStorage ?? (globalThis.__labStorage = { objects: {}, calls: [] });

try {
  // ── Prompt 5: Gathering / prayer passage lookup ──
  const psalm = await call("POST", "/bible/passage", null, { book: "Psalms", chapter: 23, startVerse: 1, endVerse: 1, translationCode: "KJV" });
  ok("no key: a cached verse (Psalm 23:1) still loads", psalm.status === 200 && psalm.body.verses[0].text.startsWith("The LORD"));
  const gen = await call("POST", "/bible/passage", null, { book: "Genesis", chapter: 1, startVerse: 1, endVerse: 2, translationCode: "KJV" });
  ok("no key: an uncached passage says the service isn't set up (503), not 'not found'", gen.status === 503 && /isn't set up/.test(gen.body.error), JSON.stringify(gen.body));
  const part = await call("POST", "/bible/passage", null, { book: "Psalms", chapter: 23, startVerse: 1, endVerse: 2, translationCode: "KJV" });
  ok("no key: a partly cached passage is flagged incomplete with the reason", part.status === 200 && part.body.incomplete === true && part.body.reason === "service_not_configured" && part.body.missingVerses === 1);
  ok("no key: the provider was never called", providerCalls.length === 0);
  process.env.API_BIBLE_KEY = "lab-key-not-real";
  const gen2 = await call("POST", "/bible/passage", null, { book: "Genesis", chapter: 1, startVerse: 1, endVerse: 2, translationCode: "KJV" });
  ok("with the key: Genesis 1:1-2 loads from the provider", gen2.status === 200 && gen2.body.verses.length === 2 && gen2.body.verses[1].text === "Verse text GEN 1:2");
  const rom = await call("POST", "/bible/passage", null, { book: "Romans", chapter: 8, startVerse: 28, endVerse: 28, translationCode: "KJV" });
  ok("with the key: Romans 8:28 loads", rom.status === 200 && rom.body.verses.length === 1);
  ok("with the key: fetched verses are cached (reference + licensed text, existing cache)", (await db.query(`select count(*)::int n from p2p_bible_verses_cache where book = 'GEN'`)).rows[0].n === 2);
  ok("unknown translation → 404", (await call("POST", "/bible/passage", null, { book: "John", chapter: 3, startVerse: 16, translationCode: "NIV" })).status === 404);
  delete process.env.API_BIBLE_KEY;

  // ── Prompt 6: P2P Library at production scale ──
  const lib = await call("GET", "/learning/library", U.adult);
  const plans = (lib.body?.categories ?? []).flatMap((c) => c.plans);
  const total = [...(lib.body?.core ?? []), ...plans].reduce((s, c) => s + c.lessonCount, 0);
  ok("library: all 3 published Core curricula listed (draft excluded)", lib.status === 200 && lib.body.core.length === 3, `${lib.status} ${JSON.stringify(lib.body).slice(0, 200)}`);
  ok("library: all 140 Plans listed in their 10 categories", plans.length === 140 && lib.body.categories.length === 10);
  ok("library: every published lesson counted (1,787 — more than one 1,000-row page), drafts not", total === 1787, String(total));
  ok("library: signed out → 401", (await call("GET", "/learning/library", null)).status === 401);

  // ── Prompt 10: Files & Resources ──
  const R = (p = "") => `/resources/family/${FAM}${p}`;
  ok("member lists files (empty), with permissions", (await call("GET", R(), U.adult)).body?.items?.length === 0);
  ok("non-member can't list (403)", (await call("GET", R(), U.outsider)).status === 403);
  ok("another family's Shepherd can't list (403)", (await call("GET", R(), U.otherFam)).status === 403);
  ok("bad type rejected", (await call("POST", R("/uploads"), U.adult, { fileName: "run.exe", mimeType: "application/x-msdownload", sizeBytes: 10 })).status === 400);
  ok("type/extension mismatch rejected (disguised file)", (await call("POST", R("/uploads"), U.adult, { fileName: "notes.exe", mimeType: "application/pdf", sizeBytes: 10 })).status === 400);
  ok("over 25 MB rejected", (await call("POST", R("/uploads"), U.adult, { fileName: "big.pdf", mimeType: "application/pdf", sizeBytes: 26 * 1024 * 1024 })).status === 400);
  ok("a Family child can view but not add files (403)", (await call("POST", R("/uploads"), U.child, { fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 10 })).status === 403);
  const up = await call("POST", R("/uploads"), U.adult, { fileName: "../../Week 1 notes.pdf", mimeType: "application/pdf", sizeBytes: 1234 });
  ok("upload slot issued for a server-chosen, sanitised path", up.status === 200 && up.body.path === `family/${FAM}/${up.body.resourceId}/Week_1_notes.pdf` && S().calls.some((c) => c.op === "signUpload" && c.bucket === "group-resources" && c.path === up.body.path), JSON.stringify(up.body));
  ok("a pending upload isn't listed", (await call("GET", R(), U.adult)).body.items.length === 0);
  ok("complete without the object → 409 (nothing listed)", (await call("POST", `/resources/${up.body.resourceId}/complete`, U.adult)).status === 409);
  ok("someone else can't complete my upload (404)", (await call("POST", `/resources/${up.body.resourceId}/complete`, U.shep)).status === 404);
  S().objects[`group-resources/${up.body.path}`] = { size: 1234 };
  ok("complete after the object exists → ready", (await call("POST", `/resources/${up.body.resourceId}/complete`, U.adult)).body?.ready === true);
  const listed = await call("GET", R(), U.child);
  ok("listed for every member (incl. a child), with uploader name", listed.body.items.length === 1 && listed.body.items[0].fileName === "Week_1_notes.pdf" && listed.body.items[0].uploaderName === "adult");
  const dl = await call("GET", `/resources/${up.body.resourceId}/download`, U.child);
  ok("member download → 5-minute signed link for exactly that object", dl.status === 200 && dl.body.expiresIn === 300 && dl.body.url.includes(up.body.path) && dl.body.url.endsWith("ttl=300"));
  ok("another family can't download it by id (403)", (await call("GET", `/resources/${up.body.resourceId}/download`, U.otherFam)).status === 403);
  ok("a church member can't either (403)", (await call("GET", `/resources/${up.body.resourceId}/download`, U.churchMember)).status === 403);
  ok("a guessed id → 404", (await call("GET", `/resources/${id(999999)}/download`, U.adult)).status === 404);
  ok("signed out → 401", (await call("GET", `/resources/${up.body.resourceId}/download`, null)).status === 401);
  const anonDirect = await makeTranslator(db, "anon").from("p2p_group_resources").select("id");
  const userDirect = await makeTranslator(db, "authenticated", U.adult).from("p2p_group_resources").select("id");
  ok("the table is API-only (anon and signed-in clients get no direct access)", !!anonDirect.error && (!!userDirect.error || (userDirect.data ?? []).length === 0));
  ok("bucket is private", (await db.query(`select public from storage.buckets where id = 'group-resources'`)).rows[0].public === false);
  ok("a child can't delete someone else's file (403)", (await call("DELETE", `/resources/${up.body.resourceId}`, U.child)).status === 403);
  // Leaving the group ends access immediately.
  await db.query(`update p2p_family_members set status = 'left' where user_id = $1 and family_id = $2`, [U.child, FAM]);
  ok("after leaving: no new download link (403)", (await call("GET", `/resources/${up.body.resourceId}/download`, U.child)).status === 403);
  ok("after leaving: can't list (403)", (await call("GET", R(), U.child)).status === 403);
  // A second file, removed by the Shepherd (group leader).
  const up2 = await call("POST", R("/uploads"), U.adult, { fileName: "photo.jpg", mimeType: "image/jpeg", sizeBytes: 50 });
  S().objects[`group-resources/${up2.body.path}`] = { size: 50 };
  await call("POST", `/resources/${up2.body.resourceId}/complete`, U.adult);
  ok("the Shepherd can remove any file in the family", (await call("DELETE", `/resources/${up2.body.resourceId}`, U.shep)).body?.removed === true);
  ok("removal deletes the stored object and hides the row", !S().objects[`group-resources/${up2.body.path}`] && (await call("GET", R(), U.adult)).body.items.length === 1);
  ok("removed file can't be downloaded (404)", (await call("GET", `/resources/${up2.body.resourceId}/download`, U.adult)).status === 404);
  ok("the uploader can remove their own file", (await call("DELETE", `/resources/${up.body.resourceId}`, U.adult)).body?.removed === true);
  // Church scope.
  const cu = await call("POST", `/resources/church/${CH}/uploads`, U.churchMember, { fileName: "Sermon.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", sizeBytes: 999 });
  S().objects[`group-resources/${cu.body.path}`] = { size: 999 };
  await call("POST", `/resources/${cu.body.resourceId}/complete`, U.churchMember);
  ok("church member upload listed for the church; families can't see it", (await call("GET", `/resources/church/${CH}`, U.pastor)).body.items.length === 1 && (await call("GET", `/resources/church/${CH}`, U.adult)).status === 403);
  ok("church leadership can remove a member's file", (await call("DELETE", `/resources/${cu.body.resourceId}`, U.pastor)).body?.removed === true);
} finally {
  globalThis.fetch = realFetch;
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
