import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import { supabase } from "../lib/supabase";
import { validateUsername, formatUsername } from "../lib/username";

const router = Router();

// Same moderator+ set breakRooms.ts uses for its moderator-alert path —
// verification review is scoped narrower than the general requireAdmin()
// gate (which also includes peer_guide) since it means looking at another
// person's face/selfie.
const VERIFICATION_REVIEWER_ROLES = ["moderator", "church_leader", "regional_admin", "super_admin"];

// Same RLS workaround as curriculum.ts's supabaseRead — the shared `supabase`
// client above uses the anon key, which several tables the forest endpoint
// reads (discipleship links, lesson progress, fruits) block from anon SELECT.
const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
const supabaseRead = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id,
    displayName: row.full_name,
    email: row.email,
    avatarUrl: row.photo_url ?? null,
    country: row.country ?? null,
    languageCode: row.language ?? "en",
    growthLevel: row.growth_level ?? 0,
    role: row.role ?? "disciple",
    gifts: row.gifts ?? [],
    isPraying: row.is_praying ?? false,
    createdAt: row.created_at,
  };
}

// ── Username system ──────────────────────────────────────────────────────────
// Reuses the supabaseRead service-role client above — p2p_username_history
// has no client-facing INSERT policy at all (system-owned, same reasoning
// as p2p_call_logs in calls.ts), and the reserved/availability checks need
// to read across every profile regardless of that profile's own RLS
// visibility.
async function isReserved(username: string): Promise<boolean> {
  const { data } = await supabaseRead
    .from("p2p_reserved_usernames")
    .select("id")
    .eq("is_active", true)
    .ilike("username", username)
    .maybeSingle();
  return !!data;
}

async function isRecentlyReleased(username: string, excludeUserId?: string): Promise<boolean> {
  let query = supabaseRead
    .from("p2p_profiles")
    .select("id")
    .ilike("username_previous", username)
    .gt("username_previous_held_until", new Date().toISOString());
  if (excludeUserId) query = query.neq("id", excludeUserId);
  const { data } = await query.maybeSingle();
  return !!data;
}

async function checkUsernameAvailability(username: string, excludeUserId?: string): Promise<{ available: boolean; reason?: string }> {
  const validation = validateUsername(username);
  if (!validation.valid) return { available: false, reason: "invalid_format" };
  const clean = formatUsername(username);

  if (await isReserved(clean)) return { available: false, reason: "reserved" };

  let takenQuery = supabaseRead.from("p2p_profiles").select("id").ilike("username", clean);
  if (excludeUserId) takenQuery = takenQuery.neq("id", excludeUserId);
  const { data: takenRow } = await takenQuery.maybeSingle();
  if (takenRow) return { available: false, reason: "taken" };

  if (await isRecentlyReleased(clean, excludeUserId)) return { available: false, reason: "recently_released" };

  return { available: true };
}

// Blocked-either-direction check, used by both the public-profile lookup and
// search so a block is symmetric regardless of who blocked whom.
async function isBlockedEitherWay(viewerId: string, targetId: string): Promise<boolean> {
  const { data } = await supabaseRead
    .from("p2p_user_blocks")
    .select("id")
    .or(`and(blocker_id.eq.${viewerId},blocked_id.eq.${targetId}),and(blocker_id.eq.${targetId},blocked_id.eq.${viewerId})`)
    .maybeSingle();
  return !!data;
}

type PublicProfileRow = {
  id: string; username: string | null; full_name: string | null; photo_url: string | null;
  country: string | null; country_code: string | null; growth_level: number | null; bio: string | null;
  is_peer_guide_eligible: boolean | null; created_at: string; profile_visibility: string | null;
  show_real_name_publicly: boolean | null; show_progress_publicly: boolean | null;
  is_verified: boolean | null; verification_badge_visible: boolean | null;
};

async function mapPublicProfile(row: PublicProfileRow) {
  const [{ modulesCompletedByUser, fruitCountByUser }, { count: menteeCount }] = await Promise.all([
    computeModuleAndFruitCounts([row.id]),
    supabaseRead.from("p2p_discipleship_links").select("id", { count: "exact", head: true }).eq("mentor_id", row.id).eq("active", true),
  ]);
  const showProgress = row.show_progress_publicly ?? true;
  return {
    username: row.username,
    fullName: row.show_real_name_publicly ?? true ? row.full_name : null,
    photoUrl: row.photo_url ?? null,
    country: row.country ?? null,
    countryCode: row.country_code ?? null,
    bio: row.bio ?? null,
    isPeerGuideEligible: row.is_peer_guide_eligible ?? false,
    joinedAt: row.created_at,
    showProgressPublicly: showProgress,
    growthLevel: showProgress ? (row.growth_level ?? 0) : null,
    modulesCompleted: showProgress ? (modulesCompletedByUser.get(row.id) ?? 0) : null,
    fruitCount: showProgress ? (fruitCountByUser.get(row.id) ?? 0) : null,
    activeMenteesCount: showProgress ? (menteeCount ?? 0) : null,
    isVerified: (row.is_verified ?? false) && (row.verification_badge_visible ?? true),
  };
}

