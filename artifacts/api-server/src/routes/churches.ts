import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

// Same trust model as discipleship.ts/connections.ts/calls.ts — no
// requireAuth/requireAdmin middleware exists for this non-admin surface
// (church leadership is a per-church role in p2p_church_members, orthogonal
// to the global admin_* role system admin.ts gates on), so every endpoint
// takes a caller-supplied requesterId and authorizes inline against
// p2p_church_members, same as the rest of this API.
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

const LEADERSHIP_ROLES = ["senior_pastor", "discipleship_pastor", "small_group_leader"];
const PASTOR_ROLES = ["senior_pastor", "discipleship_pastor"];

async function getMembership(churchId: string, userId: string) {
  const { data } = await db
    .from("p2p_church_members")
    .select("role, is_active")
    .eq("church_id", churchId).eq("user_id", userId).maybeSingle();
  return data as { role: string; is_active: boolean } | null;
}

// Same URL-length-safety reasoning as admin.ts's selectInChunksAdmin.
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

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function randomSuffix(len = 6): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
// Same live Netlify base the personal @username invite link uses
// (profiles.ts's INVITE_BASE) — church invites live under /join/church/ to
// stay disambiguated from the /join/@username personal-invite path. Same
// documented caveat applies: this base resolves, but /join/* itself isn't
// wired up on that deployment yet (see lib/sharing.ts's comment) — link
// *generation* is correct and complete, the web landing page it points to
// is a separate, already-tracked gap, not something this endpoint can fix.
const INVITE_BASE = process.env.INVITE_BASE_URL
  || "https://peer-to-peer-globalbiblestudynetwork.netlify.app/join";
function buildChurchInviteLink(inviteCode: string): string {
  return `${INVITE_BASE}/church/${encodeURIComponent(inviteCode)}`;
}

function mapChurch(row: Record<string, unknown>) {
  return {
    id: row.id, name: row.name, description: row.description ?? null,
    logoUrl: row.logo_url ?? null, website: row.website ?? null,
    city: row.city ?? null, country: row.country, countryCode: row.country_code ?? null,
    timezone: row.timezone ?? null, denomination: row.denomination ?? null,
    languageCode: row.language_code ?? "en", contactEmail: row.contact_email ?? null,
    contactName: row.contact_name ?? null, inviteCode: row.invite_code,
    inviteLink: buildChurchInviteLink(row.invite_code as string),
    status: row.status, isVerified: row.is_verified ?? false,
    verifiedAt: row.verified_at ?? null, createdAt: row.created_at, createdBy: row.created_by,
  };
}

// ── Registration / membership ────────────────────────────────────────────────

// POST /churches — any authenticated user registers a church and becomes
// its senior_pastor.
router.post("/churches", async (req, res) => {
  const {
    requesterId, name, description, city, country, country_code, timezone,
    denomination, language_code, contact_email, contact_name, website,
  } = req.body as Record<string, string | undefined>;
  if (!requesterId || !name?.trim() || !country?.trim()) {
    return err(res, "requesterId, name, and country are required", 400);
  }

  const { data: existingMembership } = await db
    .from("p2p_church_members").select("id").eq("user_id", requesterId).eq("is_active", true).maybeSingle();
  if (existingMembership) return err(res, "You already belong to a church", 409);

  let inviteCode = `${slugify([name, city].filter(Boolean).join(" "))}-${randomSuffix()}`;
  // Vanishingly unlikely, but the column is UNIQUE — retry once on collision
  // rather than fail the whole registration over it.
  const { data: clash } = await db.from("p2p_churches").select("id").eq("invite_code", inviteCode).maybeSingle();
  if (clash) inviteCode = `${slugify([name, city].filter(Boolean).join(" "))}-${randomSuffix()}`;

  const { data: church, error } = await db
    .from("p2p_churches")
    .insert({
      name: name.trim(), description: description?.trim() || null, city: city?.trim() || null,
      country: country.trim(), country_code: country_code || null, timezone: timezone || null,
      denomination: denomination || null, language_code: language_code || "en",
      contact_email: contact_email?.trim() || null, contact_name: contact_name?.trim() || null,
      website: website?.trim() || null, invite_code: inviteCode, created_by: requesterId,
    })
    .select("*").single();
  if (error || !church) return err(res, error?.message ?? "Failed to register church", 500);

  const { error: memberErr } = await db.from("p2p_church_members").insert({
    church_id: church.id, user_id: requesterId, role: "senior_pastor", is_active: true,
  });
  if (memberErr) {
    await db.from("p2p_churches").delete().eq("id", church.id as string);
    return err(res, memberErr.message, 500);
  }
  // Wire the pre-existing church_id scoping column (migration 012) to the
  // church the pastor just created, per the explicit product decision that
  // these are now the same "church" concept.
  await db.from("p2p_profiles").update({ church_id: church.id }).eq("id", requesterId);

  return res.status(201).json(mapChurch(church as Record<string, unknown>));
});

