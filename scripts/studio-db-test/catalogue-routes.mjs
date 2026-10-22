// Kingdom Stories catalogue routes (routes/kingdomStoriesCatalogue.ts + the
// story routes it extends) end-to-end on PGlite with the REAL migrations
// 152 + 188 + 210 and the REAL Publishing Studio routes. Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/catalogue-routes.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";
import { CATEGORIES } from "../kingdom-stories/catalogue.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
await setupBase(db, readFileSync(path.join(repo, "migrations/152_kingdom_stories.sql"), "utf8"));
await db.exec(readFileSync(path.join(repo, "migrations/188_publishing_studio_foundation.sql"), "utf8"));
await db.exec(readFileSync(path.join(repo, "migrations/210_kingdom_story_catalogue.sql"), "utf8"));
await db.exec(readFileSync(path.join(repo, "migrations/211_kingdom_story_chapter_assignment_media.sql"), "utf8"));
const q = async (sql, p) => (await db.query(sql, p)).rows;
await q(`insert into auth.users (id) select id from p2p_profiles on conflict do nothing`);

const tmp = mkdtempSync(path.join(os.tmpdir(), "ks-catalogue-"));
const { app } = await bundleApp({ apiRoot, tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const five = (p) => [1, 2, 3, 4, 5].map((i) => `${p} ${i}`);

try {
  // ── Readers: categories with honest counts ──
  const cat0 = await call("GET", "/kingdom-stories/catalogue/categories", U.P);
  const list = cat0.body?.categories ?? [];
  ok("reader sees the 24 active categories in order", cat0.status === 200 && list.length === 24 && list.every((c, i) => c.title === CATEGORIES[i].title), JSON.stringify(list.map((c) => c.title)).slice(0, 300));
  ok("published-story and planned-topic counts are separate; nothing published yet", list.every((c, i) => c.publishedStories === 0 && c.plannedTopics === CATEGORIES[i].topics.length));
  ok("readers never receive topic titles", !JSON.stringify(cat0.body).includes("Noah and the Flood"));
  ok("signed-out callers get nothing", (await call("GET", "/kingdom-stories/catalogue/categories", null)).status === 401);
  ok("old category list still works (with icons)", (await call("GET", "/kingdom-stories/categories", U.P)).body?.some((c) => c.slug === "biblical-history" && c.icon === "book-outline"));

  // ── Editors only ──
  for (const who of [U.P, U.M]) {
    const r = await call("GET", "/kingdom-stories/admin/topics", who);
    ok(`topics refused for ${who === U.P ? "a student" : "a moderator"}`, r.status === 403 || r.status === 401, String(r.status));
  }
  ok("topic writes refused for a student", [401, 403].includes((await call("POST", "/kingdom-stories/admin/topics", U.P, { title: "X", categoryId: list[0].id })).status));

  const bh = await call("GET", "/kingdom-stories/admin/topics?category=biblical-history&limit=200", U.A);
  ok("editor lists a category's topics in catalogue order", bh.status === 200 && bh.body.total === 23 && bh.body.topics[0].title === "Creation and the Beginning of Humanity" && bh.body.topics[22].title === "Ezra and the Restoration of the Community", JSON.stringify(bh.body).slice(0, 200));
  ok("filter by priority", (await call("GET", "/kingdom-stories/admin/topics?category=biblical-history&priority=P1&limit=200", U.A)).body.topics.map((t) => t.title).join("|") === "Creation and the Beginning of Humanity|Abraham and the Covenant|Moses and the Exodus|David: From Shepherd to King");
  const search = await call("GET", "/kingdom-stories/admin/topics?q=slessor&limit=200", U.A);
  ok("search across categories", search.body.total === 3 && search.body.topics.every((t) => /Slessor/.test(t.title)), JSON.stringify(search.body.topics?.map((t) => t.title)));
  ok("overlap notes come through", search.body.topics.every((t) => t.overlapNote?.startsWith("Possible overlap")));
  ok("bad status filter rejected", (await call("GET", "/kingdom-stories/admin/topics?status=done", U.A)).status === 400);
  ok("a wildcard in search is literal, not 'match all'", (await call("GET", "/kingdom-stories/admin/topics?q=%25", U.A)).body.total === 461);

  // Create / edit
  const bhId = list[0].id, jcId = list[1].id;
  const t1 = await call("POST", "/kingdom-stories/admin/topics", U.A, { title: "Synthetic Topic", categoryId: bhId, priority: "P2", tags: ["a", "a", " b "] });
  ok("editor creates a topic (status Topic, URL-safe slug, last in order)", t1.status === 200 && t1.body.slug === "synthetic-topic" && t1.body.status === "topic" && t1.body.displayOrder === 23 && JSON.stringify(t1.body.tags) === '["a","b"]', JSON.stringify(t1.body));
  const t2 = await call("POST", "/kingdom-stories/admin/topics", U.A, { title: "Synthetic Topic", categoryId: bhId });
  ok("same title gets a unique slug", t2.body?.slug === "synthetic-topic-2");
  ok("a new topic cannot start as Published", (await call("POST", "/kingdom-stories/admin/topics", U.A, { title: "Y", categoryId: bhId, status: "published" })).status === 400);
  ok("priority validated", (await call("PUT", `/kingdom-stories/admin/topics/${t1.body.id}`, U.A, { priority: "P9" })).status === 400);
  const moved = await call("PUT", `/kingdom-stories/admin/topics/${t1.body.id}`, U.A, { categoryId: jcId, status: "researching", region: "Synthetic region" });
  ok("editor moves a topic to another category and changes its status", moved.status === 200 && moved.body.categoryId === jcId && moved.body.status === "researching" && moved.body.displayOrder === 25 && moved.body.region === "Synthetic region", JSON.stringify(moved.body));
  ok("Published only once its story is published", (await call("PUT", `/kingdom-stories/admin/topics/${t1.body.id}`, U.A, { status: "published" })).status === 400);

  // Reorder
  const ids = (await call("GET", "/kingdom-stories/admin/topics?category=biblical-history&limit=200", U.A)).body.topics.map((t) => t.id);
  ok("reorder refuses a partial list", (await call("POST", "/kingdom-stories/admin/topics/reorder", U.A, { categoryId: bhId, orderedIds: ids.slice(1) })).status === 400);
  ok("reorder accepts the full list", (await call("POST", "/kingdom-stories/admin/topics/reorder", U.A, { categoryId: bhId, orderedIds: [...ids].reverse() })).status === 200);
  ok("new order is kept", (await call("GET", "/kingdom-stories/admin/topics?category=biblical-history&limit=200", U.A)).body.topics[0].id === ids[ids.length - 1]);

  // ── Topic → Story → Chapters ──
  const noah = (await call("GET", "/kingdom-stories/admin/topics?q=Noah&limit=5", U.A)).body.topics[0];
  const made = await call("POST", `/kingdom-stories/admin/topics/${noah.id}/story`, U.A);
  const sid = made.body?.story?.id;
  ok("create a story from a topic: empty draft, linked, no generated text", made.status === 200 && made.body.story.status === "draft" && made.body.story.topic_id === noah.id
    && (await q(`select body, category_id from p2p_kingdom_stories where id=$1`, [sid]))[0].body === "", JSON.stringify(made.body));
  ok("topic moves to Drafting", (await call("GET", `/kingdom-stories/admin/topics/${noah.id}`, U.A)).body.status === "drafting");
  ok("draft is invisible to readers", (await call("GET", `/kingdom-stories/${sid}`, U.P)).status === 404);
  ok("draft not in the reader feed", (await call("GET", "/kingdom-stories/feed", U.P)).body.total === 0);

  const c1 = await call("POST", `/kingdom-stories/${sid}/chapters`, U.A, { title: "The warning", narrative: "Synthetic narrative 1.", lessons: five("Lesson"), reflections: five("Question"), scriptureRefs: "Genesis 6", evidence: { documented: "Synthetic documented note", disputed: "Synthetic disputed note" } });
  const c2 = await call("POST", `/kingdom-stories/${sid}/chapters`, U.A, { title: "The ark", narrative: "Synthetic narrative 2.", lessons: ["Only one"] });
  ok("chapters numbered 1, 2", c1.body?.chapterNumber === 1 && c2.body?.chapterNumber === 2, JSON.stringify([c1.body, c2.body]).slice(0, 300));
  ok("chapter evidence kinds kept apart", c1.body.evidence.documented === "Synthetic documented note" && c1.body.evidence.disputed === "Synthetic disputed note" && c1.body.evidence.tradition === null);
  ok("completeness reported per chapter", c1.body.complete === true && c2.body.complete === false);
  ok("more than 5 lessons refused", (await call("PUT", `/kingdom-stories/${sid}/chapters/${c2.body.id}`, U.A, { lessons: [...five("L"), "six"] })).status === 400);
  ok("students cannot add chapters", [401, 403].includes((await call("POST", `/kingdom-stories/${sid}/chapters`, U.P, { title: "x" })).status));
  const c3 = await call("POST", `/kingdom-stories/${sid}/chapters`, U.A, { title: "Temporary" });
  ok("reorder chapters", (await call("POST", `/kingdom-stories/${sid}/chapters/reorder`, U.A, { orderedIds: [c3.body.id, c1.body.id, c2.body.id] })).status === 200);
  ok("delete a chapter closes the gap", (await call("DELETE", `/kingdom-stories/${sid}/chapters/${c3.body.id}`, U.A)).status === 200
    && JSON.stringify((await q(`select chapter_number n from p2p_kingdom_story_chapters where story_id=$1 order by n`, [sid])).map((r) => r.n)) === "[1,2]");
  const src = await call("POST", `/kingdom-stories/${sid}/sources`, U.A, { title: "Synthetic source", sourceType: "book", chapterId: c1.body.id });
  ok("source attached to a chapter", src.status === 200 && src.body.chapterId === c1.body.id);
  ok("source can't use another story's chapter", (await call("POST", `/kingdom-stories/${(await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Other', $1, 'b') returning id`, [bhId]))[0].id}/sources`, U.A, { title: "x", chapterId: c1.body.id })).status === 400);

  // Assignment field + chapter images (migration 211).
  const asg = await call("PUT", `/kingdom-stories/${sid}/chapters/${c1.body.id}`, U.A, { assignmentTitle: "Synthetic task title", assignment: "Synthetic task." });
  ok("assignment saved as its own field", asg.status === 200 && asg.body.assignment?.title === "Synthetic task title" && asg.body.assignment?.text === "Synthetic task.", JSON.stringify(asg.body).slice(0, 200));
  ok("a chapter without an assignment reports none", c2.body.assignment === null);
  ok("assignment is optional for completeness", asg.body.complete === true);
  const chImg = await call("POST", `/kingdom-stories/${sid}/media`, U.A, { mediaType: "image", mediaPath: `${sid}/pdf/c1.jpg`, caption: "Image: example.org", chapterId: c1.body.id });
  ok("an image can be placed in a chapter", chImg.status === 200 && chImg.body.chapterId === c1.body.id, JSON.stringify(chImg.body).slice(0, 200));
  const storyImg = await call("POST", `/kingdom-stories/${sid}/media`, U.A, { mediaType: "image", mediaPath: `${sid}/pdf/cover.jpg`, isCover: true });
  ok("an image without a chapter stays story-level", storyImg.status === 200 && storyImg.body.chapterId === null);
  ok("an image can't use another story's chapter", (await call("POST", `/kingdom-stories/${sid}/media`, U.A, { mediaType: "image", mediaPath: `${sid}/pdf/x.jpg`, chapterId: "00000000-0000-4000-8000-000000000000" })).status >= 400);
  const movedImg = await call("PUT", `/kingdom-stories/${sid}/media/${storyImg.body.id}`, U.A, { chapterId: c2.body.id });
  const back = await call("PUT", `/kingdom-stories/${sid}/media/${storyImg.body.id}`, U.A, { chapterId: null });
  ok("an image can be moved into a chapter and back", movedImg.body?.chapterId === c2.body.id && back.status === 200 && back.body.chapterId === null);
  const full = await call("GET", `/kingdom-stories/${sid}`, U.A);
  ok("the story returns media with their chapter and chapters with their assignment",
    full.body.media?.find((m) => m.id === chImg.body.id)?.chapterId === c1.body.id && full.body.chapters?.[0]?.assignment?.text === "Synthetic task.");
  const c4 = await call("POST", `/kingdom-stories/${sid}/chapters`, U.A, { title: "Temporary with image" });
  const c4img = await call("POST", `/kingdom-stories/${sid}/media`, U.A, { mediaType: "image", mediaPath: `${sid}/pdf/c4.jpg`, chapterId: c4.body.id });
  const removedBefore = (globalThis.__labStorage?.calls ?? []).length;
  await call("DELETE", `/kingdom-stories/${sid}/chapters/${c4.body.id}`, U.A);
  ok("deleting a chapter removes its images (row and file)", (await q(`select count(*)::int n from p2p_kingdom_story_media where id=$1`, [c4img.body.id]))[0].n === 0
    && (globalThis.__labStorage?.calls ?? []).slice(removedBefore).some((x) => x.op === "remove" && x.paths.includes(`${sid}/pdf/c4.jpg`)));

  // Fill the story and go through the Studio.
  await call("PUT", `/kingdom-stories/${sid}`, U.A, { body: "Synthetic introduction." });
  const approve = async () => {
    const s = await call("POST", `/studio/items/kingdom_story/${sid}/review`, U.A, { to: "in_review", version: (await q(`select version from p2p_studio_items where source_id=$1`, [sid]))[0]?.version ?? 1 });
    return call("POST", `/studio/items/kingdom_story/${sid}/review`, U.B, { to: "approved", version: s.body?.version });
  };
  const ap1 = await approve();
  ok("studio approval works", ap1.status === 200, JSON.stringify(ap1.body).slice(0, 200));
  const blocked = await call("PUT", `/kingdom-stories/${sid}`, U.A, { status: "published" });
  ok("an incomplete chapter blocks publishing, with a clear reason", blocked.status === 409 && blocked.body.code === "chapters_incomplete" && /5 Kingdom Lessons and 5 Peer Reflection Questions/.test(blocked.body.error), JSON.stringify(blocked.body));
  await call("PUT", `/kingdom-stories/${sid}/chapters/${c2.body.id}`, U.A, { lessons: five("L"), reflections: five("R") });
  await q(`update p2p_studio_items set review_state='draft', approved_fingerprint=null where source_id=$1`, [sid]);
  await approve();
  const pub = await call("PUT", `/kingdom-stories/${sid}`, U.A, { status: "published" });
  ok("complete chapters publish", pub.status === 200 && pub.body.status === "published", JSON.stringify(pub.body).slice(0, 200));

  const read = await call("GET", `/kingdom-stories/${sid}`, U.P);
  ok("reader gets chapters with lessons, reflections and chapter sources", read.status === 200 && read.body.chapters.length === 2
    && read.body.chapters[0].lessons.length === 5 && read.body.chapters[0].reflections.length === 5 && read.body.chapters[0].sources[0]?.title === "Synthetic source" && read.body.topicId === noah.id);
  ok("live chapters are frozen", (await call("PUT", `/kingdom-stories/${sid}/chapters/${c1.body.id}`, U.A, { title: "Changed" })).status === 409);
  ok("reader search finds the published story", (await call("GET", "/kingdom-stories/feed?q=noah", U.P)).body.stories.map((s) => s.id).join() === sid);
  ok("reader search never finds topics", (await call("GET", "/kingdom-stories/feed?q=abraham", U.P)).body.total === 0);
  const after = (await call("GET", "/kingdom-stories/catalogue/categories", U.P)).body.categories.find((c) => c.slug === "biblical-history");
  ok("counts: 1 published story; its topic no longer counted as planned", after.publishedStories === 1 && after.plannedTopics === 23 - 1 + 1 /* synthetic-topic-2 */, JSON.stringify(after));
  ok("topic can now be marked Published", (await call("PUT", `/kingdom-stories/admin/topics/${noah.id}`, U.A, { status: "published" })).status === 200);

  // Link / unlink an existing story.
  const legacy = (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Legacy', $1, 'b') returning id`, [jcId]))[0].id;
  const birth = (await call("GET", "/kingdom-stories/admin/topics?q=The%20Birth%20of%20Jesus&limit=5", U.A)).body.topics.find((t) => t.title === "The Birth of Jesus");
  ok("link an existing story to a topic", (await call("POST", `/kingdom-stories/admin/topics/${birth.id}/link`, U.A, { storyId: legacy })).status === 200
    && (await call("GET", `/kingdom-stories/admin/topics/${birth.id}`, U.A)).body.stories[0]?.id === legacy);
  ok("unlink it", (await call("DELETE", `/kingdom-stories/admin/topics/${birth.id}/link/${legacy}`, U.A)).status === 200);

  // Overview.
  const ov = await call("GET", "/kingdom-stories/admin/catalogue/overview", U.A);
  ok("overview: totals by status/priority, per category, chapter progress — counts only",
    ov.status === 200 && ov.body.totals.categories === 27 && ov.body.totals.activeCategories === 24 && ov.body.totals.topics === 463
    && ov.body.topicsByStatus.topic >= 450 && ov.body.storiesByStatus.published === 1 && ov.body.categories.length === 27
    && !/percent|%/i.test(JSON.stringify(ov.body)), JSON.stringify(ov.body).slice(0, 400));
  ok("overview refused for a student", [401, 403].includes((await call("GET", "/kingdom-stories/admin/catalogue/overview", U.P)).status));
} catch (e) {
  fail++; console.log("CRASH", e);
} finally {
  server.close(); rmSync(tmp, { recursive: true, force: true });
}
console.log(`\ncatalogue routes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