const PUBLIC_PROFILE_COLUMNS = "id,username,full_name,photo_url,country,country_code,growth_level,bio,is_peer_guide_eligible,created_at,profile_visibility,show_real_name_publicly,show_progress_publicly,is_verified,verification_badge_visible";

// GET /profiles/username/:username — public profile by username.
router.get("/username/:username", async (req, res) => {
  const { username } = req.params;
  const { viewerId } = req.query as { viewerId?: string };

  const { data, error } = await supabaseRead
    .from("p2p_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .ilike("username", username)
    .maybeSingle();
  if (error || !data) return res.status(404).json({ error: "Profile not found" });
  if (data.profile_visibility === "private" && data.id !== viewerId) {
    return res.status(404).json({ error: "Profile not found" });
  }
  if (viewerId && viewerId !== data.id && (await isBlockedEitherWay(viewerId, data.id))) {
    return res.status(404).json({ error: "Profile not found" });
  }

  return res.json({ userId: data.id, ...(await mapPublicProfile(data as PublicProfileRow)) });
});

// GET /profiles/search?q=&viewerId= — prefix-then-contains username/name
// search. Not true pg_trgm similarity ranking (supabase-js can't express
// `ORDER BY similarity(...)` without a raw-SQL RPC) — this does a prefix
// match pass first, then backfills with a contains match, which in practice
// surfaces the closest usernames first for the common "typing from the
// start" search pattern this UI is built around. The trigram GIN index
// still accelerates the ILIKE '%...%' pass either way.
router.get("/search", async (req, res) => {
  const { q, viewerId, verified_only } = req.query as { q?: string; viewerId?: string; verified_only?: string };
  if (!q || q.trim().length < 2) return res.json([]);
  const query = q.trim().replace(/^@/, "");
  const verifiedOnly = verified_only === "true";

  let prefixQuery = supabaseRead
    .from("p2p_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .ilike("username", `${query}%`)
    .neq("profile_visibility", "private")
    .limit(10);
  if (verifiedOnly) prefixQuery = prefixQuery.eq("is_verified", true);
  const { data: prefixMatches } = await prefixQuery;

  let results = (prefixMatches ?? []) as PublicProfileRow[];
  if (results.length < 10) {
    const excludeIds = results.map((r) => r.id);
    let containsQuery = supabaseRead
      .from("p2p_profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .neq("profile_visibility", "private")
      .limit(10 - results.length);
    if (verifiedOnly) containsQuery = containsQuery.eq("is_verified", true);
    if (excludeIds.length) containsQuery = containsQuery.not("id", "in", `(${excludeIds.join(",")})`);
    const { data: containsMatches } = await containsQuery;
    results = results.concat((containsMatches ?? []) as PublicProfileRow[]);
  }

  // Verified profiles first when otherwise tied on match position (both
  // arrays above are already ordered prefix-then-contains; a stable sort on
  // is_verified alone preserves that relative order within each group).
  results = results
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const av = a.r.is_verified ? 1 : 0;
      const bv = b.r.is_verified ? 1 : 0;
      if (av !== bv) return bv - av;
      return a.i - b.i;
    })
    .map(({ r }) => r);

  if (viewerId) {
    const { data: blocks } = await supabaseRead
      .from("p2p_user_blocks")
      .select("blocker_id,blocked_id")
      .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
    const blockedIds = new Set(
      (blocks ?? []).map((b) => (b.blocker_id === viewerId ? b.blocked_id : b.blocker_id) as string)
    );
    results = results.filter((r) => !blockedIds.has(r.id));
  }

  return res.json(await Promise.all(results.map(async (r) => ({ userId: r.id, ...(await mapPublicProfile(r)) }))));
});

// POST /profiles/check-username — { username } -> { available, reason? }
router.post("/check-username", async (req, res) => {
  const { username } = req.body as { username?: string };
  if (!username) return res.status(400).json({ error: "username is required" });
  return res.json(await checkUsernameAvailability(username));
});

// PUT /profiles/username — { userId, username }. Enforces the 90-day
// change cooldown and holds the released username for 30 days. Writes to
// p2p_username_history, which has no client-facing INSERT policy, so this
// (not a direct client .update()) is the only way a username can change.
const USERNAME_CHANGE_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;
const USERNAME_HOLD_MS = 30 * 24 * 60 * 60 * 1000;
router.put("/username", async (req, res) => {
  const { userId, username } = req.body as { userId?: string; username?: string };
  if (!userId || !username) return res.status(400).json({ error: "userId and username are required" });

  const { data: profile } = await supabaseRead
    .from("p2p_profiles").select("username,username_changed_at").eq("id", userId).maybeSingle();
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  if (profile.username_changed_at) {
    const nextAllowed = new Date(new Date(profile.username_changed_at as string).getTime() + USERNAME_CHANGE_COOLDOWN_MS);
    if (nextAllowed.getTime() > Date.now()) {
      return res.status(429).json({ error: "Username was changed recently", next_change_allowed_at: nextAllowed.toISOString() });
    }
  }

  const availability = await checkUsernameAvailability(username, userId);
  if (!availability.available) return res.status(409).json({ error: "Username unavailable", reason: availability.reason });

  const clean = formatUsername(username);
  const oldUsername = (profile.username as string | null) ?? null;
  const now = new Date();

  const { data: updated, error: updateErr } = await supabaseRead
    .from("p2p_profiles")
    .update({
      username: clean,
      username_changed_at: now.toISOString(),
      username_previous: oldUsername,
      username_previous_held_until: oldUsername ? new Date(now.getTime() + USERNAME_HOLD_MS).toISOString() : null,
      username_change_required: false,
    })
    .eq("id", userId)
    .select(PUBLIC_PROFILE_COLUMNS)
    .single();
  // A concurrent request could win the race between the availability check
  // above and this write — the unique index is the real backstop.
  if (updateErr) {
    if ((updateErr as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Username unavailable", reason: "taken" });
    }
    return res.status(500).json({ error: updateErr.message });
  }

  await supabaseRead.from("p2p_username_history").insert({ user_id: userId, old_username: oldUsername, new_username: clean });

  return res.json(mapProfile(updated as Record<string, unknown>));
});

// POST /profiles/login-with-username — { username, password } -> Supabase
// session tokens. Resolves username -> email server-side and NEVER returns
// the email to the client: a client-embedded "secret header" (as originally
// specced) can't actually be kept secret in a public mobile build — anyone
// can extract it from the APK/bundle and use it as an email-harvesting
// oracle. This proxies the same password grant supabase.auth.signInWithPassword
// makes, just with the email resolved first, so the client only ever
// receives session tokens (mirroring supabase.auth.signInWithPassword's own
// response shape) via setSession() — never the email itself.
const loginAttemptsByIp = new Map<string, { count: number; resetAt: number }>();
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = loginAttemptsByIp.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttemptsByIp.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

router.post("/login-with-username", async (req, res) => {
  const ip = req.ip ?? "unknown";
  if (!checkRateLimit(ip)) return res.status(429).json({ error: "Too many attempts. Please wait a minute and try again." });

  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) return res.status(400).json({ error: "username and password are required" });

  const { data: profile } = await supabaseRead
    .from("p2p_profiles").select("email").ilike("username", username.replace(/^@/, "")).maybeSingle();
  if (!profile?.email) return res.status(401).json({ error: "Invalid username or password" });

  const tokenRes = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email: profile.email, password }),
  });
  if (!tokenRes.ok) return res.status(401).json({ error: "Invalid username or password" });
  const session = await tokenRes.json();
  return res.json(session);
});

