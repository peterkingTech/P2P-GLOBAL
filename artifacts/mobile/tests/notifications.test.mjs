// Tests for notifications: lib/notificationTap.ts (push-tap handling and
// read state), lib/notificationModel.ts (identity/text rules) and
// components/notifications/NotificationRow.tsx (the identity layout), plus
// source checks on the wiring in app/_layout.tsx, DataContext and the
// Notification Center. Real files transpiled with TypeScript; synthetic data.
// Server behaviour (actor mapping, idempotent mark-read, exact count, paging)
// is covered by scripts/studio-db-test/notifications-routes.mjs.
// Run: node tests/notifications.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

let slots = [], slot = 0;
const reactMock = {
  ...React,
  useState: (init) => { const i = slot++; if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
  useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: (v) => ({ current: v }),
};
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), Image: host("Image"), ActivityIndicator: host("ActivityIndicator"),
  StyleSheet: { create: (s) => s },
};
const colors = { primaryGreen: "#0a0", accentGreen: "#0b0", lightCream: "#fff", card: "#fff", borderBeige: "#ddd", textDark: "#111", textMid: "#333", textMuted: "#777" };
const mocks = {
  react: reactMock, "react-native": RN,
  "@/contexts/ThemeContext": { useTheme: () => ({ colors }) },
  "@/constants/colors": { default: colors, __esModule: true },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, String, Number, Array, Object, Set, Map, Date, Promise, Error,
    require: (n) => {
      if (n in mocks) return mocks[n];
      if (/\.(png|jpg)$/.test(n)) { const p = path.resolve(path.dirname(file), n); return { __asset: path.relative(root, p).replace(/\\/g, "/"), exists: existsSync(p) }; }
      return loadFile(resolveFile(n, path.dirname(file)));
    } });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (node.type === React.Fragment) return expand(node.props.children);
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
  const children = node.props?.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const textOf = (tree) => findAll(tree, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).flat(Infinity).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");
const render = (Comp, props) => { slot = 0; slots = []; return expand(React.createElement(Comp, props)); };

const Tap = load("lib/notificationTap.ts");
const M = load("lib/notificationModel.ts");
const { NotificationRow } = load("components/notifications/NotificationRow.tsx");
const NID = "11111111-2222-4333-8444-555555555555", NID2 = "11111111-2222-4333-8444-666666666666";

