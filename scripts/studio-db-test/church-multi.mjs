// Multiple churches per person: the REAL /api/churches routes
// (routes/churches.ts) through the lab bundle on PGlite. Reproduces the
// 2026-10-18 audit bug — joining a second church made GET /churches/my-church
// fail (it read exactly one membership) so the app showed no church — and
// proves the fix: my-church returns the CURRENT church (p2p_profiles.church_id
// when it is an active membership, else the most recently joined) plus every
// active church; PUT /churches/current switches only to the caller's own
// active churches; leaving/removal re-points to a remaining church.
// Synthetic data only; minimal stand-in tables with the columns these routes use.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/church-multi.mjs
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const U = { ada: id(1), ben: id(2), pastorA: id(3), pastorB: id(4), pastorC: id(5) };
const [CA, CB, CC] = ["aaaaaaaa-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002", "cccccccc-0000-4000-8000-000000000003"];

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, church_id uuid);
  create table public.p2p_churches (id uuid primary key, name text not null, country text not null default 'GH', created_by uuid not null, logo_url text,
    invite_code text unique not null, status text not null default 'active', created_at timestamptz default now());
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid not null references public.p2p_churches(id) on delete cascade,
    user_id uuid not null references public.p2p_profiles(id), role text not null default 'member', joined_at timestamptz not null default now(),
    is_active boolean not null default true, invited_by uuid, profile_visible_to_leadership boolean not null default true, admin_notes text, unique (church_id, user_id));
  create table public.p2p_church_cohorts (id uuid primary key default gen_random_uuid(), church_id uuid not null);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, read boolean default false, created_at timestamptz default now());
`);
await db.query(`insert into p2p_profiles (id, full_name) values ($1,'Ada'),($2,'Ben'),($3,'Pastor A'),($4,'Pastor B'),($5,'Pastor C')`, Object.values(U));
await db.query(`insert into p2p_churches (id, name, created_by, invite_code) values ($1,'Grace Church',$2,'GRACE1'),($3,'Hope Church',$4,'HOPE22'),($5,'Faith Church',$6,'FAITH3')`, [CA, U.pastorA, CB, U.pastorB, CC, U.pastorC]);
await db.query(`insert into p2p_church_members (church_id, user_id, role, joined_at) values ($1,$2,'senior_pastor','2026-01-01'),($3,$4,'senior_pastor','2026-01-01'),($5,$6,'senior_pastor','2026-01-01')`, [CA, U.pastorA, CB, U.pastorB, CC, U.pastorC]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "church-multi-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const mine = (who) => call("GET", "/churches/my-church", who);
const profileChurch = async (u) => (await db.query(`select church_id from p2p_profiles where id = $1`, [u])).rows[0].church_id;

try {
  // One church: unchanged shape.
  let r = await call("POST", "/churches/join", U.ada, { inviteCode: "GRACE1" });
  ok("join first church", r.status === 200, JSON.stringify(r.body));
  r = await mine(U.ada);
  ok("one church: same response as before (+ churches list)", r.status === 200 && r.body.church?.id === CA && r.body.userRole === "member" && r.body.memberCount === 2 && r.body.cohortCount === 0
    && r.body.churches.length === 1 && r.body.churches[0].isCurrent, JSON.stringify(r.body));

  // The bug: a second church.
  await db.query(`update p2p_church_members set joined_at = '2026-02-01' where user_id = $1`, [U.ada]);
  r = await call("POST", "/churches/join", U.ada, { inviteCode: "HOPE22" });
  ok("join a second church", r.status === 200);
  r = await mine(U.ada);
  ok("two churches: my-church still works (was: no church)", r.status === 200 && !!r.body.church, JSON.stringify(r.body));
  ok("current = the church just joined; both listed, newest first", r.body.church.id === CB && r.body.churches.map((c) => c.id).join() === [CB, CA].join() && r.body.churches.filter((c) => c.isCurrent).length === 1);
  ok("role reported for the current church", r.body.userRole === "member" && r.body.churches.every((c) => c.role === "member"));

  // Switch.
  r = await call("PUT", "/churches/current", U.ada, { churchId: CA });
  ok("switch current church to one you belong to", r.status === 200 && (await profileChurch(U.ada)) === CA);
  r = await mine(U.ada);
  ok("my-church now opens the switched church", r.body.church.id === CA && r.body.churches.find((c) => c.id === CA).isCurrent);
  r = await call("PUT", "/churches/current", U.ada, { churchId: CC });
  ok("can't switch to a church you don't belong to", r.status === 403 && (await profileChurch(U.ada)) === CA);
  r = await call("PUT", "/churches/current", U.ben, { churchId: CA });
  ok("a non-member can't point themselves at a church", r.status === 403 && (await profileChurch(U.ben)) === null);
  ok("no sign-in → 401; missing churchId → 400", (await call("PUT", "/churches/current", null, { churchId: CA })).status === 401 && (await call("PUT", "/churches/current", U.ada, {})).status === 400);

  // Stale pointer → most recent active church.
  await db.query(`update p2p_profiles set church_id = $1 where id = $2`, [CC, U.ada]);
  r = await mine(U.ada);
  ok("church_id pointing at a non-membership is ignored (most recent active used)", r.body.church.id === CB && !r.body.churches.some((c) => c.id === CC));
  await db.query(`update p2p_profiles set church_id = $1 where id = $2`, [CA, U.ada]);

  // Leaving re-points.
  r = await call("DELETE", `/churches/${CA}/members/${U.ada}`, U.ada);
  ok("leave the current church", r.status === 200);
  ok("current church re-pointed to the remaining one", (await profileChurch(U.ada)) === CB && (await mine(U.ada)).body.church.id === CB);
  r = await call("PUT", "/churches/current", U.ada, { churchId: CA });
  ok("can't switch back to a church you left", r.status === 403);

  // Removal by a pastor of a NON-current church leaves current alone.
  await call("POST", "/churches/join", U.ada, { inviteCode: "FAITH3" });
  await call("PUT", "/churches/current", U.ada, { churchId: CB });
  r = await call("DELETE", `/churches/${CC}/members/${U.ada}`, U.pastorC);
  ok("removed from another church: current church unchanged", r.status === 200 && (await profileChurch(U.ada)) === CB);

  // Last church.
  await call("DELETE", `/churches/${CB}/members/${U.ada}`, U.ada);
  r = await mine(U.ada);
  ok("no churches left: church null, empty list, pointer cleared", r.status === 200 && r.body.church === null && r.body.churches.length === 0 && (await profileChurch(U.ada)) === null);

  ok("other routes unaffected: GET /churches/:id still answers (not shadowed by /current)", (await call("GET", `/churches/${CB}`, U.pastorB)).status === 200);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
