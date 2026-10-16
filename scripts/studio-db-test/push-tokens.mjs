// Push token ownership: the REAL /api/push/register and /api/push/unregister
// (routes/push.ts) through the lab bundle on PGlite. Reproduces the
// 2026-10-16 bug — one iPhone install with an old token (previous build /
// EAS project) still active for account B while it is now signed in as A,
// so A received pushes meant for B, including A's own messages to B — and
// proves the fix: registering retires every other active token of the same
// install + platform; signing out retires the caller's tokens on that install.
// Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/push-tokens.mjs
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const A = "00000000-0000-4000-8000-0000000007a1", B = "00000000-0000-4000-8000-0000000007b1", C = "00000000-0000-4000-8000-0000000007c1";
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
  create table public.p2p_push_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null, token text not null unique,
    platform text not null, device_id text, is_active boolean not null default true, created_at timestamptz default now(),
    updated_at timestamptz default now(), last_seen_at timestamptz, call_system boolean);
  insert into p2p_profiles (id, full_name) values ('${A}', 'Ada'), ('${B}', 'Ben'), ('${C}', 'Cy');
`);
const tmp = mkdtempSync(path.join(os.tmpdir(), "push-tokens-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/push`;
const post = async (p, who, body) => { const r = await fetch(base + p, { method: "POST", headers: { authorization: `Bearer ${who}`, "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => null) }; };
const active = async (where = "true") => (await db.query(`select user_id, token, platform, device_id from p2p_push_tokens where is_active and ${where} order by token`)).rows;

try {
  // Before the fix's situation: install X once ran an older build signed in as Ben (token OLD).
  await db.query(`insert into p2p_push_tokens (user_id, token, platform, device_id) values ($1, 'ExponentPushToken[OLD-from-previous-build]', 'ios', 'install-X')`, [B]);
  await db.query(`insert into p2p_push_tokens (user_id, token, platform, device_id) values ($1, 'voip-old', 'ios_voip', 'install-X')`, [B]);
  // Another phone of Ben's, and Cy's phone — must not be touched.
  await db.query(`insert into p2p_push_tokens (user_id, token, platform, device_id) values ($1, 'ExponentPushToken[BEN-android]', 'android', 'install-Y')`, [B]);
  await db.query(`insert into p2p_push_tokens (user_id, token, platform, device_id) values ($1, 'ExponentPushToken[CY]', 'ios', 'install-Z')`, [C]);

  // The new build on install X (new Expo project → new token) signs in as Ada.
  const r = await post("/register", A, { token: "ExponentPushToken[NEW-current-build]", platform: "ios", deviceId: "install-X" });
  ok("register succeeds", r.status === 200 && r.body?.registered === true);
  const x = await active(`device_id = 'install-X' and platform = 'ios'`);
  ok("install X now has exactly ONE active iOS token — Ada's new one", x.length === 1 && x[0].user_id === A && x[0].token === "ExponentPushToken[NEW-current-build]", JSON.stringify(x));
  ok("Ben's old token on install X retired (Ada no longer gets Ben's pushes)", !(await active(`token = 'ExponentPushToken[OLD-from-previous-build]'`)).length);
  ok("other platform on the same install untouched until it re-registers (VoIP)", (await active(`token = 'voip-old'`)).length === 1);
  ok("Ben's other phone untouched", (await active(`token = 'ExponentPushToken[BEN-android]'`)).length === 1);
  ok("Cy's phone untouched", (await active(`token = 'ExponentPushToken[CY]'`)).length === 1);

  const v = await post("/register", A, { token: "voip-new", platform: "ios_voip", deviceId: "install-X", callSystem: true });
  ok("VoIP re-register retires the old VoIP token on that install", v.status === 200 && !(await active(`token = 'voip-old'`)).length && (await active(`token = 'voip-new'`)).length === 1);

  const again = await post("/register", A, { token: "ExponentPushToken[NEW-current-build]", platform: "ios", deviceId: "install-X" });
  ok("re-registering the same token is harmless (stays active, one row)", again.status === 200 && (await active(`device_id = 'install-X' and platform = 'ios'`)).length === 1);

  const noDev = await post("/register", C, { token: "ExponentPushToken[CY-web-nodevice]", platform: "ios" });
  ok("no deviceId → nothing else retired", noDev.status === 200 && (await active(`token = 'ExponentPushToken[CY]'`)).length === 1);

  // Same token moving to another account (sign-out/sign-in on one phone) still reassigns ownership.
  await post("/register", B, { token: "ExponentPushToken[NEW-current-build]", platform: "ios", deviceId: "install-X" });
  const moved = await active(`token = 'ExponentPushToken[NEW-current-build]'`);
  ok("token reassigned to whoever signs in", moved.length === 1 && moved[0].user_id === B);

  // Sign-out: retires the caller's tokens on that install (all platforms), nobody else's.
  await db.query(`insert into p2p_push_tokens (user_id, token, platform, device_id) values ($1, 'stale-ben-x', 'ios', 'install-X')`, [B]);
  await db.query(`update p2p_push_tokens set user_id = $1 where token = 'voip-new'`, [B]);
  const out = await post("/unregister", B, { token: "ExponentPushToken[NEW-current-build]" });
  ok("sign-out succeeds", out.status === 200 && out.body?.unregistered === true);
  ok("sign-out retired ALL of Ben's tokens on install X", !(await active(`device_id = 'install-X' and user_id = '${B}'`)).length);
  ok("sign-out left Ben's other phone and other users alone", (await active(`token = 'ExponentPushToken[BEN-android]'`)).length === 1 && (await active(`token = 'ExponentPushToken[CY]'`)).length === 1);
  const forged = await post("/unregister", A, { token: "ExponentPushToken[CY]" });
  ok("unregistering someone else's token is a no-op", forged.status === 200 && (await active(`token = 'ExponentPushToken[CY]'`)).length === 1);
  ok("no sign-in → 401", (await fetch(base + "/register", { method: "POST" })).status === 401);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
