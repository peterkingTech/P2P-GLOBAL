// Explore Scripture by Topic — the Bible Study list (search, categories, counts) and the topic page.
// Executes lib/scriptureTopicsUi.ts and checks the screens; the data rules are tested on the server
// (api-server/tests/scriptureTopics.test.mjs). Run: node tests/scriptureTopicsUi.test.mjs
import { readFileSync } from "node:fs";
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
const js = ts.transpileModule(src("lib/scriptureTopicsUi.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, String, Set, Object, Array });
const U = mod.exports;
const en = JSON.parse(src("locales/en.json")).scriptureTopics;
const apiIndex = JSON.parse(src("../api-server/data/scripture-topics/index.json"));
const apiCats = JSON.parse(src("../api-server/data/scripture-topics/categories.json"));
const list = src("app/bible-study/index.tsx"), page = src("app/bible-study/topic/[slug].tsx");

const T = (title, category, extra = {}) => ({ id: title, slug: U.topicKey(title), title, description: null, displayOrder: 0, status: "published", parentTopicId: null, createdAt: "", updatedAt: "", category, scriptureCount: 12, ...extra });
const topics = [T("Peace", "spiritual_life"), T("Fear & Anxiety", "difficult_seasons", { description: "When worry weighs heavy" }), T("God's Will", "knowing_god"), T("Marriage", "relationships"), T("Old topic", null)];

ok("10. search finds a topic by title, ignoring case and apostrophes", U.searchTopics(topics, "gods WILL").map((t) => t.title).join() === "God's Will");
ok("10. search also matches description and category name", U.searchTopics(topics, "worry").length === 1 && U.searchTopics(topics, "family", (k) => (k === "relationships" ? "Relationships and Family" : k)).map((t) => t.title).join() === "Marriage");
ok("10. every word must match; empty search shows all", U.searchTopics(topics, "fear anxiety").length === 1 && U.searchTopics(topics, "fear peace").length === 0 && U.searchTopics(topics, "  ").length === 5);
const groups = U.groupTopics(topics);
ok("categories: grouped in the editorial order, unknown last", groups.map((g) => g.category).join() === "knowing_god,spiritual_life,relationships,difficult_seasons,other");
ok("app category order = the editorial collection's", U.TOPIC_CATEGORIES.join() === apiIndex.categories.map((c) => c.key).join());
ok("topic keys match the server's slugs (\"Fear & Anxiety\" → fear-anxiety)", U.topicKey("Fear & Anxiety") === "fear-anxiety" && U.topicKey("God's Will") === "gods-will");
const keysNeeded = Object.keys(apiCats.byTitle).map(U.topicKey);
ok("13. every topic name and category has an English string (others fall back to English)", keysNeeded.every((k) => en.names[k]) && [...U.TOPIC_CATEGORIES, "other"].every((c) => en.categories[c]) && Object.keys(en.kinds).length === 7);
ok("14. the introduction is unchanged", en.title === "Explore Scripture by Topic" && en.intro === "Passages chosen by P2P editors for each topic. Open any passage to read it in context.");
ok("plurals use i18next v4 forms", en.count_one && en.count_other);
ok("list: search box, category headers, counts beside topics, no hard-coded English labels", list.includes("searchTopics(") && list.includes("groupTopics(") && list.includes("scriptureCount") && list.includes('t("scriptureTopics.search")') && !list.includes('"Topics couldn\'t load. Try again"'));
ok("list: the search text is kept when returning from a topic (state in the mounted screen)", list.includes('const [query, setQuery] = useState("")'));
ok("11–12. passages open in the existing Bible reader with the passage's translation", page.includes("topicPassageRoute(r)") && src("lib/bibleStudy.ts").includes("translation: r.translationCode") && !/fetch\(|bible\.helloao/.test(page));
ok("topic page: editorial title and passage kind shown when reviewed passages carry them", page.includes("r.editorialTitle") && page.includes("scriptureTopics.kinds."));
ok("no Bible text is stored in the app for topics (references only)", !/verseText|scripture_text/.test(list + page));
ok("RTL-safe layout (no hard left/right alignment added)", !/textAlign: "left"|paddingLeft|marginRight/.test(page + list.slice(list.indexOf("groupTitle"))));

console.log(`scriptureTopicsUi (app): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