// ── Identity verification (blue tick) ────────────────────────────────────────
// Selfie or short video selfie only — no government ID. Every read/write on
// p2p_verification_applications/history and the private storage bucket goes
// through supabaseRead (service role); see migration 065's deviation notes.
const VERIFICATION_ACCOUNT_MIN_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const verificationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function mapVerificationStatus(profile: Record<string, unknown>, attemptNumber: number) {
  return {
    status: (profile.verification_status as string) ?? "unverified",
    method: (profile.verification_method as string | null) ?? null,
    submittedAt: (profile.verification_submitted_at as string | null) ?? null,
    approvedAt: (profile.verification_approved_at as string | null) ?? null,
    declineReason: (profile.verification_decline_reason as string | null) ?? null,
    canReapplyAt: (profile.can_reapply_at as string | null) ?? null,
    attemptNumber,
    isVerified: (profile.is_verified as boolean) ?? false,
    badgeVisible: (profile.verification_badge_visible as boolean) ?? true,
  };
}

// POST /profiles/verification/submit — multipart: fields userId, method
// ('selfie_note'|'video_selfie'), file field 'file'.
router.post("/verification/submit", verificationUpload.single("file"), async (req, res) => {
  const { userId, method } = req.body as { userId?: string; method?: string };
  if (!userId || !method) return res.status(400).json({ error: "userId and method are required" });
  if (!["selfie_note", "video_selfie"].includes(method)) {
    return res.status(400).json({ error: "method must be 'selfie_note' or 'video_selfie'" });
  }
  if (!req.file) return res.status(400).json({ error: "No file uploaded (expected field name 'file')" });

  const { data: profile } = await supabaseRead
    .from("p2p_profiles")
    .select("photo_url, created_at, verification_status, can_reapply_at")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  if (!profile.photo_url) {
    return res.status(400).json({ error: "Please add a profile photo before applying" });
  }
  const accountAgeMs = Date.now() - new Date(profile.created_at as string).getTime();
  if (accountAgeMs < VERIFICATION_ACCOUNT_MIN_AGE_MS) {
    return res.status(400).json({ error: "Your account must be at least 14 days old to apply" });
  }
  if (profile.verification_status === "pending") {
    return res.status(409).json({ error: "You already have a verification application pending" });
  }
  if (profile.can_reapply_at && new Date(profile.can_reapply_at as string).getTime() > Date.now()) {
    return res.status(429).json({ error: "You can reapply later", can_reapply_at: profile.can_reapply_at });
  }
  // "No active moderation flags" — p2p_profiles has no is_flagged column;
  // the real signal is an open/escalated row in p2p_content_flags (see
  // migrations/013_moderation.sql).
  const { data: activeFlag } = await supabaseRead
    .from("p2p_content_flags")
    .select("id")
    .eq("author_id", userId)
    .in("status", ["open", "escalated"])
    .maybeSingle();
  if (activeFlag) {
    return res.status(403).json({ error: "Your account has active moderation flags" });
  }

  const { count: priorAttempts } = await supabaseRead
    .from("p2p_verification_applications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  const attemptNumber = (priorAttempts ?? 0) + 1;

  const ext = (req.file.originalname.split(".").pop() || (method === "video_selfie" ? "mp4" : "jpg")).toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error: uploadErr } = await supabaseRead.storage
    .from("verification-submissions")
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
  if (uploadErr) return res.status(500).json({ error: uploadErr.message });

  const { data: application, error: insertErr } = await supabaseRead
    .from("p2p_verification_applications")
    .insert({
      user_id: userId, method, submission_path: path, profile_photo_url: profile.photo_url,
      status: "pending", attempt_number: attemptNumber,
    })
    .select("id")
    .single();
  if (insertErr || !application) {
    await supabaseRead.storage.from("verification-submissions").remove([path]);
    return res.status(500).json({ error: insertErr?.message ?? "Failed to submit application" });
  }

  await supabaseRead.from("p2p_profiles").update({
    verification_status: "pending", verification_submitted_at: new Date().toISOString(), verification_method: method,
  }).eq("id", userId);

  await supabaseRead.from("p2p_verification_history").insert({ user_id: userId, action: "submitted" });

  await supabaseRead.from("p2p_notifications").insert({
    user_id: userId, title: "Verification submitted",
    message: "We have received your verification application. You will hear from us within 72 hours.",
    notification_type: "verification_submitted",
  });

  const { data: reviewers } = await supabaseRead.from("p2p_profiles").select("id").in("role", VERIFICATION_REVIEWER_ROLES);
  const { data: submitterProfile } = await supabaseRead.from("p2p_profiles").select("username, full_name").eq("id", userId).maybeSingle();
  const submitterName = (submitterProfile?.username as string | undefined) ? `@${submitterProfile!.username}` : (submitterProfile?.full_name as string | undefined) ?? "Someone";
  if (reviewers && reviewers.length) {
    await supabaseRead.from("p2p_notifications").insert(
      reviewers.map((r) => ({
        user_id: r.id, title: "New verification application",
        message: `${submitterName} has submitted a verification application. Review it in the admin panel.`,
        notification_type: "verification_admin_alert", data: { applicationId: application.id },
      }))
    );
  }

  return res.status(201).json({ success: true, applicationId: application.id, estimatedReviewHours: 72 });
});

