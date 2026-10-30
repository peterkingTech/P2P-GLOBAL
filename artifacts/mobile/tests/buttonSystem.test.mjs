// Tests for the P2P Global button system (components/ui, lib/buttonTheme.ts,
// lib/pressGuard.ts) and Studio's Button/Pill wrappers:
//  1. Colours — every variant's label is readable (WCAG 4.5:1) on its own
//     surface, for EVERY app style in light AND dark; focus ring visible (3:1).
//  2. Sizes — 36 / 44 / 52; small still offers a 44-point tap target.
//  3. Press guard — no double submits while an action runs; sync actions free.
//  4. Components rendered to element trees (react-native mocked): roles,
//     labels, disabled / busy / selected / checked states, loading keeps the
//     width, double tap ignored, reduced motion turns the press-in off,
//     theme followed (light vs dark), fixed-light override for legacy screens.
//  5. Studio wrappers keep their props and map to the shared variants.
// Run: node tests/buttonSystem.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
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
const src = (p) => readFileSync(path.join(root, p), "utf8");

// ── Harness ──────────────────────────────────────────────────────────────
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), Pressable: host("Pressable"), ActivityIndicator: host("ActivityIndicator"),
  StyleSheet: { create: (s) => s }, Platform: { OS: "ios" },
  AccessibilityInfo: { isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }) },
};
const env = { mode: "light", reduceMotion: false, override: null };
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
const reactMock = {
  ...React,
  // useState: the reduce-motion hook's state follows env; everything else starts at its initial value.
  useState: (init) => [typeof init === "function" ? init() : init === false && env.inReduceMotion ? env.reduceMotion : init, () => {}],
  useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }), useContext: () => env.override,
  createContext: React.createContext,
};
let THEMES;
const mocks = {
  react: reactMock,
  "react-native": RN,
  "@expo/vector-icons": { Ionicons: Object.assign(host("Ionicons"), { glyphMap: {} }) },
  "@/contexts/ThemeContext": { useTheme: () => ({ colors: THEMES[env.mode], resolvedMode: env.mode }) },
  "@/hooks/useReduceMotion": { useReduceMotion: () => env.reduceMotion },
};
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, Promise, Error, Array, Object, Number, String, Set, Map,
    require: (n) => (n in mocks ? mocks[n] : loadFile(resolveFile(n, path.dirname(file)))) });
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
  if (pred(node)) out.push(node);
  findAll(node.props?.children, pred, out);
  return out;
}
const render = (C, props) => expand(React.createElement(C, props));
const flat = (st) => [].concat(st).flat(Infinity).filter(Boolean);
const styleAt = (n, state = { pressed: false }) => Object.assign({}, ...flat(typeof n.props.style === "function" ? n.props.style(state) : n.props.style));
const pressable = (tree) => findAll(tree, (n) => n.type === RN.Pressable)[0];
const textOf = (tree) => findAll(tree, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).join("")).join(" | ");

THEMES = load("constants/themes.ts").THEMES;
const BT = load("lib/buttonTheme.ts");
const { APP_STYLES, resolveAppStyleColors } = load("constants/appStyles.ts");

