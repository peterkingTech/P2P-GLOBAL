import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Deleting an auth user requires the service-role key — the mobile client
// only ever holds the anon key, so this has to go through the API, same
// pattern as every other privileged write in this server (see discipleship.ts).
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const router = Router();

// POST /account/delete — deletes the caller's own profile row and auth user.
// Trusts the caller-supplied userId, same trust model as the app's other
// non-admin, self-scoped routes (e.g. /plans/:planId/progress/:userId).
router.post("/delete", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  await supabaseWrite.from("p2p_profiles").delete().eq("id", userId);
  const { error } = await supabaseWrite.auth.admin.deleteUser(userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ deleted: true });
});

export default router;