// ── Tap handling ───────────────────────────────────────────────────────────
function harness({ signedIn = true, markResult = "marked" } = {}) {
  const log = { nav: [], marks: [], clears: 0 };
  const state = { signedIn, markResult };
  const h = Tap.createNotificationTapHandler({
    route: (i) => ({ path: i.data?.notificationType === "new_message" ? `/messages/${i.data.conversationId}` : "/notifications", replace: i.data?.notificationType === "incoming_call" }),
    navigate: (p, r) => log.nav.push(`${r ? "replace" : "push"}:${p}`),
    markRead: async (id) => { log.marks.push(id); return typeof state.markResult === "function" ? state.markResult(id) : state.markResult; },
    canSync: () => state.signedIn,
    clearLaunchResponse: () => { log.clears++; },
  });
  return { h, log, state };
}
const tap = (id, extra = {}, os = "os-1") => ({ osIdentifier: os, data: { notificationId: id, notificationType: "new_message", conversationId: "c1", ...extra } });
{
  const { h, log } = harness();
  const r = await h.handle(tap(NID));
  ok("tap: opens the right destination", log.nav.join() === "push:/messages/c1", log.nav.join());
  ok("tap: marks THAT notification read (the bug)", log.marks.join() === NID && r.read === "marked");
  ok("tap: cold-start response cleared so it can't replay", log.clears === 1);
  const dup = await h.handle(tap(NID, {}, "os-2"));
  ok("duplicate OS event for the same notification: no second navigation or write", dup.outcome === "duplicate" && log.nav.length === 1 && log.marks.length === 1);
  await h.handle(tap(NID2, {}, "os-3"));
  ok("a different notification is handled separately", log.nav.length === 2 && log.marks.join() === `${NID},${NID2}`);
  ok("opening the app never marks anything else", log.marks.length === 2);
}
{
  const { h, log, state } = harness({ signedIn: false });
  const r = await h.handle(tap(NID));
  ok("cold start before sign-in: navigates, defers the mark", r.read === "deferred" && log.marks.length === 0 && log.nav.length === 1 && h.pendingIds().join() === NID);
  await h.flushPending();
  ok("still signed out: nothing sent", log.marks.length === 0);
  state.signedIn = true;
  await h.flushPending();
  ok("after sign-in: the deferred mark is sent once", log.marks.join() === NID && h.pendingIds().length === 0);
}
{
  const { h, log, state } = harness({ markResult: "failed" });
  await h.handle(tap(NID));
  ok("network/auth failure: kept for retry, not lost", h.pendingIds().join() === NID);
  state.markResult = "marked";
  await h.flushPending();
  ok("retry on next foreground succeeds and clears it", log.marks.length === 2 && h.pendingIds().length === 0);
}
{
  const { h } = harness({ markResult: () => { throw new Error("boom"); } });
  const r = await h.handle(tap(NID));
  ok("a throwing mark is treated as failed (no crash, retried later)", r.read === "failed" && h.pendingIds().join() === NID);
}
{
  const { h, log } = harness({ markResult: "not_found" });
  const r = await h.handle(tap(NID));
  ok("deleted/unauthorized notification: not retried forever", r.read === "not_found" && h.pendingIds().length === 0 && log.nav.length === 1);
}
{
  const { h, log } = harness();
  await h.handle({ osIdentifier: "os-x", data: { notificationType: "missed_call" } });
  await h.handle({ osIdentifier: "os-x", data: { notificationType: "missed_call" } });
  ok("push without a notification id: navigates once (by OS id), marks nothing", log.nav.length === 1 && log.marks.length === 0);
  await h.handle({ osIdentifier: "os-y", data: { notificationId: "not-a-uuid", notificationType: "incoming_call" } });
  ok("malformed id ignored; incoming call uses replace", log.marks.length === 0 && log.nav.at(-1) === "replace:/notifications");
  ok("notificationIdOf validates", Tap.notificationIdOf({ notificationId: NID }) === NID && Tap.notificationIdOf({ notificationId: 5 }) === null && Tap.notificationIdOf(undefined) === null);
}

// ── Identity and text rules ────────────────────────────────────────────────
const base = { id: "n1", title: "Ben Sender", message: "sent you a message", isRead: false, createdAt: new Date(Date.now() - 5 * 60e3).toISOString(), notificationType: "new_message", data: {} };
const ben = { id: "u-b", name: "Ben Sender", photoUrl: "https://cdn.example/ben.jpg", username: "ben" };
ok("person: identity from the server's actor", JSON.stringify(M.notificationIdentity({ ...base, actor: ben })) === JSON.stringify({ kind: "person", name: "Ben Sender", photoUrl: "https://cdn.example/ben.jpg" }));
ok("no actor → P2P Global, never an invented person", M.notificationIdentity({ ...base, actor: null }).kind === "system" && M.notificationIdentity({ ...base, actor: { ...ben, name: "  " } }).kind === "system");
ok("message text: name + 'sent you a message' (no content added)", JSON.stringify(M.notificationText({ ...base, actor: ben })) === JSON.stringify({ headline: "Ben Sender", detail: "sent you a message" }));
ok("person with only a title: title becomes the detail", M.notificationText({ ...base, actor: ben, message: null, title: "Ben accepted your request" }).detail === "Ben accepted your request");
ok("system: title + message", JSON.stringify(M.notificationText({ ...base, actor: null, title: "Weekly report ready", message: null })) === JSON.stringify({ headline: "Weekly report ready", detail: null }));
ok("relative time", M.relativeTime(new Date(Date.now() - 30e3).toISOString()) === "now" && M.relativeTime(new Date(Date.now() - 5 * 60e3).toISOString()) === "5m" && M.relativeTime(new Date(Date.now() - 3 * 3600e3).toISOString()) === "3h" && M.relativeTime("junk") === "");
ok("accessibility label says unread, who, what, when", /^Unread, Ben Sender, sent you a message, 5m$/.test(M.notificationAccessibilityLabel({ ...base, actor: ben })), M.notificationAccessibilityLabel({ ...base, actor: ben }));
ok("system accessibility label says it's from P2P Global", /^Unread, From P2P Global, Weekly report ready, 5m$/.test(M.notificationAccessibilityLabel({ ...base, actor: null, title: "Weekly report ready", message: null })), M.notificationAccessibilityLabel({ ...base, actor: null, title: "Weekly report ready", message: null }));