// ── 1. Colours: every app style, light and dark ──────────────────────────
const palettes = [];
for (const st of APP_STYLES) for (const mode of ["light", "dark"]) palettes.push({ name: `${st.id}/${mode}`, c: resolveAppStyleColors(st, mode), mode });
for (const name of Object.keys(THEMES)) palettes.push({ name: `theme:${name}`, c: THEMES[name], mode: name === "light" || name === "sepia" ? "light" : "dark" });
const lowContrast = [];
for (const p of palettes) {
  const t = BT.buttonTokens(p.c, p.mode);
  const checks = {
    primary: [t.variants.primary.fg, t.variants.primary.bg],
    secondary: [t.variants.secondary.fg, t.variants.secondary.bg],
    tertiary: [t.variants.tertiary.fg, t.surface],
    outline: [t.variants.outline.fg, t.surface],
    destructive: [t.variants.destructive.fg, t.variants.destructive.bg],
    chipSelected: [t.chip.selectedFg, t.chip.selectedBg],
    chip: [t.chip.fg, t.chip.bg],
    segmentSelected: [t.segment.selectedFg, t.segment.selectedBg],
  };
  for (const [k, [fg, bg]] of Object.entries(checks)) if (BT.contrast(fg, bg) < 4.5) lowContrast.push(`${p.name} ${k} ${BT.contrast(fg, bg).toFixed(2)}`);
  if (BT.contrast(t.focus, t.surface) < 3) lowContrast.push(`${p.name} focus ${BT.contrast(t.focus, t.surface).toFixed(2)}`);
}
ok(`colours: every label readable (4.5:1) and focus ring visible (3:1) in ${palettes.length} palettes (all app styles, light + dark)`, lowContrast.length === 0, lowContrast.slice(0, 12).join("; "));
const light = BT.buttonTokens(THEMES.light, "light"), dark = BT.buttonTokens(THEMES.dark, "dark");
ok("colours: primary is the theme's green (not gold); white text on the light theme's deep green", light.variants.primary.bg === THEMES.light.primaryGreen && light.variants.primary.fg === "#FFFFFF");
ok("colours: the dark theme's bright green takes dark text (white would be too faint)", dark.variants.primary.bg === THEMES.dark.primaryGreen && dark.variants.primary.fg !== "#FFFFFF" && BT.contrast("#FFFFFF", THEMES.dark.primaryGreen) < 4.5);
ok("colours: destructive is red and never the primary colour", light.variants.destructive.bg === "#B42318" && light.variants.destructive.bg !== light.variants.primary.bg && dark.variants.destructive.bg !== dark.variants.primary.bg);
ok("colours: pressed is a visibly different shade", light.variants.primary.pressedBg !== light.variants.primary.bg && dark.variants.secondary.pressedBg !== dark.variants.secondary.bg);
ok("colours: overlay icon buttons are the same dark scrim + white in every theme", light.icon.overlay.bg === dark.icon.overlay.bg && light.icon.overlay.fg === "#FFFFFF");
ok("colours: call controls — white on idle, dark on active, white on red end", BT.contrast(BT.CALL_TOKENS.end.fg, BT.CALL_TOKENS.end.bg) >= 3 && BT.contrast(BT.CALL_TOKENS.active.fg, BT.CALL_TOKENS.active.bg) >= 4.5);

// ── 2. Sizes ─────────────────────────────────────────────────────────────
ok("sizes: 36 / 44 / 52 with moderate radii (never pill-shaped)", BT.SIZES.sm.height === 36 && BT.SIZES.md.height === 44 && BT.SIZES.lg.height === 52 && Object.values(BT.SIZES).every((z) => z.radius <= 12));
ok("sizes: small gets 4 points of extra tap area each side (44 total); medium needs none", JSON.stringify(BT.hitSlopFor(36)) === JSON.stringify({ top: 4, bottom: 4, left: 4, right: 4 }) && BT.hitSlopFor(44) === undefined);

// ── 3. Press guard ───────────────────────────────────────────────────────
const { createPressGuard } = load("lib/pressGuard.ts");
{
  let n = 0; const g = createPressGuard();
  g.press(() => { n++; }); g.press(() => { n++; });
  ok("guard: quick actions (navigation, toggles) are never blocked", n === 2 && !g.running);
  let resolve; let calls = 0; const states = [];
  const g2 = createPressGuard((r) => states.push(r));
  const job = () => { calls++; return new Promise((r) => { resolve = r; }); };
  g2.press(job); g2.press(job); g2.press(job);
  ok("guard: a running save/send/join can't be sent twice", calls === 1 && g2.running);
  resolve(); await Promise.resolve(); await Promise.resolve();
  ok("guard: free again once it finishes", !g2.running && g2.press(job) && calls === 2);
  let reject; const g3 = createPressGuard();
  g3.press(() => new Promise((_r, j) => { reject = j; })); reject(new Error("offline")); await Promise.resolve(); await Promise.resolve();
  ok("guard: free again after a failure (no stuck button, no false success)", !g3.running);
  ok("guard: no handler → nothing happens", createPressGuard().press(undefined) === false);
}

