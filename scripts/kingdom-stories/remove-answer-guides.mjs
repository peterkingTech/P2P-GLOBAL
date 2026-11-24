// Remove answer guides from Kingdom Stories (owner request 2026-11-24: learners must not see the answers).
// Removes: "Answer Guide" / "Answer Key" / "Suggested Answers" sections (up to the next real section such as
// Memory Verse, Final Assignment or PART B — … QUESTIONS), and "Answer:" / "Suggested Answer:" lines under
// questions (with the answer text on the next line when the label stands alone). The instruction
// "Answer the questions before consulting the answer guide." loses only the words about the guide.
// Nothing else in the story text changes.
//
//   node scripts/kingdom-stories/remove-answer-guides.mjs            dry run on the database (BEGIN … ROLLBACK)
//   node scripts/kingdom-stories/remove-answer-guides.mjs --apply    commit (draft and review stories only;
//                                                                    published stories are reported, not changed)
//   node scripts/kingdom-stories/remove-answer-guides.mjs --content  rewrite the content files the same way
//
// The database text is cleaned where it is (not re-imported), so edits made in the admin are kept.
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apply = process.argv.includes("--apply");

const GUIDE_START = /^(?:.*\banswer guide\b.*|.*\banswer key\b.*|suggested answers|section\s+\w+\s*[—:-]\s*(?:multiple[- ]choice answers|true[- ]or[- ]false answers|true or false answers|suggested answers?(?: points)?|short-answer guide|application guide))\s*$/i;
const GUIDE_END = /^(?:memory verse|final assignment|closing prayer|part [b-z]\s*[—-].*questions|section\s+\w+\s*[—:-].*questions|topic \d+|comprehensive knowledge check\s*$|knowledge check\s*$|reflection\s*$|key lessons|lessons|reflection questions)/i;
const ANSWER_LINE = /^(?:\d+\.\s*)?(?:suggested |model |sample |expected )?answers?(?: points)?\s*:/i;
const NOT_ANSWER = /^(?:\d+\.\s*)?short answer\s*:/i;
const QUESTION = /^\d+\.\s|^(?:part|section)\s|^[A-D]\.\s/i;

export function clean(lines) {
  const out = [], removed = [];
  let inGuide = false, inAnswer = false, block = null;
  for (const raw of lines) {
    const l = raw.trim();
    if (inGuide) {
      if (GUIDE_END.test(l) && !GUIDE_START.test(l)) { inGuide = false; block = null; }
      else { block.push(raw); continue; }
    }
    if (GUIDE_START.test(l) && !/^instructions\s*:/i.test(l)) { inGuide = true; inAnswer = false; block = [raw]; removed.push(block); continue; }
    if (ANSWER_LINE.test(l) && !NOT_ANSWER.test(l)) { inAnswer = true; block = [raw]; removed.push(block); continue; }
    if (inAnswer) {
      const labelOnly = block.length === 1 && /:\s*$/.test(block[0].trim());
      if (l && !QUESTION.test(l) && !GUIDE_END.test(l) && (labelOnly || /^[•\-–]/.test(l))) { block.push(raw); continue; }
      inAnswer = false; block = null;
    }
    out.push(raw);
  }
  let changed = removed.length > 0;
  for (let i = 0; i < out.length; i++) {
    const t = out[i].replace(/\s*before consulting the answer guide(?=[.])/i, "");
    if (t !== out[i]) { out[i] = t; changed = true; }
  }
  return { lines: out, removed, changed };
}
const cleanText = (text, sep) => {
  const r = clean(String(text ?? "").split(sep));
  return { text: r.lines.join(sep), changed: r.changed, lines: r.removed.reduce((a, b) => a + b.length, 0) };
};