// GET /profiles/verification/status?userId=
router.get("/verification/status", async (req, res) => {
  const { userId } = req.query as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data: profile } = await supabaseRead
    .from("p2p_profiles")
    .select("verification_status, verification_method, verification_submitted_at, verification_approved_at, verification_decline_reason, can_reapply_at, is_verified, verification_badge_visible")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const { count: attemptCount } = await supabaseRead
    .from("p2p_verification_applications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return res.json(mapVerificationStatus(profile as Record<string, unknown>, attemptCount ?? 0));
});

// PUT /profiles/verification/badge-visibility — { userId, visible }
router.put("/verification/badge-visibility", async (req, res) => {
  const { userId, visible } = req.body as { userId?: string; visible?: boolean };
  if (!userId || typeof visible !== "boolean") return res.status(400).json({ error: "userId and visible are required" });

  const { data: updated, error } = await supabaseRead
    .from("p2p_profiles")
    .update({ verification_badge_visible: visible })
    .eq("id", userId)
    .select(PUBLIC_PROFILE_COLUMNS)
    .single();
  if (error || !updated) return res.status(500).json({ error: error?.message ?? "Failed to update badge visibility" });

  return res.json(mapProfile(updated as Record<string, unknown>));
});

// POST /profiles/verification/withdraw — { userId } — cancels a pending
// application and deletes the submitted file immediately.
router.post("/verification/withdraw", async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data: application } = await supabaseRead
    .from("p2p_verification_applications")
    .select("id, submission_path")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false })
    .maybeSingle();
  if (!application) return res.status(404).json({ error: "No pending application found" });

  if (application.submission_path) {
    await supabaseRead.storage.from("verification-submissions").remove([application.submission_path]);
  }
  await supabaseRead.from("p2p_verification_applications").update({
    status: "declined", submission_path: null, submission_deleted_at: new Date().toISOString(),
  }).eq("id", application.id);
  await supabaseRead.from("p2p_profiles").update({ verification_status: "unverified", verification_submitted_at: null }).eq("id", userId);
  await supabaseRead.from("p2p_verification_history").insert({ user_id: userId, action: "withdrawn" });

  return res.json({ success: true });
});

