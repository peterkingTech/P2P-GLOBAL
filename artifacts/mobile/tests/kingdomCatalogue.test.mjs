// Kingdom Stories catalogue UI rules (static checks on the real sources).
//   • Readers only ever see published stories: reader screens never call the
//     editor (topic/overview) endpoints, and planned topics appear as a count.
//   • Published and planned counts are shown separately.
//   • Chapters show 5 Kingdom Lessons and 5 Peer Reflection Questions and keep
//     documented history / testimony / tradition / disputed claims apart.
//   • The editor overview never shows completion percentages.
// Run: node tests/kingdomCatalogue.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = (p) => readFileSync(path.join(root, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`FAIL ${n}`); } };

const api = src("lib/kingdomStoriesApi.ts");
const home = src("app/kingdom-stories/index.tsx");
const cat = src("app/kingdom-stories/category/[slug].tsx");
const detail = src("app/kingdom-stories/[id].tsx");
const chapters = src("app/kingdom-stories/chapter.tsx");
const editor = src("components/kingdom-stories/ChaptersEditor.tsx");
const overview = src("app/admin/kingdom-stories/catalogue.tsx");
const topics = src("app/admin/kingdom-stories/topics/index.tsx");
const topic = src("app/admin/kingdom-stories/topics/[topicId].tsx");

// Reader side.
for (const [name, s] of [["home", home], ["category", cat], ["story", detail], ["chapters", chapters]]) {
  ok(`${name}: no editor endpoints (topics/overview)`, !/getTopics|getTopic\b|getCatalogueOverview|admin\/topics|admin\/catalogue/.test(s));
}
ok("home: categories come from the reader catalogue endpoint", home.includes("getCatalogueCategories"));
ok("home: search uses the published-only feed", home.includes("searchKingdomStories") && /\/kingdom-stories\/feed\?\$\{new URLSearchParams\(\{ q/.test(api));
ok("home + category: counts via the shared labels (published and planned apart)", home.includes("categoryCountLabels") && cat.includes("categoryCountLabels"));
const labels = api.slice(api.indexOf("export function categoryCountLabels"), api.indexOf("export const TOPIC_STATUSES"));
ok("count labels: 'No stories yet' / '1 story' / 'N stories' and a separate 'N planned'", labels.includes('"No stories yet"') && labels.includes('"1 story"') && labels.includes("planned`") && labels.includes("planned: cat.plannedTopics > 0"));
ok("category page never lists topic titles", !/topics\.map|plannedTopics\.map/.test(cat) && cat.includes("being prepared"));
ok("story: a book — contents link each chapter to its own reading screen", detail.includes('pathname: "/kingdom-stories/chapter"') && detail.includes("Contents"));
ok("story: the story gallery shows only story-level images", detail.includes("media.filter((m) => !m.chapterId && m.id !== cover?.id)"));
ok("story: no Pray button", !detail.includes(">Pray<") && !detail.includes('"/(tabs)/prayer"'));
ok("story: chapter sources not repeated in the story source list", detail.includes("filter((x) => !x.chapterId)"));
ok("story: editors' preview of an unpublished story is labelled", detail.includes('story.status !== "published"') && detail.includes("Preview"));
ok("chapters: Lessons on This Chapter, Reflection and Comprehensive Check", ["Lessons on This Chapter", ">Reflection<", "{COMPREHENSIVE_CHECK}"].every((l) => chapters.includes(l)));
ok("chapters: each chapter shows its own images", chapters.includes("m.chapterId === ch.id"));
ok("chapters: four evidence kinds kept apart", ["Documented history", "Testimony", "Tradition", "Disputed or uncertain"].every((l) => chapters.includes(l)));
ok("chapters: readable book text (≥16px, generous line height, scalable)", chapters.includes("paragraph: { fontSize: 18 * k, lineHeight: 30 * k"));

// Editor side.
ok("CHAPTER_ITEMS is 5", /export const CHAPTER_ITEMS = 5;/.test(api));
ok("chapter editor: exactly CHAPTER_ITEMS slots for lessons and questions", editor.includes("Array.from({ length: CHAPTER_ITEMS }") && editor.includes('label="Lessons"') && editor.includes('label="Reflection questions"'));
ok("chapter editor: Comprehensive Check title + text, and images placed per chapter", editor.includes("save({ assignmentTitle:") && editor.includes("save({ assignment:") && editor.includes("placeImage(m.id, chapter.id)"));
ok("chapter editor: locked while the story is live", editor.includes("editable={!locked}") && src("app/admin/kingdom-stories/[id].tsx").includes('locked={story.status === "published"}'));
ok("chapter editor: says what is still needed", editor.includes("Still needed:"));
// (layout widths like "47%" are styles, not figures shown to editors)
ok("overview: no percentages shown or computed", !/percent|\* ?100|\}%|%</i.test(overview.replace(/\/\/.*$/gm, "")));
ok("overview: chapter progress as 'X of Y complete'", overview.includes("of ${s.chapters} chapter"));
ok("topics: filters for category, status, priority, period, region and search", ["setCategory", "setStatus", "setPriority", "setPeriod", "setRegion", "setQ"].every((f) => topics.includes(f)));
ok("topics: reorder only inside one unfiltered category", topics.includes("const canReorder = !!category && !status && !priority"));
ok("topic: start an empty draft or link an existing story", topic.includes("createStoryFromTopic") && topic.includes("linkStoryToTopic") && topic.includes("unlinkStoryFromTopic"));
ok("topic: research fields default to 'Not yet researched', never guessed", (topic.match(/Not yet researched/g) ?? []).length === 3);
ok("topic: overlap note shown to editors", topic.includes("topic.overlapNote"));
ok("admin list links to the catalogue", src("app/admin/kingdom-stories/index.tsx").includes('"/admin/kingdom-stories/catalogue"'));

console.log(`\nkingdom catalogue UI: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