// ---- content files ----------------------------------------------------------------------------------------
if (process.argv.includes("--content")) {
  const dir = path.join(repo, "scripts/kingdom-stories/content");
  for (const f of readdirSync(dir).filter((f) => /-stories\.mjs$|^jesus-christ-.*\.mjs$|^topics-.*\.mjs$|^story-.*\.mjs$/.test(f))) {
    const file = path.join(dir, f);
    const stories = (await import(pathToFileURL(file).href)).default;
    if (!Array.isArray(stories)) continue;
    let n = 0;
    for (const s of stories) {
      const b = clean(s.body); if (b.changed) { s.body = b.lines; n++; }
      for (const c of s.chapters ?? []) {
        const nr = clean(c.narrative); if (nr.changed) { c.narrative = nr.lines; n++; }
        if (c.assignment?.text) { const a = cleanText(c.assignment.text, "\n"); if (a.changed) { c.assignment.text = a.text; n++; } }
      }
    }
    if (!n) continue;
    const src = readFileSync(file, "utf8");
    const head = src.slice(0, src.indexOf("export default"));
    writeFileSync(file, head + "export default " + JSON.stringify(stories, null, 1) + ";\n");
    console.log(`${f}: ${n} field(s) cleaned`);
  }
  process.exit(0);
}

// ---- database ---------------------------------------------------------------------------------------------
function envValue(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}
const url = process.env.KS_IMPORT_DB_URL
  || envValue(path.join(repo, "artifacts/api-server/.env.production-direct.local"), "PROD_DIRECT_DB_URL")
  || envValue(path.join(repo, "artifacts/api-server/.env"), "SUPABASE_DB_URL");
if (!url) { console.error("No database URL configured."); process.exit(2); }
const store = path.join(repo, "node_modules/.pnpm");
const pg = createRequire(import.meta.url)(path.join(store, readdirSync(store).filter((d) => /^pg@\d/.test(d)).sort().pop(), "node_modules/pg"));
const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
const c = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
await c.connect();
try {
  await c.query("BEGIN");
  await c.query("SET LOCAL statement_timeout = '60s'");
  const stories = (await c.query(`select s.id, s.title, s.topic_number, s.status, s.body, k.slug
    from public.p2p_kingdom_stories s join public.p2p_kingdom_story_categories k on k.id = s.category_id
    order by k.slug, s.topic_number nulls last`)).rows;
  let changedStories = 0, removedLines = 0;
  for (const s of stories) {
    const where = `${s.slug} T${s.topic_number ?? "-"} (${s.status})`;
    const notes = [];
    const body = cleanText(s.body, "\n\n");
    const chapters = (await c.query("select id, chapter_number, narrative, assignment from public.p2p_kingdom_story_chapters where story_id = $1 order by chapter_number", [s.id])).rows;
    const chUpdates = [];
    for (const ch of chapters) {
      const nr = cleanText(ch.narrative, "\n\n"), as = cleanText(ch.assignment, "\n");
      if (nr.changed || as.changed) {
        chUpdates.push([ch.id, nr.changed ? nr.text : ch.narrative, as.changed ? as.text : ch.assignment]);
        notes.push(`ch${ch.chapter_number}: ${nr.lines + as.lines} line(s)`); removedLines += nr.lines + as.lines;
      }
    }
    if (body.changed) { notes.unshift(`intro: ${body.lines} line(s)`); removedLines += body.lines; }
    if (!notes.length) continue;
    if (s.status === "published") { console.log(`SKIP published ${where}: ${notes.join(", ")}`); continue; }
    changedStories++;
    console.log(`${where} ${s.title.slice(0, 50)} — ${notes.join(", ")}`);
    if (body.changed) await c.query("update public.p2p_kingdom_stories set body = $2, updated_at = now() where id = $1", [s.id, body.text]);
    for (const [id, narrative, assignment] of chUpdates)
      await c.query("update public.p2p_kingdom_story_chapters set narrative = $2, assignment = $3, updated_at = now() where id = $1", [id, narrative, assignment]);
  }
  console.log(`\n${changedStories} stories, ${removedLines} answer line(s) removed.`);
  if (apply) { await c.query("COMMIT"); console.log("APPLIED."); }
  else { await c.query("ROLLBACK"); console.log("Dry run — rolled back. Add --apply to commit."); }
} catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
finally { await c.end(); }
