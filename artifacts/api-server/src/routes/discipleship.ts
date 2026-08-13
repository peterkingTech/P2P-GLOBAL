import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";
// p2p_notifications has no client-facing INSERT policy for writing to
// someone ELSE's user_id (self select/update only — migration 007), and the
// matching/connection-request endpoints below need to read across many
// candidates' profiles and progress at once — same reasoning as every other
// privileged write/read in this API (see prayer.ts, curriculum.ts).
const supabaseWrite = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

const CONNECTION_REQUEST_TTL_HOURS = 72;

function mapLink(row: Record<string, unknown>) {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    discipleId: row.disciple_id,
    isActive: row.active ?? true,
    status: row.status ?? "active",
    createdAt: row.created_at,
  };
}

// GET /discipleship/my-peer-guide/:userId — used by the crisis-alert screen's
// "Call My Peer Guide" button, which needs the id to call before it can even
// build the Agora channel name.
router.get("/my-peer-guide/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data: link } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("disciple_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!link?.mentor_id) return res.json({ peerGuideId: null, peerGuideName: null });

  const { data: profile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", link.mentor_id).maybeSingle();
  return res.json({ peerGuideId: link.mentor_id, peerGuideName: profile?.full_name ?? "Your peer guide" });
});

// GET /discipleship/:userId/disciples
router.get("/:userId/disciples", async (req, res) => {
  const { userId } = req.params;
  const { data, error } = await supabase
    .from("p2p_discipleship_links")
    .select("*")
    .eq("mentor_id", userId)
    .eq("active", true);

  if (error) {
    return res.status(500).json({ error: error.message });
  }
  return res.json(((data ?? []) as Record<string, unknown>[]).map(mapLink));
});

// POST /discipleship
router.post("/", async (req, res) => {
  const { mentorId, discipleId } = req.body as {
    mentorId: string;
    discipleId: string;
  };

  const { data, error } = await supabase
    .from("p2p_discipleship_links")
    .insert({
      mentor_id: mentorId,
      disciple_id: discipleId,
      active: true,
      status: "active",
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    return res.status(500).json({ error: error?.message ?? "Insert failed" });
  }
  return res.status(201).json(mapLink(data as Record<string, unknown>));
});

// POST /discipleship/notify-peer-guide — notify the caller's ACTIVE peer
// guide with a caller-supplied title/message. Used by the Integration
// Journey's "Pray Together" (step 3) and "Begin Module 1" (step 5) moments.
router.post("/notify-peer-guide", async (req, res) => {
  const { userId, title, message } = req.body as { userId?: string; title?: string; message?: string };
  if (!userId || !title || !message) {
    return res.status(400).json({ error: "userId, title, and message are required" });
  }

  const { data: link } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("disciple_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!link?.mentor_id) return res.json({ notified: false, reason: "No peer guide on record" });

  const { error } = await supabaseWrite.from("p2p_notifications").insert({
    user_id: link.mentor_id,
    title,
    message,
  });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notified: true });
});

// POST /discipleship/notify-user — direct, caller-supplied-userId
// notification (no lookup). Same trust model as the rest of this non-admin
// API (e.g. /plans/:planId/progress/:userId) — the caller's own client
// already knows who they mean to notify (e.g. a peer guide sending their
// learner the completion letter). Needed because p2p_notifications has no
// client-facing INSERT policy for writing to someone else's user_id.
router.post("/notify-user", async (req, res) => {
  const { userId, title, message } = req.body as { userId?: string; title?: string; message?: string };
  if (!userId || !title || !message) {
    return res.status(400).json({ error: "userId, title, and message are required" });
  }
  const { error } = await supabaseWrite.from("p2p_notifications").insert({ user_id: userId, title, message });
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ notified: true });
});

