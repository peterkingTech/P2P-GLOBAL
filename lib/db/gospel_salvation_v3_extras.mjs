// Everything ELSE in the owner's files for The Gospel & Salvation, beyond the
// Simplified Teaching Edition already in migration 221 — parsed verbatim
// (page furniture removed only), so migration 222 can add ALL of it:
//   • the seven book files (1_Pre-Salvation.pdf … 7_From_Convert_to_Disciple.pdf):
//     per book — description, Root Scripture, lecture; per lesson — Bible
//     quote, two study questions with answers, Important Distinction,
//     5 Personal Reflections, 5-step Lesson Assignment;
//   • "The Gospel Of Jesus Christ" (the full Book 3): per module —
//     description, main Scripture references, objectives; per lesson — main
//     Scriptures, introduction, numbered teaching, Personal Reflection
//     questions, lesson summary; Module 4's completion review (the book
//     repeats Module 4 — the second, complete copy is used);
//   • "Pre-Salvation Curriculum — New Teaching Approach": the sample Lesson
//     1.1 (learner content) and the editorial framework (admin notes).
// Usage: node gospel_salvation_v3_extras.mjs <dir with pdftotext -enc UTF-8 outputs> <v2.json> <out.json>
//   expects sep1.txt … sep7.txt, gospel.txt, approach.txt in <dir>.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [, , dir, v2File, outFile] = process.argv;
const v2 = JSON.parse(readFileSync(v2File, "utf8"));
const flat = (s) => s.replace(/\s+/g, " ").trim();
const read = (f) => readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n").replace(/\f/g, "\n");
const fail = (m) => { throw new Error(m); };
const items = (s) => flat(s).split(/(?:^|\s)\d{1,2}\.\s+(?=\S)/).map(flat).filter(Boolean);

// ── 1. The seven book files ────────────────────────────────────────────────
const books = {};
for (let b = 1; b <= 7; b++) {
  const t = flat(read(`sep${b}.txt`));
  const sim = v2.books[b - 1];
  const description = t.match(/Plan Description:\s*(.*?)\s*Root Scripture:/)?.[1] ?? fail(`book ${b}: description`);
  const rootScripture = t.match(/Root Scripture:\s*(.*?)\s*Lecture\s/)?.[1] ?? fail(`book ${b}: root scripture`);
  const lecture = t.match(/\sLecture\s+(.*?)\s*\d+ Modules \| \d+ Lessons/)?.[1] ?? fail(`book ${b}: lecture`);
  const lessonRe = /Lesson (\d)\.(\d): (.*?) Bible Quote: /g;
  const marks = [];
  let m;
  while ((m = lessonRe.exec(t))) marks.push({ n: `${m[1]}.${m[2]}`, title: flat(m[3]), at: m.index, bodyAt: m.index + m[0].length });
  if (marks.length !== 12) fail(`book ${b}: ${marks.length} lessons`);
  const modules = [];
  for (let k = 1; k <= 4; k++) {
    const mm = t.match(new RegExp(`Module ${k}: (.*?) Lesson ${k}\\.1: `));
    modules.push(mm ? flat(mm[1]) : fail(`book ${b}: module ${k} title`));
  }
  const lessons = {};
  marks.forEach((L, i) => {
    // Cut the lesson's text, dropping any following "Module N: …" heading.
    let body = t.slice(L.bodyAt, marks[i + 1]?.at ?? t.length);
    if (marks[i + 1]) body = body.replace(/\s*Module \d: [^]*$/, (x) => (/Module \d: /.test(x) ? "" : x));
    const ref = sim.modules[Number(L.n[0]) - 1].lessons[Number(L.n[2]) - 1].scripture.reference;
    const refAt = body.indexOf(`— ${ref}`);
    if (refAt < 0) fail(`book ${b} lesson ${L.n}: quote reference "${ref}" not found`);
    const quote = flat(body.slice(0, refAt + 2 + ref.length));
    const afterQuote = body.slice(refAt + 2 + ref.length);
    const qaText = flat(afterQuote.split("Important Distinction:")[0]);
    // Two study questions, each "Question? Answer."
    const q1End = qaText.indexOf("?");
    const q2End = qaText.indexOf("?", q1End + 1);
    if (q1End < 0 || q2End < 0) fail(`book ${b} lesson ${L.n}: study questions`);
    // The second question is the last sentence before its "?" that opens with a question word.
    const before2 = qaText.slice(0, q2End);
    const opens = [...before2.matchAll(/[.!”] (?=(?:How|Why|What|In what|Does|Is|Can|Should|Where|When|Who|Which)\b)/g)];
    if (!opens.length) fail(`book ${b} lesson ${L.n}: second study question not found`);
    const q2Start = opens.at(-1).index + 2;
    const qa = [
      { q: flat(qaText.slice(0, q1End + 1)), a: flat(qaText.slice(q1End + 1, q2Start)) },
      { q: flat(qaText.slice(q2Start, q2End + 1)), a: flat(qaText.slice(q2End + 1)) },
    ];
    if (qa.some((x) => x.q.length < 20 || x.a.length < 40)) fail(`book ${b} lesson ${L.n}: study question split ${JSON.stringify(qa).slice(0, 300)}`);
    const distinction = flat(body.match(/Important Distinction:\s*(.*?)\s*Personal Reflection:/)?.[1] ?? fail(`book ${b} lesson ${L.n}: distinction`));
    const reflection = items(body.match(/Personal Reflection:\s*(.*?)\s*Lesson \d\.\d Assignment:/)?.[1] ?? fail(`book ${b} lesson ${L.n}: reflection`));
    const assignment = items(body.match(/Lesson \d\.\d Assignment:\s*(.*)$/)?.[1] ?? fail(`book ${b} lesson ${L.n}: assignment`));
    if (reflection.length !== 5) fail(`book ${b} lesson ${L.n}: ${reflection.length} reflections`);
    if (assignment.length !== 5) fail(`book ${b} lesson ${L.n}: ${assignment.length} assignment steps`);
    lessons[L.n] = { title: L.title, quote, qa, distinction, reflection, assignment };
  });
  books[b] = { description: flat(description), rootScripture: flat(rootScripture), lecture: flat(lecture), modules, lessons };
}

