// Tests for the Learning System redesign (Learning Centre landing, Kingdom
// School screen, Bible Study, Study Together hub, Kingdom Stories carousel):
//  1. lib/learningHome.ts — Continue Learning from real progress only, in a
//     sensible order, each item opening its own screen.
//  2. lib/studyTogetherApi.ts hubItems / hubFilters — one collection over the
//     real study records; filters only for kinds that exist.
//  3. lib/bibleStudy.ts — topic references open in context in the P2P reader.
//  4. Source checks — no second Kingdom School dashboard; links; Bible Study
//     offers no empty reading plans; the hub reads no private data; the hero
//     carousel never turns by itself and respects reduced motion; the
//     proposed migration 219 is additive and not referenced by code yet.
// Run: node tests/learningSystem.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const mocks = {
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
  "react-native": { Platform: { OS: "web", select: (o) => o.default }, Linking: {} },
  "expo-router": { router: { push: () => {} } },
};
const cache = new Map();
function loadFile(file) {
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (m) => {
    if (m in mocks) return mocks[m];
    if (m.startsWith("@/")) { const base = path.join(root, m.slice(2)); for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return loadFile(base + ext); }
    return {};
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, console, Date, Math, JSON, fetch: async () => ({ ok: false }) });
  cache.set(file, mod.exports);
  return mod.exports;
}

// ── 1. Continue Learning ────────────────────────────────────────────────
const { continueItems } = loadFile(path.join(root, "lib/learningHome.ts"));
const mod = (o) => ({ id: "m1", title: "Who Is God?", lessonCount: 8, completedLessons: 3, isLocked: false, ...o });
const story = (o) => ({ id: "s1", title: "Abraham", category: { title: "Biblical History" }, myProgress: { totalChapters: 6, doneChapters: 2, started: true }, lastChapterNumber: 3, media: [{ mediaPath: "a/b.jpg" }], ...o });
const study = { id: "t1", title: "Creation", contentType: "kingdom_story", destination: { type: "family", name: "The Okafors" }, lastOpenedAt: null, updatedAt: "2026-10-28T10:00:00Z" };
const bible = { book: "JHN", bookName: "John", chapter: 3, translation: "KJV" };
let c = continueItems({ modules: [mod()], stories: [story()], studies: [study], bible });
ok("continue: work under way first (module, story, shared study), then the Bible", c.map((x) => x.kind).join() === "school,story,together,bible");
ok("continue: real progress only", c[0].progress === 3 / 8 && c[1].progress === 2 / 6 && c[2].progress === null && c[3].progress === null);
ok("continue: details in words", c[0].detail === "3 of 8 lessons" && c[1].detail === "Biblical History · Chapter 3 of 6" && c[2].detail === "Kingdom Story · The Okafors" && c[3].title === "John 3");
ok("continue: each item opens its own screen", c[0].route.pathname === "/module/[id]" && c[1].route.params.open === "next" && c[2].route.pathname === "/study-together/[id]" && c[3].route.pathname === "/bible");
c = continueItems({ modules: [mod({ completedLessons: 0 })], stories: [], studies: [], bible: null });
ok("continue: a module not yet begun comes last, as 'not started' (0%)", c.length === 1 && c[0].kind === "school" && c[0].progress === 0 && /not started/.test(c[0].detail));
ok("continue: finished, locked and empty things are left out", continueItems({ modules: [mod({ isLocked: true }), mod({ id: "m2", completedLessons: 8 })], stories: [story({ myProgress: { totalChapters: 6, doneChapters: 6, started: true } }), story({ id: "s2", myProgress: { totalChapters: 6, doneChapters: 0, started: false } })] }).length === 0);
ok("continue: nothing at all → empty (the screen explains where to begin)", continueItems({}).length === 0);
c = continueItems({ modules: [mod({ imageUrl: "https://x/m.jpg" })], stories: [story()], studies: [{ ...study, contentId: "s9" }, { ...study, id: "t2", contentType: "lesson", contentId: "s9" }], storyCovers: { s9: "c/d.jpg" } });
ok("continue: each item carries its photo (story cover, module photo, shared story's cover; lessons none)", c[0].imageUrl === "https://x/m.jpg" && c[1].imagePath === "a/b.jpg" && c[2].imagePath === "c/d.jpg" && c[3].imagePath === null);

