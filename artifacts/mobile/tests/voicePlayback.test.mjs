// Tests for recorded voice-message playback: lib/voicePlayback.ts (the
// controller that drives the audio player) and components/VoiceMessageBubble.tsx
// (seek bar gestures, controls, accessibility). expo-audio is replaced by a FAKE
// player that records every call (seekTo, setPlaybackRate, play, pause) and
// emits status updates on demand — so these prove the controls drive the
// player, NOT how real audio sounds on a device (that needs device testing).
// Run: node tests/voicePlayback.test.mjs
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

// ── Fake expo-audio player ─────────────────────────────────────────────────
const players = [];
function fakePlayer(uri) {
  const p = {
    uri, calls: [], listener: null, shouldCorrectPitch: false, removed: false, rate: 1,
    play() { this.calls.push("play"); }, pause() { this.calls.push("pause"); },
    async seekTo(t) { this.calls.push(`seek:${t}`); },
    setPlaybackRate(r, q) { this.rate = r; this.calls.push(`rate:${r}:${q}:${this.shouldCorrectPitch}`); },
    remove() { this.removed = true; },
    addListener(_e, cb) { this.listener = cb; return { remove: () => { this.listener = null; } }; },
    emit(s) { this.listener?.({ isLoaded: true, currentTime: 0, duration: 40, playing: false, didJustFinish: false, isBuffering: false, error: null, ...s }); },
  };
  players.push(p);
  return p;
}

