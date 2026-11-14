// MY GROWTH (owner brief 2026-11-14) — the participant's view of verified learning, application,
// contributions and consistency around their real 3D tree. Executes lib/myGrowth.ts + the tree composition
// and checks the screens' sources against the brief's acceptance list (the server rules themselves are
// tested in api-server/tests/growthMyGrowth.test.mjs and growthTree.test.mjs).
// Run: node tests/myGrowth.test.mjs
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
const load = (f) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, Set, Map, process: { env: {} }, require: (n) => { throw new Error(`require ${n}`); } });
  return mod.exports;
};
const M = load("lib/myGrowth.ts");
const C = load("lib/growthTreeComposition.ts");
const en = JSON.parse(src("locales/en.json"));
const screen = src("app/my-growth.tsx"), myTree = src("app/living-tree.tsx"), story = src("app/growth-timeline.tsx"), home = src("app/(tabs)/index.tsx");

// TEST DATA (invented for these checks only).
const fruit = (id, date, extra = {}) => ({ id, type: "service.learning_feedback", label: "Useful learning feedback given", date, area: "evaluation", areaLabel: "Peer evaluation", kind: "individual", peopleHelped: 1, status: "verified", countsTowardMilestone: true, ...extra });
const tree = {
  stage: { stage: 3, name: "Young Tree", description: "d", since: "2026-08-01T00:00:00Z", verification: "verified", objective: { title: "x" } },
  history: [{ stage: 2, name: "Sprout", achievedAt: "2026-04-01T00:00:00Z", kind: "automatic" }, { stage: 3, name: "Young Tree", achievedAt: "2026-08-01T00:00:00Z", kind: "automatic" }],
  roots: { coreLessons: { passed: 30, total: 188, percent: 15 }, learningUnits: 41, activeWeeks: 22, activeMonths: 7 }, stems: { practicalActions: 2 },
  branches: [{ area: "evaluation", label: "Peer evaluation", verified: 3 }],
  fruits: [fruit("f1", "2026-06-01"), fruit("f2", "2026-07-01", { kind: "group", type: "service.study_session_facilitated", peopleHelped: 9 }), fruit("f3", "2026-10-01", { status: "pending_review", countsTowardMilestone: false }),
    fruit("f4", "2026-10-02", { status: "rejected", countsTowardMilestone: false }), fruit("f5", "2026-10-03", { status: "withdrawn", countsTowardMilestone: false })],
  fruitTotals: { verified: 2, pendingReview: 1, withdrawn: 1, rejected: 1 }, seeds: [],
  consistency: { activeWeeks: 22, activeMonths: 7, journeyDays: 200, daysInStage: 100, pausedDaysInStage: 0, pausedNow: false, activeWeeksLast16: 9, activeWeeksLast26: 15, firstActivityAt: null, recentDays: 14, recentQualifying: 0, lastQualifyingOn: "2026-10-03", calculatedFor: "2026-11-14" },
  application: [{ id: "a1", type: "application.practical_answer_approved", label: "Practical action verified", date: "2026-05-05", area: "kingdom_school", areaLabel: "Kingdom School", status: "verified", countsTowardMilestone: true },
    { id: "a2", type: "application.group_practical_reviewed", label: "Group practical activity reviewed", date: "2026-11-01", area: "group_learning", areaLabel: "group_learning", status: "pending_review", countsTowardMilestone: false }],
  learningMilestones: [{ units: 1, date: "2026-03-01" }, { units: 10, date: "2026-05-01" }],
  disclaimer: "", note: "",
};

// 1. Official stage = the server's (Matrix) stage; 2. no seventh stage; 3. Forest of Nations collective only.
const sum = M.treeSummary(tree);
ok("1. summary: the official stage is the server's stage name", sum.find((r) => r.key === "stage").value === "Young Tree");
ok("1. screen: stage card reads the server stage (tree.stage / useGrowthStage), never points", screen.includes("tree?.stage.name ?? stage.name") && !/growthLevel|getStageFromPoints/.test(screen));
ok("2. no seventh individual stage: the tree bodies are the 5 personal stages", Object.keys(C.STAGE_BODIES).join() === "1,2,3,4,5");
ok("2. My Tree counts personal stages (no 'OF 6'), no points 'Growth Level'", !myTree.includes("OF 6") && myTree.includes("OF {PERSONAL_STAGE_COUNT}") && !myTree.includes("growthPoints") && !/Lv\{node\.growthLevel\}/.test(myTree));
ok("3. Forest of Nations is never a personal tree body", !Object.values(C.STAGE_BODIES).includes("forest-of-nations-3d-landscape") && C.composeTree({ ...tree, stage: { ...tree.stage, stage: 6 } }, "2026-11-14").stage === 5);
ok("3. My Growth says Forest Builder is the highest personal stage; Forest of Nations collective", /not a personal stage/.test(en.myGrowth.stage.top));

