// OFFICIAL KINGDOM STORIES NARRATION — the OWNER-CONTROLLED workflow (owner brief 2026-11-18, P2P Voices §2A/§12).
// Mounted at /api/admin/narrations; requireAdmin + requireRole("super_admin") on EVERY route — enforced here on the
// server, never by what the app shows. Every action is written to p2p_story_narration_events (append-only) and to
// the Admin Centre audit log.
//
// P2P NEVER generates narration: there is no call to ElevenLabs (or any TTS) anywhere in this file. The owner
// generates a recording outside P2P (e.g. scripts/narrate.mjs, run by the owner) and uploads:
//   1. POST /draft            story, chapter, language, provider, voice … → a record + signed upload links
//   2. (the app uploads the audio file and its word-timing JSON straight to private storage)
//   3. POST /:id/uploaded     server checks: the files exist, real audio by its bytes (MP3/M4A/WAV/OGG), size,
//                             the timing file is for THIS story + chapter + language → "uploaded" (awaiting review)
//   4. GET  /:id/preview      a signed link to listen
//   5. POST /:id/approve      the owner confirms they listened and it is the right story and chapter
//      POST /:id/reject       with a reason
//   6. POST /:id/publish      approved → published (the previous published version becomes "superseded" — kept)
//   7. POST /:id/withdraw     published → withdrawn (participants stop getting it; nothing is deleted)
//   Recordings published before this workflow ("legacy" files) keep playing; the owner can withdraw or restore them.
// Nothing is ever deleted: files and records stay, so every version can be audited.
import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { audit } from "../lib/adminIdentity";
import { invalidateNarration } from "../lib/storyNarration";

const router = Router();
router.use(requireAdmin, requireRole("super_admin"));

const BUCKET = "kingdom-stories-media";
const MAX_AUDIO_BYTES = 80 * 1024 * 1024, MAX_TIMINGS_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// MP3 only: what the narration script produces, and what the kingdom-stories-media bucket accepts (migration 242
// allows exactly audio/mpeg + application/json — this workflow does not widen it).
const AUDIO_EXT: Record<string, string> = { mp3: "audio/mpeg" };
const PROVIDERS = ["elevenlabs", "studio", "other"] as const;
type Status = "awaiting_upload" | "uploaded" | "approved" | "rejected" | "published" | "withdrawn" | "superseded";

class NError extends Error { constructor(public status: number, message: string) { super(message); } }
function fail(res: Response, e: unknown) {
  if (e instanceof NError) return res.status(e.status).json({ error: e.message });
  const code = (e as { code?: string })?.code;
  if (code === "42P01" || code === "PGRST205") return res.status(503).json({ error: "Story narration management needs migration 254 (not applied yet)." });
  return res.status(500).json({ error: "Something went wrong. Nothing was changed." });
}
const admin = (req: Request) => ({ id: (req as any).adminUserId as string, role: (req as any).adminRole as string, session: (req as any).adminSessionId as string | undefined });
async function event(narrationId: string, req: Request, action: string, detail: Record<string, unknown> = {}) {
  const a = admin(req);
  await db.from("p2p_story_narration_events").insert({ narration_id: narrationId, action, actor: a.id, detail });
  await audit({ adminUserId: a.id, adminRole: a.role, sessionId: a.session ?? null, action: `narration.${action}`, targetType: "story_narration", targetId: narrationId, detail });
}
async function row(id: string) {
  if (!UUID.test(id)) throw new NError(404, "Not found.");
  const { data, error } = await db.from("p2p_story_narrations").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new NError(404, "Not found.");
  return data as Record<string, any> & { status: Status };
}
async function setStatus(id: string, from: Status[], to: Status, patch: Record<string, unknown> = {}) {
  const { data, error } = await db.from("p2p_story_narrations").update({ status: to, updated_at: new Date().toISOString(), ...patch }).eq("id", id).in("status", from).select("*").maybeSingle();
  if (error) throw error;
  if (!data) throw new NError(409, "This recording changed meanwhile — refresh and try again.");
  return data as Record<string, any>;
}

