// Kingdom Stories in the reader's content language (lib/kingdomStoryTranslations.ts + routes/kingdomStories.ts):
//   • an approved translation replaces title, story text, Story Lessons, Personal Reflections and the
//     Comprehensive Check, part by part; whatever isn't translated stays English;
//   • a short English sub-heading keeps its colon (still set as a heading);
//   • only APPROVED translations are read; English needs no lookup; a locked chapter gets its title only;
//   • the language comes from ?lang= or the reader's saved content language.
// Run: node tests/kingdomStoryTranslations.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = path.join(root, "tests", `.tmp-kst-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const queries = [];
globalThis.__kst = {
  from(table) {
    const q = { table, f: [] };
    const c = { select: () => c, eq: (k, v) => { q.f.push([k, v]); return c; }, in: (k, v) => { q.f.push([k, v]); return c; },
      maybeSingle: async () => { queries.push(q); return { data: { title: "Titel", subtitle: "Untertitel", body: "Text" } }; },
      then: (res) => { queries.push(q); res({ data: [{ content_id: "C1", metadata: { parts: [{ key: "title", text: "Kapitel 1: Titel." }] } }] }); } };
    return c;
  },
};
try {
  const out = await build({ entryPoints: [path.join(root, "src/lib/kingdomStoryTranslations.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "m", setup(b) { b.onResolve({ filter: /\/supabase$/ }, () => ({ path: "s", namespace: "m" })); b.onLoad({ filter: /.*/, namespace: "m" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__kst;" })); } }] });
  const f = path.join(tmp, "t.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const T = await import(pathToFileURL(f).href);

  const en = {
    id: "C1", title: "Light", narrative: "In the beginning.\n\nFinal reflection questions:\n\nNot translated here.",
    lessons: ["Lesson one text.", "Lesson two text."], reflections: [],
    learning: { state: "available", reflectionQuestions: [{ id: "R1", question: "What?" }, { id: "R2", question: "Why?" }],
      check: { title: "Comprehensive Check", questions: [{ id: "Q1", question: "1. First?" }] } },
  };
  const parts = [
    { key: "story", text: "Die Schöpfung: Der Anfang von allem." }, { key: "title", text: "Kapitel 2: Licht, Himmel, Land und Meere." },
    { key: "p0", text: "Im Anfang." }, { key: "p1", text: "Abschließende Fragen zum Nachdenken" }, { key: "p2", text: "Hier übersetzt." },
    { key: "lesson0", text: "Lektion 1. Erste Lektion." },
    { key: "reflection:R1", text: "Frage 1. Was?" },
    { key: "check:label", text: "Umfassende Lernkontrolle." }, { key: "check:Q1", text: "Frage 1. 1. Erstens?" },
  ];
  const g = T.translateChapter(en, parts);
  ok("title without its spoken label", g.title === "Licht, Himmel, Land und Meere");
  ok("story text paragraph by paragraph; an English sub-heading keeps its colon", g.narrative === "Im Anfang.\n\nAbschließende Fragen zum Nachdenken:\n\nHier übersetzt.");
  ok("Story Lessons translated where given, English otherwise", g.lessons[0] === "Erste Lektion." && g.lessons[1] === "Lesson two text.");
  ok("Personal Reflections by question id; untranslated stays English", g.learning.reflectionQuestions[0].question === "Was?" && g.learning.reflectionQuestions[1].question === "Why?" && g.learning.reflectionQuestions[0].id === "R1");
  ok("Comprehensive Check title and questions", g.learning.check.title === "Umfassende Lernkontrolle" && g.learning.check.questions[0].question === "1. Erstens?" && g.learning.check.questions[0].id === "Q1");
  ok("learning state and ids untouched (answers and progress stay linked)", g.learning.state === "available" && g.id === "C1");
  ok("story text left English if any paragraph is untranslated (never half and half)", T.translateChapter(en, parts.filter((p) => p.key !== "p2")).narrative === en.narrative);
  ok("the story's title in that language", T.translatedStoryTitle(new Map([["C1", parts]])) === "Die Schöpfung: Der Anfang von allem");
  ok("the English original is not modified", en.title === "Light" && en.learning.check.title === "Comprehensive Check");

  const none = await T.approvedChapterTranslations(["C1"], "en");
  ok("English: no lookup at all", none.size === 0 && queries.length === 0);
  const got = await T.approvedChapterTranslations(["C1"], "de");
  ok("German: only APPROVED translations of these chapters are read", got.size === 1 && queries.length === 1
    && JSON.stringify(queries[0].f) === JSON.stringify([["content_type", "kingdom_story_chapter"], ["language_code", "de"], ["status", "approved"], ["content_id", ["C1"]]]));
  ok("a nonsense language → nothing", (await T.approvedChapterTranslations(["C1"], "../x")).size === 0);

  const route = readFileSync(path.join(root, "src/routes/kingdomStories.ts"), "utf8");
  ok("route: ?lang= first, then the reader's saved content language (never select * on profiles)", route.includes('select("content_language")') && route.includes("if (LANG_RE.test(q)) return q;"));
  ok("route: a locked chapter gets only its translated title", route.includes('parts.filter((p: { key: string }) => p.key === "title")'));
  ok("route: says which language the story and its introduction came back in", route.includes('contentLanguage: translations.size || storyTr ? lang : "en"') && route.includes('introLanguage: storyTr?.body ? lang : "en"'));
  ok("route: the story's approved translation gives its title, subtitle and introduction", route.includes("approvedStoryTranslation(story.id as string, lang)") && route.includes("...(storyTr?.subtitle ? { subtitle: storyTr.subtitle } : {}), ...(storyTr?.body ? { body: storyTr.body } : {}),"));
  ok("route: the introduction's narration is served ('intro'), under the story's own access rule", route.includes('const intro = req.params.chapterId === "intro";') && readFileSync(path.join(root, "src/lib/storyNarration.ts"), "utf8").includes('chapterId === "intro"'));
  const st = await T.approvedStoryTranslation("S1", "de");
  ok("story translation: only the APPROVED kingdom_story row for this story", JSON.stringify(queries.at(-1).f) === JSON.stringify([["content_type", "kingdom_story"], ["language_code", "de"], ["status", "approved"], ["content_id", "S1"]]) && (await T.approvedStoryTranslation("S1", "en")) === null);
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`kingdomStoryTranslations: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