// GET /churches/my-church?requesterId=
router.get("/churches/my-church", async (req, res) => {
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);

  const { data: membership } = await db
    .from("p2p_church_members").select("church_id, role").eq("user_id", requesterId).eq("is_active", true).maybeSingle();
  if (!membership) return ok(res, { church: null, userRole: null, memberCount: 0, cohortCount: 0 });

  const { data: church } = await db.from("p2p_churches").select("*").eq("id", membership.church_id).maybeSingle();
  if (!church) return ok(res, { church: null, userRole: null, memberCount: 0, cohortCount: 0 });

  const [{ count: memberCount }, { count: cohortCount }] = await Promise.all([
    db.from("p2p_church_members").select("id", { count: "exact", head: true }).eq("church_id", membership.church_id).eq("is_active", true),
    db.from("p2p_church_cohorts").select("id", { count: "exact", head: true }).eq("church_id", membership.church_id),
  ]);

  return ok(res, {
    church: mapChurch(church as Record<string, unknown>),
    userRole: membership.role, memberCount: memberCount ?? 0, cohortCount: cohortCount ?? 0,
  });
});

// GET /churches/:churchId?requesterId= — members only.
router.get("/churches/:churchId", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const membership = await getMembership(churchId, requesterId);
  if (!membership?.is_active) return err(res, "Church not found", 404);

  const { data: church } = await db.from("p2p_churches").select("*").eq("id", churchId).maybeSingle();
  if (!church) return err(res, "Church not found", 404);
  return ok(res, mapChurch(church as Record<string, unknown>));
});

// POST /churches/join — { requesterId, inviteCode }
router.post("/churches/join", async (req, res) => {
  const { requesterId, inviteCode } = req.body as { requesterId?: string; inviteCode?: string };
  if (!requesterId || !inviteCode?.trim()) return err(res, "requesterId and inviteCode are required", 400);

  const { data: church } = await db.from("p2p_churches").select("*").eq("invite_code", inviteCode.trim()).eq("status", "active").maybeSingle();
  if (!church) return err(res, "Invalid invite code", 404);

  const { data: existing } = await db
    .from("p2p_church_members").select("id, is_active").eq("church_id", church.id).eq("user_id", requesterId).maybeSingle();
  if (existing?.is_active) return err(res, "You are already a member of this church", 409);

  if (existing) {
    await db.from("p2p_church_members").update({ is_active: true, role: "member" }).eq("id", existing.id as string);
  } else {
    const { error } = await db.from("p2p_church_members").insert({ church_id: church.id, user_id: requesterId, role: "member", is_active: true });
    if (error) return err(res, error.message, 500);
  }
  await db.from("p2p_profiles").update({ church_id: church.id }).eq("id", requesterId);

  return ok(res, mapChurch(church as Record<string, unknown>));
});

