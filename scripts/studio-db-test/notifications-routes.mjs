// Notifications: the REAL routes (routes/notifications.ts) through the lab
// bundle (lab.mjs) on a p2p_notifications table shaped exactly like
// production's (columns read from the production catalog snapshot). Proves:
// verified sender identity (public fields only, never invented), paging,
// exact unread count, idempotent single mark-read, and per-user isolation.
// Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/notifications-routes.mjs
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

// created_at is "timestamp without time zone" in production; PGlite's JS
// driver reads such values in the process's local zone. PostgREST (production)
// returns them as-is, so pin this process to UTC to round-trip the paging
// cursor the same way.
process.env.TZ = "UTC";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const A = "00000000-0000-0000-0000-0000000002a1", B = "00000000-0000-0000-0000-0000000002b1", C = "00000000-0000-0000-0000-0000000002c1";
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text, email text, date_of_birth date);
  -- Production shape (catalog snapshot 2026-10-15): id, user_id, title, message, notification_type, data, read, created_at, pushed_at.
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    notification_type text, data jsonb, read boolean default false, created_at timestamp without time zone default now(), pushed_at timestamptz);
  alter table public.p2p_notifications enable row level security;
`);
await db.query(`insert into p2p_profiles (id, full_name, photo_url, username, email, date_of_birth) values
  ($1, 'Ada Member', null, 'ada', 'ada@example.invalid', '1990-01-01'),
  ($2, 'Ben Sender', 'https://cdn.example/ben.jpg', 'ben', 'ben@example.invalid', '1991-01-01'),
  ($3, 'Cy Other', null, 'cy', 'cy@example.invalid', '1992-01-01')`, [A, B, C]);
const N = async (user, type, title, message, data, minutesAgo, read = false) => (await db.query(
  `insert into p2p_notifications (user_id, title, message, notification_type, data, read, created_at) values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval) returning id`,
  [user, title, message, type, data, read, String(minutesAgo)])).rows[0].id;
const ids = {
  msg: await N(A, "new_message", "Ben Sender", "sent you a message", { conversationId: "c1", messageId: "m1", senderId: B }, 1),
  call: await N(A, "incoming_call", "Ben Sender is calling you", null, { callId: "x", callerId: B }, 2),
  accepted: await N(A, "connection_accepted", "P2P Connection Accepted", "Ben Sender accepted your P2P connection request.", { requestId: "r", responderId: B }, 3),
  pastoral: await N(A, "pastoral_alert", "Please check in", "Ben hasn't been active.", { discipleId: B, discipleName: "Ben" }, 4),
  report: await N(A, "admin_report_ready", "Your weekly report is ready for review", null, {}, 5),
  bad: await N(A, "new_message", "Someone", "sent you a message", { senderId: "not-a-uuid" }, 6),
  old1: await N(A, "admin_report_ready", "Older report", null, {}, 60, true),
  old2: await N(A, "admin_report_ready", "Oldest report", null, {}, 120),
  cy: await N(C, "new_message", "Ben Sender", "sent you a message", { senderId: B }, 1),
};

const tmp = mkdtempSync(path.join(os.tmpdir(), "notif-routes-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/notifications`;
const call = async (method, p, who) => { const r = await fetch(base + p, { method, headers: who ? { authorization: `Bearer ${who}` } : {} }); return { status: r.status, body: await r.json().catch(() => null) }; };
const unread = async (who) => (await call("GET", "/me/unread-count", who)).body?.count;

