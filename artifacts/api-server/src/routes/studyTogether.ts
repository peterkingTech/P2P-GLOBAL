import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import {
  CONTENT_TYPES, DESTINATIONS, GROUP_DESTINATIONS, INVITE_DAYS, MAX_PEER_INVITES, StudyError, isUuid,
  invitablePeers, isBlockedEitherWay, isDestinationMember, canLeadDestination, destinationMemberIds,
  groupsUserLeads, destinationName, loadContent, notify, displayName,
  type ContentType, type Destination,
} from "../lib/sharedStudy";

// Study Together — shared (asynchronous) studies (migration 216), mounted at
// /study-together. The live in-call Study Together (calls.ts, migration 084)
// is unchanged; this is the "study at your own pace, together" layer.
//   GET    /destinations                 who / which groups I may study with
//   POST   /                             start (peer invitations or a group study)
//   GET    /mine                         invitations, active and concluded studies
//   GET    /:id                          the shared study (authorized viewers only)
//   POST   /:id/respond                  { response: "accepted" | "declined" }
//   POST   /:id/invite                   { userIds } host of a peer study
//   POST   /:id/cancel-invite            { userId } host
//   POST   /:id/leave                    any participant except the host
//   POST   /:id/conclude | /:id/reopen   leader
//   PUT    /:id/position                 { sectionId | null } leader
//   POST   /:id/prompts                  { body, sectionId? } leader
//   DELETE /:id/prompts/:promptId        leader
//   POST   /:id/responses                { body, promptId? | sectionId + questionIndex } participant
//   DELETE /:id/responses/:responseId    the author, or a leader
//   POST   /:id/opened                   participant ("Resume Study"; group members join here)
// Identity always comes from the token. Each person's reading position,
// completion and private reflections stay in their own progress tables —
// nothing here reads or copies them, and joining never marks anything done.

const router = Router();
const DECLINE_COOLDOWN_DAYS = 7;
type Study = {
  id: string; content_type: ContentType; content_id: string; title: string; host_id: string;
  destination_type: Destination; destination_id: string | null; current_section_id: string | null;
  status: "active" | "concluded"; created_at: string; updated_at: string; concluded_at: string | null;
};
type Member = { id: string; study_id: string; user_id: string; role: "host" | "member"; status: string; invited_at: string; responded_at: string | null; expires_at: string | null; last_opened_at: string | null };
type Access = { study: Study; member: Member | null; isHost: boolean; isLeader: boolean; isGroupMember: boolean; canParticipate: boolean; invited: boolean };

async function caller(req: Request, res: Response): Promise<string | null> {
  const userId = await verifyCaller(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return null; }
  return userId;
}
function fail(res: Response, e: unknown) {
  if (e instanceof StudyError) return res.status(e.status).json({ error: e.message });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205") return res.status(503).json({ error: "Study Together isn't available yet." });
  return res.status(500).json({ error: "Something went wrong. Please try again." });
}
const isExpired = (m: Member) => m.status === "pending" && !!m.expires_at && new Date(m.expires_at).getTime() < Date.now();

async function access(studyId: string, userId: string): Promise<Access> {
  if (!isUuid(studyId)) throw new StudyError(404, "This study isn't available.");
  const { data: study, error } = await db.from("p2p_shared_studies").select("*").eq("id", studyId).maybeSingle();
  if (error) throw error;
  if (!study) throw new StudyError(404, "This study isn't available.");
  const s = study as Study;
  const { data: m } = await db.from("p2p_shared_study_members").select("*").eq("study_id", s.id).eq("user_id", userId).maybeSingle();
  let member = (m as Member) ?? null;
  if (member && isExpired(member)) {
    await db.from("p2p_shared_study_members").update({ status: "expired" }).eq("id", member.id);
    member = { ...member, status: "expired" };
  }
  const isHost = s.host_id === userId;
  const group = s.destination_id && GROUP_DESTINATIONS.includes(s.destination_type);
  const isGroupMember = group ? await isDestinationMember(s.destination_type, s.destination_id!, userId) : false;
  const isLeader = isHost || (group ? await canLeadDestination(s.destination_type, s.destination_id!, userId) : false);
  const left = member?.status === "left";
  const canParticipate = isHost || isLeader || (group ? isGroupMember && !left : member?.status === "accepted");
  const invited = !group && member?.status === "pending";
  if (!canParticipate && !invited) throw new StudyError(404, "This study isn't available.");
  return { study: s, member, isHost, isLeader, isGroupMember, canParticipate, invited };
}
const requireLeader = (a: Access) => { if (!a.isLeader) throw new StudyError(403, "Only the person leading this study can do that."); };
const requireParticipant = (a: Access) => { if (!a.canParticipate) throw new StudyError(403, "Accept the invitation first."); };
const requireActive = (a: Access) => { if (a.study.status !== "active") throw new StudyError(409, "This study has been concluded."); };
const touch = (id: string) => db.from("p2p_shared_studies").update({ updated_at: new Date().toISOString() }).eq("id", id);

