// One-time/repeatable batch translation script — translates every lesson
// into every configured target language, using the existing Anthropic-backed
// translation engine (lib/translationEngine.ts, already block-aware).
//
// Usage:
//   set -a && source ../.env && set +a && pnpm exec tsx src/scripts/translateCurriculum.ts
// or, since this script also self-loads artifacts/api-server/.env directly
// (see below), it works bare too:
//   pnpm exec tsx src/scripts/translateCurriculum.ts
//
// Fully idempotent — re-running skips any lesson/language pair that's
// already been translated (any status), so it's safe to re-run after a
// partial run or interruption.

// MUST be the first import — see _loadEnv.ts for why order matters here.
import "./_loadEnv.js";

import { createClient } from "@supabase/supabase-js";
import { translateAndStore, fetchEnglishSource, hasTranslatableContent, getTranslation } from "../lib/translationEngine.js";

const SUPABASE_URL =
  process.env.SUPABASE_DB_URL?.startsWith("https://")
    ? process.env.SUPABASE_DB_URL
    : (process.env.SUPABASE_URL ?? "https://omkqkasniakcnmfcwrvs.supabase.co");
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY is not set — check artifacts/api-server/.env.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const TARGET_LANGUAGES = ["de", "fr", "es", "pt", "ar", "sw", "hi", "ig", "yo", "ko", "id", "ru", "tl", "bn", "zh"];
const DELAY_MS = 200;
const TRIGGERED_BY = "batch-script";
const MAX_ATTEMPTS = 3; // matches p2p_translation_jobs.max_attempts convention — this script makes one attempt per item; further attempts happen via the admin retry action.

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", fr: "French", es: "Spanish", pt: "Portuguese",
  ar: "Arabic", sw: "Swahili", hi: "Hindi", ig: "Igbo",
  yo: "Yoruba", ko: "Korean", id: "Indonesian", ru: "Russian",
  tl: "Tagalog", bn: "Bengali", zh: "Chinese", am: "Amharic",
  ha: "Hausa", tr: "Turkish", ur: "Urdu", it: "Italian",
  nl: "Dutch", ro: "Romanian", uk: "Ukrainian",
};

function langLabel(code: string): string {
  return `${code.toUpperCase()} (${LANGUAGE_NAMES[code] ?? code})`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Batch Curriculum Translation ===\n");

  // ── Connection test — fails fast with a clear message if credentials are wrong ──
  const { error: connErr } = await supabase.from("p2p_lessons").select("id", { count: "exact", head: true });
  if (connErr) {
    console.error("Supabase connection failed:", connErr.message);
    process.exit(1);
  }
  console.log("Supabase connection confirmed.\n");

  // ── Lookup maps: module/lesson names for human-readable log lines ────────────
  const { data: lessons, error: lessonsErr } = await supabase
    .from("p2p_lessons")
    .select("id, title, module_id, order_index")
    .order("order_index");
  if (lessonsErr) {
    console.error("Failed to fetch lessons:", lessonsErr.message);
    process.exit(1);
  }

  const { data: modules, error: modulesErr } = await supabase
    .from("p2p_modules")
    .select("id, title, order_index");
  if (modulesErr) {
    console.error("Failed to fetch modules:", modulesErr.message);
    process.exit(1);
  }

  const lessonMap = Object.fromEntries((lessons ?? []).map((l) => [l.id, l]));
  const moduleMap = Object.fromEntries((modules ?? []).map((m) => [m.id, m]));

  function lessonLabel(lessonId: string): string {
    const lesson = lessonMap[lessonId];
    if (!lesson) return `Lesson ${lessonId}`;
    const mod = lesson.module_id ? moduleMap[lesson.module_id] : null;
    const modLabel = mod ? `Module ${mod.order_index}: ${mod.title}` : "Module ?: Unknown";
    return `${modLabel} → Lesson ${lesson.order_index}: ${lesson.title}`;
  }

  // ── Pre-filter: which lessons actually have translatable content ─────────────
  // Checked once (not once per language) since the check itself is a real
  // query — re-running it per language would be 15x wasted work.
  const translatableLessonIds: string[] = [];
  for (const lesson of lessons ?? []) {
    const source = await fetchEnglishSource("lesson", lesson.id);
    if (hasTranslatableContent(source)) {
      translatableLessonIds.push(lesson.id);
    } else {
      console.log(`Skipping lesson ${lesson.id} (${lesson.title}) — no translatable content found`);
    }
  }

  const total = translatableLessonIds.length;
  console.log(`\nFound ${lessons?.length ?? 0} lessons, ${total} with translatable content.`);
  console.log(`Target languages (${TARGET_LANGUAGES.length}): ${TARGET_LANGUAGES.map(langLabel).join(", ")}\n`);

  let translatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let totalCostUsd = 0;

  for (const lang of TARGET_LANGUAGES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Starting language: ${langLabel(lang)}`);
    console.log(`${"=".repeat(60)}\n`);

    for (let i = 0; i < total; i++) {
      const lessonId = translatableLessonIds[i];
      const label = lessonLabel(lessonId);

      try {
        const existing = await getTranslation("lesson", lessonId, lang, true);
        if (existing) {
          console.log(`[${i + 1}/${total}] ${label} | ${langLabel(lang)} | already translated, skipping`);
          skippedCount++;
          continue;
        }

        await translateAndStore("lesson", lessonId, lang, { triggeredBy: TRIGGERED_BY });

        const { data: jobRows } = await supabase
          .from("p2p_translation_jobs")
          .select("ai_cost_usd")
          .eq("content_type", "lesson")
          .eq("content_id", lessonId)
          .eq("language", lang)
          .eq("triggered_by", TRIGGERED_BY)
          .order("created_at", { ascending: false })
          .limit(1);
        const cost = jobRows?.[0]?.ai_cost_usd ?? 0;
        totalCostUsd += cost;

        console.log(`[${i + 1}/${total}] ${label} | ${langLabel(lang)} | $${cost.toFixed(4)} | attempt 1/${MAX_ATTEMPTS}`);
        translatedCount++;
        await sleep(DELAY_MS);
      } catch (e: any) {
        console.log(`[${i + 1}/${total}] ${label} | ${langLabel(lang)} | FAILED — ${e.message}`);
        failedCount++;
      }
    }
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("TRANSLATION COMPLETE");
  console.log(`Lessons translated: ${translatedCount}`);
  console.log(`Lessons skipped (already cached): ${skippedCount}`);
  console.log(`Lessons failed: ${failedCount}`);
  console.log(`Total cost: $${totalCostUsd.toFixed(4)}`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch((e) => {
  console.error("\nFATAL ERROR:", e.message);
  console.error(e.stack);
  process.exit(1);
});