// ── 2. Study Together hub ───────────────────────────────────────────────
const st = loadFile(path.join(root, "lib/studyTogetherApi.ts"));
const card = (o) => ({ id: "a", title: "A", contentType: "kingdom_story", contentId: "x", status: "active", destination: { type: "peer", id: null, name: null }, host: { id: "h", name: "Ruth" }, isHost: false, myStatus: "accepted", invitedAt: null, expiresAt: null, lastOpenedAt: null, updatedAt: "2026-10-20T00:00:00Z", ...o });
const data = {
  invitations: [card({ id: "inv" })],
  active: [card({ id: "old", updatedAt: "2026-10-01T00:00:00Z" }), card({ id: "new", contentType: "lesson", destination: { type: "church", id: "c1", name: "Grace Church" }, lastOpenedAt: "2026-10-28T00:00:00Z" })],
  concluded: [card({ id: "done", status: "concluded", updatedAt: "2026-10-29T00:00:00Z" })],
  groupLessons: [{ id: "g1", kind: "family", title: "Family Psalms", description: null, groupId: "f1", groupName: "The Okafors", updatedAt: "2026-10-27T00:00:00Z" }],
};
const items = st.hubItems(data);
ok("hub: one collection — in-progress first by latest activity, completed last; invitations kept apart", items.map((x) => x.key).join() === "s:new,g:family:g1,s:old,s:done");
ok("hub: each card opens its own screen", items[0].route.pathname === "/study-together/[id]" && items[1].route.pathname === "/family/studies/[studyId]" && items[1].route.params.studyId === "g1");
ok("hub: says what and where", items[0].typeLabel === "Kingdom School lesson" && items[0].where === "Church · Grace Church" && items[1].typeLabel === "Family Circle study" && items[2].where === "With Ruth");
ok("hub: filters only for kinds that exist", st.hubFilters(items).join() === "all,kingdom_story,lesson,group_lessons" && st.hubFilters(st.hubItems({ invitations: [], active: [card({})], concluded: [] })).join() === "all,kingdom_story");
ok("hub: older API without groupLessons still works", st.hubItems({ invitations: [], active: [card({})], concluded: [] }).length === 1);
const church = st.hubItems({ invitations: [], active: [], concluded: [], groupLessons: [{ id: "c9", kind: "church", title: "Acts", description: null, groupId: "c1", groupName: null, updatedAt: "2026-10-01T00:00:00Z" }] })[0];
ok("hub: church studies open the church's study screen", church.route.pathname === "/church/studies/[studyId]" && church.where === "Your church");

// ── 3. Bible topics open in context ─────────────────────────────────────
const { topicPassageRoute } = loadFile(path.join(root, "lib/bibleStudy.ts"));
const r = topicPassageRoute({ book: "John", chapter: 3, startVerse: 16, endVerse: 18, translationCode: "KJV" });
ok("topics: a reference opens the P2P reader at the passage, in its translation", r?.pathname === "/bible" && r.params.book === "JHN" && r.params.chapter === "3" && r.params.v === "16" && r.params.ve === "18" && r.params.t === "KJV");
ok("topics: numbered books work", topicPassageRoute({ book: "1 Corinthians", chapter: 13, startVerse: 4, endVerse: 7, translationCode: null })?.params.book === "1CO");
ok("topics: an unreadable reference never goes to an outside site", topicPassageRoute({ book: "Nowhere", chapter: 1, startVerse: 1, endVerse: 1, translationCode: null }) === null);

