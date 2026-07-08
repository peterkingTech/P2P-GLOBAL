import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

function mapProfile(row: Record<string, unknown>) {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    languageCode: row.language_code ?? "en",
    growthLevel: row.growth_level ?? 0,
    role: row.role ?? "disciple",
    gifts: row.gifts ?? [],
    mentorId: row.mentor_id ?? null,
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
  if (body.displayName !== undefined) dbUpdates.display_name = body.displayName;
  if (body.city !== undefined) dbUpdates.city = body.city;
  if (body.country !== undefined) dbUpdates.country = body.country;
  if (body.languageCode !== undefined) dbUpdates.language_code = body.languageCode;
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

// GET /profiles/:userId/forest
router.get("/:userId/forest", async (req, res) => {
  const { userId } = req.params;

  // Fetch the root profile
  const { data: rootProfile, error: rootErr } = await supabase
    .from("p2p_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (rootErr || !rootProfile) {
    return res.status(404).json({ error: "Profile not found" });
  }

  // Fetch discipleship links where user is mentor
  const { data: links } = await supabase
    .from("p2p_discipleship_links")
    .select("disciple_id, is_active")
    .eq("mentor_id", userId)
    .eq("is_active", true);

  // Fetch disciple profiles
  const discipleIds = (links ?? []).map((l: Record<string, unknown>) => l.disciple_id as string);
  let disciples: Record<string, unknown>[] = [];
  if (discipleIds.length > 0) {
    const { data: discipleProfiles } = await supabase
      .from("p2p_profiles")
      .select("*")
      .in("id", discipleIds);
    disciples = (discipleProfiles ?? []) as Record<string, unknown>[];
  }

  const rp = rootProfile as Record<string, unknown>;
  const forest = {
    id: rp.id,
    name: rp.display_name,
    role: rp.role,
    growthLevel: rp.growth_level ?? 0,
    country: rp.country ?? null,
    depth: 0,
    children: disciples.map((d) => ({
      id: d.id,
      name: d.display_name,
      role: d.role,
      growthLevel: d.growth_level ?? 0,
      country: d.country ?? null,
      depth: 1,
      children: [],
    })),
  };

  return res.json(forest);
});

export default router;
