// Growth journey on the app side (migrations 235–237):
//   • five personal stages — Forest Builder is the highest; Forest of Nations
//     is the collective view, never a person's stage (even from old points);
//   • the official names, descriptions and Scripture are unchanged;
//   • the journey screen reads the server's calculation, shows milestone
//     checklists by dimension and never a percentage or "points to go";
//   • a new stage is celebrated first (with its Scripture) and opens the
//     journey; notification taps go to the right screens;
//   • My Tree shows the one official stage (its own 8-stage names are gone).
// Run: node tests/growthJourney.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (p) => readFileSync(path.join(root, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
function load(file, mocks = {}) {
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Math, Number, String, JSON, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n}`); } });
  return mod.exports;
}

// ── Stages ──
const S = load("constants/stages.ts");
ok("five personal stages; Forest of Nations kept as the collective (index 5)", S.PERSONAL_STAGE_COUNT === 5 && S.STAGES[S.COLLECTIVE_STAGE_INDEX].name === "Forest of Nations");
ok("old points → personal stage, never Forest of Nations (115 → Forest Builder)", [0, 4, 12, 28, 60, 110, 115, 999].map(S.getStageFromPoints).join() === "0,1,2,3,4,4,4,4");
const OFFICIAL = [
  ["Dormant Seed", "The journey begins in stillness. A seed rests in the soil, holding the promise of everything to come.", "John 12:24"],
  ["Sprout", "First light. Tender shoots break the surface as new habits of prayer and Scripture take hold.", "Psalm 1:3"],
  ["Young Tree", "A trunk forms and branches reach outward. Consistency is turning belief into a settled root system.", "Colossians 2:7"],
  ["Fruitful Tree", "The canopy fills and fruit appears — the visible overflow of a life abiding and bearing witness.", "Matthew 7:20"],
  ["Forest Builder", "Saplings rise in your shade. You are no longer only growing — you are helping others take root.", "Matthew 28:19"],
  ["Forest of Nations", "A whole grove flourishes. Generations of disciples now shelter, feed, and multiply one another.", "Revelation 21:24"],
];
ok("the official names, descriptions and Scripture are unchanged", OFFICIAL.every(([n, d, r], i) => S.STAGES[i].name === n && S.STAGES[i].description === d && S.STAGES[i].verseRef === r));
ok("stageByName finds a stage by its official name", S.stageByName("Young Tree")?.verseRef === "Colossians 2:7" && !S.stageByName("Root"));

// ── Journey helpers ──
const G = load("lib/growthApi.ts", { "@/lib/apiClient": { apiRequest: async () => ({}) } });
const now = Date.parse("2026-11-04T12:00:00Z");
ok("time in a stage in whole units", G.timeInStage("2026-11-04T08:00:00Z", now) === "since today" && G.timeInStage("2026-10-31T12:00:00Z", now) === "4 days" && G.timeInStage("2026-10-01T12:00:00Z", now) === "4 weeks" && G.timeInStage("2026-05-01T12:00:00Z", now) === "6 months");
ok("a milestone reads as a count against its requirement — no percentage", G.progressText({ met: false, have: 5, need: 8 }) === "5 of 8" && G.progressText({ met: true, have: 9, need: 8 }) === "Done" && G.progressText({ met: false, have: 12, need: 8 }) === "8 of 8");

// ── The journey screen ──
const st = src("app/stages.tsx");
ok("journey screen: the server's calculation (GET /growth/me), refreshed on focus", st.includes("getGrowthJourney()") && st.includes("useFocusEffect"));
ok("…checklist by dimension, 'not needed yet' said plainly", st.includes("journey.next.dimensions.map") && st.includes("Not needed yet for this stage") && st.includes("progressText(i)"));
ok("…no percentages, progress bars or 'points to go'", !/%`|\* 100|progressBar|more growth points/.test(st));
ok("…time in stage, and a recognised legacy stage explained kindly", st.includes("In this stage for {timeInStage(journey.stage.since)}") && st.includes("It stays yours"));
ok("…five personal stages listed; Forest of Nations shown as TOGETHER, not a personal stage", st.includes("STAGES.slice(0, PERSONAL_STAGE_COUNT)") && st.includes("TOGETHER") && /Not a personal stage/.test(st));
ok("…accessible: headers and labelled milestones", (st.match(/accessibilityRole="header"/g) ?? []).length >= 3 && st.includes("accessibilityLabel={`${i.label}:"));

// ── Celebrations + notifications ──
const dc = src("contexts/DataContext.tsx");
ok("a new stage is celebrated first (before a module or lesson)", /const stageEvent = unseen\.find\(\(r\) => r\.event_type === "stage_reached"\);[\s\S]*?if \(stageEvent\) \{\s*setCelebrationEvent\(toEvent\(stageEvent\)\);\s*\} else if \(moduleEvent\)/.test(dc));
const lay = src("app/_layout.tsx");
ok("…with the stage's own emoji, name and Scripture, opening the journey", lay.includes('stage={celebrationEvent.eventType === "stage_reached" ? stageByName(celebrationEvent.label) : undefined}') && lay.includes('router.push("/stages" as any)'));
const modal = src("components/ModuleCelebrationModal.tsx");
ok("…the modal reads 'You have grown into a …' with the verse", modal.includes("You have grown into a") && modal.includes("{stage.verse}") && modal.includes("{stage.verseRef}"));
const push = src("lib/push.ts");
ok("notification taps: a new stage → the journey; a relationship change → My relationships", push.includes('if (notificationType === "growth_stage_reached") return "/stages";') && push.includes('if (notificationType === "peer_guide_relationship_changed") return "/relationships";'));

// ── My Tree ──
const lt = src("app/living-tree.tsx");
ok("My Tree shows the official stage (its own 8-stage names are gone), no percentage bar", lt.includes("{stage.emoji} {stage.name}") && !lt.includes("{newTreeStage.name}") && !lt.includes("newTreeStageProgress") && !/treeStageProgressFill, \{ width/.test(lt));
ok("…a Forest Builder isn't told they're 'growing toward' Forest of Nations", lt.includes("const nextStage = stageIndex + 1 < PERSONAL_STAGE_COUNT ? STAGES[stageIndex + 1] : null;"));
ok("…the accessible summary names the same official stage", lt.includes("stage={{ ...newTreeStage, name: stage.name, description: stage.description }}"));

console.log(`growthJourney (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