async function profilesById(ids: string[]) {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (!unique.length) return new Map<string, { name: string; photoUrl: string | null }>();
  const { data } = await db.from("p2p_profiles").select("id,full_name,photo_url").in("id", unique);
  return new Map(((data ?? []) as { id: string; full_name: string | null; photo_url: string | null }[])
    .map((p) => [p.id, { name: p.full_name || "Someone", photoUrl: p.photo_url ?? null }]));
}

/** Peers who already share an active study of this content with the host (pending or accepted). */
async function alreadyStudyingWith(hostId: string, type: ContentType, contentId: string, inviteeIds: string[]): Promise<{ userId: string; studyId: string } | null> {
  const { data: studies } = await db.from("p2p_shared_studies").select("id").eq("destination_type", "peer")
    .eq("content_type", type).eq("content_id", contentId).eq("status", "active");
  const ids = ((studies ?? []) as { id: string }[]).map((s) => s.id);
  if (!ids.length) return null;
  const { data: rows } = await db.from("p2p_shared_study_members").select("*").in("study_id", ids);
  const live = ((rows ?? []) as Member[]).filter((r) => r.status === "accepted" || (r.status === "pending" && !isExpired(r)));
  for (const id of ids) {
    const inStudy = new Set(live.filter((r) => r.study_id === id).map((r) => r.user_id));
    if (!inStudy.has(hostId)) continue;
    const hit = inviteeIds.find((u) => inStudy.has(u));
    if (hit) return { userId: hit, studyId: id };
  }
  return null;
}

// No repeat nudging: someone who declined this host's invitation in the last
// week can't be invited by them again (to any study) until it has passed.
async function refuseIfDeclinedRecently(hostId: string, userIds: string[]) {
  const since = new Date(Date.now() - DECLINE_COOLDOWN_DAYS * 86400000).toISOString();
  const { data: declined } = await db.from("p2p_shared_study_members").select("user_id").eq("invited_by", hostId).eq("status", "declined").in("user_id", userIds).gte("responded_at", since);
  if ((declined ?? []).length) throw new StudyError(409, "Someone you chose declined an invitation from you recently. You can invite them again after a week.");
}

async function invitePeers(study: Study, hostId: string, userIds: string[]) {
  const unique = Array.from(new Set(userIds)).filter((u) => u !== hostId);
  if (!unique.length) throw new StudyError(400, "Choose someone to invite.");
  if (unique.length > MAX_PEER_INVITES) throw new StudyError(400, `You can invite up to ${MAX_PEER_INVITES} people at a time.`);
  if (!unique.every(isUuid)) throw new StudyError(400, "Choose someone to invite.");
  const allowed = await invitablePeers(hostId);
  if (!unique.every((u) => allowed.has(u))) throw new StudyError(403, "You can only invite people you're connected with on P2P.");
  const dup = await alreadyStudyingWith(hostId, study.content_type, study.content_id, unique);
  if (dup && dup.studyId !== study.id) throw Object.assign(new StudyError(409, "You're already studying this with that person."), { studyId: dup.studyId });
  await refuseIfDeclinedRecently(hostId, unique);
  const expires = new Date(Date.now() + INVITE_DAYS * 86400000).toISOString();
  const { data: existing } = await db.from("p2p_shared_study_members").select("*").eq("study_id", study.id).in("user_id", unique);
  const byUser = new Map(((existing ?? []) as Member[]).map((m) => [m.user_id, m]));
  const fresh: string[] = [];
  for (const u of unique) {
    const m = byUser.get(u);
    if (m && (m.status === "accepted" || (m.status === "pending" && !isExpired(m)))) continue;
    if (m) await db.from("p2p_shared_study_members").update({ status: "pending", invited_by: hostId, invited_at: new Date().toISOString(), responded_at: null, expires_at: expires }).eq("id", m.id);
    else await db.from("p2p_shared_study_members").insert({ study_id: study.id, user_id: u, role: "member", status: "pending", invited_by: hostId, expires_at: expires });
    fresh.push(u);
  }
  if (fresh.length) {
    const name = await displayName(hostId);
    await notify(fresh, { title: "Study Together invitation", message: `${name} invited you to study "${study.title}" together.`, type: "shared_study_invite", studyId: study.id });
  }
  return fresh;
}

