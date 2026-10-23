// Kingdom Stories storybook (migration 212) and the product-wide
// "Comprehensive Check" wording.
//   Real module code (transpiled): Scripture references → P2P Bible targets
//   (shorthand, ranges, inline references), paragraphs, the story overview,
//   reading progress, locked-chapter wording, illustration placement, the
//   story-card line and checkTitle().
//   Source checks (rendering needs a device): the book and chapter screens,
//   reuse of the Core Curriculum answer card (drafts, peer review), private
//   reflections, server-withheld locked chapters, Bible navigation, images,
//   accessibility, and that learners/editors no longer see "Assignment".
// Run: node tests/kingdomStorybook.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (f) => readFileSync(path.join(root, f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);

function load(file, mocks) {
  const js = ts.transpileModule(src(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Promise, console, Map, Set, JSON, Number, String, Math, Array, Object, RegExp,
    require: (n) => { if (n in mocks) return mocks[n]; throw new Error(`unexpected require ${n} in ${file}`); } });
  return mod.exports;
}
const books = load("lib/bibleBooks.ts", {});
const bible = load("lib/bibleReaderApi.ts", {
  "react-native": { Platform: { select: (o) => o.ios } },
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://api.test/api" },
  "@/lib/bibleBooks": books,
});
const SB = load("lib/storybook.ts", { "@/lib/bibleReaderApi": bible });
const T = load("lib/terminology.ts", {});

// ── A. Scripture → P2P Bible targets ─────────────────────────────────────
const t = (line) => SB.scriptureLinks(line).map((l) => l.target && [l.target.book, l.target.chapter, l.target.v ?? null, l.target.ve ?? null]);
eq("chapter line with shorthand continues the book", t("Genesis 16; 21:8–21; Psalm 34:18"), [["GEN", 16, null, null], ["GEN", 21, 8, 21], ["PSA", 34, 18, 18]]);
eq("verse range", t("Joshua 2; Joshua 6:22–25"), [["JOS", 2, null, null], ["JOS", 6, 22, 25]]);
eq("a range into the next chapter opens at its first verse", t("Joshua 5:13–6:27"), [["JOS", 5, 13, 13]]);
eq("chapter ranges open at the first chapter", t("Exodus 1–4; Exodus 5–14"), [["EXO", 1, null, null], ["EXO", 5, null, null]]);
eq("numbered books", t("1 Corinthians 15:21–22, 45–49; 2 Peter 2:4–9"), [["1CO", 15, 21, 22], ["2PE", 2, 4, 9]]);
eq("labels keep the book on shorthand parts", SB.scriptureLinks("Genesis 17:15–21; 18:1–15").map((l) => l.label), ["Genesis 17:15–21", "Genesis 18:1–15"]);
ok("an unrecognised reference stays plain text (never guessed)", SB.scriptureLinks("The Didache 4:2")[0].target === null);
ok("empty line → no links", SB.scriptureLinks(null).length === 0 && SB.scriptureLinks("").length === 0);
const runs = SB.inlineScripture("Hebrews 11:31 highlights her faith, and James 2:25 points to her actions.");
eq("inline references found in narrative", runs.filter((r) => r.target).map((r) => r.text), ["Hebrews 11:31", "James 2:25"]);
ok("inline runs rebuild the paragraph exactly", runs.map((r) => r.text).join("") === "Hebrews 11:31 highlights her faith, and James 2:25 points to her actions.");
ok("'Chapter 3:2' is not a Bible reference", SB.inlineScripture("See Chapter 3:2 above.").every((r) => !r.target));
eq("inline verse range", SB.inlineScripture("Read Revelation 2:10–11 today.").filter((r) => r.target).map((r) => [r.target.book, r.target.chapter, r.target.v, r.target.ve]), [["REV", 2, 10, 11]]);
const route = bible.bibleRoute(SB.scriptureLinks("John 3:16")[0].target);
ok("Bible route carries no translation (the peer's own choice applies)", route.pathname === "/bible" && !("t" in route.params) && route.params.book === "JHN" && route.params.v === "16");