// ── Peer Guide Smart Matching ────────────────────────────────────────────────
//
// Continent lookup is a best-effort, honestly partial signal: p2p_profiles
// has no dedicated geo/continent column, only a freeform `country` text
// field filled in various ways across intake/settings. This covers common
// country names/codes; anything not recognized simply scores 0 for the
// "same continent" signal rather than erroring.
const CONTINENT_BY_COUNTRY: Record<string, string> = {
  nigeria: "Africa", ghana: "Africa", kenya: "Africa", "south africa": "Africa",
  uganda: "Africa", tanzania: "Africa", ethiopia: "Africa", egypt: "Africa",
  zimbabwe: "Africa", zambia: "Africa", rwanda: "Africa", cameroon: "Africa",
  "united states": "North America", usa: "North America", us: "North America",
  canada: "North America", mexico: "North America",
  brazil: "South America", argentina: "South America", colombia: "South America",
  peru: "South America", chile: "South America", venezuela: "South America",
  "united kingdom": "Europe", uk: "Europe", germany: "Europe", france: "Europe",
  spain: "Europe", italy: "Europe", portugal: "Europe", netherlands: "Europe",
  poland: "Europe", ukraine: "Europe", ireland: "Europe",
  india: "Asia", china: "Asia", philippines: "Asia", indonesia: "Asia",
  pakistan: "Asia", "sri lanka": "Asia", vietnam: "Asia", "south korea": "Asia",
  japan: "Asia", malaysia: "Asia", singapore: "Asia",
  australia: "Oceania", "new zealand": "Oceania",
};
function continentOf(country?: string | null): string | null {
  if (!country) return null;
  return CONTINENT_BY_COUNTRY[country.trim().toLowerCase()] ?? null;
}

// timezone is stored as a simple UTC-offset string (e.g. "+1", "-5", "+5.5")
// — nothing in this codebase populates real IANA zone data yet, so this is a
// deliberately simple honest heuristic rather than full timezone resolution.
function parseUtcOffset(tz?: string | null): number | null {
  if (!tz) return null;
  const n = Number(tz);
  return Number.isFinite(n) ? n : null;
}

interface PeerGuideCandidate {
  id: string;
  fullName: string;
  photoUrl: string | null;
  country: string | null;
  contentLanguage: string | null;
  timezone: string | null;
  backgroundSensitivity: string | null;
  activeMenteeCount: number;
  maxMentees: number;
  modulesCompleted: number;
  countryCode: string | null;
  locationVerified: boolean;
  isVerified: boolean;
}

