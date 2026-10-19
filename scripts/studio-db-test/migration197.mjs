// Migration 197 (Family + Church group conversations) on PGlite, on a
// minimal copy of the production shapes it touches (p2p_conversations with
// its live check constraints, p2p_conversation_members, family/church member
// tables). Proves: backfill of existing ACTIVE members only; one
// conversation per family/church; membership follows status / is_active on
// insert, update and delete; renames follow; cascades on group deletion;
// no cross-group access; multi-church users get each church's conversation;
// re-runnable; trigger functions aren't callable by signed-in users.
// Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration197.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sql197 = readFileSync(path.join(repo, "migrations/197_family_church_conversations.sql"), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [ADA, BEN, CY, DEE, EVE] = [1, 2, 3, 4, 5].map(id);
const [F1, F2, F3] = [101, 102, 103].map(id);
const [CH1, CH2] = [201, 202].map(id);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  create table auth.users (id uuid primary key);
  create table public.p2p_profiles (id uuid primary key, full_name text);
  create table public.p2p_peer_circles (id uuid primary key, name text);
  create table public.p2p_groups (id uuid primary key);
  create table public.p2p_help_requests (id uuid primary key);
  create table public.p2p_families (id uuid primary key default gen_random_uuid(), name text not null, shepherd_id uuid not null references auth.users(id) on delete cascade, created_at timestamptz not null default now());
  create table public.p2p_family_members (id uuid primary key default gen_random_uuid(), family_id uuid not null references public.p2p_families(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade, role text not null default 'adult', status text not null default 'active', joined_at timestamptz not null default now(), unique (family_id, user_id));
  create table public.p2p_churches (id uuid primary key default gen_random_uuid(), name text not null, country text not null default 'X', created_by uuid not null references public.p2p_profiles(id));
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid not null references public.p2p_churches(id) on delete cascade,
    user_id uuid not null references public.p2p_profiles(id) on delete cascade, role text not null default 'member', is_active boolean not null default true, unique (church_id, user_id));
  -- p2p_conversations / members as live in production (constraints from pg_constraint, 2026-10-18).
  create table public.p2p_conversations (id uuid primary key default gen_random_uuid(), type text, name text, group_id uuid references public.p2p_groups(id) on delete cascade,
    created_at timestamptz default now(), conversation_type text default 'direct', help_request_id uuid references public.p2p_help_requests(id) on delete set null,
    crisis_type text, circle_id uuid references public.p2p_peer_circles(id) on delete cascade,
    constraint p2p_conversations_type_check check (type = any (array['direct','group'])),
    constraint p2p_conversations_conversation_type_check check (conversation_type = any (array['direct','crisis_response','help_request','pastoral','support','peer_group','circle'])));
  create table public.p2p_conversation_members (conversation_id uuid not null references public.p2p_conversations(id) on delete cascade, user_id uuid not null,
    joined_at timestamptz default now(), last_read_at timestamptz default now(), primary key (conversation_id, user_id));
  create function public.p2p_is_conversation_member(p_conversation_id uuid, p_user_id uuid) returns boolean language sql stable security definer set search_path = public
    as 'select exists (select 1 from p2p_conversation_members where conversation_id = p_conversation_id and user_id = p_user_id)';
  alter table public.p2p_conversations enable row level security;
  create policy conversations_select on public.p2p_conversations for select to authenticated using (public.p2p_is_conversation_member(id, auth.uid()));
  grant select on public.p2p_conversations to authenticated;
  grant all on all tables in schema public to service_role;

  insert into auth.users values ('${ADA}'), ('${BEN}'), ('${CY}'), ('${DEE}'), ('${EVE}');
  insert into public.p2p_profiles values ('${ADA}', 'Ada'), ('${BEN}', 'Ben'), ('${CY}', 'Cy'), ('${DEE}', 'Dee'), ('${EVE}', 'Eve');
  -- Existing data before 197: two families (F1 with an invited member), F3 with nobody active; existing circle/direct conversations.
  insert into public.p2p_families (id, name, shepherd_id) values ('${F1}', 'The Ades', '${ADA}'), ('${F2}', 'The Bens', '${BEN}'), ('${F3}', 'Empty', '${CY}');
  insert into public.p2p_family_members (family_id, user_id, role, status) values
    ('${F1}', '${ADA}', 'shepherd', 'active'), ('${F1}', '${BEN}', 'adult', 'active'), ('${F1}', '${CY}', 'teen', 'invited'),
    ('${F2}', '${BEN}', 'shepherd', 'active'), ('${F3}', '${CY}', 'shepherd', 'left');
  insert into public.p2p_churches (id, name, created_by) values ('${CH1}', 'Grace Church', '${ADA}'), ('${CH2}', 'Hope Church', '${DEE}');
  insert into public.p2p_church_members (church_id, user_id, role, is_active) values
    ('${CH1}', '${ADA}', 'senior_pastor', true), ('${CH1}', '${EVE}', 'member', false), ('${CH2}', '${DEE}', 'senior_pastor', true);
  insert into public.p2p_conversations (id, type, conversation_type, name) values ('${id(900)}', 'direct', 'direct', null);
