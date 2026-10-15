// Stage 5 integration: the new app code (QR links, notification tap handling,
// notification identity, family member model) driven against the REAL API
// routes (circles, family, notifications) on the REAL migrations (044 peer
// circles, 115/116/126 families) in PGlite, through the lab bundle. Each
// scenario crosses a boundary the unit tests stub out:
//   1. Circle QR → scan → Circle preview → Request to Join → leader review,
//      proving a scan never makes anyone a member.
//   2. Profile QR ↔ Group Members: a member row and that member's QR open the
//      same screen.
//   3. Notification Center identity from the real /notifications/me payload.
//   4. Push tap → real mark-read: once per notification, exact unread count,
//      second device, before sign-in, someone else's notification.
// Synthetic users only; never contacts a real backend.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/stage5-integration.mjs
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp } from "./lab.mjs";

process.env.TZ = "UTC";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mobileRoot = path.join(repo, "artifacts/mobile");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-0000-0000-0000000005${String(n).padStart(2, "0")}`;
const U = { leader: id(1), member: id(2), scanner: id(3), other: id(4) };
const C1 = "22222222-2222-4222-8222-000000000001", F1 = "33333333-3333-4333-8333-000000000001";

// ── Database: real migrations ──────────────────────────────────────────────
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text,
    email text, date_of_birth date, country text, is_verified boolean default false);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    notification_type text, data jsonb, read boolean default false, created_at timestamp without time zone default now(), pushed_at timestamptz);
  alter table public.p2p_notifications enable row level security;
`);
const loaded = [];
for (const f of ["044_peer_circles.sql", "115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql"]) {
  try { await db.exec(mig(f)); loaded.push(f); } catch (e) { console.log(`note: ${f} failed to load: ${e.message.split("\n")[0]}`); }
}
ok("real migrations 044 + 115 + 116 + 126 load", loaded.length === 4, loaded.join(", "));

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name, photo_url, username, email, date_of_birth, country) values
  ($1, 'Lydia Leader', 'https://cdn.example/lydia.jpg', 'lydia', 'lydia@example.invalid', '1980-01-01', 'NG'),
  ($2, 'Mark Member', null, 'mark.m', 'mark@example.invalid', '1990-01-01', 'GB'),
  ($3, 'Sola Scanner', 'https://cdn.example/sola.jpg', 'sola', 'sola@example.invalid', '1995-01-01', 'GH'),
  ($4, 'Olu Other', null, 'olu', 'olu@example.invalid', '1970-01-01', 'KE')`, [U.leader, U.member, U.scanner, U.other]);
await db.query(`insert into p2p_peer_circles (id, name, description, circle_type, leader_id, max_members, status) values ($1, 'Romans Circle', 'Reading Romans together', 'open', $2, 8, 'forming')`, [C1, U.leader]);
await db.query(`insert into p2p_peer_circle_members (circle_id, user_id, role, status) values ($1, $2, 'leader', 'active'), ($1, $3, 'member', 'active')`, [C1, U.leader, U.member]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1, 'The Adeyemis', $2)`, [F1, U.leader]);
await db.query(`insert into p2p_family_members (family_id, user_id, role, status) values ($1, $2, 'shepherd', 'active'), ($1, $3, 'adult', 'active'), ($1, $4, 'teen', 'active')`, [F1, U.leader, U.member, U.scanner]);

// ── API: real routes through the lab ───────────────────────────────────────
const tmp = mkdtempSync(path.join(os.tmpdir(), "stage5-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
};

// ── App code: the real mobile modules, bundled for Node ────────────────────
const { build } = createRequire(path.join(repo, "artifacts/api-server/package.json"))("esbuild");
const entry = path.join(tmp, "mobile-entry.ts");
writeFileSync(entry, ["qrLinks", "notificationModel", "notificationTap", "familyMembersModel"]
  .map((m) => `export * from ${JSON.stringify(path.join(mobileRoot, "lib", m + ".ts").replace(/\\/g, "/"))};`).join("\n"));
const out = await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  plugins: [{ name: "rn-stub", setup(b) {
    b.onResolve({ filter: /^react-native$/ }, () => ({ path: "rn", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "export const Share = { share: async () => ({}) };" }));
  } }] });
writeFileSync(path.join(tmp, "mobile.mjs"), out.outputFiles[0].text);
const M = await import(pathToFileURL(path.join(tmp, "mobile.mjs")).href);

