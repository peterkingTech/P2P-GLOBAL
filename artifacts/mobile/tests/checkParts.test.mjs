// Comprehensive Checks split per question on screen (owner decision 2026-11-11): lib/checkParts.ts executed
// against the REAL Creation chapter 1 check text, plus source checks of the answer card.
// Run: node tests/checkParts.test.mjs
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
const load = (f) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (n) => { throw new Error(`require ${n}`); } });
  return mod.exports;
};
const C = load("lib/checkParts.ts");

// The real check (Creation, chapter 1) as stored: one question, five numbered questions.
const script = src("../api-server/narration/scripts/creation/en/chapter-1.txt");
const real = script.split("### check:").pop().split("\n").slice(1).join("\n").replace(/^\[[^\]]+\]\s*Question 1\.\s*/, "").replace(/\[[a-z ,]+\]\s*/g, "").trim();
const parts = C.splitCheckQuestion(real);
ok("real check: split into its 5 questions", parts?.length === 5, JSON.stringify(parts));
ok("real check: question text kept exactly (number removed)", parts?.[0] === "What words open the biblical creation account, and what do they tell us about the beginning of the world?"
  && parts?.[4].startsWith("What is the most important truth you have learned from this chapter"));

// Not numbered → kept whole (ordinary questions, single questions, instructions with a list).
ok("a single question stays whole", C.splitCheckQuestion("Explain what you learned.") === null);
ok("one numbered line stays whole", C.splitCheckQuestion("1. Only one question?") === null);
ok("numbers must run 1, 2, 3", C.splitCheckQuestion("1. A?\n3. C?") === null);
ok("long instructions before a list → kept whole", C.splitCheckQuestion(`${"Read the passage carefully and then write a paragraph about it. ".repeat(2)}\n1. A?\n2. B?`) === null);
ok("a question over two lines stays one question", JSON.stringify(C.splitCheckQuestion("1. First part\ncontinued here?\n2. Second?")) === JSON.stringify(["First part continued here?", "Second?"]));

// Combine → one answer for evaluation; split back for per-question display and sharing.
const answers = ["In the beginning God.", "Heavens and earth;\nformless and empty.", "God is first.", "Order comes next.", "Trust Him."];
const combined = C.combineAnswers(parts, answers);
ok("combined: each answer under its numbered question", combined.startsWith(`1. ${parts[0]}\nIn the beginning God.\n\n2. ${parts[1]}\nHeavens and earth;\nformless and empty.`));
ok("round trip: the same five answers come back", JSON.stringify(C.splitCombinedAnswer(combined, parts)) === JSON.stringify(answers));
ok("an earlier one-block answer is never split", C.splitCombinedAnswer("I think God made everything and it was good.", parts) === null && C.splitCombinedAnswer(null, parts) === null);
ok("an answer that quotes a number isn't confused", JSON.stringify(C.splitCombinedAnswer(C.combineAnswers(parts, ["See 2. above", "b", "c", "d", "e"]), parts)) === JSON.stringify(["See 2. above", "b", "c", "d", "e"]));

// Drafts: one saved draft holds all five answers.
ok("drafts: saved and restored", JSON.stringify(C.readPartDrafts(C.writePartDrafts(["a", "", "c", "", ""]), 5)) === JSON.stringify(["a", "", "c", "", ""]));
ok("drafts: nothing typed → empty draft (cleared)", C.writePartDrafts(["", " ", "", "", ""]) === "");
ok("drafts: an older single-box draft goes into question 1", JSON.stringify(C.readPartDrafts("my old draft", 3)) === JSON.stringify(["my old draft", "", ""]));

// ── The answer card ─────────────────────────────────────────────────────
const card = src("app/lesson/[id].tsx");
ok("card: only Comprehensive Checks are split (never reflections)", card.includes('const parts = kind === "assignment" ? splitCheckQuestion(question.question) : null;'));
ok("card: every question has its own 'Share your response' button + answer box", card.includes("{open ? t(\"lesson.hide\") : t(\"lesson.shareYourResponse\")}")
  && card.includes("value={partAnswers[i]} onChangeText={(v) => setPartAnswer(i, v)} accessibilityLabel={`Your answer to question ${i + 1}`}"));
ok("card: after submitting, every question shows its answer and its own 'Share Your Response'", card.includes("accessibilityLabel={`Share your response to question ${i + 1}`} onPress={() => shareOne(pq, answered)}"));
ok("card: submitted together as one answer (evaluation unchanged)", card.includes("text: answerText,") && card.includes("const answerText = parts ? combineAnswers(parts, partAnswers) : text.trim();"));
ok("card: all questions answered before submitting", card.includes("const canSend = (parts ? partsLeft === 0 :") && card.includes("still to answer."));
ok("card: earlier one-block answers keep one Share", card.includes("{!submittedParts && shareContext && shareableResponse(submitted.textContent) ? ("));
ok("card: revising starts from the earlier answers", card.includes("if (submittedParts && !partAnswers.some((a) => a.trim())) setText(writePartDrafts(submittedParts));"));

console.log(`checkParts (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
