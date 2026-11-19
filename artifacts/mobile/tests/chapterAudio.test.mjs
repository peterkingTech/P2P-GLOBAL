// Bible recordings (API.Bible audio editions: Igbo BIUO, BSB, WEB, IRV …) as P2P Listen narration — owner 2026-11-19:
// "the Igbo Bible … not playing … it says P2P only reads public translations". The recording is one file per chapter
// with no timings, so positions are ESTIMATED; they must use the same word form and time unit (1/100 s) as the
// matcher (lib/listen/narration alignChunks), or every sentence falls back to P2P Voice (which refuses these Bibles).
// The real modules, bundled with expo-audio stubbed. Run: node tests/chapterAudio.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ts = createRequire(path.join(root, "package.json"))("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const load = (f, mocks = {}) => {
  const js = ts.transpileModule(readFileSync(path.join(root, f), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Map, Set, Math, Number, JSON, setInterval, clearInterval, setTimeout, clearTimeout, require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};
const N = load("lib/listen/narration.ts", { "@/lib/kingdomStoriesApi": { getChapterNarration: async () => null } });
const A = load("lib/listen/chapterAudio.ts", { "expo-audio": { createAudioPlayer: () => ({ duration: 0, remove() {} }) }, "./narration": N });

// Igbo (made-up text; diacritics like ị ọ ụ), a Hindi line (non-Latin script), and an English line.
const igbo = ["Jizọs zara ya, sị: “N’ezie, n’ezie, ana m agwa gị.”", "Nikodemọs jụrụ ya: “Olee otu mmadụ ga-esi mụọ?”", "Chineke hụrụ ụwa n’anya nke ukwuu."];
const n = A.estimatedNarration("https://audio/x.mp3", "Reader", igbo, 30);
const seg = N.alignChunks(n, igbo);
ok("estimated recording lines up with every verse (no fallback to P2P Voice)", seg.every(Boolean), JSON.stringify(seg));
ok("times are in the matcher's unit: the chapter spans the recording's 30 s", Math.abs(seg[seg.length - 1].end - 30) < 0.01 && seg[0].start === 0, JSON.stringify(seg.at(-1)));
ok("verses follow each other without gaps", seg.every((s, i) => i === 0 || Math.abs(s.start - seg[i - 1].end) < 0.01));
const hindi = ["क्योंकि परमेश्वर ने जगत से ऐसा प्रेम रखा।", "उसने अपना एकलौता पुत्र दे दिया।"];
const hn = A.estimatedNarration("u", "r", hindi, 10);
ok("non-Latin scripts line up too (IRV Hindi, Bengali, Tamil, Telugu, Urdu recordings)", N.alignChunks(hn, hindi).every(Boolean));
ok("English story words keep their old form (Kingdom Stories narration unchanged)", N.normWord("Don’t") === "dont" && N.normWord("Jesus,") === "jesus" && N.normWord("café") === "cafe");

// A selection of verses (2-3 of 3): only its stretch of the chapter recording; the spoken heading is skipped silently.
const part = A.sliceNarration(n, igbo, (i) => i >= 1, ["John", "3:2-3"]);
const sources = ["John 3:2-3", ...igbo.slice(1)];
const ps = N.alignChunks(part, sources);
ok("verse selection: heading = zero-length (skipped), verses = their own stretch of the recording", ps.length === 3 && ps[0] && ps[0].end - ps[0].start < 0.01 && Math.abs(ps[1].start - seg[1].start) < 0.01 && Math.abs(ps[2].end - seg[2].end) < 0.01, JSON.stringify(ps));
ok("nothing to keep → no narration", A.sliceNarration(n, igbo, () => false) === null);

console.log(`chapterAudio (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
