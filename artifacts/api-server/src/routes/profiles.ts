import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

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
};

type PersonSummary = {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  country: string | null;
  growthLevel: number;
  lastActiveAt: string | null;
};

function toPersonSummary(p: ProfileRow): PersonSummary {
  return {
    userId: p.id,
    displayName: p.full_name ?? "A disciple",
    photoUrl: p.photo_url ?? null,
    country: p.country ?? null,
    growthLevel: p.growth_level ?? 0,
    lastActiveAt: p.last_active_at ?? null,
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
      .select("id,full_name,photo_url,country,growth_level,last_active_at")
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
    .select("id,full_name,photo_url,country,growth_level,last_active_at")
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
        .select("id,full_name,photo_url,country,growth_level,last_active_at")
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