// Tests for the Kingdom Stories browse experience and the Learning tab
// organisation:
//  1. api-server lib/kingdomStoryJourney.ts — the biblical order (each
//     category's own editorial order), next in the journey, recommendations
//     with reasons, before/after neighbours. Run on the real module.
//  2. progressOf / storyAction — Start / Continue / Review from real progress;
//     "Finished · awaiting review" vs "Completed".
//  3. lib/storyTheme.ts — dark keeps the existing palette; light follows the
//     reader's app style; text over artwork stays white on a dark scrim.
//  4. Source checks — the API serves published stories only, never writes
//     progress from browsing; the screen's sections and states; the story
//     page's before/after links; six tabs with "Learning"; the Learning hub;
//     Home's My Community holds the moved church card and My Family tile once.
// Run: node tests/kingdomStoriesExperience.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const api = path.resolve(root, "../api-server/src");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const apiSrc = (p) => readFileSync(path.join(api, p), "utf8");

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; return f; };
const anyModule = new Proxy({}, { get: (_t, k) => (k === "__esModule" ? true : k === "default" ? anyModule : host(String(k))) });
const mocks = {
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
  "@/contexts/ThemeContext": { useTheme: () => ({ resolvedMode: "dark", colors: {} }) },
  react: require("react"),
  "react-native": { StyleSheet: { create: (s) => s, absoluteFill: {} }, Platform: { OS: "web" } },
};
const cache = new Map();
function loadFile(file) {
  if (cache.has(file)) return cache.get(file);
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const req = (m) => {
    if (m in mocks) return mocks[m];
    if (m.startsWith("@/")) {
      const base = path.join(root, m.slice(2));
      for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return loadFile(base + ext);
    }
    return anyModule;
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, console, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, Date, Math, JSON });
  cache.set(file, mod.exports);
  return mod.exports;
}

// ── 1. The biblical order ───────────────────────────────────────────────
const J = loadFile(path.join(api, "lib/kingdomStoryJourney.ts"));
const cats = [
  { id: "jesus", title: "Jesus Christ", displayOrder: 2 },
  { id: "bh", title: "Biblical History", displayOrder: 1 },
  { id: "empty", title: "Archaeology", displayOrder: 3 },
  { id: "church", title: "The Early Church", displayOrder: 4 },
];
// Deliberately shuffled, with a gap (topic 3 unpublished = absent) and titles that sort differently.
const st = (id, categoryId, topicNumber, publishedAt = "2026-01-01T00:00:00Z", relatedStoryId = null) => ({ id, categoryId, topicNumber, publishedAt, relatedStoryId });
const stories = [
  st("abraham", "bh", 4, "2026-03-01T00:00:00Z"), st("creation", "bh", 1, "2026-09-01T00:00:00Z"), st("fall", "bh", 2),
  st("isaac", "bh", 5, "2026-01-01T00:00:00Z", "abraham"), st("birth", "jesus", 1), st("baptism", "jesus", 2),
  st("pentecost", "church", 1, "2026-02-01T00:00:00Z", "baptism"),
];
const titles = new Map(stories.map((s) => [s.id, s.id[0].toUpperCase() + s.id.slice(1)]));
const P = (entries) => new Map(Object.entries(entries));
const fin = { totalChapters: 5, doneChapters: 5, started: true };
const mid = { totalChapters: 5, doneChapters: 2, started: true };
const none = { totalChapters: 5, doneChapters: 0, started: false };

const seq = J.sequences(cats, stories);
ok("order: categories by display order; empty categories left out", seq.map((r) => r.category.id).join() === "bh,jesus,church");
ok("order: topic number within a category — not date, title or id", seq[0].ids.join() === "creation,fall,abraham,isaac");
ok("order: an unpublished topic is simply skipped (2 → 4)", seq[0].ids.indexOf("abraham") === seq[0].ids.indexOf("fall") + 1);
ok("order: unnumbered stories after numbered ones, oldest first", J.sequences([cats[1]], [st("b", "bh", null, "2026-05-01"), st("a", "bh", null, "2026-04-01"), st("n", "bh", 9)])[0].ids.join() === "n,a,b");

