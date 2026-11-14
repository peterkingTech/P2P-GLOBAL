// P2P PLANS — Biblical people / events as DRAFT subject records (owner decision 1a, 2026-11-14).
//   node scripts/build-study-subjects.mjs [--offline]
// Source: P2P's OWN published Kingdom Stories (data/study-subjects/stories-*.json — ids, titles, each chapter's
// Scripture references; no story text). For each story about a person or an event:
//   • the subject's passages = the NARRATIVE references of its chapters (the chapter's own book — e.g.
//     "Genesis 11:27–12:9" from "Genesis 11:27–12:9; Hebrews 11:8–10"), read with the SAME parser as the API;
//   • one relationship subject → story (DIRECT), awaiting review.
// Verse ends for ranges that cross chapters come from verse NUMBERS only (data/study-plans/verse-counts.json,
// Berean Standard Bible via bible.helloao.org — the method build-study-plans.mjs already uses). No Bible text.
// Writes docs/proposals/252_study_subjects_drafts_PROPOSED.sql (everything DRAFT / needs_review — nothing is
// visible to participants until two editors approve and publish it) and docs/study-subjects-review.md.
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const { buildSync } = createRequire(import.meta.url)("esbuild");
const bundled = path.join(here, ".study-subjects-lib.mjs");
buildSync({ stdin: { contents: "export * from './src/lib/planDiscovery'; export { passageDisplay, validatePassage } from './src/lib/studyPlans'; export { slugify } from './src/lib/scriptureTopics';", resolveDir: path.join(here, ".."), loader: "ts" },
  bundle: true, format: "esm", platform: "node", outfile: bundled, logLevel: "silent" });
const L = await import(pathToFileURL(bundled).href);
rmSync(bundled);
const offline = process.argv.includes("--offline");
const repo = path.join(here, "..", "..", "..");
const dataDir = path.join(here, "..", "data", "study-subjects");
const snapshot = readdirSync(dataDir).filter((f) => /^stories-.*\.json$/.test(f)).sort().pop();
const { stories } = JSON.parse(readFileSync(path.join(dataDir, snapshot), "utf8"));
const countsFile = path.join(here, "..", "data", "study-plans", "verse-counts.json");
const counts = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, "utf8")) : { chapters: {} };

// Which stories are about a person, which about an event — the editors' call; proposed here, reviewed in 252.
const EVENTS = new Set(["Creation", "The Fall of Humanity", "Israel in the Wilderness", "Israel in the Time of the Judges"]);
async function lastVerse(code, chapter) {
  const key = `${code} ${chapter}`;
  if (counts.chapters[key]) return counts.chapters[key];
  if (offline) return null;
  const r = await fetch(`https://bible.helloao.org/api/BSB/${code}/${chapter}.json`);
  if (!r.ok) return null;
  const j = await r.json();
  const nums = (j?.chapter?.content ?? []).filter((x) => x?.type === "verse").map((x) => x.number);
  const last = nums.length ? Math.max(...nums) : null;
  if (last) counts.chapters[key] = last;
  return last;
}
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const problems = [], subjects = [];
for (const st of stories) {
  const name = st.title.split(":")[0].trim();
  const kind = EVENTS.has(name) ? "event" : "person";
  const passages = [], keys = new Set(), unread = [];
  for (const ch of st.chapters) {
    const r = L.parseRefList(ch.refs ?? "");
    unread.push(...r.unread.map((u) => `ch ${ch.number}: ${u}`));
    const narrative = r.spans.filter((s) => s.book === r.spans[0]?.book);
    for (const sp of narrative) {
      // Ranges crossing chapters need each chapter's last verse.
      const ends = new Map();
      for (let c = sp.c1; c <= sp.c2; c++) ends.set(c, await lastVerse(sp.book, c));
      const ps = L.spanPassages(sp, (b, c) => ends.get(c) ?? null);
      if (!ps) { problems.push(`${st.title} ch ${ch.number}: couldn't split ${L.spanDisplay(sp)}`); continue; }
      for (const p of ps) {
        const ok = L.validatePassage(p);
        if (!ok) { problems.push(`${st.title} ch ${ch.number}: invalid ${JSON.stringify(p)}`); continue; }
        if (ok.endVerse && counts.chapters[`${ok.book} ${ok.chapter}`] && ok.endVerse > counts.chapters[`${ok.book} ${ok.chapter}`]) { problems.push(`${st.title}: ${L.passageDisplay(ok)} ends after the chapter`); continue; }
        const k = L.passageDisplay(ok);
        if (!keys.has(k)) { keys.add(k); passages.push(ok); }
      }
    }
  }
  if (unread.length) problems.push(`${st.title}: unread references ${unread.join(" | ")}`);
  subjects.push({ slug: L.slugify(name), kind, name, passages: passages.slice(0, 80), story: st, chapters: st.chapters.length, more: Math.max(0, passages.length - 80) });
}
writeFileSync(countsFile, JSON.stringify({ ...counts, chapters: Object.fromEntries(Object.entries(counts.chapters).sort()) }, null, 1) + "\n");