// PUT /churches/:churchId/members/:userId/role — senior_pastor only.
router.put("/churches/:churchId/members/:userId/role", async (req, res) => {
  const { churchId, userId } = req.params;
  const { requesterId, role } = req.body as { requesterId?: string; role?: string };
  if (!requesterId || !role) return err(res, "requesterId and role are required", 400);
  const validRoles = ["discipleship_pastor", "small_group_leader", "peer_guide", "member"];
  if (!validRoles.includes(role)) return err(res, `role must be one of: ${validRoles.join(", ")}`, 400);

  const requester = await getMembership(churchId, requesterId);
  if (requester?.role !== "senior_pastor") return err(res, "Only the senior pastor can change roles", 403);

  const target = await getMembership(churchId, userId);
  if (!target) return err(res, "Member not found", 404);
  if (target.role === "senior_pastor") return err(res, "Cannot change the senior pastor's role", 400);

  const { error } = await db.from("p2p_church_members").update({ role }).eq("church_id", churchId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// DELETE /churches/:churchId/members/:userId — senior/discipleship pastor
// removing someone else, OR any member removing themselves (leaving).
router.delete("/churches/:churchId/members/:userId", async (req, res) => {
  const { churchId, userId } = req.params;
  const { requesterId } = req.body as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const isSelf = requesterId === userId;

  const requester = await getMembership(churchId, requesterId);
  if (!isSelf && (!requester || !PASTOR_ROLES.includes(requester.role))) {
    return err(res, "Only church leadership can remove other members", 403);
  }

  const target = await getMembership(churchId, userId);
  if (target?.role === "senior_pastor") {
    return err(res, "The senior pastor cannot be removed — appoint a new senior pastor first", 400);
  }

  const { error } = await db.from("p2p_church_members").update({ is_active: false }).eq("church_id", churchId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  await db.from("p2p_profiles").update({ church_id: null }).eq("id", userId).eq("church_id", churchId);

  if (!isSelf) {
    await db.from("p2p_notifications").insert({
      user_id: userId, title: "You have been removed from your church",
      message: "A church leader has removed you from the church on P2P Global.",
      notification_type: "church_member_removed", data: { churchId },
    });
  }
  return ok(res, { ok: true });
});

// ── Grove dashboard ───────────────────────────────────────────────────────────

// Duplicated from constants/stages.ts (mobile) — api-server and mobile are
// separate packages with no shared-constants workspace, same reasoning as
// breakRooms.ts's PLAN_CATEGORIES duplication. Keep in sync with STAGES
// there if the growth-point thresholds ever change.
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

async function getActiveChurchMemberIds(churchId: string): Promise<string[]> {
  const { data } = await db.from("p2p_church_members").select("user_id").eq("church_id", churchId).eq("is_active", true);
  return (data ?? []).map((m) => m.user_id as string);
}

// GET /churches/:churchId/grove?requesterId= — leadership only.
router.get("/churches/:churchId/grove", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const memberIds = await getActiveChurchMemberIds(churchId);
  if (!memberIds.length) {
    return ok(res, {
      stageCounts: { dormant_seed: 0, sprout: 0, young_tree: 0, fruitful_tree: 0, forest_builder: 0, forest_of_nations: 0 },
      activeLearners: 0, lessonsThisWeek: 0, modulesCompletedTotal: 0, newMembersThisMonth: 0,
      activePeerGuides: 0, nationsReached: 0, totalGrainPlanted: 0, totalFruitsEarned: 0,
      inactiveMembers: 0, newBelieversWithoutGuides: 0, deepestDiscipleshipChain: 0, recentActivity: [],
    });
  }

  const members = await selectInChunks<{ id: string; full_name: string; growth_level: number | null; grain_count: number | null; created_at: string }>(
    "p2p_profiles", "id,full_name,growth_level,grain_count,created_at", "id", memberIds
  );
  const memberById = new Map(members.map((m) => [m.id, m]));

  const stageCounts: Record<string, number> = { dormant_seed: 0, sprout: 0, young_tree: 0, fruitful_tree: 0, forest_builder: 0, forest_of_nations: 0 };
  for (const m of members) stageCounts[stageKeyForPoints(m.growth_level ?? 0)]++;
  const totalGrainPlanted = members.reduce((sum, m) => sum + (m.grain_count ?? 0), 0);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const progressRows = await selectInChunks<{ user_id: string; completed: boolean; updated_at: string; lesson_id: string }>(
    "p2p_lesson_progress", "user_id,completed,updated_at,lesson_id", "user_id", memberIds
  );
  const activeLearners = new Set(progressRows.filter((p) => p.updated_at >= thirtyDaysAgo).map((p) => p.user_id)).size;
  const lessonsThisWeek = progressRows.filter((p) => p.completed && p.updated_at >= sevenDaysAgo).length;
  const lastActiveByUser = new Map<string, string>();
  for (const p of progressRows) {
    const cur = lastActiveByUser.get(p.user_id);
    if (!cur || p.updated_at > cur) lastActiveByUser.set(p.user_id, p.updated_at);
  }
  const inactiveMembers = memberIds.filter((id) => !((lastActiveByUser.get(id) ?? "") >= fourteenDaysAgo)).length;

  // "Modules completed" — a member has completed a module once every lesson
  // in it is marked complete for them. Computed via aggregation rather than
  // per-member/per-module RPC calls (see discipleship.ts's
  // p2p_module_fully_completed for the single-pair version this generalizes).
  const completedLessonIds = [...new Set(progressRows.filter((p) => p.completed).map((p) => p.lesson_id))];
  const lessonRows = completedLessonIds.length
    ? await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "id", completedLessonIds)
    : [];
  const moduleIdByLesson = new Map(lessonRows.map((l) => [l.id, l.module_id]));
  const allModuleIds = [...new Set(lessonRows.map((l) => l.module_id))];
  const allLessonsByModule = allModuleIds.length
    ? await selectInChunks<{ id: string; module_id: string }>("p2p_lessons", "id,module_id", "module_id", allModuleIds)
    : [];
  const totalLessonsPerModule = new Map<string, number>();
  for (const l of allLessonsByModule) totalLessonsPerModule.set(l.module_id, (totalLessonsPerModule.get(l.module_id) ?? 0) + 1);
  const completedCountByUserModule = new Map<string, number>();
  for (const p of progressRows) {
    if (!p.completed) continue;
    const moduleId = moduleIdByLesson.get(p.lesson_id);
    if (!moduleId) continue;
    const key = `${p.user_id}::${moduleId}`;
    completedCountByUserModule.set(key, (completedCountByUserModule.get(key) ?? 0) + 1);
  }
  let modulesCompletedTotal = 0;
  for (const [key, done] of completedCountByUserModule) {
    const moduleId = key.split("::")[1];
    if (done >= (totalLessonsPerModule.get(moduleId) ?? Infinity)) modulesCompletedTotal++;
  }

  const newMembersThisMonth = members.filter((m) => m.created_at >= monthAgo).length;
  const newBelieversWithoutGuidesCandidates = members.filter((m) => m.created_at >= sixtyDaysAgo);

  const [linksAsDisciple, linksAsMentor, fruitRows] = await Promise.all([
    selectInChunks<{ disciple_id: string; mentor_id: string; active: boolean }>("p2p_discipleship_links", "disciple_id,mentor_id,active", "disciple_id", memberIds),
    selectInChunks<{ mentor_id: string; disciple_id: string; active: boolean }>("p2p_discipleship_links", "mentor_id,disciple_id,active", "mentor_id", memberIds),
    selectInChunks<{ user_id: string; awarded_at: string; fruit_key: string }>("p2p_user_fruits", "user_id,awarded_at,fruit_key", "user_id", memberIds),
  ]);
  const hasActiveGuide = new Set(linksAsDisciple.filter((l: any) => l.active !== false).map((l) => l.disciple_id));
  const newBelieversWithoutGuides = newBelieversWithoutGuidesCandidates.filter((m) => !hasActiveGuide.has(m.id)).length;
  const activePeerGuides = new Set(linksAsMentor.map((l) => l.mentor_id)).size;
  const totalFruitsEarned = fruitRows.length;

  // Nations reached — countries of members' disciples (people church
  // members are guiding), matching the spec's definition exactly.
  const discipleIds = [...new Set(linksAsMentor.map((l) => l.disciple_id))];
  const discipleProfiles = discipleIds.length
    ? await selectInChunks<{ id: string; country_code: string | null }>("p2p_profiles", "id,country_code", "id", discipleIds)
    : [];
  const nationsReached = new Set(discipleProfiles.map((p) => p.country_code).filter(Boolean)).size;

  // Deepest discipleship chain — walk each member's mentor lineage upward
  // (same bounded-loop pattern as profiles.ts's ancestry builder) and take
  // the max depth found. Bounded to 20 generations, matching that precedent.
  const mentorByDisciple = new Map<string, string>();
  const allLinksTouchingMembers = [...linksAsDisciple, ...linksAsMentor];
  for (const l of allLinksTouchingMembers as any[]) {
    if (l.active !== false) mentorByDisciple.set(l.disciple_id, l.mentor_id);
  }
  let deepestDiscipleshipChain = 0;
  for (const id of memberIds) {
    let depth = 0;
    let current = id;
    const seen = new Set<string>();
    while (depth < 20) {
      const mentor = mentorByDisciple.get(current);
      if (!mentor || seen.has(mentor)) break;
      seen.add(mentor);
      depth++;
      current = mentor;
    }
    deepestDiscipleshipChain = Math.max(deepestDiscipleshipChain, depth);
  }

  const recentActivity: { userDisplayName: string; action: string; createdAt: string }[] = [];
  for (const p of progressRows.filter((p) => p.completed && p.updated_at >= sevenDaysAgo)) {
    recentActivity.push({ userDisplayName: memberById.get(p.user_id)?.full_name ?? "A member", action: "completed a lesson", createdAt: p.updated_at });
  }
  for (const f of fruitRows.filter((f) => f.awarded_at >= sevenDaysAgo)) {
    recentActivity.push({ userDisplayName: memberById.get(f.user_id)?.full_name ?? "A member", action: `earned ${f.fruit_key.replace(/_/g, " ")}`, createdAt: f.awarded_at });
  }
  for (const m of members.filter((m) => m.created_at >= sevenDaysAgo)) {
    recentActivity.push({ userDisplayName: m.full_name ?? "A member", action: "joined the network", createdAt: m.created_at });
  }
  recentActivity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return ok(res, {
    stageCounts, activeLearners, lessonsThisWeek, modulesCompletedTotal, newMembersThisMonth,
    activePeerGuides, nationsReached, totalGrainPlanted, totalFruitsEarned,
    inactiveMembers, newBelieversWithoutGuides, deepestDiscipleshipChain,
    recentActivity: recentActivity.slice(0, 20),
  });
});

// ── Members list / profile ────────────────────────────────────────────────────

// GET /churches/:churchId/members?requesterId=&search=&activeOnly=&cohortId=
router.get("/churches/:churchId/members", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId, search } = req.query as { requesterId?: string; search?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { data: memberships } = await db
    .from("p2p_church_members")
    .select("user_id, role, is_active, profile_visible_to_leadership, joined_at")
    .eq("church_id", churchId).eq("is_active", true);
  const rows = memberships ?? [];
  if (!rows.length) return ok(res, []);

  const memberIds = rows.map((m) => m.user_id as string);
  let profiles = await selectInChunks<Record<string, unknown>>(
    "p2p_profiles",
    "id,username,full_name,photo_url,country,growth_level,last_active_at,grain_count",
    "id", memberIds
  );
  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    profiles = profiles.filter((p) => `${p.full_name ?? ""} ${p.username ?? ""}`.toLowerCase().includes(q));
  }
  const profileById = new Map(profiles.map((p) => [p.id as string, p]));

  const [linksAsDisciple, fruitCounts] = await Promise.all([
    selectInChunks<{ disciple_id: string; active: boolean }>("p2p_discipleship_links", "disciple_id,active", "disciple_id", memberIds),
    selectInChunks<{ user_id: string }>("p2p_user_fruits", "user_id", "user_id", memberIds),
  ]);
  const hasGuideByUser = new Set(linksAsDisciple.filter((l) => l.active).map((l) => l.disciple_id));
  const fruitCountByUser = new Map<string, number>();
  for (const f of fruitCounts) fruitCountByUser.set(f.user_id, (fruitCountByUser.get(f.user_id) ?? 0) + 1);

  return ok(res, rows
    .filter((m) => profileById.has(m.user_id as string))
    .map((m) => {
      const p = profileById.get(m.user_id as string)!;
      if (!m.profile_visible_to_leadership) {
        return { userId: m.user_id, role: m.role, visible: false, joinedAt: m.joined_at };
      }
      return {
        userId: m.user_id, role: m.role, visible: true, joinedAt: m.joined_at,
        username: p.username ?? null, displayName: p.full_name ?? "A member", photoUrl: p.photo_url ?? null,
        country: p.country ?? null, treeStage: stageKeyForPoints((p.growth_level as number) ?? 0),
        lastActiveAt: p.last_active_at ?? null, hasPeerGuide: hasGuideByUser.has(m.user_id as string),
        fruitsCount: fruitCountByUser.get(m.user_id as string) ?? 0, grainCount: p.grain_count ?? 0,
      };
    }));
});

