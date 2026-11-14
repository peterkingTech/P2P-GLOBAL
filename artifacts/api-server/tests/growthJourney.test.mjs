// Your growth milestones (migrations 235–239) — routes/growth.ts over HTTP with
// an in-memory database, plus lib/growthStages.ts:
//   • signed out → 401; only ever the caller's own journey;
//   • a first visit (or a checklist from an older calculation) asks the engine to re-check;
//   • the next milestone's checklist is grouped by the FOUR dimensions —
//     Consistency, Learning, Application, Service & Contribution — each item
//     with what counts and what is still missing; no percentages anywhere;
//   • the exact explanation and disclaimer; what has been verified so far;
//   • pauses (start/resume) and the collective-country opt-in, for the caller only;
//   • my evidence: kinds and dates, never content;
//   • Forest Builder is the highest personal stage; Forest of Nations is collective;
//   • the official names and Scripture match the app's.
// Run: node tests/growthJourney.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const checklist = {
  calc_version: 2,
  facts: { active_weeks: 7, active_months: 3, learning_units: 12, core_lessons_passed: 4, core_lessons_total: 84, application_actions: 5, contributions: 21, pending_review: 1, paused_now: false, today_local: "2026-11-05" },
  stages: [
    { stage: 2, met: true, requirements: [{ key: "learning_units", dimension: "learning", label: "10 learning units passed", have: 12, need: 10, met: true }] },
    { stage: 3, met: false, requirements: [
      { key: "days_in_stage", dimension: "consistency", label: "At least 3 months as a Sprout", explanation: "Time at your current milestone.", have: 35, need: 90, met: false, note: null },
      { key: "active_weeks_window", dimension: "consistency", label: "Active in 10 of your latest 16 weeks", have: 10, need: 10, met: true },
      { key: "learning_units", dimension: "learning", label: "20 learning units passed", explanation: "A lesson counts once, when its assessment has been passed.", have: 12, need: 20, met: false },
      { key: "application_actions", dimension: "application", label: "20 verified practical actions", have: 5, need: 20, met: false },
      { key: "contributions", dimension: "service", label: "20 verified contributions", have: 21, need: 20, met: true },
    ] },
  ],
};
const T = {
  p2p_growth_status: [{ user_id: "ann", stage: 2, stage_since: "2026-10-01T00:00:00Z", verification: "legacy_unverified", legacy_note: "Recognised from the previous growth system", eligible_stage: 2, checklist, evaluated_at: "2026-11-04T00:00:00Z", calc_version: 2 }],
  p2p_growth_settings: [{ thresholds_status: "draft", promotions_enabled: false, calc_version: 2 }],
  p2p_growth_history: [{ user_id: "ann", to_stage: 2, achieved_at: "2026-10-01T00:00:00Z", kind: "legacy_import" }],
  p2p_growth_pauses: [{ user_id: "ann", id: "p1", starts_on: "2026-11-01", planned_end_on: "2026-11-20", ended_on: null, reason: "health" }],
  p2p_profiles: [{ id: "ann", share_country_in_collective: false }, { id: "ben", share_country_in_collective: false }],
  p2p_growth_evidence: [
    { user_id: "ann", evidence_type: "learning.assessment_passed", dimension: "learning", credit: true, source_resource: "kingdom_stories", local_date: "2026-10-20", verification: "verified", voided_at: null, occurred_at: "2026-10-20T10:00:00Z", detail: { secret: "x" } },
    { user_id: "ann", evidence_type: "learning.assessment_attempted", dimension: "learning", credit: false, source_resource: "kingdom_school", local_date: "2026-10-19", verification: "verified", voided_at: null, occurred_at: "2026-10-19T10:00:00Z" },
    { user_id: "ben", evidence_type: "service.learning_feedback", dimension: "service", credit: true, source_resource: "evaluation", local_date: "2026-10-18", verification: "verified", voided_at: null, occurred_at: "2026-10-18T10:00:00Z" },
  ],
};
const rpc = [];
let rpcCore = [];
const updates = [];
const db = {
  from(name) {
    const f = [];
    let cols = null;
    const pick = (r) => (cols ? Object.fromEntries(cols.map((c) => [c, r[c]])) : { ...r });
    const rows = () => (T[name] ?? []).filter((x) => f.every((p) => p(x)));
    const q = {
      select(c) { cols = c ? c.split(",").map((x) => x.trim()) : null; return q; }, order() { return q; }, limit() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      update(v) { updates.push([name, v]); q._update = v; return q; },
      async maybeSingle() { const r = rows(); return { data: r[0] ? pick(r[0]) : null, error: null }; },
      then(res) { if (q._update) { rows().forEach((r) => Object.assign(r, q._update)); return Promise.resolve({ data: null, error: null }).then(res); } return Promise.resolve({ data: rows().map(pick), error: null }).then(res); },
    };
    return q;
  },
  async rpc(fn, args) {
    rpc.push([fn, args]);
    if (fn === "p2p_growth_recalculate") T.p2p_growth_status.push({ user_id: args.p_user, stage: 1, stage_since: "2026-11-04T00:00:00Z", verification: "verified", legacy_note: null, eligible_stage: 1, checklist: { stages: [], facts: {} }, evaluated_at: "2026-11-04T00:00:00Z", calc_version: 2 });
    if (fn === "p2p_growth_pause_start") return args.p_ends < args.p_starts ? { data: null, error: { message: "P2P_GROWTH_PAUSE: choose a start and an end date" } } : { data: "new-pause", error: null };
    if (fn === "p2p_growth_pause_end") return { data: null, error: null };
    if (fn === "p2p_core_curriculum_progress") return { data: rpcCore, error: null };
    return { data: null, error: null };
  },
};
globalThis.__gj = db;

