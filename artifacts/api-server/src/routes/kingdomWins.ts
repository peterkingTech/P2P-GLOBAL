import { Router } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";

// Kingdom Wins / Testimonies — "Look what God has done." A genuinely
// independent peer-authored domain (migration 150, extended 151 for P2P
// Impact): NOT the Prayer Wall ("please pray for me"), NOT Missions
// (admin-curated field reporting). Any authenticated user may author
// their own entry — there is no admin gate on CREATION here, matching
// the product intent that this is peer testimony, not curated editorial
// content. P2P Impact is a content classification within this same
// table (entry_type='p2p_impact'), not a second system.
//
// CORE PRINCIPLE: "Not our work. His work." Two things this file
// enforces everywhere, not just for the new entry type, per migration
// 151's own reasoning: (1) a PUBLISHED entry is always globally visible
// to the authenticated P2P community — never privately published; (2) an
// author's account being deleted never deletes their published
// testimony — it survives, attributed to "A Former P2P Member."
const router = Router();

function ok(res: import("express").Response, data: unknown) { return res.json(data); }
function err(res: import("express").Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}

const ENTRY_TYPES = ["kingdom_win", "testimony", "p2p_impact"];
const CATEGORIES = [
  "answered_prayer", "salvation", "healing", "freedom", "provision", "reconciliation",
  "spiritual_growth", "family", "work_calling", "evangelism", "discipleship", "missions", "other",
];
// Impact Themes — a richer, multi-select taxonomy distinct from the
// coarser single-select `category` above (same "controlled list,
// API-validated, no free-form tags" pattern as Missions' mission_focus).
const IMPACT_THEMES = [
  "bible_study", "prayer", "discipleship", "spiritual_growth", "peer_relationships", "family", "church",
  "mission", "evangelism", "scripture", "faith", "hope", "healing", "forgiveness", "obedience",
  "identity_in_christ", "knowing_god", "leadership", "serving", "unity", "encouragement",
];
const REACTION_TYPES = ["praying", "amen", "encourage"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_SETTABLE_STATUSES = ["draft", "submitted", "published", "archived"];
const MODERATOR_ONLY_STATUSES = ["rejected", "removed"];

function validThemes(themes: unknown): themes is string[] {
  return Array.isArray(themes) && themes.every((t) => typeof t === "string" && IMPACT_THEMES.includes(t));
}
interface GuidedSections {
  before?: string; journey?: string; whatGodDid?: string; today?: string; encouragement?: string;
}
// Guided creation (Before/Journey/What God Did/Today/Encouragement) is
// entirely optional and flexible — the assembled text becomes `body` so
// every existing card/detail renderer keeps working without changes.
// None of the five sections is required; at least one must be non-empty.
function assembleBodyFromSections(sections: GuidedSections): string | null {
  const labeled: [string, string | undefined][] = [
    ["Before", sections.before], ["The Journey", sections.journey], ["What God Did", sections.whatGodDid],
    ["Today", sections.today], ["Encouragement", sections.encouragement],
  ];
  const parts = labeled.filter(([, v]) => v?.trim()).map(([label, v]) => `${label}: ${v!.trim()}`);
  return parts.length ? parts.join("\n\n") : null;
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data } = await db.from("p2p_profiles").select("role").eq("id", userId).maybeSingle();
  return !!data && data.role !== "student";
}
async function notify(userId: string, title: string, message: string, notificationType: string, data: Record<string, unknown> = {}) {
  await db.from("p2p_notifications").insert({ user_id: userId, title, message, notification_type: notificationType, data });
}

