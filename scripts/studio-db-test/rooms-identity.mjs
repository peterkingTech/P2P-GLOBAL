// Break Rooms — who is acting (security fix): the REAL /api/calls/rooms routes
// on the real room migrations (058, 061), in PGlite through the lab bundle.
// Proves: with a sign-in token the identity comes from the token and a
// mismatching body id is refused (no acting as someone else); without a token
// installed builds keep working (body id) until ROOMS_REQUIRE_AUTH=true, after
// which token-less requests are refused; host-only actions stay host-only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/rooms-identity.mjs
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

const id = (n) => `00000000-0000-4000-8000-0000000013${String(n).padStart(2, "0")}`;
const U = { host: id(1), guest: id(2), other: id(3) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text);
  create table public.p2p_sessions (id uuid primary key); create table public.p2p_peer_circles (id uuid primary key);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, created_at timestamptz default now());
  create table public.p2p_curriculums (id uuid primary key, tags text[]); create table public.p2p_modules (id uuid primary key, curriculum_id uuid);
  create table public.p2p_lessons (id uuid primary key, module_id uuid); create table public.p2p_lesson_progress (id uuid primary key default gen_random_uuid(), user_id uuid, lesson_id uuid);
`);
await db.exec(mig("058_calls_and_rooms.sql"));
await db.exec(mig("061_break_room_extras.sql"));
await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name) select x, 'User' from unnest($1::uuid[]) x`, [Object.values(U)]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "rooms-identity-"));
const callsPath = path.join(repo, "artifacts/api-server/src/routes/calls.ts").replace(/\\/g, "/");
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db,
  extraRoutes: `import callsRouter from ${JSON.stringify(callsPath)};\napp.use("/api", express.json(), callsRouter);` });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};

try {
  // ── With a sign-in token (new builds) ────────────────────────────────────
  let r = await call("POST", "/calls/rooms", U.host, { hostId: U.host, name: "Evening prayer" });
  ok("host creates a room with their token", r.status === 200 && r.body?.id, JSON.stringify(r.body));
  const room = r.body.id;
  ok("can't create a room as someone else (body hostId ≠ token)", (await call("POST", "/calls/rooms", U.guest, { hostId: U.host, name: "x" })).status === 403);
  ok("with a token, the body id is optional (token is the identity)", (await call("POST", `/calls/rooms/${room}/join`, U.guest, {})).status === 200);
  ok("can't join as someone else", (await call("POST", `/calls/rooms/${room}/join`, U.guest, { userId: U.other })).status === 403);
  ok("a bad token is refused, not trusted (401)", (await call("POST", `/calls/rooms/${room}/join`, "not-a-real-token", { userId: U.guest })).status === 401);
  ok("a guest can't end the room by claiming to be the host", (await call("DELETE", `/calls/rooms/${room}`, U.guest, { hostId: U.host })).status === 403
    && (await call("DELETE", `/calls/rooms/${room}`, U.guest, {})).status === 403);
  ok("a guest can't remove people or take the floor by claiming to be the host",
    (await call("POST", `/calls/rooms/${room}/remove`, U.guest, { hostId: U.host, userId: U.other })).status === 403
    && (await call("POST", `/calls/rooms/${room}/set-speaker`, U.guest, { hostId: U.host, speakerId: U.guest })).status === 403);
  ok("a flag is recorded against the real flagger, not a claimed one",
    (await call("POST", `/calls/rooms/${room}/flag`, U.guest, { flaggerId: U.other, reason: "x" })).status === 403
    && (await call("POST", `/calls/rooms/${room}/flag`, U.guest, { reason: "spam" })).status === 200
    && (await db.query(`select flagger_id from p2p_break_room_flags where room_id = $1`, [room])).rows.every((f) => f.flagger_id === U.guest));
  ok("the real host can set the speaker and remove someone", (await call("POST", `/calls/rooms/${room}/set-speaker`, U.host, { speakerId: U.guest })).status === 200
    && (await call("POST", `/calls/rooms/${room}/remove`, U.host, { userId: U.guest })).status === 200);

  // ── Installed builds (no token): unchanged until the switch ──────────────
  r = await call("POST", "/calls/rooms", null, { hostId: U.other, name: "Old-app room" });
  ok("installed builds (no token) still create rooms with the body id", r.status === 200, JSON.stringify(r.body));
  const room2 = r.body.id;
  ok("installed builds still join and leave", (await call("POST", `/calls/rooms/${room2}/join`, null, { userId: U.guest })).status === 200
    && (await call("POST", `/calls/rooms/${room2}/leave`, null, { userId: U.guest })).status === 200);
  ok("no token and no id: refused (400)", (await call("POST", `/calls/rooms/${room2}/join`, null, {})).status === 400);

  // ── After ROOMS_REQUIRE_AUTH=true: tokens only ───────────────────────────
  process.env.ROOMS_REQUIRE_AUTH = "true";
  ok("with the switch on, token-less requests are refused (401)", (await call("POST", `/calls/rooms/${room2}/join`, null, { userId: U.guest })).status === 401
    && (await call("DELETE", `/calls/rooms/${room2}`, null, { hostId: U.other })).status === 401);
  ok("with the switch on, signed-in users carry on", (await call("POST", `/calls/rooms/${room2}/join`, U.guest, {})).status === 200
    && (await call("DELETE", `/calls/rooms/${room2}`, U.other, {})).status === 200);
  delete process.env.ROOMS_REQUIRE_AUTH;
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
