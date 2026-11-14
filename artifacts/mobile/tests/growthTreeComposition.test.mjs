// My Growth Tree composition (lib/growthTreeComposition.ts) and the 26-asset manifest (lib/growthTreeAssets.ts),
// executed. The tree is a deterministic VIEW of verified data:
//   correct body per stage, Forest of Nations never individual; one fruit per verified contribution (group
//   = one), withdrawn/rejected = none, awaiting review = a labelled bud; capacity overflow = one cluster with
//   the exact count (nothing dropped); same data → same tree; new fruit never moves old fruit; inactivity
//   erases nothing; seasonal assets never driven by activity; the input is never changed.
// Run: node tests/growthTreeComposition.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const load = (f) => {
  const js = ts.transpileModule(readFileSync(path.join(root, f), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, process: { env: {} }, require: (n) => { throw new Error(`require ${n}`); } });
  return mod.exports;
};
const C = load("lib/growthTreeComposition.ts");
const A = load("lib/growthTreeAssets.ts");

// ── Manifest ──
ok("manifest: exactly 26 assets, unique ids", A.TREE_ASSETS.length === 26 && new Set(A.TREE_ASSETS.map((x) => x.id)).size === 26);
ok("manifest: groups 6 body/landscape · 3 modular · 6 apple · 9 micro · 2 variants",
  ["body", "modular", "apple", "micro", "variant"].map((g) => A.TREE_ASSETS.filter((x) => x.group === g).length).join() === "6,3,6,9,2");
ok("manifest: 26 copies with real measurements; 25 hosted (13 for the tree + 12 lifecycle, release v2) are integrated; the Forest of Nations globe (2026-11-14) is validated, not hosted yet",
  A.TREE_ASSETS.filter((x) => x.file && /^[0-9a-f]{64}$/.test(x.file.sha256) && x.file.bytes > 0 && x.file.triangles > 0 && x.file.triangles < x.file.sourceTriangles).length === 26
  && A.TREE_ASSETS.every((x) => !x.file || (x.status === "integrated") === (x.release === "v2"))
  && A.TREE_ASSETS.filter((x) => x.status === "integrated").length === 25 && A.TREE_ASSETS.filter((x) => x.status === "validated").map((x) => x.id).join() === "forest-of-nations-3d-landscape"
  && !A.assetById("forest-of-nations-3d-landscape").release
  && A.modularTreeReady(Object.values(C.STAGE_BODIES)) && A.modularTreeReady(["asset-apple-blossoms"]) && !A.modularTreeReady(["special-half-apple-with-seeds"]));
ok("manifest: matches made by eye are flagged for the owner to confirm", ["asset-micro-7-balloon-stage-bud", "asset-micro-9-golden-autumn-leaf"].every((id) => A.assetById(id).identifiedBy === "visual"));
ok("manifest: every copy is full 3D (no front-only views claimed)", A.TREE_ASSETS.filter((x) => x.file).every((x) => x.file.views.join() === "full"));
ok("manifest: dormant bud, June drop and autumn leaf are seasonal-only", ["asset-micro-6-dormant-winter-bud", "asset-micro-8-june-drop-fruitlet", "asset-micro-9-golden-autumn-leaf"].every((id) => A.assetById(id).seasonalOnly));
ok("every asset the composer uses is in the manifest", [...Object.values(C.STAGE_BODIES), "asset-06-fruiting-spur-socket", "asset-apple-stage-5-ripe-red", "asset-apple-stage-6-striped-red", "asset-04d-blushed-apple",
  "asset-micro-7-balloon-stage-bud", "asset-micro-1-green-tip-bud", "asset-micro-3-unfurling-shoot-tip", "asset-micro-5-active-root-tip"].every((id) => !!A.assetById(id)));

