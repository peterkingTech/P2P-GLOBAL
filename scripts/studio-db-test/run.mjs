// Database tests for migration 188 (Publishing Studio), run against a real
// PostgreSQL engine in-process (PGlite) — never against a live database.
//
//   1. setup.mjs stubs what Supabase provides (anon/authenticated/service_role
//      roles, auth.uid(), auth.users, storage tables, Supabase-style DEFAULT
//      PRIVILEGES) and the tables migration 152 references, then applies the
//      REAL migrations/152_kingdom_stories.sql.
//   2. Applies migrations/188_publishing_studio_foundation.sql (twice).
//   3. Runs named checks: grants/RLS, identity (actor from auth.uid(), service
//      key cannot act as a user), the universal publication gate, approval
//      bound to content, the live-story freeze, atomic audit, permission
//      before write, versions, the audit sequence, scheduling with claim
//      tokens (incl. a stale-worker hand-over), audit immutability.
//   4. NEGATIVE PROOF: re-runs the suite on deliberately broken copies of 188
//      and requires the matching check to FAIL.
//
// NOT proven here: PGlite is ONE connection — two workers cannot truly run
// in parallel, so SKIP LOCKED contention is not exercised (the stale-worker
// test interleaves two workers' calls step by step instead). Supabase's real
// PostgREST, JWT handling and role setup are stand-ins.
//
// PGlite is NOT a project dependency. To run:
//   mkdir /tmp/pglite && cd /tmp/pglite && npm i @electric-sql/pglite@0.5.8
//   PGLITE_MODULE=/tmp/pglite/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/studio-db-test/run.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { USERS as U, WIN, setupBase } from "./setup.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const M152 = readFileSync(path.resolve(here, "../../migrations/152_kingdom_stories.sql"), "utf8");
const M188 = readFileSync(path.resolve(here, "../../migrations/188_publishing_studio_foundation.sql"), "utf8");
const modPath = process.env.PGLITE_MODULE;
if (!modPath) { console.error("Set PGLITE_MODULE (see header)."); process.exit(2); }
const { PGlite } = await import(pathToFileURL(modPath).href);

