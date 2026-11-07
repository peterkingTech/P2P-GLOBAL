// Kingdom Stories narration generator (ElevenLabs Eleven v4). Server-side only.
//
//   ELEVENLABS_API_KEY=… node scripts/narrate.mjs --script narration/scripts/creation [--chapters 1,2] [--upload]
//
// For each chapter:
//   1. reads what the app's Listen player speaks for it — the app's own chapterListenSections over the
//      live chapter, reflections and Comprehensive Check (read-only; api-server/.env service role);
//   2. reads the performance script (narration/scripts/<story>/chapter-N.txt: "### <partKey>" then the
//      text with ElevenLabs audio tags) and REFUSES to continue unless every part is scripted and its
//      words — tags, pauses and capitals aside — are exactly the words on screen (highlighting stays
//      exact; Scripture is never reworded);
//   3. generates the audio in blocks (one narrator: narration/config.json), caching every block by a
//      hash of everything that shapes it (narration/.cache) — nothing is ever generated twice;
//   4. joins the blocks into one MP3 (headers stripped), aligns it to the chapter's text with ElevenLabs
//      forced alignment, and writes <chapterId>.mp3 + <chapterId>.json (word timings) to
//      narration/out/<storyId>/;
//   5. --upload: puts both in Supabase Storage at kingdom-stories-media/<storyId>/narration/ (needs
//      migration 242, which lets that bucket hold audio and JSON).
//
// The key is read from the environment and never printed. Nothing here runs in the app.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE = path.resolve(API, "../mobile");
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const scriptDir = path.resolve(API, arg("--script") ?? "");
const onlyChapters = arg("--chapters")?.split(",").map(Number) ?? null;
const upload = process.argv.includes("--upload");
const dryRun = process.argv.includes("--dry-run");
const config = JSON.parse(readFileSync(path.join(API, "narration/config.json"), "utf8"));
// Language: scripts in <story>/<lang>/, one narrator per language, files under …/narration/<lang>/.
// English scripts carry the screen's own words (checked word for word); other languages are cached,
// reviewed translations of every part (checked for completeness) — never retranslated.
const lang = arg("--lang") ?? "en";
const L = config.languages[lang];
if (!L) throw new Error(`no narrator configured for language "${lang}" (narration/config.json)`);
const voice = L.voice;
const CACHE = path.join(API, "narration/.cache");
mkdirSync(CACHE, { recursive: true });

