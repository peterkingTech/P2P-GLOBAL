// Parses "Pre-Salvation Core Curriculum — Complete Simplified Teaching Edition"
// (the owner's 7 books × 4 modules × 3 lessons) into structured data for
// The Gospel & Salvation. Text is taken verbatim from the PDF (via
// `pdftotext -enc UTF-8`); only page footers are removed. Nothing is
// paraphrased or invented. Fails loudly if any lesson is missing a part.
//   node gospel_salvation_v2_parse.mjs <pdftotext output> <out.json>
import { readFileSync, writeFileSync } from "node:fs";

const [, , inFile, outFile] = process.argv;
let text = readFileSync(inFile, "utf8").replace(/\r\n/g, "\n");
// Page furniture.
text = text.replace(/^Pre-Salvation Core Curriculum • Simplified Teaching Edition\s*$/gm, "").replace(/^Page \d+\s*$/gm, "");
const flat = (s) => s.replace(/\s+/g, " ").trim();

const bookRe = /BOOK (\d+): ([^\n]+)\n/g;
const books = [];
let m;
const bookStarts = [];
while ((m = bookRe.exec(text))) bookStarts.push({ n: Number(m[1]), title: m[2].trim(), at: m.index, bodyAt: m.index + m[0].length });
if (bookStarts.length !== 7) throw new Error(`expected 7 books, found ${bookStarts.length}`);

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bWith\b/g, "With").replace(/\b(And|Of|To|The|From)\b/g, (w, _a, i) => (i === 0 ? w : w.toLowerCase()));

for (let b = 0; b < bookStarts.length; b++) {
  const start = bookStarts[b], end = bookStarts[b + 1]?.at ?? text.length;
  const body = text.slice(start.bodyAt, end);
  const descEnd = body.indexOf("\n");
  const description = flat(body.slice(0, descEnd));
  const rest = body.slice(descEnd + 1);
  // Lessons: "Lesson M.L: Title" followed by "Key Scripture:".
  const lessonRe = /Lesson (\d+)\.(\d+): ([^\n]+?)\s*\n?\s*Key Scripture:/g;
  const marks = [];
  while ((m = lessonRe.exec(rest))) marks.push({ mod: Number(m[1]), num: Number(m[2]), title: flat(m[3]), at: m.index, bodyAt: m.index + m[0].length });
  if (marks.length !== 12) throw new Error(`book ${start.n}: expected 12 lessons, found ${marks.length}`);
  const modules = [];
  for (let i = 0; i < marks.length; i++) {
    const L = marks[i];
    const lbody = rest.slice(L.bodyAt, marks[i + 1]?.at ?? rest.length);
    // The module heading sits just before each module's first lesson, after the
    // previous lesson's final sentence ("...church leader.") or the book description.
    if (L.num === 1) {
      const before = rest.slice(0, L.at);
      const cut = Math.max(before.lastIndexOf("church leader."), -1);
      const heading = flat(cut >= 0 ? before.slice(cut + "church leader.".length) : before);
      if (!heading || heading.length > 90) throw new Error(`book ${start.n} module ${L.mod}: bad heading "${heading}"`);
      modules.push({ title: heading, lessons: [] });
    }
    const part = (re) => { const x = lbody.match(re); return x ? flat(x[1]) : null; };
    const scripture = part(/^([\s\S]*?)\s*1\. Definition and simple explanation/);
    const explanation = part(/1\. Definition and simple explanation([\s\S]*?)2\. What this means and why it matters/);
    const matters = part(/2\. What this means and why it matters([\s\S]*?)3\. Important things to remember/);
    const remember = part(/3\. Important things to remember([\s\S]*?)4\. Personal reflection/);
    const reflection = part(/4\. Personal reflection([\s\S]*?)5\. Comprehensive understanding check/);
    const check = part(/5\. Comprehensive understanding check([\s\S]*?)6\. Practical application/);
    const application = part(/6\. Practical application([\s\S]*)$/);
    const missing = Object.entries({ scripture, explanation, matters, remember, reflection, check, application }).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error(`book ${start.n} lesson ${L.mod}.${L.num}: missing ${missing.join(", ")}`);
    // "“verse text” — Reference"
    const sm = scripture.match(/^[“"]([\s\S]+)[”"]\s*[—–-]{1,2}\s*(.+)$/);
    if (!sm) throw new Error(`book ${start.n} lesson ${L.mod}.${L.num}: can't split scripture "${scripture}"`);
    const bullets = (s) => s.split("•").map(flat).filter(Boolean);
    const numbered = (s) => s.split(/\s*\b\d\.\s+/).map(flat).filter(Boolean);
    const reflectionQs = bullets(reflection), checkQs = numbered(check), rememberItems = bullets(remember);
    if (reflectionQs.length !== 3) throw new Error(`book ${start.n} lesson ${L.mod}.${L.num}: ${reflectionQs.length} reflection questions`);
    if (checkQs.length !== 4) throw new Error(`book ${start.n} lesson ${L.mod}.${L.num}: ${checkQs.length} check questions`);
    if (!rememberItems.length) throw new Error(`book ${start.n} lesson ${L.mod}.${L.num}: nothing to remember`);
    modules.at(-1).lessons.push({
      number: `${L.mod}.${L.num}`, title: L.title,
      scripture: { reference: flat(sm[2]), text: flat(sm[1]) },
      explanation, matters, remember: rememberItems, reflection: reflectionQs, check: checkQs, application,
    });
  }
  if (modules.length !== 4 || modules.some((x) => x.lessons.length !== 3)) throw new Error(`book ${start.n}: expected 4 modules of 3 lessons`);
  books.push({ number: start.n, title: titleCase(start.title), description, modules });
}
const total = books.reduce((n, b) => n + b.modules.reduce((k, x) => k + x.lessons.length, 0), 0);
if (total !== 84) throw new Error(`expected 84 lessons, found ${total}`);
writeFileSync(outFile, JSON.stringify({ source: "Pre-Salvation Core Curriculum — Complete Simplified Teaching Edition", books }, null, 2));
for (const b of books) {
  console.log(`Book ${b.number}: ${b.title}`);
  for (const x of b.modules) console.log(`   ${x.title}: ${x.lessons.map((l) => `${l.number} ${l.title} [${l.scripture.reference}]`).join(" | ")}`);
}
console.log(`${books.length} books, ${books.reduce((n, b) => n + b.modules.length, 0)} modules, ${total} lessons`);