// ── Grain invitations ─────────────────────────────────────────────────────────
// One rule: invite someone, they register with your link, you earn 1 Grain.
// The invite code IS the inviter's current @username — see migration 066's
// deviation notes for why there's no separate generated code or persisted
// link (usernames can change, so nothing is stored that could go stale).
// Real, live Netlify deployment (confirmed reachable) — overridable via
// INVITE_BASE_URL for staging/local testing without touching code.
const INVITE_BASE = process.env.INVITE_BASE_URL
  || "https://peer-to-peer-globalbiblestudynetwork.netlify.app/join";
function buildInviteLink(username: string): string {
  return `${INVITE_BASE}/@${encodeURIComponent(username)}`;
}

// GET /profiles/invite/my-link?userId= — the current user's personal invite
// link + grain count. Nothing is created or persisted; it's computed live
// from the current profile row.
router.get("/invite/my-link", async (req, res) => {
  const { userId } = req.query as { userId?: string };
  if (!userId) return res.status(400).json({ error: "userId is required" });

  const { data: profile } = await supabaseRead
    .from("p2p_profiles").select("username, grain_count").eq("id", userId).maybeSingle();
  if (!profile) return res.status(404).json({ error: "Profile not found" });
  if (!profile.username) return res.status(400).json({ error: "Set a username before inviting others" });

  const { count: peopleInvited } = await supabaseRead
    .from("p2p_invitations").select("id", { count: "exact", head: true }).eq("inviter_id", userId);

  return res.json({
    inviteLink: buildInviteLink(profile.username as string),
    inviteCode: profile.username,
    grainCount: (profile.grain_count as number) ?? 0,
    peopleInvited: peopleInvited ?? 0,
  });
});

