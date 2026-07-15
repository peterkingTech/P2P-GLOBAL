import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth";
import {
  getTranslation,
  getBatchTranslations,
  translateAndStore,
  batchTranslateCurriculum,
  getCoverage,
  type ContentType,
} from "../lib/translationEngine";

const router = Router();

function ok(res: any, data: unknown) { return res.json(data); }
function err(res: any, msg: string, status = 500) {
  return res.status(status).json({ error: msg });
}

const VALID_TYPES = new Set([
  "curriculum", "module", "lesson", "section",
  "scripture", "question", "assignment", "quiz", "devotional", "journal",
]);

// ── Public: fetch a single translation ────────────────────────────────────────
// GET /api/translations/:contentType/:contentId?lang=de&auto=true

router.get("/:contentType/:contentId", async (req, res) => {
  const { contentType, contentId } = req.params;
  const { lang = "en", auto = "false" } = req.query as Record<string, string>;

  if (!VALID_TYPES.has(contentType)) {
    return err(res, `Unknown content type: ${contentType}`, 400);
  }
  if (lang === "en") {
    return ok(res, null);
  }

  try {
    let translation = await getTranslation(contentType as ContentType, contentId, lang);

    if (!translation && auto === "true") {
      translation = await translateAndStore(contentType as ContentType, contentId, lang);
    }

    return ok(res, translation ?? null);
  } catch (e: any) {
    return err(res, e.message ?? "Translation lookup failed");
  }
});

// ── Public: batch fetch translations for multiple IDs ─────────────────────────
// POST /api/translations/batch { contentType, contentIds, lang }

router.post("/batch", async (req, res) => {
  const { contentType, contentIds, lang } = req.body as {
    contentType: string;
    contentIds: string[];
    lang: string;
  };

  if (!VALID_TYPES.has(contentType)) {
    return err(res, `Unknown content type: ${contentType}`, 400);
  }
  if (!Array.isArray(contentIds) || contentIds.length === 0) {
    return ok(res, {});
  }
  if (lang === "en") {
    return ok(res, {});
  }

  try {
    const map = await getBatchTranslations(
      contentType as ContentType,
      contentIds,
      lang
    );
    return ok(res, Object.fromEntries(map));
  } catch (e: any) {
    return err(res, e.message ?? "Batch translation lookup failed");
  }
});

// ── Admin: trigger AI translation for a single item ───────────────────────────
// POST /api/admin/translations/trigger { contentType, contentId, lang }

router.post("/admin/trigger", requireAdmin, async (req, res) => {
  const { contentType, contentId, lang } = req.body as {
    contentType: string;
    contentId: string;
    lang: string;
  };

  if (!VALID_TYPES.has(contentType)) {
    return err(res, `Unknown content type: ${contentType}`, 400);
  }
  if (!contentId || !lang) {
    return err(res, "contentId and lang are required", 400);
  }

  try {
    const result = await translateAndStore(contentType as ContentType, contentId, lang);
    return ok(res, result);
  } catch (e: any) {
    return err(res, e.message ?? "Translation failed");
  }
});

// ── Admin: batch-translate an entire curriculum ────────────────────────────────
// POST /api/admin/translations/batch-curriculum { curriculumId, lang }

router.post("/admin/batch-curriculum", requireAdmin, async (req, res) => {
  const { curriculumId, lang } = req.body as {
    curriculumId: string;
    lang: string;
  };

  if (!curriculumId || !lang) {
    return err(res, "curriculumId and lang are required", 400);
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stats = await batchTranslateCurriculum(
      curriculumId,
      lang,
      (done, total) => {
        res.write(`data: ${JSON.stringify({ done, total })}\n\n`);
      }
    );
    res.write(`data: ${JSON.stringify({ done: true, stats })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ error: e.message ?? "Batch translation failed" })}\n\n`);
  }

  res.end();
});

// ── Admin: translation coverage report ────────────────────────────────────────
// GET /api/admin/translations/coverage?lang=de

router.get("/admin/coverage", requireAdmin, async (req, res) => {
  const { lang } = req.query as { lang?: string };
  if (!lang) return err(res, "lang query param is required", 400);

  try {
    const coverage = await getCoverage(lang);
    return ok(res, coverage);
  } catch (e: any) {
    return err(res, e.message ?? "Coverage check failed");
  }
});

export default router;
