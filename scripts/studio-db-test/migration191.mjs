// Migration 191 (voice-message notification wording) on PGlite.
// Proves: voice messages say "sent you a voice message" ("sent a voice
// message" in groups); text keeps 104's wording; every 104 skip still holds
// (no sender, official send, call summary, muted); no message content in the
// notification; re-runnable; and the function differs from 104's only in the
// wording branch.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration191.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sql191 = readFileSync(path.join(repo, "migrations/191_voice_message_notification_wording.sql"), "utf8");
const sql104 = readFileSync(path.join(repo, "migrations/104_push_notifications.sql"), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
await db.exec(`
  create table p2p_profiles (id uuid primary key, full_name text);
  create table p2p_conversations (id uuid primary key, type text not null);
  create table p2p_conversation_members (conversation_id uuid, user_id uuid);
  create table p2p_conversation_settings (conversation_id uuid, user_id uuid, is_muted boolean);
  create table p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid, content text,
    message_type text default 'text', sent_by_admin_id uuid);
  create table p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    notification_type text, data jsonb, read boolean default false, created_at timestamp default now());
`);
const A = "00000000-0000-0000-0000-0000000007a1", B = "00000000-0000-0000-0000-0000000007b1", C = "00000000-0000-0000-0000-0000000007c1";
const D1 = "44444444-4444-4444-8444-000000000001", G1 = "44444444-4444-4444-8444-000000000002";
await db.exec(`
  insert into p2p_profiles values ('${A}', 'Ada'), ('${B}', 'Ben'), ('${C}', 'Cy');
  insert into p2p_conversations values ('${D1}', 'direct'), ('${G1}', 'group');
  insert into p2p_conversation_members values ('${D1}', '${A}'), ('${D1}', '${B}'), ('${G1}', '${A}'), ('${G1}', '${B}'), ('${G1}', '${C}');
  insert into p2p_conversation_settings values ('${G1}', '${C}', true);
`);
await db.exec(sql191);
await db.exec(sql191); // re-runnable
// The trigger itself comes from 104 (191 only replaces the function).
await db.exec(`create trigger p2p_messages_notify_new_message after insert on p2p_messages for each row execute function p2p_notify_on_new_message();`);

const send = async (conv, sender, type, content = "SECRET CONTENT") => {
  await db.query(`delete from p2p_notifications`);
  await db.query(`insert into p2p_messages (conversation_id, sender_id, message_type, content) values ($1, $2, $3, $4)`, [conv, sender, type, content]);
  return (await db.query(`select user_id, title, message, notification_type, data from p2p_notifications order by user_id`)).rows;
};
let r = await send(D1, A, "voice");
ok("direct voice → 'sent you a voice message'", r.length === 1 && r[0].user_id === B && r[0].title === "Ada" && r[0].message === "sent you a voice message", JSON.stringify(r));
r = await send(G1, A, "voice");
ok("group voice → 'sent a voice message', muted member skipped", r.length === 1 && r[0].user_id === B && r[0].message === "sent a voice message", JSON.stringify(r));
r = await send(D1, A, "text");
ok("direct text unchanged → 'sent you a message'", r.length === 1 && r[0].message === "sent you a message");
r = await send(G1, B, "text");
ok("group text unchanged → 'sent a message'", r.length === 1 && r[0].user_id === A && r[0].message === "sent a message");
r = await send(D1, A, "image");
ok("other types keep the generic wording", r[0].message === "sent you a message");
r = await send(D1, A, "call_summary");
ok("call summaries still skipped", r.length === 0);
await db.query(`delete from p2p_notifications`);
await db.query(`insert into p2p_messages (conversation_id, sender_id, message_type, sent_by_admin_id) values ($1, $2, 'voice', $3)`, [D1, A, C]);
ok("official sends still skipped", (await db.query(`select count(*)::int n from p2p_notifications`)).rows[0].n === 0);
await db.query(`insert into p2p_messages (conversation_id, sender_id, message_type) values ($1, null, 'voice')`, [D1]);
ok("no-sender messages still skipped", (await db.query(`select count(*)::int n from p2p_notifications`)).rows[0].n === 0);
r = await send(D1, A, "voice", "my private voice transcript");
ok("no message content in the notification", !JSON.stringify(r).includes("private") && !JSON.stringify(r).includes("SECRET"));
ok("data payload unchanged (conversationId, messageId, senderId)", Object.keys(r[0].data).sort().join() === "conversationId,messageId,senderId" && r[0].data.senderId === A && r[0].notification_type === "new_message");

// Only the wording branch differs from 104's function.
const body = (s) => {
  const start = s.indexOf("create or replace function public.p2p_notify_on_new_message()");
  const end = s.indexOf("$$;", start);
  return s.slice(start, end).replace(/\s+/g, " ");
};
const b104 = body(sql104), b191 = body(sql191);
const strip191 = b191.replace(" v_is_voice boolean := (new.message_type = 'voice');", "")
  .replace(/case when v_is_voice and v_is_group then 'sent a voice message' when v_is_voice then 'sent you a voice message' when v_is_group then 'sent a message' else 'sent you a message' end/, "case when v_is_group then 'sent a message' else 'sent you a message' end");
ok("function identical to 104 apart from the voice wording", strip191 === b104, "\n104: " + b104.slice(0, 400) + "\n191: " + strip191.slice(0, 400));
ok("191 makes no grant / policy / table changes", !/\b(grant|revoke|policy|alter table|create table|drop )/i.test(sql191.replace(/--.*$/gm, "")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
