// Tests for two shared admin/web fixes:
//  1. lib/launchNotification.ts + its use in app/_layout.tsx — the native-only
//     getLastNotificationResponseAsync is never called on web, native keeps
//     calling it, and a native failure no longer becomes an unhandled error.
//  2. app/admin/_layout.tsx — the top-bar tab row is a horizontal ScrollView
//     between the fixed Admin title and Exit Admin button, and every admin
//     role still sees exactly its own tabs.
// Run: node tests/adminShell.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buttonDouble } from "./helpers/buttonDouble.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = { View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"), StyleSheet: { create: (s) => s } };
const Ionicons = host("Ionicons");
const env = { profile: null, pathname: "/admin" };
const mocks = {
  // The shared button system renders as a labelled tappable (tests/helpers/buttonDouble.mjs).
  "@/components/ui": buttonDouble(React, RN),
  react: { ...React, useEffect: () => {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}] },
  "react-native": RN,
  "@expo/vector-icons": { Ionicons },
  "expo-router": { Slot: host("Slot"), useRouter: () => ({ push() {}, replace() {} }), usePathname: () => env.pathname },
  "react-native-safe-area-context": { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
  "@/contexts/AuthContext": { useAuth: () => ({ profile: env.profile, isLoading: false, isAuthenticated: true }) },
};
const cache = new Map();
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Promise, Error, Array, Object, Math, Date, JSON, Intl,
    require: (n) => {
      if (n in mocks) return mocks[n];
      const base = n.startsWith("@/") ? path.join(root, n.slice(2)) : path.resolve(path.dirname(file), n);
      for (const ext of [".ts", ".tsx", ".js"]) if (existsSync(base + ext)) return loadFile(base + ext);
      throw new Error("unexpected import " + n);
    },
  });
  return mod.exports;
}

// ── 1. Launch notification (web guard) ─────────────────────────────────────
{
  const L = loadFile(path.join(root, "lib/launchNotification.ts"));
  let calls = 0;
  const throwsOnWeb = () => { calls++; return Promise.reject(new Error("ExpoNotifications.getLastNotificationResponse is not available on web")); };
  ok("web: native API never called, resolves null", (await L.getLaunchNotificationResponse("web", throwsOnWeb)) === null && calls === 0);
  const resp = { notification: { request: { identifier: "n1" } } };
  ok("ios: native API called, response passed through", (await L.getLaunchNotificationResponse("ios", async () => resp)) === resp);
  ok("android: native API called, response passed through", (await L.getLaunchNotificationResponse("android", async () => resp)) === resp);
  ok("native: no launch notification → null", (await L.getLaunchNotificationResponse("ios", async () => null)) === null);
  const logged = [];
  const r = await L.getLaunchNotificationResponse("android", async () => { throw new Error("boom"); }, (m) => logged.push(m));
  ok("native failure: logged and resolved null (no unhandled rejection)", r === null && logged.length === 1);

  const layout = readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
  ok("_layout: uses the guarded helper with Platform.OS", /getLaunchNotificationResponse\(Platform\.OS, \(\) => Notifications\.getLastNotificationResponseAsync\(\)\)/.test(layout));
  ok("_layout: no remaining unguarded getLastNotificationResponseAsync().then", !/Notifications\.getLastNotificationResponseAsync\(\)\.then/.test(layout));
  ok("_layout: live tap listener unchanged", /Notifications\.addNotificationResponseReceivedListener\(handleResponse\)/.test(layout));
}

// ── 2. Admin top bar ───────────────────────────────────────────────────────
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
  const c = node.props?.children;
  return { ...node, props: { ...node.props, children: c === undefined ? undefined : expand(c) } };
}
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const textIn = (n) => findAll(n, (x) => x.type === RN.Text).map((t) => [].concat(t.props.children).join("")).join(" ");

