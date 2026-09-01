import { Router } from "express";
import { verifyCaller, supabaseServiceRole as db } from "../lib/supabase";

const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const PLATFORMS = ["ios", "android"] as const;

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

  const { token, platform, deviceId } = req.body as { token?: string; platform?: string; deviceId?: string };
  if (!token?.trim()) return err(res, "token is required", 400);
  if (!platform || !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) {
    return err(res, `platform must be one of: ${PLATFORMS.join(", ")}`, 400);
  }

  const now = new Date().toISOString();
  const { error } = await db.from("p2p_push_tokens").upsert(
    {
      user_id: userId, token: token.trim(), platform, device_id: deviceId ?? null,
      is_active: true, updated_at: now, last_seen_at: now,
    },
    { onConflict: "token" }
  );
  if (error) return err(res, error.message, 500);
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

  const { error } = await db.from("p2p_push_tokens")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("token", token.trim())
    .eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { unregistered: true });
});

export default router;