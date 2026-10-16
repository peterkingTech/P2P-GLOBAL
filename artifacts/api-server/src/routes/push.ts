import { Router } from "express";
import { verifyCaller, supabaseServiceRole as db } from "../lib/supabase";
import { logger } from "../lib/logger";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// ios_voip: a PushKit VoIP token (migration 172) — delivered straight to
// Apple by lib/apnsVoip.ts, never through Expo.
const PLATFORMS = ["ios", "android", "ios_voip"] as const;

// POST /push/register — { token, platform, deviceId? }. Identity always
// comes from verifyCaller, never a body-supplied userId (section 3/13's
// explicit requirement). Upserts on the token's own unique constraint, so
// re-registering the SAME physical device's token under a DIFFERENT user
// (logout/login on a shared device, section 12) correctly reassigns
// ownership to whoever is verified right now -- exactly the real-world
// behavior a push token needs, and something a direct client-side RLS
// upsert could never do safely (the pre-image's owner would block it).
router.post("/push/register", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { token, platform, deviceId, callSystem } = req.body as {
    token?: string; platform?: string; deviceId?: string;
    // This app build handles calls natively (Android Telecom / iOS CallKit).
    callSystem?: boolean;
  };
  if (!token?.trim()) return err(res, "token is required", 400);
  if (!platform || !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return err(res, `platform must be one of: ${PLATFORMS.join(", ")}`, 400);
  }

  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: userId, token: token.trim(), platform, device_id: deviceId ?? null,
    is_active: true, updated_at: now, last_seen_at: now,
  };
  if (typeof callSystem === "boolean") row.call_system = callSystem;
  let { error } = await db.from("p2p_push_tokens").upsert(row, { onConflict: "token" });
  // Before migration 172: no call_system column (42703) — register the
  // token exactly as before. An ios_voip token can't be stored yet (23514).
  if (error && (error as { code?: string }).code === "42703") {
    delete row.call_system;
    ({ error } = await db.from("p2p_push_tokens").upsert(row, { onConflict: "token" }));
  }
  if (error && (error as { code?: string }).code === "23514") return err(res, "This token type isn't supported yet.", 409);
  if (error) return err(res, error.message, 500);

  // One install has ONE current token per platform. A token can change
  // under the same install (e.g. a build from a different EAS project gets
  // a new Expo push token) and the old one keeps reaching the same phone —
  // so a phone once signed in as someone else kept receiving THEIR pushes,
  // including the messages this user sent them (2026-10-16). Retire every
  // other active token of this install + platform, whoever owned it.
  if (deviceId) {
    const { error: retireErr } = await db.from("p2p_push_tokens")
      .update({ is_active: false, updated_at: now })
      .eq("device_id", deviceId)
      .eq("platform", platform)
      .eq("is_active", true)
      .neq("token", token.trim());
    if (retireErr) logger.warn({ err: retireErr }, "push/register: could not retire older tokens for this install");
  }
  return ok(res, { registered: true });
});

// POST /push/unregister — { token }. Deliberately scoped by BOTH token AND
// the verified caller's own id -- if a caller supplies a token they don't
// own (forged/guessed), the WHERE clause matches zero rows: a safe no-op,
// never another user's row (section 13's "deleting another user's token"
// test).
router.post("/push/unregister", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);

  const { token } = req.body as { token?: string };
  if (!token?.trim()) return err(res, "token is required", 400);

  const now = new Date().toISOString();
  const { data: retired, error } = await db.from("p2p_push_tokens")
    .update({ is_active: false, updated_at: now })
    .eq("token", token.trim())
    .eq("user_id", userId)
    .select("device_id");
  if (error) return err(res, error.message, 500);
  // Signing out also retires this user's OTHER tokens on the same install
  // (an older token from a previous build would otherwise keep delivering
  // this user's pushes to a phone they signed out of). Still scoped to the
  // caller's own rows.
  const deviceId = ((retired ?? []) as { device_id: string | null }[]).find((r) => r.device_id)?.device_id;
  if (deviceId) {
    const { error: e2 } = await db.from("p2p_push_tokens")
      .update({ is_active: false, updated_at: now })
      .eq("device_id", deviceId)
      .eq("user_id", userId)
      .eq("is_active", true);
    if (e2) logger.warn({ err: e2 }, "push/unregister: could not retire older tokens for this install");
  }
  return ok(res, { unregistered: true });
});

export default router;