// ── 4. Screens ───────────────────────────────────────────────────────────
const learn = src("app/(tabs)/learn.tsx");
ok("learning centre: sections in order", ["Learning Centre", "Continue Learning", "Explore Learning", "Your Learning Journey"].map((w) => learn.indexOf(w)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])));
ok("learning centre: no Recommended for You section (removed at the owner's request)", !/Recommended for You|recommended/.test(learn));
ok("learning centre: no second Kingdom School dashboard; reuses the existing data", !/KingdomSchoolCards|FoundationCategoryCard|getCurriculumCatalog/.test(learn) && learn.includes("getLearningOverview()") && learn.includes("getDiscoverHome()") && learn.includes("getMyStudies()"));
ok("learning centre: loading, empty and failure states", learn.includes("Loading your learning") && learn.includes("Nothing in progress yet") && learn.includes("couldn't load"));
ok("learning centre: still the tab (reselect scrolls to top; iPad capsule inset)", learn.includes('useScrollToTopOnTabReselect("learn"') && learn.includes("useTabCapsuleTopInset"));
const hub = src("components/LearningHub.tsx");
ok("explore learning: exactly the four destinations", (hub.match(/\{ key: "/g) ?? []).length === 4 && ["/kingdom-school", "/kingdom-stories", "/bible-study", "/study-together"].every((r) => hub.includes(`route: "${r}"`)));
const school = src("app/kingdom-school.tsx");
ok("kingdom school: its own screen with the same dashboard, splash, Foundations and plans", school.includes("<KingdomSchoolCards") && school.includes("KingdomSchoolSplash") && school.includes("getCurriculumCatalog") && school.includes("recordFoundationCompletion") && school.includes("Back to Learning Centre"));
ok("kingdom school: links to assigned work and Comprehensive Checks (My Learning)", school.includes('router.push("/learning" as any)') && school.includes("Assigned Work & Comprehensive Checks"));
for (const [f, needle] of [["app/(tabs)/index.tsx", 'router.push("/kingdom-school" as any)'], ["app/learning/index.tsx", 'router.push("/kingdom-school" as any)'], ["components/myp2p/MyP2PWidgets.tsx", '<Btn label="Kingdom School" primary onPress={() => router.push("/kingdom-school" as any)}'], ["lib/getStarted.ts", 'route: "/kingdom-school", actionLabel: "Open Kingdom School"']]) {
  ok(`links: "Kingdom School" in ${f} opens the Kingdom School screen`, src(f).includes(needle));
}
ok("links: reminder/notification routes unchanged (still allowed)", src("lib/studyReminders.ts").includes('new Set(["/bible", "/plans", "/(tabs)/learn"])'));
const bs = src("app/bible-study/index.tsx");
ok("bible study: continue reading, reader, search, notes, highlights, topics", ["Continue Reading", '"/bible"', '"/bible/search"', '"/notes"', '"/highlights"', "Explore Scripture by Topic", "getTopics()"].every((w) => bs.includes(w)));
ok("bible study: no empty reading plans presented as a feature", !/reading plan/i.test(bs.replace(/\/\/.*$/gm, "")));
ok("bible study: topics read-only (never touches Pray the Word progress)", !/updateTopicProgress/.test(bs + src("app/bible-study/topic/[slug].tsx")));
const hubScreen = src("app/study-together/index.tsx");
ok("study together: hub sections", ["Continue Studying Together", "Invitations", "All Shared Studies", "Start a Study", "Join a Study"].every((w) => hubScreen.includes(w)));
ok("study together: no pretend Upcoming section before scheduling exists", !hubScreen.includes(">Upcoming"));
ok("study together: hub reads no personal progress or private reflections", !/lesson_progress|reflection|journal/i.test(src("lib/studyTogetherApi.ts").split("// ── The Study Together hub")[1] ?? ""));
const api = readFileSync(path.join(repo, "artifacts/api-server/src/routes/studyTogether.ts"), "utf8");
const gcs = api.slice(api.indexOf("async function groupCustomStudies"), api.indexOf('router.get("/mine"'));
ok("study together API: group studies are published-only, for the caller's active groups", gcs.includes('.eq("status", "published")') && api.includes("groupCustomStudies(groups.family, groups.church)") && !/\.(insert|update|upsert|delete)\(/.test(gcs));
const ks = src("app/kingdom-stories/index.tsx");
ok("carousel: swipeable with paging, dots say which slide, slides open the story", ks.includes("pagingEnabled") && ks.includes("Slide ${i + 1} of ${slides.length}") && ks.includes("accessibilityState={{ selected: i === slide }}") && ks.includes("Open story details"));
ok("carousel: never turns by itself; reduced motion respected when jumping", !/setInterval|setTimeout\([^)]*goToSlide|autoplay/i.test(ks) && ks.includes("isReduceMotionEnabled") && ks.includes("animated: !reduceMotion"));
ok("carousel: older API still shows one hero", ks.includes("home?.heroSlides?.length ? home.heroSlides : one ? [one] : []"));
const m219 = readFileSync(path.join(repo, "migrations/219_study_together_schedule.sql"), "utf8");
ok("migration 219: marked proposed, additive (no drop table / delete / truncate)", /PROPOSED — NOT APPLIED/.test(m219) && !/drop table|delete from|truncate/i.test(m219));
ok("migration 219: nothing in the app or API depends on it yet", !/scheduled_start_at|reminder_offsets|bible_passage/.test(api + src("lib/studyTogetherApi.ts") + hubScreen));

console.log(`learningSystem: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
