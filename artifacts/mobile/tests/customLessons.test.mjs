// Custom lesson authoring — app side.
//   lib/customLessonModel.ts — real module code (form ⇄ payload, legacy reads).
//   components/study/CustomLessonEditor.tsx, CustomLessonSection.tsx,
//   CustomLessonViewer.tsx and both study screens — source checks.
// Server rules (drafts, publish, archive-not-delete, versions, permissions,
// isolation) are tested on the real routes: scripts/studio-db-test/custom-lessons.mjs.
// Run: node tests/customLessons.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const js = ts.transpileModule(src("lib/customLessonModel.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Number, String, JSON });
const M = mod.exports;

// ── Model ────────────────────────────────────────────────────────────────
const blank = M.lessonToForm(null);
ok("new lesson: one empty passage, one empty discussion question", blank.passages.length === 1 && blank.questions.length === 1 && blank.questions[0].kind === "discussion");
ok("only the title is required", M.formToInput(blank) === "Give the lesson a title." && typeof M.formToInput({ ...blank, title: "T" }) === "object");
const legacy = { id: "l1", studyId: "s", title: "Old", description: null, scriptureReferences: [{ book: "John", chapter: 3, startVerse: 16 }], teachingMaterial: null,
  questions: ["Plain old question", { id: "q-2", text: "Reflect", kind: "reflection" }], prayerFocus: null, media: { provider: "youtube", id: "dQw4w9WgXcQ", url: null }, orderIndex: 0, createdAt: "", updatedAt: "" };
const f = M.lessonToForm(legacy);
ok("legacy plain-string questions read as discussion; ids/kinds kept", f.questions[0].text === "Plain old question" && f.questions[0].kind === "discussion" && f.questions[1].id === "q-2" && f.questions[1].kind === "reflection");
ok("passage end verse defaults to the start verse", f.passages[0].endVerse === "16");
const input = M.formToInput({ ...f, title: " Old ", tags: "Hope, prayer ,", resources: [{ title: " Site ", url: "https://example.com" }, { title: "", url: "  " }] });
ok("payload: trimmed, tags split, empty links dropped, question ids kept", input.title === "Old" && JSON.stringify(input.tags) === JSON.stringify(["Hope", "prayer"])
  && input.resources.length === 1 && input.resources[0].title === "Site" && input.questions[1].id === "q-2" && input.questions[0].id === undefined);
ok("payload: YouTube link passed for the server to normalise", input.media.provider === "youtube" && input.media.id === "https://youtu.be/dQw4w9WgXcQ");
ok("http links refused before sending", M.formToInput({ ...f, resources: [{ title: "x", url: "http://example.com" }] }) === "Links must start with https://");
ok("passages: verses checked; empty rows ignored", /check the verse numbers/.test(M.formToInput({ ...f, passages: [{ book: "John", chapter: "3", startVerse: "20", endVerse: "16", translation: "" }] }))
  && M.formToInput({ ...f, passages: [{ book: "", chapter: "", startVerse: "", endVerse: "", translation: "" }] }).scriptureReferences.length === 0);
ok("passage label", M.passageLabel({ book: "Psalms", chapter: 23, startVerse: 1, endVerse: 6, translation: "KJV" }) === "Psalms 23:1-6 (KJV)");

// ── Editor ────────────────────────────────────────────────────────────────
const ed = src("components/study/CustomLessonEditor.tsx");
ok("editor: real Bible book list + translations from the Bible API (no free-typed book/version)", /BIBLE_BOOKS\.map/.test(ed) && /getBibleTranslations\("en"\)/.test(ed) && !/placeholder="NIV"/.test(ed));
ok("editor: several passages (first = main), discussion/reflection per question, links, topics, video", /Main passage/.test(ed) && /Add another passage/.test(ed) && /"Discussion" : "Reflection"/.test(ed) && /Add a link/.test(ed) && /label="Topics"/.test(ed) && /YouTube link/.test(ed));
ok("editor: Save draft vs Publish; a published lesson just saves changes", /Save draft/.test(ed) && /isPublished \? "Save changes" : "Publish"/.test(ed) && /\{!isPublished && \(/.test(ed));
ok("editor: Field component at module level (typing keeps focus)", /^function Field\(/m.test(ed) && !/const Field = \(/.test(ed));
ok("editor: problems shown in place, save errors surfaced", /setProblem\(input\)/.test(ed) && /accessibilityLiveRegion="assertive"/.test(ed));

// ── List / actions ──────────────────────────────────────────────────────
const sec = src("components/study/CustomLessonSection.tsx");
ok("actions: Edit, Preview/Open, Publish, Unpublish, Archive, Restore", ["Edit", "Preview", "Publish", "Unpublish (back to draft)", "Archive", "Restore as draft"].every((t) => sec.includes(`"${t}"`)));
ok("delete offered only for a draft that was never published", /const neverPublished = status === "draft" && !lesson\.publishedAt;/.test(sec) && /if \(neverPublished\) actions\.push\(\{ text: "Delete draft"/.test(sec));
ok("archive asks first and says nothing written is lost", /Anything already written is kept\./.test(sec));
ok("status badge + actions only for leaders", /\{canManage && \(\s*\n\s*<View style=\{\[styles\.badge/.test(sec) && /\{canManage && \(\s*\n\s*busyId === lesson\.id/.test(sec));

for (const [file, T] of [["app/family/studies/[studyId].tsx", "FamilyStudy"], ["app/church/studies/[studyId].tsx", "ChurchStudy"]]) {
  const sc = src(file);
  ok(`${file}: uses the shared section; old inline editor removed`, /<CustomLessonSection/.test(sc) && !/lessonEditor/.test(sc) && !/lessonToFormState/.test(sc));
  ok(`${file}: adapter calls this scope's API incl. status`, new RegExp(`setStatus: \\(lessonId, status\\) => set${T}LessonStatus\\(`).test(sc));
}
ok("church screen: management follows THIS study's church (server canManage), not the current church", /setCanManage\(manage \?\? isChurchLeader\);/.test(src("app/church/studies/[studyId].tsx")) && !/\{isChurchLeader \?/.test(src("app/church/studies/[studyId].tsx")));

// ── Viewer ───────────────────────────────────────────────────────────────
const v = src("components/study/CustomLessonViewer.tsx");
ok("viewer: marked as custom (not official P2P); draft/archived preview banner", /Custom lesson — not official P2P curriculum/.test(v) && /Draft preview — members can't see this yet/.test(v));
ok("viewer: every passage, discussion vs reflection, https links only, topics", /passages\.map/.test(v) && /DISCUSSION QUESTIONS/.test(v) && /REFLECTION QUESTIONS/.test(v) && /filter\(\(r\) => \/\^https:\\\/\\\/\/i\.test\(r\.url\)\)/.test(v) && /lesson\.tags\.map/.test(v));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
