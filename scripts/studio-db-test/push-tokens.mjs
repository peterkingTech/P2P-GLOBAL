// Push token ownership: the REAL /api/push/register and /api/push/unregister
// (routes/push.ts) through the lab bundle on PGlite. Reproduces the
// 2026-10-16 bug — one iPhone install with an old token (previous build /
// EAS project) still active for account B while it is now signed in as A,
// so A received pushes meant for B, including A's own messages to B — and
// proves the fix: registering retires every other active token of the same
// install + platform; signing out retires the caller's tokens on that install.
// Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/push-tokens.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

  // ── Same PHYSICAL phone across reinstalls / EAS projects (migration 208) ──
  // Before 208 the column doesn't exist: registering with nativeToken still works.
  const pre = await post("/register", C, { token: "ExponentPushToken[CY-pre208]", platform: "android", deviceId: "install-C", nativeToken: "fcm-native-token-of-cys-phone-0001" });
  ok("pre-208: register with nativeToken still succeeds (column absent)", pre.status === 200 && (await active(`token = 'ExponentPushToken[CY-pre208]'`)).length === 1);
  const m208 = readFileSync(path.join(repo, "migrations/208_push_token_native_hash.sql"), "utf8");
  await db.exec(m208); await db.exec(m208);
  ok("migration 208 applies twice", true);
  // Phone P was signed in as Ben (old install, old EAS project token)...
  await post("/register", B, { token: "ExponentPushToken[P-old-project-ben]", platform: "ios", deviceId: "install-P1", nativeToken: "apns-native-token-of-phone-P-000000" });
  await post("/register", B, { token: "ExponentPushToken[BEN-own-iphone]", platform: "ios", deviceId: "install-B", nativeToken: "apns-native-token-of-bens-iphone-01" });
  // ...then the app was deleted and reinstalled (new install id) and Ada signed in.
  const pa = await post("/register", A, { token: "ExponentPushToken[P-new-project-ada]", platform: "ios", deviceId: "install-P2", nativeToken: "apns-native-token-of-phone-P-000000" });
  ok("reinstall + new project: Ada registers on phone P", pa.status === 200);
  ok("Ben's old token on phone P retired — Ada stops getting Ben's notifications (incl. her own group messages)", !(await active(`token = 'ExponentPushToken[P-old-project-ben]'`)).length);
  ok("phone P has exactly one active iOS token, Ada's", JSON.stringify((await active(`native_token_hash is not null and token like '%[P-%'`)).map((r) => r.user_id)) === JSON.stringify([A]));
  ok("Ben's own iPhone (different native token) untouched", (await active(`token = 'ExponentPushToken[BEN-own-iphone]'`)).length === 1);
  ok("only a SHA-256 is stored, never the native token", !(await db.query(`select 1 from p2p_push_tokens where native_token_hash like '%apns%' or native_token_hash !~ '^[0-9a-f]{64}$'`)).rows.length
    && (await db.query(`select count(*)::int n from p2p_push_tokens where native_token_hash is not null`)).rows[0].n >= 2);
  await post("/register", A, { token: "voip-P", platform: "ios_voip", deviceId: "install-P2", nativeToken: "apns-native-token-of-phone-P-000000" });
  ok("another platform on the same phone is not retired by it", (await active(`token = 'voip-P'`)).length === 1 && (await active(`token = 'ExponentPushToken[P-new-project-ada]'`)).length === 1);
  const junk = await post("/register", C, { token: "ExponentPushToken[CY-junk-native]", platform: "ios", nativeToken: "short" });
  ok("an implausible native token is ignored (no hash stored, nothing retired)", junk.status === 200 && (await db.query(`select native_token_hash from p2p_push_tokens where token = 'ExponentPushToken[CY-junk-native]'`)).rows[0].native_token_hash === null);

  // ── The message trigger itself (migration 191, the live definition) ──
  await db.exec(`
    create table public.p2p_conversations (id uuid primary key, type text not null default 'direct');
    create table public.p2p_conversation_members (conversation_id uuid, user_id uuid);
    create table public.p2p_conversation_settings (conversation_id uuid, user_id uuid, is_muted boolean default false);
    create table public.p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid, sent_by_admin_id uuid, message_type text default 'text', body text);
    create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, read boolean default false, created_at timestamptz default now(), pushed_at timestamptz);
  `);
  const m191 = readFileSync(path.join(repo, "migrations/191_voice_message_notification_wording.sql"), "utf8");
  const fn = m191.slice(m191.indexOf("create or replace function public.p2p_notify_on_new_message()"), m191.indexOf("$$;", m191.indexOf("create or replace function public.p2p_notify_on_new_message()")) + 3);
  await db.exec(fn);
  await db.exec(`create trigger p2p_messages_notify_new_message after insert on public.p2p_messages for each row execute function public.p2p_notify_on_new_message();`);
  const G = "00000000-0000-4000-8000-0000000007d1", D = "00000000-0000-4000-8000-0000000007d2";
  await db.query(`insert into p2p_conversations values ($1,'group'),($2,'direct')`, [G, D]);
  for (const u of [A, B, C]) await db.query(`insert into p2p_conversation_members values ($1,$2)`, [G, u]);
  await db.query(`insert into p2p_conversation_members values ($1,$2),($1,$3)`, [D, A, B]);
  await db.query(`insert into p2p_conversation_settings values ($1,$2,true)`, [G, C]); // Cy muted the group
  const notifs = async () => (await db.query(`select user_id, message, data->>'senderId' s from p2p_notifications order by created_at, user_id`)).rows;
  await db.query(`insert into p2p_messages (conversation_id, sender_id, body) values ($1,$2,'hello group')`, [G, A]);
  let n = await notifs();
  ok("group text: Ben notified, author Ada NOT, muted Cy not", n.length === 1 && n[0].user_id === B && n[0].message === "sent a message", JSON.stringify(n));
  await db.query(`delete from p2p_notifications`);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, message_type) values ($1,$2,'voice')`, [G, A]);
  n = await notifs();
  ok("group voice note: same rule (Ben only, 'sent a voice message')", n.length === 1 && n[0].user_id === B && n[0].message === "sent a voice message");
  await db.query(`delete from p2p_notifications`);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, body) values ($1,$2,'hi')`, [D, B]);
  n = await notifs();
  ok("direct message: only the other person", n.length === 1 && n[0].user_id === A);
  await db.query(`delete from p2p_notifications`);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, body) values ($1,null,'system')`, [G]);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, sent_by_admin_id, body) values ($1,$2,$2,'admin')`, [G, A]);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, message_type) values ($1,$2,'call_summary')`, [G, A]);
  ok("service/system, admin-sent and call-summary messages create no notifications", (await notifs()).length === 0);
  ok("no notification anywhere is addressed to its own sender", !(await db.query(`select 1 from p2p_notifications where user_id::text = data->>'senderId'`)).rows.length);
  ok("no sign-in → 401", (await fetch(base + "/register", { method: "POST" })).status === 401);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