// ── Destinations ─────────────────────────────────────────────────────────────

router.get("/destinations", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const peers = await invitablePeers(userId);
    const profiles = await profilesById(Array.from(peers.keys()));
    const rank = { peer_guide: 0, disciple: 1, friend: 2, connection: 3 } as const;
    const people = Array.from(peers.entries()).map(([id, relationship]) => ({ id, relationship, name: profiles.get(id)?.name ?? "Someone", photoUrl: profiles.get(id)?.photoUrl ?? null }))
      .sort((a, b) => rank[a.relationship] - rank[b.relationship] || a.name.localeCompare(b.name));
    const groups = await groupsUserLeads(userId);
    return res.json({ people, groups, maxPeople: MAX_PEER_INVITES });
  } catch (e) { return fail(res, e); }
});

// ── Start ────────────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const b = (req.body ?? {}) as { contentType?: string; contentId?: string; destination?: string; groupId?: string; userIds?: string[]; prompt?: string };
  try {
    if (!CONTENT_TYPES.includes(b.contentType as ContentType)) throw new StudyError(400, "Choose a story or lesson to study.");
    if (!DESTINATIONS.includes(b.destination as Destination)) throw new StudyError(400, "Choose who to study with.");
    const type = b.contentType as ContentType, dest = b.destination as Destination;
    const content = await loadContent(type, String(b.contentId ?? ""));
    if (!content) throw new StudyError(404, "This story or lesson isn't available.");
    const prompt = typeof b.prompt === "string" ? b.prompt.trim().slice(0, 1000) : "";

    if (dest === "peer") {
      const userIds = Array.isArray(b.userIds) ? b.userIds.map(String) : [];
      // Validate before creating anything (invitePeers re-checks).
      const allowed = await invitablePeers(userId);
      if (!userIds.length) throw new StudyError(400, "Choose someone to invite.");
      if (new Set(userIds).size > MAX_PEER_INVITES) throw new StudyError(400, `You can invite up to ${MAX_PEER_INVITES} people at a time.`);
      if (!userIds.every((u) => allowed.has(u))) throw new StudyError(403, "You can only invite people you're connected with on P2P.");
      const dup = await alreadyStudyingWith(userId, type, content.id, userIds);
      if (dup) return res.status(409).json({ error: "You're already studying this with that person.", studyId: dup.studyId });
      await refuseIfDeclinedRecently(userId, userIds);
      const { data: study, error } = await db.from("p2p_shared_studies").insert({
        content_type: type, content_id: content.id, title: content.title, host_id: userId, destination_type: "peer", destination_id: null,
        current_section_id: content.sections[0]?.id ?? null,
      }).select("*").single();
      if (error) throw error;
      await db.from("p2p_shared_study_members").insert({ study_id: study.id, user_id: userId, role: "host", status: "accepted", responded_at: new Date().toISOString(), last_opened_at: new Date().toISOString() });
      if (prompt) await db.from("p2p_shared_study_prompts").insert({ study_id: study.id, body: prompt, created_by: userId });
      const invited = await invitePeers(study as Study, userId, userIds);
      return res.status(201).json({ id: study.id, invited: invited.length });
    }

    const groupId = String(b.groupId ?? "");
    if (!isUuid(groupId)) throw new StudyError(400, "Choose a group.");
    if (!(await canLeadDestination(dest, groupId, userId))) throw new StudyError(403, "Only the group's leaders can start a group study.");
    const { data: existing } = await db.from("p2p_shared_studies").select("id").eq("destination_type", dest).eq("destination_id", groupId)
      .eq("content_type", type).eq("content_id", content.id).eq("status", "active").maybeSingle();
    if (existing) return res.json({ id: existing.id, existing: true });
    const { data: study, error } = await db.from("p2p_shared_studies").insert({
      content_type: type, content_id: content.id, title: content.title, host_id: userId, destination_type: dest, destination_id: groupId,
      current_section_id: content.sections[0]?.id ?? null,
    }).select("*").single();
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const { data: again } = await db.from("p2p_shared_studies").select("id").eq("destination_type", dest).eq("destination_id", groupId)
          .eq("content_type", type).eq("content_id", content.id).eq("status", "active").maybeSingle();
        if (again) return res.json({ id: again.id, existing: true });
      }
      throw error;
    }
    await db.from("p2p_shared_study_members").insert({ study_id: study.id, user_id: userId, role: "host", status: "accepted", responded_at: new Date().toISOString(), last_opened_at: new Date().toISOString() });
    if (prompt) await db.from("p2p_shared_study_prompts").insert({ study_id: study.id, body: prompt, created_by: userId });
    const members = (await destinationMemberIds(dest, groupId)).filter((u) => u !== userId);
    const [name, groupName] = await Promise.all([displayName(userId), destinationName(dest, groupId)]);
    await notify(members, { title: "Group study started", message: `${name} started studying "${content.title}" with ${groupName ?? "your group"}.`, type: "shared_study_started", studyId: study.id });
    return res.status(201).json({ id: study.id });
  } catch (e) {
    const sid = (e as { studyId?: string })?.studyId;
    if (e instanceof StudyError && sid) return res.status(e.status).json({ error: e.message, studyId: sid });
    return fail(res, e);
  }
});

