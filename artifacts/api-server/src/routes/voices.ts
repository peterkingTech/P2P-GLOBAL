// P2P VOICES — participant API (owner brief 2026-11-18). Mounted at /api/voices.
//   GET  /catalogue?language=&accent=&provider=&presentation=&characteristic=&q=&purpose=&page=   voices + facets
//   GET  /capabilities                       languages P2P can actually speak, and through whom
//   POST /speak   { voiceId, contentKind, contentKey, contentVersion?, language, text, translation? }   one chunk (eligible content; Bible = public domain only)
//   POST /preview { voiceId }                a short fixed sample, or the provider's own preview link
//   GET  /audio/:key?exp=&sig=               locally stored audio (development / no bucket) — signed, expiring
//   GET  /preferences · PUT /preferences     the participant's voices per language, favourites, speed (own row only)
//   GET  /admin/status                       providers, candidates, usage — administrators only
// Every route needs a signed-in participant; nothing returns or logs a provider secret or the text being read.
import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db, verifyCaller } from "../lib/supabase";
import { requireAdmin } from "../middleware/adminAuth";
import { capabilities, catalogue, candidates, defaultVoices, providerStatuses } from "../lib/voices/catalogue";
import { preview, readLocal, speak, usageSummary, verifyLocal, isLiveLocal, VoicesError, ELIGIBLE_KINDS } from "../lib/voices/synth";
import { CHARACTERISTICS, type Characteristic, type ProviderId } from "../lib/voices/types";

const router = Router();
async function caller(req: Request, res: Response): Promise<string | null> {
  const u = await verifyCaller(req);
  if (!u) { res.status(401).json({ error: "Please sign in." }); return null; }
  return u;
}
function fail(res: Response, e: unknown) {
  if (e instanceof VoicesError) return res.status(e.status).json({ error: e.message, code: e.code });
  return res.status(500).json({ error: "Voices aren't available at the moment." }); // never a provider's own message
}
const baseUrl = (req: Request) => process.env.PUBLIC_API_URL?.replace(/\/$/, "") || `${req.get("x-forwarded-proto") ?? req.protocol}://${req.get("host")}`;
const str = (v: unknown, max = 80) => (typeof v === "string" ? v.slice(0, max) : null);

router.get("/catalogue", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const presentation = req.query.presentation === "female" || req.query.presentation === "male" ? req.query.presentation : null;
    const characteristic = CHARACTERISTICS.includes(req.query.characteristic as Characteristic) ? (req.query.characteristic as Characteristic) : null;
    const provider = ["azure", "google", "elevenlabs", "spitch", "naijalingo", "naijaspeech", "giggy"].includes(String(req.query.provider)) ? (req.query.provider as ProviderId) : null;
    const purpose = req.query.purpose === "story" || req.query.purpose === "everyday" ? req.query.purpose : null;
    return res.json(await catalogue({ language: str(req.query.language, 8), accent: str(req.query.accent), provider, presentation, characteristic, q: str(req.query.q), purpose,
      page: Number(req.query.page) || 0, pageSize: Number(req.query.pageSize) || 40, honoursPolicy: req.query.policy === "1" }));
  } catch (e) { return fail(res, e); }
});
router.get("/capabilities", async (req, res) => {
  if (!(await caller(req, res))) return;
  try { return res.json({ languages: await capabilities(req.query.policy === "1"), eligibleKinds: ELIGIBLE_KINDS }); } catch (e) { return fail(res, e); }
});
// The default P2P Voice for each language (used until a participant chooses another, or their phone's voice).
router.get("/defaults", async (req, res) => {
  if (!(await caller(req, res))) return;
  try {
    const d = await defaultVoices(req.query.policy === "1");
    return res.json({ defaults: Object.fromEntries(Object.entries(d).map(([l, v]) => [l, { voiceId: v.id, name: v.name, provider: v.provider, accent: v.accent, language: v.language, presentation: v.presentation }])) });
  } catch (e) { return fail(res, e); }
});
router.post("/speak", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try {
    const b = req.body ?? {};
    const out = await speak({ userId, voiceId: String(b.voiceId ?? "").slice(0, 200), contentKind: String(b.contentKind ?? ""), contentKey: String(b.contentKey ?? ""),
      contentVersion: b.contentVersion ? String(b.contentVersion).slice(0, 80) : "", language: String(b.language ?? "").slice(0, 16), text: String(b.text ?? ""), baseUrl: baseUrl(req),
      translation: b.translation ? String(b.translation).slice(0, 64) : undefined, honoursPolicy: b.honoursPolicy === true });
    return res.json(out);
  } catch (e) { return fail(res, e); }
});
router.post("/preview", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  try { return res.json(await preview(userId, String(req.body?.voiceId ?? "").slice(0, 200), baseUrl(req), req.body?.honoursPolicy === true)); } catch (e) { return fail(res, e); }
});
// Signed and expiring — the link itself is the permission (same model as a storage signed URL).
router.get("/audio/:key", (req, res) => {
  const key = String(req.params.key);
  if (!verifyLocal(key, Number(req.query.exp), String(req.query.sig ?? ""))) return res.status(403).json({ error: "This link has expired." });
  const audio = readLocal(key);
  if (!audio) return res.status(404).json({ error: "Not found." });
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Cache-Control", isLiveLocal(key) ? "no-store" : "private, max-age=21600");
  res.setHeader("Accept-Ranges", "bytes");
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range) {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
    if (start > end || start >= audio.length) return res.status(416).end();
    res.status(206).setHeader("Content-Range", `bytes ${start}-${end}/${audio.length}`);
    return res.end(audio.subarray(start, end + 1));
  }
  return res.end(audio);
});