let j = J.nextInJourney(cats, stories, P({}));
ok("journey: no progress → the first story of the first category", j?.storyId === "creation" && j.state === "start" && j.position === 1 && j.categoryTotal === 4);
ok("journey: what follows is listed in order", j.upNext.join() === "fall,abraham,isaac");
j = J.nextInJourney(cats, stories, P({ creation: fin }));
ok("journey: finished story → the next one in order", j?.storyId === "fall" && j.state === "next" && j.position === 2);
j = J.nextInJourney(cats, stories, P({ creation: fin, fall: mid, abraham: fin }));
ok("journey: an earlier started story comes first (continue before moving on)", j?.storyId === "fall" && j.state === "continue");
j = J.nextInJourney(cats, stories, P({ creation: fin, fall: fin, abraham: fin, isaac: fin }));
ok("journey: a finished category moves to the next category in order", j?.storyId === "birth" && j.categoryId === "jesus" && j.state === "next");
j = J.nextInJourney(cats, stories, P({ abraham: fin }));
ok("journey: skipped ahead → the next after the furthest finished", j?.storyId === "isaac");
j = J.nextInJourney(cats, stories, P({ abraham: fin, isaac: fin }));
ok("journey: then back to the earlier unread stories of that category", j?.storyId === "creation");
j = J.nextInJourney(cats, stories, P({ creation: fin, birth: mid }), new Map([["birth", "2026-10-20T00:00:00Z"], ["creation", "2026-10-01T00:00:00Z"]]));
ok("journey: follows the category the reader was last active in", j?.storyId === "birth" && j.state === "continue");
ok("journey: opening alone is not progress (views without progress → start)", J.nextInJourney(cats, stories, P({ fall: none }), new Map([["fall", "2026-10-20T00:00:00Z"]]))?.storyId === "creation");
const allDone = Object.fromEntries(stories.map((s) => [s.id, fin]));
ok("journey: everything finished → none", J.nextInJourney(cats, stories, P(allDone)) === null);
ok("journey: nothing published → none", J.nextInJourney(cats, [], P({})) === null);

// Recommendations
j = J.nextInJourney(cats, stories, P({ creation: fin, fall: fin, abraham: fin }));
let rec = J.recommend(cats, stories, P({ creation: fin, fall: fin, abraham: fin }), j, titles);
ok("recommend: next in the journey comes first", rec[0]?.storyId === "isaac" && rec[0].reason === "next_in_journey" && rec[0].label === "Next in your biblical journey");
ok("recommend: a related story is offered without replacing the next one", !rec.some((r) => r.storyId === "abraham") /* finished */);
rec = J.recommend(cats, stories, P({ creation: fin, fall: fin }), J.nextInJourney(cats, stories, P({ creation: fin, fall: fin })), titles);
ok("recommend: order is next → same category → other categories", rec.map((r) => r.reason).join() === "next_in_journey,same_category,other_category,other_category,for_journey");
ok("recommend: same-category reason names the category", rec[1].label === "Continue exploring Biblical History");
ok("recommend: other categories are labelled as exploring, never as 'next'", rec.filter((r) => r.reason === "other_category").map((r) => r.label).join() === "Explore Jesus Christ,Explore The Early Church");
rec = J.recommend(cats, stories, P({ creation: fin, fall: fin, abraham: fin, pentecost: mid }), J.nextInJourney(cats, stories, P({ creation: fin, fall: fin, abraham: fin, pentecost: mid }), new Map([["abraham", "2026-10-20"]])), titles);
ok("recommend: a related story (editor link) is suggested with its reason", rec.some((r) => r.storyId === "baptism" && r.reason === "related" && r.label === "Related to Pentecost"));
ok("recommend: the next story is still first", rec[0].storyId === "isaac");
ok("recommend: each story once; finished stories never", new Set(rec.map((r) => r.storyId)).size === rec.length && !rec.some((r) => ["creation", "fall", "abraham"].includes(r.storyId)));
rec = J.recommend(cats, stories, P({}), J.nextInJourney(cats, stories, P({})), titles, new Set(["creation"]));
ok("recommend: the hero / Continue stories are left out", !rec.some((r) => r.storyId === "creation"));
ok("recommend: only tops up a short row (category rows list the rest)", rec.length <= 6);

ok("neighbours: before and after in the category order", JSON.stringify(J.neighbours(cats, stories, "abraham")) === JSON.stringify({ previous: "fall", next: "isaac" }));
ok("neighbours: first and last have one side; categories never cross", J.neighbours(cats, stories, "creation").previous === null && J.neighbours(cats, stories, "isaac").next === null && J.neighbours(cats, stories, "birth").previous === null);

// ── 2. Progress words and the main button ───────────────────────────────
const { progressOf, storyAction } = loadFile(path.join(root, "components/kingdom-stories/DiscoverRow.tsx"));
ok("button: not started → Start Story", storyAction({ myProgress: { started: false, doneChapters: 0, totalChapters: 4 } }).label === "Start Story");
ok("button: no progress record (opened only) → Start Story", storyAction({ myProgress: null }).label === "Start Story");
ok("button: in progress → Continue Story", storyAction({ myProgress: { started: true, doneChapters: 1, totalChapters: 4 } }).label === "Continue Story");
ok("button: finished → Review Story", storyAction({ myProgress: { started: true, doneChapters: 4, completedChapters: 4, totalChapters: 4 } }).label === "Review Story");
ok("progress: all approved → Completed", progressOf({ myProgress: { started: true, doneChapters: 4, completedChapters: 4, totalChapters: 4 } })?.label === "Completed");
ok("progress: all submitted, a check still with a peer → Finished · awaiting review", progressOf({ myProgress: { started: true, doneChapters: 4, completedChapters: 3, totalChapters: 4 } })?.label === "Finished · awaiting review");
ok("progress: older API without completedChapters keeps 'Completed'", progressOf({ myProgress: { started: true, doneChapters: 4, totalChapters: 4 } })?.label === "Completed");
ok("progress: a story with no chapters shows nothing (no invented %)", progressOf({ myProgress: { started: true, doneChapters: 0, totalChapters: 0 } }) === null);