// ── My studies ───────────────────────────────────────────────────────────────

async function myGroupIds(userId: string): Promise<Record<string, string[]>> {
  const [{ data: fam }, { data: ch }, { data: circ }, { data: led }, { data: grp }, { data: grpLed }] = await Promise.all([
    db.from("p2p_family_members").select("family_id").eq("user_id", userId).eq("status", "active"),
    db.from("p2p_church_members").select("church_id").eq("user_id", userId).eq("is_active", true),
    db.from("p2p_peer_circle_members").select("circle_id").eq("user_id", userId).eq("status", "active"),
    db.from("p2p_peer_circles").select("id").eq("leader_id", userId),
    db.from("p2p_group_members").select("group_id").eq("user_id", userId),
    db.from("p2p_groups").select("id").eq("peer_guide_id", userId),
  ]);
  return {
    family: (fam ?? []).map((r) => r.family_id as string),
    church: (ch ?? []).map((r) => r.church_id as string),
    circle: [...(circ ?? []).map((r) => r.circle_id as string), ...(led ?? []).map((r) => r.id as string)],
    group: [...(grp ?? []).map((r) => r.group_id as string), ...(grpLed ?? []).map((r) => r.id as string)],
  };
}

router.get("/mine", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const { data: rows, error } = await db.from("p2p_shared_study_members").select("*").eq("user_id", userId);
    if (error) throw error;
    const mine = (rows ?? []) as Member[];
    const byStudy = new Map(mine.map((m) => [m.study_id, m]));
    const studyIds = new Set(mine.filter((m) => ["pending", "accepted"].includes(m.status) && !isExpired(m)).map((m) => m.study_id));
    const groups = await myGroupIds(userId);
    const studies: Study[] = [];
    if (studyIds.size) {
      const { data } = await db.from("p2p_shared_studies").select("*").in("id", Array.from(studyIds));
      studies.push(...((data ?? []) as Study[]));
    }
    for (const [type, ids] of Object.entries(groups)) {
      if (!ids.length) continue;
      const { data } = await db.from("p2p_shared_studies").select("*").eq("destination_type", type).in("destination_id", ids);
      for (const s of (data ?? []) as Study[]) {
        if (byStudy.get(s.id)?.status === "left") continue;
        if (!studies.some((x) => x.id === s.id)) studies.push(s);
      }
    }
    const hosts = await profilesById(studies.map((s) => s.host_id));
    const names = new Map<string, string | null>();
    for (const s of studies) if (s.destination_id && !names.has(s.destination_id)) names.set(s.destination_id, await destinationName(s.destination_type, s.destination_id));
    const card = (s: Study) => {
      const m = byStudy.get(s.id);
      return {
        id: s.id, title: s.title, contentType: s.content_type, contentId: s.content_id, status: s.status,
        destination: { type: s.destination_type, id: s.destination_id, name: s.destination_id ? names.get(s.destination_id) ?? null : null },
        host: { id: s.host_id, name: hosts.get(s.host_id)?.name ?? "Someone" }, isHost: s.host_id === userId,
        myStatus: m?.status ?? (s.destination_id ? "group" : null), invitedAt: m?.invited_at ?? null, expiresAt: m?.expires_at ?? null,
        lastOpenedAt: m?.last_opened_at ?? null, updatedAt: s.updated_at,
      };
    };
    const sorted = studies.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return res.json({
      invitations: sorted.filter((s) => s.status === "active" && byStudy.get(s.id)?.status === "pending").map(card),
      active: sorted.filter((s) => s.status === "active" && byStudy.get(s.id)?.status !== "pending").map(card),
      concluded: sorted.filter((s) => s.status === "concluded").slice(0, 20).map(card),
    });
  } catch (e) { return fail(res, e); }
});

