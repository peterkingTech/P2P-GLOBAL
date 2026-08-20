import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Same trust model as churches.ts/discipleship.ts/connections.ts — no
// requireAuth/requireAdmin middleware; every endpoint takes a caller-supplied
// requesterId and authorizes inline against p2p_profiles.role, using the
// service-role client for all real reads/writes (RLS is the backstop).
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

const DEPARTMENTS = ["help_request", "crisis_response", "p2p_support", "marketing"] as const;
type Department = (typeof DEPARTMENTS)[number];
const ESTIMATED_RESPONSE: Record<Department, string> = {
  help_request: "within 24 to 48 hours",
  crisis_response: "as soon as possible — usually within a few hours",
  p2p_support: "within 24 to 48 hours",
  marketing: "within 3 to 5 business days",
};

// The real admin role set only has one "help"-flavored role and one
// "marketing"-flavored role (confirmed against admin/_layout.tsx's
// ADMIN_ROLES this session) — three of the four departments share admin_help.
function departmentsForRole(role: string): Department[] {
  if (role === "super_admin") return [...DEPARTMENTS];
  if (role === "admin_help") return ["help_request", "crisis_response", "p2p_support"];
  if (role === "admin_marketing") return ["marketing"];
  return [];
}
function canManageDepartment(role: string, department: string): boolean {
  return departmentsForRole(role).includes(department as Department);
}

async function getAdminAccess(requesterId: string): Promise<{ role: string; departments: Department[] } | null> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  const role = (data?.role as string) ?? "";
  const departments = departmentsForRole(role);
  if (!departments.length) return null;
  return { role, departments };
}

