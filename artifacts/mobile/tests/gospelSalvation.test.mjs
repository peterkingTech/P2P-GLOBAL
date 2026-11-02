// The Gospel & Salvation — seven-book edition (migration 221):
//  1. The parsed content (lib/db/gospel_salvation_v2.json) is the owner's
//     7 books × 4 modules × 3 lessons, every lesson complete.
//  2. The migration adds exactly that, deletes nothing, moves the previous
//     edition into a hidden archived course, and is safe to run twice.
//  3. The course screen shows one heading per book (bookOf), and ordinary
//     module descriptions are left alone.
// Run: node tests/gospelSalvation.test.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// 1. Content
const data = JSON.parse(readFileSync(path.join(repo, "lib/db/gospel_salvation_v2.json"), "utf8"));
const BOOKS = ["Pre-Salvation", "Jesus Christ", "The Gospel", "Responding to the Gospel", "Assurance of Salvation", "Baptism and Identification With Christ", "From Convert to Disciple"];
ok("7 books in the owner's order", JSON.stringify(data.books.map((b) => b.title)) === JSON.stringify(BOOKS), JSON.stringify(data.books.map((b) => b.title)));
ok("4 modules per book, 3 lessons per module (28 / 84)", data.books.every((b) => b.modules.length === 4 && b.modules.every((m) => m.lessons.length === 3)));
const lessons = data.books.flatMap((b) => b.modules.flatMap((m) => m.lessons));
ok("84 lessons", lessons.length === 84);
ok("every lesson: Scripture reference + text, explanation, why it matters, things to remember, 3 reflections, 4 check questions, practical application",
  lessons.every((l) => l.scripture.reference && l.scripture.text.length > 10 && l.explanation.length > 40 && l.matters.length > 40 && l.remember.length >= 1
    && l.reflection.length === 3 && l.check.length === 4 && l.application.length > 40));
ok("verbatim sample: Lesson 1.1 of Book 1", lessons[0].title === "Dead in Trespasses and Sins" && lessons[0].scripture.reference === "Ephesians 2:1"
  && lessons[0].scripture.text === "And you He made alive, who were dead in trespasses and sins." && lessons[0].explanation.startsWith("Paul describes people apart from Christ as spiritually dead because of sin."));
ok("verbatim sample: last lesson of Book 7", lessons[83].title === "A Lifetime of Following Jesus" && lessons[83].scripture.reference === "Matthew 28:19-20");
ok("no page furniture leaked into the text", !JSON.stringify(data).match(/Simplified Teaching Edition\s+Page|Page \d+ /));
ok("previous description saved for rollback", typeof data.previousDescription === "string" && data.previousDescription.startsWith("Discover the good news"));

// 2. Migration
const sql = readFileSync(path.join(repo, "migrations/221_gospel_salvation_seven_books.sql"), "utf8");
const ids = JSON.parse(readFileSync(path.join(repo, "migrations/221_gospel_salvation_seven_books.ids.json"), "utf8"));
ok("one transaction", /^begin;$/m.test(sql) && /^commit;$/m.test(sql));
ok("deletes nothing, drops nothing", !/^\s*(delete|drop|truncate)\b/im.test(sql));
ok("every insert is idempotent (on conflict do nothing)", (sql.match(/^insert into /gm) ?? []).length === (sql.match(/^on conflict \(id\) do nothing;$/gm) ?? []).length);
ok("28 modules and 84 lessons, each id unique", ids.modules.length === 28 && ids.lessons.length === 84 && new Set([...ids.modules, ...ids.lessons]).size === 112);
ok("every lesson title is in the migration", lessons.every((l) => sql.includes(`$gs$${l.title}$gs$`)));
ok("previous edition is moved (guarded) into the hidden archived course, not deleted",
  /update public\.p2p_modules set curriculum_id = '39694985-01f2-53bb-9df3-08325bb96f17', status = 'archived'\s+where curriculum_id = 'f6a2b3f6-b66d-45d6-8065-c46d7b63441b' and id not in \(/.test(sql)
  && /'core', 'archived', false/.test(sql));
ok("Comprehensive Check = the 4 check questions; reflections = the 3 Personal Reflections", (sql.match(/\$gs\$Comprehensive Check\$gs\$, \$gs\$\$gs\$\)/g) ?? []).length === 84
  && (sql.match(/insert into public\.p2p_reflection_questions/g) ?? []).length === 84);
ok("module descriptions name their book", data.books.every((b) => sql.includes(`$gs$Book ${b.number} · ${b.title} — `)));

// 3. Course screen: one heading per book
const screen = readFileSync(path.join(root, "app/curriculum/[id].tsx"), "utf8");
const body = screen.slice(screen.indexOf("export function bookOf"));
const m = { exports: {} };
new Function("module", "exports", ts.transpileModule(body, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(m, m.exports);
const bookOf = m.exports.bookOf;
const b6 = bookOf("Part 6 · Baptism and Identification With Christ — This part explains baptism.");
ok("bookOf reads the word, number, title and description", b6 && b6.word === "Part" && b6.number === 6 && b6.title === "Baptism and Identification With Christ" && b6.about === "This part explains baptism.");
ok("older 'Book N' descriptions still read (installed data before 222)", bookOf("Book 2 · Jesus Christ — x")?.word === "Book");
ok("heading shows the description's own word (Part)", screen.includes("{`${book!.word} ${book!.number}`}"));
const sql222 = readFileSync(path.join(repo, "migrations/222_gospel_salvation_full_content.sql"), "utf8");
ok("222 renames every module and lesson to 'Part N' (and no 'About this book')", (sql222.match(/^update public\.p2p_modules set description = \$gs\$Part \d · /gm) ?? []).length === 28
  && (sql222.match(/^update public\.p2p_lessons set subtitle = \$gs\$Part \d · Lesson \d\.\d\$gs\$/gm) ?? []).length === 84 && !sql222.includes("About this book") && sql222.includes("$gs$About this part$gs$"));
ok("222 deletes nothing", !/^\s*(delete|drop|truncate)\b/im.test(sql222));
ok("bookOf leaves ordinary descriptions alone", bookOf("Learn to pray every day") === null && bookOf(null) === null && bookOf("Booklet 2 · x") === null);
ok("every module description is recognised", data.books.every((b) => !!bookOf(`Part ${b.number} · ${b.title} — ${b.description}`) && !!bookOf(`Book ${b.number} · ${b.title} — ${b.description}`)));
ok("screen: heading only when the book changes; card hides the repeated book text",
  screen.includes("const newBook = !!book && book.key !== prevBook?.key;") && screen.includes("{!!m.description && !book && <Text style={styles.moduleDesc}"));

console.log(`gospelSalvation: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
