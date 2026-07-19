import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

// Both trusted, server-side clients: everything here runs behind the
// requireAdmin middleware already. supabaseRead used to sit on the bare
// anon key with no user session — p2p_curriculums' only SELECT policies
// require the `authenticated` role, so an anon-only client could read
// zero rows, published or draft. Every batch-translate call failed with
// "Curriculum not found" for every curriculum, not just drafts.
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);
const supabaseRead  = createClient(SUPABASE_URL, SERVICE_ROLE_KEY || ANON_KEY);

function getOpenAI(): OpenAI {
  const apiKey = process.env.P2P_Global_Bible_Study_Network_OPEN_AI;
  if (!apiKey) throw new Error("P2P_Global_Bible_Study_Network_OPEN_AI secret is not set");
  return new OpenAI({ apiKey });
}

// gpt-4o-mini pricing (USD per token)
const COST_PER_INPUT_TOKEN  = 0.15 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 0.60 / 1_000_000;

function calcCost(usage: { prompt_tokens: number; completion_tokens: number }): number {
  return Math.round(
    (usage.prompt_tokens * COST_PER_INPUT_TOKEN +
     usage.completion_tokens * COST_PER_OUTPUT_TOKEN) * 10_000
  ) / 10_000;
}

// ── Language names ─────────────────────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese",
  zh: "Chinese (Simplified)", ar: "Arabic", he: "Hebrew", ru: "Russian",
  ja: "Japanese", ko: "Korean", hi: "Hindi", sw: "Swahili", am: "Amharic",
  yo: "Yoruba", ig: "Igbo", ha: "Hausa", zu: "Zulu", id: "Indonesian",
  ms: "Malay", tl: "Filipino", vi: "Vietnamese", th: "Thai", tr: "Turkish",
  fa: "Persian", ur: "Urdu", it: "Italian", nl: "Dutch", pl: "Polish",
  ro: "Romanian", uk: "Ukrainian", bn: "Bengali", ta: "Tamil",
};

// ── Types ──────────────────────────────────────────────────────────────────────

export type ContentType =
  | "curriculum" | "module" | "lesson"
  | "section" | "scripture" | "question"
  | "assignment" | "quiz" | "devotional" | "journal";

interface SourceFields {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  body?: string | null;
  /** Only translatable fields go here — never scripture verse text */
  metadata?: Record<string, unknown>;
}

// ── Source content fetchers ────────────────────────────────────────────────────
// ⚠️  Scripture rule: verse_text is NEVER sent to AI.
//     Only verse_ref (book/chapter/verse citation) is included as metadata.
//     Translated verse text is sourced from p2p_bible_verses_cache (Phase 5).

async function fetchEnglishSource(
  contentType: ContentType,
  contentId: string
): Promise<SourceFields | null> {
  switch (contentType) {
    case "curriculum": {
      const { data } = await supabaseRead
        .from("p2p_curriculums")
        .select("title,description")
        .eq("id", contentId)
        .maybeSingle();
      if (!data) return null;
      return { title: data.title, description: data.description };
    }

    case "module": {
      const { data } = await supabaseRead
        .from("p2p_modules")
        .select("title,description")
        .eq("id", contentId)
        .maybeSingle();
      if (!data) return null;
      return { title: data.title, description: data.description };
    }

    case "lesson": {
      const { data: lesson } = await supabaseRead
        .from("p2p_lessons")
        .select("title,subtitle")
        .eq("id", contentId)
        .maybeSingle();
      if (!lesson) return null;

      // Fetch sections + scripture refs + questions — but NOT verse text
      const [{ data: sections }, { data: scriptures }, { data: questions }] =
        await Promise.all([
          supabaseRead
            .from("p2p_lesson_sections")
            .select("id,title,content")
            .eq("lesson_id", contentId)
            .order("sort_order"),
          supabaseRead
            // Only fetch verse_ref — verse_text is excluded from AI payload
            .from("p2p_scriptures")
            .select("id,verse_ref")
            .eq("lesson_id", contentId)
            .order("sort_order"),
          supabaseRead
            .from("p2p_reflection_questions")
            .select("id,question")
            .eq("lesson_id", contentId)
            .order("sort_order"),
        ]);

      return {
        title: lesson.title,
        subtitle: lesson.subtitle,
        metadata: {
          sections: sections ?? [],
          // scriptureRefs stores citation-only metadata — language-agnostic,
          // not translated. Verse text comes from p2p_bible_verses_cache.
          scriptureRefs: scriptures ?? [],
          questions: questions ?? [],
        },
      };
    }

    default:
      return null;
  }
}

