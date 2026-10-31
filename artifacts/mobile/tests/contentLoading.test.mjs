// Content loading — the shared cache (lib/query.ts), Bible request sharing,
// on-demand languages, startup ordering, story caching and the
// development-only measurements (lib/perf.ts).
//   Real module code: lib/query (with the real React Query), bibleReaderApi
//   request sharing, perf request descriptions.
//   Source checks: what can only be seen in screens / the server route.
// Run: node tests/contentLoading.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

function load(file, mocks = {}, extra = {}) {
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, console, Map, Set, JSON, Number, String, Math, Array, Object, Date, Error, URL, process, ...extra,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Shared cache (real React Query) ────────────────────────────────────────
const Q = load("lib/query.ts", { "@tanstack/react-query": require("@tanstack/react-query") });
{
  let calls = 0;
  const fetcher = () => { calls++; return new Promise((r) => setTimeout(() => r({ v: calls }), 20)); };
  const [a, b] = await Promise.all([Q.loadCached(["t", 1], fetcher), Q.loadCached(["t", 1], fetcher)]);
  ok("identical requests at the same time share one fetch", calls === 1 && a === b);
  await Q.loadCached(["t", 1], fetcher, { maxAgeMs: 60_000 });
  ok("content younger than its max age comes from memory", calls === 1);
  ok("peek gives what's already loaded (instant first paint)", Q.peekCached(["t", 1]).v === 1 && Q.peekCached(["t", 2]) === undefined);
  await Q.loadCached(["t", 1], fetcher, { fresh: true });
  ok("fresh: true always fetches (after the person changed something)", calls === 2);
  await new Promise((r) => setTimeout(r, 5));
  await Q.loadCached(["t", 1], fetcher, { maxAgeMs: 1 });
  ok("older than its max age → fetched again", calls === 3);
  let failing = 0;
  await Q.loadCached(["bad"], () => { failing++; return Promise.reject(new Error("offline")); }).catch(() => {});
  ok("a failed load isn't cached as content", Q.peekCached(["bad"]) === undefined);
  Q.setCached(["t", 1], { v: 99 });
  ok("an edit updates the shared copy for every screen", Q.peekCached(["t", 1]).v === 99);
  Q.clearContentCache();
  ok("signing out / another person: everything forgotten", Q.peekCached(["t", 1]) === undefined);
  ok("keys: one place; private ones carry the person", JSON.stringify(Q.qk.plan("p", "u1")) !== JSON.stringify(Q.qk.plan("p", "u2")) && JSON.stringify(Q.qk.curriculumCatalog("u1")) !== JSON.stringify(Q.qk.curriculumCatalog("u2")));
}
const layout = src("app/_layout.tsx");
ok("one shared client for the app; cache cleared when the signed-in person changes", /import \{ queryClient, clearContentCache \} from "@\/lib\/query"/.test(layout) && /<ContentCacheGuard \/>/.test(layout)
  && /if \(last\.current !== undefined && last\.current !== id\) clearContentCache\(\)/.test(layout) && !/new QueryClient\(/.test(layout));
ok("nothing persisted to storage by the cache (memory only; Bible text never stored)", !/AsyncStorage|localStorage|persist/i.test(src("lib/query.ts").replace(/\/\/.*$/gm, "")));

// ── Bible ──────────────────────────────────────────────────────────────────
{
  let reqs = [];
  const B = load("lib/bibleReaderApi.ts", {
    "react-native": { Platform: { select: (o) => o.ios } },
    "@/lib/bibleBooks": load("lib/bibleBooks.ts"),
    "@/lib/apiClient": { apiRequest: (p) => { reqs.push(p); return new Promise((r) => setTimeout(() => r(p.includes("translations") ? { translations: [] } : { chapter: 1, verses: [] }), 15)); } },
  });
  B.prefetchChapter("JHN", 3, "BSB");
  const c = await B.getChapter("JHN", 3, "BSB");
  ok("a prefetched chapter and the reader share ONE request", reqs.filter((p) => p.includes("/chapter")).length === 1 && c.chapter === 1);
  await B.getChapter("JHN", 3, "BSB");
  ok("a chapter read this session comes from memory", reqs.filter((p) => p.includes("/chapter")).length === 1);
  await Promise.all([B.getTranslations(), B.getTranslations()]);
  await B.getTranslations();
  ok("translations list: one request, reused (10 minutes)", reqs.filter((p) => p.includes("translations")).length === 1);
}
{
  let n = 0;
  const B = load("lib/bibleReaderApi.ts", {
    "react-native": { Platform: { select: (o) => o.ios } },
    "@/lib/bibleBooks": load("lib/bibleBooks.ts"),
    "@/lib/apiClient": { apiRequest: () => { n++; return Promise.reject(new Error("offline")); } },
  });
  await B.getTranslations().catch(() => {});
  await tick();
  await B.getTranslations().catch(() => {});
  ok("a failed translations request isn't remembered (next visit tries again)", n === 2);
}
const bible = src("app/bible/index.tsx");
ok("Bible: the likely chapter starts loading alongside the translations list", /prefetchChapter\(book, chapter, t\)/.test(bible) && bible.indexOf("prefetchChapter(book, chapter, t)") < bible.indexOf("// ── Translations (only licensed ones are ever listed)"));
ok("Bible: newest request still wins (stale responses dropped)", /if \(id !== reqId\.current\) return;/.test(bible));

// ── Languages ──────────────────────────────────────────────────────────────
const i18n = src("lib/i18n.ts");
const loaders = [...i18n.matchAll(/^\s+"?([\w-]+)"?: \(\) => import\("@\/locales\/([\w-]+)\.json"\),$/gm)];
ok("only English is built in; the other 35 languages load on demand", (i18n.match(/^import \w+ from "@\/locales\//gm) ?? []).length === 1 && /import en from "@\/locales\/en\.json"/.test(i18n) && loaders.length === 35);
ok("every on-demand language has its file", loaders.every((m) => existsSync(path.join(root, `locales/${m[2]}.json`))));
ok("every supported language is loadable (none lost)", (() => { const sup = i18n.match(/export const SUPPORTED_LANGUAGES = \[([\s\S]*?)\] as const/)[1].match(/"([\w-]+)"/g).map((x) => x.replace(/"/g, "")); const have = new Set(["en", ...loaders.map((m) => m[1])]); return sup.every((c) => have.has(c)); })());
ok("switching language loads it first; English fallback while loading", /export async function setAppLanguage[\s\S]*await loadLocale\(lng\);[\s\S]*i18n\.changeLanguage\(lng\)/.test(i18n) && /fallbackLng: "en"/.test(i18n)
  && !/i18n\.changeLanguage\(|i18next\.changeLanguage\(/.test(layout + src("app/(auth)/onboarding.tsx")) && /setAppLanguage\(/.test(layout) && /setAppLanguage\(lang\.code\)/.test(src("app/(auth)/onboarding.tsx")));
ok("the content language (Listen signposts) is loaded too", /loadLocale\(profile\.contentLanguage\)/.test(layout) && /await loadLocale\(/.test(bible) && /loadLocale\(language\)/.test(src("lib/listen/bibleContent.ts")));

// ── Startup ────────────────────────────────────────────────────────────────
const data = src("contexts/DataContext.tsx");
ok("startup reloads only when the person or content language changes", /\}, \[authLoading, isAuthenticated, profileId, contentLang\]\);/.test(data));
ok("essentials together: home feed, Kingdom School, Learning Plans", /await Promise\.all\(\[\s*loadHome\(\),\s*loadCurriculum\(/.test(data));
ok("screens are released before the secondary data (fruits, missions, forest…)", (() => { const a = data.indexOf("      setIsLoading(false);\n      const loadFruitCatalog") , b = data.indexOf("await Promise.allSettled(["); return a > 0 && b > a; })() || (() => { const n = data.replace(/\r\n/g, "\n"); const a = n.indexOf("      setIsLoading(false);\n      const loadFruitCatalog"), b = n.indexOf("await Promise.allSettled(["); return a > 0 && b > a; })());
ok("secondary data loads in parallel and can't break the essentials", /await Promise\.allSettled\(\[[\s\S]{0,300}loadFruitCatalog\(\),[\s\S]{0,80}loadFruitsAndMissions\(\),[\s\S]{0,40}loadNetwork\(\),/.test(data));
ok("Kingdom School catalogue: lock state and modules/lessons together; cached per person", /await Promise\.all\(\[getKingdomSchoolLockState\(userId\), modulesAndLessons\]\)/.test(data) && /loadCached\(catalogKey, \(\) => getCurriculumCatalog\(\)\)/.test(src("app/kingdom-school.tsx")));

// ── Stories, lessons, plans ────────────────────────────────────────────────
const chapter = src("app/kingdom-stories/chapter.tsx"), storyPage = src("app/kingdom-stories/[id].tsx"), storiesHome = src("app/kingdom-stories/index.tsx");
ok("story page and chapters share one cached story (opening a chapter is instant)", /loadCached\(qk\.story\(id\), \(\) => getKingdomStory\(id\)/.test(chapter) && /loadCached\(qk\.story\(id\), \(\) => getKingdomStory\(id\)/.test(storyPage)
  && /peekCached<KingdomStory>\(qk\.story\(id\)\)/.test(chapter) && /peekCached<KingdomStory>\(qk\.story\(id\)\)/.test(storyPage));
ok("after finishing a chapter / answering, the story is fetched fresh (progress stays correct)", /await load\(true\); await loadAnswers\(\)/.test(chapter) && /\{ maxAgeMs: 30_000, fresh \}/.test(chapter));
ok("favourites keep the cached copies honest", /setCached\(qk\.story\(story!\.id\)/.test(storyPage) && /invalidateCached\(qk\.storiesHome\(\)\); invalidateCached\(qk\.story\(id\)\)/.test(storiesHome));
ok("stories home cached; pull-to-refresh is always fresh", /loadCached\(qk\.storiesHome\(\), \(\) => getDiscoverHome\(\)/.test(storiesHome) && /onRefresh=\{\(\) => \{ setRefreshing\(true\); load\(true\); \}\}/.test(storiesHome));
const lesson = src("app/lesson/[id].tsx");
ok("lesson content cached (never answers or progress); a failed load isn't cached", /loadCached<LessonContent>\(qk\.lessonContent\(id\)/.test(lesson) && /if \(lessonError\) throw lessonError;/.test(lesson) && !/loadCached[\s\S]{0,200}(submission|progress)/i.test(lesson));
ok("plan cached per person for 30 s (locks / progress refresh after that)", /loadCached<PlanLoad>\(qk\.plan\(id, profile\?\.id\)/.test(src("app/plan/[id].tsx")) && /\{ maxAgeMs: 30_000 \}/.test(src("app/plan/[id].tsx")));

// ── Server: opening a story ────────────────────────────────────────────────
const route = readFileSync(path.join(root, "../api-server/src/routes/kingdomStories.ts"), "utf8").replace(/\r\n/g, "\n");
const handler = route.slice(route.indexOf('router.get("/:id", async'), route.indexOf("\n});", route.indexOf('router.get("/:id", async')));
ok("server: story, editor check and saves fetched together", /const \[\{ data: story \}, editor, saves\] = await Promise\.all\(\[[\s\S]*isEditor\(userId\),[\s\S]*savesFor\(userId, \[req\.params\.id\]\),/.test(handler));
ok("server: access rule unchanged (not found / unpublished-non-editor before anything else is returned)", handler.indexOf('if (story.status !== "published" && !editor) return err(res, "Story not found", 404);') > 0
  && handler.indexOf('if (story.status !== "published" && !editor)') < handler.indexOf("return ok(res"));
ok("server: neighbours fetched alongside the other details; no extra sequential awaits", /siblingsRes\]/.test(handler) && !/await savesFor\(/.test(handler) && !/const editor = await isEditor/.test(handler) && (handler.match(/await /g) ?? []).length <= 6);

// ── Measurements (development only) ───────────────────────────────────────
const P = load("lib/perf.ts", { react: { useEffect() {}, useRef: (v) => ({ current: v }) } }, { performance: { now: () => 0 } });
ok("measurements are off in normal builds", /export const PERF_ON = \(typeof __DEV__ !== "undefined" && __DEV__\) \|\| process\.env\.EXPO_PUBLIC_PERF === "1";/.test(src("lib/perf.ts")));
ok("request kinds only: no ids, query values or tokens", P.describeRequest("https://abc.supabase.co/rest/v1/p2p_lessons?id=eq.11111111-2222-3333-4444-555555555555&apikey=SECRET") === "supabase/rest/v1/p2p_lessons"
  && P.describeRequest("https://workspaceapi-server-production-6d56.up.railway.app/api/kingdom-stories/11111111-2222-3333-4444-555555555555?token=x") === "api/api/kingdom-stories/:id");
ok("every measured screen is instrumented", ["contexts/DataContext.tsx", "app/bible/index.tsx", "app/kingdom-stories/index.tsx", "app/kingdom-stories/[id].tsx", "app/kingdom-stories/chapter.tsx", "app/kingdom-school.tsx", "app/lesson/[id].tsx", "app/plan/[id].tsx"].every((f) => /usePerfVisit\(/.test(src(f))));
ok("measurement loads first (sees every request)", layout.replace(/\r\n/g, "\n").indexOf('import "@/lib/perf";') < layout.indexOf("@/contexts/AuthContext"));

console.log(`content loading: ${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
