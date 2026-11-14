// P2P PLANS — discovery, the 5-step builder, Bible passage choosing and group plans: the app side
// (owner brief "Unified Plans, Intelligent Resource Discovery and Study Together", 2026-11-14).
// lib/studyPlansUi.ts + lib/passagePick.ts executed; screens checked against the brief (§7–§12, §20, §22).
// The server side: api-server/tests/plansDiscoveryGroups.test.mjs. Run: node tests/plansDiscoveryUi.test.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (f) => readFileSync(path.join(root, f), "utf8");
const mods = { "react-native": { Platform: { select: (o) => o.default } }, "@/lib/apiClient": { apiRequest: async () => ({}) } };
const load = (f) => {
  const js = ts.transpileModule(src(f), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, Math, JSON, Date, Number, String, Object, Array, Set, Map, RegExp,
    require: (n) => { if (mods[n]) return mods[n]; throw new Error(`require ${n}`); } });
  return mod.exports;
};
mods["@/lib/bibleBooks"] = load("lib/bibleBooks.ts");
mods["@/lib/bibleReaderApi"] = load("lib/bibleReaderApi.ts");
const U = load("lib/studyPlansUi.ts");
const Pick = load("lib/passagePick.ts");
const en = JSON.parse(src("locales/en.json")).p2pPlans;
const t = (k, o = {}) => { const v = k.replace(/^p2pPlans\./, "").split(".").reduce((x, p) => (x == null ? x : x[p]), en); return typeof v === "string" ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n] ?? "")) : `[missing ${k}]`; };
const builder = src("app/plans/builder.tsx"), discoverScreen = src("app/plans/discover.tsx"), group = src("app/plans/group.tsx"), together = src("app/plans/together.tsx");
const home = src("app/plans/index.tsx"), reader = src("app/bible/index.tsx"), detail = src("app/study-plan/[id].tsx");
const recs = src("components/plans/Recommendations.tsx"), picker = src("components/plans/SubjectPicker.tsx"), chooser = src("components/plans/GroupChooser.tsx");
const apiLib = readFileSync(path.join(root, "..", "api-server", "src", "lib", "planDiscovery.ts"), "utf8");

// ── Helpers ──
ok("focus: each subject type maps to the plan's one main focus, by reference", JSON.stringify(U.focusFor("bible_book", "ROM")) === '{"focusType":"bible_book","focusRef":{"book":"ROM"}}'
  && U.focusFor("bible_topic", "love").focusRef.topicSlug === "love" && U.focusFor("biblical_person", "x").focusType === "biblical_person" && U.focusFor("kingdom_school", "c").focusRef.curriculumId === "c");
const qs = U.templateQuestions(t, "Love", "John 3:16");
ok("prepared questions come from the person's language, name the passage and focus, and are four learning aids", qs.length === 4 && qs[0].text.includes("John 3:16") && qs[2].text.includes("Love") && qs.every((q) => !q.text.includes("[missing")));
const js = U.journeySessions({ sessions: [{ title: "1 Corinthians 13:4-7", intro: null, passages: [{ book: "1CO", chapter: 13, startVerse: 4, endVerse: 7 }], primaryResource: null, supporting: [{ kind: "kingdom_story", id: "s" }], reflection: null, prayer: null, essential: true, from: [], templateQuestions: true },
  { title: "Ruth", intro: null, passages: [], primaryResource: { kind: "kingdom_story", id: "r" }, supporting: [], reflection: null, prayer: null, essential: true, from: [], templateQuestions: false }], derivedFrom: null, note: null }, t, "Love");
ok("a suggested journey becomes plan sessions (references only; questions only for Scripture sessions)", js.length === 2 && js[0].questions.length === 4 && js[1].questions.length === 0 && js[0].supporting[0].id === "s" && !JSON.stringify(js).includes('"text":"For God so'));
ok("reasons are worded from codes; an editor's reason is shown as written", U.reasonText(t, { code: "storyOverlap", params: { chapter: 3, passage: "John 3" } }).includes("Chapter 3") && U.reasonText(t, { code: "editorial", params: { text: "Teaches loyal love" } }) === "Teaches loyal love");
// Every quoted code in a "code:" expression (including `code: cond ? "a" : "b"`).
const codes = [...new Set([...apiLib.matchAll(/code: ([^,}]+)/g)].flatMap((m) => [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1])).filter((c) => c !== "editorial"))];
ok("every reason the server can give has English wording", codes.length >= 15 && codes.every((c) => en.reason[c]), codes.filter((c) => !en.reason[c]).join());
const types = [...apiLib.matchAll(/SUBJECT_TYPES = \[([^\]]+)\]/g)][0][1].match(/"(\w+)"/g).map((x) => x.slice(1, -1));
const sections = [...apiLib.matchAll(/SECTIONS = \[([^\]]+)\]/g)][0][1].match(/"(\w+)"/g).map((x) => x.slice(1, -1));
ok("every subject type, section and relevance level has a label (and a search hint)", types.every((x) => en.subjectType[x] && en.discover.searchPlaceholder[x]) && sections.every((x) => en.section[x]) && ["all", "direct", "supporting", "further"].every((x) => en.relevance[x]));
ok("targets open the real screens: plan, subject (in discovery), dictionary article, passage", U.targetRoute({ kind: "plan", id: "p" }).pathname === "/study-plan/[id]" && U.targetRoute({ kind: "subject", id: "d" }, { params: { kind: "person" } }).params.type === "biblical_person"
  && U.resourceRoute({ kind: "reference_article", id: "love" }).pathname === "/dictionary/article/[id]" && U.targetRoute({ kind: "bible_passage", book: "JHN", chapter: 3 }).pathname === "/bible");