function mapEntry(row: Record<string, unknown>, extra?: { authorName?: string | null; reactionCounts?: Record<string, number>; myReactions?: string[] }) {
  // "Not our work, His work": an anonymous author is a deliberate choice
  // by the author; a NULL author_id means the account no longer exists —
  // both hide the name, but for different reasons, and the second must
  // never be confused with "unauthorized" or make the story disappear.
  const authorName = row.author_id == null ? "A Former P2P Member" : (row.is_anonymous ? null : extra?.authorName ?? null);
  return {
    id: row.id, authorId: row.author_id, authorName,
    entryType: row.entry_type, title: row.title, body: row.body, lessonLearned: row.lesson_learned,
    category: row.category, impactThemes: row.impact_themes ?? [], guidedSections: row.guided_sections ?? null,
    scriptureReferenceId: row.scripture_reference_id, missionStoryId: row.mission_story_id,
    missionFieldId: row.mission_field_id, prayer2RequestId: row.prayer2_request_id, mediaType: row.media_type,
    mediaPath: row.media_path, mediaDurationSeconds: row.media_duration_seconds, isAnonymous: row.is_anonymous,
    visibility: row.visibility, status: row.status, moderationNote: row.moderation_note,
    consentConfirmedAt: row.consent_confirmed_at, createdAt: row.created_at, updatedAt: row.updated_at,
    submittedAt: row.submitted_at, publishedAt: row.published_at, archivedAt: row.archived_at,
    reactionCounts: extra?.reactionCounts ?? undefined, myReactions: extra?.myReactions ?? undefined,
  };
}
async function profileName(userId: string): Promise<string> {
  const { data } = await db.from("p2p_profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? "A peer";
}
async function reactionSummary(entryId: string, userId: string) {
  const { data } = await db.from("p2p_kingdom_win_reactions").select("reaction_type,user_id").eq("kingdom_win_id", entryId);
  const counts: Record<string, number> = {};
  const mine: string[] = [];
  for (const r of data ?? []) {
    counts[r.reaction_type as string] = (counts[r.reaction_type as string] ?? 0) + 1;
    if (r.user_id === userId) mine.push(r.reaction_type as string);
  }
  return { reactionCounts: counts, myReactions: mine };
}

// Shared by create/update: "published" always means globally visible to
// the authenticated P2P community — never a per-entry private audience.
// Enforced here (clear error message) AND by the DB CHECK (151) as a
// backstop, matching this codebase's "API validates, RLS/CHECK is the
// backstop" convention everywhere else.
function validateGlobalVisibility(status: string | undefined, visibility: string | undefined): string | null {
  if (status === "published" && visibility === "private") {
    return "Published testimonies are shared with the global P2P community and cannot be private.";
  }
  return null;
}
// Consent is required only for P2P Impact — its heavier guided/reviewed
// flow is what this feature's spec calls out for an explicit pre-publication
// consent step. Kingdom Win/Testimony keep their original, already-shipped
// self-publish flow (no consent step, no moderation queue) untouched.
function validateConsent(entryType: string, status: string | undefined, consentConfirmed: boolean | undefined, existingConsent: unknown): string | null {
  if (entryType !== "p2p_impact") return null;
  if ((status === "submitted" || status === "published") && !consentConfirmed && !existingConsent) {
    return "Please confirm the consent statement before sharing this testimony.";
  }
  return null;
}

// ── Create / manage own ──────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const {
    id, entryType, title, body, guidedSections, lessonLearned, category, impactThemes, scriptureReferenceId,
    missionStoryId, missionFieldId, prayer2RequestId, mediaType, mediaPath, mediaDurationSeconds,
    isAnonymous, visibility, status, consentConfirmed,
  } = req.body as {
    id?: string; entryType?: string; title?: string; body?: string; guidedSections?: GuidedSections;
    lessonLearned?: string | null; category?: string; impactThemes?: string[]; scriptureReferenceId?: string | null;
    missionStoryId?: string | null; missionFieldId?: string | null; prayer2RequestId?: string | null;
    mediaType?: "photo" | "video" | null; mediaPath?: string | null; mediaDurationSeconds?: number | null;
    isAnonymous?: boolean; visibility?: string; status?: string; consentConfirmed?: boolean;
  };
  if (id !== undefined && !UUID_RE.test(id)) return err(res, "id must be a valid UUID");
  if (!entryType || !ENTRY_TYPES.includes(entryType)) return err(res, `entryType must be one of: ${ENTRY_TYPES.join(", ")}`);
  if (!title?.trim()) return err(res, "title is required");
  const resolvedBody = body?.trim() || (guidedSections ? assembleBodyFromSections(guidedSections) : null);
  if (!resolvedBody) return err(res, "Write at least part of your story before continuing");
  if (!category || !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (impactThemes !== undefined && !validThemes(impactThemes)) return err(res, `impactThemes must be a subset of: ${IMPACT_THEMES.join(", ")}`);
  if (visibility !== undefined && !["p2p_network", "private"].includes(visibility)) return err(res, "visibility must be p2p_network or private");
  if (status !== undefined && !["draft", "submitted", "published"].includes(status)) return err(res, "status must be draft, submitted, or published on create");
  const visibilityErr = validateGlobalVisibility(status, visibility);
  if (visibilityErr) return err(res, visibilityErr);
  const consentErr = validateConsent(entryType, status, consentConfirmed, null);
  if (consentErr) return err(res, consentErr);
  if (mediaType !== undefined && mediaType !== null && !["photo", "video"].includes(mediaType)) return err(res, "mediaType must be photo or video");
  if (mediaType && !mediaPath) return err(res, "mediaPath is required when mediaType is set");
  if (mediaPath) {
    const segments = mediaPath.split("/");
    if (!mediaPath.startsWith(`${userId}/`)) return err(res, "mediaPath must be under your own storage prefix", 403);
    if (!id || segments[1] !== id) return err(res, "mediaPath must belong to this entry's id", 400);
  }
  if (prayer2RequestId) {
    const { data: request } = await db.from("p2p_prayer_coord_requests").select("id,user_id").eq("id", prayer2RequestId).maybeSingle();
    if (!request) return err(res, "That prayer request could not be found", 404);
    if (request.user_id !== userId) return err(res, "You can only link your own Prayer 2.0 request", 403);
  }
  if (missionStoryId) {
    const { data: story } = await db.from("p2p_mission_stories").select("id").eq("id", missionStoryId).eq("status", "published").maybeSingle();
    if (!story) return err(res, "That mission story could not be found", 404);
  }
  if (missionFieldId) {
    const { data: field } = await db.from("p2p_mission_fields").select("id").eq("id", missionFieldId).eq("status", "published").maybeSingle();
    if (!field) return err(res, "That mission field could not be found", 404);
  }

  const isPublishing = status === "published";
  const { data, error } = await db.from("p2p_kingdom_wins").insert({
    ...(id ? { id } : {}),
    author_id: userId, entry_type: entryType, title: title.trim(), body: resolvedBody,
    guided_sections: guidedSections ?? null,
    lesson_learned: lessonLearned?.trim() || null, category, impact_themes: impactThemes ?? [],
    scripture_reference_id: scriptureReferenceId ?? null, mission_story_id: missionStoryId ?? null,
    mission_field_id: missionFieldId ?? null, prayer2_request_id: prayer2RequestId ?? null,
    media_type: mediaType ?? null, media_path: mediaPath ?? null, media_duration_seconds: mediaDurationSeconds ?? null,
    is_anonymous: !!isAnonymous, visibility: visibility ?? "p2p_network", status: status ?? "draft",
    consent_confirmed_at: consentConfirmed ? new Date().toISOString() : null,
    submitted_at: status === "submitted" || isPublishing ? new Date().toISOString() : null,
    published_at: isPublishing ? new Date().toISOString() : null,
  }).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to create entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>, { authorName: await profileName(userId) }));
});

