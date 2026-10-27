// Study Together shared studies (migration 216) end-to-end on PGlite with the
// REAL migrations 152 + 188 + 210 + 216 and the REAL routes
// (routes/studyTogether.ts + lib/sharedStudy.ts). Synthetic data only;
// relationship/group tables are minimal stand-ins with the real column names.
//   • Destinations: only connected peers (Peer Guide, disciple, groupmate,
//     accepted connection), never blocked people or children; only groups
//     the caller leads.
//   • Peer flow: invite → pending / accepted / declined / expired / cancelled,
//     no duplicate invitations, invitee sees no discussion before accepting.
//   • Group flow: leaders only, one active study per group + content,
//     members join by opening, ex-members lose access at once.
//   • Shared position / prompts are leader-only; responses are explicit,
//     removable, and never touch anyone's progress.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/study-together.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const catId = await setupBase(db, read("152_kingdom_stories.sql"));
await db.exec(read("188_publishing_studio_foundation.sql"));
await db.exec(read("210_kingdom_story_catalogue.sql"));
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const id = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const asOwner = async (sql, p) => { await db.exec(`set session_replication_role = replica`); try { return await q(sql, p); } finally { await db.exec(`set session_replication_role = origin`); } };

// People: H hosts; G is H's Peer Guide; D H's disciple; F an accepted
// connection; M a groupmate; B blocked H; K a child; N a stranger;
// L leads the family (shepherd) with members H and K; C leads a circle with member M.
const P = { H: id(1), G: id(2), D: id(3), F: id(4), M: id(5), B: id(6), K: id(7), N: id(8), L: id(9), C: id(10) };
await db.exec(`
  alter table public.p2p_profiles add column if not exists full_name text, add column if not exists photo_url text;
  create table public.p2p_discipleship_links (id uuid primary key default gen_random_uuid(), mentor_id uuid, disciple_id uuid, active boolean default true);
  create table public.p2p_groups (id uuid primary key, name text, peer_guide_id uuid);
  create table public.p2p_group_members (id uuid primary key default gen_random_uuid(), group_id uuid, user_id uuid);
  create table public.p2p_connection_requests (id uuid primary key default gen_random_uuid(), from_user_id uuid, to_user_id uuid, request_type text, status text);
  create table public.p2p_user_blocks (id uuid primary key default gen_random_uuid(), blocker_id uuid, blocked_id uuid, created_at timestamptz default now());
  create table public.p2p_families (id uuid primary key, name text, shepherd_id uuid);
  create table public.p2p_family_members (id uuid primary key default gen_random_uuid(), family_id uuid, user_id uuid, role text, status text);
  create table public.p2p_churches (id uuid primary key, name text);
  create table public.p2p_church_members (id uuid primary key default gen_random_uuid(), church_id uuid, user_id uuid, role text, is_active boolean);
  create table public.p2p_peer_circles (id uuid primary key, name text, leader_id uuid);
  create table public.p2p_peer_circle_members (id uuid primary key default gen_random_uuid(), circle_id uuid, user_id uuid, status text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text, notification_type text, data jsonb, pushed_at timestamptz, created_at timestamptz default now());
  create table public.p2p_lessons (id uuid primary key, title text, status text);
`);
for (const [k, v] of Object.entries(P)) await q(`insert into p2p_profiles (id, role, full_name) values ($1, 'student', $2)`, [v, `Person ${k}`]);
await db.exec(read("216_study_together_shared.sql"));