// ── 2. The full Book 3 ("The Gospel Of Jesus Christ") ─────────────────────
const gLines = read("gospel.txt").split("\n").map((l) => l.replace(/\s+$/, ""));
const isBlank = (l) => !l.trim();
// Join a paragraph broken across a page: a line not ending a sentence, followed by one starting in lower case.
function paragraphs(lines) {
  const out = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (out.length && !/[.?!:”"’)]$/.test(out.at(-1)) && /^[a-z(“"]/.test(l)) out[out.length - 1] += " " + l;
    else out.push(l);
  }
  return out;
}
// Split into modules; a repeated module number replaces the earlier copy.
const gModules = {};
let cur = null;
for (const line of gLines) {
  const mm = line.match(/^MODULE (\d): (.+)$/);
  if (mm) { cur = { n: Number(mm[1]), title: mm[2].trim(), lines: [] }; gModules[cur.n] = cur; continue; }
  if (cur) cur.lines.push(line);
}
if (Object.keys(gModules).length !== 4) fail(`gospel: ${Object.keys(gModules).length} modules`);
const gospel = { modules: {}, lessons: {} };
for (const mod of Object.values(gModules)) {
  const L = mod.lines;
  const idx = (re, from = 0) => { for (let i = from; i < L.length; i++) if (re.test(L[i].trim())) return i; return -1; };
  const iDesc = idx(/^Module Description$/), iRefs = idx(/^Main Scripture References$/), iObj = idx(/^Module Objectives$/);
  const iFirstLesson = idx(/^LESSON \d\.\d — /);
  if (iDesc < 0 || iRefs < 0 || iFirstLesson < 0) fail(`gospel module ${mod.n}: header parts`);
  const refsEnd = iObj > 0 ? iObj : iFirstLesson;
  const refs = flat(L.slice(iRefs + 1, refsEnd).join(" ")).split("•").map(flat).filter(Boolean);
  let objectives = [], objectivesIntro = "";
  if (iObj > 0) {
    const o = flat(L.slice(iObj + 1, iFirstLesson).join(" "));
    const firstNum = o.search(/\b1\.\s/);
    objectivesIntro = flat(o.slice(0, firstNum));
    objectives = items(o.slice(firstNum));
  }
  gospel.modules[mod.n] = { title: mod.title, description: paragraphs(L.slice(iDesc + 1, iRefs)), scriptureReferences: refs, objectivesIntro, objectives };
  // Lessons and the completion review.
  const starts = [];
  L.forEach((l, i) => { const x = l.trim().match(/^LESSON (\d\.\d) — (.+)$/); if (x) starts.push({ n: x[1], at: i }); });
  const iReview = idx(/^MODULE \d — COMPLETION REVIEW$/);
  starts.forEach((s, k) => {
    const end = starts[k + 1]?.at ?? (iReview > 0 ? iReview : L.length);
    const body = L.slice(s.at + 1, end);
    const at = (re) => body.findIndex((l) => re.test(l.trim()));
    const iMain = at(/^Main Scriptures$/), iRefl = at(/^Personal Reflection$/), iSum = at(/^Lesson Summary$/);
    if (iMain < 0 || iRefl < 0) fail(`gospel lesson ${s.n}: parts (main ${iMain}, reflection ${iRefl})`);
    // Main Scriptures: the next non-blank line(s) until a heading.
    let p = iMain + 1; while (p < body.length && isBlank(body[p])) p++;
    const mainScriptures = flat(body[p] ?? "");
    const teachLines = body.slice(p + 1, iRefl);
    const sections = [];
    let section = null;
    for (const raw of teachLines) {
      const l = raw.trim();
      const h = l.match(/^(\d{1,2})\. ([A-Z][^.?!]{2,95}[^.?!:,])$/);
      if (l === "Introduction" || (h && Number(h[1]) === (sections.filter((x) => x.numbered).length + 1))) {
        section = { title: l === "Introduction" ? "Introduction" : `${h[1]}. ${h[2]}`, numbered: l !== "Introduction", lines: [] };
        sections.push(section);
        continue;
      }
      if (!section) { section = { title: "Introduction", numbered: false, lines: [] }; sections.push(section); }
      section.lines.push(raw);
    }
    const reflEnd = iSum > 0 ? iSum : body.length;
    const reflection = items(body.slice(iRefl + 1, reflEnd).join(" "));
    const summary = iSum > 0 ? paragraphs(body.slice(iSum + 1)) : [];
    if (!sections.length || reflection.length < 3) fail(`gospel lesson ${s.n}: ${sections.length} sections, ${reflection.length} questions`);
    gospel.lessons[s.n] = {
      mainScriptures,
      sections: sections.map((x) => ({ title: x.title, content: paragraphs(x.lines).join("\n\n") })).filter((x) => x.content),
      reflection, summary: summary.join("\n\n"),
    };
  });
  if (iReview > 0) {
    const R = L.slice(iReview + 1);
    const at = (re) => R.findIndex((l) => re.test(l.trim()));
    const iTruth = at(/^Key Truths to Remember$/), iQ = at(/^Module Review Questions$/), iApp = at(/^Practical Application$/);
    if (iTruth < 0 || iQ < 0 || iApp < 0) fail(`gospel module ${mod.n}: completion review parts`);
    gospel.modules[mod.n].review = {
      keyTruths: items(R.slice(iTruth + 1, iQ).join(" ")),
      reviewQuestions: items(R.slice(iQ + 1, iApp).join(" ")),
      practicalApplication: paragraphs(R.slice(iApp + 1)).join("\n\n"),
    };
  }
}
const gCount = Object.keys(gospel.lessons).length;
if (gCount !== 12) fail(`gospel: ${gCount} lessons`);