async function getEligibleCandidates(requesterId: string, excludeCandidateIds: string[] = []): Promise<PeerGuideCandidate[]> {
  const { data: candidateProfiles } = await supabaseWrite
    .from("p2p_profiles")
    .select("id, full_name, photo_url, country, country_code, location_verified, content_language, timezone, background_sensitivity, is_peer_guide_eligible, max_mentees, accepting_mentees, is_verified")
    .neq("id", requesterId)
    .eq("accepting_mentees", true);

  let candidates = (candidateProfiles ?? []) as Record<string, unknown>[];
  candidates = candidates.filter((c) => !excludeCandidateIds.includes(c.id as string));
  if (candidates.length === 0) return [];
  const candidateIds = candidates.map((c) => c.id as string);

  // Exclude anyone already linked (any status) with the requester — either
  // an existing pending request or an existing active mentor relationship.
  const { data: existingLinks } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("disciple_id", requesterId)
    .in("mentor_id", candidateIds);
  const alreadyLinked = new Set((existingLinks ?? []).map((l: Record<string, unknown>) => l.mentor_id as string));
  candidates = candidates.filter((c) => !alreadyLinked.has(c.id as string));
  if (candidates.length === 0) return [];

  // Active mentee counts (current mentor load) for the "fewer than max_mentees" filter.
  const { data: menteeLinks } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("mentor_id")
    .eq("active", true)
    .in("mentor_id", candidates.map((c) => c.id as string));
  const menteeCountByMentor = new Map<string, number>();
  for (const l of (menteeLinks ?? []) as Record<string, unknown>[]) {
    const mid = l.mentor_id as string;
    menteeCountByMentor.set(mid, (menteeCountByMentor.get(mid) ?? 0) + 1);
  }

  // Active in the last 30 days = any lesson_progress row updated recently.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentProgress } = await supabaseWrite
    .from("p2p_lesson_progress")
    .select("user_id, updated_at")
    .in("user_id", candidates.map((c) => c.id as string))
    .gte("updated_at", thirtyDaysAgo);
  const recentlyActive = new Set((recentProgress ?? []).map((p: Record<string, unknown>) => p.user_id as string));

  // Module 1 completion (fallback eligibility signal for anyone not manually
  // flagged is_peer_guide_eligible) via the existing, already-relied-on
  // p2p_active_curriculum_id() / p2p_module_fully_completed() functions.
  const { data: activeCurriculumId } = await supabaseWrite.rpc("p2p_active_curriculum_id");
  let module1Id: string | null = null;
  if (activeCurriculumId) {
    const { data: module1 } = await supabaseWrite
      .from("p2p_modules")
      .select("id")
      .eq("curriculum_id", activeCurriculumId as string)
      .order("order_index", { ascending: true })
      .limit(1)
      .maybeSingle();
    module1Id = (module1 as Record<string, unknown> | null)?.id as string ?? null;
  }
  const module1CompletedBy = new Set<string>();
  if (module1Id) {
    await Promise.all(
      candidates.map(async (c) => {
        const { data: done } = await supabaseWrite.rpc("p2p_module_fully_completed", {
          p_user_id: c.id, p_module_id: module1Id,
        });
        if (done) module1CompletedBy.add(c.id as string);
      })
    );
  }

  // Modules completed count (for the "more = better match" scoring signal).
  const modulesCompletedByUser = new Map<string, number>();
  if (activeCurriculumId) {
    const { data: allModules } = await supabaseWrite
      .from("p2p_modules")
      .select("id")
      .eq("curriculum_id", activeCurriculumId as string);
    const moduleIds = (allModules ?? []).map((m: Record<string, unknown>) => m.id as string);
    if (moduleIds.length) {
      await Promise.all(
        candidates.map(async (c) => {
          let count = 0;
          for (const mid of moduleIds) {
            const { data: done } = await supabaseWrite.rpc("p2p_module_fully_completed", {
              p_user_id: c.id, p_module_id: mid,
            });
            if (done) count += 1;
          }
          modulesCompletedByUser.set(c.id as string, count);
        })
      );
    }
  }

  const eligible: PeerGuideCandidate[] = [];
  for (const c of candidates) {
    const id = c.id as string;
    const maxMentees = (c.max_mentees as number) ?? 3;
    const activeMenteeCount = menteeCountByMentor.get(id) ?? 0;
    const isEligible = !!c.is_peer_guide_eligible || module1CompletedBy.has(id);
    if (!isEligible) continue;
    if (activeMenteeCount >= maxMentees) continue;
    if (!recentlyActive.has(id)) continue;

    eligible.push({
      id,
      fullName: (c.full_name as string) ?? "A believer",
      photoUrl: (c.photo_url as string) ?? null,
      country: (c.country as string) ?? null,
      contentLanguage: (c.content_language as string) ?? null,
      timezone: (c.timezone as string) ?? null,
      backgroundSensitivity: (c.background_sensitivity as string) ?? null,
      activeMenteeCount,
      maxMentees,
      modulesCompleted: modulesCompletedByUser.get(id) ?? 0,
      countryCode: (c.country_code as string) ?? null,
      locationVerified: (c.location_verified as boolean) ?? false,
      isVerified: (c.is_verified as boolean) ?? false,
    });
  }
  return eligible;
}

interface ScoredMatch {
  id: string;
  fullName: string;
  photoUrl: string | null;
  country: string | null;
  contentLanguage: string | null;
  modulesCompleted: number;
  activeMenteeCount: number;
  maxMentees: number;
  isVerified: boolean;
  score: number;
  reasons: string[];
}

