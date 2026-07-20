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

const MISSING = [
  { code: "el", name: "Greek" },
  { code: "am", name: "Amharic" },
  { code: "yo", name: "Yoruba" },
  { code: "ig", name: "Igbo" },
  { code: "zu", name: "Zulu" },
  { code: "pa", name: "Punjabi (Gurmukhi script)" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
];

async function translateTo(langCode, langName, enObj) {
  // Use system message to enforce JSON-only output
  const response = await openai.chat.completions.create({
    model: "gpt-5.6-luna",
    max_completion_tokens: 8192,
    messages: [
      {
        role: "system",
        content: `You are a JSON translation engine. You ONLY output raw valid JSON. No markdown, no code fences, no explanation — just the JSON object starting with { and ending with }.`,
      },
      {
        role: "user",
        content: `Translate all string VALUES in this JSON from English to ${langName}. RULES:
- Keys: unchanged
- Placeholders {{stage}} {{count}} {{points}} {{name}} {{pct}} {{total}} {{submitted}} {{approved}} {{done}} {{praying}} {{amen}}: unchanged
- Brand names "P2P", "AMEN TECH", "P2P Global Bible Study Network": unchanged
- Emoji: unchanged
- \\n in strings: unchanged
- Use standard Bible/Christian terminology in ${langName}
- Output ONLY the JSON object

${JSON.stringify(enObj, null, 2)}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content?.trim() ?? "";
  // Try direct parse first, then extract JSON block
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON found. Response preview: ${text.slice(0, 200)}`);
    return JSON.parse(match[0]);
  }
}

async function run() {
  const toProcess = MISSING.filter(({ code }) => !fs.existsSync(path.join(LOCALES_DIR, `${code}.json`)));
  console.log(`Processing ${toProcess.length} missing languages...`);

  for (const { code, name } of toProcess) {
    try {
      console.log(`⏳ ${name} (${code})...`);
      const translated = await translateTo(code, name, enJson);
      fs.writeFileSync(path.join(LOCALES_DIR, `${code}.json`), JSON.stringify(translated, null, 2) + "\n");
      console.log(`✓  ${name} (${code})`);
    } catch (e) {
      console.error(`✗  ${name} (${code}): ${e.message}`);
    }
  }
  console.log("Done!");
}

run();
