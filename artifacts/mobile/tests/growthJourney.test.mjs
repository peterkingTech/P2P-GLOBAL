// Growth milestones on the app side (migrations 235–239):
//   • five personal milestones — Seed, Sprout, Young Tree, Fruitful Tree, Forest
//     Builder; Forest of Nations is the collective view, never a person's stage;
//   • the official names, neutral descriptions and Scripture;
//   • the exact explanation and disclaimer; four dimensions; what's verified so far;
//     what is still missing; pauses; the collective-country opt-in;
//   • the journey screen reads the server's calculation, shows milestone
//     checklists by dimension — each requirement as "have / need — percent"
//     of THAT requirement only (never averaged across dimensions), no "points to go";
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
const S = load("constants/stages.ts", { "@/lib/growthModels": { stageStillUrl: (i) => `still-${i}` } });
ok("five personal stages; Forest of Nations kept as the collective (index 5)", S.PERSONAL_STAGE_COUNT === 5 && S.STAGES[S.COLLECTIVE_STAGE_INDEX].name === "Forest of Nations");
ok("old points → personal stage, never Forest of Nations (115 → Forest Builder)", [0, 4, 12, 28, 60, 110, 115, 999].map(S.getStageFromPoints).join() === "0,1,2,3,4,4,4,4");
const OFFICIAL = [
  ["Seed", "The starting point. Everyone begins here, with all of P2P Global open to explore.", "John 12:24"],
  ["Sprout", "First steady steps: a rhythm of taking part, passing assessed learning, putting it into practice and helping others.", "Psalm 1:3"],
  ["Young Tree", "A consistent rhythm over months, with more learning passed, more practice and more help given to others.", "Colossians 2:7"],
  ["Fruitful Tree", "Sustained participation, and helping at least one learner develop who is now helping someone else.", "Matthew 7:20"],
  ["Forest Builder", "The whole Core Curriculum passed, and a long record of helping others learn that those you helped carry on.", "Matthew 28:19"],
  ["Forest of Nations", "What P2P Global's participants build together, generation after generation — shown only as shared totals.", "Revelation 21:24"],
];
ok("the official names, descriptions and Scripture", OFFICIAL.every(([n, d, r], i) => S.STAGES[i].name === n && S.STAGES[i].description === d && S.STAGES[i].verseRef === r));
ok("descriptions make no claims about anyone's inner life", S.STAGES.every((x) => !/belief|abiding|habits of prayer|spiritual|maturity|faith/i.test(x.description)));
ok("stageByName finds a stage by its official name", S.stageByName("Young Tree")?.verseRef === "Colossians 2:7" && !S.stageByName("Root"));

// ── Journey helpers ──
const G = load("lib/growthApi.ts", { "@/lib/apiClient": { apiRequest: async () => ({}) } });
const now = Date.parse("2026-11-04T12:00:00Z");
ok("time in a stage in whole units", G.timeInStage("2026-11-04T08:00:00Z", now) === "since today" && G.timeInStage("2026-10-31T12:00:00Z", now) === "4 days" && G.timeInStage("2026-10-01T12:00:00Z", now) === "4 weeks" && G.timeInStage("2026-05-01T12:00:00Z", now) === "6 months");
ok("the exact explanation and disclaimer are available offline", G.MILESTONE_EXPLANATION === "Growth milestones celebrate how you take part in P2P Global: how consistently you participate, what you learn, how you put learning into practice, and how you help others learn. They are a record of participation and contribution on P2P Global — nothing more."
  && G.MILESTONE_DISCLAIMER === "These milestones do not measure your relationship with God, your faith, or your worth. Only God knows the heart. They simply recognise the activity you've chosen to record here.");
