// Main tabs (owner decision 2026-11-06): Home, Learning, Bible, Messages, My Profile, More —
// Prayer and Discover live inside More (Prayer first):
//   • the tab bar (native, iPad capsule, classic) lists exactly those six, in that order;
//   • More: Prayer / Discover switch, opens on Prayer, honours ?section=, its badge counts new
//     prayer notifications and clears when Prayer is shown;
//   • old Prayer / Discover tab links (widgets, notifications, shared links) are rewritten to More;
//     no code still links to the old tab routes;
//   • no Prayer card on Home (Prayer is in More); Bible tab is the Bible Study page; labels in every language.
// Run: node tests/mainTabs.test.mjs
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const load = (rel, mocks = {}) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => { if (m in mocks) return mocks[m]; throw new Error(`unexpected require ${m}`); } });
  return mod.exports;
};

// ── Tab bar ──
const layout = src("app/(tabs)/_layout.tsx");
const order = ["index", "learn", "bible", "messages", "more", "profile"]; // My Profile last (owner, 2026-11-11)
const tabFiles = readdirSync(path.join(root, "app/(tabs)")).filter((f) => f.endsWith(".tsx") && f !== "_layout.tsx").map((f) => f.replace(".tsx", "")).sort();
ok("tabs: exactly Home, Learning, Bible, Messages, More, My Profile", tabFiles.join() === [...order].sort().join(), tabFiles.join());
const nativeOrder = [...layout.matchAll(/<NativeTabs\.Trigger name="([a-z]+)"/g)].map((m) => m[1]);
ok("tabs: native bar in order", nativeOrder.join() === order.join(), nativeOrder.join());
const listOrders = [...layout.matchAll(/\{ name: "([a-z]+)", label/g)].map((m) => m[1]);
ok("tabs: iPad capsule and classic bar in the same order", listOrders.join() === [...order, ...order].join(), listOrders.join());
ok("tabs: Prayer and Discover are no longer tabs", !/name="(prayer|discover)"/.test(layout) && !/name: "(prayer|discover)"/.test(layout));
ok("tabs: Learning and Bible have different icons (graduation cap / book)", layout.includes('"graduationcap"') && layout.includes('"school-outline"') && layout.includes('name="bible"'));
ok("tabs: Messages keeps its unread badge; More shows the prayer badge", layout.includes("hidden={totalUnreadCount === 0}") && layout.includes("hidden={prayerBadge === 0}")
  && layout.includes('tab.name === "more" && prayerBadge > 0') && layout.includes('{ name: "more", label: moreLabel(t), badge: prayerBadge }'));

// ── More ──
const more = src("app/(tabs)/more.tsx");
ok("more: Prayer / Discover switch, Prayer first", /options=\{\[\{ value: "prayer"[^\]]*\{ value: "discover"/.test(more));
ok("more: opens on Prayer, honours ?section=", more.includes('let lastSection: MoreSection = "prayer"') && more.includes('params.section === "prayer" || params.section === "discover"'));
ok("more: showing Prayer clears the badge", more.includes('if (section === "prayer") markPrayerSeen(profile?.id)'));
ok("more: the full Prayer and Discover screens, with the switch at their top", more.includes("<PrayerHome") && more.includes("<DiscoverHome") && more.includes("topSlot={toggle}"));
for (const f of ["components/more/PrayerHome.tsx", "components/more/DiscoverHome.tsx"]) {
  const s = src(f);
  ok(`${f}: takes the switch and reselects as the More tab`, s.includes("{topSlot}") && s.includes('reselectKey = "more"') && s.includes("useScrollToTopOnTabReselect(reselectKey"));
}
const badge = src("hooks/usePrayerBadge.ts");
ok("badge: unread prayer_* notifications newer than the last time Prayer was seen", badge.includes('startsWith("prayer_")') && badge.includes("!n.isRead") && badge.includes("n.createdAt > seenAt"));

// ── Old links ──
const routes = load("lib/moreRoutes.ts");
const intent = load("app/+native-intent.tsx", { "@/lib/moreRoutes": routes });
const r = (p) => intent.redirectSystemPath({ path: p, initial: true });
ok("links: old tab paths → More", r("/(tabs)/prayer") === routes.PRAYER_ROUTE && r("/prayer") === routes.PRAYER_ROUTE && r("/(tabs)/discover") === routes.DISCOVER_ROUTE && r("/discover") === routes.DISCOVER_ROUTE);
ok("links: app-scheme, web and Expo Go URLs too", r("p2pglobal:///(tabs)/prayer") === routes.PRAYER_ROUTE && r("p2pglobal://prayer") === routes.PRAYER_ROUTE
  && r("https://p2p.global/discover") === routes.DISCOVER_ROUTE && r("exp://10.0.0.2:8081/--/(tabs)/prayer") === routes.PRAYER_ROUTE);
ok("links: query strings kept", r("/(tabs)/discover?x=1") === routes.DISCOVER_ROUTE + "&x=1");
ok("links: everything else untouched (incl. Prayer's own pages)", ["/prayer/journal", "/prayer/discover", "/bible?book=JHN", "p2pglobal:///module/1"].every((p) => r(p) === p));
const stale = [];
const walk = (d) => { for (const e of readdirSync(path.join(root, d), { withFileTypes: true })) { const rel = `${d}/${e.name}`; if (e.isDirectory()) walk(rel); else if (/\.(tsx?|mjs)$/.test(e.name) && !rel.includes("moreRoutes") && !rel.includes("+native-intent") && /["'`]\/\(tabs\)\/(prayer|discover)["'`?]/.test(src(rel))) stale.push(rel); } };
["app", "components", "lib", "hooks", "contexts"].forEach(walk);
ok("links: no code links to the old Prayer / Discover tabs", stale.length === 0, stale.join(", "));

// ── Home, Bible, labels ──
const home = src("app/(tabs)/index.tsx");
// Owner decision 2026-11-06: no Prayer card on Home — Prayer is in More (whose badge shows what is new).
ok("home: no Prayer card (Prayer lives in More)", !home.includes("PRAYER_ROUTE") && !home.includes("usePrayerBadge"));
ok("bible tab: the Bible Study page, no Back button as a tab", src("app/(tabs)/bible.tsx").includes("<BibleStudyHome asTab />") && src("app/bible-study/index.tsx").includes("{!asTab ? ("));
ok("bible tab: the /bible-study page still exists for older links", existsSync(path.join(root, "app/bible-study/index.tsx")) && src("app/bible-study/index.tsx").includes("export default function BibleStudyScreen()"));
const locales = readdirSync(path.join(root, "locales")).filter((f) => f.endsWith(".json"));
const missing = locales.filter((f) => { const t = JSON.parse(src(`locales/${f}`)).tabs ?? {}; return !t.bible || (!t.more && f !== "tw.json"); });
ok("labels: Bible and More in every language (Twi 'More' falls back to English)", missing.length === 0, missing.join());

console.log(`mainTabs (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
