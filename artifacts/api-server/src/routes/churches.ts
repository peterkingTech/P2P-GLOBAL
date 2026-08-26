import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { verifyCaller } from "../lib/supabase";

const router = Router();

// Church Portal hardening — every endpoint below used to take a
// caller-supplied requesterId from the body/query and trust it outright, the
// same shape calls.ts/notifications.ts/groupStudy.ts moved away from via
// verifyCaller (a real Supabase JWT check). That meant any authenticated
// caller could impersonate any other user in every church-scoped action
// (register a church as someone else, read/manage another church's members,
// remove admins, etc.) just by knowing their uuid. Identity now always comes
// from verifyCaller; authorization still runs inline against
// p2p_church_members exactly as before, orthogonal to the global admin_*
// role system admin.ts gates on.
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

async function getChurch(churchId: string) {
  const { data } = await db.from("p2p_churches").select("*").eq("id", churchId).maybeSingle();
  return data as Record<string, unknown> | null;
}

// Ownership is a distinct authorization axis from role (LEADERSHIP_ROLES/
// PASTOR_ROLES): it's "the person who created THIS church", independent of
// whatever role they or anyone else currently holds. A senior_pastor
// appointed later — or one who simply isn't the original creator — must
// still be blocked from ownership-level actions (branding, name/description,
// social media, location visibility). Kept as its own helper, syntactically
// distinct from the role-array checks, so every call site is obviously using
// the new, separate gate rather than the existing role system.
function isCreator(church: Record<string, unknown> | null, requesterId: string): boolean {
  return !!church && church.created_by === requesterId;
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
    churchType: row.church_type ?? null, churchTypeOther: row.church_type_other ?? null,
    locationHidden: row.location_hidden ?? false, churchSlug: row.church_slug ?? null,
  };
}

function mapSocialAccount(row: Record<string, unknown>) {
  return {
    id: row.id, churchId: row.church_id, platform: row.platform,
    handleOrUrl: row.handle_or_url, displayOrder: row.display_order ?? 0,
  };
}

const SOCIAL_PLATFORMS = ["facebook", "instagram", "youtube", "tiktok", "x_twitter", "whatsapp", "telegram", "website", "other"];
const MAX_SOCIAL_ACCOUNTS = 8;

// ── Registration / membership ────────────────────────────────────────────────

// POST /churches — any authenticated user registers a church and becomes
// its senior_pastor.
router.post("/churches", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const {
    name, description, city, country, country_code, timezone,
    denomination, language_code, contact_email, contact_name, website,
    church_type, church_type_other, location_hidden, logo_url, social_accounts,
  } = req.body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim() || typeof country !== "string" || !country.trim()) {
    return err(res, "name and country are required", 400);
  }
  const socialAccounts = Array.isArray(social_accounts) ? social_accounts as { platform?: string; handleOrUrl?: string }[] : [];
  if (socialAccounts.length > MAX_SOCIAL_ACCOUNTS) return err(res, `A church may list at most ${MAX_SOCIAL_ACCOUNTS} social media accounts`, 400);
  for (const s of socialAccounts) {
    if (!s.platform || !SOCIAL_PLATFORMS.includes(s.platform)) return err(res, `Invalid social platform: ${s.platform}`, 400);
    if (!s.handleOrUrl?.trim()) return err(res, "Each social media account needs a handle or URL", 400);
  }

  const { data: existingMembership } = await db
    .from("p2p_church_members").select("id").eq("user_id", requesterId as string).eq("is_active", true).maybeSingle();
  if (existingMembership) return err(res, "You already belong to a church", 409);

  let inviteCode = `${slugify([name, city].filter(Boolean).join(" "))}-${randomSuffix()}`;
  // Vanishingly unlikely, but the column is UNIQUE — retry once on collision
  // rather than fail the whole registration over it.
  const { data: clash } = await db.from("p2p_churches").select("id").eq("invite_code", inviteCode).maybeSingle();
  if (clash) inviteCode = `${slugify([name, city].filter(Boolean).join(" "))}-${randomSuffix()}`;

  const { data: church, error } = await db
    .from("p2p_churches")
    .insert({
      name: (name as string).trim(), description: typeof description === "string" ? description.trim() || null : null,
      city: typeof city === "string" ? city.trim() || null : null,
      country: (country as string).trim(), country_code: country_code || null, timezone: timezone || null,
      denomination: denomination || null, language_code: language_code || "en",
      contact_email: typeof contact_email === "string" ? contact_email.trim() || null : null,
      contact_name: typeof contact_name === "string" ? contact_name.trim() || null : null,
      website: typeof website === "string" ? website.trim() || null : null,
      invite_code: inviteCode, created_by: requesterId,
      church_type: church_type || null, church_type_other: church_type_other || null,
      location_hidden: location_hidden === true, logo_url: logo_url || null,
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

  if (socialAccounts.length) {
    await db.from("p2p_church_social_accounts").insert(
      socialAccounts.map((s, i) => ({
        church_id: church.id, platform: s.platform, handle_or_url: s.handleOrUrl!.trim(), display_order: i,
      }))
    );
  }

  return res.status(201).json(mapChurch(church as Record<string, unknown>));
});

