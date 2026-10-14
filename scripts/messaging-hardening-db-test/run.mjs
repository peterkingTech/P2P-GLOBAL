// Database tests for migration 180 (messaging security hardening), on an
// in-process PostgreSQL (PGlite) — never a live database.
// The stub reproduces the LIVE privileges and policies the audit verified
// (table-level INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated on
// p2p_messages and p2p_conversation_members, column-level SELECT on
// p2p_messages, the self-join insert policy, messages_update_pin), applies
// migrations 179 and 180 exactly as written (180 twice), then attacks and
// exercises every legitimate path as signed-in users.
//   PGLITE_MODULE=<path>/@electric-sql/pglite/dist/index.js node scripts/messaging-hardening-db-test/run.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const M179 = readFileSync(path.resolve(here, "../../migrations/179_message_receipts.sql"), "utf8");
const M180 = readFileSync(path.resolve(here, "../../migrations/180_messaging_security_hardening.sql"), "utf8");
if (!process.env.PGLITE_MODULE) { console.error("Set PGLITE_MODULE"); process.exit(2); }
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();

const U = { a: "00000000-0000-4000-8000-00000000000a", b: "00000000-0000-4000-8000-00000000000b", c: "00000000-0000-4000-8000-00000000000c", e: "00000000-0000-4000-8000-00000000000e" };
const D = "10000000-0000-4000-8000-000000000001", G = "10000000-0000-4000-8000-000000000002", X = "10000000-0000-4000-8000-000000000003";

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
create publication supabase_realtime;
create table public.p2p_profiles (id uuid primary key, full_name text, username text, photo_url text);
create table public.p2p_groups (id uuid primary key, peer_guide_id uuid);
create table public.p2p_peer_circles (id uuid primary key, leader_id uuid);
create table public.p2p_conversations (id uuid primary key default gen_random_uuid(), type text not null, conversation_type text not null default 'direct',
  group_id uuid references public.p2p_groups(id), circle_id uuid references public.p2p_peer_circles(id), created_at timestamptz not null default now());
create table public.p2p_conversation_members (conversation_id uuid not null references public.p2p_conversations(id) on delete cascade,
  user_id uuid not null references public.p2p_profiles(id) on delete cascade, joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(), primary key (conversation_id, user_id));
create table public.p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.p2p_conversations(id) on delete cascade,
  sender_id uuid references public.p2p_profiles(id) on delete cascade, body text, media_url text, created_at timestamptz not null default now(),
  flagged_self_harm boolean not null default false, message_type text not null default 'text', call_log_id uuid, is_official_response boolean not null default false,
  crisis_context text, is_pinned boolean not null default false, pinned_by uuid references public.p2p_profiles(id), pinned_at timestamptz, pinned_label text,
  media_duration_seconds integer, subject text, department text, sent_by_admin_id uuid, deleted_at timestamptz, deleted_by uuid,
  reply_to_message_id uuid references public.p2p_messages(id) on delete set null);

create function public.p2p_is_conversation_member(p_conversation_id uuid, p_user_id uuid) returns boolean language sql security definer set search_path = public stable as
  $$ select exists (select 1 from p2p_conversation_members where conversation_id = p_conversation_id and user_id = p_user_id) $$;
create function public.p2p_message_in_conversation(p_message_id uuid, p_conversation_id uuid) returns boolean language sql security definer set search_path = public stable as
  $$ select exists (select 1 from p2p_messages where id = p_message_id and conversation_id = p_conversation_id) $$;
-- verbatim logic of migration 068
create function public.p2p_can_pin_message(p_conversation_id uuid, p_user_id uuid) returns boolean language sql security definer set search_path = public stable as $$
  select p2p_is_conversation_member(p_conversation_id, p_user_id) and (
    (select conversation_type from p2p_conversations where id = p_conversation_id) not in ('peer_group', 'circle')
    or exists (select 1 from p2p_conversations conv left join p2p_groups g on g.id = conv.group_id left join p2p_peer_circles c on c.id = conv.circle_id
      where conv.id = p_conversation_id and (g.peer_guide_id = p_user_id or c.leader_id = p_user_id))); $$;
