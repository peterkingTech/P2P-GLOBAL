// Full-screen / focus mode for Bible, Media and Workspace + persisted drafts.
//   lib/drafts.ts — run against a mocked AsyncStorage (real module code).
//   hooks/useFocusMode.ts, components/focus/FocusBar.tsx,
//   app/family/worship/[sessionId].tsx, components/family/ScripturePanel.tsx,
//   app/lesson/[id].tsx — source checks (rendering needs a device).
// The key guarantees: expanding never re-creates the media player or the
// passage view (same component, same place in the tree), never touches the
// Gathering's voice connection, and typed text is never lost.
// Run: node tests/focusMode.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// ── lib/drafts.ts against a mocked AsyncStorage ──────────────────────────
const store = new Map(); let failNext = false;
const AsyncStorage = {
  getItem: async (k) => { if (failNext) { failNext = false; throw new Error("io"); } return store.has(k) ? store.get(k) : null; },
  setItem: async (k, v) => { store.set(k, v); },
  removeItem: async (k) => { store.delete(k); },
  multiSet: async (pairs) => { for (const [k, v] of pairs) store.set(k, v); },
  multiRemove: async (keys) => { for (const k of keys) store.delete(k); },
};
const js = ts.transpileModule(src("lib/drafts.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout,
  require: (n) => n === "@react-native-async-storage/async-storage" ? { __esModule: true, default: AsyncStorage } : n === "react" ? { useCallback: (f) => f, useEffect() {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}] } : n === "react-native" ? { AppState: { addEventListener: () => ({ remove() {} }) } } : {} });
const D = mod.exports;
const k = D.draftKey("user-1", "lesson:L1:reflection:Q1");
ok("draft keys are per user + per question", k === "p2p:draft:v1:user-1:lesson:L1:reflection:Q1" && D.draftKey("user-2", "x") !== D.draftKey("user-1", "x"));
await D.saveDraft(k, "My answer so far");
ok("save + load round-trip", (await D.loadDraft(k)) === "My answer so far");
await D.saveDraft(k, "   ");
ok("blank text removes the draft (nothing stale left behind)", !store.has(k) && (await D.loadDraft(k)) === "");
await D.saveDraft(k, "again"); await D.clearDraft(k);
ok("clear removes it", !store.has(k));
failNext = true;
ok("storage failure → empty draft, never a crash", (await D.loadDraft(k)) === "");

const drafts = src("lib/drafts.ts");
ok("useDraft: saved shortly after typing, immediately on background and on leaving the screen", /SAVE_DELAY_MS = 400/.test(drafts)
  && drafts.includes('AppState.addEventListener("change", (s) => { if (s !== "active") { flush(); flushOnline(); } })') && drafts.includes("return () => { sub.remove(); flush(); flushOnline(); };"));
ok("useDraft: a slow load never overwrites what was already typed", drafts.includes("local.text && !typedBeforeLoad.current") && drafts.includes('best.from === "online" && !typedBeforeLoad.current'));
ok("drafts: device copy first (works offline); online copy is the writer's own and best-effort", drafts.includes("saveDraft(key, latest.current") && drafts.includes('from("p2p_answer_drafts")')
  && !drafts.includes("fetch(") && !drafts.includes("authedFetch") && drafts.includes("catch { /* offline"));

// ── Lesson answers ────────────────────────────────────────────────────────
const lesson = src("app/lesson/[id].tsx");
ok("lesson answer is a persisted draft keyed by user + lesson + kind + question", /useDraft\(profile\?\.id \? draftKey\(profile\.id, `lesson:\$\{lessonId\}:\$\{kind\}:\$\{question\.id\}`\) : null\)/.test(lesson));
ok("draft cleared only after a successful submit", /if \(err\) \{ setError\(err\); return; \}[\s\S]{0,400}setFocusWriting\(false\);\s*\n\s*await draft\.clear\(\);/.test(lesson));
ok("a restored draft re-opens the composer", /if \(draft\.restored && !submitted\) \{ setExpanded\(true\); setMode\("text"\); \}/.test(lesson));
ok("Expand opens a full-screen writing view bound to the same draft text", /accessibilityLabel="Expand writing to full screen"/.test(lesson)
  && /<Modal visible=\{focusWriting\}[\s\S]{0,200}presentationStyle="fullScreen"/.test(lesson) && (lesson.match(/value=\{text\}\s*\n\s*onChangeText=\{setText\}/g) ?? []).length >= 2);
