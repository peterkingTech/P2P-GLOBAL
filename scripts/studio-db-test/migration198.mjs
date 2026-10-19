// Migration 198 (child/teen safeguards) on PGlite. Starts from the LIVE
// pre-198 p2p_can_contact_directly and p2p_discover_peers (fixtures/, read
// from production 2026-10-18) on minimal copies of the tables they use, then
// applies 198 and checks every rule in both directions, plus that adults are
// unaffected. PostGIS isn't available in PGlite: two stub functions let the
// worldwide discovery mode run (nearby mode is exercised on the production
// restore test). Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration198.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const sql198 = readFileSync(path.join(repo, "migrations/198_minor_safeguards.sql"), "utf8");
const pre = (n) => readFileSync(path.join(here, "fixtures", `pre198_${n}.sql`), "utf8").replace(/\r\n/g, "\n").trimEnd() + ";";
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`;
const U = { parent: id(1), child: id(2), teen: id(3), sibling: id(4), outsider: id(5), leader: id(6), member: id(7), responder: id(8), admin: id(9), adult2: id(10), multi: id(11) };
const F = "33333333-3333-4333-8333-000000000001", F2 = "33333333-3333-4333-8333-000000000002", CH = "44444444-4444-4444-8444-000000000001";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  create schema extensions; create domain extensions.geography as text;
  create function extensions.st_dwithin(text, text, double precision) returns boolean language sql immutable as 'select false';
  create function extensions.st_distance(text, text) returns double precision language sql immutable as 'select 0::double precision';
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', username text, full_name text, photo_url text, country text, city text,
    calling text, gifts text[], skills text[], show_country_on_profile boolean default true, profile_visibility text default 'public', is_official_account boolean default false, location_point extensions.geography);
  create function public.p2p_is_admin_or_official(uuid) returns boolean language sql stable as 'select false';
  create table public.p2p_user_blocks (blocker_id uuid, blocked_id uuid);
  create table public.p2p_help_requests (id uuid primary key default gen_random_uuid(), user_id uuid);
  create table public.p2p_groups (id uuid primary key default gen_random_uuid(), name text, peer_guide_id uuid);
  create table public.p2p_group_members (id uuid primary key default gen_random_uuid(), group_id uuid references public.p2p_groups(id), user_id uuid, joined_at timestamptz default now());
  create table public.p2p_discipleship_links (mentor_id uuid, disciple_id uuid, active boolean);
  create table public.p2p_connection_requests (from_user_id uuid, to_user_id uuid, status text, request_type text);
  create table public.p2p_families (id uuid primary key, name text, shepherd_id uuid);
  create table public.p2p_family_members (id uuid primary key default gen_random_uuid(), family_id uuid, user_id uuid, role text, status text default 'active');
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean default true);
  create table public.p2p_peer_circles (id uuid primary key default gen_random_uuid(), name text, leader_id uuid);
  create table public.p2p_peer_circle_members (id uuid primary key default gen_random_uuid(), circle_id uuid, user_id uuid, role text, status text default 'active', joined_at timestamptz default now(), unique (circle_id, user_id));
  create table public.p2p_break_rooms (id uuid primary key default gen_random_uuid(), name text, host_id uuid, is_live boolean default true);
  create table public.p2p_break_room_participants (id uuid primary key default gen_random_uuid(), room_id uuid, user_id uuid, joined_at timestamptz default now(), left_at timestamptz);
  create table public.p2p_call_logs (id uuid primary key default gen_random_uuid(), participants jsonb);
  create table public.p2p_call_invitations (id uuid primary key default gen_random_uuid(), call_id uuid, inviter_id uuid, invitee_id uuid, status text default 'pending');
  create table public.p2p_prayer_coord_invitations (id uuid primary key default gen_random_uuid(), requester_id uuid, recipient_id uuid, status text default 'pending');
  create table public.p2p_conversations (id uuid primary key default gen_random_uuid(), type text, conversation_type text);
  create table public.p2p_conversation_members (conversation_id uuid, user_id uuid, primary key (conversation_id, user_id));
  create table public.p2p_messages (id uuid primary key default gen_random_uuid(), conversation_id uuid, sender_id uuid, body text);
  grant all on all tables in schema public to service_role;
`);
await db.exec(pre("p2p_can_contact_directly"));
await db.exec(pre("p2p_discover_peers"));
await db.exec(`grant execute on function public.p2p_can_contact_directly(uuid,uuid) to anon, authenticated; grant execute on function public.p2p_discover_peers(text,integer,text,text[],integer) to authenticated;`);