const IN_CHUNK_SIZE = 100;
function chunk<T>(items: T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
async function selectInChunks<T = Record<string, unknown>>(table: string, columns: string, column: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return [];
  const results: T[] = [];
  for (const c of chunk(ids)) {
    const { data, error } = await db.from(table).select(columns).in(column, c);
    if (error) throw new Error(`${table}.${column} IN chunk failed: ${error.message}`);
    results.push(...((data ?? []) as T[]));
  }
  return results;
}

// Duplicated from constants/stages.ts (mobile) — separate packages, same
// reasoning as churches.ts's STAGE_THRESHOLDS duplication.
const STAGE_THRESHOLDS = [
  { key: "dormant_seed", unlockPoints: 0 },
  { key: "sprout", unlockPoints: 4 },
  { key: "young_tree", unlockPoints: 12 },
  { key: "fruitful_tree", unlockPoints: 28 },
  { key: "forest_builder", unlockPoints: 60 },
  { key: "forest_of_nations", unlockPoints: 110 },
];
function stageKeyForPoints(points: number): string {
  let key = STAGE_THRESHOLDS[0].key;
  for (const s of STAGE_THRESHOLDS) if (points >= s.unlockPoints) key = s.key;
  return key;
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: row.id, referenceNumber: row.reference_number, fromUserId: row.from_user_id,
    toDepartment: row.to_department, subject: row.subject, body: row.body,
    attachmentUrl: row.attachment_url ?? null, attachmentType: row.attachment_type ?? null,
    status: row.status, priority: row.priority, assignedTo: row.assigned_to ?? null,
    forwardedFrom: row.forwarded_from ?? null, forwardedNote: row.forwarded_note ?? null,
    originalDepartment: row.original_department ?? null,
    feedbackRequested: row.feedback_requested ?? false, feedbackSubmitted: row.feedback_submitted ?? false,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function mapReply(row: Record<string, unknown>, adminUsername?: string | null) {
  return {
    id: row.id, messageId: row.message_id, fromAdminId: row.from_admin_id, fromAdminUsername: adminUsername ?? null,
    fromDepartment: row.from_department, body: row.body, isInternalNote: row.is_internal_note ?? false,
    createdAt: row.created_at,
  };
}
function mapNote(row: Record<string, unknown>, adminUsername?: string | null) {
  return { id: row.id, messageId: row.message_id, adminId: row.admin_id, adminUsername: adminUsername ?? null, noteText: row.note_text, createdAt: row.created_at };
}

async function notifyDepartmentAdmins(department: Department, title: string, message: string, data: Record<string, unknown>) {
  const { data: admins } = await db.from("p2p_profiles").select("id, role");
  const recipients = (admins ?? []).filter((a) => canManageDepartment(a.role as string, department));
  if (!recipients.length) return;
  await db.from("p2p_notifications").insert(
    recipients.map((a) => ({ user_id: a.id, title, message, notification_type: "contact_message_received", data }))
  );
}

// ── Peer-facing ───────────────────────────────────────────────────────────────

// POST /contact/send — { requesterId, to_department, subject, body, attachment_url?, attachment_type? }
router.post("/contact/send", async (req, res) => {
  const { requesterId, to_department, subject, body, attachment_url, attachment_type } = req.body as {
    requesterId?: string; to_department?: string; subject?: string; body?: string;
    attachment_url?: string; attachment_type?: string;
  };
  if (!requesterId) return err(res, "requesterId is required", 400);
  if (!to_department || !DEPARTMENTS.includes(to_department as Department)) {
    return err(res, `to_department must be one of: ${DEPARTMENTS.join(", ")}`, 400);
  }
  const trimmedSubject = subject?.trim() ?? "";
  const trimmedBody = body?.trim() ?? "";
  if (trimmedSubject.length < 5 || trimmedSubject.length > 200) return err(res, "Subject must be between 5 and 200 characters", 400);
  if (trimmedBody.length < 20 || trimmedBody.length > 2000) return err(res, "Message must be between 20 and 2000 characters", 400);
  if (attachment_type && !["image", "pdf"].includes(attachment_type)) return err(res, "Invalid attachment type", 400);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("p2p_contact_messages").select("id", { count: "exact", head: true })
    .eq("from_user_id", requesterId).gt("created_at", dayAgo);
  if ((count ?? 0) >= 5) return err(res, "You've reached the limit of 5 messages per 24 hours. Please try again later.", 429);

  const priority = to_department === "crisis_response" ? "high" : "normal";
  const { data, error } = await db.from("p2p_contact_messages").insert({
    from_user_id: requesterId, to_department, subject: trimmedSubject, body: trimmedBody,
    attachment_url: attachment_url || null, attachment_type: attachment_type || null, priority,
  }).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to send message", 500);

  const deptLabel = to_department.replace(/_/g, " ");
  await notifyDepartmentAdmins(to_department as Department, `New message: ${trimmedSubject}`, `A new ${deptLabel} message needs review.`, {
    messageId: data.id, referenceNumber: data.reference_number,
  });

  return res.status(201).json({
    success: true, referenceNumber: data.reference_number,
    estimatedResponse: ESTIMATED_RESPONSE[to_department as Department],
  });
});

// GET /contact/my-messages?requesterId=
router.get("/contact/my-messages", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);

  const { data, error } = await db.from("p2p_contact_messages").select("*").eq("from_user_id", requesterId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  const messageIds = (data ?? []).map((m) => m.id as string);
  const replies = messageIds.length
    ? await selectInChunks<{ message_id: string; created_at: string }>("p2p_contact_replies", "message_id,created_at", "message_id", messageIds)
    : [];
  const replyCountByMessage = new Map<string, number>();
  const latestReplyByMessage = new Map<string, string>();
  for (const r of replies) {
    replyCountByMessage.set(r.message_id, (replyCountByMessage.get(r.message_id) ?? 0) + 1);
    const cur = latestReplyByMessage.get(r.message_id);
    if (!cur || r.created_at > cur) latestReplyByMessage.set(r.message_id, r.created_at);
  }

  return ok(res, (data ?? []).map((m) => ({
    ...mapMessage(m as Record<string, unknown>),
    bodyPreview: (m.body as string).slice(0, 100),
    replyCount: replyCountByMessage.get(m.id as string) ?? 0,
    latestReplyAt: latestReplyByMessage.get(m.id as string) ?? null,
  })));
});

// GET /contact/my-messages/:messageId?requesterId=
router.get("/contact/my-messages/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);

  const { data: message } = await db.from("p2p_contact_messages").select("*").eq("id", messageId).eq("from_user_id", requesterId).maybeSingle();
  if (!message) return err(res, "Message not found", 404);

  const { data: replies } = await db.from("p2p_contact_replies").select("*").eq("message_id", messageId).eq("is_internal_note", false).order("created_at", { ascending: true });
  return ok(res, { message: mapMessage(message as Record<string, unknown>), replies: (replies ?? []).map((r) => mapReply(r as Record<string, unknown>)) });
});

// ── Admin-facing ──────────────────────────────────────────────────────────────

