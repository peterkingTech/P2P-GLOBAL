// Multilingual Expansion Stage 6 — fill MISSING keys only for the locales
// that are actually wired into the running app (lib/i18n.ts) but stuck at
// 10-40% completion: de, ar, es, fr, hi, pt, sw, zh. Every other locale
// file in this repo is already ~95.7% complete (see Stage 4's audit tool,
// artifacts/mobile/scripts/audit-translations.js) via an older OpenAI-based
// script that is not configured in this environment (no
// AI_INTEGRATIONS_OPENAI_API_KEY) — this uses the Anthropic SDK instead,
// the same provider translationEngine.ts already uses for curriculum
// translation, with an equivalent system prompt (faithful, warm,
// theologically careful, preserve interpolation/brand names/emoji).
//
// SAFETY: only ever fills keys that are missing or empty in the target
// file today. Every already-present translated string (the ~49-192 keys
// each of these locales already had) is preserved byte-for-byte, never
// resent to the model, never overwritten.
//
// This produces an AI-DRAFT, not an approved translation — see Stage 6/8's
// report for why these must not be presented as human-reviewed or
// production-ready.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../../../artifacts/mobile/locales");

// Standalone script — not run through the API server's normal bootstrap,
// so .env isn't loaded ambiently. Parse it directly (same approach used
// for the read-only audit scripts earlier this session).
const envPath = path.resolve(__dirname, "..", ".env");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TARGETS = [
  { code: "de", name: "German" },
  { code: "ar", name: "Arabic" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "hi", name: "Hindi" },
  { code: "pt", name: "Portuguese" },
  { code: "sw", name: "Swahili" },
  { code: "zh", name: "Chinese (Simplified)" },
];

const MODEL = "claude-haiku-4-5-20251001";
const CHUNK_SIZE = 120;

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, fullKey, out);
    else out[fullKey] = value;
  }
  return out;
}

function setNested(obj, dotKey, value) {
  const parts = dotKey.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function translateChunk(anthropic, langName, pairs) {
  const system = `You are translating user-interface strings for P2P Global, a peer-to-peer Christian discipleship and Bible study mobile app, from English to ${langName}.

STRICT RULES:
1. Return ONLY a valid JSON object mapping each input key to its translated string — no markdown, no explanation, no code fences.
2. Keep every JSON key exactly as given.
3. Preserve every {{variable}} placeholder exactly (e.g. {{count}}, {{name}}, {{pct}}) — never translate or remove them.
4. Preserve brand/product names unchanged: "P2P", "P2P Global", "AMEN TECH", "P2P Global Bible Study Network".
5. Preserve emoji characters unchanged.
6. Preserve \\n newlines within a string.
7. Use natural, warm, theologically accurate Christian/discipleship terminology in ${langName} — this is UI text for believers studying the Bible together, not a literal word-for-word translation.
8. If a value is already a short technical token (a single letter, a number, an empty string), return it unchanged.`;

  const userPrompt = `Translate these UI strings to ${langName}. Input (key -> English text):\n\n${JSON.stringify(pairs, null, 2)}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = (textBlock?.text ?? "{}").trim().replace(/^```(?:json)?\n?|\n?```$/g, "");
  return JSON.parse(raw);
}

async function processLocale(anthropic, code, name) {
  const enPath = path.join(LOCALES_DIR, "en.json");
  const targetPath = path.join(LOCALES_DIR, `${code}.json`);
  const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
  const target = JSON.parse(fs.readFileSync(targetPath, "utf8"));

  const enFlat = flatten(en);
  const targetFlat = flatten(target);

  const missingPairs = {};
  for (const [key, value] of Object.entries(enFlat)) {
    const existing = targetFlat[key];
    if (existing === undefined || (typeof existing === "string" && existing.trim() === "")) {
      missingPairs[key] = value;
    }
  }

  const missingKeys = Object.keys(missingPairs);
  console.log(`${name} (${code}): ${missingKeys.length} missing/empty keys to translate`);
  if (missingKeys.length === 0) return { code, translated: 0, skipped: true };

  const chunks = chunk(missingKeys, CHUNK_SIZE);
  const merged = { ...target };
  let translatedCount = 0;

  for (const [i, keyChunk] of chunks.entries()) {
    const pairs = Object.fromEntries(keyChunk.map((k) => [k, missingPairs[k]]));
    try {
      const result = await translateChunk(anthropic, name, pairs);
      for (const key of keyChunk) {
        if (typeof result[key] === "string" && result[key].trim() !== "") {
          setNested(merged, key, result[key]);
          translatedCount++;
        } else {
          console.warn(`  ${code}: no translation returned for "${key}", leaving as-is`);
        }
      }
      console.log(`  ${code}: chunk ${i + 1}/${chunks.length} done (${keyChunk.length} keys)`);
    } catch (e) {
      console.error(`  ${code}: chunk ${i + 1}/${chunks.length} FAILED: ${e.message} — leaving these ${keyChunk.length} keys untouched`);
    }
  }

  fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
  return { code, translated: translatedCount, missing: missingKeys.length };
}

async function main() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = [];
  for (const { code, name } of TARGETS) {
    const result = await processLocale(anthropic, code, name);
    results.push(result);
  }
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.code}: ${r.skipped ? "already complete" : `${r.translated}/${r.missing} keys filled`}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
