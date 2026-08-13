import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "../middleware/adminAuth";
import { detectInactiveUsers, getActivePeerGuideId } from "../lib/pastoralCare";

const router = Router();

// POST /pastoral-care/run-check — manually runs the daily inactivity sweep
// (normally scheduled at 6am UTC via node-cron in index.ts). Same pattern as
// evaluations.ts's /run-reassignment — useful for testing without waiting
// for real time to pass, and as an on-demand ops tool.
router.post("/run-check", requireAdmin, async (_req, res) => {
  try {
    const result = await detectInactiveUsers();
    return res.json(result);
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? "Pastoral care check failed" });
  }
});

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
// p2p_pastoral_care_log has no client-facing INSERT/UPDATE policy (only
// self-SELECT) and notifying a peer guide is a cross-user write — same
// service-role reasoning as pastoralCare.ts.
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

// GET /pastoral-care/pending/:userId — the most recent unresponded Elijah
// Protocol message for this user, if any. Used by the Home screen to surface
// the "tap to respond" card (this app has no push-notification tap-routing
// infrastructure, so the in-app card is the real delivery mechanism —
// the notification row still exists in p2p_notifications for visibility).
router.get("/pending/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await db
    .from("p2p_pastoral_care_log")
    .select("id, message_sent, sent_at")
    .eq("user_id", userId)
    .eq("care_type", "elijah_protocol")
    .is("user_response", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(data ? { id: data.id, messageSent: data.message_sent, sentAt: data.sent_at } : null);
});

// POST /pastoral-care/respond — the three Elijah Protocol response buttons.
router.post("/respond", async (req, res) => {
  const { userId, decision } = req.body as {
    userId?: string;
    decision?: "taking_break" | "needs_support" | "restarting";
  };
  if (!userId || !decision || !["taking_break", "needs_support", "restarting"].includes(decision)) {
    return res.status(400).json({ error: "userId and a valid decision are required" });
  }

  const { data: logRow } = await db
    .from("p2p_pastoral_care_log")
    .select("id")
    .eq("user_id", userId)
    .eq("care_type", "elijah_protocol")
    .is("user_response", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!logRow) return res.status(404).json({ error: "No pending Elijah Protocol response found" });

  await db
    .from("p2p_pastoral_care_log")
    .update({ user_response: decision, responded_at: new Date().toISOString() })
    .eq("id", logRow.id);

  if (decision === "taking_break") {
    await db
      .from("p2p_profiles")
      .update({ elijah_rest_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() })
      .eq("id", userId);
  } else if (decision === "needs_support") {
    const peerGuideId = await getActivePeerGuideId(userId);
    if (peerGuideId) {
      const { data: profile } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
      const name = (profile as Record<string, unknown> | null)?.full_name ?? "A disciple";
      await db.from("p2p_notifications").insert({
        user_id: peerGuideId,
        title: "Please check in",
        message: `${name} has been quiet for 21 days and reached out. Please check in with them personally.`,
        notification_type: "pastoral_alert",
        data: { discipleId: userId, discipleName: name },
      });
      await db
        .from("p2p_pastoral_care_log")
        .update({ peer_guide_notified: true, peer_guide_notified_at: new Date().toISOString(), peer_guide_id: peerGuideId })
        .eq("id", logRow.id);
    }
  }
  // "restarting" needs no further server-side action — the client navigates
  // the user straight to their current lesson.

  return res.json({ ok: true, decision });
});

// GET /pastoral-care/guide-alerts/:peerGuideId — pending "please check in"
// alerts for this peer guide that haven't had a call outcome logged yet.
// Covers both the passive 21-day peer_guide_alert tier and the Elijah
// Protocol's needs_support tier — same underlying log table.
router.get("/guide-alerts/:peerGuideId", async (req, res) => {
  const { peerGuideId } = req.params;
  const { data, error } = await db
    .from("p2p_pastoral_care_log")
    .select("id, user_id, care_type, message_sent, peer_guide_notified_at")
    .eq("peer_guide_id", peerGuideId)
    .eq("peer_guide_notified", true)
    .is("call_outcome", null)
    .order("peer_guide_notified_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const discipleIds = Array.from(new Set((data ?? []).map((r) => r.user_id as string)));
  const { data: profiles } = discipleIds.length
    ? await db.from("p2p_profiles").select("id,full_name").in("id", discipleIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return res.json((data ?? []).map((r) => ({
    id: r.id,
    discipleId: r.user_id,
    discipleName: nameById.get(r.user_id as string) ?? "A disciple",
    careType: r.care_type,
    messageSent: r.message_sent,
    notifiedAt: r.peer_guide_notified_at,
  })));
});

// POST /pastoral-care/call-outcome — the peer guide's 3-option outcome after
// calling their disciple from the alert.
router.post("/call-outcome", async (req, res) => {
  const { logId, outcome } = req.body as { logId?: string; outcome?: string };
  if (!logId || !outcome || !["reached_them", "left_message", "no_answer"].includes(outcome)) {
    return res.status(400).json({ error: "logId and a valid outcome are required" });
  }
  const { error } = await db
    .from("p2p_pastoral_care_log")
    .update({ call_outcome: outcome, call_outcome_at: new Date().toISOString() })
    .eq("id", logId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true });
});

export default router;