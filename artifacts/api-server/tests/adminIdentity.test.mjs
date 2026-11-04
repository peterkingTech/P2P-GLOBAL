// Admin Centre identity (migration 238) — routes/adminIdentity.ts and
// middleware/adminAuth.ts over HTTP with an in-memory database (synthetic ids):
//   • a session starts only for an ACTIVE admin account, right after a real
//     sign-in, with the second factor where required; only a hash is stored;
//   • the session ends on logout, when idle too long, or when revoked —
//     and an ended session is refused at once;
//   • ADMIN_SESSIONS_REQUIRED: without a session, admin routes refuse;
//   • least privilege on the server; nobody changes their own access; the
//     last super admin can't be removed; suspending ends their sessions;
//   • a new admin identity never reuses a peer's email and never gets a peer
//     profile; sensitive actions are audited with who, what and why.
// Run: node tests/adminIdentity.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub, { aal = "aal1", minutesAgo = 1 } = {}) => `${b64({ alg: "HS256" })}.${b64({ sub, aal, amr: [{ method: "password", timestamp: Math.floor((Date.now() - minutesAgo * 60_000) / 1000) }] })}.sig`;
const PERMS = { super_admin: ["admins.manage", "admins.view", "audit.view", "dashboard.view", "help.manage"], admin_help: ["dashboard.view", "help.manage", "mail.send"] };
const T = {
  p2p_admin_accounts: [
    { auth_user_id: "sup1", display_name: "Sup One", roles: ["super_admin"], status: "active", identity_kind: "legacy_shared", mfa_required: false },
    { auth_user_id: "sup2", display_name: "Sup Two", roles: ["super_admin"], status: "active", identity_kind: "legacy_shared", mfa_required: false },
    { auth_user_id: "help", display_name: "Helper", roles: ["admin_help"], status: "active", identity_kind: "legacy_shared", mfa_required: false },
    { auth_user_id: "mfa", display_name: "Needs MFA", roles: ["admin_help"], status: "active", identity_kind: "admin_only", mfa_required: true },
  ],
  p2p_admin_sessions: [], p2p_admin_audit: [], p2p_profiles: [{ id: "peer", role: "student" }, { id: "sup1", role: "super_admin" }], authUsers: [{ id: "peer", email: "peer@example.invalid" }],
};
let seq = 0;
function query(name) {
  const f = []; let upd = null, ins = null, countHead = false;
  const rows = () => (T[name] ?? []).filter((r) => f.every((p) => p(r)));
  const q = {
    select(_c, o) { if (o?.head) countHead = true; return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { f.push((r) => r[c] === v); return q; }, is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
    gt(c, v) { f.push((r) => r[c] > v); return q; }, lt(c, v) { f.push((r) => r[c] < v); return q; },
    contains(c, v) { f.push((r) => v.every((x) => (r[c] ?? []).includes(x))); return q; },
    insert(row) { ins = { ...row }; if (name === "p2p_admin_sessions") Object.assign(ins, { id: `s${++seq}`, created_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 12 * 3600e3).toISOString(), idle_minutes: 120, ended_at: null }); (T[name] ??= []).push(ins); return q; },
    update(v) { upd = v; return q; },
    async single() { return { data: ins, error: null }; },
    async maybeSingle() { if (upd) { const r = rows(); r.forEach((x) => Object.assign(x, upd)); return { data: r[0] ? { ...r[0] } : null, error: null }; } const r = rows(); return { data: r[0] ? { ...r[0] } : null, error: null }; },
    then(res) {
      if (upd) { rows().forEach((x) => Object.assign(x, upd)); return Promise.resolve({ data: null, error: null }).then(res); }
      if (ins) return Promise.resolve({ data: null, error: null }).then(res);
      return Promise.resolve(countHead ? { count: rows().length, data: null, error: null } : { data: rows().map((x) => ({ ...x })), error: null }).then(res);
    },
  };
  return q;
}
const db = {
  from: query,
  async rpc(fn, a) {
    const acc = T.p2p_admin_accounts.find((x) => x.auth_user_id === a.p_user && x.status === "active");
    return { data: acc ? [...new Set(acc.roles.flatMap((r) => PERMS[r] ?? []))] : [], error: null };
  },
  auth: {
    async getUser(token) { try { const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub; return { data: { user: { id: sub } }, error: null }; } catch { return { data: { user: null }, error: { message: "bad" } }; } },
    admin: { async inviteUserByEmail(email) { if (T.authUsers.some((u) => u.email === email)) return { data: null, error: { message: "A user with this email address has already been registered" } }; const u = { id: `new-${++seq}`, email }; T.authUsers.push(u); return { data: { user: u }, error: null }; } },
  },
};
globalThis.__ai = db;