async function runSuite(m188) {
  const db = new PGlite();
  const results = new Map();
  const ok = (name, cond, detail = "") => { results.set(name, { pass: !!cond, detail: cond ? "" : String(detail) }); };
  const q = (sql, params) => db.query(sql, params);
  const as = async (role, uid, sql, params) => {
    await db.exec(`set test.uid = '${uid ?? ""}'; set role ${role};`);
    try { return await db.query(sql, params); } finally { await db.exec("reset role;"); }
  };
  const err = async (fn) => { try { await fn(); return null; } catch (e) { return { code: e.code, message: e.message }; } };
  const callAs = async (role, uid, fn, args) => (await as(role, uid, `select ${fn}(${args.map((_, i) => `$${i + 1}`).join(", ")}) as r`, args)).rows[0].r;
  const user = (uid, fn, args) => callAs("authenticated", uid, fn, args);      // a signed-in user, as themselves
  const svcCall = (fn, args) => callAs("service_role", null, fn, args);         // the API's service role
  const svc = (sql, params) => as("service_role", null, sql, params);
  const review = (story, to, version, actor, note = null) => user(actor, "p2p_studio_review_transition", ["kingdom_story", story, to, version, note]);
  const itemOf = async (story) => (await q(`select * from p2p_studio_items where source_type='kingdom_story' and source_id=$1`, [story])).rows[0] ?? null;
  const statusOf = async (story) => (await q(`select status from p2p_kingdom_stories where id=$1`, [story])).rows[0]?.status;
  const auditCount = async (action, story) => Number((await q(`select count(*)::int n from p2p_studio_audit_log where action=$1 and ($2::uuid is null or source_id=$2)`, [action, story ?? null])).rows[0].n);
  const runAt = async () => (await q(`select (now() + interval '2 days')::timestamptz t`)).rows[0].t.toISOString();
  let cat;
  const newStory = async (o = {}) => (await q(
    `insert into p2p_kingdom_stories (title, category_id, body, status, content_type, scripture_reference_id) values ($1,$2,$3,$4,$5,$6) returning id`,
    [o.title ?? "Synthetic story", cat, o.body ?? "Synthetic body.", o.status ?? "draft", o.contentType ?? "historical_story", o.scripture ?? null])).rows[0].id;
  const approve = async (story, submitter = U.A, approver = U.B) => {
    const s = await review(story, "in_review", (await itemOf(story))?.version ?? 1, submitter);
    return review(story, "approved", s.version, approver);
  };
  const setStatus = (story, status, actor) => user(actor, "p2p_kingdom_story_set_status", [story, status]);
  const createSchedule = async (story, action, key, actor, sourceType = "kingdom_story") =>
    user(actor, "p2p_studio_create_schedule", [sourceType, story, action, await runAt(), "2026-12-01T09:00", "UTC", key]);
  const makeDue = (id) => q(`update p2p_studio_schedules set next_attempt_at = now() - interval '1 second' where id=$1`, [id]);
  const claim = async (stale = 600) => (await svc(`select id, claim_token from p2p_studio_claim_due_jobs(10, ${stale})`)).rows;
  const runJob = (id, token) => svcCall("p2p_studio_run_job", [id, token]);
  const finishJob = (id, token, retry, next, error) => svcCall("p2p_studio_finish_job", [id, token, retry, next, error]);
  const injectAuditFailure = (action) => db.exec(`
    create or replace function test_fail_audit() returns trigger language plpgsql as $f$
    begin if new.action = '${action}' then raise exception 'injected audit failure'; end if; return new; end $f$;
    drop trigger if exists test_fail_audit on p2p_studio_audit_log;
    create trigger test_fail_audit before insert on p2p_studio_audit_log for each row execute function test_fail_audit();`);
  const clearAuditFailure = () => db.exec(`drop trigger if exists test_fail_audit on p2p_studio_audit_log;`);

  cat = await setupBase(db, M152);
  const preExisting = await newStory({ title: "Published before 188", status: "published" });

  try { await db.exec(m188); ok("migration applies", true); } catch (e) { ok("migration applies", false, e.message); await db.close(); return results; }
  try { await db.exec(m188); ok("migration re-applies cleanly", true); } catch (e) { ok("migration re-applies cleanly", false, e.message); }

  // ── Grants / RLS ─────────────────────────────────────────────────────────
  ok("RLS on all three Studio tables", (await q(`select count(*)::int n from pg_class where relname in ('p2p_studio_items','p2p_studio_schedules','p2p_studio_audit_log') and relrowsecurity`)).rows[0].n === 3);
  ok("anon cannot read Studio items", /permission denied/.test((await err(() => as("anon", null, "select * from p2p_studio_items")))?.message ?? ""));
  ok("authenticated cannot write Studio items", /permission denied/.test((await err(() => as("authenticated", U.A, `insert into p2p_studio_items (source_type, source_id) values ('kingdom_story', gen_random_uuid())`)))?.message ?? ""));
  for (const [t, col] of [["p2p_studio_items", "version"], ["p2p_studio_schedules", "attempts"], ["p2p_studio_audit_log", "action"]]) {
    ok(`service role has SELECT only on ${t}`, /permission denied/.test((await err(() => svc(`delete from ${t}`)))?.message ?? "")
      && /permission denied/.test((await err(() => svc(`update ${t} set ${col} = ${col}`)))?.message ?? "")
      && !(await err(() => svc(`select count(*) from ${t}`))));
  }
  ok("service role cannot insert audit rows directly", /permission denied/.test((await err(() => svc(`insert into p2p_studio_audit_log (action) values ('forged')`)))?.message ?? ""));
  const seq = (await q(`select pg_get_serial_sequence('public.p2p_studio_audit_log', 'id') s`)).rows[0].s;
  ok("audit id sequence is p2p_studio_audit_log_id_seq", seq === "public.p2p_studio_audit_log_id_seq", seq);
  ok("client roles cannot use the audit id sequence",
    /permission denied/.test((await err(() => as("authenticated", U.A, `select nextval('public.p2p_studio_audit_log_id_seq')`)))?.message ?? "")
    && /permission denied/.test((await err(() => as("anon", null, `select nextval('public.p2p_studio_audit_log_id_seq')`)))?.message ?? "")
    && /permission denied/.test((await err(() => svc(`select nextval('public.p2p_studio_audit_log_id_seq')`)))?.message ?? ""));
  ok("nobody but the owner can call the internal audit function", /permission denied/.test((await err(() => svc(`select p2p_studio_audit(null, 'x', 'forged', null, null, null, '{}')`)))?.message ?? "")
    && /permission denied/.test((await err(() => as("authenticated", U.S, `select p2p_studio_audit(null, 'x', 'forged', null, null, null, '{}')`)))?.message ?? ""));
  ok("internal fingerprint function not callable by API/clients", /permission denied/.test((await err(() => svc(`select p2p_kingdom_story_fingerprint(s) from p2p_kingdom_stories s limit 1`)))?.message ?? ""));
  ok("anon cannot call Studio write functions", /permission denied/.test((await err(() => as("anon", null, `select p2p_kingdom_story_set_status(gen_random_uuid(), 'published')`)))?.message ?? ""));
  ok("clients cannot call scheduler functions", /permission denied/.test((await err(() => as("authenticated", U.S, `select * from p2p_studio_claim_due_jobs(10)`)))?.message ?? ""));

  // ── Identity: actor is the verified session, never a parameter ───────────
  const id1 = await newStory();
  ok("identity: service role cannot call editorial functions (cannot act as a user)",
    /permission denied/.test((await err(() => svcCall("p2p_studio_review_transition", ["kingdom_story", id1, "in_review", 1, null])))?.message ?? "")
    && /permission denied/.test((await err(() => svcCall("p2p_kingdom_story_set_status", [id1, "published"])))?.message ?? ""));
  ok("identity: signed-in role without a user id is refused", (await err(() => user(null, "p2p_studio_review_transition", ["kingdom_story", id1, "in_review", 1, null])))?.code === "S0401");
  const idr = await review(id1, "in_review", 1, U.A);
  ok("identity: the recorded actor is the session user", (await itemOf(id1)).submitted_by === U.A && idr.version === 2
    && (await q(`select actor_id, actor_role from p2p_studio_audit_log where action='review.in_review' and source_id=$1`, [id1])).rows[0]?.actor_id === U.A);

  // ── H2: universal publication gate ───────────────────────────────────────
  const s1 = await newStory();
  ok("H2: owner/SQL publish without approval blocked", (await err(() => q(`update p2p_kingdom_stories set status='published' where id=$1`, [s1])))?.code === "S0423");
  ok("H2: service-role direct publish without approval blocked", (await err(() => svc(`update p2p_kingdom_stories set status='published' where id=$1`, [s1])))?.code === "S0423");
  ok("H2: signed-in editor direct (PostgREST-style) publish blocked", (await err(() => as("authenticated", U.A, `update p2p_kingdom_stories set status='published' where id=$1`, [s1])))?.code === "S0423");
  ok("H2: creating a story already published is blocked", (await err(() => as("authenticated", U.A, `insert into p2p_kingdom_stories (title, category_id, body, status) values ('x', $1, 'y', 'published')`, [cat])))?.code === "S0423");
  ok("H2: existing editor path (set_status) blocked without approval", (await err(() => setStatus(s1, "published", U.A)))?.code === "S0423");
  ok("H2: story stays unpublished after all refused attempts", (await statusOf(s1)) === "draft");
  ok("H2: non-editor cannot change status at all", (await err(() => setStatus(s1, "review", U.M)))?.code === "S0403");
  ok("H2: drafts/review moves remain allowed", !(await err(() => setStatus(s1, "review", U.A))) && !(await err(() => setStatus(s1, "draft", U.A))));

  const s2 = await newStory();
  await approve(s2, U.A, U.B);
  const before = await auditCount("story.published", s2);
  ok("H2: approved by a second editor → editor path publishes", !(await err(() => setStatus(s2, "published", U.B))) && (await statusOf(s2)) === "published");
  const pubAudit = (await q(`select actor_id, details from p2p_studio_audit_log where action='story.published' and source_id=$1 order by id desc limit 1`, [s2])).rows[0];
  ok("H2: publication audited with actor and path", (await auditCount("story.published", s2)) === before + 1 && pubAudit?.actor_id === U.B && pubAudit?.details.path === "editor");

  const s3 = await newStory();
  const sub3 = await review(s3, "in_review", 1, U.A);
  ok("H2/four-eyes: submitter cannot approve own submission", (await err(() => review(s3, "approved", sub3.version, U.A)))?.code === "S0403");
  const s3b = await newStory();
  const subS = await review(s3b, "in_review", 1, U.S);
  ok("H2: super_admin may approve own submission (documented exception) and publish", !(await err(() => review(s3b, "approved", subS.version, U.S))) && !(await err(() => setStatus(s3b, "published", U.S))));

  const s4 = await newStory();
  await approve(s4, U.A, U.B);
  await q(`update p2p_studio_items set reviewed_by = submitted_by where source_id = $1`, [s4]); // forged self-approval
  ok("H2: gate validates reviewer independence (forged self-approval blocked)", (await err(() => setStatus(s4, "published", U.A)))?.message === "studio_four_eyes");

  const s5 = await newStory();
  await approve(s5, U.A, U.C);
  await q(`update p2p_profiles set role='student' where id=$1`, [U.C]);
  ok("H2: approval by a reviewer who lost the role no longer publishes", (await err(() => setStatus(s5, "published", U.A)))?.message === "studio_reviewer_ineligible");
  await q(`update p2p_profiles set role='admin_content' where id=$1`, [U.C]);

  const s6 = await newStory();
  await approve(s6, U.A, U.B);
  ok("H2: approved story published directly by a signed-in editor → allowed and audited to that editor",
    !(await err(() => as("authenticated", U.B, `update p2p_kingdom_stories set status='published' where id=$1`, [s6])))
    && (await q(`select actor_id from p2p_studio_audit_log where action='story.published' and source_id=$1`, [s6])).rows[0]?.actor_id === U.B);

  ok("H2: stories already published before 188 keep status and content", (await statusOf(preExisting)) === "published"
    && (await q(`select body from p2p_kingdom_stories where id=$1`, [preExisting])).rows[0].body === "Synthetic body.");
  ok("H2: unpublish/archive are not gated, and are audited", !(await err(() => setStatus(s2, "archived", U.A))) && (await statusOf(s2)) === "archived"
    && (await q(`select details from p2p_studio_audit_log where action='story.status_changed' and source_id=$1 order by id desc limit 1`, [s2])).rows[0]?.details.to === "archived");

  // ── H1: approval bound to content ────────────────────────────────────────
  const h1 = await newStory();
  await approve(h1, U.A, U.B);
  await q(`update p2p_kingdom_stories set body = 'Changed after approval' where id=$1`, [h1]);
  ok("H1: body edited after approval → publish refused (stale)", (await err(() => setStatus(h1, "published", U.B)))?.message === "studio_approval_stale");
  ok("H1: stale approval reported by the read-only lookup", (await svc(`select * from p2p_studio_stale_approvals(array[$1]::uuid[])`, [h1])).rows.length === 1);
  const h1r = await newStory();
  await approve(h1r, U.A, U.B);
  await q(`insert into p2p_scripture_references values ('33333333-3333-4333-8333-000000000099') on conflict do nothing`);
  await q(`update p2p_kingdom_stories set scripture_reference_id = '33333333-3333-4333-8333-000000000099' where id=$1`, [h1r]);
  ok("H1: Scripture reference changed after approval → publish refused", (await err(() => setStatus(h1r, "published", U.B)))?.message === "studio_approval_stale");
  const h1m = await newStory();
  await approve(h1m, U.A, U.B);
  await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path) values ($1, 'image', $2)`, [h1m, `${h1m}/x/a.jpg`]);
  ok("H1: media added after approval → publish refused", (await err(() => setStatus(h1m, "published", U.B)))?.message === "studio_approval_stale");
  const h1s = await newStory();
  await approve(h1s, U.A, U.B);
  await q(`insert into p2p_kingdom_story_sources (story_id, title) values ($1, 'Unreviewed source')`, [h1s]);
  ok("H1: source added after approval → publish refused", (await err(() => setStatus(h1s, "published", U.B)))?.message === "studio_approval_stale");
  const h1one = await newStory();
  await approve(h1one, U.A, U.B);
  ok("H1: content change and publish in ONE statement refused", (await err(() => as("authenticated", U.B, `update p2p_kingdom_stories set body='swap', status='published' where id=$1`, [h1one])))?.message === "studio_approval_stale"
    && (await q(`select body from p2p_kingdom_stories where id=$1`, [h1one])).rows[0].body !== "swap");
  const h1f = await newStory();
  await approve(h1f, U.A, U.B);
  await q(`update p2p_kingdom_stories set is_featured = true where id=$1`, [h1f]);
  ok("H1: featuring (not content) does not invalidate approval", !(await err(() => setStatus(h1f, "published", U.B))));
  const h1sc = await newStory({ contentType: "scripture_story" });
  await approve(h1sc, U.A, U.B);
  ok("H1: Scripture Story without a reference cannot publish", (await err(() => setStatus(h1sc, "published", U.B)))?.message === "scripture_reference_required");

  // ── Live stories are frozen ──────────────────────────────────────────────
  const live = await newStory({ title: "Live story" });
  await approve(live, U.A, U.B);
  await setStatus(live, "published", U.B);
  ok("LIVE: body edit of a published story blocked (owner, API, editor)",
    (await err(() => q(`update p2p_kingdom_stories set body='x' where id=$1`, [live])))?.message === "studio_live_edit_blocked"
    && (await err(() => svc(`update p2p_kingdom_stories set title='x' where id=$1`, [live])))?.message === "studio_live_edit_blocked"
    && (await err(() => as("authenticated", U.A, `update p2p_kingdom_stories set reflection='x' where id=$1`, [live])))?.message === "studio_live_edit_blocked");
  ok("LIVE: media of a published story cannot be added", (await err(() => q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path) values ($1, 'image', $2)`, [live, `${live}/m/1.jpg`])))?.message === "studio_live_edit_blocked");
  ok("LIVE: sources of a published story cannot be added", (await err(() => q(`insert into p2p_kingdom_story_sources (story_id, title) values ($1, 'x')`, [live])))?.message === "studio_live_edit_blocked");
  ok("LIVE: non-content field (is_featured) can still change", !(await err(() => q(`update p2p_kingdom_stories set is_featured = true where id=$1`, [live]))));
  ok("LIVE: pre-188 published story is protected too", (await err(() => q(`update p2p_kingdom_stories set body='x' where id=$1`, [preExisting])))?.message === "studio_live_edit_blocked");
  const liveM = await newStory({ title: "Live with media" });
  await q(`insert into p2p_kingdom_story_media (story_id, media_type, media_path) values ($1, 'image', $2)`, [liveM, `${liveM}/m/1.jpg`]);
  await q(`insert into p2p_kingdom_story_sources (story_id, title) values ($1, 'A source')`, [liveM]);
  await approve(liveM, U.A, U.B);
  await setStatus(liveM, "published", U.B);
  ok("LIVE: media/sources of a published story cannot be edited or removed",
    (await err(() => q(`update p2p_kingdom_story_media set caption='x' where story_id=$1`, [liveM])))?.message === "studio_live_edit_blocked"
    && (await err(() => q(`delete from p2p_kingdom_story_media where story_id=$1`, [liveM])))?.message === "studio_live_edit_blocked"
    && (await err(() => q(`delete from p2p_kingdom_story_sources where story_id=$1`, [liveM])))?.message === "studio_live_edit_blocked");
  ok("LIVE: unpublish → edit → re-review → publish works", await (async () => {
    await setStatus(live, "draft", U.A);
    await q(`update p2p_kingdom_stories set body='Corrected text' where id=$1`, [live]);
    if ((await err(() => setStatus(live, "published", U.B)))?.message !== "studio_approval_stale") return false; // old approval no longer matches
    const it = await itemOf(live);
    const back = await review(live, "draft", it.version, U.A);
    await approve(live, U.A, U.B);
    return !(await err(() => setStatus(live, "published", U.B))) && back.reviewState === "draft";
  })());
  ok("LIVE: deleting a published story (with media) works and is audited", !(await err(() => q(`delete from p2p_kingdom_stories where id=$1`, [liveM])))
    && (await auditCount("story.deleted", liveM)) === 1 && Number((await q(`select count(*)::int n from p2p_kingdom_story_media where story_id=$1`, [liveM])).rows[0].n) === 0);

  // ── Scheduler: approval re-check, claim tokens, retries ──────────────────
  const sch = await newStory();
  const ap = await approve(sch, U.A, U.B);
  const job = (await createSchedule(sch, "publish", "key-h1-job-0001", U.B)).schedule;
  ok("schedule rows never expose the claim token", job.claim_token === undefined);
  await q(`update p2p_kingdom_stories set title = 'Retitled after approval' where id=$1`, [sch]);
  await makeDue(job.id);
  const c0 = await claim();
  const out = await runJob(job.id, c0.find((r) => r.id === job.id)?.claim_token);
  const itemAfter = await itemOf(sch);
  ok("H1: scheduled publish of changed content refused at execution", out.outcome === "failed" && out.reason === "changed_since_approval" && (await statusOf(sch)) === "draft", JSON.stringify(out));
  ok("H1: approval revoked (re-review required) and audited", itemAfter.review_state === "draft" && itemAfter.approved_fingerprint === null
    && (await auditCount("review.invalidated", sch)) === 1 && (await auditCount("schedule.failed", sch)) === 1 && ap.version < itemAfter.version);

  const ok1 = await newStory();
  await approve(ok1, U.A, U.B);
  const j2 = (await createSchedule(ok1, "publish", "key-ok-job-0001", U.B)).schedule;
  await makeDue(j2.id);
  const first = await claim();
  const again = await claim();
  const tok = first.find((r) => r.id === j2.id)?.claim_token;
  const r2 = await runJob(j2.id, tok);
  ok("scheduler: claimed once, published, job succeeded, audited together", first.length === 1 && again.length === 0 && r2.outcome === "succeeded" && (await statusOf(ok1)) === "published"
    && (await auditCount("schedule.executed", ok1)) === 1 && (await auditCount("story.published", ok1)) === 1, JSON.stringify(r2));
  ok("scheduler: running a finished job again does nothing (no duplicate audit)", (await runJob(j2.id, tok)).outcome === "not_running" && (await auditCount("schedule.executed", ok1)) === 1);

  // Two workers, interleaved step by step: A claims, A stalls past the lease,
  // B re-claims; A's late run and late finish are refused; B completes once.
  const tw = await newStory();
  await approve(tw, U.A, U.B);
  const j3 = (await createSchedule(tw, "publish", "key-two-worker-01", U.B)).schedule;
  await makeDue(j3.id);
  const tokA = (await claim()).find((r) => r.id === j3.id)?.claim_token;
  await q(`update p2p_studio_schedules set locked_at = now() - interval '20 minutes' where id=$1`, [j3.id]); // worker A stalled
  const tokB = (await claim(600)).find((r) => r.id === j3.id)?.claim_token;
  const lateA = await runJob(j3.id, tokA);
  const lateFinishA = await finishJob(j3.id, tokA, true, null, "late");
  const runB = await runJob(j3.id, tokB);
  ok("scheduler: stale worker cannot run or finish a job it no longer owns", !!tokA && !!tokB && tokA !== tokB && lateA.outcome === "not_running" && lateFinishA === false
    && runB.outcome === "succeeded" && (await auditCount("schedule.executed", tw)) === 1 && (await auditCount("story.published", tw)) === 1, JSON.stringify({ lateA, lateFinishA, runB }));

  const j4s = await newStory();
  const j4 = (await createSchedule(j4s, "archive", "key-retry-0001", U.A)).schedule;
  await makeDue(j4.id);
  const t4 = (await claim()).find((r) => r.id === j4.id)?.claim_token;
  const fin = await finishJob(j4.id, t4, true, new Date(Date.now() + 60000).toISOString(), "timeout");
  ok("scheduler: retry recorded with audit, back to pending", fin === true && (await q(`select status, claim_token from p2p_studio_schedules where id=$1`, [j4.id])).rows[0].status === "pending" && (await auditCount("schedule.retry", j4s)) === 1);
  ok("scheduler: bounded attempts → final failure", await (async () => {
    await q(`update p2p_studio_schedules set attempts = max_attempts, next_attempt_at = now() - interval '1 second' where id=$1`, [j4.id]);
    const t = (await claim()).find((r) => r.id === j4.id)?.claim_token;
    const r = await runJob(j4.id, t);
    return r.outcome === "failed" && r.reason === "attempts_exhausted";
  })());
  const wd = await newStory();
  const wda = await approve(wd, U.A, U.B);
  await createSchedule(wd, "publish", "key-withdraw-01", U.B);
  ok("scheduler: approval withdrawn → pending publish cancelled", (await review(wd, "draft", wda.version, U.A)).cancelledPublishSchedules === 1);

  // ── M4: atomic action + audit ────────────────────────────────────────────
  const m4 = await newStory();
  const sub = await review(m4, "in_review", 1, U.A);
  await injectAuditFailure("review.approved");
  const e1 = await err(() => review(m4, "approved", sub.version, U.B));
  await clearAuditFailure();
  const m4item = await itemOf(m4);
  ok("M4: audit failure rolls back the review decision", !!e1 && m4item.review_state === "in_review" && m4item.version === sub.version && m4item.approved_fingerprint === null, e1?.message);
  ok("M4: successful decision and its audit row commit together", !(await err(() => review(m4, "approved", sub.version, U.B))) && (await auditCount("review.approved", m4)) === 1);

  const m4s = await newStory();
  await injectAuditFailure("schedule.created");
  const e2 = await err(() => createSchedule(m4s, "archive", "key-m4-sched-01", U.A));
  await clearAuditFailure();
  ok("M4: audit failure rolls back schedule creation (no job, no item)", !!e2 && (await itemOf(m4s)) === null
    && Number((await q(`select count(*)::int n from p2p_studio_schedules where idempotency_key='key-m4-sched-01'`)).rows[0].n) === 0);

  const m4p = await newStory();
  await approve(m4p, U.A, U.B);
  await injectAuditFailure("story.published");
  const e3 = await err(() => setStatus(m4p, "published", U.B));
  await clearAuditFailure();
  ok("M4: audit failure rolls back the publication itself", !!e3 && (await statusOf(m4p)) === "draft");

  const m4d = await newStory();
  await injectAuditFailure("story.deleted");
  const e3d = await err(() => q(`delete from p2p_kingdom_stories where id=$1`, [m4d]));
  await clearAuditFailure();
  ok("M4: audit failure rolls back a story deletion", !!e3d && (await statusOf(m4d)) === "draft");

  const m4j = await newStory();
  await approve(m4j, U.A, U.B);
  const jj = (await createSchedule(m4j, "publish", "key-m4-job-0001", U.B)).schedule;
  await makeDue(jj.id);
  const tj = (await claim()).find((r) => r.id === jj.id)?.claim_token;
  await injectAuditFailure("schedule.executed");
  const e4 = await err(() => runJob(jj.id, tj));
  await clearAuditFailure();
  ok("M4: audit failure rolls back a scheduled publish (story and job unchanged)", !!e4 && (await statusOf(m4j)) === "draft"
    && (await q(`select status from p2p_studio_schedules where id=$1`, [jj.id])).rows[0].status === "running");

  // ── M3: permission before any write ──────────────────────────────────────
  const m3 = await newStory();
  const itemsBefore = Number((await q(`select count(*)::int n from p2p_studio_items`)).rows[0].n);
  ok("M3: Kingdom Win cannot be scheduled even by super_admin", (await err(() => createSchedule(WIN, "archive", "key-m3-win-0001", U.S, "kingdom_win")))?.code === "S0403");
  ok("M3: Kingdom Win cannot be reviewed even by super_admin", (await err(() => user(U.S, "p2p_studio_review_transition", ["kingdom_win", WIN, "in_review", 1, null])))?.code === "S0403");
  ok("M3: non-editor role cannot schedule (and creates nothing)", (await err(() => createSchedule(m3, "archive", "key-m3-mod-0001", U.M)))?.code === "S0403");
  ok("M3: non-editor role cannot review", (await err(() => review(m3, "in_review", 1, U.V)))?.code === "S0403");
  ok("M3: publish schedule without approval refused before creating anything", (await err(() => createSchedule(m3, "publish", "key-m3-pub-0001", U.A)))?.code === "S0403");
  ok("M3: refused requests created no Studio records", Number((await q(`select count(*)::int n from p2p_studio_items`)).rows[0].n) === itemsBefore);
  ok("M3: permitted request (editor archive schedule) does create its record", !(await err(() => createSchedule(m3, "archive", "key-m3-arc-0001", U.A))) && (await itemOf(m3)) !== null);

  // ── L9: versions ─────────────────────────────────────────────────────────
  const l9 = await newStory();
  const l9a = await review(l9, "in_review", 1, U.A);
  const auditN = await auditCount("review.approved", l9);
  ok("L9: missing version rejected", (await err(() => review(l9, "approved", null, U.B)))?.code === "S0422");
  const staleErr = await err(() => review(l9, "approved", l9a.version - 1, U.B));
  ok("L9: stale version rejected without mutation", staleErr?.code === "S0409"
    && (await itemOf(l9)).review_state === "in_review" && (await itemOf(l9)).version === l9a.version && (await auditCount("review.approved", l9)) === auditN, staleErr?.message);

  // ── Idempotency / cancel ─────────────────────────────────────────────────
  const idm = await newStory();
  const firstS = await createSchedule(idm, "archive", "key-idem-00001", U.A);
  const againS = await createSchedule(idm, "archive", "key-idem-00001", U.A);
  ok("idempotency: same request by the same user replays the same job", againS.replayed === true && againS.schedule.id === firstS.schedule.id);
  ok("idempotency: same key from a different user refused", (await err(() => createSchedule(idm, "archive", "key-idem-00001", U.B)))?.code === "S0409");
  ok("idempotency: key reused for a different item refused", (await err(() => createSchedule(m3, "unpublish", "key-idem-00001", U.A)))?.code === "S0409");
  ok("idempotency: second live job for same action refused", (await err(() => createSchedule(idm, "archive", "key-idem-00002", U.A)))?.code === "S0409");
  ok("cancel: non-editor refused; editor cancels pending (audited)", (await err(() => user(U.M, "p2p_studio_cancel_schedule", [firstS.schedule.id])))?.code === "S0403"
    && (await user(U.A, "p2p_studio_cancel_schedule", [firstS.schedule.id])).cancelled === true && (await auditCount("schedule.cancelled", idm)) === 1);

  // ── Audit immutability + RLS reads ───────────────────────────────────────
  ok("audit: UPDATE blocked even for the owner", /append-only/.test((await err(() => q(`update p2p_studio_audit_log set action='x'`)))?.message ?? ""));
  ok("audit: DELETE blocked even for the owner", /append-only/.test((await err(() => q(`delete from p2p_studio_audit_log`)))?.message ?? ""));
  ok("audit: TRUNCATE blocked even for the owner", /append-only/.test((await err(() => q(`truncate p2p_studio_audit_log`)))?.message ?? ""));
  ok("RLS: staff read items, others see none", (await as("authenticated", U.M, `select count(*)::int n from p2p_studio_items`)).rows[0].n > 0
    && (await as("authenticated", U.P, `select count(*)::int n from p2p_studio_items`)).rows[0].n === 0);
  ok("RLS: audit readable by auditor roles only (super_admin, admin_supervisor, admin_content)",
    (await as("authenticated", U.V, `select count(*)::int n from p2p_studio_audit_log`)).rows[0].n > 0
    && (await as("authenticated", U.A, `select count(*)::int n from p2p_studio_audit_log`)).rows[0].n > 0
    && (await as("authenticated", U.M, `select count(*)::int n from p2p_studio_audit_log`)).rows[0].n === 0);

  await db.close();
  return results;
}

