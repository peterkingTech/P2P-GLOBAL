import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Admin → User official messages ("P2P Global" proactively contacting a
// user — account notices, community announcements, safeguarding, moderation
// warnings, support follow-ups). Deliberately separate from Contact P2P
// Global (peer → department, see contact.ts): this reuses the existing
// p2p_conversations/p2p_messages system and the official-account
// infrastructure already built in migration 068 (is_official_account,
// official_account_type, official_account_label + the
// p2p_stamp_official_response trigger and every mobile-side OfficialBadge/
// "Official Response" rendering already wired to it) rather than inventing
// a second messaging system, per the "reuse existing infrastructure, don't
// duplicate" instruction this feature was built under.
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

const OFFICIAL_TYPES = ["crisis_response", "announcement", "support", "general"] as const;
type OfficialType = (typeof OFFICIAL_TYPES)[number];

// Mirrors contact.ts's departmentsForRole mapping, applied to official
// account identities instead of contact departments — same real role set,
// same reasoning (admin_supervisor has no defined stake here either).
function typesForRole(role: string): OfficialType[] {
  if (role === "super_admin") return [...OFFICIAL_TYPES];
  if (role === "admin_help") return ["support", "crisis_response"];
  if (role === "admin_marketing") return ["announcement"];
  return [];
}

// GET /official-messages/allowed-types?requesterId= — which official
// identities this admin may send as, for the compose screen's picker.
router.get("/official-messages/allowed-types", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  const types = typesForRole((data?.role as string) ?? "");
  if (!types.length) return err(res, "Admin access required", 403);
  return ok(res, types);
});

// POST /official-messages/send — { requesterId, targetUserId, officialAccountType, subject?, body }
// Finds/creates the 1:1 conversation between the official account and the
// target user (replicated here rather than calling the p2p_start_direct_conversation
// RPC, since that function reads auth.uid() from a real session — this route,
// like every other route in this codebase, has no per-request Supabase
// session, only a caller-supplied requesterId), then inserts the message as
// sent by the official account. conversation_type is set to 'support' (an
// already-defined, currently-unused value in the CHECK constraint) so it's
// distinguishable from plain peer 'direct' DMs without colliding with
// 'help_request' (p2p_help_requests-specific) or 'crisis_response'/'pastoral'
// (crisis-call-specific) semantics used elsewhere.
router.post("/official-messages/send", async (req, res) => {
  const { requesterId, targetUserId, officialAccountType, subject, body } = req.body as {
    requesterId?: string; targetUserId?: string; officialAccountType?: string; subject?: string; body?: string;
  };
  if (!requesterId || !targetUserId || !officialAccountType) {
    return err(res, "requesterId, targetUserId, and officialAccountType are required", 400);
  }
  if (!OFFICIAL_TYPES.includes(officialAccountType as OfficialType)) return err(res, "Invalid officialAccountType", 400);
  const trimmedBody = body?.trim() ?? "";
  if (trimmedBody.length < 5 || trimmedBody.length > 4000) return err(res, "Message must be between 5 and 4000 characters", 400);

  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  const allowedTypes = typesForRole((requester?.role as string) ?? "");
  if (!allowedTypes.includes(officialAccountType as OfficialType)) return err(res, "Admin access required", 403);

  const { data: target } = await db.from("p2p_profiles").select("id, full_name").eq("id", targetUserId).maybeSingle();
  if (!target) return err(res, "Target user not found", 404);

  const { data: officialAccount } = await db
    .from("p2p_profiles").select("id, official_account_label")
    .eq("is_official_account", true).eq("official_account_type", officialAccountType).maybeSingle();
  if (!officialAccount) return err(res, "Official account not configured for this identity", 500);

  // Reuse an existing DM between the official account and this user if one
  // already exists, same dedupe rule as p2p_start_direct_conversation.
  const { data: existingMemberRows } = await db
    .from("p2p_conversation_members").select("conversation_id").eq("user_id", officialAccount.id);
  const officialConvIds = (existingMemberRows ?? []).map((r) => r.conversation_id as string);
  let conversationId: string | null = null;
  if (officialConvIds.length) {
    const { data: targetMemberRows } = await db
      .from("p2p_conversation_members").select("conversation_id")
      .eq("user_id", targetUserId).in("conversation_id", officialConvIds);
    conversationId = (targetMemberRows?.[0]?.conversation_id as string) ?? null;
  }

  if (!conversationId) {
    const { data: newConv, error: convErr } = await db
      .from("p2p_conversations").insert({ type: "direct", conversation_type: "support" }).select("id").single();
    if (convErr || !newConv) return err(res, convErr?.message ?? "Failed to start conversation", 500);
    conversationId = newConv.id as string;
    const { error: membersErr } = await db.from("p2p_conversation_members").insert([
      { conversation_id: conversationId, user_id: officialAccount.id },
      { conversation_id: conversationId, user_id: targetUserId },
    ]);
    if (membersErr) return err(res, membersErr.message, 500);
  }

  const messageBody = subject?.trim() ? `${subject.trim()}\n\n${trimmedBody}` : trimmedBody;
  const { data: message, error: msgErr } = await db
    .from("p2p_messages")
    .insert({ conversation_id: conversationId, sender_id: officialAccount.id, body: messageBody })
    .select("id, created_at").single();
  if (msgErr || !message) return err(res, msgErr?.message ?? "Failed to send message", 500);

  await db.from("p2p_notifications").insert({
    user_id: targetUserId,
    title: officialAccount.official_account_label ?? "Message from P2P Global",
    message: subject?.trim() || trimmedBody.slice(0, 120),
    notification_type: "official_message_received",
    data: { conversationId, messageId: message.id },
  });

  return res.status(201).json({ conversationId, messageId: message.id, sentAt: message.created_at });
});

export default router;