// ── Loader ─────────────────────────────────────────────────────────────────
let slots = [], slot = 0;
const reactMock = {
  ...React,
  useState: (init) => { const i = slot++; if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; },
  useMemo: (f) => { const i = slot++; if (!(i in slots)) slots[i] = f(); return slots[i]; },
  useRef: (v) => { const i = slot++; if (!(i in slots)) slots[i] = { current: v }; return slots[i]; },
  useEffect: () => {}, useCallback: (f) => f,
};
const host = (name) => { const f = ({ [name]: function () { return null; } })[name]; f.__host = true; return f; };
const RN = {
  View: host("View"), Text: host("Text"), TouchableOpacity: host("TouchableOpacity"), StyleSheet: { create: (s) => s },
  PanResponder: { create: (cfg) => ({ panHandlers: { __pan: cfg } }) },
};
const mocks = {
  react: reactMock, "react-native": RN, "@expo/vector-icons": { Ionicons: host("Ionicons") },
  "expo-audio": { createAudioPlayer: (src) => fakePlayer(src.uri) },
  "@/constants/colors": { default: { accentGreen: "#0b0", textMuted: "#777" }, __esModule: true },
};
const cache = new Map();
function resolveFile(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(root, spec.slice(2)) : path.resolve(fromDir, spec);
  for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return base + ext;
  throw new Error(`cannot resolve ${spec}`);
}
function loadFile(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, console, Math, JSON, String, Number, Array, Object, Set, Map, Promise, setTimeout, clearTimeout,
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
const textOf = (tree) => findAll(tree, (n) => n.type === RN.Text).map((t) => [].concat(t.props.children).flat(Infinity).filter((c) => typeof c === "string" || typeof c === "number").join("")).join(" | ");

const V = load("lib/voicePlayback.ts");

// Controller with a fake timer and a recorded state stream.
function make(o = {}) {
  V.__resetVoiceSession && o.reset !== false && V.__resetVoiceSession();
  const timers = [];
  const states = [];
  const c = V.createVoiceController({
    uri: o.uri ?? "https://cdn.example/a.m4a", initialDuration: o.duration ?? 40,
    createPlayer: (u) => fakePlayer(u), onChange: (s) => states.push(s),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimer: (t) => { t.cleared = true; },
  });
  return { c, states, timers, player: () => players.at(-1) };
}

// ── Helpers ────────────────────────────────────────────────────────────────
ok("speeds offered: 0.5 0.75 1 1.25 1.5 2", V.PLAYBACK_SPEEDS.join() === "0.5,0.75,1,1.25,1.5,2");
ok("speed cycle wraps: 2 → 0.5", V.nextSpeed(2) === 0.5 && V.nextSpeed(1) === 1.25);
ok("labels", V.speedLabel(1) === "1×" && V.speedLabel(1.5) === "1.5×" && V.speedLabel(0.75) === "0.75×" && V.speedLabel(2) === "2×");
ok("clock", V.formatClock(0) === "0:00" && V.formatClock(65.9) === "1:05" && V.formatClock(NaN) === "0:00");
ok("clamp within bounds", V.clampTime(-3, 40) === 0 && V.clampTime(55, 40) === 40 && V.clampTime(12, 40) === 12);
ok("touch position → time", V.timeAtX(50, 200, 40) === 10 && V.timeAtX(-10, 200, 40) === 0 && V.timeAtX(999, 200, 40) === 40 && V.timeAtX(10, 0, 40) === 0);

// ── Controller: play, seek, skip ───────────────────────────────────────────
{
  const { c, player } = make();
  c.toggle();
  const p = player();
  ok("play: creates the player lazily and waits for the file", p && c.state.phase === "loading" && !p.calls.includes("play"));
  p.emit({ currentTime: 0 });
  ok("play: starts once loaded", p.calls.includes("play"));
  p.emit({ playing: true, currentTime: 12 });
  ok("position follows the real player", c.state.phase === "playing" && c.state.position === 12 && c.state.duration === 40);
  c.seek(3);
  ok("seek BACKWARD calls the player's seekTo", p.calls.at(-1) === "seek:3" && c.state.position === 3);
  c.seek(30);
  ok("seek forward calls seekTo", p.calls.at(-1) === "seek:30");
  c.skip(-5);
  ok("back 5s", p.calls.at(-1) === "seek:25");
  c.skip(100);
  ok("forward clamps at the end", p.calls.at(-1) === "seek:40");
  c.seek(2); c.skip(-5);
  ok("back clamps at the start", p.calls.at(-1) === "seek:0");
  ok("seeking keeps it playing (no restart)", c.state.phase === "playing" && !p.calls.slice(2).includes("play"));
  c.toggle();
  ok("pause", p.calls.at(-1) === "pause" && c.state.phase === "paused");
  c.seek(20); c.toggle();
  ok("resume from the chosen position (no seek to 0)", p.calls.slice(-2).join() === "seek:20,play");
}
{
  const { c, player } = make();
  c.beginScrub(); c.previewScrub(18);
  ok("drag: the bar follows the finger", c.state.position === 18);
  c.endScrub(22);
  const p = player();
  ok("drag before the file loads: seek is applied once it loads", !p.calls.some((x) => x.startsWith("seek")) && c.state.position === 22 && c.state.phase === "paused");
  p.emit({ currentTime: 0 });
  ok("…then seekTo(22) runs, without auto-playing", p.calls.includes("seek:22") && !p.calls.includes("play"));
  c.toggle(); p.emit({ playing: true, currentTime: 22 });
  c.beginScrub(); p.emit({ playing: true, currentTime: 23 });
  ok("while dragging, player ticks don't yank the bar back", c.state.position === 22);
  c.previewScrub(5); c.endScrub(5);
  ok("release seeks the real player", p.calls.at(-1) === "seek:5");
}
{
  const { c, player } = make();
  c.toggle(); const p = player(); p.emit({}); p.emit({ playing: true, currentTime: 39 });
  p.emit({ didJustFinish: true, currentTime: 40 });
  ok("end: shows ended at full length", c.state.phase === "ended" && c.state.position === 40);
  c.toggle();
  ok("replay from the beginning", p.calls.slice(-2).join() === "seek:0,play" && c.state.position === 0);
  c.replay();
  ok("explicit replay seeks to 0 and plays", p.calls.slice(-2).join() === "seek:0,play");
}

{
  // Regression: a status that still carries the pre-seek time must not
  // yank the playhead back (found by the bubble test; fixed with seekingTo).
  const { c, player } = make();
  c.toggle(); const p = player(); p.emit({}); p.emit({ playing: true, currentTime: 30 });
  c.seek(8);
  p.emit({ playing: true, currentTime: 30 });
  ok("stale status right after a seek doesn't move the playhead back to the old time", c.state.position === 8);
  c.skip(-5);
  ok("…so a quick 'back 5s' starts from the new position", p.calls.at(-1) === "seek:3");
  await Promise.resolve(); await Promise.resolve();
  p.emit({ playing: true, currentTime: 3.4 });
  ok("once the seek completes, the real player's time is followed again", c.state.position === 3.4);
}

// ── Speed ─────────────────────────────────────────────────────────────────
{
  const { c, player } = make();
  c.toggle(); const p = player(); p.emit({}); p.emit({ playing: true, currentTime: 10 });
  const before = p.calls.length;
  for (const r of V.PLAYBACK_SPEEDS) {
    c.setRate(r);
    ok(`speed ${r}×: real player rate set with pitch correction`, p.rate === r && p.calls.at(-1) === `rate:${r}:high:true` && c.state.rate === r);
  }
  ok("changing speed never seeks, restarts or pauses", !p.calls.slice(before).some((x) => x.startsWith("seek") || x === "play" || x === "pause"));
  ok("position unchanged by speed changes", c.state.position === 10 && c.state.phase === "playing");
  c.resetRate();
  ok("one tap back to 1×", p.rate === 1 && c.state.rate === 1);
  c.cycleRate(); c.cycleRate();
  ok("cycle 1 → 1.25 → 1.5", c.state.rate === 1.5);
  c.setRate(3);
  ok("unsupported rate refused", c.state.rate === 1.5 && p.rate === 1.5);
}
{
  V.__resetVoiceSession();
  const a = make({ reset: false, uri: "a" });
  const b = make({ reset: false, uri: "b" });
  a.c.toggle(); const pa = players.at(-1); pa.emit({}); pa.emit({ playing: true });
  a.c.setRate(1.5);
  ok("speed is shared for the listening session", V.sessionRate() === 1.5);
  b.c.toggle(); const pb = players.at(-1);
  ok("next message starts at the session speed", pb.calls.includes("rate:1.5:high:true") && b.c.state.rate === 1.5);
  ok("starting another message pauses the first (no overlap)", pa.calls.at(-1) === "pause" && a.c.state.phase === "paused");
  b.c.dispose();
  ok("cleanup removes the player", pb.removed);
}

// ── Errors and interruptions ─────────────────────────────────────────────────
{
  const { c, timers, player } = make();
  c.toggle();
  timers[0].fn();
  ok("file never loads (deleted/offline): error state after the timeout", c.state.phase === "error");
  c.retry();
  ok("retry creates a fresh player", players.at(-1) !== undefined && c.state.phase === "loading");
  player().emit({ isLoaded: false, error: "404" });
  ok("player error → error state", c.state.phase === "error");
}
{
  const { c, player } = make({ duration: null });
  c.toggle(); const p = player(); p.emit({ duration: 33 }); p.emit({ playing: true, currentTime: 4, duration: 33 });
  ok("missing stored duration: the file's own duration is used", c.state.duration === 33);
  p.emit({ playing: false, currentTime: 4, duration: 33 });
  ok("system pause (call, headphones unplugged) shows paused, keeps position", c.state.phase === "paused" && c.state.position === 4);
  const m2 = make({ duration: 0 });
  ok("zero/invalid stored duration not shown as a real length", m2.c.state.duration === 0);
}

// ── Bubble component ─────────────────────────────────────────────────────────
{
  V.__resetVoiceSession();
  slots = [];
  const { VoiceMessageBubble } = load("components/VoiceMessageBubble.tsx");
  const render = () => { slot = 0; return expand(React.createElement(VoiceMessageBubble, { mediaUrl: "https://cdn.example/v.m4a", durationSeconds: 40 })); };
  let tree = render();
  ok("bubble (idle): play button, seek bar, total time", /0:40/.test(textOf(tree)) && findAll(tree, (n) => n.props?.accessibilityLabel === "Play voice message").length === 1);
  ok("bubble (idle): extra controls hidden until played", !findAll(tree, (n) => n.props?.accessibilityLabel === "Back 5 seconds").length);
  const seekArea = findAll(tree, (n) => n.props?.accessibilityRole === "adjustable")[0];
  ok("seek bar is adjustable for screen readers", !!seekArea && seekArea.props.accessibilityValue.text === "0:00 of 0:40");
  seekArea.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
  const pan = seekArea.props.__pan;
  pan.onPanResponderGrant({ nativeEvent: { locationX: 100 } });
  pan.onPanResponderMove({}, { dx: -50 });
  pan.onPanResponderRelease();
  const p = players.at(-1);
  p.emit({});
  ok("tap + drag on the bar seeks the real player (backward drag)", p.calls.includes("seek:10"), p.calls.join());
  slots[0] = { ...slots[0], phase: "playing", position: 10 };
  tree = render();
  ok("bubble (active): back/forward and speed controls", ["Back 5 seconds", "Forward 5 seconds"].every((l) => findAll(tree, (n) => n.props?.accessibilityLabel === l).length === 1)
    && findAll(tree, (n) => /^Playback speed 1×/.test(n.props?.accessibilityLabel ?? "")).length === 1);
  ok("bubble shows current / total", /0:10 \/ 0:40/.test(textOf(tree)));
  findAll(tree, (n) => n.props?.accessibilityLabel === "Back 5 seconds")[0].props.onPress();
  ok("back button seeks the player", p.calls.at(-1) === "seek:5");
  findAll(tree, (n) => /^Playback speed/.test(n.props?.accessibilityLabel ?? ""))[0].props.onPress();
  ok("speed button changes the player rate", p.rate === 1.25);
  slots[0] = { ...slots[0], rate: 1.25 };
  tree = render();
  const reset = findAll(tree, (n) => n.props?.accessibilityLabel === "Normal speed");
  ok("1× reset shown when not at normal speed", reset.length === 1);
  reset[0].props.onPress();
  ok("1× reset sets the player back to 1", p.rate === 1);
  ok("every control is labelled and at least 44pt", findAll(tree, (n) => n.type === RN.TouchableOpacity).every((b) => b.props.accessibilityLabel && b.props.accessibilityRole === "button"));
  slots[0] = { ...slots[0], phase: "error" };
  tree = render();
  ok("error state: message + retry", /unavailable/.test(textOf(tree)) && findAll(tree, (n) => n.props?.accessibilityLabel === "Try playing again").length === 1);
}

// ── Separation from live calls ───────────────────────────────────────────────
for (const f of ["lib/voicePlayback.ts", "components/VoiceMessageBubble.tsx"]) {
  const src = readFileSync(path.join(root, f), "utf8").replace(/\/\/.*$/gm, "");
  ok(`${f}: no Agora, no audio-mode/session changes (calls unaffected)`, !/agora|setAudioModeAsync|AudioModule|setIsAudioActiveAsync/i.test(src));
}
const chat = readFileSync(path.join(root, "app/messages/[id].tsx"), "utf8");
ok("chat still renders the bubble with the same props", /<VoiceMessageBubble/.test(chat) && /mediaUrl=/.test(chat));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