`);
const q = async (sql, p = []) => (await db.query(sql, p)).rows;
const convOf = async (col, gid) => (await q(`select id, name, conversation_type, type from p2p_conversations where ${col} = $1`, [gid]));
const members = async (convId) => (await q(`select user_id from p2p_conversation_members where conversation_id = $1 order by user_id`, [convId])).map((r) => r.user_id);

await db.exec(sql197);

// ── Backfill ───────────────────────────────────────────────────────────────
const [c1] = await convOf("family_id", F1), [c2] = await convOf("family_id", F2);
ok("backfill: one group conversation per family with active members", c1 && c2 && c1.type === "group" && c1.conversation_type === "family" && c1.name === "The Ades");
ok("backfill: only ACTIVE members (invited teen not added)", JSON.stringify(await members(c1.id)) === JSON.stringify([ADA, BEN]));
ok("backfill: family with nobody active gets no conversation yet", (await convOf("family_id", F3)).length === 0);
const [ch1] = await convOf("church_id", CH1), [ch2] = await convOf("church_id", CH2);
ok("backfill: church conversations, active members only", ch1?.conversation_type === "church" && ch1.name === "Grace Church" && JSON.stringify(await members(ch1.id)) === JSON.stringify([ADA]) && JSON.stringify(await members(ch2.id)) === JSON.stringify([DEE]));
ok("existing conversations untouched", (await q(`select count(*)::int n from p2p_conversations where id = '${id(900)}' and conversation_type = 'direct'`))[0].n === 1);

// ── Membership follows status ─────────────────────────────────────────────
await db.exec(`update p2p_family_members set status = 'active' where family_id = '${F1}' and user_id = '${CY}'`);
ok("accepting an invitation (invited → active) adds them", (await members(c1.id)).includes(CY));
await db.exec(`update p2p_family_members set status = 'left' where family_id = '${F1}' and user_id = '${BEN}'`);
ok("leaving (active → left) removes them", !(await members(c1.id)).includes(BEN));
await db.exec(`update p2p_family_members set status = 'active' where family_id = '${F1}' and user_id = '${BEN}'`);
ok("re-joining adds them back", (await members(c1.id)).includes(BEN));
await db.exec(`delete from p2p_family_members where family_id = '${F1}' and user_id = '${CY}'`);
ok("removing a member row removes access", !(await members(c1.id)).includes(CY));
await db.exec(`insert into p2p_family_members (family_id, user_id, status) values ('${F1}', '${DEE}', 'invited')`);
ok("a new INVITED member gets no access", !(await members(c1.id)).includes(DEE));
await db.exec(`update p2p_family_members set status = 'active' where family_id = '${F3}' and user_id = '${CY}'`);
const [c3] = await convOf("family_id", F3);
ok("first active member of a family creates its conversation", c3 && JSON.stringify(await members(c3.id)) === JSON.stringify([CY]));
await db.exec(`update p2p_family_members set role = 'co_shepherd' where family_id = '${F1}' and user_id = '${BEN}'`);
ok("a role change doesn't touch conversation membership", (await members(c1.id)).includes(BEN));

await db.exec(`update p2p_church_members set is_active = true where church_id = '${CH1}' and user_id = '${EVE}'`);
ok("church: re-activated member added", (await members(ch1.id)).includes(EVE));
await db.exec(`update p2p_church_members set is_active = false where church_id = '${CH1}' and user_id = '${EVE}'`);
ok("church: deactivated member removed", !(await members(ch1.id)).includes(EVE));
await db.exec(`insert into p2p_church_members (church_id, user_id, role) values ('${CH2}', '${ADA}', 'member')`);
ok("a member of TWO churches is in both conversations (multi-church)", (await members(ch1.id)).includes(ADA) && (await members(ch2.id)).includes(ADA));

// ── One conversation per group, renames, cascades ─────────────────────────
await db.exec(`insert into p2p_family_members (family_id, user_id) values ('${F2}', '${EVE}')`);
ok("still exactly one conversation per family", (await q(`select count(*)::int n from p2p_conversations where family_id = '${F2}'`))[0].n === 1 && (await members(c2.id)).includes(EVE));
let dup = null; try { await db.exec(`insert into p2p_conversations (type, family_id, conversation_type) values ('group', '${F1}', 'family')`); } catch (e) { dup = e.message; }
ok("a second conversation for the same family is refused (unique index)", !!dup);
await db.exec(`update p2p_families set name = 'The Ade Family' where id = '${F1}'`);
await db.exec(`update p2p_churches set name = 'Grace Chapel' where id = '${CH1}'`);
ok("renames follow", (await convOf("family_id", F1))[0].name === "The Ade Family" && (await convOf("church_id", CH1))[0].name === "Grace Chapel");
await db.exec(`delete from p2p_families where id = '${F3}'`);
ok("deleting a family deletes its conversation and memberships", (await convOf("family_id", F3)).length === 0 && (await q(`select count(*)::int n from p2p_conversation_members where conversation_id = '${c3.id}'`))[0].n === 0);

// ── Constraint ───────────────────────────────────────────────────────────
let bad = null; try { await db.exec(`insert into p2p_conversations (type, conversation_type) values ('group', 'everyone')`); } catch (e) { bad = e.message; }
ok("conversation_type still rejects unknown values; all old values still allowed", !!bad && (await (async () => { try { for (const t of ["direct", "crisis_response", "help_request", "pastoral", "support", "peer_group", "circle"]) await db.exec(`insert into p2p_conversations (type, conversation_type) values ('direct', '${t}')`); return true; } catch { return false; } })()));

// ── Access (RLS on conversations) ─────────────────────────────────────────
const as = async (uid, sql, params = []) => {
  await db.exec(`set test.uid = '${uid}'; set role authenticated;`);
  try { return { rows: (await db.query(sql, params)).rows, error: null }; } catch (e) { return { rows: [], error: e.message }; } finally { await db.exec("reset role;"); }
};
const seen = await as(EVE, `select id from p2p_conversations where family_id is not null or church_id is not null`);
ok("a user sees only the group conversations they belong to", !seen.error && seen.rows.length === 1 && seen.rows[0].id === c2.id, JSON.stringify(seen));
const guess = await as(DEE, `select id from p2p_conversations where id = $1`, [c1.id]);
ok("guessing another family's conversation id returns nothing", !guess.error && guess.rows.length === 0);
const rpc = await as(ADA, `select public.p2p_sync_family_conversation()`);
ok("trigger functions can't be called directly by signed-in users", !!rpc.error);

// ── Re-runnable ──────────────────────────────────────────────────────────
const before = await q(`select (select count(*)::int from p2p_conversations) c, (select count(*)::int from p2p_conversation_members) m`);
await db.exec(sql197);
const after = await q(`select (select count(*)::int from p2p_conversations) c, (select count(*)::int from p2p_conversation_members) m`);
ok("second run changes nothing", JSON.stringify(before) === JSON.stringify(after));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