// ── B. Book text, progress, wording ─────────────────────────────────────
eq("paragraphs split on blank lines, trimmed", SB.paragraphs("One.\n\n  Two.\n\n\n\nThree.  "), ["One.", "Two.", "Three."]);
const intro = SB.storyIntro("Central theme: Courage.\n\nPrimary Scripture: Joshua 1–6\n\nSupporting Scripture: James 2:25\n\nThe story begins.");
ok("story overview separated from the introduction", intro.theme === "Courage." && intro.scripture.length === 2 && intro.paragraphs.join() === "The story begins.");
const ps = SB.progressSummary({ totalChapters: 7, completedChapters: 2, awaitingReviewChapters: 1, currentChapterId: "x", started: true, finished: false });
ok("progress counts submitted + completed, from real states", ps.done === 3 && ps.total === 7 && ps.label === "3 of 7 chapters finished" && Math.abs(ps.fraction - 3 / 7) < 1e-9);
ok("no progress invented for an unknown story", SB.progressSummary(undefined).total === 0 && SB.progressSummary(undefined).label === "");
const chs = [{ id: "a", chapterNumber: 1 }, { id: "b", chapterNumber: 2 }, { id: "c", chapterNumber: 3 }];
ok("locked chapter says what to finish (in words)", SB.lockedMessage(chs, "c") === "Complete Chapter 2 to open this chapter.");
eq("illustrations spread through the chapter", SB.illustrationSlots(8, 3), [2, 4]);
eq("one illustration: none inline (it opens the chapter)", SB.illustrationSlots(8, 1), []);
ok("illustration slots stay inside the text", SB.illustrationSlots(1, 4).every((x) => x === 0));
ok("story card line: start / continue / finished", SB.cardProgress({ totalChapters: 7, doneChapters: 0, started: false }) === "Start reading · 7 chapters"
  && SB.cardProgress({ totalChapters: 7, doneChapters: 2, started: true }) === "Continue reading · 2 of 7 chapters"
  && SB.cardProgress({ totalChapters: 7, doneChapters: 7, started: true }) === "Finished · 7 chapters" && SB.cardProgress(null) === null);
ok("every chapter state has words", ["locked", "available", "in_progress", "awaiting_review", "completed", "preview"].every((k) => typeof SB.STATE_LABEL[k] === "string" && SB.STATE_LABEL[k].length > 3));

// ── C. Terminology ───────────────────────────────────────────────────────
ok("checkTitle: generic stored titles read 'Comprehensive Check'", T.checkTitle("Assignment") === "Comprehensive Check" && T.checkTitle(null) === "Comprehensive Check" && T.checkTitle(" assignments ") === "Comprehensive Check");
ok("checkTitle: an author's own title is kept", T.checkTitle("Practise honesty in an agreement") === "Practise honesty in an agreement");
const en = JSON.parse(src("locales/en.json"));
ok("English strings say Comprehensive Check", en.lesson.assignment === "Comprehensive Check" && en.lesson.submitAssignment === "Submit Comprehensive Check" && /Comprehensive Check/.test(en.evaluations.nothingAwaitingSub) && en.admin.addAssignment === "Add Comprehensive Check");
ok("translation keys unchanged (no missing-key errors)", ["assignment", "requiresPeerEval", "assignmentNote", "submitAssignment"].every((k) => k in en.lesson));
const learnerFiles = ["app/lesson/[id].tsx", "app/evaluations.tsx", "app/my-discipleship/journey.tsx", "app/learning/assignment/[assignmentId].tsx", "app/learning/[scope]/[groupId].tsx",
  "app/church/call-summary.tsx", "app/church/member-profile.tsx", "components/study/LessonWork.tsx", "components/study/GatheringFollowUp.tsx", "lib/curriculumBlocks.ts",
  "components/admin/BlockRenderer.tsx", "lib/getStarted.ts", "components/kingdom-stories/ChaptersEditor.tsx", "app/kingdom-stories/chapter.tsx", "app/kingdom-stories/[id].tsx"];