// ── AI translation ─────────────────────────────────────────────────────────────

interface TranslationResult extends SourceFields {
  metadata?: Record<string, unknown>;
}

async function callAI(
  contentType: ContentType,
  source: SourceFields,
  targetLang: string
): Promise<{ result: TranslationResult; cost_usd: number }> {
  const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;
  const openai = getOpenAI();

  const systemPrompt = `You are a professional Bible study content translator for the P2P Global Bible Study Network (AMEN TECH).
Translate the following Christian discipleship content from English to ${langName}.

Rules:
- Preserve scripture references (e.g. "John 3:16") exactly as-is — they are language-agnostic identifiers
- Do NOT translate or include verse text — scripture passages are handled by a separate Bible translation system
- Preserve theological terms appropriately for ${langName}-speaking believers
- Translate study questions, section headings, and descriptive content faithfully
- Keep the same tone: warm, encouraging, and biblically grounded
- Return ONLY a valid JSON object with the same keys as the input — no markdown, no explanation`;

  const userPrompt = `Translate this ${contentType} content to ${langName}:\n\n${JSON.stringify(source, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4096,
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  const cost_usd = response.usage ? calcCost(response.usage) : 0;
  return { result: JSON.parse(raw) as TranslationResult, cost_usd };
}

// ── Job tracking ───────────────────────────────────────────────────────────────

async function createJob(
  contentType: ContentType,
  contentId: string,
  languageCode: string,
  triggeredBy: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("p2p_translation_jobs")
    .insert({
      content_type: contentType,
      content_id: contentId,
      language: languageCode,
      status: "processing",
      attempts: 1,
      triggered_by: triggeredBy,
      ai_provider: "gpt-4o-mini",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.warn("Failed to create translation job:", error.message);
    return null;
  }
  return data.id as string;
}

async function completeJob(
  jobId: string | null,
  costUsd: number
): Promise<void> {
  if (!jobId) return;
  await supabaseAdmin
    .from("p2p_translation_jobs")
    .update({ status: "completed", ai_cost_usd: costUsd, completed_at: new Date().toISOString() })
    .eq("id", jobId);
}

async function failJob(jobId: string | null, error: string): Promise<void> {
  if (!jobId) return;
  await supabaseAdmin
    .from("p2p_translation_jobs")
    .update({ status: "failed", last_error: error, completed_at: new Date().toISOString() })
    .eq("id", jobId);
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface StoredTranslation {
  id: string;
  content_type: string;
  content_id: string;
  language_code: string;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  body: string | null;
  metadata: Record<string, unknown>;
  version: number;
  status: string;
  translated_at: string;
}

// ── Public reads (approved only for end-user paths) ───────────────────────────

/** Fetch an approved translation. Pass adminMode=true to include drafts. */
export async function getTranslation(
  contentType: ContentType,
  contentId: string,
  languageCode: string,
  adminMode = false
): Promise<StoredTranslation | null> {
  let q = supabaseRead
    .from("p2p_content_translations")
    .select("*")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("language_code", languageCode);
  if (!adminMode) q = q.eq("status", "approved");
  const { data } = await q.maybeSingle();
  return data as StoredTranslation | null;
}

/** Internal cache check — any status (used to skip re-translation) */
async function getExistingTranslation(
  contentType: ContentType,
  contentId: string,
  languageCode: string
): Promise<StoredTranslation | null> {
  const { data } = await supabaseRead
    .from("p2p_content_translations")
    .select("*")
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .eq("language_code", languageCode)
    .maybeSingle();
  return data as StoredTranslation | null;
}

/** Batch fetch approved translations for multiple IDs */
export async function getBatchTranslations(
  contentType: ContentType,
  contentIds: string[],
  languageCode: string,
  adminMode = false
): Promise<Map<string, StoredTranslation>> {
  if (!contentIds.length) return new Map();
  let q = supabaseRead
    .from("p2p_content_translations")
    .select("*")
    .eq("content_type", contentType)
    .in("content_id", contentIds)
    .eq("language_code", languageCode);
  if (!adminMode) q = q.eq("status", "approved");
  const { data } = await q;
  const map = new Map<string, StoredTranslation>();
  for (const row of (data ?? []) as StoredTranslation[]) {
    map.set(row.content_id, row);
  }
  return map;
}

/** Translate and cache a single item. Skips if already cached (any status). */
export async function translateAndStore(
  contentType: ContentType,
  contentId: string,
  languageCode: string,
  options: { triggeredBy?: string; force?: boolean } = {}
): Promise<StoredTranslation> {
  const { triggeredBy = "admin", force = false } = options;

  if (!force) {
    const existing = await getExistingTranslation(contentType, contentId, languageCode);
    if (existing) return existing;
  }

  const source = await fetchEnglishSource(contentType, contentId);
  if (!source) throw new Error(`Content not found: ${contentType}/${contentId}`);

  const jobId = await createJob(contentType, contentId, languageCode, triggeredBy);

  try {
    const { result: translated, cost_usd } = await callAI(contentType, source, languageCode);

    const row = {
      content_type: contentType,
      content_id: contentId,
      language_code: languageCode,
      title: translated.title ?? null,
      subtitle: translated.subtitle ?? null,
      description: translated.description ?? null,
      body: translated.body ?? null,
      metadata: translated.metadata ?? {},
      status: "draft",
      translated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("p2p_content_translations")
      .upsert(row, { onConflict: "content_type,content_id,language_code" })
      .select()
      .single();

    if (error) throw new Error(`Failed to store translation: ${error.message}`);
    await completeJob(jobId, cost_usd);
    return data as StoredTranslation;
  } catch (err: any) {
    await failJob(jobId, err.message ?? "Unknown error");
    throw err;
  }
}

/** Retry a failed job by re-running translation */
export async function retryJob(jobId: string): Promise<StoredTranslation> {
  const { data: job, error } = await supabaseAdmin
    .from("p2p_translation_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (error || !job) throw new Error("Job not found");
  if (job.attempts >= job.max_attempts) throw new Error("Max attempts reached");

  await supabaseAdmin
    .from("p2p_translation_jobs")
    .update({ status: "retrying", attempts: job.attempts + 1, started_at: new Date().toISOString() })
    .eq("id", jobId);

  return translateAndStore(
    job.content_type as ContentType,
    job.content_id,
    job.language,
    { triggeredBy: job.triggered_by, force: true }
  );
}

/** Batch translate all modules/lessons in a curriculum */
export async function batchTranslateCurriculum(
  curriculumId: string,
  languageCode: string,
  triggeredBy = "batch",
  onProgress?: (done: number, total: number) => void
): Promise<{ done: number; skipped: number; failed: number }> {
  const [{ data: modules }, { data: curriculum }] = await Promise.all([
    supabaseRead.from("p2p_modules").select("id").eq("curriculum_id", curriculumId),
    supabaseRead.from("p2p_curriculums").select("id").eq("id", curriculumId).maybeSingle(),
  ]);

  if (!curriculum) throw new Error("Curriculum not found");

  const moduleIds = (modules ?? []).map((m: any) => m.id as string);
  const { data: lessons } = moduleIds.length
    ? await supabaseRead.from("p2p_lessons").select("id").in("module_id", moduleIds)
    : { data: [] };

  const items: Array<{ type: ContentType; id: string }> = [
    { type: "curriculum", id: curriculumId },
    ...moduleIds.map((id) => ({ type: "module" as ContentType, id })),
    ...(lessons ?? []).map((l: any) => ({ type: "lesson" as ContentType, id: l.id as string })),
  ];

  let done = 0, skipped = 0, failed = 0;

  for (const item of items) {
    try {
      const existing = await getExistingTranslation(item.type, item.id, languageCode);
      if (existing) { skipped++; }
      else {
        await translateAndStore(item.type, item.id, languageCode, { triggeredBy });
        done++;
      }
    } catch {
      failed++;
    }
    onProgress?.(done + skipped + failed, items.length);
  }

  return { done, skipped, failed };
}

/** Coverage per language, broken down by content type with draft/approved counts */
export async function getCoverage(languageCode?: string): Promise<{
  languages?: Array<{
    code: string;
    name: string;
    curricula: { total: number; approved: number; draft: number };
    modules: { total: number; approved: number; draft: number };
    lessons: { total: number; approved: number; draft: number };
  }>;
  curricula?: { total: number; approved: number; draft: number };
  modules?: { total: number; approved: number; draft: number };
  lessons?: { total: number; approved: number; draft: number };
}> {
  const [
    { count: totalCurricula },
    { count: totalModules },
    { count: totalLessons },
  ] = await Promise.all([
    supabaseRead.from("p2p_curriculums").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabaseRead.from("p2p_modules").select("*", { count: "exact", head: true }),
    supabaseRead.from("p2p_lessons").select("*", { count: "exact", head: true }),
  ]);

  if (languageCode) {
    // Single language breakdown
    const [
      { count: appCurricula }, { count: draftCurricula },
      { count: appModules },  { count: draftModules },
      { count: appLessons },  { count: draftLessons },
    ] = await Promise.all([
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "curriculum").eq("language_code", languageCode).eq("status", "approved"),
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "curriculum").eq("language_code", languageCode).eq("status", "draft"),
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "module").eq("language_code", languageCode).eq("status", "approved"),
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "module").eq("language_code", languageCode).eq("status", "draft"),
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "lesson").eq("language_code", languageCode).eq("status", "approved"),
      supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "lesson").eq("language_code", languageCode).eq("status", "draft"),
    ]);

    return {
      curricula: { total: totalCurricula ?? 0, approved: appCurricula ?? 0, draft: draftCurricula ?? 0 },
      modules:   { total: totalModules ?? 0,   approved: appModules ?? 0,   draft: draftModules ?? 0   },
      lessons:   { total: totalLessons ?? 0,   approved: appLessons ?? 0,   draft: draftLessons ?? 0   },
    };
  }

  // All languages overview
  const { data: langs } = await supabaseRead
    .from("p2p_languages")
    .select("code,name_en")
    .neq("code", "en");

  const results = await Promise.all(
    (langs ?? []).map(async (lang: any) => {
      const code = lang.code as string;
      const [
        { count: appM },  { count: draftM },
        { count: appL },  { count: draftL },
      ] = await Promise.all([
        supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "module").eq("language_code", code).eq("status", "approved"),
        supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "module").eq("language_code", code).eq("status", "draft"),
        supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "lesson").eq("language_code", code).eq("status", "approved"),
        supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "lesson").eq("language_code", code).eq("status", "draft"),
      ]);
      return {
        code,
        name: lang.name_en ?? code,
        curricula: { total: totalCurricula ?? 0, approved: 0, draft: 0 },
        modules:   { total: totalModules ?? 0,   approved: appM ?? 0, draft: draftM ?? 0 },
        lessons:   { total: totalLessons ?? 0,   approved: appL ?? 0, draft: draftL ?? 0 },
      };
    })
  );

  return { languages: results };
}
