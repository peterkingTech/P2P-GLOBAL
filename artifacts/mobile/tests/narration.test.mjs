// Studio narration for Kingdom Stories (lib/listen/narration.ts, lib/listen/index.ts, the chapter screen,
// api-server routes/kingdomStories.ts + lib/storyNarration.ts + scripts/narrate.mjs):
//   • the app gets each chapter's recording + word timings from the API (never generated on the phone);
//   • each sentence the player sends is found in the recording by its words, moving forward, so a
//     repeated phrase plays its next occurrence; a sentence the recording lacks → the phone's voice;
//   • the engine passes the displayed text + the content's narration to the driver (additive);
//   • consecutive sentences continue without a seek; never stuck; a recording that won't play →
//     the phone's voice (not silence);
//   • the API follows the chapter's own access rule; the generator refuses scripts whose words
//     differ from the screen, reads the key from the environment and caches every block.
// Run: node tests/narration.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = path.resolve(root, "../api-server");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
const apiSrc = (f) => readFileSync(path.join(api, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const js = ts.transpileModule(src("lib/listen/narration.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
let calls = 0;
vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, Map, require: (n) => {
  if (n === "@/lib/kingdomStoriesApi") return { getChapterNarration: async () => { calls++; return { narration: DATA }; } };
  throw new Error(`unexpected require ${n}`);
} });
const N = mod.exports;

// A recording of: "Creation: The Beginning of Everything. But God was there. Everything begins with God. ... God."
const words = "creation the beginning of everything but god was there everything begins with god and at the beginning there is god".split(" ");
const DATA = { url: "https://x/a.mp3", voice: "Jon", model: "eleven_v4", createdAt: "", words: words.join(" "), starts: words.map((_, i) => i * 50), ends: words.map((_, i) => i * 50 + 40) };
const n = N.fromData(DATA);

ok("data: accepted only when words and timings line up", n && n.words.length === 20 && N.fromData({ ...DATA, starts: DATA.starts.slice(1) }) === null && N.fromData(null) === null);
const first = N.segmentFor(n, "Creation: The Beginning of Everything.");
ok("the title is found at the start", first && first.firstWord === 0 && first.start === 0 && first.end === 2.4);
const god = N.segmentFor(n, "But God was there.");
ok("a sentence maps to its own stretch (seconds)", god && god.firstWord === 5 && god.lastWord === 8 && god.start === 2.5 && god.end === 4.4);
ok("punctuation, case, curly quotes and dashes don't matter", JSON.stringify(N.segmentFor(n, "but GOD — was there!")) === JSON.stringify(god));
const begins = N.segmentFor(n, "Everything begins with God.");
ok("moving forward: from after a phrase, a repeated word resolves to its next occurrence", begins.lastWord === 12 && N.segmentFor(n, "God", begins.lastWord + 1).firstWord === 19);
ok("a sentence the recording doesn't contain → null (the phone's voice reads it)", N.segmentFor(n, "Write your own answer.") === null && N.segmentFor(n, "") === null);
await N.loadNarration("s", "c"); await N.loadNarration("s", "c");
ok("loaded once per chapter per session", calls === 1);

// App wiring
const engine = src("lib/listen/engine.ts"), index = src("lib/listen/index.ts"), chapter = src("app/kingdom-stories/chapter.tsx"), client = src("lib/kingdomStoriesApi.ts");
ok("engine: passes the displayed text and the content's narration to the driver", engine.includes("source: content.sections[c.section]?.parts[c.part]?.text.slice(c.start, c.end),") && engine.includes("narration: content.narration,"));
ok("driver: the phone's voice when there's no recording, no match, a broken recording, or any failure", index.includes("if (!n || !seg) { recStop(true); return deviceSpeech.speak(text, o); }") && index.includes("recBroken.add(n.url); recStop(true); deviceSpeech.speak(text, o);") && /catch \{\s*recStop\(true\);\s*deviceSpeech\.speak\(text, o\);/.test(index));
ok("driver: consecutive sentences carry on without a seek; never stuck", index.includes("const contiguous = p.playing") && index.includes("recPause = setTimeout(") && index.includes("setTimeout(finish, ((seg.end - seg.start)"));
ok("driver: one player, replaced (and the cursor reset) when the recording changes", index.includes("recPlayer?.remove();") && index.includes("recCursor = 0;"));
ok("chapter: narration loaded for this chapter and its neighbours; Listen waits briefly, then the phone's voice", chapter.includes("for (const t of [prev, ch, next])") && chapter.includes("setTimeout(() => r(null), 3000)") && chapter.includes("narration: narrations.current.get(`${storyLang}:${target.id}`) ?? undefined,")
  && chapter.includes("loadNarration(story.id, target.id, storyLang)"));
ok("client: the API route, in the chapter's language", client.includes("`/kingdom-stories/${storyId}/chapters/${chapterId}/narration?lang=${encodeURIComponent(lang)}`"));
ok("content language: the story and its chapters are requested and cached per content language", chapter.includes("getKingdomStory(id, lang)") && chapter.includes("qk.story(id, lang)")
  && src("app/kingdom-stories/[id].tsx").includes("getKingdomStory(id, lang)") && src("lib/query.ts").includes('story: (id: string, lang: string = "en")'));
ok("introduction: in its own language, with its studio narration ('intro'), else the phone's voice", src("app/kingdom-stories/[id].tsx").includes('loadNarration(story.id, "intro", introLang)')
  && src("app/kingdom-stories/[id].tsx").includes("narration: introNarration.current?.n ?? undefined,") && src("app/kingdom-stories/[id].tsx").includes("language: introLang,"));
ok("content language: German check label matches the narration", JSON.parse(src("locales/de.json")).lesson.assignment === "Umfassende Lernkontrolle");
ok("no ElevenLabs key or call in the app", !/api\.elevenlabs\.io|xi-api-key|ELEVENLABS_API_KEY/i.test(index + chapter + client + src("lib/listen/narration.ts")));

// API + generator
const route = apiSrc("src/routes/kingdomStories.ts"), lib = apiSrc("src/lib/storyNarration.ts"), gen = apiSrc("scripts/narrate.mjs"), cfg = JSON.parse(apiSrc("narration/config.json"));
ok("API: signed in; published story or editor; a locked chapter gets no narration (the database's own rule)", route.includes('router.get("/:id/chapters/:chapterId/narration"') && route.includes('db.rpc("p2p_kingdom_story_chapter_open"') && route.includes("if (open !== true) return ok(res, { narration: null });"));
ok("API: private storage, signed links; a local folder for development", lib.includes('const BUCKET = "kingdom-stories-media"') && lib.includes("createSignedUrl(") && lib.includes("process.env.NARRATION_LOCAL_DIR"));
ok("generator: key from the environment only, never printed", gen.includes("process.env.ELEVENLABS_API_KEY") && !/console\.log\([^)]*XI\b/.test(gen));
ok("generator: refuses a script whose words differ from the screen", gen.includes("words differ in") && gen.includes("NOT generated"));
ok("generator: every block cached by a hash of what shapes it (never regenerated)", gen.includes("createHash(\"sha256\")") && gen.includes("if (existsSync(file)) return { audio: readFileSync(file), cached: true };"));
ok("generator: one narrator per language (English Jon, native German Alexander) and the expressive model", cfg.modelId === "eleven_v4"
  && Object.values(cfg.languages).every((l) => /^[A-Za-z0-9]{20}$/.test(l.voice.id)) && cfg.languages.en.voice.short === "Jon" && cfg.languages.de.voice.short === "Alexander");
ok("generator: files per language (scripts, output, storage); English words checked against the screen, translations for completeness", gen.includes("path.join(scriptDir, lang)") && gen.includes("narration/${lang}/${ch.id}.mp3") && gen.includes('if (lang !== "en")'));
ok("scripts: Topic 1 (Creation) has all six chapters in English and German", ["en", "de"].every((l) => [1, 2, 3, 4, 5, 6].every((k) => apiSrc(`narration/scripts/creation/${l}/chapter-${k}.txt`).includes("### check:label"))));
ok("API: narration per language (?lang=), English still served from the first upload's place", route.includes("req.query.lang") && lib.includes('const dirs = lang === "en" ? [`${lang}/`, ""] : [`${lang}/`];'));

console.log(`narration (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
