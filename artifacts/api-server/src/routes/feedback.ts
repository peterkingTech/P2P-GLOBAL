import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Same RLS-workaround service-role client used throughout this codebase
// (see calls.ts, notifications.ts, breakRooms.ts) — this router has no
// requireAuth/requireAdmin middleware since it's called by regular peer
// users (submitting feedback on an admin interaction), not admins.
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

// POST /feedback/admin-interaction — peer submits feedback on an admin's
// response to their help request / crisis thread. Direct-inserts through the
// service role rather than relying on the client-side RLS insert policy
// (migration 068 grants it, but the flag-and-notify step below needs the
// service role regardless, so one consistent code path is simpler).
router.post("/admin-interaction", async (req, res) => {
  const {
    conversationId, helpRequestId, adminUserId, peerUserId,
    rating, wasTimely, wasRespectful, wasHelpful, wasRude, didNotAddressConcern, freeText,
  } = req.body as {
    conversationId?: string; helpRequestId?: string | null; adminUserId?: string; peerUserId?: string;
    rating?: number; wasTimely?: boolean; wasRespectful?: boolean; wasHelpful?: boolean;
    wasRude?: boolean; didNotAddressConcern?: boolean; freeText?: string;
  };
  if (!conversationId || !adminUserId || !peerUserId) {
    return err(res, "conversationId, adminUserId, and peerUserId are required");
  }

  const flagged = wasRude === true;
  const { data: feedback, error: insErr } = await db
    .from("p2p_admin_interaction_feedback")
    .insert({
      conversation_id: conversationId, help_request_id: helpRequestId ?? null,
      admin_user_id: adminUserId, peer_user_id: peerUserId,
      rating: rating ?? null, was_timely: wasTimely ?? null, was_respectful: wasRespectful ?? null,
      was_helpful: wasHelpful ?? null, was_rude: wasRude ?? null, did_not_address_concern: didNotAddressConcern ?? null,
      free_text: freeText?.trim() || null, flagged_for_review: flagged,
    })
    .select("id")
    .single();
  if (insErr || !feedback) return err(res, insErr?.message ?? "Failed to submit feedback", 500);

  await db.from("p2p_conversations").update({ feedback_submitted: true }).eq("id", conversationId);

  if (flagged) {
    const { data: superAdmins } = await db.from("p2p_profiles").select("id").eq("role", "super_admin");
    if (superAdmins?.length) {
      await db.from("p2p_notifications").insert(
        superAdmins.map((a) => ({
          user_id: a.id,
          title: "Feedback flagged for review",
          message: "A peer marked an admin's response as rude or dismissive. Please review.",
          notification_type: "admin_feedback_flagged",
          data: { feedbackId: feedback.id, adminUserId, conversationId },
        }))
      );
    }
  }

  return ok(res, { ok: true, flagged });
});

// POST /feedback/request — admin resolving a help request/crisis thread
// triggers this to ask the peer for feedback. Notification-only (the actual
// submission screen reads conversation_id off the notification's data).
router.post("/request", async (req, res) => {
  const { conversationId, peerUserId } = req.body as { conversationId?: string; peerUserId?: string };
  if (!conversationId || !peerUserId) return err(res, "conversationId and peerUserId are required");

  await db.from("p2p_conversations").update({ feedback_requested: true }).eq("id", conversationId);
  await db.from("p2p_notifications").insert({
    user_id: peerUserId,
    title: "How was your support experience?",
    message: "Tap to share feedback on the support you received.",
    notification_type: "feedback_request",
    data: { type: "feedback_request", conversation_id: conversationId },
  });

  return ok(res, { ok: true });
});

export default router;