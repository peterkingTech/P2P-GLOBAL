// P2P PLANS — prepared plans (data/study-plans/*.json) → checked, then written as a PROPOSED seed of DRAFTS.
//   node scripts/build-study-plans.mjs [--offline]
// 1. Every session goes through the SAME rules as the API (src/lib/studyPlans.ts validateSession).
// 2. Every Scripture reference (main passages and passage-type supporting resources) is checked against a
//    real Bible text: the chapter is read from the Free Use Bible API (bible.helloao.org, Berean Standard
//    Bible) and the book, chapter, start AND end verse must exist. Only verse NUMBERS are cached
//    (data/study-plans/verse-counts.json) — never Bible text. This checks references, not whether a
//    question suits its passage: that is the editors' review (docs/p2p-plans-review.md).
// 3. Writes docs/proposals/250_p2p_plans_prepared_drafts_PROPOSED.sql (every plan as an official DRAFT —
//    nothing published) and docs/p2p-plans-review.md. Exit code 1 if anything fails.
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The SAME rules as the API: bundle src/lib/studyPlans.ts (+ scriptureTopics) and import it.
const { buildSync } = createRequire(import.meta.url)("esbuild");
const bundled = path.join(here, ".study-plans-lib.mjs");
buildSync({ stdin: { contents: "export * from './src/lib/studyPlans'; export { parsePassage } from './src/lib/scriptureTopics';", resolveDir: path.join(here, ".."), loader: "ts" }, bundle: true, format: "esm", platform: "node", outfile: bundled, logLevel: "silent" });
const { parsePassage, validateSession, passageDisplay, resourceKinds } = await import(pathToFileURL(bundled).href);
(await import("node:fs")).rmSync(bundled);
const dir = path.join(here, "..", "data", "study-plans");
const repo = path.join(here, "..", "..", "..");
const offline = process.argv.includes("--offline");
const countsFile = path.join(dir, "verse-counts.json");
const counts = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, "utf8")) : { chapters: {} };
counts.source = "bible.helloao.org/api/BSB (Berean Standard Bible) — last verse number per chapter only";

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
      return (counts.chapters[key] = nums.length ? Math.max(...nums) : 0);
    } catch (e) { if (attempt === 2) throw e; await new Promise((res) => setTimeout(res, 800)); }
  }
}