// ── One study ────────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    const s = a.study;
    const content = await loadContent(s.content_type, s.content_id);
    const [host, destName] = await Promise.all([profilesById([s.host_id]), destinationName(s.destination_type, s.destination_id)]);
    const base = {
      id: s.id, title: s.title, status: s.status, contentType: s.content_type, contentId: s.content_id,
      contentAvailable: !!content, subtitle: content?.subtitle ?? null,
      destination: { type: s.destination_type, id: s.destination_id, name: destName },
      host: { id: s.host_id, name: host.get(s.host_id)?.name ?? "Someone", photoUrl: host.get(s.host_id)?.photoUrl ?? null },
      me: { isHost: a.isHost, isLeader: a.isLeader, canParticipate: a.canParticipate, invited: a.invited, status: a.member?.status ?? (a.isGroupMember ? "group" : null), expiresAt: a.member?.expires_at ?? null },
      createdAt: s.created_at, updatedAt: s.updated_at, concludedAt: s.concluded_at,
    };
    // An invitee sees what they're invited to — not the discussion or who else is in it.
    if (!a.canParticipate) return res.json({ ...base, sections: [], currentSectionId: null, prompts: [], responses: [], members: [] });

    const [{ data: prompts }, { data: responses }, { data: members }] = await Promise.all([
      db.from("p2p_shared_study_prompts").select("*").eq("study_id", s.id).order("created_at", { ascending: true }),
      db.from("p2p_shared_study_responses").select("*").eq("study_id", s.id).order("created_at", { ascending: true }),
      db.from("p2p_shared_study_members").select("*").eq("study_id", s.id),
    ]);
    const mem = (members ?? []) as Member[];
    const resp = (responses ?? []) as { id: string; prompt_id: string | null; section_id: string | null; question_index: number | null; user_id: string; body: string; created_at: string }[];
    const people = await profilesById([...mem.map((m) => m.user_id), ...resp.map((r) => r.user_id)]);
    const visibleMembers = mem.filter((m) => m.status === "accepted" || (a.isHost && m.status === "pending" && !isExpired(m)))
      .map((m) => ({ userId: m.user_id, name: people.get(m.user_id)?.name ?? "Someone", photoUrl: people.get(m.user_id)?.photoUrl ?? null, role: m.role, status: isExpired(m) ? "expired" : m.status, lastOpenedAt: m.last_opened_at }));
    const weekAgo = Date.now() - 7 * 86400000;
    return res.json({
      ...base,
      sections: content?.sections ?? [],
      currentSectionId: s.current_section_id,
      prompts: ((prompts ?? []) as { id: string; section_id: string | null; body: string; created_at: string }[]).map((p) => ({ id: p.id, sectionId: p.section_id, body: p.body, createdAt: p.created_at })),
      responses: resp.map((r) => ({ id: r.id, promptId: r.prompt_id, sectionId: r.section_id, questionIndex: r.question_index, body: r.body, createdAt: r.created_at, userId: r.user_id, name: people.get(r.user_id)?.name ?? "Someone", mine: r.user_id === userId })),
      members: visibleMembers,
      // Group participation for leaders: who joined and opened it — never anyone's private progress or answers.
      participation: a.isLeader ? {
        joined: mem.filter((m) => m.status === "accepted").length,
        openedThisWeek: mem.filter((m) => m.last_opened_at && new Date(m.last_opened_at).getTime() > weekAgo).length,
        sharedResponses: resp.length,
        groupSize: s.destination_id ? (await destinationMemberIds(s.destination_type, s.destination_id)).length : null,
      } : null,
    });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/respond", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  const response = (req.body ?? {}).response;
  try {
    if (!["accepted", "declined"].includes(response)) throw new StudyError(400, "response must be accepted or declined");
    const a = await access(String(req.params.id), userId).catch((e) => {
      if (e instanceof StudyError && e.status === 404) throw new StudyError(404, "This invitation is no longer available.");
      throw e;
    });
    if (!a.invited || !a.member) throw new StudyError(409, a.member?.status === "expired" ? "This invitation has expired." : "There's no open invitation to answer.");
    requireActive(a);
    if (response === "accepted" && (await isBlockedEitherWay(userId, a.study.host_id))) throw new StudyError(403, "This invitation is no longer available.");
    await db.from("p2p_shared_study_members").update({ status: response, responded_at: new Date().toISOString(), ...(response === "accepted" ? { last_opened_at: new Date().toISOString() } : {}) }).eq("id", a.member.id);
    await touch(a.study.id);
    const name = await displayName(userId);
    await notify([a.study.host_id], {
      title: response === "accepted" ? "Study Together: invitation accepted" : "Study Together: invitation declined",
      message: response === "accepted" ? `${name} will study "${a.study.title}" with you.` : `${name} can't study "${a.study.title}" right now.`,
      type: response === "accepted" ? "shared_study_accepted" : "shared_study_declined", studyId: a.study.id,
    });
    return res.json({ status: response });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/invite", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    if (!a.isHost || a.study.destination_type !== "peer") throw new StudyError(403, "Only the person who started this study can invite people to it.");
    requireActive(a);
    const userIds = Array.isArray(req.body?.userIds) ? req.body.userIds.map(String) : [];
    const invited = await invitePeers(a.study, userId, userIds);
    await touch(a.study.id);
    return res.json({ invited: invited.length });
  } catch (e) {
    const sid = (e as { studyId?: string })?.studyId;
    if (e instanceof StudyError && sid) return res.status(e.status).json({ error: e.message, studyId: sid });
    return fail(res, e);
  }
});