// ── 4. Components ────────────────────────────────────────────────────────
const { AppButton, IconButton, Chip, FilterChip, SegmentedControl, CallControl } = load("components/ui/index.ts");
{
  let presses = 0;
  let tree = render(AppButton, { label: "Continue Learning", onPress: () => { presses++; } });
  let p = pressable(tree);
  ok("button: announced as a button with its label", p.props.accessibilityRole === "button" && p.props.accessibilityLabel === "Continue Learning" && textOf(tree) === "Continue Learning");
  p.props.onPress(); p.props.onPress();
  ok("button: presses run the same handler (behaviour unchanged)", presses === 2);
  ok("button: medium is 44 high, 12 radius, primary green", styleAt(p).minHeight === 44 && styleAt(p).borderRadius === 12 && styleAt(p).backgroundColor === light.variants.primary.bg);
  ok("button: pressed shade", styleAt(p, { pressed: true }).backgroundColor === light.variants.primary.pressedBg);
  ok("button: slight press-in when motion is allowed", JSON.stringify(styleAt(p, { pressed: true }).transform) === JSON.stringify([{ scale: 0.98 }]));
  env.reduceMotion = true;
  ok("button: no press-in with reduced motion", styleAt(pressable(render(AppButton, { label: "x", onPress() {} })), { pressed: true }).transform === undefined);
  env.reduceMotion = false;

  let ran = 0;
  tree = render(AppButton, { label: "Save", onPress: () => { ran++; }, disabled: true });
  p = pressable(tree); p.props.onPress();
  ok("disabled: announced, dimmed, does nothing", p.props.disabled === true && p.props.accessibilityState.disabled === true && styleAt(p).opacity === BT.DISABLED_OPACITY && ran === 0);

  tree = render(AppButton, { label: "Sending…", onPress() {}, loading: true });
  p = pressable(tree);
  const content = findAll(tree, (n) => n.type === RN.View && n.props.importantForAccessibility === "no-hide-descendants")[0];
  ok("loading: busy announced and presses ignored", p.props.accessibilityState.busy === true && p.props.disabled === true);
  ok("loading: the label stays in place (hidden) under the spinner, so the width never jumps", /Sending/.test(textOf(tree)) && flat(content.props.style).some((s) => s.opacity === 0) && findAll(tree, (n) => n.type === RN.ActivityIndicator).length === 1);

  let sent = 0;
  tree = render(AppButton, { label: "Submit", onPress: () => { sent++; return new Promise(() => {}); } });
  p = pressable(tree); p.props.onPress(); p.props.onPress(); p.props.onPress();
  ok("double tap: a submit that is still running is sent once", sent === 1);

  for (const v of ["primary", "secondary", "tertiary", "outline", "destructive"]) {
    const st = styleAt(pressable(render(AppButton, { label: v, onPress() {}, variant: v })));
    ok(`variant ${v}: its own colours`, st.backgroundColor === light.variants[v].bg && (v === "outline" ? st.borderColor === light.variants.outline.border : st.borderWidth === undefined));
  }
  const sm = pressable(render(AppButton, { label: "Edit", onPress() {}, size: "sm" }));
  ok("small: 36 visual, 44 to tap", styleAt(sm).minHeight === 36 && sm.props.hitSlop.top + sm.props.hitSlop.bottom + 36 === 44);
  ok("large: 52", styleAt(pressable(render(AppButton, { label: "Start", onPress() {}, size: "lg" }))).minHeight === 52);
  ok("icon: leading by default, trailing on request", (() => { const kids = findAll(render(AppButton, { label: "Next", onPress() {}, icon: "arrow-forward", iconPosition: "trailing" }), (n) => n.type === RN.View && n.props.importantForAccessibility)[0].props.children.filter(Boolean); return kids[kids.length - 1].type.name === "Ionicons"; })());

  env.mode = "dark";
  ok("theme: follows dark mode", styleAt(pressable(render(AppButton, { label: "x", onPress() {} }))).backgroundColor === dark.variants.primary.bg);
  env.override = { colors: THEMES.light, mode: "light" };
  ok("theme: a fixed-light screen keeps light buttons even in dark mode", styleAt(pressable(render(AppButton, { label: "x", onPress() {} }))).backgroundColor === light.variants.primary.bg);
  env.override = null; env.mode = "light";

  RN.Platform.OS = "web";
  const w = pressable(render(AppButton, { label: "x", onPress() {} }));
  ok("web: hover shade and a visible keyboard focus ring", styleAt(w, { pressed: false, hovered: true }).backgroundColor === light.variants.primary.hoverBg && styleAt(w, { pressed: false, focused: true }).outlineWidth === 2);
  RN.Platform.OS = "ios";
  ok("touch devices: no hover look", styleAt(pressable(render(AppButton, { label: "x", onPress() {} })), { pressed: false, hovered: true }).backgroundColor === light.variants.primary.bg);

  // Icon buttons
  const ib = pressable(render(IconButton, { icon: "search", accessibilityLabel: "Search", onPress() {} }));
  ok("icon button: labelled, 44 round, no extra tap area needed", ib.props.accessibilityLabel === "Search" && styleAt(ib).width === 44 && ib.props.hitSlop === undefined);
  const ibs = pressable(render(IconButton, { icon: "close", accessibilityLabel: "Close", size: "sm", onPress() {} }));
  ok("icon button small: 36 visual, 44 to tap", styleAt(ibs).width === 36 && ibs.props.hitSlop.top === 4);
  const ov = render(IconButton, { icon: "bookmark-outline", selectedIcon: "bookmark", selected: true, variant: "overlay", accessibilityLabel: "Saved", onPress() {} });
  ok("icon button: selected is announced and shown by a different glyph (not colour alone)", pressable(ov).props.accessibilityState.selected === true && findAll(ov, (n) => n.type?.name === "Ionicons")[0].props.name === "bookmark");
  ok("icon button overlay: dark scrim over artwork", styleAt(pressable(ov)).backgroundColor === light.icon.overlay.bg);
  ok("icon button: label is required by its type", /accessibilityLabel: string;/.test(src("components/ui/IconButton.tsx")));

  // Chips
  const multi = pressable(render(FilterChip, { label: "Kingdom Stories", selected: true, onPress() {} }));
  ok("filter chip (multi): a checkbox, checked, with a check mark", multi.props.accessibilityRole === "checkbox" && multi.props.accessibilityState.checked === true && multi.props["aria-checked"] === true);
  const single = render(FilterChip, { label: "All", selected: false, selection: "single", onPress() {} });
  ok("filter chip (single): a radio button, unchecked, no check mark", pressable(single).props.accessibilityRole === "radio" && pressable(single).props.accessibilityState.checked === false && !findAll(single, (n) => n.type?.name === "Ionicons" && n.props.name === "checkmark").length);
  ok("chips: the only pill shapes (radius = half height)", styleAt(multi).borderRadius === 18 && styleAt(multi).minHeight === 36);
  ok("chip: a small action announced as a button", pressable(render(Chip, { label: "Add", onPress() {} })).props.accessibilityRole === "button");

  // Segmented control
  let chosen = null;
  const seg = render(SegmentedControl, { options: [{ value: "a", label: "In progress" }, { value: "b", label: "Completed" }], value: "a", onChange: (v) => { chosen = v; }, accessibilityLabel: "Show" });
  const radios = findAll(seg, (n) => n.type === RN.Pressable);
  ok("segmented: a radio group, the chosen option checked", seg.props.accessibilityRole === "radiogroup" && radios[0].props.accessibilityState.checked === true && radios[1].props.accessibilityState.checked === false);
  radios[0].props.onPress(); const before = chosen; radios[1].props.onPress();
  ok("segmented: choosing the current option does nothing; another one changes it", before === null && chosen === "b");

  // Call controls
  let toggled = 0;
  const mute = render(CallControl, { icon: "mic", activeIcon: "mic-off", label: "Unmute", active: true, onPress: () => { toggled++; } });
  const mp = pressable(mute);
  ok("call: toggle state announced, shown by glyph and caption, not colour alone", mp.props.accessibilityState.selected === true && findAll(mute, (n) => n.type?.name === "Ionicons")[0].props.name === "mic-off" && /Unmute/.test(textOf(mute)));
  mp.props.onPress();
  ok("call: presses go straight to the existing call handler", toggled === 1);
  const end = pressable(render(CallControl, { icon: "call", label: "End call", kind: "end", onPress() {} }));
  ok("call: End is red and at least 44 to tap", styleAt(end).backgroundColor === BT.CALL_TOKENS.end.bg && styleAt(end).width >= 44 && end.props.accessibilityState.selected === undefined);
  ok("call: presentation only — no Agora or call code imported", !/agora|useAgora|callStart/i.test(src("components/ui/CallControl.tsx").replace(/\/\/.*$/gm, "")));
}

