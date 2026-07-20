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

const REMAINING = [
  { code: "el", name: "Greek" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "vi", name: "Vietnamese" },
  { code: "th", name: "Thai" },
  { code: "id", name: "Indonesian" },
  { code: "ms", name: "Malay" },
  { code: "tl", name: "Filipino (Tagalog)" },
  { code: "am", name: "Amharic" },
  { code: "ha", name: "Hausa" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
  { code: "zu", name: "Zulu" },
  { code: "af", name: "Afrikaans" },
  { code: "zh-Hant", name: "Chinese Traditional" },
  { code: "pa", name: "Punjabi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
];

async function translateTo(langCode, langName, enObj) {
  const prompt = `Translate this JSON object from English to ${langName}.

STRICT RULES:
1. Keep ALL JSON keys exactly as-is
2. Keep ALL template placeholders: {{stage}}, {{count}}, {{points}}, {{name}}, {{pct}}, {{total}}, {{submitted}}, {{approved}}, {{done}}, {{praying}}, {{amen}}
3. Keep brand names: "P2P", "AMEN TECH", "P2P Global Bible Study Network"
4. Keep emoji characters unchanged
5. Keep \\n newlines in strings
6. Use standard Bible/Christian terminology in ${langName}
7. Return ONLY valid JSON — no markdown, no explanation

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

async function run() {
  const toProcess = REMAINING.filter(({ code }) => !fs.existsSync(path.join(LOCALES_DIR, `${code}.json`)));
  console.log(`Processing ${toProcess.length} remaining languages...`);

  const CONCURRENCY = 5;
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const chunk = toProcess.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async ({ code, name }) => {
      try {
        console.log(`⏳ ${name} (${code})...`);
        const translated = await translateTo(code, name, enJson);
        fs.writeFileSync(path.join(LOCALES_DIR, `${code}.json`), JSON.stringify(translated, null, 2) + "\n");
        console.log(`✓  ${name} (${code})`);
      } catch (e) {
        console.error(`✗  ${name} (${code}): ${e.message}`);
      }
    }));
  }
  console.log("Done!");
}

run();
