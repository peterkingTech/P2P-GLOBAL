import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../../../artifacts/mobile/locales");

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
});

const enJson = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"));

// Phase 1: ~40 priority languages
const PHASE1_LANGUAGES = [
  // European (not yet done)
  { code: "it", name: "Italian" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
  { code: "pl", name: "Polish" },
  { code: "ro", name: "Romanian" },
  { code: "uk", name: "Ukrainian" },
  { code: "el", name: "Greek" },
  { code: "sv", name: "Swedish" },
  { code: "no", name: "Norwegian" },
  { code: "da", name: "Danish" },
  // Middle Eastern / Central Asian (he, fa, tr, ur not yet done)
  { code: "he", name: "Hebrew" },
  { code: "fa", name: "Persian (Farsi)" },
  { code: "tr", name: "Turkish" },
  { code: "ur", name: "Urdu" },
  // South Asian (not yet done)
  { code: "bn", name: "Bengali" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "pa", name: "Punjabi" },
  // East/Southeast Asian (ja, ko, vi, th, id, ms, tl not yet done)
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tl", name: "Filipino (Tagalog)" },
  // African (am, ha, yo, ig, zu, af not yet done)
  { code: "am", name: "Amharic" },
  { code: "ha", name: "Hausa" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
  { code: "zu", name: "Zulu" },
  { code: "af", name: "Afrikaans" },
  // Chinese Traditional
  { code: "zh-Hant", name: "Chinese Traditional" },
];

async function translateTo(langCode, langName, enObj) {
  const prompt = `Translate this JSON object from English to ${langName}.

STRICT RULES — violating any rule will break the app:
1. Keep ALL JSON keys exactly as-is (never translate keys)
2. Keep ALL template placeholders exactly: {{stage}}, {{count}}, {{points}}, {{name}}, {{pct}}, {{total}}, {{submitted}}, {{approved}}, {{done}}, {{praying}}, {{amen}}
3. Keep brand names unchanged: "P2P", "AMEN TECH", "P2P Global Bible Study Network"
4. Keep emoji characters unchanged
5. Keep \\n newlines unchanged in strings
6. Use natural, fluent ${langName} — especially standard Bible/Christian terminology in ${langName}
7. Return ONLY valid JSON — no markdown fences, no explanation, no extra text

English source:
${JSON.stringify(enObj, null, 2)}`;

  const response = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in response for ${langCode}`);
  return JSON.parse(match[0]);
}

async function processBatch(langs, concurrency = 4) {
  const results = [];
  for (let i = 0; i < langs.length; i += concurrency) {
    const chunk = langs.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      chunk.map(async ({ code, name }) => {
        const outPath = path.join(LOCALES_DIR, `${code}.json`);
        // Skip if already exists
        if (fs.existsSync(outPath)) {
          console.log(`⏭  ${name} (${code}) — already exists, skipping`);
          return { code, success: true, skipped: true };
        }
        try {
          process.stdout.write(`⏳ Translating ${name} (${code})...\n`);
          const translated = await translateTo(code, name, enJson);
          fs.writeFileSync(outPath, JSON.stringify(translated, null, 2) + "\n");
          console.log(`✓  ${name} (${code}) done`);
          return { code, success: true };
        } catch (e) {
          console.error(`✗  ${name} (${code}) FAILED: ${e.message}`);
          return { code, name, success: false, error: e.message };
        }
      })
    );
    results.push(...chunkResults);
  }
  return results;
}

console.log(`Starting Phase 1 translation: ${PHASE1_LANGUAGES.length} languages`);
console.log(`Locales dir: ${LOCALES_DIR}`);
console.log("---");

const results = await processBatch(PHASE1_LANGUAGES, 5);

const failed = results.filter((r) => !r.success);
const done = results.filter((r) => r.success && !r.skipped);
const skipped = results.filter((r) => r.skipped);

console.log("\n=== SUMMARY ===");
console.log(`✓ Translated: ${done.length}`);
console.log(`⏭ Skipped (existing): ${skipped.length}`);
console.log(`✗ Failed: ${failed.length}`);
if (failed.length > 0) {
  console.log("Failed languages:", failed.map((r) => `${r.name} (${r.code}): ${r.error}`).join("\n"));
}
