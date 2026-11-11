// P2P Mail (routes/mail.ts) and private groups & Communities (routes/groups.ts) over HTTP against an
// in-memory database. The database's own rules (RLS, posting trigger, immutability) are tested on real
// Postgres in migrations/tests/244_245_communication.db.test.mjs; this checks the API's authorisation:
//   • mail: only participants read a thread (same 404 as "no such mail"); drafts only their author;
//     official mail only within the sender's real scope and only to its members; replies stay in the
//     thread; forwarding keeps the original; nothing written to chat; blocks respected; notifications
//     open the thread and carry the subject only;
//   • groups: non-members get 404 for everything; only admins manage; the last admin can't leave;
//     a community's members aren't in its groups; community groups only take community members;
//     invitations accept/decline; invite links expire, run out, are revoked, can need approval,
//     never bypass a block, and only their hash is stored.
// Run: node tests/communication.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = path.join(root, "tests", `.tmp-comm-${process.pid}`);
mkdirSync(tmp, { recursive: true });

// ── In-memory database ─────────────────────────────────────────────────────
const T = {};
const autoId = { p2p_mail_events: true, p2p_group_events: true };
// The migrations' column defaults (the real database applies them).
const DEFAULTS = {
  p2p_group_invitations: { status: "pending" }, p2p_group_invite_links: { uses: 0, requires_approval: false, revoked_at: null },
  p2p_group_join_requests: { status: "pending" }, p2p_conversations: { posting: "everyone", is_announcements: false, archived_at: null, community_id: null },
  p2p_conversation_members: { role: "member" }, p2p_community_members: { role: "member" }, p2p_communities: { archived_at: null },
  p2p_mail_messages: { kind: "original", is_official: false, attachments: [] }, p2p_mail_threads: { is_official: false },
  p2p_mail_participants: { last_read_at: null, archived_at: null, removed_at: null },
};
function makeDb() {
  return {
    from(table) {
      const q = { op: "select", f: [], payload: null, single: false, maybe: false, lim: null, orders: [], head: false, ret: false };
      const rows = () => (T[table] ??= []);
      const test = (r, [op, k, v]) => {
        if (op === "eq") return r[k] === v;
        if (op === "neq") return r[k] !== v;
        if (op === "in") return v.includes(r[k]);
        if (op === "is") return (r[k] ?? null) === v;
        if (op === "gte") return r[k] >= v;
        if (op === "contains") return Object.entries(v).every(([kk, vv]) => r[k]?.[kk] === vv);
        if (op === "or") return v.some((cond) => test(r, cond));
        if (op === "fn") return v(r);
        return true;
      };
      const match = (r) => q.f.every((c) => test(r, c));
      const exec = () => {
        let data;
        if (q.op === "insert") {
          const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({ ...(autoId[table] ? {} : { id: randomUUID() }), created_at: new Date().toISOString(), sent_at: new Date().toISOString(), ...(DEFAULTS[table] ?? {}), ...p }));
          rows().push(...list); data = list;
        } else if (q.op === "update") { const hit = rows().filter(match); hit.forEach((r) => Object.assign(r, q.payload)); data = hit; }
        else if (q.op === "delete") { const keep = rows().filter((r) => !match(r)); data = rows().filter(match); T[table] = keep; }
        else { data = rows().filter(match); for (const [k, asc] of [...q.orders].reverse()) data = [...data].sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1)); if (q.lim) data = data.slice(0, q.lim); }
        data = data.map((r) => ({ ...r }));
        if (q.head) return { data: null, count: data.length, error: null };
        if (q.single && data.length !== 1) return { data: null, error: { message: "not single" } };
        return { data: q.single || q.maybe ? data[0] ?? null : data, error: null };
      };
      // PostgREST "or" filter: "a.eq.X,b.ilike.%y%"
      const parseOr = (s) => s.split(",").map((part) => {
        const [k, op, ...rest] = part.split("."); const v = rest.join(".");
        if (op === "ilike") { const needle = v.replace(/%/g, "").toLowerCase(); return ["ilikeFn", k, needle]; }
        return [op, k, v];
      });
      const c = {
        select(_s, o) { if (o?.head) q.head = true; if (q.op !== "select") q.ret = true; return c; },
        insert(p) { q.op = "insert"; q.payload = p; return c; }, update(p) { q.op = "update"; q.payload = p; return c; }, delete() { q.op = "delete"; return c; },
        eq(k, v) { q.f.push(["eq", k, v]); return c; }, neq(k, v) { q.f.push(["neq", k, v]); return c; }, in(k, v) { q.f.push(["in", k, v]); return c; },
        is(k, v) { q.f.push(["is", k, v]); return c; }, gte(k, v) { q.f.push(["gte", k, v]); return c; }, contains(k, v) { q.f.push(["contains", k, v]); return c; },
        or(s) { const conds = parseOr(s).map(([op, k, v]) => (op === "ilikeFn" ? ["fn", k, (r) => String(r[k] ?? "").toLowerCase().includes(v)] : [op, k, v])); q.f.push(["or", null, conds]); return c; },
        order(k, o) { q.orders.push([k, o?.ascending !== false]); return c; }, limit(n) { q.lim = n; return c; },
        maybeSingle() { q.maybe = true; return c; }, single() { q.single = true; return c; },
        then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
      };
      return c;
    },
  };
}
// "fn" filters inside or()
globalThis.__comm = { db: makeDb() };