// GET /churches/check-duplicate?name=&city=&country=&website= (identity from Bearer token)
// Soft, non-blocking signal for the registration Review step — never
// automatically merges or rejects, per the spec's explicit "many churches
// can share names" guidance.
router.get("/churches/check-duplicate", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { name, country, website } = req.query as Record<string, string | undefined>;
  if (!name?.trim() && !website?.trim()) return ok(res, { matches: [] });

  const orParts: string[] = [];
  if (name?.trim() && country?.trim()) orParts.push(`and(name.ilike.%${name.trim().replace(/[%,]/g, "")}%,country.eq.${country.trim().replace(/,/g, "")})`);
  else if (name?.trim()) orParts.push(`name.ilike.%${name.trim().replace(/[%,]/g, "")}%`);
  if (website?.trim()) orParts.push(`website.eq.${website.trim().replace(/,/g, "")}`);
  if (!orParts.length) return ok(res, { matches: [] });

  const { data } = await db
    .from("p2p_churches").select("id,name,city,country,website")
    .eq("status", "active").or(orParts.join(",")).limit(5);
  return ok(res, { matches: (data ?? []).map((c) => ({ id: c.id, name: c.name, city: c.city, country: c.country, website: c.website })) });
});

// GET /churches/my-church (identity from Bearer token)
router.get("/churches/my-church", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);

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

// GET /churches/:churchId — members only (identity from Bearer token).
// GET /churches/by-code/:inviteCode — public, no auth. Registered before the
// /churches/:churchId route below so Express doesn't swallow "by-code" as a
// churchId param. Powers the Netlify share-landing page a scanned QR/link
// opens for someone who doesn't have the app installed yet — deliberately
// returns only what's safe to show anonymously (matches the personal invite
// landing page's same public-profile-preview scope).
router.get("/churches/by-code/:inviteCode", async (req, res) => {
  const { inviteCode } = req.params;
  const { data: church } = await db
    .from("p2p_churches").select("id,name,city,country,logo_url,location_hidden")
    .eq("invite_code", inviteCode).eq("status", "active").maybeSingle();
  if (!church) return err(res, "Church not found", 404);

  const { count: memberCount } = await db
    .from("p2p_church_members").select("id", { count: "exact", head: true })
    .eq("church_id", church.id as string).eq("is_active", true);

  return ok(res, {
    church: {
      name: church.name,
      city: church.location_hidden ? null : (church.city ?? null),
      country: church.location_hidden ? null : church.country,
      logoUrl: church.logo_url ?? null,
      memberCount: memberCount ?? 0,
    },
  });
});

router.get("/churches/:churchId", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const membership = await getMembership(churchId, requesterId);
  if (!membership?.is_active) return err(res, "Church not found", 404);

  const { data: church } = await db.from("p2p_churches").select("*").eq("id", churchId).maybeSingle();
  if (!church) return err(res, "Church not found", 404);
  return ok(res, mapChurch(church as Record<string, unknown>));
});

