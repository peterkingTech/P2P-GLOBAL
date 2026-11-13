// Screen safety (2026-11-12, after "Something went wrong" on the web): a screen that fails must never take
// down the whole app, and the Deep Study credit must render whatever shape it receives.
//   • Renders the Attribution component with the EXACT credit shape that crashed (no `origin`/`via`,
//     from an older server or saved copy), with nothing, and with a full credit — none may throw.
//   • Runs the screen error boundary: an error shows "This screen couldn't open" with Try again / Go back.
//   • Checks every Stack screen (PageFrame) and every main tab is wrapped, the app-wide boundary remains as
//     the last resort, and the Deep Study saved-copy format is versioned (old copies discarded).
// Harness as tests/buttonSystem.test.mjs (host components, no device needed).
// Run: node tests/screenSafety.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const React = require("react");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");

// ── Harness ──────────────────────────────────────────────────────────────
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), ActivityIndicator: host("ActivityIndicator"),
  StyleSheet: { create: (s) => s, hairlineWidth: 1 }, Platform: { OS: "ios", select: (o) => o.ios ?? o.default }, Linking: { openURL: async () => {} },
};
const colors = new Proxy({}, { get: () => "#000" });
const routerCalls = [];
const reactMock = { ...React, useState: (init) => [typeof init === "function" ? init() : init, () => {}], useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }) };
const mocks = {
  react: reactMock, "react-native": RN,
  "@expo/vector-icons": { Ionicons: Object.assign(host("Ionicons"), { glyphMap: {} }) },
  "react-i18next": { useTranslation: () => ({ t: (_k, o) => o?.defaultValue ?? _k }) },
  "@/contexts/ThemeContext": { useTheme: () => ({ colors }) },
  "@/components/ui": { AppButton: host("AppButton") },
  "@/components/ErrorFallback": { ErrorFallback: host("RootFallback") },
  // P2P Listen (native speech) isn't needed to render the credit.
  "@/lib/listen": { listen: { speakSnippet: async () => ({ result: "spoken" }) } },
  "expo-router": { useRouter: () => ({ canGoBack: () => true, back: () => routerCalls.push("back"), replace: (r) => routerCalls.push(`replace:${r}`) }) },
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console: { ...console, error: () => {} }, Math, JSON, Promise, Error, Array, Object, Number, String, Set, Map, __DEV__: false,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
  return mod.exports;
}
const load = (rel) => loadFile(path.join(root, rel));
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !node.type) return node;
  if (node.type === React.Fragment) return expand(node.props.children);
  if (typeof node.type === "function" && !node.type.__host && !node.type.prototype?.isReactComponent) return expand(node.type(node.props));
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
const textOf = (tree) => findAll(tree, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).flat(Infinity).filter((x) => typeof x === "string").join("")).join(" | ");
const render = (C, props) => expand(React.createElement(C, props));
const noThrow = (fn) => { try { return { ok: true, value: fn() }; } catch (e) { return { ok: false, error: e }; } };

// ── The Deep Study credit, in every shape ──────────────────────────────────
const { Attribution } = load("components/study/StudyUI.tsx");
const oldShape = { id: "stepbible-lexicon", name: "STEPBible", author: "x", attribution: "Translators Brief lexicons … CC BY 4.0.", licence: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  shareAlike: false, providerNotice: null, changes: "Re-formatted", note: null, source: "Free Use Bible API (AO Lab, bible.helloao.org)" };
let r = noThrow(() => render(Attribution, { credit: oldShape }));
ok("the credit shape that crashed (no origin/via) now renders", r.ok, r.error?.message);
ok("…and still shows the attribution and the licence link", r.ok && textOf(r.value).includes("CC BY 4.0") && textOf(r.value).includes("Translators Brief lexicons"));
const full = { ...oldShape, origin: { label: "STEP Bible", url: "https://www.STEPBible.org" }, via: { label: "Free Use Bible API (AO Lab)", url: "https://bible.helloao.org" }, licenceVerifiedOn: "2026-11-12" };
r = noThrow(() => render(Attribution, { credit: full }));
ok("the current credit renders with its source link (\"STEP Bible\")", r.ok && textOf(r.value).includes("STEP Bible"));
ok("no credit → nothing, no crash", noThrow(() => render(Attribution, { credit: null })).ok && noThrow(() => render(Attribution, { credit: undefined })).ok);
ok("a credit missing even its licence renders", noThrow(() => render(Attribution, { credit: { ...oldShape, licence: undefined } })).ok);
ok("a nonsense credit renders nothing instead of crashing", noThrow(() => render(Attribution, { credit: { foo: 1 } })).ok);

