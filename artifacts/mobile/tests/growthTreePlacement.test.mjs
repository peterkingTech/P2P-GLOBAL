// Where the modular Growth Tree's parts sit (lib/growthTreePlacement.ts), executed on a synthetic
// anchor set: positions come only from each attachment's own id/slot, so the same data → the same
// tree, a new fruit never moves an old one, and inactivity removes nothing. Also checks the viewer
// page builds the parts layer, the wrappers pass it through, and the app keeps v1 when v2 isn't set.
// Run: node tests/growthTreePlacement.test.mjs
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
const mods = {};
const load = (rel, env = {}) => {
  const key = rel + JSON.stringify(env);
  if (mods[key]) return mods[key];
  const js = ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, process: { env },
    require: (n) => { if (n.startsWith("@/")) return load(n.slice(2) + ".ts", env); throw new Error(`require ${n}`); } });
  return (mods[key] = mod.exports);
};
const src = (f) => readFileSync(path.join(root, f), "utf8");
const C = load("lib/growthTreeComposition.ts");
const P = load("lib/growthTreePlacement.ts");

// Synthetic anchors: 12 sectors × 20 points on a ring, outward normals.
const anchors = { trunk: [0, 0, 0], height: 2, rMax: 1, sectors: Array.from({ length: 12 }, (_, s) => Array.from({ length: 20 }, (_, i) => {
  const a = (s + 0.5) / 12 * Math.PI * 2, r = 0.3 + i * 0.035; return [Math.cos(a) * r, 1.2 + i * 0.02, Math.sin(a) * r, Math.cos(a), 0, Math.sin(a)];
})) };
const fruit = (id, date, extra = {}) => ({ id, type: "service.learning_feedback", label: "Useful learning feedback given", date, area: "evaluation", areaLabel: "Peer evaluation", kind: "individual", peopleHelped: 1, status: "verified", countsTowardMilestone: true, ...extra });
const tree = (fruits, extra = {}) => ({ stage: { stage: 4, name: "Fruitful Tree" }, history: [{ stage: 4, name: "Fruitful Tree", achievedAt: "2026-01-01T00:00:00Z", kind: "verified" }],
  roots: { coreLessons: { passed: 20, total: 84, percent: 24 }, learningUnits: 41, activeWeeks: 30, activeMonths: 8 }, stems: { practicalActions: 2 },
  branches: [{ area: "evaluation", label: "Peer evaluation", verified: 9 }], fruits, fruitTotals: {}, seeds: [], disclaimer: "", note: "", ...extra });
const fs = [fruit("e1", "2026-06-10"), fruit("e2", "2026-07-02", { kind: "group" }), fruit("e3", "2026-08-15"), fruit("e5", "2026-11-05", { status: "pending_review", countsTowardMilestone: false })];
const plan = C.composeTree(tree(fs), "2026-11-12");
const placed = P.placeTree(plan, anchors);
const byId = (ps) => Object.fromEntries(ps.map((p) => [p.id, p]));

