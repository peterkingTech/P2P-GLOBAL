// The Bible reader API (routes/bibleReader.ts + lib/bibleReader.ts): the real
// routes on PGlite, with API.Bible answered from recorded public-domain KJV
// responses (fixtures/bible) — the network is never contacted.
// Proves: sign-in required everywhere; only licensed translations are listed
// or readable (no provider ids or key in any response); chapters parse into
// verses/headings/poetry and are cached server-side; search (reference +
// words); related lessons come only from published lessons in published
// curricula; before migration 207 the study routes degrade cleanly
// (available:false / 503) and lesson highlights are untouched; after 207
// highlights, notes and saved passages work, are private to their owner
// (routes AND RLS), never store Bible text, and never touch lesson
// highlights or plain notes.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/bible-reader.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp, makeTranslator } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000016${String(n).padStart(2, "0")}`;
const U = { ada: id(1), ben: id(2), leader: id(3) };
const KJV_ID = "de4e12af7f28f599-01", BLT_ID = "blt-test-0001", SECRET_KEY = "lab-api-bible-key-not-real";
const fixture = (f) => JSON.parse(readFileSync(path.join(here, "fixtures/bible", f), "utf8"));

// ── API.Bible stub (only its host; everything else is the real fetch) ──────
const realFetch = globalThis.fetch;
const providerCalls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith("https://api.scripture.api.bible/")) return realFetch(url, init);
  providerCalls.push({ url: u, key: init?.headers?.["api-key"] });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const m = u.match(/\/bibles\/([^/]+)\/chapters\/([A-Z0-9]+\.\d+)\?/);
  if (m) {
    const f = { "JHN.3": "kjv-JHN.3.json", "PSA.23": "kjv-PSA.23.json", "GEN.1": "kjv-GEN.1.json" }[m[2]];
    if ((m[1] === KJV_ID || m[1] === BLT_ID) && f) return json(fixture(f));
    return json({ statusCode: 404 }, 404);
  }
  if (/\/bibles\/[^/]+\/search\?/.test(u)) return json(fixture("kjv-search-love-one-another.json"));
  return json({}, 404);
};
process.env.API_BIBLE_KEY = SECRET_KEY;
delete process.env.API_Bible;

