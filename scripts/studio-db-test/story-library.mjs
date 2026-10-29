// Kingdom Stories library (migration 215) end-to-end on PGlite with the REAL
// migrations 152 + 188 + 210 + 211 + 212 + 214 + 215 and the REAL story
// routes (kingdomStories.ts + kingdomStoryLibrary.ts). Synthetic data only.
//   • Topic numbers: unique per category, the catalogue's default order.
//   • Favourites / Saved for Later: published stories only, idempotent, each
//     reader's own (API and RLS).
//   • Recently viewed + resume: last chapter opened (validated).
//   • In progress / Completed come from REAL chapter progress — opening a
//     story never marks it started or completed.
//   • The Admin Recycle Bin keeps readers' saves/views with a binned story.
//   • Image role may change on a live story; anything else stays frozen.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/story-library.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const catId = await setupBase(db, read("152_kingdom_stories.sql"));
// The stories live in a published category (the seed's first one is an archived legacy category).
await db.exec(read("188_publishing_studio_foundation.sql"));
await db.exec(read("210_kingdom_story_catalogue.sql"));
await db.exec(read("211_kingdom_story_chapter_assignment_media.sql"));
const standIns = readFileSync(path.join(here, "recycle-bin.mjs"), "utf8").match(/await db\.exec\(`\n  alter table public\.p2p_curriculums([\s\S]*?)`\);/)[0];
await new Function("db", `return (async () => { ${standIns} })()`)(db);
await db.exec(read("212_kingdom_story_learning.sql"));
await db.exec(read("214_admin_recycle_bin.sql"));
await db.exec(read("215_kingdom_story_library.sql"));
// 217: exact client grants. Simulate Supabase's default privileges on 215's tables first, then 217 must remove them.
await db.exec(`grant all on public.p2p_kingdom_story_saves, public.p2p_kingdom_story_views, public.p2p_kingdom_story_collections, public.p2p_kingdom_story_collection_items to anon, authenticated`);
await db.exec(read("217_kingdom_story_library_grants.sql"));
await db.exec(read("217_kingdom_story_library_grants.sql")); // idempotent
{
  const g = (await db.query(`select
    has_table_privilege('authenticated','public.p2p_kingdom_story_saves','select,insert,delete') saves_ok,
    has_table_privilege('authenticated','public.p2p_kingdom_story_saves','update') or has_table_privilege('authenticated','public.p2p_kingdom_story_saves','truncate') saves_extra,
    has_table_privilege('authenticated','public.p2p_kingdom_story_views','select') views_read,
    has_table_privilege('authenticated','public.p2p_kingdom_story_views','insert') or has_table_privilege('authenticated','public.p2p_kingdom_story_views','truncate') views_write,
    has_table_privilege('authenticated','public.p2p_kingdom_story_collections','select') and has_table_privilege('authenticated','public.p2p_kingdom_story_collection_items','select') cols_read,
    has_table_privilege('authenticated','public.p2p_kingdom_story_collections','insert,update,delete,truncate') cols_write,
    has_table_privilege('anon','public.p2p_kingdom_story_saves','select') or has_table_privilege('anon','public.p2p_kingdom_story_collections','select') anon_any,
    has_table_privilege('service_role','public.p2p_kingdom_story_views','select,insert,update,delete') svc`)).rows[0];
  if (!(g.saves_ok && !g.saves_extra && g.views_read && !g.views_write && g.cols_read && !g.cols_write && !g.anon_any && g.svc)) throw new Error("217 grants wrong: " + JSON.stringify(g));
  console.log("217 grants exact:", JSON.stringify(g));
}
await db.query(`update p2p_kingdom_story_categories set status = 'published' where id = $1`, [catId]);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const expectErr = async (sql, p) => { try { await q(sql, p); return null; } catch (e) { return e.message; } };
await q(`insert into auth.users (id) select id from p2p_profiles on conflict do nothing`);
const id = (n) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const asOwner = async (sql, p) => { await db.exec(`set session_replication_role = replica`); try { return await q(sql, p); } finally { await db.exec(`set session_replication_role = origin`); } };

// Three published stories (published directly; the Studio gate is tested elsewhere), one draft.
const S = { a: id(1), b: id(2), c: id(3), draft: id(4) };
await asOwner(`insert into p2p_kingdom_stories (id, title, body, category_id, status, topic_number, published_at) values
  ($1, 'Abraham', 'b', $5, 'published', 3, now() - interval '3 days'),
  ($2, 'Creation', 'b', $5, 'published', 1, now() - interval '1 day'),
  ($3, 'Babel', 'b', $5, 'published', null, now() - interval '2 days'),
  ($4, 'Draft story', 'b', $5, 'draft', null, now())`, [S.a, S.b, S.c, S.draft, catId]);