try {
  // ── 1. Circle QR → scan → preview → request → leader review ──────────────
  const spec = M.circleQr({ id: C1, name: "Romans Circle" });
  const scan = M.parseP2PCode(spec.url);
  ok("1a member's Circle QR scans to the Circle screen", scan.ok && scan.path === `/circles/${C1}`, JSON.stringify(scan));
  const circleId = scan.path.split("/").pop();
  const preview = await call("GET", `/circles/${circleId}`, U.scanner);
  ok("1b Circle preview loads from the real route", preview.status === 200 && preview.body.name === "Romans Circle" && preview.body.members.length === 2, JSON.stringify(preview).slice(0, 200));
  ok("1c preview members carry no private fields", preview.body.members.every((m) => !("email" in m) && !("dateOfBirth" in m) && !("date_of_birth" in m)));
  const isMember = (who) => preview.body.members.some((m) => m.userId === who);
  ok("1d app gating: member sees the QR button, scanner sees Request to Join", isMember(U.member) && !isMember(U.scanner));

  const joinRes = await call("POST", `/circles/${circleId}/join`, U.scanner, { userId: U.scanner });   // exactly the app's (signed) request
  ok("1e Request to Join creates a pending request", joinRes.ok && joinRes.body.status === "pending", JSON.stringify(joinRes));
  const after = await call("GET", `/circles/${circleId}`, U.scanner);
  ok("1f scanning + requesting does NOT make them a member", after.body.members.length === 2 && !after.body.members.some((m) => m.userId === U.scanner));
  const memberRows = (await db.query(`select count(*)::int n from p2p_peer_circle_members where circle_id = $1 and user_id = $2`, [C1, U.scanner])).rows[0].n;
  ok("1g no membership row exists for the scanner", memberRows === 0);
  await call("POST", `/circles/${circleId}/join`, U.scanner, { userId: U.scanner });               // scanned again
  const reqRows = (await db.query(`select status from p2p_peer_circle_join_requests where circle_id = $1 and user_id = $2`, [C1, U.scanner])).rows;
  ok("1h scanning again doesn't duplicate the request", reqRows.length === 1 && reqRows[0].status === "pending");
  const review = await call("GET", `/circles/${circleId}/join-requests`, U.leader);
  ok("1i leader sees the request for approval", review.status === 200 && review.body.some((r) => r.userId === U.scanner && r.userName === "Sola Scanner"));

  const stale = M.circleQr({ id: "22222222-2222-4222-8222-0000000000ff", name: "Gone" });
  const staleScan = M.parseP2PCode(stale.url);
  const staleRes = await call("GET", staleScan.path.replace(/^\/circles/, "/circles"), U.scanner);
  ok("1j old QR for a deleted Circle → 404 (app shows 'not available')", staleScan.ok && staleRes.status === 404 && !staleRes.ok);
  const malformed = await call("GET", "/circles/not-a-uuid", U.scanner);
  ok("1k malformed id never reaches the API (scanner refuses it)", M.parseP2PCode("p2pglobalbiblestudy://circles/not-a-uuid").ok === false);
  console.log(`    info: API answer for a malformed Circle id sent directly: HTTP ${malformed.status}`);

  // ── 1-auth. Join requests: identity comes from the sign-in, not the body ──
  const reqCount = async (who) => (await db.query(`select count(*)::int n from p2p_peer_circle_join_requests where circle_id = $1 and user_id = $2`, [C1, who])).rows[0].n;
  const spoof = await call("POST", `/circles/${C1}/join`, U.scanner, { userId: U.other });
  ok("A1 signed request in someone else's name → 403, nothing filed", spoof.status === 403 && (await reqCount(U.other)) === 0, JSON.stringify(spoof));
  const badTok = await call("POST", `/circles/${C1}/join`, "not-a-real-session", { userId: U.other });
  ok("A2 invalid sign-in → 401, nothing filed", badTok.status === 401 && (await reqCount(U.other)) === 0);
  const noCircle = await call("POST", `/circles/22222222-2222-4222-8222-0000000000ee/join`, U.other, { userId: U.other });
  ok("A3 request for a Circle that doesn't exist → 404 (not a 500)", noCircle.status === 404, JSON.stringify(noCircle));
  const asMember = await call("GET", `/circles/${C1}/join-requests`, U.member);
  ok("A4 non-leader can't list requesters", asMember.status === 403);
  const asScanner = await call("GET", `/circles/${C1}/join-requests`, U.scanner);
  ok("A5 the requester can't list requesters either", asScanner.status === 403);
  const otherReq = (await call("POST", `/circles/${C1}/join`, U.other, { userId: U.other })).body;
  const reqRow = (await db.query(`select id from p2p_peer_circle_join_requests where circle_id = $1 and user_id = $2`, [C1, U.other])).rows[0];
  ok("A6 a real signed request from Olu is filed", otherReq?.status === "pending" && !!reqRow);
  const fakeApprove = await call("PUT", `/circles/${C1}/join-requests/${reqRow.id}`, U.member, { action: "approve", respondedBy: U.leader });
  ok("A7 member pretending to be the leader can't approve", fakeApprove.status === 403 && (await db.query(`select status from p2p_peer_circle_join_requests where id = $1`, [reqRow.id])).rows[0].status === "pending");
  const selfApprove = await call("PUT", `/circles/${C1}/join-requests/${reqRow.id}`, U.other, { action: "approve", respondedBy: U.other });
  ok("A8 requester can't approve themselves", selfApprove.status === 403);
  const realApprove = await call("PUT", `/circles/${C1}/join-requests/${reqRow.id}`, U.leader, { action: "approve", respondedBy: U.leader });
  const olu = (await db.query(`select status from p2p_peer_circle_members where circle_id = $1 and user_id = $2`, [C1, U.other])).rows[0];
  ok("A9 the real leader approves → Olu becomes a member", realApprove.ok && olu?.status === "active", JSON.stringify(realApprove));
  const responder = (await db.query(`select responded_by from p2p_peer_circle_join_requests where id = $1`, [reqRow.id])).rows[0].responded_by;
  ok("A10 responded_by records the signed-in leader", responder === U.leader);

  // Older app builds send no token: unchanged until CIRCLES_REQUIRE_AUTH is switched on.
  const legacyList = await call("GET", `/circles/${C1}/join-requests`, null);
  ok("A11 old app (no token): leader's list still loads", legacyList.status === 200);
  process.env.CIRCLES_REQUIRE_AUTH = "true";
  const strictJoin = await call("POST", `/circles/${C1}/join`, null, { userId: U.other });
  const strictList = await call("GET", `/circles/${C1}/join-requests`, null);
  const strictPut = await call("PUT", `/circles/${C1}/join-requests/${reqRow.id}`, null, { action: "decline", respondedBy: U.leader });
  ok("A12 with CIRCLES_REQUIRE_AUTH=true, unsigned join/list/answer are refused", strictJoin.status === 401 && strictList.status === 401 && strictPut.status === 401);
  const strictSigned = await call("GET", `/circles/${C1}/join-requests`, U.leader);
  ok("A13 with the switch on, the signed-in leader still works", strictSigned.status === 200);
  delete process.env.CIRCLES_REQUIRE_AUTH;
  const appSrc = (f) => readFileSync(path.join(mobileRoot, f), "utf8");
  ok("A14 app sends the sign-in on join, list and answer", /authedFetch\(`\/circles\/\$\{circleId\}\/join`/.test(appSrc("app/circles/[id].tsx"))
    && /authedFetch\(`\/circles\/\$\{circleId\}\/join-requests`\)/.test(appSrc("app/circles/[id].tsx"))
    && /authedFetch\(`\/circles\/\$\{circleId\}\/join-requests\/\$\{requestId\}`/.test(appSrc("app/circles/[id].tsx"))
    && /authedFetch\(`\/circles\/\$\{circleId\}\/join`/.test(appSrc("app/circles/discover.tsx")));
  ok("A15 Find a Circle no longer says 'Request sent' when it failed", /if \(!res\.ok\) throw new Error/.test(appSrc("app/circles/discover.tsx")));

  // ── 2. Profile QR ↔ Group Members ────────────────────────────────────────
  const fam = await call("GET", `/family/${F1}`, U.member);
  ok("2a family member list loads for a member", fam.status === 200 && Array.isArray(fam.body.members) && fam.body.members.length === 3, JSON.stringify(fam).slice(0, 200));
  const sorted = M.sortMembers(fam.body.members);
  ok("2b shepherd listed first", M.roleLabel(sorted[0].role) && sorted[0].userId === U.leader);
  for (const m of sorted) {
    const fromList = M.memberProfilePath(m);
    const fromQr = M.parseP2PCode(M.profileQr(m.username).url);
    ok(`2c ${m.username}: member row and their QR open the same profile`, fromList && fromQr.ok && fromList === fromQr.path, `${fromList} vs ${JSON.stringify(fromQr)}`);
  }
  const outsider = await call("GET", `/family/${F1}`, U.other);
  ok("2d non-member can't list the family", outsider.status === 403);

  // ── 3. Notification Center identity from the real payload ────────────────
  const ins = async (user, type, title, message, data, minutesAgo) => (await db.query(
    `insert into p2p_notifications (user_id, title, message, notification_type, data, created_at) values ($1, $2, $3, $4, $5, now() - ($6 || ' minutes')::interval) returning id`,
    [user, title, message, type, data, String(minutesAgo)])).rows[0].id;
  const nConn = await ins(U.member, "connection_request", "New P2P Connection Request", "Sola Scanner wants to connect.", { fromUserId: U.scanner }, 1);
  const nSys = await ins(U.member, "admin_report_ready", "Your weekly report is ready", null, {}, 2);
  const nMsg = await ins(U.member, "new_message", "Lydia Leader", "sent you a message", { conversationId: "c1", senderId: U.leader }, 3);
  const nOthers = await ins(U.other, "new_message", "Lydia Leader", "sent you a message", { senderId: U.leader }, 1);
  const list = await call("GET", "/notifications/me", U.member);
  ok("3a member gets only their own notifications", list.status === 200 && list.body.length === 3 && !list.body.some((n) => n.id === nOthers));
  const byId = Object.fromEntries(list.body.map((n) => [n.id, n]));
  const idConn = M.notificationIdentity(byId[nConn]);
  ok("3b connection request shows the real sender (name + photo)", idConn.kind === "person" && idConn.name === "Sola Scanner" && idConn.photoUrl === "https://cdn.example/sola.jpg", JSON.stringify(idConn));
  ok("3c system notification shows P2P Global", M.notificationIdentity(byId[nSys]).kind === "system");
  ok("3d message notification shows the sender, no message content", M.notificationIdentity(byId[nMsg]).name === "Lydia Leader" && M.notificationText(byId[nMsg]).detail === "sent you a message");
  ok("3e actor carries public fields only", list.body.every((n) => !n.actor || Object.keys(n.actor).sort().join() === "id,name,photoUrl,username"));

  // ── 4. Push tap → real mark-read ─────────────────────────────────────────
  // Same HTTP → result mapping as DataContext.markNotificationRead (checked below).
  const markAs = (who) => async (nid) => {
    const res = await fetch(`${base}/notifications/me/${encodeURIComponent(nid)}/read`, { method: "POST", headers: { Authorization: `Bearer ${who}` } });
    if (res.status === 404) return "not_found";
    if (!res.ok) return "failed";
    const body = await res.json().catch(() => ({}));
    return body?.wasUnread === false ? "already_read" : "marked";
  };
  const dc = readFileSync(path.join(mobileRoot, "contexts/DataContext.tsx"), "utf8");
  ok("4a test mapping matches the app's markNotificationRead", /if \(res\.status === 404\) return "not_found";\s*if \(!res\.ok\) return "failed";/.test(dc) && /return body\?\.wasUnread === false \? "already_read" : "marked";/.test(dc));
  const unread = async (who) => (await call("GET", "/notifications/me/unread-count", who)).body.count;
  const before = await unread(U.member);
  const nav = [], marks = [];
  let signedIn = true;
  const handler = M.createNotificationTapHandler({
    route: () => ({ path: "/notifications", replace: false }), navigate: (p) => nav.push(p),
    markRead: async (nid) => { marks.push(nid); return markAs(U.member)(nid); }, canSync: () => signedIn, clearLaunchResponse() {},
  });
  const r1 = await handler.handle({ osIdentifier: "os-1", data: { notificationId: nMsg } });
  const r2 = await handler.handle({ osIdentifier: "os-2", data: { notificationId: nMsg } });   // same push delivered twice
  ok("4b tap marks that notification read via the real route", r1.read === "marked" && (await db.query(`select read from p2p_notifications where id = $1`, [nMsg])).rows[0].read === true);
  ok("4c duplicate tap ignored: one navigation, one mark", r2.outcome === "duplicate" && nav.length === 1 && marks.length === 1);
  ok("4d unread count drops by exactly one", (await unread(U.member)) === before - 1, `${before} → ${await unread(U.member)}`);
  ok("4e other notifications untouched", (await db.query(`select count(*)::int n from p2p_notifications where user_id = $1 and read = false`, [U.member])).rows[0].n === before - 1);
  const device2 = M.createNotificationTapHandler({ route: () => ({ path: "/notifications", replace: false }), navigate() {}, markRead: markAs(U.member), canSync: () => true, clearLaunchResponse() {} });
  const r3 = await device2.handle({ osIdentifier: "os-9", data: { notificationId: nMsg } });
  ok("4f second device: already read, count unchanged", r3.read === "already_read" && (await unread(U.member)) === before - 1);
  signedIn = false;
  const r4 = await handler.handle({ osIdentifier: "os-3", data: { notificationId: nConn } });
  ok("4g tap before sign-in is deferred, not lost", r4.read === "deferred" && handler.pendingIds().includes(nConn) && (await unread(U.member)) === before - 1);
  signedIn = true; await handler.flushPending();
  ok("4h after sign-in the deferred tap is marked", handler.pendingIds().length === 0 && (await unread(U.member)) === before - 2);
  const r5 = await handler.handle({ osIdentifier: "os-4", data: { notificationId: nOthers } });
  ok("4i someone else's notification id → not found, not marked", r5.read === "not_found" && (await db.query(`select read from p2p_notifications where id = $1`, [nOthers])).rows[0].read === false);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