-- verbatim logic of migration 161
create function public.p2p_delete_message_for_everyone(p_message_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_sender uuid; begin
  select sender_id into v_sender from p2p_messages where id = p_message_id;
  if v_sender is null then raise exception 'Message not found'; end if;
  if v_sender is distinct from auth.uid() then raise exception 'Only the sender can delete this message for everyone'; end if;
  update p2p_messages set body = null, media_url = null, media_duration_seconds = null, deleted_at = now(), deleted_by = auth.uid() where id = p_message_id;
end; $$;
-- shape of migration 166 (trusted creation path; authorization details elided)
create function public.p2p_start_direct_conversation(target_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; begin
  insert into p2p_conversations (type) values ('direct') returning id into v;
  insert into p2p_conversation_members (conversation_id, user_id) values (v, auth.uid()), (v, target_id);
  return v; end; $$;
-- shape of the official-response stamp trigger (068): sets a column clients may not insert
create function public.p2p_stamp_official_response() returns trigger language plpgsql security definer set search_path = public as $$
begin if new.body like '[official]%' then new.is_official_response := true; new.crisis_context := 'Official Response'; end if; return new; end; $$;
create trigger p2p_messages_stamp_official_response before insert on public.p2p_messages for each row execute function public.p2p_stamp_official_response();
grant execute on function public.p2p_is_conversation_member(uuid,uuid), public.p2p_message_in_conversation(uuid,uuid), public.p2p_can_pin_message(uuid,uuid),
  public.p2p_delete_message_for_everyone(uuid), public.p2p_start_direct_conversation(uuid) to authenticated;

-- LIVE policies (audit 2026-10-11)
alter table public.p2p_conversation_members enable row level security;
alter table public.p2p_messages enable row level security;
alter table public.p2p_conversations enable row level security;
create policy conversations_select on public.p2p_conversations for select to authenticated using (p2p_is_conversation_member(id, auth.uid()));
create policy conversation_members_select on public.p2p_conversation_members for select to authenticated using (user_id = auth.uid() or p2p_is_conversation_member(conversation_id, auth.uid()));
create policy conversation_members_insert on public.p2p_conversation_members for insert to authenticated with check (user_id = auth.uid() or p2p_is_conversation_member(conversation_id, auth.uid()));
create policy conversation_members_update on public.p2p_conversation_members for update to authenticated using (user_id = auth.uid());
create policy messages_select on public.p2p_messages for select to authenticated using (p2p_is_conversation_member(conversation_id, auth.uid()));
create policy messages_insert on public.p2p_messages for insert to authenticated with check (sender_id = auth.uid() and p2p_is_conversation_member(conversation_id, auth.uid())
  and (reply_to_message_id is null or p2p_message_in_conversation(reply_to_message_id, conversation_id)));
create policy messages_update_pin on public.p2p_messages for update to authenticated using (p2p_can_pin_message(conversation_id, auth.uid())) with check (p2p_can_pin_message(conversation_id, auth.uid()));

-- LIVE privileges (audit 2026-10-11)
grant select on public.p2p_profiles, public.p2p_conversations to anon, authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.p2p_conversation_members to anon, authenticated;
grant insert, update, delete, truncate, references, trigger on public.p2p_messages to anon, authenticated;
grant select (id, conversation_id, sender_id, body, media_url, created_at, flagged_self_harm, message_type, call_log_id, is_official_response, crisis_context,
  is_pinned, pinned_by, pinned_at, pinned_label, media_duration_seconds, subject, department, deleted_at, reply_to_message_id) on public.p2p_messages to anon, authenticated;
grant all on all tables in schema public to service_role;
`);

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
async function as(user, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? ""]);
  await db.exec(user === "anon" ? "set role anon" : "set role authenticated");
  try { return await fn(); } finally { await db.exec("reset role"); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
async function denied(n, fn) { try { await fn(); ok(n, false, "(no error)"); } catch (e) { ok(n, e.code === "42501", `(${e.code}: ${e.message})`); } }
const q = (s, p) => db.query(s, p);

// ── Baseline: prove the stub has the vulnerabilities before 180 ────────────
for (const [k, id] of Object.entries(U)) await q(`insert into p2p_profiles (id, full_name) values ($1, $2)`, [id, k]);
await q(`insert into p2p_groups (id, peer_guide_id) values ('20000000-0000-4000-8000-000000000001', $1)`, [U.a]);
await q(`insert into p2p_conversations (id, type, conversation_type) values ($1,'direct','direct'), ($2,'group','peer_group'), ($3,'direct','direct')`, [D, G, X]);
await q(`update p2p_conversations set group_id = '20000000-0000-4000-8000-000000000001' where id = $1`, [G]);
await q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1,$3),($1,$4),($2,$3),($2,$4),($2,$5)`, [D, G, U.a, U.b, U.c]);
const before = await as(U.e, async () => { try { await q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [D, U.e]); return "joined"; } catch { return "blocked"; } });
ok("baseline: stub reproduces the self-join vulnerability", before === "joined");
await q(`delete from p2p_conversation_members where conversation_id = $1 and user_id = $2`, [D, U.e]);
const mA = (await as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hello') returning id`, [D, U.a]))).rows[0].id;
const editBefore = await as(U.b, async () => (await q(`update p2p_messages set body = 'tampered' where id = $1`, [mA])).affectedRows);
ok("baseline: stub reproduces the edit-others vulnerability", editBefore === 1);
await q(`update p2p_messages set body = 'hello' where id = $1`, [mA]);

// ── Apply 179 then 180 (twice) ──────────────────────────────────────────────
await db.exec(M179);
await db.exec(M180);
await db.exec(M180);
ok("migration 180 applies and re-applies cleanly", true);

// ── 1. Membership ──────────────────────────────────────────────────────────
await denied("outsider cannot insert self into direct conversation", () => as(U.e, () => q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [D, U.e])));
await denied("outsider cannot insert self into group conversation", () => as(U.e, () => q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [G, U.e])));
await denied("member cannot add someone else", () => as(U.a, () => q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [D, U.e])));
await denied("member cannot move own row to another conversation", () => as(U.a, () => q(`update p2p_conversation_members set conversation_id = $1 where conversation_id = $2 and user_id = $3`, [X, D, U.a])));
await denied("member cannot change own row's user_id", () => as(U.a, () => q(`update p2p_conversation_members set user_id = $1 where conversation_id = $2 and user_id = $3`, [U.e, D, U.a])));
await denied("member cannot backdate joined_at", () => as(U.a, () => q(`update p2p_conversation_members set joined_at = now() - interval '1 year' where conversation_id = $1 and user_id = $2`, [D, U.a])));
await denied("member cannot delete membership rows", () => as(U.a, () => q(`delete from p2p_conversation_members where conversation_id = $1`, [D])));
const lr = await as(U.b, () => q(`update p2p_conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2`, [D, U.b]));
ok("member can still update own last_read_at (unread counts)", lr.affectedRows === 1);
const lrOther = await as(U.b, () => q(`update p2p_conversation_members set last_read_at = now() where conversation_id = $1 and user_id = $2`, [D, U.a]));
ok("member cannot update someone else's last_read_at", lrOther.affectedRows === 0);
const outsiderReads = await as(U.e, () => q(`select id from p2p_messages where conversation_id = $1`, [D]));
ok("outsider still reads nothing", outsiderReads.rows.length === 0);
const conv = await as(U.e, () => q(`select p2p_start_direct_conversation($1) as id`, [U.a]));
ok("trusted path: direct conversation creation still works", !!conv.rows[0].id);
const newMembers = await q(`select count(*)::int n from p2p_conversation_members where conversation_id = $1`, [conv.rows[0].id]);
ok("trusted path created both memberships", newMembers.rows[0].n === 2);
await q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [X, U.e]); // service/definer-side insert (table owner)
ok("server-side (owner) membership insert unaffected", true);
await db.exec("set role service_role");
await q(`insert into p2p_conversation_members (conversation_id, user_id) values ($1, $2)`, [X, U.a]);
await db.exec("reset role");
ok("service_role membership insert unaffected", true);

