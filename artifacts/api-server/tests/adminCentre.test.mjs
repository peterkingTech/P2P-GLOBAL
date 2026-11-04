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

const PERMS = { sup: ["dashboard.view", "growth.view", "growth.approve_matrix", "genealogy.view_named", "genealogy.correct", "audit.view"], help: ["dashboard.view", "help.manage"] };
const T = {
  p2p_profiles: [{ id: "u1", full_name: "Ann Secret", username: "ann", is_official_account: false, created_at: new Date().toISOString(), last_active_at: new Date().toISOString() }, { id: "u2", full_name: "Ben", username: "ben", is_official_account: false, created_at: "2020-01-01", last_active_at: "2020-01-01" }],
  p2p_discipleship_links: [{ id: "l1", mentor_id: "u1", disciple_id: "u2", status: "active", is_primary: true, started_at: new Date().toISOString(), created_at: new Date().toISOString() }],
  p2p_growth_status: [{ stage: 2, verification: "legacy_unverified" }, { stage: 1, verification: "verified" }],
  p2p_growth_settings: [{ id: true, thresholds_status: "draft", promotions_enabled: false, calc_version: 1 }],
  p2p_growth_requirements: [{ stage: 2, dimension: "learning", fact_key: "lessons_completed", min_value: 3, label: "First 3 lessons", data_source: "x", display_order: 1 }],
  p2p_admin_audit: [], p2p_growth_queue: [], p2p_notifications: [], p2p_growth_events: [], p2p_lesson_evaluations: [], p2p_kingdom_stories: [], p2p_curriculums: [], p2p_families: [], p2p_family_members: [], p2p_churches: [], p2p_church_members: [], p2p_evaluation_events: [],
};
const rpcs = [];
function query(name) {
  const f = []; let upd = null, head = false;
  const rows = () => (T[name] ?? []).filter((r) => f.every((p) => p(r)));
  const q = {
    select(_c, o) { if (o?.head) head = true; return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { f.push((r) => r[c] === v); return q; }, is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; }, in(c, v) { f.push((r) => v.includes(r[c])); return q; },
    gt(c, v) { f.push((r) => r[c] > v); return q; }, gte(c, v) { f.push((r) => r[c] >= v); return q; }, lt(c, v) { f.push((r) => r[c] < v); return q; },
    ilike(c, v) { f.push((r) => String(r[c]).toLowerCase() === v.toLowerCase()); return q; },
    or(expr) { const ids = [...expr.matchAll(/(mentor_id|disciple_id)\.eq\.([\w-]+)/g)]; f.push((r) => ids.some(([, c, v]) => r[c] === v)); return q; },
    insert(row) { (T[name] ??= []).push({ ...row }); return Promise.resolve({ error: null }); },
    update(v) { upd = v; return q; },
    async maybeSingle() { const r = rows(); return { data: r[0] ? { ...r[0] } : null, error: null }; },
    then(res) {
      if (upd) {
        if (name === "p2p_growth_settings" && upd.promotions_enabled === true && (upd.thresholds_status ?? rows()[0].thresholds_status) !== "approved") return Promise.resolve({ error: { message: "violates check constraint p2p_growth_settings_promote_approved" } }).then(res);
        rows().forEach((x) => Object.assign(x, upd)); return Promise.resolve({ error: null }).then(res);
      }
      return Promise.resolve(head ? { count: rows().length, error: null } : { data: rows().map((x) => ({ ...x })), error: null }).then(res);
    },
  };
  return q;
}
const db = {
  from: query,
  async rpc(fn, a) { rpcs.push([fn, a]); if (fn === "p2p_admin_permissions_for") return { data: PERMS[a.p_user] ?? [], error: null }; if (fn === "p2p_link_set_status") { const l = T.p2p_discipleship_links.find((x) => x.id === a.p_link); if (!l) return { data: null, error: { message: "P2P_LINK: not found" } }; l.status = "ended"; return { data: "ended", error: null }; } return { data: null, error: null }; },
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
  ok("growth matrix: requirements with stage names and data sources", r.status === 200 && r.j.requirements[0].stageName === "Sprout" && r.j.requirements[0].data_source === "x");
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
