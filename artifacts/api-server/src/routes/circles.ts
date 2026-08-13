import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Same reasoning as curriculum.ts's supabaseRead: p2p_peer_circle_* RLS
// policies require auth.uid() to match, which a server-side anon-key client
// with no forwarded session can never satisfy — use service-role for all
// reads/writes here, same as every other route file in this API.
const supabaseRead = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function mapCircle(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    planId: row.plan_id ?? null,
    curriculumId: row.curriculum_id ?? null,
    moduleId: row.module_id ?? null,
    circleType: row.circle_type,
    leaderId: row.leader_id,
    maxMembers: row.max_members,
    minMembers: row.min_members,
    currentLessonId: row.current_lesson_id ?? null,
    languageCode: row.language_code,
    timezone: row.timezone ?? null,
    meetingPreference: row.meeting_preference ?? null,
    status: row.status,
    churchId: row.church_id ?? null,
    isFeatured: row.is_featured ?? false,
    createdAt: row.created_at,
    ...extra,
  };
}

function mapMember(row: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    id: row.id,
    circleId: row.circle_id,
    userId: row.user_id,
    role: row.role,
    joinedAt: row.joined_at,
    status: row.status,
    ...extra,
  };
}

function mapSession(row: Record<string, unknown>) {
  return {
    id: row.id,
    circleId: row.circle_id,
    lessonId: row.lesson_id,
    scheduledAt: row.scheduled_at ?? null,
    completedAt: row.completed_at ?? null,
    notes: row.notes ?? null,
    sessionStatus: row.session_status,
    createdBy: row.created_by ?? null,
  };
}

