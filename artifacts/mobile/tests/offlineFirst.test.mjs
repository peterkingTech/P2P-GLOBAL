// Offline-first + the 2026-11-18 implementation brief (app side):
//   • lib/offline: per-person copies; queued changes stored BEFORE sending, sent in order once online,
//     the same change kept once, 409 → conflict kept with the server copy (never forced), 4xx → failed
//     (kept, shown), no connection → kept and retried; resolve "theirs" drops mine, "mine" re-sends;
//   • Bible text is kept on the phone ONLY when the translation's licence permits offline use;
//   • Daily Word follows the Home/widget day rule and never stores licensed text itself;
//   • the study workspace: study highlights never replace the person's own highlights, saves are queued
//     offline with a client key, conflicts are the person's choice; the sensitive-information placeholder;
//   • Scripture emphasis: Jesus' words only from the translation's markup, other categories only from
//     published editorial references; the guide's What's New; the interactive tree uses real records.
// Run: node tests/offlineFirst.test.mjs
import { readFileSync } from "node:fs";
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

// ── lib/offline (real module, memory AsyncStorage) ──
const store = new Map();
const AsyncStorage = { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } };
const timers = [];
function loadOffline() {
  const js = ts.transpileModule(src("lib/offline/index.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, Promise, JSON, Math, Date, Map, Set, Error, TypeError, String, Object, console,
    setInterval: (f) => { timers.push(f); return 0; },
    require: (n) => {
      if (n === "@react-native-async-storage/async-storage") return { __esModule: true, default: AsyncStorage };
      if (n === "react-native") return { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: "ios" } };
      if (n === "react") return { useEffect: () => {}, useState: (v) => [typeof v === "function" ? v() : v, () => {}] };
      throw new Error("unexpected " + n);
    },
  });
  return mod.exports;
}
const O = loadOffline();
const tick = () => new Promise((r) => setTimeout(r, 0));
const netErr = () => Object.assign(new Error("You're offline"), { status: 0 });

O.setOfflineUser("u1");
await tick();
await O.kvSet("a", { x: 1 });
ok("kv: stored per person", [...store.keys()].some((k) => k === "offline:v1:u1:a"));
ok("kv: read back", (await O.kvGet("a"))?.x === 1);

// Queue: offline → kept, then sent in order once online.
let online = false; const sent = [];
O.registerHandler("t.save", async (p) => { if (!online) throw netErr(); sent.push(p.n); return {}; });
await O.enqueue({ id: "k1", type: "t.save", payload: { n: 1 } });
await O.enqueue({ id: "k2", type: "t.save", payload: { n: 2 } });
await tick(); await tick();
ok("queue: stored before sending (survives the app closing)", JSON.parse(store.get("offline:v1:u1:queue")).length === 2);
ok("queue: offline → nothing lost, status offline", O.syncStatus().pending === 2 && O.syncStatus().online === false);
await O.enqueue({ id: "k2", type: "t.save", payload: { n: 22 } });
ok("queue: the same change queued twice is kept once (latest wins)", O.syncStatus().pending === 2);
online = true;
for (let i = 0; i < 6; i++) await tick();
await O.flush(); await tick();
ok("queue: sent in order once the connection returns", JSON.stringify(sent) === "[1,22]", JSON.stringify(sent));
ok("queue: empty and online afterwards", O.syncStatus().pending === 0 && O.syncStatus().online === true);

// Conflict: never forced; kept with the server copy; the person decides.
O.registerHandler("t.conflict", async () => { throw Object.assign(new Error("changed"), { status: 409, current: { version: 5 } }); });
await O.enqueue({ id: "c1", type: "t.conflict", payload: { v: 1 } });
await tick(); await tick();
const st = O.syncStatus();
ok("conflict: kept for the person, with the server's copy", st.conflicts.length === 1 && st.conflicts[0].current?.version === 5 && st.pending === 0);
await O.resolveConflict("c1", "theirs"); await tick();
ok("conflict: 'keep the other version' drops mine", O.syncStatus().conflicts.length === 0);

// A 4xx is shown as failed (kept), not retried forever and not dropped silently.
O.registerHandler("t.bad", async () => { throw Object.assign(new Error("Not allowed"), { status: 403 }); });
await O.enqueue({ id: "b1", type: "t.bad", payload: {} });
await tick(); await tick();
ok("failed: kept and shown with its reason", O.syncStatus().failed.length === 1 && O.syncStatus().failed[0].error === "Not allowed");

