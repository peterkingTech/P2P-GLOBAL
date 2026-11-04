import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin, requirePermission } from "../middleware/adminAuth";
import { audit } from "../lib/adminIdentity";
import { stageInfo } from "../lib/growthStages";

// Admin Centre (Phase 6). Every figure comes from real records — totals only,
// never a reflection, journal, message, prayer or evaluation's content.
//   GET  /admin-centre/overview                       (dashboard.view)
//   GET  /admin-centre/growth                         (growth.view)         — the milestone matrix and its state
//   PUT  /admin-centre/growth                         (growth.approve_matrix) — approve the matrix / switch promotions, with a reason
//   GET  /admin-centre/relationships?username=        (genealogy.view_named) — one person's relationships
//   POST /admin-centre/relationships/:linkId/end      (genealogy.correct)   — a correction: ended with a reason, history kept
// Sensitive actions go to the append-only admin audit (who, role, what, why).

const router = Router();
router.use(requireAdmin);
const ctx = (req: Request) => ({ adminUserId: (req as any).adminUserId as string, adminRole: (req as any).adminRole as string, sessionId: ((req as any).adminSessionId as string | undefined) ?? null });
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
const count = async (table: string, build: (q: any) => any = (q) => q): Promise<number> => {
  const { count: n } = await build(db.from(table).select("*", { count: "exact", head: true }));
  return n ?? 0;
};

