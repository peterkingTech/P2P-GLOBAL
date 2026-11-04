import { Router, type Request, type Response } from "express";
import { supabase, supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin, requirePermission } from "../middleware/adminAuth";
import { FRESH_SIGN_IN_MS, activeAccount, audit, hashToken, newSessionToken, permissionsFor, signInClaims } from "../lib/adminIdentity";

// The Admin Centre's own identity (migration 238).
//   POST /admin-identity/session/start — right after a real sign-in (within 15
//        minutes; with the second factor where the account requires it), an
//        ACTIVE admin account gets a server-side session: idle 2 hours,
//        absolute 12 hours. A revoked session can't be quietly restarted with
//        an old token: the person must sign in again.
//   GET  /admin-identity/session/me · POST /admin-identity/session/end (logout)
//   Accounts (admins.manage / admins.view): list, provision, change roles or
//        status (with a reason), revoke sessions. Nobody can change their own
//        roles or status, and the last active super admin can't be removed.
//        A new admin identity never reuses a peer's email address and never
//        gets a peer profile — the two stay separate.
//   GET  /admin-identity/audit (audit.view) — the append-only record.

const router = Router();
const KNOWN_ROLES = new Set(["super_admin", "admin_supervisor", "regional_admin", "church_leader", "moderator", "peer_guide", "admin_content", "admin_translation",
  "admin_moderation", "admin_verification", "admin_help", "admin_username", "admin_marketing", "admin_church", "admin_zone", "admin_national", "admin_finance"]);
const bearer = (req: Request) => (req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null);
const ctx = (req: Request) => ({ adminUserId: (req as any).adminUserId as string, adminRole: (req as any).adminRole as string, sessionId: ((req as any).adminSessionId as string | undefined) ?? null });

router.post("/session/start", async (req: Request, res: Response) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: "Please sign in." });
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return res.status(401).json({ error: "Please sign in." });
  const account = await activeAccount(user.id);
  if (!account) {
    await audit({ adminUserId: user.id, action: "admin_session.refused", reason: "No active admin account" });
    return res.status(403).json({ error: "This account isn't an active P2P Global administrator." });
  }
  const claims = signInClaims(token);
  if (!claims.authenticatedAt || Date.now() - claims.authenticatedAt > FRESH_SIGN_IN_MS) {
    return res.status(401).json({ error: "Please sign in again to open the Admin Centre.", freshSignInRequired: true });
  }
  if (account.mfa_required && claims.aal !== "aal2") {
    return res.status(403).json({ error: "This admin account needs two-step verification.", mfaRequired: true });
  }
  const sessionToken = newSessionToken();
  const { data: s, error } = await db.from("p2p_admin_sessions").insert({
    auth_user_id: user.id, token_hash: hashToken(sessionToken), aal: claims.aal, user_agent: String(req.headers["user-agent"] ?? "").slice(0, 200),
  }).select("id,expires_at,idle_minutes").single();
  if (error || !s) return res.status(500).json({ error: "Couldn't start the admin session." });
  await db.from("p2p_admin_accounts").update({ last_session_at: new Date().toISOString() }).eq("auth_user_id", user.id);
  const roles = account.roles;
  await audit({ adminUserId: user.id, adminRole: roles[0], sessionId: s.id, action: "admin_session.start", detail: { aal: claims.aal } });
  return res.status(201).json({ token: sessionToken, expiresAt: s.expires_at, idleMinutes: s.idle_minutes, displayName: account.display_name, roles, permissions: await permissionsFor(user.id), identityKind: account.identity_kind });
});

router.get("/session/me", requireAdmin, async (req: Request, res: Response) => {
  if (!(req as any).adminSessionId) return res.status(401).json({ error: "No admin session.", adminSessionRequired: true });
  const account = await activeAccount((req as any).adminUserId);
  return res.json({ displayName: account?.display_name ?? "Administrator", roles: (req as any).adminRoles, permissions: (req as any).adminPermissions, identityKind: account?.identity_kind ?? null });
});

router.post("/session/end", requireAdmin, async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  if (sessionId) {
    await db.from("p2p_admin_sessions").update({ ended_at: new Date().toISOString(), end_reason: "logout", ended_by: adminUserId }).eq("id", sessionId).is("ended_at", null);
    await audit({ adminUserId, adminRole, sessionId, action: "admin_session.end" });
  }
  return res.json({ ended: true });
});

// ── Accounts ────────────────────────────────────────────────────────────────
router.get("/accounts", requireAdmin, requirePermission("admins.view"), async (_req: Request, res: Response) => {
  const [{ data: accounts }, { data: open }] = await Promise.all([
    db.from("p2p_admin_accounts").select("auth_user_id,display_name,roles,status,identity_kind,mfa_required,created_at,last_session_at").order("created_at", { ascending: true }),
    db.from("p2p_admin_sessions").select("auth_user_id").is("ended_at", null).gt("expires_at", new Date().toISOString()),
  ]);
  const openBy = new Map<string, number>();
  for (const s of (open ?? []) as { auth_user_id: string }[]) openBy.set(s.auth_user_id, (openBy.get(s.auth_user_id) ?? 0) + 1);
  return res.json({ accounts: ((accounts ?? []) as Record<string, unknown>[]).map((a) => ({
    userId: a.auth_user_id, displayName: a.display_name, roles: a.roles, status: a.status, identityKind: a.identity_kind,
    mfaRequired: a.mfa_required, createdAt: a.created_at, lastSessionAt: a.last_session_at, openSessions: openBy.get(a.auth_user_id as string) ?? 0,
  })) });
});

