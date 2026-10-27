// Admin Recycle Bin over HTTP: the REAL routes (recycleBin.ts, admin.ts,
// kingdomStories*.ts, missions.ts, prayerTopics.ts, prayerPaths.ts) on PGlite
// with the REAL migrations 152 + 188 + 210 + 211 + 212 + 214 and the same
// Kingdom School / prayer / mission stand-ins as recycle-bin.mjs.
// Proves the existing delete buttons now move content to the bin (same
// responses as before), the bin lists only what the caller's role may manage
// (with search and filters), restore and purge work with their permission
// rules, and the typed confirmation is required to purge. Synthetic data only.
// Run: PGLITE_MODULE=.../@electric-sql/pglite/dist/index.js node scripts/studio-db-test/recycle-bin-routes.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

const db = new PGlite();
const read = (f) => readFileSync(path.join(repo, "migrations", f), "utf8");
const catId = await setupBase(db, read("152_kingdom_stories.sql"));
await db.exec(read("188_publishing_studio_foundation.sql"));
await db.exec(read("210_kingdom_story_catalogue.sql"));
await db.exec(read("211_kingdom_story_chapter_assignment_media.sql"));
// The stand-in block from recycle-bin.mjs (production FK rules).
const standIns = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "recycle-bin.mjs"), "utf8").match(/await db\.exec\(`\n  alter table public\.p2p_curriculums([\s\S]*?)`\);/)[0];
await new Function("db", `return (async () => { ${standIns} })()`)(db);
await db.exec(read("212_kingdom_story_learning.sql"));
await db.exec(read("214_admin_recycle_bin.sql"));
await db.exec(`alter table p2p_profiles add column if not exists full_name text, add column if not exists username text;
  update p2p_profiles set full_name = 'Ada Admin' where id = '${U.A}';`);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const id = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

const posix = (p) => p.replace(/\\/g, "/");
const r = (f) => JSON.stringify(posix(path.join(apiRoot, "src/routes", f)));
const tmp = mkdtempSync(path.join(os.tmpdir(), "recycle-routes-"));
const { app } = await bundleApp({ apiRoot, tmpDir: tmp, db, extraRoutes: `
import express_ from "express";
import recycleBin from ${r("recycleBin.ts")};
import admin from ${r("admin.ts")};
import missions from ${r("missions.ts")};
import prayerTopics from ${r("prayerTopics.ts")};
import prayerPaths from ${r("prayerPaths.ts")};
app.use("/api/admin/recycle-bin", express_.json(), recycleBin);
app.use("/api/admin", express_.json(), admin);
app.use("/api/missions", express_.json(), missions);
app.use("/api/prayer", express_.json(), prayerTopics);
app.use("/api/prayer", express_.json(), prayerPaths);
` });
const server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

