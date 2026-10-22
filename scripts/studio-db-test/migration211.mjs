// Migration 211 (chapter Assignment + chapter images) on PGlite with the REAL
// migrations 152 + 188 + 210 + 211. Synthetic data only.
//   • Additive: every existing story's fingerprint is unchanged (with and
//     without chapters), so no Studio approval goes stale.
//   • Assignment and a media item's chapter are fingerprinted when present.
//   • A media item can only point at a chapter of its own story; deleting the
//     chapter removes its media rows.
//   • Live stories stay frozen; students still can't write; idempotent.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/migration211.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const m152 = read("152_kingdom_stories.sql"), m188 = read("188_publishing_studio_foundation.sql");
const m210 = read("210_kingdom_story_catalogue.sql"), m211 = read("211_kingdom_story_chapter_assignment_media.sql");
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

const db = new PGlite();
const firstCat = await setupBase(db, m152);
await db.exec(m188);
await db.exec(m210);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const fp = async (id) => (await q(`select p2p_kingdom_story_fingerprint(s) f from p2p_kingdom_stories s where id=$1`, [id]))[0].f;
const five = (p) => `array['${p} 1','${p} 2','${p} 3','${p} 4','${p} 5']`;

// Existing content before 211: a plain story with media + source, and a chaptered story.
const plain = (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Plain', $1, 'Body.') returning id`, [firstCat]))[0].id;
await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path, caption, is_cover) values ($1::uuid, 'image', $1::text || '/a.jpg', 'Cap', true)`, [plain]);
await q(`insert into p2p_kingdom_story_sources (story_id, title) values ($1, 'Src')`, [plain]);
const chaptered = (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ('Chaptered', $1, 'Intro.') returning id`, [firstCat]))[0].id;
const ch1 = (await q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, lessons, reflections) values ($1, 1, 'One', 'N1.', ${five("L")}, ${five("R")}) returning id`, [chaptered]))[0].id;
await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path) values ($1::uuid, 'image', $1::text || '/b.jpg')`, [chaptered]);
const fpPlain = await fp(plain), fpChaptered = await fp(chaptered);
const cols = async () => (await q(`select table_name || '.' || column_name c from information_schema.columns where table_name in ('p2p_kingdom_story_chapters','p2p_kingdom_story_media') order by 1`)).map((r) => r.c).join(",");

await db.exec(m211);

ok("existing story without chapters: fingerprint unchanged", (await fp(plain)) === fpPlain);
ok("existing story with chapters + media: fingerprint unchanged", (await fp(chaptered)) === fpChaptered);
const colsAfter = await cols();
ok("assignment columns added", colsAfter.includes("p2p_kingdom_story_chapters.assignment_title") && colsAfter.includes("p2p_kingdom_story_chapters.assignment"));
ok("media chapter_id added", colsAfter.includes("p2p_kingdom_story_media.chapter_id"));
const e2 = await expectErr(db.exec(m211));
ok("211 is idempotent", e2 === null, e2);
ok("re-run leaves fingerprints unchanged", (await fp(plain)) === fpPlain && (await fp(chaptered)) === fpChaptered);
ok("re-run adds no columns", (await cols()) === colsAfter);

// Assignment is fingerprinted when present.
await q(`update p2p_kingdom_story_chapters set assignment_title = 'Practise', assignment = 'Do the task.' where id=$1`, [ch1]);
const fpA = await fp(chaptered);
ok("adding an assignment changes the fingerprint", fpA !== fpChaptered);
await q(`update p2p_kingdom_story_chapters set assignment = 'Do the task, edited.' where id=$1`, [ch1]);
ok("editing an assignment changes the fingerprint", (await fp(chaptered)) !== fpA);
ok("over-long assignment title rejected", !!(await expectErr(q(`update p2p_kingdom_story_chapters set assignment_title = repeat('x', 201) where id=$1`, [ch1]))));

// Chapter images.
ok("media cannot point at another story's chapter", !!(await expectErr(q(`insert into p2p_kingdom_story_media (story_id, chapter_id, media_type, media_path) values ($1::uuid, $2, 'image', $1::text || '/x.jpg')`, [plain, ch1]))));
const fpB = await fp(chaptered);
const chMedia = (await q(`insert into p2p_kingdom_story_media (story_id, chapter_id, media_type, media_path, caption) values ($1::uuid, $2, 'image', $1::text || '/c.jpg', 'Image: example.org') returning id`, [chaptered, ch1]))[0].id;
ok("chapter media accepted for the same story", !!chMedia);
const fpC = await fp(chaptered);
ok("adding a chapter image changes the fingerprint", fpC !== fpB);
await q(`update p2p_kingdom_story_media set chapter_id = null where id=$1`, [chMedia]);
ok("moving an image out of its chapter changes the fingerprint", (await fp(chaptered)) !== fpC);
await q(`update p2p_kingdom_story_media set chapter_id = $2 where id=$1`, [chMedia, ch1]);