// ── Row layout ─────────────────────────────────────────────────────────────
{
  let pressed = 0;
  const row = render(NotificationRow, { n: { ...base, actor: ben }, onPress: () => pressed++ });
  const images = findAll(row, (x) => x.type === RN.Image);
  ok("row (person): real photo on the left", images.some((i) => i.props.source?.uri === "https://cdn.example/ben.jpg"));
  ok("row (person): P2P brand mark on the right, from the official app icon", images.some((i) => i.props.source?.__asset === "assets/images/icon.png" && i.props.source.exists));
  ok("row: name, description, time, unread", /Ben Sender \| sent you a message \| 5m/.test(textOf(row)) && findAll(row, (x) => x.type === RN.View && x.props.style?.borderRadius === 5).length === 1, textOf(row));
  const btn = findAll(row, (x) => x.type === RN.TouchableOpacity)[0];
  ok("row: one labelled button", btn.props.accessibilityRole === "button" && /Ben Sender/.test(btn.props.accessibilityLabel));
  btn.props.onPress();
  ok("row: press handled", pressed === 1);
  const sys = render(NotificationRow, { n: { ...base, actor: null, title: "Your weekly report is ready", message: null, isRead: true }, onPress: () => {} });
  const sysImages = findAll(sys, (x) => x.type === RN.Image);
  ok("row (system): P2P mark on the left, not repeated on the right", sysImages.length === 1 && sysImages[0].props.source.__asset === "assets/images/icon.png");
  ok("row (system): no unread dot when read", !findAll(sys, (x) => x.type === RN.View && x.props.style?.borderRadius === 5).length);
  const broken = render(NotificationRow, { n: { ...base, actor: { ...ben, photoUrl: null } }, onPress: () => {} });
  ok("row: missing photo → initial", /^B \|/.test(textOf(broken)), textOf(broken));
  const long = render(NotificationRow, { n: { ...base, actor: { ...ben, name: "Bartholomew Oluwaseun Adekunle-Johnson the Third" } }, onPress: () => {} });
  ok("row: long names truncated to one line", findAll(long, (x) => x.type === RN.Text && /Bartholomew/.test(String(x.props.children))).every((t) => t.props.numberOfLines === 1));
}

// ── Wiring (source checks) ─────────────────────────────────────────────────
const layout = readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
ok("_layout: tap handler wired to the tap listener and cold start", /createNotificationTapHandler\(/.test(layout) && /addNotificationResponseReceivedListener\(handleResponse\)/.test(layout) && /getLaunchNotificationResponse\(/.test(layout));
ok("_layout: marks through DataContext (the canonical route)", /markRead: \(id\) => markReadRef\.current\(id\)/.test(layout));
ok("_layout: clears the cold-start response (native only)", /clearLastNotificationResponseAsync\(\)/.test(layout));
ok("_layout: pending marks flushed on sign-in and foreground", /flushPending\(\)/.test(layout) && /AppState\.addEventListener\("change"/.test(layout));
ok("_layout: badge follows the server unread count (native only)", /setBadgeCountAsync\(unreadNotificationCount\)/.test(layout));
const dc = readFileSync(path.join(root, "contexts/DataContext.tsx"), "utf8");
ok("DataContext: mark-read checks the response and counts once (wasUnread)", /if \(!res\.ok\) return "failed"/.test(dc) && /body\?\.wasUnread === true\) setUnreadNotificationCount/.test(dc));
ok("DataContext: count from the exact server endpoint", /\/notifications\/me\/unread-count/.test(dc));
ok("DataContext: read changes on other devices reconcile (UPDATE events)", /event: "UPDATE", schema: "public", table: "p2p_notifications"/.test(dc));
ok("DataContext: no 'mark all' on open", !/markAllNotificationsRead\(\)/.test(dc.slice(dc.indexOf("refreshUnreadNotificationCount = useCallback"))));
const center = readFileSync(path.join(root, "app/notifications/index.tsx"), "utf8");
ok("center: uses the identity row and paging", /<NotificationRow /.test(center) && /before: last\.createdAt/.test(center));
ok("center: failed mark restores the row to unread", /if \(r === "failed"\) setNotifications/.test(center));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