const q = async (sql, p = []) => (await db.query(sql, p)).rows;
await q(`insert into p2p_profiles (id, role, username, full_name) select v.id::uuid, v.role, v.u, v.u from (values
  ('${U.parent}','student','parent'),('${U.child}','student','child'),('${U.teen}','student','teen'),('${U.sibling}','student','sibling'),('${U.outsider}','student','outsider'),
  ('${U.leader}','student','leader'),('${U.member}','student','member'),('${U.responder}','peer_guide','responder'),('${U.admin}','super_admin','admin'),('${U.adult2}','student','adult2'),('${U.multi}','student','multi')) v(id, role, u)`);
await q(`insert into p2p_families values ('${F}', 'The Ades', '${U.parent}'), ('${F2}', 'Other', '${U.multi}')`);
await q(`insert into p2p_family_members (family_id, user_id, role) values ('${F}','${U.parent}','shepherd'),('${F}','${U.child}','child'),('${F}','${U.teen}','teen'),('${F}','${U.sibling}','adult'),
  ('${F2}','${U.multi}','teen'),('${F}','${U.multi}','child')`);
await q(`insert into p2p_churches values ('${CH}', 'Grace')`);
await q(`insert into p2p_church_members (church_id, user_id, role) values ('${CH}','${U.teen}','member'),('${CH}','${U.leader}','small_group_leader'),('${CH}','${U.member}','member'),('${CH}','${U.child}','member')`);
// Pre-existing relationships that would normally allow contact: an accepted connection, a shared peer group, a discipleship link.
await q(`insert into p2p_connection_requests values ('${U.outsider}','${U.child}','accepted','connect'), ('${U.outsider}','${U.adult2}','accepted','connect'), ('${U.outsider}','${U.teen}','accepted','connect')`);
await q(`insert into p2p_discipleship_links values ('${U.member}','${U.teen}', true)`);
await q(`insert into p2p_help_requests (user_id) values ('${U.child}')`);
// An existing direct conversation between the outsider and the child, from before 198.
const [oldDm] = await q(`insert into p2p_conversations (type, conversation_type) values ('direct','direct') returning id`);
await q(`insert into p2p_conversation_members values ($1,'${U.outsider}'),($1,'${U.child}')`, [oldDm.id]);

await db.exec(sql198);
await db.exec(sql198); // re-runnable

const role = async (u) => (await q(`select p2p_family_minor_role($1) r`, [u]))[0].r;
const contact = async (a, b) => (await q(`select p2p_can_contact_directly($1, $2) v`, [a, b]))[0].v;
const fails = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };

// ── 1. Who counts ─────────────────────────────────────────────────────
ok("child / teen / adult detected from active family roles", (await role(U.child)) === "child" && (await role(U.teen)) === "teen" && (await role(U.parent)) === null && (await role(U.outsider)) === null);
ok("child in one family + teen in another counts as child", (await role(U.multi)) === "child");
await q(`update p2p_family_members set status = 'left' where user_id = '${U.multi}' and family_id = '${F}'`);
ok("a left membership no longer counts", (await role(U.multi)) === "teen");

// ── 2. Direct contact (DMs + calls use this gate) ─────────────────────
ok("child ↔ own family: allowed", await contact(U.child, U.parent) && await contact(U.parent, U.child) && await contact(U.child, U.sibling) && await contact(U.child, U.teen));
ok("child ↔ outsider: refused even with an accepted connection (both directions)", !(await contact(U.outsider, U.child)) && !(await contact(U.child, U.outsider)));
ok("child ↔ their church's leader: refused (only family for children)", !(await contact(U.leader, U.child)));
ok("teen ↔ their church's leader: allowed", await contact(U.leader, U.teen) && await contact(U.teen, U.leader));
ok("teen ↔ ordinary church member: refused (even with a discipleship link)", !(await contact(U.member, U.teen)));
ok("teen ↔ outsider: refused even with an accepted connection", !(await contact(U.outsider, U.teen)));
ok("responder to the child's own help request: still allowed", await contact(U.responder, U.child));
ok("super admin ↔ child: refused (minor rules apply to everyone)", !(await contact(U.admin, U.child)));
ok("adults unaffected: connection still allows contact; strangers still refused", await contact(U.outsider, U.adult2) && !(await contact(U.adult2, U.member)));
await q(`insert into p2p_user_blocks values ('${U.child}','${U.parent}')`);
ok("blocks still win, even within a family", !(await contact(U.parent, U.child)));
await q(`delete from p2p_user_blocks`);