const pushed = [];
const mocks = {
  supabase: "export const supabaseServiceRole = globalThis.__comm.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  pushDispatch: "export const dispatchNotificationNow = async (id) => { (globalThis.__pushed ??= []).push(id); };",
};
const plugin = { name: "m", setup(b) {
  b.onResolve({ filter: /(^|\/)(supabase|pushDispatch)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "m" }));
  b.onLoad({ filter: /.*/, namespace: "m" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };

// People and organisations
const [P, Q, R, S, ADMIN, PASTOR, MEMBER, OUTSIDER, SHEP, KID] = Array.from({ length: 10 }, () => randomUUID());
const names = { [P]: "Peter", [Q]: "Queen", [R]: "Ruth", [S]: "Silas", [ADMIN]: "Ada Admin", [PASTOR]: "Pastor Paul", [MEMBER]: "Mary Member", [OUTSIDER]: "Otto Outside", [SHEP]: "Shepherd Sam", [KID]: "Kim" };
T.p2p_profiles = Object.entries(names).map(([id, full_name]) => ({ id, full_name, username: full_name.toLowerCase().replace(/ /g, "_"), photo_url: null, role: id === ADMIN ? "super_admin" : "student" }));
const CH = randomUUID(), OTHER_CH = randomUUID(), FAM = randomUUID();
T.p2p_churches = [{ id: CH, name: "Grace Church", logo_url: null }, { id: OTHER_CH, name: "Other Church", logo_url: null }];
T.p2p_church_members = [{ church_id: CH, user_id: PASTOR, role: "senior_pastor", is_active: true }, { church_id: CH, user_id: MEMBER, role: "member", is_active: true },
  { church_id: OTHER_CH, user_id: OUTSIDER, role: "member", is_active: true }];
T.p2p_families = [{ id: FAM, name: "The Okafors", shepherd_id: SHEP }];
T.p2p_family_members = [{ family_id: FAM, user_id: SHEP, role: "shepherd", status: "active" }, { family_id: FAM, user_id: KID, role: "adult", status: "active" }];
T.p2p_user_blocks = [{ blocker_id: S, blocked_id: P }];
T.p2p_messages = [];
T.p2p_notifications = [];

let server, base;
const call = async (method, p, user, body) => {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, body: json, text: JSON.stringify(json) };
};

try {
  // The fake's or() with "fn" conditions:
  const bundle = async (entry, name) => {
    const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [plugin], external: ["express"] });
    const f = path.join(tmp, name); writeFileSync(f, out.outputFiles[0].text.replace(/if \(op === "or"\)/g, "$&")); return import(pathToFileURL(f).href);
  };
  const express = createRequire(path.join(root, "package.json"))("express");
  const { default: mail } = await bundle("src/routes/mail.ts", "mail.mjs");
  const { default: groups } = await bundle("src/routes/groups.ts", "groups.mjs");
  const app = express(); app.use(express.json()); app.use("/mail", mail); app.use("/groups", groups);
  server = app.listen(0); await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;

  // ════ P2P MAIL ════
  ok("mail: signed out → 401", (await call("GET", "/mail")).status === 401);
  const sent = await call("POST", "/mail", P, { to: [Q], subject: "Our study plan", body: "Dear Queen,\n\nShall we start Romans?" });
  ok("mail: peer mail sent", sent.status === 200 && sent.body.recipients === 1, sent.text);
  const tid = sent.body.threadId;
  ok("mail: nothing written to chat", T.p2p_messages.length === 0);
  const inboxQ = await call("GET", "/mail?folder=inbox", Q);
  ok("mail: the recipient's inbox has it, unread, with the sender", inboxQ.body.threads.length === 1 && inboxQ.body.threads[0].unread === 1 && inboxQ.body.threads[0].from.name === "Peter");
  ok("mail: the sender's Sent has it; their inbox doesn't (until a reply)", (await call("GET", "/mail?folder=sent", P)).body.threads.length === 1 && (await call("GET", "/mail?folder=inbox", P)).body.threads.length === 0);
  ok("mail: unread count", (await call("GET", "/mail/unread", Q)).body.unreadThreads === 1);
  const note = T.p2p_notifications.find((n) => n.user_id === Q);
  ok("mail: a P2P Mail notification that opens the thread — subject only, never the letter", note?.notification_type === "p2p_mail" && note.data.threadId === tid && note.message === "Our study plan" && !JSON.stringify(note).includes("Romans"));
  ok("mail: a stranger can't open the thread (same answer as no such mail)", (await call("GET", `/mail/${tid}`, R)).status === 404 && (await call("GET", `/mail/${randomUUID()}`, R)).status === 404);
  ok("mail: a stranger can't reply, forward, archive or mark it read", (await call("POST", `/mail/${tid}/reply`, R, { body: "hi" })).status === 404
    && (await call("POST", `/mail/${tid}/archive`, R, {})).status === 404 && (await call("POST", `/mail/${tid}/read`, R)).status === 404);
  const view = await call("GET", `/mail/${tid}`, Q);
  ok("mail: the recipient reads the thread: subject, letters, sender, date", view.body.subject === "Our study plan" && view.body.letters.length === 1 && view.body.letters[0].from.name === "Peter" && !!view.body.letters[0].sentAt);
  await call("POST", `/mail/${tid}/read`, Q);
  ok("mail: marked read", (await call("GET", "/mail/unread", Q)).body.unreadThreads === 0);
  const rep = await call("POST", `/mail/${tid}/reply`, Q, { body: "Yes — Monday?" });
  const after = await call("GET", `/mail/${tid}`, P);
  ok("mail: a reply stays in the same thread, marked as a reply to the letter before", rep.status === 200 && after.body.letters.length === 2 && after.body.letters[1].kind === "reply" && after.body.letters[1].replyToId === after.body.letters[0].id);
  ok("mail: no new thread was created for the reply", T.p2p_mail_threads.length === 1);
  await call("POST", `/mail/${tid}/archive`, P, { archived: true });
  ok("mail: archiving moves it to Archived (for that person only)", (await call("GET", "/mail?folder=archived", P)).body.threads.length === 1 && (await call("GET", "/mail?folder=sent", P)).body.threads.length === 0
    && (await call("GET", "/mail?folder=inbox", Q)).body.threads.length === 1 && (await call("GET", "/mail?folder=sent", Q)).body.threads.length === 1);
  const fwd = await call("POST", `/mail/${tid}/forward`, Q, { messageId: after.body.letters[0].id, to: [R], note: "FYI" });
  const fview = await call("GET", `/mail/${fwd.body.threadId}`, R);
  ok("mail: forwarding makes a new thread keeping the original sender, date, subject and text", fwd.status === 200 && fview.body.subject === "Fwd: Our study plan" && fview.body.letters[0].kind === "forward"
    && fview.body.letters[0].body.includes("From: Peter") && fview.body.letters[0].body.includes("Shall we start Romans?") && fview.body.letters[0].forwardedFromId === after.body.letters[0].id);
  ok("mail: forwarding doesn't let the new recipient into the original thread", (await call("GET", `/mail/${tid}`, R)).status === 404);
  ok("mail: search finds subject and body, only in the caller's own mail", (await call("GET", "/mail?folder=sent&q=romans", P)).body.threads.length === 0
    && (await call("GET", "/mail?folder=archived&q=romans", P)).body.threads.length === 1 && (await call("GET", "/mail?folder=inbox&q=romans", OUTSIDER)).body.threads.length === 0);
  ok("mail: with=<person> shows only correspondence with that person", (await call("GET", `/mail?folder=sent&with=${P}`, Q)).body.threads.length === 1 && (await call("GET", `/mail?folder=sent&with=${R}`, Q)).body.threads.length === 1);
  ok("mail: someone who blocked you can't be written to", (await call("POST", "/mail", P, { to: [S], subject: "x", body: "y" })).status === 403);
  ok("mail: recipient search hides people with a block either way", !(await call("GET", "/mail/recipients?q=silas", P)).body.people.some((p) => p.id === S) && (await call("GET", "/mail/recipients?q=ruth", P)).body.people.some((p) => p.id === R));
  ok("mail: subject and body required", (await call("POST", "/mail", P, { to: [Q], subject: "", body: "y" })).status === 400 && (await call("POST", "/mail", P, { to: [Q], subject: "x", body: " " })).status === 400);
  ok("mail: a non-participant can't be a recipient", (await call("POST", "/mail", P, { to: [randomUUID()], subject: "x", body: "y" })).status === 400);

  // Drafts
  const d = await call("POST", "/mail/drafts", P, { to: [Q], subject: "Draft", body: "half" });
  ok("drafts: saved and listed for their author", d.status === 200 && (await call("GET", "/mail/drafts", P)).body.drafts.some((x) => x.id === d.body.id && x.to[0].name === "Queen"));
  ok("drafts: nobody else sees or changes them", !(await call("GET", "/mail/drafts", Q)).body.drafts.length && (await call("POST", "/mail/drafts", Q, { id: d.body.id, subject: "hijack" })).status === 404);
  await call("POST", "/mail", P, { to: [Q], subject: "Draft", body: "finished", draftId: d.body.id });
  ok("drafts: sending a draft removes it", !(await call("GET", "/mail/drafts", P)).body.drafts.some((x) => x.id === d.body.id));

  // Official mail
  ok("official: an ordinary participant has no official scopes", (await call("GET", "/mail/official-scopes", P)).body.scopes.length === 0);
  ok("official: an ordinary participant can't send official mail", (await call("POST", "/mail", P, { to: [Q], subject: "Notice", body: "x", official: { scope: "p2p" } })).status === 403);
  const adm = await call("GET", "/mail/official-scopes", ADMIN);
  ok("official: P2P Global administration", adm.body.scopes.some((s) => s.scope === "p2p" && s.label === "P2P Global Administration"));
  const o = await call("POST", "/mail", ADMIN, { to: [Q], subject: "Account notice", body: "Official.", official: { scope: "p2p" } });
  const on = T.p2p_notifications.filter((n) => n.notification_type === "official_mail").at(-1);
  ok("official: sent as P2P Global, marked official, its own notification", o.status === 200 && (await call("GET", `/mail/${o.body.threadId}`, Q)).body.officialLabel === "P2P Global Administration" && on?.title.includes("P2P Global Administration"));
  const ps = await call("GET", "/mail/official-scopes", PASTOR);
  ok("official: a church leader may write for THEIR church only", ps.body.scopes.length === 1 && ps.body.scopes[0].scope === "church" && ps.body.scopes[0].scopeId === CH && ps.body.scopes[0].memberCount === 1);
  ok("official: church mail only to its own members", (await call("POST", "/mail", PASTOR, { to: [OUTSIDER], subject: "x", body: "y", official: { scope: "church", scopeId: CH } })).status === 403
    && (await call("POST", "/mail", PASTOR, { to: [MEMBER], subject: "Sunday", body: "y", official: { scope: "church", scopeId: CH } })).status === 200);
  ok("official: a leader can't write on behalf of another church", (await call("POST", "/mail", PASTOR, { to: [OUTSIDER], subject: "x", body: "y", official: { scope: "church", scopeId: OTHER_CH } })).status === 403);
  ok("official: a church member (not a leader) can't send for it", (await call("POST", "/mail", MEMBER, { to: [PASTOR], subject: "x", body: "y", official: { scope: "church", scopeId: CH } })).status === 403);
  const all = await call("POST", "/mail", SHEP, { subject: "Family worship", body: "Tonight at 7", official: { scope: "family", scopeId: FAM, toAll: true } });
  ok("official: a family shepherd writes to the whole family (and only it)", all.status === 200 && all.body.recipients === 1 && (await call("GET", `/mail/${all.body.threadId}`, KID)).status === 200);
  ok("official: a reply from someone without authority isn't official", (await (async () => { await call("POST", `/mail/${all.body.threadId}/reply`, KID, { body: "Amen" }); return T.p2p_mail_messages.at(-1).is_official === false; })()));
  ok("audit: every send, reply, read, archive and forward recorded", ["sent", "replied", "read", "archived", "forwarded", "official_sent"].every((e) => T.p2p_mail_events.some((x) => x.event === e)));

  // ════ GROUPS ════
  const g = await call("POST", "/groups", P, { name: "Youth Fellowship", description: "Private", memberIds: [Q] });
  ok("groups: created private; creator is admin; members added and notified", g.status === 200 && T.p2p_conversations.find((c) => c.id === g.body.id)?.conversation_type === "private_group"
    && T.p2p_conversation_members.some((m) => m.conversation_id === g.body.id && m.user_id === P && m.role === "admin") && T.p2p_notifications.some((n) => n.user_id === Q && n.notification_type === "group_added"));
  const gid = g.body.id;
  ok("groups: a non-member gets 404 for its details (nothing revealed)", (await call("GET", `/groups/${gid}`, R)).status === 404);
  ok("groups: a non-member's list doesn't include it", !(await call("GET", "/groups", R)).body.groups.some((x) => x.id === gid));
  ok("groups: a member sees it and its members", (await call("GET", `/groups/${gid}`, Q)).body.members.length === 2);
  ok("groups: an ordinary member can't manage", (await call("PATCH", `/groups/${gid}`, Q, { name: "Mine" })).status === 403 && (await call("POST", `/groups/${gid}/members`, Q, { userIds: [R] })).status === 403
    && (await call("DELETE", `/groups/${gid}/members/${P}`, Q)).status === 403 && (await call("POST", `/groups/${gid}/admins`, Q, { userId: Q, admin: true })).status === 403);
  ok("groups: an admin can rename and restrict posting", (await call("PATCH", `/groups/${gid}`, P, { name: "Youth", posting: "admins" })).status === 200 && T.p2p_conversations.find((c) => c.id === gid).posting === "admins");
  ok("groups: the last admin can't leave (or be demoted)", (await call("DELETE", `/groups/${gid}/members/${P}`, P)).status === 409 && (await call("POST", `/groups/${gid}/admins`, P, { userId: P, admin: false })).status === 409);
  ok("groups: someone blocked can't be added by the blocker's counterpart", (await call("POST", "/groups", S, { name: "S group", memberIds: [P] })).status === 200 && !T.p2p_conversation_members.some((m) => m.user_id === P && T.p2p_conversations.find((c) => c.id === m.conversation_id)?.name === "S group"));
  // Invitations
  const invPost = await call("POST", `/groups/${gid}/invitations`, P, { userIds: [R] });
  const invR = await call("GET", "/groups/invitations", R);
  ok("invitations: the invitee sees name and description only", invR.body.invitations.length === 1 && invR.body.invitations[0].name === "Youth" && !("members" in invR.body.invitations[0]));
  ok("invitations: someone else can't answer it", (await call("POST", `/groups/invitations/${invR.body.invitations[0].id}`, OUTSIDER, { accept: true })).status === 404);
  await call("POST", `/groups/invitations/${invR.body.invitations[0].id}`, R, { accept: true });
  ok("invitations: accepting makes them a member", (await call("GET", `/groups/${gid}`, R)).status === 200);
  // Removal ends access
  await call("DELETE", `/groups/${gid}/members/${R}`, P);
  ok("groups: a removed member gets 404 at once", (await call("GET", `/groups/${gid}`, R)).status === 404);
  // Links
  const link = await call("POST", `/groups/${gid}/links`, P, { maxUses: 1 });
  ok("links: token returned once; only its hash stored", !!link.body.token && T.p2p_group_invite_links.every((l) => l.token_hash !== link.body.token) && T.p2p_group_invite_links.some((l) => l.token_hash === createHash("sha256").update(link.body.token).digest("hex")));
  ok("links: a member who isn't admin can't create or list links", (await call("POST", `/groups/${gid}/links`, Q, {})).status === 403 && (await call("GET", `/groups/${gid}/links`, Q)).status === 403);
  const j1 = await call("POST", "/groups/join", R, { token: link.body.token });
  ok("links: joining with a valid link", j1.body?.status === "joined");
  ok("links: used up after its limit", (await call("POST", "/groups/join", OUTSIDER, { token: link.body.token })).status === 410);
  const l2 = await call("POST", `/groups/${gid}/links`, P, { requiresApproval: true });
  ok("links: approval links make a request, not a member", (await call("POST", "/groups/join", OUTSIDER, { token: l2.body.token })).body.status === "requested" && (await call("GET", `/groups/${gid}`, OUTSIDER)).status === 404);
  const reqs = await call("GET", `/groups/${gid}/requests`, P);
  await call("POST", `/groups/${gid}/requests/${reqs.body.requests[0].id}`, P, { approve: true });
  ok("links: an approved request joins", (await call("GET", `/groups/${gid}`, OUTSIDER)).status === 200);
  await call("DELETE", `/groups/${gid}/links/${l2.body.id}`, P);
  ok("links: a revoked link doesn't work", (await call("POST", "/groups/join", MEMBER, { token: l2.body.token })).status === 410);
  const l3 = await call("POST", `/groups/${gid}/links`, P, {});
  T.p2p_group_invite_links.find((l) => l.id === l3.body.id).expires_at = new Date(Date.now() - 1000).toISOString();
  ok("links: an expired link doesn't work", (await call("POST", "/groups/join", MEMBER, { token: l3.body.token })).status === 410);
  const l4 = await call("POST", `/groups/${gid}/links`, P, {});
  T.p2p_user_blocks.push({ blocker_id: P, blocked_id: KID });
  ok("links: a link never gets round a block", (await call("POST", "/groups/join", KID, { token: l4.body.token })).status === 410);
  ok("links: nonsense token", (await call("POST", "/groups/join", MEMBER, { token: "nope" })).status === 410);
  // Closed group
  await call("PATCH", `/groups/${gid}`, P, { archived: true });
  ok("groups: a closed group takes no new members or invitations", (await call("POST", `/groups/${gid}/members`, P, { userIds: [MEMBER] })).status === 410 && (await call("POST", `/groups/${gid}/invitations`, P, { userIds: [MEMBER] })).status === 410);

  // ════ COMMUNITIES ════
  const com = await call("POST", "/groups/communities", PASTOR, { name: "Grace Church Community", memberIds: [MEMBER, Q], announcements: true });
  const cid = com.body.id;
  const ann = T.p2p_conversations.find((c) => c.community_id === cid && c.is_announcements);
  ok("community: created with owner, members and an admins-only Announcements every member reads", com.status === 200 && !!ann && ann.posting === "admins"
    && [PASTOR, MEMBER, Q].every((u) => T.p2p_conversation_members.some((m) => m.conversation_id === ann.id && m.user_id === u)));
  const lead = await call("POST", "/groups", PASTOR, { name: "Leaders", communityId: cid, memberIds: [] });
  ok("community: a group inside it; community members are NOT in it", lead.status === 200 && (await call("GET", `/groups/${lead.body.id}`, MEMBER)).status === 404);
  const cv = await call("GET", `/groups/communities/${cid}`, MEMBER);
  ok("community: a member sees the groups they're in, not the others", cv.body.groups.some((x) => x.isAnnouncements) && !cv.body.groups.some((x) => x.name === "Leaders"));
  ok("community: an admin sees every group", (await call("GET", `/groups/communities/${cid}`, PASTOR)).body.groups.some((x) => x.name === "Leaders"));
  ok("community: non-members get 404", (await call("GET", `/groups/communities/${cid}`, OUTSIDER)).status === 404 && !(await call("GET", "/groups", OUTSIDER)).body.communities.some((x) => x.id === cid));
  ok("community: a member can't create groups in it or add people", (await call("POST", "/groups", MEMBER, { name: "x", communityId: cid })).status === 403 && (await call("POST", `/groups/communities/${cid}/members`, MEMBER, { userIds: [R] })).status === 403);
  ok("community: its groups only take its members", (await call("POST", `/groups/${lead.body.id}/members`, PASTOR, { userIds: [OUTSIDER] })).status === 403
    && (await call("POST", `/groups/${lead.body.id}/members`, PASTOR, { userIds: [MEMBER] })).status === 200);
  ok("community: a group link only works for community members", (await (async () => { const l = await call("POST", `/groups/${lead.body.id}/links`, PASTOR, {}); return (await call("POST", "/groups/join", OUTSIDER, { token: l.body.token })).status === 403; })()));
  await call("DELETE", `/groups/communities/${cid}/members/${MEMBER}`, PASTOR);
  ok("community: removing a member also removes them from its groups", !T.p2p_conversation_members.some((m) => m.user_id === MEMBER && [ann.id, lead.body.id].includes(m.conversation_id)));
  ok("community: the owner can't be removed by an admin, and can't leave as the only owner", (await call("DELETE", `/groups/communities/${cid}/members/${PASTOR}`, PASTOR)).status === 409);
  ok("community: 'me' leaves as the caller (and their groups with it)", (await call("DELETE", `/groups/communities/${cid}/members/me`, Q)).body.removed === true
    && !T.p2p_community_members.some((m) => m.community_id === cid && m.user_id === Q) && !T.p2p_conversation_members.some((m) => m.user_id === Q && m.conversation_id === ann.id)
    && (await call("DELETE", `/groups/communities/${cid}/members/me`, PASTOR)).status === 409);
  // Family and Church presented as communities
  const mine = await call("GET", "/groups", KID);
  ok("Family/Church: shown as communities from their own records (no copies made)", mine.body.communities.some((x) => x.kind === "family" && x.name === "The Okafors") && !T.p2p_communities.some((x) => x.name === "The Okafors"));
  ok("Family/Church: a shepherd is its administrator; a church leader likewise", (await call("GET", "/groups", SHEP)).body.communities.find((x) => x.kind === "family").myRole === "admin"
    && (await call("GET", "/groups", PASTOR)).body.communities.find((x) => x.kind === "church").myRole === "admin");
  ok("audit: group and community actions recorded", ["created", "member_added", "member_removed", "link_created", "link_revoked", "updated"].every((e) => T.p2p_group_events.some((x) => x.event === e)));
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  server?.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`communication (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