router.get("/mine", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data, error } = await db.from("p2p_kingdom_wins").select("*").eq("author_id", userId).order("created_at", { ascending: false });
  if (error) return err(res, error.message, 500);
  return ok(res, (data ?? []).map((r) => mapEntry(r as Record<string, unknown>)));
});

router.put("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_kingdom_wins").select("*").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Entry not found", 404);
  const callerIsAdmin = await isAdmin(userId);
  const isOwner = existing.author_id === userId;
  if (!isOwner && !callerIsAdmin) return err(res, "Only the author can edit this entry", 403);

  const {
    title, body, guidedSections, lessonLearned, category, impactThemes, scriptureReferenceId,
    isAnonymous, visibility, status, moderationNote, consentConfirmed,
  } = req.body as {
    title?: string; body?: string; guidedSections?: GuidedSections; lessonLearned?: string | null; category?: string;
    impactThemes?: string[]; scriptureReferenceId?: string | null; isAnonymous?: boolean; visibility?: string;
    status?: string; moderationNote?: string | null; consentConfirmed?: boolean;
  };
  if (category !== undefined && !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (impactThemes !== undefined && !validThemes(impactThemes)) return err(res, `impactThemes must be a subset of: ${IMPACT_THEMES.join(", ")}`);
  if (visibility !== undefined && !["p2p_network", "private"].includes(visibility)) return err(res, "visibility must be p2p_network or private");
  const effectiveVisibility = visibility ?? existing.visibility;
  const effectiveStatus = status ?? (existing.status as string);
  if (status !== undefined) {
    const allowed = callerIsAdmin ? [...OWNER_SETTABLE_STATUSES, ...MODERATOR_ONLY_STATUSES] : OWNER_SETTABLE_STATUSES;
    if (!allowed.includes(status)) return err(res, isOwner && !callerIsAdmin ? "You can only set draft, submitted, published, or archived" : "invalid status");
  }
  // Use the EFFECTIVE (resulting) status/visibility, not just whichever
  // field happened to be in this particular request — a request that only
  // touches visibility (status omitted) must still be validated against
  // the row's current status, otherwise "already published" + "just
  // changing visibility to private" silently produces the exact
  // published-but-private row this feature's global-visibility principle
  // forbids (only caught by the DB CHECK as a raw 500, not a clean 400).
  const visibilityErr = validateGlobalVisibility(effectiveStatus, effectiveVisibility);
  if (visibilityErr) return err(res, visibilityErr);
  const consentErr = validateConsent(existing.entry_type as string, effectiveStatus, consentConfirmed, existing.consent_confirmed_at);
  if (consentErr) return err(res, consentErr);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (title !== undefined) { if (!title.trim()) return err(res, "title cannot be empty"); updates.title = title.trim(); }
  if (body !== undefined) { if (!body.trim()) return err(res, "body cannot be empty"); updates.body = body.trim(); }
  else if (guidedSections !== undefined) {
    const assembled = assembleBodyFromSections(guidedSections);
    if (assembled) updates.body = assembled;
  }
  if (guidedSections !== undefined) updates.guided_sections = guidedSections;
  if (lessonLearned !== undefined) updates.lesson_learned = lessonLearned?.trim() || null;
  if (category !== undefined) updates.category = category;
  if (impactThemes !== undefined) updates.impact_themes = impactThemes;
  if (scriptureReferenceId !== undefined) updates.scripture_reference_id = scriptureReferenceId;
  if (isAnonymous !== undefined) updates.is_anonymous = !!isAnonymous;
  if (visibility !== undefined) updates.visibility = visibility;
  if (consentConfirmed && !existing.consent_confirmed_at) updates.consent_confirmed_at = new Date().toISOString();
  if (callerIsAdmin && moderationNote !== undefined) updates.moderation_note = moderationNote?.trim() || null;
  if (status !== undefined) {
    updates.status = status;
    if (status === "submitted" && !existing.submitted_at) updates.submitted_at = new Date().toISOString();
    if (status === "published" && existing.status !== "published") updates.published_at = new Date().toISOString();
    if (status === "archived" && !existing.archived_at) updates.archived_at = new Date().toISOString();
  }

  const { data, error } = await db.from("p2p_kingdom_wins").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update entry", 500);
  return ok(res, mapEntry(data as Record<string, unknown>, { authorName: existing.author_id ? await profileName(existing.author_id as string) : null }));
});

