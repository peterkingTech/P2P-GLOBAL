// Multilingual Expansion — 39-language target reconciliation.
// Generates the 4 locale files that have a p2p_languages row but NO
// locale file at all: am (Amharic), cs (Czech), mr (Marathi),
// pcm (Nigerian Pidgin). Unlike complete-partial-locales.mjs (which fills
// gaps in an EXISTING file), these start from nothing — every key is
// translated fresh from en.json.
//
// am was previously targeted by both translate-locales.mjs and
// translate-remaining.mjs (the older OpenAI-based scripts) but no am.json
// ever landed in this repository — no log or trace of that run exists
// here to explain why. cs/mr/pcm were never targeted by any script at
// all, in any environment, ever (confirmed by searching both older
// scripts' target arrays).
//
// Same safety model as complete-partial-locales.mjs: Anthropic SDK
// (claude-haiku-4-5-20251001, the same provider/model translationEngine.ts
// already uses for curriculum), chunked requests, a file is only written
// once ALL its chunks are attempted, a failed chunk just leaves those
// keys absent (never corrupts what succeeded). This produces an AI DRAFT,
// not an approved or reviewed translation — p2p_languages.ui_review_status
// stays 'unreviewed' for all four; nothing in this script touches that
// column.

import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "../../../artifacts/mobile/locales");

const envPath = path.resolve(__dirname, "..", ".env");
const envText = fs.readFileSync(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TARGETS = [
  { code: "am", name: "Amharic" },
  { code: "cs", name: "Czech" },
  { code: "mr", name: "Marathi" },
  { code: "pcm", name: "Nigerian Pidgin" },
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

async function generateLocale(anthropic, code, name) {
  const enPath = path.join(LOCALES_DIR, "en.json");
  const targetPath = path.join(LOCALES_DIR, `${code}.json`);
  const en = JSON.parse(fs.readFileSync(enPath, "utf8"));

  const alreadyExists = fs.existsSync(targetPath);
  const target = alreadyExists ? JSON.parse(fs.readFileSync(targetPath, "utf8")) : {};
  if (alreadyExists) {
    console.log(`${name} (${code}): file already exists — treating as incremental fill, not full regeneration`);
  }

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
  console.log(`${name} (${code}): ${missingKeys.length} keys to translate (of ${Object.keys(enFlat).length} total)`);
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
          console.warn(`  ${code}: no translation returned for "${key}", leaving absent`);
        }
      }
      console.log(`  ${code}: chunk ${i + 1}/${chunks.length} done (${keyChunk.length} keys)`);
    } catch (e) {
      console.error(`  ${code}: chunk ${i + 1}/${chunks.length} FAILED: ${e.message} — leaving these ${keyChunk.length} keys absent`);
    }
  }

  if (translatedCount > 0) {
    fs.writeFileSync(targetPath, JSON.stringify(merged, null, 2) + "\n");
  } else {
    console.log(`  ${code}: nothing translated successfully — no file written`);
  }
  return { code, translated: translatedCount, total: missingKeys.length };
}

async function main() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const results = [];
  for (const { code, name } of TARGETS) {
    const result = await generateLocale(anthropic, code, name);
    results.push(result);
  }
  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`${r.code}: ${r.skipped ? "already complete" : `${r.translated}/${r.total} keys translated`}`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
