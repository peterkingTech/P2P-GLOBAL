#!/usr/bin/env npx ts-node --esm
/**
 * Phase 7.3 — Locale file generator
 *
 * Reads locales/en.json (source of truth), translates all strings to each
 * target language using the same OpenAI gpt-4o-mini model used by the
 * translation engine, and writes locales/<code>.json.
 *
 * UI strings are safe to AI-translate — the "no AI for Scripture" rule applies
 * only to Bible verse text, not interface copy.
 *
 * Usage:
 *   pnpm ts-node scripts/translate-locales.ts [--lang de,fr,es] [--dry-run]
 *
 * Options:
 *   --lang    Comma-separated list of language codes (default: all inactive languages)
 *   --dry-run Print output without writing files
 *   --force   Re-translate even if a locale file already exists
 */

import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";

const API_KEY = process.env.P2P_Global_Bible_Study_Network_OPEN_AI;
if (!API_KEY) {
  console.error("P2P_Global_Bible_Study_Network_OPEN_AI secret is not set");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });

const LOCALES_DIR = path.resolve(__dirname, "../artifacts/mobile/locales");
const EN_FILE     = path.join(LOCALES_DIR, "en.json");

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", es: "Spanish", fr: "French", pt: "Portuguese",
  it: "Italian", nl: "Dutch", pl: "Polish", ro: "Romanian",
  el: "Greek", cs: "Czech", ru: "Russian", uk: "Ukrainian",
  tr: "Turkish", ar: "Arabic", he: "Hebrew", fa: "Persian",
  hi: "Hindi", bn: "Bengali", ur: "Urdu", ta: "Tamil",
  te: "Telugu", mr: "Marathi", zh: "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)", ja: "Japanese", ko: "Korean",
  th: "Thai", vi: "Vietnamese", id: "Indonesian", ms: "Malay",
  sw: "Swahili", am: "Amharic", ha: "Hausa", yo: "Yoruba",
  ig: "Igbo", pcm: "Nigerian Pidgin (Naijá)",
};

// Languages that need special handling (right-to-left, complex scripts)
const HIGH_REVIEW_PRIORITY = new Set(["ar", "he", "fa", "ur", "am", "yo", "ig", "pcm"]);

function parseArgs(): { langs: string[]; dryRun: boolean; force: boolean } {
  const args = process.argv.slice(2);
  const langArg = args.find((a) => a.startsWith("--lang="))?.split("=")[1];
  const langs = langArg
    ? langArg.split(",").map((l) => l.trim())
    : Object.keys(LANGUAGE_NAMES).filter((l) => l !== "en");
  const dryRun = args.includes("--dry-run");
  const force  = args.includes("--force");
  return { langs, dryRun, force };
}

/** Recursively collect all leaf string values from a nested JSON object */
function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") keys.push(full);
    else if (v && typeof v === "object") keys.push(...flattenKeys(v as any, full));
  }
  return keys;
}

/** Translate a flat map of key→string from English to targetLang */
async function translateBatch(
  strings: Record<string, string>,
  targetLang: string
): Promise<Record<string, string>> {
  const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;

  const systemPrompt = `You are a professional UI translator for the P2P Global Bible Study Network (AMEN TECH), a Christian discipleship mobile app.
Translate the following English UI strings to ${langName}.

Rules:
- Keep {{variable}} placeholders exactly as-is (they are replaced at runtime)
- Keep translation key names exactly as-is (only translate the values)
- Preserve the tone: warm, encouraging, and appropriate for a church/discipleship app
- For ${HIGH_REVIEW_PRIORITY.has(targetLang) ? "this language, use formal/standard register appropriate for church contexts" : "common UI terms like 'Home', 'Settings', 'Profile', use natural ${langName} equivalents"}
- Return ONLY a valid JSON object with the same keys — no markdown, no explanation`;

  const userPrompt = `Translate these UI strings to ${langName}:\n\n${JSON.stringify(strings, null, 2)}`;

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
  const usage = response.usage;
  if (usage) {
    const cost = ((usage.prompt_tokens * 0.15) + (usage.completion_tokens * 0.60)) / 1_000_000;
    console.log(`    tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out — $${cost.toFixed(4)}`);
  }

  return JSON.parse(raw) as Record<string, string>;
}