for (const line of readFileSync(path.join(API, ".env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const XI = process.env.ELEVENLABS_API_KEY;
if (!XI && !dryRun) throw new Error("ELEVENLABS_API_KEY is not set");
const SB = process.env.SUPABASE_URL, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sbHeaders = { apikey: SR, authorization: `Bearer ${SR}` };
const rest = async (q) => {
  const r = await fetch(`${SB}/rest/v1/${q}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`database ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
};

// ── What the app speaks (its own code, so the two can never drift apart) ──────
const req = createRequire(path.join(MOBILE, "package.json"));
const ts = req("typescript");
const load = (f, mocks = {}) => {
  const js = ts.transpileModule(readFileSync(path.join(MOBILE, f), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${f}`); } });
  return mod.exports;
};
const labelsMod = load("lib/listen/labels.ts");
const storybook = load("lib/storybook.ts", { "@/lib/bibleReaderApi": { readerTarget: () => null }, "@/lib/listen/lessonContent": load("lib/listen/lessonContent.ts", { "./labels": labelsMod }), "@/lib/listen/labels": labelsMod });
const terms = load("lib/terminology.ts");
const en = JSON.parse(readFileSync(path.join(MOBILE, "locales/en.json"), "utf8"));
const labels = labelsMod.labelsFrom((k) => k.split(".").reduce((o, p) => o?.[p], en));

async function spokenChapters(storyId) {
  const [story] = await rest(`p2p_kingdom_stories?select=id,title&id=eq.${storyId}`);
  if (!story) throw new Error(`story ${storyId} not found`);
  const chapters = await rest(`p2p_kingdom_story_chapters?select=id,chapter_number,title,narrative,lessons,reflections,assignment,lesson_id&story_id=eq.${storyId}&order=chapter_number.asc`);
  const ids = chapters.map((c) => c.lesson_id).filter(Boolean);
  const list = (x) => `(${x.join(",")})`;
  const rq = ids.length ? await rest(`p2p_reflection_questions?select=id,lesson_id,question,display_order&lesson_id=in.${list(ids)}&order=display_order.asc`) : [];
  const asg = ids.length ? await rest(`p2p_assignments?select=id,lesson_id,title&lesson_id=in.${list(ids)}`) : [];
  const aqs = asg.length ? await rest(`p2p_assignment_questions?select=id,assignment_id,question,display_order&assignment_id=in.${list(asg.map((a) => a.id))}&order=display_order.asc`) : [];
  return chapters.map((c) => {
    const reflections = rq.filter((r) => r.lesson_id === c.lesson_id).map((r) => ({ id: r.id, question: r.question }));
    const a = asg.find((x) => x.lesson_id === c.lesson_id);
    const check = a ? { title: terms.checkTitle(a.title || "Comprehensive Check"), questions: aqs.filter((q) => q.assignment_id === a.id).map((q) => ({ id: q.id, question: q.question })) }
      : c.assignment ? { title: terms.COMPREHENSIVE_CHECK, questions: [{ id: "check", question: c.assignment }] } : null;
    const sections = storybook.chapterListenSections({ chapterNumber: c.chapter_number, title: c.title, narrative: c.narrative, lessons: c.lessons ?? [] },
      { reflections: reflections.length ? reflections : (c.reflections ?? []).map((q, k) => ({ id: `r${k}`, question: q })), check }, labels, story.title);
    return { id: c.id, number: c.chapter_number, sections };
  });
}

// ── Scripts ────────────────────────────────────────────────────────────────
const TAG = /\[([^\]]+)\]/g;
const normWord = (w) => w.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const wordsOf = (t) => t.replace(TAG, " ").split(/[\s—–-]+/).map(normWord).filter(Boolean);
const withAliases = (t) => t.replace(TAG, (_, inner) => `[${inner.split(/\]\s*\[/).map((x) => config.tagAliases[x.trim()] ?? x.trim()).join("")}]`);
function readScript(file) {
  const parts = new Map();
  let key = null;
  for (const line of readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^### (.+)$/);
    if (m) { key = m[1].trim(); parts.set(key, []); } else if (key) parts.get(key).push(line);
  }
  return new Map([...parts].map(([k, v]) => [k, v.join("\n").trim()]));
}
function checkScript(chapter, script) {
  const problems = [];
  for (const s of chapter.sections) for (const p of s.parts) {
    const t = script.get(p.key);
    if (t == null) { problems.push(`missing part ${p.key}`); continue; }
    const a = wordsOf(p.text).join(" "), b = wordsOf(t).join(" ");
    if (a !== b) {
      const i = [...a].findIndex((ch, k) => ch !== b[k]);
      problems.push(`words differ in ${p.key} near "…${a.slice(Math.max(0, i - 25), i + 25)}…" vs "…${b.slice(Math.max(0, i - 25), i + 25)}…"`);
    }
  }
  if (lang !== "en") return problems.filter((x) => x.startsWith("missing")).concat(
    [...script].filter(([, t]) => !t.replace(TAG, "").trim()).map(([k]) => `empty translation for ${k}`),
    [...script.keys()].filter((k) => !chapter.sections.some((s) => s.parts.some((p) => p.key === k))).map((k) => `script has an unknown part ${k} (the chapter changed?)`));
  const known = new Set(chapter.sections.flatMap((s) => s.parts.map((p) => p.key)));
  for (const k of script.keys()) if (!known.has(k)) problems.push(`script has an unknown part ${k} (the chapter changed?)`);
  return problems;
}

// ── ElevenLabs ─────────────────────────────────────────────────────────────
let contextSupported = true;
async function tts(text, previousText) {
  const body = { text, model_id: config.modelId, language_code: lang, voice_settings: config.voiceSettings };
  const key = createHash("sha256").update(JSON.stringify({ body, voice: voice.id, format: config.outputFormat, previousText: previousText ?? null })).digest("hex");
  const file = path.join(CACHE, `${key}.mp3`);
  if (existsSync(file)) return { audio: readFileSync(file), cached: true };
  const call = (withContext) => fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=${config.outputFormat}`, {
    method: "POST", headers: { "xi-api-key": XI, "content-type": "application/json" },
    body: JSON.stringify(withContext && previousText ? { ...body, previous_text: previousText } : body),
  });
  let r = await call(contextSupported);
  if (r.status === 400 && contextSupported && previousText) { contextSupported = false; r = await call(false); }
  if (!r.ok) throw new Error(`ElevenLabs text-to-speech ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const audio = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, audio);
  return { audio, cached: false };
}
async function align(audio, transcript) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/mpeg" }), "chapter.mp3");
  form.append("text", transcript);
  const r = await fetch("https://api.elevenlabs.io/v1/forced-alignment", { method: "POST", headers: { "xi-api-key": XI }, body: form });
  if (!r.ok) throw new Error(`ElevenLabs forced alignment ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// MP3 frames only: drop the ID3 tag and the "Info"/"Xing" header frame each file starts with, so the
// joined file is one plain constant-bitrate stream (correct length and seeking everywhere).
const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
function framesOnly(buf) {
  let i = 0;
  if (buf.subarray(0, 3).toString("latin1") === "ID3") i = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  while (i < buf.length - 4 && !(buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0)) i++;
  const br = BITRATES[buf[i + 2] >> 4] * 1000, sr = [44100, 48000, 32000][(buf[i + 2] >> 2) & 3], pad = (buf[i + 2] >> 1) & 1;
  const len = Math.floor((144 * br) / sr) + pad;
  const head = buf.subarray(i, i + len).toString("latin1");
  return head.includes("Info") || head.includes("Xing") ? buf.subarray(i + len) : buf.subarray(i);
}

// ── Storage ────────────────────────────────────────────────────────────────
async function put(objectPath, data, contentType) {
  const r = await fetch(`${SB}/storage/v1/object/kingdom-stories-media/${objectPath}`, {
    method: "POST", headers: { ...sbHeaders, "content-type": contentType, "x-upsert": "true", "cache-control": "3600" }, body: data,
  });
  if (!r.ok) throw new Error(`storage upload ${objectPath} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// The chapter's translation into the shared translation store (p2p_content_translations, migration 243):
// content_type kingdom_story_chapter, every part in metadata.parts. Created as a draft for review; a
// later run updates the text only — it never changes a status a reviewer has set.
async function saveTranslation(ch, parts) {
  const title = (parts.find((p) => p.key === "title")?.text ?? "").replace(/^[^:]*\d+:\s*/, "").replace(/\.$/, "");
  const row = {
    title, body: parts.filter((p) => /^p\d+$/.test(p.key)).map((p) => p.text).join("\n\n"),
    metadata: { source: "narration-script", scriptFile: `narration/scripts/${path.basename(scriptDir)}/${lang}/chapter-${ch.number}.txt`, parts },
    translated_at: new Date().toISOString(),
  };
  const q = `content_type=eq.kingdom_story_chapter&content_id=eq.${ch.id}&language_code=eq.${lang}`;
  const existing = await rest(`p2p_content_translations?select=id,status&${q}`);
  const r = existing.length
    ? await fetch(`${SB}/rest/v1/p2p_content_translations?${q}`, { method: "PATCH", headers: { ...sbHeaders, "content-type": "application/json" }, body: JSON.stringify(row) })
    : await fetch(`${SB}/rest/v1/p2p_content_translations`, { method: "POST", headers: { ...sbHeaders, "content-type": "application/json" },
        body: JSON.stringify({ ...row, content_type: "kingdom_story_chapter", content_id: ch.id, language_code: lang, status: "draft" }) });
  if (!r.ok) throw new Error(`translation save ${ch.number} ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// ── Run ────────────────────────────────────────────────────────────────────
const meta = JSON.parse(readFileSync(path.join(scriptDir, "story.json"), "utf8"));
const chapters = await spokenChapters(meta.storyId);
const langDir = path.join(scriptDir, lang);
const files = existsSync(langDir) ? readdirSync(langDir).filter((f) => /^chapter-\d+\.txt$/.test(f)) : [];
const outDir = path.join(API, "narration/out", meta.storyId, lang);
mkdirSync(outDir, { recursive: true });
for (const ch of chapters) {
  if (onlyChapters && !onlyChapters.includes(ch.number)) continue;
  if (!files.includes(`chapter-${ch.number}.txt`)) { console.log(`chapter ${ch.number}: no script yet — skipped`); continue; }
  const script = readScript(path.join(langDir, `chapter-${ch.number}.txt`));
  const problems = checkScript(ch, script);
  if (problems.length) { console.log(`chapter ${ch.number}: NOT generated —\n  ${problems.join("\n  ")}`); process.exitCode = 1; continue; }

  // Blocks: consecutive parts of one section, up to blockMaxChars, so delivery flows naturally.
  // Each part as it will be shown in this language: the screen's own text (English) or its translation.
  const shown = (p) => (lang === "en" ? p.text : script.get(p.key).replace(TAG, "").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim());
  const blocks = [];
  for (const s of ch.sections) {
    let cur = null;
    for (const p of s.parts) {
      const t = withAliases(script.get(p.key));
      if (cur && cur.text.length + t.length + 2 <= config.blockMaxChars) { cur.text += `\n\n${t}`; cur.plain += `\n\n${shown(p)}`; }
      else { cur = { text: t, plain: shown(p) }; blocks.push(cur); }
    }
  }
  if (dryRun) { console.log(`chapter ${ch.number}: script OK — ${blocks.length} blocks, ${blocks.reduce((n, b) => n + b.text.length, 0)} characters to generate`); continue; }
  const audio = [];
  let fresh = 0, chars = 0;
  for (const [i, b] of blocks.entries()) {
    const { audio: a, cached } = await tts(b.text, i ? blocks[i - 1].plain.slice(-400) : undefined);
    audio.push(framesOnly(a));
    if (!cached) { fresh++; chars += b.text.length; }
  }
  const mp3 = Buffer.concat(audio);
  const transcript = blocks.map((b) => b.plain).join("\n\n");
  const al = await align(mp3, transcript);
  const words = (al.words ?? []).flatMap((x) => x.text.split(/[—–-]+/).map((t) => ({ ...x, text: t }))).filter((x) => normWord(x.text));
  const manifest = {
    version: 2, storyId: meta.storyId, chapterId: ch.id, chapterNumber: ch.number, language: lang,
    voice: { id: voice.id, name: voice.name }, model: config.modelId, file: `${ch.id}.mp3`, createdAt: new Date().toISOString(),
    // The chapter as shown in this language, part by part (the cached translation, for the reader).
    parts: ch.sections.flatMap((s) => s.parts.map((p) => ({ section: s.id, key: p.key, text: shown(p) }))),
    words: words.map((x) => normWord(x.text)).join(" "), starts: words.map((x) => Math.round(x.start * 100)), ends: words.map((x) => Math.round(x.end * 100)),
  };
  writeFileSync(path.join(outDir, `${ch.id}.mp3`), mp3);
  writeFileSync(path.join(outDir, `${ch.id}.json`), JSON.stringify(manifest));
  if (upload) {
    await put(`${meta.storyId}/narration/${lang}/${ch.id}.mp3`, mp3, "audio/mpeg");
    await put(`${meta.storyId}/narration/${lang}/${ch.id}.json`, JSON.stringify(manifest), "application/json");
    if (lang !== "en") await saveTranslation(ch, manifest.parts);
  }
  console.log(`chapter ${ch.number}: ${blocks.length} blocks (${fresh} new, ${chars} characters), ${Math.round(words.at(-1)?.end ?? 0)} s, alignment loss ${al.loss?.toFixed?.(2)}${upload ? ", uploaded" : ""}${contextSupported ? "" : " (previous_text not accepted — sent without)"}`);
}