const shown = /(?:>|"|`|')[^<>"`'{}]*\bAssignments?\b[^<>"`'{}]*(?:<|"|`|')/;
for (const f of learnerFiles) {
  const lines = src(f).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l) && shown.test(l) && !/"assignment"|assignmentId|assignment_|\/assignment|:assignment:|block_type|kind ===/.test(l));
  ok(`no 'Assignment' shown in ${f}`, lines.length === 0, lines.join(" | ").slice(0, 200));
}
ok("lesson screen shows stored titles through checkTitle", src("app/lesson/[id].tsx").includes("{checkTitle(assignment.title)}"));
ok("database names untouched (still p2p_assignments / kind=\"assignment\")", src("contexts/DataContext.tsx").includes('from("p2p_assignments")') && src("app/kingdom-stories/chapter.tsx").includes('kind="assignment"'));
const apiWork = readFileSync(path.join(repo, "artifacts/api-server/src/routes/lessonWork.ts"), "utf8");
ok("server messages and review notifications say Comprehensive Check", apiWork.includes('"Your Comprehensive Check was returned"') && apiWork.replace(/\/\/.*$/gm, "").split("\n").filter((l) => !/router\.(get|post|put|patch|delete)\("\//.test(l)) // route paths are internal names
    .every((l) => !/"[^"\n]*\b[Aa]ssignments?\b[^"\n]*"/.test(l)));

// ── D. Book + chapter screens ────────────────────────────────────────────
const book = src("app/kingdom-stories/[id].tsx");
const chapter = src("app/kingdom-stories/chapter.tsx");
const links = src("components/kingdom-stories/ScriptureLinks.tsx");
const img = src("components/kingdom-stories/StoryImage.tsx");
ok("book: cover, introduction, progress, Start/Continue Reading, contents, sources & credits",
  ["StoryImage media={cover}", "Introduction", "progressBox", "Start Reading", "Continue Reading", "Contents", "Sources & credits"].every((x) => book.includes(x)));
ok("book: chapter status in words (not colour/icon only) and locked reason", book.includes("STATE_LABEL[st]") && book.includes("lockedMessage(chapters, ch.id)") && book.includes("accessibilityLabel={`Chapter ${ch.chapterNumber}"));
ok("book: progress refreshed when returning from a chapter", book.includes("useFocusEffect"));
ok("book: chapter images stay with their chapter (not in the story gallery)", book.includes("media.filter((m) => !m.chapterId && m.id !== cover?.id)"));
ok("book: no Pray button", !book.includes(">Pray<") && !book.includes('"/(tabs)/prayer"'));
ok("chapter: illustrations inside the chapter, in order", chapter.includes("m.chapterId === ch.id") && chapter.includes("sort((a, b) => a.displayOrder - b.displayOrder)") && chapter.includes("illustrationSlots("));
ok("chapter: 'Lessons on This Chapter', Reflection, Comprehensive Check sections", ["Lessons on This Chapter", ">Reflection<", "{COMPREHENSIVE_CHECK}"].every((x) => chapter.includes(x)));
ok("chapter: answers use the Core Curriculum card (drafts, submit, peer-review state)", chapter.includes('from "@/app/lesson/[id]"') && chapter.includes('kind="reflection"') && chapter.includes("assignmentId={check.assignmentId}"));
ok("chapter: reflections are labelled private", chapter.includes("Private — only you can see your reflections"));
ok("chapter: peer review explained as peers, not AI", chapter.includes("feedback comes from peers, not from AI"));
ok("chapter: says what remains before the next chapter", chapter.includes("submit this chapter's Comprehensive Check") && chapter.includes("statusBox"));
ok("chapter: locked chapter shows no text, only the reason", chapter.includes('if (state === "locked")') && chapter.includes("lockedMessage(chapters, ch.id)"));
ok("chapter: previous / contents / next, next shows when locked", chapter.includes("Previous") && chapter.includes("Contents") && chapter.includes('next?.learning?.state === "locked" ? "lock-closed"'));
ok("chapter: adjustable text size with labels", chapter.includes('accessibilityLabel="Smaller text"') && chapter.includes('accessibilityLabel="Larger text"') && src("components/kingdom-stories/useReadingScale.ts").includes(".catch(() => {})"));
ok("chapter: evidence kinds kept apart", ["Documented history", "Testimony", "Tradition", "Disputed or uncertain"].every((x) => chapter.includes(x)));
ok("chapter: keyboard-safe answer boxes", chapter.includes("KeyboardAvoidingView") && chapter.includes('keyboardShouldPersistTaps="handled"'));
ok("Scripture: the existing P2P Bible via bibleRoute, pushed (Back returns to the chapter)", links.includes("router.push(bibleRoute(t)") && !links.includes("router.replace"));
ok("Scripture: links are labelled for screen readers", links.includes('accessibilityRole="link"') && links.includes("Opens in the P2P Bible"));
ok("images: accessibility description, loading + error states, cached by path", img.includes("accessibilityLabel={label}") && img.includes("ActivityIndicator") && img.includes("Image unavailable") && img.includes("cacheKey: media.mediaPath"));
ok("images: AI/artistic images labelled, never passed off as records", src("lib/kingdomStoriesApi.ts").includes("AI-generated illustration (not a historical record)") && img.includes("IMAGE_KIND_LABELS"));
ok("readers never get a locked chapter's text from the server", (() => {
  const r = readFileSync(path.join(repo, "artifacts/api-server/src/routes/kingdomStories.ts"), "utf8");
  return r.includes('learning.state === "locked" && !editor ? lockChapter(ch) : ch') && r.includes("chapterLearning(");
})());
ok("old single-page chapter component removed", (() => { try { src("components/kingdom-stories/StoryChapters.tsx"); return false; } catch { return true; } })());

// ── E. Follow-ups: drafts across devices, reviewer prompts, reading position, chapter notifications ──
const hooks = { useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }), useState: (v) => [v, () => {}] };
const D = load("lib/drafts.ts", { react: hooks, "react-native": { AppState: { addEventListener: () => ({ remove() {} }) } }, "@react-native-async-storage/async-storage": { default: {} } });
eq("draft key → private online (user, scope)", D.draftParts(D.draftKey("u-1", "lesson:L:reflection:Q")), { userId: "u-1", scope: "lesson:L:reflection:Q" });
ok("foreign keys are never synced", D.draftParts("something-else") === null);
ok("newer online copy wins", D.pickDraft({ text: "old", at: 1 }, { text: "new", at: 2 }).text === "new");
ok("newer device copy wins (and is pushed up)", D.pickDraft({ text: "mine", at: 5 }, { text: "older", at: 2 }).from === "device");
ok("an empty copy never replaces writing", D.pickDraft({ text: "kept", at: 1 }, { text: "  ", at: 9 }).text === "kept" && D.pickDraft({ text: "", at: 9 }, { text: "online", at: 1 }).text === "online");
const draftsSrc = src("lib/drafts.ts");
ok("drafts: device copy first, online best-effort, deleted on submit", draftsSrc.includes("saveDraft(key, latest.current") && draftsSrc.includes('from("p2p_answer_drafts")') && draftsSrc.includes("void removeOnline(key)") && /catch \{ \/\* offline/.test(draftsSrc));
ok("draft wording no longer says 'on this device' only", !src("app/lesson/[id].tsx").includes('"Draft saved on this device"') && src("app/lesson/[id].tsx").includes("continues on your other devices"));
const RP = load("components/ReviewPrompts.tsx", { react: { default: { createElement: () => null } }, "react-native": { StyleSheet: { create: (x) => x }, View: "View", Text: "Text", TouchableOpacity: "TouchableOpacity" }, "@/constants/colors": { default: {} } });
ok("reviewer prompts: encouraging questions, not grades", RP.REVIEW_PROMPTS.length === 4 && RP.REVIEW_PROMPTS.every((p) => !/score|grade|wrong|fail/i.test(p)));
ok("reviewer prompt added once, on its own line", RP.addPrompt("Good work.", RP.REVIEW_PROMPTS[0]) === `Good work.\n${RP.REVIEW_PROMPTS[0]} ` && RP.addPrompt(`x ${RP.REVIEW_PROMPTS[0]}`, RP.REVIEW_PROMPTS[0]) === `x ${RP.REVIEW_PROMPTS[0]}`);
ok("reviewer prompts on both review cards", (src("app/evaluations.tsx").match(/<ReviewPrompts feedback=\{feedback\} onChange=\{setFeedback\} \/>/g) ?? []).length === 2);
const pos = src("components/kingdom-stories/useReadingPosition.ts");
ok("reading position: saved per chapter, restored after layout, storage errors ignored", pos.includes("kingdomStories:position:") && pos.includes("onContentSizeChange") && pos.includes(".catch(() => {})") && chapter.includes("ref={position.ref} onScroll={position.onScroll}"));
const m213 = readFileSync(path.join(repo, "migrations/213_answer_drafts_and_chapter_notifications.sql"), "utf8");
ok("chapter notifications: chapter wording, same types, lessons unchanged", m213.includes("'Chapter submitted'") && m213.includes("'Chapter completed!'") && m213.includes("'Lesson submitted — your peer guide will review your answers.'") && m213.includes("'lesson_submitted'") && m213.includes("'lesson_completed'"));
ok("answer drafts: only the writer", m213.includes("using (user_id = auth.uid()) with check (user_id = auth.uid())") && m213.includes("revoke all on public.p2p_answer_drafts from anon"));

console.log(`\nkingdom storybook: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