router.post("/:id/cancel-invite", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    if (!a.isHost) throw new StudyError(403, "Only the person who started this study can cancel invitations.");
    const target = String(req.body?.userId ?? "");
    const { data: m } = await db.from("p2p_shared_study_members").select("*").eq("study_id", a.study.id).eq("user_id", target).maybeSingle();
    if (!m || (m as Member).status !== "pending") throw new StudyError(409, "There's no open invitation to cancel.");
    await db.from("p2p_shared_study_members").update({ status: "cancelled", responded_at: new Date().toISOString() }).eq("id", (m as Member).id);
    return res.json({ status: "cancelled" });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/leave", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    if (a.isHost) throw new StudyError(409, "You started this study — conclude it instead.");
    if (a.member) await db.from("p2p_shared_study_members").update({ status: "left", responded_at: new Date().toISOString() }).eq("id", a.member.id);
    else await db.from("p2p_shared_study_members").insert({ study_id: a.study.id, user_id: userId, role: "member", status: "left", responded_at: new Date().toISOString() });
    return res.json({ status: "left" });
  } catch (e) { return fail(res, e); }
});

for (const [path, status] of [["conclude", "concluded"], ["reopen", "active"]] as const) {
  router.post(`/:id/${path}`, async (req, res) => {
    const userId = await caller(req, res);
    if (!userId) return;
    try {
      const a = await access(String(req.params.id), userId);
      requireLeader(a);
      if (status === "active" && a.study.destination_id) {
        const { data: other } = await db.from("p2p_shared_studies").select("id").eq("destination_type", a.study.destination_type).eq("destination_id", a.study.destination_id)
          .eq("content_type", a.study.content_type).eq("content_id", a.study.content_id).eq("status", "active").maybeSingle();
        if (other && other.id !== a.study.id) throw new StudyError(409, "This group already has an active study of this content.");
      }
      const now = new Date().toISOString();
      await db.from("p2p_shared_studies").update({ status, concluded_at: status === "concluded" ? now : null, updated_at: now }).eq("id", a.study.id);
      return res.json({ status });
    } catch (e) { return fail(res, e); }
  });
}

