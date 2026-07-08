import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabase";

const ADMIN_ROLES = new Set([
  "peer_guide",
  "church_leader",
  "regional_admin",
  "moderator",
  "super_admin",
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

  // Check profile role
  const { data: profile, error: profileErr } = await supabase
    .from("p2p_profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    res.status(403).json({ error: "Profile not found." });
    return;
  }

  if (!ADMIN_ROLES.has(profile.role as string)) {
    res.status(403).json({ error: "Admin access required (peer_guide, church_leader, regional_admin, moderator, or super_admin role)." });
    return;
  }

  // Attach user ID for downstream use
  (req as any).adminUserId = user.id;
  next();
}
