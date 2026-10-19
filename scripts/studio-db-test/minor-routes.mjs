// Child/teen safeguards in the API (the database side is migration198.mjs):
//   rule 4 — the REAL /api/family/worship/* media routes (routes/familyWorship.ts)
//            refuse a child even as Guide, trusted or under "Everyone";
//            teens follow the existing trusted setting; adults unchanged.
//   rule 5 — the REAL /api/search people results never include children.
// Real family/Gathering migrations (115–124, 126) in PGlite through the lab bundle.
// Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/minor-routes.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
const U = { parent: id(1), child: id(2), teen: id(3), adult: id(4), searcher: id(5) };
const F = "55555555-5555-4555-8555-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text, profile_visibility text default 'public');
  create table public.p2p_user_blocks (blocker_id uuid, blocked_id uuid);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_lessons (id uuid primary key, title text);
`);
const loaded = [], skipped = [];
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "117_family_worship_modes_and_history.sql", "118_family_worship_modes_visited.sql",
  "119_family_worship_media_provider.sql", "122_family_worship_messages.sql", "123_family_worship_media_permissions_queue.sql", "124_family_worship_phase7.sql", "126_family_multi_membership.sql"]) {
  try { await db.exec(mig(f)); loaded.push(f); } catch (e) { skipped.push(`${f}: ${e.message.split("\n")[0]}`); }
}
ok("real family + Gathering migrations load", skipped.length === 0, skipped.join(" | "));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name, username) values ($1,'Pat Parent','pat'),($2,'Kid Child','kidchild'),($3,'Tia Teen','tiateen'),($4,'Ada Adult','adaadult'),($5,'Sam Searcher','sam')`, Object.values(U));
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1, 'The Kids', $2)`, [F, U.parent]);
for (const [u, r] of [[U.parent, "shepherd"], [U.child, "child"], [U.teen, "teen"], [U.adult, "adult"]]) {
  await db.query(`insert into p2p_family_members (family_id, user_id, role) values ($1, $2, $3)`, [F, u, r]);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "minor-routes-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { authorization: `Bearer ${who}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const setSession = (sid, cols) => db.query(`update p2p_family_worship_sessions set ${Object.keys(cols).map((k, i) => `${k} = $${i + 2}`).join(", ")} where id = $1`, [sid, ...Object.values(cols)]);
const play = (sid, who) => call("PUT", `/family/worship/sessions/${sid}/state`, who, { isPlaying: true, positionMs: 1000 });
const queueAdd = (sid, who) => call("POST", `/family/worship/sessions/${sid}/queue`, who, { mediaProvider: "youtube", mediaId: "dQw4w9WgXcQ" });

try {
  // The child starts a Gathering — they become its Guide (host).
  const start = await call("POST", "/family/worship/start", U.child, { familyId: F });
  ok("a child can start / join a Gathering (only media is restricted)", start.status === 200 && !!start.body?.id, JSON.stringify(start.body));
  const sid = start.body.id;
  for (const u of [U.parent, U.teen, U.adult]) await call("POST", `/family/worship/sessions/${sid}/join`, u);

  let r = await play(sid, U.child);
  ok("child as Guide: can't play/seek Shared Media", r.status === 403, JSON.stringify(r));
  ok("child as Guide: can't add to the Media Shelf", (await queueAdd(sid, U.child)).status === 403);

  await setSession(sid, { media_permission: "everyone" });
  ok("'Everyone' can control media — except the child", (await play(sid, U.child)).status === 403 && (await play(sid, U.adult)).status === 200 && (await play(sid, U.teen)).status === 200);

  await setSession(sid, { media_permission: "trusted", trusted_user_ids: [U.child, U.teen] });
  ok("'Trusted': a trusted child still can't; a trusted teen can", (await play(sid, U.child)).status === 403 && (await play(sid, U.teen)).status === 200);
  await setSession(sid, { trusted_user_ids: [U.child] });
  ok("'Trusted': an untrusted teen can't (existing setting decides for teens)", (await play(sid, U.teen)).status === 403);
  ok("'Trusted': an untrusted adult can't (unchanged)", (await play(sid, U.adult)).status === 403);

  await setSession(sid, { host_id: U.parent, media_permission: "guide_only" });
  ok("adult Guide still controls media (unchanged)", (await play(sid, U.parent)).status === 200 && (await queueAdd(sid, U.parent)).status === 200);
  const [item] = (await db.query(`select id from p2p_family_worship_queue where session_id = $1 limit 1`, [sid])).rows;
  ok("child can't remove or advance the queue either", (await call("DELETE", `/family/worship/sessions/${sid}/queue/${item.id}`, U.child)).status === 403
    && (await call("POST", `/family/worship/sessions/${sid}/queue/next`, U.child)).status === 403);
  ok("child can still read the Gathering (late-join state)", (await call("GET", `/family/worship/sessions/${sid}`, U.child)).status === 200);

  // Rule 5 — search.
  const s1 = await call("GET", "/search?q=kid", U.searcher);
  const s2 = await call("GET", "/search?q=tia", U.searcher);
  // Response: { groups: [{ type: "person", results: [{ id: <userId>, ... }] }, ...] }
  const people = (b) => ((b?.groups ?? []).find((g) => g.type === "person")?.results ?? []).map((r) => r.id);
  ok("search never returns a child", s1.status === 200 && Array.isArray(s1.body?.groups) && !people(s1.body).includes(U.child), JSON.stringify(s1.body).slice(0, 300));
  ok("search still returns teens and adults", people(s2.body).includes(U.teen) && people((await call("GET", "/search?q=ada", U.searcher)).body).includes(U.adult), JSON.stringify(s2.body).slice(0, 300));
  // Prove the child WOULD match the query without the safeguard (so the check above isn't vacuous).
  await db.query(`update p2p_family_members set role = 'adult' where user_id = $1`, [U.child]);
  ok("control: the same search finds them once they're not a child", people((await call("GET", "/search?q=kid", U.searcher)).body).includes(U.child));
  await db.query(`update p2p_family_members set role = 'child' where user_id = $1`, [U.child]);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