// ── 5. Studio wrappers ──────────────────────────────────────────────────
{
  const U = load("components/studio/StudioUI.tsx");
  const map = { primary: "primary", secondary: "outline", danger: "destructive" };
  for (const [tone, v] of Object.entries(map)) {
    env.override = null;
    const p = pressable(render(U.Button, { label: "Go", onPress() {}, tone }));
    ok(`studio button "${tone}" → ${v}, fixed light palette`, styleAt(p).backgroundColor === light.variants[v].bg);
  }
  const busy = pressable(render(U.Button, { label: "Publish", onPress() {}, busy: true }));
  ok("studio button: busy → loading (announced, no repeat presses)", busy.props.accessibilityState.busy === true && busy.props.disabled === true);
  const pill = pressable(render(U.Pill, { label: "Any", selected: true, onPress() {} }));
  ok("studio pill: one choice of a set (radio), selected reaches the browser", pill.props.accessibilityRole === "radio" && pill.props["aria-selected"] === true);
  ok("studio: wrappers keep the same props", /export function Button\(\{ label, onPress, icon, tone = "primary", disabled, busy, accessibilityHint \}/.test(src("components/studio/StudioUI.tsx")) && /export function Pill\(\{ label, selected, onPress, disabled \}/.test(src("components/studio/StudioUI.tsx")));
}

// ── 6. Scope ─────────────────────────────────────────────────────────────
ok("one system: the parts are exported together; no second button component in components/ui", existsSync(path.join(root, "components/ui/index.ts")) && !/export (default )?function \w*Button/.test(src("components/ui/Chip.tsx") + src("components/ui/SegmentedControl.tsx")));
ok("preview: only in development builds", /__DEV__/.test(src("app/design/buttons.tsx")));

// ── 7. App-wide migration audit (Phase 5) ───────────────────────────────
{
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".tsx") && !p.includes(`${path.sep}ui${path.sep}`)) files.push(p); } };
  walk(path.join(root, "app")); walk(path.join(root, "components"));
  const all = files.map((f) => ({ f: path.relative(root, f), s: readFileSync(f, "utf8") }));
  const count = (re) => all.reduce((n, x) => n + (x.s.match(re) ?? []).length, 0);
  ok("audit: the shared buttons are used across the app", count(/<AppButton\b/g) >= 600 && count(/<IconButton\b/g) >= 60, `${count(/<AppButton\b/g)} / ${count(/<IconButton\b/g)}`);
  const symbolLabels = all.flatMap((x) => (x.s.match(/<AppButton label=("[^"]*"|\{`[^`]*`\})/g) ?? []).filter((m) => /[\p{Extended_Pictographic}✓✗→←]/u.test(m)).map((m) => `${x.f}: ${m}`));
  ok("audit: no emoji or arrow characters used as button icons (real icons instead)", symbolLabels.length === 0, symbolLabels.join("; "));
  const badPalette = all.filter((x) => /palette="(?!fixedLight"|fixedDark"|theme")/.test(x.s)).map((x) => x.f);
  ok("audit: palettes are only theme / fixedLight / fixedDark", badPalette.length === 0, badPalette.join(", "));
  // Every remaining icon-only TouchableOpacity carries a spoken label.
  const unlabelled = [];
  for (const x of all) {
    const sf = ts.createSourceFile(x.f, x.s, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n) => {
      if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "TouchableOpacity") {
        const kids = n.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
        const has = (k) => n.openingElement.attributes.properties.some((a) => a.name?.getText() === k);
        if (kids.length === 1 && ts.isJsxSelfClosingElement(kids[0]) && kids[0].tagName.getText() === "Ionicons" && has("onPress") && !has("accessibilityLabel")) unlabelled.push(x.f);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  ok("audit: every icon-only tappable has a spoken label", unlabelled.length === 0, unlabelled.join(", "));
  // Documented exceptions: the two celebration pop-ups colour their main button with the celebrated category's colour.
  const CELEBRATION = new Set(["components/CategoryCompletionModal.tsx", "components/FruitCelebrationModal.tsx"].map((f) => f.split("/").join(path.sep)));
  const leftovers = all.filter((x) => !CELEBRATION.has(x.f)).filter((x) => /<TouchableOpacity\b[^>]*style=\{styles\.(primaryBtn|secondaryBtn|submitBtn|saveBtn)\}[^>]*>\s*<Text[^>]*>[^<{]*<\/Text>\s*<\/TouchableOpacity>/.test(x.s)).map((x) => x.f);
  ok("audit: no plain old-style Save/Submit/Primary/Secondary text buttons remain", leftovers.length === 0, leftovers.join(", "));
}

console.log(`buttonSystem: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