async function makeDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
    create function auth.role() returns text language sql stable as 'select current_user::text';
    grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to service_role;
    create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
    -- Production shape of the two existing personal tables (owner-only RLS).
    create table public.p2p_user_highlights (id uuid primary key default gen_random_uuid(), user_id uuid not null references p2p_profiles(id),
      reference text not null, quote text, created_at timestamptz not null default now(), lesson_id uuid, section_id uuid,
      start_offset integer, end_offset integer, color text not null default 'yellow');
    create table public.p2p_user_notes (id uuid primary key default gen_random_uuid(), user_id uuid not null references p2p_profiles(id),
      title text, body text not null, created_at timestamptz not null default now(), lesson_id uuid, module_id uuid, study_session_id uuid, updated_at timestamptz);
    alter table p2p_user_highlights enable row level security; alter table p2p_user_notes enable row level security;
    create policy own_h on p2p_user_highlights for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    create policy own_n on p2p_user_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
    grant select, insert, update, delete on p2p_user_highlights, p2p_user_notes to authenticated;
    create table public.p2p_bible_translations (id uuid primary key default gen_random_uuid(), language text, translation_code text, translation_name text,
      is_default_for_language boolean, provider text, api_bible_id text, license_notes text, is_licensed_confirmed boolean, created_at timestamptz default now());
    create table public.p2p_curriculums (id uuid primary key, title text, type text, status text);
    create table public.p2p_modules (id uuid primary key, title text, curriculum_id uuid);
    create table public.p2p_lessons (id uuid primary key, title text, module_id uuid, status text);
    create table public.p2p_scriptures (id uuid primary key default gen_random_uuid(), lesson_id uuid, reference text, verse text, display_order int);
  `);
  await db.query(`insert into p2p_profiles (id, role) values ($1,'student'),($2,'student'),($3,'admin')`, [U.ada, U.ben, U.leader]);
  await db.query(`insert into p2p_bible_translations (language, translation_code, translation_name, is_default_for_language, provider, api_bible_id, license_notes, is_licensed_confirmed) values
    ('en','KJV','King James Version',true,'api_bible',$1,'Public domain',true),
    ('pt','BLT','Bíblia Livre',true,'api_bible',$2,'Open licence (attribution)',true),
    ('en','NIV','New International Version',false,'api_bible','niv-id','Not licensed',false),
    ('fr','NOAPI','No provider id',false,'api_bible',null,'Public domain',true)`, [KJV_ID, BLT_ID]);
  // Official content: a published Core lesson + a published Plan lesson on John 3,
  // a DRAFT lesson on John 3, and a published lesson in an UNPUBLISHED curriculum.
  const [cCore, cPlan, cDraft, mCore, mPlan, mDraft] = [id(40), id(41), id(42), id(43), id(44), id(45)];
  await db.query(`insert into p2p_curriculums values ($1,'Core Foundation','core','published'),($2,'Faith Plan','plan','published'),($3,'Hidden','core','draft')`, [cCore, cPlan, cDraft]);
  await db.query(`insert into p2p_modules values ($1,'New Birth',$4),($2,'Week 1',$5),($3,'Secret',$6)`, [mCore, mPlan, mDraft, cCore, cPlan, cDraft]);
  await db.query(`insert into p2p_lessons values ($1,'Born Again',$4,'published'),($2,'God So Loved',$5,'published'),($3,'Draft lesson',$4,'draft'),($6,'In hidden curriculum',$7,'published')`,
    [id(50), id(51), id(52), mCore, mPlan, id(53), mDraft]);
  for (const [l, ref] of [[id(50), "John 3:3-7"], [id(51), "John 3:16; Romans 5:8"], [id(52), "John 3:1"], [id(53), "John 3:30"], [id(50), "Ephesians 2:8-9"]])
    await db.query(`insert into p2p_scriptures (lesson_id, reference, verse) values ($1,$2,'x')`, [l, ref]);
  // Ada's existing LESSON highlight and plain note (must never be touched).
  await db.query(`insert into p2p_user_highlights (user_id, reference, quote, lesson_id, color) values ($1,'Lesson 1','a quote',$2,'yellow')`, [U.ada, id(50)]);
  await db.query(`insert into p2p_user_notes (user_id, title, body) values ($1,'Journal','plain note')`, [U.ada]);
  return db;
}

async function start(db) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "bible-reader-"));
  const routes = path.join(repo, "artifacts/api-server/src/routes/bibleReader.ts").replace(/\\/g, "/");
  const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db,
    extraRoutes: `import bibleReader from ${JSON.stringify(routes)};\napp.use("/api/bible", express.json(), bibleReader);` });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/bible`;
  const call = async (method, p, who, body) => {
    const r = await realFetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, body: json, text };
  };
  return { call, close: () => { server.close(); rmSync(tmp, { recursive: true, force: true }); } };
}

const ref = (sv, ev = sv, extra = {}) => ({ translationCode: "KJV", bookCode: "JHN", chapter: 3, startVerse: sv, endVerse: ev, ...extra });
const leaks = (text) => text.includes(SECRET_KEY) || text.includes(KJV_ID) || text.includes(BLT_ID) || text.includes("api_bible_id");

