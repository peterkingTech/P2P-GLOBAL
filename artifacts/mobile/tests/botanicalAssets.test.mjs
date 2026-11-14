// Botanical Asset System (owner brief 2026-11-13): ONE register of every Meshy model (categories, uses,
// integration, availability), botanical development kept apart from the participant Growth Stage, the
// apple lifecycle as teaching only, and the screens that show them.
//   • the six Growth Matrix stages stay fixed; no botanical category or lifecycle phase is a stage;
//   • fruit = one per verified contribution (a group session one fruit; pending → bud; rejected/withdrawn
//     → nothing); botanical development never counts, never awards, never changes the stage;
//   • hosted assets stay exactly the 13; local review copies resolve ONLY with the local review address;
//     the two special apples are validated but never resolve (not integrated).
// Run: node tests/botanicalAssets.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");
const load = (f, env = {}) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, process: { env }, require: (n) => { throw new Error(`require ${n}`); } });
  return mod.exports;
};
const A = load("lib/growthTreeAssets.ts");
const L = load("lib/growthTreeAssets.ts", { EXPO_PUBLIC_BOTANICAL_LOCAL_BASE_URL: "http://127.0.0.1:8798/v2" });
const C = load("lib/growthTreeComposition.ts");
const B = load("lib/botanicalDevelopment.ts");
const LC = load("lib/botanicalLifecycle.ts");
const S = load("constants/stages.ts");

// ── Register ──
const R = A.BOTANICAL_REGISTRY;
ok("register: every unique Meshy model once — 26 brief assets (incl. the Forest of Nations globe, 2026-11-14) + 5 extras + 2 special apples = 33 entries, all with a file",
  R.length === 33 && new Set(R.map((x) => x.id)).size === 33 && R.filter((x) => x.file).length === 33);
ok("register: no two entries share an original export (identical Meshy copies are one asset)", new Set(R.filter((x) => x.file).map((x) => x.file.sha256)).size === 33);
ok("register: every entry has a category, an intended use and an integration state", R.every((x) => x.category && x.use && x.use.length > 10 && ["live", "local_review", "reserved", "excluded", "missing"].includes(x.integration)));
const count = (k) => R.filter((x) => x.category === k).length;
ok("register: categories — 5 stage trees, 1 collective, 3 contribution fruit, 7 fruit development, 6 bud/blossom, 4 leaf, 4 root, 1 structure, 2 special (= 33)",
  [count("stage_tree"), count("collective"), count("contribution_fruit"), count("fruit_development"), count("bud_blossom"), count("leaf"), count("root"), count("structure"), count("special")].join() === "5,1,3,7,6,4,4,1,2");
ok("register: hosted = live = 30 (the tree's 13 + the 17 lifecycle models); Forest of Nations local review (not hosted yet); Single Apple held back; Half Apple excluded (owner 2026-11-14)",
  R.filter((x) => x.integration === "live").map((x) => x.id).sort().join() === R.filter((x) => x.release === "v2").map((x) => x.id).sort().join()
  && R.filter((x) => x.release === "v2").length === 30 && R.filter((x) => x.integration === "reserved").map((x) => x.id).join() === "special-single-apple-on-stalk"
  && R.filter((x) => x.integration === "excluded").map((x) => x.id).join() === "special-half-apple-with-seeds"
  && R.filter((x) => x.integration === "local_review").map((x) => x.id).join() === "forest-of-nations-3d-landscape" && !R.some((x) => x.integration === "missing"));
ok("register: only the five stage trees are stage trees, in Growth Matrix order", R.filter((x) => x.category === "stage_tree").map((x) => x.id).join() === Object.values(C.STAGE_BODIES).join());
ok("stages: the six Growth Matrix stages are unchanged", S.STAGES.map((s) => s.name).join() === "Seed,Sprout,Young Tree,Fruitful Tree,Forest Builder,Forest of Nations" && S.PERSONAL_STAGE_COUNT === 5 && S.COLLECTIVE_STAGE_INDEX === 5);
ok("register: no category or use names a participant stage as something earned", !R.some((x) => /rank|level up|milestone earned|points/i.test(x.use)));
ok("special apples: validated (real measurements) but held back / excluded — never resolve, even for local review",
  ["special-half-apple-with-seeds", "special-single-apple-on-stalk"].every((id) => { const x = A.botanicalAsset(id); return ["reserved", "excluded"].includes(x.integration) && x.file.triangles > 0 && x.file.triangles < x.file.sourceTriangles && /^[0-9a-f]{64}$/.test(x.file.sha256)
    && A.botanicalAssetUrl(id) === null && L.botanicalAssetUrl(id) === null && A.modularFileUrl(id) === null; }));
