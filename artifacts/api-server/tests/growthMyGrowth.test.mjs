// My Growth (2026-11-14) — the backwards-compatible additions to GET /growth/me/tree and the new read-only
// GET /growth/me/learning-roots, over HTTP with an in-memory database.
//   • consistency comes from the Matrix's own facts (never recalculated here) + recent QUALIFYING ledger evidence;
//   • application lists Application ledger records — only verified, credited, not withdrawn ones count;
//   • learning milestones: the dated pass that made the 1st/10th… UNIQUE unit — a re-pass never counts twice;
//   • Learning Roots follow the curriculum's own groupings (Foundations curriculum, plan category, Kingdom
//     Stories) — a failed attempt earns nothing, a repeated pass is one unit, practical actions are listed apart;
//   • never content (answers, reflections, messages), never a write, never a recalculation.
// Run: node tests/growthMyGrowth.test.mjs
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

const ev = (id, type, dimension, date, extra = {}) => ({ id, user_id: "ann", evidence_type: type, dimension, credit: true, counts_for_activity: true, unit_key: null, source_resource: "kingdom_school", local_date: date, occurred_at: `${date}T10:00:00Z`, verification: "verified", voided_at: null, detail: {}, ...extra });
const passed = (id, lesson, date, extra = {}) => ev(id, "learning.assessment_passed", "learning", date, { unit_key: `lesson:${lesson}`, detail: { lesson_id: lesson, evaluation_ids: ["secret-eval"] }, ...extra });
const T = {
  p2p_growth_status: [{ user_id: "ann", stage: 2, stage_since: "2026-08-01T00:00:00Z", verification: "verified", legacy_note: null, eligible_stage: 2, evaluated_at: "2026-11-10T00:00:00Z", calc_version: 2,
    checklist: { calc_version: 2, facts: { today_local: "2026-11-14", journey_days: 200, active_weeks: 19, active_months: 6, active_weeks_window: { 16: 9, 26: 14 }, days_in_stage: 105, paused_days_in_stage: 0, paused_now: false,
      learning_units: 11, core_lessons_passed: 3, core_lessons_total: 188, application_actions: 2, contributions: 1, first_activity_at: "2026-04-28T09:00:00Z" } } }],
  p2p_growth_history: [{ user_id: "ann", to_stage: 2, achieved_at: "2026-08-01T00:00:00Z", kind: "automatic" }],
  p2p_growth_evidence: [
    // Learning: L1 passed (core), L1 passed AGAIN via another pathway (same unit), L2 failed then passed, L3 failed only, L4 submitted, plan + story passes.
    passed("p1", "L1", "2026-05-01"),
    passed("p1b", "L1", "2026-06-01", { source_resource: "study_together" }),
    ev("a2", "learning.assessment_attempted", "learning", "2026-05-02", { credit: false, unit_key: "lesson:L2" }),
    ev("f2", "learning.assessment_failed", "learning", "2026-05-03", { credit: false, counts_for_activity: false, unit_key: "lesson:L2" }),
    passed("p2", "L2", "2026-05-09"),
    ev("a3", "learning.assessment_attempted", "learning", "2026-05-10", { credit: false, unit_key: "lesson:L3" }),
    ev("f3", "learning.assessment_failed", "learning", "2026-05-11", { credit: false, counts_for_activity: false, unit_key: "lesson:L3" }),
    ev("a4", "learning.assessment_attempted", "learning", "2026-11-05", { credit: false, unit_key: "lesson:L4" }),
    passed("p5", "P1", "2026-06-05", { source_resource: "learning_plan" }),
    passed("p6", "S1", "2026-06-06", { source_resource: "kingdom_stories" }),
    passed("p7", "LX", "2026-06-07", { voided_at: "2026-06-20T00:00:00Z" }),
    ...Array.from({ length: 6 }, (_, i) => passed(`q${i}`, `Q${i}`, `2026-07-1${i}`, { source_resource: "learning_plan" })),
    // Application: one verified practical on L2, one awaiting review, one withdrawn.
    ev("ap1", "application.practical_answer_approved", "application", "2026-05-09", { unit_key: "question:Q-L2", detail: { lesson_id: "L2" } }),
    ev("ap2", "application.group_practical_reviewed", "application", "2026-11-08", { verification: "pending_review", source_resource: "group_learning" }),
    ev("ap3", "application.peer_confirmed_action", "application", "2026-09-01", { voided_at: "2026-09-03T00:00:00Z" }),
    // Service + recent consistency.
    ev("s1", "service.learning_feedback", "service", "2026-11-10", { source_resource: "evaluation" }),
    ev("c1", "consistency.scripture_listening", "consistency", "2026-11-12", { credit: false, source_resource: "scripture" }),
    ev("c2", "consistency.scripture_listening", "consistency", "2026-11-13", { credit: false, source_resource: "scripture", voided_at: "2026-11-13T12:00:00Z" }),
  ],
  p2p_growth_evidence_beneficiaries: [],
  p2p_lesson_progress: [{ user_id: "ann", lesson_id: "L5", status: "in_progress", progress_percent: 40 }, { user_id: "ann", lesson_id: "L6", status: "not_started", progress_percent: 0 }],
  p2p_lessons: [
    { id: "L1", title: "Who is Jesus?", module_id: "M1" }, { id: "L2", title: "Grace", module_id: "M1" }, { id: "L3", title: "Faith", module_id: "M1" },
    { id: "L4", title: "Baptism", module_id: "M2" }, { id: "L5", title: "Prayer basics", module_id: "M2" }, { id: "L6", title: "Never opened", module_id: "M2" },
    { id: "P1", title: "Leading well", module_id: "MP" }, { id: "S1", title: "Creation, chapter 1", module_id: "MS" }, { id: "LX", title: "Withdrawn pass", module_id: "M1" },
    ...Array.from({ length: 6 }, (_, i) => ({ id: `Q${i}`, title: `Plan lesson ${i}`, module_id: "MQ" })),
  ],
  p2p_modules: [{ id: "M1", title: "The Gospel", curriculum_id: "C1" }, { id: "M2", title: "New Life", curriculum_id: "C2" }, { id: "MP", title: "Week 1", curriculum_id: "CP" }, { id: "MS", title: "Creation", curriculum_id: "CS" }, { id: "MQ", title: "Week 1", curriculum_id: "CQ" }],
  p2p_curriculums: [
    { id: "C1", title: "The Gospel & Salvation", type: "core", parent_category_id: null, tags: [] },
    { id: "C2", title: "The Christian Foundation", type: "core", parent_category_id: null, tags: [] },
    { id: "CP", title: "Servant leadership", type: "plan", parent_category_id: "CAT1", tags: ["ministry_leadership"] },
    { id: "CQ", title: "Uncategorised plan", type: "plan", parent_category_id: null, tags: [] },
    { id: "CS", title: "Creation", type: "kingdom_story", parent_category_id: null, tags: [] },
    { id: "CAT1", title: "Ministry & Leadership", type: "plan_category", parent_category_id: null, tags: ["ministry_leadership"] },
  ],
};
const rpc = [], writes = [];
const db = {
  from(name) {
    const f = []; let cols = null; let ord = null;
    // Supports "alias:json->>key" the way PostgREST does.
    const pick = (r) => (cols ? Object.fromEntries(cols.map((c) => { const m = c.match(/^(\w+):(\w+)->>(\w+)$/); return m ? [m[1], r[m[2]]?.[m[3]] ?? null] : [c, r[c]]; })) : { ...r });
    const rows = () => { const r = (T[name] ?? []).filter((x) => f.every((p) => p(x))); if (ord) r.sort((a, b) => (String(a[ord.c]) < String(b[ord.c]) ? -1 : String(a[ord.c]) > String(b[ord.c]) ? 1 : 0) * (ord.asc ? 1 : -1)); return r; };
    const q = {
      select(c) { cols = c ? c.split(",").map((x) => x.trim()) : null; return q; }, order(c, o) { ord = { c, asc: o?.ascending !== false }; return q; }, limit() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; }, in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
      update(v) { writes.push([name, v]); return q; }, insert(v) { writes.push([name, v]); return q; }, delete() { writes.push([name, "delete"]); return q; },
      async maybeSingle() { const r = rows(); return { data: r[0] ? pick(r[0]) : null, error: null }; },
      then(res) { return Promise.resolve({ data: rows().map(pick), error: null }).then(res); },
    };
    return q;
  },
  async rpc(fn, args) { rpc.push([fn, args]); return { data: fn === "p2p_development_history" ? { helped: [] } : null, error: null }; },
};
globalThis.__gt = db;
const tmpDir = path.join(root, "tests", `.tmp-mygrowth-${process.pid}`);
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
  const get = (p, u = "ann") => fetch(base + p, { headers: u ? { "x-test-user": u } : {} });

  // ── /me/tree additions ──
  const t = await (await get("/me/tree")).json();
  ok("tree: the old fields are all still there (backwards-compatible)", ["stage", "history", "roots", "stems", "branches", "fruits", "fruitTotals", "seeds", "disclaimer", "note"].every((k) => k in t));
  ok("tree: Foundations total comes from the server (188 here), never a hard-coded 84", t.roots.coreLessons.total === 188 && t.roots.coreLessons.passed === 3);
  const c = t.consistency;
  ok("consistency: the Matrix's own facts (weeks, months, days, 16/26-week windows, days at stage)", c.activeWeeks === 19 && c.activeMonths === 6 && c.journeyDays === 200 && c.activeWeeksLast16 === 9 && c.activeWeeksLast26 === 14 && c.daysInStage === 105 && c.pausedNow === false);
  ok("consistency: recent = verified QUALIFYING evidence in the last 14 days (withdrawn and non-activity records excluded)", c.recentDays === 14 && c.recentQualifying === 3, JSON.stringify(c));
  ok("consistency: last qualifying date from the ledger", c.lastQualifyingOn === "2026-11-12", c.lastQualifyingOn);
  ok("application: every Application record, with status; only verified ones count", t.application.length === 3 && t.application.filter((a) => a.countsTowardMilestone).map((a) => a.id).join() === "ap1"
    && t.application.find((a) => a.id === "ap2").status === "pending_review" && t.application.find((a) => a.id === "ap3").status === "withdrawn");
  ok("learning milestones: the 1st and 10th UNIQUE unit, dated (L1's second pass and the withdrawn pass never count)", JSON.stringify(t.learningMilestones) === JSON.stringify([{ units: 1, date: "2026-05-01" }, { units: 10, date: "2026-07-15" }]), JSON.stringify(t.learningMilestones));
  ok("tree: no evaluation ids, answers or other content", !JSON.stringify(t).includes("secret-eval"));
  ok("contributions counted by the Matrix travel with the tree", t.contributionsCounted === 1);

  // ── /me/learning-roots ──
  ok("learning roots: signed out → 401", (await get("/me/learning-roots", null)).status === 401);
  const lr = await (await get("/me/learning-roots")).json();
  const rootOf = (k) => lr.roots.find((r) => r.key === k);
  const gospel = rootOf("foundations:C1"), found = rootOf("foundations:C2"), lead = rootOf("plan_category:ministry_leadership"), stories = rootOf("kingdom_stories"), other = rootOf("plan_category:uncategorised");
  ok("roots follow the curriculum's own groupings (Foundations curricula, plan category, Kingdom Stories)", !!gospel && !!found && !!lead && !!stories && !!other && lr.roots.length === 5, lr.roots.map((r) => r.key).join());
  ok("plan category root uses the approved category's title", lead.title === "Ministry & Leadership" && lead.source === "plan_category" && lead.categorySlug === "ministry_leadership");
  ok("Foundations roots keep their curriculum titles", gospel.title === "The Gospel & Salvation" && gospel.source === "foundations_curriculum");
  const st = (r, id) => r.lessons.find((l) => l.id === id)?.status;
  ok("a lesson passed twice (two pathways) is ONE unit", gospel.lessons.filter((l) => l.id === "L1").length === 1 && st(gospel, "L1") === "passed");
  ok("failed then passed → passed (credit only after the successful pass)", st(gospel, "L2") === "passed" && gospel.lessons.find((l) => l.id === "L2").passedOn === "2026-05-09");
  ok("failed only → returned, earns nothing", st(gospel, "L3") === "returned" && gospel.passed === 2);
  ok("a withdrawn pass earns nothing", st(gospel, "LX") !== "passed");
  ok("submitted answers → awaiting assessment; progress only → in progress; never opened → absent", st(found, "L4") === "submitted" && st(found, "L5") === "in_progress" && !found.lessons.some((l) => l.id === "L6"));
  ok("counts per root (passed / submitted / returned / in progress)", gospel.passed === 2 && gospel.returned === 1 && found.submitted === 1 && found.inProgress === 1 && stories.passed === 1 && lead.passed === 1);
  ok("practical actions are listed apart (verified ones only)", gospel.practicalVerified === 1 && gospel.lessons.find((l) => l.id === "L2").practicalVerified === 1);
  ok("totals: unique passed units across roots (no double counting)", lr.totals.passed === 10, String(lr.totals.passed));
  ok("themes: the proposed theme mapping is NOT applied (pending owner review)", lr.themesStatus === "pending_review");
  ok("learning roots: no content or evaluation ids", !JSON.stringify(lr).includes("secret-eval") && !/answer|reflection/i.test(JSON.stringify(lr.roots)));
  ok("nothing written, nothing recalculated", writes.length === 0 && !rpc.some(([fn]) => fn === "p2p_growth_recalculate"));

  server.close();
} catch (e) {
  fail++; console.log("FAIL crashed", e?.stack ?? e);
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`growthMyGrowth (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
