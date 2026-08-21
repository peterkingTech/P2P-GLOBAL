import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Admin → User official messages ("P2P Global" proactively contacting a
// user via Compose — account notices, safeguarding, moderation, support
// follow-ups). Deliberately separate from Contact P2P Global (peer →
// department, see contact.ts): this reuses the existing
// p2p_conversations/p2p_messages system and the official-account
// infrastructure already built in migration 068 (is_official_account,
// official_account_type, official_account_label + the
// p2p_stamp_official_response trigger and every mobile-side OfficialBadge/
// "Official Response" rendering already wired to it), plus the subject/
// department/sent_by_admin_id columns added in migration 076 — no second
// messaging system, no new tables.
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

// Compose's user-facing category — distinct from Contact P2P Global's
// to_department (help_request/crisis_response/p2p_support/marketing) and
// from official_account_type (crisis_response/announcement/support/general,
// which controls which of the 4 seeded official-account rows actually sends
// the message and therefore which OfficialBadge/label the recipient sees).
// Compose only exposes department to the admin; the official identity is
// derived from it automatically rather than asked for separately, per spec
// ("FROM: P2P Global" — one identity, not a picker).
const DEPARTMENTS = [
  "support_help", "crisis_safeguarding", "account_security",
  "report_user", "feedback_suggestions", "general_contact",
] as const;
type Department = (typeof DEPARTMENTS)[number];

const OFFICIAL_TYPES = ["crisis_response", "announcement", "support", "general"] as const;
type OfficialType = (typeof OFFICIAL_TYPES)[number];

const DEPARTMENT_TO_OFFICIAL_TYPE: Record<Department, OfficialType> = {
  support_help: "support",
  crisis_safeguarding: "crisis_response",
  account_security: "general",
  report_user: "general",
  feedback_suggestions: "announcement",
  general_contact: "general",
};

// Same real admin role set Contact P2P Global uses — Compose access isn't
// department-scoped the way Contact P2P Global replies are (any authorized
// admin may pick any of the 6 Compose departments), it's a flat yes/no.
function canCompose(role: string): boolean {
  return role === "super_admin" || role === "admin_help" || role === "admin_marketing";
}

// GET /official-messages/allowed-types?requesterId= — kept for the earlier
// send-official-message flow (choosing a specific official identity
// directly); Compose itself derives the identity from department instead.
function typesForRole(role: string): OfficialType[] {
  if (role === "super_admin") return [...OFFICIAL_TYPES];
  if (role === "admin_help") return ["support", "crisis_response"];
  if (role === "admin_marketing") return ["announcement"];
  return [];
}
router.get("/official-messages/allowed-types", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  const types = typesForRole((data?.role as string) ?? "");
  if (!types.length) return err(res, "Admin access required", 403);
  return ok(res, types);
});

// GET /official-messages/search-users?requesterId=&q= — Compose's TO
// selector. Deliberately a separate, admin-only search from
// /profiles/search: matches email too (safe here since only a verified
// admin ever sees the results) and doesn't filter out private profiles
// (an admin needs to be able to reach any registered user, not just
// publicly-discoverable ones).
router.get("/official-messages/search-users", async (req, res) => {
  const { requesterId, q } = req.query as { requesterId?: string; q?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);
  if (!q || q.trim().length < 2) return ok(res, []);

  const query = q.trim().replace(/^@/, "");
  const { data, error } = await db
    .from("p2p_profiles")
    .select("id, username, full_name, photo_url, email")
    .or(`username.ilike.%${query}%,full_name.ilike.%${query}%,email.ilike.%${query}%`)
    .eq("is_official_account", false)
    .limit(10);
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((u) => ({
    userId: u.id, username: u.username, fullName: u.full_name ?? null, photoUrl: u.photo_url ?? null, email: u.email ?? null,
  })));
});

