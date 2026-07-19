import { Router } from "express";
import { requireAdmin } from "../middleware/adminAuth";
import {
  getTranslation,
  getBatchTranslations,
  translateAndStore,
  batchTranslateCurriculum,
  getCoverage,
  retryJob,
  type ContentType,
} from "../lib/translationEngine";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Same fix as lib/translationEngine.ts — supabaseRead must bypass RLS to
// read curriculum/module/lesson rows; the bare anon key (no user session,
// role `anon`) cannot satisfy p2p_curriculums' authenticated-only SELECT
// policies, so every lookup failed regardless of status.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);
const supabaseRead  = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function ok(res: any, data: unknown) { return res.json(data); }
function err(res: any, msg: string, status = 500) {
  return res.status(status).json({ error: msg });
}

const VALID_TYPES = new Set([
  "curriculum","module","lesson","section",
  "scripture","question","assignment","quiz","devotional","journal",
]);

// ── Public: fetch a single approved translation ───────────────────────────────
// GET /api/translations/:contentType/:contentId?lang=de&auto=true

router.get("/:contentType/:contentId", async (req, res) => {
  const { contentType, contentId } = req.params;
  const { lang = "en", auto = "false" } = req.query as Record<string, string>;

  if (!VALID_TYPES.has(contentType)) return err(res, `Unknown content type: ${contentType}`, 400);
  if (lang === "en") return ok(res, null);

  try {
    // Public endpoint: approved translations only
    let translation = await getTranslation(contentType as ContentType, contentId, lang, false);

    if (!translation && auto === "true") {
      // Trigger AI — result will be draft (not yet approved), so not returned here
      translateAndStore(contentType as ContentType, contentId, lang, { triggeredBy: "auto" })
        .catch((e) => console.warn("Auto-translate failed:", e.message));
    }

    return ok(res, translation ?? null);
  } catch (e: any) {
    return err(res, e.message ?? "Translation lookup failed");
  }
});

// ── Public: batch fetch approved translations ─────────────────────────────────
// POST /api/translations/batch { contentType, contentIds, lang }

router.post("/batch", async (req, res) => {
  const { contentType, contentIds, lang } = req.body as {
    contentType: string; contentIds: string[]; lang: string;
  };

  if (!VALID_TYPES.has(contentType)) return err(res, `Unknown content type: ${contentType}`, 400);
  if (!Array.isArray(contentIds) || contentIds.length === 0) return ok(res, {});
  if (lang === "en") return ok(res, {});

  try {
    // Public: approved only
    const map = await getBatchTranslations(contentType as ContentType, contentIds, lang, false);
    return ok(res, Object.fromEntries(map));
  } catch (e: any) {
    return err(res, e.message ?? "Batch lookup failed");
  }
});

// ── Admin: delete a cached translation (force re-translate next trigger) ──────
// DELETE /api/translations/:contentType/:contentId?lang=de

router.delete("/:contentType/:contentId", requireAdmin, async (req, res) => {
  const { contentType, contentId } = req.params;
  const { lang } = req.query as { lang?: string };

  if (!lang) return err(res, "lang query param is required", 400);

  const { error } = await supabaseAdmin
    .from("p2p_content_translations")
    .delete()
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("language_code", lang);

  if (error) return err(res, error.message);
  return ok(res, { deleted: true });
});

// ── Admin: edit + approve/reject a translation ────────────────────────────────
// PATCH /api/translations/:contentType/:contentId
// Body: { lang, title?, subtitle?, description?, body?, metadata?, status? }