const FAM = id(20), CIR = id(21), GRP = id(22), CH = id(23);
await q(`insert into p2p_discipleship_links (mentor_id, disciple_id) values ($1, $2), ($2, $3)`, [P.G, P.H, P.D]);
await q(`insert into p2p_groups values ($1, 'Group', $2)`, [GRP, P.N]);
await q(`insert into p2p_group_members (group_id, user_id) values ($1, $2), ($1, $3)`, [GRP, P.H, P.M]);
await q(`insert into p2p_connection_requests (from_user_id, to_user_id, request_type, status) values ($1, $2, 'connect', 'accepted'), ($3, $1, 'connect', 'accepted'), ($1, $4, 'connect', 'pending')`, [P.H, P.F, P.B, P.N]);
await q(`insert into p2p_user_blocks (blocker_id, blocked_id) values ($1, $2)`, [P.B, P.H]);
await q(`insert into p2p_families values ($1, 'The Family', $2)`, [FAM, P.L]);
await q(`insert into p2p_family_members (family_id, user_id, role, status) values ($1, $2, 'shepherd', 'active'), ($1, $3, 'member', 'active'), ($1, $4, 'child', 'active')`, [FAM, P.L, P.H, P.K]);
await q(`insert into p2p_connection_requests (from_user_id, to_user_id, request_type, status) values ($1, $2, 'connect', 'accepted')`, [P.H, P.K]);
await q(`insert into p2p_peer_circles values ($1, 'The Circle', $2)`, [CIR, P.C]);
await q(`insert into p2p_peer_circle_members (circle_id, user_id, status) values ($1, $2, 'active')`, [CIR, P.M]);
await q(`insert into p2p_churches values ($1, 'The Church')`, [CH]);
await q(`insert into p2p_church_members (church_id, user_id, role, is_active) values ($1, $2, 'small_group_leader', true), ($1, $3, 'member', true)`, [CH, P.L, P.F]);

const S = { story: id(30), draft: id(31), lesson: id(32) };
await asOwner(`insert into p2p_kingdom_stories (id, title, subtitle, body, category_id, status, published_at) values
  ($1, 'Daniel', 'Faith in exile', 'b', $3, 'published', now()), ($2, 'Draft', null, 'b', $3, 'draft', null)`, [S.story, S.draft, catId]);
const CH1 = id(40), CH2 = id(41);
await asOwner(`insert into p2p_kingdom_story_chapters (id, story_id, chapter_number, title, narrative, reflections) values
  ($1, $3, 1, 'Captive', 'n', '{"What did Daniel risk?","Where do you need courage?"}'), ($2, $3, 2, 'The Dream', 'n', '{}')`, [CH1, CH2, S.story]);