// POST /profiles/invite/redeem — { inviteCode, newUserId }. Called right
// after a new account registers. Never blocks registration: any failure
// here (bad code, self-referral, already redeemed) is reported back but the
// account itself already exists by the time this runs.
router.post("/invite/redeem", async (req, res) => {
  const { inviteCode, newUserId } = req.body as { inviteCode?: string; newUserId?: string };
  if (!inviteCode || !newUserId) return res.status(400).json({ error: "inviteCode and newUserId are required" });

  const { data: inviter } = await supabaseRead
    .from("p2p_profiles").select("id, username, full_name, grain_count").ilike("username", inviteCode.replace(/^@/, "")).maybeSingle();
  if (!inviter) return res.status(404).json({ error: "Invalid invite code" });
  if (inviter.id === newUserId) return res.status(400).json({ error: "You can't redeem your own invite link" });

  const { data: existing } = await supabaseRead
    .from("p2p_invitations").select("id").eq("invited_user_id", newUserId).maybeSingle();
  if (existing) return res.status(409).json({ error: "You've already used an invite code" });

  const { error: insertErr } = await supabaseRead.from("p2p_invitations").insert({
    inviter_id: inviter.id, invited_user_id: newUserId, invite_code: inviter.username,
  });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === "23505") return res.status(409).json({ error: "You've already used an invite code" });
    return res.status(500).json({ error: insertErr.message });
  }

  // Fetch current count, then increment (same pattern as prayer.ts's /pray).
  const newGrainCount = ((inviter.grain_count as number) ?? 0) + 1;
  await supabaseRead.from("p2p_profiles").update({ grain_count: newGrainCount }).eq("id", inviter.id);

  const { data: newUserProfile } = await supabaseRead.from("p2p_profiles").select("full_name, username").eq("id", newUserId).maybeSingle();
  const newUserName = (newUserProfile?.username as string | undefined) ? `@${newUserProfile!.username}` : (newUserProfile?.full_name as string | undefined) ?? "Someone";
  await supabaseRead.from("p2p_notifications").insert({
    user_id: inviter.id, title: "🌾 You earned Grain",
    message: `${newUserName} joined P2P Global through your invitation.`,
    notification_type: "grain_earned",
    data: { newUserUsername: newUserProfile?.username ?? null, newGrainCount },
  });

  return res.json({ success: true, inviterUsername: inviter.username });
});

// GET /profiles/:userId
router.get("/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from("p2p_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Profile not found" });
  }
  return res.json(mapProfile(data as Record<string, unknown>));
});

// PATCH /profiles/:userId
router.patch("/:userId", async (req, res) => {
  const { userId } = req.params;
  const body = req.body as Record<string, unknown>;

  const dbUpdates: Record<string, unknown> = {};
  if (body.displayName !== undefined) dbUpdates.full_name = body.displayName;
  if (body.country !== undefined) dbUpdates.country = body.country;
  if (body.languageCode !== undefined) dbUpdates.language = body.languageCode;
  if (body.growthLevel !== undefined) dbUpdates.growth_level = body.growthLevel;
  if (body.role !== undefined) dbUpdates.role = body.role;
  if (body.gifts !== undefined) dbUpdates.gifts = body.gifts;
  if (body.isPraying !== undefined) dbUpdates.is_praying = body.isPraying;

  const { data, error } = await supabase
    .from("p2p_profiles")
    .update(dbUpdates)
    .eq("id", userId)
    .select()
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Profile not found" });
  }
  return res.json(mapProfile(data as Record<string, unknown>));
});

// ── Generational Forest (GET /profiles/:userId/forest) ──────────────────────
// Same URL-length caution as curriculum.ts's chunkIds — any .in() combined
// with a second .in() filter on the same query needs a smaller chunk than a
// single-filter call, so this uses its own more conservative chunk size.
const FOREST_IN_CHUNK = 60;
function chunk<T>(arr: T[], size = FOREST_IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type ProfileRow = {
  id: string;
  full_name: string | null;
  photo_url: string | null;
  country: string | null;
  growth_level: number | null;
  last_active_at: string | null;
  username: string | null;
  is_verified: boolean | null;
};

type PersonSummary = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  country: string | null;
  growthLevel: number;
  lastActiveAt: string | null;
  username: string | null;
  isVerified: boolean;
};

function toPersonSummary(p: ProfileRow): PersonSummary {
  return {
    userId: p.id,
    displayName: p.full_name ?? "A disciple",
    photoUrl: p.photo_url ?? null,
    country: p.country ?? null,
    growthLevel: p.growth_level ?? 0,
    lastActiveAt: p.last_active_at ?? null,
    username: p.username ?? null,
    isVerified: p.is_verified ?? false,
  };
}