// Same dedupe rule as p2p_start_direct_conversation, replicated here rather
// than calling that RPC — it reads auth.uid() from a real session, and this
// route (like every other route in this codebase) has no per-request
// Supabase session, only a caller-supplied requesterId. Read-only: used both
// by the create path below and by the thread-lookup endpoint (which must
// never create a conversation just because an admin opened a read view).
async function findOfficialConversation(officialAccountId: string, targetUserId: string): Promise<string | null> {
  const { data: existingMemberRows } = await db
    .from("p2p_conversation_members").select("conversation_id").eq("user_id", officialAccountId);
  const officialConvIds = (existingMemberRows ?? []).map((r) => r.conversation_id as string);
  if (!officialConvIds.length) return null;
  const { data: targetMemberRows } = await db
    .from("p2p_conversation_members").select("conversation_id")
    .eq("user_id", targetUserId).in("conversation_id", officialConvIds);
  return (targetMemberRows?.[0]?.conversation_id as string | undefined) ?? null;
}

async function findOrCreateOfficialConversation(officialAccountId: string, targetUserId: string): Promise<string> {
  const existing = await findOfficialConversation(officialAccountId, targetUserId);
  if (existing) return existing;

  // conversation_type = 'support' (an already-defined, previously-unused
  // CHECK value) distinguishes this from plain peer 'direct' DMs without
  // colliding with 'help_request'/'crisis_response'/'pastoral' semantics
  // used elsewhere.
  const { data: newConv, error: convErr } = await db
    .from("p2p_conversations").insert({ type: "direct", conversation_type: "support" }).select("id").single();
  if (convErr || !newConv) throw new Error(convErr?.message ?? "Failed to start conversation");
  const conversationId = newConv.id as string;
  const { error: membersErr } = await db.from("p2p_conversation_members").insert([
    { conversation_id: conversationId, user_id: officialAccountId },
    { conversation_id: conversationId, user_id: targetUserId },
  ]);
  if (membersErr) throw new Error(membersErr.message);
  return conversationId;
}

// POST /official-messages/send — { requesterId, targetUserId, department, subject, body }
// Compose's endpoint: sender identity is always derived from department
// (never chosen directly by the admin — "the admin must NOT be able to
// impersonate another user" and always sends "from the official P2P Global
// identity").
router.post("/official-messages/send", async (req, res) => {
  const { requesterId, targetUserId, department, subject, body, draftId } = req.body as {
    requesterId?: string; targetUserId?: string; department?: string; subject?: string; body?: string; draftId?: string;
  };
  if (!requesterId || !targetUserId || !department) {
    return err(res, "requesterId, targetUserId, and department are required", 400);
  }
  if (!DEPARTMENTS.includes(department as Department)) return err(res, "Invalid department", 400);
  const trimmedSubject = subject?.trim() ?? "";
  if (trimmedSubject.length < 3 || trimmedSubject.length > 200) return err(res, "Subject must be between 3 and 200 characters", 400);
  const trimmedBody = body?.trim() ?? "";
  if (trimmedBody.length < 5 || trimmedBody.length > 2000) return err(res, "Message must be between 5 and 2,000 characters", 400);

  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const { data: target } = await db.from("p2p_profiles").select("id").eq("id", targetUserId).maybeSingle();
  if (!target) return err(res, "Target user not found", 404);

  const officialType = DEPARTMENT_TO_OFFICIAL_TYPE[department as Department];
  const { data: officialAccount } = await db
    .from("p2p_profiles").select("id, official_account_label")
    .eq("is_official_account", true).eq("official_account_type", officialType).maybeSingle();
  if (!officialAccount) return err(res, "Official account not configured", 500);

  let conversationId: string;
  try {
    conversationId = await findOrCreateOfficialConversation(officialAccount.id as string, targetUserId);
  } catch (e) {
    return err(res, e instanceof Error ? e.message : "Failed to start conversation", 500);
  }

  const { data: message, error: msgErr } = await db
    .from("p2p_messages")
    .insert({
      conversation_id: conversationId, sender_id: officialAccount.id, body: trimmedBody,
      subject: trimmedSubject, department, sent_by_admin_id: requesterId,
    })
    .select("id, created_at").single();
  if (msgErr || !message) return err(res, msgErr?.message ?? "Failed to send message", 500);

  // A message sent successfully from a draft retires that draft — best
  // effort, a failure here shouldn't undo an already-sent message.
  if (draftId) {
    await db.from("p2p_official_mail_drafts").delete().eq("id", draftId).eq("admin_id", requesterId);
  }

  await db.from("p2p_notifications").insert({
    user_id: targetUserId,
    title: trimmedSubject,
    message: trimmedBody.slice(0, 120),
    notification_type: "official_message_received",
    data: { conversationId, messageId: message.id, department },
  });

  return res.status(201).json({ conversationId, messageId: message.id, sentAt: message.created_at });
});

