// ABOUT P2P — the 11 introduction videos (owner brief 2026-11-26). Mounted at /api/intro-videos.
//
// One text-free master per video (footage + original English sound), plus per language: subtitles, on-screen text
// (drawn by the app over the picture) and, when recorded, a voice-over track in the same HLS stream. The text lives
// in data/intro-videos (timing.json from the video engine, lang/<code>.json per language — the original English
// script is the source of truth). Media files are served from INTRO_VIDEOS_MEDIA_URL (Supabase Storage in
// production once uploaded; a local folder while reviewing).
//
// A language is offered to members only when its asset is PUBLISHED (approved by a reviewer and released).
// Machine or AI translation, or a generated voice, is never published automatically: statuses come from the content
// files ("awaiting_review"), and only an administrator (migration 260) can approve and publish.
// Scripture quoted in another language comes only from a real Bible translation (public domain / open licence,
// credited) — never from our own translation.
//
// Viewing status (first viewing must be completed) is stored per account when migration 260 is applied; until then
// the API answers `stored: false` and the phone keeps it.
import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { audit } from "../lib/adminIdentity";
import { introLangs, introTiming, introLang, introVoice, introVoices, splitUnit, type AssetKind, type AssetStatus } from "../lib/introVideos";

const router = Router();
const VIDEO = /^(0[1-9]|1[01])$/;
const LANG = /^[a-z]{2,3}(-[A-Z]{2})?$/;
const KINDS: AssetKind[] = ["subtitles", "overlays", "audio"];
const STATUSES: AssetStatus[] = ["not_started", "translated", "audio_generated", "awaiting_review", "approved", "published", "withdrawn"];
const REVIEW_ROLES = ["super_admin", "admin_content", "admin_translation"];
const PUBLISH_ROLES = ["super_admin", "admin_content"];

function mediaBase(): string {
  return (process.env.INTRO_VIDEOS_MEDIA_URL || "").replace(/\/+$/, "");
}

// ── review status overrides (migration 260); cached briefly, fall back to the repo statuses ──
let overrides: { at: number; map: Map<string, AssetStatus> | null } = { at: 0, map: null };
async function statusOverrides(): Promise<Map<string, AssetStatus>> {
  if (overrides.map && Date.now() - overrides.at < 60_000) return overrides.map;
  const map = new Map<string, AssetStatus>();
  const { data, error } = await db.from("p2p_intro_video_assets").select("video_id,language,kind,status");
  if (!error) for (const r of (data ?? []) as any[]) map.set(`${r.video_id}|${r.language}|${r.kind}`, r.status);
  overrides = { at: Date.now(), map };
  return map;
}
async function statusOf(video: string, lang: string, kind: AssetKind): Promise<AssetStatus> {
  const o = (await statusOverrides()).get(`${video}|${lang}|${kind}`);
  if (o) return o;
  return introLang(lang)?.videos?.[video]?.status?.[kind] ?? "not_started";
}
const live = (s: AssetStatus) => s === "published";

/** Reviewers may preview languages that are not yet published (?preview=1); members never see them. */
async function canPreview(req: Request): Promise<boolean> {
  // Local review only (never set on Railway, refused in production): every screen on localhost — library, feature
  // introductions, the first-launch film — shows unpublished languages, so the owner can review them in place.
  if (process.env.INTRO_VIDEOS_PREVIEW_ALL === "1" && process.env.NODE_ENV !== "production") return true;
  if (req.query.preview !== "1") return false;
  const uid = await verifyCaller(req);
  if (!uid) return false;
  const { data } = await db.from("p2p_profiles").select("role").eq("id", uid).maybeSingle();
  return REVIEW_ROLES.includes(String((data as any)?.role ?? ""));
}

// ── GET /manifest?lang=de — the library: titles, descriptions, durations, media, languages per video ──
router.get("/manifest", async (req, res) => {
  const lang = typeof req.query.lang === "string" && LANG.test(req.query.lang) ? req.query.lang : "en";
  const preview = await canPreview(req);
  const timing = introTiming();
  const base = mediaBase();
  const videos = [];
  for (const v of timing.videos) {
    const own = introLang(lang)?.videos?.[v.id];
    const en = introLang("en")!.videos[v.id];
    const titleOk = !!own?.title && (lang === "en" || preview || live(await statusOf(v.id, lang, "subtitles")));
    const languages = [];
    for (const code of introLangs()) {
      const st = { subtitles: await statusOf(v.id, code, "subtitles"), overlays: await statusOf(v.id, code, "overlays"), audio: await statusOf(v.id, code, "audio") };
      const ok = (k: AssetKind) => live(st[k]) || (preview && st[k] !== "not_started");
      languages.push({ code, subtitles: ok("subtitles"), overlays: ok("overlays"), audio: ok("audio"), status: st, voice: ok("audio") || code === "en" ? introVoice(v.id, code) : null,
        voices: ok("audio") || code === "en" ? introVoices(v.id, code) : [] });
    }
    videos.push({
      id: v.id, group: v.group, order: v.order, duration: v.duration,
      title: titleOk ? own!.title : en.title, description: titleOk ? own!.description : en.description, titleLanguage: titleOk ? lang : "en",
      media: base ? { hls: `${base}/${v.id}/master.m3u8`, mp4: `${base}/${v.id}/web.mp4`, thumbnail: `${base}/${v.id}/thumb.jpg` } : null,
      languages: languages.filter((l) => l.subtitles || l.audio || l.overlays),
    });
  }
  res.set("Cache-Control", "public, max-age=300");
  return res.json({ version: timing.version, mediaReady: !!base, preview, videos });
});