// RLS unchanged: students read nothing of a draft, write nothing.
ok("a student cannot read a draft's chapter assignment", (await asRole(db, "authenticated", U.P, `select count(*)::int n from p2p_kingdom_story_chapters where story_id=$1`, [chaptered])).rows?.[0].n === 0);
const sw = await asRole(db, "authenticated", U.P, `update p2p_kingdom_story_chapters set assignment='x' where id=$1 returning id`, [ch1]);
ok("a student cannot write an assignment", !!sw.error || sw.rows.length === 0, JSON.stringify(sw));
const sm = await asRole(db, "authenticated", U.P, `update p2p_kingdom_story_media set chapter_id=null where id=$1 returning id`, [chMedia]);
ok("a student cannot move media", !!sm.error || sm.rows.length === 0, JSON.stringify(sm));

// Publish: assignment optional; live story frozen.
const approve = async (id) => {
  await q(`delete from p2p_studio_items where source_id=$1`, [id]);
  await q(`insert into p2p_studio_items (source_type, source_id, review_state, submitted_by, reviewed_by, approved_fingerprint)
           select 'kingdom_story', $1, 'approved', $2, $3, p2p_kingdom_story_fingerprint(s) from p2p_kingdom_stories s where s.id=$1`, [id, U.A, U.B]);
};
const publish = (id) => expectErr(q(`update p2p_kingdom_stories set status='published', published_at=now() where id=$1`, [id]));
const ch2 = (await q(`insert into p2p_kingdom_story_chapters (story_id, chapter_number, title, narrative, lessons, reflections) values ($1, 2, 'Two', 'N2.', ${five("L")}, ${five("R")}) returning id`, [chaptered]))[0].id;
await approve(chaptered);
const pub = await publish(chaptered);
ok("a chapter without an assignment does not block publishing", pub === null, pub);
ok("a live story's assignment is frozen", /studio_live_edit_blocked/.test((await expectErr(q(`update p2p_kingdom_story_chapters set assignment='x' where id=$1`, [ch2]))) ?? ""));
ok("a live story's chapter image is frozen", /studio_live_edit_blocked/.test((await expectErr(q(`update p2p_kingdom_story_media set caption='x' where id=$1`, [chMedia]))) ?? ""));
ok("a student can read a published story's assignment", (await asRole(db, "authenticated", U.P, `select assignment from p2p_kingdom_story_chapters where id=$1`, [ch1])).rows?.[0]?.assignment === "Do the task, edited.");

// Deleting a chapter (of a draft) removes its media rows; story media stays.
await q(`update p2p_kingdom_stories set status='draft', published_at=null where id=$1`, [chaptered]).catch(() => {});
const stillLive = (await q(`select status from p2p_kingdom_stories where id=$1`, [chaptered]))[0].status === "published";
if (!stillLive) {
  await q(`delete from p2p_kingdom_story_chapters where id=$1`, [ch1]);
  ok("deleting a chapter removes its image rows", (await q(`select count(*)::int n from p2p_kingdom_story_media where id=$1`, [chMedia]))[0].n === 0);
  ok("story-level media kept", (await q(`select count(*)::int n from p2p_kingdom_story_media where story_id=$1 and chapter_id is null`, [chaptered]))[0].n === 1);
} else ok("story can be unpublished for the delete check", false);

// Rollback runs, restores 210's fingerprint, and 211 re-applies.
const rb = m211.slice(m211.indexOf("-- Rollback")).split(/\r?\n/).filter((l) => l.startsWith("--   ") && !l.startsWith("--   restore")).map((l) => l.slice(5)).join("\n");
const fn210 = m210.slice(m210.indexOf("create or replace function public.p2p_kingdom_story_fingerprint"), m210.indexOf("-- Same rules as 188, plus"));
const db2 = new PGlite();
const cat2 = await setupBase(db2, m152);
await db2.exec(m188); await db2.exec(m210);
const s2 = (await db2.query(`insert into p2p_kingdom_stories (title, category_id, body) values ('X', $1, 'B.') returning id`, [cat2])).rows[0].id;
const fp2 = async () => (await db2.query(`select p2p_kingdom_story_fingerprint(s) f from p2p_kingdom_stories s where id=$1`, [s2])).rows[0].f;
const f0 = await fp2();
await db2.exec(m211);
const rbErr = await expectErr(db2.exec(fn210 + "\n" + rb));
ok("documented rollback runs", rbErr === null, rbErr);
ok("fingerprint identical after rollback", (await fp2()) === f0);
ok("211 re-applies after rollback", (await expectErr(db2.exec(m211))) === null);

console.log(`\nmigration 211: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