// ════════════════ Before migration 207 ════════════════
{
  const db = await makeDb();
  const { call, close } = await start(db);
  try {
    for (const p of ["/reader/translations", "/reader/books", "/reader/chapter?book=JHN&chapter=3&t=KJV", "/reader/search?q=love&t=KJV", "/reader/related?book=JHN&chapter=3", "/me/chapter?t=KJV&book=JHN&chapter=3", "/me/library?kind=notes"])
      ok(`signed out → 401: ${p}`, (await call("GET", p, null)).status === 401);
    ok("unknown token → 401", (await call("GET", "/reader/translations", "not-a-user")).status === 401);
    ok("signed out POST highlight → 401", (await call("POST", "/me/highlights", null, { ...ref(16), color: "gold" })).status === 401);

    const tr = await call("GET", "/reader/translations", U.ada);
    const codes = tr.body?.translations?.map((t) => t.code).sort();
    ok("only licensed translations with a provider id are listed (KJV, BLT)", JSON.stringify(codes) === JSON.stringify(["BLT", "KJV"]), JSON.stringify(codes));
    ok("KJV (public domain) allows copying text; BLT (open licence) doesn't", tr.body.translations.find((t) => t.code === "KJV").textCopyAllowed === true && tr.body.translations.find((t) => t.code === "BLT").textCopyAllowed === false);
    ok("no provider id or API key in the translations response", !leaks(tr.text));

    const before = providerCalls.length;
    const ch = await call("GET", "/reader/chapter?book=JHN&chapter=3&t=KJV", U.ada);
    ok("John 3 KJV: 36 verses", ch.status === 200 && ch.body.verses.length === 36, `${ch.status} ${ch.body?.verses?.length}`);
    ok("source paragraph marks (¶) are stripped from verse text", ch.body.verses.every((v) => !v.text.includes("¶")));
    ok("John 3:16 text parsed", /God so loved the world/.test(ch.body.verses.find((v) => v.verse === 16)?.text ?? ""));
    ok("chapter carries next/previous + translation", ch.body.next?.bookCode === "JHN" && ch.body.next?.chapter === 4 && ch.body.previous?.chapter === 2 && ch.body.translation.code === "KJV");
    ok("the provider was called with the server-side key", providerCalls.length === before + 1 && providerCalls.at(-1).key === SECRET_KEY);
    ok("no provider id or API key in the chapter response", !leaks(ch.text));
    await call("GET", "/reader/chapter?book=JHN&chapter=3&t=KJV", U.ben);
    ok("second read of the same chapter is served from the server cache", providerCalls.length === before + 1);
    const ps = await call("GET", "/reader/chapter?book=PSA&chapter=23&t=KJV", U.ada);
    ok("Psalm 23: 6 poetry verses with its title heading", ps.body.verses.length === 6 && ps.body.verses.every((v) => v.poetry) && ps.body.headings.some((h) => /Psalm of David/i.test(h.text)), JSON.stringify(ps.body.headings));
    ok("John 30 → 400 (no such chapter)", (await call("GET", "/reader/chapter?book=JHN&chapter=30&t=KJV", U.ada)).status === 400);
    ok("unknown book → 400", (await call("GET", "/reader/chapter?book=HEZ&chapter=1&t=KJV", U.ada)).status === 400);
    const n0 = providerCalls.length;
    ok("unlicensed translation (NIV) → 404 and the provider is never asked", (await call("GET", "/reader/chapter?book=JHN&chapter=3&t=NIV", U.ada)).status === 404 && providerCalls.length === n0);
    ok("translation without a provider id → 404", (await call("GET", "/reader/chapter?book=JHN&chapter=3&t=NOAPI", U.ada)).status === 404);
    ok("chapter the provider doesn't have → 404", (await call("GET", "/reader/chapter?book=REV&chapter=22&t=KJV", U.ada)).status === 404);

    const sRef = await call("GET", "/reader/search?q=" + encodeURIComponent("Romans 8:28") + "&t=KJV", U.ada);
    ok("search: a reference opens the passage", sRef.body.kind === "reference" && sRef.body.reference.bookCode === "ROM" && sRef.body.reference.chapter === 8 && sRef.body.reference.startVerse === 28);
    const sTxt = await call("GET", "/reader/search?q=" + encodeURIComponent("love one another") + "&t=KJV", U.ada);
    ok("search: words → verse results with total", sTxt.body.kind === "text" && sTxt.body.total === 21 && sTxt.body.results[0].reference === "John 13:34" && sTxt.body.results[0].bookCode === "JHN");
    ok("search: no provider id or key leaks", !leaks(sTxt.text));
    ok("search: too short → 400", (await call("GET", "/reader/search?q=a&t=KJV", U.ada)).status === 400);
    ok("search: unlicensed translation → 404", (await call("GET", "/reader/search?q=love&t=NIV", U.ada)).status === 404);

    const rel = await call("GET", "/reader/related?book=JHN&chapter=3", U.ada);
    const titles = rel.body.lessons.map((l) => l.lessonTitle).sort();
    ok("related: published Core + Plan lessons on John 3 only (no draft lesson, no draft curriculum)", JSON.stringify(titles) === JSON.stringify(["Born Again", "God So Loved"]), JSON.stringify(titles));
    ok("related: kinds are core/plan", rel.body.lessons.find((l) => l.lessonTitle === "God So Loved").kind === "plan" && rel.body.lessons.find((l) => l.lessonTitle === "Born Again").kind === "core");
    ok("related: second reference in a list (Romans 5) is indexed", (await call("GET", "/reader/related?book=ROM&chapter=5", U.ada)).body.lessons.some((l) => l.lessonTitle === "God So Loved"));
    ok("related: chapter with no lessons → []", (await call("GET", "/reader/related?book=GEN&chapter=1", U.ada)).body.lessons.length === 0);

    // Study data without 207: clean degradation.
    const me = await call("GET", "/me/chapter?t=KJV&book=JHN&chapter=3", U.ada);
    ok("pre-207: my chapter → available:false", me.status === 200 && me.body.available === false);
    ok("pre-207: highlight → 503", (await call("POST", "/me/highlights", U.ada, { ...ref(16), color: "gold" })).status === 503);
    ok("pre-207: note → 503", (await call("POST", "/me/notes", U.ada, { ...ref(16), body: "x" })).status === 503);
    ok("pre-207: save passage → 503", (await call("POST", "/me/bookmarks", U.ada, ref(16))).status === 503);
    ok("pre-207: library → available:false", (await call("GET", "/me/library?kind=saved", U.ada)).body.available === false);
    const lessonH = await db.query(`select count(*)::int n from p2p_user_highlights`);
    ok("pre-207: the lesson highlight is untouched", lessonH.rows[0].n === 1);
  } finally { close(); }

  // ════════════════ After migration 207 (applied twice: idempotent) ════════════════
  const mig = readFileSync(path.join(repo, "migrations/207_bible_personal_study.sql"), "utf8");
  await db.exec(mig);
  await db.exec(mig);
  ok("migration 207 applies twice without error", true);
  {
  const { call, close: close2 } = await start(db);
  try {
    // Highlights
    const h1 = await call("POST", "/me/highlights", U.ada, { ...ref(16, 17), color: "gold" });
    ok("highlight John 3:16-17 gold", h1.status === 200 && h1.body.color === "gold" && h1.body.reference === "John 3:16-17" && h1.body.startVerse === 16, JSON.stringify(h1.body));
    const row = (await db.query(`select * from p2p_user_highlights where id = $1`, [h1.body.id])).rows[0];
    ok("stored as a reference only — no Bible text (quote is null)", row.quote === null && row.reference === "John 3:16-17 (KJV)" && row.book_code === "JHN" && row.translation_code === "KJV");
    ok("bad colour → 400", (await call("POST", "/me/highlights", U.ada, { ...ref(16), color: "black" })).status === 400);
    ok("verses out of order → 400", (await call("POST", "/me/highlights", U.ada, { ...ref(17, 16), color: "gold" })).status === 400);
    ok("chapter beyond the book → 400", (await call("POST", "/me/highlights", U.ada, { ...ref(1), chapter: 22, color: "gold" })).status === 400);
    ok("unlicensed translation → 400", (await call("POST", "/me/highlights", U.ada, { ...ref(16), translationCode: "NIV", color: "gold" })).status === 400);
    const h2 = await call("POST", "/me/highlights", U.ada, { ...ref(17, 18), color: "blue" });
    const mine = await call("GET", "/me/chapter?t=KJV&book=JHN&chapter=3", U.ada);
    ok("overlapping highlight replaces the old one (one per verse)", mine.body.available === true && mine.body.highlights.length === 1 && mine.body.highlights[0].id === h2.body.id && mine.body.highlights[0].color === "blue");
    ok("highlights are per translation: none shown for BLT", (await call("GET", "/me/chapter?t=BLT&book=JHN&chapter=3", U.ada)).body.highlights.length === 0);
    ok("recolour own highlight", (await call("PUT", `/me/highlights/${h2.body.id}`, U.ada, { color: "rose" })).body.color === "rose");

    // Notes
    const n1 = await call("POST", "/me/notes", U.ada, { ...ref(16), title: "Love", body: "  God gave.  " });
    ok("note saved (trimmed)", n1.status === 200 && n1.body.body === "God gave." && n1.body.title === "Love" && n1.body.reference === "John 3:16");
    ok("empty note → 400", (await call("POST", "/me/notes", U.ada, { ...ref(16), body: "   " })).status === 400);
    ok("note over 10,000 chars → 400", (await call("POST", "/me/notes", U.ada, { ...ref(16), body: "x".repeat(10001) })).status === 400);
    ok("edit own note", (await call("PUT", `/me/notes/${n1.body.id}`, U.ada, { title: null, body: "Edited" })).body.body === "Edited");

    // Saved passages
    const b1 = await call("POST", "/me/bookmarks", U.ada, ref(16));
    const b1again = await call("POST", "/me/bookmarks", U.ada, ref(16));
    ok("save passage; saving again is idempotent (same id)", b1.status === 200 && b1again.body.id === b1.body.id);
    ok("saved passages are unique per range", (await db.query(`select count(*)::int n from p2p_bible_bookmarks where user_id = $1`, [U.ada])).rows[0].n === 1);

    // Privacy: Ben (and an admin/leader) can't see or change Ada's data via the API.
    const benView = await call("GET", "/me/chapter?t=KJV&book=JHN&chapter=3", U.ben);
    ok("another person sees none of Ada's highlights/notes/saved", benView.body.highlights.length === 0 && benView.body.notes.length === 0 && benView.body.bookmarks.length === 0);
    const leaderView = await call("GET", "/me/library?kind=notes", U.leader);
    ok("an admin/leader gets no access to Ada's notes", leaderView.body.items.length === 0);
    ok("Ben can't recolour Ada's highlight (404)", (await call("PUT", `/me/highlights/${h2.body.id}`, U.ben, { color: "gold" })).status === 404);
    ok("Ben can't delete Ada's highlight (404)", (await call("DELETE", `/me/highlights/${h2.body.id}`, U.ben)).status === 404);
    ok("Ben can't edit Ada's note (404)", (await call("PUT", `/me/notes/${n1.body.id}`, U.ben, { body: "hacked" })).status === 404);
    ok("Ben can't delete Ada's note (404)", (await call("DELETE", `/me/notes/${n1.body.id}`, U.ben)).status === 404);
    ok("Ben can't delete Ada's saved passage (404)", (await call("DELETE", `/me/bookmarks/${b1.body.id}`, U.ben)).status === 404);
    ok("Ada's note is unchanged after Ben's attempts", (await db.query(`select body from p2p_user_notes where id = $1`, [n1.body.id])).rows[0].body === "Edited");
    ok("non-uuid id → 404", (await call("DELETE", "/me/notes/not-an-id", U.ada)).status === 404);

    // RLS directly (a signed-in client going around the API).
    const ben = makeTranslator(db, "authenticated", U.ben);
    ok("RLS: Ben's own client reads none of Ada's saved passages", ((await ben.from("p2p_bible_bookmarks").select("id")).data ?? []).length === 0);
    const sneak = await ben.from("p2p_bible_bookmarks").insert({ user_id: U.ada, translation_code: "KJV", book_code: "JHN", chapter: 3, start_verse: 1, end_verse: 1 });
    ok("RLS: Ben can't insert a saved passage as Ada", !!sneak.error);
    const anon = makeTranslator(db, "anon");
    ok("anon has no access to saved passages", !!(await anon.from("p2p_bible_bookmarks").select("id")).error);
    ok("RLS: constraint rejects a bad book code", !!(await makeTranslator(db, "authenticated", U.ada).from("p2p_bible_bookmarks").insert({ user_id: U.ada, translation_code: "KJV", book_code: "xx", chapter: 1, start_verse: 1, end_verse: 1 })).error);

    // Lesson highlights / plain notes are never touched by the Bible routes.
    const lessonRow = (await db.query(`select id from p2p_user_highlights where lesson_id is not null`)).rows[0];
    const plainNote = (await db.query(`select id from p2p_user_notes where book_code is null`)).rows[0];
    ok("can't recolour a lesson highlight through the Bible route", (await call("PUT", `/me/highlights/${lessonRow.id}`, U.ada, { color: "gold" })).status === 404);
    ok("can't delete a lesson highlight through the Bible route", (await call("DELETE", `/me/highlights/${lessonRow.id}`, U.ada)).status === 404);
    ok("can't delete a plain note through the Bible route", (await call("DELETE", `/me/notes/${plainNote.id}`, U.ada)).status === 404);
    const libH = await call("GET", "/me/library?kind=highlights", U.ada);
    ok("library: highlights lists only Bible highlights (not the lesson one)", libH.body.items.length === 1 && libH.body.items[0].bookCode === "JHN");
    const libN = await call("GET", "/me/library?kind=notes", U.ada);
    ok("library: notes lists only Bible notes (not the plain journal note)", libN.body.items.length === 1 && libN.body.items[0].id === n1.body.id);
    ok("library: saved", (await call("GET", "/me/library?kind=saved", U.ada)).body.items.length === 1);
    ok("library: unknown list → 400", (await call("GET", "/me/library?kind=other", U.ada)).status === 400);

    // Paging: 31 saved passages → page of 30 + hasMore.
    for (let v = 1; v <= 31; v++) if (v !== 16) await call("POST", "/me/bookmarks", U.ben, { ...ref(v), translationCode: "KJV" });
    await call("POST", "/me/bookmarks", U.ben, ref(16));
    const p1 = await call("GET", "/me/library?kind=saved", U.ben);
    const p2 = await call("GET", "/me/library?kind=saved&offset=30", U.ben);
    ok("library pages by 30 with hasMore", p1.body.items.length === 30 && p1.body.hasMore === true && p2.body.items.length === 1 && p2.body.hasMore === false);

    // Removal by the owner.
    ok("Ada removes her highlight", (await call("DELETE", `/me/highlights/${h2.body.id}`, U.ada)).status === 200);
    ok("Ada deletes her note", (await call("DELETE", `/me/notes/${n1.body.id}`, U.ada)).status === 200);
    ok("Ada removes her saved passage", (await call("DELETE", `/me/bookmarks/${b1.body.id}`, U.ada)).status === 200);
    ok("removing again → 404", (await call("DELETE", `/me/bookmarks/${b1.body.id}`, U.ada)).status === 404);
    ok("lesson highlight + plain note survive everything", (await db.query(`select (select count(*)::int from p2p_user_highlights where lesson_id is not null) h, (select count(*)::int from p2p_user_notes where book_code is null) n`)).rows[0].h === 1);
    ok("no Bible text stored anywhere (all Bible-reader highlight quotes null)", (await db.query(`select count(*)::int n from p2p_user_highlights where book_code is not null and quote is not null`)).rows[0].n === 0);
  } finally { close2(); }
  }
}

globalThis.fetch = realFetch;
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