router.delete("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: existing } = await db.from("p2p_kingdom_wins").select("id,author_id,media_path").eq("id", req.params.id).maybeSingle();
  if (!existing) return err(res, "Entry not found", 404);
  if (existing.author_id !== userId) return err(res, "Only the author can delete this entry", 403);
  if (existing.media_path) await db.storage.from("kingdom-wins-media").remove([existing.media_path as string]);
  const { error } = await db.from("p2p_kingdom_wins").delete().eq("id", req.params.id);
  if (error) return err(res, error.message, 500);
  return ok(res, { removed: true });
});

// ── Public feed / detail ─────────────────────────────────────────────────────

router.get("/feed", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { category, entryType, impactTheme, page = "0", limit = "20" } = req.query as Record<string, string>;
  if (category && !CATEGORIES.includes(category)) return err(res, `category must be one of: ${CATEGORIES.join(", ")}`);
  if (entryType && !ENTRY_TYPES.includes(entryType)) return err(res, `entryType must be one of: ${ENTRY_TYPES.join(", ")}`);
  if (impactTheme && !IMPACT_THEMES.includes(impactTheme)) return err(res, `impactTheme must be one of: ${IMPACT_THEMES.join(", ")}`);
  const pageNum = Math.max(0, parseInt(page, 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
  const from = pageNum * pageSize;
  const to = from + pageSize - 1;

  // Only 'published' + 'p2p_network' rows ever reach here — archived and
  // removed entries are never part of normal global discovery, without
  // needing a separate "exclude archived" clause (they simply aren't
  // status='published' any more once archived).
  let query = db.from("p2p_kingdom_wins").select("*", { count: "exact" })
    .eq("status", "published").eq("visibility", "p2p_network").order("published_at", { ascending: false }).range(from, to);
  if (category) query = query.eq("category", category);
  if (entryType) query = query.eq("entry_type", entryType);
  if (impactTheme) query = query.contains("impact_themes", [impactTheme]);
  const { data, error, count } = await query;
  if (error) return err(res, error.message, 500);

  const withExtras = await Promise.all((data ?? []).map(async (r) => {
    const [authorName, { reactionCounts, myReactions }] = await Promise.all([
      r.author_id && !r.is_anonymous ? profileName(r.author_id as string) : Promise.resolve(null),
      reactionSummary(r.id as string, userId),
    ]);
    return mapEntry(r as Record<string, unknown>, { authorName, reactionCounts, myReactions });
  }));
  return ok(res, { entries: withExtras, total: count ?? 0, page: pageNum, pageSize });
});

router.get("/:id", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { data: entry } = await db.from("p2p_kingdom_wins").select("*").eq("id", req.params.id).maybeSingle();
  if (!entry) return err(res, "Entry not found", 404);
  const callerIsAdmin = entry.author_id === userId ? true : await isAdmin(userId);
  const viewable = (entry.status === "published" && entry.visibility === "p2p_network") || entry.author_id === userId || callerIsAdmin;
  if (!viewable) return err(res, "This entry is not available", 404);

  const [authorName, { reactionCounts, myReactions }] = await Promise.all([
    entry.author_id && !entry.is_anonymous ? profileName(entry.author_id as string) : Promise.resolve(null),
    reactionSummary(entry.id as string, userId),
  ]);
  return ok(res, mapEntry(entry as Record<string, unknown>, { authorName, reactionCounts, myReactions }));
});

