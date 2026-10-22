// Migration 210 (Kingdom Stories catalogue) on PGlite with the REAL
// migrations 152 + 188 + 210. Synthetic data only.
//   • 24 categories in the approved order with the approved names; the 10
//     mapped originals keep their id/slug; unused originals archived, used
//     ones untouched; an editor's rename is never overwritten.
//   • Every catalogue topic seeded once, status 'topic', nothing invented.
//   • Idempotent: a second run changes nothing.
//   • RLS: topics are editors-only; chapters follow their story.
//   • Studio: fingerprint unchanged for stories without chapters (existing
//     approvals stay valid); chapters are fingerprinted, frozen when live,
//     and must be complete (5 lessons + 5 reflections) to publish.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration210.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { CATEGORIES, buildTopics } from "../kingdom-stories/catalogue.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const m152 = read("152_kingdom_stories.sql"), m188 = read("188_publishing_studio_foundation.sql"), m210 = read("210_kingdom_story_catalogue.sql");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const expectErr = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

async function asRole(db, role, uid, sql, params = []) {
  await db.exec("begin");
  try {
    await db.query(`select set_config('test.uid', $1, true)`, [uid ?? ""]);
    await db.exec(`set local role ${role}`);
    return { rows: (await db.query(sql, params)).rows };
  } catch (e) { return { error: e.message }; } finally { await db.exec("rollback"); }
}

const topics = buildTopics();

// ── Database 1: production-like (13 original categories, existing stories) ──
const db = new PGlite();
const firstCat = await setupBase(db, m152);
await db.exec(m188);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const catId = async (slug) => (await q(`select id from p2p_kingdom_story_categories where slug=$1`, [slug]))[0]?.id;
const before = Object.fromEntries((await q(`select slug, id from p2p_kingdom_story_categories`)).map((r) => [r.slug, r.id]));

// Existing content before 210: a story with media + sources, approved (pre-210 fingerprint).
const story = (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Synthetic story', $1, 'Synthetic body.') returning id`, [before.missions]))[0].id;
await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path, caption) values ($1::uuid, 'image', $1::text || '/m/a.jpg', 'Cap')`, [story]);
await q(`insert into p2p_kingdom_story_sources (story_id, title, publisher) values ($1, 'Synthetic source', 'Synthetic publisher')`, [story]);
const fp = async (id) => (await q(`select p2p_kingdom_story_fingerprint(s) f from p2p_kingdom_stories s where id=$1`, [id]))[0].f;
const fpBefore = await fp(story);
// A story in a retired category keeps that category published.
const usedRetired = (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Uses global-church', $1, 'Body.') returning id`, [before["global-church"]]))[0].id;
const storiesHash = async () => (await q(`select md5(string_agg(concat_ws('|', id, title, category_id, status, body), '||' order by id)) h from p2p_kingdom_stories`))[0].h;
const storiesBefore = await storiesHash();

await db.exec(m210);

const cats = await q(`select id, slug, title, description, display_order, status, icon from p2p_kingdom_story_categories where status = 'published' order by display_order`);
const expectedPublished = CATEGORIES.length + 1; // + global-church, kept because a story uses it
ok("24 catalogue categories + 1 original still in use are published", cats.length === expectedPublished, String(cats.length));
const catalogueRows = CATEGORIES.map((c) => cats.find((r) => r.slug === c.slug));
ok("every catalogue category present with the exact approved name, in order 1–24",
  catalogueRows.every((r, i) => r && r.title === CATEGORIES[i].title && r.display_order === i + 1 && r.description === CATEGORIES[i].description && r.icon === CATEGORIES[i].icon),
  JSON.stringify(catalogueRows.map((r) => r?.title)));
ok("mapped originals keep their id and slug", CATEGORIES.filter((c) => c.existing).every((c) => before[c.slug] && catalogueRows.find((r) => r.slug === c.slug).id === before[c.slug]));
const retired = await q(`select slug, status from p2p_kingdom_story_categories where slug in ('christian-history','the-church','global-church') order by slug`);
ok("unused originals archived (not deleted); the one in use stays published",
  JSON.stringify(retired) === JSON.stringify([{ slug: "christian-history", status: "archived" }, { slug: "global-church", status: "published" }, { slug: "the-church", status: "archived" }]), JSON.stringify(retired));