ok("every attachment and every leaf cluster is placed on a tree (nothing dropped)", placed.length === plan.attachments.length + plan.leafClusters);
ok("every position is finite", placed.every((p) => [...p.p, ...p.n, p.size, p.yaw].every(Number.isFinite)));
ok("fruit sits out on the branches, never inside the trunk", placed.filter((p) => p.id.startsWith("fruit:")).every((p) => Math.hypot(p.p[0], p.p[2]) > 0.2));
ok("fruit and buds hang; tips and leaves don't", placed.filter((p) => /^(fruit|bud):/.test(p.id)).every((p) => p.hang) && placed.filter((p) => /^(leaf|green-tip|shoot-tip)/.test(p.id)).every((p) => !p.hang));
ok("root tip sits at the foot of the trunk axis (never floating beside the plant)", (() => { const r = placed.find((p) => p.id === "root-tip"); return r && r.p[0] === 0 && r.p[2] === 0 && r.p[1] < 0.3; })());
ok("no woody fruiting spur on a Seed or Sprout", P.placeTree(C.composeTree({ ...tree(fs), stage: { stage: 2, name: "Sprout" } }, "2026-11-12"), anchors).every((p) => !p.id.startsWith("branch:")));
ok("sizes follow the body's height (fruit 5 %)", Math.abs(placed.find((p) => p.id === "fruit:e1").size - 0.1) < 1e-9);
const again = P.placeTree(C.composeTree(tree([...fs].reverse()), "2026-11-12"), anchors);
ok("same data → identical positions, whatever order the records arrive in", JSON.stringify(byId(again)) === JSON.stringify(byId(placed)));
const more = P.placeTree(C.composeTree(tree([...fs, fruit("e0", "2026-01-01"), fruit("e9", "2026-11-10")]), "2026-11-12"), anchors);
ok("a new fruit (even an OLDER record) never moves an existing one", ["fruit:e1", "fruit:e2", "fruit:e3"].every((id) => JSON.stringify(byId(more)[id]) === JSON.stringify(byId(placed)[id])));
const later = P.placeTree(C.composeTree(tree(fs), "2027-06-01"), anchors);
ok("months later: every fruit and leaf still in the same place", placed.filter((p) => !/tip/.test(p.id)).every((p) => JSON.stringify(byId(later)[p.id]) === JSON.stringify(p)));
const inst = P.instancesByAsset(placed);
ok("instances grouped per asset, 9 numbers each, counts add up", Object.values(inst).every((l) => l.every((v) => v.length === 9)) && Object.values(inst).reduce((a, l) => a + l.length, 0) === placed.length);
ok("an empty sector falls back to one with points (never a crash)", P.placeTree(plan, { ...anchors, sectors: anchors.sectors.map((s, i) => (i % 2 ? s : [])) }).length === placed.length);

// ── Manifest + configuration ──
const A0 = load("lib/growthTreeAssets.ts", {});
ok("default base = the hosted, versioned v2 folder (uploaded and verified 2026-11-13)", A0.MODULAR_TREE_BASE_URL === "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Forests/models/v2/"
  && A0.modularFileUrl("asset-04-fruitful-apple-tree") === A0.MODULAR_TREE_BASE_URL + "body-04-fruitful-tree.glb" && A0.modularCloseUrl("asset-04-fruitful-apple-tree") === A0.MODULAR_TREE_BASE_URL + "body-04-fruitful-tree.close.glb");
const A1 = load("lib/growthTreeAssets.ts", { EXPO_PUBLIC_GROWTH_MODEL_V2_BASE_URL: "http://127.0.0.1:8797" });
ok("v2 configured → validated files resolve under that base", A1.modularFileUrl("asset-04-fruitful-apple-tree") === "http://127.0.0.1:8797/body-04-fruitful-tree.glb" && A1.anchorsUrl("asset-04-fruitful-apple-tree") === "http://127.0.0.1:8797/body-04-fruitful-tree.anchors.json");
ok("a missing asset never gets a URL (Forest of Nations: only a 2D image exists)", A1.modularFileUrl("forest-of-nations-3d-landscape") === null && A1.anchorsUrl("asset-apple-stage-5-ripe-red") === null);
ok("bodies that carry their own leaves get no leaf clusters on top", P.placeTree(plan, anchors, { bodyHasFoliage: true }).filter((p) => p.id.startsWith("leaf:")).length === 0 && placed.some((p) => p.id.startsWith("leaf:")));
ok("LivingTreeView respects the body's own foliage", src("components/growth/LivingTreeView.tsx").includes("bodyHasFoliage: !!assetById(plan.body)?.hasFoliage"));
// Owner 2026-11-13: the first upload held the 13 the tree uses; the second (same day) the 17 lifecycle models.
const used = [...Object.values(C.STAGE_BODIES), "asset-06-fruiting-spur-socket", "asset-apple-stage-5-ripe-red", "asset-apple-stage-6-striped-red", "asset-04d-blushed-apple",
  "asset-micro-7-balloon-stage-bud", "asset-micro-1-green-tip-bud", "asset-micro-3-unfurling-shoot-tip", "asset-micro-5-active-root-tip"];