// Counts, per user, how many Foundation (core curriculum, not a plan) modules
// are fully completed — a module counts once every one of its lessons has a
// completed=true row for that user. Bounded by the small, fixed Foundation
// module/lesson set, so this stays cheap even for a large lineage.
async function computeModuleAndFruitCounts(userIds: string[]) {
  const modulesCompletedByUser = new Map<string, number>();
  const fruitCountByUser = new Map<string, number>();
  for (const id of userIds) { modulesCompletedByUser.set(id, 0); fruitCountByUser.set(id, 0); }
  if (userIds.length === 0) return { modulesCompletedByUser, fruitCountByUser };

  const { data: foundationCurricula } = await supabaseRead
    .from("p2p_curriculums").select("id").not("type", "in", "(plan,plan_category)");
  const curriculumIds = (foundationCurricula ?? []).map((c) => c.id as string);

  const { data: modules } = curriculumIds.length
    ? await supabaseRead.from("p2p_modules").select("id,curriculum_id").in("curriculum_id", curriculumIds)
    : { data: [] as { id: string; curriculum_id: string }[] };
  const moduleIds = (modules ?? []).map((m) => m.id as string);

  const { data: lessons } = moduleIds.length
    ? await supabaseRead.from("p2p_lessons").select("id,module_id").in("module_id", moduleIds)
    : { data: [] as { id: string; module_id: string }[] };
  const lessonToModule = new Map((lessons ?? []).map((l) => [l.id as string, l.module_id as string]));
  const lessonsByModule = new Map<string, number>();
  for (const moduleId of lessonToModule.values()) lessonsByModule.set(moduleId, (lessonsByModule.get(moduleId) ?? 0) + 1);
  const lessonIds = Array.from(lessonToModule.keys());

  if (lessonIds.length > 0) {
    for (const userChunk of chunk(userIds)) {
      const { data: progress } = await supabaseRead
        .from("p2p_lesson_progress")
        .select("user_id,lesson_id,completed")
        .eq("completed", true)
        .in("user_id", userChunk)
        .in("lesson_id", lessonIds);

      const completedByUserModule = new Map<string, Map<string, number>>();
      for (const row of (progress ?? []) as { user_id: string; lesson_id: string }[]) {
        const moduleId = lessonToModule.get(row.lesson_id);
        if (!moduleId) continue;
        const perModule = completedByUserModule.get(row.user_id) ?? new Map<string, number>();
        perModule.set(moduleId, (perModule.get(moduleId) ?? 0) + 1);
        completedByUserModule.set(row.user_id, perModule);
      }
      for (const [userId, perModule] of completedByUserModule) {
        let completeModules = 0;
        for (const [moduleId, completedCount] of perModule) {
          if (completedCount >= (lessonsByModule.get(moduleId) ?? Infinity)) completeModules++;
        }
        modulesCompletedByUser.set(userId, completeModules);
      }
    }
  }

  for (const userChunk of chunk(userIds)) {
    const { data: fruits } = await supabaseRead.from("p2p_user_fruits").select("user_id").in("user_id", userChunk);
    for (const row of (fruits ?? []) as { user_id: string }[]) {
      fruitCountByUser.set(row.user_id, (fruitCountByUser.get(row.user_id) ?? 0) + 1);
    }
  }

  return { modulesCompletedByUser, fruitCountByUser };
}

// Walks the mentor chain backward from userId up to `maxGenerations` steps,
// using the same active=true discipleship link the forward walk uses.
async function loadAncestry(userId: string, maxGenerations: number) {
  const ancestry: (PersonSummary & { generation: number })[] = [];
  let currentId = userId;
  for (let gen = 1; gen <= maxGenerations; gen++) {
    const { data: link } = await supabaseRead
      .from("p2p_discipleship_links")
      .select("mentor_id")
      .eq("disciple_id", currentId)
      .eq("active", true)
      .maybeSingle();
    const mentorId = (link as { mentor_id: string } | null)?.mentor_id;
    if (!mentorId) break;
    const { data: mentorProfile } = await supabaseRead
      .from("p2p_profiles")
      .select("id,full_name,photo_url,country,growth_level,last_active_at,username,is_verified")
      .eq("id", mentorId)
      .maybeSingle();
    if (!mentorProfile) break;
    ancestry.push({ ...toPersonSummary(mentorProfile as ProfileRow), generation: gen });
    currentId = mentorId;
  }
  return ancestry.reverse(); // oldest ancestor first, so it reads outward-in toward "you"
}

// GET /profiles/:userId/grain — public grain info for any profile.
router.get("/:userId/grain", async (req, res) => {
  const { userId } = req.params;
  const { data: profile } = await supabaseRead.from("p2p_profiles").select("grain_count").eq("id", userId).maybeSingle();
  if (!profile) return res.status(404).json({ error: "Profile not found" });

  const { count: peopleInvited } = await supabaseRead
    .from("p2p_invitations").select("id", { count: "exact", head: true }).eq("inviter_id", userId);

  return res.json({ grainCount: (profile.grain_count as number) ?? 0, peopleInvited: peopleInvited ?? 0 });
});

const FOREST_FORWARD_GENERATIONS = 3;