async function scoreCandidates(requesterId: string, excludeCandidateIds: string[] = []): Promise<ScoredMatch[]> {
  const { data: requesterProfile } = await supabaseWrite
    .from("p2p_profiles")
    .select("country, country_code, content_language, timezone, background_sensitivity")
    .eq("id", requesterId)
    .maybeSingle();
  const requester = (requesterProfile ?? {}) as Record<string, unknown>;
  const requesterContinent = continentOf(requester.country as string | undefined);
  const requesterOffset = parseUtcOffset(requester.timezone as string | undefined);

  const candidates = await getEligibleCandidates(requesterId, excludeCandidateIds);

  const scored: ScoredMatch[] = candidates.map((c) => {
    let score = 0;
    const reasons: string[] = [];

    if (requester.content_language && c.contentLanguage && requester.content_language === c.contentLanguage) {
      score += 30;
      reasons.push("Same language");
    }
    // Country matching uses only the GPS-verified country_code, never the
    // freeform, manually-typed `country` text field — a verified code is
    // exact and can't be spoofed by typing a fake location.
    const requesterCode = requester.country_code as string | undefined;
    if (requesterCode && c.countryCode && requesterCode === c.countryCode) {
      score += 20;
      reasons.push("Same country");
    } else {
      const candidateContinent = continentOf(c.country);
      if (requesterContinent && candidateContinent && requesterContinent === candidateContinent) {
        score += 10;
        reasons.push("Same region of the world");
      }
    }
    // Verified location gives a small trust boost — it signals the
    // candidate's profile location is real, not just typed in.
    if (c.locationVerified) {
      score += 5;
      reasons.push("Verified location");
    }
    const candidateOffset = parseUtcOffset(c.timezone);
    if (requesterOffset !== null && candidateOffset !== null && Math.abs(requesterOffset - candidateOffset) <= 4) {
      score += 15;
      reasons.push("Close timezone");
    }
    score += Math.min(10, c.modulesCompleted);
    if (c.modulesCompleted > 0) reasons.push("Experienced in the curriculum");

    const availabilityScore = Math.round((1 - c.activeMenteeCount / Math.max(1, c.maxMentees)) * 10);
    score += availabilityScore;
    if (c.activeMenteeCount === 0) reasons.push("Available to guide");

    if (requester.background_sensitivity && c.backgroundSensitivity && requester.background_sensitivity === c.backgroundSensitivity) {
      score += 20;
      reasons.push("Understands your background");
    }
    if (c.isVerified) {
      score += 10;
      reasons.push("Identity verified");
    }

    return {
      id: c.id,
      fullName: c.fullName,
      photoUrl: c.photoUrl,
      country: c.country,
      contentLanguage: c.contentLanguage,
      modulesCompleted: c.modulesCompleted,
      activeMenteeCount: c.activeMenteeCount,
      maxMentees: c.maxMentees,
      isVerified: c.isVerified,
      score,
      reasons,
    };
  });

  return scored.sort((a, b) => b.score - a.score);
}

// GET /discipleship/find-peer-guide/:userId — top 5 eligible peer guide
// matches for this learner, scored and with human-readable match reasons.
router.get("/find-peer-guide/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const scored = await scoreCandidates(userId);
    return res.json(scored.slice(0, 5));
  } catch (e: any) {
    return res.status(500).json({ error: e.message ?? "Failed to find peer guide matches" });
  }
});

