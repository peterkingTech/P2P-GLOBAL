// The Bible reader (app/bible/*, components/bible/*, lib/bibleReaderApi.ts,
// lib/bibleReadingPrefs.ts, lib/openScripture.ts) and its connections.
//   Real module code (transpiled, with React Native/Supabase mocked):
//     the canon, reference parsing, reader routes, highlight palette,
//     reading-preference clamping and the saved reading position.
//   Source checks (rendering needs a device): the Bible follows the P2P
//     theme (no Bible theme switch, colours from useTheme), no audio, copy
//     respects the translation licence, private study data stays private,
//     Gatherings stay mounted (push, never replace) and only the group's
//     passage is offered — never changed — and no new tab was added.
// Run: node tests/bibleReader.test.mjs
import { readFileSync, readdirSync } from "node:fs";
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

function load(file, mocks) {
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, setTimeout, clearTimeout, console, Map, Set, JSON, Number, String, Math, Array, Object,
    require: (n) => { if (n in mocks) return mocks[n]; if (n === "@/lib/apiClient") return load("lib/apiClient.ts", mocks); throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}

// ── lib/bibleReaderApi.ts ────────────────────────────────────────────────
const books = load("lib/bibleBooks.ts", {});
const B = load("lib/bibleReaderApi.ts", {
  "react-native": { Platform: { select: (o) => o.ios } },
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://api.test/api" },
  "@/lib/bibleBooks": books,
});
ok("canon: 66 books, 39 OT + 27 NT", B.CANON.length === 66 && B.CANON.filter((b) => b.testament === "OT").length === 39);
ok("canon: USFM codes line up with names", B.bookByCode("JHN").name === "John" && B.bookByCode("PSA").chapters === 150 && B.bookByCode("REV").name === "Revelation" && B.bookByCode("1CO").name === "1 Corinthians");
ok("canon: every book has a unique code", new Set(B.CANON.map((b) => b.code)).size === 66);
ok("bookByName: 'Psalm' → Psalms, '1 Corinthians', prefix 'Gen'", B.bookByName("Psalm")?.code === "PSA" && B.bookByName("1 Corinthians")?.code === "1CO" && B.bookByName("Gen")?.code === "GEN");
const rt = (s) => JSON.stringify(B.readerTarget(s));
ok("readerTarget: John 3:16-18", rt("John 3:16-18") === JSON.stringify({ book: "JHN", chapter: 3, v: 16, ve: 18 }));
ok("readerTarget: Psalm 23 (whole chapter)", rt("Psalm 23") === JSON.stringify({ book: "PSA", chapter: 23 }));
ok("readerTarget: 1Cor 13:4 and en dash ranges", B.readerTarget("1Cor 13:4")?.book === "1CO" && B.readerTarget("Romans 8:28–30")?.ve === 30);
ok("readerTarget: lesson label with translation suffix", B.readerTarget("John 3:16 (KJV)")?.v === 16);
ok("readerTarget: impossible chapter / unknown book → null", B.readerTarget("John 30") === null && B.readerTarget("Hezekiah 1:1") === null && B.readerTarget("") === null);
const r = B.bibleRoute({ book: "JHN", chapter: 3, v: 16, ve: 18, translation: "KJV" });
ok("bibleRoute → /bible with string params", r.pathname === "/bible" && r.params.book === "JHN" && r.params.chapter === "3" && r.params.v === "16" && r.params.ve === "18" && r.params.t === "KJV");
ok("bibleRoute without verse/translation omits them", !("v" in B.bibleRoute({ book: "GEN", chapter: 1 }).params) && !("t" in B.bibleRoute({ book: "GEN", chapter: 1 }).params));
ok("formatRef", B.formatRef(B.bookByCode("JHN"), 3, 16, 18) === "John 3:16–18" && B.formatRef(B.bookByCode("PSA"), 23) === "Psalms 23");
const light = B.highlightPalette("light"), dark = B.highlightPalette("dark");
ok("five bold solid fills (same in both themes, dark ink on top) plus an underline style", B.HIGHLIGHT_COLORS.length === 6
  && B.HIGHLIGHT_COLORS.filter((c) => c !== "underline").every((c) => /^#[0-9A-F]{6}$/i.test(light[c].wash) && light[c].wash === dark[c].wash && light[c].ink === "#111318")
  && light.underline.wash === "transparent" && light.underline.swatch !== dark.underline.swatch);
ok("stored highlight keys unchanged (saved highlights keep working)", B.HIGHLIGHT_COLORS.join() === "gold,green,blue,rose,violet,underline" && light.rose.label === "Red" && light.violet.label === "Purple");
const readerSrc = src("app/bible/index.tsx");
ok("reader: a fully highlighted verse is its own rounded colour card", /runs\.length === 1 && runs\[0\]\.color && runs\[0\]\.color !== "underline"/.test(readerSrc)
  && /\|\| !!card \|\| !!last\.card/.test(readerSrc) && /styles\.hlCard, \{ backgroundColor: card\.wash \}/.test(readerSrc) && /hlCard: \{ borderRadius: 10/.test(readerSrc));
ok("reader: note icon before the verse number", readerSrc.indexOf('name="document-text"') > 0 && readerSrc.indexOf('name="document-text"') < readerSrc.indexOf("styles.verseNum, {"));
ok("scripture face: platform serif, no new font dependency", B.SCRIPTURE_FONT === "Georgia");

// ── lib/bibleReadingPrefs.ts against a mocked AsyncStorage ──────────────
const store = new Map();
const P = load("lib/bibleReadingPrefs.ts", {
  react: { useCallback: (f) => f, useEffect() {}, useState: (v) => [v, () => {}] },
  "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } } },
});
ok("defaults: 19pt, comfortable, verse numbers, paragraphs", JSON.stringify(P.clampPrefs(null)) === JSON.stringify(P.DEFAULT_PREFS));
ok("font size is clamped 15–30", P.clampPrefs({ fontSize: 99 }).fontSize === 30 && P.clampPrefs({ fontSize: 2 }).fontSize === 15 && P.clampPrefs({ fontSize: "x" }).fontSize === 19);
ok("unknown values fall back", P.clampPrefs({ lineSpacing: "huge", layout: "grid", verseNumbers: "no" }).lineSpacing === "comfortable" && P.clampPrefs({ layout: "grid" }).layout === "paragraphs");
ok("verse numbers can be turned off", P.clampPrefs({ verseNumbers: false }).verseNumbers === false);
ok("no theme in reading prefs (the P2P theme decides light/dark)", !Object.keys(P.DEFAULT_PREFS).some((k) => /theme|dark|light|mode/i.test(k)));
P.savePosition({ translation: "KJV", book: "JHN", chapter: 3 });
await new Promise((r) => setTimeout(r, 0));
ok("reading position round-trips", JSON.stringify(await P.loadPosition()) === JSON.stringify({ translation: "KJV", book: "JHN", chapter: 3 }));
store.set("p2p.bible.position.v1", "{broken");
ok("a corrupt saved position is ignored", (await P.loadPosition()) === null);

// ── Source checks ────────────────────────────────────────────────────────
const bibleFiles = [...readdirSync(path.join(root, "app/bible")).map((f) => `app/bible/${f}`), ...readdirSync(path.join(root, "components/bible")).map((f) => `components/bible/${f}`)];
const all = bibleFiles.map((f) => [f, src(f)]);
ok("Bible screens/components exist", bibleFiles.length >= 8, bibleFiles.join(","));
for (const [f, s] of all) {
  ok(`${f}: colours come from useTheme`, /useTheme\(\)/.test(s));
  // Allowed fixed colours: white text on the accent, the shared destructive red, and scrim overlays.
  const hex = (s.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? []).filter((h) => !["#fff", "#FFF", "#DC2626", "#000"].includes(h));
  ok(`${f}: no hardcoded theme colours`, hex.length === 0, hex.join(","));
  ok(`${f}: no Bible light/dark switch`, !/setMode\(|Appearance\.|setColorScheme|darkMode/.test(s));
  ok(`${f}: no audio`, !/expo-av|expo-audio|expo-speech|Audio\.|playAudio|\baudio\b/i.test(s));
}
const reader = src("app/bible/index.tsx");
ok("reader: verse text is copied/shared only when the translation allows it", /textCopyAllowed \? `“\$\{selectedText\(\)\}” — \$\{selLabel\}` : selLabel/.test(reader));
ok("reader: stale chapter responses are dropped (request id + abort)", /id !== reqId\.current/.test(reader) && /new AbortController\(\)/.test(reader) && /ac\.abort\(\)/.test(reader));
ok("reader: focus mode is in-screen state (no navigation, no remount)", /setFocus\(true\)/.test(reader) && !/router\.(push|replace)\([^)]*focus/i.test(reader));
ok("reader: loading, error + retry, empty and offline states", /ActivityIndicator/.test(reader) && /Try again/.test(reader) && /No translations available/.test(reader) && /cloud-offline-outline/.test(reader));
ok("reader: shows the Gathering return bar and the group's passage, read-only", /<GatheringReturnBar/.test(reader) && /gathering\?\.sharedPassage/.test(reader) && !/setChurchCallScripture|updateWorshipState/.test(reader));
ok("reader: translation copyright shown", /data\.copyright/.test(reader));
ok("reader: study data degrades when unavailable (migration not applied)", /my\.available/.test(reader) && /coming soon/.test(reader));
ok("reader: 44pt touch targets for header icons", /iconBtn: \{ width: 44, height: 44/.test(reader));
const noteSheet = src("components/bible/BibleNoteSheet.tsx");
ok("notes say they're private", /Private — only you can see your notes/.test(noteSheet));
ok("library says it's private", /Only you can see your notes, highlights and saved passages/.test(src("app/bible/library.tsx")));
const prefsSheet = src("components/bible/ReadingPrefsSheet.tsx");
ok("reading settings point to the P2P appearance setting", /follow your P2P appearance setting/.test(prefsSheet));
const tp = src("components/bible/TranslationPicker.tsx");
ok("translation picker lists only what the server returns (no hardcoded translations)", !/"(NIV|ESV|NLT|NKJV)"/.test(tp));

const api = src("lib/bibleReaderApi.ts");
ok("client never holds an API.Bible key or calls API.Bible directly", !/api\.scripture\.api\.bible|api-key|API_BIBLE/i.test(api));
ok("client sends the user's session token (through the shared client)", /apiRequest<T>\(path, init/.test(api) && /Authorization: `Bearer \$\{token\}`/.test(src("lib/apiClient.ts")));

// Navigation + connections
const layout = src("app/_layout.tsx");
ok("Bible routes draw their own header", /"bible\/index", "bible\/search", "bible\/library"/.test(layout));
ok("no new bottom tab", !/bible/i.test(src("app/(tabs)/_layout.tsx")));
// The Learning Centre header carries the Bible shortcut; Bible Study (Explore Learning) opens the reader too.
ok("Learning opens Bible Study, which opens the Bible (one place, no repeated shortcut rows)", src("components/LearningHub.tsx").includes('route: "/bible-study"') && src("app/bible-study/index.tsx").includes('route: "/bible"')
  && !src("app/(tabs)/learn.tsx").includes('"/notes"') && !src("app/kingdom-school.tsx").includes('"/notes"') && !src("app/kingdom-school.tsx").includes('"/bible"'));
const lesson = src("app/lesson/[id].tsx");
ok("lesson Scripture opens in the P2P Bible (bible.com only as fallback)", /readerTarget\(s\.reference\)/.test(lesson) && /router\.push\(bibleRoute\(/.test(lesson) && /Read in Bible/.test(lesson));
for (const f of ["app/kingdom-wins/[id].tsx", "app/missions/story/[id].tsx", "app/prayer/gathering/[id].tsx", "app/prayer/journal.tsx", "app/prayer/testimony/[id].tsx", "components/study/CustomLessonViewer.tsx"])
  ok(`${f}: Scripture opens via openScripture`, /openScripture\(/.test(src(f)) && !/bible\.com/.test(src(f)));
const prayerCall = src("app/call/prayer.tsx");
ok("1:1 prayer call: Bible button opens the reader (no bible.com)", /openScripture\(scriptureRef\)/.test(prayerCall) && !/bible\.com/.test(prayerCall));
ok("1:1 prayer call: publishes the Return bar + its passage while in the call", /kind: "prayer", sharedPassage: passage/.test(prayerCall) && /clearActiveGathering\(`prayer:\$\{/.test(prayerCall));
ok("1:1 prayer call: join/leave/engine logic untouched (leave only from the button or a failure)", /onPress=\{\(\) => handleLeave\(\)\}/.test(prayerCall) && /if \(callState === "failed"\) void handleLeave\("failed"\)/.test(prayerCall));
ok("Return bar names the prayer call", /Prayer call in progress/.test(src("components/family/GatheringReturnBar.tsx")));
const link = src("components/bible/ReadInBibleLink.tsx");
ok("ReadInBibleLink renders nothing for unreadable references and can close a Modal first", /if \(!readerTarget\(reference\)\) return null/.test(link) && /beforeOpen\?\.\(\)/.test(link));
for (const f of ["app/prayer/study/[scriptureId].tsx", "app/prayer/pray-the-word/[slug].tsx", "app/prayer/paths/[slug].tsx", "app/fruit/[fruitKey].tsx", "app/living-tree.tsx", "components/study/StudyLessonTab.tsx", "components/study/StudyScriptureTab.tsx"])
  ok(`${f}: Read in Bible link`, /<ReadInBibleLink reference=/.test(src(f)));
ok("Prayer tab modal closes before opening the reader", /<ReadInBibleLink reference=\{activePrayer\?\.scripture_reference\}[^>]*beforeOpen=\{\(\) => setActivePrayer\(null\)\}/.test(src("app/(tabs)/prayer.tsx")));
const os = src("lib/openScripture.ts");
ok("openScripture pushes (keeps the current screen/call mounted)", /router\.push\(/.test(os) && !/router\.replace/.test(os));
const myBible = src("components/family/MyBibleSheet.tsx");
ok("My Bible → Full Bible pushes on top of the Gathering", /function openFullBible/.test(myBible) && /router\.push\(bibleRoute/.test(myBible) && !/router\.replace/.test(myBible));
const ag = src("lib/activeGathering.ts");
ok("ActiveGathering carries the shared passage (optional, additive)", /sharedPassage\?:/.test(ag));
ok("Family Gathering publishes its current Scripture", /kind: "family", sharedPassage: session\.currentScripture/.test(src("app/family/worship/[sessionId].tsx")));
ok("Church Gathering publishes its shared Scripture", /kind: "church", sharedPassage:/.test(src("app/call/church.tsx")));

// 1:1 audio/video calls: Return bar while reading the Bible from Study Together.
const pub = src("hooks/usePublishActiveCall.ts");
ok("usePublishActiveCall only mirrors state (no engine/leave calls) and clears itself", !/engine|leave|endCall|muteLocalAudioStream/i.test(pub.replace(/\/\*\*[\s\S]*?\*\//, "")) && /clearActiveGathering\(sessionId\)/.test(pub) && /kind: "call"/.test(pub));
for (const f of ["app/call/audio.tsx", "app/call/video.tsx"]) {
  const s = src(f);
  ok(`${f}: publishes while the call is live, using its own toggleMute`, /usePublishActiveCall\(\{\s*callKey: params\.callId \|\| params\.channelName,\s*live: callState === "connected" \|\| callState === "waiting_for_peer",\s*muted, toggleMute,\s*\}\)/.test(s));
}
ok("Return bar names a direct call", /"Call in progress"/.test(src("components/family/GatheringReturnBar.tsx")));

// Study Together Scripture reads the P2P Bible (licensed translations), not the old verse lookup.
const studyScripture = src("components/study/StudyScriptureTab.tsx");
ok("Study Together Scripture: P2P Bible reader, not bibleClient", /from "@\/lib\/bibleReaderApi"/.test(studyScripture) && /getChapter\(target\.book, target\.chapter, t\)/.test(studyScripture)
  && /getTranslations\(\)/.test(studyScripture) && !/bibleClient|lookupVerseForAdmin/.test(studyScripture));
ok("Study Together Scripture: shares the passage with its translation", /session\.shareScripture\(`\$\{result\.reference\} \(\$\{result\.translation\}\)`, result\.text\)/.test(studyScripture));
console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
