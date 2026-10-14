// Database tests for migration 179 (message receipts), run against a real
// PostgreSQL engine in-process (PGlite) — never against a live database.
//
//   1. Builds a minimal stub of the live schema the migration depends on
//      (shapes and policies taken from the read-only production catalog
//      audit: p2p_profiles, p2p_conversations, p2p_conversation_members,
//      p2p_messages, p2p_is_conversation_member, messages RLS, Supabase-style
//      roles, auth.uid(), the supabase_realtime publication).
//   2. Applies migrations/179_message_receipts.sql exactly as written, twice
//      (re-run safety).
//   3. Exercises every write/read path as different signed-in users.
//
// PGlite is NOT a project dependency. To run:
//   mkdir /tmp/pglite && cd /tmp/pglite && npm i @electric-sql/pglite@0.5.8
//   PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/receipts-db-test/run.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, "../../migrations/179_message_receipts.sql");
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);
const db = new PGlite();

const U = {
  alice: "00000000-0000-4000-8000-00000000000a", // sender
  bob: "00000000-0000-4000-8000-00000000000b",   // direct recipient / group member
  carol: "00000000-0000-4000-8000-00000000000c", // group member
  dave: "00000000-0000-4000-8000-00000000000d",  // joins group late
  eve: "00000000-0000-4000-8000-00000000000e",   // outsider
};
const C = { direct: "10000000-0000-4000-8000-000000000001", group: "10000000-0000-4000-8000-000000000002" };

const STUB = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create publication supabase_realtime;

create table public.p2p_profiles (
  id uuid primary key, full_name text, username text, photo_url text);
create table public.p2p_conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct','group')),
  conversation_type text not null default 'direct', created_at timestamptz not null default now());
create table public.p2p_conversation_members (
  conversation_id uuid not null references public.p2p_conversations(id) on delete cascade,
  user_id uuid not null references public.p2p_profiles(id) on delete cascade,
  joined_at timestamptz not null default now(), last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id));
create table public.p2p_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.p2p_conversations(id) on delete cascade,
  sender_id uuid references public.p2p_profiles(id) on delete cascade,
  body text, created_at timestamptz not null default now(),
  message_type text not null default 'text', deleted_at timestamptz);

create function public.p2p_is_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns boolean language sql security definer set search_path = public stable as
  $$ select exists (select 1 from p2p_conversation_members where conversation_id = p_conversation_id and user_id = p_user_id) $$;
grant execute on function public.p2p_is_conversation_member(uuid, uuid) to authenticated;

alter table public.p2p_messages enable row level security;
create policy messages_select on public.p2p_messages for select to authenticated
  using (p2p_is_conversation_member(conversation_id, auth.uid()));
alter table public.p2p_conversation_members enable row level security;
create policy conversation_members_select on public.p2p_conversation_members for select to authenticated
  using (user_id = auth.uid() or p2p_is_conversation_member(conversation_id, auth.uid()));
