import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth";
import {
  getVerseText,
  getBatchVerseText,
  getAvailableTranslations,
  getVerseTextForTranslation,
  getTranslationByCode,
  parseVerseRef,
} from "../lib/bibleService";

const API_BIBLE_BASE = "https://api.scripture.api.bible/v1";

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

// ── POST /bible/passage ───────────────────────────────────────────────────────
// P2P Together Phase 6 — a Scripture "passage" (book/chapter/verse-range) in
// an EXPLICITLY chosen translation, not the language-default GET /verse
// resolves. Reuses getVerseTextForTranslation per verse (same per-verse
// cache as everywhere else in this file — no bulk translation storage).
// Body: { book, chapter, startVerse, endVerse, translationCode }
router.post("/passage", async (req, res) => {
  const { book, chapter, startVerse, endVerse, translationCode } = req.body as {
    book?: string; chapter?: number; startVerse?: number; endVerse?: number; translationCode?: string;
  };
  if (!book || !chapter || !startVerse || !translationCode) {
    return err(res, "book, chapter, startVerse, and translationCode are required");
  }
  const end = endVerse ?? startVerse;
  if (end < startVerse) return err(res, "endVerse must not be before startVerse");
  if (end - startVerse > 29) return err(res, "A passage can span at most 30 verses at a time");

  const translation = await getTranslationByCode(translationCode);
  if (!translation) return err(res, "That translation isn't available", 404);

  try {
    const verses: { verse: number; text: string }[] = [];
    for (let v = startVerse; v <= end; v++) {
      const result = await getVerseTextForTranslation(`${book} ${chapter}:${v}`, translationCode);
      if (result) verses.push({ verse: v, text: result.text });
    }
    if (verses.length === 0) return err(res, "No verses found for that passage", 404);
    return ok(res, { translationCode: translation.translation_code, translationName: translation.translation_name, book, chapter, verses });
  } catch (e: any) {
    return err(res, e.message ?? "Passage lookup failed", 500);
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

// ── GET /bible/catalog ────────────────────────────────────────────────────────
// Admin: fetch every Bible we have access to from API.Bible.
// Optional ?lang=es to filter by ISO language code.

router.get("/catalog", requireAdmin, async (req, res) => {
  const apiKey = process.env.API_Bible ?? process.env.API_BIBLE_KEY;
  if (!apiKey) return err(res, "API_Bible secret is not set", 500);

  const { lang } = req.query as { lang?: string };
  const url = lang
    ? `${API_BIBLE_BASE}/bibles?language=${lang}`
    : `${API_BIBLE_BASE}/bibles`;

  try {
    const apires = await fetch(url, { headers: { "api-key": apiKey } });
    if (!apires.ok) {
      const body = await apires.text().catch(() => "");
      return err(res, `API.Bible returned ${apires.status}: ${body}`, 502);
    }
    const json = await apires.json() as { data?: unknown[] };
    return ok(res, json.data ?? []);
  } catch (e: any) {
    return err(res, e.message ?? "Catalog fetch failed", 500);
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
