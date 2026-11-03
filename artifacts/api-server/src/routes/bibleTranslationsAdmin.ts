import { Router, type Request, type Response } from "express";
import { supabaseServiceRole as db } from "../lib/supabase";
import { requireAdmin, requireRole } from "../middleware/adminAuth";
import { getHelloAoCatalogue } from "../lib/bibleProviders/helloao";
import { approvalProblems, LICENCE_STATUSES, reviewNotes, type LicenceStatus, type TranslationRow } from "../lib/bibleLicence";
import { clearTranslationCache } from "../lib/bibleReader";

// Bible translation licence review — SUPER ADMIN ONLY (requireRole() with no
// other roles). Mounted at /admin/bible-translations. Needs migration 225.
//   GET   /helloao/catalogue?language=eng&q=berean   AO Lab's catalogue + review notes + our status
//   POST  /helloao/import { ids }                    add as UNREVIEWED (hidden) rows
//   PATCH /:code/licence { status, permits…, notes } record a decision; approval publishes it
// Nothing here can make a translation visible without a recorded, complete
// approval (lib/bibleLicence.ts approvalProblems + the migration 225 check).

const router = Router();
router.use(requireAdmin, requireRole());
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CODE_RE = /^[A-Za-z0-9_-]{1,40}$/;
const notReady = (e: { code?: string } | null) => !!e && ["42703", "PGRST204", "23514"].includes(String(e.code));

router.get("/helloao/catalogue", async (req: Request, res: Response) => {
  try {
    const language = typeof req.query.language === "string" ? req.query.language.toLowerCase() : "";
    const q = typeof req.query.q === "string" ? req.query.q.toLowerCase().slice(0, 80) : "";
    const all = await getHelloAoCatalogue();
    const list = all.filter((t) => (!language || t.language === language) && (!q || `${t.id} ${t.name} ${t.englishName} ${t.shortName} ${t.languageEnglishName ?? ""}`.toLowerCase().includes(q))).slice(0, 200);
    const { data } = await db.from("p2p_bible_translations").select("*").eq("provider", "helloao");
    const ours = new Map(((data ?? []) as TranslationRow[]).map((r) => [r.provider_translation_id, r]));
    return res.json({
      total: all.length,
      translations: list.map((t) => ({ ...t, review: reviewNotes(t), ours: ours.get(t.id) ? { code: ours.get(t.id)!.translation_code, status: ours.get(t.id)!.licence_status } : null })),
    });
  } catch { return res.status(502).json({ error: "The Free Use Bible catalogue couldn't be loaded." }); }
});

router.post("/helloao/import", async (req: Request, res: Response) => {
  const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String).filter((x) => ID_RE.test(x)).slice(0, 50) : [];
  if (!ids.length) return res.status(400).json({ error: "Choose AO Lab translation ids to import." });
  try {
    const catalogue = new Map((await getHelloAoCatalogue()).map((t) => [t.id, t]));
    const missing = ids.filter((id) => !catalogue.has(id));
    if (missing.length) return res.status(400).json({ error: `Not in AO Lab's catalogue: ${missing.join(", ")}` });
    const { data: langs } = await db.from("p2p_languages").select("code");
    const known = new Set(((langs ?? []) as { code: string }[]).map((l) => l.code));
    const rows = ids.map((id) => {
      const t = catalogue.get(id)!;
      const review = reviewNotes(t);
      const language = ISO3[t.language] ?? t.language;
      return {
        translation_code: `AO-${id}`.slice(0, 40), translation_name: t.englishName, language, provider: "helloao",
        provider_translation_id: id, abbreviation: t.shortName, text_direction: t.textDirection, source_url: t.website, licence_url: t.licenseUrl,
        provider_licence: t.license, is_licensed_confirmed: false, is_default_for_language: false, licence_status: "unreviewed",
        licence_questions: `${review.statement}\n${review.questions.map((x) => `• ${x}`).join("\n")}`,
        license_notes: "AO Lab Free Use Bible API — licence under review",
        _knownLanguage: known.has(language),
      };
    });
    const unknownLang = rows.filter((r) => !r._knownLanguage).map((r) => `${r.provider_translation_id} (${r.language})`);
    if (unknownLang.length) return res.status(400).json({ error: `Add these languages to the app's language list first: ${unknownLang.join(", ")}` });
    const { error } = await db.from("p2p_bible_translations").upsert(rows.map(({ _knownLanguage, ...r }) => r), { onConflict: "translation_code", ignoreDuplicates: true });
    if (notReady(error)) return res.status(503).json({ error: "Licence review needs migration 225 first." });
    if (error) return res.status(500).json({ error: "Couldn't import." });
    return res.json({ imported: rows.length, status: "unreviewed (hidden from people until approved)" });
  } catch { return res.status(502).json({ error: "The Free Use Bible catalogue couldn't be loaded." }); }
});