// 4–8. Learning.
ok("4. Core Foundations shows passed / server total (188 here) — never a fixed 84", sum.find((r) => r.key === "foundations").value === "30/188" && !/\b84\b/.test(screen));
ok("4. roots detail uses the server total (half of 188 → deeper roots at 94, not 42)", C.composeTree({ ...tree, roots: { ...tree.roots, coreLessons: { passed: 50, total: 188 }, learningUnits: 41 } }, "2026-11-14").rootDetail === 1
  && C.composeTree({ ...tree, roots: { ...tree.roots, coreLessons: { passed: 94, total: 188 }, learningUnits: 41 } }, "2026-11-14").rootDetail === 2
  && C.composeTree({ ...tree, roots: { ...tree.roots, coreLessons: { passed: 188, total: 188 }, learningUnits: 200 } }, "2026-11-14").rootDetail === 3);
ok("4. routes to continue learning and to the full curriculum", screen.includes('"/core-foundations"') && screen.includes("core.next!.id"));
ok("5–7. unique learning units come from the server count (no client counting)", sum.find((r) => r.key === "units").value === 41 && !/new Set\(.*lesson/i.test(screen));
ok("8. Learning Roots come from the server's curriculum groupings (no title guessing on the device)", screen.includes("getLearningRoots()") && !/\.title\.(includes|match|toLowerCase)/.test(screen));
ok("8. the proposed wider themes are labelled as awaiting editorial review", /waiting for editorial review/.test(en.myGrowth.roots.themesNote));
ok("8. neutral status labels only (no expert/master/mature)", Object.values(en.myGrowth.roots.status).join("|") === "Assessment passed|Returned for revision|Awaiting assessment|In progress" && !/expert|master|mature|competent/i.test(JSON.stringify(en.myGrowth)));
ok("8. a root on the model is never claimed to be one lesson", /does not stand for a single lesson/.test(en.myGrowth.roots.highlightNote));

// 9. Application; 10. privacy.
const ev = M.storyEvents(tree);
ok("9. only verified application appears in the story (awaiting review does not)", ev.filter((e) => e.kind === "application").map((e) => e.ref).join() === "a1");
ok("9. what does not count is stated", /attendance alone/.test(en.myGrowth.application.notCounted) && /self-declared/.test(en.myGrowth.application.notCounted));
ok("10. no private content is read or shown (answers, reflections, journals, messages)", !/\b(answer_text|reflection_text|journal|message_body)\b|\.content\b/.test(screen) && !/\.answer\b|\.reflection\b/.test(screen));

// 11–15. Fruit.
const plan = C.composeTree(tree, "2026-11-14");
const fruitIds = plan.attachments.filter((a) => a.kind === "fruit").map((a) => a.ref).sort().join();
ok("11. fruit only for verified contributions", fruitIds === "f1,f2");
ok("12. awaiting verification → a bud", plan.attachments.filter((a) => a.kind === "fruit_bud").map((a) => a.ref).join() === "f3");
ok("13. rejected and withdrawn → no fruit and no bud", !plan.attachments.some((a) => ["f4", "f5"].includes(a.ref)));
ok("14. a group session (9 took part) is ONE fruit", plan.attachments.filter((a) => a.ref === "f2").length === 1);
const again = C.composeTree(JSON.parse(JSON.stringify(tree)), "2026-11-14");
ok("15. fruit positions are deterministic", JSON.stringify(plan.attachments) === JSON.stringify(again.attachments));
ok("15. tapping a fruit/bud maps to its ledger record", JSON.stringify(M.recordFromSelection("fruit:f2")) === JSON.stringify({ kind: "fruit", evidenceId: "f2" }) && M.recordFromSelection("bud:f3").kind === "bud" && M.recordFromSelection("leaf:3") === null);

// 16. Inactivity.
const later = C.composeTree(tree, "2027-11-14");
ok("16. a year without activity removes no leaves and no fruit, and keeps the stage", later.leafClusters === plan.leafClusters && later.stage === plan.stage
  && later.attachments.filter((a) => a.kind === "fruit").length === plan.attachments.filter((a) => a.kind === "fruit").length);
ok("16. the screen says resting never lowers a stage", /never lowers your stage/.test(en.myGrowth.consistency.noDowngrade));

// 17. Four dimensions, no percentages.
ok("17. the four Matrix dimensions are explained, no fifth", Object.keys(en.myGrowth.stage.dimensionPurpose).join() === "consistency,learning,application,service");
ok("17. no percentage or averaged progress on My Growth or My Tree", !/\d+%\s*(toward|complete|done)|percent/.test(screen.replace(/\/\/.*$/gm, "")) && !myTree.includes("progressPct") && !src("components/GrowthVideoModal.tsx").includes("progressPct"));

// 18. One shared data source.
ok("18. My Growth, My Tree and the Growth Story use the shared tree hook (useGrowthTree)", [screen, myTree, story].every((s) => s.includes("useGrowthTree")) && !story.includes("getGrowthTree") && !screen.includes("getGrowthTree"));
ok("18. Home still uses the same hook", home.includes("useGrowthTree"));
ok("18. My Growth draws the person's tree with the shared renderer", screen.includes('<LivingTreeView') && screen.includes('mode="tree"'));

// 19. Story kinds.
ok("19. Growth Story: stage, learning, application, contribution and botanical events kept apart", ["stage", "learning", "application", "fruit", "botany"].every((k) => ev.some((e) => e.kind === k)) && Object.keys(en.myGrowth.story.kinds).length === 5);
ok("19. every story event has a date from its record; learning milestones are the server's", ev.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date)) && ev.filter((e) => e.kind === "learning").map((e) => e.units).sort((a, b) => a - b).join() === "1,10");
ok("19. the botanical 'first fruit' is dated by the first verified fruit", ev.find((e) => e.kind === "botany").date === "2026-06-01");

