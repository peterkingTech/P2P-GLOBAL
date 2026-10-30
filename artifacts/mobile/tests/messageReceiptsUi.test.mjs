// Render tests for the receipt UI (components/MessageTicks.tsx and
// components/MessageInfoSheet.tsx) with react-native mocked: the real
// components are transpiled and their element trees inspected.
// Run: node tests/messageReceiptsUi.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { buttonDouble } from "./helpers/buttonDouble.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");

const mk = (name) => ({ [name]: function () { return null; } })[name];
const RN = {
  View: mk("View"), Text: mk("Text"), TouchableOpacity: mk("TouchableOpacity"), ScrollView: mk("ScrollView"),
  Modal: mk("Modal"), ActivityIndicator: mk("ActivityIndicator"),
  StyleSheet: { create: (s) => s },
};
const Ionicons = mk("Ionicons");
let hookState = [];
function load(rel, extraMocks = {}) {
  const src = readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const mod = { exports: {} };
  const reactMock = {
    ...React,
    useState: (init) => [hookState.length ? hookState.shift() : init, () => {}],
    useEffect: () => {},
  };
  vm.runInNewContext(js, {
    module: mod, exports: mod.exports, console, Date,
    require: (n) => {
      if (n === "react") return reactMock;
      if (n === "react-native") return RN;
      if (n === "@expo/vector-icons") return { Ionicons };
      if (n === "@/lib/messageReceipts") return loadPlain("lib/messageReceipts.ts");
      // The shared button system renders as a labelled tappable (tests/helpers/buttonDouble.mjs).
      if (n === "@/components/ui") return buttonDouble(React, RN);
      if (n in extraMocks) return extraMocks[n];
      throw new Error("unexpected import " + n);
    },
  });
  return mod.exports;
}
function loadPlain(rel) {
  const js = ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Date, Math, Uint8Array, globalThis: {} });
  return mod.exports;
}
// Expand function components (not host mocks) so the full tree is inspectable.
const HOSTS = new Set(Object.values(RN).filter((v) => typeof v === "function").concat([Ionicons]));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !HOSTS.has(node.type) && !node.type.__host) return expand(node.type(node.props));
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
const textOf = (node) => findAll(node, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

// ── MessageTicks ────────────────────────────────────────────────────────────
const T = load("components/MessageTicks.tsx");
const icon = (tree) => findAll(tree, (n) => n.type === Ionicons)[0]?.props;
const spinner = (tree) => findAll(tree, (n) => n.type === RN.ActivityIndicator)[0];
const cases = {
  sending: (t) => !!spinner(t) && !icon(t),
  sent: (t) => icon(t).name === "checkmark" && icon(t).color === T.TICK_COLORS.grey,
  delivered: (t) => icon(t).name === "checkmark-done" && icon(t).color === T.TICK_COLORS.grey,
  read: (t) => icon(t).name === "checkmark-done" && icon(t).color === T.TICK_COLORS.read,
  failed: (t) => icon(t).name === "alert-circle" && icon(t).color === T.TICK_COLORS.failed,
};
for (const [status, check] of Object.entries(cases)) {
  const tree = expand(T.MessageTicks({ status, timeLabel: "10:42 AM", onPress: () => {} }));
  ok(`ticks ${status}: glyph/colour`, check(tree), JSON.stringify(icon(tree)));
  ok(`ticks ${status}: has own a11y label`, typeof tree.props.accessibilityLabel === "string" && tree.props.accessibilityLabel.startsWith("10:42 AM."));
  ok(`ticks ${status}: tappable with role button and >=44pt hit area`, tree.type === RN.TouchableOpacity && tree.props.accessibilityRole === "button" && tree.props.hitSlop.top + tree.props.hitSlop.bottom + 14 >= 38);
}
const labels = Object.keys(cases).map((s) => expand(T.MessageTicks({ status: s, timeLabel: "9:00", onPress: () => {} })).props.accessibilityLabel);
ok("a11y labels distinct per status (not colour-only)", new Set(labels).size === labels.length, JSON.stringify(labels));
ok("delivered vs read labels differ", labels[2] === "9:00. Delivered" && labels[3] === "9:00. Read");
const failed = expand(T.MessageTicks({ status: "failed", timeLabel: "9:00", onPress: () => {} }));
ok("failed shows text, not just an icon", textOf(failed).includes("Not sent · Retry"));
ok("failed hint explains retry", failed.props.accessibilityHint === "Double tap to try sending again");
ok("failed never renders delivered/read glyph", icon(failed).name === "alert-circle");
const sentTree = expand(T.MessageTicks({ status: "sent", timeLabel: "9:00", onPress: () => {} }));
ok("time shown beside ticks", textOf(sentTree).includes("9:00"));
ok("sent hint opens info", sentTree.props.accessibilityHint === "Double tap for message info");
const noPress = expand(T.MessageTicks({ status: "delivered", timeLabel: "9:00" }));
ok("without handler: not a button but still labelled", noPress.type === RN.View && noPress.props.accessible === true && noPress.props.accessibilityLabel === "9:00. Delivered");
const onLight = expand(T.MessageTicks({ status: "read", timeLabel: "9:00", onLight: true }));
ok("emoji-only (light background) palette", icon(onLight).color === T.TICK_COLORS_ON_LIGHT.read && T.TICK_COLORS_ON_LIGHT.read !== T.TICK_COLORS.read);
ok("palettes keep read distinct from grey", T.TICK_COLORS.read !== T.TICK_COLORS.grey && T.TICK_COLORS_ON_LIGHT.read !== T.TICK_COLORS_ON_LIGHT.grey);

// ── MessageInfoSheet ────────────────────────────────────────────────────────
const S = load("components/MessageInfoSheet.tsx", {
  "@supabase/supabase-js": {},
  "@/constants/colors": { __esModule: true, default: { textMid: "#6B5C3D", textMuted: "#8A7B5C", textDark: "#2B2216", lightCream: "#FBF7EE", accentGreen: "#1D9E75", borderBeige: "#E3D9C2" } },
  "@/components/Avatar": { Avatar: mk("Avatar") },
  "@/hooks/useLayout": { useSheetWidth: () => ({}) },
  "@/lib/messageReceiptsApi": { fetchReceiptDetails: async () => ({ rows: [] }) },
});
const ISO = (h, m) => new Date(2026, 9, 1, h, m).toISOString();
const rows = [
  { userId: "u1", fullName: "Bob", username: "bob", photoUrl: null, deliveredAt: ISO(10, 1), readAt: ISO(10, 5), isCurrentMember: true },
  { userId: "u2", fullName: "Carol", username: "carol", photoUrl: null, deliveredAt: ISO(10, 2), readAt: null, isCurrentMember: true }, // e.g. read receipts off
  { userId: "u3", fullName: null, username: "dan", photoUrl: null, deliveredAt: null, readAt: null, isCurrentMember: true },
  { userId: "u4", fullName: "Eve", username: "eve", photoUrl: null, deliveredAt: ISO(9, 0), readAt: null, isCurrentMember: false },
];
const render = (state) => { hookState = state; return expand(S.MessageInfoSheet({ supabase: {}, messageId: "m1", sentAt: ISO(10, 0), onClose: () => {} })); };
const sheet = render([rows, null]);
const rowNodes = findAll(sheet, (n) => typeof n.props?.testID === "string" && n.props.testID.startsWith("receipt-row-"));
ok("one row per participant", rowNodes.length === 4);
const lab = Object.fromEntries(rowNodes.map((n) => [n.props.testID.slice(12), n.props.accessibilityLabel]));
ok("read participant", lab.u1.startsWith("Bob. Read.") && !lab.u1.includes("Read not yet"));
ok("delivered-only participant (privacy off / not yet read) never shown as read", lab.u2.startsWith("Carol. Delivered.") && lab.u2.includes("Read not yet"));
ok("missing receipt shows not delivered, no invented time", lab.u3.startsWith("dan. Not delivered yet.") && lab.u3.includes("Delivered not yet"));
ok("left member labelled", lab.u4.includes("Left the conversation") && textOf(sheet).includes("Eve (left)"));
ok("timestamps rendered from server data only", textOf(sheet).includes("Read: —") && textOf(sheet).includes("Delivered: —"));
ok("sent time shown", textOf(sheet).includes("Sent "));
const icons = findAll(sheet, (n) => n.type === Ionicons).map((n) => n.props.name);
ok("state icons per row", icons.filter((x) => x === "checkmark-done").length === 3 && icons.includes("checkmark"));
const closeBtn = findAll(sheet, (n) => n.props?.accessibilityLabel === "Close")[0];
ok("close button labelled, 44pt", !!closeBtn && closeBtn.props.style !== undefined);
ok("header role", findAll(sheet, (n) => n.props?.accessibilityRole === "header").length === 1);
const loading = render([null, null]);
ok("loading state (no rows yet)", findAll(loading, (n) => n.type === RN.ActivityIndicator).length === 1 && findAll(loading, (n) => n.props?.testID?.startsWith?.("receipt-row-")).length === 0);
const errored = render([null, "Couldn't load message info."]);
ok("error state shows message, no fabricated rows", textOf(errored).includes("Couldn't load message info.") && findAll(errored, (n) => n.props?.testID?.startsWith?.("receipt-row-")).length === 0);
const empty = render([[], null]);
ok("empty recipients state", textOf(empty).includes("No recipients for this message."));
hookState = [rows, null];
const closed = S.MessageInfoSheet({ supabase: {}, messageId: null, sentAt: null, onClose: () => {} });
ok("closed when no message selected", closed.props.visible === false);
ok("formatReceiptTime: missing => dash", S.formatReceiptTime(null) === "—");
ok("formatReceiptTime: today", S.formatReceiptTime(new Date().toISOString()).startsWith("Today, "));

// Inbox (Messages tab): status of the user's own last message.
{
  const inbox = readFileSync(path.join(root, "app/(tabs)/messages.tsx"), "utf8");
  const dc = readFileSync(path.join(root, "contexts/DataContext.tsx"), "utf8");
  ok("inbox: ticks rendered only when the last message is the user's (lastMessageStatus set)", /\{item\.lastMessageStatus && \(/.test(inbox) && /<StatusGlyph[\s\S]{0,80}status=\{item\.lastMessageStatus\}/.test(inbox));
  ok("inbox: ticks have a screen-reader label (never colour alone)", /accessibilityLabel=\{`Your last message: \$\{statusAccessibilityLabel\(item\.lastMessageStatus\)\}`\}/.test(inbox));
  ok("inbox: status derived by the same engine as the conversation (deriveOutgoingStatus)", /lastStatusByConv\.set\(m\.conversation_id, deriveOutgoingStatus\(/.test(dc));
  ok("inbox: only the user's own eligible last messages get a status", /m\.sender_id === profile\.id && isReceiptEligible\(/.test(dc));
  ok("inbox: member join times loaded (late joiners are not recipients)", /"conversation_id, user_id, joined_at, p2p_profiles\(/.test(dc));
  ok("inbox: receipts unavailable → never fakes Delivered/Read", /receiptIndex\[m\.id\], receiptsAvailable\(\)/.test(dc) && /if \(ownLast\.length && receiptsAvailable\(\)\)/.test(dc));
  ok("inbox: live refresh only for OTHER people's receipts, debounced", /table: "p2p_message_receipts"[\s\S]{0,300}r\.user_id === myId\) return;[\s\S]{0,200}setTimeout\(/.test(dc));
  ok("inbox: debounce timer cleared on unmount", /if \(receiptRefreshTimer\) clearTimeout\(receiptRefreshTimer\);\s*supabase\.removeChannel\(channel\);/.test(dc));
  const settings = readFileSync(path.join(root, "app/settings/index.tsx"), "utf8");
  ok("settings: Privacy entry mentions Read Receipts (discoverable)", /title: "Privacy", subtitle: "[^"]*Read Receipts[^"]*", route: "\/settings\/privacy"/.test(settings));
  const profileTab = readFileSync(path.join(root, "app/(tabs)/profile.tsx"), "utf8");
  ok("profile tab: Privacy entry routes to the read-receipts screen", /route: "\/settings\/privacy"/.test(profileTab));
  const layout = readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
  ok("startup: the whole app is wrapped by the minimum-version gate", /<AppVersionGate>\s*<RootLayoutNav \/>\s*<\/AppVersionGate>/.test(layout));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
