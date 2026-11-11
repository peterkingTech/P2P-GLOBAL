// 244 P2P Mail + 245 private groups and Communities — on a DISPOSABLE local copy only.
//   GROWTH_TEST_DATABASE_URL=… GROWTH_TEST_DISPOSABLE=yes PG_MODULE=… node migrations/tests/244_245_communication.db.test.mjs
// Acts as real signed-in users (role authenticated + JWT claims), so the database's own rules are tested:
//   • P2P Mail and Community tables: a phone can't read or write them at all (API-only);
//   • mail letters immutable, audit append-only, official scope required for official threads;
//   • a private group: non-members can't see it exists, read or post; members can; removing a member
//     ends their access at once; "admins only" posting and closed groups enforced for every writer;
//   • community membership grants NO group access; existing conversations and members unchanged.
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
const url = process.env.GROWTH_TEST_DATABASE_URL ?? "";
if (process.env.GROWTH_TEST_DISPOSABLE !== "yes" || !/@(127\.0\.0\.1|localhost)[:/]/.test(url)) { console.error("Refusing: disposable local database only."); process.exit(2); }
const pg = require(process.env.PG_MODULE || "pg");
const c = new pg.Client({ connectionString: url, ssl: false });
await c.connect();
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); } };
const q = async (s, p = []) => (await c.query(s, p)).rows;
const one = async (s, p = []) => (await q(s, p))[0];
const seed = async (fn) => { await c.query("set session_replication_role = replica"); try { await fn(); } finally { await c.query("set session_replication_role = origin"); } };

/** Run SQL as a signed-in user (or the anonymous role); always rolled back. Returns { rows, error }. */
async function as(user, sql, params = []) {
  await c.query("begin");
  try {
    if (user) await c.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)", [JSON.stringify({ sub: user, role: "authenticated" }), user]);
    await c.query(`set local role ${user ? "authenticated" : "anon"}`);
    const r = await c.query(sql, params);
    return { rows: r.rows, error: null };
  } catch (e) { return { rows: [], error: e.message }; }
  finally { await c.query("rollback"); }
}
async function person() {
  const id = randomUUID();
  await seed(async () => {
    await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `c-${id}@example.invalid`]);
    await c.query(`insert into p2p_profiles (id, email, full_name, username, role) values ($1, $2, 'Comm test', $3, 'student'::user_role)`, [id, `c-${id}@example.invalid`, `c_${id.slice(0, 12)}`]);
  });
  return id;
}

// ── Existing data untouched ────────────────────────────────────────────────
const before = await one("select (select count(*)::int from p2p_conversations) convs, (select count(*)::int from p2p_conversation_members) members, (select count(*)::int from p2p_messages) msgs");
ok("existing conversations, members and messages all still there", before.convs > 0 && before.members > 0);
ok("existing members default to the 'member' role (none left without one)", (await one("select count(*)::int n from p2p_conversation_members where role is null or role not in ('admin','member')")).n === 0);
ok("existing conversations: everyone may post, none archived, none in a community", (await one("select count(*)::int n from p2p_conversations where posting <> 'everyone' or archived_at is not null or community_id is not null")).n === 0);

// ── API-only tables ────────────────────────────────────────────────────────
const A = await person(), B = await person(), C = await person();
for (const t of ["p2p_mail_threads", "p2p_mail_messages", "p2p_mail_participants", "p2p_mail_drafts", "p2p_mail_events", "p2p_communities", "p2p_community_members", "p2p_group_invitations", "p2p_group_invite_links", "p2p_group_join_requests", "p2p_group_events"]) {
  const r = await as(A, `select * from ${t} limit 1`);
  const w = await as(A, `delete from ${t}`);
  const anon = await as(null, `select * from ${t} limit 1`);
  ok(`${t}: a phone can neither read nor write it (API-only)`, /permission denied/.test(r.error ?? "") && /permission denied/.test(w.error ?? "") && /permission denied/.test(anon.error ?? ""));
}

// ── P2P Mail rules ─────────────────────────────────────────────────────────
const thread = await one("insert into p2p_mail_threads (subject, created_by) values ('Hello', $1) returning id", [A]);
const letter = await one("insert into p2p_mail_messages (thread_id, sender_id, body) values ($1, $2, 'First letter') returning id", [thread.id, A]);
await c.query("insert into p2p_mail_participants (thread_id, user_id, role) values ($1, $2, 'sender'), ($1, $3, 'recipient')", [thread.id, A, B]);
let e = null; try { await c.query("update p2p_mail_messages set body = 'changed' where id = $1", [letter.id]); } catch (x) { e = x.message; }
ok("a sent letter can't be changed", /cannot be changed/.test(e ?? ""));
e = null; try { await c.query("delete from p2p_mail_messages where id = $1", [letter.id]); } catch (x) { e = x.message; }
ok("a sent letter can't be deleted", /cannot be changed/.test(e ?? ""));
await c.query("insert into p2p_mail_events (thread_id, message_id, actor_id, event) values ($1, $2, $3, 'sent')", [thread.id, letter.id, A]);
e = null; try { await c.query("update p2p_mail_events set event = 'read'"); } catch (x) { e = x.message; }
ok("the mail audit is append-only", /cannot be changed/.test(e ?? ""));
e = null; try { await c.query("insert into p2p_mail_threads (subject, created_by, is_official) values ('Official', $1, true)", [A]); } catch (x) { e = x.message; }
ok("an official thread must name whose behalf it is sent on", /p2p_mail_official_scope/.test(e ?? ""));
e = null; try { await c.query("insert into p2p_mail_threads (subject, created_by, is_official, official_scope) values ('Church', $1, true, 'church')", [A]); } catch (x) { e = x.message; }
ok("a Church or Family official thread must name that Church or Family", /p2p_mail_official_scope/.test(e ?? ""));
ok("an official P2P Global thread is accepted", !!(await one("insert into p2p_mail_threads (subject, created_by, is_official, official_scope) values ('Notice', $1, true, 'p2p') returning id", [A])));
ok("mail is nowhere in chat: no message rows were written", (await one("select count(*)::int n from p2p_messages")).n === before.msgs);

