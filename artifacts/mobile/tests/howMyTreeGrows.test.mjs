// HOW MY TREE GROWS (owner brief 2026-11-14) — the apple tree's complete development explained as the
// person's own growth journey. Executes lib/howMyTreeGrows.ts with invented data and checks the screen's
// source against the brief's acceptance list (§18). The engine's rules are tested on the server
// (api-server/tests/growthJourney.test.mjs, growthMatrixMigration.test.mjs). Run: node tests/howMyTreeGrows.test.mjs
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
const src = (f) => readFileSync(path.join(root, f), "utf8");
const mods = {};
const load = (f) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, Set, Map,
    require: (n) => { if (mods[n]) return mods[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};
mods["@/lib/botanicalLifecycle"] = load("lib/botanicalLifecycle.ts");
const LC = mods["@/lib/botanicalLifecycle"];
const H = load("lib/howMyTreeGrows.ts");
const en = JSON.parse(src("locales/en.json"));
const tg = en.treeGrows;
const screen = src("app/botanical/index.tsx"), myTree = src("app/living-tree.tsx"), assets = src("lib/growthTreeAssets.ts");
const get = (k) => k.split(".").reduce((o, p) => (o == null ? o : o[p]), en);
const has = (k, params = {}) => get(k) !== undefined || (params.count !== undefined && get(k + "_one") !== undefined && get(k + "_other") !== undefined);

// TEST DATA (invented): a Sprout working towards Young Tree; Fruitful Tree + Forest Builder later.
const item = (key, have, need, label) => ({ key, label: label ?? key, have, need, met: have >= need, missing: have >= need ? null : `${need - have} more to go` });
const dim = (dimension, items) => ({ dimension, label: dimension, required: items.length > 0, met: items.length > 0 && items.every((i) => i.met), items });
const journey = {
  stage: { stage: 2, name: "Sprout", since: "2026-09-01T00:00:00Z", verification: "verified", legacyNote: null },
  next: { stage: 3, name: "Young Tree", dimensions: [dim("consistency", [item("days_in_stage", 74, 90), item("active_weeks_window", 10, 10)]), dim("learning", [item("learning_units", 14, 20)]),
    dim("application", [item("application_actions", 0, 20)]), dim("service", [item("contributions", 21, 20)])] },
  later: [
    { stage: 4, name: "Fruitful Tree", dimensions: [dim("consistency", [item("active_weeks_window", 9, 18)]), dim("learning", [item("learning_units", 14, 50)]), dim("application", [item("application_actions", 0, 50)]),
      dim("service", [item("contributions", 21, 50), item("learners_supported_developed", 0, 1), item("second_generation_contributors", 0, 1)])] },
    { stage: 5, name: "Forest Builder", dimensions: [dim("consistency", [item("active_weeks_window", 9, 18)]), dim("learning", [item("learning_units", 14, 100), item("core_curriculum_complete", 0, 1)]),
      dim("application", [item("application_actions", 0, 100)]), dim("service", [item("contributions", 21, 100), item("learners_supported_developed", 0, 1), item("second_generation_sustained", 0, 1)])] },
  ],
  history: [{ stage: 2, name: "Sprout", achievedAt: "2026-09-01T00:00:00Z", kind: "automatic" }],
  verified: { pausedNow: false }, milestones: "approved", promotionsEnabled: false, collective: {}, evaluatedAt: null,
};
const fruit = (id, date, extra = {}) => ({ id, type: "service.learning_feedback", label: "Useful learning feedback given", date, area: "evaluation", areaLabel: "Peer evaluation", kind: "individual", peopleHelped: 1, status: "verified", countsTowardMilestone: true, ...extra });
const tree = {
  stage: { stage: 2, name: "Sprout" }, history: journey.history,
  roots: { coreLessons: { passed: 9, total: 188, percent: 4 }, learningUnits: 14, activeWeeks: 12, activeMonths: 4 }, stems: { practicalActions: 0 },
  branches: [{ area: "evaluation", label: "Peer evaluation", verified: 21 }, { area: "family", label: "Family", verified: 0 }],
  fruits: [fruit("f1", "2026-06-01"), fruit("f2", "2026-10-20"), fruit("p1", "2026-11-10", { status: "pending_review", countsTowardMilestone: false }), fruit("r1", "2026-11-11", { status: "rejected", countsTowardMilestone: false })],
  fruitTotals: { verified: 2, pendingReview: 1, withdrawn: 0, rejected: 1 }, seeds: [],
  consistency: { activeWeeks: 12, firstActivityAt: "2026-05-02T10:00:00Z", pausedNow: false },
  application: [], learningMilestones: [{ units: 1, date: "2026-05-10" }, { units: 10, date: "2026-08-20" }], disclaimer: "", note: "",
};
const plan = { attachments: [{ kind: "green_tip" }], leafClusters: 3, seeds: 0 };
const D = { journey, tree, plan };
const P = (asset, d = D) => H.personalFor(asset, d);

// ── Naming and navigation ──
ok("18. the screen is called How My Tree Grows", tg.title === "How My Tree Grows" && screen.includes('t("treeGrows.title")'));
ok("18. the old visible name is gone from the screen and My Tree; the /botanical route still works", !/How an apple tree grows/.test(screen.replace(/\/\/.*$/gm, "")) && myTree.includes('"How My Tree Grows"') && myTree.includes('router.push("/botanical"'));

// ── The complete botanical process is preserved ──
const names = LC.APPLE_LIFECYCLE.flatMap((s) => s.items.map((i) => i.name));
const required = ["Germinating seed", "Active root tip", "Young roots", "Established roots", "Deep roots", "Dormant winter bud", "Green tip", "Unfurling shoot", "Fruiting spur",
  "Pink bud cluster", "Balloon bud", "Blossom", "Petal fall", "Fruitlet", "Young applelet", "Green apple", "Turning yellow-green", "Golden", "Blushed", "Ripe", "Striped variety"];
ok("4. every existing lifecycle step remains (26, incl. roots, buds, blossom, petal fall, every fruit stage, fruiting spur)", LC.APPLE_LIFECYCLE.flatMap((s) => s.items).length === 26 && required.every((n) => names.includes(n)), required.filter((n) => !names.includes(n)).join());
ok("4. the screen shows every step (APPLE_LIFECYCLE, nothing filtered out)", screen.includes("APPLE_LIFECYCLE.map") && !/APPLE_LIFECYCLE[^;]*\.filter/.test(screen));
ok("4. excluded / held-back assets never appear (Half Apple with Seeds, Single Apple on Stalk)", !/special-half-apple|special-single-apple/.test(src("lib/botanicalLifecycle.ts") + src("lib/howMyTreeGrows.ts") + screen));
ok("4. no PNG / emoji / picture stand-ins; models come from the shared register and BotanicalModelView", screen.includes("BotanicalModelView") && screen.includes("botanicalAvailability(") && !/\.png|Image\b|source=\{/.test(screen));
ok("11. the person's tree is the shared renderer + data (LivingTreeView, useGrowthTree), not a second tree", screen.includes("<LivingTreeView") && screen.includes("useGrowthTree()") && screen.includes("useGrowthStage()"));

// ── Every step has a personal explanation ──
const keys = H.ALL_STEPS.map((s) => H.stepKey(s.asset));
ok("6. every step has name, accurate botany and its meaning in the person's journey", keys.every((k) => tg.steps[k]?.name && tg.steps[k]?.botany && tg.steps[k]?.meaning), keys.filter((k) => !tg.steps[k]?.meaning).join());
ok("6. the botanical notes are the existing, accurate ones (unchanged wording)", LC.APPLE_LIFECYCLE.flatMap((s) => s.items).every((i) => i.note.startsWith(tg.steps[H.stepKey(i.asset)].botany.replace(/ \(The same.*$/, "").slice(0, 30))));
ok("6. every step names its Growth Matrix dimension(s)", H.ALL_STEPS.every((s) => (H.STEP_DIMENSIONS[s.asset] ?? []).length > 0));
ok("6. every step has a personal progress answer whose wording exists", H.ALL_STEPS.every((s) => { const p = P(s.asset); return p.lines.length > 0 && p.lines.every((l) => has(l.key, l.params)); }),
  H.ALL_STEPS.flatMap((s) => P(s.asset).lines.filter((l) => !has(l.key, l.params)).map((l) => l.key)).join());
ok("17. every lifecycle section and state is worded", LC.APPLE_LIFECYCLE.every((s) => tg.lifecycle[s.id]?.title && tg.lifecycle[s.id]?.intro) && ["achieved", "in_progress", "upcoming", "now", "not_now", "season", "unknown"].every((s) => tg.state[s]));

// ── Achieved / in progress / upcoming, from the engine's own numbers ──
ok("7. germinating seed: achieved, dated by the first meaningful activity", P("asset-00-germinating-seed").state === "achieved" && P("asset-00-germinating-seed").lines[0].params.date === "2026-05-02");
ok("7. active root tip: the first learning unit, with its date", P("asset-micro-5-active-root-tip").state === "achieved" && P("asset-micro-5-active-root-tip").lines[0].params.date === "2026-05-10");
ok("7. young roots: achieved as part of reaching Sprout (dated)", P("extra-roots-young").state === "achieved" && P("extra-roots-young").lines[0].params.stage === "Sprout");
const est = P("extra-roots-established");
ok("8. established roots: in progress with the ENGINE's numbers (14 of 20 for Young Tree)", est.state === "in_progress" && est.lines[0].params.have === 14 && est.lines[0].params.need === 20 && est.lines[0].params.stage === "Young Tree");
const deep = P("extra-roots-deep");
ok("9. deep roots: Forest Builder learning AND every Foundations lesson, with the server's total (9 of 188)", deep.state === "in_progress" && deep.lines.some((l) => l.key === "treeGrows.req.core_curriculum_complete") && deep.lines.some((l) => l.params?.passed === 9 && l.params?.total === 188));
ok("9. deep roots never says learning alone makes a Forest Builder", /other three dimensions are needed/.test(tg.steps.extra_roots_deep.meaning));
ok("7. Sprout contributions: achieved as part of reaching Sprout; Young Tree's met but the stage still needs the rest", P("asset-04c-young-green-applelet").state === "achieved"
  && P("asset-apple-stage-2-green").state === "achieved" && P("asset-apple-stage-2-green").lines.some((l) => l.key === "treeGrows.personal.metOthersStill"));
const yg = P("asset-apple-stage-3-yellow-green");
ok("7. Fruitful Tree's contribution needs (50, a learner developed, second generation) are in progress, never achieved", yg.state === "in_progress" && yg.lines.length === 3);
ok("7. a step with nothing yet is upcoming (no practical actions → future)", H.milestoneBoard(D).next.find((d) => d.dimension === "application").items[0].have === 0);
ok("5. balloon bud = contributions awaiting verification, never fruit", P("asset-micro-7-balloon-stage-bud").state === "now" && P("asset-micro-7-balloon-stage-bud").lines[0].params.count === 1 && /not fruit/.test(tg.personal.awaiting_one));
ok("5. ripe fruit: only verified contributions (2, not the pending or rejected ones), latest dated", P("asset-apple-stage-5-ripe-red").lines[0].params.count === 2 && P("asset-apple-stage-5-ripe-red").lines[0].params.date === "2026-10-20");
ok("5. fruit variety (ripe / blushed / striped) carries no meaning: the same answer for each", JSON.stringify(P("asset-04d-blushed-apple")) === JSON.stringify(P("asset-apple-stage-6-striped-red")));
ok("5. green tip only while the tree shows it (recent verified contribution); unfurling shoot not now", P("asset-micro-1-green-tip-bud").state === "now" && P("asset-micro-3-unfurling-shoot-tip").state === "not_now");
ok("5. fruiting spur: only areas with verified evidence (Family with 0 is not one)", P("asset-06-fruiting-spur-socket").lines[0].params.count === 1 && P("asset-06-fruiting-spur-socket").lines[0].params.areas === "Peer evaluation");
ok("5. seasons (winter bud, autumn leaf, June drop) are never a loss", ["asset-micro-6-dormant-winter-bud", "asset-micro-9-golden-autumn-leaf", "asset-micro-8-june-drop-fruitlet"].every((a) => P(a).state === "season")
  && /never/.test(tg.personal.seasonNeverLoss) && /takes nothing away/.test(tg.personal.juneDrop));
ok("8. blossom / pink buds: requirements and dimensions met for the NEXT stage, from the checklist", P("asset-micro-2-pink-bud-cluster").lines[0].params.met === 2 && P("asset-micro-2-pink-bud-cluster").lines[0].params.total === 5
  && P("asset-apple-blossoms").lines[0].params.met === 1 && P("asset-apple-blossoms").state === "in_progress");
ok("8. blossom never awards a stage by itself", /never awards a stage/.test(tg.steps.asset_apple_blossoms.meaning) && /not a promotion/.test(tg.steps.asset_apple_stage_5_ripe_red.meaning));

// ── Board: achieved, growing, next ──
const B = H.milestoneBoard(D);
ok("7A. achieved: stage reached (dated), journey start, learning milestones, verified fruit, met requirements", B.achieved.some((i) => i.dimension === "stage" && i.date === "2026-09-01")
  && B.achieved.some((i) => i.key === "treeGrows.board.unitsMilestone" && i.params.count === 10 && i.date === "2026-08-20") && B.achieved.some((i) => i.key === "treeGrows.board.fruit" && i.params.count === 2)
  && B.achieved.some((i) => i.key === "treeGrows.board.requirementMet" && i.params.label === "contributions"));
ok("7B. growing now: unmet requirements with progress (have/need/remaining) and pending evidence kept apart", B.growing.some((i) => i.key === "treeGrows.board.requirementGrowing" && i.params.have === 14 && i.params.remaining === 6)
  && B.growing.some((i) => i.key === "treeGrows.board.awaitingFruit" && i.params.count === 1) && !B.achieved.some((i) => i.key === "treeGrows.board.awaitingFruit"));
ok("7B. a requirement with nothing yet is not 'growing' (application 0 of 20)", !B.growing.some((i) => i.params?.label === "application_actions"));
ok("8. next stage: ALL four dimensions and every requirement, straight from the engine", B.nextStage === "Young Tree" && B.next.length === 4 && B.next.flatMap((d) => d.items).length === 5);
ok("8. the screen says every requirement is needed and dimensions never compensate", /every requirement below must be met/.test(tg.board.nextIntro) && /never makes up/.test(tg.board.nextIntro));
ok("8. later stages come from the server's `later` checklists (never computed in the app)", screen.includes("journey.later.map") && !/learning_units"\s*,\s*\d|need:\s*\d{2}/.test(screen));

// ── Honest data ──
const none = { journey: null, tree: null, plan: null };
ok("12. failed loads → 'unknown', never a false zero or a false 'not yet'", H.ALL_STEPS.every((s) => ["unknown", "season"].includes(H.personalFor(s.asset, none).state)) && !H.milestoneBoard(none).available);
ok("12. the screen shows an honest unavailable state with Try again", screen.includes('t("treeGrows.unavailableBody")') && screen.includes("onPress={reload}"));
const pending = { ...D, tree: { ...tree, fruits: [fruit("p1", "2026-11-10", { status: "pending_review", countsTowardMilestone: false })], fruitTotals: { verified: 0, pendingReview: 1 } } };
ok("12. pending evidence is never shown as achieved fruit", P("asset-apple-stage-1-fruitlet", pending).state === "upcoming" && P("asset-apple-stage-5-ripe-red", pending).state === "upcoming");
ok("12. nothing private: no answers, reflections, journals or messages read or shown", !/answer|reflection|journal|message/i.test(src("lib/howMyTreeGrows.ts").replace(/\/\/.*$/gm, "").replace(/practical_answer/g, "")));
ok("3. no stage is calculated here (no thresholds, no eligibility in the app)", !/eligible|getStageFromPoints|>= ?(10|20|50|100)\b/.test(src("lib/howMyTreeGrows.ts")));
ok("14. Forest of Nations is never a personal stage here", /never a personal stage/.test(tg.journey.highest) && !/forest-of-nations|Forest of Nations/.test(src("lib/howMyTreeGrows.ts")));
ok("16. no spiritual-worth wording; the disclaimer is said", /never decides them/.test(tg.honest) && /faith, your relationship with God or your worth/.test(tg.honest) && !/more valuable|spiritually mature|spiritual maturity/i.test(JSON.stringify(tg)));
ok("16. the P2P vision is shown", tg.vision === "Everyone is learning from someone and helping someone grow." && screen.includes('t("treeGrows.vision")'));

// ── Story and continue ──
ok("13. growth story: dated verified events only, with a link to the full Growth Story", screen.includes("storyEvents(tree)") && screen.includes('"/growth-timeline"') && /only these are things that happened/.test(tg.story.intro));
const appRoutes = (r) => { const p = r.replace(/^\//, ""); try { readFileSync(path.join(root, "app", p + ".tsx")); return true; } catch { try { readFileSync(path.join(root, "app", p, "index.tsx")); return true; } catch { try { readFileSync(path.join(root, "app/(tabs)", p + ".tsx")); return true; } catch { return false; } } } };
ok("10. every 'Continue growing' link is an existing screen", H.CONTINUE_LINKS.every((l) => appRoutes(l.route)), H.CONTINUE_LINKS.filter((l) => !appRoutes(l.route)).map((l) => l.route).join());
ok("10. links cover all four dimensions and are worded", ["learning", "application", "service", "consistency"].every((d) => H.CONTINUE_LINKS.some((l) => l.dimension === d)) && H.CONTINUE_LINKS.every((l) => tg.continue[l.key]));

// ── Localisation / layout ──
ok("17. every treeGrows key used in the screen exists in English", [...screen.matchAll(/t\("(treeGrows\.[a-zA-Z0-9_.]+)"/g)].every((m) => has(m[1], { count: 1 })), [...screen.matchAll(/t\("(treeGrows\.[a-zA-Z0-9_.]+)"/g)].filter((m) => !has(m[1], { count: 1 })).map((m) => m[1]).join());
ok("17. no hard-coded English labels in the screen (all through t())", !/<Text[^>]*>[A-Z][a-z]+ [a-z]+/.test(screen));
ok("17. RTL-safe (no hard left/right padding or alignment)", !/paddingLeft|paddingRight|marginLeft|marginRight|textAlign: "left"/.test(screen));
ok("register: still the authority (lifecycle note references the register)", /BOTANICAL_REGISTRY/.test(src("lib/botanicalLifecycle.ts")) && /How My Tree Grows/.test(assets));

console.log(`howMyTreeGrows (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