// Messages in an EXISTING direct conversation.
ok("message to a child in a pre-198 DM from an outsider: refused", /P2P_MINOR_SAFEGUARD/.test(await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [oldDm.id, U.outsider]) ?? ""));
ok("…and the child can't reply there either", /P2P_MINOR_SAFEGUARD/.test(await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [oldDm.id, U.child]) ?? ""));
const [famDm] = await q(`insert into p2p_conversations (type, conversation_type) values ('direct','direct') returning id`);
await q(`insert into p2p_conversation_members values ($1,'${U.parent}'),($1,'${U.child}')`, [famDm.id]);
ok("parent ↔ child DM: messages flow", (await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'dinner')`, [famDm.id, U.child])) === null);
const [famGroup] = await q(`insert into p2p_conversations (type, conversation_type) values ('group','family') returning id`);
await q(`insert into p2p_conversation_members values ($1,'${U.parent}'),($1,'${U.child}')`, [famGroup.id]);
ok("family group chat: child can post", (await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hello all')`, [famGroup.id, U.child])) === null);
const [adultDm] = await q(`insert into p2p_conversations (type, conversation_type) values ('direct','direct') returning id`);
await q(`insert into p2p_conversation_members values ($1,'${U.outsider}'),($1,'${U.adult2}')`, [adultDm.id]);
ok("adult ↔ adult DM unaffected", (await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hey')`, [adultDm.id, U.outsider])) === null);
ok("system messages (no sender) unaffected", (await fails(`insert into p2p_messages (conversation_id, sender_id, body) values ($1, null, 'system')`, [oldDm.id])) === null);

// ── 3. Groups and rooms ─────────────────────────────────────────────────
const [oc] = await q(`insert into p2p_peer_circles (name, leader_id) values ('Outsider circle', '${U.outsider}') returning id`);
const [lc] = await q(`insert into p2p_peer_circles (name, leader_id) values ('Leader circle', '${U.leader}') returning id`);
const [pc] = await q(`insert into p2p_peer_circles (name, leader_id) values ('Parent circle', '${U.parent}') returning id`);
ok("circle led by an outsider: child refused, teen refused", /children can only join/.test(await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [oc.id, U.child]) ?? "")
  && /not available for teen accounts/.test(await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [oc.id, U.teen]) ?? ""));
ok("circle led by the teen's church leader: teen allowed, child refused", (await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [lc.id, U.teen])) === null
  && !!(await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [lc.id, U.child])));
ok("child refused even in a circle led by their parent (circles aren't family-only)", !!(await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [pc.id, U.child])));
await q(`insert into p2p_peer_circle_members (circle_id, user_id, status) values ($1, $2, 'pending')`, [oc.id, U.teen]);
ok("a pending (inactive) row is allowed; activating it is refused", /P2P_MINOR_SAFEGUARD/.test(await fails(`update p2p_peer_circle_members set status = 'active' where circle_id = $1 and user_id = $2`, [oc.id, U.teen]) ?? ""));
ok("a child can't create (lead) a circle", /P2P_MINOR_SAFEGUARD/.test(await fails(`insert into p2p_peer_circles (name, leader_id) values ('Kids', $1)`, [U.child]) ?? ""));
ok("a teen can lead their own circle; adults join adults' circles freely", (await fails(`insert into p2p_peer_circles (name, leader_id) values ('Teen circle', $1)`, [U.teen])) === null
  && (await fails(`insert into p2p_peer_circle_members (circle_id, user_id) values ($1, $2)`, [oc.id, U.adult2])) === null);

const [og] = await q(`insert into p2p_groups (name, peer_guide_id) values ('Outsider group', '${U.outsider}') returning id`);
ok("peer group by an outsider: child and teen refused; adult fine", !!(await fails(`insert into p2p_group_members (group_id, user_id) values ($1, $2)`, [og.id, U.child]))
  && !!(await fails(`insert into p2p_group_members (group_id, user_id) values ($1, $2)`, [og.id, U.teen])) && (await fails(`insert into p2p_group_members (group_id, user_id) values ($1, $2)`, [og.id, U.adult2])) === null);
