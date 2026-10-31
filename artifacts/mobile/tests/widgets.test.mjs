// Home-screen widgets: the snapshot builder (lib/widgetSnapshot, run for real),
// daily reminders (lib/dailyReminders, run for real), and source checks that
// the native widgets (iOS Swift, Android Kotlin) follow the same contract and
// rules, never fetch, and never show private content. Native code can't be
// compiled here (no Xcode / Android SDK on this machine) — an EAS build does.
// Run: node tests/widgets.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const read = (p) => readFileSync(path.join(root, p), "utf8");

const scheduled = [];
const MOCKS = {
  "react-native": { Platform: { OS: "ios" } },
  "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async () => null, setItem: async () => {}, multiSet: async () => {}, multiRemove: async () => {} } },
  "expo-notifications": {
    SchedulableTriggerInputTypes: { DAILY: "daily" },
    getAllScheduledNotificationsAsync: async () => [{ identifier: "p2p-daily-old" }, { identifier: "p2p-study-1" }],
    cancelScheduledNotificationAsync: async (id) => { scheduled.push(["cancel", id]); },
    getPermissionsAsync: async () => ({ status: "granted" }),
    requestPermissionsAsync: async () => ({ status: "granted" }),
    scheduleNotificationAsync: async (req) => { scheduled.push(["schedule", req]); },
  },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, Date, Number, String, Array, Object, Set, Map, Promise, Error,
    require: (n) => (n in MOCKS ? MOCKS[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));

// ── 1. Snapshot builder ─────────────────────────────────────────────────────
const W = load("lib/widgetSnapshot.ts");
const link = (p) => `p2pglobalbiblestudy://${p.replace(/^\//, "")}`;
const verses = [{ ref: "John 15:5", text: "I am the vine…", url: link("/bible?book=JHN&chapter=15&v=5") }, { ref: "Acts 2:42", text: "They devoted…", url: link("/bible-study") }];
const modules = [
  { id: "m1", title: "Orientation", isLocked: false, lessonCount: 6, completedLessons: 6 },
  { id: "m2", title: "Who Is God?", isLocked: false, lessonCount: 8, completedLessons: 3 },
  { id: "m3", title: "Locked", isLocked: true, lessonCount: 5, completedLessons: 0 },
  { id: "m4", title: "Empty", isLocked: false, lessonCount: 0, completedLessons: 0 },
];
const base = {
  now: new Date("2026-10-30T09:00:00Z"), signedIn: true, firstName: "Peter", prefs: W.DEFAULT_WIDGET_PREFS, link, verses, modules,
  activePlans: [{ id: "p1", title: "Foundations of Prayer" }, { id: "p2", title: "Second plan" }],
  stories: [{ id: "s0", title: "Done", myProgress: { totalChapters: 4, doneChapters: 4, started: true } }, { id: "s1", title: "David", myProgress: { totalChapters: 6, doneChapters: 2, started: true }, lastChapterNumber: 3 }],
  bible: { book: "PRO", bookName: "Proverbs", chapter: 5, translation: "KJV" },
  overview: { toDo: 2, awaitingReview: 1, feedback: 0, toReview: 3 },
  studies: [{ id: "t1", title: "Creation", destinationName: "The Okafors" }],
  nextGathering: { title: "Sunday Gathering", startsAt: "2026-11-01T09:00:00Z", churchName: "Grace Church" },
};
let s = W.buildWidgetSnapshot(base);
ok("versioned contract", s.version === W.WIDGET_SNAPSHOT_VERSION && s.version === 1 && s.updatedAt === "2026-10-30T09:00:00.000Z");
ok("Kingdom School: the shared current-module rule (first unlocked, non-empty, unfinished)", s.school.hasProgress && s.school.moduleTitle === "Who Is God?" && s.school.completedLessons === 3 && s.school.lessonCount === 8 && s.school.url.endsWith("module/m2"));
ok("Core Curriculum: real counts (finished modules of modules with lessons) — no invented percentage", s.school.modulesCompleted === 1 && s.school.totalModules === 3 && s.progress.modulesCompleted === 1 && s.progress.totalModules === 3);
ok("Learning Plans: first active plan, count of all", s.plans.activeCount === 2 && s.plans.title === "Foundations of Prayer" && s.plans.url.endsWith("plan/p1"));
ok("Kingdom Stories: the shared in-progress rule; opens the next chapter", s.story.title === "David" && s.story.detail === "Chapter 3 of 6" && s.story.url.endsWith("kingdom-stories/s1?open=next"));
ok("Bible: last chapter read opens there", s.bible.label === "Proverbs 5 · KJV" && /bible\?book=PRO&chapter=5$/.test(s.bible.url));
ok("My Learning: counts only, from the Learning Centre overview", s.learning.known && s.learning.toDo === 2 && s.learning.toReview === 3 && s.learning.url.endsWith("learning"));
ok("greeting uses the first name (default on)", s.greeting.name === "Peter");
ok("verses carry their own links", s.verses[0].url.includes("book=JHN&chapter=15"));
ok("community details OFF by default: no family/church names, no gathering", s.together.title === "Creation" && s.together.detail === null && s.gathering.title === null && s.privacy.showCommunity === false);
s = W.buildWidgetSnapshot({ ...base, prefs: { personalGreeting: false, showCommunity: true, lockScreenDetails: true } });
ok("community details ON: study's group name and next church Gathering", s.together.detail === "The Okafors" && s.gathering.title === "Sunday Gathering" && s.gathering.where === "Grace Church" && s.gathering.url.endsWith("church/calls"));
ok("greeting without a name when the person turns it off", s.greeting.name === null && s.privacy.lockScreenDetails === true);
s = W.buildWidgetSnapshot({ ...base, modules: modules.map((m) => ({ ...m, completedLessons: m.lessonCount })), overview: null, studies: [], activePlans: [], stories: [] });
ok("all done: no current module, full progress; unknown overview is marked unknown (not zero)", !s.school.hasProgress && s.school.modulesCompleted === s.school.totalModules && s.learning.known === false && s.plans.title === null && s.story.title === null && s.together.title === null);
const out = W.signedOutSnapshot(new Date(), link, verses);
ok("signed out: nothing personal at all", out.signedIn === false && out.greeting.name === null && out.school.moduleTitle === null && out.plans.title === null && out.together.title === null && !out.learning.known);
const json = JSON.stringify(W.buildWidgetSnapshot({ ...base, prefs: { personalGreeting: true, showCommunity: true, lockScreenDetails: true } }));
ok("no tokens, ids of people, emails, journal or prayer text in the snapshot", !/token|password|email|journal(Text|Entry)|prayerRequest|reflection|answer|message/i.test(json.replace(/journalUrl|prayerUrl/g, "")));
ok("change detection ignores the timestamp", W.snapshotKey(W.buildWidgetSnapshot(base)) === W.snapshotKey(W.buildWidgetSnapshot({ ...base, now: new Date("2026-10-31T09:00:00Z") })));
ok("greeting boundaries: morning < 12 ≤ afternoon < 18 ≤ evening", W.greetingFor(0) === "Good morning" && W.greetingFor(11) === "Good morning" && W.greetingFor(12) === "Good afternoon" && W.greetingFor(17) === "Good afternoon" && W.greetingFor(18) === "Good evening");
ok("verse of the day: same rule as Home (day of month % length)", W.verseForDay(verses, new Date(2026, 9, 3)).ref === verses[3 % 2].ref && W.verseForDay([], new Date()) === null);
ok("Home and widgets share one verse list", /import \{ DAILY_VERSES \} from "@\/constants\/dailyVerses";/.test(read("contexts/DataContext.tsx")) && /new Date\(\)\.getDate\(\) % DAILY_VERSES\.length/.test(read("contexts/DataContext.tsx")) && read("components/widgets/WidgetSyncHost.tsx").includes("DAILY_VERSES"));

// ── 2. Daily reminders ──────────────────────────────────────────────────────
const R = load("lib/dailyReminders.ts");
const plan = R.plannedDailyReminders({ confession: { enabled: true, time: "06:30" }, prayerJournal: { enabled: true }, journal: { enabled: true, time: "21:00" } });
ok("reminders: confession at its time, prayer journal 20:00, discipleship journal at its time", plan.length === 3 && plan[0].hour === 6 && plan[0].minute === 30 && plan[1].hour === 20 && plan[2].hour === 21);
ok("reminder text never personal", plan.every((r) => !/\{|name|request/i.test(r.title + r.body)));
ok("reminders off → none; bad time falls back safely", R.plannedDailyReminders({ confession: { enabled: false, time: "x" }, prayerJournal: { enabled: false }, journal: { enabled: false, time: "x" } }).length === 0
  && R.plannedDailyReminders({ confession: { enabled: true, time: "bad" }, prayerJournal: { enabled: false }, journal: { enabled: false, time: "" } })[0].hour === 7);
const push = read("lib/push.ts");
ok("tapping a reminder can only open an approved screen", plan.every((r) => push.includes(`"${r.route}"`)) && /notificationType === "daily_reminder"/.test(push));
scheduled.length = 0;
const res = await R.applyDailyReminders({ confession: { enabled: true, time: "07:00" }, prayerJournal: { enabled: false }, journal: { enabled: false, time: "21:00" } });
ok("apply: cancels only its own old reminders, then schedules daily ones", res.status === "scheduled" && res.count === 1
  && scheduled.some(([k, id]) => k === "cancel" && id === "p2p-daily-old") && !scheduled.some(([k, id]) => k === "cancel" && id === "p2p-study-1")
  && scheduled.some(([k, r]) => k === "schedule" && r.trigger.type === "daily" && r.content.data.notificationType === "daily_reminder"));
ok("signed out clears them", (await R.applyDailyReminders(null)).status === "off");
ok("Prayer settings switches now schedule (and ask permission on enable)", (read("app/settings/prayer.tsx").match(/syncDailyReminders\(profile\.id, \{ \.\.\.profile, \w+: true \}, true\)/g) ?? []).length === 2 && /syncDailyReminders\(uid, uid \? profile : null\)/.test(read("app/_layout.tsx")));

// ── 3. Native widgets follow the same contract and rules ────────────────────
const swift = read("plugins/p2p-widgets/P2PWidgets.swift");
const kotlin = read("modules/p2p-widgets/android/src/main/java/expo/modules/p2pwidgets/P2PWidgets.kt");
const contractKeys = ["updatedAt", "signedIn", "greeting", "verses", "verseUrl", "school", "plans", "story", "learning", "together", "gathering", "reminders", "privacy",
  "hasProgress", "moduleTitle", "completedLessons", "lessonCount", "modulesCompleted", "totalModules", "activeCount", "awaitingReview", "toReview", "startsAt", "prayerUrl", "journalUrl", "lockScreenDetails"];
ok("iOS decodes the snapshot fields it uses", contractKeys.every((k) => swift.includes(k)));
ok("Android reads the snapshot fields it uses", ["greeting", "verses", "verseUrl", "school", "plans", "story", "learning", "together", "gathering", "reminders", "hasProgress", "modulesCompleted", "totalModules", "startsAt", "prayerUrl", "journalUrl", "updatedAt", "signedIn"].every((k) => kotlin.includes(`"${k}"`)));
ok("both: greeting boundaries 12 / 18", /h < 12 \? "GOOD MORNING" : \(h < 18/.test(swift) && /if \(h < 12\) "GOOD MORNING" else if \(h < 18\)/.test(kotlin));
ok("both: verse of the day = day of month % list length (same as Home)", /component\(\.day, from: date\) % list\.count/.test(swift) && /DAY_OF_MONTH\) % list\.length\(\)/.test(kotlin));
ok("both: 'may be out of date' after a day", /> 86_400/.test(swift) && /24L \* 60 \* 60 \* 1000/.test(kotlin));
ok("both: signed out shows no personal data", /signedIn != true/.test(swift) && /if \(signedIn \|\| worksSignedOut\)/.test(kotlin));
ok("widgets never fetch (no network APIs)", !/URLSession|URLRequest|dataTask/.test(swift) && !/HttpURLConnection|OkHttp|URL\(/.test(kotlin));
ok("Lock Screen: generic text unless details are on", /details \? \(card\.title \?\? card\.lockTitle\) : card\.lockTitle/.test(swift));
ok("iOS: ten widgets in one bundle (WidgetKit's limit)", (swift.match(/^struct P2P\w+Widget: Widget/gm) ?? []).length === 10 && /@main\s+struct P2PWidgetsBundle: WidgetBundle/.test(swift));
ok("iOS 17 container background with an older-iOS fallback", /containerBackground\(for: \.widget\)/.test(swift) && /iOSApplicationExtension 17\.0/.test(swift));
const manifest = read("modules/p2p-widgets/android/src/main/AndroidManifest.xml");
const providers = [...kotlin.matchAll(/^class (\w+Widget) : P2PWidgetProvider/gm)].map((m) => m[1]);
ok("Android: every widget class is declared with its own provider info", providers.length === 7 && providers.every((p) => manifest.includes(`android:name=".${p}"`)) && providers.every((p) => existsSync(path.join(root, `modules/p2p-widgets/android/src/main/res/xml/p2p_widget_${p.replace("Widget", "").toLowerCase()}_info.xml`))));
ok("Android: receivers not exported; taps open only this app", !/android:exported="true"/.test(manifest) && /setPackage\(ctx\.packageName\)/.test(kotlin) && /FLAG_IMMUTABLE/.test(kotlin));
const plugin = read("plugins/withP2PWidgets.js");
ok("iOS extension: App Group from the bundle id (staging separate), declared to EAS, WidgetKit + SwiftUI linked", /group\.\$\{config\.ios\.bundleIdentifier\}/.test(plugin) && /declareAppExtension\(/.test(plugin) && /WidgetKit\.framework/.test(plugin) && /SwiftUI\.framework/.test(plugin));
ok("plugin registered for every build (without touching app.json)", read("app.config.js").includes('"./plugins/withP2PWidgets.js"'));
ok("app and widgets read the same App Group key", read("modules/p2p-widgets/ios/P2PWidgetsModule.swift").includes('"p2p.widgets.snapshot"') && swift.includes('"p2p.widgets.snapshot"') && read("plugins/p2p-widgets/P2PWidgets-Info.plist").includes("P2PAppGroup"));
ok("sync host mounted once, writes only on change, clears on sign-out", (read("app/_layout.tsx").match(/<WidgetSyncHost \/>/g) ?? []).length === 1 && /prev === key/.test(read("lib/widgetSync.ts")) && /clearWidgetSnapshot\(\)/.test(read("components/widgets/WidgetSyncHost.tsx")));
ok("settings: Widgets & Offline screen in Settings (not a new tab)", existsSync(path.join(root, "app/settings/widgets.tsx")) && read("app/settings/index.tsx").includes('route: "/settings/widgets"'));
// iOS build 2026-10-31 failed with "cannot find 'P2PWidgetsModule' in scope": the bridge pod and the
// WidgetKit extension target were both named P2PWidgets, so the app's `import P2PWidgets` found the
// extension's module. The pod (= the Swift module the app imports) must never share the target's name.
{
  const target = plugin.match(/const TARGET = "([^"]+)"/)?.[1];
  const podspecs = readdirSync(path.join(root, "modules/p2p-widgets/ios")).filter((f) => f.endsWith(".podspec"));
  const podName = podspecs.length === 1 ? read(`modules/p2p-widgets/ios/${podspecs[0]}`).match(/s\.name\s*=\s*'([^']+)'/)?.[1] : null;
  ok("iOS: bridge pod name differs from the widget extension target (no Swift module clash)", !!target && !!podName && podName !== target && podspecs[0] === `${podName}.podspec`, `${podName} vs ${target}`);
}

console.log(`widgets: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
