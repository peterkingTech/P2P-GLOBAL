// Admin Centre (Phase 6) — routes/adminCentre.ts over HTTP with an in-memory
// database (synthetic ids):
//   • every route checks its own permission on the server;
//   • the overview is totals from real records — no names, no content;
//   • growth: approving the matrix and switching promotions need a reason and
//     growth.approve_matrix; promotions can't start on a draft; all audited;
//   • relationship corrections need genealogy.correct and a reason, go through
//     the database's own rule (ended, never deleted) with the admin as actor;
//     even viewing someone's relationships is audited.
// Run: node tests/adminCentre.test.mjs
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

const PERMS = { sup: ["dashboard.view", "growth.view", "growth.approve_matrix", "genealogy.view_named", "genealogy.correct", "audit.view", "growth.review_evidence", "growth.correct", "content.manage"], help: ["dashboard.view", "help.manage"] };
const T = {
  p2p_profiles: [{ id: "u1", full_name: "Ann Secret", username: "ann", is_official_account: false, created_at: new Date().toISOString(), last_active_at: new Date().toISOString() }, { id: "u2", full_name: "Ben", username: "ben", is_official_account: false, created_at: "2020-01-01", last_active_at: "2020-01-01" }],
  p2p_discipleship_links: [{ id: "l1", mentor_id: "u1", disciple_id: "u2", status: "active", is_primary: true, started_at: new Date().toISOString(), created_at: new Date().toISOString() }],
  p2p_growth_status: [{ stage: 2, verification: "legacy_unverified" }, { stage: 1, verification: "verified", user_id: "u2", checklist: { stages: [{ stage: 2, met: false, requirements: [{ key: "learning_units", dimension: "learning", label: "10 learning units passed", have: 1, need: 10, met: false }] }], facts: { learning_units: 1, contributions: 0 } } }],
  p2p_growth_settings: [{ id: true, thresholds_status: "draft", promotions_enabled: false, calc_version: 2, legacy_formula_frozen: true }],
  p2p_growth_matrix: [{ calc_version: 2, stage: 2, dimension: "learning", fact_key: "learning_units", min_value: 10, param: null, label: "10 learning units passed", explanation: "x", display_order: 1 },
                      { calc_version: 2, stage: 5, dimension: "learning", fact_key: "core_curriculum_complete", min_value: 84, param: null, label: "Every Core Curriculum lesson passed", explanation: "y", display_order: 4 }],
  p2p_growth_evidence_types: [{ evidence_type: "learning.assessment_passed", dimension: "learning", credit: true }],
  p2p_growth_matrix_changes: [],
  p2p_growth_evidence: [
    { id: "e1", user_id: "u2", evidence_type: "service.peer_confirmed_support", dimension: "service", credit: true, source_resource: "peer_confirmation", source_table: "p2p_peer_confirmations", local_date: "2026-11-01", verification: "pending_review", verification_method: "peer_confirmation", voided_at: null, created_at: "2026-11-01", occurred_at: "2026-11-01", detail: { private: "never" } },
    { id: "e2", user_id: "u2", evidence_type: "learning.assessment_passed", dimension: "learning", credit: true, source_resource: "kingdom_school", source_table: "p2p_lessons", local_date: "2026-10-01", verification: "verified", verification_method: "peer_evaluation", voided_at: null, created_at: "2026-10-01", occurred_at: "2026-10-01" },
  ],
  p2p_growth_pauses: [], p2p_growth_history: [],
  p2p_growth_learner_development: [{ contributor_id: "u2", learner_key: "k1", learner_id: null, support_months: 6, developed: true, onward_months: 3 }],
  p2p_growth_learning_units: [
    { lesson_id: "l1", title: "Core 1", lesson_status: "published", resource: "kingdom_school", is_core: true, assessment_questions: 5, practical_questions: 1 },
    { lesson_id: "l2", title: "Story 1", lesson_status: "published", resource: "kingdom_stories", is_core: false, assessment_questions: 0, practical_questions: 0 },
  ],
  p2p_assignment_questions: [{ id: "q1", is_practical: false }],
  p2p_admin_audit: [], p2p_growth_queue: [], p2p_notifications: [], p2p_growth_events: [], p2p_lesson_evaluations: [], p2p_kingdom_stories: [], p2p_curriculums: [], p2p_families: [], p2p_family_members: [], p2p_churches: [], p2p_church_members: [], p2p_evaluation_events: [],
};
const rpcs = [];
function query(name) {
  const f = []; let upd = null, head = false, cols = null;
  const rows = () => (T[name] ?? []).filter((r) => f.every((p) => p(r)));
  const q = {
    select(c, o) { if (o?.head) head = true; cols = c && c !== "*" ? c.split(",").map((x) => x.trim()) : null; return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { f.push((r) => r[c] === v); return q; }, is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; }, in(c, v) { f.push((r) => v.includes(r[c])); return q; },
    gt(c, v) { f.push((r) => r[c] > v); return q; }, gte(c, v) { f.push((r) => r[c] >= v); return q; }, lt(c, v) { f.push((r) => r[c] < v); return q; },
    ilike(c, v) { f.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()); return q; },
    or(expr) { const ids = [...expr.matchAll(/(mentor_id|disciple_id)\.eq\.([\w-]+)/g)]; f.push((r) => ids.some(([, c, v]) => r[c] === v)); return q; },
    insert(row) { (T[name] ??= []).push({ ...row }); return Promise.resolve({ error: null }); },
    update(v) { upd = v; return q; },
    async maybeSingle() { const r = rows(); return { data: r[0] ? (cols ? Object.fromEntries(cols.map((k) => [k, r[0][k]])) : { ...r[0] }) : null, error: null }; },
    then(res) {
      if (upd) {
        if (name === "p2p_growth_settings" && upd.promotions_enabled === true && (upd.thresholds_status ?? rows()[0].thresholds_status) !== "approved") return Promise.resolve({ error: { message: "violates check constraint p2p_growth_settings_promote_approved" } }).then(res);
        rows().forEach((x) => Object.assign(x, upd)); return Promise.resolve({ error: null }).then(res);
      }
      return Promise.resolve(head ? { count: rows().length, error: null } : { data: rows().map((x) => (cols ? Object.fromEntries(cols.map((k) => [k, x[k]])) : { ...x })), error: null }).then(res);
    },
  };
  return q;
}
const db = {
  from: query,
  async rpc(fn, a) { rpcs.push([fn, a]); if (fn === "p2p_admin_permissions_for") return { data: PERMS[a.p_user] ?? [], error: null };
    if (fn === "p2p_growth_set_threshold") return T.p2p_growth_settings[0].thresholds_status === "draft" ? { data: { stage: a.p_stage, fact: a.p_fact, old: 10, new: a.p_value }, error: null } : { data: null, error: { message: "P2P_GROWTH: thresholds can only change while the matrix is a draft" } };
    if (fn === "p2p_growth_review_evidence") return a.p_actor === "u2" ? { data: null, error: { message: "P2P_GROWTH: nobody reviews their own evidence" } } : { data: { id: a.p_evidence, action: a.p_action }, error: null };
    if (fn === "p2p_growth_exception") return { data: null, error: { message: "P2P_GROWTH: exceptions are switched off" } }; if (fn === "p2p_link_set_status") { const l = T.p2p_discipleship_links.find((x) => x.id === a.p_link); if (!l) return { data: null, error: { message: "P2P_LINK: not found" } }; l.status = "ended"; return { data: "ended", error: null }; } return { data: null, error: null }; },
};
globalThis.__ac = db;

