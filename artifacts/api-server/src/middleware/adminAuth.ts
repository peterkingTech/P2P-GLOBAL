import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

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
    res.status(403).json({ error: "Admin access required (peer_guide, church_leader, regional_admin, moderator, or super_admin role)." });
    return;
  }

  // Attach user ID for downstream use
  (req as any).adminUserId = user.id;
  next();
}
