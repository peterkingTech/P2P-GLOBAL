// iPhone long-press preview endpoint: the REAL POST /api/notifications/preview
// (routes/notifications.ts) through the lab bundle, on PGlite with migrations
// 193 + 194 and production-shaped messaging tables. Proves the endpoint
// returns a preview only for the intended recipient, of the intended message,
// while they are a member, the message exists, and their CURRENT level is
// "Name and message" — and the same safe 404 otherwise. Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/notification-preview.mjs
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

process.env.TZ = "UTC";
const SECRET = "lab-preview-secret-0123456789abcdefghij";
process.env.NOTIFICATION_PREVIEW_SECRET = SECRET;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (p, n) => `00000000-0000-4000-8000-${p}${String(n).padStart(12 - p.length, "0")}`;
const U = { ada: id("a", 1), ben: id("a", 2), cy: id("a", 3), eve: id("a", 4) };
const C1 = id("c", 1), C2 = id("c", 2);
const SB = "https://proj.supabase.co";
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text);
  create table public.p2p_conversations (id uuid primary key, type text not null default 'direct');
  create table public.p2p_conversation_members (conversation_id uuid, user_id uuid, last_read_at timestamptz);
  create table public.p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid, body text, message_type text default 'text',
    media_url text, media_duration_seconds numeric, deleted_at timestamptz, created_at timestamptz default now());
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb,
    read boolean default false, created_at timestamp default now(), pushed_at timestamptz);
`);
await db.exec(mig("193_message_preview_privacy.sql"));
await db.exec(mig("194_notification_message_preview_level.sql"));
await db.exec(mig("195_notification_preview_hold_level.sql"));
await db.query(`insert into p2p_profiles (id, full_name) values ($1,'Ada'),($2,'Ben'),($3,'Cy'),($4,'Eve')`, [U.ada, U.ben, U.cy, U.eve]);
await db.query(`update p2p_profiles set notify_message_preview = 'full' where id in ($1, $2)`, [U.ada, U.eve]);
await db.query(`insert into p2p_conversations (id) values ($1), ($2)`, [C1, C2]);
await db.query(`insert into p2p_conversation_members (conversation_id, user_id) values ($1,$2),($1,$3),($1,$4),($5,$6),($5,$3)`, [C1, U.ada, U.ben, U.cy, C2, U.eve]);
const msg = async (conv, sender, extra = {}) => (await db.query(
  `insert into p2p_messages (conversation_id, sender_id, body, message_type, media_url, media_duration_seconds) values ($1,$2,$3,$4,$5,$6) returning id`,
  [conv, sender, extra.body ?? null, extra.type ?? "text", extra.url ?? null, extra.dur ?? null])).rows[0].id;
const note = async (user, conv, m) => (await db.query(
  `insert into p2p_notifications (user_id, title, message, notification_type, data) values ($1,'Ben','sent you a message','new_message',$2) returning id`,
  [user, { conversationId: conv, messageId: m, senderId: U.ben }])).rows[0].id;

const mText = await msg(C1, U.ben, { body: "  Hello Ada, see you at 7  " });
const mVoice = await msg(C1, U.ben, { type: "voice", url: `${SB}/storage/v1/object/public/voice-messages/${U.ben}/v1.m4a`, dur: 12.4 });
const mVoiceForeign = await msg(C1, U.ben, { type: "voice", url: "https://evil.example/v.m4a", dur: -3 });
const mVoiceOtherBucket = await msg(C1, U.ben, { type: "voice", url: `${SB}/storage/v1/object/public/avatars/x.m4a`, dur: null });
const mLong = await msg(C1, U.ben, { body: "x".repeat(1500) });
const mEve = await msg(C2, U.cy, { body: "Eve's private conversation" });
const nText = await note(U.ada, C1, mText), nVoice = await note(U.ada, C1, mVoice), nForeign = await note(U.ada, C1, mVoiceForeign), nOther = await note(U.ada, C1, mVoiceOtherBucket);
const nLong = await note(U.ada, C1, mLong), nEve = await note(U.eve, C2, mEve), nCy = await note(U.cy, C1, mText);

// Real token module + real routes.
const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-preview-db-"));
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
const out = await build({ entryPoints: [path.join(repo, "artifacts/api-server/src/lib/previewToken.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
writeFileSync(path.join(tmp, "pt.mjs"), out.outputFiles[0].text);
const T = await import(pathToFileURL(path.join(tmp, "pt.mjs")).href);
const tok = (n, u, m, c, opts) => T.issuePreviewToken({ notificationId: n, recipientId: u, messageId: m, conversationId: c }, opts);
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db, supabaseUrl: SB });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const url = `http://127.0.0.1:${server.address().port}/api/notifications/preview`;
const preview = async (token, headers = {}) => {
  const r = await fetch(url, { method: "POST", headers: { ...(token != null ? { "x-p2p-preview-token": token } : {}), ...headers } });
  return { status: r.status, body: await r.json().catch(() => null), cache: r.headers.get("cache-control") };
};
const NOPE = (r) => r.status === 404 && r.body?.error === "Preview unavailable";

