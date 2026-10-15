// Group Members (Family Circles): the REAL GET /family/:familyId route
// (routes/family.ts) on the REAL family migrations (115, 116, 126) in PGlite,
// through the lab bundle (lab.mjs). Proves the member list the app shows is
// accurate and members-only: active members only, real names/photos/roles,
// no private profile fields, and membership in one family never opens another.
// Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/family-members.mjs
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

const id = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const U = { shep: id(1), adult: id(2), teen: id(3), removed: id(4), outsider: id(5), coShep: id(6), noProfile: id(7) };
const F1 = "11111111-1111-4111-8111-000000000001", F2 = "11111111-1111-4111-8111-000000000002";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text,
    email text, date_of_birth date);
`);
const loaded = [];
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql"]) {
  try { await db.exec(mig(f)); loaded.push(f); } catch (e) { console.log(`note: ${f} not loadable in PGlite (${e.message.split("\n")[0]}) — stand-in used`); }
}
ok("real family migrations 115 + 116 + 126 load", loaded.length === 3, loaded.join(", "));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name, photo_url, username, email, date_of_birth) values
  ($1, 'Grace Shepherd', 'https://cdn.example/grace.jpg', 'grace', 'grace@example.invalid', '1980-01-01'),
  ($2, 'Daniel Adult', null, 'daniel', 'daniel@example.invalid', '1990-01-01'),
  ($3, 'Tim Teen', 'https://cdn.example/tim.jpg', 'tim', 't@example.invalid', '2010-01-01'),
  ($4, 'Rhoda Removed', null, 'rhoda', 'r@example.invalid', '1985-01-01'),
  ($5, 'Olu Outsider', null, 'olu', 'o@example.invalid', '1970-01-01'),
  ($6, 'Chi Co-Shepherd', null, 'chi', 'c@example.invalid', '1982-01-01')`,
  [U.shep, U.adult, U.teen, U.removed, U.outsider, U.coShep]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1, 'The Okafors', $2), ($3, 'Grace Bible Group', $4)`, [F1, U.shep, F2, U.outsider]);
const member = (f, u, role, status = "active", joined = "2026-01-01") =>
  db.query(`insert into p2p_family_members (family_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, $5)`, [f, u, role, status, joined]);
await member(F1, U.shep, "shepherd", "active", "2026-01-01");
await member(F1, U.adult, "adult", "active", "2026-01-03");
await member(F1, U.teen, "teen", "active", "2026-01-04");
await member(F1, U.coShep, "co_shepherd", "active", "2026-01-05");
await member(F1, U.removed, "adult", "removed", "2026-01-02");
await member(F1, U.noProfile, "child", "active", "2026-01-06");
await member(F2, U.outsider, "shepherd", "active", "2026-02-01");
await member(F2, U.adult, "adult", "active", "2026-02-02");   // Daniel is in both families

// lab.bundleApp resolves callers by profile id; add the profile-less member too.
await db.query(`insert into p2p_profiles (id, role) values ($1, 'student') on conflict do nothing`, [U.noProfile]);
await db.query(`update p2p_profiles set full_name = null, username = null where id = $1`, [U.noProfile]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "family-members-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const get = async (p, who) => { const r = await fetch(base + p, { headers: who ? { authorization: `Bearer ${who}` } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };

try {
  const r = await get(`/family/${F1}`, U.adult);
  if (r.status !== 200) console.log("DEBUG", r.status, JSON.stringify(r.body));
  const ids = (r.body?.members ?? []).map((m) => m.userId);
  ok("member sees their family's roster", r.status === 200);
  ok("count = active members only (removed member excluded)", ids.length === 5 && !ids.includes(U.removed), JSON.stringify(ids));
  ok("never members of another family", !ids.includes(U.outsider));
  const grace = r.body.members.find((m) => m.userId === U.shep);
  ok("real name, photo, username and role", grace?.name === "Grace Shepherd" && grace.avatarUrl === "https://cdn.example/grace.jpg" && grace.username === "grace" && grace.role === "shepherd");
  const dan = r.body.members.find((m) => m.userId === U.adult);
  ok("missing photo is null (app shows the initial)", dan?.avatarUrl === null);
  const np = r.body.members.find((m) => m.userId === U.noProfile);
  ok("member without a profile name/username: neutral name, not tappable (no username)", np?.name === "Family member" && np.username === null);
  ok("no private profile fields in the roster", !JSON.stringify(r.body.members).match(/email|date_of_birth|dateOfBirth|example\.invalid/));
  ok("roles are the stored roles only", r.body.members.every((m) => ["shepherd", "co_shepherd", "adult", "teen", "child"].includes(m.role)));
  ok("adult cannot manage; no pending invitations exposed", r.body.canManage === false && r.body.pendingInvitations.length === 0);
  const s = await get(`/family/${F1}`, U.shep);
  ok("shepherd can manage", s.status === 200 && s.body.canManage === true);
  const co = await get(`/family/${F1}`, U.coShep);
  ok("co-shepherd can manage", co.status === 200 && co.body.canManage === true);
  ok("outsider refused (403)", (await get(`/family/${F1}`, U.outsider)).status === 403);
  ok("removed member refused (403)", (await get(`/family/${F1}`, U.removed)).status === 403);
  ok("signed out refused (401)", (await get(`/family/${F1}`, null)).status === 401);
  const f2 = await get(`/family/${F2}`, U.adult);
  const f2ids = (f2.body?.members ?? []).map((m) => m.userId);
  ok("multi-family: the same person sees each family separately", f2.status === 200 && f2ids.length === 2 && f2ids.includes(U.outsider) && !f2ids.includes(U.shep));
  ok("multi-family: membership in F2 does not open F1 to F2's shepherd", (await get(`/family/${F1}`, U.outsider)).status === 403);
  ok("unknown family id refused without leaking existence", [403, 404].includes((await get(`/family/11111111-1111-4111-8111-0000000000ff`, U.adult)).status));
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  await db.close();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
