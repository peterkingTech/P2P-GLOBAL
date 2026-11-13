// My Growth Tree data — GET /growth/me/tree (routes/growth.ts) over HTTP with an in-memory database.
// The tree is a VIEW of what the Growth Milestone Matrix already verified, never a second score:
//   • one fruit per Service & Contribution ledger record (the ledger's dedup_key: one action, one record);
//   • a group session is ONE fruit for its facilitator, however many attended (attendees only counted);
//   • withdrawn / rejected / pending records stay in the history but are never verified fruit;
//   • branches only from verified, credited evidence; roots/stems from the Matrix's own facts;
//   • seeds: people I helped who now help others, with the DATE only — no names, no content;
//   • reading the tree never recalculates or changes a stage (no engine call, no writes).
// Run: node tests/growthTree.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const ev = (id, user, type, dimension, date, extra = {}) => ({ id, user_id: user, evidence_type: type, dimension, credit: true, source_resource: "evaluation", local_date: date, occurred_at: `${date}T10:00:00Z`, verification: "verified", voided_at: null, ...extra });
const T = {
  p2p_growth_status: [{ user_id: "ann", stage: 3, stage_since: "2026-09-01T00:00:00Z", verification: "verified", legacy_note: null, eligible_stage: 3, evaluated_at: "2026-11-01T00:00:00Z", calc_version: 2,
    checklist: { calc_version: 2, facts: { active_weeks: 30, active_months: 8, learning_units: 41, core_lessons_passed: 20, core_lessons_total: 84, application_actions: 22, contributions: 3 } } }],
  p2p_growth_history: [{ user_id: "ann", to_stage: 2, achieved_at: "2026-05-01T00:00:00Z", kind: "verified" }, { user_id: "ann", to_stage: 3, achieved_at: "2026-09-01T00:00:00Z", kind: "verified" }],
  p2p_growth_evidence: [
    ev("e1", "ann", "service.learning_feedback", "service", "2026-06-10"),
    ev("e2", "ann", "service.study_session_facilitated", "service", "2026-07-02", { source_resource: "study_together" }),
    ev("e3", "ann", "service.peer_confirmed_support", "service", "2026-08-15", { source_resource: "peer_confirmation" }),
    ev("e4", "ann", "service.learning_feedback", "service", "2026-09-03", { voided_at: "2026-09-10T00:00:00Z", void_reason: "duplicate review" }),
    ev("e5", "ann", "service.learning_feedback", "service", "2026-10-01", { verification: "pending_review" }),
    ev("e6", "ann", "service.peer_confirmed_support", "service", "2026-10-05", { verification: "rejected" }),
    ev("e7", "ann", "learning.assessment_passed", "learning", "2026-04-01", { source_resource: "kingdom_school" }),
    ev("e8", "ann", "learning.assessment_attempted", "learning", "2026-04-02", { source_resource: "kingdom_stories", credit: false }),
    ev("b1", "ben", "service.learning_feedback", "service", "2026-10-18"),
    ev("b0", "ben", "service.learning_feedback", "service", "2026-10-11", { verification: "rejected" }),
    ev("c1", "cat", "learning.assessment_passed", "learning", "2026-10-20"),
  ],
  // e2: a study session Ann led — five people attended.
  p2p_growth_evidence_beneficiaries: ["x1", "x2", "x3", "x4", "x5"].map((k) => ({ evidence_id: "e2", learner_key: k })).concat([{ evidence_id: "e1", learner_key: "ben" }]),
};
const rpc = [], writes = [];
const db = {
  from(name) {
    const f = []; let cols = null;
    const pick = (r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r });
    const rows = () => (T[name] ?? []).filter((x) => f.every((p) => p(x)));
    const q = {
      select(c) { cols = c ? c.split(",").map((x) => x.trim()) : null; return q; }, order() { return q; }, limit() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; }, in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
      update(v) { writes.push([name, v]); return q; }, insert(v) { writes.push([name, v]); return q; }, delete() { writes.push([name, "delete"]); return q; },
      async maybeSingle() { const r = rows(); return { data: r[0] ? pick(r[0]) : null, error: null }; },
      then(res) { return Promise.resolve({ data: rows().map(pick), error: null }).then(res); },
    };
    return q;
  },
  async rpc(fn, args) {
    rpc.push([fn, args]);
    if (fn === "p2p_development_history" && args.p_person === "ann") return { data: { helped: [{ personId: "ben", contributions: 1, helpsOthers: true }, { personId: "cat", contributions: 2, helpsOthers: false }] }, error: null };
    return { data: null, error: null };
  },
};
globalThis.__gt = db;
const tmpDir = path.join(root, "tests", `.tmp-tree-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__gt; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;" }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/growth.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, "growth.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const app = express(); app.use("/growth", (await import(pathToFileURL(f).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/growth`;
  const as = (u) => fetch(base + "/me/tree", { headers: u ? { "x-test-user": u } : {} });

  ok("signed out → 401", (await as(null)).status === 401);
  const r = await as("ann");
  const j = await r.json();
  ok("200 for the participant", r.status === 200, JSON.stringify(j).slice(0, 200));

  // Trunk & roots come straight from the Matrix.
  ok("trunk: the verified stage (Young Tree) and its dated history", j.stage.name === "Young Tree" && j.history.map((h) => h.name).join() === "Sprout,Young Tree");
  ok("roots: Foundations 20/84, learning units, active weeks and months — the Matrix's facts", j.roots.coreLessons.passed === 20 && j.roots.coreLessons.total === 84 && j.roots.learningUnits === 41 && j.roots.activeWeeks === 30 && j.roots.activeMonths === 8);
  ok("stems: verified practical actions", j.stems.practicalActions === 22);

  // Fruits.
  ok("one fruit per Service & Contribution record (6), unique ids, nothing from learning evidence", j.fruits.length === 6 && new Set(j.fruits.map((x) => x.id)).size === 6 && j.fruits.every((x) => x.type.startsWith("service.")));
  const led = j.fruits.find((x) => x.id === "e2");
  ok("a group session is ONE fruit for its facilitator — the 5 attendees are a count, not 5 fruits", led.kind === "group" && led.peopleHelped === 5 && j.fruits.filter((x) => x.type === "service.study_session_facilitated").length === 1);
  ok("an individual contribution is its own fruit", j.fruits.find((x) => x.id === "e1").kind === "individual");
  ok("verified fruit: only verified, credited, not withdrawn (3)", j.fruitTotals.verified === 3 && ["e1", "e2", "e3"].every((id) => j.fruits.find((x) => x.id === id).countsTowardMilestone));
  ok("withdrawn, pending and rejected stay in the history but never count", j.fruits.find((x) => x.id === "e4").status === "withdrawn" && !j.fruits.find((x) => x.id === "e4").countsTowardMilestone
    && j.fruits.find((x) => x.id === "e5").status === "pending_review" && j.fruits.find((x) => x.id === "e6").status === "rejected" && j.fruitTotals.withdrawn === 1 && j.fruitTotals.pendingReview === 1 && j.fruitTotals.rejected === 1);
  ok("old fruit stays: a contribution from months ago is still there (inactivity erases nothing)", j.fruits.some((x) => x.id === "e1" && x.date === "2026-06-10" && x.countsTowardMilestone));
  ok("fruit details: type, label, date, area — never content", led.label === "Study session led" && led.areaLabel === "Study Together" && !("text" in led) && !("content" in led) && !("detail" in led));

  // Branches.
  ok("branches only where verified, credited evidence exists", j.branches.some((b) => b.area === "kingdom_school") && !j.branches.some((b) => b.area === "kingdom_stories"));

  // Seeds.
  ok("seeds: people helped, with whether they now help others", j.seeds.length === 2 && j.seeds.filter((s) => s.nowHelpingOthers).length === 1);
  ok("seeds: the date Ben FIRST verifiably helped someone (his rejected record ignored)", j.seeds.find((s) => s.nowHelpingOthers).firstHelpedOthersOn === "2026-10-18");
  ok("seeds: someone helped who hasn't helped others yet has no date (never invented)", j.seeds.find((s) => !s.nowHelpingOthers).firstHelpedOthersOn === null);
  ok("seeds: no names or ids of other people (genealogy screen applies privacy)", !JSON.stringify(j.seeds).includes("ben") && !JSON.stringify(j.seeds).includes("cat"));

  // A view, not a score.
  ok("reading the tree never recalculates or changes anything", !rpc.some(([fn]) => fn === "p2p_growth_recalculate") && writes.length === 0);
  ok("the milestone disclaimer travels with the tree", /do not measure your relationship with God/.test(j.disclaimer));
  ok("another participant gets 404 until they have a journey (no one else's data)", (await as("zed")).status === 404);

  server.close();
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`growthTree (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