// ── The screen error boundary ─────────────────────────────────────────────
const { ScreenErrorBoundary } = load("components/ScreenErrorBoundary.tsx");
const { ErrorBoundary } = load("components/ErrorBoundary.tsx");
const el = React.createElement(ScreenErrorBoundary, { routeName: "deep-study/index", children: "content" });
const boundaryEl = el.type(el.props);                      // <ErrorBoundary FallbackComponent=ScreenFallback …>
const b = new ErrorBoundary(boundaryEl.props);
b.setState = (s) => { b.state = { ...b.state, ...s }; };   // not mounted in this harness
b.state = ErrorBoundary.getDerivedStateFromError(new TypeError("Cannot read properties of undefined (reading 'url')"));
const shown = expand(b.render());
ok("a screen error shows \"This screen couldn't open\"", textOf(shown).includes("This screen couldn't open") && textOf(shown).includes("Everything else in P2P Global still works"));
const buttons = findAll(shown, (n) => n.type?.name === "AppButton").map((n) => n.props.label);
ok("…with Try again and Go back", buttons.includes("Try again") && buttons.includes("Go back"), buttons.join());
const goBack = findAll(shown, (n) => n.props?.label === "Go back")[0];
goBack.props.onPress();
ok("Go back leaves the broken screen (and clears the error)", routerCalls.includes("back") && b.state.error === null);
ok("without an error the screen renders normally", b.render() === "content");
ok("the boundary's error logger runs without throwing", noThrow(() => boundaryEl.props.onError(new Error("x"), "stack")).ok);
ok("the error is logged with the screen's name", src("components/ScreenErrorBoundary.tsx").includes("[ScreenErrorBoundary] ${routeName}:"));

// ── Every screen and tab is wrapped ───────────────────────────────────────
const frame = src("components/PageFrame.tsx");
ok("every Stack screen is wrapped (framed AND full-bleed routes)", frame.includes("const guarded = <ScreenErrorBoundary routeName={routeName}>{children}</ScreenErrorBoundary>;")
  && frame.includes("if (isFullBleedRoute(routeName)) return guarded;") && frame.includes("{guarded}") && !frame.includes("return <>{children}</>"));
ok("PageFrame wraps every Stack screen (screenLayout)", src("app/_layout.tsx").includes("screenLayout={({ route, children }) => <PageFrame routeName={route.name}>{children}</PageFrame>}"));
for (const t of ["index", "learn", "bible", "messages", "more", "profile"]) {
  ok(`tab ${t}: its own error boundary`, new RegExp(`export default withScreenBoundary\\(\\w+, "tabs/${t}"\\);`).test(src(`app/(tabs)/${t}.tsx`)));
}
ok("the app-wide boundary remains as the last resort", src("app/_layout.tsx").includes("<ErrorBoundary") && src("app/_layout.tsx").includes("[ErrorBoundary] Uncaught render error:"));

// ── Saved copies can't come back in an old shape ─────────────────────────
const api = src("lib/deepStudyApi.ts");
ok("Deep Study saved-copy format is versioned (v3) and older copies are removed", /const SCHEMA = 3;/.test(api) && api.includes("clearOlderSchemas()") && api.includes("BUMP THIS whenever the server's response shape changes"));
ok("credit fields from the server are optional in the app's types (the compiler forces checks)", /origin\?: \{ label: string; url: string \}/.test(api) && /via\?: \{ label: string; url: string \}/.test(api));

console.log(`screenSafety (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