// ── Composition ──
const fruit = (id, date, extra = {}) => ({ id, type: "service.learning_feedback", label: "Useful learning feedback given", date, area: "evaluation", areaLabel: "Peer evaluation", kind: "individual", peopleHelped: 1, status: "verified", countsTowardMilestone: true, ...extra });
const tree = (stage, fruits, extra = {}) => ({
  stage: { stage, name: "x" }, history: [{ stage, name: "x", achievedAt: "2026-01-01T00:00:00Z", kind: "verified" }],
  roots: { coreLessons: { passed: 20, total: 84, percent: 24 }, learningUnits: 41, activeWeeks: 30, activeMonths: 8 }, stems: { practicalActions: 22 },
  branches: [{ area: "evaluation", label: "Peer evaluation", verified: 9 }, { area: "kingdom_school", label: "Kingdom School", verified: 4 }],
  fruits, fruitTotals: {}, seeds: [{ ref: "p1", verifiedContributionsToThem: 1, nowHelpingOthers: true, firstHelpedOthersOn: "2026-10-18" }, { ref: "p2", verifiedContributionsToThem: 1, nowHelpingOthers: false, firstHelpedOthersOn: null }],
  disclaimer: "", note: "", ...extra,
});
for (const [stage, body] of [[1, "asset-00-germinating-seed"], [2, "asset-02-sprout"], [3, "asset-03-young-apple-tree"], [4, "asset-04-fruitful-apple-tree"], [5, "asset-05-forest-builder-apple-tree"]]) {
  ok(`stage ${stage} → ${body}`, C.composeTree(tree(stage, []), "2026-11-12").body === body);
}
ok("Forest of Nations is never an individual body", !Object.values(C.STAGE_BODIES).includes("forest-of-nations-3d-landscape"));

const fs = [fruit("e1", "2026-06-10"), fruit("e2", "2026-07-02", { kind: "group", peopleHelped: 5, type: "service.study_session_facilitated" }), fruit("e3", "2026-08-15"),
  fruit("e4", "2026-09-03", { status: "withdrawn", countsTowardMilestone: false }), fruit("e5", "2026-11-05", { status: "pending_review", countsTowardMilestone: false }), fruit("e6", "2026-10-05", { status: "rejected", countsTowardMilestone: false })];
const p = C.composeTree(tree(4, fs), "2026-11-12");
const fruitsDrawn = p.attachments.filter((x) => x.kind === "fruit");
ok("one fruit per verified contribution (3) — the group session is ONE fruit", fruitsDrawn.length === 3 && fruitsDrawn.map((x) => x.ref).sort().join() === "e1,e2,e3");
ok("withdrawn and rejected → no fruit", !p.attachments.some((x) => x.ref === "e4" || x.ref === "e6"));
ok("awaiting review → a closed bud, labelled 'not yet fruit'", p.attachments.some((x) => x.kind === "fruit_bud" && x.ref === "e5" && /not yet fruit/.test(x.meaning)));
ok("each fruit carries its record and meaning (group said once)", /group session \(one fruit\)/.test(fruitsDrawn.find((x) => x.ref === "e2").meaning));
ok("fruit sits on the outer part of a branch (never the trunk), on a real branch", fruitsDrawn.every((x) => x.slot.along >= 0.35 && x.slot.along <= 0.95 && x.slot.branch >= 0 && x.slot.branch < 9));
ok("branches: only the areas with verified evidence", p.attachments.filter((x) => x.kind === "branch").map((x) => x.id).join() === "branch:evaluation,branch:kingdom_school");
ok("seeds: only people who now help others", p.seeds === 1);

// Determinism.
const again = C.composeTree(tree(4, [...fs].reverse()), "2026-11-12");
ok("same data → the same tree, whatever order the records arrive in", JSON.stringify(again.attachments.map((x) => [x.id, x.asset, x.slot]).sort()) === JSON.stringify(p.attachments.map((x) => [x.id, x.asset, x.slot]).sort()));
const more = C.composeTree(tree(4, [...fs, fruit("e9", "2026-11-10")]), "2026-11-12");
ok("a new fruit never moves the fruit already there", fruitsDrawn.every((f) => JSON.stringify(more.attachments.find((x) => x.id === f.id).slot) === JSON.stringify(f.slot)));
ok("ripe variety comes from the record id (stable), not from time", fruitsDrawn.every((f) => more.attachments.find((x) => x.id === f.id).asset === f.asset));