// ── GET /:id/text?lang=de — timed subtitles + on-screen text for one language ──
router.get("/:id/text", async (req, res) => {
  const id = String(req.params.id);
  const lang = typeof req.query.lang === "string" && LANG.test(req.query.lang) ? req.query.lang : "en";
  if (!VIDEO.test(id)) return res.status(404).json({ error: "Not found." });
  const v = introTiming().videos.find((x) => x.id === id);
  const L = introLang(lang)?.videos?.[id];
  if (!v) return res.status(404).json({ error: "Not found." });
  const preview = await canPreview(req);
  const subOk = lang === "en" || (!!L && (live(await statusOf(id, lang, "subtitles")) || preview));
  const ovOk = lang === "en" || (!!L && (live(await statusOf(id, lang, "overlays")) || preview));
  const en = introLang("en")!.videos[id];
  const cues = subOk && L ? v.units.flatMap((u) => splitUnit(u, L.units?.[u.id] ?? "")) : [];
  const overlays = v.overlays.map((o) => {
    const own = ovOk ? L?.overlays?.[o.id] : undefined;
    const ref = ovOk ? L?.overlays?.[`${o.id}.ref`] : undefined;
    return { ...o, text: own ?? en.overlays?.[o.id] ?? o.text ?? "", ref: o.ref ? (ref ?? en.overlays?.[`${o.id}.ref`] ?? o.ref) : undefined, language: own ? lang : "en" };
  });
  res.set("Cache-Control", "public, max-age=300");
  return res.json({
    id, language: lang, rtl: !!introLang(lang)?.rtl, subtitles: subOk ? "available" : "unavailable", overlaysLanguage: ovOk ? lang : "en",
    cues, overlays, scriptureSources: ovOk || subOk ? (introLang(lang)?.scriptureSources ?? []) : [],
  });
});