ok("reordering moves one item; out of range changes nothing", U.move([1, 2, 3], 0, 1).join() === "2,1,3" && U.move([1, 2, 3], 2, 3).join() === "1,2,3");
ok("client keys are random and server-safe", /^[a-z0-9]{24}$/.test(U.newClientKey()) && U.newClientKey() !== U.newClientKey());

// ── Bible passage choosing (brief §9) ──
let heard = null; const off = Pick.onPick((p) => { heard = p; });
Pick.deliverPick({ book: "ROM", chapter: 8, startVerse: 1, endVerse: 11, text: "There is therefore now" });
ok("the reader hands back a reference only (never text)", JSON.stringify(heard) === '{"book":"ROM","chapter":8,"startVerse":1,"endVerse":11}');
ok("…taken once, so returning twice never adds it twice", JSON.stringify(Pick.takePick()) === '{"book":"ROM","chapter":8,"startVerse":1,"endVerse":11}' && Pick.takePick() === null);
off();
ok("pick mode opens the EXISTING Bible reader (at the passage being edited)", Pick.pickRoute(null).pathname === "/bible" && Pick.pickRoute({ book: "JHN", chapter: 3, startVerse: 16 }).params.v === "16" && Pick.pickRoute(null).params.pick === "plan");
ok("the reader: 'Add to plan' for a verse range, 'Add the whole chapter', Cancel — only in pick mode", reader.includes('params.pick === "plan"') && reader.includes("deliverPick({ book: loc.book, chapter: loc.chapter, startVerse: sel.start, endVerse: sel.end })") && reader.includes("p2pPlans.pick.wholeChapter") && /picking && loc \?/.test(reader));
ok("choosing a passage never moves the person's own reading place", reader.includes("if (!picking) savePosition("));
ok("no second Bible picker: the builder uses the reader (and typed references)", builder.includes("pickRoute(") && !/BookChapterPicker/.test(builder));

// ── Discovery and the builder (§5–§8) ──
ok("Explore creates nothing (no plan writes on the explore screen)", !/createPlan|updatePlan|startPlan/.test(discoverScreen) && discoverScreen.includes("Recommendations"));
ok("subject selectors are searchable, paged, from the real records, and hide empty types", picker.includes("searchSubjects(") && picker.includes("getSubjectTypes(") && picker.includes("x.count > 0") && picker.includes("items.length < total"));
ok("recommendations show relevance, essential/optional, why, and open the real resource", recs.includes("p2pPlans.relevance.") && recs.includes("p2pPlans.discover.essential") && recs.includes("reasonText(") && recs.includes("targetRoute("));
ok("further exploration is one tap away, not forced on beginners", recs.includes("showFurther") && recs.includes('r.relevance !== "further" || showFurther'));
ok("builder: 5 labelled steps with progress, back keeps selections, live summary", /const STEPS: Step\[\] = \[1, 2, 3, 4, 5\]/.test(builder) && builder.includes('accessibilityRole="progressbar"') && builder.includes("<Summary />") && builder.includes("setStep((step - 1) as Step)"));
ok("builder: P2P's journey is prepared once and shown for review (never silently saved)", builder.includes("journeyFor === id") && builder.includes("p2pPlans.builder.journeyReview") && !/getJourney\([^)]*\)\.then\([^)]*createPlan/.test(builder));
ok("builder: add, remove, reorder, rename sessions; edit a passage through the reader", ["move(xs, i, i - 1)", "move(xs, i, i + 1)", "xs.filter((_, j) => j !== i)", "pickAt.current = i"].every((x) => builder.includes(x)));
ok("builder: supporting resources per session, kept optional", builder.includes("p2pPlans.builder.oneFocus") && en.builder.r_requiredValue.includes("optional"));
ok("builder: 7 durations, paces, start date, feasibility warning with a suggestion", builder.includes("DURATIONS.map(") && builder.includes("PACES.map(") && builder.includes("startChoices()") && builder.includes("est.tooMuch") && builder.includes("useSuggestion"));
ok("builder: Core Foundations / a course follow the real curriculum (schedule only)", builder.includes("derivedFrom") && /curriculum itself never changes/.test(en.builder.scheduleOnly) && /never the curriculum/.test(en.builder.curriculumRules));
ok("builder: save draft, create, cancel; every create is retry-safe", builder.includes("saveDraft") && builder.includes("clientKey: keys.current.draft") && builder.includes("clientKey: keys.current.create") && builder.includes("clientKey: keys.current.group") && builder.includes("clientKey: keys.current.attach"));
ok("builder: a 422 explains and offers the suggestion or 'keep my schedule'", builder.includes("e?.status === 422") && builder.includes("finish(true)"));
ok("Individual is the default; Study Together is never forced", builder.includes('useState<"individual" | "together">(params.group ? "together" : "individual")'));

