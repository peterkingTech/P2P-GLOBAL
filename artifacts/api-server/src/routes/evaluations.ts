import { Router } from "express";
import { supabase } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";

const router = Router();

// POST /admin/evaluations/run-reassignment
// Manually runs the 72h stale-evaluation reassignment sweep (normally scheduled hourly via pg_cron).
// Useful for testing without waiting for real time to pass (backdate a row's assigned_at, then call this).
router.post("/run-reassignment", requireAdmin, async (_req, res) => {
  const { data, error } = await supabase.rpc("p2p_reassign_stale_evaluations");

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json({ reassignedCount: data ?? 0 });
});

export default router;