router.get("/meta/impact-themes", async (req, res) => ok(res, IMPACT_THEMES));

// ── Reactions ────────────────────────────────────────────────────────────────

router.post("/:id/react", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { reactionType } = req.body as { reactionType?: string };
  if (!reactionType || !REACTION_TYPES.includes(reactionType)) return err(res, `reactionType must be one of: ${REACTION_TYPES.join(", ")}`);
  const { data: entry } = await db.from("p2p_kingdom_wins").select("id,status,visibility").eq("id", req.params.id).maybeSingle();
  if (!entry || entry.status !== "published" || entry.visibility !== "p2p_network") return err(res, "Entry not found", 404);

  const { error } = await db.from("p2p_kingdom_win_reactions")
    .upsert({ kingdom_win_id: req.params.id, user_id: userId, reaction_type: reactionType }, { onConflict: "kingdom_win_id,user_id,reaction_type" });
  if (error) return err(res, error.message, 500);
  return ok(res, await reactionSummary(req.params.id, userId));
});

router.delete("/:id/react/:reactionType", async (req, res) => {
  const userId = await verifyCaller(req);
  if (!userId) return err(res, "Unauthorized", 401);
  const { error } = await db.from("p2p_kingdom_win_reactions").delete()
    .eq("kingdom_win_id", req.params.id).eq("user_id", userId).eq("reaction_type", req.params.reactionType);
  if (error) return err(res, error.message, 500);
  return ok(res, await reactionSummary(req.params.id, userId));
});