const fon = A.botanicalAsset("forest-of-nations-3d-landscape");
ok("Forest of Nations: the real 3D globe (collective, never a stage), standard + close-up copies; not hosted → unavailable in a release build, never the PNG",
  fon.category === "collective" && fon.file.sourceTriangles === 7630676 && fon.file.triangles === 299999 && fon.file.close?.name === "collective-forest-of-nations.close.glb" && fon.file.close.triangles > fon.file.triangles
  && !fon.wind && A.botanicalAssetUrl(fon.id) === null && A.botanicalCloseUrl(fon.id) === null && A.modularFileUrl(fon.id) === null
  && L.botanicalAssetUrl(fon.id) === "http://127.0.0.1:8798/v2/collective-forest-of-nations.glb" && L.botanicalCloseUrl(fon.id) === "http://127.0.0.1:8798/v2/collective-forest-of-nations.close.glb"
  && !Object.values(C.STAGE_BODIES).includes(fon.id));
ok("availability: hosted assets resolve to the hosted v2 folder", A.botanicalAvailability("asset-apple-stage-5-ripe-red") === "hosted" && A.botanicalAssetUrl("asset-apple-stage-5-ripe-red").endsWith("/Forests/models/v2/apple-stage-5-ripe-red.glb"));
const lifecycleIds = LC.APPLE_LIFECYCLE.flatMap((s) => s.items.map((i) => i.asset));
ok("availability: every lifecycle model is hosted in a normal build (no local review needed)", lifecycleIds.length === 26 && lifecycleIds.every((id) => A.botanicalAvailability(id) === "hosted" && A.botanicalAssetUrl(id) === A.modularFileUrl(id) && A.botanicalAssetUrl(id).includes("/Forests/models/v2/")));
ok("availability: hosted always wins over the local review address (live assets never load from this computer)", lifecycleIds.every((id) => L.botanicalAvailability(id) === "hosted" && !L.botanicalAssetUrl(id).startsWith("http://127.0.0.1")));
ok("wind only on assets with leaves or petals (stage trees, leaves, blossom/pink buds)", R.filter((x) => x.wind).every((x) => ["stage_tree", "leaf", "bud_blossom"].includes(x.category)) && !R.some((x) => x.wind && ["contribution_fruit", "fruit_development", "root", "structure", "special", "collective"].includes(x.category)));

// ── Botanical development (kept apart from the stage) ──
const fruit = (id, extra = {}) => ({ id, type: "service.learning_feedback", label: "Feedback", date: "2026-10-01", area: "evaluation", areaLabel: "Peer evaluation", kind: "individual", peopleHelped: 1, status: "verified", countsTowardMilestone: true, ...extra });
const tree = (stage, fruits, extra = {}) => ({ stage: { stage, name: "x" }, history: [{ stage, name: "x", achievedAt: "2026-01-01T00:00:00Z", kind: "verified" }],
  roots: { coreLessons: { passed: 20, total: 84, percent: 24 }, learningUnits: 41, activeWeeks: 30, activeMonths: 8 }, stems: { practicalActions: 22 },
  branches: [{ area: "evaluation", label: "Peer evaluation", verified: 9 }], fruits, fruitTotals: {}, seeds: [], disclaimer: "", note: "", ...extra });
const fruits = [fruit("a"), fruit("b"), fruit("g", { kind: "group", peopleHelped: 12 }), fruit("p", { status: "pending_review", countsTowardMilestone: false }),
  fruit("r", { status: "rejected", countsTowardMilestone: false }), fruit("w", { status: "withdrawn", countsTowardMilestone: false })];
const plan = C.composeTree(tree(4, fruits), "2026-11-13");
const bd = B.botanicalDevelopment(3, plan);
const ff = bd.features.find((f) => f.id === "fruit"), bb = bd.features.find((f) => f.id === "buds");
ok("fruit: one per verified contribution (a group session is ONE fruit; rejected and withdrawn give none)", ff.count === 3);
ok("pending: shown as a bud awaiting verification, not fruit", bb.count === 1 && /not fruit/.test(bb.explains));
ok("botanical development never changes the stage or the plan", plan.stage === 4 && JSON.stringify(C.composeTree(tree(4, fruits), "2026-11-13")) === JSON.stringify(plan) && !("stage" in bd));
ok("summary is labelled botanical and never names a stage or a rank", bd.summary.startsWith("Botanical development: ") && !S.STAGES.some((s) => bd.summary.includes(s.name)) && !/rank|level|points|milestone/i.test(bd.summary));
ok("the note says it is not a rank or milestone", /not a rank or a milestone/.test(bd.note));
ok("no tree data yet → the stage model's own appearance (nothing invented)", B.botanicalDevelopment(1, null).features.length === 0 && B.botanicalDevelopment(1, null).summary === "Botanical development: a seedling with its first leaves above a fan of fine roots");
ok("seasons and the lifecycle are never put on a person's tree", !plan.attachments.some((x) => C.SEASONAL_ONLY.includes(x.asset) || ["asset-apple-blossoms", "asset-apple-stage-1-fruitlet", "asset-apple-stage-2-green"].includes(x.asset)));
const recent = C.composeTree(tree(4, [fruit("n", { date: "2026-11-10" })], { history: [{ stage: 4, name: "x", achievedAt: "2026-11-05T00:00:00Z", kind: "verified" }] }), "2026-11-13");
const rf = B.botanicalDevelopment(3, recent).features.map((f) => f.id);
ok("new growth / new shoot only from recent VERIFIED evidence or milestone (the composition's rule — no timer)", rf.includes("new_growth") && rf.includes("new_shoot") && !B.botanicalDevelopment(3, plan).features.some((f) => f.id === "new_growth"));