// A queued change whose handler isn't registered yet is kept (sent later).
await O.enqueue({ id: "u1", type: "t.unknown", payload: {} });
await tick();
ok("unknown handler: kept, not dropped", O.syncStatus().pending === 1);

// Read-through cache: online stores, offline returns the stored copy marked offline.
const r1 = await O.cached("list", async () => ({ items: [1] }));
await tick();
const r2 = await O.cached("list", async () => { throw netErr(); });
ok("cached: offline returns the saved copy, marked", r1.items[0] === 1 && r2.offline === true && r2.items[0] === 1 && !!r2.savedAt);
let threw = false; try { await O.cached("list", async () => { throw Object.assign(new Error("x"), { status: 500 }); }); } catch { threw = true; }
ok("cached: a server error is not hidden behind an old copy", threw);

// Per person: another person sees none of it.
O.setOfflineUser("u2"); await tick();
ok("per person: another account starts empty", (await O.kvGet("a")) === null && O.syncStatus().pending === 0);
ok("newKey: valid client key shape", /^[A-Za-z0-9_-]{8,80}$/.test(O.newKey("study")));

// ── Licence-gated Bible text ──
const bible = src("lib/bibleReaderApi.ts");
ok("bible: chapters kept on the phone only when the licence permits offline", bible.includes("if (c.translation?.offlineAllowed) void keepOffline(key, c);"));
ok("bible: offline returns the kept copy, marked", bible.includes("return { ...kept, offline: true } as BibleChapter;"));
ok("bible: capped at 300 chapters", bible.includes("while (idx.length > 300)"));
const reader = readFileSync(path.join(root, "../api-server/src/lib/bibleReader.ts"), "utf8"), lic = readFileSync(path.join(root, "../api-server/src/lib/bibleLicence.ts"), "utf8");
ok("api: offlineAllowed comes from the reviewed licence record", lic.includes("export const offlineAllowed = (r: TranslationRow) => r.permits_offline === true;") && (reader.match(/offlineAllowed: offlineAllowed\(t\)/g) ?? []).length === 2);