// ── Preferences (migration 254: p2p_voice_preferences; RLS own row; the API writes only the caller's row) ──
export interface VoicePrefs {
  version: 1;
  /** Official studio narration first when a story chapter has it (default true). */
  preferOfficial: boolean;
  /** Per content language: the chosen P2P Voice (null = the phone's own voice). */
  byLanguage: Record<string, { voiceId: string | null; accent?: string | null; provider?: string | null } | undefined>;
  favourites: string[];
  rate?: number | null;
}
export function cleanPrefs(raw: unknown): VoicePrefs {
  const r = (raw ?? {}) as Partial<VoicePrefs>;
  const byLanguage: VoicePrefs["byLanguage"] = {};
  for (const [lang, v] of Object.entries(r.byLanguage ?? {}).slice(0, 40)) {
    if (!/^[a-z]{2,3}$/.test(lang) || !v) continue;
    const id = typeof v.voiceId === "string" && /^[a-z]+:[\w.@\-]{1,120}$/i.test(v.voiceId) ? v.voiceId : null;
    byLanguage[lang] = { voiceId: id, accent: typeof v.accent === "string" ? v.accent.slice(0, 60) : null, provider: typeof v.provider === "string" ? v.provider.slice(0, 20) : null };
  }
  const favourites = (Array.isArray(r.favourites) ? r.favourites : []).filter((x): x is string => typeof x === "string" && /^[a-z]+:[\w.@\-]{1,120}$/i.test(x)).slice(0, 60);
  const rate = typeof r.rate === "number" && r.rate >= 0.5 && r.rate <= 2 ? r.rate : null;
  return { version: 1, preferOfficial: r.preferOfficial !== false, byLanguage, favourites: [...new Set(favourites)], rate };
}
router.get("/preferences", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const { data, error } = await db.from("p2p_voice_preferences").select("prefs,updated_at").eq("user_id", userId).maybeSingle();
  if (error) return res.json({ prefs: null, stored: false }); // migration 254 not applied: the phone keeps them
  return res.json({ prefs: data ? cleanPrefs((data as { prefs: unknown }).prefs) : null, updatedAt: (data as { updated_at?: string } | null)?.updated_at ?? null, stored: true });
});
router.put("/preferences", async (req, res) => {
  const userId = await caller(req, res); if (!userId) return;
  const prefs = cleanPrefs(req.body?.prefs);
  const { error } = await db.from("p2p_voice_preferences").upsert({ user_id: userId, prefs, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return res.status(202).json({ prefs, stored: false });
  return res.json({ prefs, stored: true });
});

// ── Administrators: what is connected, what isn't and why, and consumption (no content, no secrets) ──
router.get("/admin/status", requireAdmin, async (_req, res) => {
  return res.json({ providers: providerStatuses(), candidates: candidates(), usage: usageSummary(), eligibleKinds: ELIGIBLE_KINDS,
    elevenlabs: { generation: "disabled — official narration is generated by the owner and uploaded (Admin › Story narration)", creditsSpentByP2P: 0 } });
});

export default router;