// ── Lifecycle (teaching) ──
const items = LC.APPLE_LIFECYCLE.flatMap((s) => s.items);
ok("lifecycle: every item is a registered model; none is a special apple or the collective", items.every((i) => A.botanicalAsset(i.asset) && !["special", "collective"].includes(A.botanicalAsset(i.asset).category)));
ok("lifecycle: shows the prepared leaf, blossom, bud, root and fruit-development models (each once)", new Set(items.map((i) => i.asset)).size === items.length
  && R.filter((x) => ["fruit_development", "leaf"].includes(x.category) || (x.category === "root") || (x.category === "bud_blossom")).every((x) => items.some((i) => i.asset === x.id)));
ok("lifecycle: said plainly to be teaching, not stages", /not a set of growth stages/.test(LC.LIFECYCLE_NOTE) && !LC.APPLE_LIFECYCLE.some((s) => S.STAGES.slice(1).some((st) => s.title.includes(st.name))));
ok("lifecycle: seasons framed as nature's rhythm, never decline", /not a sign of decline/.test(items.find((i) => i.asset === "asset-micro-6-dormant-winter-bud").note) && /not failure/.test(items.find((i) => i.asset === "asset-micro-8-june-drop-fruitlet").note));

// ── Screens ──
const home = src("app/(tabs)/index.tsx"), my = src("app/living-tree.tsx"), story = src("app/growth-timeline.tsx"), life = src("app/botanical/index.tsx"), view = src("components/growth/BotanicalModelView.tsx"), lt = src("components/growth/LivingTreeView.tsx");
ok("Home: 'Your Growth Stage' and the botanical line shown separately, from the same tree data as the 3D tree", home.includes('t("home.yourGrowthStage"') && home.includes("botanicalDevelopment(stageIndex, useGrowthTree().plan)") && home.includes("{botany.summary}"));
ok("My Tree: the botanical card (stage stated separately, each feature explained, the note) and the lifecycle link", my.includes("Your Growth Stage:") && my.includes("Botanical development") && my.includes("{f.explains}") && my.includes("{botany.note}") && my.includes('router.push("/botanical"'));
ok("Home, My Tree and the 3D tree share one tree data source", lt.includes("useGrowthTree(mode === \"tree\")") && !lt.includes("getGrowthTree()"));
// 2026-11-14 (My Growth): five kinds — stage, learning, application, contribution fruit, botanical — still labelled apart.
ok("Growth Story: event kinds always labelled apart; botanical only where dated", Object.keys(JSON.parse(src("locales/en.json")).myGrowth.story.kinds).join() === "stage,learning,application,fruit,botany"
  && JSON.parse(src("locales/en.json")).myGrowth.story.firstFruit === "First fruit on your tree" && story.includes("{KIND_LABEL(e.kind)}") && src("lib/myGrowth.ts").includes('kind: "botany", ref: `first-fruit:${first.id}`'));
ok("lifecycle screen: one model at a time; unavailable items say so; local copies labelled", life.includes("<BotanicalModelView assetId={current.asset}") && life.includes('t("treeGrows.modelNotAvailable")') && life.includes('t("treeGrows.localCopy")')
  && JSON.parse(readFileSync(path.join(root, "locales/en.json"), "utf8")).treeGrows.localCopy === "Local review copy — not yet published in the app.");
ok("BotanicalModelView: register URL only; loading / Try again / not available — no picture", view.includes("botanicalAssetUrl(assetId)") && view.includes('label="Try again"') && view.includes("isn&apos;t available yet") && !/<Image\b/.test(view));
ok("route registered", src("app/_layout.tsx").includes('"botanical/index"'));
ok("Home label translated in all 8 languages", ["en", "de", "es", "fr", "pt", "ar", "hi", "sw"].every((l) => { const v = JSON.parse(src(`locales/${l}.json`)).home?.yourGrowthStage; return v && (l === "en" || v !== "Your Growth Stage"); }));
ok("no new API, schema or migration for the botanical system", !existsSync(path.join(root, "../api-server/src/routes/botanical.ts")) && !src("lib/growthApi.ts").includes("botanical"));

console.log(`botanicalAssets (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