/** Real audio by its first bytes (not by the file name). */
export function audioKind(b: Uint8Array): "mp3" | "m4a" | "wav" | "ogg" | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length < 12) return null;
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  if (s(4, 4) === "ftyp") return "m4a";
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return "wav";
  if (s(0, 4) === "OggS") return "ogg";
  return null;
}
/** The word-timing file (scripts/narrate.mjs output) must belong to this story, chapter and language. */
export function checkTimings(j: any, want: { storyId: string; chapterId: string; language: string }): { ok: true; duration: number; words: number } | { ok: false; reason: string } {
  if (!j || typeof j !== "object") return { ok: false, reason: "The timing file is not valid JSON." };
  const words = typeof j.words === "string" ? j.words.split(" ").filter(Boolean) : null;
  if (!words || !Array.isArray(j.starts) || !Array.isArray(j.ends) || words.length !== j.starts.length || j.starts.length !== j.ends.length || !words.length)
    return { ok: false, reason: "The timing file needs matching words, starts and ends (as produced by the narration script)." };
  if (j.storyId && j.storyId !== want.storyId) return { ok: false, reason: "The timing file is for a different story." };
  if (j.chapterId && j.chapterId !== want.chapterId) return { ok: false, reason: "The timing file is for a different chapter." };
  if ((j.language ?? "en") !== want.language) return { ok: false, reason: `The timing file is in "${j.language ?? "en"}", not "${want.language}".` };
  return { ok: true, duration: Math.round(Number(j.ends[j.ends.length - 1]) / 100), words: words.length };
}

// ── Stories and chapters with their narration state ──
router.get("/stories", async (_req, res) => {
  try {
    const { data: stories, error } = await db.from("p2p_kingdom_stories").select("id,title,status").order("title").limit(500);
    if (error) throw error;
    const ids = (stories ?? []).map((s: any) => s.id);
    const { data: chapters } = ids.length ? await db.from("p2p_kingdom_story_chapters").select("id,story_id,chapter_number,title,updated_at").in("story_id", ids).order("chapter_number") : { data: [] };
    const { data: recs } = await db.from("p2p_story_narrations").select("story_id,chapter_id,language,status").in("story_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    return res.json({ stories: (stories ?? []).map((s: any) => ({ ...s, chapters: [{ id: "intro", chapter_number: 0, title: "Introduction" },
      ...((chapters ?? []) as any[]).filter((c) => c.story_id === s.id)].map((c: any) => ({ ...c, recordings: ((recs ?? []) as any[]).filter((r) => r.story_id === s.id && r.chapter_id === c.id) })) })) });
  } catch (e) { return fail(res, e); }
});
router.get("/", async (req, res) => {
  try {
    const storyId = String(req.query.storyId ?? "");
    if (!UUID.test(storyId)) throw new NError(400, "Choose a story.");
    const { data, error } = await db.from("p2p_story_narrations").select("*").eq("story_id", storyId).order("created_at", { ascending: false });
    if (error) throw error;
    return res.json({ recordings: data ?? [] });
  } catch (e) { return fail(res, e); }
});
router.get("/:id/history", async (req, res) => {
  try {
    await row(String(req.params.id));
    const { data, error } = await db.from("p2p_story_narration_events").select("action,actor,detail,created_at").eq("narration_id", req.params.id).order("created_at");
    if (error) throw error;
    return res.json({ events: data ?? [] });
  } catch (e) { return fail(res, e); }
});

// Legacy recordings (uploaded before this workflow): withdraw / restore without touching the files.
router.post("/legacy/:action", async (req, res) => {
  try {
    const action = String(req.params.action);
    if (action !== "withdraw" && action !== "restore") throw new NError(404, "Not found.");
    const b = req.body ?? {};
    const storyId = String(b.storyId ?? ""), chapterId = String(b.chapterId ?? ""), language = String(b.language ?? "en");
    if (!UUID.test(storyId) || !(chapterId === "intro" || UUID.test(chapterId)) || !/^[a-z]{2,3}$/.test(language)) throw new NError(400, "Choose the story, chapter and language.");
    const reason = String(b.reason ?? "").trim().slice(0, 500);
    if (action === "withdraw") {
      if (!reason) throw new NError(400, "Say why it is withdrawn.");
      const id = randomUUID();
      const { error } = await db.from("p2p_story_narrations").insert({ id, story_id: storyId, chapter_id: chapterId, language, provider: "elevenlabs", voice_name: "Legacy recording",
        legacy: true, status: "withdrawn", reason, withdrawn_at: new Date().toISOString(), uploaded_by: admin(req).id, audio_path: null, timings_path: null });
      if (error) throw error;
      invalidateNarration(storyId, chapterId, language);
      await event(id, req, "legacy_withdrawn", { storyId, chapterId, language, reason });
      return res.json({ id });
    }
    const { data, error } = await db.from("p2p_story_narrations").update({ status: "superseded", updated_at: new Date().toISOString() }).eq("story_id", storyId).eq("chapter_id", chapterId)
      .eq("language", language).eq("legacy", true).eq("status", "withdrawn").select("id");
    if (error) throw error;
    invalidateNarration(storyId, chapterId, language);
    for (const x of (data ?? []) as { id: string }[]) await event(x.id, req, "legacy_restored", { storyId, chapterId, language });
    return res.json({ restored: (data ?? []).length });
  } catch (e) { return fail(res, e); }
});