// ── Private group ──────────────────────────────────────────────────────────
const g = await one("insert into p2p_conversations (type, name, conversation_type, created_by, description) values ('group', 'Youth Fellowship', 'private_group', $1, 'Private') returning id", [A]);
await c.query("insert into p2p_conversation_members (conversation_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'member')", [g.id, A, B]);
const sees = async (u) => { const r = await as(u, "select id, name from p2p_conversations where id = $1", [g.id]); if (r.error) throw new Error(r.error); return r.rows.length === 1; };
const post = (u) => as(u, "insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'hello') returning id", [g.id, u]);
ok("a non-member can't see the group exists (name, description)", !(await sees(C)));
const cMembers = await as(C, "select user_id from p2p_conversation_members where conversation_id = $1", [g.id]);
ok("a non-member can't see its members", !cMembers.error && cMembers.rows.length === 0, cMembers.error ?? "");
ok("a non-member can't post into it", !!(await post(C)).error);
ok("members see the group; members can post", (await sees(B)) && !(await post(B)).error && !(await post(A)).error);
await c.query("insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'group history')", [g.id, A]);
// (Specific columns: phones may not read every column of p2p_messages; an error must not pass as "no rows".)
const readMsgs = (u) => as(u, "select id, body from p2p_messages where conversation_id = $1", [g.id]);
const cRead = await readMsgs(C), bRead = await readMsgs(B);
ok("a non-member can't read its messages", !cRead.error && cRead.rows.length === 0, cRead.error ?? "");
ok("a member reads its messages", !bRead.error && bRead.rows.length >= 1, bRead.error ?? "");
e = null; try { await c.query("insert into p2p_conversation_members (conversation_id, user_id, role) values ($1, $2, 'owner')", [g.id, C]); } catch (x) { e = x.message; }
ok("group roles are only admin or member", /p2p_conversation_members_role_check/.test(e ?? ""));

// Admins-only posting (e.g. Announcements) — for every writer
await c.query("update p2p_conversations set posting = 'admins' where id = $1", [g.id]);
ok("'admins only': a member can't post", /Only group administrators/.test((await post(B)).error ?? ""));
ok("'admins only': an admin can", !(await post(A)).error);
await c.query("update p2p_conversations set posting = 'everyone' where id = $1", [g.id]);

// Removal ends access immediately
await c.query("delete from p2p_conversation_members where conversation_id = $1 and user_id = $2", [g.id, B]);
const bAfter = await readMsgs(B);
ok("a removed member can no longer see the group, read it or post", !(await sees(B)) && !bAfter.error && bAfter.rows.length === 0 && !!(await post(B)).error, bAfter.error ?? "");

// Closed group
await c.query("update p2p_conversations set archived_at = now() where id = $1", [g.id]);
ok("a closed group takes no new messages, even from its admin", /closed/.test((await post(A)).error ?? ""));
await c.query("update p2p_conversations set archived_at = null where id = $1", [g.id]);

// ── Communities ────────────────────────────────────────────────────────────
const com = await one("insert into p2p_communities (name, created_by) values ('Grace Church Community', $1) returning id", [A]);
await c.query("insert into p2p_community_members (community_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')", [com.id, A, C]);
const leaders = await one("insert into p2p_conversations (type, name, conversation_type, created_by, community_id) values ('group', 'Leaders', 'private_group', $1, $2) returning id", [A, com.id]);
await c.query("insert into p2p_conversation_members (conversation_id, user_id, role) values ($1, $2, 'admin')", [leaders.id, A]);
ok("community membership does NOT grant access to its groups", (await as(C, "select id from p2p_conversations where id = $1", [leaders.id])).rows.length === 0
  && !!(await as(C, "insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'x')", [leaders.id, C])).error);
e = null; try { await c.query("insert into p2p_community_members (community_id, user_id, role) values ($1, $2, 'superuser')", [com.id, B]); } catch (x) { e = x.message; }
ok("community roles are only owner, admin or member", /check/.test(e ?? ""));

// ── Existing conversation kinds are unaffected by the posting rule ─────────
const fam = await one("select m.conversation_id, m.user_id from p2p_conversation_members m join p2p_conversations v on v.id = m.conversation_id where v.conversation_type in ('family','church','direct') limit 1");
if (fam) ok("an existing Family/Church/direct conversation: its members still post as before", !(await as(fam.user_id, "insert into p2p_messages (conversation_id, sender_id, body) values ($1, $2, 'still works') returning id", [fam.conversation_id, fam.user_id])).error);

// Group events append-only
await c.query("insert into p2p_group_events (target_type, target_id, actor_id, event) values ('group', $1, $2, 'created')", [g.id, A]);
e = null; try { await c.query("delete from p2p_group_events"); } catch (x) { e = x.message; }
ok("group audit is append-only", /append-only/.test(e ?? ""));

console.log(`244/245 communication (database): ${pass} passed, ${fail} failed`);
await c.end();
process.exit(fail ? 1 : 0);
