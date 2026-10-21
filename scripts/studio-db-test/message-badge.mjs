// App-icon badge = unread chat messages only (lib/messageBadge.ts, used by
// the push dispatcher): real code on PGlite through the lab bundle.
// Proves: counts only other people's messages newer than the reader's
// last_read_at; muted chats don't count; my own messages never count;
// chats I'm not in never count; Notification Center items never count;
// several recipients in one batched call; nothing unread → 0.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/message-badge.mjs
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000015${String(n).padStart(2, "0")}`;
const U = { me: id(1), ann: id(2), ben: id(3), quiet: id(4) };
const C = { dm: id(10), group: id(11), muted: id(12), notMine: id(13), read: id(14) };

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text);
  create table public.p2p_conversation_members (id uuid primary key default gen_random_uuid(), conversation_id uuid, user_id uuid, last_read_at timestamptz not null default now());
  create table public.p2p_conversation_settings (id uuid primary key default gen_random_uuid(), conversation_id uuid, user_id uuid, is_muted boolean default false);
  create table public.p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid, body text, created_at timestamptz default now());
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, read boolean default false, created_at timestamptz default now());
`);
await db.query(`insert into p2p_profiles (id) select unnest($1::uuid[])`, [Object.values(U)]);
const t = (min) => new Date(Date.now() + min * 60_000).toISOString();
// My chats: dm (read up to -60), group (read up to -30), muted (read up to -60), read (read up to now).
for (const [c, u, read] of [[C.dm, U.me, -60], [C.dm, U.ann, 0], [C.group, U.me, -30], [C.group, U.ann, 0], [C.group, U.ben, -100],
  [C.muted, U.me, -60], [C.read, U.me, 0], [C.notMine, U.ann, -60], [C.notMine, U.quiet, 0]])
  await db.query(`insert into p2p_conversation_members (conversation_id, user_id, last_read_at) values ($1,$2,$3)`, [c, u, t(read)]);
await db.query(`insert into p2p_conversation_settings (conversation_id, user_id, is_muted) values ($1,$2,true)`, [C.muted, U.me]);
const msg = (c, s, min) => db.query(`insert into p2p_messages (conversation_id, sender_id, created_at) values ($1,$2,$3)`, [c, s, t(min)]);
await msg(C.dm, U.ann, -90);   // older than my last read → read
await msg(C.dm, U.ann, -10);   // unread
await msg(C.dm, U.ann, -5);    // unread
await msg(C.dm, U.me, -4);     // mine → never counts
await msg(C.group, U.ben, -40); // before my last read
await msg(C.group, U.ben, -20); // unread
await msg(C.muted, U.ann, -10); await msg(C.muted, U.ann, -9); // muted chat → doesn't count
await msg(C.read, U.ann, -10); // already read
await msg(C.notMine, U.ann, -1); // not my chat
// 136 Notification Center items — must NOT touch the badge.
await db.query(`insert into p2p_notifications (user_id, title) select $1, 'n' from generate_series(1,136)`, [U.me]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "message-badge-"));
const libPath = path.join(repo, "artifacts/api-server/src/lib/messageBadge.ts").replace(/\\/g, "/");
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db,
  extraRoutes: `import { unreadMessageCounts } from ${JSON.stringify(libPath)};
app.get("/__badge", async (req, res) => res.json(Object.fromEntries(await unreadMessageCounts(String(req.query.u || "").split(",").filter(Boolean)))));` });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const badge = async (...users) => (await (await fetch(`http://127.0.0.1:${server.address().port}/__badge?u=${users.join(",")}`)).json());

try {
  const b = await badge(U.me);
  ok("me: 3 unread messages (2 in the DM + 1 in the group) — not the 136 notifications", b[U.me] === 3, JSON.stringify(b));
  ok("Ann: everything others sent is older than her last read → 0", (await badge(U.ann))[U.ann] === 0, JSON.stringify(await badge(U.ann)));
  ok("Ben: his own group messages never count for him → 0", (await badge(U.ben))[U.ben] === 0, JSON.stringify(await badge(U.ben)));
  ok("Quiet: Ann's message in their shared chat, sent before Quiet's last read → 0", (await badge(U.quiet))[U.quiet] === 0);
  const all = await badge(U.me, U.ann, U.ben, U.quiet);
  ok("batched: every recipient answered in one call, same numbers", all[U.me] === 3 && all[U.ann] === 0 && all[U.ben] === 0 && all[U.quiet] === 0, JSON.stringify(all));
  await db.query(`update p2p_conversation_settings set is_muted = false where conversation_id = $1`, [C.muted]);
  ok("un-muting the chat makes its 2 messages count (3 → 5)", (await badge(U.me))[U.me] === 5);
  await db.query(`update p2p_conversation_members set last_read_at = now() + interval '1 minute' where user_id = $1`, [U.me]);
  ok("after reading everything: 0", (await badge(U.me))[U.me] === 0);
  ok("no recipients → empty", Object.keys(await badge()).length === 0);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