// 1. A draft with its metadata, and signed links to upload the two files.
router.post("/draft", async (req, res) => {
  try {
    const b = req.body ?? {};
    const storyId = String(b.storyId ?? ""), chapterId = String(b.chapterId ?? ""), language = String(b.language ?? "en").toLowerCase();
    const ext = String(b.audioExt ?? "mp3").toLowerCase();
    if (!UUID.test(storyId)) throw new NError(400, "Choose a story.");
    if (!(chapterId === "intro" || UUID.test(chapterId))) throw new NError(400, "Choose a chapter.");
    if (!/^[a-z]{2,3}$/.test(language)) throw new NError(400, "Choose the recording's language.");
    if (!AUDIO_EXT[ext]) throw new NError(400, "Audio must be an MP3 file.");
    const provider = PROVIDERS.includes(b.provider) ? b.provider : "elevenlabs";
    const voiceName = String(b.voiceName ?? "").trim().slice(0, 120);
    if (!voiceName) throw new NError(400, "Name the narration voice.");
    const { data: story } = await db.from("p2p_kingdom_stories").select("id").eq("id", storyId).maybeSingle();
    if (!story) throw new NError(404, "That story doesn't exist.");
    let chapterUpdated: string | null = null;
    if (chapterId !== "intro") {
      const { data: ch } = await db.from("p2p_kingdom_story_chapters").select("id,updated_at").eq("id", chapterId).eq("story_id", storyId).maybeSingle();
      if (!ch) throw new NError(404, "That chapter isn't part of this story.");
      chapterUpdated = (ch as { updated_at: string }).updated_at;
    }
    const id = randomUUID();
    const base = `${storyId}/narration/uploads/${id}`;
    const audioPath = `${base}/audio.${ext}`, timingsPath = `${base}/timings.json`;
    const a = admin(req);
    const { error } = await db.from("p2p_story_narrations").insert({ id, story_id: storyId, chapter_id: chapterId, language, provider,
      voice_id: b.voiceId ? String(b.voiceId).slice(0, 120) : null, voice_name: voiceName, accent: b.accent ? String(b.accent).slice(0, 60) : null,
      model: b.model ? String(b.model).slice(0, 60) : null, audio_format: ext, audio_path: audioPath, timings_path: timingsPath,
      content_version: b.contentVersion ? String(b.contentVersion).slice(0, 80) : chapterUpdated, notes: b.notes ? String(b.notes).slice(0, 1000) : null,
      status: "awaiting_upload", uploaded_by: a.id });
    if (error) throw error;
    const [au, ti] = await Promise.all([db.storage.from(BUCKET).createSignedUploadUrl(audioPath), db.storage.from(BUCKET).createSignedUploadUrl(timingsPath)]);
    if (au.error || ti.error) throw new NError(500, "Couldn't prepare the upload.");
    await event(id, req, "draft", { storyId, chapterId, language, provider, voiceName });
    return res.json({ id, upload: { audio: { url: au.data.signedUrl, contentType: AUDIO_EXT[ext] }, timings: { url: ti.data.signedUrl, contentType: "application/json" } } });
  } catch (e) { return fail(res, e); }
});