router.patch("/:contentType/:contentId", requireAdmin, async (req, res) => {
  const { contentType, contentId } = req.params;
  const { lang, title, subtitle, description, body, metadata, status } = req.body as {
    lang: string; title?: string; subtitle?: string; description?: string;
    body?: string; metadata?: Record<string, unknown>; status?: string;
  };

  if (!lang) return err(res, "lang is required", 400);

  const allowed = new Set(["draft", "approved", "rejected"]);
  if (status && !allowed.has(status)) return err(res, `Invalid status: ${status}`, 400);

  const update: Record<string, unknown> = {};
  if (title !== undefined) update.title = title;
  if (subtitle !== undefined) update.subtitle = subtitle;
  if (description !== undefined) update.description = description;
  if (body !== undefined) update.body = body;
  if (metadata !== undefined) update.metadata = metadata;
  if (status !== undefined) {
    update.status = status;
    if (status === "approved") {
      update.approved_at = new Date().toISOString();
    }
  }

  if (!Object.keys(update).length) return err(res, "No fields to update", 400);

  const { data, error } = await supabaseAdmin
    .from("p2p_content_translations")
    .update(update)
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("language_code", lang)
    .select()
    .single();

  if (error) return err(res, error.message);
  return ok(res, data);
});

// ── Admin: trigger AI translation for a single item ───────────────────────────
// POST /api/translations/admin/trigger { contentType, contentId, lang, force? }

router.post("/admin/trigger", requireAdmin, async (req, res) => {
  const { contentType, contentId, lang, force = false } = req.body as {
    contentType: string; contentId: string; lang: string; force?: boolean;
  };

  if (!VALID_TYPES.has(contentType)) return err(res, `Unknown type: ${contentType}`, 400);
  if (!contentId || !lang) return err(res, "contentId and lang are required", 400);

  try {
    const result = await translateAndStore(contentType as ContentType, contentId, lang, {
      triggeredBy: "admin",
      force,
    });
    return ok(res, result);
  } catch (e: any) {
    return err(res, e.message ?? "Translation failed");
  }
});

// ── Admin: retry a failed job ─────────────────────────────────────────────────
// POST /api/translations/admin/retry/:jobId

router.post("/admin/retry/:jobId", requireAdmin, async (req, res) => {
  const { jobId } = req.params;
  try {
    const result = await retryJob(jobId);
    return ok(res, result);
  } catch (e: any) {
    return err(res, e.message ?? "Retry failed");
  }
});

// ── Admin: paginated job history ──────────────────────────────────────────────
// GET /api/translations/admin/jobs?status=&language=&content_type=&page=0&limit=50

router.get("/admin/jobs", requireAdmin, async (req, res) => {
  const {
    status, language, content_type,
    page = "0", limit = "50",
  } = req.query as Record<string, string>;

  const from = parseInt(page) * parseInt(limit);
  const to   = from + parseInt(limit) - 1;

  let q = supabaseRead
    .from("p2p_translation_jobs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status) q = q.eq("status", status);
  if (language) q = q.eq("language", language);
  if (content_type) q = q.eq("content_type", content_type);

  const { data, count, error } = await q;
  if (error) return err(res, error.message);
  return ok(res, { jobs: data, total: count, page: parseInt(page), limit: parseInt(limit) });
});

// ── Admin: batch-translate a curriculum (SSE stream) ─────────────────────────
// POST /api/translations/admin/batch-curriculum { curriculumId, lang, triggeredBy? }

router.post("/admin/batch-curriculum", requireAdmin, async (req, res) => {
  const { curriculumId, lang, triggeredBy = "batch" } = req.body as {
    curriculumId: string; lang: string; triggeredBy?: string;
  };

  if (!curriculumId || !lang) return err(res, "curriculumId and lang are required", 400);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const stats = await batchTranslateCurriculum(curriculumId, lang, triggeredBy, (done, total) => {
      res.write(`data: ${JSON.stringify({ done, total })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true, stats })}\n\n`);
  } catch (e: any) {
    res.write(`data: ${JSON.stringify({ error: e.message ?? "Batch failed" })}\n\n`);
  }

  res.end();
});

// ── Admin: coverage report ────────────────────────────────────────────────────
// GET /api/translations/admin/coverage?lang=de   (single language breakdown)
// GET /api/translations/admin/coverage           (all languages overview)

router.get("/admin/coverage", requireAdmin, async (req, res) => {
  const { lang } = req.query as { lang?: string };
  try {
    const coverage = await getCoverage(lang);
    return ok(res, coverage);
  } catch (e: any) {
    return err(res, e.message ?? "Coverage check failed");
  }
});

export default router;