try {
  const all = await call("GET", "/me", A);
  const byId = Object.fromEntries((all.body ?? []).map((n) => [n.id, n]));
  ok("GET /me still a plain array (older app builds)", Array.isArray(all.body) && all.body.length === 8, String(all.body?.length));
  ok("newest first", all.body?.[0]?.id === ids.msg);
  ok("message: sender identity from senderId (public fields only)", JSON.stringify(byId[ids.msg]?.actor) === JSON.stringify({ id: B, name: "Ben Sender", photoUrl: "https://cdn.example/ben.jpg", username: "ben" }));
  ok("call: caller identity", byId[ids.call]?.actor?.id === B);
  ok("connection accepted: responder identity", byId[ids.accepted]?.actor?.id === B);
  ok("pastoral alert: the subject is NOT presented as a sender", byId[ids.pastoral]?.actor === null);
  ok("system event: no invented sender", byId[ids.report]?.actor === null);
  ok("malformed sender id → no sender", byId[ids.bad]?.actor === null);
  ok("no private profile fields anywhere", !JSON.stringify(all.body).match(/example\.invalid|date_of_birth|1991-01-01/));
  ok("only my notifications", !byId[ids.cy]);
  ok("message content is not added (body stays the server's)", byId[ids.msg]?.message === "sent you a message");

  const p1 = await call("GET", "/me?limit=3", A);
  const p2 = await call("GET", `/me?limit=3&before=${encodeURIComponent(p1.body.at(-1).createdAt)}`, A);
  const p3 = await call("GET", `/me?limit=3&before=${encodeURIComponent(p2.body.at(-1).createdAt)}`, A);
  const paged = [...p1.body, ...p2.body, ...p3.body].map((n) => n.id);
  ok("paging: pages in order, no overlap, nothing lost", paged.length === 8 && new Set(paged).size === 8 && paged[0] === ids.msg && paged.at(-1) === ids.old2, paged.length);
  ok("paging: limit capped at 100, junk ignored", (await call("GET", "/me?limit=9999&before=garbage", A)).body.length === 8);

  ok("unread count exact (all, not one page)", await unread(A) === 7, String(await unread(A)));
  const r1 = await call("POST", `/me/${ids.msg}/read`, A);
  ok("mark read: first time changes it", r1.status === 200 && r1.body.wasUnread === true && r1.body.isRead === true);
  ok("unread count drops by one", await unread(A) === 6);
  const r2 = await call("POST", `/me/${ids.msg}/read`, A);
  ok("mark read again (duplicate tap / retry): idempotent, wasUnread=false", r2.status === 200 && r2.body.wasUnread === false);
  ok("count unchanged by the duplicate", await unread(A) === 6);
  const others = (await db.query(`select count(*)::int n from p2p_notifications where user_id = $1 and read = false`, [A])).rows[0].n;
  ok("only that notification was marked", others === 6);
  ok("someone else's notification: 404, untouched", (await call("POST", `/me/${ids.cy}/read`, A)).status === 404
    && (await db.query(`select read from p2p_notifications where id = $1`, [ids.cy])).rows[0].read === false);
  ok("malformed id: 404, not a server error", (await call("POST", "/me/not-a-uuid/read", A)).status === 404);
  ok("unknown id: 404", (await call("POST", "/me/00000000-0000-0000-0000-00000000dead/read", A)).status === 404);
  ok("signed out: 401 everywhere", (await call("GET", "/me", null)).status === 401 && (await call("GET", "/me/unread-count", null)).status === 401 && (await call("POST", `/me/${ids.call}/read`, null)).status === 401);
  ok("other user's count unaffected", await unread(C) === 1);
  // Opening a chat (Prompt 2): only THAT chat's message notifications of
  // the caller are marked read — several pushes, duplicates, late ones.
  const CH1 = "00000000-0000-4000-8000-0000000c0001", CH2 = "00000000-0000-4000-8000-0000000c0002";
  const c1a = await N(A, "new_message", "Ben", "sent a message", { conversationId: CH1, messageId: "a", senderId: B }, 3);
  const c1b = await N(A, "new_message", "Ben", "sent a message", { conversationId: CH1, messageId: "b", senderId: B }, 2);
  const c1dup = await N(A, "new_message", "Ben", "sent a message", { conversationId: CH1, messageId: "b", senderId: B }, 1);
  const c2 = await N(A, "new_message", "Cy", "sent a message", { conversationId: CH2, messageId: "c", senderId: C }, 1);
  const callSameChat = await N(A, "incoming_call", "Ben is calling", null, { conversationId: CH1, callId: "k", callerId: B }, 1);
  const cyCh1 = await N(C, "new_message", "Ben", "sent a message", { conversationId: CH1, messageId: "a", senderId: B }, 1);
  const isRead = async (id) => (await db.query(`select read from p2p_notifications where id = $1`, [id])).rows[0].read;
  const before = await unread(A);
  const cr1 = await call("POST", `/me/conversations/${CH1}/read`, A);
  ok("open chat 1: all 3 of its message notifications marked read (incl. duplicate)", cr1.status === 200 && cr1.body.marked === 3 && await isRead(c1a) && await isRead(c1b) && await isRead(c1dup), JSON.stringify(cr1.body));
  ok("open chat 1: chat 2's notification untouched", !(await isRead(c2)));
  ok("open chat 1: a call notification in the same chat untouched (other type)", !(await isRead(callSameChat)));
  ok("open chat 1: another member's notifications for that chat untouched", !(await isRead(cyCh1)));
  ok("unread count drops by exactly 3", await unread(A) === before - 3);
  const cr2 = await call("POST", `/me/conversations/${CH1}/read`, A);
  ok("repeat (duplicate tap / retry): harmless, nothing more marked", cr2.status === 200 && cr2.body.marked === 0 && await unread(A) === before - 3);
  const late = await N(A, "new_message", "Ben", "sent a message", { conversationId: CH1, messageId: "d", senderId: B }, 0);
  ok("a late notification for the open chat is cleared on the next open", (await call("POST", `/me/conversations/${CH1}/read`, A)).body.marked === 1 && await isRead(late));
  ok("malformed conversation id: 404", (await call("POST", "/me/conversations/nope/read", A)).status === 404);
  ok("signed out: 401", (await call("POST", `/me/conversations/${CH1}/read`, null)).status === 401);
  await db.query(`delete from p2p_notifications where id = $1`, [cyCh1]); // keep the read-all check below exact
  ok("read-all: only mine", (await call("POST", "/me/read-all", A)).status === 200 && await unread(A) === 0 && await unread(C) === 1);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  await db.close();
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
