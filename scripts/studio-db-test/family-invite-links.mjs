// Family Circle invite links (migration 192 + routes/family.ts) on the REAL
// family migrations (115, 116, 126) in PGlite, through the lab bundle.
// Proves: only Shepherds/Co-Shepherds create, list and revoke links; tokens
// are returned once and only their hash is stored; every invalid link
// (unknown, malformed, revoked, expired, used up) gets the same answer; a
// link never adds anyone — it files a request a manager approves; a link
// can't grant co_shepherd; clients can't read the tables directly.
// Synthetic users only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/family-invite-links.mjs
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleApp, makeTranslator } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mig = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const id = (n) => `00000000-0000-0000-0000-0000000008${String(n).padStart(2, "0")}`;
const U = { shep: id(1), co: id(2), adult: id(3), outsider: id(4), other: id(5), otherShep: id(6) };
const F1 = "55555555-5555-4555-8555-000000000001", F2 = "55555555-5555-4555-8555-000000000002";

const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''test.uid'', true), '''')::uuid';
  grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create table public.p2p_profiles (id uuid primary key, role text not null default 'student', full_name text, photo_url text, username text, email text);
  create table public.p2p_notifications (id uuid primary key default gen_random_uuid(), user_id uuid, title text, message text,
    notification_type text, data jsonb, read boolean default false, created_at timestamp default now(), pushed_at timestamptz);
`);
for (const f of ["115_family_foundation.sql", "116_family_worship_sessions.sql", "126_family_multi_membership.sql", "192_family_invite_links.sql"]) await db.exec(mig(f));
await db.exec(mig("192_family_invite_links.sql")); // re-runnable
ok("migration 192 loads on the real family schema and re-runs", true);

await db.exec(`insert into auth.users values ${Object.values(U).map((u) => `('${u}')`).join(",")};`);
await db.query(`insert into p2p_profiles (id, full_name, username, email) values
  ($1, 'Grace Shepherd', 'grace', 'g@example.invalid'), ($2, 'Chi CoShepherd', 'chi', 'c@example.invalid'), ($3, 'Dan Adult', 'dan', 'd@example.invalid'),
  ($4, 'Olu Outsider', 'olu', 'o@example.invalid'), ($5, 'Pat Other', 'pat', 'p@example.invalid'), ($6, 'Sam OtherShepherd', 'sam', 's@example.invalid')`,
  [U.shep, U.co, U.adult, U.outsider, U.other, U.otherShep]);
await db.query(`insert into p2p_families (id, name, shepherd_id) values ($1, 'The Okafors', $2), ($3, 'The Bellos', $4)`, [F1, U.shep, F2, U.otherShep]);
await db.query(`insert into p2p_family_members (family_id, user_id, role, status) values ($1, $2, 'shepherd', 'active'), ($1, $3, 'co_shepherd', 'active'), ($1, $4, 'adult', 'active'), ($5, $6, 'shepherd', 'active')`,
  [F1, U.shep, U.co, U.adult, F2, U.otherShep]);

const tmp = mkdtempSync(path.join(os.tmpdir(), "family-links-"));
const { app } = await bundleApp({ apiRoot: path.join(repo, "artifacts/api-server"), tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/family`;
const call = async (method, p, who, body) => {
  const r = await fetch(base + p, { method, headers: { ...(who ? { authorization: `Bearer ${who}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const q = async (sql, params = []) => (await db.query(sql, params)).rows;

try {
  // ── Creating links ───────────────────────────────────────────────────────
  ok("no sign-in → 401", (await call("POST", `/${F1}/invite-links`, null, {})).status === 401);
  ok("adult member can't create a link", (await call("POST", `/${F1}/invite-links`, U.adult, {})).status === 403);
  ok("outsider can't create a link", (await call("POST", `/${F1}/invite-links`, U.outsider, {})).status === 403);
  ok("another family's Shepherd can't create one here", (await call("POST", `/${F1}/invite-links`, U.otherShep, {})).status === 403);
  const made = await call("POST", `/${F1}/invite-links`, U.shep, {});
  const token = made.body?.token;
  ok("Shepherd creates a link: token returned once, adult role, 7-day expiry", made.status === 200 && /^[A-Za-z0-9_-]{32}$/.test(token) && made.body.role === "adult"
    && Math.abs(new Date(made.body.expiresAt).getTime() - (Date.now() + 7 * 864e5)) < 60_000, JSON.stringify(made));
  const stored = (await q(`select token_hash from p2p_family_invite_links where id = $1`, [made.body.id]))[0];
  ok("only the SHA-256 hash is stored", stored.token_hash === createHash("sha256").update(token).digest("hex") && stored.token_hash !== token);
  const coLink = await call("POST", `/${F1}/invite-links`, U.co, { role: "co_shepherd" });
  ok("Co-Shepherd can create; a link can't grant co_shepherd (falls back to adult)", coLink.status === 200 && coLink.body.role === "adult");
  const teenLink = await call("POST", `/${F1}/invite-links`, U.shep, { role: "teen" });
  ok("teen link", teenLink.body?.role === "teen");
  const list = await call("GET", `/${F1}/invite-links`, U.co);
  ok("managers list active links without tokens or hashes", list.status === 200 && list.body.length === 3 && !JSON.stringify(list.body).includes(token) && !JSON.stringify(list.body).includes("hash"));
  ok("adult member can't list links", (await call("GET", `/${F1}/invite-links`, U.adult)).status === 403);

  // ── Preview ──────────────────────────────────────────────────────────────
  const prev = await call("GET", `/invite-links/${token}/preview`, U.outsider);
  ok("outsider preview: family name, inviter, role, status none", prev.status === 200 && prev.body.familyName === "The Okafors Family Circle" && prev.body.invitedBy === "Grace Shepherd" && prev.body.status === "none", JSON.stringify(prev));
  ok("preview reveals no ids or member list", !JSON.stringify(prev.body).includes(F1) && !("members" in prev.body));
  ok("preview needs sign-in", (await call("GET", `/invite-links/${token}/preview`, null)).status === 401);
  ok("member's preview says already a member", (await call("GET", `/invite-links/${token}/preview`, U.adult)).body.status === "member");

  const invalid = await call("GET", `/invite-links/${"x".repeat(32)}/preview`, U.outsider);
  const malformed = await call("GET", `/invite-links/abc/preview`, U.outsider);
  ok("unknown and malformed tokens → same 404 message", invalid.status === 404 && malformed.status === 404 && invalid.body.error === malformed.body.error);

  // ── Request (never joins) ────────────────────────────────────────────────
  const reqd = await call("POST", `/invite-links/${token}/request`, U.outsider);
  ok("outsider's request is pending", reqd.status === 200 && reqd.body.status === "pending");
  ok("…and they are NOT a member", (await q(`select count(*)::int n from p2p_family_members where family_id = $1 and user_id = $2`, [F1, U.outsider]))[0].n === 0);
  const notes = await q(`select user_id, notification_type, data from p2p_notifications where notification_type = 'family_join_request' order by user_id`);
  ok("Shepherd and Co-Shepherd notified with the requester id", notes.length === 2 && notes.map((n) => n.user_id).sort().join() === [U.shep, U.co].sort().join() && notes.every((n) => n.data.requesterId === U.outsider && n.data.familyId === F1));
  const again = await call("POST", `/invite-links/${token}/request`, U.outsider);
  const uses = (await q(`select use_count from p2p_family_invite_links where id = $1`, [made.body.id]))[0].use_count;
  ok("asking again: still pending, link used once, no extra notifications", again.body.status === "pending" && uses === 1 && (await q(`select count(*)::int n from p2p_notifications where notification_type = 'family_join_request'`))[0].n === 2);
  ok("member using the link: no request filed", (await call("POST", `/invite-links/${token}/request`, U.adult)).body.status === "member"
    && (await q(`select count(*)::int n from p2p_family_join_requests where user_id = $1`, [U.adult]))[0].n === 0);
  ok("preview now says pending", (await call("GET", `/invite-links/${token}/preview`, U.outsider)).body.status === "pending");

  // ── Review ───────────────────────────────────────────────────────────────
  const pending = await call("GET", `/${F1}/join-requests`, U.shep);
  ok("Shepherd sees the request with public profile only", pending.status === 200 && pending.body.length === 1 && pending.body[0].name === "Olu Outsider" && !("email" in pending.body[0]));
  ok("adult member can't see join requests", (await call("GET", `/${F1}/join-requests`, U.adult)).status === 403);
  ok("requester can't see join requests", (await call("GET", `/${F1}/join-requests`, U.outsider)).status === 403);
  const rid = pending.body[0].id;
  ok("requester can't approve themselves", (await call("POST", `/${F1}/join-requests/${rid}/respond`, U.outsider, { action: "approve" })).status === 403);
  ok("adult member can't approve", (await call("POST", `/${F1}/join-requests/${rid}/respond`, U.adult, { action: "approve" })).status === 403);
  ok("another family's Shepherd can't approve", (await call("POST", `/${F2}/join-requests/${rid}/respond`, U.otherShep, { action: "approve" })).status === 404);
  const appr = await call("POST", `/${F1}/join-requests/${rid}/respond`, U.co, { action: "approve", role: "co_shepherd" });
  const m = (await q(`select role, status from p2p_family_members where family_id = $1 and user_id = $2`, [F1, U.outsider]))[0];
  ok("Co-Shepherd approves; co_shepherd can't be granted (keeps the link's role)", appr.body?.status === "approved" && m?.status === "active" && m.role === "adult", JSON.stringify({ appr, m }));
  ok("requester notified of approval", (await q(`select count(*)::int n from p2p_notifications where user_id = $1 and notification_type = 'family_join_approved'`, [U.outsider]))[0].n === 1);
  ok("answering twice → 409", (await call("POST", `/${F1}/join-requests/${rid}/respond`, U.shep, { action: "decline" })).status === 409);

  await call("POST", `/invite-links/${teenLink.body.token}/request`, U.other);
  const rid2 = (await call("GET", `/${F1}/join-requests`, U.shep)).body[0].id;
  const dec = await call("POST", `/${F1}/join-requests/${rid2}/respond`, U.shep, { action: "decline" });
  ok("decline leaves them out", dec.body?.status === "declined" && (await q(`select count(*)::int n from p2p_family_members where family_id = $1 and user_id = $2`, [F1, U.other]))[0].n === 0);

  // ── Revoked / expired / used up → same answer ───────────────────────────
  ok("revoke by another family's Shepherd → 403", (await call("POST", `/${F1}/invite-links/${coLink.body.id}/revoke`, U.otherShep)).status === 403);
  ok("revoke by a manager", (await call("POST", `/${F1}/invite-links/${coLink.body.id}/revoke`, U.shep)).body?.revoked === true);
  const rev = await call("GET", `/invite-links/${coLink.body.token}/preview`, U.other);
  await q(`update p2p_family_invite_links set expires_at = now() - interval '1 minute' where id = $1`, [teenLink.body.id]);
  const exp = await call("POST", `/invite-links/${teenLink.body.token}/request`, U.otherShep);
  await q(`update p2p_family_invite_links set use_count = max_uses where id = $1`, [made.body.id]);
  const used = await call("GET", `/invite-links/${token}/preview`, U.other);
  ok("revoked, expired and used-up links all answer the same 404", [rev, exp, used].every((r) => r.status === 404 && r.body.error === invalid.body.error), JSON.stringify([rev.status, exp.status, used.status]));
  ok("expired link filed no request", (await q(`select count(*)::int n from p2p_family_join_requests where user_id = $1`, [U.otherShep]))[0].n === 0);

  // ── Limits and direct access ─────────────────────────────────────────────
  for (let i = 0; i < 5; i++) await call("POST", `/${F1}/invite-links`, U.shep, {});
  ok("at most 5 active links per family", (await call("POST", `/${F1}/invite-links`, U.shep, {})).status === 409);
  for (const role of ["authenticated", "anon"]) {
    const t = makeTranslator(db, role, U.shep);
    const a = await t.from("p2p_family_invite_links").select("*");
    const b = await t.from("p2p_family_join_requests").select("*");
    ok(`${role} can't read link or request tables directly`, !!a.error && !!b.error, JSON.stringify([a.error, b.error]));
  }
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