router.get("/overview", requirePermission("dashboard.view"), async (req: Request, res: Response) => {
  try {
    const peers = (q: any) => q.eq("is_official_account", false);
    const [total, active7, active30, new7, new30, families, familyMembers, churches, churchMembers] = await Promise.all([
      count("p2p_profiles", peers), count("p2p_profiles", (q) => peers(q).gte("last_active_at", ago(7))), count("p2p_profiles", (q) => peers(q).gte("last_active_at", ago(30))),
      count("p2p_profiles", (q) => peers(q).gte("created_at", ago(7))), count("p2p_profiles", (q) => peers(q).gte("created_at", ago(30))),
      count("p2p_families"), count("p2p_family_members", (q) => q.eq("status", "active")), count("p2p_churches"), count("p2p_church_members", (q) => q.eq("is_active", true)),
    ]);
    const { data: links } = await db.from("p2p_discipleship_links").select("mentor_id,disciple_id,started_at").in("status", ["active", "paused"]).limit(100000);
    const rows = (links ?? []) as { mentor_id: string; disciple_id: string; started_at: string | null }[];
    const kids = new Map<string, string[]>(); const disciples = new Set<string>(); const mentors = new Set<string>();
    for (const r of rows) { kids.set(r.mentor_id, [...(kids.get(r.mentor_id) ?? []), r.disciple_id]); disciples.add(r.disciple_id); mentors.add(r.mentor_id); }
    let generations = 0;
    for (const root of [...mentors].filter((m) => !disciples.has(m))) {
      let frontier = [root]; const seen = new Set([root]); let d = 1;
      while (frontier.length && d < 200) { const next = frontier.flatMap((f) => kids.get(f) ?? []).filter((x) => !seen.has(x)); next.forEach((x) => seen.add(x)); if (next.length) d++; frontier = next; }
      generations = Math.max(generations, d);
    }
    const { data: st } = await db.from("p2p_growth_status").select("stage,verification");
    const stages = [1, 2, 3, 4, 5].map((n) => ({ stage: n, name: stageInfo(n).name, people: ((st ?? []) as { stage: number }[]).filter((s) => s.stage === n).length }));
    const legacy = ((st ?? []) as { verification: string }[]).filter((s) => s.verification === "legacy_unverified").length;
    const { data: gs } = await db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled").maybeSingle();
    const [lessons30, evalQueued, evalActive, evalLegacy, evalDone30, storiesPub, storiesReview, storiesDraft, curPub, curDraft, growthQueue, growthFailing, pushWaiting] = await Promise.all([
      count("p2p_growth_events", (q) => q.eq("event_type", "lesson_completed").gte("created_at", ago(30))),
      count("p2p_lesson_evaluations", (q) => q.eq("engine_state", "queued")),
      count("p2p_lesson_evaluations", (q) => q.in("engine_state", ["invited", "in_progress"])),
      count("p2p_lesson_evaluations", (q) => q.is("engine_state", null).eq("status", "pending")),
      count("p2p_lesson_evaluations", (q) => q.in("status", ["approved", "needs_revision"]).gte("resolved_at", ago(30))),
      count("p2p_kingdom_stories", (q) => q.eq("status", "published")), count("p2p_kingdom_stories", (q) => q.eq("status", "review")), count("p2p_kingdom_stories", (q) => q.eq("status", "draft")),
      count("p2p_curriculums", (q) => q.eq("status", "published")), count("p2p_curriculums", (q) => q.eq("status", "draft")),
      count("p2p_growth_queue"), count("p2p_growth_queue", (q) => q.gt("attempts", 0)),
      count("p2p_notifications", (q) => q.is("pushed_at", null).lt("created_at", ago(1 / 96)).gte("created_at", ago(1))),
    ]);
    const { data: learnersRows } = await db.from("p2p_growth_events").select("user_id").eq("event_type", "lesson_completed").gte("created_at", ago(30)).limit(50000);
    const { data: sweep } = await db.from("p2p_evaluation_events").select("created_at").eq("event_type", "sweep").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const perms = ((req as any).adminPermissions as string[] | undefined) ?? [];
    let recent: unknown[] = [];
    if (perms.includes("audit.view")) {
      const { data: a } = await db.from("p2p_admin_audit").select("at,admin_role,action,target_type").order("at", { ascending: false }).limit(10);
      recent = a ?? [];
    }
    return res.json({
      community: { peers: total, active7, active30, newRegistrations7: new7, newRegistrations30: new30, families, familyMembers, churches, churchMembers },
      discipleship: { activeRelationships: rows.length, beingGuided: disciples.size, guiding: mentors.size, generations: rows.length ? generations : 0,
        relationshipsBegun30: rows.filter((r) => r.started_at && r.started_at >= ago(30)).length, stages, legacyStages: legacy,
        milestones: (gs as { thresholds_status?: string } | null)?.thresholds_status ?? "draft", promotionsEnabled: !!(gs as { promotions_enabled?: boolean } | null)?.promotions_enabled },
      learning: { lessonsCompleted30: lessons30, activeLearners30: new Set(((learnersRows ?? []) as { user_id: string }[]).map((r) => r.user_id)).size,
        evaluationsWaiting: evalQueued + evalLegacy, evaluationsInProgress: evalActive, evaluationsCompleted30: evalDone30 },
      content: { storiesPublished: storiesPub, storiesInReview: storiesReview, storiesDraft, curriculaPublished: curPub, curriculaDraft: curDraft },
      health: { api: "ok", growthQueue, growthQueueFailing: growthFailing, evaluationSweepLastRun: (sweep as { created_at?: string } | null)?.created_at ?? null, notificationsAwaitingPush: pushWaiting },
      recentAdminActivity: recent,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Couldn't load the overview." });
  }
});

router.get("/growth", requirePermission("growth.view"), async (_req: Request, res: Response) => {
  const [{ data: settings }, { data: reqs }] = await Promise.all([
    db.from("p2p_growth_settings").select("calc_version,thresholds_status,promotions_enabled,approved_at,updated_at").maybeSingle(),
    db.from("p2p_growth_requirements").select("stage,dimension,fact_key,min_value,label,data_source,display_order").order("stage").order("display_order"),
  ]);
  return res.json({ settings, requirements: ((reqs ?? []) as { stage: number }[]).map((r) => ({ ...r, stageName: stageInfo(r.stage).name })) });
});

router.put("/growth", requirePermission("growth.approve_matrix"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return res.status(400).json({ error: "Say why this change is being made." });
  const { data: before } = await db.from("p2p_growth_settings").select("thresholds_status,promotions_enabled").maybeSingle();
  const next: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (req.body?.approveMatrix === true) { next.thresholds_status = "approved"; next.approved_at = new Date().toISOString(); next.approved_by = adminUserId; }
  if (typeof req.body?.promotionsEnabled === "boolean") next.promotions_enabled = req.body.promotionsEnabled;
  const { error } = await db.from("p2p_growth_settings").update(next).eq("id", true);
  if (error) return res.status(409).json({ error: /promote_approved/.test(error.message) ? "Promotions can only start once the milestone matrix is approved." : "Couldn't update growth settings." });
  await audit({ adminUserId, adminRole, sessionId, action: "growth.settings_changed", targetType: "growth_settings", reason, detail: { before, after: next } });
  // When promotions start, everyone is re-checked by the engine's own worker.
  if (next.promotions_enabled === true) await db.rpc("p2p_growth_reconcile_all");
  return res.json({ updated: true });
});

router.get("/relationships", requirePermission("genealogy.view_named"), async (req: Request, res: Response) => {
  const username = String(req.query.username ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!username) return res.status(400).json({ error: "A username is required." });
  const { data: person } = await db.from("p2p_profiles").select("id,full_name,username").ilike("username", username).maybeSingle();
  if (!person) return res.status(404).json({ error: "No one with that username." });
  const p = person as { id: string; full_name: string | null; username: string };
  const { data: links } = await db.from("p2p_discipleship_links").select("id,mentor_id,disciple_id,status,is_primary,started_at,ended_at,end_reason,created_at")
    .or(`mentor_id.eq.${p.id},disciple_id.eq.${p.id}`).order("created_at", { ascending: false }).limit(200);
  const rows = (links ?? []) as { id: string; mentor_id: string; disciple_id: string; status: string; is_primary: boolean; started_at: string | null; ended_at: string | null; end_reason: string | null; created_at: string }[];
  const ids = [...new Set(rows.flatMap((r) => [r.mentor_id, r.disciple_id]))];
  const { data: ps } = ids.length ? await db.from("p2p_profiles").select("id,full_name,username").in("id", ids) : { data: [] };
  const name = new Map(((ps ?? []) as { id: string; full_name: string | null; username: string | null }[]).map((x) => [x.id, x.full_name || (x.username ? `@${x.username}` : "Unknown")]));
  const { adminUserId, adminRole, sessionId } = ctx(req);
  await audit({ adminUserId, adminRole, sessionId, action: "genealogy.relationships_viewed", targetType: "profile", targetId: p.id });
  return res.json({ person: { id: p.id, name: p.full_name || `@${p.username}` }, relationships: rows.map((r) => ({ ...r, mentorName: name.get(r.mentor_id), discipleName: name.get(r.disciple_id) })) });
});

router.post("/relationships/:linkId/end", requirePermission("genealogy.correct"), async (req: Request, res: Response) => {
  const { adminUserId, adminRole, sessionId } = ctx(req);
  const reason = String(req.body?.reason ?? "").trim();
  if (reason.length < 5) return res.status(400).json({ error: "Explain the correction (it is kept with the relationship's history)." });
  const { data, error } = await db.rpc("p2p_link_set_status", { p_link: String(req.params.linkId), p_actor: adminUserId, p_status: "ended", p_reason: `Administrator correction: ${reason}` });
  if (error) return res.status(409).json({ error: String(error.message).replace(/^P2P_LINK[A-Z_]*:\s*/, "") });
  await audit({ adminUserId, adminRole, sessionId, action: "genealogy.relationship_ended", targetType: "discipleship_link", targetId: String(req.params.linkId), reason, detail: { status: data } });
  return res.json({ status: data });
});

export default router;
