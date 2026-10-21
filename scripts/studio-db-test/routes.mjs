// End-to-end: the REAL API routes (routes/studio.ts, routes/kingdomStories.ts)
// and the REAL scheduler (lib/studio/runtime.ts) running against the REAL
// migrations 152 + 188 in PGlite (lab.mjs). Reads run AS service_role; every
// write runs AS the signed-in user (authenticated + auth.uid()), exactly as
// the API does with supabaseAsUser. Auth is synthetic (token = user id).
//
// Not covered: real PostgREST/HTTP behaviour of Supabase, real JWT
// verification, multi-connection concurrency.
//
// Run (same PGlite setup as run.mjs):
//   PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/studio-db-test/routes.mjs
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { USERS as U, WIN, setupBase } from "./setup.mjs";
import { bundleApp } from "./lab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const apiRoot = path.join(repo, "artifacts/api-server");
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const db = new PGlite();
const cat = await setupBase(db, readFileSync(path.join(repo, "migrations/152_kingdom_stories.sql"), "utf8"));
await db.exec(readFileSync(path.join(repo, "migrations/188_publishing_studio_foundation.sql"), "utf8"));
await db.exec(`insert into p2p_curriculums (title, status) values ('Foundations', 'published'), ('Draft plan', 'draft');
  insert into p2p_prayer_topics (title, status) values ('Peace', 'published'); insert into p2p_prayer_paths (title, status) values ('Psalm 23 path', 'draft');`);