// PUT /churches/:churchId — creator-only. Services General/Profile/Branding
// settings screens, each calling this with a different field subset (same
// shape as account.tsx's bio/photo/email sections all calling one
// updateProfile()). Ownership fields never trusted from elsewhere.
const CHURCH_EDITABLE_FIELDS: Record<string, string> = {
  name: "name", description: "description", churchType: "church_type", churchTypeOther: "church_type_other",
  website: "website", contactName: "contact_name", contactEmail: "contact_email",
  city: "city", country: "country", countryCode: "country_code", timezone: "timezone",
  denomination: "denomination", languageCode: "language_code", locationHidden: "location_hidden",
  logoUrl: "logo_url",
};
router.put("/churches/:churchId", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const fields = req.body as Record<string, unknown>;

  const church = await getChurch(churchId);
  if (!church) return err(res, "Church not found", 404);
  if (!isCreator(church, requesterId)) {
    return err(res, "Only the church's original creator can change these settings", 403);
  }

  const updates: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(CHURCH_EDITABLE_FIELDS)) {
    if (fields[key] !== undefined) updates[column] = fields[key];
  }
  if (!Object.keys(updates).length) return err(res, "No fields to update", 400);
  if (typeof updates.name === "string" && !updates.name.trim()) return err(res, "Church name cannot be empty", 400);

  const { data, error } = await db.from("p2p_churches").update(updates).eq("id", churchId).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to update church", 500);
  return ok(res, mapChurch(data as Record<string, unknown>));
});

// GET /churches/:churchId/social-accounts — member-readable (identity from Bearer token).
router.get("/churches/:churchId/social-accounts", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  const { data, error } = await db.from("p2p_church_social_accounts").select("*").eq("church_id", churchId).order("display_order", { ascending: true });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapSocialAccount(r as Record<string, unknown>)));
});

// PUT /churches/:churchId/social-accounts — creator-only, full replacement.
// Delete-all-then-bulk-insert avoids display-order-sync edge cases a
// granular per-row API would introduce for what's edited as one repeatable
// list in the settings UI.
router.put("/churches/:churchId/social-accounts", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { accounts } = req.body as { accounts?: { platform?: string; handleOrUrl?: string }[] };
  const church = await getChurch(churchId);
  if (!church) return err(res, "Church not found", 404);
  if (!isCreator(church, requesterId)) return err(res, "Only the church's original creator can manage social media accounts", 403);

  const list = Array.isArray(accounts) ? accounts : [];
  if (list.length > MAX_SOCIAL_ACCOUNTS) return err(res, `A church may list at most ${MAX_SOCIAL_ACCOUNTS} social media accounts`, 400);
  for (const s of list) {
    if (!s.platform || !SOCIAL_PLATFORMS.includes(s.platform)) return err(res, `Invalid social platform: ${s.platform}`, 400);
    if (!s.handleOrUrl?.trim()) return err(res, "Each social media account needs a handle or URL", 400);
  }

  const { error: delErr } = await db.from("p2p_church_social_accounts").delete().eq("church_id", churchId);
  if (delErr) return err(res, delErr.message, 500);
  if (list.length) {
    const { error: insErr } = await db.from("p2p_church_social_accounts").insert(
      list.map((s, i) => ({ church_id: churchId, platform: s.platform, handle_or_url: s.handleOrUrl!.trim(), display_order: i }))
    );
    if (insErr) return err(res, insErr.message, 500);
  }
  return ok(res, { ok: true });
});