// ── Daily Word ──
const dw = src("app/daily-word.tsx"), dwl = src("lib/dailyWord.ts");
ok("daily word: same day rule as Home and the widgets", dwl.includes("verseForDay(DAILY_VERSES, day)"));
const dv = src("constants/dailyVerses.ts");
const entries = [...dv.matchAll(/\{ ref: "([^"]+)", text: "((?:[^"\\]|\\.)*)", theme: "([^"]+)", instruction: "((?:[^"\\]|\\.)+)" \}/g)];
ok("daily word: 400 scriptures, every one with text, theme and Today's Instruction", entries.length === 400 && entries.every((m) => m[2].length > 10 && m[3] && m[4].length > 20), String(entries.length));
ok("daily word: no scripture repeats", new Set(entries.map((m) => m[1])).size === entries.length);
ok("daily word: fallback text is the public-domain BSB, labelled", dv.includes('DAILY_VERSE_TRANSLATION = "Berean Standard Bible (public domain)"') && dw.includes("DAILY_WORD_FALLBACK_TRANSLATION"));
ok("daily word: only today's entry — no list, no browsing (a daily surprise)", !dw.includes("DAILY_VERSES") && !dw.includes("setEntry") && !dw.includes(".map((e)") && !/export function dailyWordCatalogue/.test(dwl));
ok("daily word: Read the full chapter, Save, Add to playlist, Share", ["dailyWord.readFull", "dailyWord.save", "dailyWord.playlist", "dailyWord.share"].every((k) => dw.includes(`t("${k}"`)));
ok("daily word: no separate cache of licensed text (getChapter's licence rule only)", !dw.includes("cached(") && !dw.includes("kvSet("));
ok("daily word: share sends only the reference when copying isn't allowed", dw.includes("live && !live.copy ? entry!.ref"));
ok("home: shows Daily Word label, Today's Instruction and Open Daily Word", src("app/(tabs)/index.tsx").includes("Today's Instruction") && src("app/(tabs)/index.tsx").includes("Open Daily Word") && src("app/(tabs)/index.tsx").includes("dailyWordByRef(verse.ref)"));
ok("daily word: Home verse opens it", src("app/(tabs)/index.tsx").includes('onPressVerse={() => router.push("/daily-word" as any)}'));

// ── Study workspace ──
const sw = src("app/study/index.tsx"), hist = src("app/study/history.tsx");
ok("study: saving highlights skips verses already highlighted", sw.includes("if (taken.has(v)) { skipped++; await flush(v - 1); }"));
ok("study: offline save queued with the client key (no duplicate study)", sw.includes('await enqueue({ id: clientKey, type: "study.create", payload: { clientKey,'));
ok("study: a 409 is shown for the person to choose (never overwritten)", sw.includes("setConflict(e.current as SavedStudy)") && sw.includes("keepMine") && sw.includes("keepTheirs"));
ok("study: notes placeholder is the exact sensitive-information text", sw.includes('defaultValue: "Do not enter sensitive personal information"'));
ok("study: each finding shows why and its source", sw.includes('t("study.whyLabel"') && sw.includes('t("study.sourceLabel"'));
ok("study: study highlights grouped Old/New Testament and direct/related", sw.includes('for (const tm of ["OT", "NT"] as const) for (const g of ["direct", "related"] as const)'));
ok("history: search, kind and folder filters, rename, delete, reopen", hist.includes("listStudies(f)") && hist.includes("setFolder") && hist.includes("updateStudy(editing.id") && hist.includes("deleteStudy(st.id)") && hist.includes('params: { id: item.id }'));
ok("handlers registered once at app start", src("app/_layout.tsx").includes('import "@/lib/offline/handlers";') && src("lib/offline/handlers.ts").includes('registerHandler("study.create"'));
ok("read marks queued offline", src("app/scripture-collections/[id].tsx").includes('type: "collection.read"'));

// ── Emphasis ──
const emph = src("lib/scriptureEmphasis.ts");
ok("emphasis: seven categories, off by default", emph.includes('["jesus", "holy_spirit", "father", "commands", "promises", "prophecy", "prayer_worship"]') && src("lib/bibleReadingPrefs.ts").includes("emphasis: []"));
ok("emphasis api: only published editorial references are served", readFileSync(path.join(root, "../api-server/src/routes/studyWorkspace.ts"), "utf8").includes('.eq("editorial_status", "published").eq("book_code", book)'));

// ── Guide + tree ──
const gs = src("lib/getStarted.ts");
ok("guide: version 2 with What's New for Bible, Plans, Growth", gs.includes("GUIDE_VERSION = 2") && /2: \["bible", "plans", "growth"\]/.test(gs));
ok("guide: shown after onboarding", src("app/(auth)/journey.tsx").includes('router.replace("/get-started?intro=1" as any)'));
const tp = src("components/growth/TreePartsPanel.tsx");
ok("tree parts: counts straight from the tree record", tp.includes("tree.roots.coreLessons.passed") && tp.includes("tree.fruitTotals.verified") && tp.includes("tree.fruitTotals.pendingReview"));
ok("tree parts: each part opens its records", tp.includes("onOpenSection(SECTION[part])") && src("app/my-growth.tsx").includes("<TreePartsPanel tree={tree} onOpenSection={setSection} />"));

// ── Concordance + easy-to-find Scripture emphasis (owner 2026-11-18) ──
const conc = src("app/concordance.tsx"), rd = src("app/bible/index.tsx");
const apiReader = readFileSync(path.join(root, "../api-server/src/lib/bibleReader.ts"), "utf8");
ok("concordance: Bible order, testament filter, count, load more", conc.includes('order: "canonical"') && conc.includes('testament: sc === "all" ? null : sc') && conc.includes('t("concordance.count"') && conc.includes('t("concordance.more"'));
ok("concordance: the searched word is highlighted", conc.includes("const highlighted = (text: string)"));
ok("concordance: Greek and Hebrew words open their own occurrences", conc.includes('pathname: "/dictionary/term/[key]"'));
ok("concordance: says which translation it searched (fallback when yours has no word search)", conc.includes('t("concordance.fallback"'));
ok("concordance api: canonical sort + testament range, defaults unchanged", apiReader.includes('sort: opts.order === "canonical" ? "canonical" : "relevance"') && apiReader.includes('params.set("range", "GEN-MAL")') && apiReader.includes('params.set("range", "MAT-REV")'));
ok("concordance: on the Bible Study page (not a menu), plus Deep Study and the study workspace", src("app/bible-study/index.tsx").includes('route: "/concordance"') && src("app/deep-study/index.tsx").includes('router.push("/concordance"') && src("app/study/index.tsx").includes('pathname: "/concordance"'));
ok("emphasis: its own item in the reader menu, opening the emphasis-only sheet", rd.includes('onPress={() => setSheet("emphasis")}') && rd.includes('only={sheet === "emphasis" ? "emphasis" : undefined}') && src("components/bible/ReadingPrefsSheet.tsx").includes('const emphasisOnly = only === "emphasis";'));

// ── Owner round 2026-11-18 (Plans / Bible Study / brief re-check) ──
const plansHome = src("app/plans/index.tsx"), bsPage = src("app/bible-study/index.tsx"), studyWs = src("app/study/index.tsx");
ok("plans: one study search instead of subject tiles and focus chips", plansHome.includes('pathname: "/study", params: { q: studyQ.trim() }') && !plansHome.includes("SUBJECT_SHORTCUTS") && !plansHome.includes("FOCUS_TYPES") && !plansHome.includes("togetherOnly"));
ok("bible study: topic browser removed, one search + Concordance on the page", !bsPage.includes("getTopics()") && bsPage.includes('pathname: "/study", params: { q: query.trim() }') && bsPage.includes('route: "/concordance"'));
ok("reader menu: no Concordance in the ••• menu (it is on the Bible Study page)", !src("app/bible/index.tsx").includes('label="Concordance"'));
ok("study: compare and listen open the reader in that mode", studyWs.includes("compare: true") && studyWs.includes("listen: true") && src("app/bible/index.tsx").includes('params.listen === "1" ? "start" : null'));
ok("study: connected concepts row searches each concept", studyWs.includes('t("study.connected"') && studyWs.includes('case "concept":'));
ok("study: areas are chosen by the person (suggestions only)", studyWs.includes("SUGGESTED_AREAS") && studyWs.includes("const setArea = (h: StudyHl, area: string | null)") && studyWs.includes('t("study.byArea"'));
ok("study: show in my Bible (temporary, opt-in) + the reader banner with Hide", studyWs.includes("toggleOverlay") && src("app/bible/index.tsx").includes("setStudyOverlay(null)") && src("lib/studyOverlay.ts").includes('const KEY = "study:overlay"'));
ok("study: my own notes/highlights/playlists group", src("lib/studyWorkspaceApi.ts").includes('"mine"') && studyWs.includes('mine: "My notes & playlists"'));
ok("deep study: save to my studies (offline-safe), reopened on the same passage and tab", src("app/deep-study/index.tsx").includes('kind: "deep_study" as const') && src("app/study/history.tsx").includes('item.kind === "deep_study"'));
ok("daily word: Listen through P2P Listen (the reader's player)", src("app/daily-word.tsx").includes("listen: true"));
ok("growth roots: the lesson's own description and Scripture", src("app/my-growth.tsx").includes('t("myGrowth.roots.about"') && readFileSync(path.join(root, "../api-server/src/routes/growth.ts"), "utf8").includes('db.from("p2p_scriptures").select("lesson_id,reference")'));
ok("growth: fruit meaning + the apple-tree biology link (stages never equated)", src("app/my-growth.tsx").includes("meaningVerified") && src("components/growth/TreePartsPanel.tsx").includes('router.push("/botanical"') && src("components/growth/TreePartsPanel.tsx").includes("treeParts.notStages"));
ok("admin: screens size by the space beside the sidebar", src("lib/adminLayout.ts").includes("ADMIN_SIDEBAR = 248") && src("app/admin/curriculum.tsx").includes("useAdminContentWidth()"));
ok("offline: playlists and my chapter notes/highlights kept on the phone", src("lib/scriptureCollectionsApi.ts").includes('cached("collections:list"') && src("lib/bibleReaderApi.ts").includes("cached(`bible:me:"));
ok("offline: Messages says what needs the internet", src("app/(tabs)/messages.tsx").includes("sync.messagesNeedInternet"));

console.log(`offlineFirst (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
