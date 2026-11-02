// My Discipleship Journal — Personal Reflections from Kingdom School lessons
// and Kingdom Stories chapters (lib/journalReflections.ts), against an
// in-memory Supabase: only the reader's own answers, the latest per question,
// labelled by where they were written, opening that lesson / chapter; voice
// answers described; the Journal screen shows and filters them. Also the
// Bible reader's one-line book/chapter title.
// Run: node tests/journalReflections.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const load = (rel) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({}), console, Map, Set, Array, Promise, Math, String });
  return mod.exports;
};

// In-memory Supabase (select / eq / in / not-is-null / order / limit).
const T = {
  p2p_submissions: [
    { id: "s1", user_id: "me", lesson_id: "L1", reflection_question_id: "q1", submission_type: "text", text_content: "Old answer", duration_seconds: null, created_at: "2026-10-01T10:00:00Z" },
    { id: "s2", user_id: "me", lesson_id: "L1", reflection_question_id: "q1", submission_type: "text", text_content: "  God made me on purpose.  ", duration_seconds: null, created_at: "2026-10-05T10:00:00Z" },
    { id: "s3", user_id: "me", lesson_id: "L2", reflection_question_id: "q2", submission_type: "audio", text_content: null, duration_seconds: 83, created_at: "2026-10-06T10:00:00Z" },
    { id: "s4", user_id: "me", lesson_id: "L1", reflection_question_id: null, assignment_question_id: "a1", submission_type: "text", text_content: "check answer", created_at: "2026-10-07T10:00:00Z" },
    { id: "s5", user_id: "someone-else", lesson_id: "L1", reflection_question_id: "q1", submission_type: "text", text_content: "not mine", created_at: "2026-10-08T10:00:00Z" },
  ],
  p2p_reflection_questions: [{ id: "q1", question: "How does being made in God's image change how you see yourself?" }, { id: "q2", question: "What did Noah's obedience cost him?" }],
  p2p_lessons: [{ id: "L1", title: "Dead in Trespasses and Sins", module_id: "M1" }, { id: "L2", title: "Chapter lesson", module_id: "M2" }],
  p2p_modules: [{ id: "M1", curriculum_id: "C1" }, { id: "M2", curriculum_id: "CS" }],
  p2p_curriculums: [{ id: "C1", title: "The Gospel & Salvation", type: "core" }, { id: "CS", title: "Kingdom Stories (system)", type: "kingdom_story" }],
  p2p_kingdom_story_chapters: [{ lesson_id: "L2", id: "CH2", story_id: "ST1", chapter_number: 2, title: "The Ark" }],
  p2p_kingdom_stories: [{ id: "ST1", title: "Noah and the Flood" }],
};
const db = { from(t) {
  const f = []; let lim = null, desc = false;
  const c = {
    select() { return c; }, eq(k, v) { f.push((r) => r[k] === v); return c; }, in(k, v) { f.push((r) => v.includes(r[k])); return c; },
    not(k, op, v) { f.push((r) => r[k] !== null && r[k] !== undefined); return c; }, order(_k, o) { desc = o?.ascending === false; return c; }, limit(n) { lim = n; return c; },
    then(res) { let rows = (T[t] ?? []).filter((r) => f.every((g) => g(r))); if (desc) rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)); if (lim) rows = rows.slice(0, lim); res({ data: rows, error: null }); },
  };
  return c;
} };

const J = load("lib/journalReflections.ts");
const entries = await J.getLessonReflectionEntries(db, "me");
ok("only my Personal Reflection answers (not other people's, not check answers), latest per question", entries.length === 2 && entries.every((e) => e.type === "lesson_reflection"), JSON.stringify(entries.map((e) => e.id)));
const school = entries.find((e) => e.id === "s2");
ok("Kingdom School answer: label, course · lesson, question, trimmed answer, opens the lesson",
  school && school.label === "Kingdom School" && school.title === "The Gospel & Salvation · Dead in Trespasses and Sins" && school.prompt.startsWith("How does being made")
  && school.preview === "God made me on purpose." && school.route.pathname === "/lesson/[id]" && school.route.params.id === "L1", JSON.stringify(school));
const story = entries.find((e) => e.id === "s3");
ok("Kingdom Stories answer: story · chapter, voice answer described, opens the chapter",
  story && story.label === "Kingdom Stories" && story.title === "Noah and the Flood · Chapter 2" && story.preview === "🎙 Voice reflection (1:23)"
  && story.route.pathname === "/kingdom-stories/chapter" && story.route.params.id === "ST1" && story.route.params.chapter === "CH2", JSON.stringify(story));
ok("no answers → nothing (and no lookups needed)", (await J.getLessonReflectionEntries(db, "nobody")).length === 0);
const failing = { from() { const c = { select: () => c, eq: () => c, not: () => c, order: () => c, limit: () => c, then: (res) => res({ data: null, error: { message: "x" } }) }; return c; } };
ok("a failed read never breaks the Journal", (await J.getLessonReflectionEntries(failing, "me")).length === 0);

// Wiring
const dc = src("contexts/DataContext.tsx");
ok("the Journal timeline includes them", dc.includes("await getLessonReflectionEntries(supabase, profile.id)") && dc.includes("...reflectionEntries, ...lessonReflectionEntries]"));
const screen = src("app/my-discipleship/journal.tsx");
ok("Journal: 'Reflections' shows all reflections; 'Lessons & Stories' shows these answers", screen.includes('filter === "reflection" ? timeline.filter((e) => e.type === "reflection" || e.type === "lesson_reflection")') && screen.includes('{ key: "lesson_reflection", label: "Lessons & Stories" }'));
ok("Journal: shows where it was written and the question; opens the lesson or chapter", screen.includes("entry.label ? `${entry.label} · ${TYPE_LABEL[entry.type]}`") && screen.includes("{entry.prompt ? <Text style={s.entryPrompt}") && screen.includes("if (entry.route) { router.push(entry.route as any); return; }"));
ok("My P2P journal card names them too", src("components/myp2p/MyP2PWidgets.tsx").includes('lesson_reflection: latest.label ? `${latest.label} reflection` : "Personal Reflection"'));

// Bible reader: book + chapter on one line at any width
const bible = src("app/bible/index.tsx");
ok("Bible title: one line, shrinks then shortens — never breaks mid-word; chapter always shown",
  bible.includes('numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{book ? book.name : "Bible"}</Text>') && bible.includes("{book ? <Text style={styles.refText} numberOfLines={1}>{` ${loc?.chapter}`}</Text> : null}")
  && !bible.includes("<AppButton label={book ? `${book.name} ${loc?.chapter}` : \"Bible\"}"));

ok("Bible text fills the screen at every size (no narrow column); margins grow with the screen; compare uses the full width",
  !/scroll: \{[^}]*maxWidth/.test(bible) && bible.includes("const sidePad = screenWidth >= 1024 ? 48 : screenWidth >= 768 ? 36 : 22;")
  && (bible.match(/contentContainerStyle=\{\[styles\.scroll, fullWidth,/g) ?? []).length === 2 && bible.includes("width={screenWidth - 2 * sidePad - insets.left - insets.right}"));

console.log(`journalReflections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