// ── Study Together and group plans (§11–§12) ──
ok("existing groups: only those the person leads; one with an active plan can't take another", chooser.includes("groupsILead(") && chooser.includes("disabled={busy}") && en.together.hasActive.includes("one active plan"));
ok("a new group is prefilled from the plan, editable, and private", chooser.includes("defaultName") && builder.includes("defaultName={(title.trim() || focusLabel)") && /private/.test(en.together.privateNote) && /filled this in from your plan/.test(en.together.prefilled));
ok("the actual plan is attached (attach / create-from-plan), then the person's own run starts", builder.includes("attachGroupPlan(") && builder.includes("createGroupFromPlan(") && builder.includes('mode: "together", sharedStudyId: studyId') && together.includes("createGroupFromPlan("));
ok("group plans: active plan, completed history, choose another (leaders), nothing automatic", group.includes("data.active ?") && group.includes("data.history.map(") && group.includes("data.canLead ?") && /Nothing starts until a leader/.test(en.group.readyForNext));
ok("completing asks first, and says the group continues", group.includes("confirmAction(") && /group continues/.test(en.group.completeConfirm));
ok("members see counts and their own progress only (no other names or answers)", group.includes("item.overview.following") && group.includes("item.mine") && !/\.user_id|members\.map|responses/.test(group));
ok("members can revisit completed plans; latecomers aren't marked as having done them", group.includes("p2pPlans.group.revisit") && group.includes("p2pPlans.group.notInThisPlan"));
ok("discussion and calls are the group's own chat (existing messaging)", group.includes("/messages/${id}") && src("app/groups/[id].tsx").includes('pathname: "/plans/group"'));
ok("inviting uses the existing group invitations", group.includes('import { invite } from "@/lib/groupsApi"') && group.includes("invite(String(id), [...invitees])"));
ok("plan details: Study with a group; retired / added-later sessions are explained; drafts can't start", detail.includes('pathname: "/plans/together"') && detail.includes("p2pPlans.version.retired") && detail.includes("p2pPlans.version.addedLater") && detail.includes("p.draft ?"));

// ── Home (§14), localisation and accessibility (§20) ──
ok("home: Build my study journey, explore by subject (non-empty types only), Study Together, Drafts", home.includes('"/plans/discover"') && home.includes("subjectTypes.has(x.type)") && home.includes('"/study-together"') && home.includes('"drafts"'));
const all = builder + discoverScreen + group + together + recs + picker + chooser;
const keys = [...all.matchAll(/t\(`?"p2pPlans\.([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]);
const get = (k) => k.split(".").reduce((o, p) => (o == null ? o : o[p]), en);
ok("every fixed key used by the new screens exists in English", keys.length > 100 && keys.every((k) => get(k) !== undefined || (get(k + "_one") && get(k + "_other"))), keys.filter((k) => get(k) === undefined && !get(k + "_one")).join());
ok("no hard-coded English sentences in the new screens' JSX text", !/>\s*[A-Z][a-z]+ [a-z]+[^<{]*</.test(all.replace(/\/\/[^\n]*/g, "")));
ok("RTL-safe (no hard left/right spacing or alignment)", !/paddingLeft|paddingRight|marginLeft|marginRight|textAlign: "left"|textAlign: "right"/.test(all));
ok("controls are labelled for screen readers", (all.match(/accessibilityLabel=/g) ?? []).length >= 30 && all.includes("accessibilityState={{ selected"));
ok("routes registered", ["plans/discover", "plans/group", "plans/together"].every((r) => src("app/_layout.tsx").includes(`"${r}"`)));
ok("no Growth Matrix claims or 3D in the new screens", !/growthApi|LivingTreeView|BotanicalModelView/.test(all) && /never awards Growth Matrix credit|never awards/.test(src("../api-server/src/routes/studyPlans.ts")));
ok("the messaging composer placeholder is untouched (exact text, shared and in English)", src("lib/messagePrivacy.ts").includes('MESSAGE_PRIVACY_TEXT = "Do not enter sensitive personal information"') && src("locales/en.json").includes('"privacyPlaceholder": "Do not enter sensitive personal information"'));
console.log(`plansDiscoveryUi (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
