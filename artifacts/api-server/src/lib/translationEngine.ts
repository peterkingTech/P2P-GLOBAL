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

// Service-role client bypasses RLS — used only for writing translations
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY || ANON_KEY
);

// Regular client for reads
const supabaseRead = createClient(SUPABASE_URL, ANON_KEY);

function getOpenAI(): OpenAI {
  const apiKey = process.env.P2P_Global_Bible_Study_Network_OPEN_AI;
  if (!apiKey) throw new Error("P2P_Global_Bible_Study_Network_OPEN_AI secret is not set");
  return new OpenAI({ apiKey });
}

// ── Language names for the prompt ─────────────────────────────────────────────

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese",
  zh: "Chinese (Simplified)", ar: "Arabic", he: "Hebrew", ru: "Russian",
  ja: "Japanese", ko: "Korean", hi: "Hindi", sw: "Swahili", am: "Amharic",
  yo: "Yoruba", ig: "Igbo", ha: "Hausa", zu: "Zulu", id: "Indonesian",
  ms: "Malay", tl: "Filipino", vi: "Vietnamese", th: "Thai", tr: "Turkish",
  fa: "Persian", ur: "Urdu", it: "Italian", nl: "Dutch", pl: "Polish",
  ro: "Romanian", uk: "Ukrainian", bn: "Bengali", ta: "Tamil",
};

// ── Source content fetchers ───────────────────────────────────────────────────

export type ContentType =
  | "curriculum" | "module" | "lesson"
  | "section" | "scripture" | "question"
  | "assignment" | "quiz" | "devotional" | "journal";

interface SourceFields {
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  body?: string | null;
  metadata?: Record<string, unknown>;
}

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

      const [{ data: sections }, { data: scriptures }, { data: questions }] =
        await Promise.all([
          supabaseRead
            .from("p2p_lesson_sections")
            .select("id,title,content")
            .eq("lesson_id", contentId)
            .order("sort_order"),
          supabaseRead
            .from("p2p_scriptures")
            .select("id,verse_ref,verse_text")
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
          scriptures: scriptures ?? [],
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
): Promise<TranslationResult> {
  const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;
  const openai = getOpenAI();

  const systemPrompt = `You are a professional Bible study content translator for the P2P Global Bible Study Network (AMEN TECH).
Translate the following Christian discipleship content from English to ${langName}.

Rules:
- Preserve scripture references (e.g. John 3:16) exactly as-is — do NOT translate verse citations
- Translate verse text faithfully using standard ${langName} Bible translation conventions
- Preserve theological terms appropriately for ${langName}-speaking believers
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
  return JSON.parse(raw) as TranslationResult;
}

// ── Public API ─────────────────────────────────────────────────────────────────

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

/** Fetch an existing translation from the cache — no AI call */
export async function getTranslation(
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
  return (data as StoredTranslation | null);
}

/** Fetch translations for multiple IDs in one query */
export async function getBatchTranslations(
  contentType: ContentType,
  contentIds: string[],
  languageCode: string
): Promise<Map<string, StoredTranslation>> {
  if (!contentIds.length) return new Map();
  const { data } = await supabaseRead
    .from("p2p_content_translations")
    .select("*")
    .eq("content_type", contentType)
    .in("content_id", contentIds)
    .eq("language_code", languageCode);
  const map = new Map<string, StoredTranslation>();
  for (const row of (data ?? []) as StoredTranslation[]) {
    map.set(row.content_id, row);
  }
  return map;
}

/** Translate a single content item and store in the cache */
export async function translateAndStore(
  contentType: ContentType,
  contentId: string,
  languageCode: string
): Promise<StoredTranslation> {
  const existing = await getTranslation(contentType, contentId, languageCode);
  if (existing) return existing;

  const source = await fetchEnglishSource(contentType, contentId);
  if (!source) throw new Error(`Content not found: ${contentType}/${contentId}`);

  const translated = await callAI(contentType, source, languageCode);

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
  return data as StoredTranslation;
}

/** Batch translate all modules/lessons in a curriculum for a language */
export async function batchTranslateCurriculum(
  curriculumId: string,
  languageCode: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ done: number; skipped: number; failed: number }> {
  const [{ data: modules }, { data: curriculum }] = await Promise.all([
    supabaseRead
      .from("p2p_modules")
      .select("id")
      .eq("curriculum_id", curriculumId),
    supabaseRead
      .from("p2p_curriculums")
      .select("id")
      .eq("id", curriculumId)
      .maybeSingle(),
  ]);

  if (!curriculum) throw new Error("Curriculum not found");

  const moduleIds = (modules ?? []).map((m: any) => m.id as string);
  const { data: lessons } = moduleIds.length
    ? await supabaseRead
        .from("p2p_lessons")
        .select("id")
        .in("module_id", moduleIds)
    : { data: [] };

  const items: Array<{ type: ContentType; id: string }> = [
    { type: "curriculum", id: curriculumId },
    ...moduleIds.map((id) => ({ type: "module" as ContentType, id })),
    ...(lessons ?? []).map((l: any) => ({ type: "lesson" as ContentType, id: l.id as string })),
  ];

  let done = 0, skipped = 0, failed = 0;

  for (const item of items) {
    try {
      const existing = await getTranslation(item.type, item.id, languageCode);
      if (existing) { skipped++; }
      else {
        await translateAndStore(item.type, item.id, languageCode);
        done++;
      }
    } catch {
      failed++;
    }
    onProgress?.(done + skipped + failed, items.length);
  }

  return { done, skipped, failed };
}

/** Translation coverage for a given content type + language */
export async function getCoverage(languageCode: string): Promise<{
  curricula: { total: number; translated: number };
  modules: { total: number; translated: number };
  lessons: { total: number; translated: number };
}> {
  const [
    { count: totalCurricula },
    { count: totalModules },
    { count: totalLessons },
    { count: translatedCurricula },
    { count: translatedModules },
    { count: translatedLessons },
  ] = await Promise.all([
    supabaseRead.from("p2p_curriculums").select("*", { count: "exact", head: true }).eq("status", "published"),
    supabaseRead.from("p2p_modules").select("*", { count: "exact", head: true }),
    supabaseRead.from("p2p_lessons").select("*", { count: "exact", head: true }),
    supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "curriculum").eq("language_code", languageCode),
    supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "module").eq("language_code", languageCode),
    supabaseRead.from("p2p_content_translations").select("*", { count: "exact", head: true }).eq("content_type", "lesson").eq("language_code", languageCode),
  ]);

  return {
    curricula: { total: totalCurricula ?? 0, translated: translatedCurricula ?? 0 },
    modules: { total: totalModules ?? 0, translated: translatedModules ?? 0 },
    lessons: { total: totalLessons ?? 0, translated: translatedLessons ?? 0 },
  };
}