const hosted = [...A1.TREE_ASSETS, ...A1.EXTRA_ASSETS].filter((x) => x.release === "v2").map((x) => x.id);
ok("hosted v2 = the 13 the tree uses + the 17 lifecycle models (30); nothing else", hosted.length === 30 && used.every((id) => hosted.includes(id)) && A1.TREE_ASSETS.filter((x) => !x.release && x.file).length === 0);
ok("the tree itself only ever draws its 13 (lifecycle models never go on a person's tree)", [1, 2, 3, 4, 5].every((st) => C.composeTree(tree([fruit("a", "2026-11-10"), fruit("b", "2026-10-01"), fruit("p", "2026-11-11", { status: "pending_review", countsTowardMilestone: false })],
    { stage: { stage: st, name: "x" }, history: [{ stage: st, name: "x", achievedAt: "2026-11-08T00:00:00Z", kind: "verified" }] }), "2026-11-12").attachments.every((x) => used.includes(x.asset)))
  && P.placeTree(plan, anchors, { bodyHasFoliage: true }).every((p) => used.includes(p.asset)));
ok("assets held back are never requested (no URL): the two special apples", ["special-half-apple-with-seeds", "special-single-apple-on-stalk"].every((id) => A1.modularFileUrl(id) === null));
ok("owner-confirmed visual matches keep their original filenames", A1.assetById("asset-micro-7-balloon-stage-bud").confirmedByOwner && A1.assetById("asset-micro-7-balloon-stage-bud").file.source === "P2P - Tight Pink Bud Cluster (Early Spring)_.glb"
  && A1.assetById("asset-micro-9-golden-autumn-leaf").confirmedByOwner && A1.assetById("asset-micro-9-golden-autumn-leaf").file.source === "P2P - Petal to  Fruitlet Transition_.glb");
ok("close-up URL only where a close-up copy exists (else null → zoom limited, never faked)", A1.TREE_ASSETS.every((x) => (A1.modularCloseUrl(x.id) !== null) === !!(x.release && x.file?.close && x.file.lods.includes("close"))));
ok("LivingTreeView: close-up copy when there is one, otherwise noCloseUp", src("components/growth/LivingTreeView.tsx").includes("detailedUrl={closeUrl} noCloseUp={!closeUrl}"));
ok("every asset the placement can use is resolvable or honestly missing", [...new Set(placed.map((p) => p.asset))].every((a) => A1.modularFileUrl(a) !== undefined));

// ── Viewer + wiring ──
const html = load("lib/treeViewerHtml.ts").treeViewerHtml({ standardUrl: "b.glb", detailedUrl: null, background: "#fff", reduceMotion: true, parts: { urls: { x: "x.glb" }, instances: { x: [[0, 1, 0, 0, 1, 0, 0.1, 0, 1]] }, ids: { x: ["fruit:e1"] } } });
ok("viewer: parts drawn as instanced meshes, tap reports the record id, cleanup on pagehide", html.includes("new THREE.InstancedMesh(") && html.includes('type: "select"') && html.includes('addEventListener("pagehide"') && html.includes("__p2pStats"));
ok("viewer: the parts config is embedded safely (no raw '<')", !/"urls":\{"x":"x.glb"\}[^]*<\/script>[^]*"ids"/.test(html.split("const CFG = ")[1].split(";\n")[0]) && !html.split("const CFG = ")[1].split(";\n")[0].includes("<"));
ok("both viewer wrappers pass parts and selection through", ["components/growth/TreeModelViewer.web.tsx", "components/growth/TreeModelViewer.native.tsx"].every((f) => src(f).includes("noCloseUp, parts, wind, windFrame, compact }),") && src(f).includes('"select"')));
ok("Living Tree uses the shared living tree (no v1 fallback, no picture)", src("app/living-tree.tsx").includes("<LivingTreeView") && !src("app/living-tree.tsx").includes("fallback="));

console.log(`growthTreePlacement (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
