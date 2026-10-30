// Admin Recycle Bin — app side (migration 214's server/database behaviour is
// tested on PGlite in scripts/studio-db-test/recycle-bin*.mjs).
//   lib/recycleBinApi.ts — real code against a mocked server.
//   app/admin/recycle-bin.tsx — rendered with mocked data (synthetic only).
//   Delete buttons across the admin — source checks: no direct deletes of
//   Kingdom School content, every delete message points to the Recycle Bin.
// Run: node tests/recycleBin.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");

const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ScrollView: host("ScrollView"), TextInput: host("TextInput"),
  Modal: host("Modal"), ActivityIndicator: host("ActivityIndicator"), StyleSheet: { create: (s) => s }, useWindowDimensions: () => ({ width: 1200, height: 800 }),
  // The shared button system (components/ui) draws with Pressable.
  Pressable: host("Pressable"), Platform: { OS: "web" },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
};
const env = { query: null, pushes: [], fetch: null };
const mocks = {
  react: { ...React, useState: (init) => [typeof init === "function" ? init() : init, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }), useCallback: (f) => f, useMemo: (f) => f(), useContext: () => null },
  "react-native": RN,
  "@expo/vector-icons": { Ionicons: host("Ionicons") },
  "expo-router": { useRouter: () => ({ push: (p) => env.pushes.push(p) }), useFocusEffect: () => {} },
  "@/lib/apiClient": { apiFetch: (p, i) => env.fetch(p, i) },
  "@/components/studio/useStudioQuery": { useStudioQuery: () => env.query },
  "@/contexts/ThemeContext": { useTheme: () => ({ colors: loadFile(path.join(root, "constants/themes.ts")).THEMES.light, resolvedMode: "light" }) },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} }; cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Date, Math, JSON, Intl, Promise, Error, Object, Array, String, Number, encodeURIComponent,
    require: (n) => (n in mocks ? mocks[n] : n === "@/constants/colors" ? { default: new Proxy({}, { get: () => "#000" }) } : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (typeof node.type === "function" && !node.type.__host) return expand(node.type(node.props));
  const children = node.props?.children;
  return { ...node, props: { ...node.props, children: children === undefined ? undefined : expand(children) } };
}
function findAll(node, pred, out = []) {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, pred, out)); return out; }
  if (!node || typeof node !== "object") return out;
  if (node.type === RN.Modal && !node.props.visible) return out;
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const textOf = (t) => findAll(t, (n) => n.type === RN.Text).map((x) => [].concat(x.props.children).flat(Infinity).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");
const buttons = (t) => findAll(t, (n) => (n.type === RN.TouchableOpacity || n.type === RN.Pressable) && ["button", "radio", "checkbox"].includes(n.props.accessibilityRole));
const button = (t, label) => buttons(t).find((b) => b.props.accessibilityLabel === label);

// ── API client ──────────────────────────────────────────────────────────────
const Api = load("lib/recycleBinApi.ts");
const calls = [];
const respond = (status, body) => ({ ok: status < 300, status, json: async () => body });
env.fetch = async (p, init) => { calls.push({ p, init }); return env.next(p, init); };
env.next = () => respond(200, { items: [], total: 0 });
await Api.listRecycleBin({ status: "in_bin", type: "", q: "ruth & naomi", deletedBy: "", page: 1 });
ok("api: list query (empty filters omitted, values encoded)", calls.at(-1).p === "/admin/recycle-bin?status=in_bin&q=ruth%20%26%20naomi&page=1", calls.at(-1).p);
env.next = () => respond(201, { entryId: "e1" });
await Api.moveToBin("lesson", "L1");
ok("api: move sends type + id only (the server takes the actor from the token)", calls.at(-1).init.method === "POST" && JSON.stringify(JSON.parse(calls.at(-1).init.body)) === '{"type":"lesson","id":"L1"}');
env.next = () => respond(200, { removedFiles: 1, keptFiles: 0, fileErrors: 0 });
await Api.purgeEntry("e1", "PERMANENTLY DELETE");
ok("api: purge sends the typed confirmation", calls.at(-1).p === "/admin/recycle-bin/e1/purge" && JSON.parse(calls.at(-1).init.body).confirm === "PERMANENTLY DELETE");
env.next = () => respond(409, { error: "This story is live. Unpublish it first, then move it to the Recycle Bin.", code: "recycle_live_story" });
let e409; try { await Api.moveToBin("kingdom_story", "S1"); } catch (e) { e409 = e; }
ok("api: server message and code kept", e409?.code === "recycle_live_story" && /Unpublish it first/.test(e409.message) && e409.status === 409);
env.next = () => { throw new TypeError("Failed to fetch"); };
let eNet; try { await Api.restoreEntry("e1"); } catch (e) { eNet = e; }
ok("api: network failure explained", /Can't reach the server/.test(eNet?.message ?? ""));
ok("counts read naturally, the item first", Api.describeCounts({ p2p_lessons: 1, p2p_submissions: 12, p2p_lesson_evaluations: 1 }) === "1 lesson, 12 learner answers, 1 evaluation");
ok("delete message says where it goes and that it can be restored",
  /moved to the Recycle Bin with everything that belongs to it \(1 lesson, 2 learner answers\)\..*can be restored from Admin → Recycle Bin/.test(Api.moveToBinMessage("Lesson One", { title: "Lesson One", counts: { p2p_lessons: 1, p2p_submissions: 2 }, links: 0, files: 0, blocked: null })));
const routes = readFileSync(path.join(root, "../api-server/src/routes/recycleBin.ts"), "utf8");
ok("api: every client endpoint exists on the server", ['router.get("/"', 'router.get("/:id"', 'router.post("/preview"', 'router.post("/"', 'router.post("/:id/restore"', 'router.post("/:id/purge"'].every((r) => routes.includes(r)));

// ── Screen ──────────────────────────────────────────────────────────────────
const entry = (o = {}) => ({ id: "e1", contentType: "lesson", typeLabel: "Lesson", contentId: "L1", title: "Lesson One", parentLabel: "Module A", parentType: "module", parentId: "M1",
  originalStatus: "published", status: "in_bin", counts: { p2p_lessons: 1, p2p_submissions: 3 }, fileCount: 0, deletedBy: { id: "a", name: "Ada Admin" },
  deletedAt: "2026-10-20T10:00:00Z", restoredBy: null, restoredAt: null, restoreWarnings: [], purgedBy: null, purgedAt: null, ...o });
const listOf = (items, o = {}) => ({ data: { items, total: items.length, page: 0, pageSize: 20, types: [{ value: "lesson", label: "Lesson" }, { value: "kingdom_story", label: "Kingdom Story" }], deleters: [{ id: "a", name: "Ada Admin" }], canPurge: false, ...o },
  loading: false, error: null, reload: async () => {} });
const render = () => expand(React.createElement(load("app/admin/recycle-bin.tsx").default));
env.query = listOf([entry()]);
let tree = render();
ok("screen: item, type, original status, parent, who/when, what it includes", /Lesson One/.test(textOf(tree)) && /Was published/.test(textOf(tree)) && /In module: Module A/.test(textOf(tree))
  && /by Ada Admin/.test(textOf(tree)) && /Includes 1 lesson, 3 learner answers\./.test(textOf(tree)), textOf(tree));
ok("screen: Restore offered; permanent delete hidden for non-super-admins", !!button(tree, "Restore") && !button(tree, "Delete permanently"));
ok("screen: status tabs, type filters, deleter filter, search", ["In the bin", "Restored", "Permanently deleted", "All types", "Lesson", "Kingdom Story"].every((l) => !!button(tree, l)) && !!findAll(tree, (n) => n.type === RN.TextInput && /Search deleted/.test(n.props.accessibilityLabel ?? "")).length);
env.query = listOf([entry()], { canPurge: true });
ok("screen: super admin also sees Delete permanently", !!button(render(), "Delete permanently"));
env.query = listOf([]);
ok("screen: empty state explains the bin", /Nothing has been deleted/.test(textOf(render())));
env.query = listOf([], { types: [] });
ok("screen: a role without bin types is told so", /doesn't manage any content/.test(textOf(render())));
env.query = { data: null, loading: false, error: { message: "boom" }, reload: async () => {} };
ok("screen: error state with retry", !!button(render(), "Try again"));
const screenSrc = src("app/admin/recycle-bin.tsx");
ok("screen: permanent delete needs the typed confirmation; restore never publishes (said so)",
  /confirmText=\{pending\?\.action === "purge" \? PURGE_CONFIRMATION : undefined\}/.test(screenSrc) && /A restore never publishes anything\./.test(screenSrc));
const ui = src("components/studio/StudioUI.tsx");
ok("confirm dialog: typed text must match exactly before the button works", /\(!!c\.confirmText && note\.trim\(\) !== c\.confirmText\)/.test(ui));
ok("screen: dialog closes are covered by the tap guard", (screenSrc.match(/noteDialogClosed\(\)/g) ?? []).length >= 2);
ok("nav: Recycle Bin listed for admin roles", /label: "Recycle Bin", path: "\/admin\/recycle-bin"/.test(src("app/admin/_layout.tsx")));

// ── Delete buttons across the admin ─────────────────────────────────────────
const cur = src("app/admin/curriculum.tsx"), plans = src("components/admin/PlanCategoryManager.tsx"), blocks = src("components/admin/BlockEditorPanel.tsx");
ok("Kingdom School: no direct deletes of curricula/modules/lessons/blocks from the app",
  !/from\((table|"p2p_(curriculums|modules|lessons|lesson_blocks)")\)\.delete\(\)/.test(cur + plans + blocks));
ok("Kingdom School: module/curriculum/plan/block deletes go to the bin with a preview", /await previewMoveToBin\(type, id\)/.test(cur) && /await moveToBin\(type, id\)/.test(cur)
  && /previewMoveToBin\("curriculum", plan\.id\)/.test(plans) && /moveToBin\("lesson_block", blockId\)/.test(blocks));
const story = src("app/admin/kingdom-stories/[id].tsx"), chapters = src("components/kingdom-stories/ChaptersEditor.tsx");
ok("Kingdom Stories: delete messages point to the Recycle Bin (no 'cannot be undone')",
  /Move this story to the Recycle Bin\?/.test(story) && /Move this chapter to the Recycle Bin\?/.test(chapters) && !/cannot be undone/i.test(story + chapters));
// The shared confirm (lib/alerts) uses window.confirm on the web.
const alertsLib = readFileSync(path.join(root, "lib/alerts.ts"), "utf8");
ok("Kingdom Stories: story delete works on the web too (shared confirm → window.confirm)", /confirmAction\(title, message, doDelete, \{ confirmLabel: "Move to Recycle Bin", destructive: true \}\)/.test(story) && /if \(Platform\.OS === "web"\) \{\s*if \(window\.confirm\(/.test(alertsLib));

console.log(`recycle bin (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
