import { createHash, randomBytes } from "node:crypto";
import { supabaseServiceRole as db } from "./supabase";

// Administrative identity and sessions (migration 238). An admin session is a
// server-side record on top of the person's Supabase sign-in: started only
// right after a real sign-in (password, plus the second factor where required),
// expiring when idle and absolutely, revocable at once, ended on logout. Only a
// hash of its token is stored. Permissions come from the admin account's roles
// (least privilege), never from what the app shows or hides.

export const ADMIN_SESSION_HEADER = "x-p2p-admin-session";
/** Once the owner switches this on, every admin route needs a valid admin session (the current role check alone no longer suffices). */
export const adminSessionsRequired = () => process.env.ADMIN_SESSIONS_REQUIRED === "true";
/** A session may only start this soon after the person actually signed in. */
export const FRESH_SIGN_IN_MS = 15 * 60_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newSessionToken = () => randomBytes(32).toString("base64url");

/** From an access token Supabase has already verified: the assurance level, and when the person last actually authenticated. */
export function signInClaims(accessToken: string): { aal: string | null; authenticatedAt: number | null } {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { aal?: string; amr?: { method?: string; timestamp?: number }[] };
    const times = (payload.amr ?? []).map((m) => Number(m.timestamp) * 1000).filter((t) => Number.isFinite(t) && t > 0);
    return { aal: payload.aal ?? null, authenticatedAt: times.length ? Math.max(...times) : null };
  } catch {
    return { aal: null, authenticatedAt: null };
  }
}

export interface AdminAccount { auth_user_id: string; display_name: string; roles: string[]; status: string; identity_kind: string; mfa_required: boolean }
export interface AdminSession { sessionId: string; userId: string; displayName: string; roles: string[]; permissions: string[]; identityKind: string; expiresAt: string }

export async function activeAccount(userId: string): Promise<AdminAccount | null> {
  const { data } = await db.from("p2p_admin_accounts").select("auth_user_id,display_name,roles,status,identity_kind,mfa_required").eq("auth_user_id", userId).maybeSingle();
  const a = data as AdminAccount | null;
  return a && a.status === "active" ? a : null;
}

export async function permissionsFor(userId: string): Promise<string[]> {
  const { data } = await db.rpc("p2p_admin_permissions_for", { p_user: userId });
  return Array.isArray(data) ? (data as string[]) : [];
}

/** The admin session behind a token, if it is this person's, still open, not idle too long, and their account is active. */
export async function validateAdminSession(token: string, userId: string, now = Date.now()): Promise<AdminSession | null> {
  if (!token || token.length < 20) return null;
  const { data } = await db.from("p2p_admin_sessions").select("id,auth_user_id,expires_at,last_seen_at,idle_minutes,ended_at").eq("token_hash", hashToken(token)).maybeSingle();
  const s = data as { id: string; auth_user_id: string; expires_at: string; last_seen_at: string; idle_minutes: number; ended_at: string | null } | null;
  if (!s || s.auth_user_id !== userId || s.ended_at) return null;
  if (Date.parse(s.expires_at) <= now || now - Date.parse(s.last_seen_at) > s.idle_minutes * 60_000) {
    await db.from("p2p_admin_sessions").update({ ended_at: new Date(now).toISOString(), end_reason: "expired" }).eq("id", s.id).is("ended_at", null);
    return null;
  }
  const account = await activeAccount(userId);
  if (!account) return null;
  if (now - Date.parse(s.last_seen_at) > 60_000) await db.from("p2p_admin_sessions").update({ last_seen_at: new Date(now).toISOString() }).eq("id", s.id);
  return { sessionId: s.id, userId, displayName: account.display_name, roles: account.roles, permissions: await permissionsFor(userId), identityKind: account.identity_kind, expiresAt: s.expires_at };
}

/** One append-only audit entry (migration 238). Never throws: an audit failure is logged, not hidden in the response. */
export async function audit(entry: { adminUserId?: string | null; adminRole?: string | null; sessionId?: string | null; action: string; targetType?: string | null; targetId?: string | null; reason?: string | null; detail?: Record<string, unknown> }): Promise<void> {
  const { error } = await db.from("p2p_admin_audit").insert({
    admin_user_id: entry.adminUserId ?? null, admin_role: entry.adminRole ?? null, session_id: entry.sessionId ?? null,
    action: entry.action, target_type: entry.targetType ?? null, target_id: entry.targetId ?? null,
    reason: entry.reason ? String(entry.reason).slice(0, 1000) : null, detail: entry.detail ?? {},
  });
  if (error) console.error("P2P admin audit write failed", entry.action, error.message);
}