ok("no category deleted", (await q(`select count(*)::int n from p2p_kingdom_story_categories`))[0].n === 13 + CATEGORIES.filter((c) => !c.existing).length);
ok("existing stories untouched", (await storiesHash()) === storiesBefore);

const trows = await q(`select t.slug, t.title, t.status, t.priority, t.historical_period, t.region, t.key_people, t.research_notes, t.overlap_note, c.slug cat
  from p2p_kingdom_story_topics t join p2p_kingdom_story_categories c on c.id = t.category_id`);
ok(`all ${topics.length} topics seeded once`, trows.length === topics.length && new Set(trows.map((t) => t.slug)).size === topics.length, String(trows.length));
ok("every topic in its approved category with its exact title", topics.every((t) => trows.some((r) => r.slug === t.slug && r.title === t.title && r.cat === t.categorySlug)));
ok("every topic seeded as 'topic' (nothing drafted/published)", trows.every((t) => t.status === "topic"));
ok("no invented metadata: period, region, key people empty", trows.every((t) => t.historical_period === null && t.region === null && t.key_people === null));
ok("priorities P1–P4 only", trows.every((t) => ["P1", "P2", "P3", "P4"].includes(t.priority)));
ok("duplicates across categories flagged", trows.filter((t) => t.title === "Perpetua and Felicity").every((t) => t.overlap_note?.includes("Possible overlap")) && trows.filter((t) => t.title === "Perpetua and Felicity").length === 3);
const counts = Object.fromEntries((await q(`select c.slug, count(t.id)::int n from p2p_kingdom_story_categories c left join p2p_kingdom_story_topics t on t.category_id = c.id group by c.slug`)).map((r) => [r.slug, r.n]));
ok("topic counts per category match the catalogue", CATEGORIES.every((c) => counts[c.slug] === c.topics.length), JSON.stringify(counts));

ok("fingerprint of a story without chapters is unchanged (existing approvals stay valid)", (await fp(story)) === fpBefore);

// Idempotent: second run changes nothing.
const snapshot = async () => (await q(`select
  (select md5(string_agg(concat_ws('|', id, slug, title, description, display_order, status, icon, updated_at), '||' order by slug)) from p2p_kingdom_story_categories) c,
  (select md5(string_agg(concat_ws('|', id, slug, title, category_id, status, priority, summary, research_notes, overlap_note, display_order, updated_at), '||' order by slug)) from p2p_kingdom_story_topics) t`))[0];
const s1 = await snapshot();
const e2 = await expectErr(db.exec(m210));
ok("second run succeeds", e2 === null, e2);
ok("second run changes nothing", JSON.stringify(await snapshot()) === JSON.stringify(s1));
// Editor changes survive a re-run.
await q(`update p2p_kingdom_story_topics set status = 'researching', region = 'Synthetic region' where slug = 'noah-and-the-flood'`);
await q(`update p2p_kingdom_story_categories set title = 'Edited title' where slug = 'biblical-history'`);
await db.exec(m210);
ok("re-run keeps editor changes to topics and categories",
  (await q(`select status, region from p2p_kingdom_story_topics where slug='noah-and-the-flood'`))[0].region === "Synthetic region"
  && (await q(`select title from p2p_kingdom_story_categories where slug='biblical-history'`))[0].title === "Edited title");

// ── RLS ──
const tsel = (role, uid) => asRole(db, role, uid, `select count(*)::int n from p2p_kingdom_story_topics`);
ok("a student sees no topics", (await tsel("authenticated", U.P)).rows?.[0].n === 0);
ok("a moderator (not an editor) sees no topics", (await tsel("authenticated", U.M)).rows?.[0].n === 0);
ok("anon cannot read topics", !!(await tsel("anon", null)).error);
ok("an editor sees every topic", (await tsel("authenticated", U.A)).rows?.[0].n === topics.length);
ok("a student cannot create a topic", !!(await asRole(db, "authenticated", U.P, `insert into p2p_kingdom_story_topics (slug, title, category_id) values ('x-y', 'X', $1)`, [firstCat])).error);
ok("an editor can create a topic", !(await asRole(db, "authenticated", U.A, `insert into p2p_kingdom_story_topics (slug, title, category_id) values ('x-y', 'X', $1) returning id`, [firstCat])).error);
ok("a topic slug must be URL-safe", !!(await expectErr(q(`insert into p2p_kingdom_story_topics (slug, title, category_id) values ('Bad Slug', 'X', $1)`, [firstCat]))));

