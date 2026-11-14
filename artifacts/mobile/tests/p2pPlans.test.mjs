// P2P PLANS (owner brief 2026-11-14) — the app side: lib/studyPlansUi.ts executed, and the screens checked
// against the brief's acceptance list (§20). The server rules are tested in api-server/tests/studyPlans.test.mjs
// and the tables on a throwaway database (proposal 249/250). Run: node tests/p2pPlans.test.mjs
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
const mods = { "react-native": { Platform: { select: (o) => o.default } }, "@/lib/apiClient": { apiRequest: async () => ({}) } };
const load = (f) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, Set, Map, RegExp,
    require: (n) => { if (mods[n]) return mods[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};
mods["@/lib/bibleBooks"] = load("lib/bibleBooks.ts");
mods["@/lib/bibleReaderApi"] = load("lib/bibleReaderApi.ts");
const U = load("lib/studyPlansUi.ts");
const en = JSON.parse(src("locales/en.json")).p2pPlans;
const home = src("app/plans/index.tsx"), detail = src("app/study-plan/[id].tsx"), session = src("app/study-plan/session.tsx"), builder = src("app/plans/builder.tsx");
const screens = home + detail + session + builder;
const routeExists = (r) => { const p = r.pathname.replace(/^\//, ""); return ["", ".tsx", "/index.tsx"].some((x) => existsSync(path.join(root, "app", p + x))) || existsSync(path.join(root, "app/(tabs)", p + ".tsx")); };

// ── Resources open their EXISTING screens, by their own ids ──
const kinds = [
  { kind: "bible_passage", book: "ROM", chapter: 8, startVerse: 1, endVerse: 11 }, { kind: "lesson", id: "L1" }, { kind: "kingdom_story", id: "S1" }, { kind: "kingdom_story", id: "S1", chapterId: "C2" },
  { kind: "scripture_topic", slug: "faith" }, { kind: "deep_study", book: "JHN", chapter: 3 }, { kind: "commentary", book: "ACT", chapter: 2 }, { kind: "word_study", strongs: "G26" },
  { kind: "dictionary_term", key: "grace" }, { kind: "curriculum", id: "CU1" },
];
const routes = kinds.map((k) => U.resourceRoute(k));
ok("every resource kind opens an existing screen", routes.every((r) => r && routeExists(r)), JSON.stringify(routes.filter((r) => !r || !routeExists(r))));
ok("a passage opens the EXISTING Bible reader at that reference (no second reader)", JSON.stringify(routes[0]) === JSON.stringify({ pathname: "/bible", params: { book: "ROM", chapter: "8", v: "1", ve: "11" } }) && !existsSync(path.join(root, "app/study-plan/reader.tsx")));
ok("resources keep their own ids (lesson L1, story chapter C2, Strong's G26)", routes[1].params.id === "L1" && routes[3].params.chapter === "C2" && routes[7].params.strongs === "G26");
ok("commentary opens Deep Study's commentaries tab for the passage", routes[6].params.tab === "commentaries" && routes[6].params.book === "ACT");
ok("references parse ('Romans 8:1-11', '1 John 4', nonsense → null)", JSON.stringify(U.parseReference("Romans 8:1-11")) === JSON.stringify({ book: "ROM", chapter: 8, startVerse: 1, endVerse: 11 })
  && U.parseReference("1 John 4")?.book === "1JN" && U.parseReference("hello world") === null);
ok("one session per chapter (Romans 1–16; a range; beyond the last chapter capped)", U.chapterSessions("ROM").length === 16 && U.chapterSessions("ROM", 5, 8).map((s) => s.title).join() === "Romans 5,Romans 6,Romans 7,Romans 8" && U.chapterSessions("JUD").length === 1);
ok("passage text for display", U.passageText({ book: "PSA", chapter: 23 }) === "Psalms 23" && U.passageText({ book: "JHN", chapter: 3, startVerse: 16, endVerse: 16 }) === "John 3:16");

// ── Scheduling preview (the server decides) ──
const e1 = U.estimate(16, "monthly", "daily"), e2 = U.estimate(260, "weekly", "daily"), e3 = U.estimate(16, "monthly", "flexible");
ok("preview: 16 in a month daily = 1 a day; 260 in a week = too much; flexible = no dates", e1.perDay === 1 && !e1.tooMuch && e2.tooMuch && e3.perDay === null && !e3.tooMuch);
ok("every duration and pace from the brief", U.DURATIONS.join() === "daily,weekly,monthly,quarterly,half_year,yearly,custom" && U.PACES.join() === "daily,five_weekly,three_weekly,weekly,flexible");
ok("planned dates are neutral — never 'late', 'missed', streaks or points", U.dueKey("2026-11-10", "2026-11-14").key === "dueOn" && U.dueKey("2026-11-14", "2026-11-14").key === "dueToday" && U.dueKey(null, "2026-11-14").key === "noDate"
  && !/late|missed|overdue|streak|behind|points/i.test(JSON.stringify(en)));

// ── Discovery: collections are shelves of one system ──
const P = (id, extra) => ({ id, title: id, description: null, focusType: "bible_book", focusLabel: id, official: true, collection: "bible_books", togetherSuitable: true, ...extra });
const cat = [P("Romans"), P("Holy Spirit", { focusType: "theme", collection: "topical" }), P("Mine", { official: false, collection: null }), P("Solo", { togetherSuitable: false, collection: "topical" })];
ok("collections: official plans by shelf in order, the person's own last", U.shelves(cat).map((s) => s.collection).join() === "bible_books,topical,mine");
ok("filters: focus, search (accents/apostrophes ignored), together", U.filterPlans(cat, { focus: "theme" }).length === 1 && U.filterPlans(cat, { q: "ROMANS" }).length === 1 && U.filterPlans(cat, { together: true }).length === 3);

// ── Screens ──
ok("10. home: continue, explore (search + focus + collections), My Plans tabs incl. paused/created/saved/together", home.includes('t("p2pPlans.continue")') && home.includes("shelves(plans)") && home.includes("filterPlans(") && /MINE_TABS: MineTab\[\] = \["active", "paused", "completed", "created", "saved", "together"\]/.test(home));
ok("10. the Learning Centre topic plans keep their own browser (moved, unchanged) and are linked", existsSync(path.join(root, "app/plans/learning.tsx")) && src("app/plans/learning.tsx").includes("Recommended for You") && home.includes('"/plans/learning"'));
ok("11. details: focus, primary + supporting kinds, sessions, schedule, mode, objectives, questions, sample; start individually / together / save", ["mainFocus", "primary", "supporting", "sessions", "suggested", "mode", "objectives", "questions", "sample", "startIndividually", "startTogether", "save"].every((k) => detail.includes(`p2pPlans.detail.${k}`)));
ok("11. joining a group is never forced (individual start is separate)", detail.includes('setPanel("individual")') && detail.includes("openTogether"));
ok("6. questions shown by default, Show / Hide on the session; hiding never calls completion", session.includes("override ?? (run ? run.showQuestions : true)") && session.includes('t("p2pPlans.session.hide")') && session.includes("showQuestions: !show") && !/toggle[^\n]*setSessionDone/.test(session));
ok("6. questions are a learning aid: nothing to submit, no answer fields", !/TextInput/.test(session) && /nothing to submit/.test(en.session.questionsNote));
ok("13. session: only its own sections (Scripture, intro, questions, supporting, reflection, prayer, completion)", ["scripture", "intro", "questions", "supporting", "reflection", "prayer", "markDone"].every((k) => session.includes(`p2pPlans.session.${k}`)));
ok("13. Scripture opens the existing reader; Listen is the reader's own (no plan audio player)", session.includes("passageRoute(p)") && !/expo-av|expo-audio|expo-speech|Audio\./.test(screens));
ok("14. opening a session completes nothing; completion is an explicit action; lesson sessions only through the lesson", !/useEffect\([^)]*setSessionDone/.test(session) && session.includes("mark(true)") && session.includes("x.derived ?") && session.includes('t("p2pPlans.session.lessonNote")'));
ok("8. schedule: duration + pace + start date; a server refusal is explained with a suggestion, never silently changed", detail.includes("SchedulePicker") && detail.includes("problem.suggestion") && detail.includes("acceptSchedule"));
ok("9. together uses Study Together (shared study first, then my own run)", detail.includes("startSharedStudy(") && detail.includes('contentType: "study_plan"') && detail.includes("sharedStudyId"));
ok("9. Study Together knows plans and opens each person's own run", src("lib/studyTogetherApi.ts").includes('study_plan: "P2P Plan"') && src("lib/studyTogetherApi.ts").includes('pathname: "/study-plan/[id]"'));
ok("12. builder: 7 steps, Bible chapters/passages or existing lessons by id, supporting per session, then create (and start)", [1, 2, 3, 4, 5, 6, 7].every((n) => en.builder[`step${n}`]) && builder.includes("chapterSessions(") && builder.includes('kind: "lesson", id: l.id') && builder.includes("addSupport(") && builder.includes("createPlan("));
ok("15. a participant's plan is shown as theirs, never as official P2P curriculum", /isn't official P2P curriculum/.test(en.builder.privateNote) && detail.includes('t("p2pPlans.detail.notOfficial")'));
ok("18. Growth Matrix: the app never claims credit for plan sessions", /doesn't award Growth Matrix credit/.test(en.detail.growthNote) && !/growthApi"\)?;?[^\n]*(record|award)/.test(screens));
ok("no Bible text in the plan screens (references only)", !/bible\.helloao|verseText|getChapter\(/.test(screens));
const keys = [...screens.matchAll(/t\(`?"?p2pPlans\.([a-zA-Z0-9_.]+)/g)].map((m) => m[1]).filter((k) => !k.endsWith(".") && k !== "builder.step"); // builder.step${n} is checked below
const get = (k) => k.split(".").reduce((o, p) => (o == null ? o : o[p]), en);
ok("17. every fixed p2pPlans key used by the screens exists in English", keys.every((k) => get(k) !== undefined || (get(k + "_one") && get(k + "_other"))), keys.filter((k) => get(k) === undefined && !get(k + "_one")).join());
ok("17. every focus, collection, kind, duration and pace has a label", U.FOCUS_TYPES.every((f) => en.focus[f]) && [...U.COLLECTIONS, "mine"].every((c) => en.collection[c]) && U.DURATIONS.every((d) => en.duration[d]) && U.PACES.every((p) => en.pace[p]) && Object.keys(en.kind).length === 9);
ok("17. RTL-safe (no hard left/right spacing or alignment)", !/paddingLeft|paddingRight|marginLeft|marginRight|textAlign: "left"|textAlign: "right"/.test(screens));
ok("routes registered with their own header", ["plans/index", "plans/learning", "plans/builder", "study-plan/[id]", "study-plan/session"].every((r) => src("app/_layout.tsx").includes(`"${r}"`)));
ok("Learning tab has a P2P Plans tile", src("components/LearningHub.tsx").includes('route: "/plans"'));
ok("no 3D, no Growth Tree reward in plans", !/LivingTreeView|BotanicalModelView|growthTree/i.test(screens));
console.log(`p2pPlans (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