await q(`insert into p2p_lessons values ($1, 'Lesson 1', 'published')`, [S.lesson]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "study-together-"));
const r = (f) => JSON.stringify(path.join(apiRoot, "src/routes", f).replace(/\\/g, "/"));
const { app } = await bundleApp({ apiRoot, tmpDir: tmp, db, extraRoutes: `
import studyTogether from ${r("studyTogether.ts")};
app.use("/api/study-together", (await import("express")).default.json(), studyTogether);
` });
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/study-together`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const notes = async (user, type) => Number((await one(`select count(*)::int n from p2p_notifications where user_id = $1 and notification_type = $2`, [user, type])).n);

try {
  ok("auth required", (await call("GET", "/destinations")).status === 401);

  // Destinations
  const dest = await call("GET", "/destinations", P.H);
  const ids = new Set((dest.body?.people ?? []).map((p) => p.id));
  ok("destinations: peer guide, disciple, groupmate, friend", [P.G, P.D, P.M, P.F].every((x) => ids.has(x)), JSON.stringify(dest.body));
  ok("destinations: no blocked, child, pending, stranger", ![P.B, P.K, P.N, P.H].some((x) => ids.has(x)));
  ok("destinations: relationship labels", dest.body.people.find((p) => p.id === P.G)?.relationship === "peer_guide" && dest.body.people.find((p) => p.id === P.F)?.relationship === "friend");
  ok("destinations: H leads no group", dest.body.groups.length === 0);
  const lead = await call("GET", "/destinations", P.L);
  ok("destinations: shepherd leads family + church", ["family", "church"].every((t) => lead.body.groups.some((g) => g.type === t)), JSON.stringify(lead.body?.groups));
  ok("destinations: child gets nobody one-to-one", (await call("GET", "/destinations", P.K)).body.people.length === 0);

  // Peer validation
  ok("peer: stranger refused", (await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "peer", userIds: [P.N] })).status === 403);
  ok("peer: blocked refused", (await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "peer", userIds: [P.B] })).status === 403);
  ok("peer: child refused", (await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "peer", userIds: [P.K] })).status === 403);
  ok("peer: draft story refused", (await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.draft, destination: "peer", userIds: [P.F] })).status === 404);
  ok("peer: bad content type", (await call("POST", "/", P.H, { contentType: "x", contentId: S.story, destination: "peer", userIds: [P.F] })).status === 400);
  ok("nothing created by refusals", Number((await one(`select count(*)::int n from p2p_shared_studies`)).n) === 0);

  // Peer flow
  const created = await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "peer", userIds: [P.F, P.G], prompt: "Read chapter 1 by Friday" });
  ok("peer: created", created.status === 201 && created.body.invited === 2, JSON.stringify(created.body));
  const SID = created.body.id;
  ok("peer: invite notifications", (await notes(P.F, "shared_study_invite")) === 1 && (await notes(P.G, "shared_study_invite")) === 1);
  ok("peer: notification links the study", (await one(`select data->>'studyId' s from p2p_notifications where user_id = $1`, [P.F])).s === SID);
  const dup = await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "peer", userIds: [P.F] });
  ok("peer: duplicate refused with the existing study", dup.status === 409 && dup.body.studyId === SID);
  const invitedView = await call("GET", `/${SID}`, P.F);
  ok("invitee: sees the invitation", invitedView.status === 200 && invitedView.body.me.invited === true && invitedView.body.title === "Daniel");
  ok("invitee: no discussion before accepting", invitedView.body.prompts.length === 0 && invitedView.body.members.length === 0 && invitedView.body.sections.length === 0);
  ok("stranger: no access", (await call("GET", `/${SID}`, P.N)).status === 404);
  ok("invitee: can't post before accepting", (await call("POST", `/${SID}/responses`, P.F, { body: "hi" })).status === 403);
  ok("mine: invitation listed", (await call("GET", "/mine", P.F)).body.invitations.some((s) => s.id === SID));

  ok("accept", (await call("POST", `/${SID}/respond`, P.F, { response: "accepted" })).body?.status === "accepted");
  ok("host told of acceptance", (await notes(P.H, "shared_study_accepted")) === 1);
  ok("accept twice refused", (await call("POST", `/${SID}/respond`, P.F, { response: "accepted" })).status === 409);
  ok("decline", (await call("POST", `/${SID}/respond`, P.G, { response: "declined" })).body?.status === "declined");
  ok("decliner loses access", (await call("GET", `/${SID}`, P.G)).status === 404);
  ok("mine: active after accepting", (await call("GET", "/mine", P.F)).body.active.some((s) => s.id === SID));

  const full = await call("GET", `/${SID}`, P.F);
  ok("study: chapters with reflection questions", full.body.sections.length === 2 && full.body.sections[0].questions.length === 2);
  ok("study: shared position starts at chapter 1", full.body.currentSectionId === CH1);
  ok("study: host's opening prompt", full.body.prompts[0]?.body === "Read chapter 1 by Friday");
  ok("study: members are host + accepted", full.body.members.map((m) => m.userId).sort().join() === [P.H, P.F].sort().join());
  ok("study: participation hidden from non-leaders", full.body.participation === null);

  // Leader-only controls
  ok("position: member can't move it", (await call("PUT", `/${SID}/position`, P.F, { sectionId: CH2 })).status === 403);
  ok("position: other story's chapter refused", (await call("PUT", `/${SID}/position`, P.H, { sectionId: id(99) })).status === 400);
  ok("position: host moves it", (await call("PUT", `/${SID}/position`, P.H, { sectionId: CH2 })).body?.currentSectionId === CH2);
  ok("prompt: member can't add", (await call("POST", `/${SID}/prompts`, P.F, { body: "Q" })).status === 403);
  const pr = await call("POST", `/${SID}/prompts`, P.H, { body: "What stood out?", sectionId: CH2 });
  ok("prompt: host adds", pr.status === 201);

  // Responses — explicit, removable, never progress
  const resp1 = await call("POST", `/${SID}/responses`, P.F, { body: "His courage.", sectionId: CH1, questionIndex: 0 });
  ok("response to a chapter question", resp1.status === 201);
  ok("response: bad question index refused", (await call("POST", `/${SID}/responses`, P.F, { body: "x", sectionId: CH1, questionIndex: 5 })).status === 400);
  ok("response to a prompt", (await call("POST", `/${SID}/responses`, P.H, { body: "Prayer.", promptId: pr.body.id })).status === 201);
  ok("response: empty refused", (await call("POST", `/${SID}/responses`, P.F, { body: "  " })).status === 400);
  const withResp = await call("GET", `/${SID}`, P.H);
  ok("responses visible to participants with names", withResp.body.responses.length === 2 && withResp.body.responses.some((x) => x.name === "Person F" && !x.mine));
  ok("host sees participation counts", withResp.body.participation?.sharedResponses === 2 && withResp.body.participation.joined === 2);
  const hostResp = withResp.body.responses.find((x) => x.userId === P.H).id;
  ok("response: others can't remove yours", (await call("DELETE", `/${SID}/responses/${hostResp}`, P.F)).status === 403);
  ok("response: author removes own", (await call("DELETE", `/${SID}/responses/${resp1.body.id}`, P.F)).body?.removed === true);

  // Invitation lifecycle
  ok("no re-invite within a week of a decline", (await call("POST", `/${SID}/invite`, P.H, { userIds: [P.G] })).status === 409);
  ok("decline cooldown also blocks a new study", (await call("POST", "/", P.H, { contentType: "lesson", contentId: S.lesson, destination: "peer", userIds: [P.G] })).status === 409
    && Number((await one(`select count(*)::int n from p2p_shared_studies where content_type = 'lesson'`)).n) === 0);
  await q(`update p2p_shared_study_members set responded_at = now() - interval '8 days' where user_id = $1 and status = 'declined'`, [P.G]);
  ok("re-invite after the cooldown", (await call("POST", `/${SID}/invite`, P.H, { userIds: [P.G] })).body?.invited === 1);
  ok("more than five refused before anything is created", (await call("POST", "/", P.H, { contentType: "lesson", contentId: S.lesson, destination: "peer", userIds: [id(91), id(92), id(93), id(94), id(95), id(96)] })).status === 400);
  ok("member can't invite", (await call("POST", `/${SID}/invite`, P.F, { userIds: [P.D] })).status === 403);
  ok("cancel invitation", (await call("POST", `/${SID}/cancel-invite`, P.H, { userId: P.G })).body?.status === "cancelled");
  ok("cancelled invitee can't accept", (await call("POST", `/${SID}/respond`, P.G, { response: "accepted" })).status === 404);
  await call("POST", `/${SID}/invite`, P.H, { userIds: [P.D] });
  await q(`update p2p_shared_study_members set expires_at = now() - interval '1 minute' where user_id = $1`, [P.D]);
  ok("expired invitation can't be accepted", (await call("POST", `/${SID}/respond`, P.D, { response: "accepted" })).status === 404);
  ok("expired recorded", (await one(`select status from p2p_shared_study_members where user_id = $1`, [P.D])).status === "expired");

  // Leave / conclude
  ok("host can't leave", (await call("POST", `/${SID}/leave`, P.H)).status === 409);
  ok("member leaves", (await call("POST", `/${SID}/leave`, P.F)).body?.status === "left");
  ok("left member loses access", (await call("GET", `/${SID}`, P.F)).status === 404);
  ok("conclude: host", (await call("POST", `/${SID}/conclude`, P.H)).body?.status === "concluded");
  ok("concluded: no new responses", (await call("POST", `/${SID}/responses`, P.H, { body: "late" })).status === 409);
  ok("reopen: host", (await call("POST", `/${SID}/reopen`, P.H)).body?.status === "active");

  // Group flow
  ok("group: non-leader refused", (await call("POST", "/", P.H, { contentType: "kingdom_story", contentId: S.story, destination: "family", groupId: FAM })).status === 403);
  const g = await call("POST", "/", P.L, { contentType: "kingdom_story", contentId: S.story, destination: "family", groupId: FAM });
  ok("group: shepherd starts", g.status === 201, JSON.stringify(g.body));
  const GID = g.body.id;
  ok("group: members notified (not the leader)", (await notes(P.H, "shared_study_started")) === 1 && (await notes(P.K, "shared_study_started")) === 1 && (await notes(P.L, "shared_study_started")) === 0);
  const again = await call("POST", "/", P.L, { contentType: "kingdom_story", contentId: S.story, destination: "family", groupId: FAM });
  ok("group: second start opens the same study", again.status === 200 && again.body.existing === true && again.body.id === GID);
  ok("group: unique index backstop", /duplicate|unique/.test(await q(`insert into p2p_shared_studies (content_type, content_id, host_id, destination_type, destination_id) values ('kingdom_story', $1, $2, 'family', $3)`, [S.story, P.L, FAM]).then(() => "", (e) => e.message)));
  ok("group: member sees it in mine", (await call("GET", "/mine", P.K)).body.active.some((s) => s.id === GID));
  ok("group: member reads it", (await call("GET", `/${GID}`, P.K)).body?.me.canParticipate === true);
  ok("group: outsider refused", (await call("GET", `/${GID}`, P.F)).status === 404);
  ok("group: member joins by opening", (await call("POST", `/${GID}/opened`, P.K)).body?.ok === true);
  ok("group: member posts", (await call("POST", `/${GID}/responses`, P.K, { body: "I liked it" })).status === 201);
  ok("group: member can't set position", (await call("PUT", `/${GID}/position`, P.K, { sectionId: CH2 })).status === 403);
  const gl = await call("GET", `/${GID}`, P.L);
  ok("group: leader participation", gl.body.participation?.joined === 2 && gl.body.participation.groupSize === 3, JSON.stringify(gl.body.participation));
  await q(`update p2p_family_members set status = 'removed' where user_id = $1`, [P.K]);
  ok("group: removed member loses access at once", (await call("GET", `/${GID}`, P.K)).status === 404);
  const circ = await call("POST", "/", P.C, { contentType: "lesson", contentId: S.lesson, destination: "circle", groupId: CIR });
  ok("circle: leader starts a lesson study", circ.status === 201);
  ok("circle: lesson has no chapters", (await call("GET", `/${circ.body.id}`, P.M)).body?.sections.length === 0);
  ok("church: leadership role starts", (await call("POST", "/", P.L, { contentType: "lesson", contentId: S.lesson, destination: "church", groupId: CH })).status === 201);
  ok("church: plain member can't", (await call("POST", "/", P.F, { contentType: "kingdom_story", contentId: S.story, destination: "church", groupId: CH })).status === 403);

  // Privacy at the database
  for (const t of ["p2p_shared_studies", "p2p_shared_study_members", "p2p_shared_study_prompts", "p2p_shared_study_responses"]) {
    ok(`rls: ${t} not readable by clients`, /permission denied/.test(await (async () => { await db.exec(`set role authenticated`); try { await q(`select * from ${t}`); return ""; } catch (e) { return e.message; } finally { await db.exec(`reset role`); } })()));
  }
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`study-together: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