router.put("/:id/position", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    requireLeader(a); requireActive(a);
    const sectionId = req.body?.sectionId ?? null;
    if (sectionId !== null) {
      const content = await loadContent(a.study.content_type, a.study.content_id);
      if (!content?.sections.some((x) => x.id === sectionId)) throw new StudyError(400, "That chapter isn't part of this study.");
    }
    await db.from("p2p_shared_studies").update({ current_section_id: sectionId, updated_at: new Date().toISOString() }).eq("id", a.study.id);
    return res.json({ currentSectionId: sectionId });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/prompts", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    requireLeader(a); requireActive(a);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length > 1000) throw new StudyError(400, "Write a question (up to 1000 characters).");
    const sectionId = req.body?.sectionId ?? null;
    if (sectionId !== null) {
      const content = await loadContent(a.study.content_type, a.study.content_id);
      if (!content?.sections.some((x) => x.id === sectionId)) throw new StudyError(400, "That chapter isn't part of this study.");
    }
    const { data, error } = await db.from("p2p_shared_study_prompts").insert({ study_id: a.study.id, section_id: sectionId, body, created_by: userId }).select("id").single();
    if (error) throw error;
    await touch(a.study.id);
    return res.status(201).json({ id: data.id });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/prompts/:promptId", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    requireLeader(a);
    await db.from("p2p_shared_study_prompts").delete().eq("id", String(req.params.promptId)).eq("study_id", a.study.id);
    return res.json({ removed: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/responses", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    requireParticipant(a); requireActive(a);
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length > 2000) throw new StudyError(400, "Write a response (up to 2000 characters).");
    const promptId = req.body?.promptId ?? null;
    const sectionId = req.body?.sectionId ?? null;
    const questionIndex = req.body?.questionIndex ?? null;
    if (promptId !== null) {
      const { data: p } = await db.from("p2p_shared_study_prompts").select("id").eq("id", String(promptId)).eq("study_id", a.study.id).maybeSingle();
      if (!p) throw new StudyError(400, "That question isn't part of this study.");
    } else if (sectionId !== null) {
      const content = await loadContent(a.study.content_type, a.study.content_id);
      const sec = content?.sections.find((x) => x.id === sectionId);
      if (!sec || (questionIndex !== null && !(Number.isInteger(questionIndex) && questionIndex >= 0 && questionIndex < sec.questions.length))) throw new StudyError(400, "That question isn't part of this study.");
    }
    const { data, error } = await db.from("p2p_shared_study_responses").insert({
      study_id: a.study.id, prompt_id: promptId, section_id: promptId ? null : sectionId, question_index: promptId ? null : questionIndex, user_id: userId, body,
    }).select("id").single();
    if (error) throw error;
    await touch(a.study.id);
    return res.status(201).json({ id: data.id });
  } catch (e) { return fail(res, e); }
});

router.delete("/:id/responses/:responseId", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    const { data: r } = await db.from("p2p_shared_study_responses").select("id,user_id").eq("id", String(req.params.responseId)).eq("study_id", a.study.id).maybeSingle();
    if (!r) throw new StudyError(404, "That response isn't here any more.");
    if (r.user_id !== userId && !a.isLeader) throw new StudyError(403, "You can only remove your own responses.");
    await db.from("p2p_shared_study_responses").delete().eq("id", r.id);
    return res.json({ removed: true });
  } catch (e) { return fail(res, e); }
});

router.post("/:id/opened", async (req, res) => {
  const userId = await caller(req, res);
  if (!userId) return;
  try {
    const a = await access(String(req.params.id), userId);
    requireParticipant(a);
    const now = new Date().toISOString();
    if (a.member) await db.from("p2p_shared_study_members").update({ last_opened_at: now }).eq("id", a.member.id);
    else await db.from("p2p_shared_study_members").insert({ study_id: a.study.id, user_id: userId, role: "member", status: "accepted", responded_at: now, last_opened_at: now });
    return res.json({ ok: true });
  } catch (e) { return fail(res, e); }
});

export default router;