router.get("/:userId/forest", async (req, res) => {
  const { userId } = req.params;

  const { data: rootProfile, error: rootErr } = await supabaseRead
    .from("p2p_profiles")
    .select("id,full_name,photo_url,country,growth_level,last_active_at,username,is_verified")
    .eq("id", userId)
    .single();
  if (rootErr || !rootProfile) return res.status(404).json({ error: "Profile not found" });

  // BFS forward through active discipleship links, one generation at a time,
  // fetching one extra generation past the requested depth so gen-3 entries
  // can carry a minimal preview of their own mentees rather than just a count.
  type LinkRow = { mentor_id: string; disciple_id: string };
  const byGeneration: ProfileRow[][] = [];
  const childrenByMentor = new Map<string, string[]>();
  let frontier = [userId];
  const visited = new Set<string>([userId]);

  for (let gen = 1; gen <= FOREST_FORWARD_GENERATIONS + 1 && frontier.length > 0; gen++) {
    const links: LinkRow[] = [];
    for (const mentorChunk of chunk(frontier)) {
      const { data } = await supabaseRead
        .from("p2p_discipleship_links")
        .select("mentor_id,disciple_id")
        .eq("active", true)
        .in("mentor_id", mentorChunk);
      links.push(...((data ?? []) as LinkRow[]));
    }
    for (const l of links) {
      const arr = childrenByMentor.get(l.mentor_id) ?? [];
      arr.push(l.disciple_id);
      childrenByMentor.set(l.mentor_id, arr);
    }
    const nextIds = [...new Set(links.map((l) => l.disciple_id))].filter((id) => !visited.has(id));
    nextIds.forEach((id) => visited.add(id));
    if (nextIds.length === 0) break;

    let genProfiles: ProfileRow[] = [];
    for (const idChunk of chunk(nextIds)) {
      const { data } = await supabaseRead
        .from("p2p_profiles")
        .select("id,full_name,photo_url,country,growth_level,last_active_at,username,is_verified")
        .in("id", idChunk);
      genProfiles = genProfiles.concat((data ?? []) as ProfileRow[]);
    }
    byGeneration[gen] = genProfiles;
    frontier = nextIds;
  }

  const profileById = new Map<string, ProfileRow>();
  profileById.set(userId, rootProfile as ProfileRow);
  byGeneration.forEach((gen) => gen?.forEach((p) => profileById.set(p.id, p)));

  const ancestry = await loadAncestry(userId, 3);

  const allLineageIds = Array.from(visited); // self + every fetched descendant generation
  const { modulesCompletedByUser, fruitCountByUser } = await computeModuleAndFruitCounts(allLineageIds);

  function toPersonWithModules(p: ProfileRow) {
    return { ...toPersonSummary(p), modulesCompleted: modulesCompletedByUser.get(p.id) ?? 0 };
  }
  function buildMinimalNode(id: string) {
    const p = profileById.get(id);
    if (!p) return null;
    return { userId: p.id, country: p.country ?? null, growthLevel: p.growth_level ?? 0 };
  }

  const gen1Ids = childrenByMentor.get(userId) ?? [];
  const mentees = gen1Ids.map((g1Id) => {
    const gen2Ids = childrenByMentor.get(g1Id) ?? [];
    return {
      ...toPersonWithModules(profileById.get(g1Id)!),
      mentees: gen2Ids.map((g2Id) => {
        const gen3Ids = childrenByMentor.get(g2Id) ?? [];
        return {
          ...toPersonWithModules(profileById.get(g2Id)!),
          mentees: gen3Ids.map((g3Id) => ({
            ...toPersonWithModules(profileById.get(g3Id)!),
            mentees: (childrenByMentor.get(g3Id) ?? []).map(buildMinimalNode).filter(Boolean),
          })),
        };
      }),
    };
  });

  const countriesRepresented = Array.from(new Set(
    allLineageIds.map((id) => profileById.get(id)?.country).filter((c): c is string => !!c)
  ));
  let generationsDeep = 0;
  for (let gen = byGeneration.length - 1; gen >= 1; gen--) {
    if (byGeneration[gen]?.length) { generationsDeep = gen; break; }
  }
  const totalModulesCompleted = allLineageIds.reduce((sum, id) => sum + (modulesCompletedByUser.get(id) ?? 0), 0);
  const totalFruits = allLineageIds.reduce((sum, id) => sum + (fruitCountByUser.get(id) ?? 0), 0);

  return res.json({
    self: {
      ...toPersonSummary(rootProfile as ProfileRow),
      modulesCompleted: modulesCompletedByUser.get(userId) ?? 0,
      fruitCount: fruitCountByUser.get(userId) ?? 0,
    },
    mentees,
    ancestry,
    stats: {
      totalInLineage: allLineageIds.length - 1, // excludes self
      generationsDeep,
      countriesRepresented,
      totalModulesCompletedAcrossLineage: totalModulesCompleted,
      totalFruitsAcrossLineage: totalFruits,
    },
  });
});

export default router;