// ── viewing status (per account) ──
const num = (x: unknown, max = 36000) => (typeof x === "number" && isFinite(x) && x >= 0 ? Math.min(x, max) : null);
router.get("/progress", async (req, res) => {
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).json({ error: "Sign in required." });
  const { data, error } = await db.from("p2p_intro_video_views").select("*").eq("user_id", uid);
  if (error) return res.json({ stored: false, views: [] });   // migration 260 not applied: the phone keeps it
  return res.json({ stored: true, views: (data ?? []).map((r: any) => ({ videoId: r.video_id, position: Number(r.position_seconds), maxWatched: Number(r.max_watched_seconds), completedAt: r.completed_at, skippedAt: r.skipped_at, completions: r.completions, autoIntroOff: r.auto_intro_off, audioLanguage: r.audio_language, subtitleLanguage: r.subtitle_language })) });
});
router.put("/progress/:id", async (req, res) => {
  const uid = await verifyCaller(req);
  if (!uid) return res.status(401).json({ error: "Sign in required." });
  const id = String(req.params.id);
  if (!VIDEO.test(id)) return res.status(404).json({ error: "Not found." });
  const b = req.body ?? {};
  const { data: cur, error: e0 } = await db.from("p2p_intro_video_views").select("*").eq("user_id", uid).eq("video_id", id).maybeSingle();
  if (e0) return res.status(202).json({ stored: false });
  const c = (cur ?? {}) as any;
  const duration = introTiming().videos.find((v) => v.id === id)?.duration ?? 0;
  const maxWatched = Math.max(Number(c.max_watched_seconds ?? 0), num(b.maxWatched) ?? 0);
  // Completed only when the app reports the end AND the person actually watched (nearly) all of it.
  const completedNow = b.completed === true && duration > 0 && maxWatched >= duration - 3;
  const row = {
    user_id: uid, video_id: id,
    position_seconds: num(b.position) ?? Number(c.position_seconds ?? 0),
    max_watched_seconds: maxWatched,
    completed_at: c.completed_at ?? (completedNow ? new Date().toISOString() : null),
    completions: Number(c.completions ?? 0) + (completedNow ? 1 : 0),
    skipped_at: c.skipped_at ?? (b.skipped === true ? new Date().toISOString() : null),
    auto_intro_off: typeof b.autoIntroOff === "boolean" ? b.autoIntroOff : !!c.auto_intro_off,
    audio_language: typeof b.audioLanguage === "string" && LANG.test(b.audioLanguage) ? b.audioLanguage : c.audio_language ?? null,
    subtitle_language: typeof b.subtitleLanguage === "string" && (LANG.test(b.subtitleLanguage) || b.subtitleLanguage === "off") ? b.subtitleLanguage : c.subtitle_language ?? null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("p2p_intro_video_views").upsert(row, { onConflict: "user_id,video_id" });
  if (error) return res.status(202).json({ stored: false });
  return res.json({ stored: true, completedAt: row.completed_at, completions: row.completions });
});

// ── analytics: events only (no free text) ──
const EVENTS = ["intro_shown", "play_started", "completed", "interrupted", "replayed", "skipped", "language_selected", "translation_unavailable"];
router.post("/events", async (req, res) => {
  const uid = await verifyCaller(req);   // optional: first launch happens before registration
  const list = (Array.isArray(req.body?.events) ? req.body.events : []).slice(0, 50);
  const rows = list
    .filter((e: any) => e && VIDEO.test(String(e.videoId)) && EVENTS.includes(e.event))
    .map((e: any) => ({
      user_id: uid, video_id: String(e.videoId), event: e.event,
      context: typeof e.context === "string" && /^[a-z_]{1,40}$/.test(e.context) ? e.context : null,
      language: typeof e.language === "string" && LANG.test(e.language) ? e.language : null,
      position_seconds: num(e.position),
    }));
  if (!rows.length) return res.json({ stored: 0 });
  const { error } = await db.from("p2p_intro_video_events").insert(rows);
  return res.status(error ? 202 : 200).json({ stored: error ? 0 : rows.length });
});

// ── Admin Centre: review languages (approve / publish) ──
const adminInfo = (req: Request) => ({ id: (req as any).adminUserId as string, role: (req as any).adminRole as string, roles: ((req as any).adminRoles as string[] | undefined) ?? [(req as any).adminRole as string], session: (req as any).adminSessionId as string | undefined });
router.get("/admin/status", requireAdmin, requireRole(...REVIEW_ROLES), async (_req, res) => {
  const { error } = await db.from("p2p_intro_video_assets").select("video_id").limit(1);
  const rows = [];
  for (const v of introTiming().videos) {
    for (const code of introLangs()) {
      rows.push({ videoId: v.id, language: code, subtitles: await statusOf(v.id, code, "subtitles"), overlays: await statusOf(v.id, code, "overlays"), audio: await statusOf(v.id, code, "audio") });
    }
  }
  return res.json({ reviewEnabled: !error, languages: introLangs(), videos: introTiming().videos.map((v) => ({ id: v.id, title: introLang("en")!.videos[v.id].title })), rows, mediaReady: !!mediaBase() });
});
router.post("/admin/status", requireAdmin, requireRole(...REVIEW_ROLES), async (req: Request, res: Response) => {
  const { videoId, language, kind, status, note } = req.body ?? {};
  if (!VIDEO.test(String(videoId)) || !LANG.test(String(language)) || !KINDS.includes(kind) || !STATUSES.includes(status)) return res.status(400).json({ error: "Check the video, language, kind and status." });
  const a = adminInfo(req);
  if ((status === "published" || status === "withdrawn") && !a.roles.some((r) => PUBLISH_ROLES.includes(r))) return res.status(403).json({ error: "Only a content administrator can publish or withdraw." });
  const from = await statusOf(videoId, language, kind);
  if (status === "published" && from !== "approved") return res.status(409).json({ error: "Approve it first (someone must review it before it is published)." });
  if (kind === "audio" && status === "approved" && from === "not_started") return res.status(409).json({ error: "There is no recording to approve yet." });
  const at = new Date().toISOString();
  const { error } = await db.from("p2p_intro_video_assets").upsert({ video_id: videoId, language, kind, status, note: typeof note === "string" ? note.slice(0, 500) : null, reviewed_by: a.id, reviewed_at: at, updated_at: at }, { onConflict: "video_id,language,kind" });
  if (error) {
    const code = (error as any).code;
    if (code === "42P01" || code === "PGRST205") return res.status(503).json({ error: "Reviewing languages needs migration 260 (not applied yet)." });
    return res.status(500).json({ error: "Something went wrong. Nothing was changed." });
  }
  await db.from("p2p_intro_video_asset_events").insert({ video_id: videoId, language, kind, from_status: from, to_status: status, note: typeof note === "string" ? note.slice(0, 500) : null, actor: a.id });
  await audit({ adminUserId: a.id, adminRole: a.role, sessionId: a.session ?? null, action: `intro_video.${status}`, targetType: "intro_video_asset", targetId: `${videoId}/${language}/${kind}`, detail: { from } });
  overrides = { at: 0, map: null };
  return res.json({ ok: true, from, status });
});

export default router;