router.post("/accounts", requireAdmin, requirePermission("admins.manage"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const displayName = String(req.body?.displayName ?? "").trim().slice(0, 120);
  const roles = (Array.isArray(req.body?.roles) ? req.body.roles : []).map(String);
  const reason = String(req.body?.reason ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !displayName) return res.status(400).json({ error: "An email address and a name are required." });
  if (!roles.length || roles.some((r: string) => !KNOWN_ROLES.has(r))) return res.status(400).json({ error: "Choose at least one known admin role." });
  if (!reason) return res.status(400).json({ error: "Say why this administrator is being added." });
  // A separate identity: never an existing account (a peer's) — even with the same email.
  const { data: invited, error } = await db.auth.admin.inviteUserByEmail(email, { data: { p2p_admin_identity: true } });
  if (error || !invited?.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return res.status(exists ? 409 : 500).json({ error: exists ? "That email already has an account. An admin identity needs its own email address — it's kept separate from any peer account." : "Couldn't invite this administrator." });
  }
  const { error: insErr } = await db.from("p2p_admin_accounts").insert({ auth_user_id: invited.user.id, display_name: displayName, roles, identity_kind: "admin_only", mfa_required: true, created_by: adminUserId });
  if (insErr) return res.status(500).json({ error: "The invitation was sent, but the admin account couldn't be recorded." });
  await audit({ adminUserId, adminRole, sessionId, action: "admin_account.provisioned", targetType: "admin_account", targetId: invited.user.id, reason, detail: { roles, displayName } });
  return res.status(201).json({ userId: invited.user.id, invited: true });
});

router.put("/accounts/:userId", requireAdmin, requirePermission("admins.manage"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const target = String(req.params.userId);
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Say why this change is being made." });
  if (target === adminUserId) return res.status(403).json({ error: "You can't change your own administrator access — ask another administrator." });
  const { data: cur } = await db.from("p2p_admin_accounts").select("roles,status").eq("auth_user_id", target).maybeSingle();
  if (!cur) return res.status(404).json({ error: "Administrator not found." });
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.roles !== undefined) {
    const roles = (Array.isArray(req.body.roles) ? req.body.roles : []).map(String);
    if (!roles.length || roles.some((r: string) => !KNOWN_ROLES.has(r))) return res.status(400).json({ error: "Choose at least one known admin role." });
    next.roles = roles;
  }
  if (req.body?.status !== undefined) {
    if (!["active", "suspended", "revoked"].includes(String(req.body.status))) return res.status(400).json({ error: "Unknown status." });
    next.status = String(req.body.status); next.status_reason = reason; next.status_changed_by = adminUserId;
  }
  // Never leave P2P Global without an active super admin.
  const losesSuper = (cur.roles as string[]).includes("super_admin") && cur.status === "active"
    && ((next.status && next.status !== "active") || (next.roles && !(next.roles as string[]).includes("super_admin")));
  if (losesSuper) {
    const { count } = await db.from("p2p_admin_accounts").select("auth_user_id", { count: "exact", head: true }).eq("status", "active").contains("roles", ["super_admin"]);
    if ((count ?? 0) <= 1) return res.status(409).json({ error: "This is the last active super admin." });
  }
  const { error } = await db.from("p2p_admin_accounts").update(next).eq("auth_user_id", target);
  if (error) return res.status(500).json({ error: "Couldn't update the administrator." });
  if (next.status && next.status !== "active") {
    await db.from("p2p_admin_sessions").update({ ended_at: new Date().toISOString(), end_reason: `account ${next.status}`, ended_by: adminUserId }).eq("auth_user_id", target).is("ended_at", null);
  }
  await audit({ adminUserId, adminRole, sessionId, action: next.roles ? "admin_account.roles_changed" : "admin_account.status_changed", targetType: "admin_account", targetId: target, reason,
    detail: { before: { roles: cur.roles, status: cur.status }, after: { roles: next.roles ?? cur.roles, status: next.status ?? cur.status } } });
  return res.json({ updated: true });
});

router.post("/sessions/:sessionId/revoke", requireAdmin, requirePermission("admins.manage"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim() || "Revoked by an administrator";
  const { data, error } = await db.from("p2p_admin_sessions").update({ ended_at: new Date().toISOString(), end_reason: "revoked", ended_by: adminUserId })
    .eq("id", String(req.params.sessionId)).is("ended_at", null).select("auth_user_id").maybeSingle();
  if (error) return res.status(500).json({ error: "Couldn't revoke the session." });
  if (!data) return res.status(404).json({ error: "No open session with that id." });
  await audit({ adminUserId, adminRole, sessionId, action: "admin_session.revoked", targetType: "admin_session", targetId: String(req.params.sessionId), reason, detail: { of: (data as { auth_user_id: string }).auth_user_id } });
  return res.json({ revoked: true });
});

router.get("/audit", requireAdmin, requirePermission("audit.view"), async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const before = typeof req.query.before === "string" ? req.query.before : null;
  let q = db.from("p2p_admin_audit").select("id,at,admin_user_id,admin_role,action,target_type,target_id,reason,detail").order("at", { ascending: false }).limit(limit);
  if (before) q = q.lt("at", before);
  const { data } = await q;
  const rows = (data ?? []) as Record<string, unknown>[];
  return res.json({ entries: rows, nextBefore: rows.length === limit ? rows[rows.length - 1].at : null });
});

export default router;