// GET /churches/:churchId/members/:userId?requesterId= — leadership only.
router.get("/churches/:churchId/members/:userId", async (req, res) => {
  const { churchId, userId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const target = await getMembership(churchId, userId);
  if (!target) return err(res, "Member not found", 404);
  if (!target.is_active) return err(res, "Member not found", 404);

  const { data: memberRow } = await db
    .from("p2p_church_members").select("profile_visible_to_leadership, admin_notes")
    .eq("church_id", churchId).eq("user_id", userId).maybeSingle();
  if (memberRow && !memberRow.profile_visible_to_leadership) {
    return err(res, "This member has opted out of leadership visibility", 403);
  }

  const { data: profile } = await db
    .from("p2p_profiles")
    .select("id,username,full_name,photo_url,country,growth_level,last_active_at,grain_count")
    .eq("id", userId).maybeSingle();
  if (!profile) return err(res, "Member not found", 404);

  const [{ data: guideLink }, { data: guidingLinks }, { data: fruits }, { data: cohortLinks }] = await Promise.all([
    db.from("p2p_discipleship_links").select("mentor_id").eq("disciple_id", userId).eq("active", true).maybeSingle(),
    db.from("p2p_discipleship_links").select("disciple_id").eq("mentor_id", userId).eq("active", true),
    db.from("p2p_user_fruits").select("fruit_key,awarded_at").eq("user_id", userId).order("awarded_at", { ascending: false }),
    db.from("p2p_church_cohort_members").select("cohort_id, status, p2p_church_cohorts(name)").eq("user_id", userId),
  ]);

  let guideProfile: { username?: string; full_name?: string; country?: string } | null = null;
  if (guideLink?.mentor_id) {
    const { data } = await db.from("p2p_profiles").select("username,full_name,country").eq("id", guideLink.mentor_id).maybeSingle();
    guideProfile = data;
  }

  const discipleIds = (guidingLinks ?? []).map((l) => l.disciple_id as string);
  const discipleCountries = discipleIds.length
    ? await selectInChunks<{ country_code: string | null }>("p2p_profiles", "country_code", "id", discipleIds)
    : [];
  const nationsCount = new Set(discipleCountries.map((d) => d.country_code).filter(Boolean)).size;

  return ok(res, {
    userId: profile.id, username: profile.username, displayName: profile.full_name ?? "A member",
    photoUrl: profile.photo_url ?? null, country: profile.country ?? null,
    treeStage: stageKeyForPoints((profile.growth_level as number) ?? 0), growthLevel: profile.growth_level ?? 0,
    lastActiveAt: profile.last_active_at ?? null,
    peerGuide: guideProfile ? { username: guideProfile.username, displayName: guideProfile.full_name, country: guideProfile.country } : null,
    guidingCount: (guidingLinks ?? []).length, nationsGuided: nationsCount,
    fruits: (fruits ?? []).map((f) => ({ key: f.fruit_key, awardedAt: f.awarded_at })),
    grainCount: profile.grain_count ?? 0,
    cohorts: (cohortLinks ?? []).map((c: any) => ({ cohortId: c.cohort_id, status: c.status, name: c.p2p_church_cohorts?.name ?? "Cohort" })),
    adminNotes: memberRow?.admin_notes ?? null,
  });
});

// PUT /churches/:churchId/members/:userId/notes — leadership only.
router.put("/churches/:churchId/members/:userId/notes", async (req, res) => {
  const { churchId, userId } = req.params;
  const { requesterId, notes } = req.body as { requesterId?: string; notes?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { error } = await db.from("p2p_church_members").update({ admin_notes: notes?.trim() || null }).eq("church_id", churchId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// ── Cohorts ───────────────────────────────────────────────────────────────────

function mapCohort(row: Record<string, unknown>) {
  return {
    id: row.id, churchId: row.church_id, name: row.name, description: row.description ?? null,
    curriculumId: row.curriculum_id ?? null, moduleId: row.module_id ?? null, leaderId: row.leader_id ?? null,
    targetStartDate: row.target_start_date ?? null, targetEndDate: row.target_end_date ?? null,
    maxMembers: row.max_members ?? null, status: row.status, createdAt: row.created_at,
  };
}

router.post("/churches/:churchId/cohorts", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId, name, description, curriculumId, moduleId, leaderId, targetStartDate, targetEndDate, maxMembers } = req.body as Record<string, any>;
  if (!requesterId || !name?.trim()) return err(res, "requesterId and name are required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !PASTOR_ROLES.includes(requester.role)) return err(res, "Only senior/discipleship pastors can create cohorts", 403);

  const { data, error } = await db.from("p2p_church_cohorts").insert({
    church_id: churchId, name: name.trim(), description: description?.trim() || null,
    curriculum_id: curriculumId || null, module_id: moduleId || null, leader_id: leaderId || null,
    target_start_date: targetStartDate || null, target_end_date: targetEndDate || null,
    max_members: maxMembers || null, status: "forming", created_by: requesterId,
  }).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to create cohort", 500);
  return res.status(201).json(mapCohort(data as Record<string, unknown>));
});

router.get("/churches/:churchId/cohorts", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  const { data: cohorts, error } = await db.from("p2p_church_cohorts").select("*").eq("church_id", churchId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  const cohortIds = (cohorts ?? []).map((c) => c.id as string);
  const memberCounts = cohortIds.length
    ? await selectInChunks<{ cohort_id: string }>("p2p_church_cohort_members", "cohort_id", "cohort_id", cohortIds)
    : [];
  const countByCohort = new Map<string, number>();
  for (const m of memberCounts) countByCohort.set(m.cohort_id, (countByCohort.get(m.cohort_id) ?? 0) + 1);

  const leaderIds = [...new Set((cohorts ?? []).map((c) => c.leader_id).filter(Boolean))] as string[];
  const leaders = leaderIds.length ? await selectInChunks<{ id: string; username: string; full_name: string }>("p2p_profiles", "id,username,full_name", "id", leaderIds) : [];
  const leaderById = new Map(leaders.map((l) => [l.id, l]));

  return ok(res, (cohorts ?? []).map((c) => ({
    ...mapCohort(c as Record<string, unknown>),
    memberCount: countByCohort.get(c.id as string) ?? 0,
    leaderUsername: c.leader_id ? leaderById.get(c.leader_id as string)?.username ?? null : null,
    leaderName: c.leader_id ? leaderById.get(c.leader_id as string)?.full_name ?? null : null,
  })));
});

router.put("/churches/:churchId/cohorts/:cohortId", async (req, res) => {
  const { churchId, cohortId } = req.params;
  const { requesterId, ...fields } = req.body as Record<string, any>;
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !PASTOR_ROLES.includes(requester.role)) return err(res, "Only senior/discipleship pastors can update cohorts", 403);

  const updates: Record<string, unknown> = {};
  if (fields.name !== undefined) updates.name = fields.name;
  if (fields.description !== undefined) updates.description = fields.description;
  if (fields.leaderId !== undefined) updates.leader_id = fields.leaderId;
  if (fields.targetStartDate !== undefined) updates.target_start_date = fields.targetStartDate;
  if (fields.targetEndDate !== undefined) updates.target_end_date = fields.targetEndDate;
  if (fields.maxMembers !== undefined) updates.max_members = fields.maxMembers;
  if (fields.status !== undefined) updates.status = fields.status;
  if (!Object.keys(updates).length) return err(res, "No fields to update", 400);

  const { data, error } = await db.from("p2p_church_cohorts").update(updates).eq("id", cohortId).eq("church_id", churchId).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Cohort not found", 404);
  return ok(res, mapCohort(data as Record<string, unknown>));
});

router.post("/churches/:churchId/cohorts/:cohortId/members", async (req, res) => {
  const { churchId, cohortId } = req.params;
  const { requesterId, userId, username } = req.body as { requesterId?: string; userId?: string; username?: string };
  if (!requesterId || (!userId && !username?.trim())) return err(res, "requesterId and userId or username are required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  let targetUserId = userId;
  if (!targetUserId && username) {
    const { data } = await db.from("p2p_profiles").select("id").eq("username", username.trim().toLowerCase()).maybeSingle();
    if (!data) return err(res, "No user found with that username", 404);
    targetUserId = data.id as string;
  }

  const membership = await getMembership(churchId, targetUserId as string);
  if (!membership?.is_active) return err(res, "That user is not a member of this church", 400);

  const { error } = await db.from("p2p_church_cohort_members").upsert(
    { cohort_id: cohortId, user_id: targetUserId, status: "active" },
    { onConflict: "cohort_id,user_id" }
  );
  if (error) return err(res, error.message, 500);
  return res.status(201).json({ ok: true });
});

router.delete("/churches/:churchId/cohorts/:cohortId/members/:userId", async (req, res) => {
  const { churchId, cohortId, userId } = req.params;
  const { requesterId } = req.body as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { error } = await db.from("p2p_church_cohort_members").delete().eq("cohort_id", cohortId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// ── Announcements ─────────────────────────────────────────────────────────────

function mapAnnouncement(row: Record<string, unknown>, authorName?: string | null) {
  return {
    id: row.id, churchId: row.church_id, title: row.title, body: row.body,
    authorId: row.author_id, authorName: authorName ?? null,
    isPinned: row.is_pinned ?? false, createdAt: row.created_at, expiresAt: row.expires_at ?? null,
  };
}

router.post("/churches/:churchId/announcements", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId, title, body, expiresAt } = req.body as { requesterId?: string; title?: string; body?: string; expiresAt?: string };
  if (!requesterId || !title?.trim() || !body?.trim()) return err(res, "requesterId, title, and body are required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { data, error } = await db.from("p2p_church_announcements").insert({
    church_id: churchId, title: title.trim(), body: body.trim(), author_id: requesterId, expires_at: expiresAt || null,
  }).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to post announcement", 500);

  const memberIds = (await getActiveChurchMemberIds(churchId)).filter((id) => id !== requesterId);
  if (memberIds.length) {
    await db.from("p2p_notifications").insert(
      memberIds.map((id) => ({
        user_id: id, title: `📢 ${title.trim()}`, message: body.trim(),
        notification_type: "church_announcement", data: { churchId, announcementId: data.id },
      }))
    );
  }
  return res.status(201).json(mapAnnouncement(data as Record<string, unknown>));
});

router.get("/churches/:churchId/announcements", async (req, res) => {
  const { churchId } = req.params;
  const { requesterId } = req.query as { requesterId?: string };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  const { data, error } = await db
    .from("p2p_church_announcements").select("*").eq("church_id", churchId)
    .order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  const authorIds = [...new Set((data ?? []).map((a) => a.author_id as string))];
  const authors = authorIds.length ? await selectInChunks<{ id: string; full_name: string }>("p2p_profiles", "id,full_name", "id", authorIds) : [];
  const nameById = new Map(authors.map((a) => [a.id, a.full_name]));

  return ok(res, (data ?? []).map((a) => mapAnnouncement(a as Record<string, unknown>, nameById.get(a.author_id as string) ?? null)));
});

router.put("/churches/:churchId/announcements/:id/pin", async (req, res) => {
  const { churchId, id } = req.params;
  const { requesterId, pinned } = req.body as { requesterId?: string; pinned?: boolean };
  if (!requesterId) return err(res, "requesterId is required", 400);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { error } = await db.from("p2p_church_announcements").update({ is_pinned: pinned !== false }).eq("id", id).eq("church_id", churchId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

export default router;