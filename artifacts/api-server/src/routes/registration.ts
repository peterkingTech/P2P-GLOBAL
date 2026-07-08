import { Router } from "express";
import { supabase } from "../lib/supabase";

const router = Router();

// POST /api/registration — submit intake form
router.post("/", async (req, res) => {
  const {
    user_id,
    full_name,
    email,
    location_city,
    location_country,
    contact,
    primary_language,
    other_languages,
    faith_journey_stage,
    born_again,
    born_again_other,
    walking_with_christ_duration,
    church_involvement,
  } = req.body;

  const missing = [];
  if (!full_name?.trim()) missing.push("full_name");
  if (!email?.trim()) missing.push("email");
  if (!location_city?.trim()) missing.push("location_city");
  if (!location_country?.trim()) missing.push("location_country");
  if (!primary_language?.trim()) missing.push("primary_language");
  if (!faith_journey_stage) missing.push("faith_journey_stage");
  if (!born_again) missing.push("born_again");
  if (!walking_with_christ_duration) missing.push("walking_with_christ_duration");

  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }

  // Upsert (one row per user_id)
  const { data, error } = await supabase
    .from("p2p_registration_profiles")
    .upsert(
      {
        user_id: user_id ?? null,
        full_name: full_name.trim(),
        email: email.trim(),
        location_city: location_city.trim(),
        location_country: location_country.trim(),
        contact: contact?.trim() ?? null,
        primary_language: primary_language.trim(),
        other_languages: other_languages ?? [],
        faith_journey_stage: Number(faith_journey_stage),
        born_again,
        born_again_other: born_again === "other" ? (born_again_other ?? null) : null,
        walking_with_christ_duration,
        church_involvement: church_involvement?.trim() ?? null,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json(data);
});

// GET /api/registration/:userId — get a user's registration
router.get("/:userId", async (req, res) => {
  const { data, error } = await supabase
    .from("p2p_registration_profiles")
    .select("*")
    .eq("user_id", req.params.userId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: "Not found" });
  return res.json(data);
});

export default router;