// GET /contact/admin/inbox?requesterId=&status=&priority=&search=&includeAll=
router.get("/contact/admin/inbox", async (req, res) => {
  const { requesterId, status, priority, search } = req.query as { requesterId?: string; status?: string; priority?: string; search?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  let query = db.from("p2p_contact_messages").select("*").in("to_department", access.departments);
  if (status) query = query.eq("status", status);
  if (priority) query = query.eq("priority", priority);
  const { data, error } = await query.order("priority", { ascending: false }).order("created_at", { ascending: true });
  if (error) return err(res, error.message, 500);

  let rows = data ?? [];
  const senderIds = [...new Set(rows.map((r) => r.from_user_id as string))];
  const senders = senderIds.length
    ? await selectInChunks<Record<string, unknown>>(
        "p2p_profiles", "id,username,full_name,photo_url,country,ministry_role,growth_level,is_verified,created_at", "id", senderIds
      )
    : [];
  const senderById = new Map(senders.map((s) => [s.id as string, s]));

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    rows = rows.filter((r) => {
      const sender = senderById.get(r.from_user_id as string);
      return (
        (r.subject as string)?.toLowerCase().includes(q) ||
        (r.body as string)?.toLowerCase().includes(q) ||
        (r.reference_number as string)?.toLowerCase().includes(q) ||
        (sender?.username as string)?.toLowerCase().includes(q)
      );
    });
  }

  return ok(res, rows.map((r) => {
    const sender = senderById.get(r.from_user_id as string);
    const accountAgeDays = sender?.created_at ? Math.floor((Date.now() - new Date(sender.created_at as string).getTime()) / (1000 * 60 * 60 * 24)) : null;
    return {
      ...mapMessage(r as Record<string, unknown>),
      bodyPreview: (r.body as string).slice(0, 100),
      fromUsername: sender?.username ?? null, fromDisplayName: sender?.full_name ?? "A member",
      fromPhotoUrl: sender?.photo_url ?? null, fromCountry: sender?.country ?? null,
      fromMinistryRole: sender?.ministry_role ?? null,
      fromTreeStage: stageKeyForPoints((sender?.growth_level as number) ?? 0),
      fromIsVerified: sender?.is_verified ?? false, fromAccountAgeDays: accountAgeDays,
    };
  }));
});

// GET /contact/admin/inbox/:messageId?requesterId=
router.get("/contact/admin/inbox/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("*").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  if (message.status === "unread") {
    await db.from("p2p_contact_messages").update({ status: "read", updated_at: new Date().toISOString() }).eq("id", messageId);
    message.status = "read";
  }

  const [{ data: sender }, { data: replies }, { data: notes }, modulesCompletedTotal] = await Promise.all([
    db.from("p2p_profiles").select("id,username,full_name,photo_url,country,ministry_role,growth_level,is_verified,created_at").eq("id", message.from_user_id).maybeSingle(),
    db.from("p2p_contact_replies").select("*").eq("message_id", messageId).order("created_at", { ascending: true }),
    db.from("p2p_contact_notes").select("*").eq("message_id", messageId).order("created_at", { ascending: true }),
    getModulesCompletedForUser(message.from_user_id as string),
  ]);

  const adminIds = [...new Set([...(replies ?? []).map((r) => r.from_admin_id as string), ...(notes ?? []).map((n) => n.admin_id as string)])];
  const admins = adminIds.length ? await selectInChunks<{ id: string; username: string }>("p2p_profiles", "id,username", "id", adminIds) : [];
  const adminUsernameById = new Map(admins.map((a) => [a.id, a.username]));

  const accountAgeDays = sender?.created_at ? Math.floor((Date.now() - new Date(sender.created_at as string).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return ok(res, {
    message: {
      ...mapMessage(message as Record<string, unknown>),
      fromUsername: sender?.username ?? null, fromDisplayName: sender?.full_name ?? "A member",
      fromPhotoUrl: sender?.photo_url ?? null, fromCountry: sender?.country ?? null,
      fromMinistryRole: sender?.ministry_role ?? null,
      fromTreeStage: stageKeyForPoints((sender?.growth_level as number) ?? 0),
      fromIsVerified: sender?.is_verified ?? false, fromAccountAgeDays: accountAgeDays,
      fromModulesCompleted: modulesCompletedTotal,
    },
    replies: (replies ?? []).map((r) => mapReply(r as Record<string, unknown>, adminUsernameById.get(r.from_admin_id as string))),
    notes: (notes ?? []).map((n) => mapNote(n as Record<string, unknown>, adminUsernameById.get(n.admin_id as string))),
  });
});