const problems = [];
const plans = [];
let checkedRefs = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "verse-counts.json").sort()) {
  const j = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
  const sessions = [];
  for (const [i, s] of (j.sessions ?? []).entries()) {
    const passages = [];
    for (const raw of s.passages ?? []) {
      const p = parsePassage(`${raw} | x | teaching`);
      if (!p.ok) { problems.push(`${f} #${i + 1}: ${raw} — ${p.reason}`); continue; }
      passages.push({ book: p.code, chapter: p.chapter, startVerse: p.startVerse, endVerse: p.endVerse });
    }
    const v = validateSession({ ...s, passages });
    if (!v.ok) { problems.push(`${f} #${i + 1}: ${v.error}`); continue; }
    sessions.push(v.value);
  }
  for (const [i, s] of sessions.entries()) {
    const refs = [...s.passages, ...s.supporting.filter((r) => "book" in r && r.startVerse)];
    for (const r of refs) {
      checkedRefs++;
      const last = await lastVerse(r.book, r.chapter);
      if (last === null) problems.push(`${f} #${i + 1}: ${passageDisplay(r)} — not checked (offline, chapter not cached)`);
      else if (!last) problems.push(`${f} #${i + 1}: ${passageDisplay(r)} — chapter not found in the Bible text`);
      else if ((r.endVerse ?? r.startVerse ?? 1) > last) problems.push(`${f} #${i + 1}: ${passageDisplay(r)} — the chapter ends at verse ${last}`);
    }
  }
  if (!j.derivedFrom && !sessions.length) problems.push(`${f}: no sessions`);
  plans.push({ file: f, ...j, sessions });
}
counts.chapters = Object.fromEntries(Object.entries(counts.chapters).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(countsFile, JSON.stringify(counts, null, 1) + "\n");
if (problems.length) { console.log(problems.join("\n")); console.log(`${problems.length} problem(s); nothing written.`); process.exit(1); }

// ── SQL (drafts only; idempotent: a plan whose slug exists is left alone, with its sessions) ──
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const js = (v) => `${q(JSON.stringify(v))}::jsonb`;
let sql = `-- 250 (PROPOSED — NOT APPLIED; apply only AFTER 249 and after the owner approves): the prepared P2P plans as
-- official DRAFTS for editorial review (docs/p2p-plans-review.md). Generated by
-- artifacts/api-server/scripts/build-study-plans.mjs from artifacts/api-server/data/study-plans/*.json — do not edit by hand.
-- Nothing is published: editors move each plan through under_review → approved (by a different editor) →
-- published in the API. Every Scripture reference was checked against the BSB text (book, chapter, verses).
-- Idempotent: a plan whose slug already exists is skipped together with its sessions.
begin;
`;
for (const p of plans) {
  const kind = p.derivedFrom ? "structured" : resourceKinds(p.sessions).primary.every((k) => k === "bible_passage") ? "scripture" : "mixed";
  sql += `\n-- ${p.title} (${p.derivedFrom ? "sessions = the real lessons, read live" : `${p.sessions.length} sessions`})\n`;
  sql += `insert into public.p2p_study_plans (slug, title, description, focus_type, focus_ref, focus_label, plan_kind, collection, derived_from, origin, editorial_status, objectives, suggested_pace, suggested_days)
values (${q(p.slug)}, ${q(p.title)}, ${q(p.description)}, ${q(p.focusType)}, ${js(p.focusRef ?? {})}, ${q(p.focusLabel)}, ${q(kind)}, ${q(p.collection)}, ${p.derivedFrom ? js(p.derivedFrom) : "null"}, 'p2p', 'draft', ${js(p.objectives ?? [])}, ${q(p.suggestedPace)}, ${p.suggestedDays ?? "null"})
on conflict (slug) where slug is not null do nothing;\n`;
  if (p.sessions.length) {
    sql += `insert into public.p2p_study_plan_sessions (plan_id, position, title, intro, passages, supporting, questions)
select pl.id, s.position, s.title, s.intro, s.passages, s.supporting, s.questions
from public.p2p_study_plans pl, (values\n`;
    sql += p.sessions.map((s, i) => `  (${i + 1}, ${q(s.title)}, ${q(s.intro)}, ${js(s.passages)}, ${js(s.supporting)}, ${js(s.questions)})`).join(",\n");
    sql += `\n) as s(position, title, intro, passages, supporting, questions)
where pl.slug = ${q(p.slug)} and not exists (select 1 from public.p2p_study_plan_sessions x where x.plan_id = pl.id);\n`;
  }
}
sql += "\ncommit;\n";
writeFileSync(path.join(repo, "docs", "proposals", "250_p2p_plans_prepared_drafts_PROPOSED.sql"), sql);

// ── Review document for editors ──
const KIND = { observe: "Understanding the passage", context: "Context", interpret: "Interpretation", consider: "Personal consideration", apply: "Practical application" };
let md = `# P2P Plans — prepared plans for editorial review\n\nGenerated from \`artifacts/api-server/data/study-plans/\` by \`scripts/build-study-plans.mjs\`. **Status: every plan is a DRAFT.** Nothing is published until an editor submits it and a *different* editor approves it in the API.\n\nEvery Scripture reference (${checkedRefs}) was checked against the Berean Standard Bible text (book, chapter and verse numbers exist). That check does **not** confirm that each question suits its passage or that the intro is accurate — that is what this review is for. Please check each session for: questions that match the passage and its context; no verse taken out of context; descriptive events not presented as commands; promises not presented as universal guarantees; supporting resources that genuinely relate.\n\n`;
for (const p of plans) {
  md += `## ${p.title}\n\n*${p.description}*\n\n- Main focus: **${p.focusLabel}** (${p.focusType}) · collection: ${p.collection} · suggested: ${p.suggestedPace}, ${p.suggestedDays} days\n`;
  if (p.derivedFrom) { md += `- Sessions: the real Kingdom School Foundations lessons, read live in curriculum order (nothing copied). No questions are added: each lesson keeps its own content and assessment.\n\n`; continue; }
  md += `- ${p.sessions.length} sessions · ${p.sessions.reduce((n, s) => n + s.questions.length, 0)} questions\n\n`;
  for (const [i, s] of p.sessions.entries()) {
    md += `### ${i + 1}. ${s.title} — ${s.passages.map(passageDisplay).join("; ")}\n\n${s.intro ?? ""}\n\n`;
    for (const qn of s.questions) md += `- *${KIND[qn.kind]}:* ${qn.text}\n`;
    if (s.supporting.length) md += `\nSupporting: ${s.supporting.map((r) => `${r.kind}${"book" in r ? ` ${passageDisplay(r)}` : "strongs" in r ? ` ${r.strongs}` : "slug" in r ? ` ${r.slug}` : ""}${r.note ? ` (${r.note})` : ""}`).join("; ")}\n`;
    md += "\n- [ ] Reviewed\n\n";
  }
}
writeFileSync(path.join(repo, "docs", "p2p-plans-review.md"), md);
console.log(`${plans.length} plans, ${plans.reduce((n, p) => n + p.sessions.length, 0)} sessions, ${checkedRefs} references checked against the BSB text. Wrote 250 (drafts) and docs/p2p-plans-review.md.`);