// GET /official-messages/thread-with-user?requesterId=&targetUserId=&officialType=
// Read-only lookup backing the Help Requests "Mail" screen (and reusable for
// any admin surface that needs to read/reply to an existing official-account
// thread with a specific peer). Admins are never members of these
// conversations (only the synthetic official account + the peer are), so
// there's no other way for an admin to read one — never creates a
// conversation, unlike /official-messages/send.
router.get("/official-messages/thread-with-user", async (req, res) => {
  const { requesterId, targetUserId, officialType } = req.query as {
    requesterId?: string; targetUserId?: string; officialType?: string;
  };
  if (!requesterId || !targetUserId || !officialType) {
    return err(res, "requesterId, targetUserId, and officialType are required", 400);
  }
  if (!OFFICIAL_TYPES.includes(officialType as OfficialType)) return err(res, "Invalid officialType", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const { data: officialAccount } = await db
    .from("p2p_profiles").select("id")
    .eq("is_official_account", true).eq("official_account_type", officialType).maybeSingle();
  if (!officialAccount) return err(res, "Official account not configured", 500);

  const conversationId = await findOfficialConversation(officialAccount.id as string, targetUserId);
  if (!conversationId) return ok(res, { conversationId: null, subject: null, department: null, messages: [] });

  const { data: rows, error } = await db
    .from("p2p_messages")
    .select("id, sender_id, body, created_at, subject, department, sent_by_admin_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) return err(res, error.message, 500);

  const adminIds = Array.from(new Set((rows ?? []).map((r) => r.sent_by_admin_id as string).filter(Boolean)));
  const { data: adminProfiles } = adminIds.length
    ? await db.from("p2p_profiles").select("id, username").in("id", adminIds)
    : { data: [] as { id: string; username: string }[] };
  const adminUsernameById = new Map((adminProfiles ?? []).map((a) => [a.id as string, a.username as string]));

  const subjectRow = (rows ?? []).find((r) => r.subject);
  const departmentRow = (rows ?? []).find((r) => r.department);

  return ok(res, {
    conversationId,
    subject: subjectRow?.subject ?? null,
    department: departmentRow?.department ?? null,
    messages: (rows ?? []).map((r) => ({
      id: r.id,
      isFromOfficial: r.sender_id === officialAccount.id,
      body: r.body,
      createdAt: r.created_at,
      sentByAdminUsername: r.sent_by_admin_id ? (adminUsernameById.get(r.sent_by_admin_id as string) ?? null) : null,
    })),
  });
});

// GET /official-messages/sent?requesterId= — every Compose message any
// authorized admin has sent (shared visibility, same "any admin in scope
// sees the full inbox" model Contact P2P Global's admin inbox already
// uses) — recipient, department, subject, preview, date, read status.
router.get("/official-messages/sent", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const { data: rows, error } = await db
    .from("p2p_messages")
    .select("id, conversation_id, subject, department, body, created_at, sent_by_admin_id")
    .not("subject", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return err(res, error.message, 500);
  if (!rows?.length) return ok(res, []);

  const conversationIds = Array.from(new Set(rows.map((r) => r.conversation_id as string)));
  const { data: memberRows } = await db
    .from("p2p_conversation_members").select("conversation_id, user_id, last_read_at")
    .in("conversation_id", conversationIds);

  const { data: officialAccountRows } = await db
    .from("p2p_profiles").select("id").eq("is_official_account", true);
  const officialIds = new Set((officialAccountRows ?? []).map((a) => a.id as string));

  const recipientByConv = new Map<string, { userId: string; lastReadAt: string | null }>();
  for (const m of memberRows ?? []) {
    if (!officialIds.has(m.user_id as string)) {
      recipientByConv.set(m.conversation_id as string, { userId: m.user_id as string, lastReadAt: m.last_read_at as string | null });
    }
  }

  const recipientIds = Array.from(new Set(Array.from(recipientByConv.values()).map((r) => r.userId)));
  const { data: recipientProfiles } = recipientIds.length
    ? await db.from("p2p_profiles").select("id, username, full_name").in("id", recipientIds)
    : { data: [] as { id: string; username: string; full_name: string }[] };
  const profileById = new Map((recipientProfiles ?? []).map((p) => [p.id as string, p]));

  const adminIds = Array.from(new Set(rows.map((r) => r.sent_by_admin_id as string).filter(Boolean)));
  const { data: adminProfiles } = adminIds.length
    ? await db.from("p2p_profiles").select("id, username").in("id", adminIds)
    : { data: [] as { id: string; username: string }[] };
  const adminUsernameById = new Map((adminProfiles ?? []).map((a) => [a.id as string, a.username as string]));

  return ok(res, rows.map((r) => {
    const recipient = recipientByConv.get(r.conversation_id as string);
    const recipientProfile = recipient ? profileById.get(recipient.userId) : undefined;
    const isRead = !!(recipient?.lastReadAt && new Date(recipient.lastReadAt) >= new Date(r.created_at as string));
    return {
      id: r.id, conversationId: r.conversation_id, subject: r.subject, department: r.department,
      bodyPreview: (r.body as string).slice(0, 140), createdAt: r.created_at,
      sentByAdminUsername: r.sent_by_admin_id ? (adminUsernameById.get(r.sent_by_admin_id as string) ?? null) : null,
      recipientUserId: recipient?.userId ?? null,
      recipientUsername: recipientProfile?.username ?? null,
      recipientFullName: recipientProfile?.full_name ?? null,
      isRead,
    };
  }));
});

// ── Drafts — private to the admin who wrote them (migration 080) ──────────

// GET /official-messages/drafts?requesterId=
router.get("/official-messages/drafts", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const { data, error } = await db
    .from("p2p_official_mail_drafts")
    .select("*")
    .eq("admin_id", requesterId)
    .order("updated_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  return ok(res, (data ?? []).map((d) => ({
    id: d.id, targetUserId: d.target_user_id ?? null, targetUsername: d.target_username_cache ?? null,
    department: d.department ?? null, subject: d.subject ?? "", body: d.body ?? "",
    createdAt: d.created_at, updatedAt: d.updated_at,
  })));
});

