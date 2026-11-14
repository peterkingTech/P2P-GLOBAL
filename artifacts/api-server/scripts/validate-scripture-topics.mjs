// Validate the Explore Scripture by Topic editorial collection (data/scripture-topics/*.json) against a REAL
// Bible text: for every referenced chapter it reads that chapter from the Free Use Bible API
// (bible.helloao.org, the HelloAO provider P2P already uses; Berean Standard Bible, public domain) and checks
// that the book exists, the chapter exists, and the start AND end verse exist in that chapter.
// Only verse NUMBERS are kept (data/scripture-topics/verse-counts.json — structural facts, no Bible text),
// so the tests can re-check offline.
//   node --experimental-strip-types scripts/validate-scripture-topics.mjs [--offline]
// Writes data/scripture-topics/validation-report.json. Exit code 1 if any reference fails.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePassage, BOOKS } from "../src/lib/scriptureTopics.ts";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "scripture-topics");
const offline = process.argv.includes("--offline");
const countsFile = path.join(dir, "verse-counts.json");
const counts = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, "utf8")) : { source: "", chapters: {} };
counts.source = "bible.helloao.org/api/BSB (Berean Standard Bible) — last verse number per chapter only";

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !["index.json", "verse-counts.json", "validation-report.json"].includes(f));
const items = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  for (const t of j.topics ?? []) for (const raw of t.passages ?? []) items.push({ file: f, topic: t.title, raw });
  for (const t of j.existingTopicAdditions ?? []) for (const raw of t.passages ?? []) items.push({ file: f, topic: t.title, raw, existing: true });
}

async function lastVerse(code, chapter) {
  const key = `${code} ${chapter}`;
  if (counts.chapters[key]) return counts.chapters[key];
  if (offline) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`https://bible.helloao.org/api/BSB/${code}/${chapter}.json`);
      if (r.status === 404) return 0;
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      const nums = (j.chapter?.content ?? []).filter((x) => x.type === "verse").map((x) => Number(x.number));
      const max = nums.length ? Math.max(...nums) : 0;
      counts.chapters[key] = max;
      return max;
    } catch (e) { if (attempt === 2) throw e; await new Promise((res) => setTimeout(res, 800)); }
  }
}

const results = [];
for (const it of items) {
  const p = parsePassage(it.raw);
  if (!p.ok) { results.push({ ...it, ok: false, reason: p.reason }); continue; }
  const book = BOOKS.find((b) => b.name === p.book);
  if (p.chapter > book.chapters) { results.push({ ...it, ok: false, reason: `${p.book} has ${book.chapters} chapters` }); continue; }
  const last = await lastVerse(book.code, p.chapter);
  if (last === null) { results.push({ ...it, ok: false, reason: "not checked (offline, chapter not cached)" }); continue; }
  if (!last) { results.push({ ...it, ok: false, reason: "chapter not found in the Bible text" }); continue; }
  if (p.endVerse > last) { results.push({ ...it, ok: false, reason: `${p.book} ${p.chapter} ends at verse ${last}` }); continue; }
  results.push({ ...it, ok: true, ref: p.display });
}
counts.chapters = Object.fromEntries(Object.entries(counts.chapters).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(countsFile, JSON.stringify(counts, null, 1) + "\n");
const failed = results.filter((r) => !r.ok);
writeFileSync(path.join(dir, "validation-report.json"), JSON.stringify({
  checkedAt: new Date().toISOString().slice(0, 10), source: counts.source, references: results.length, valid: results.length - failed.length,
  failed: failed.map((r) => ({ file: r.file, topic: r.topic, raw: r.raw, reason: r.reason })),
}, null, 1) + "\n");
console.log(`checked ${results.length} references: ${results.length - failed.length} valid, ${failed.length} failed`);
for (const r of failed) console.log(`FAIL ${r.file} · ${r.topic} · ${r.raw.split("|")[0].trim()} — ${r.reason}`);
process.exit(failed.length ? 1 : 0);
