// Tests for Group Members (Family Circles): lib/familyMembersModel.ts,
// components/family/FamilyMemberList.tsx, components/Avatar.tsx's photo
// fallback, and the members screen's wiring. Real files are transpiled with
// TypeScript and rendered to element trees with a tiny hooks stand-in
// (useState persists across re-renders; effects are not run). Synthetic data.
// Server-side authorization is covered by scripts/studio-db-test/family-members.mjs.
// Run: node tests/familyMembers.test.mjs
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

// ── Hooks stand-in: state survives re-renders (by call order) ──────────────
let slots = [], slot = 0;
const reactMock = {
  ...React,
  useState: (init) => {
    const i = slot++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
    return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }];
  },
  useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f(), useRef: (v) => ({ current: v }),
};
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"), Image: host("Image"),
  TextInput: host("TextInput"), ActivityIndicator: host("ActivityIndicator"), RefreshControl: host("RefreshControl"),
  StyleSheet: { create: (s) => s }, Platform: { OS: "ios" }, Alert: { alert: () => {} },
};
const colors = { primaryGreen: "#0a0", accentGreen: "#0b0", lightCream: "#fff", card: "#fff", borderBeige: "#ddd", textDark: "#111", textMid: "#333", textMuted: "#777" };
const mocks = {
  react: reactMock, "react-native": RN,
  "@expo/vector-icons": { Ionicons: host("Ionicons") },
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, String, Number, Array, Object, Set, Map, encodeURIComponent,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
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
const render = (Comp, props) => { slot = 0; return expand(React.createElement(Comp, props)); };

// ── Fixtures ───────────────────────────────────────────────────────────────
const m = (id, o = {}) => ({ id: `fm-${id}`, familyId: "f1", userId: `u-${id}`, role: "adult", status: "active", joinedAt: `2026-01-0${id}`, name: `Person ${id}`, avatarUrl: null, username: `user${id}`, ...o });
const M = load("lib/familyMembersModel.ts");
const { FamilyMemberList } = load("components/family/FamilyMemberList.tsx");
const { Avatar } = load("components/Avatar.tsx");

// ── Model ──────────────────────────────────────────────────────────────────
ok("roles: stored roles get labels", M.roleLabel("shepherd") === "Family Circle Shepherd" && M.roleLabel("co_shepherd") === "Co-Shepherd" && M.roleLabel("teen") === "Teen");
ok("roles: unknown role gets no invented title", M.roleLabel("pastor") === null && M.roleLabel(null) === null);
const sorted = M.sortMembers([m(3), m(1, { role: "child" }), m(2, { role: "shepherd" }), m(4, { role: "co_shepherd" })]).map((x) => x.role);
ok("order: shepherd, co-shepherd, then by role and join date", sorted.join() === "shepherd,co_shepherd,adult,child", sorted.join());
ok("search: by name or @username, case-insensitive", M.filterMembers([m(1, { name: "Grace Okafor" }), m(2)], "@GRACE").length === 1
  && M.filterMembers([m(1), m(2)], "zzz").length === 0 && M.filterMembers([m(1), m(2)], "  ").length === 2
  && M.filterMembers([m(1, { name: "Grace Okafor" }), m(2)], "grace").length === 1 && M.filterMembers([m(1), m(2, { username: "tim" })], "@tim").length === 1);
ok("search: only for longer lists", !M.showSearch(12) && M.showSearch(13));
ok("count wording", M.memberCountLabel(1) === "1 person" && M.memberCountLabel(5) === "5 people");
ok("profile path: public @username profile, encoded", M.memberProfilePath({ username: "grace" }) === "/profile/grace" && M.memberProfilePath({ username: "a b" }) === "/profile/a%20b");
ok("profile path: no username → not tappable", M.memberProfilePath({ username: null }) === null);
ok("remove: managers only, never self or the shepherd", M.canRemoveMember(m(1), "u-9", true) && !M.canRemoveMember(m(1), "u-1", true)
  && !M.canRemoveMember(m(1, { role: "shepherd" }), "u-9", true) && !M.canRemoveMember(m(1), "u-9", false));

// ── Avatar: real photo, fallback when it fails to load ─────────────────────
{
  slots = [];
  let tree = render(Avatar, { photoUrl: "https://cdn.example/p.jpg", name: "Grace" });
  const img = findAll(tree, (n) => n.type === RN.Image)[0];
  ok("avatar: shows the real photo", img?.props.source?.uri === "https://cdn.example/p.jpg");
  img.props.onError();
  tree = render(Avatar, { photoUrl: "https://cdn.example/p.jpg", name: "Grace" });
  ok("avatar: photo fails to load → initial, not a blank circle", findAll(tree, (n) => n.type === RN.Image).length === 0 && textOf(tree) === "G");
  slots = [];
  ok("avatar: no photo → initial", textOf(render(Avatar, { photoUrl: null, name: "daniel" })) === "D");
  ok("avatar: no name → '?'", textOf(render(Avatar, { photoUrl: null, name: null })) === "?");
}

// ── Member list ────────────────────────────────────────────────────────────
const base = { myId: "u-2", canManage: false, loading: false, error: null, query: "", onQueryChange: () => {}, onRemove: () => {}, onRetry: () => {} };
{
  const opened = [];
  const members = [m(1, { role: "shepherd", name: "Grace Shepherd", avatarUrl: "https://cdn.example/g.jpg" }), m(2, { name: "Daniel Adult" }), m(3, { name: "No Username", username: null, role: "child" })];
  slots = [];
  const tree = render(FamilyMemberList, { ...base, members, onOpenProfile: (p) => opened.push(p) });
  const text = textOf(tree);
  ok("list: accurate count header", /3 people/.test(text), text);
  ok("list: names, roles and (You) marker", /Grace Shepherd/.test(text) && /Family Circle Shepherd/.test(text) && /Daniel Adult \(You\)/.test(text) && /Child/.test(text));
  ok("list: real photo used where present", findAll(tree, (n) => n.type === RN.Image).some((i) => i.props.source.uri === "https://cdn.example/g.jpg"));
  const rows = findAll(tree, (n) => n.type === RN.TouchableOpacity && n.props.accessibilityHint === "Opens their profile");
  ok("list: members with a username are tappable; others are not", rows.length === 2, String(rows.length));
  rows.find((r) => /Grace/.test(r.props.accessibilityLabel)).props.onPress();
  ok("list: tap opens that member's profile", opened.join() === "/profile/user1", opened.join());
  ok("list: no remove buttons for a non-manager", findAll(tree, (n) => n.type === RN.TouchableOpacity && /^Remove /.test(n.props.accessibilityLabel ?? "")).length === 0);
  ok("list: no search box for a small family", findAll(tree, (n) => n.type === RN.TextInput).length === 0);
  ok("list: every button has a label", findAll(tree, (n) => n.type === RN.TouchableOpacity).every((b) => b.props.accessibilityLabel && b.props.accessibilityRole === "button"));
}
{
  const removed = [];
  slots = [];
  const tree = render(FamilyMemberList, { ...base, myId: "u-1", canManage: true, members: [m(1, { role: "shepherd" }), m(2), m(3, { role: "co_shepherd" })], onOpenProfile: () => {}, onRemove: (x) => removed.push(x.userId) });
  const rm = findAll(tree, (n) => n.type === RN.TouchableOpacity && /^Remove /.test(n.props.accessibilityLabel ?? ""));
  ok("manager: remove offered for others, not self or shepherd", rm.length === 2, rm.map((r) => r.props.accessibilityLabel).join());
  rm[0].props.onPress();
  ok("manager: remove passes the member to the screen's confirm flow", removed.length === 1);
}
{
  slots = [];
  ok("loading state", findAll(render(FamilyMemberList, { ...base, members: null, loading: true, onOpenProfile: () => {} }), (n) => n.type === RN.ActivityIndicator).length === 1);
  let retried = 0;
  const err = render(FamilyMemberList, { ...base, members: null, error: "You're not a member of this Family Gathering", onOpenProfile: () => {}, onRetry: () => retried++ });
  ok("error state: message shown inline", /not a member/.test(textOf(err)));
  findAll(err, (n) => n.type === RN.TouchableOpacity && n.props.accessibilityLabel === "Retry")[0].props.onPress();
  ok("error state: Retry reloads", retried === 1);
  ok("empty state", /No one is in this Family Circle yet/.test(textOf(render(FamilyMemberList, { ...base, members: [], onOpenProfile: () => {} }))));
  ok("refresh failure keeps the last list with a note", /Couldn't refresh/.test(textOf(render(FamilyMemberList, { ...base, members: [m(1)], error: "offline", onOpenProfile: () => {} }))));
  const many = Array.from({ length: 15 }, (_, i) => m(i + 1, { name: i === 4 ? "Zara Finder" : `Person ${i + 1}`, joinedAt: `2026-02-${String(i + 10).padStart(2, "0")}` }));
  const searched = render(FamilyMemberList, { ...base, members: many, query: "zara", onOpenProfile: () => {} });
  ok("large family: search box shown, count still the full roster", findAll(searched, (n) => n.type === RN.TextInput).length === 1 && /15 people/.test(textOf(searched)));
  ok("large family: search narrows the rows", findAll(searched, (n) => n.type === RN.TouchableOpacity && n.props.accessibilityHint === "Opens their profile").length === 1);
  ok("no match message", /No one matches/.test(textOf(render(FamilyMemberList, { ...base, members: many, query: "nobody", onOpenProfile: () => {} }))));
}

// ── Screen wiring (source checks) ──────────────────────────────────────────
const screen = readFileSync(path.join(root, "app/family/members.tsx"), "utf8");
ok("screen: roster only from GET /family/:familyId", /getFamilyDetail\(familyId\)/.test(screen) && !/supabase\.from\(/.test(screen));
ok("screen: load errors shown inline, not as a pop-up", /setError\(/.test(screen) && !/showAlert\("Couldn't load/.test(screen));
ok("screen: tap navigates to the computed profile path", /onOpenProfile=\{\(path\) => router\.push\(path as any\)\}/.test(screen));
ok("screen: invite and remove preserved", /inviteToFamily\(familyId/.test(screen) && /removeFamilyMember\(familyId, m\.userId\)/.test(screen));
const detail = readFileSync(path.join(root, "app/family/[familyId].tsx"), "utf8");
// Simplified hub (2026-10-18): People is a list row (accessibilityLabel={r.label}) and the header identity row.
ok("entry point: Family detail links to People", /pathname: "\/family\/members"/.test(detail) && /label: "People"[\s\S]{0,120}onPress: openPeople/.test(detail) && /accessibilityRole="button" accessibilityLabel=\{r\.label\}/.test(detail));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