// POST /official-messages/drafts — { requesterId, draftId?, targetUserId?, targetUsername?, department?, subject?, body? }
// Upsert: omit draftId to create, include it to update (only that admin's
// own draft — verified by the .eq("admin_id", ...) below rather than
// trusting the draftId alone).
router.post("/official-messages/drafts", async (req, res) => {
  const { requesterId, draftId, targetUserId, targetUsername, department, subject, body } = req.body as {
    requesterId?: string; draftId?: string; targetUserId?: string; targetUsername?: string;
    department?: string; subject?: string; body?: string;
  };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const payload = {
    admin_id: requesterId, target_user_id: targetUserId ?? null, target_username_cache: targetUsername ?? null,
    department: department ?? null, subject: subject ?? null, body: body ?? null, updated_at: new Date().toISOString(),
  };

  if (draftId) {
    const { data, error } = await db
      .from("p2p_official_mail_drafts").update(payload).eq("id", draftId).eq("admin_id", requesterId)
      .select("id").maybeSingle();
    if (error) return err(res, error.message, 500);
    if (!data) return err(res, "Draft not found", 404);
    return ok(res, { id: data.id });
  }

  const { data, error } = await db.from("p2p_official_mail_drafts").insert(payload).select("id").single();
  if (error || !data) return err(res, error?.message ?? "Failed to save draft", 500);
  return res.status(201).json({ id: data.id });
});

// DELETE /official-messages/drafts/:draftId — body { requesterId }
router.delete("/official-messages/drafts/:draftId", async (req, res) => {
  const { draftId } = req.params;
  const { requesterId } = req.body as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: requester } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (!canCompose((requester?.role as string) ?? "")) return err(res, "Admin access required", 403);

  const { error } = await db.from("p2p_official_mail_drafts").delete().eq("id", draftId).eq("admin_id", requesterId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

export default router;