ok("a child can't create a peer group", !!(await fails(`insert into p2p_groups (name, peer_guide_id) values ('x', $1)`, [U.child])));

const [or] = await q(`insert into p2p_break_rooms (name, host_id) values ('Outsider room', '${U.outsider}') returning id`);
const [lr] = await q(`insert into p2p_break_rooms (name, host_id) values ('Leader room', '${U.leader}') returning id`);
ok("break room by an outsider: child and teen refused", !!(await fails(`insert into p2p_break_room_participants (room_id, user_id) values ($1, $2)`, [or.id, U.child]))
  && !!(await fails(`insert into p2p_break_room_participants (room_id, user_id) values ($1, $2)`, [or.id, U.teen])));
ok("break room hosted by the teen's church leader: teen allowed", (await fails(`insert into p2p_break_room_participants (room_id, user_id) values ($1, $2)`, [lr.id, U.teen])) === null);
ok("a child can't host a break room", !!(await fails(`insert into p2p_break_rooms (name, host_id) values ('x', $1)`, [U.child])));

// Calls: invitee must be allowed with the inviter AND everyone in the call — both directions.
const [callWithOutsider] = await q(`insert into p2p_call_logs (participants) values ($1::jsonb) returning id`, [JSON.stringify([U.parent, U.outsider])]);
const [familyCall] = await q(`insert into p2p_call_logs (participants) values ($1::jsonb) returning id`, [JSON.stringify([U.parent, U.sibling])]);
const [callWithChild] = await q(`insert into p2p_call_logs (participants) values ($1::jsonb) returning id`, [JSON.stringify([U.parent, U.child])]);
ok("parent can't add the child to a call an outsider is in", !!(await fails(`insert into p2p_call_invitations (call_id, inviter_id, invitee_id) values ($1, $2, $3)`, [callWithOutsider.id, U.parent, U.child])));
ok("parent can add the child to a family-only call", (await fails(`insert into p2p_call_invitations (call_id, inviter_id, invitee_id) values ($1, $2, $3)`, [familyCall.id, U.parent, U.child])) === null);
ok("nobody can add an outsider to a call a child is in", !!(await fails(`insert into p2p_call_invitations (call_id, inviter_id, invitee_id) values ($1, $2, $3)`, [callWithChild.id, U.parent, U.outsider])));
ok("adult calls unaffected", (await fails(`insert into p2p_call_invitations (call_id, inviter_id, invitee_id) values ($1, $2, $3)`, [callWithOutsider.id, U.outsider, U.adult2])) === null);

ok("prayer invitation: outsider → teen refused; teen's church leader → teen allowed", !!(await fails(`insert into p2p_prayer_coord_invitations (requester_id, recipient_id) values ($1, $2)`, [U.outsider, U.teen]))
  && (await fails(`insert into p2p_prayer_coord_invitations (requester_id, recipient_id) values ($1, $2)`, [U.leader, U.teen])) === null);

// ── 5. Discovery ────────────────────────────────────────────────────────
await db.exec(`set test.uid = '${U.outsider}'; set role authenticated;`);
let found = null, discErr = null;
try { found = (await db.query(`select id from p2p_discover_peers('worldwide', 50, null, null, 50)`)).rows.map((r) => r.id); } catch (e) { discErr = e.message; }
await db.exec("reset role;");
ok("discovery (as a signed-in user): children never listed; teens and adults still are", found && !found.includes(U.child) && found.includes(U.teen) && found.includes(U.parent), discErr ?? JSON.stringify(found));

// ── Privacy of the helpers ──────────────────────────────────────────────
const asUser = async (sql) => { await db.exec(`set test.uid = '${U.outsider}'; set role authenticated;`); try { await db.query(sql); return null; } catch (e) { return e.message; } finally { await db.exec("reset role;"); } };
ok("app users can't ask who is a child/teen (helpers not callable)", !!(await asUser(`select p2p_family_minor_role('${U.child}')`)) && !!(await asUser(`select p2p_minor_contact_allowed('${U.child}', '${U.parent}')`)));
ok("existing grants kept on the two replaced functions", (await asUser(`select p2p_can_contact_directly('${U.outsider}', '${U.adult2}')`)) === null);
ok("safeguard trigger functions not callable directly", !!(await asUser(`select p2p_minor_group_check('${U.child}', '${U.outsider}', 'x')`)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