const tmpDir = path.join(root, "tests", `.tmp-growth-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__gj; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;" }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/growth.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, "growth.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const app = express(); app.use(express.json()); app.use("/growth", (await import(pathToFileURL(f).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/growth`;
  const as = (u, p = "", init = {}) => fetch(base + p, { ...init, headers: { "x-test-user": u, "content-type": "application/json", ...(init.headers ?? {}) } });

  let r = await fetch(base + "/me");
  ok("signed out → 401", r.status === 401);
  r = await as("ann", "/me");
  const j = await r.json();
  ok("Ann's own journey: Sprout, recognised (legacy) with the reason, since 1 Oct", j.stage.name === "Sprout" && j.stage.verification === "legacy_unverified" && /previous growth/.test(j.stage.legacyNote) && j.stage.since.startsWith("2026-10-01"));
  ok("…with the milestone's own neutral description and Scripture", j.stage.verseRef === "Psalm 1:3" && /assessed learning/.test(j.stage.description));
  ok("the exact explanation and disclaimer", j.explanation === "Growth milestones celebrate how you take part in P2P Global: how consistently you participate, what you learn, how you put learning into practice, and how you help others learn. They are a record of participation and contribution on P2P Global — nothing more."
    && j.disclaimer === "These milestones do not measure your relationship with God, your faith, or your worth. Only God knows the heart. They simply recognise the activity you've chosen to record here.");
  const dims = Object.fromEntries(j.next.dimensions.map((d) => [d.dimension, d]));
  ok("next milestone (Young Tree): checklist grouped by the FOUR dimensions, labelled plainly", j.next.name === "Young Tree"
    && ["consistency", "learning", "application", "service"].every((k) => dims[k]) && dims.service.label === "Service & Contribution" && j.next.dimensions.length === 4);
  ok("…each dimension judged on its own: service met, the others not; one never compensates", dims.service.met && !dims.learning.met && !dims.application.met && !dims.consistency.met);
  const units = dims.learning.items[0];
  ok("…each item says what counts and what is still missing (counts, not percentages)", units.have === 12 && units.need === 20 && units.missing === "8 more learning units to go" && /assessment/.test(units.explanation));
  ok("…met items have nothing missing", dims.service.items[0].missing === null);
  ok("what has been verified so far, as counts", j.verified.learningUnits === 12 && j.verified.practicalActions === 5 && j.verified.contributions === 21 && j.verified.activeWeeks === 7
    && j.verified.coreLessons.passed === 4 && j.verified.coreLessons.total === 84 && j.verified.pendingReview === 1);
  ok("each requirement shows its own fraction and percentage (10 of 20 → 50%), and what remains", units.percent === 60 && units.remaining === 8 && dims.service.items[0].percent === 100);
  ok("no overall average across dimensions anywhere (no dimension can make up for another)", !/overall|average/i.test(JSON.stringify(j)) && j.next.dimensions.every((d) => !("percent" in d)));
  ok("the current stage's objective, and the next stage's", j.stage.objective.title === "Develop and strengthen" && /helping others/.test(j.stage.objective.objective) && j.next.objective.title === "Become established and help others" && j.next.objective.focus.length === 5);
  ok("Forest of Nations is a collective objective, never a personal stage", /never an individual stage/.test(j.collective.objective.objective));
  ok("Core Foundations progress is visible at every stage (4 / 84 — 4%)", j.verified.coreLessons.passed === 4 && j.verified.coreLessons.total === 84 && j.verified.coreLessons.percent === 4);
  ok("no spiritual-measurement wording in the answer", !/spiritual fruit|spiritual growth|maturity/i.test(JSON.stringify(j)));
  ok("Forest of Nations is the collective view, said plainly", j.collective.name === "Forest of Nations" && /not a personal stage/.test(j.collective.note));
  ok("milestones still a draft; promotions off; calculation version 2", j.milestones === "draft" && j.promotionsEnabled === false && j.calcVersion === 2);
  ok("later milestones (How My Tree Grows): the engine's checklists for the stages after the next, never past Forest Builder",
    Array.isArray(j.later) && j.later.map((x) => x.name).join() === "Fruitful Tree,Forest Builder" && j.later.every((x) => x.dimensions.length === 4) && !JSON.stringify(j.later).includes("Forest of Nations"));
  ok("…a stage the engine has no checklist for yet shows no requirements (never invented)", j.later[0].dimensions.every((d) => !d.required && d.items.length === 0));
  ok("history: the stages reached, with how", j.history.length === 1 && j.history[0].name === "Sprout" && j.history[0].kind === "legacy_import");
  ok("the current pause is shown", j.pauses.length === 1 && j.pauses[0].current && j.pauses[0].endsOn === "2026-11-20");
  ok("an up-to-date checklist is not recalculated on view", !rpc.some(([fn, a]) => fn === "p2p_growth_recalculate" && a.p_user === "ann"));

  r = await as("new-person", "/me");
  const n = await r.json();
  ok("first visit (a new account): the engine records it, Seed", r.status === 200 && rpc.some(([fn, a]) => fn === "p2p_growth_recalculate" && a.p_user === "new-person") && n.stage.name === "Seed");

  // My evidence: kinds and dates, only mine, never content.
  r = await as("ann", "/me/evidence");
  const ev = (await r.json()).evidence;
  ok("my evidence: only my own records, kinds and dates", ev.length === 2 && ev.every((e) => e.date && e.label) && ev[0].label === "Learning unit passed" && ev[0].counts === true && ev[1].counts === false);
  ok("…never content or internal detail", !/secret|detail|source_id|text/.test(JSON.stringify(ev)));

  // Pauses and the collective-country opt-in — always the caller's own.
  r = await as("ann", "/me/pause", { method: "POST", body: JSON.stringify({ startsOn: "2026-11-10", endsOn: "2026-11-24", reason: "travel" }) });
  ok("pause: started for the caller only", r.status === 200 && rpc.some(([fn, a]) => fn === "p2p_growth_pause_start" && a.p_user === "ann" && a.p_reason === "travel"));
  r = await as("ann", "/me/pause", { method: "POST", body: JSON.stringify({ startsOn: "soon", endsOn: "later" }) });
  ok("pause: dates are required", r.status === 400);
  r = await as("ann", "/me/pause", { method: "POST", body: JSON.stringify({ startsOn: "2026-11-24", endsOn: "2026-11-10" }) });
  ok("pause: the engine's refusal is passed on plainly", r.status === 409 && /start and an end/.test((await r.json()).error));
  r = await as("ann", "/me/pause/p1/end", { method: "POST" });
  ok("pause: resume early (the caller's own pause)", r.status === 200 && rpc.some(([fn, a]) => fn === "p2p_growth_pause_end" && a.p_user === "ann" && a.p_pause === "p1"));
  r = await as("ann", "/me/collective-country", { method: "PUT", body: JSON.stringify({ share: true }) });
  ok("collective country: an explicit opt-in, saved for the caller only", r.status === 200 && T.p2p_profiles.find((p) => p.id === "ann").share_country_in_collective === true && T.p2p_profiles.find((p) => p.id === "ben").share_country_in_collective === false);
  r = await as("ann", "/me/collective-country", { method: "PUT", body: JSON.stringify({ share: "yes" }) });
  ok("collective country: needs a true/false answer", r.status === 400);
  // Kingdom School Foundations: every lesson of every published Kingdom School curriculum, with its status.
  const O = { curriculum_id: "c1", curriculum_title: "Peer-to-Peer Orientation" }, G = { curriculum_id: "c2", curriculum_title: "The Gospel & Salvation" }, F = { curriculum_id: "c3", curriculum_title: "The Christian Foundation" };
  rpcCore = [
    { ...O, lesson_id: "o1", title: "Welcome", module_id: "m0", module_title: "Orientation", status: "answer_again", passed_at: null },
    { ...G, lesson_id: "l1", title: "Grace", module_id: "m1", module_title: "Salvation", status: "passed", passed_at: "2026-10-01" },
    { ...G, lesson_id: "l2", title: "Faith", module_id: "m1", module_title: "Salvation", status: "awaiting_evaluation", passed_at: null },
    { ...G, lesson_id: "l3", title: "Repentance", module_id: "m2", module_title: "New life", status: "returned", passed_at: null },
    { ...F, lesson_id: "l4", title: "Identity", module_id: "m3", module_title: "Your identity", status: "not_started", passed_at: null },
  ];
  r = await as("ann", "/me/core-foundations");
  const cf = await r.json();
  ok("Foundations: every lesson of every Kingdom School curriculum, grouped by curriculum and module; only passed lessons count",
    r.status === 200 && cf.name === "Kingdom School Foundations" && cf.passed === 1 && cf.total === 5 && cf.percent === 20 && cf.outstanding === 4
    && cf.curricula.map((c) => c.title).join("|") === "Peer-to-Peer Orientation|The Gospel & Salvation|The Christian Foundation" && cf.curricula[1].passed === 1 && cf.curricula[1].total === 3 && cf.curricula[1].modules.length === 2
    && rpc.some(([fn, a]) => fn === "p2p_core_curriculum_progress" && a.p_user === "ann"));
  ok("Foundations: plain status labels, including 'answer again' after the fresh start; the next lesson to continue",
    cf.curricula[0].modules[0].lessons[0].statusLabel === "Answer the check again for a fresh evaluation" && cf.curricula[1].modules[0].lessons[1].statusLabel === "Awaiting evaluation" && cf.next.id === "o1");
  ok("only the caller's own data is ever read (no user id in the URL)", !/:userId|req\.params\.user/.test(readFileSync(path.join(root, "src/routes/growth.ts"), "utf8")));
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── lib/growthStages ──
const lib = await (async () => {
  const out = await build({ entryPoints: [path.join(root, "src/lib/growthStages.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const f = path.join(root, "tests", `.tmp-gs-${process.pid}.mjs`); writeFileSync(f, out.outputFiles[0].text);
  try { return await import(pathToFileURL(f).href); } finally { rmSync(f, { force: true }); }
})();
ok("personal milestones: exactly Seed, Sprout, Young Tree, Fruitful Tree, Forest Builder", lib.PERSONAL_STAGES.map((s) => s.name).join("|") === "Seed|Sprout|Young Tree|Fruitful Tree|Forest Builder");
ok("stage keys are stable for older builds", lib.PERSONAL_STAGES[0].key === "dormant_seed" && lib.PERSONAL_STAGES[4].key === "forest_builder");
ok("percentages: whole numbers, capped at 100, and a zero requirement never divides by zero", lib.percentOf(1, 5) === 20 && lib.percentOf(7, 20) === 35 && lib.percentOf(30, 20) === 100 && lib.percentOf(0, 0) === 100 && lib.percentOf(0, 20) === 0);
ok("every individual stage has an objective, growing from foundations to generational impact; none claims spiritual maturity",
  [1, 2, 3, 4, 5].every((n) => lib.stageObjective(n).focus.length >= 5) && lib.stageObjective(5).focus[0].includes("every Kingdom School Foundations lesson") && !/spiritual|maturity|faith|holy/i.test(JSON.stringify(lib.STAGE_OBJECTIVES)));
ok("four dimensions, no 'spiritual fruit'", JSON.stringify(Object.keys(lib.DIMENSIONS)) === '["consistency","learning","application","service"]' && !/fruit|spiritual/i.test(JSON.stringify(lib.DIMENSIONS)));
ok("descriptions make no claims about anyone's inner life", lib.PERSONAL_STAGES.every((s) => !/belief|abiding|habits of prayer|spiritual|faith|maturity/i.test(s.description)));
ok("old points → personal stage; Forest of Nations points count as Forest Builder", [0, 4, 12, 28, 60, 115].map(lib.personalStageFromPoints).join() === "1,2,3,4,5,5");
const app = readFileSync(path.join(repo, "artifacts/mobile/constants/stages.ts"), "utf8");
ok("names, descriptions and Scripture match the app", [...lib.PERSONAL_STAGES, lib.COLLECTIVE_STAGE].every((s) => app.includes(`name: "${s.name}"`) && app.includes(s.description) && app.includes(s.verseRef)));
const gapp = readFileSync(path.join(repo, "artifacts/mobile/lib/growthApi.ts"), "utf8");
ok("the app shows the same explanation and disclaimer offline", gapp.includes(lib.MILESTONE_EXPLANATION) && gapp.includes(lib.MILESTONE_DISCLAIMER.replace(/'/g, "'")));
ok("the stage-reached notification is categorised", /growth_stage_reached: "fruit"/.test(readFileSync(path.join(root, "src/lib/notificationCategories.ts"), "utf8")));

console.log(`growthJourney: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