const tmpDir = path.join(root, "tests", `.tmp-admincentre-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mocks = {
  supabase: "export const supabase = globalThis.__ac; export const supabaseServiceRole = globalThis.__ac;",
  adminAuth: "export const requireAdmin = (req, res, next) => { const u = req.headers['x-test-admin']; if (!u) return res.status(401).json({ error: 'Unauthorized.' }); req.adminUserId = u; req.adminRole = u === 'sup' ? 'super_admin' : 'admin_help'; next(); };\n" +
    "export const requirePermission = (p) => async (req, res, next) => { const { data } = await globalThis.__ac.rpc('p2p_admin_permissions_for', { p_user: req.adminUserId }); req.adminPermissions = data; if (!data.includes(p)) return res.status(403).json({ error: 'nope', permission: p }); next(); };",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)(supabase|adminAuth)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/adminCentre.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const file = path.join(tmpDir, "ac.mjs"); writeFileSync(file, out.outputFiles[0].text);
  const app = express(); app.use(express.json()); app.use("/ac", (await import(pathToFileURL(file).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/ac`;
  const call = async (method, p, who, body) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { "x-test-admin": who } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => ({})) }; };

  let r = await call("GET", "/overview");
  ok("not an admin → 401", r.status === 401);
  r = await call("GET", "/overview", "help");
  ok("overview: totals from real records (peers, active, relationships, stages, legacy, milestones)", r.status === 200 && r.j.community.peers === 2 && r.j.community.active7 === 1 && r.j.discipleship.activeRelationships === 1 && r.j.discipleship.generations === 2 && r.j.discipleship.legacyStages === 1 && r.j.discipleship.milestones === "draft");
  ok("…no names, usernames or ids anywhere", !/Ann Secret|"ann"|u1|u2/.test(JSON.stringify(r.j)));
  ok("…recent admin activity only for those who may read the audit", Array.isArray(r.j.recentAdminActivity) && r.j.recentAdminActivity.length === 0);
  r = await call("GET", "/growth", "help");
  ok("growth matrix: admin_help can't see it (403)", r.status === 403);
  r = await call("GET", "/growth", "sup");
  ok("growth matrix: the version-2 requirements with stage names, explanations and the four dimensions", r.status === 200 && r.j.requirements[0].stageName === "Sprout" && r.j.requirements[0].explanation === "x"
    && r.j.requirements[0].data_source === "x" && Object.keys(r.j.dimensions).join() === "consistency,learning,application,service" && r.j.settings.legacy_formula_frozen === true);
  r = await call("PUT", "/growth/threshold", "sup", { stage: 2, factKey: "learning_units", value: 11 });
  ok("threshold change: needs a reason", r.status === 400);
  r = await call("PUT", "/growth/threshold", "help", { stage: 2, factKey: "learning_units", value: 11, reason: "Owner decision" });
  ok("threshold change: needs growth.approve_matrix", r.status === 403);
  r = await call("PUT", "/growth/threshold", "sup", { stage: 2, factKey: "learning_units", value: 11, reason: "Owner decision" });
  ok("threshold change: through the database's central rule, audited with the reason", r.status === 200 && rpcs.some(([f, a]) => f === "p2p_growth_set_threshold" && a.p_actor === "sup" && a.p_value === 11) && T.p2p_admin_audit.at(-1).action === "growth.threshold_changed");
  r = await call("GET", "/growth/person?username=ben", "help");
  ok("why someone qualifies: needs genealogy.view_named", r.status === 403);
  r = await call("GET", "/growth/person?username=@ben", "sup");
  ok("why someone qualifies: checklist with what's missing, provenance counts, contribution network — and the look is audited", r.status === 200 && r.j.status.next[1].items[0].missing === "9 more learning units to go"
    && r.j.provenance["service.peer_confirmed_support"].pending === 1 && r.j.provenance["learning.assessment_passed"].counted === 1
    && r.j.contributionNetwork[0].learnerStillActive === false && !("learner_id" in r.j.contributionNetwork[0]) && T.p2p_admin_audit.at(-1).action === "growth.person_explained", JSON.stringify(r.j).slice(0, 300));
  ok("…never private content", !/never|private/.test(JSON.stringify(r.j.evidence)));
  r = await call("GET", "/growth/evidence/review", "help");
  ok("evidence review: needs growth.review_evidence", r.status === 403);
  r = await call("GET", "/growth/evidence/review", "sup");
  ok("evidence review: what waits for review, by @username only", r.status === 200 && r.j.evidence.length === 1 && r.j.evidence[0].participant === "@ben" && !/Ben"/.test(JSON.stringify(r.j)));
  r = await call("POST", "/growth/evidence/e1/review", "sup", { action: "approve", reason: "x" });
  ok("evidence review: a real reason is required", r.status === 400);
  r = await call("POST", "/growth/evidence/e1/review", "sup", { action: "delete", reason: "Remove it please" });
  ok("evidence review: there is no delete — only approve / reject / void / restore", r.status === 400);
  r = await call("POST", "/growth/evidence/e1/review", "sup", { action: "approve", reason: "Confirmed with both people" });
  ok("evidence review: through the database (permanent review history), audited", r.status === 200 && rpcs.some(([f, a]) => f === "p2p_growth_review_evidence" && a.p_action === "approve" && a.p_actor === "sup") && T.p2p_admin_audit.at(-1).action === "growth.evidence_approve");
  r = await call("POST", "/growth/person/u2/recalculate", "sup");
  ok("recalculate one person: audited", r.status === 200 && rpcs.some(([f, a]) => f === "p2p_growth_recalculate" && a.p_user === "u2") && T.p2p_admin_audit.at(-1).action === "growth.recalculated");
  r = await call("POST", "/growth/reconcile-legacy", "help");
  ok("legacy reconciliation: needs growth.correct", r.status === 403);
  r = await call("GET", "/growth/learning-units", "sup");
  ok("learning units: Core Curriculum audit and units without an assessment", r.status === 200 && r.j.core.publishedLessons === 1 && r.j.core.expected === 1 && r.j.byResource.kingdom_stories.withoutAssessment === 1 && r.j.withoutAssessment.length === 1, JSON.stringify(r.j).slice(0, 300));
  r = await call("PUT", "/growth/questions/q1/practical", "sup", { isPractical: true, reason: "A practical exercise" });
  ok("practical question: set through the existing workflow, audited", r.status === 200 && T.p2p_assignment_questions[0].is_practical === true && T.p2p_admin_audit.at(-1).action === "growth.practical_question_set");
  r = await call("POST", "/growth/exception", "sup", { userId: "u2", toStage: 2, authorisedBy: "other", reason: "A long enough reason for the record" });
  ok("exceptions: refused while switched off (the database decides)", r.status === 409 && /switched off/.test(r.j.error));
  r = await call("PUT", "/growth", "sup", { promotionsEnabled: true });
  ok("changing growth settings needs a reason", r.status === 400);
  r = await call("PUT", "/growth", "sup", { promotionsEnabled: true, reason: "Go" });
  ok("promotions can't start on a draft matrix (plain answer)", r.status === 409 && /approved/.test(r.j.error) && T.p2p_growth_settings[0].promotions_enabled === false);
  r = await call("PUT", "/growth", "help", { approveMatrix: true, reason: "x" });
  ok("only growth.approve_matrix may approve", r.status === 403 && T.p2p_growth_settings[0].thresholds_status === "draft");
  r = await call("PUT", "/growth", "sup", { approveMatrix: true, promotionsEnabled: true, reason: "Owner approved the matrix" });
  ok("approve + switch on: done, audited with before/after and the reason, everyone queued for a re-check", r.status === 200 && T.p2p_growth_settings[0].promotions_enabled === true && T.p2p_admin_audit.at(-1).action === "growth.settings_changed" && T.p2p_admin_audit.at(-1).reason === "Owner approved the matrix" && rpcs.some(([f]) => f === "p2p_growth_reconcile_all"));

  r = await call("GET", "/relationships?username=ann", "help");
  ok("someone's relationships: admin_help can't look (403)", r.status === 403);
  r = await call("GET", "/relationships?username=@ann", "sup");
  ok("…genealogy.view_named can, with names — and the look is audited", r.status === 200 && r.j.relationships[0].discipleName === "Ben" && T.p2p_admin_audit.at(-1).action === "genealogy.relationships_viewed");
  r = await call("POST", "/relationships/l1/end", "sup", { reason: "x" });
  ok("a correction needs a real reason", r.status === 400 && T.p2p_discipleship_links[0].status === "active");
  r = await call("POST", "/relationships/l1/end", "help", { reason: "Duplicate account" });
  ok("only genealogy.correct may correct", r.status === 403);
  r = await call("POST", "/relationships/l1/end", "sup", { reason: "Duplicate account, confirmed with both people" });
  const call1 = rpcs.filter(([f]) => f === "p2p_link_set_status").at(-1)[1];
  ok("correction: ended through the database rule, admin as actor, reason kept with the history; audited", r.status === 200 && call1.p_actor === "sup" && call1.p_status === "ended" && /Administrator correction: Duplicate account/.test(call1.p_reason) && T.p2p_admin_audit.at(-1).action === "genealogy.relationship_ended");
  ok("…nothing was deleted", T.p2p_discipleship_links.length === 1);
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`adminCentre: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