ok("focus writing: Done restores; Android back closes it", /onRequestClose=\{\(\) => setFocusWriting\(false\)\}/.test(lesson) && /accessibilityLabel="Done, return to the lesson"/.test(lesson));
ok("shared with Study Together on calls (same QuestionResponseCard export)", /export function QuestionResponseCard\(/.test(lesson));

// ── useFocusMode ──────────────────────────────────────────────────────────
const hook = src("hooks/useFocusMode.ts");
ok("focus mode: Android back closes the focus view first", /BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{ exit\(\); return true; \}\)/.test(hook));
ok("focus mode: restores the previous scroll position on Done", /savedY\.current = offsetY\.current;/.test(hook) && /scrollRef\.current\?\.scrollTo\(\{ y, animated: false \}\)/.test(hook));
ok("focus mode: closes itself when the resource disappears (e.g. Guide changes mode)", /if \(focus && !available\.includes\(focus\)\) exit\(\);/.test(hook));
ok("focus mode: no calls/audio/navigation code", !/agora|useVoiceSpace|router\.|leaveChannel|Audio\./i.test(hook));

// ── Gathering ─────────────────────────────────────────────────────────────
const g = src("app/family/worship/[sessionId].tsx");
ok("Expand on Bible, Media and Study Workspace panels", /<ExpandButton label="Media" onPress=\{\(\) => focusMode\.enter\("media"\)\} \/>/.test(g)
  && /<ExpandButton label="Bible" onPress=\{\(\) => focusMode\.enter\("bible"\)\} \/>/.test(g) && /<ExpandButton label="Study Workspace" onPress=\{\(\) => focusMode\.enter\("workspace"\)\} \/>/.test(g));
ok("only the current mode's resource can be focused", /session\?\.currentMode === "worship" \? \["media"\]/.test(g) && /session\?\.currentMode === "scripture" \? \["bible"\]/.test(g) && /session\?\.currentMode === "teaching" \? \["workspace"\]/.test(g));
ok("one media player: SharedMedia still rendered exactly where it was (no second player, no Modal)", (g.match(/<SharedMedia \{\.\.\.sharedMediaProps\} \/>/g) ?? []).length === 2 && !/<Modal[^>]*>[\s\S]{0,300}<SharedMedia/.test(g));
ok("resources stay mounted: same ScrollView, siblings hidden in place", /\{modeContent\}\s*\n\s*\{focused \? null : companionsArea\}/.test(g) && /\{focused \? null : <ScrollView style=\{styles\.desktopCompanionsPane\}/.test(g));
ok("header kept mounted (hidden), FocusBar shown instead", /<View style=\{\[\{ paddingTop: insets\.top \+ 10 \}, focused && styles\.hidden\]\}>/.test(g) && /<FocusBar\s*\n\s*title=/.test(g));
ok("voice connection independent of focus (hook unconditional, not inside focus code)", /const voiceSpace = useVoiceSpace\(/.test(g) && !/focused[^\n]{0,80}useVoiceSpace/.test(g));
ok("compact live controls while expanded: mic + chat", /mic=\{\{ connected: voiceSpace\.phase === "connected", muted: voiceSpace\.micMuted, onToggle: voiceSpace\.toggleMic \}\}/.test(g) && /onOpenChat=\{\(\) => setChatOpen\(true\)\}/.test(g));
ok("Guide mode bar, reactions footer hidden while expanded", /\{isHost && !focused && <GuideControls/.test(g) && /\{!focused && <GatheringFooter/.test(g));
ok("expanded resource fills the space (safe-area aware)", /const focusMinHeight = Math\.max\(320, windowHeight - insets\.top - insets\.bottom - 84\);/.test(g) && /scrollFocused: \{ flexGrow: 1/.test(g));
ok("Bible text larger when expanded; passage / translation state untouched", /largeText=\{focused === "bible"\}/.test(g) && /passageTextLarge: \{ fontSize: 20, lineHeight: 32 \}/.test(src("components/family/ScripturePanel.tsx")));
ok("focus hook called before the loading return (hooks order stable)", g.indexOf("useFocusMode<FocusKey>(focusable)") < g.indexOf("if (loading || !session) {"));

const bar = src("components/focus/FocusBar.tsx");
ok("FocusBar: 44pt targets, labelled Done; only calls handlers it's given", /width: 44, height: 44/.test(bar) && /minHeight: 44/.test(bar) && /accessibilityLabel=\{`Done, close full screen \$\{title\}`\}/.test(bar) && !/agora|leave|endCall/i.test(bar));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