ok("local dates for pauses are calendar dates", G.localDate(0, new Date(2026, 10, 5)) === "2026-11-05" && G.localDate(29, new Date(2026, 10, 5)) === "2026-12-04");
ok("a requirement reads as fraction and percentage of that requirement (10 / 20 — 50%)", G.progressText({ met: false, have: 10, need: 20 }) === "10 / 20 — 50%" && G.progressText({ met: false, have: 1, need: 5 }) === "1 / 5 — 20%"
  && G.progressText({ met: true, have: 12, need: 8 }) === "8 / 8 — 100%" && G.progressText({ met: true, have: 0, need: 0 }) === "0 / 0 — 100%");
ok("percentages never divide by zero and never exceed 100", G.percentOf(0, 0) === 100 && G.percentOf(30, 20) === 100 && G.percentOf(7, 20) === 35);

// ── The journey screen ──
const st = src("app/stages.tsx");
ok("journey screen: the server's calculation (GET /growth/me), refreshed on focus", st.includes("getGrowthJourney()") && st.includes("useFocusEffect"));
ok("…checklist by dimension, 'not needed yet' said plainly", st.includes("journey.next.dimensions.map") && st.includes("Not needed yet for this stage") && st.includes("progressText(i)"));
ok("…progress bars only for single requirements from server data; no overall average, no 'points to go'", st.includes("<ProgressBar percent={i.percent ?? percentOf(i.have, i.need)}") && !/overall|average|more growth points/i.test(st.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
ok("…the stage objective, with what the stage develops on request", st.includes("journey.stage.objective.title") && st.includes("What this stage develops") && st.includes("journey.next.objective"));
ok("…Kingdom School Foundations progress on the milestone screen at every stage, opening the full list", st.includes(">Kingdom School Foundations</Text>") && st.includes('router.push("/core-foundations" as any)') && st.includes("v.coreLessons.passed} / {v.coreLessons.total} lessons"));
ok("…each dimension opens on its own (progressive disclosure) and the development history is one tap away", st.includes("setOpenDim(") && st.includes('router.push("/development-history" as any)'));
const cf = src("app/core-foundations.tsx");
ok("Foundations screen: grouped by Kingdom School curriculum, then module, each with passed / total — percent; 'answer again' lessons explained",
  cf.includes("data.curricula") && cf.includes("cu.passed} / {cu.total} — {cu.percent}%") && cf.includes("answer_again") && cf.includes("fresh start"));
ok("Core Foundations screen: every lesson by module with its status, passed / total — percent, and continue", cf.includes("getCoreFoundations()") && cf.includes("data.passed} / {data.total} lessons — {data.percent}%") && cf.includes("l.statusLabel") && cf.includes("Continue the curriculum"));
const dc = src("contexts/DataContext.tsx");
ok("fresh start: a question whose evaluation was closed shows unanswered, so the learner answers it again", dc.includes('evalBySubmission.get(r.id as string)?.engine_state !== "cancelled"') && dc.includes('engine_state === "cancelled") return null'));
ok("fresh start: a lesson whose waiting evaluation was closed no longer shows 'awaiting review' (unless a new evaluation is waiting)",
  (dc.match(/!\(freshStartLessons\.has\(l\.id as string\) && !evalStatusByLesson\.has\(l\.id as string\)\)/g) ?? []).length === 2);
const dh = src("app/development-history.tsx");
ok("Development history screen: Guides with both stages at each checkpoint ('Not recorded' when unknown), contributors, people helped", dh.includes("getDevelopmentHistory(") && dh.includes("Not recorded") && dh.includes("Everyone who helped") && dh.includes("People helped") && dh.includes("now helping others"));
ok("lineage links to the development history", src("app/lineage.tsx").includes('router.push("/development-history" as any)'));
ok("a Kingdom Stories chapter can be studied together — that exact chapter", src("app/kingdom-stories/chapter.tsx").includes("sectionId: ch.id") && src("components/study/SharedStudySheet.tsx").includes("sectionId: content.sectionId"));
ok("…time in stage, and a recognised legacy stage explained kindly", st.includes("In this stage for {timeInStage(journey.stage.since)}") && st.includes("It stays yours"));
ok("…five personal stages listed; Forest of Nations shown as TOGETHER, not a personal stage", st.includes("STAGES.slice(0, PERSONAL_STAGE_COUNT)") && st.includes("TOGETHER") && /Not a personal stage/.test(st));
ok("…accessible: headers and labelled milestones", (st.match(/accessibilityRole="header"/g) ?? []).length >= 3 && st.includes("accessibilityLabel={`${i.label}:"));
ok("…the explanation and disclaimer shown on the screen (localisable, English fallback)", st.includes('t("growthMilestones.explanation", MILESTONE_EXPLANATION)') && st.includes('t("growthMilestones.disclaimer", MILESTONE_DISCLAIMER)')
  && JSON.parse(src("locales/en.json")).growthMilestones.disclaimer === G.MILESTONE_DISCLAIMER);
ok("…what is verified so far, as counts", st.includes("Verified so far") && st.includes("v.learningUnits") && st.includes("v.practicalActions") && st.includes("v.contributions") && st.includes("v.coreLessons.passed"));
ok("…why a requirement is not yet met (what is missing and what counts)", st.includes("i.missing") && st.includes("i.explanation") && st.includes("never makes up for another"));
ok("…a pause can be taken and ended; it never counts against anyone", st.includes("startGrowthPause(") && st.includes("endGrowthPause(") && /never counts against you/.test(st));
ok("…the collective country is an explicit opt-in", st.includes("setShareCountryInCollective(") && st.includes('accessibilityRole="switch"'));
// (Tree-name suggestions people may choose for their own tree are their own words, not a measurement.)
ok("…no 'spiritual fruit' or 'your spiritual growth is shown' wording in the milestone screens", !/spiritual fruit|spiritual growth is shown/i.test(st + src("app/admin/discipleship.tsx") + src("app/(auth)/journey.tsx")));

// ── Celebrations + notifications ──
ok("a new stage is celebrated first (before a module or lesson)", /const stageEvent = unseen\.find\(\(r\) => r\.event_type === "stage_reached"\);[\s\S]*?if \(stageEvent\) \{\s*setCelebrationEvent\(toEvent\(stageEvent\)\);\s*\} else if \(moduleEvent\)/.test(dc));
const lay = src("app/_layout.tsx");
ok("…with the stage's own emoji, name and Scripture, opening the journey", lay.includes('stage={celebrationEvent.eventType === "stage_reached" ? stageByName(celebrationEvent.label) : undefined}') && lay.includes('router.push("/stages" as any)'));
const modal = src("components/ModuleCelebrationModal.tsx");
ok("…the modal reads 'You have grown into a …' with the verse", modal.includes("You have grown into a") && modal.includes("{stage.verse}") && modal.includes("{stage.verseRef}"));
const push = src("lib/push.ts");
ok("notification taps: a new stage → the journey; a relationship change → My relationships", push.includes('if (notificationType === "growth_stage_reached") return "/stages";') && push.includes('if (notificationType === "peer_guide_relationship_changed") return "/relationships";'));

// ── My Tree ──
const lt = src("app/living-tree.tsx");
ok("My Tree shows the official stage (its own 8-stage names are gone), no percentage bar", lt.includes("{stage.name}") && !lt.includes("{stage.emoji}") && !lt.includes("{newTreeStage.name}") && !lt.includes("newTreeStageProgress") && !/treeStageProgressFill, \{ width/.test(lt));
ok("…a Forest Builder isn't told they're 'growing toward' Forest of Nations", lt.includes("const nextStage = stageIndex + 1 < PERSONAL_STAGE_COUNT ? STAGES[stageIndex + 1] : null;"));
ok("…the accessible summary names the same official stage", lt.includes("stage={{ ...newTreeStage, name: stage.name, description: stage.description }}"));

console.log(`growthJourney (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