// ── Chapters ──
const draft = (await q(`insert into p2p_kingdom_stories (title, category_id, body, topic_id) values ('Chaptered', $1, 'Intro.', (select id from p2p_kingdom_story_topics where slug='the-moravian-prayer-watch')) returning id`, [before.prayer]))[0].id;
const five = (p) => `array['${p} 1','${p} 2','${p} 3','${p} 4','${p} 5']`;
const ch1 = (await q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, lessons, reflections) values ($1, 1, 'One', 'Narrative one.', ${five("L")}, ${five("R")}) returning id`, [draft]))[0].id;
const ch2 = (await q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, lessons) values ($1, 2, 'Two', 'Narrative two.', array['Only one']) returning id`, [draft]))[0].id;
ok("more than 5 lessons rejected", !!(await expectErr(q(`update p2p_kingdom_story_chapters set lessons = array['1','2','3','4','5','6'] where id=$1`, [ch1]))));
ok("chapter numbers unique per story", !!(await expectErr(q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number) values ($1, 1)`, [draft]))));
ok("a source cannot point at another story's chapter", !!(await expectErr(q(`insert into p2p_kingdom_story_sources (story_id, chapter_id, title) values ($1, $2, 'x')`, [story, ch1]))));
await q(`insert into p2p_kingdom_story_sources (story_id, chapter_id, title) values ($1, $2, 'Chapter source')`, [draft, ch1]);
ok("chapter sources accepted for the same story", (await q(`select count(*)::int n from p2p_kingdom_story_sources where chapter_id=$1`, [ch1]))[0].n === 1);
ok("a student cannot read a draft story's chapters", (await asRole(db, "authenticated", U.P, `select count(*)::int n from p2p_kingdom_story_chapters where story_id=$1`, [draft])).rows?.[0].n === 0);
const sw = await asRole(db, "authenticated", U.P, `update p2p_kingdom_story_chapters set title='x' where id=$1 returning id`, [ch1]);
ok("a student cannot write chapters", !!sw.error || sw.rows.length === 0, JSON.stringify(sw));

const fpA = await fp(draft);
await q(`update p2p_kingdom_story_chapters set narrative = 'Narrative one, edited.' where id=$1`, [ch1]);
ok("chapter text is part of the fingerprint", (await fp(draft)) !== fpA);

// Reorder RPC (service role only).
await q(`select p2p_kingdom_story_reorder_chapters($1, array[$2, $3]::uuid[])`, [draft, ch2, ch1]);
ok("chapters renumbered in one call", JSON.stringify((await q(`select id from p2p_kingdom_story_chapters where story_id=$1 order by chapter_number`, [draft])).map((r) => r.id)) === JSON.stringify([ch2, ch1]));
ok("reorder refuses a partial list", !!(await expectErr(q(`select p2p_kingdom_story_reorder_chapters($1, array[$2]::uuid[])`, [draft, ch1]))));
ok("students cannot call reorder", !!(await asRole(db, "authenticated", U.P, `select p2p_kingdom_story_reorder_chapters($1, array[$2, $3]::uuid[])`, [draft, ch1, ch2])).error);
await q(`select p2p_kingdom_story_reorder_chapters($1, array[$2, $3]::uuid[])`, [draft, ch1, ch2]);

// Publish gate.
const approve = async (id) => {
  await q(`delete from p2p_studio_items where source_id=$1`, [id]);
  await q(`insert into p2p_studio_items (source_type, source_id, review_state, submitted_by, reviewed_by, approved_fingerprint)
           select 'kingdom_story', $1, 'approved', $2, $3, p2p_kingdom_story_fingerprint(s) from p2p_kingdom_stories s where s.id=$1`, [id, U.A, U.B]);
};
const publish = (id) => expectErr(q(`update p2p_kingdom_stories set status='published', published_at=now() where id=$1`, [id]));
await approve(draft);
const blocked = await publish(draft);
ok("incomplete chapter blocks publishing (approved or not)", /chapters_incomplete/.test(blocked ?? ""), blocked);
await q(`update p2p_kingdom_story_chapters set lessons = ${five("L")}, reflections = array['R 1','R 2','R 3','R 4','  '] where id=$1`, [ch2]);
await approve(draft);
ok("a blank reflection still blocks", /chapters_incomplete/.test((await publish(draft)) ?? ""));
await q(`update p2p_kingdom_story_chapters set reflections = ${five("R")} where id=$1`, [ch2]);
ok("an approval from before the last edit is stale", /studio_approval_stale/.test((await publish(draft)) ?? ""));
await approve(draft);
const pub = await publish(draft);
ok("complete chapters + current approval publishes", pub === null, pub);
ok("a live story's chapters are frozen", /studio_live_edit_blocked/.test((await expectErr(q(`update p2p_kingdom_story_chapters set title='x' where id=$1`, [ch1]))) ?? ""));
ok("no chapter can be added to a live story", /studio_live_edit_blocked/.test((await expectErr(q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number) values ($1, 9)`, [draft]))) ?? ""));
ok("a student can read a published story's chapters", (await asRole(db, "authenticated", U.P, `select count(*)::int n from p2p_kingdom_story_chapters where story_id=$1`, [draft])).rows?.[0].n === 2);
ok("linking a live story to a topic is allowed (administrative, not content)", (await expectErr(q(`update p2p_kingdom_stories set topic_id = null where id=$1`, [draft]))) === null);
// A story without chapters still publishes exactly as before.
await approve(story);
ok("a story without chapters publishes as before", (await publish(story)) === null);
await q(`update p2p_kingdom_stories set topic_id = (select id from p2p_kingdom_story_topics where slug='the-moravian-prayer-watch') where id=$1`, [story]);
await q(`delete from p2p_kingdom_story_topics where slug='the-moravian-prayer-watch'`);
ok("deleting a topic only unlinks its story (story kept, still live)", (await q(`select topic_id, status from p2p_kingdom_stories where id=$1`, [story]))[0]?.topic_id === null && (await q(`select status from p2p_kingdom_stories where id=$1`, [story]))[0]?.status === "published");

