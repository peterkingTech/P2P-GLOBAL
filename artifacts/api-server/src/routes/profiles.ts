import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { validateUsername, formatUsername } from "../lib/username";

const router = Router();

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
  };
}

const PUBLIC_PROFILE_COLUMNS = "id,username,full_name,photo_url,country,country_code,growth_level,bio,is_peer_guide_eligible,created_at,profile_visibility,show_real_name_publicly,show_progress_publicly";

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
  const { q, viewerId } = req.query as { q?: string; viewerId?: string };
  if (!q || q.trim().length < 2) return res.json([]);
  const query = q.trim().replace(/^@/, "");

  const { data: prefixMatches } = await supabaseRead
    .from("p2p_profiles")
    .select(PUBLIC_PROFILE_COLUMNS)
    .ilike("username", `${query}%`)
    .neq("profile_visibility", "private")
    .limit(10);

  let results = (prefixMatches ?? []) as PublicProfileRow[];
  if (results.length < 10) {
    const excludeIds = results.map((r) => r.id);
    let containsQuery = supabaseRead
      .from("p2p_profiles")
      .select(PUBLIC_PROFILE_COLUMNS)
      .or(`username.ilike.%${query}%,full_name.ilike.%${query}%`)
      .neq("profile_visibility", "private")
      .limit(10 - results.length);
    if (excludeIds.length) containsQuery = containsQuery.not("id", "in", `(${excludeIds.join(",")})`);
    const { data: containsMatches } = await containsQuery;
    results = results.concat((containsMatches ?? []) as PublicProfileRow[]);
  }

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
};

type PersonSummary = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  country: string | null;
  growthLevel: number;
  lastActiveAt: string | null;
  username: string | null;
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
      .select("id,full_name,photo_url,country,growth_level,last_active_at,username")
      .eq("id", mentorId)
      .maybeSingle();
    if (!mentorProfile) break;
    ancestry.push({ ...toPersonSummary(mentorProfile as ProfileRow), generation: gen });
    currentId = mentorId;
  }
  return ancestry.reverse(); // oldest ancestor first, so it reads outward-in toward "you"
}

const FOREST_FORWARD_GENERATIONS = 3;

router.get("/:userId/forest", async (req, res) => {
  const { userId } = req.params;

  const { data: rootProfile, error: rootErr } = await supabaseRead
    .from("p2p_profiles")
    .select("id,full_name,photo_url,country,growth_level,last_active_at,username")
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
        .select("id,full_name,photo_url,country,growth_level,last_active_at,username")
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