// POST /discipleship/request — learner taps "Connect" on a candidate.
router.post("/request", async (req, res) => {
  const { learnerId, peerGuideId } = req.body as { learnerId?: string; peerGuideId?: string };
  if (!learnerId || !peerGuideId) return res.status(400).json({ error: "learnerId and peerGuideId are required" });

  const requestedAt = new Date();
  const expiresAt = new Date(requestedAt.getTime() + CONNECTION_REQUEST_TTL_HOURS * 60 * 60 * 1000);

  const { data, error } = await supabaseWrite
    .from("p2p_discipleship_links")
    .insert({
      mentor_id: peerGuideId,
      disciple_id: learnerId,
      active: false,
      status: "pending",
      requested_at: requestedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_at: requestedAt.toISOString(),
    })
    .select()
    .single();
  if (error || !data) return res.status(500).json({ error: error?.message ?? "Could not create connection request" });

  const { data: learnerProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", learnerId).maybeSingle();
  const learnerName = (learnerProfile as Record<string, unknown> | null)?.full_name ?? "A learner";

  await supabaseWrite.from("p2p_notifications").insert({
    user_id: peerGuideId,
    title: "A new peer guide request",
    message: `${learnerName} is looking for a peer guide and you are a great match. Will you walk alongside them?`,
  });

  return res.status(201).json(mapLink(data as Record<string, unknown>));
});

// GET /discipleship/pending-requests/:userId — incoming Connect requests
// this user (as a prospective peer guide) can Accept/Decline.
router.get("/pending-requests/:userId", async (req, res) => {
  const { userId } = req.params;
  const { data: links, error } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("id, disciple_id, requested_at, expires_at")
    .eq("mentor_id", userId)
    .eq("status", "pending")
    .order("requested_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const rows = (links ?? []) as Record<string, unknown>[];
  const discipleIds = rows.map((r) => r.disciple_id as string);
  let profileById = new Map<string, Record<string, unknown>>();
  if (discipleIds.length) {
    const { data: profiles } = await supabaseWrite
      .from("p2p_profiles")
      .select("id, full_name, photo_url, country")
      .in("id", discipleIds);
    profileById = new Map((profiles ?? []).map((p: Record<string, unknown>) => [p.id as string, p]));
  }

  return res.json(
    rows.map((r) => {
      const p = profileById.get(r.disciple_id as string);
      return {
        id: r.id,
        learnerId: r.disciple_id,
        learnerName: (p?.full_name as string) ?? "A learner",
        learnerPhotoUrl: (p?.photo_url as string) ?? null,
        learnerCountry: (p?.country as string) ?? null,
        requestedAt: r.requested_at,
        expiresAt: r.expires_at,
      };
    })
  );
});

// PUT /discipleship/request/:linkId/respond — peer guide accepts or declines.
router.put("/request/:linkId/respond", async (req, res) => {
  const { linkId } = req.params;
  const { userId, decision } = req.body as { userId?: string; decision?: "accept" | "decline" };
  if (!userId || (decision !== "accept" && decision !== "decline")) {
    return res.status(400).json({ error: "userId and decision ('accept'|'decline') are required" });
  }

  const { data: link } = await supabaseWrite
    .from("p2p_discipleship_links")
    .select("*")
    .eq("id", linkId)
    .eq("mentor_id", userId)
    .eq("status", "pending")
    .maybeSingle();
  if (!link) return res.status(404).json({ error: "Pending request not found" });

  const l = link as Record<string, unknown>;
  const learnerId = l.disciple_id as string;

  if (decision === "accept") {
    const { error } = await supabaseWrite
      .from("p2p_discipleship_links")
      .update({ status: "active", active: true, responded_at: new Date().toISOString() })
      .eq("id", linkId);
    if (error) return res.status(500).json({ error: error.message });

    const { data: guideProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
    const guideName = (guideProfile as Record<string, unknown> | null)?.full_name ?? "Your peer guide";
    await supabaseWrite.from("p2p_notifications").insert([
      { user_id: learnerId, title: "Your peer guide accepted!", message: `${guideName} has accepted your request and is ready to walk alongside you.` },
      { user_id: userId, title: "Connection confirmed", message: "You are now walking alongside a new disciple. Reach out and welcome them." },
    ]);
    return res.json({ status: "active" });
  }

  // Decline — mark this link declined, then automatically offer the next best match.
  const { error: declineErr } = await supabaseWrite
    .from("p2p_discipleship_links")
    .update({ status: "declined", active: false, responded_at: new Date().toISOString() })
    .eq("id", linkId);
  if (declineErr) return res.status(500).json({ error: declineErr.message });

  const nextMatches = await scoreCandidates(learnerId, [userId]);
  const next = nextMatches[0];
  if (next) {
    const requestedAt = new Date();
    const expiresAt = new Date(requestedAt.getTime() + CONNECTION_REQUEST_TTL_HOURS * 60 * 60 * 1000);
    await supabaseWrite.from("p2p_discipleship_links").insert({
      mentor_id: next.id,
      disciple_id: learnerId,
      active: false,
      status: "pending",
      requested_at: requestedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      created_at: requestedAt.toISOString(),
    });
    const { data: learnerProfile } = await supabaseWrite.from("p2p_profiles").select("full_name").eq("id", learnerId).maybeSingle();
    const learnerName = (learnerProfile as Record<string, unknown> | null)?.full_name ?? "A learner";
    await supabaseWrite.from("p2p_notifications").insert([
      { user_id: next.id, title: "A new peer guide request", message: `${learnerName} is looking for a peer guide and you are a great match. Will you walk alongside them?` },
      { user_id: learnerId, title: "We found you another match", message: `${next.fullName} may be a great peer guide for you. We've sent them your request.` },
    ]);
  } else {
    await supabaseWrite.from("p2p_notifications").insert({
      user_id: learnerId,
      title: "Still finding your match",
      message: "We are still finding the best peer guide for you. We will notify you when someone becomes available. You can begin Module 1 on your own in the meantime.",
    });
  }

  return res.json({ status: "declined", nextMatchOffered: !!next });
});

export default router;