try {
  const t1 = await preview(tok(nText, U.ada, mText, C1));
  ok("text preview for the intended recipient (trimmed)", t1.status === 200 && t1.body.kind === "text" && t1.body.text === "Hello Ada, see you at 7", JSON.stringify(t1));
  ok("response is minimal and not cacheable", JSON.stringify(Object.keys(t1.body).sort()) === JSON.stringify(["display", "kind", "text"]) && t1.cache === "no-store");
  ok("Name and message → display banner", t1.body.display === "banner");
  const v1 = await preview(tok(nVoice, U.ada, mVoice, C1));
  ok("voice preview: trusted storage link + rounded duration", v1.status === 200 && v1.body.kind === "voice" && v1.body.voice.url === `${SB}/storage/v1/object/public/voice-messages/${U.ben}/v1.m4a` && v1.body.voice.durationSeconds === 12);
  const vf = await preview(tok(nForeign, U.ada, mVoiceForeign, C1));
  ok("foreign voice host is never returned; bad duration → null", vf.status === 200 && vf.body.voice.url === null && vf.body.voice.durationSeconds === null);
  const vo = await preview(tok(nOther, U.ada, mVoiceOtherBucket, C1));
  ok("other storage bucket is never returned", vo.status === 200 && vo.body.voice.url === null);
  const lg = await preview(tok(nLong, U.ada, mLong, C1));
  ok("long text capped at 1000 characters", lg.status === 200 && lg.body.text.length === 1000 && lg.body.text.endsWith("…"));

  // Refusals — all the same 404.
  ok("no token", NOPE(await preview(null)));
  ok("malformed token", NOPE(await preview("v1.garbage.sig")));
  ok("token in the query string is ignored", NOPE(await (async () => { const r = await fetch(`${url}?t=${encodeURIComponent(tok(nText, U.ada, mText, C1))}`, { method: "POST" }); return { status: r.status, body: await r.json() }; })()));
  const good = tok(nText, U.ada, mText, C1);
  ok("tampered signature", NOPE(await preview(good.slice(0, -3) + "AAA")));
  ok("expired token", NOPE(await preview(tok(nText, U.ada, mText, C1, { now: Date.now() - 11 * 60 * 1000 }))));
  ok("token signed with another secret", NOPE(await preview(tok(nText, U.ada, mText, C1, { secret: Buffer.from("another-secret-0123456789abcdefghijkl") }))));
  ok("wrong recipient (Cy reusing Ada's notification)", NOPE(await preview(tok(nText, U.cy, mText, C1))));
  ok("wrong message for that notification", NOPE(await preview(tok(nText, U.ada, mVoice, C1))));
  ok("wrong conversation for that notification", NOPE(await preview(tok(nText, U.ada, mText, C2))));
  ok("another member's message: Ada can't read Eve's conversation", NOPE(await preview(tok(nEve, U.ada, mEve, C2))) && NOPE(await preview(tok(nText, U.ada, mEve, C2))));
  ok("recipient at Name only gets nothing (Cy: member, not the sender)", NOPE(await preview(tok(nCy, U.cy, mText, C1))));
  ok("Eve (Name and message, member of C2) does get her own preview", (await preview(tok(nEve, U.eve, mEve, C2))).status === 200);

  await db.query(`update p2p_profiles set notify_message_preview = 'name' where id = $1`, [U.ada]);
  ok("preference changed after the token was issued → refused", NOPE(await preview(good)));
  await db.query(`update p2p_profiles set notify_message_preview = 'none' where id = $1`, [U.ada]);
  ok("…and under Nothing", NOPE(await preview(good)));
  await db.query(`update p2p_profiles set notify_message_preview = 'full' where id = $1`, [U.ada]);
  ok("…back to Name and message → allowed again", (await preview(good)).status === 200);
  await db.query(`update p2p_profiles set notify_message_preview = 'hold' where id = $1`, [U.ada]);
  const h1 = await preview(good);
  ok("Reveal on hold → same preview, display hold (banner stays private)", h1.status === 200 && h1.body.display === "hold" && h1.body.text === "Hello Ada, see you at 7", JSON.stringify(h1));
  await db.query(`update p2p_profiles set notify_message_preview = 'full' where id = $1`, [U.ada]);
  ok("…display follows the CURRENT level (back to banner)", (await preview(good)).body.display === "banner");

  await db.query(`delete from p2p_conversation_members where conversation_id = $1 and user_id = $2`, [C1, U.ada]);
  ok("recipient removed from the conversation → refused", NOPE(await preview(good)));
  await db.query(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [C1, U.ada]);
  await db.query(`update p2p_messages set deleted_at = now() where id = $1`, [mText]);
  ok("message deleted → refused", NOPE(await preview(good)));
  await db.query(`delete from p2p_messages where id = $1`, [mVoice]);
  ok("message gone → refused", NOPE(await preview(tok(nVoice, U.ada, mVoice, C1))));

  const readBefore = (await db.query(`select count(*) filter (where read)::int r, count(*) filter (where last_read_at is not null)::int lr from p2p_notifications, p2p_conversation_members`)).rows[0];
  await preview(tok(nLong, U.ada, mLong, C1));
  const readAfter = (await db.query(`select count(*) filter (where read)::int r, count(*) filter (where last_read_at is not null)::int lr from p2p_notifications, p2p_conversation_members`)).rows[0];
  ok("a preview changes nothing (no read marks, no membership)", JSON.stringify(readBefore) === JSON.stringify(readAfter));

  delete process.env.NOTIFICATION_PREVIEW_SECRET;
  ok("server without the secret refuses every preview (fail closed)", NOPE(await preview(tok(nLong, U.ada, mLong, C1, { secret: Buffer.from(SECRET) }))));
  process.env.NOTIFICATION_PREVIEW_SECRET = SECRET;
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