// Story B has two chapters linked to learning lessons in the storybook curriculum.
const sysCur = (await one(`select id from p2p_curriculums where type = 'kingdom_story'`)).id;
await q(`insert into p2p_modules (id, curriculum_id, title) values ($1, $2, 'B module')`, [id(50), sysCur]);
await q(`insert into p2p_lessons (id, module_id, title, status) values ($1, $3, 'B1', 'published'), ($2, $3, 'B2', 'published')`, [id(51), id(52), id(50)]);
await asOwner(`insert into p2p_kingdom_story_chapters (id, story_id, chapter_number, title, narrative, lesson_id) values ($1, $3, 1, 'One', 'n', $4), ($2, $3, 2, 'Two', 'n', $5)`, [id(10), id(11), S.b, id(51), id(52)]);

ok("topic number unique within a category", /duplicate key|unique/.test(await expectErr(`update p2p_kingdom_stories set topic_number = 3 where id = $1`, [S.b]) ?? ""));
ok("topic number range checked", /topic_number_range|check/.test(await expectErr(`update p2p_kingdom_stories set topic_number = 0 where id = $1`, [S.c]) ?? ""));

const tmp = mkdtempSync(path.join(os.tmpdir(), "ks-library-"));
const { app } = await bundleApp({ apiRoot, tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const titles = (r) => (r.body?.stories ?? []).map((s) => s.title).join(",");

try {
  ok("feed: topic number order by default (unnumbered last)", titles(await call("GET", "/kingdom-stories/feed", U.P)) === "Creation,Abraham,Babel");
  ok("feed: title / recently added sorts", titles(await call("GET", "/kingdom-stories/feed?sort=title", U.P)) === "Abraham,Babel,Creation"
    && titles(await call("GET", "/kingdom-stories/feed?sort=recent", U.P)) === "Creation,Babel,Abraham");
  ok("feed: unknown sort refused", (await call("GET", "/kingdom-stories/feed?sort=popular", U.P)).status === 400);
  const feed = await call("GET", "/kingdom-stories/feed", U.P);
  ok("feed: topic number and the reader's saves on each card", feed.body.stories[0].topicNumber === 1 && feed.body.stories[0].mine.favourite === false);

  // Saves.
  ok("save: favourite", (await call("POST", `/kingdom-stories/${S.a}/save`, U.P, { kind: "favourite" })).body.saved === true);
  ok("save: twice is fine (idempotent)", (await call("POST", `/kingdom-stories/${S.a}/save`, U.P, { kind: "favourite" })).status === 200
    && (await one(`select count(*)::int n from p2p_kingdom_story_saves where user_id = $1`, [U.P])).n === 1);
  await call("POST", `/kingdom-stories/${S.b}/save`, U.P, { kind: "later" });
  ok("save: a draft can't be saved", (await call("POST", `/kingdom-stories/${S.draft}/save`, U.P, { kind: "later" })).status === 404);
  ok("save: unknown kind refused", (await call("POST", `/kingdom-stories/${S.a}/save`, U.P, { kind: "pin" })).status === 400);
  const favs = await call("GET", "/kingdom-stories/me/library?shelf=favourites", U.P);
  ok("library: My Favourites", titles(favs) === "Abraham" && favs.body.stories[0].mine.favourite === true && favs.body.stories[0].topicNumber === 3);
  ok("library: Saved for Later", titles(await call("GET", "/kingdom-stories/me/library?shelf=later", U.P)) === "Creation");
  ok("library: another reader sees none of it", titles(await call("GET", "/kingdom-stories/me/library?shelf=favourites", U.A)) === "");
  const detail = await call("GET", `/kingdom-stories/${S.a}`, U.P);
  ok("detail: the reader's saves and the topic number", detail.body.mine.favourite === true && detail.body.mine.later === false && detail.body.topicNumber === 3);
  await db.exec(`set role authenticated; set test.uid = '${U.A}'`);
  const rls = (await db.query(`select count(*)::int n from p2p_kingdom_story_saves`)).rows[0].n;
  const rlsInsert = await db.query(`insert into p2p_kingdom_story_saves (user_id, story_id, kind) values ($1, $2, 'later')`, [U.P, S.c]).then(() => null, (e) => e.message);
  await db.exec(`reset role; set test.uid = ''`);
  ok("RLS: a reader can't see or write someone else's saves", rls === 0 && /row-level security|violates/.test(rlsInsert ?? ""), `${rls} ${rlsInsert}`);
  ok("unsave", (await call("DELETE", `/kingdom-stories/${S.a}/save/favourite`, U.P)).body.saved === false && titles(await call("GET", "/kingdom-stories/me/library?shelf=favourites", U.P)) === "");

  // Recently viewed + resume; opening never counts as progress.
  ok("opened: records the chapter", (await call("POST", `/kingdom-stories/${S.b}/opened`, U.P, { chapterId: id(11) })).body.recorded === true);
  ok("opened: a chapter of another story refused", (await call("POST", `/kingdom-stories/${S.a}/opened`, U.P, { chapterId: id(11) })).status === 400);
  ok("opened: a draft isn't tracked", (await call("POST", `/kingdom-stories/${S.draft}/opened`, U.P, {})).body.recorded === false);
  await call("POST", `/kingdom-stories/${S.a}/opened`, U.P, {});
  const recent = await call("GET", "/kingdom-stories/me/library?shelf=recent", U.P);
  ok("library: Recently viewed, newest first, with the resume chapter", titles(recent) === "Abraham,Creation" && recent.body.stories[1].lastChapterId === id(11));
  ok("opening is not progress: nothing In progress yet", titles(await call("GET", "/kingdom-stories/me/library?shelf=in_progress", U.P)) === "");
  await q(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1, $2, 'completed', true)`, [U.P, id(51)]);
  ok("real progress: chapter 1 done → In progress", titles(await call("GET", "/kingdom-stories/me/library?shelf=in_progress", U.P)) === "Creation"
    && titles(await call("GET", "/kingdom-stories/me/library?shelf=completed", U.P)) === "");
  await q(`insert into p2p_lesson_progress (user_id, lesson_id, status, completed) values ($1, $2, 'submitted', false)`, [U.P, id(52)]);
  ok("real progress: every chapter submitted/completed → Completed", titles(await call("GET", "/kingdom-stories/me/library?shelf=completed", U.P)) === "Creation"
    && titles(await call("GET", "/kingdom-stories/me/library?shelf=in_progress", U.P)) === "");
  ok("library: unknown shelf refused", (await call("GET", "/kingdom-stories/me/library?shelf=popular", U.P)).status === 400);

  // Recycle Bin keeps readers' library rows with the story.
  await call("POST", `/kingdom-stories/${S.c}/save`, U.P, { kind: "favourite" });
  await call("POST", `/kingdom-stories/${S.c}/opened`, U.P, {});
  const before = JSON.stringify(await q(`select * from p2p_kingdom_story_saves where story_id = $1 order by id`, [S.c])) + JSON.stringify(await q(`select * from p2p_kingdom_story_views where story_id = $1 order by id`, [S.c]));
  await asOwner(`update p2p_kingdom_stories set status = 'draft' where id = $1`, [S.c]);
  const del = (await one(`select p2p_recycle_delete($1, 'kingdom_story', $2) r`, [U.A, S.c])).r;
  ok("bin: readers' saves and views go with the story", (await one(`select count(*)::int n from p2p_kingdom_story_saves where story_id = $1`, [S.c])).n === 0
    && del.counts.p2p_kingdom_story_saves === 1 && del.counts.p2p_kingdom_story_views === 1);
  await q(`select p2p_recycle_restore($1, $2)`, [U.A, del.entryId]);
  const after = JSON.stringify(await q(`select * from p2p_kingdom_story_saves where story_id = $1 order by id`, [S.c])) + JSON.stringify(await q(`select * from p2p_kingdom_story_views where story_id = $1 order by id`, [S.c]));
  ok("bin: restored exactly (same ids, same times)", after === before);
  ok("bin: restored as it was deleted (draft — never republished by a restore)", (await one(`select status from p2p_kingdom_stories where id = $1`, [S.c])).status === "draft");
  await asOwner(`update p2p_kingdom_stories set status = 'published' where id = $1`, [S.c]); // back to the scenario's published set
  ok("bin: collections are recoverable content", !!(await one(`select tbl from p2p_recycle_type('kingdom_story_collection')`))?.tbl);

  // Image role on a live story.
  await asOwner(`insert into p2p_kingdom_story_media (id, story_id, media_type, media_path, caption) values ($1, $2, 'image', 'b/hero.jpg', 'Image: x')`, [id(60), S.b]);
  ok("live story: changing only an image's role is allowed", (await expectErr(`update p2p_kingdom_story_media set role = 'hero' where id = $1`, [id(60)])) === null
    && (await one(`select role from p2p_kingdom_story_media where id = $1`, [id(60)])).role === "hero");
  ok("live story: any other image change stays frozen", /studio_live_edit_blocked/.test(await expectErr(`update p2p_kingdom_story_media set caption = 'changed' where id = $1`, [id(60)]) ?? "")
    && /studio_live_edit_blocked/.test(await expectErr(`update p2p_kingdom_story_media set role = 'cover', caption = 'x' where id = $1`, [id(60)]) ?? ""));
  await asOwner(`insert into p2p_kingdom_story_media (id, story_id, media_type, media_path) values ($1, $2, 'image', 'b/hero2.jpg')`, [id(61), S.b]);
  ok("one hero per story", /duplicate key|unique/.test(await expectErr(`update p2p_kingdom_story_media set role = 'hero' where id = $1`, [id(61)]) ?? ""));
  ok("unknown role refused", /role_check|check/.test(await expectErr(`update p2p_kingdom_story_media set role = 'banner' where id = $1`, [id(61)]) ?? ""));
  // ── Discovery homepage + editorial collections ───────────────────────────
  await asOwner(`update p2p_kingdom_stories set is_featured = true where id = $1`, [S.a]);
  await call("POST", `/kingdom-stories/${S.a}/save`, U.P, { kind: "later" });
  const d = (await call("GET", "/kingdom-stories/discover", U.P)).body;
  ok("discover: the editor's Featured story, with its card data", d.featured?.id === S.a && d.featured.topicNumber === 3);
  ok("discover: personal rows from real data (saved, recently viewed); Continue Learning only for started-not-finished",
    d.later.some((x) => x.id === S.a) && d.recentlyViewed.length >= 2 && !d.continueLearning.some((x) => x.id === S.b));
  ok("discover: category row in topic order; drafts never shown", d.categoryRows.length === 1 && d.categoryRows[0].stories.map((x) => x.title).join() === "Creation,Abraham,Babel"
    && !JSON.stringify(d).includes("Draft story"));
  ok("discover: recently added newest first; total published", d.recentlyAdded[0].title === "Creation" && d.totalPublished === 3, JSON.stringify([d.recentlyAdded.map((x) => [x.title, x.publishedAt]), d.totalPublished]));
  ok("discover: no collections until one is published", d.collections.length === 0);
  ok("collections: readers can't manage them", (await call("POST", "/kingdom-stories/admin/collections", U.P, { title: "Start Here" })).status === 403);
  const col = await call("POST", "/kingdom-stories/admin/collections", U.A, { title: "Start Here", description: "Begin with these." });
  ok("collections: an editor creates one (slug from the title)", col.status === 201 && col.body.slug === "start-here" && col.body.status === "draft");
  ok("collections: same name refused", (await call("POST", "/kingdom-stories/admin/collections", U.A, { title: "Start Here" })).status === 409);
  ok("collections: stories set in order (references, no copies)", (await call("PUT", `/kingdom-stories/admin/collections/${col.body.id}/stories`, U.A, { storyIds: [S.b, S.draft, S.a] })).status === 200);
  ok("collections: unknown story ids refused", (await call("PUT", `/kingdom-stories/admin/collections/${col.body.id}/stories`, U.A, { storyIds: [id(999)] })).status === 400);
  ok("collections: drafts stay hidden until published", (await call("GET", "/kingdom-stories/discover", U.P)).body.collections.length === 0);
  await call("PUT", `/kingdom-stories/admin/collections/${col.body.id}`, U.A, { status: "published" });
  const d2 = (await call("GET", "/kingdom-stories/discover", U.P)).body;
  ok("collections: published → shown in order, only published stories", d2.collections[0]?.title === "Start Here" && d2.collections[0].stories.map((x) => x.title).join() === "Creation,Abraham");
  ok("collections: See all page", (await call("GET", "/kingdom-stories/collections/start-here", U.P)).body.stories.length === 2);
  const delCol = await call("DELETE", `/kingdom-stories/admin/collections/${col.body.id}`, U.A);
  ok("collections: delete → Recycle Bin (items kept with it)", delCol.status === 200 && (await one(`select (counts->>'p2p_kingdom_story_collection_items')::int n from p2p_recycle_bin where content_type = 'kingdom_story_collection'`)).n === 3);

  // ── Hero, biblical journey, recommendations (lib/kingdomStoryJourney.ts) ──
  // P has finished Creation (#1; one chapter approved, one with a peer); Abraham (#3) is Featured.
  const h = (await call("GET", "/kingdom-stories/discover", U.P)).body;
  ok("hero: the editor's Featured story wins", h.hero?.id === S.a && h.hero.source === "featured" && h.featured?.id === S.a);
  const slideIds = (h.heroSlides ?? []).map((x) => x.id);
  ok("hero slides: start with the hero, no repeats, published only, at most 5", slideIds[0] === S.a && new Set(slideIds).size === slideIds.length && slideIds.length <= 5 && !slideIds.includes(S.draft));
  ok("journey: after a finished story, the next published one in topic order", h.journey?.story.id === S.a && h.journey.state === "next" && h.journey.position === 2 && h.journey.categoryTotal === 3
    && h.journey.upNext.map((x) => x.title).join() === "Babel", JSON.stringify(h.journey && [h.journey.story.title, h.journey.state, h.journey.position]));
  ok("recommended: reasons given; hero and finished stories left out; drafts never", h.recommended.map((x) => `${x.title}:${x.reason}`).join() === "Babel:same_category"
    && h.recommended[0].reasonLabel.startsWith("Continue exploring") && !JSON.stringify(h.recommended).includes("Draft story"));
  const creationCard = h.categoryRows[0].stories.find((x) => x.id === S.b);
  ok("cards: done vs peer-approved counted separately (finished, awaiting review)", creationCard.myProgress.doneChapters === 2 && creationCard.myProgress.completedChapters === 1);
  // A reader with no progress, and no Featured story: the hero is the start of the biblical order.
  await asOwner(`update p2p_kingdom_stories set is_featured = false where id = $1`, [S.a]);
  const fresh = (await call("GET", "/kingdom-stories/discover", U.A)).body;
  ok("hero: no Featured story → the reader's next story; never started → the first in order", fresh.hero?.id === S.b && fresh.hero.source === "journey" && fresh.journey.state === "start" && fresh.featured === null);
  ok("journey: opening alone never starts a story", fresh.continueLearning.length === 0);
  // An answered reflection counts as started (as on the story page), never as done.
  const sub = await q(`insert into p2p_submissions (user_id, lesson_id, text_content) values ($1, $2, 'A thought') returning id`, [U.A, id(51)]).then(() => null, (e) => e.message);
  if (sub) console.log("note: submission insert:", sub);
  const started = (await call("GET", "/kingdom-stories/discover", U.A)).body;
  ok("cards: an answer starts a story → Continue Your Stories + continue the journey", !sub && started.continueLearning.map((x) => x.id).join() === S.b
    && started.journey.state === "continue" && started.continueLearning[0].myProgress.doneChapters === 0, sub ?? "");
  // The story page: the published stories before and after it, in topic order.
  const seqA = (await call("GET", `/kingdom-stories/${S.a}`, U.P)).body.sequence;
  ok("story page: before/after in topic order", seqA?.previous?.id === S.b && seqA?.next?.id === S.c && seqA.previous.topicNumber === 1);
  ok("story page: first story has nothing before it", (await call("GET", `/kingdom-stories/${S.b}`, U.P)).body.sequence.previous === null);
  ok("story page: a draft stays hidden from readers", (await call("GET", `/kingdom-stories/${S.draft}`, U.P)).status === 404);
  // Search: published only, by title or category name.
  ok("search: by title, published only", titles(await call("GET", "/kingdom-stories/feed?q=abra", U.P)) === "Abraham" && titles(await call("GET", "/kingdom-stories/feed?q=draft", U.P)) === "");
  const catTitle = (await one(`select title from p2p_kingdom_story_categories where id = $1`, [catId])).title;
  ok("search: by category name", titles(await call("GET", `/kingdom-stories/feed?q=${encodeURIComponent(catTitle.slice(0, 6))}`, U.P)) === "Creation,Abraham,Babel", catTitle);
  ok("search: filter characters can't break the query", (await call("GET", `/kingdom-stories/feed?q=${encodeURIComponent("a,b),(x")}`, U.P)).status === 200);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`story library (215): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
