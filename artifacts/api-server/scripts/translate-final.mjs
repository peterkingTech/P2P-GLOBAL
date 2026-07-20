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

const FINAL = [
  { code: "am", name: "Amharic" },
  { code: "ig", name: "Igbo" },
  { code: "zu", name: "Zulu" },
  { code: "pa", name: "Punjabi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
];

async function translateTo(langCode, langName, enObj) {
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: "You are a JSON translator. Output ONLY raw valid JSON starting with { — no markdown, no code fences, no explanation.",
      },
      {
        role: "user",
        content: `Translate all JSON string values from English to ${langName}. Rules: preserve all keys unchanged; preserve placeholders {{stage}} {{count}} {{points}} {{name}} {{pct}} {{total}} {{submitted}} {{approved}} {{done}} {{praying}} {{amen}} unchanged; preserve brand names P2P and AMEN TECH unchanged; preserve emoji and \\n unchanged; use standard Bible/Christian terminology in ${langName}.\n\n${JSON.stringify(enObj, null, 2)}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON. Preview: ${text.slice(0, 300)}`);
    return JSON.parse(match[0]);
  }
}

const toProcess = FINAL.filter(({ code }) => !fs.existsSync(path.join(LOCALES_DIR, `${code}.json`)));
console.log(`Processing ${toProcess.length} final languages...`);

await Promise.all(toProcess.map(async ({ code, name }) => {
  try {
    console.log(`⏳ ${name} (${code})...`);
    const translated = await translateTo(code, name, enJson);
    fs.writeFileSync(path.join(LOCALES_DIR, `${code}.json`), JSON.stringify(translated, null, 2) + "\n");
    console.log(`✓  ${name} (${code})`);
  } catch (e) {
    console.error(`✗  ${name} (${code}): ${e.message}`);
  }
}));
console.log("Done!");