const sql = [`-- 252 — Biblical people and events as DRAFT subject records (owner decision 1a, 2026-11-14). NOT APPLIED. REQUIRES 251.
-- Generated by artifacts/api-server/scripts/build-study-subjects.mjs from P2P's own published Kingdom Stories
-- (${snapshot}). ADDITIVE: inserts only; re-running changes nothing (on conflict do nothing).
-- Every subject is a DRAFT and every relationship needs_review: participants see NOTHING from this file until one
-- editor submits a subject and a second editor approves and publishes it (four eyes, enforced by 251).
-- Review guide: docs/study-subjects-review.md
begin;`];
for (const s of subjects) {
  const id = `md5('p2p-study-subject:${s.slug}')::uuid`;
  sql.push(`insert into public.p2p_study_subjects (id, slug, kind, name, passages, source_note, editorial_status) values (${id}, ${q(s.slug)}, ${q(s.kind)}, ${q(s.name)}, ${q(JSON.stringify(s.passages))}::jsonb,
  ${q(`Proposed from the Kingdom Story "${s.story.title}" — the narrative references of its ${s.chapters} chapters.`)}, 'draft') on conflict (slug) do nothing;`);
  sql.push(`insert into public.p2p_subject_resource_links (subject_type, subject_key, resource, resource_key, relation, reason, editorial_status)
  select 'subject', s.id::text, ${q(JSON.stringify({ kind: "kingdom_story", id: s.story.id }))}::jsonb, ${q(`kingdom_story:${s.story.id}`)}, 'direct', ${q(`The P2P Kingdom Story about ${s.name}`)}, 'needs_review'
    from public.p2p_study_subjects s where s.slug = ${q(s.slug)} on conflict do nothing;`);
}
sql.push("commit;", "");
writeFileSync(path.join(repo, "docs", "proposals", "252_study_subjects_drafts_PROPOSED.sql"), sql.join("\n"));

const md = [`# Biblical people and events — review (proposal 252)`, "", `Generated ${new Date().toISOString().slice(0, 10)} from ${snapshot} by \`scripts/build-study-subjects.mjs\`.`, "",
  "Each subject below is a **draft**. Its passages are the narrative references of the P2P Kingdom Story it comes from. Before publishing, an editor should check:", "",
  "1. Is this the right kind (person / event)?", "2. Do the passages really tell this person's or event's story? Remove any that don't; add key passages the story doesn't cover.",
  "3. Is the link to the Kingdom Story right?", "", "Publishing needs two editors: one submits (under review), a different one approves, then publishes.", "",
  `| Subject | Kind | Passages | From |`, `|---|---|---|---|`,
  ...subjects.map((s) => `| ${s.name} | ${s.kind} | ${s.passages.length}${s.more ? ` (+${s.more} not included)` : ""}: ${s.passages.slice(0, 6).map(L.passageDisplay).join("; ")}${s.passages.length > 6 ? "; …" : ""} | ${s.story.title} |`),
  "", problems.length ? `## Problems found (${problems.length})\n\n${problems.map((p) => `- ${p}`).join("\n")}` : "## Problems found\n\nNone: every reference was read, and every verse range was checked against verse numbers.", ""];
writeFileSync(path.join(repo, "docs", "study-subjects-review.md"), md.join("\n"));
console.log(`${subjects.length} subjects (${subjects.filter((s) => s.kind === "person").length} people, ${subjects.filter((s) => s.kind === "event").length} events), ${subjects.reduce((n, s) => n + s.passages.length, 0)} passages; problems: ${problems.length}`);
for (const p of problems) console.log("  -", p);
process.exit(problems.length ? 1 : 0);