-- Live-like privileges: profiles readable; client UPDATE limited to a
-- column list that does NOT include send_read_receipts (migration 174).
grant select on public.p2p_profiles, public.p2p_conversations, public.p2p_conversation_members, public.p2p_messages to authenticated;
grant update (full_name) on public.p2p_profiles to authenticated;
`;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ""]);
  await db.exec(user === "anon" ? "set role anon" : "set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
async function expectError(name, fn, code) {
  try { await fn(); ok(name, false, "(no error)"); }
  catch (e) { ok(name, !code || e.code === code, `(got ${e.code}: ${e.message})`); }
}
const ack = (ids, read) => db.query(`select * from p2p_acknowledge_messages($1::uuid[], $2)`, [ids, read]);
const receipt = async (msg, user) => (await db.query(
  `select delivered_at, read_at from p2p_message_receipts where message_id = $1 and user_id = $2`, [msg, user])).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await db.exec(STUB);
const migration = readFileSync(MIGRATION, "utf8");
await db.exec(migration);
await db.exec(migration); // re-run safety
ok("migration re-runs cleanly", true);

// Fixtures (as table owner)
for (const [k, id] of Object.entries(U)) await db.query(`insert into p2p_profiles (id, full_name, username) values ($1, $2, $3)`, [id, k[0].toUpperCase() + k.slice(1), k]);
await db.query(`insert into p2p_conversations (id, type) values ($1, 'direct'), ($2, 'group')`, [C.direct, C.group]);
const past = "now() - interval '1 hour'";
await db.exec(`insert into p2p_conversation_members (conversation_id, user_id, joined_at) values
  ('${C.direct}', '${U.alice}', ${past}), ('${C.direct}', '${U.bob}', ${past}),
  ('${C.group}', '${U.alice}', ${past}), ('${C.group}', '${U.bob}', ${past}), ('${C.group}', '${U.carol}', ${past})`);
const msg = async (conv, sender, extra = {}) => (await db.query(
  `insert into p2p_messages (conversation_id, sender_id, body, message_type, deleted_at) values ($1, $2, 'x', $3, $4) returning id`,
  [conv, sender, extra.type ?? "text", extra.deletedAt ?? null])).rows[0].id;

const d1 = await msg(C.direct, U.alice);
const d2 = await msg(C.direct, U.alice);
const g1 = await msg(C.group, U.alice);
const bobsOwn = await msg(C.direct, U.bob);
const deleted = await msg(C.direct, U.alice, { deletedAt: new Date().toISOString() });
const callSummary = await msg(C.direct, U.alice, { type: "call_summary" });

// ── State machine: Sent -> Delivered -> Read, idempotent, monotonic ────────
ok("no receipt before acknowledgement (Sent)", !(await receipt(d1, U.bob)));
let r = await as(U.bob, () => ack([d1], false));
ok("delivered ack returns the row", r.rows.length === 1 && r.rows[0].read_at === null);
const delivered1 = (await receipt(d1, U.bob)).delivered_at;
ok("delivered ack creates delivered_at only", !!delivered1 && (await receipt(d1, U.bob)).read_at === null);
await sleep(15);
await as(U.bob, () => ack([d1], false));
ok("duplicate delivered ack keeps original delivered_at", +(await receipt(d1, U.bob)).delivered_at === +delivered1);
await sleep(15);
await as(U.bob, () => ack([d1], true));
const afterRead = await receipt(d1, U.bob);
ok("read ack sets read_at", !!afterRead.read_at);
ok("read ack keeps delivered_at", +afterRead.delivered_at === +delivered1);
ok("read_at >= delivered_at", +afterRead.read_at >= +afterRead.delivered_at);
await sleep(15);
await as(U.bob, () => ack([d1], false));
await as(U.bob, () => ack([d1], true));
const later = await receipt(d1, U.bob);
ok("late delivered ack never regresses Read", +later.read_at === +afterRead.read_at && +later.delivered_at === +delivered1);
ok("one row per message/recipient", (await db.query(`select count(*)::int n from p2p_message_receipts where message_id = $1`, [d1])).rows[0].n === 1);
await as(U.bob, () => ack([d2], true));
const directRead = await receipt(d2, U.bob);
ok("first ack as read sets both timestamps", !!directRead.delivered_at && !!directRead.read_at);
await as(U.bob, () => ack([d2, d2, d2], true));
ok("repeated ids in one call stay one row", (await db.query(`select count(*)::int n from p2p_message_receipts where message_id = $1`, [d2])).rows[0].n === 1);

// ── Authorization: who may acknowledge ──────────────────────────────────────
await as(U.alice, () => ack([d1, d2, g1], true));
ok("sender cannot acknowledge own messages", !(await receipt(d1, U.alice)) && !(await receipt(g1, U.alice)));
await as(U.eve, () => ack([d1, g1], true));
ok("non-member cannot acknowledge", !(await receipt(d1, U.eve)) && !(await receipt(g1, U.eve)));
await as(U.bob, () => ack([deleted, callSummary], true));
ok("deleted-for-everyone not acknowledged", !(await receipt(deleted, U.bob)));
ok("call summary not acknowledged", !(await receipt(callSummary, U.bob)));
await as(U.bob, () => ack(["20000000-0000-4000-8000-000000000999"], true));
ok("unknown id ignored", (await db.query(`select count(*)::int n from p2p_message_receipts where message_id = '20000000-0000-4000-8000-000000000999'`)).rows[0].n === 0);
await expectError("unauthenticated ack rejected", () => as(null, () => ack([d1], true)), "42501");
await expectError("anon cannot execute ack", () => as("anon", () => ack([d1], true)), "42501");
await expectError("more than 200 ids rejected", () => as(U.bob, () => ack(Array.from({ length: 201 }, () => d1), true)), "22023");

// ── No direct client writes ────────────────────────────────────────────────
await expectError("client INSERT denied", () => as(U.bob, () => db.query(
  `insert into p2p_message_receipts (message_id, user_id, conversation_id) values ($1, $2, $3)`, [g1, U.bob, C.group])), "42501");
await expectError("client UPDATE denied (forge read)", () => as(U.alice, () => db.query(
  `update p2p_message_receipts set read_at = now() where message_id = $1`, [d1])), "42501");
await expectError("client DELETE denied", () => as(U.bob, () => db.query(
  `delete from p2p_message_receipts where message_id = $1`, [d1])), "42501");
await expectError("anon SELECT denied", () => as("anon", () => db.query(`select * from p2p_message_receipts`)), "42501");

// ── Group: per participant, private between recipients ─────────────────────
await as(U.bob, () => ack([g1], true));
await as(U.carol, () => ack([g1], false));
const gb = await receipt(g1, U.bob), gc = await receipt(g1, U.carol);
ok("group: bob read, carol only delivered", !!gb.read_at && !!gc.delivered_at && gc.read_at === null);
const senderView = await as(U.alice, () => db.query(`select user_id, read_at from p2p_message_receipts where message_id = $1 order by user_id`, [g1]));
ok("sender sees each recipient's receipt", senderView.rows.length === 2);
const carolView = await as(U.carol, () => db.query(`select user_id from p2p_message_receipts where message_id = $1`, [g1]));
ok("recipient sees only own receipt", carolView.rows.length === 1 && carolView.rows[0].user_id === U.carol);
const eveView = await as(U.eve, () => db.query(`select * from p2p_message_receipts`));
ok("outsider sees nothing", eveView.rows.length === 0);

// ── Message info (sender only) ──────────────────────────────────────────────
const details = await as(U.alice, () => db.query(`select * from p2p_message_receipt_details($1)`, [g1]));
const byUser = Object.fromEntries(details.rows.map((x) => [x.user_id, x]));
ok("details: one row per recipient (bob, carol)", details.rows.length === 2 && !!byUser[U.bob] && !!byUser[U.carol]);
ok("details: per-recipient timestamps", !!byUser[U.bob].read_at && byUser[U.carol].read_at === null && !!byUser[U.carol].delivered_at);
ok("details: sender not listed", !byUser[U.alice]);
await expectError("details denied to a recipient", () => as(U.bob, () => db.query(`select * from p2p_message_receipt_details($1)`, [g1])), "42501");
await expectError("details denied to outsider", () => as(U.eve, () => db.query(`select * from p2p_message_receipt_details($1)`, [g1])), "42501");

// ── Late joiner and leaver ─────────────────────────────────────────────────
await db.query(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [C.group, U.dave]);
await as(U.dave, () => ack([g1], true));
ok("late joiner cannot acknowledge earlier messages", !(await receipt(g1, U.dave)));
const g2 = await msg(C.group, U.alice);
await as(U.dave, () => ack([g2], true));
ok("late joiner acknowledges later messages", !!(await receipt(g2, U.dave))?.read_at);
const detailsLate = await as(U.alice, () => db.query(`select user_id from p2p_message_receipt_details($1)`, [g1]));
ok("late joiner not a recipient of earlier message", !detailsLate.rows.some((x) => x.user_id === U.dave));
await db.query(`delete from p2p_conversation_members where conversation_id = $1 and user_id = $2`, [C.group, U.carol]);
const afterLeave = await as(U.alice, () => db.query(`select user_id, is_current_member from p2p_message_receipt_details($1)`, [g1]));
const carolRow = afterLeave.rows.find((x) => x.user_id === U.carol);
ok("leaver keeps their past receipt, marked not current", !!carolRow && carolRow.is_current_member === false);
const carolAfterLeave = await as(U.carol, () => db.query(`select * from p2p_message_receipts where conversation_id = $1`, [C.group]));
ok("leaver can no longer read group receipts", carolAfterLeave.rows.length === 0);
await as(U.carol, () => ack([g2], true));
ok("leaver cannot acknowledge", !(await receipt(g2, U.carol)));

// ── Read-receipt privacy ────────────────────────────────────────────────────
await expectError("direct client UPDATE of preference denied", () => as(U.bob, () => db.query(
  `update p2p_profiles set send_read_receipts = false where id = $1`, [U.bob])), "42501");
ok("preference defaults to on", (await as(U.bob, () => db.query(`select p2p_get_my_read_receipts() v`))).rows[0].v === true);
await as(U.bob, () => db.query(`select p2p_set_my_read_receipts(false)`));
ok("preference set off through RPC", (await as(U.bob, () => db.query(`select p2p_get_my_read_receipts() v`))).rows[0].v === false);
ok("turning off keeps historical read receipts", !!(await receipt(d1, U.bob)).read_at);
const d3 = await msg(C.direct, U.alice);
await as(U.bob, () => ack([d3], true));
const d3r = await receipt(d3, U.bob);
ok("receipts off: read ack records delivery only", !!d3r.delivered_at && d3r.read_at === null);
const back = await msg(C.direct, U.bob);
await as(U.alice, () => ack([back], true));
const aliceSeesBobsReceipt = await as(U.bob, () => db.query(`select read_at from p2p_message_receipts where message_id = $1`, [back]));
ok("receipts off: still receives others' read receipts", !!aliceSeesBobsReceipt.rows[0]?.read_at);
await as(U.bob, () => db.query(`select p2p_set_my_read_receipts(true)`));
const stillUnread = await receipt(d3, U.bob);
ok("turning on does not fabricate past reads", stillUnread.read_at === null);
await as(U.bob, () => ack([d3], true));
ok("after turning on, a new read ack records read", !!(await receipt(d3, U.bob)).read_at);
await expectError("null preference rejected", () => as(U.bob, () => db.query(`select p2p_set_my_read_receipts(null)`)), "22004");
await expectError("anon cannot set preference", () => as("anon", () => db.query(`select p2p_set_my_read_receipts(false)`)), "42501");

// ── Deletion behaviour ─────────────────────────────────────────────────────
await db.query(`update p2p_messages set deleted_at = now(), body = null where id = $1`, [d1]);
ok("delete-for-everyone keeps existing receipt", !!(await receipt(d1, U.bob)));
await db.query(`delete from p2p_messages where id = $1`, [d2]);
ok("hard-deleted message cascades its receipts", !(await receipt(d2, U.bob)));
await db.query(`delete from p2p_profiles where id = $1`, [U.dave]);
ok("deleted profile cascades its receipts", !(await receipt(g2, U.dave)));

// ── Constraints and publication ────────────────────────────────────────────
await expectError("read before delivered rejected by constraint", () => db.query(
  `insert into p2p_message_receipts (message_id, user_id, conversation_id, delivered_at, read_at) values ($1, $2, $3, now(), now() - interval '1 minute')`,
  [g2, U.bob, C.group]), "23514");
ok("table is in supabase_realtime", (await db.query(
  `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'p2p_message_receipts'`)).rows.length === 1);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