/** Deep-set a dot-separated key path in a nested object */
function deepSet(obj: Record<string, unknown>, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in cur)) cur[parts[i]] = {};
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

/** Flatten a nested object to a flat key→string map */
function flattenValues(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") result[full] = v;
    else if (v && typeof v === "object") Object.assign(result, flattenValues(v as any, full));
  }
  return result;
}

async function translateLocale(langCode: string, enSource: Record<string, unknown>, dryRun: boolean, force: boolean): Promise<void> {
  const outFile = path.join(LOCALES_DIR, `${langCode}.json`);
  const langName = LANGUAGE_NAMES[langCode] ?? langCode;

  if (!force && fs.existsSync(outFile)) {
    console.log(`  ⏭  ${langCode} (${langName}) — already exists, use --force to overwrite`);
    return;
  }

  console.log(`  🌐 ${langCode} (${langName})…`);
  if (HIGH_REVIEW_PRIORITY.has(langCode)) {
    console.log(`     ⚠️  High-review priority — spot-check by a native/theologically-informed reviewer before enabling`);
  }

  const flatEn = flattenValues(enSource);

  // Translate in chunks of 50 keys to stay within token limits
  const CHUNK = 50;
  const entries = Object.entries(flatEn);
  const translatedFlat: Record<string, string> = {};

  for (let i = 0; i < entries.length; i += CHUNK) {
    const chunk = Object.fromEntries(entries.slice(i, i + CHUNK));
    console.log(`    chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(entries.length / CHUNK)} (${Object.keys(chunk).length} strings)…`);
    const result = await translateBatch(chunk, langCode);
    Object.assign(translatedFlat, result);
    // Small delay to avoid rate limits
    if (i + CHUNK < entries.length) await new Promise((r) => setTimeout(r, 300));
  }

  // Rebuild nested structure
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(translatedFlat)) {
    deepSet(nested, key, value ?? flatEn[key]); // fallback to English if translation missing
  }

  const output = JSON.stringify(nested, null, 2);

  if (dryRun) {
    console.log(`    [dry-run] would write ${output.length} bytes to ${path.basename(outFile)}`);
  } else {
    fs.writeFileSync(outFile, output, "utf-8");
    console.log(`    ✅ written → ${path.basename(outFile)}`);
  }
}

async function main() {
  const { langs, dryRun, force } = parseArgs();

  if (!fs.existsSync(EN_FILE)) {
    console.error(`English source not found: ${EN_FILE}`);
    process.exit(1);
  }

  const enSource = JSON.parse(fs.readFileSync(EN_FILE, "utf-8")) as Record<string, unknown>;
  const totalStrings = Object.keys(flattenValues(enSource)).length;

  console.log(`\nP2P Locale Generator`);
  console.log(`Source: ${totalStrings} strings in en.json`);
  console.log(`Target languages: ${langs.join(", ")}`);
  if (dryRun) console.log("DRY RUN — no files will be written");
  console.log("");

  for (const lang of langs) {
    if (!(lang in LANGUAGE_NAMES)) {
      console.warn(`  ⚠️  Unknown language code: ${lang} — skipping`);
      continue;
    }
    await translateLocale(lang, enSource, dryRun, force);
  }

  console.log("\nDone.");
  if (!dryRun) {
    console.log("\nNext steps:");
    console.log("  1. Spot-check generated locale files — especially nav/button strings");
    console.log("  2. For high-review-priority languages (ar, he, fa, ur, am, yo, ig, pcm),");
    console.log("     have a native/theologically-informed reviewer check key terms");
    console.log("  3. Set is_active = true in p2p_languages only when ready to ship");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