// ── Moderation queue (new pre-publication review, additive) ────────────────
// No pre-publication review queue exists anywhere else in this codebase
// (Prayer Library/Testimonies/Mission Stories/original Kingdom Wins all
// self-publish; moderation elsewhere is reactive/report-based only via
// p2p_report_content/p2p_moderate_flag). Self-publish still works exactly
// as before for authors who use it — this is an ADDITIONAL path, gated by
// the existing requireAdmin middleware, not a replacement.

router.get("/admin/queue", requireAdmin, async (req, res) => {
  const { status = "submitted" } = req.query as { status?: string };
  if (!["submitted", "published", "rejected", "archived"].includes(status)) return err(res, "invalid status filter");
  const { data, error } = await db.from("p2p_kingdom_wins").select("*").eq("status", status).order("submitted_at", { ascending: true, nullsFirst: false });
  if (error) return err(res, error.message, 500);
  const withNames = await Promise.all((data ?? []).map(async (r) => mapEntry(r as Record<string, unknown>, { authorName: r.author_id ? await profileName(r.author_id as string) : null })));
  return ok(res, withNames);
});

router.post("/:id/moderate", requireAdmin, async (req, res) => {
  const { action, note } = req.body as { action?: string; note?: string };
  if (!action || !["approve", "reject", "archive"].includes(action)) return err(res, "action must be approve, reject, or archive");
  const { data: entry } = await db.from("p2p_kingdom_wins").select("id,author_id,title,status").eq("id", req.params.id).maybeSingle();
  if (!entry) return err(res, "Entry not found", 404);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString(), moderation_note: note?.trim() || null };
  let notifyTitle = "", notifyMessage = "";
  if (action === "approve") {
    updates.status = "published"; updates.published_at = new Date().toISOString();
    notifyTitle = "Your story was published"; notifyMessage = `"${entry.title}" is now visible to the P2P community. Thank you for testifying to what God has done.`;
  } else if (action === "reject") {
    updates.status = "rejected";
    notifyTitle = "Your story needs a revision"; notifyMessage = note?.trim() ? `"${entry.title}" wasn't published: ${note.trim()}` : `"${entry.title}" wasn't published this time.`;
  } else {
    updates.status = "archived"; updates.archived_at = new Date().toISOString();
    notifyTitle = "Your story was archived"; notifyMessage = `"${entry.title}" has been archived and is no longer publicly visible.`;
  }

  const { data, error } = await db.from("p2p_kingdom_wins").update(updates).eq("id", req.params.id).select().single();
  if (error || !data) return err(res, error?.message ?? "Failed to update entry", 500);
  if (entry.author_id) {
    await notify(entry.author_id as string, notifyTitle, notifyMessage, "kingdom_win_moderation", { kingdomWinId: entry.id, action });
  }
  return ok(res, mapEntry(data as Record<string, unknown>, { authorName: entry.author_id ? await profileName(entry.author_id as string) : null }));
});

export default router;