router.patch("/:code/licence", async (req: Request, res: Response) => {
  const code = String(req.params.code ?? "");
  if (!CODE_RE.test(code)) return res.status(404).json({ error: "Unknown translation." });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = b.status as LicenceStatus;
  if (!LICENCE_STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${LICENCE_STATUSES.join(", ")}` });
  const { data: row, error: e1 } = await db.from("p2p_bible_translations").select("*").eq("translation_code", code).maybeSingle();
  if (notReady(e1)) return res.status(503).json({ error: "Licence review needs migration 225 first." });
  if (!row || (row as TranslationRow).provider !== "helloao") return res.status(404).json({ error: "Only Free Use Bible (AO Lab) translations are reviewed here; API.Bible keeps its own rules." });
  const flag = (k: string) => (typeof b[k] === "boolean" ? (b[k] as boolean) : (row as Record<string, unknown>)[k] ?? null);
  const text = (k: string, max = 2000) => (typeof b[k] === "string" ? String(b[k]).trim().slice(0, max) || null : (row as Record<string, unknown>)[k] ?? null);
  const reviewer = (req as unknown as { adminUserId: string }).adminUserId;
  const patch = {
    licence_status: status,
    permits_display: flag("permits_display"), permits_commercial: flag("permits_commercial"), permits_caching: flag("permits_caching"),
    permits_offline: flag("permits_offline"), permits_audio: flag("permits_audio"), permits_sharing: flag("permits_sharing"),
    copyright_notice: text("copyright_notice"), licence_name: text("licence_name", 200), licence_url: text("licence_url", 500), attribution: text("attribution"),
    licence_questions: text("licence_questions", 5000), reviewed_by: reviewer, reviewed_at: new Date().toISOString(),
  };
  if (status === "approved") {
    const problems = approvalProblems({ ...patch, provider_translation_id: (row as TranslationRow).provider_translation_id } as TranslationRow);
    if (problems.length) return res.status(400).json({ error: problems.join(" ") });
  }
  // Visible to people only while approved.
  const { error } = await db.from("p2p_bible_translations").update({ ...patch, is_licensed_confirmed: status === "approved" }).eq("translation_code", code);
  if (error) return res.status(notReady(error) ? 400 : 500).json({ error: notReady(error) ? "The approval is incomplete (display + commercial use must be permitted and the reviewer recorded)." : "Couldn't save the review." });
  clearTranslationCache();
  return res.json({ code, status, visible: status === "approved" });
});

// AO Lab uses ISO 639-3 language codes; the app's language list uses these.
const ISO3: Record<string, string> = { eng: "en", deu: "de", fra: "fr", spa: "es", por: "pt", swh: "sw", ita: "it", nld: "nl", arb: "ar", hin: "hi", cmn: "zh", rus: "ru", pol: "pl", tur: "tr", ukr: "uk", vie: "vi", ind: "id", kor: "ko", jpn: "ja", pes: "fa", urd: "ur", ben: "bn", tam: "ta", tel: "te", tha: "th", heb: "he", yor: "yo", ibo: "ig", hau: "ha", zul: "zu", ron: "ro", tgl: "tl", twi: "tw", ces: "cs", mar: "mr", amh: "am", ell: "el", msa: "ms", zsm: "ms" };

export default router;