// 20–22. Assets, lifecycle, lessons.
ok("20. no picture or emoji stands in for the 3D tree on My Growth", !/<Image\b|require\(".*\.(png|jpg)"\)/.test(screen));
ok("21. the educational lifecycle stays separate (not imported into My Growth)", !/botanicalLifecycle|LIFECYCLE/.test(screen));
ok("22. no 3D models in ordinary lessons", !/LivingTreeView|BotanicalModelView|TreeModelViewer/.test(src("app/lesson/[id].tsx")));

// 23. Localisation.
const keys = [...screen.matchAll(/t\(\s*[`"]myGrowth\.([\w.]+)[`"]/g)].map((m) => m[1]);
const get = (o, k) => k.split(".").reduce((a, x) => a?.[x], o);
const missing = keys.filter((k) => get(en.myGrowth, k) === undefined && get(en.myGrowth, k + "_one") === undefined);
ok("23. every My Growth string used by the screen exists in en.json", keys.length > 40 && !missing.length, missing.join(", "));
ok("23. plural strings use i18next v4 _one/_other", en.myGrowth.roots.practicalVerified_one && en.myGrowth.roots.practicalVerified_other && !("practicalVerified" in en.myGrowth.roots));
ok("23. layout uses start/end-neutral styles (no hard left/right text alignment)", !/textAlign: "left"|marginLeft|paddingRight/.test(screen));
ok("23. other languages fall back to English (i18n fallbackLng)", /fallbackLng: "en"/.test(src("lib/i18n.ts")));

// Navigation.
ok("route registered; reachable from My Tree and the Growth Story", src("app/_layout.tsx").includes('"my-growth"') && myTree.includes('"/my-growth"') && story.includes('"/my-growth"') && existsSync(path.join(root, "app/my-growth.tsx")));
ok("the motto and the disclaimer are shown", screen.includes("myGrowth.motto") && screen.includes("tree.disclaimer"));

console.log(`myGrowth (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