try {
  // Kingdom School content with learner work.
  await q(`insert into p2p_curriculums (id, title, status) values ($1, 'Core', 'published')`, [id(1)]);
  await q(`insert into p2p_modules (id, curriculum_id, title, status) values ($1, $2, 'Module A', 'published')`, [id(2), id(1)]);
  await q(`insert into p2p_lessons (id, module_id, title, status) values ($1, $2, 'Lesson One', 'published')`, [id(3), id(2)]);
  await q(`insert into p2p_reflection_questions (id, lesson_id, question) values ($1, $2, 'Why?')`, [id(4), id(3)]);
  await q(`insert into p2p_submissions (id, user_id, lesson_id, reflection_question_id, text_content) values ($1, $2, $3, $4, 'answer')`, [id(5), U.P, id(3), id(4)]);

  ok("a student cannot open the bin", (await call("GET", "/admin/recycle-bin", U.P)).status === 403);
  ok("signed-out: 401", (await call("GET", "/admin/recycle-bin")).status === 401);
  const pv = await call("POST", "/admin/recycle-bin/preview", U.A, { type: "lesson", id: id(3) });
  ok("preview over HTTP shows what moves", pv.status === 200 && pv.body.counts.p2p_submissions === 1 && pv.body.title === "Lesson One", JSON.stringify(pv.body));

  const del = await call("DELETE", `/admin/lesson/${id(3)}`, U.A);
  ok("existing Delete lesson button: same 204 response, now moves to the bin", del.status === 204 && (await one(`select count(*)::int n from p2p_lessons where id = $1`, [id(3)])).n === 0, JSON.stringify(del));
  const list = await call("GET", "/admin/recycle-bin", U.A);
  const entry = list.body.items?.find((i) => i.contentId === id(3));
  ok("bin lists it: type label, parent, deleter's name, counts", !!entry && entry.typeLabel === "Lesson" && entry.parentLabel === "Module A"
    && entry.deletedBy?.name === "Ada Admin" && entry.counts.p2p_submissions === 1 && list.body.canPurge === false, JSON.stringify(list.body));
  ok("filters: by type, by search, by deleter", (await call("GET", "/admin/recycle-bin?type=lesson&q=one", U.A)).body.items.length === 1
    && (await call("GET", "/admin/recycle-bin?type=module", U.A)).body.items.length === 0
    && (await call("GET", `/admin/recycle-bin?deletedBy=${U.B}`, U.A)).body.items.length === 0
    && list.body.deleters.some((d) => d.id === U.A));
  const mod = await call("GET", "/admin/recycle-bin", U.M);
  ok("an admin_moderation sees only the types it manages (no Kingdom School)", !mod.body.items.some((i) => i.contentType === "lesson")
    && !mod.body.types.some((t) => t.value === "lesson") && mod.body.types.some((t) => t.value === "prayer_topic"));
  ok("…and cannot open or restore a lesson entry", (await call("GET", `/admin/recycle-bin/${entry.id}`, U.M)).status === 404
    && (await call("POST", `/admin/recycle-bin/${entry.id}/restore`, U.M)).status === 403);
  const detail = await call("GET", `/admin/recycle-bin/${entry.id}`, U.A);
  ok("entry detail: a short preview of the item, never the raw snapshot", detail.body.preview?.title === "Lesson One" && detail.body.snapshot === undefined);
  const rs = await call("POST", `/admin/recycle-bin/${entry.id}/restore`, U.B);
  ok("restore over HTTP: lesson and the learner's answer are back", rs.status === 200
    && (await one(`select text_content, reflection_question_id from p2p_submissions where id = $1`, [id(5)])).reflection_question_id === id(4));
  ok("restored entries listed under Restored", (await call("GET", "/admin/recycle-bin?status=restored", U.A)).body.items[0]?.restoredBy?.id === U.B);
  const again = await call("POST", `/admin/recycle-bin/${entry.id}/restore`, U.A);
  ok("restoring twice: clear 409", again.status === 409 && again.body.code === "recycle_not_in_bin");

  // Module + curriculum through the old routes.
  ok("Delete module route → bin", (await call("DELETE", `/admin/module/${id(2)}`, U.A)).status === 204 && (await one(`select count(*)::int n from p2p_lessons`)).n === 0);
  const modEntry = (await call("GET", "/admin/recycle-bin?type=module", U.A)).body.items[0];
  await call("POST", `/admin/recycle-bin/${modEntry.id}/restore`, U.A);
  ok("module restored with its lesson", (await one(`select count(*)::int n from p2p_lessons`)).n === 1);

  // Kingdom Stories: live story refused with a clear message; draft → bin; chapter → bin.
  const S1 = id(100);
  await q(`insert into p2p_kingdom_stories (id, title, body, category_id, status) values ($1, 'Ruth', 'Body', $2, 'draft')`, [S1, catId]);
  await q(`insert into p2p_kingdom_story_chapters (id, story_id, chapter_number, title, narrative) values ($1, $2, 1, 'One', 'N'), ($3, $2, 2, 'Two', 'N')`, [id(101), S1, id(102)]);
  await q(`insert into p2p_kingdom_story_media (id, story_id, media_type, media_path, chapter_id) values ($1, $2, 'image', $3, $4)`, [id(103), S1, `${S1}/a.jpg`, id(101)]);
  globalThis.__labStorage = { objects: { [`kingdom-stories-media/${S1}/a.jpg`]: { size: 1 } }, calls: [] };
  const chDel = await call("DELETE", `/kingdom-stories/${S1}/chapters/${id(101)}`, U.A);
  ok("Delete chapter route → bin; remaining chapters renumbered 1…; the image file is NOT removed",
    chDel.status === 200 && (await one(`select chapter_number from p2p_kingdom_story_chapters where id = $1`, [id(102)])).chapter_number === 1
    && !!globalThis.__labStorage.objects[`kingdom-stories-media/${S1}/a.jpg`], JSON.stringify(chDel.body));
  const chEntry = (await call("GET", "/admin/recycle-bin?type=kingdom_story_chapter", U.A)).body.items[0];
  const chRs = await call("POST", `/admin/recycle-bin/${chEntry.id}/restore`, U.A);
  ok("chapter restored at the end (its number is taken), warning returned", chRs.body.warnings?.length === 1
    && (await one(`select chapter_number from p2p_kingdom_story_chapters where id = $1`, [id(101)])).chapter_number === 2);
  await db.exec(`set session_replication_role = replica`); await q(`update p2p_kingdom_stories set status = 'published' where id = $1`, [S1]); await db.exec(`set session_replication_role = origin`);
  const live = await call("DELETE", `/kingdom-stories/${S1}`, U.A);
  ok("live story: Delete refused with 'unpublish first'", live.status === 409 && live.body.code === "recycle_live_story" && /Unpublish it first/.test(live.body.error));
  await db.exec(`set session_replication_role = replica`); await q(`update p2p_kingdom_stories set status = 'draft' where id = $1`, [S1]); await db.exec(`set session_replication_role = origin`);
  const sDel = await call("DELETE", `/kingdom-stories/${S1}`, U.A);
  ok("draft story: Delete → bin (same {removed:true}), files kept", sDel.status === 200 && sDel.body.removed === true
    && (await one(`select count(*)::int n from p2p_kingdom_stories where id = $1`, [S1])).n === 0 && !!globalThis.__labStorage.objects[`kingdom-stories-media/${S1}/a.jpg`]);
  const sEntry = (await call("GET", "/admin/recycle-bin?type=kingdom_story", U.A)).body.items[0];
  ok("story entry shows its file count", sEntry.fileCount === 1);

  // Purge: super_admin + typed confirmation; files removed only then.
  ok("purge: content admin refused", (await call("POST", `/admin/recycle-bin/${sEntry.id}/purge`, U.A, { confirm: "PERMANENTLY DELETE" })).status === 403);
  ok("purge: confirmation text required", (await call("POST", `/admin/recycle-bin/${sEntry.id}/purge`, U.S, { confirm: "yes" })).status === 400);
  const pg = await call("POST", `/admin/recycle-bin/${sEntry.id}/purge`, U.S, { confirm: "PERMANENTLY DELETE" });
  ok("purge: super_admin permanently deletes; its unused file is removed from storage", pg.status === 200 && pg.body.removedFiles === 1
    && !globalThis.__labStorage.objects[`kingdom-stories-media/${S1}/a.jpg`]);
  ok("purged entry cannot be restored", (await call("POST", `/admin/recycle-bin/${sEntry.id}/restore`, U.A)).body.code === "recycle_not_in_bin");

  // Prayer + missions through their existing routes (any admin, as today).
  await q(`insert into p2p_prayer_topics (id, title, status) values ($1, 'Peace', 'published')`, [id(200)]);
  await q(`insert into p2p_prayer_paths (id, title, status, topic_id) values ($1, 'Path', 'published', $2)`, [id(201), id(200)]);
  ok("Delete prayer topic route → bin; its path keeps existing", (await call("DELETE", `/prayer/admin/topics/${id(200)}`, U.M)).status === 200
    && (await one(`select topic_id from p2p_prayer_paths where id = $1`, [id(201)])).topic_id === null);
  ok("Delete prayer path route → bin", (await call("DELETE", `/prayer/admin/paths/${id(201)}`, U.M)).status === 200 && (await one(`select count(*)::int n from p2p_prayer_paths`)).n === 0);
  await q(`insert into p2p_mission_fields (id, title) values ($1, 'Field')`, [id(300)]);
  ok("Delete mission field route → bin", (await call("DELETE", `/missions/admin/fields/${id(300)}`, U.M)).status === 200 && (await one(`select count(*)::int n from p2p_mission_fields`)).n === 0);
  ok("all three appear in the moderator's bin", (await call("GET", "/admin/recycle-bin", U.M)).body.items.filter((i) => ["prayer_topic", "prayer_path", "mission_field"].includes(i.contentType)).length === 3);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`recycle bin routes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