// 3. The server checks what arrived.
router.post("/:id/uploaded", async (req, res) => {
  try {
    const r = await row(String(req.params.id));
    if (r.status !== "awaiting_upload") throw new NError(409, "This recording was already checked.");
    const [au, ti] = await Promise.all([db.storage.from(BUCKET).download(r.audio_path), db.storage.from(BUCKET).download(r.timings_path)]);
    if (!au.data) throw new NError(400, "The audio file hasn't arrived. Upload it again.");
    if (!ti.data) throw new NError(400, "The word-timing file hasn't arrived. Upload it again (it keeps the highlighting in sync).");
    const bytes = new Uint8Array(await au.data.arrayBuffer());
    if (bytes.length > MAX_AUDIO_BYTES) throw new NError(400, "The audio file is larger than 80 MB.");
    const kind = audioKind(bytes);
    if (kind !== "mp3") throw new NError(400, "That file isn't an MP3 recording.");
    if (ti.data.size > MAX_TIMINGS_BYTES) throw new NError(400, "The timing file is too large.");
    let tj: unknown; try { tj = JSON.parse(await ti.data.text()); } catch { tj = null; }
    const check = checkTimings(tj, { storyId: r.story_id, chapterId: r.chapter_id, language: r.language });
    if (!check.ok) throw new NError(400, check.reason);
    const out = await setStatus(r.id, ["awaiting_upload"], "uploaded", { size_bytes: bytes.length, audio_format: kind, duration_seconds: check.duration, word_count: check.words, uploaded_at: new Date().toISOString() });
    await event(r.id, req, "uploaded", { bytes: bytes.length, format: kind, durationSeconds: check.duration, words: check.words });
    return res.json({ recording: out });
  } catch (e) { return fail(res, e); }
});
router.get("/:id/preview", async (req, res) => {
  try {
    const r = await row(String(req.params.id));
    if (r.status === "awaiting_upload") throw new NError(409, "Upload the files first.");
    const { data } = await db.storage.from(BUCKET).createSignedUrl(r.audio_path, 3600);
    if (!data?.signedUrl) throw new NError(404, "The audio file is missing.");
    return res.json({ url: data.signedUrl });
  } catch (e) { return fail(res, e); }
});
router.post("/:id/approve", async (req, res) => {
  try {
    if (req.body?.verified !== true) throw new NError(400, "Listen to the recording and confirm it is the right story and chapter first.");
    const r = await row(String(req.params.id));
    const out = await setStatus(r.id, ["uploaded"], "approved", { approved_by: admin(req).id, approved_at: new Date().toISOString() });
    await event(r.id, req, "approved", { verifiedStoryAndChapter: true });
    return res.json({ recording: out });
  } catch (e) { return fail(res, e); }
});
router.post("/:id/reject", async (req, res) => {
  try {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
    if (!reason) throw new NError(400, "Say why it is rejected.");
    const r = await row(String(req.params.id));
    const out = await setStatus(r.id, ["uploaded", "approved"], "rejected", { reason });
    await event(r.id, req, "rejected", { reason });
    return res.json({ recording: out });
  } catch (e) { return fail(res, e); }
});
router.post("/:id/publish", async (req, res) => {
  try {
    const r = await row(String(req.params.id));
    if (r.status !== "approved") throw new NError(409, "Only an approved recording can be published.");
    const nowIso = new Date().toISOString();
    // The previous official version for this chapter + language steps aside (kept, marked superseded).
    const { data: prev } = await db.from("p2p_story_narrations").update({ status: "superseded", updated_at: nowIso }).eq("story_id", r.story_id).eq("chapter_id", r.chapter_id)
      .eq("language", r.language).eq("status", "published").neq("id", r.id).select("id");
    const out = await setStatus(r.id, ["approved"], "published", { published_by: admin(req).id, published_at: nowIso });
    invalidateNarration(r.story_id, r.chapter_id, r.language);
    await event(r.id, req, "published", { superseded: ((prev ?? []) as { id: string }[]).map((x) => x.id) });
    return res.json({ recording: out });
  } catch (e) { return fail(res, e); }
});
router.post("/:id/withdraw", async (req, res) => {
  try {
    const reason = String(req.body?.reason ?? "").trim().slice(0, 500);
    if (!reason) throw new NError(400, "Say why it is withdrawn.");
    const r = await row(String(req.params.id));
    const out = await setStatus(r.id, ["published"], "withdrawn", { reason, withdrawn_at: new Date().toISOString() });
    invalidateNarration(r.story_id, r.chapter_id, r.language);
    await event(r.id, req, "withdrawn", { reason });
    return res.json({ recording: out });
  } catch (e) { return fail(res, e); }
});
export default router;