// ── 2. Message integrity ───────────────────────────────────────────────────
for (const [col, val] of [["body", "'tampered'"], ["sender_id", `'${U.b}'`], ["conversation_id", `'${X}'`], ["created_at", "now() - interval '1 year'"],
  ["deleted_at", "now()"], ["deleted_by", `'${U.b}'`], ["is_official_response", "true"], ["media_url", "'x'"], ["message_type", "'call_summary'"]]) {
  await denied(`recipient cannot update ${col} of another's message`, () => as(U.b, () => q(`update p2p_messages set ${col} = ${val} where id = $1`, [mA])));
}
await denied("sender cannot edit own message body directly either", () => as(U.a, () => q(`update p2p_messages set body = 'edited' where id = $1`, [mA])));
await denied("no client DELETE of messages", () => as(U.a, () => q(`delete from p2p_messages where id = $1`, [mA])));
ok("message body intact", (await q(`select body from p2p_messages where id = $1`, [mA])).rows[0].body === "hello");

// ── 3. Pinning ─────────────────────────────────────────────────────────────
const pin = await as(U.b, () => q(`update p2p_messages set is_pinned = true, pinned_by = $2, pinned_at = now() - interval '1 year', pinned_label = 'note' where id = $1`, [mA, U.a]));
ok("DM member can pin (installed-build update shape)", pin.affectedRows === 1);
const pr = (await q(`select is_pinned, pinned_by, pinned_at, pinned_label from p2p_messages where id = $1`, [mA])).rows[0];
ok("pinned_by is the real pinner, not the spoofed one", pr.pinned_by === U.b);
ok("pinned_at is server time, not the supplied one", Date.now() - +new Date(pr.pinned_at) < 60000);
ok("pin label kept", pr.pinned_label === "note");
const unpin = await as(U.b, () => q(`update p2p_messages set is_pinned = false, pinned_by = null, pinned_at = null, pinned_label = null where id = $1`, [mA]));
const ur = (await q(`select is_pinned, pinned_by, pinned_at, pinned_label from p2p_messages where id = $1`, [mA])).rows[0];
ok("unpin works and clears pin fields", unpin.affectedRows === 1 && !ur.is_pinned && ur.pinned_by === null && ur.pinned_at === null && ur.pinned_label === null);
const gMsg = (await as(U.c, () => q(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'group hi') returning id`, [G, U.c]))).rows[0].id;
const nonLeader = await as(U.b, () => q(`update p2p_messages set is_pinned = true where id = $1`, [gMsg]));
ok("group non-leader cannot pin (policy unchanged)", nonLeader.affectedRows === 0);
const leader = await as(U.a, () => q(`update p2p_messages set is_pinned = true where id = $1`, [gMsg]));
ok("group leader can pin", leader.affectedRows === 1);
await denied("pin path cannot smuggle a body change", () => as(U.a, () => q(`update p2p_messages set is_pinned = true, body = 'x' where id = $1`, [gMsg])));

// ── 4. Timestamps and sending ──────────────────────────────────────────────
await denied("client cannot supply created_at (past)", () => as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body, created_at) values ($1, $2, 'old', now() - interval '1 year')`, [D, U.a])));
await denied("client cannot supply created_at (future)", () => as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body, created_at) values ($1, $2, 'new', now() + interval '1 year')`, [D, U.a])));
const clientId = "30000000-0000-4000-8000-000000000001";
const text = await as(U.a, () => q(`insert into p2p_messages (id, conversation_id, sender_id, body, reply_to_message_id) values ($1, $2, $3, 'text', $4) returning id, created_at, flagged_self_harm`, [clientId, D, U.a, mA]));
ok("text send (client id + reply) works, returns server created_at", text.rows[0].id === clientId && Date.now() - +new Date(text.rows[0].created_at) < 60000);
const voice = await as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, message_type, media_url, media_duration_seconds, reply_to_message_id) values ($1, $2, 'voice', 'https://x/v.m4a', 7, null) returning id`, [D, U.a]));
ok("voice send works", !!voice.rows[0].id);
const official = await as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, '[official] update') returning is_official_response, crisis_context`, [D, U.a]));
ok("trigger-set columns still work (official response stamp)", official.rows[0].is_official_response === true && official.rows[0].crisis_context === "Official Response");
await denied("client cannot set sent_by_admin_id", () => as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body, sent_by_admin_id) values ($1, $2, 'x', $2)`, [D, U.a])));
await denied("client cannot set is_official_response", () => as(U.a, () => q(`insert into p2p_messages (conversation_id, sender_id, body, is_official_response) values ($1, $2, 'x', true)`, [D, U.a])));
await denied("anon cannot insert messages", () => as("anon", () => q(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'x')`, [D, U.a])));
await db.exec("set role service_role");
const svc = await q(`insert into p2p_messages (conversation_id, sender_id, body, created_at, message_type) values ($1, $2, 'system', now() - interval '1 day', 'call_summary') returning created_at`, [D, U.a]);
await db.exec("reset role");
ok("server (service_role) can still set created_at / call summaries", Date.now() - +new Date(svc.rows[0].created_at) > 3600000);

// ── 5. Delete-for-everyone and receipts (179) still work ────────────────────
await as(U.a, () => q(`select p2p_delete_message_for_everyone($1)`, [clientId]));
const del = (await q(`select body, deleted_at, deleted_by from p2p_messages where id = $1`, [clientId])).rows[0];
ok("delete-for-everyone (DEFINER) still works", del.body === null && !!del.deleted_at && del.deleted_by === U.a);
const ack = await as(U.b, () => q(`select * from p2p_acknowledge_messages($1::uuid[], true)`, [[mA]]));
ok("receipt acknowledgement (179) still works", ack.rows.length === 1 && !!ack.rows[0].read_at);
await denied("receipts still not directly writable", () => as(U.a, () => q(`insert into p2p_message_receipts (message_id, user_id, conversation_id) values ($1, $2, $3)`, [mA, U.b, D])));

// ── 6. Privilege inventory ─────────────────────────────────────────────────
const inv = async (table, priv) => (await q(`select coalesce(string_agg(column_name, ',' order by column_name), '') c from information_schema.column_privileges
  where table_schema='public' and table_name=$1 and grantee='authenticated' and privilege_type=$2`, [table, priv])).rows[0].c;
ok("authenticated UPDATE on members = last_read_at only", (await inv("p2p_conversation_members", "UPDATE")) === "last_read_at");
ok("authenticated INSERT on members = none", (await inv("p2p_conversation_members", "INSERT")) === "");
ok("authenticated UPDATE on messages = pin columns only", (await inv("p2p_messages", "UPDATE")) === "is_pinned,pinned_at,pinned_by,pinned_label");
ok("authenticated INSERT on messages = the 8 app columns", (await inv("p2p_messages", "INSERT")) === "body,conversation_id,id,media_duration_seconds,media_url,message_type,reply_to_message_id,sender_id");
const tbl = async (table, role) => (await q(`select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') p from information_schema.role_table_grants
  where table_schema='public' and table_name=$1 and grantee=$2`, [table, role])).rows[0].p;
ok("no table-level INSERT/UPDATE/DELETE/TRUNCATE on messages for anon/authenticated",
  !/INSERT|UPDATE|DELETE|TRUNCATE/.test((await tbl("p2p_messages", "authenticated")) + (await tbl("p2p_messages", "anon"))));
ok("no table-level INSERT/UPDATE/DELETE/TRUNCATE on members for anon/authenticated",
  !/INSERT|UPDATE|DELETE|TRUNCATE/.test((await tbl("p2p_conversation_members", "authenticated")) + (await tbl("p2p_conversation_members", "anon"))));
ok("self-join policy removed", (await q(`select count(*)::int n from pg_policies where policyname = 'conversation_members_insert'`)).rows[0].n === 0);
ok("SELECT privileges unchanged (column SELECT on messages kept)", (await inv("p2p_messages", "SELECT")).includes("reply_to_message_id"));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
