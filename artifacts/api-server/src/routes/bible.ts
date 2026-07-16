import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth";
import {
  getVerseText,
  getBatchVerseText,
  getAvailableTranslations,
  parseVerseRef,
} from "../lib/bibleService";

const router = Router();

function ok(res: any, data: unknown) { return res.json(data); }
function err(res: any, msg: string, status = 400) {
  return res.status(status).json({ error: msg });
}

// ── GET /bible/verse?ref=John+3:16&lang=de ────────────────────────────────────
// Returns verse text in the requested language (with fallback chain).
// Public — no auth required (verse text is licensed, but served to users already
// inside the authenticated app; anon access to the API server is acceptable here).

router.get("/verse", async (req, res) => {
  const { ref, lang = "en" } = req.query as { ref?: string; lang?: string };

  if (!ref) return err(res, "ref query param is required");

  const parsed = parseVerseRef(ref);
  if (!parsed) return err(res, `Could not parse verse reference: "${ref}"`);

  try {
    const result = await getVerseText(ref, lang);
    if (!result) {
      return res.status(404).json({
        error: "Verse not found",
        hint: lang !== "en"
          ? "No translation available for this language yet. Run migration 005 and seed p2p_bible_translations."
          : "Verse not in cache and API_BIBLE_KEY is not set.",
      });
    }
    return ok(res, result);
  } catch (e: any) {
    return err(res, e.message ?? "Verse lookup failed", 500);
  }
});

// ── POST /bible/batch ─────────────────────────────────────────────────────────
// Batch fetch verse texts for multiple references.
// Body: { refs: [{ id: string, ref: string }], lang: string }

router.post("/batch", async (req, res) => {
  const { refs, lang = "en" } = req.body as {
    refs?: Array<{ id: string; ref: string }>;
    lang?: string;
  };

  if (!Array.isArray(refs) || refs.length === 0) return ok(res, {});

  try {
    const map = await getBatchVerseText(refs, lang);
    return ok(res, Object.fromEntries(map));
  } catch (e: any) {
    return err(res, e.message ?? "Batch verse lookup failed", 500);
  }
});

// ── GET /bible/translations?lang=de ──────────────────────────────────────────
// Returns available Bible translations for a language (admin/info endpoint).

router.get("/translations", async (req, res) => {
  const { lang } = req.query as { lang?: string };
  if (!lang) return err(res, "lang query param is required");

  try {
    const translations = await getAvailableTranslations(lang);
    return ok(res, translations);
  } catch (e: any) {
    return err(res, e.message ?? "Lookup failed", 500);
  }
});

// ── POST /admin/bible/verse ───────────────────────────────────────────────────
// Admin: manually warm the cache for a specific verse.

router.post("/admin/warm", requireAdmin, async (req, res) => {
  const { ref, lang } = req.body as { ref?: string; lang?: string };
  if (!ref || !lang) return err(res, "ref and lang are required");

  try {
    const result = await getVerseText(ref, lang);
    if (!result) return res.status(404).json({ error: "Could not fetch verse", ref, lang });
    return ok(res, result);
  } catch (e: any) {
    return err(res, e.message ?? "Verse warm failed", 500);
  }
});

export default router;
