// Family Home "Family chat": the REAL GET /api/family/:familyId
// (routes/family.ts) on the REAL family migrations (115, 116, 126) plus
// migration 197, in PGlite through the lab bundle. Proves: an active member
// gets their family's conversationId; it's the family's own conversation;
// a removed member is 403 and loses the conversation; a member of another
// family never gets this one; before 197 (no family_id column) the route
// still works and returns conversationId null; the Gathering-start push
// wording. Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/family-conversation.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, "0")}`;
const U = { grace: id(1), dan: id(2), tim: id(3), olu: id(4) };
const F1 = "22222222-2222-4222-8222-000000000001", F2 = "22222222-2222-4222-8222-000000000002";

async function setup(with197) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
    grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text);
    create table public.p2p_peer_circles (id uuid primary key, name text);
    create table public.p2p_groups (id uuid primary key);
    create table public.p2p_help_requests (id uuid primary key);
    create table public.p2p_churches (id uuid primary key, name text not null);
    create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid not null references public.p2p_churches(id), user_id uuid not null, is_active boolean not null default true);
    create table public.p2p_conversations (id uuid primary key default gen_random_uuid(), type text, name text, group_id uuid references public.p2p_groups(id) on delete cascade,
      created_at timestamptz default now(), conversation_type text default 'direct', help_request_id uuid references public.p2p_help_requests(id), crisis_type text,
      circle_id uuid references public.p2p_peer_circles(id) on delete cascade,
      constraint p2p_conversations_conversation_type_check check (conversation_type = any (array['direct','crisis_response','help_request','pastoral','support','peer_group','circle'])));
    create table public.p2p_conversation_members (conversation_id uuid not null references public.p2p_conversations(id) on delete cascade, user_id uuid not null,
      joined_at timestamptz default now(), last_read_at timestamptz default now(), primary key (conversation_id, user_id));
    create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  `);
  for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql"]) await db.exec(mig(f));
  await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
  await db.query(`insert into p2p_profiles (id, full_name) values ($1,'Grace'),($2,'Dan'),($3,'Tim'),($4,'Olu')`, Object.values(U));
  await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1, 'The Okafors', $2), ($3, 'The Olus', $4)`, [F1, U.grace, F2, U.olu]);
  const member = (f, u, role, status = "active") => db.query(`insert into p2p_family_members (family_id, user_id, role, status) values ($1,$2,$3,$4)`, [f, u, role, status]);
  await member(F1, U.grace, "shepherd"); await member(F1, U.dan, "adult"); await member(F1, U.tim, "teen");
  await member(F2, U.olu, "shepherd");
  if (with197) await db.exec(mig("197_family_church_conversations.sql"));
  return db;
}

async function serve(db) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "family-conv-"));
  const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, who, body) => {
    const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, close: () => { server.close(); rmSync(tmp, { recursive: true, force: true }); } };
}

// ── With 197 ──────────────────────────────────────────────────────────────
{
  const db = await setup(true);
  const { call, close } = await serve(db);
  try {
    const conv1 = (await db.query(`select id from p2p_conversations where family_id = $1`, [F1])).rows[0]?.id;
    const conv2 = (await db.query(`select id from p2p_conversations where family_id = $1`, [F2])).rows[0]?.id;
    let r = await call("GET", `/family/${F1}`, U.dan);
    ok("member gets their family's conversationId", r.status === 200 && r.body.conversationId === conv1 && !!conv1, JSON.stringify(r.body?.conversationId));
    ok("it's this family's conversation, not another's", r.body.conversationId !== conv2);
    ok("teen member gets it too (same rule for every active member)", (await call("GET", `/family/${F1}`, U.tim)).body?.conversationId === conv1);
    ok("someone from another family: 403, nothing about this family", (await call("GET", `/family/${F1}`, U.olu)).status === 403);
    await db.query(`update p2p_family_members set status = 'left' where family_id = $1 and user_id = $2`, [F1, U.dan]);
    r = await call("GET", `/family/${F1}`, U.dan);
    const stillIn = (await db.query(`select 1 from p2p_conversation_members where conversation_id = $1 and user_id = $2`, [conv1, U.dan])).rows.length;
    ok("after leaving: 403 and removed from the conversation", r.status === 403 && stillIn === 0);
    const g = await call("GET", `/family/${F1}`, U.grace);
    ok("roster and existing fields unchanged for remaining members", g.status === 200 && g.body.members.length === 2 && g.body.myRole === "shepherd" && g.body.canManage === true && "activeSessionId" in g.body);

    // Gathering start notification wording (routes/familyWorship.ts) — read from source.
    const src = readFileSync(path.join(repo, "artifacts/api-server/src/routes/familyWorship.ts"), "utf8");
    ok("Gathering-start push says what it is (no stale 'Family Circle Media', no false 'tap to join')",
      /title: "Family Gathering"/.test(src) && /started a Family Gathering\.`/.test(src) && !/Family Circle Media/.test(src) && !/Tap to join/.test(src));
  } finally { close(); }
}

// ── Before 197 is applied ─────────────────────────────────────────────────
{
  const db = await setup(false);
  const { call, close } = await serve(db);
  try {
    const r = await call("GET", `/family/${F1}`, U.dan);
    ok("before 197: family detail still works, conversationId null", r.status === 200 && r.body.conversationId === null && r.body.members.length === 3, JSON.stringify(r.body));
  } finally { close(); }
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