// POST /churches/join — { inviteCode } (identity from Bearer token)
router.post("/churches/join", async (req, res) => {
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { inviteCode } = req.body as { inviteCode?: string };
  if (!inviteCode?.trim()) return err(res, "inviteCode is required", 400);

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

// PUT /churches/:churchId/members/:userId/role — General Overseer (the
// church's creator) only. This is the church's Church Admin management
// action (assigning/revoking discipleship_pastor/small_group_leader —
// labeled "Church Admin" in the UI, see constants/churchRoles.ts), so it's
// gated on ownership (isCreator) rather than the broader senior_pastor role
// check this used to have — a defense-in-depth distinction, since today
// senior_pastor is structurally always the creator (nothing else can grant
// or move that role), but ownership is the actually-intended authority axis
// per the Church Portal spec ("only the General Overseer manages church
// administrators"), not incidental role equivalence. Also blocks a caller
// from changing their own role through this endpoint, and blocks targeting
// the creator, so the General Overseer can never be demoted or reassigned
// by this route.
router.put("/churches/:churchId/members/:userId/role", async (req, res) => {
  const { churchId, userId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { role } = req.body as { role?: string };
  if (!role) return err(res, "role is required", 400);
  const validRoles = ["discipleship_pastor", "small_group_leader", "peer_guide", "member"];
  if (!validRoles.includes(role)) return err(res, `role must be one of: ${validRoles.join(", ")}`, 400);

  const church = await getChurch(churchId);
  if (!church) return err(res, "Church not found", 404);
  if (!isCreator(church, requesterId)) return err(res, "Only the General Overseer can change member roles", 403);
  if (requesterId === userId) return err(res, "You cannot change your own role", 400);

  const target = await getMembership(churchId, userId);
  if (!target) return err(res, "Member not found", 404);
  if (isCreator(church, userId) || target.role === "senior_pastor") {
    return err(res, "The General Overseer's role cannot be changed", 400);
  }

  const { error } = await db.from("p2p_church_members").update({ role }).eq("church_id", churchId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// DELETE /churches/:churchId/members/:userId — senior/discipleship pastor
// removing someone else, OR any member removing themselves (leaving). A
// Church Admin (discipleship_pastor/small_group_leader) may still remove an
// ordinary member, but removing a FELLOW Church Admin is restricted to the
// General Overseer — "GO manages admins" shouldn't mean admins manage each
// other. The General Overseer themself can never be removed by anyone.
const CHURCH_ADMIN_ROLES = ["discipleship_pastor", "small_group_leader"];
router.delete("/churches/:churchId/members/:userId", async (req, res) => {
  const { churchId, userId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const isSelf = requesterId === userId;

  const requester = await getMembership(churchId, requesterId);
  if (!isSelf && (!requester || !PASTOR_ROLES.includes(requester.role))) {
    return err(res, "Only church leadership can remove other members", 403);
  }

  const church = await getChurch(churchId);
  if (!church) return err(res, "Church not found", 404);
  const target = await getMembership(churchId, userId);
  if (target?.role === "senior_pastor" || isCreator(church, userId)) {
    return err(res, "The General Overseer cannot be removed", 400);
  }
  if (!isSelf && target && CHURCH_ADMIN_ROLES.includes(target.role) && !isCreator(church, requesterId)) {
    return err(res, "Only the General Overseer can remove a Church Admin", 403);
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

// GET /churches/:churchId/grove — leadership only (identity from Bearer token).
router.get("/churches/:churchId/grove", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
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

// GET /churches/:churchId/members?search=&activeOnly=&cohortId= (identity from Bearer token)
router.get("/churches/:churchId/members", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { search } = req.query as { search?: string };
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

// GET /churches/:churchId/members/:userId — leadership only (identity from Bearer token).
router.get("/churches/:churchId/members/:userId", async (req, res) => {
  const { churchId, userId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { notes } = req.body as { notes?: string };
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { name, description, curriculumId, moduleId, leaderId, targetStartDate, targetEndDate, maxMembers } = req.body as Record<string, any>;
  if (!name?.trim()) return err(res, "name is required", 400);
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const fields = req.body as Record<string, any>;
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { userId, username } = req.body as { userId?: string; username?: string };
  if (!userId && !username?.trim()) return err(res, "userId or username is required", 400);
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
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { error } = await db.from("p2p_church_cohort_members").delete().eq("cohort_id", cohortId).eq("user_id", userId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// ── Announcements ─────────────────────────────────────────────────────────────

const ANNOUNCEMENT_TYPES = ["general", "bible_study", "discipleship", "prayer", "learning_goal", "study_plan", "event", "important", "reminder", "other"];
const MAX_FEATURED_ANNOUNCEMENTS = 3;

function mapAnnouncement(row: Record<string, unknown>, authorName?: string | null) {
  return {
    id: row.id, churchId: row.church_id, title: row.title, body: row.body,
    authorId: row.author_id, authorName: authorName ?? null,
    isPinned: row.is_pinned ?? false, createdAt: row.created_at, expiresAt: row.expires_at ?? null,
    announcementType: row.announcement_type ?? "general", announcementTypeOther: row.announcement_type_other ?? null,
    imageUrl: row.image_url ?? null, videoUrl: row.video_url ?? null,
    publishAt: row.publish_at ?? null, status: row.status ?? "published",
    isFeatured: row.is_featured ?? false, audience: row.audience ?? "entire_church",
    updatedAt: row.updated_at ?? row.created_at,
  };
}

async function notifyChurchAnnouncement(churchId: string, authorId: string, title: string, body: string, announcementId: string) {
  const memberIds = (await getActiveChurchMemberIds(churchId)).filter((id) => id !== authorId);
  if (!memberIds.length) return;
  await db.from("p2p_notifications").insert(
    memberIds.map((id) => ({
      user_id: id, title: `📢 ${title}`, message: body,
      notification_type: "church_announcement", data: { churchId, announcementId },
    }))
  );
}

router.post("/churches/:churchId/announcements", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const {
    title, body, expiresAt, announcementType, announcementTypeOther,
    imageUrl, videoUrl, publishAt, isFeatured,
  } = req.body as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string" || !body.trim()) {
    return err(res, "title and body are required", 400);
  }
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const type = typeof announcementType === "string" && ANNOUNCEMENT_TYPES.includes(announcementType) ? announcementType : "general";
  if (isFeatured === true) {
    const { count } = await db.from("p2p_church_announcements").select("id", { count: "exact", head: true }).eq("church_id", churchId).eq("is_featured", true);
    if ((count ?? 0) >= MAX_FEATURED_ANNOUNCEMENTS) return err(res, `Only ${MAX_FEATURED_ANNOUNCEMENTS} announcements can be featured at once — unfeature one first`, 400);
  }

  // status is computed server-side, never trusted from the client.
  const publishAtIso = typeof publishAt === "string" && publishAt ? publishAt : null;
  const status = !publishAtIso || new Date(publishAtIso) <= new Date() ? "published" : "scheduled";

  const { data, error } = await db.from("p2p_church_announcements").insert({
    church_id: churchId, title: (title as string).trim(), body: (body as string).trim(), author_id: requesterId,
    expires_at: expiresAt || null, announcement_type: type,
    announcement_type_other: type === "other" ? (announcementTypeOther as string)?.trim() || null : null,
    image_url: imageUrl || null, video_url: videoUrl || null, publish_at: publishAtIso, status,
    is_featured: isFeatured === true,
  }).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to post announcement", 500);

  if (status === "published") {
    await notifyChurchAnnouncement(churchId, requesterId as string, (title as string).trim(), (body as string).trim(), data.id as string);
  }
  return res.status(201).json(mapAnnouncement(data as Record<string, unknown>));
});

// PUT /churches/:churchId/announcements/:id — general edit (leadership).
// The narrow existing .../pin route below is left unmodified for pin-only toggles.
router.put("/churches/:churchId/announcements/:id", async (req, res) => {
  const { churchId, id } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const fields = req.body as Record<string, unknown>;
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  if (fields.isFeatured === true) {
    const { count } = await db.from("p2p_church_announcements").select("id", { count: "exact", head: true }).eq("church_id", churchId).eq("is_featured", true).neq("id", id);
    if ((count ?? 0) >= MAX_FEATURED_ANNOUNCEMENTS) return err(res, `Only ${MAX_FEATURED_ANNOUNCEMENTS} announcements can be featured at once — unfeature one first`, 400);
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof fields.title === "string") updates.title = fields.title.trim();
  if (typeof fields.body === "string") updates.body = fields.body.trim();
  if (fields.announcementType !== undefined && ANNOUNCEMENT_TYPES.includes(fields.announcementType as string)) updates.announcement_type = fields.announcementType;
  if (fields.announcementTypeOther !== undefined) updates.announcement_type_other = fields.announcementTypeOther;
  if (fields.imageUrl !== undefined) updates.image_url = fields.imageUrl;
  if (fields.videoUrl !== undefined) updates.video_url = fields.videoUrl;
  if (fields.expiresAt !== undefined) updates.expires_at = fields.expiresAt;
  if (fields.isFeatured !== undefined) updates.is_featured = fields.isFeatured;
  // Re-publishing (status -> published) or rescheduling recomputes status
  // server-side, same rule as creation — the client can only ask, not set it directly.
  if (fields.publishAt !== undefined || fields.status !== undefined) {
    const publishAtIso = typeof fields.publishAt === "string" && fields.publishAt ? fields.publishAt : null;
    updates.publish_at = publishAtIso;
    if (fields.status === "draft" || fields.status === "archived") {
      updates.status = fields.status;
    } else {
      updates.status = !publishAtIso || new Date(publishAtIso) <= new Date() ? "published" : "scheduled";
    }
  }

  const { data, error } = await db.from("p2p_church_announcements").update(updates).eq("id", id).eq("church_id", churchId).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Announcement not found", 404);
  return ok(res, mapAnnouncement(data as Record<string, unknown>));
});

router.get("/churches/:churchId/announcements", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { includeAll } = req.query as { includeAll?: string };
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  let query = db.from("p2p_church_announcements").select("*").eq("church_id", churchId);
  if (includeAll === "true") {
    if (!LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required to view all announcements", 403);
  } else {
    const nowIso = new Date().toISOString();
    query = query.eq("status", "published")
      .or(`publish_at.is.null,publish_at.lte.${nowIso}`)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
  }
  const { data, error } = await query
    .order("is_featured", { ascending: false }).order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  const authorIds = [...new Set((data ?? []).map((a) => a.author_id as string))];
  const authors = authorIds.length ? await selectInChunks<{ id: string; full_name: string }>("p2p_profiles", "id,full_name", "id", authorIds) : [];
  const nameById = new Map(authors.map((a) => [a.id, a.full_name]));

  return ok(res, (data ?? []).map((a) => mapAnnouncement(a as Record<string, unknown>, nameById.get(a.author_id as string) ?? null)));
});

router.put("/churches/:churchId/announcements/:id/pin", async (req, res) => {
  const { churchId, id } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { pinned } = req.body as { pinned?: boolean };
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const { error } = await db.from("p2p_church_announcements").update({ is_pinned: pinned !== false }).eq("id", id).eq("church_id", churchId);
  if (error) return err(res, error.message, 500);
  return ok(res, { ok: true });
});

// ── Learning Goals ────────────────────────────────────────────────────────────
// "Lesson of the Day/Week/Month" are just goals with a preset timeframe —
// not a separate system. Leadership-gated (not creator-gated): goals aren't
// a branding/ownership action per the confirmed scope.

const GOAL_LEVELS = ["lesson", "module", "curriculum"];
const GOAL_TIMEFRAMES = ["today", "this_week", "this_month", "custom"];
const GOAL_TARGET_TYPES = ["percentage", "member_count"];

function mapLearningGoal(row: Record<string, unknown>, progress?: { completedUserCount: number; totalMembers: number; percent: number; achieved: boolean }) {
  return {
    id: row.id, churchId: row.church_id, createdBy: row.created_by, title: row.title,
    goalLevel: row.goal_level, lessonId: row.lesson_id ?? null, moduleId: row.module_id ?? null, curriculumId: row.curriculum_id ?? null,
    timeframe: row.timeframe, startsAt: row.starts_at, endsAt: row.ends_at,
    targetType: row.target_type, targetValue: Number(row.target_value), status: row.status, createdAt: row.created_at,
    ...(progress ? {
      completedCount: progress.completedUserCount, totalMembers: progress.totalMembers,
      progressPercent: Math.round(progress.percent * 10) / 10, achieved: progress.achieved,
    } : {}),
  };
}

// Preset windows use UTC day/week(Mon-Sun)/month boundaries computed once at
// creation time — not per-member-local-time, and not adjusted for the
// church's stored timezone (a true per-member-local implementation is a
// materially bigger feature; flagged as an accepted simplification).
function computeGoalWindow(timeframe: string, customStartsAt?: string, customEndsAt?: string): { startsAt: string; endsAt: string } | null {
  const now = new Date();
  if (timeframe === "custom") {
    if (!customStartsAt || !customEndsAt) return null;
    const s = new Date(customStartsAt);
    const e = new Date(customEndsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) return null;
    return { startsAt: s.toISOString(), endsAt: e.toISOString() };
  }
  if (timeframe === "today") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString() };
  }
  if (timeframe === "this_week") {
    const diffToMonday = (now.getUTCDay() + 6) % 7; // Mon=0..Sun=6
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday));
    return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString() };
  }
  if (timeframe === "this_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { startsAt: start.toISOString(), endsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
  }
  return null;
}

// Reuses the exact chunked-.in() discipline the grove endpoint already
// established (selectInChunks) rather than any unchunked query — a
// church-wide members × lessons aggregation is exactly the shape that broke
// elsewhere in this codebase (see DataContext.tsx's Plans-progress loader).
async function computeGoalProgress(goal: Record<string, unknown>, memberIds: string[]): Promise<{ completedUserCount: number; totalMembers: number; percent: number; achieved: boolean }> {
  const empty = { completedUserCount: 0, totalMembers: memberIds.length, percent: 0, achieved: false };
  if (!memberIds.length) return empty;

  let relevantLessonIds: string[];
  if (goal.goal_level === "lesson") {
    relevantLessonIds = [goal.lesson_id as string];
  } else if (goal.goal_level === "module") {
    const lessons = await selectInChunks<{ id: string }>("p2p_lessons", "id", "module_id", [goal.module_id as string]);
    relevantLessonIds = lessons.map((l) => l.id);
  } else {
    const modules = await selectInChunks<{ id: string }>("p2p_modules", "id", "curriculum_id", [goal.curriculum_id as string]);
    const moduleIds = modules.map((m) => m.id);
    const lessons = moduleIds.length ? await selectInChunks<{ id: string }>("p2p_lessons", "id", "module_id", moduleIds) : [];
    relevantLessonIds = lessons.map((l) => l.id);
  }
  if (!relevantLessonIds.length) return empty;

  const progressRows = await selectInChunks<{ user_id: string; lesson_id: string; completed: boolean; updated_at: string }>(
    "p2p_lesson_progress", "user_id,lesson_id,completed,updated_at", "user_id", memberIds
  );
  const relevantSet = new Set(relevantLessonIds);
  const startsAt = goal.starts_at as string;
  const endsAt = goal.ends_at as string;
  const inWindow = progressRows.filter((p) => p.completed && relevantSet.has(p.lesson_id) && p.updated_at >= startsAt && p.updated_at <= endsAt);

  let completedUserCount: number;
  if (goal.goal_level === "lesson") {
    completedUserCount = new Set(inWindow.map((p) => p.user_id)).size;
  } else {
    const doneByUser = new Map<string, Set<string>>();
    for (const p of inWindow) {
      if (!doneByUser.has(p.user_id)) doneByUser.set(p.user_id, new Set());
      doneByUser.get(p.user_id)!.add(p.lesson_id);
    }
    completedUserCount = [...doneByUser.values()].filter((set) => relevantLessonIds.every((id) => set.has(id))).length;
  }

  const percent = (completedUserCount / memberIds.length) * 100;
  const achieved = goal.target_type === "percentage" ? percent >= Number(goal.target_value) : completedUserCount >= Number(goal.target_value);
  return { completedUserCount, totalMembers: memberIds.length, percent, achieved };
}

router.post("/churches/:churchId/learning-goals", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const {
    title, goalLevel, lessonId, moduleId, curriculumId,
    timeframe, startsAt, endsAt, targetType, targetValue,
  } = req.body as Record<string, unknown>;
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  if (typeof title !== "string" || !title.trim()) return err(res, "title is required", 400);
  if (!GOAL_LEVELS.includes(goalLevel as string)) return err(res, `goalLevel must be one of: ${GOAL_LEVELS.join(", ")}`, 400);
  if (!GOAL_TIMEFRAMES.includes(timeframe as string)) return err(res, `timeframe must be one of: ${GOAL_TIMEFRAMES.join(", ")}`, 400);
  if (!GOAL_TARGET_TYPES.includes(targetType as string)) return err(res, `targetType must be one of: ${GOAL_TARGET_TYPES.join(", ")}`, 400);
  const targetNum = Number(targetValue);
  if (!(targetNum > 0)) return err(res, "targetValue must be greater than 0", 400);
  if (targetType === "percentage" && targetNum > 100) return err(res, "A percentage target cannot exceed 100", 400);

  if (goalLevel === "lesson" && !lessonId) return err(res, "lessonId is required for a lesson-level goal", 400);
  if (goalLevel === "module" && !moduleId) return err(res, "moduleId is required for a module-level goal", 400);
  if (goalLevel === "curriculum" && !curriculumId) return err(res, "curriculumId is required for a curriculum-level goal", 400);

  const window = computeGoalWindow(timeframe as string, startsAt as string | undefined, endsAt as string | undefined);
  if (!window) return err(res, "custom timeframe requires a valid startsAt/endsAt (startsAt must be before endsAt)", 400);

  const { data, error } = await db.from("p2p_church_learning_goals").insert({
    church_id: churchId, created_by: requesterId, title: (title as string).trim(),
    goal_level: goalLevel, lesson_id: goalLevel === "lesson" ? lessonId : null,
    module_id: goalLevel === "module" ? moduleId : null, curriculum_id: goalLevel === "curriculum" ? curriculumId : null,
    timeframe, starts_at: window.startsAt, ends_at: window.endsAt,
    target_type: targetType, target_value: targetNum, status: "active",
  }).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Failed to create learning goal", 500);
  return res.status(201).json(mapLearningGoal(data as Record<string, unknown>));
});

router.get("/churches/:churchId/learning-goals", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { status } = req.query as { status?: string };
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  let query = db.from("p2p_church_learning_goals").select("*").eq("church_id", churchId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);

  const memberIds = await getActiveChurchMemberIds(churchId);
  const results = [];
  for (const goal of data ?? []) {
    const progress = await computeGoalProgress(goal as Record<string, unknown>, memberIds);
    results.push(mapLearningGoal(goal as Record<string, unknown>, progress));
  }
  return ok(res, results);
});

router.put("/churches/:churchId/learning-goals/:goalId", async (req, res) => {
  const { churchId, goalId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const { title, targetType, targetValue, status } = req.body as Record<string, unknown>;
  const requester = await getMembership(churchId, requesterId);
  if (!requester || !LEADERSHIP_ROLES.includes(requester.role)) return err(res, "Leadership access required", 403);

  const updates: Record<string, unknown> = {};
  if (typeof title === "string" && title.trim()) updates.title = title.trim();
  if (targetType !== undefined) {
    if (!GOAL_TARGET_TYPES.includes(targetType as string)) return err(res, `targetType must be one of: ${GOAL_TARGET_TYPES.join(", ")}`, 400);
    updates.target_type = targetType;
  }
  if (targetValue !== undefined) {
    const n = Number(targetValue);
    if (!(n > 0)) return err(res, "targetValue must be greater than 0", 400);
    updates.target_value = n;
  }
  if (status !== undefined) {
    if (!["active", "completed", "archived"].includes(status as string)) return err(res, "Invalid status", 400);
    updates.status = status;
  }
  if (!Object.keys(updates).length) return err(res, "No fields to update", 400);

  const { data, error } = await db.from("p2p_church_learning_goals").update(updates).eq("id", goalId).eq("church_id", churchId).select("*").single();
  if (error || !data) return err(res, error?.message ?? "Learning goal not found", 404);
  return ok(res, mapLearningGoal(data as Record<string, unknown>));
});

// GET /churches/:churchId/learning-goals/dashboard — purpose-built (identity from Bearer token)
// server-side aggregation for the church home card (today/this-week/this-month
// active preset goals + progress, in one round trip). Keeping progress math
// server-side here (rather than the client fetching the full list and
// computing locally) is how the "don't repeat DataContext's unchunked .in()
// bug" discipline is actually enforced going forward.
router.get("/churches/:churchId/learning-goals/dashboard", async (req, res) => {
  const { churchId } = req.params;
  const requesterId = await verifyCaller(req);
  if (!requesterId) return err(res, "Unauthorized", 401);
  const requester = await getMembership(churchId, requesterId);
  if (!requester?.is_active) return err(res, "Not a member of this church", 403);

  const nowIso = new Date().toISOString();
  const { data: goals, error } = await db
    .from("p2p_church_learning_goals").select("*").eq("church_id", churchId).eq("status", "active")
    .in("timeframe", ["today", "this_week", "this_month"]).gte("ends_at", nowIso);
  if (error) return err(res, error.message, 500);

  const memberIds = await getActiveChurchMemberIds(churchId);
  const results = [];
  for (const goal of goals ?? []) {
    const progress = await computeGoalProgress(goal as Record<string, unknown>, memberIds);
    results.push(mapLearningGoal(goal as Record<string, unknown>, progress));
  }
  results.sort((a, b) => (a.timeframe === "today" ? -1 : b.timeframe === "today" ? 1 : 0));
  return ok(res, { goals: results });
});

export default router;