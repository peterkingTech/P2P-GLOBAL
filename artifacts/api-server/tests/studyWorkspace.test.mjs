// Study workspace (owner brief 2026-11-18): lib/studySearch.ts behaviour (the real module, bundled) and static
// checks of routes/studyWorkspace.ts + migration 253 (applied 2026-11-18; read as a file, no database needed).
//   • eight groups with counts; every finding says WHY and its SOURCE;
//   • direct = the words in the Bible text; conceptual = editor-chosen passages of a topic the search names;
//     never keyword "concepts" (a generic word like "God" names no topic);
//   • stories only when a chapter retells/quotes a found passage; connected topics only via shared passages;
//   • routes: studies are the caller's own, idempotent by client key, optimistic concurrency (409 + current),
//     soft delete; emphasis has four-eyes review and only published references are served;
//   • 253: additive only, RLS on, API-only grants, category list matches the app.
// Run: node tests/studyWorkspace.test.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const req = createRequire(path.join(root, "package.json"));
const { build } = req("esbuild");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const tmp = mkdtempSync(path.join(root, ".tmp-study-ws-"));
let S;
try {
  await build({ entryPoints: [path.join(root, "src/lib/studySearch.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(tmp, "s.mjs"), logLevel: "silent" });
  S = await import(pathToFileURL(path.join(tmp, "s.mjs")).href);
} finally { rmSync(tmp, { recursive: true, force: true }); }

const topic = (slug, title, passages) => ({ slug, title, passages: passages.map((p, i) => ({ passage: p, core: i === 0, title: null, order: i })) });
const ix = {
  topics: [
    topic("grace", "Grace", [{ book: "EPH", chapter: 2, startVerse: 8, endVerse: 9 }, { book: "ROM", chapter: 5, startVerse: 1, endVerse: 2 }]),
    topic("faith", "Faith", [{ book: "EPH", chapter: 2, startVerse: 8, endVerse: 8 }, { book: "HEB", chapter: 11, startVerse: 1, endVerse: 1 }]),
    topic("creation", "Creation", [{ book: "GEN", chapter: 1, startVerse: 1, endVerse: 1 }]),
  ],
  stories: [
    { id: "s1", title: "Saved by Grace", subtitle: null, chapters: [{ id: "c1", number: 2, title: "Gift", spans: [{ book: "EPH", c1: 2, v1: 8, c2: 2, v2: 9 }], narrative: [{ book: "EPH", c1: 2, v1: 8, c2: 2, v2: 9 }] }] },
    { id: "s2", title: "In the Beginning", subtitle: null, chapters: [{ id: "c9", number: 1, title: "Light", spans: [{ book: "GEN", c1: 1, v1: 1, c2: 1, v2: 5 }], narrative: [] }] },
  ],
  lessons: [], plans: [], subjects: [], links: [], courses: [], article: () => null,
};
const bible = { translation: "KJV", total: 124, results: [{ bookCode: "JHN", chapter: 1, verse: 14, reference: "John 1:14", text: "full of grace and truth" }] };
const r = S.buildStudy({ q: "grace", ix, bible, articles: [{ id: "a1", title: "Grace", rank: 1, mentions: 9, preview: "…" }, { id: "a2", title: "Law", rank: 20, mentions: 3, preview: "…" }],
  words: [{ key: "charis", display: "χάρις", ids: ["G5485"], languages: ["Greek"] }] });

ok("groups (Biblical Themes removed 2026-11-18, owner) + the person's own (mine), each counted", S.STUDY_GROUPS.length === 8 && !S.STUDY_GROUPS.includes("themes") && S.STUDY_GROUPS.includes("mine") && S.STUDY_GROUPS.every((g) => typeof r.counts[g] === "number"));
ok("every finding has why + source", r.findings.length > 0 && r.findings.every((f) => f.why?.code && f.source));
ok("direct: the words in the text, with the translation", r.findings.some((f) => f.key === "bible:John 1:14" && f.match === "direct" && f.why.params.translation === "KJV"));
ok("conceptual: editor passages of the named topic", r.findings.some((f) => f.group === "scriptures" && f.match === "conceptual" && f.why.params?.topic === "Grace"));
ok("stories: retelling a found passage", r.findings.some((f) => f.key === "story:s1" && f.why.code === "storyRetells"));
ok("stories: unrelated stories left out", !r.findings.some((f) => f.key === "story:s2"));
ok("definitions vs historical context by article rank", r.findings.find((f) => f.key === "article:a1")?.group === "definitions" && r.findings.find((f) => f.key === "article:a2")?.group === "history");
ok("greek/hebrew: lexicon meaning match", r.findings.some((f) => f.group === "greek_hebrew" && f.why.code === "meaningMatches"));
ok("no Biblical Themes findings at all (owner: removed entirely)", !r.findings.some((f) => f.group === "themes" || f.kind === "scripture_topic" || f.kind === "concept"));
ok("a topic connected by a shared passage still appears as a connected concept; an unconnected one does not", r.concepts.includes("Faith") && !r.concepts.includes("Creation"));
ok("one finding per key", new Set(r.findings.map((f) => f.key)).size === r.findings.length);
ok("bible total carried", r.bibleTotal === 124 && r.bibleNote === null);

const r2 = S.buildStudy({ q: "God", ix, bible: { unavailable: "Search isn't available for this translation." }, articles: [], words: [] });
ok("a generic word names no topic (no keyword concepts)", r2.topics.length === 0 && r2.concepts.length === 0);
ok("bible search unavailable → said plainly", r2.bibleNote === "Search isn't available for this translation." && r2.bibleTotal === null);
ok("contentWords drops generic words and plurals", JSON.stringify(S.contentWords("What does God say about the promises?")) === JSON.stringify(["say", "promise"]));

// ── Routes ──
const rt = readFileSync(path.join(root, "src/routes/studyWorkspace.ts"), "utf8");
ok("routes: mounted", readFileSync(path.join(root, "src/routes/index.ts"), "utf8").includes("/study-workspace"));
ok("routes: studies scoped to the caller", (rt.match(/\.eq\("user_id", userId\)/g) ?? []).length >= 4);
ok("routes: create idempotent by client key", /client_key/.test(rt) && /existing: true/.test(rt));
ok("routes: optimistic concurrency → 409 with the current copy", /status\(409\)/.test(rt) && /current/.test(rt) && /baseVersion/.test(rt));
ok("routes: delete is soft", /deleted_at/.test(rt));
ok("routes: emphasis four eyes (the submitter cannot approve)", rt.includes("if (!r.submitted_by || r.submitted_by === userId) throw new WsError(409, \"Another editor must approve this reference.\")"));

// ── Proposed migration 253 ──
const sql = readFileSync(path.join(repo, "migrations/253_study_workspace.sql"), "utf8").toLowerCase();
ok("253: additive only (no drop/truncate/delete)", !/\bdrop table\b|\btruncate\b|\bdelete from\b|\bdrop column\b/.test(sql));
ok("253: three tables", ["p2p_scripture_emphasis", "p2p_deep_studies", "p2p_scripture_collection_reads"].every((t) => sql.includes(`create table if not exists public.${t}`)));
ok("253: RLS on every new table", ["p2p_scripture_emphasis", "p2p_deep_studies", "p2p_scripture_collection_reads"].every((t) => sql.includes(`alter table public.${t} enable row level security`)));
ok("253: categories match the app (Jesus from markup, not the table)", /'holy_spirit', 'father', 'commands', 'promises', 'prophecy', 'prayer_worship'/.test(sql) && !/'jesus'/.test(sql));
ok("253: studies keyed for idempotency and versioned", /client_key/.test(sql) && /version\s+integer/.test(sql));

// ── A typed reference ("John 3:16") is studied from every side ──
const ix2 = { ...ix, topics: [...ix.topics, topic("love", "God's Love", [{ book: "JHN", chapter: 3, startVerse: 16, endVerse: 16 }])] };
const rr = S.buildStudy({ q: "John 3:16", ix: ix2, bible: { translation: "KJV", total: 0, results: [], usedQuery: "John 3:16" }, articles: [], words: [],
  reference: { book: "JHN", chapter: 3, startVerse: 16, endVerse: 16 }, referenceText: { text: "For God so loved the world", translation: "KJV" },
  mine: [{ kind: "note", id: "n1", title: "My note", subtitle: "on love", ref: { book: "JHN", chapter: 3, startVerse: 16, endVerse: 16 } }] });
ok("reference: the passage itself, with its text", rr.findings.some((f) => f.key === "bible:John 3:16" && f.why.code === "referenceTyped" && f.subtitle === "For God so loved the world"));
ok("reference: no theme findings (Biblical Themes removed)", !rr.findings.some((f) => f.kind === "scripture_topic"));
ok("reference: its original words, commentaries and cross-references", rr.findings.some((f) => f.group === "greek_hebrew" && f.why.code === "originalWordsOf") && rr.counts.commentaries > 0 && rr.counts.cross_references > 0);
ok("reference: my own note is in 'mine' (only you can see it)", rr.findings.some((f) => f.group === "mine" && f.why.code === "myNote" && f.source === "Only you can see this"));
// ── Questions fall back to their main words, and say so ──
const rq = S.buildStudy({ q: "How to grow my relationship with God", ix, bible: { translation: "KJV", total: 3, results: [{ bookCode: "2PE", chapter: 3, verse: 18, reference: "2 Peter 3:18", text: "But grow in grace" }], usedQuery: "grow relationship" }, articles: [], words: [] });
ok("question: says which words were searched", rq.bibleNote?.includes("grow relationship") && rq.findings.some((f) => f.why.code === "wordsInTextPart"));
// ── Connected concepts are sourced (Easton / lexicon), never invented ──
const lex = S.conceptsFrom([{ id: "G5485", lemma: "χάρις", gloss: "grace", renderings: [{ text: "grace", count: 114 }, { text: "favor", count: 3 }, { text: "then the lord", count: 50 }, { text: "rare", count: 1 }] }], "grace of God");
ok("concepts: lexicon renderings — single words, not the search word, not rare", JSON.stringify(lex.map((c) => c.concept)) === JSON.stringify(["favor"]));
ok("concepts: only from a lexicon word that MEANS the search", S.conceptsFrom([{ id: "H7725", lemma: "שׁוּב", gloss: "to return", renderings: [{ text: "return", count: 68 }] }], "born again").length === 0);
const ez = S.eastonConcepts({ id: "a", title: "Grace", plain: "grace and mercy and salvation of the believer", paragraphs: [[["s", null, "JUSTIFICATION"]]] }, ["Mercy", "Salvation", "Prayer"], "grace");
ok("concepts: Easton's own cross-references + subjects it discusses that are P2P topics", ["justification", "mercy", "salvation"].every((c) => ez.some((x) => x.concept === c)) && !ez.some((x) => x.concept === "prayer"));
ok("concepts: stems for lexicon lookups", S.stems("lordship").includes("lord") && S.stems("forgiveness").includes("forgive"));

// ── What it means (owner 2026-11-18): definitions for each word and for the words together — sources only ──
const tmp2 = mkdtempSync(path.join(root, ".tmp-study-meaning-"));
let M, A, D;
try {
  await build({ stdin: { contents: `export * from "./src/lib/studyMeaning"; export { getArticles } from "./src/lib/referenceArticles"; export { getDictionary } from "./src/lib/dictionary";`, resolveDir: root, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: path.join(tmp2, "m.mjs"), loader: { ".txt": "text" }, logLevel: "silent" });
  M = await import(pathToFileURL(path.join(tmp2, "m.mjs")).href);
} finally { rmSync(tmp2, { recursive: true, force: true }); }
A = M.getArticles(); D = M.getDictionary();
ok("meaning: subject words keep Jesus / God (the lordship of Jesus → lordship, jesus)", JSON.stringify(M.meaningTerms("the lordship of Jesus")) === '["lordship","jesus"]' && JSON.stringify(M.meaningTerms("What does the Bible say about grace")) === '["grace"]');
const vs = (term, results) => ({ translation: "KJV", total: results.length, searchedAs: term, results: results.map(([reference, text], i) => ({ bookCode: "PHP", chapter: 2, verse: i + 1, reference, text })) });
const mj = M.buildMeaning({ q: "the lordship of Jesus", articles: A, dict: D, termVerses: { lordship: vs("lordship", [["Luke 22:25", "The kings of the Gentiles exercise lordship over them"]]) },
  togetherVerses: vs("jesus is lord", [["Mark 10:42", "But Jesus called them to him, and saith unto them, Ye know that they which are accounted to rule over the Gentiles exercise lordship over them"],
    ["Philippians 2:11", "And that every tongue should confess that Jesus Christ is Lord"], ["John 11:35", "Jesus wept."]]) });
const [lord, jesus] = mj.terms;
ok("meaning: Lordship → Easton's entry for its root, said plainly", lord.article?.title === "Lord" && lord.article.via === "root" && lord.article.source.includes("Easton"));
ok("meaning: Lordship → the Greek word for it (κυριότης G2963)", lord.original.some((o) => o.strongs === "G2963"));
ok("meaning: Jesus → Easton's entry for our Lord, not the other men named Jesus", jesus.article?.title === "Jesus" && jesus.article.excerpt.startsWith("Je’sus, the proper") && jesus.original[0]?.strongs === "G2424");
ok("meaning: each word's verses kept with their count", lord.verses[0]?.reference === "Luke 22:25" && lord.verseTotal === 1);
ok("together: only verses with every word, 'Jesus … is Lord' first", mj.together.verses.map((v) => v.reference).join() === "Philippians 2:11,Mark 10:42");
ok("together: Easton's own sentences that join the words", mj.together.sentences.some((x) => x.article === "Jesus" && /our Lord/.test(x.text)) && !mj.together.sentences.some((x) => x.text.endsWith("“Jesus of Nazareth”")));
const mg = M.buildMeaning({ q: "Grace of God", articles: A, dict: D, termVerses: {}, togetherVerses: vs("Grace of God", [["2 Peter 1:2", "Grace and peace be multiplied unto you through the knowledge of God"], ["Titus 2:11", "For the grace of God that bringeth salvation hath appeared"]]) });
ok("grace of God: definitions of grace and of God", mg.terms.map((t) => t.article?.title).join() === "Grace,God");
ok("grace of God: the exact phrase first", mg.together.verses[0].reference === "Titus 2:11");
ok("grace of God: Easton's senses of grace that name God", mg.together.sentences.some((x) => x.text.startsWith("(3.) God’s forgiving mercy")));
const mh = M.buildMeaning({ q: "Holy Spirit", articles: A, dict: D, termVerses: {}, togetherVerses: null });
ok("holy spirit: the edition's own entry for the phrase (Holy Ghost); holy alone → Holiness", mh.together.article?.title === "Holy Ghost" && mh.terms[0].article?.title === "Holiness");
ok("no scraps of references as sentences", !M.buildMeaning({ q: "kingdom of God", articles: A, dict: D, termVerses: {}, togetherVerses: null }).together.sentences.some((x) => x.text.startsWith("(Matt")));
ok("together queries: as typed, 'Jesus is lord', the words, their roots", JSON.stringify(M.togetherQueries("the lordship of Jesus")) === '["the lordship of Jesus","jesus is lord","lordship jesus","lord jesus"]');
const route = readFileSync(path.join(root, "src/routes/studyWorkspace.ts"), "utf8");
ok("route: meaning returned with the search, never for a typed reference, no AI", route.includes("const terms = reference ? [] : meaningTerms(q)") && route.includes("termVerses: perWord }), meaning, names });") && !/anthropic/i.test(readFileSync(path.join(root, "src/lib/studyMeaning.ts"), "utf8")));
ok("route: each word's verses feed every group (termVerses)", route.includes("termVerses: perWord"));

console.log(`studyWorkspace (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
