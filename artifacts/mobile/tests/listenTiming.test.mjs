// Listening time and progress, Spotify-style (owner request 2026-11-10): lib/listen/timing.ts executed,
// plus source checks of where it is shown (the player, playlists, the Library, Kingdom Stories).
// Run: node tests/listenTiming.test.mjs
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
const load = (f, mocks = {}) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Map, Set, Intl, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};

const TF = load("lib/timeFormat.ts");
const T = load("lib/listen/timing.ts", { "@/lib/timeFormat": TF });

// ── Formatting ───────────────────────────────────────────────────────────
ok("lengths like a music app: sec / min / hr min", T.listenTime(45) === "45 sec" && T.listenTime(24 * 60) === "24 min" && T.listenTime(107 * 60) === "1 hr 47 min" && T.listenTime(3600) === "1 hr" && T.listenTime(0) === "1 sec");
ok("the other duration styles are unchanged", TF.formatDuration(4980) === "1h 23m" && TF.formatDuration(2100, "words") === "35 min" && TF.formatDuration(252, "minSec") === "4m 12s");
ok("summary: '10 scriptures · about 20 min'", T.summaryLine(10, ["scripture", "scriptures"], T.secondsForVerses(120)) === "10 scriptures · about 20 min");
ok("summary: singular, and no time when there's nothing to play", T.summaryLine(1, ["chapter", "chapters"], 0) === "1 chapter" && T.summaryLine(6, ["chapter", "chapters"], 1440, true) === "6 chapters · 24 min");
ok("words: 155 a minute at normal speed, faster at 1.5×", T.secondsForWords(155) === 60 && T.secondsForWords(155, 1.5) === 40 && T.wordCount("In the beginning, God's word — 1 light.") === 7);

// ── Progress while playing ──────────────────────────────────────────────
const text = "In the beginning God created the heavens and the earth. And the earth was without form. And God said, let there be light.";
const chunks = [{ section: 0, part: 0, start: 0, end: 56 }, { section: 0, part: 0, start: 57, end: 89 }, { section: 0, part: 0, start: 90, end: text.length }];
const st = (chunk, status = "playing", extra = {}) => ({ status, chunk, chunks, rate: 1, content: { sections: [{ parts: [{ text }] }], ...extra } });
const words = [10, 6, 8], total = 24;
const t1 = T.playbackTiming(st(1));
ok("percentage by words read (10 of 24 → 42%)", t1.percent === Math.round((words[0] / total) * 100) && Math.abs(t1.fraction - 10 / 24) < 1e-9, JSON.stringify(t1));
ok("estimate for the phone's voice: total and remaining from the words", !t1.exact && Math.abs(t1.totalSeconds - T.secondsForWords(total)) < 1e-9 && Math.abs(t1.remainingSeconds - T.secondsForWords(14)) < 1e-9);
ok("start 0%, finished 100%", T.playbackTiming(st(0)).percent === 0 && T.playbackTiming(st(2, "completed")).percent === 100);
ok("progress line: '42% · about … left' / 'Finished'", T.progressLine(t1) === `42% · about ${T.listenTime(T.secondsForWords(14))} left` && T.progressLine(T.playbackTiming(st(2, "completed"))) === "100% · Finished" && T.progressLine(null) === "");
const rec = T.playbackTiming(st(1, "playing", { narration: { ends: [100, 200, 60000] } }));
ok("studio recording: its real length (600 s), no 'about'", rec.exact && rec.totalSeconds === 600 && !T.progressLine(rec).includes("about"));
ok("faster speed shortens the time left", T.playbackTiming({ ...st(1), rate: 1.5 }).remainingSeconds < t1.remainingSeconds);
ok("nothing loaded → nothing shown", T.playbackTiming({ ...st(0), content: null }) === null && T.playbackTiming({ ...st(0), chunks: [] }) === null);

// ── Where it is shown ───────────────────────────────────────────────────
const player = src("components/listen/ListenPlayer.tsx");
ok("player: a progress line on the inline AND floating bars", player.includes("<View style={floating ? s.floatTrack : s.barTrack}>"));
ok("player: mini bar says the percentage and time left", /\[statusLine\(st\), st\.status === "playing" \|\| st\.status === "paused" \? progressLine\(timing\) : ""\]\.filter\(Boolean\)\.join\(" · "\)/.test(player));
ok("player: full screen — percentage + time left, and the total", player.includes("<Text style={s.progressText}>{progressLine(timing)}</Text>") && player.includes("in all`"));
ok("player: progress bar reports percent to screen readers", player.includes("accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100), text: progressLine(timing) || undefined }}"));
ok("playlist screen: 'N scriptures · about N min'", src("app/scripture-collections/[id].tsx").includes('summaryLine(d.items.length, ["scripture", "scriptures"], secondsForVerses(verses))'));
ok("Library cards: scriptures + length (from the API's verse count)", (src("app/library/index.tsx").match(/summaryLine\(x\.itemCount, \["scripture", "scriptures"\], secondsForVerses\(x\.verseCount \?\? 0\)\)/g) ?? []).length === 2
  && src("../api-server/src/routes/scriptureCollections.ts").includes("verseCount: verses.get(c.id) ?? 0"));
const story = src("app/kingdom-stories/[id].tsx");
ok("Kingdom Stories: 'N chapters · about N min' and each chapter's length", story.includes('summaryLine(chapters.length, ["chapter", "chapters"], storySeconds)') && story.includes("about ${listenTime(chapterSeconds.get(ch.id)!)}"));

console.log(`listenTiming (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