// ── Database 2: an editor renamed a mapped category before 210 ──
const db2 = new PGlite();
await setupBase(db2, m152);
await db2.exec(m188);
await db2.exec(`update p2p_kingdom_story_categories set title = 'Faith Heroes', description = 'Editor text' where slug = 'people'`);
await db2.exec(m210);
const people = (await db2.query(`select title, description, display_order from p2p_kingdom_story_categories where slug='people'`)).rows[0];
ok("an editor's rename of an original category is never overwritten", people.title === "Faith Heroes" && people.description === "Editor text", JSON.stringify(people));
ok("its topics are still seeded into it", (await db2.query(`select count(*)::int n from p2p_kingdom_story_topics t join p2p_kingdom_story_categories c on c.id=t.category_id where c.slug='people'`)).rows[0].n === CATEGORIES.find((c) => c.slug === "people").topics.length);

// Rollback runs and leaves stories intact.
const rb = m210.slice(m210.indexOf("-- Rollback")).split(/\r?\n/).filter((l) => l.startsWith("--   ") && !l.startsWith("--   (") && !l.startsWith("--    ")).map((l) => l.slice(5)).join("\n");
const rbErr = await expectErr(db2.exec(rb + "\n" + m188.slice(m188.indexOf("create or replace function public.p2p_kingdom_story_fingerprint"), m188.indexOf("-- Approved Studio items whose story changed"))));
ok("documented rollback runs", rbErr === null, rbErr);
ok("210 re-applies after rollback", (await expectErr(db2.exec(m210))) === null);

console.log(`\nmigration 210: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