// ── Run: real migration must pass everything ───────────────────────────────
let failures = 0;
const real = await runSuite(M188);
for (const [name, r] of real) { if (!r.pass) { failures++; console.log(`FAIL ${name} ${r.detail}`); } }
console.log(`migration 188 as written: ${real.size - failures} passed, ${failures} failed`);

// ── Negative proof: each safeguard removed → its check must fail ──────────
function mutate(src, from, to, nth = 0) {
  let idx = -1;
  for (let i = 0; i <= nth; i++) { idx = src.indexOf(from, idx + 1); if (idx < 0) throw new Error(`mutation anchor not found: ${from.slice(0, 60)}`); }
  return src.slice(0, idx) + to + src.slice(idx + from.length);
}
const AUDIT_FN_SQL = "language sql\nsecurity definer\nset search_path = public, pg_temp\nas $$\n  insert into p2p_studio_audit_log (actor_id, actor_role, action, item_id, source_type, source_id, details)\n  values (p_actor_id, p_actor_role, p_action, p_item_id, p_source_type, p_source_id, coalesce(p_details, '{}'::jsonb));\n$$;";
const MUTATIONS = [
  { name: "publication gate trigger removed", check: "H2: service-role direct publish without approval blocked",
    sql: () => mutate(M188, "create trigger trg_p2p_kingdom_story_publication_gate\n  before insert or update on public.p2p_kingdom_stories\n  for each row execute function public.p2p_kingdom_story_publication_gate();", "") },
  { name: "content fingerprint not checked", check: "H1: body edited after approval → publish refused (stale)",
    sql: () => mutate(M188, "if v_item.approved_fingerprint is distinct from p2p_kingdom_story_fingerprint(p_story) then return 'studio_approval_stale'; end if;", "") },
  { name: "reviewer independence not checked by the gate", check: "H2: gate validates reviewer independence (forged self-approval blocked)",
    sql: () => mutate(M188, "if v_item.submitted_by is not distinct from v_item.reviewed_by and v_reviewer_role <> 'super_admin' then return 'studio_four_eyes'; end if;", "") },
  { name: "reviewer role not re-checked at publication", check: "H2: approval by a reviewer who lost the role no longer publishes",
    sql: () => mutate(M188, "if v_reviewer_role is null or v_reviewer_role not in ('admin_content', 'super_admin') then return 'studio_reviewer_ineligible'; end if;", "") },
  { name: "live-story freeze removed (story fields)", check: "LIVE: body edit of a published story blocked (owner, API, editor)",
    sql: () => mutate(M188, "elsif new.status = 'published' and old.status = 'published'", "elsif false and new.status = 'published' and old.status = 'published'") },
  { name: "live-story freeze removed (media)", check: "LIVE: media of a published story cannot be added",
    sql: () => mutate(M188, "create trigger trg_p2p_kingdom_story_media_freeze\n  before insert or update or delete on public.p2p_kingdom_story_media\n  for each row execute function public.p2p_kingdom_story_child_freeze();", "") },
  { name: "audit errors swallowed (non-atomic)", check: "M4: audit failure rolls back the review decision",
    // Function replacers: in a replacement STRING, "$$" would collapse to "$".
    sql: () => mutate(M188, AUDIT_FN_SQL, AUDIT_FN_SQL.replace("language sql", () => "language plpgsql").replace("as $$\n  insert", () => "as $$\nbegin\n  insert").replace("'{}'::jsonb));\n$$;", () => "'{}'::jsonb));\nexception when others then null;\nend;\n$$;")) },
  { name: "service role allowed to act as users", check: "identity: service role cannot call editorial functions (cannot act as a user)",
    sql: () => mutate(M188, "grant execute on function public.p2p_studio_review_transition(text, uuid, text, integer, text) to authenticated;", "grant execute on function public.p2p_studio_review_transition(text, uuid, text, integer, text) to authenticated, service_role;") },
  { name: "role check removed from create_schedule", check: "M3: non-editor role cannot schedule (and creates nothing)",
    sql: () => mutate(M188, "if v_role is null then raise exception 'studio_forbidden' using errcode = 'S0403'; end if;", "", 1) },
  { name: "approval not required when scheduling a publish", check: "M3: publish schedule without approval refused before creating anything",
    sql: () => mutate(M188, "if p_action = 'publish' and (not found or v_item.review_state <> 'approved') then", "if false then") },
  { name: "expected version not checked", check: "L9: stale version rejected without mutation",
    sql: () => mutate(M188, "if v_item.version <> p_expected_version then", "if false then") },
  { name: "idempotency not scoped to the actor", check: "idempotency: same key from a different user refused",
    sql: () => mutate(M188, "if v_prior.created_by is not distinct from v_actor and v_prior.action = p_action", "if v_prior.action = p_action") },
  { name: "claim token not checked when running a job", check: "scheduler: stale worker cannot run or finish a job it no longer owns",
    sql: () => mutate(M188, " or v_job.claim_token is distinct from p_claim_token then", " then") },
  { name: "audit sequence revoke removed", check: "client roles cannot use the audit id sequence",
    sql: () => mutate(M188, "revoke all on sequence public.p2p_studio_audit_log_id_seq from public, anon, authenticated, service_role;", "") },
  { name: "service role given direct write access", check: "service role has SELECT only on p2p_studio_items",
    sql: () => mutate(M188, "grant select on table public.p2p_studio_items to service_role;", "grant select, insert, update, delete on table public.p2p_studio_items to service_role;") },
];
let undetected = 0;
for (const m of MUTATIONS) {
  const r = await runSuite(m.sql());
  const target = r.get(m.check);
  const detected = !!target && !target.pass;
  if (!detected) undetected++;
  console.log(`${detected ? "DETECTED" : "NOT DETECTED"}: ${m.name} → "${m.check}" ${detected ? "failed as expected" : target ? "still passed" : "was not reached"}`);
  if (!target) console.log("   (migration applies:", JSON.stringify(r.get("migration applies")), ")");
}
console.log(`negative proof: ${MUTATIONS.length - undetected}/${MUTATIONS.length} removed safeguards detected`);
process.exit(failures || undetected ? 1 : 0);