const Admin = loadFile(path.join(root, "app/admin/_layout.tsx")).default;
const src = readFileSync(path.join(root, "app/admin/_layout.tsx"), "utf8");
// Expected tabs per role, from the NAV_ITEMS role lists (Recycle Bin: migration 214's content roles).
const EXPECTED = {
  // "Kingdom Wins" review: Wins moderators + the admin_content P2P Impact reviewer (migration 189).
  super_admin: ["Dashboard", "Content", "Kingdom Stories", "Publishing Studio", "Registrations", "Help Requests", "P2P Official Mail", "Moderation", "Kingdom Wins", "Usernames", "Verification", "Translations", "Team", "Recycle Bin"],
  admin_content: ["Dashboard", "Content", "Kingdom Stories", "Publishing Studio", "Kingdom Wins", "Recycle Bin"],
  admin_moderation: ["Dashboard", "Publishing Studio", "Moderation", "Kingdom Wins"],
  moderator: ["Dashboard", "Publishing Studio", "Help Requests", "Moderation", "Kingdom Wins", "Usernames", "Verification"],
  admin_supervisor: ["Dashboard", "Publishing Studio", "Kingdom Wins", "Team"],
  admin_translation: ["Dashboard", "Publishing Studio", "Translations"],
  admin_marketing: ["Dashboard", "Publishing Studio", "P2P Official Mail"],
  admin_help: ["Dashboard", "Help Requests", "P2P Official Mail"],
  peer_guide: ["Dashboard", "Content", "Help Requests", "Translations", "Recycle Bin"],
  church_leader: ["Dashboard", "Content", "Registrations", "Help Requests", "Moderation", "Usernames", "Verification", "Translations", "Recycle Bin"],
  admin_finance: ["Dashboard"],
};
for (const [role, tabs] of Object.entries(EXPECTED)) {
  env.profile = { id: "u", role };
  env.pathname = "/admin";
  const tree = expand(React.createElement(Admin));
  const scroll = findAll(tree, (n) => n.type === RN.ScrollView);
  const labels = scroll.length ? findAll(scroll[0], (n) => n.type === RN.TouchableOpacity).map((b) => b.props.accessibilityLabel) : [];
  ok(`${role}: exactly its tabs, in order`, JSON.stringify(labels) === JSON.stringify(tabs), JSON.stringify(labels));
}
{
  env.profile = { id: "u", role: "super_admin" };
  env.pathname = "/admin/studio/review";
  const tree = expand(React.createElement(Admin));
  const bar = findAll(tree, (n) => n.type === RN.View && [].concat(n.props.children).some((c) => c && c.type === RN.ScrollView))[0];
  const kids = [].concat(bar.props.children).filter(Boolean);
  ok("top bar: Admin title, scrolling tabs, Exit Admin as three siblings", kids.length === 3 && /Admin/.test(textIn(kids[0])) && kids[1].type === RN.ScrollView && /Exit Admin/.test(textIn(kids[2])));
  ok("top bar: tab row scrolls horizontally", kids[1].props.horizontal === true);
  ok("top bar: title and Exit never shrink", src.includes("topBarLeft: {\n    flexShrink: 0") && /<AppButton label="Exit Admin"[^\n]*style=\{\{ flexShrink: 0 \}\}/.test(src));
  ok("top bar: tab row may shrink below its content (then scrolls)", /topBarNav: \{\s*flex: 1,\s*flexShrink: 1,\s*minWidth: 0,/.test(src));
  const tabs = findAll(kids[1], (n) => n.type === RN.TouchableOpacity);
  ok("tabs: labelled buttons with selected state", tabs.every((t) => t.props.accessibilityRole === "button" && typeof t.props.accessibilityLabel === "string" && "selected" in t.props.accessibilityState));
  ok("tabs: aria-selected mirrors the selected state (reaches the browser)", tabs.every((t) => t.props["aria-selected"] === t.props.accessibilityState.selected));
  ok("tabs: Publishing Studio selected on a Studio page", tabs.find((t) => t.props.accessibilityLabel === "Publishing Studio").props.accessibilityState.selected === true);
  ok("tabs: report layout for scroll-into-view", tabs.every((t) => typeof t.props.onLayout === "function"));
}
{
  env.profile = { id: "u", role: "student" };
  env.pathname = "/admin";
  ok("non-admin role: renders nothing", expand(React.createElement(Admin)) === null);
}

// ── 3. Super Admin Dashboard sub-tabs (app/admin/index.tsx) ────────────────
{
  const dash = readFileSync(path.join(root, "app/admin/index.tsx"), "utf8");
  ok("dashboard: sub-tab row is a horizontal ScrollView", dash.includes("<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll} contentContainerStyle={styles.tabsRow}"));
  ok("dashboard: row takes only its own height", /tabsScroll: { flexGrow: 0, flexShrink: 0 }/.test(dash));
  ok("dashboard: chips have a 44x44 minimum touch area", /tabChip: {[^}]*minHeight: 44, minWidth: 44/.test(dash));
  ok("dashboard: all four tabs kept, selecting still via setTab", ["Live Activity", "Admin Monitor", "Platform Stats", "Management"].every((l) => dash.includes(`"${l}"`)) && dash.includes("onPress={() => setTab(tb)}"));
  ok("dashboard: chips are labelled tabs in a tablist", dash.includes('contentContainerStyle={styles.tabsRow} accessibilityRole="tablist"') && /accessibilityRole="tab"\s*accessibilityLabel=\{label\}/.test(dash));
  // react-native-web 0.21 ignores accessibilityState.selected; aria-selected
  // is what reaches the browser (and React Native maps it on native too).
  ok("dashboard: selected state exposed (accessibilityState + aria-selected)", /accessibilityState=\{\{ selected: tab === tb \}\}\s*aria-selected=\{tab === tb\}/.test(dash));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