// ── 3. Theme ─────────────────────────────────────────────────────────────
const theme = loadFile(path.join(root, "lib/storyTheme.ts"));
const together = loadFile(path.join(root, "lib/togetherTheme.ts"));
const { THEMES } = loadFile(path.join(root, "constants/themes.ts"));
const darkP = theme.storyPalette("dark", THEMES.light);
ok("theme: dark keeps the existing cinematic palette", darkP.background === together.colors.background && darkP.textPrimary === "#FFFFFF");
const lightP = theme.storyPalette("light", THEMES.light);
ok("theme: light follows the reader's app style", lightP.background === THEMES.light.lightCream && lightP.textPrimary === THEMES.light.textDark && lightP.growth === THEMES.light.primaryGreen);
ok("theme: every token is defined in both modes", Object.keys(together.colors).every((k) => typeof darkP[k] === "string" && typeof lightP[k] === "string"));
ok("theme: text over artwork is white on a dark scrim in both modes", theme.ART_TEXT.text === "#FFFFFF" && /rgba\(0,0,0,0\.[4-9]/.test(theme.ART_TEXT.scrim));
for (const f of ["app/kingdom-stories/index.tsx", "components/kingdom-stories/DiscoverRow.tsx", "components/kingdom-stories/StoryGridScreen.tsx"]) {
  ok(`theme: ${f} uses the reader's theme (no fixed palette)`, !/import \{[^}]*colors as T[^}]*\} from "@\/lib\/togetherTheme"/.test(src(f)) && src(f).includes("useStoryStyles("));
}