// Modules-completed count for a single user, reusing the same "all lessons
// in a module are completed" definition churches.ts's grove endpoint uses.
async function getModulesCompletedForUser(userId: string): Promise<number> {
  const { data: progressRows } = await db.from("p2p_lesson_progress").select("lesson_id,completed").eq("user_id", userId).eq("completed", true);
  const completedLessonIds = [...new Set((progressRows ?? []).map((p) => p.lesson_id as string))];
  if (!completedLessonIds.length) return 0;
  const lessonRows = await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "id", completedLessonIds);
  const moduleIdByLesson = new Map(lessonRows.map((l) => [l.id, l.module_id]));
  const allModuleIds = [...new Set(lessonRows.map((l) => l.module_id))];
  const allLessonsByModule = allModuleIds.length ? await selectInChunks<{ module_id: string }>("p2p_lessons", "module_id", "module_id", allModuleIds) : [];
  const totalLessonsPerModule = new Map<string, number>();
  for (const l of allLessonsByModule) totalLessonsPerModule.set(l.module_id, (totalLessonsPerModule.get(l.module_id) ?? 0) + 1);
  const completedCountByModule = new Map<string, number>();
  for (const lessonId of completedLessonIds) {
    const moduleId = moduleIdByLesson.get(lessonId);
    if (!moduleId) continue;
    completedCountByModule.set(moduleId, (completedCountByModule.get(moduleId) ?? 0) + 1);
  }
  let total = 0;
  for (const [moduleId, done] of completedCountByModule) {
    if (done >= (totalLessonsPerModule.get(moduleId) ?? Infinity)) total++;
  }
  return total;
}

// POST /contact/admin/reply/:messageId — { requesterId, body, is_internal_note }
router.post("/contact/admin/reply/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId, body, is_internal_note } = req.body as { requesterId?: string; body?: string; is_internal_note?: boolean };
  if (!requesterId || !body?.trim()) return err(res, "requesterId and body are required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("id,to_department,from_user_id,subject,reference_number").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  if (is_internal_note === true) {
    const { data, error } = await db.from("p2p_contact_notes").insert({ message_id: messageId, admin_id: requesterId, note_text: body.trim() }).select("*").single();
    if (error || !data) return err(res, error?.message ?? "Failed to add note", 500);
    return res.status(201).json(mapNote(data as Record<string, unknown>));
  }

  const { data: reply, error } = await db.from("p2p_contact_replies").insert({
    message_id: messageId, from_admin_id: requesterId, from_department: message.to_department, body: body.trim(), is_internal_note: false,
  }).select("*").single();
  if (error || !reply) return err(res, error?.message ?? "Failed to send reply", 500);

  await db.from("p2p_contact_messages").update({ status: "replied", updated_at: new Date().toISOString() }).eq("id", messageId);

  const deptLabel = (message.to_department as string).replace(/_/g, " ");
  await db.from("p2p_notifications").insert({
    user_id: message.from_user_id, title: "You have a reply",
    message: `The ${deptLabel} team has replied to your message.`,
    notification_type: "contact_message_replied",
    data: { messageId, referenceNumber: message.reference_number },
  });

  return res.status(201).json(mapReply(reply as Record<string, unknown>));
});

// POST /contact/admin/forward/:messageId — { requesterId, to_department?, to_admin_id?, to_username?, note? }
router.post("/contact/admin/forward/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId, to_department, to_admin_id, to_username, note } = req.body as {
    requesterId?: string; to_department?: string; to_admin_id?: string; to_username?: string; note?: string;
  };
  if (!requesterId) return err(res, "requesterId is required", 400);
  if (!to_department && !to_admin_id && !to_username) return err(res, "to_department or to_admin_id/to_username is required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("id,to_department").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  let assignedTo: string | undefined;
  if (to_admin_id) assignedTo = to_admin_id;
  else if (to_username) {
    const { data: target } = await db.from("p2p_profiles").select("id").eq("username", to_username.trim().toLowerCase()).maybeSingle();
    if (!target) return err(res, "No admin found with that username", 404);
    assignedTo = target.id as string;
  }
  if (to_department && !DEPARTMENTS.includes(to_department as Department)) return err(res, "Invalid department", 400);

  const updates: Record<string, unknown> = {
    forwarded_from: requesterId, forwarded_note: note?.trim() || null,
    original_department: message.to_department, status: "forwarded", updated_at: new Date().toISOString(),
  };
  if (to_department) updates.to_department = to_department;
  if (assignedTo) updates.assigned_to = assignedTo;

  const { data, error } = await db.from("p2p_contact_messages").update(updates).eq("id", messageId).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to forward message", 500);
  // No peer notification — forwarding is silent to the sender, per design.
  return ok(res, mapMessage(data as Record<string, unknown>));
});

