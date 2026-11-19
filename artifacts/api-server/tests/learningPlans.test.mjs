// Learning Plans, intelligent search, Study Deeper and AI governance (owner brief 2026-11-19) — the real modules,
// bundled, with a FAKE AI provider (nothing is sent anywhere, no credits). Run: node tests/learningPlans.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mobile = path.resolve(root, "../mobile");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-lp-"));
let M;
try {
  await build({ stdin: { contents: `export * as O from "./src/lib/planOrganiser"; export * as G from "./src/lib/aiGovernance"; export * as A from "./src/lib/planOrganiserAI"; export * as L from "./src/lib/bibleLicence"; export * as P from "./src/lib/studyPlans";`,
    resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "m.mjs"), loader: { ".txt": "text" }, logLevel: "silent", packages: "external" });
  M = await import(pathToFileURL(path.join(tmp, "m.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }
const { O, G, A, L, P } = M;

// ── Fixtures: what the Bible Study search returns, and a small discovery index ──
const F = (o) => ({ match: "direct", why: { code: "x" }, source: "Test", subtitle: null, ...o });
const findings = [
  F({ key: "article:lord", group: "definitions", kind: "reference_article", title: "Lord", ref: { id: "lord" } }),
  F({ key: "bible:PSA.110.1", group: "scriptures", kind: "bible_passage", title: "Psalms 110:1", subtitle: "The LORD said unto my Lord", ref: { book: "PSA", chapter: 110, startVerse: 1, endVerse: 1 } }),
  F({ key: "bible:1SA.15.32", group: "scriptures", kind: "bible_passage", title: "1 Samuel 15:32", subtitle: "Then said Samuel, Bring ye hither to me Agag", ref: { book: "1SA", chapter: 15, startVerse: 32, endVerse: 32 } }),
  F({ key: "bible:ROM.10.9", group: "scriptures", kind: "bible_passage", title: "Romans 10:9", subtitle: "confess with thy mouth the Lord Jesus", ref: { book: "ROM", chapter: 10, startVerse: 9, endVerse: 9 } }),
  F({ key: "cm:ROM10", group: "commentaries", kind: "commentary", title: "Romans 10", ref: { book: "ROM", chapter: 10 } }),
  F({ key: "ds:ROM10", group: "cross_references", kind: "deep_study", title: "Romans 10", ref: { book: "ROM", chapter: 10, startVerse: 9, endVerse: 9, tab: "cross" } }),
  F({ key: "word:kyrios", group: "greek_hebrew", kind: "dictionary_term", title: "kyrios", ref: { key: "kyrios" } }),
  F({ key: "story:x", group: "stories", kind: "kingdom_story", title: "David", ref: { id: "11111111-1111-4111-8111-111111111111", chapterId: "22222222-2222-4222-8222-222222222222" } }),
  F({ key: "note:1", group: "mine", kind: "note", title: "My private note", ref: { id: "n1" } }),
];
const span = (book, c1, v1, c2, v2) => ({ book, c1, v1, c2, v2 });
const ix = {
  lessons: [
    { id: "33333333-3333-4333-8333-333333333333", title: "Lordship", curriculumId: "c1", curriculumTitle: "Core Foundations", foundations: true, verses: [] },
    { id: "44444444-4444-4444-8444-444444444444", title: "Confessing Christ", curriculumId: "c2", curriculumTitle: "Kingdom School: Faith", foundations: false, verses: [{ span: span("ROM", 10, 9, 10, 10), display: "Romans 10:9-10" }] },
    { id: "55555555-5555-4555-8555-555555555555", title: "Fasting", curriculumId: "c2", curriculumTitle: "Kingdom School: Faith", foundations: false, verses: [{ span: span("MAT", 6, 16, 6, 18), display: "Matthew 6:16-18" }] },
  ],
  stories: [],
};
const names = [{ id: "kyrios", name: "Kyrios", primary: { display: "Philippians 2:11", book: "PHP", chapter: 2, start: 11, end: 11 } }, { id: "adonai", name: "Adonai", primary: { display: "Genesis 15:2", book: "GEN", chapter: 15, start: 2, end: 2 } }];
const j = O.organise({ question: "Lord", findings, ix, names, library: [{ id: "66666666-6666-4666-8666-666666666666", title: "Lord's Prayer playlist", subtitle: null }] });
const items = j.stages.flatMap((s) => s.items);

// ── 1–3. Search and organisation ──
ok("organises real findings into stages (no empty stages)", j.stages.length >= 4 && j.stages.every((s) => s.items.length > 0));
ok("covers several of the seven categories", ["bible", "core_foundations", "kingdom_school", "reference", "deep_study", "library", "kingdom_stories"].filter((c) => j.coverage[c] > 0).length >= 6, JSON.stringify(j.coverage));
ok("a one-word subject finds lessons by title ('Lord' → 'Lordship')", items.some((i) => i.title === "Lordship" && i.category === "core_foundations"));
ok("lessons are found by shared Scripture too (Romans 10:9 → 'Confessing Christ', Kingdom School)", items.some((i) => i.title === "Confessing Christ" && i.category === "kingdom_school"));
ok("unrelated lessons are not included ('Fasting')", !items.some((i) => i.title === "Fasting"));
ok("a fuzzy word hit that doesn't contain the word is dropped (Agag for 'Lord')", !items.some((i) => i.title === "1 Samuel 15:32"));
ok("biblical names lead the foundations (Kyrios, Adonai) as their verified verses", j.stages[0].key === "foundations" && j.stages[0].items[0].source.startsWith("P2P Biblical Names"));
ok("private notes are never part of a journey", !items.some((i) => i.title === "My private note"));
ok("the person's own playlist is the P2P Library category", items.some((i) => i.category === "library"));
ok("every item says why it was included and where it comes from", items.every((i) => i.why && i.source));
ok("deep study is one item per chapter (no duplicate Romans 10 studies)", items.filter((i) => i.resource.kind === "deep_study" && i.title === "Romans 10").length <= 1);
ok("reflection stage = real passage + P2P's study questions (an activity)", j.stages.at(-1).key === "application" && j.stages.at(-1).items[0].origin === "activity");
const ss = O.sessionsFrom(j);
ok("proposed sessions all pass the plan validator", ss.every((x) => P.validateSession({ title: x.title, intro: x.intro, passages: x.passages, primaryResource: x.primaryResource, supporting: x.supporting, questions: x.questions }).ok));
ok("the playlist is a valid plan resource (scripture_collection)", !!P.validateResource({ kind: "scripture_collection", id: "66666666-6666-4666-8666-666666666666" }));
const empty = O.organise({ question: "zzqx", findings: [], ix: { lessons: [], stories: [] } });
ok("nothing found → no invented resources, a clear note, gaps named", empty.stages.length === 0 && empty.note === "empty" && empty.gaps.length > 0);
const start = O.organise({ question: "Lord", findings, ix, start: { type: "kingdom_school", curriculumId: "c2" } });
ok("a starting point widens, never restricts (Bible and reference still there)", start.coverage.bible > 0 && start.coverage.reference > 0 && start.stages.flatMap((s) => s.items).some((i) => i.title === "Fasting"));

// ── Study Deeper ──
const done = new Set(items.map((i) => i.key));
const deeper = O.organise({ question: "Lord", findings, ix, names, exclude: done, depth: 1 });
ok("Study Deeper never repeats what was already studied", deeper.stages.flatMap((s) => s.items).every((i) => !done.has(i.key) || i.origin === "activity"));
ok("…and says so when nothing new remains (no artificial limit, no padding)", deeper.note === "nothing_new" || deeper.stages.flatMap((s) => s.items).length > 0);
const more = O.organise({ question: "Lord", findings: [...findings, F({ key: "bible:PHP.2.11", group: "scriptures", kind: "bible_passage", title: "Philippians 2:11", subtitle: "Jesus Christ is Lord", ref: { book: "PHP", chapter: 2, startVerse: 11, endVerse: 11 } }), F({ key: "cm:PHP2", group: "commentaries", kind: "commentary", title: "Philippians 2", ref: { book: "PHP", chapter: 2 } })], ix, exclude: done, depth: 2 });
ok("a further journey offers genuinely new material, led by deeper study", more.stages.flatMap((s) => s.items).some((i) => i.title === "Philippians 2") && more.depth === 2 && more.stages[0].key === "deeper");

// ── 5. Electives: signed, per person, only what the proposal offered ──
const tok = O.signElectives("user-1", ["33333333-3333-4333-8333-333333333333"]);
ok("electives token: read back by the same person", O.readElectives(tok, "user-1").includes("33333333-3333-4333-8333-333333333333"));
ok("electives token: another person can't use it", O.readElectives(tok, "user-2").length === 0);
ok("electives token: a forged token grants nothing", O.readElectives(tok.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "user-1").length === 0 && O.readElectives("x.y", "user-1").length === 0);
ok("electives token: expires", O.readElectives(tok, "user-1", Date.now() + 8 * 86400_000).length === 0);
const plansSrc = readFileSync(path.join(root, "src/routes/studyPlans.ts"), "utf8");
ok("server: organiser metadata (electives, lineage) is never taken from the client", plansSrc.includes("for (const k of ORGANISER_KEYS) delete ref[k];") && plansSrc.includes("ref.electives = [...new Set([...prevElectives, ...offered])].filter((id) => inPlan.has(id));"));
ok("server: Study Deeper requires the whole plan completed (organise and save)", plansSrc.includes('.eq("status", "completed")') && readFileSync(path.join(root, "src/routes/studyWorkspace.ts"), "utf8").includes("Study Deeper opens when you've completed this whole plan."));
const lessonSrc = readFileSync(path.join(mobile, "app/lesson/[id].tsx"), "utf8");
ok("app: Kingdom School's own lock state is unchanged; the plan exception asks the server for one lesson", lessonSrc.includes("let locked = state.lessonLocked.get(id) ?? false;") && lessonSrc.includes("const r = await electiveAccess(id); if (r?.allowed)"));

ok("an ordinary plan (deeperOf: null) is not treated as Study Deeper (regression 2026-11-19)", plansSrc.includes('if (org.deeperOf != null && org.deeperOf !== "" && ref.deeperOf === undefined)'));

// ── 11–17. Governance ──
const bad = [
  ["I am Jesus Christ, and I am with you.", "divine_identity"], ["God told me to tell you that you will be healed.", "divine_message"],
  ["Thus says the Lord: rise up.", "speaking_for_god"], ["I have received a revelation for you.", "revelation_claim"],
  ["Stop taking your medication and trust God.", "medical_directive"], ["God wants you to marry him this year.", "personal_divine_will"],
  ["This prayer was given by God.", "god_given_prayer"],
];
for (const [text, code] of bad) ok(`output review blocks: ${code}`, G.reviewOutput(text).violations.includes(code), JSON.stringify(G.reviewOutput(text)));
ok("output review allows faithful teaching with references", G.reviewOutput("Romans 10:9 says that whoever confesses Jesus as Lord and believes will be saved. Christian traditions read Romans 9:5 differently.").ok);
ok("output review allows recommending professional help", G.reviewOutput("Please keep following your doctor's advice; Scripture also encourages us to seek wise counsel (Proverbs 15:22).").ok);
ok("every AI task gets the shared framework first", G.governedSystemPrompt("plan_organiser", "TASK").startsWith("You are a supporting tool inside P2P Global") && G.governedSystemPrompt("plan_organiser", "TASK").includes("TASK"));
let thrown = null; try { G.governedSystemPrompt("chat_summary", "x"); } catch (e) { thrown = e; }
ok("unapproved AI tasks are refused (e.g. chat summaries)", thrown?.code === "task_not_approved");
ok("conversations are listed as never-AI areas", ["private_chats", "group_chats", "family_conversations", "church_conversations", "community_conversations", "study_together_conversations", "p2p_mail"].every((x) => G.NEVER_AI.includes(x)));
thrown = null; try { G.assertNoPrivateData({ items: [{ title: "x", notes: "secret" }] }); } catch (e) { thrown = e; }
ok("private data can't be sent to an AI provider", thrown?.code === "private_data");
ok("licence: public-domain text may be sent", G.aiAllowedFor({ translation_code: "KJV", provider: null, license_notes: "Public domain — no restrictions" }, "send_to_provider"));
ok("licence: copyrighted / open-licence text is references only", !G.aiAllowedFor({ translation_code: "AMP", provider: null, license_notes: "Amplified® Bible Copyright © 2015" }, "send_to_provider") && !G.aiAllowedFor({ translation_code: "AO-eng_lsv", provider: "helloao", licence_status: "approved", licence_name: "CC BY-SA 4.0" }, "ai_analysis"));
ok("licence: never model training", !G.aiAllowedFor({ translation_code: "KJV", provider: null, license_notes: "Public domain" }, "model_training"));
ok("licence: scriptureForAI drops restricted text, keeps the reference", G.scriptureForAI("John 3:16", "For God so loved", { translation_code: "AMP", provider: null, license_notes: "Copyright" }).text === null);
const srcFiles = (dir) => readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? srcFiles(p) : [p]; });
const aiCallers = srcFiles(path.join(root, "src")).filter((f) => f.endsWith(".ts") && /messages\.create\(|new Anthropic\(/.test(readFileSync(f, "utf8"))).map((f) => path.basename(f)).sort();
ok("only approved features call an AI provider (none in messaging)", JSON.stringify(aiCallers) === JSON.stringify(["planOrganiserAI.ts", "translationEngine.ts", "winsTranslation.ts"]), JSON.stringify(aiCallers));
ok("each AI caller uses the governance framework", aiCallers.every((f) => readFileSync(srcFiles(path.join(root, "src")).find((x) => path.basename(x) === f), "utf8").includes("governedSystemPrompt(")));
// (Image credits and the admin photo check legitimately say "AI-generated"; search and journeys must not label.)
const appSrc = [...srcFiles(path.join(mobile, "app/plans")), ...srcFiles(path.join(mobile, "app/study")), ...srcFiles(path.join(mobile, "components/plans")), path.join(mobile, "lib/planOrganiserApi.ts")].filter((f) => /\.tsx?$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n");
ok("no 'AI-generated' labels in search results or learning journeys",!/AI-generated|Generated by AI|AI-created/i.test(appSrc));

// ── The AI organiser step (fake provider) ──
const known = new Set(items.map((i) => i.key));
ok("AI answer: unknown keys are dropped (it can't add a resource)", A.validateAiPlan({ stages: [{ key: "scripture", itemKeys: ["bible_passage:Made Up 1:1", items[1].key] }], gaps: [] }, known)?.stages[0].itemKeys.length === 1);
ok("AI answer: a governance violation discards it", A.validateAiPlan({ stages: [{ key: "scripture", itemKeys: [items[1].key] }], gaps: ["God told me you need this."] }, known) === null);
ok("AI answer: only P2P's stage keys", A.validateAiPlan({ stages: [{ key: "prophecy", itemKeys: [items[1].key] }], gaps: [] }, known) === null);
let sent = null;
A.setOrganiserClientForTests({ messages: { create: async (body) => { sent = body; return { content: [{ type: "text", text: JSON.stringify({ stages: [{ key: "scripture", itemKeys: items.filter((i) => i.category === "bible").map((i) => i.key) }, { key: "learning", itemKeys: items.filter((i) => i.resource.kind === "lesson").map((i) => i.key) }], gaps: ["No lesson yet on Jesus as Lord in Acts."] }) }] }; } } });
const aiPlan = await A.aiOrganise(j);
ok("AI step: governed system prompt, references only (no verse text, no private data)", sent && sent.system.startsWith("You are a supporting tool") && !JSON.stringify(sent.messages).includes("The LORD said unto my Lord") && !JSON.stringify(sent.messages).includes("private"));
const applied = aiPlan ? A.applyAiPlan(j, aiPlan) : null;
ok("AI step: re-arranges only real items; reflection activity kept; its gaps are added", !!applied && applied.stages.flatMap((s) => s.items).every((i) => known.has(i.key) || i.origin === "activity") && applied.gaps.some((g) => g.category === "external"));
ok("AI step is OFF by default (needs PLANS_AI_ORGANISER=on and a key)", !A.aiOrganiserEnabled());
A.setOrganiserClientForTests(null);

console.log(`learningPlans (api): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