// Micro-growth from RECENT verified evidence only; inactivity erases nothing.
ok("a contribution in the last 14 days → a green tip (new growth)", more.attachments.some((x) => x.kind === "green_tip"));
const later = C.composeTree(tree(4, fs), "2027-06-01");
ok("months of inactivity: every fruit, leaf and root stays", later.attachments.filter((x) => x.kind === "fruit").length === 3 && later.leafClusters === p.leafClusters && later.rootDetail === p.rootDetail);
ok("…only the 'new growth' tip fades (it marks recent verified growth, not a penalty)", !later.attachments.some((x) => x.kind === "green_tip"));
const allPlans = [p, more, later, C.composeTree(tree(1, fs), "2026-11-12"), C.composeTree(tree(5, fs), "2027-01-01")];
ok("dormant bud, June drop and autumn leaf are NEVER placed by participant data", allPlans.every((pl) => pl.attachments.every((x) => !C.SEASONAL_ONLY.includes(x.asset))));

// Capacity: nothing dropped.
const many = Array.from({ length: 55 }, (_, i) => fruit(`m${String(i).padStart(2, "0")}`, `2026-0${1 + (i % 9)}-1${i % 9}`));
const pm = C.composeTree(tree(4, many), "2026-11-12");
ok("more fruit than the tree carries → drawn up to capacity + ONE cluster with the exact remaining count", pm.attachments.filter((x) => x.kind === "fruit").length === 40 && pm.fruitCluster.count === 15);
ok("a Seed or Sprout carries no apples: its contributions are a counted cluster (never dropped)", C.composeTree(tree(2, fs), "2026-11-12").fruitCluster.count === 3);
ok("roots: detail from Foundations / learning units; Foundations complete → deepest", C.composeTree(tree(5, [], { roots: { coreLessons: { passed: 84, total: 84, percent: 100 }, learningUnits: 120, activeWeeks: 80, activeMonths: 20 } }), "2026-11-12").rootDetail === 3 && p.rootDetail === 1);
const input = tree(4, fs); const snap = JSON.stringify(input); C.composeTree(input, "2026-11-12");
ok("composing never changes the verified data", JSON.stringify(input) === snap);
ok("unitHash: stable and ALWAYS in 0–1 (1,000 ids × 6 salts)", C.unitHash("e1", 1) === C.unitHash("e1", 1) && C.unitHash("e1", 1) !== C.unitHash("e2", 1) && Array.from({ length: 1000 }, (_, i) => [0, 1, 2, 3, 4, 5].map((s) => C.unitHash(`id-${i}`, s))).flat().every((v) => v >= 0 && v <= 1));

// ── Screens ──
const src = (f) => readFileSync(path.join(root, f), "utf8");
const harvest = src("app/fruit-harvest.tsx"), story = src("app/growth-timeline.tsx");
ok("Fruit Harvest: real ledger data only (GET /growth/me/tree), honest empty state, no sample fruit", harvest.includes("getGrowthTree()") && harvest.includes("No contributions verified yet") && !/sample|dummy|mock|Lorem/i.test(harvest.replace(/^\s*\/\/.*$/gm, "")));
ok("Fruit Harvest: filters by kind, type and verified/history; details with date, type, area, status, evidence reference", ["Individual", "Group", "Every type", "Full history", "Evidence reference", "Counts toward your milestones"].every((x) => harvest.includes(x)));
ok("Fruit Harvest: a group fruit says it is ONE fruit for leading it", harvest.includes("Group — one fruit for leading it"));
ok("Growth Story: recorded events only; a stage opens its real 3D model (no tree pictures)", story.includes('label="See this stage in 3D"') && !story.includes("<Image source={{ uri: still }}") && story.includes("storyEvents(d)") && src("lib/myGrowth.ts").includes("t.history ?? []") && src("lib/myGrowth.ts").includes("f.countsTowardMilestone"));
ok("both reachable from the Living Tree, routes registered", src("app/living-tree.tsx").includes('router.push("/fruit-harvest"') && src("app/living-tree.tsx").includes('router.push("/growth-timeline"') && src("app/_layout.tsx").includes('"fruit-harvest", "growth-timeline"'));

console.log(`growthTreeComposition (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