// ── 4. API: published only; browsing never writes progress ──────────────
const discover = apiSrc("routes/kingdomStoryDiscover.ts");
ok("api: discover reads published stories and categories only", discover.includes('db.from("p2p_kingdom_stories").select("*").eq("status", "published")') && discover.includes('.eq("status", "published").order("display_order"'));
ok("api: discover adds hero / journey / recommended; `featured` kept for older apps", ["hero:", "journey:", "recommended:", "featured: featured &&"].every((w) => discover.includes(w)));
ok("api: hero = editor's Featured, else next in journey, else first in order", discover.includes("const heroId: string | null = featured?.id ?? journey?.storyId ?? firstInOrder;"));
ok("api: discover never writes", !/\.(insert|update|upsert|delete)\(/.test(discover.split('router.get("/collections/:slug"')[0]));
const learning = apiSrc("lib/kingdomStoryLearning.ts");
const sp = learning.slice(learning.indexOf("export async function storiesProgress"), learning.indexOf("export function lockChapter"));
ok("api: card progress only reads; a reflection answer counts as started", !/\.(insert|update|upsert|delete)\(/.test(sp) && sp.includes('from("p2p_submissions").select("lesson_id")') && sp.includes("started = true"));
ok("api: done = submitted or completed; completed counted separately", sp.includes('else if (p.status === "submitted") s.doneChapters++;') && sp.includes("s.completedChapters++"));
const storiesRoute = apiSrc("routes/kingdomStories.ts");
ok("api: unpublished stories stay hidden from readers", storiesRoute.includes('if (story.status !== "published" && !editor) return err(res, "Story not found", 404);'));
ok("api: before/after links come from published stories of the same category", storiesRoute.includes('.eq("category_id", story.category_id).eq("status", "published")') && storiesRoute.includes("neighbours("));
ok("api: search stays on published stories; filter characters stripped", /\.eq\("status", "published"\);\r?\n\s+query = order/.test(storiesRoute) && storiesRoute.includes('replace(/[%_,()*"\']/g, " ")'));
ok("api: opening a story is not progress", apiSrc("lib/kingdomStoryLibrary.ts").includes('from("p2p_kingdom_story_views")') && !apiSrc("lib/kingdomStoryLibrary.ts").includes("p2p_lesson_progress"));

// ── 5. The screen ────────────────────────────────────────────────────────
const home = src("app/kingdom-stories/index.tsx");
ok("screen: hero kicker says why (Featured / Next in your journey / Start here)", home.includes('featured: "Featured", journey: "Next in your biblical journey", first: "Start here"'));
ok("screen: Start / Continue / Review + View Story Details", home.includes("{hAction.label}") && home.includes("View Story Details"));
ok("screen: sections in priority order", ["Continue Your Stories", "Next in your biblical journey", "Coming up in", "Recommended for You", "home.categoryRows.map", "Browse by category"]
  .map((w) => home.indexOf(w)).every((v, i, a) => v > 0 && (i === 0 || v > a[i - 1])));
ok("screen: never started → begin at the first story", home.includes('journey?.state === "start"') && home.includes("Begin at the beginning"));
ok("screen: loading, failure with retry, empty catalogue, no search results", ["ActivityIndicator", "couldn't load", "Try again", "will appear here as new stories are published", "No published stories match"].every((w) => home.includes(w)));
ok("screen: categories keep published and planned counts apart", home.includes("categoryCountLabels(cat)") && home.includes("counts.planned"));
ok("screen: older API still works (falls back to `featured`)", home.includes("home.hero ?? (home.featured ?"));
ok("screen: missing artwork has a fallback", src("components/kingdom-stories/DiscoverRow.tsx").includes('name="book-outline"'));
ok("screen: no auto-advancing carousel or autoplay", !/setInterval|autoplay|autoPlay/i.test(home + src("components/kingdom-stories/DiscoverRow.tsx")));
const page = src("app/kingdom-stories/[id].tsx");
ok("story page: Review Story for a finished story; before/after links", page.includes('label: "Review Story"') && page.includes("Before this story") && page.includes("Next in the story"));
ok("story page: chapters, reflections and checks still open the existing reader", page.includes('pathname: "/kingdom-stories/chapter"') && existsSync(path.join(root, "app/kingdom-stories/chapter.tsx")));

// ── 6. Navigation ───────────────────────────────────────────────────────
const layout = src("app/(tabs)/_layout.tsx");
const tabFiles = readdirSync(path.join(root, "app/(tabs)")).filter((f) => f.endsWith(".tsx") && f !== "_layout.tsx").map((f) => f.replace(".tsx", "")).sort();
ok("tabs: exactly six destinations", tabFiles.join() === "discover,index,learn,messages,prayer,profile");
ok("tabs: native, iPad capsule and classic bars list the same six", (layout.match(/<NativeTabs\.Trigger name=/g) ?? []).length === 6 && (layout.match(/\{ name: "(index|learn|messages|prayer|discover|profile)", label/g) ?? []).length === 12);
const en = JSON.parse(src("locales/en.json"));
ok("tabs: Kingdom School tab is now 'Learning' (route unchanged)", en.tabs.learn === "Learning" && layout.includes('name="learn"') && !layout.includes("K-School\")"));
ok("tabs: other languages keep their own word", JSON.parse(src("locales/fr.json")).tabs.learn === "Apprendre" && JSON.parse(src("locales/sw.json")).tabs.learn === "Jifunza");
const learn = src("app/(tabs)/learn.tsx");
const hub = src("components/LearningHub.tsx");
ok("learning: Explore Learning on the tab; Kingdom School has its own screen (no second dashboard)", learn.includes("<LearningHub") && !learn.includes("<KingdomSchoolCards") && src("app/kingdom-school.tsx").includes("<KingdomSchoolCards"));
for (const r of ["/kingdom-school", "/kingdom-stories", "/bible-study", "/study-together"]) {
  const file = [path.join(root, "app", r.slice(1), "index.tsx"), path.join(root, "app", `${r.slice(1)}.tsx`)].find(existsSync);
  ok(`learning: hub opens the existing ${r} screen`, hub.includes(`route: "${r}"`) && !!file);
}
const homeTab = src("app/(tabs)/index.tsx");
const community = homeTab.indexOf("My Community</Text>");
ok("home: My Community section exists", community > 0);
for (const w of ["<GroveHomeCard", "<RegisterChurchPromptCard", "<MemberChurchCard", 'title={t("home.myFamily")}']) {
  ok(`home: ${w} appears once, inside My Community`, homeTab.split(w).length === 2 && homeTab.indexOf(w) > community && homeTab.indexOf(w) < homeTab.indexOf("4. Your Journey"));
}
ok("home: church cards keep their conditions and routes", homeTab.includes('{isChurchLeader && userChurch && (') && homeTab.includes('{!profile?.isMinistryLeader && userChurch && (') && homeTab.includes('router.push("/church/grove" as any)') && homeTab.includes('go("/family")'));
ok("home: Messages / Prayer / Discover / Profile tabs untouched by this work", !/LearningHub|My Community/.test(src("app/(tabs)/messages.tsx") + src("app/(tabs)/prayer.tsx") + src("app/(tabs)/discover.tsx") + src("app/(tabs)/profile.tsx")));

console.log(`kingdomStoriesExperience: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