const tmp = mkdtempSync(path.join(os.tmpdir(), "studio-routes-"));
const { app, runStudioScheduler } = await bundleApp({ apiRoot, tmpDir: tmp, db });
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}/api`;
const call = async (method, p, who, body, headers = {}) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${who}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const q = (sql, params) => db.query(sql, params);
const newStory = async (title) => (await q(`insert into p2p_kingdom_stories (title, category_id, body) values ($1, $2, 'Synthetic body.') returning id`, [title, cat])).rows[0].id;
const statusOf = async (id) => (await q(`select status from p2p_kingdom_stories where id=$1`, [id])).rows[0]?.status;
const itemCount = async () => Number((await q(`select count(*)::int n from p2p_studio_items`)).rows[0].n);
const future = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 16);
const sp = (id) => `/studio/items/kingdom_story/${id}`;
const approveVia = async (id) => {
  const s = await call("POST", `${sp(id)}/review`, U.A, { to: "in_review", version: 1 });
  return call("POST", `${sp(id)}/review`, U.B, { to: "approved", version: s.body.version });
};

try {
  const s1 = await newStory("Polycarp of Smyrna");
  const s2 = await newStory("The Moravian Prayer Watch");

  // Library: pagination, search, every content type.
  const page0 = await call("GET", "/studio/items?sourceType=kingdom_story&pageSize=1&page=0", U.M);
  const page1 = await call("GET", "/studio/items?sourceType=kingdom_story&pageSize=1&page=1", U.M);
  ok("library: paginated with total (API reads with SELECT-only grants)", page0.status === 200 && page0.body.total === 2 && page0.body.items.length === 1 && page1.body.items[0].sourceId !== page0.body.items[0].sourceId, JSON.stringify(page0.body).slice(0, 200));
  ok("library: search by title", (await call("GET", "/studio/items?sourceType=kingdom_story&q=moravian", U.M)).body.items.map((i) => i.title).join() === "The Moravian Prayer Watch");
  const cur = await call("GET", "/studio/items?sourceType=curriculum", U.M);
  ok("library: curriculum read-only from its own status", cur.status === 200 && cur.body.total === 2 && cur.body.editable === false && cur.body.manage.path === "/admin/curriculum" && cur.body.items.some((i) => i.nativeStatus === "published") && cur.body.items.some((i) => i.nativeStatus === "draft"));
  ok("library: curriculum filtered by status", (await call("GET", "/studio/items?sourceType=curriculum&status=published", U.M)).body?.total === 1);
  const topics = await call("GET", "/studio/items?sourceType=prayer_topic", U.M);
  ok("library: Pray the Word read-only, honest about no admin screen", topics.status === 200 && topics.body.total === 1 && topics.body.editable === false && topics.body.manage.path === null);
  const wins = await call("GET", "/studio/items?sourceType=kingdom_win", U.S);
  ok("library: Kingdom Wins read-only even for super_admin", wins.status === 200 && wins.body.editable === false && wins.body.items.length === 1);

  // H2 via the existing editor route.
  const p0 = await call("PUT", `/kingdom-stories/${s1}`, U.A, { status: "published" });
  ok("H2 e2e: editor Publish without approval → 409 'remains unpublished', still draft", p0.status === 409 && p0.body.studioRequired === true && /remains unpublished/.test(p0.body.error) && (await statusOf(s1)) === "draft", JSON.stringify(p0.body));

  // Review flow over HTTP into real SQL (as the signed-in users).
  const sub = await call("POST", `${sp(s1)}/review`, U.A, { to: "in_review", version: 1 });
  ok("e2e: submit for review", sub.status === 200 && sub.body.reviewState === "in_review" && sub.body.version === 2, JSON.stringify(sub.body));
  ok("e2e: submitted by the session user", (await q(`select submitted_by from p2p_studio_items where source_id=$1`, [s1])).rows[0].submitted_by === U.A);
  ok("e2e: submitter cannot approve", (await call("POST", `${sp(s1)}/review`, U.A, { to: "approved", version: 2 })).status === 403);
  ok("L9 e2e: missing version → 400", (await call("POST", `${sp(s1)}/review`, U.B, { to: "approved" })).status === 400);
  ok("L9 e2e: stale version → 409", (await call("POST", `${sp(s1)}/review`, U.B, { to: "approved", version: 1 })).status === 409);
  const queue = await call("GET", "/studio/review-queue?state=in_review", U.B);
  ok("review queue: lists in-review stories with context", queue.status === 200 && queue.body.total === 1 && queue.body.items[0].studio.submittedBy === U.A);
  const appr = await call("POST", `${sp(s1)}/review`, U.B, { to: "approved", version: 2, note: "Checked" });
  ok("e2e: second editor approves", appr.status === 200 && appr.body.reviewState === "approved");

  // Publish now from the Studio (immediate publication after approval).
  const pn = await call("POST", `${sp(s1)}/status`, U.A, { status: "published" });
  ok("e2e: Publish now after approval", pn.status === 200 && (await statusOf(s1)) === "published", JSON.stringify(pn.body));

  // Live story frozen via the existing editor routes.
  const liveEdit = await call("PUT", `/kingdom-stories/${s1}`, U.A, { body: "Silent change" });
  ok("LIVE e2e: editing a live story's text → 409 with guidance", liveEdit.status === 409 && liveEdit.body.code === "studio_live_edit_blocked" && /Unpublish it/.test(liveEdit.body.error));
  const liveMedia = await call("POST", `/kingdom-stories/${s1}/media`, U.A, { mediaType: "image", mediaPath: `${s1}/m/1.jpg` });
  ok("LIVE e2e: adding media to a live story → 409", liveMedia.status === 409 && liveMedia.body.code === "studio_live_edit_blocked");
  const liveSource = await call("POST", `/kingdom-stories/${s1}/sources`, U.A, { title: "Unreviewed source" });
  ok("LIVE e2e: adding a source to a live story → 409", liveSource.status === 409);
  ok("LIVE e2e: featuring a live story still works", (await call("PUT", `/kingdom-stories/${s1}`, U.A, { isFeatured: true })).status === 200);
  const unpub = await call("POST", `${sp(s1)}/status`, U.A, { status: "draft" });
  ok("e2e: unpublish (demotion) works and is audited", unpub.status === 200 && (await statusOf(s1)) === "draft"
    && (await q(`select count(*)::int n from p2p_studio_audit_log where action='story.status_changed' and source_id=$1`, [s1])).rows[0].n === 1);

  // H1 via HTTP: approve s2, edit, then publish refused; queue flags it.
  await approveVia(s2);
  const edit = await call("PUT", `/kingdom-stories/${s2}`, U.A, { body: "Rewritten after approval" });
  const approvedQueue = await call("GET", "/studio/review-queue?state=approved", U.B);
  ok("H1 e2e: review queue flags 'changed since approval'", edit.status === 200 && approvedQueue.body.items.find((i) => i.sourceId === s2)?.studio.approvalStale === true);
  const p2 = await call("PUT", `/kingdom-stories/${s2}`, U.A, { status: "published" });
  ok("H1 e2e: edited after approval → publish refused with re-review message", p2.status === 409 && /changed after it was approved/.test(p2.body.error) && (await statusOf(s2)) === "draft");
  ok("H1 e2e: Publish now refused the same way", (await call("POST", `${sp(s2)}/status`, U.A, { status: "published" })).status === 409);

  // M3 over HTTP: nothing created by refused requests.
  const before = await itemCount();
  const r1 = await call("POST", `${sp(s2)}/schedules`, U.M, { action: "archive", localTime: future, timezone: "UTC" }, { "Idempotency-Key": "key-e2e-mod-01" });
  const r2 = await call("POST", `/studio/items/kingdom_win/${WIN}/schedules`, U.S, { action: "archive", localTime: future, timezone: "UTC" }, { "Idempotency-Key": "key-e2e-win-01" });
  const r3 = await call("POST", `/studio/items/kingdom_win/${WIN}/review`, U.S, { to: "in_review", version: 1 });
  const r3b = await call("POST", `/studio/items/kingdom_win/${WIN}/status`, U.S, { status: "published" });
  const s3 = await newStory("The Welsh Revival of 1904");
  const r4 = await call("POST", `${sp(s3)}/schedules`, U.A, { action: "publish", localTime: future, timezone: "UTC" }, { "Idempotency-Key": "key-e2e-pub-01" });
  ok("M3 e2e: moderator / Kingdom Win (super_admin) / unapproved publish all refused", [r1, r2, r3, r3b, r4].every((r) => r.status === 403), [r1, r2, r3, r3b, r4].map((r) => r.status).join(","));
  ok("M3 e2e: refused requests created no Studio records", (await itemCount()) === before);

  // Ambiguous DST time must be resolved explicitly.
  const amb = await call("POST", `${sp(s3)}/schedules`, U.A, { action: "archive", localTime: "2026-10-25T01:30", timezone: "Europe/London" }, { "Idempotency-Key": "key-e2e-amb-01" });
  ok("e2e: ambiguous local time without a choice → 400", amb.status === 400 && amb.body.code === "ambiguous_local_time");
  const ambOk = await call("POST", `${sp(s3)}/schedules`, U.A, { action: "archive", localTime: "2026-10-25T01:30", timezone: "Europe/London", fold: "later" }, { "Idempotency-Key": "key-e2e-amb-02" });
  ok("e2e: ambiguous local time with explicit choice → stored as that instant (UTC)", ambOk.status === 201 && new Date(ambOk.body.schedule.run_at).toISOString() === "2026-10-25T01:30:00.000Z", JSON.stringify(ambOk.body).slice(0, 200));
  await call("POST", `/studio/schedules/${ambOk.body.schedule.id}/cancel`, U.A);

  // Scheduling + the real scheduler.
  await approveVia(s3);
  const sc = await call("POST", `${sp(s3)}/schedules`, U.B, { action: "publish", localTime: future, timezone: "Europe/London" }, { "Idempotency-Key": "key-e2e-sch-01" });
  const replay = await call("POST", `${sp(s3)}/schedules`, U.B, { action: "publish", localTime: future, timezone: "Europe/London" }, { "Idempotency-Key": "key-e2e-sch-01" });
  const otherUser = await call("POST", `${sp(s3)}/schedules`, U.A, { action: "publish", localTime: future, timezone: "Europe/London" }, { "Idempotency-Key": "key-e2e-sch-01" });
  ok("e2e: schedule created; same user replays; another user's reuse refused", sc.status === 201 && replay.status === 200 && replay.body.replayed && replay.body.schedule.id === sc.body.schedule.id && otherUser.status === 409);
  await q(`update p2p_studio_schedules set next_attempt_at = now() - interval '1 second' where id=$1`, [sc.body.schedule.id]);
  process.env.STUDIO_SCHEDULER_ENABLED = "true"; // in this test process only
  const run = await runStudioScheduler();
  delete process.env.STUDIO_SCHEDULER_ENABLED;
  ok("e2e: real scheduler publishes the approved story", run?.succeeded === 1 && (await statusOf(s3)) === "published", JSON.stringify(run));
  ok("e2e: scheduler stays off without the flag", (await runStudioScheduler()) === null);

  // Overview / calendar / media / analytics / settings / audit.
  const ov = await call("GET", "/studio/overview?tz=Europe/London", U.M);
  ok("overview: real counts, no audit activity for a non-auditor", ov.status === 200 && ov.body.stories.published === 1 && ov.body.review.approved >= 1 && ov.body.activity === null, JSON.stringify(ov.body).slice(0, 300));
  const ovA = await call("GET", "/studio/overview?tz=Europe/London", U.V);
  ok("overview: recent activity for an auditor", Array.isArray(ovA.body.activity) && ovA.body.activity.length > 0);
  const now = Date.now();
  const calRes = await call("GET", `/studio/calendar?from=${new Date(now - 7 * 864e5).toISOString()}&to=${new Date(now + 30 * 864e5).toISOString()}`, U.M);
  ok("calendar: scheduled jobs and publications in range", calRes.status === 200 && calRes.body.events.some((e) => e.kind === "schedule" && e.title === "The Welsh Revival of 1904") && calRes.body.events.some((e) => e.kind === "published"));
  ok("calendar: range limited", (await call("GET", `/studio/calendar?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z`, U.M)).status === 400);
  await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path, caption) values ($1, 'image', $2, 'Cover')`, [s2, `${s2}/m/cover.jpg`]);
  const media = await call("GET", "/studio/media", U.M);
  ok("media: lists story media with story context, no storage URLs", media.status === 200 && media.body.total === 1 && media.body.items[0].storyTitle === "The Moravian Prayer Watch" && !("mediaPath" in media.body.items[0]));
  const an = await call("GET", "/studio/analytics", U.M);
  ok("analytics: canonical counts only, unmeasured things listed", an.status === 200 && an.body.publishedByMonth.length >= 1 && an.body.notMeasured.includes("Story views and reads"));
  const set = await call("GET", "/studio/settings", U.M);
  ok("settings: scheduler reported off, roles listed", set.status === 200 && set.body.schedulerEnabled === false && set.body.roles.edit.includes("admin_content"));
  ok("audit: moderator refused", (await call("GET", "/studio/audit", U.M)).status === 403);
  const aud = await call("GET", "/studio/audit?action=review", U.V);
  ok("audit: supervisor reads, filtered by action family", aud.status === 200 && aud.body.total > 0 && aud.body.entries.every((e) => e.action.startsWith("review.")));
  const audItem = await call("GET", `/studio/audit?sourceType=kingdom_story&sourceId=${s3}`, U.A);
  const actions = (audItem.body?.entries ?? []).map((e) => e.action);
  ok("audit: per-story trail complete (editor can read)", audItem.status === 200
    && ["review.in_review", "review.approved", "schedule.created", "story.published", "schedule.executed"].every((a) => actions.includes(a)), actions.join(","));

  // Cancel.
  const s4 = await newStory("Hudson Taylor");
  const sc4 = await call("POST", `${sp(s4)}/schedules`, U.A, { action: "archive", localTime: future, timezone: "UTC" }, { "Idempotency-Key": "key-e2e-can-01" });
  ok("e2e: moderator cannot cancel", (await call("POST", `/studio/schedules/${sc4.body.schedule.id}/cancel`, U.M)).status === 403);
  ok("e2e: editor cancels", (await call("POST", `/studio/schedules/${sc4.body.schedule.id}/cancel`, U.A)).body?.cancelled === true);
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
  await db.close();
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
