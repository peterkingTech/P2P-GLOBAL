import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { ADMIN_SESSION_HEADER, adminSessionsRequired, permissionsFor, validateAdminSession } from "../lib/adminIdentity";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

const ADMIN_ROLES = new Set([
  "peer_guide",
  "church_leader",
  "regional_admin",
  "moderator",
  "super_admin",
  // Admin hierarchy roles (migration 069) — additive alongside the six roles
  // above, none of which they replace.
  "admin_supervisor",
  "admin_zone",
  "admin_national",
  "admin_content",
  "admin_translation",
  "admin_moderation",
  "admin_verification",
  "admin_help",
  "admin_username",
  "admin_finance",
  "admin_marketing",
  "admin_church",
]);

/**
 * Middleware that verifies the caller is an authenticated admin (any role above student).
 * Expects: Authorization: Bearer <supabase-jwt>
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Missing authorization token." });
    return;
  }

  // Verify the JWT with Supabase
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }

  // An admin session (migration 238): the administrative identity, its roles
  // and least-privilege permissions — separate from any peer profile.
  const sessionToken = String(req.headers[ADMIN_SESSION_HEADER] ?? "");
  if (sessionToken) {
    const session = await validateAdminSession(sessionToken, user.id);
    if (!session) {
      res.status(401).json({ error: "Your admin session has ended. Please sign in to the Admin Centre again.", adminSessionEnded: true });
      return;
    }
    (req as any).adminUserId = user.id;
    (req as any).adminRoles = session.roles;
    (req as any).adminRole = session.roles.includes("super_admin") ? "super_admin" : session.roles[0];
    (req as any).adminPermissions = session.permissions;
    (req as any).adminSessionId = session.sessionId;
    (req as any).adminToken = token;
    next();
    return;
  }
  if (adminSessionsRequired()) {
    res.status(401).json({ error: "Please sign in to the Admin Centre.", adminSessionRequired: true });
    return;
  }

  // Until admin sessions are required: the current check, unchanged.
  // Check profile role — must query AS the caller (their JWT attached), not
  // with the server's bare anon client: RLS on p2p_profiles blocks anonymous
  // reads, which made this middleware return 403 "Profile not found" for
  // every admin regardless of their actual role.
  const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileErr } = await asCaller
    .from("p2p_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    res.status(403).json({ error: "Profile not found." });
    return;
  }

  if (!ADMIN_ROLES.has(profile.role as string)) {
    res.status(403).json({ error: "Admin access required (peer_guide, church_leader, regional_admin, moderator, super_admin, or an admin_* role)." });
    return;
  }

  // Attach user ID + role for downstream use
  (req as any).adminUserId = user.id;
  (req as any).adminRole = profile.role as string;
  (req as any).adminRoles = [profile.role as string];
  // The verified access token, for routes that must act AS this user in the
  // database (supabaseAsUser) rather than as the service role.
  (req as any).adminToken = token;
  next();
}

/**
 * Stacks on top of requireAdmin (which must run first — see admin.ts's
 * blanket router.use(requireAdmin)) to further restrict a specific route to
 * a subset of admin roles. super_admin always passes, matching this
 * codebase's existing "super_admin is the full-access escape hatch"
 * convention (see p2p_start_direct_conversation, migration 021/067).
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as any).adminRole as string | undefined;
    const roles = ((req as any).adminRoles as string[] | undefined) ?? (role ? [role] : []);
    if (!role) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    if (!roles.includes("super_admin") && !roles.some((r) => allowedRoles.includes(r))) {
      res.status(403).json({ error: `This action requires one of: ${allowedRoles.join(", ")}.` });
      return;
    }
    next();
  };
}

/**
 * Least privilege (migration 238): the admin's roles must grant this exact
 * permission. Stacks on requireAdmin. Enforced here on the server — never by
 * what the app shows or hides.
 */
export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = (req as any).adminUserId as string | undefined;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    let perms = (req as any).adminPermissions as string[] | undefined;
    if (!perms) {
      perms = await permissionsFor(userId);
      (req as any).adminPermissions = perms;
    }
    if (!perms.includes(permission)) {
      res.status(403).json({ error: "You don't have permission for this.", permission });
      return;
    }
    next();
  };
}