// PUT /contact/admin/close/:messageId — { requesterId }
router.put("/contact/admin/close/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId } = req.body as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("id,to_department,from_user_id,feedback_requested,reference_number").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  const updates: Record<string, unknown> = { status: "closed", updated_at: new Date().toISOString() };
  if (!message.feedback_requested) updates.feedback_requested = true;

  const { error } = await db.from("p2p_contact_messages").update(updates).eq("id", messageId);
  if (error) return err(res, error.message, 500);

  if (!message.feedback_requested) {
    await db.from("p2p_notifications").insert({
      user_id: message.from_user_id, title: "How was your support experience?",
      message: "Tap to share feedback on the support you received.",
      notification_type: "contact_feedback_request",
      data: { type: "contact_feedback_request", messageId, referenceNumber: message.reference_number },
    });
  }
  return ok(res, { ok: true });
});

// PUT /contact/admin/priority/:messageId — { requesterId, priority }
router.put("/contact/admin/priority/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId, priority } = req.body as { requesterId?: string; priority?: string };
  if (!requesterId || !priority) return err(res, "requesterId and priority are required", 400);
  if (!["normal", "high", "urgent"].includes(priority)) return err(res, "Invalid priority", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("id,to_department").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  const { error } = await db.from("p2p_contact_messages").update({ priority, updated_at: new Date().toISOString() }).eq("id", messageId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

const MESSAGE_STATUSES = ["unread", "read", "replied", "forwarded", "closed"] as const;

// PUT /contact/admin/status/:messageId — { requesterId, status }. General
// status setter — covers "mark as unread" (re-opening a read/replied message
// for follow-up) and any other manual status change an admin wants to make
// outside the automatic transitions reply/forward/close already perform.
router.put("/contact/admin/status/:messageId", async (req, res) => {
  const { messageId } = req.params;
  const { requesterId, status } = req.body as { requesterId?: string; status?: string };
  if (!requesterId || !status) return err(res, "requesterId and status are required", 400);
  if (!MESSAGE_STATUSES.includes(status as (typeof MESSAGE_STATUSES)[number])) return err(res, "Invalid status", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);

  const { data: message } = await db.from("p2p_contact_messages").select("id,to_department").eq("id", messageId).maybeSingle();
  if (!message || !access.departments.includes(message.to_department as Department)) return err(res, "Message not found", 404);

  const { error } = await db.from("p2p_contact_messages").update({ status, updated_at: new Date().toISOString() }).eq("id", messageId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

async function computeDeptStats(departments: Department[]) {
  const { data: rows } = await db.from("p2p_contact_messages").select("status,priority,created_at,updated_at").in("to_department", departments);
  const all = rows ?? [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const unread = all.filter((m) => m.status === "unread");
  const overdue = unread.filter((m) => (m.created_at as string) < dayAgo);
  const closedRows = all.filter((m) => m.status === "closed");
  const responseHours = closedRows
    .map((m) => (new Date(m.updated_at as string).getTime() - new Date(m.created_at as string).getTime()) / (1000 * 60 * 60))
    .filter((h) => h >= 0);
  const avgResponseHours = responseHours.length ? Math.round((responseHours.reduce((a, b) => a + b, 0) / responseHours.length) * 10) / 10 : 0;

  return {
    totalUnread: unread.length,
    totalOpen: all.filter((m) => m.status === "unread" || m.status === "read").length,
    totalReplied: all.filter((m) => m.status === "replied").length,
    totalClosed: closedRows.length,
    overdue: overdue.length,
    avgResponseHours,
    thisWeek: {
      received: all.filter((m) => (m.created_at as string) >= weekAgo).length,
      replied: all.filter((m) => m.status === "replied" && (m.updated_at as string) >= weekAgo).length,
      closed: closedRows.filter((m) => (m.updated_at as string) >= weekAgo).length,
      forwarded: all.filter((m) => m.status === "forwarded" && (m.updated_at as string) >= weekAgo).length,
    },
  };
}

// GET /contact/admin/stats?requesterId=
router.get("/contact/admin/stats", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const access = await getAdminAccess(requesterId);
  if (!access) return err(res, "Admin access required", 403);
  return ok(res, await computeDeptStats(access.departments));
});

// GET /contact/admin/all-departments?requesterId= — super_admin only
router.get("/contact/admin/all-departments", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const { data: profile } = await db.from("p2p_profiles").select("role").eq("id", requesterId).maybeSingle();
  if (profile?.role !== "super_admin") return err(res, "Super admin access required", 403);

  const result: Record<string, Awaited<ReturnType<typeof computeDeptStats>>> = {};
  for (const dept of DEPARTMENTS) {
    result[dept] = await computeDeptStats([dept]);
  }
  return ok(res, result);
});

export default router;