async function getCircleContext(circleIds: string[]) {
  const memberCountByCircle = new Map<string, number>();
  const leaderNameByCircle = new Map<string, string>();
  if (!circleIds.length) return { memberCountByCircle, leaderNameByCircle };

  const { data: members } = await supabaseRead
    .from("p2p_peer_circle_members")
    .select("circle_id")
    .in("circle_id", circleIds)
    .eq("status", "active");
  for (const m of (members ?? []) as Record<string, unknown>[]) {
    const id = m.circle_id as string;
    memberCountByCircle.set(id, (memberCountByCircle.get(id) ?? 0) + 1);
  }

  const { data: circles } = await supabaseRead.from("p2p_peer_circles").select("id,leader_id").in("id", circleIds);
  const leaderIds = Array.from(new Set((circles ?? []).map((c) => c.leader_id as string)));
  const { data: leaders } = leaderIds.length
    ? await supabaseRead.from("p2p_profiles").select("id,full_name").in("id", leaderIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameByLeaderId = new Map((leaders ?? []).map((l) => [l.id as string, l.full_name as string]));
  for (const c of (circles ?? []) as Record<string, unknown>[]) {
    leaderNameByCircle.set(c.id as string, nameByLeaderId.get(c.leader_id as string) ?? "Circle Leader");
  }

  return { memberCountByCircle, leaderNameByCircle };
}

// GET /circles — discovery list
router.get("/", async (req, res) => {
  const { planId, language, timezone, status, leaderId } = req.query as { planId?: string; language?: string; timezone?: string; status?: string; leaderId?: string };
  let query = supabaseRead.from("p2p_peer_circles").select("*");
  query = status ? query.in("status", status.split(",")) : query.in("status", ["forming", "active"]);
  if (planId) query = query.eq("plan_id", planId);
  if (leaderId) query = query.eq("leader_id", leaderId);
  if (language) query = query.eq("language_code", language);
  if (timezone) query = query.eq("timezone", timezone);

  const { data: circles, error } = await query.order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const circleIds = (circles ?? []).map((c) => c.id as string);
  const { memberCountByCircle, leaderNameByCircle } = await getCircleContext(circleIds);

  return res.json(
    (circles ?? []).map((c) =>
      mapCircle(c as Record<string, unknown>, {
        memberCount: memberCountByCircle.get(c.id as string) ?? 0,
        leaderName: leaderNameByCircle.get(c.id as string) ?? "Circle Leader",
      })
    )
  );
});

// GET /circles/:circleId — full detail
router.get("/:circleId", async (req, res) => {
  const { circleId } = req.params;
  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("*").eq("id", circleId).maybeSingle();
  if (!circle) return res.status(404).json({ error: "Circle not found" });

  const { data: members } = await supabaseRead
    .from("p2p_peer_circle_members")
    .select("*")
    .eq("circle_id", circleId)
    .eq("status", "active")
    .order("joined_at", { ascending: true });
  const memberIds = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = memberIds.length
    ? await supabaseRead.from("p2p_profiles").select("id,full_name,photo_url,country,username").in("id", memberIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null; country: string | null; username: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const mappedMembers = (members ?? []).map((m) => {
    const p = profileById.get(m.user_id as string);
    return mapMember(m as Record<string, unknown>, { name: p?.full_name ?? "Member", avatarUrl: p?.photo_url ?? null, country: p?.country ?? null, username: p?.username ?? null });
  });

  const { data: sessions } = await supabaseRead
    .from("p2p_peer_circle_sessions")
    .select("*")
    .eq("circle_id", circleId)
    .order("scheduled_at", { ascending: true });

  return res.json({
    ...mapCircle(circle as Record<string, unknown>),
    members: mappedMembers,
    sessions: (sessions ?? []).map(mapSession),
  });
});

// POST /circles — create a new circle (creator becomes leader + first member)
router.post("/", async (req, res) => {
  const body = req.body as {
    name?: string; description?: string; planId?: string; curriculumId?: string; moduleId?: string;
    circleType?: string; leaderId?: string; maxMembers?: number; minMembers?: number;
    languageCode?: string; timezone?: string; meetingPreference?: string;
  };
  if (!body.name?.trim() || !body.leaderId) return res.status(400).json({ error: "name and leaderId are required" });

  const { data: circle, error } = await supabaseRead
    .from("p2p_peer_circles")
    .insert({
      name: body.name.trim(),
      description: body.description?.trim() || null,
      plan_id: body.planId ?? null,
      curriculum_id: body.curriculumId ?? null,
      module_id: body.moduleId ?? null,
      circle_type: body.circleType ?? "open",
      leader_id: body.leaderId,
      max_members: body.maxMembers ?? 8,
      min_members: body.minMembers ?? 3,
      language_code: body.languageCode ?? "en",
      timezone: body.timezone ?? null,
      meeting_preference: body.meetingPreference ?? null,
      status: "forming",
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await supabaseRead.from("p2p_peer_circle_members").insert({ circle_id: circle.id, user_id: body.leaderId, role: "leader", status: "active" });

  return res.json(mapCircle(circle as Record<string, unknown>));
});

// POST /circles/:circleId/join — request to join
router.post("/:circleId/join", async (req, res) => {
  const { circleId } = req.params;
  const { userId, message } = req.body as { userId?: string; message?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data, error } = await supabaseRead
    .from("p2p_peer_circle_join_requests")
    .upsert({ circle_id: circleId, user_id: userId, message: message?.trim() || null, status: "pending", requested_at: new Date().toISOString(), responded_at: null, responded_by: null }, { onConflict: "circle_id,user_id" })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ id: data.id, status: data.status });
});

// GET /circles/:circleId/join-requests — pending requests, for the leader's review UI
router.get("/:circleId/join-requests", async (req, res) => {
  const { circleId } = req.params;
  const { data: requests } = await supabaseRead
    .from("p2p_peer_circle_join_requests")
    .select("*")
    .eq("circle_id", circleId)
    .eq("status", "pending")
    .order("requested_at", { ascending: true });
  const userIds = (requests ?? []).map((r) => r.user_id as string);
  const { data: profiles } = userIds.length
    ? await supabaseRead.from("p2p_profiles").select("id,full_name,photo_url").in("id", userIds)
    : { data: [] as { id: string; full_name: string; photo_url: string | null }[] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  return res.json(
    (requests ?? []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: profileById.get(r.user_id as string)?.full_name ?? "Someone",
      avatarUrl: profileById.get(r.user_id as string)?.photo_url ?? null,
      message: r.message,
      requestedAt: r.requested_at,
    }))
  );
});

// PUT /circles/:circleId/join-requests/:requestId — leader approves/declines
router.put("/:circleId/join-requests/:requestId", async (req, res) => {
  const { circleId, requestId } = req.params;
  const { action, respondedBy } = req.body as { action?: "approve" | "decline"; respondedBy?: string };
  if (!action || !respondedBy) return res.status(400).json({ error: "action and respondedBy are required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("leader_id").eq("id", circleId).maybeSingle();
  if (!circle || circle.leader_id !== respondedBy) return res.status(403).json({ error: "Only the circle leader can respond to join requests" });

  const { data: request } = await supabaseRead.from("p2p_peer_circle_join_requests").select("*").eq("id", requestId).eq("circle_id", circleId).maybeSingle();
  if (!request) return res.status(404).json({ error: "Join request not found" });

  const newStatus = action === "approve" ? "approved" : "declined";
  const { error } = await supabaseRead
    .from("p2p_peer_circle_join_requests")
    .update({ status: newStatus, responded_at: new Date().toISOString(), responded_by: respondedBy })
    .eq("id", requestId);
  if (error) return res.status(500).json({ error: error.message });

  if (action === "approve") {
    await supabaseRead.from("p2p_peer_circle_members").upsert(
      { circle_id: circleId, user_id: request.user_id, role: "member", status: "active" },
      { onConflict: "circle_id,user_id" }
    );
  }
  return res.json({ status: newStatus });
});

// POST /circles/:circleId/members/by-username — leader adds someone
// directly by @username, bypassing the join-request flow (the leader
// already has authority to add members; requiring the target to separately
// request-and-be-approved would be backwards for this action).
router.post("/:circleId/members/by-username", async (req, res) => {
  const { circleId } = req.params;
  const { username, addedBy } = req.body as { username?: string; addedBy?: string };
  if (!username || !addedBy) return res.status(400).json({ error: "username and addedBy are required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("leader_id,max_members,name").eq("id", circleId).maybeSingle();
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (circle.leader_id !== addedBy) return res.status(403).json({ error: "Only the circle leader can add members" });

  const { data: targetProfile } = await supabaseRead.from("p2p_profiles").select("id,full_name").ilike("username", username.replace(/^@/, "")).maybeSingle();
  if (!targetProfile) return res.status(404).json({ error: `No account found for @${username}` });

  const { count } = await supabaseRead.from("p2p_peer_circle_members").select("id", { count: "exact", head: true }).eq("circle_id", circleId).eq("status", "active");
  if ((count ?? 0) >= (circle.max_members as number)) return res.status(409).json({ error: "This circle is full" });

  const { error } = await supabaseRead.from("p2p_peer_circle_members").upsert(
    { circle_id: circleId, user_id: targetProfile.id, role: "member", status: "active", joined_at: new Date().toISOString() },
    { onConflict: "circle_id,user_id" }
  );
  if (error) return res.status(500).json({ error: error.message });

  await supabaseRead.from("p2p_notifications").insert({
    user_id: targetProfile.id, title: `You've been added to ${circle.name}`, message: "Tap to view the circle.",
  });

  return res.json({ userId: targetProfile.id, fullName: targetProfile.full_name });
});

// PUT /circles/:circleId/members/:userId/role — { role: 'co_leader'|'member', changedBy }
router.put("/:circleId/members/:userId/role", async (req, res) => {
  const { circleId, userId } = req.params;
  const { role, changedBy } = req.body as { role?: string; changedBy?: string };
  if (!role || !["co_leader", "member"].includes(role) || !changedBy) {
    return res.status(400).json({ error: "role ('co_leader'|'member') and changedBy are required" });
  }
  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("leader_id").eq("id", circleId).maybeSingle();
  if (!circle || circle.leader_id !== changedBy) return res.status(403).json({ error: "Only the circle leader can change member roles" });

  const { error } = await supabaseRead.from("p2p_peer_circle_members").update({ role }).eq("circle_id", circleId).eq("user_id", userId);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ ok: true, role });
});

// DELETE /circles/:circleId/members/:userId — { removedBy }
router.delete("/:circleId/members/:userId", async (req, res) => {
  const { circleId, userId } = req.params;
  const { removedBy } = req.body as { removedBy?: string };
  if (!removedBy) return res.status(400).json({ error: "removedBy is required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("leader_id,name").eq("id", circleId).maybeSingle();
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (circle.leader_id !== removedBy) return res.status(403).json({ error: "Only the circle leader can remove members" });
  if (userId === removedBy) return res.status(400).json({ error: "Use Transfer Leadership before leaving your own circle" });

  const { error } = await supabaseRead.from("p2p_peer_circle_members").update({ status: "removed" }).eq("circle_id", circleId).eq("user_id", userId);
  if (error) return res.status(500).json({ error: error.message });

  await supabaseRead.from("p2p_notifications").insert({
    user_id: userId, title: `You've been removed from ${circle.name}`, message: "",
  });
  return res.json({ ok: true });
});

// PUT /circles/:circleId/transfer-leadership — { newLeaderId, currentLeaderId }
router.put("/:circleId/transfer-leadership", async (req, res) => {
  const { circleId } = req.params;
  const { newLeaderId, currentLeaderId } = req.body as { newLeaderId?: string; currentLeaderId?: string };
  if (!newLeaderId || !currentLeaderId) return res.status(400).json({ error: "newLeaderId and currentLeaderId are required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("leader_id,name").eq("id", circleId).maybeSingle();
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (circle.leader_id !== currentLeaderId) return res.status(403).json({ error: "Only the current leader can transfer leadership" });

  const { data: newLeaderMembership } = await supabaseRead
    .from("p2p_peer_circle_members").select("id").eq("circle_id", circleId).eq("user_id", newLeaderId).eq("status", "active").maybeSingle();
  if (!newLeaderMembership) return res.status(400).json({ error: "The new leader must already be an active member of this circle" });

  const { error: circleErr } = await supabaseRead.from("p2p_peer_circles").update({ leader_id: newLeaderId }).eq("id", circleId);
  if (circleErr) return res.status(500).json({ error: circleErr.message });

  await supabaseRead.from("p2p_peer_circle_members").update({ role: "leader" }).eq("circle_id", circleId).eq("user_id", newLeaderId);
  await supabaseRead.from("p2p_peer_circle_members").update({ role: "member" }).eq("circle_id", circleId).eq("user_id", currentLeaderId);

  const { data: newLeaderProfile } = await supabaseRead.from("p2p_profiles").select("full_name,username").eq("id", newLeaderId).maybeSingle();
  const newLeaderName = (newLeaderProfile?.username as string | undefined) ? `@${newLeaderProfile!.username}` : (newLeaderProfile?.full_name as string | undefined) ?? "The new leader";
  await supabaseRead.from("p2p_notifications").insert({
    user_id: newLeaderId, title: `You're now leading ${circle.name}`, message: "",
  });

  return res.json({ ok: true, newLeaderId, newLeaderName });
});

// POST /circles/:circleId/sessions — create a session
router.post("/:circleId/sessions", async (req, res) => {
  const { circleId } = req.params;
  const { lessonId, scheduledAt, createdBy } = req.body as { lessonId?: string; scheduledAt?: string; createdBy?: string };
  if (!lessonId) return res.status(400).json({ error: "lessonId is required" });

  const { data, error } = await supabaseRead
    .from("p2p_peer_circle_sessions")
    .insert({ circle_id: circleId, lesson_id: lessonId, scheduled_at: scheduledAt ?? null, created_by: createdBy ?? null, session_status: "scheduled" })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // Advance the circle's current lesson pointer to whatever session was just scheduled.
  await supabaseRead.from("p2p_peer_circles").update({ current_lesson_id: lessonId }).eq("id", circleId);

  return res.json(mapSession(data as Record<string, unknown>));
});

// POST /circles/:circleId/start-session — leader taps "Start Session": ensures
// a scheduled session row exists for the circle's current lesson (creating one
// if needed so the group call always has something to mark complete), notifies
// every active member, and hands back the Agora channel name to join.
router.post("/:circleId/start-session", async (req, res) => {
  const { circleId } = req.params;
  const { startedBy } = req.body as { startedBy?: string };
  if (!startedBy) return res.status(400).json({ error: "startedBy is required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("*").eq("id", circleId).maybeSingle();
  if (!circle) return res.status(404).json({ error: "Circle not found" });
  if (circle.leader_id !== startedBy) return res.status(403).json({ error: "Only the circle leader can start a session" });
  if (!circle.current_lesson_id) return res.status(400).json({ error: "This circle has no current lesson set" });

  let { data: session } = await supabaseRead
    .from("p2p_peer_circle_sessions")
    .select("*")
    .eq("circle_id", circleId)
    .eq("lesson_id", circle.current_lesson_id)
    .eq("session_status", "scheduled")
    .maybeSingle();

  if (!session) {
    const { data: created, error: createErr } = await supabaseRead
      .from("p2p_peer_circle_sessions")
      .insert({ circle_id: circleId, lesson_id: circle.current_lesson_id, session_status: "scheduled", created_by: startedBy })
      .select()
      .single();
    if (createErr) return res.status(500).json({ error: createErr.message });
    session = created;
  }

  const { data: members } = await supabaseRead
    .from("p2p_peer_circle_members")
    .select("user_id")
    .eq("circle_id", circleId)
    .eq("status", "active")
    .neq("user_id", startedBy);

  const channelName = `circle_${circleId}`;
  if (members && members.length > 0) {
    await supabaseRead.from("p2p_notifications").insert(
      members.map((m) => ({
        user_id: m.user_id,
        title: `${circle.name} is starting`,
        message: "Tap to join the group call now.",
        notification_type: "circle_session_start",
        data: { circleId, circleName: circle.name, channelName },
      }))
    );
  }

  return res.json({ channelName, sessionId: (session as Record<string, unknown>).id });
});

// PUT /circles/:circleId/sessions/:sessionId/complete
router.put("/:circleId/sessions/:sessionId/complete", async (req, res) => {
  const { sessionId } = req.params;
  const { notes } = req.body as { notes?: string };
  const { data, error } = await supabaseRead
    .from("p2p_peer_circle_sessions")
    .update({ session_status: "completed", completed_at: new Date().toISOString(), notes: notes?.trim() || null })
    .eq("id", sessionId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  return res.json(mapSession(data as Record<string, unknown>));
});

// POST /circles/:circleId/evaluations — submit an evaluation on a circle member's assignment
router.post("/:circleId/evaluations", async (req, res) => {
  const { circleId } = req.params;
  const { submissionId, evaluatorId, submitterId, lessonId, decision, feedback } = req.body as {
    submissionId?: string; evaluatorId?: string; submitterId?: string; lessonId?: string;
    decision?: "approved" | "needs_revision"; feedback?: string;
  };
  if (!submissionId || !evaluatorId || !submitterId || !lessonId || !decision) {
    return res.status(400).json({ error: "submissionId, evaluatorId, submitterId, lessonId and decision are required" });
  }

  const { error } = await supabaseRead.from("p2p_peer_circle_evaluations").upsert(
    { circle_id: circleId, submission_id: submissionId, evaluator_id: evaluatorId, submitter_id: submitterId, lesson_id: lessonId, decision, feedback: feedback?.trim() || null, evaluated_at: new Date().toISOString() },
    { onConflict: "submission_id,evaluator_id" }
  );
  if (error) return res.status(500).json({ error: error.message });

  const { error: rpcError } = await supabaseRead.rpc("p2p_process_circle_evaluation", { p_submission_id: submissionId, p_circle_id: circleId });
  if (rpcError) return res.status(500).json({ error: rpcError.message });

  return res.json({ recorded: true });
});

// GET /circles/:circleId/evaluations/pending?userId=... — submissions from other
// circle members awaiting this user's evaluation
router.get("/:circleId/evaluations/pending", async (req, res) => {
  const { circleId } = req.params;
  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data: circle } = await supabaseRead.from("p2p_peer_circles").select("current_lesson_id,leader_id").eq("id", circleId).maybeSingle();
  if (!circle?.current_lesson_id) return res.json([]);

  const { data: members } = await supabaseRead.from("p2p_peer_circle_members").select("user_id").eq("circle_id", circleId).eq("status", "active");
  const otherMemberIds = (members ?? []).map((m) => m.user_id as string).filter((id) => id !== userId);
  if (!otherMemberIds.length) return res.json([]);

  const { data: submissions } = await supabaseRead
    .from("p2p_submissions")
    .select("id,user_id,lesson_id,text_content,media_url,submission_type,created_at")
    .eq("lesson_id", circle.current_lesson_id)
    .in("user_id", otherMemberIds);

  const { data: myEvaluations } = await supabaseRead.from("p2p_peer_circle_evaluations").select("submission_id").eq("evaluator_id", userId);
  const alreadyEvaluated = new Set((myEvaluations ?? []).map((e) => e.submission_id as string));

  const submissionIds = (submissions ?? []).map((s) => s.id as string);
  const { data: allEvaluations } = submissionIds.length
    ? await supabaseRead.from("p2p_peer_circle_evaluations").select("submission_id,evaluator_id,decision").in("submission_id", submissionIds)
    : { data: [] as { submission_id: string; evaluator_id: string; decision: string }[] };
  const evalsBySubmission = new Map<string, { evaluator_id: string; decision: string }[]>();
  for (const e of (allEvaluations ?? []) as Record<string, unknown>[]) {
    const arr = evalsBySubmission.get(e.submission_id as string) ?? [];
    arr.push({ evaluator_id: e.evaluator_id as string, decision: e.decision as string });
    evalsBySubmission.set(e.submission_id as string, arr);
  }

  const pending = (submissions ?? []).filter((s) => {
    if (alreadyEvaluated.has(s.id as string)) return false;
    const evals = evalsBySubmission.get(s.id as string) ?? [];
    const leaderVoted = evals.some((e) => e.evaluator_id === circle.leader_id);
    if (leaderVoted) return false; // already resolved by the leader
    return evals.length < 2; // still open for one of the first two votes
  });

  const submitterIds = Array.from(new Set(pending.map((s) => s.user_id as string)));
  const { data: profiles } = submitterIds.length
    ? await supabaseRead.from("p2p_profiles").select("id,full_name").in("id", submitterIds)
    : { data: [] as { id: string; full_name: string }[] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id as string, p.full_name as string]));

  return res.json(
    pending.map((s) => ({
      submissionId: s.id,
      submitterId: s.user_id,
      submitterName: nameById.get(s.user_id as string) ?? "A circle member",
      lessonId: s.lesson_id,
      content: s.text_content,
      mediaUrl: s.media_url,
      submissionType: s.submission_type,
      createdAt: s.created_at,
      evaluationsSoFar: (evalsBySubmission.get(s.id as string) ?? []).length,
    }))
  );
});

export default router;