// ── 3. The Teaching Approach guide ─────────────────────────────────────────
const a = flat(read("approach.txt").replace(/^Pre-Salvation Core Curriculum • Revised Teaching Approach\s*$/gm, "").replace(/^Page \d+\s*$/gm, ""));
const sampleAt = a.indexOf("5. Sample Lesson in the New Style");
const appliedAt = a.indexOf("6. Applying the Approach Across All Seven Books");
if (sampleAt < 0 || appliedAt < 0) fail("approach: sections");
const sample = a.slice(sampleAt, appliedAt);
const grab = (re) => flat(sample.match(re)?.[1] ?? fail(`approach sample: ${re}`));
const approach = {
  framework: flat(a.slice(0, sampleAt) + " " + a.slice(appliedAt)),
  sample: {
    keyPassage: grab(/Key Bible passage:\s*(.*?)\s*Definition:/),
    definitionTitle: grab(/Definition:\s*(.*?\?)/),
    definition: grab(/Definition:\s*.*?\?\s*(.*?)\s*Simple explanation/),
    explanation: grab(/Simple explanation\s*(.*?)\s*Why is this important\?/).split("•").map(flat).filter(Boolean),
    important: grab(/Why is this important\?\s*(.*?)\s*Important things to understand/),
    understand: grab(/Important things to understand\s*(.*?)\s*Personal reflection/).split("•").map(flat).filter(Boolean),
    reflection: grab(/Personal reflection\s*(.*?)\s*Comprehensive understanding check/).split("•").map(flat).filter(Boolean),
    check: items(grab(/Comprehensive understanding check\s*(.*?)\s*Practical application/)),
    application: grab(/Practical application\s*(.*?)\s*Teaching note:/),
    teachingNote: grab(/Teaching note:\s*(.*)$/),
  },
};

writeFileSync(outFile, JSON.stringify({ books, gospel, approach }, null, 2));
for (let b = 1; b <= 7; b++) {
  const sim = v2.books[b - 1];
  const titleMis = sim.modules.flatMap((m, mi) => m.lessons.map((l, li) => [`${mi + 1}.${li + 1}`, l.title])).filter(([n, t]) => books[b].lessons[n].title.toLowerCase() !== t.toLowerCase());
  console.log(`Book ${b}: lecture ${books[b].lecture.length} chars; lesson title differences vs simplified: ${titleMis.length ? JSON.stringify(titleMis.map(([n, t]) => `${n}: "${books[b].lessons[n].title}" / "${t}"`)) : "none"}`);
}
for (const [n, l] of Object.entries(gospel.lessons)) console.log(`Gospel ${n}: ${l.sections.length} sections (${l.sections.map((s) => s.title.split(".")[0]).join(",")}), ${l.reflection.length} questions, summary ${l.summary.length} chars`);
for (const [n, m] of Object.entries(gospel.modules)) console.log(`Gospel module ${n}: ${m.description.length} paragraphs, ${m.scriptureReferences.length} refs, ${m.objectives.length} objectives${m.review ? `, review: ${m.review.keyTruths.length} truths / ${m.review.reviewQuestions.length} questions` : ""}`);
console.log(`Approach sample: ${approach.sample.explanation.length} explanation points, ${approach.sample.reflection.length} reflections, ${approach.sample.check.length} check questions`);
