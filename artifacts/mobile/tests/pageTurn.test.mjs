// Tests for the Kingdom Stories page-turn reader:
//  1. usePageTurn.turnFrame — the page enters from the side it was turned
//     from and settles exactly flat; Reduce Motion skips the animation.
//  2. Source checks on app/kingdom-stories/chapter.tsx — chapters change IN
//     PLACE (setParams, no router.replace remount, no story refetch per page),
//     chapter selector, progress bar, Return to Story, page dots, buttons-only
//     navigation (no swipe responder over the text), the animation never
//     gates navigation.
//  3. useReadingPosition — scrolls to the top for a new chapter and restores
//     a saved place even when storage answers after layout.
// Run: node tests/pageTurn.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
function load(rel, mocks) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => mocks[m], console, setTimeout, clearTimeout, Promise });
  return mod.exports;
}

// ── 1. page turn ─────────────────────────────────────────────────────────────
// Minimal hook runtime: one component, hooks by call order.
function hookRuntime() {
  const slots = []; let i = 0; const effects = [];
  const React = {
    useState: (init) => { const k = i++; if (!(k in slots)) slots[k] = typeof init === "function" ? init() : init; return [slots[k], (v) => { slots[k] = typeof v === "function" ? v(slots[k]) : v; }]; },
    useRef: (v) => { const k = i++; if (!(k in slots)) slots[k] = { current: v }; return slots[k]; },
    useCallback: (fn) => { i++; return fn; },
    useEffect: (fn) => { i++; effects.push(fn); },
  };
  return { React, render: (hook) => { i = 0; effects.length = 0; const out = hook(); effects.splice(0).forEach((fn) => fn()); return out; } };
}
const timings = [];
const value = () => ({ v: 1, setValue(x) { this.v = x; }, stopAnimation() {}, interpolate: (o) => o });
const RN = (reduced) => ({
  AccessibilityInfo: { isReduceMotionEnabled: () => Promise.resolve(reduced), addEventListener: () => ({ remove() {} }) },
  Animated: { Value: function (v) { return { ...value(), v }; }, timing: (val, cfg) => ({ start: () => { timings.push(cfg); val.v = cfg.toValue; } }) },
  Easing: { out: (f) => f, cubic: (t) => t },
});
{
  const rt = hookRuntime();
  const m = load("components/kingdom-stories/usePageTurn.ts", { react: rt.React, "react-native": RN(false) });
  const n0 = m.turnFrame("next", 0), n1 = m.turnFrame("next", 1), p0 = m.turnFrame("prev", 0);
  ok("turn: next enters from the right", n0.translateX > 0 && n0.rotateYDeg < 0);
  ok("turn: prev enters from the left", p0.translateX < 0 && p0.rotateYDeg > 0);
  ok("turn: settles flat and opaque", Math.abs(n1.translateX) === 0 && Math.abs(n1.rotateYDeg) === 0 && n1.opacity === 1 && n1.shade === 0);
  ok("turn: subtle (≤ 15°, page never invisible)", Math.abs(n0.rotateYDeg) <= 15 && n0.opacity >= 0.3);
  ok("turn: about a third of a second", m.TURN_MS >= 250 && m.TURN_MS <= 450);
  const h = rt.render(() => m.usePageTurn());
  h.turn("next");
  ok("turn: animates with the native driver", timings.length === 1 && timings[0].useNativeDriver === true);
  ok("turn: spine on the left going forward", rt.render(() => m.usePageTurn()).pageStyle.transformOrigin === "left center");
}
{
  const rt = hookRuntime();
  const m = load("components/kingdom-stories/usePageTurn.ts", { react: rt.React, "react-native": RN(true) });
  rt.render(() => m.usePageTurn());
  await new Promise((r) => setTimeout(r, 0));
  const h = rt.render(() => m.usePageTurn());
  const before = timings.length;
  h.turn("next");
  ok("reduce motion: no animation", h.reduced === true && timings.length === before);
}

// ── 2. reader source ─────────────────────────────────────────────────────────
const reader = src("app/kingdom-stories/chapter.tsx");
const goFn = reader.slice(reader.indexOf("const go = (target"), reader.indexOf("const toContents"));
ok("in place: setParams, not router.replace", goFn.includes("router.setParams") && !goFn.includes("router.replace"));
ok("in place: page turn starts before/independent of loading", goFn.includes("pageTurn.turn(") && !/await/.test(goFn));
ok("no story refetch per page: load doesn't depend on chapterId", /\}, \[id, lessonParam\]\);/.test(reader));
ok("locked chapters still refused", goFn.includes('target.learning?.state === "locked"'));
ok("chapter selector", reader.includes("setChaptersOpen(true)") && reader.includes("<Modal visible={chaptersOpen}"));
ok("current chapter title in header", reader.includes("s.headerChapter") && reader.includes("{ch.title}"));
ok("reading progress bar", reader.includes('accessibilityRole="progressbar"'));
ok("Return to Story", reader.includes("Return to Story"));
ok("page dots", reader.includes("s.dotHere"));
ok("previous / next buttons kept", reader.includes("Previous") && reader.includes("Next"));
ok("buttons only: no swipe/pan responders over the text", !/PanResponder|onSwipe|Gesture/.test(reader));
ok("shade never catches touches", reader.includes('pointerEvents="none" style={[StyleSheet.absoluteFill, s.shade'));
ok("answers refresh after submit without remount", (reader.match(/onSubmitted=\{reloadAll\}/g) ?? []).length === 2);
ok("bible reader untouched by story nav", !/usePageTurn/.test(src("app/bible/index.tsx")));

// ── 3. reading position ──────────────────────────────────────────────────────
{
  const rt = hookRuntime();
  let stored = { "kingdomStories:position:ch2": "900" };
  let resolveGet;
  const AsyncStorage = {
    getItem: (k) => new Promise((r) => { resolveGet = () => r(stored[k] ?? null); }),
    setItem: async (k, v) => { stored[k] = v; }, removeItem: async (k) => { delete stored[k]; },
  };
  const m = load("components/kingdom-stories/useReadingPosition.ts", { react: rt.React, "@react-native-async-storage/async-storage": { __esModule: true, default: AsyncStorage } });
  const scrolls = [];
  let pos = rt.render(() => m.useReadingPosition("ch1", true));
  pos.ref.current = { scrollTo: (o) => scrolls.push(o.y) };
  resolveGet(); await new Promise((r) => setTimeout(r, 0));
  // Turn to chapter 2: jumps to the top at once…
  pos = rt.render(() => m.useReadingPosition("ch2", true));
  ok("position: new chapter starts at the top", scrolls.at(-1) === 0, JSON.stringify(scrolls));
  // …the text lays out BEFORE storage answers, then storage answers.
  pos.onContentSizeChange(400, 3000);
  ok("position: waits for storage", scrolls.at(-1) === 0);
  resolveGet(); await new Promise((r) => setTimeout(r, 0));
  ok("position: saved place restored after late storage", scrolls.at(-1) === 900, JSON.stringify(scrolls));
}

console.log(`pageTurn: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