const tmpDir = path.join(root, "tests", `.tmp-adminid-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mocks = {
  supabase: "export const supabase = globalThis.__ai; export const supabaseServiceRole = globalThis.__ai;",
  "supabase-js": "export const createClient = () => globalThis.__ai;",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "supabase-js", namespace: "mock" }));
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/adminIdentity.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const file = path.join(tmpDir, "ai.mjs"); writeFileSync(file, out.outputFiles[0].text);
  const app = express(); app.use(express.json()); app.use("/ai", (await import(pathToFileURL(file).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/ai`;
  const call = async (method, p, { token, session, body } = {}) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(session ? { "x-p2p-admin-session": session } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  };

  let r = await call("POST", "/session/start");
  ok("start: signed out → 401", r.status === 401);
  r = await call("POST", "/session/start", { token: jwt("peer") });
  ok("start: a peer who isn't an admin → 403, and the refusal is audited", r.status === 403 && T.p2p_admin_audit.at(-1).action === "admin_session.refused");
  r = await call("POST", "/session/start", { token: jwt("sup1", { minutesAgo: 30 }) });
  ok("start: an old sign-in (30 min) isn't enough — sign in again", r.status === 401 && r.j.freshSignInRequired);
  r = await call("POST", "/session/start", { token: jwt("mfa") });
  ok("start: an account that needs two-step verification is refused without it", r.status === 403 && r.j.mfaRequired);
  r = await call("POST", "/session/start", { token: jwt("mfa", { aal: "aal2" }) });
  ok("…and accepted with it", r.status === 201);
  const supTok = jwt("sup1");
  r = await call("POST", "/session/start", { token: supTok });
  const S1 = r.j.token;
  ok("start: a fresh sign-in by an active admin → a session, with roles and permissions", r.status === 201 && S1 && r.j.roles.join() === "super_admin" && r.j.permissions.includes("admins.manage"));
  ok("…only a hash of the token is stored; the start is audited", T.p2p_admin_sessions.some((s) => s.token_hash === createHash("sha256").update(S1).digest("hex")) && !JSON.stringify(T.p2p_admin_sessions).includes(S1) && T.p2p_admin_audit.at(-1).action === "admin_session.start");

  r = await call("GET", "/session/me", { token: supTok, session: S1 });
  ok("me: the session's identity, roles and permissions", r.status === 200 && r.j.displayName === "Sup One" && r.j.permissions.includes("audit.view"));
  r = await call("GET", "/session/me", { token: jwt("sup2"), session: S1 });
  ok("someone else's session token is refused", r.status === 401 && r.j.adminSessionEnded);
  r = await call("GET", "/session/me", { token: supTok, session: "x".repeat(43) });
  ok("an unknown session → 401", r.status === 401);

  // Least privilege.
  const helpTok = jwt("help"); const H = (await call("POST", "/session/start", { token: helpTok })).j.token;
  r = await call("GET", "/accounts", { token: helpTok, session: H });
  ok("admin_help can't list administrators (403, server-side)", r.status === 403 && r.j.permission === "admins.view");
  r = await call("GET", "/audit", { token: helpTok, session: H });
  ok("…or read the audit", r.status === 403);
  r = await call("GET", "/accounts", { token: supTok, session: S1 });
  ok("a super admin can list administrators, with open sessions", r.status === 200 && r.j.accounts.length === 4 && r.j.accounts.find((a) => a.userId === "help").openSessions === 1);

  // Changes.
  r = await call("PUT", "/accounts/sup1", { token: supTok, session: S1, body: { status: "suspended", reason: "x" } });
  ok("nobody changes their own access", r.status === 403);
  r = await call("PUT", "/accounts/help", { token: supTok, session: S1, body: { status: "suspended" } });
  ok("a change needs a reason", r.status === 400);
  r = await call("PUT", "/accounts/help", { token: supTok, session: S1, body: { status: "suspended", reason: "Left the team" } });
  ok("suspending: done, their open sessions end, audited with before/after and the reason", r.status === 200 && T.p2p_admin_sessions.filter((s) => s.auth_user_id === "help").every((s) => s.ended_at) && T.p2p_admin_audit.at(-1).reason === "Left the team" && T.p2p_admin_audit.at(-1).detail.after.status === "suspended");
  r = await call("GET", "/session/me", { token: helpTok, session: H });
  ok("…and the suspended admin's session is refused at once", r.status === 401);
  const sup2Tok = jwt("sup2"); const S2 = (await call("POST", "/session/start", { token: sup2Tok })).j.token;
  r = await call("PUT", "/accounts/sup1", { token: sup2Tok, session: S2, body: { status: "revoked", reason: "test" } });
  ok("one super admin may remove another while one remains", r.status === 200);
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup1").status = "active";
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup2").status = "revoked";
  const S1b = (await call("POST", "/session/start", { token: supTok })).j.token;
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup2").status = "active";
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup1").roles = ["super_admin"];
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup2").roles = ["admin_help"];
  PERMS.admin_help.push("admins.manage");   // someone allowed to manage admins who isn't a super admin
  r = await call("PUT", "/accounts/sup1", { token: sup2Tok, session: S2, body: { roles: ["admin_help"], reason: "x" } });
  ok("the last active super admin can't be removed (409) — even by someone allowed to manage admins", r.status === 409 && T.p2p_admin_accounts.find((x) => x.auth_user_id === "sup1").roles.join() === "super_admin", String(r.status));
  PERMS.admin_help.pop();
  T.p2p_admin_accounts.find((a) => a.auth_user_id === "sup2").roles = ["super_admin"];

  // Provisioning.
  const before = T.p2p_admin_accounts.length;
  r = await call("POST", "/accounts", { token: supTok, session: S1b, body: { email: "peer@example.invalid", displayName: "Peer", roles: ["admin_help"], reason: "x" } });
  ok("a peer's email can't become an admin identity — identities are never merged (409)", r.status === 409 && T.p2p_admin_accounts.length === before);
  r = await call("POST", "/accounts", { token: supTok, session: S1b, body: { email: "new.admin@example.invalid", displayName: "New Admin", roles: ["root"], reason: "x" } });
  ok("unknown roles are refused", r.status === 400);
  const profilesBefore = T.p2p_profiles.length;
  r = await call("POST", "/accounts", { token: supTok, session: S1b, body: { email: "new.admin@example.invalid", displayName: "New Admin", roles: ["admin_content"], reason: "Content team" } });
  const created = T.p2p_admin_accounts.at(-1);
  ok("provisioning: invited by email (no password set by anyone else), admin-only, two-step verification required", r.status === 201 && created.identity_kind === "admin_only" && created.mfa_required === true && created.roles.join() === "admin_content");
  ok("…no peer profile is created; audited with the reason", T.p2p_profiles.length === profilesBefore && T.p2p_admin_audit.at(-1).action === "admin_account.provisioned" && T.p2p_admin_audit.at(-1).reason === "Content team");

  // Logout + idle.
  r = await call("POST", "/session/end", { token: supTok, session: S1b });
  ok("logout ends the session (audited)", r.status === 200 && T.p2p_admin_audit.at(-1).action === "admin_session.end");
  r = await call("GET", "/session/me", { token: supTok, session: S1b });
  ok("…and it can't be used again", r.status === 401);
  const S3 = (await call("POST", "/session/start", { token: sup2Tok })).j.token;
  T.p2p_admin_sessions.find((s) => s.token_hash === createHash("sha256").update(S3).digest("hex")).last_seen_at = new Date(Date.now() - 3 * 3600e3).toISOString();
  r = await call("GET", "/session/me", { token: sup2Tok, session: S3 });
  ok("idle for more than 2 hours → the session has ended", r.status === 401 && T.p2p_admin_sessions.find((s) => s.token_hash === createHash("sha256").update(S3).digest("hex")).end_reason === "expired");

  // Sessions required.
  process.env.ADMIN_SESSIONS_REQUIRED = "true";
  r = await call("GET", "/accounts", { token: supTok });
  ok("ADMIN_SESSIONS_REQUIRED: the role alone no longer opens admin routes", r.status === 401 && r.j.adminSessionRequired);
  delete process.env.ADMIN_SESSIONS_REQUIRED;
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`adminIdentity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
