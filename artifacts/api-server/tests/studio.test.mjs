// Tests for the Publishing Studio API: time zones / DST, review and sharing
// policy, the scheduler's retry logic, migration 188's structure, and the HTTP
// routes (real express + real adminAuth middleware) with a stub database that
// RECORDS every database function call and WHO made it — proving refused
// requests never reach a write, writes run as the signed-in user (never with
// a caller-supplied actor), and database refusals map to the right answers.
// The SQL behaviour itself (gate, fingerprint, live freeze, atomic audit,
// grants) is tested against real PostgreSQL in scripts/studio-db-test/.
// SYNTHETIC data only; no network except a local ephemeral port.
// Run: node tests/studio.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const tmp = mkdtempSync(path.join(os.tmpdir(), "studio-test-"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

async function bundle(entry, name, plugins = []) {
  const r = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins,
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  const file = path.join(tmp, `${name}.mjs`);
  writeFileSync(file, r.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

try {
  const T = await bundle("src/lib/studio/time.ts", "time");
  const P = await bundle("src/lib/studio/policy.ts", "policy");
  const S = await bundle("src/lib/studio/scheduler.ts", "scheduler");

  // ── 1. Time zones and daylight saving ────────────────────────────────────
  const iso = (r) => (r.ok ? r.utc.toISOString() : r.error);
  ok("London winter 09:00 = 09:00Z", iso(T.zonedLocalToUtc("2026-01-15T09:00", "Europe/London")) === "2026-01-15T09:00:00.000Z");
  ok("London summer 09:00 = 08:00Z", iso(T.zonedLocalToUtc("2026-07-15T09:00", "Europe/London")) === "2026-07-15T08:00:00.000Z");
  ok("London spring-forward gap 01:30 rejected", iso(T.zonedLocalToUtc("2026-03-29T01:30", "Europe/London")) === "nonexistent_local_time");
  const amb = T.zonedLocalToUtc("2026-10-25T01:30", "Europe/London");
  ok("London fall-back 01:30 ambiguous → earlier (BST) 00:30Z", amb.ok && amb.ambiguous && amb.utc.toISOString() === "2026-10-25T00:30:00.000Z");
  ok("London fall-back fold=later → 01:30Z", iso(T.zonedLocalToUtc("2026-10-25T01:30", "Europe/London", "later")) === "2026-10-25T01:30:00.000Z");
  ok("New York gap 02:30 on 2026-03-08 rejected", iso(T.zonedLocalToUtc("2026-03-08T02:30", "America/New_York")) === "nonexistent_local_time");
  ok("New York 09:00 EDT = 13:00Z", iso(T.zonedLocalToUtc("2026-06-01T09:00", "America/New_York")) === "2026-06-01T13:00:00.000Z");
  ok("Lagos (no DST) 09:00 = 08:00Z", iso(T.zonedLocalToUtc("2026-03-29T09:00", "Africa/Lagos")) === "2026-03-29T08:00:00.000Z");
  ok("Kolkata half-hour offset 09:00 = 03:30Z", iso(T.zonedLocalToUtc("2026-05-01T09:00", "Asia/Kolkata")) === "2026-05-01T03:30:00.000Z");
  ok("Sydney (southern DST) 09:00 in January = 22:00Z prev day", iso(T.zonedLocalToUtc("2026-01-10T09:00", "Australia/Sydney")) === "2026-01-09T22:00:00.000Z");
  ok("Lord Howe 30-minute DST gap 02:15 rejected", iso(T.zonedLocalToUtc("2026-10-04T02:15", "Australia/Lord_Howe")) === "nonexistent_local_time");
  ok("invalid time zone rejected", iso(T.zonedLocalToUtc("2026-01-01T09:00", "Mars/Olympus")) === "invalid_timezone");
  ok("impossible date rejected", iso(T.zonedLocalToUtc("2026-02-30T09:00", "UTC")) === "invalid_local_time");
  ok("malformed time rejected", iso(T.zonedLocalToUtc("2026-01-01 9am", "UTC")) === "invalid_local_time");
  ok("utcToZonedLocal round-trips", T.utcToZonedLocal(new Date("2026-07-15T08:00:00Z"), "Europe/London") === "2026-07-15T09:00");

  // ── 2. Policy: review, scheduling, sharing ──────────────────────────────
  const rt = (o) => P.reviewTransition({ source: "kingdom_story", actorId: "u1", submittedBy: "u2", actorRole: "admin_content", ...o });
  ok("editor submits draft → in_review", rt({ from: "draft", to: "in_review" }).ok);
  ok("draft cannot jump to approved", !rt({ from: "draft", to: "approved" }).ok);
  ok("another editor approves", rt({ from: "in_review", to: "approved" }).ok);
  ok("submitter cannot approve own work (four eyes)", !rt({ from: "in_review", to: "approved", submittedBy: "u1" }).ok);
  ok("super_admin may approve own submission", rt({ from: "in_review", to: "approved", submittedBy: "u1", actorRole: "super_admin" }).ok);
  ok("moderator cannot review Kingdom Stories", !rt({ from: "in_review", to: "approved", actorRole: "admin_moderation" }).ok);
  ok("nobody edits Kingdom Wins through the Studio", !P.reviewTransition({ source: "kingdom_win", from: "draft", to: "in_review", actorRole: "super_admin", actorId: "u1", submittedBy: null }).ok);
  ok("publish needs approval", !P.canSchedule({ source: "kingdom_story", action: "publish", reviewState: "in_review", actorRole: "admin_content" }).ok);
  ok("approved + editor can schedule publish", P.canSchedule({ source: "kingdom_story", action: "publish", reviewState: "approved", actorRole: "admin_content" }).ok);
  ok("archive can be scheduled without approval", P.canSchedule({ source: "kingdom_story", action: "archive", reviewState: "draft", actorRole: "admin_content" }).ok);
  ok("marketing cannot schedule", !P.canSchedule({ source: "kingdom_story", action: "publish", reviewState: "approved", actorRole: "admin_marketing" }).ok);
  ok("audit readers match the database (super_admin, admin_supervisor, admin_content)", [...P.AUDIT_VIEW_ROLES].sort().join() === "admin_content,admin_supervisor,super_admin");
  const share = (o) => P.canShareExternally({ actorId: "me", ...o });
  ok("Kingdom Story: peer cannot share", !share({ source: "kingdom_story", actorRole: "student", native: { status: "published" } }).ok);
  ok("Kingdom Story: content admin can share published", share({ source: "kingdom_story", actorRole: "admin_content", native: { status: "published" } }).ok);
  ok("Kingdom Story: nobody shares a draft", !share({ source: "kingdom_story", actorRole: "super_admin", native: { status: "draft" } }).ok);
  const win = { status: "published", visibility: "p2p_network", authorId: "author" };
  ok("Kingdom Win: author may share own published testimony", share({ source: "kingdom_win", actorRole: "student", actorId: "author", native: win }).ok);
  ok("Kingdom Win: others blocked without author permission", !share({ source: "kingdom_win", actorRole: "super_admin", native: win }).ok);
  ok("view roles exclude non-staff", P.canView("admin_content") && !P.canView("student") && !P.canView("peer_guide") && !P.canView(undefined));

  // ── 3. Scheduler (retry decisions; the job itself runs in the database) ──
  function sched({ jobs, run, finishThrows = false }) {
    const finished = [], logs = [], ran = [];
    const deps = {
      claim: async () => jobs,
      runJob: async (id, token) => { ran.push([id, token]); return run(id); },
      finishJob: async (id, token, retry, next, error) => { if (finishThrows) throw new Error("db down"); finished.push({ id, token, retry, next, error }); return true; },
      now: () => Date.parse("2026-10-14T12:00:00Z"), random: () => 0,
      logger: { info: (o, m) => logs.push(m), warn: (o, m) => logs.push(m), error: (o, m) => logs.push(m) },
    };
    return { deps, finished, logs, ran };
  }
  const job = (o = {}) => ({ id: "j1", item_id: "i1", action: "publish", run_at: "x", status: "running", attempts: 1, max_attempts: 3, claim_token: "tok-1", ...o });
  {
    const h = sched({ jobs: [job()], run: async () => ({ outcome: "succeeded", changed: true, nativeStatus: "published" }) });
    const r = await S.runDueJobs(h.deps);
    ok("scheduler: success needs no extra bookkeeping (done in the same DB transaction)", r.succeeded === 1 && h.finished.length === 0);
    ok("scheduler: the run carries the job's claim token", h.ran[0][1] === "tok-1");
  }
  {
    const h = sched({ jobs: [job()], run: async () => ({ outcome: "failed", reason: "changed_since_approval" }) });
    const r = await S.runDueJobs(h.deps);
    ok("scheduler: refusal recorded by the DB, not retried", r.failed === 1 && h.finished.length === 0);
  }
  {
    const h = sched({ jobs: [job()], run: async () => { throw new Error("connection reset"); } });
    const r = await S.runDueJobs(h.deps);
    const f = h.finished[0];
    ok("scheduler: error → retry recorded with backoff and the claim token", r.retried === 1 && f.retry === true && f.token === "tok-1" && Date.parse(f.next) - Date.parse("2026-10-14T12:00:00Z") === 30_000, JSON.stringify(f));
  }
  {
    const h = sched({ jobs: [job({ attempts: 3 })], run: async () => { throw new Error("connection reset"); } });
    const r = await S.runDueJobs(h.deps);
    ok("scheduler: error on last attempt → final failure (no infinite retry)", r.failed === 1 && h.finished[0].retry === false && h.finished[0].next === null);
  }
  {
    const h = sched({ jobs: [job()], run: async () => ({ outcome: "not_running" }) });
    ok("scheduler: job cancelled/finished/re-claimed elsewhere is skipped", (await S.runDueJobs(h.deps)).skipped === 1);
  }
  {
    const h = sched({ jobs: [job(), job({ id: "j2" })], run: async () => { throw new Error("x"); }, finishThrows: true });
    const r = await S.runDueJobs(h.deps);
    ok("scheduler: bookkeeping failure on one job does not stop the next", r.claimed === 2 && r.failed === 2 && h.ran.length === 2);
  }
  ok("retry delay capped at 1h", S.retryDelayMs(20, 1) === S.RETRY_MAX_MS);

  // ── 4. Migration 188 structure (static; behaviour is in studio-db-test) ──
  {
    const sql = readFileSync(path.join(repo, "migrations/188_publishing_studio_foundation.sql"), "utf8");
    const body = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").toLowerCase();
    const outside = body.replace(/\$\$[\s\S]*?\$\$/g, "$$$$"); // statement text with function bodies removed
    ok("migration: single transaction", /^\s*begin;/m.test(body) && /^\s*commit;/m.test(body));
    const tables = [...outside.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    ok("migration: creates exactly the 3 Studio tables", tables.join(",") === "p2p_studio_items,p2p_studio_schedules,p2p_studio_audit_log", tables.join(","));
    ok("migration: RLS enabled on every new table", tables.every((t) => outside.includes(`alter table public.${t} enable row level security`)));
    ok("migration: never disables RLS", !/disable row level security|no force row level/.test(body));
    ok("migration: no destructive statements", !/\bdrop table\b|^\s*truncate\b|\bdelete from\b/m.test(outside));
    ok("migration: never ALTERs an existing table", !/alter table public\.p2p_(?!studio_)/.test(outside));
    const existingTouches = [...new Set([...outside.matchAll(/\bon public\.(p2p_(?!studio_)\w+)/g)].map((m) => m[1]))].sort();
    ok("migration: only triggers on the Kingdom Story tables are added to existing tables",
      existingTouches.join() === "p2p_kingdom_stories,p2p_kingdom_story_media,p2p_kingdom_story_sources", existingTouches.join());
    ok("migration: no seeded rows (no top-level INSERT)", !/^\s*insert into/m.test(outside));
    ok("migration: clients and API get SELECT only on Studio tables", !/grant (insert|update|delete|all)[^;]*to (authenticated|service_role)/.test(outside)
      && /revoke all on table public\.p2p_studio_audit_log from public, anon, authenticated, service_role/.test(outside));
    ok("migration: audit id sequence revoked from client roles and the API", /revoke all on sequence public\.p2p_studio_audit_log_id_seq from public, anon, authenticated, service_role/.test(outside));
    const definers = [...body.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\bas \$\$/g)].filter((m) => /security definer/.test(m[0]));
    ok("migration: every SECURITY DEFINER function pins search_path", definers.length >= 12 && definers.every((m) => /set search_path = public, pg_temp/.test(m[0])), String(definers.length));
    for (const fn of ["p2p_studio_review_transition", "p2p_studio_create_schedule", "p2p_studio_cancel_schedule", "p2p_kingdom_story_set_status"]) {
      ok(`migration: ${fn} runs only as the signed-in user (not anon, not the service role)`,
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, service_role;`).test(outside)
        && new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`).test(outside));
    }
    for (const fn of ["p2p_studio_run_job", "p2p_studio_finish_job", "p2p_studio_claim_due_jobs", "p2p_studio_stale_approvals"]) {
      ok(`migration: ${fn} executable by the API (service role) only`,
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`).test(outside)
        && new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role;`).test(outside));
    }
    ok("migration: editorial functions take the actor from auth.uid(), never a parameter",
      (body.match(/v_actor uuid := auth\.uid\(\);/g) ?? []).length === 4 && !/p_actor_id uuid\)\s*returns jsonb/.test(body));
    ok("migration: internal audit writer callable by nobody", /revoke all on function public\.p2p_studio_audit\([^)]*\) from public, anon, authenticated, service_role/.test(outside));
    ok("migration: audit log append-only (update/delete/truncate triggers)", /before update or delete on public\.p2p_studio_audit_log/.test(outside) && /before truncate on public\.p2p_studio_audit_log/.test(outside));
    ok("migration: claim uses skip locked and issues claim tokens", /for update skip locked/.test(body) && /claim_token = gen_random_uuid\(\)/.test(body));
    ok("migration: rollback documented, removes gate and freezes", /-- rollback/i.test(sql) && /drop trigger if exists trg_p2p_kingdom_story_publication_gate/.test(sql) && /trg_p2p_kingdom_story_media_freeze/.test(sql));
  }

  // ── 5. Routes over HTTP (stub DB records every function call + caller) ──
  const db = makeDb();
  const profiles = { "tok-student": ["u-student", "student"], "tok-mod": ["u-mod", "admin_moderation"], "tok-c1": ["u-c1", "admin_content"], "tok-c2": ["u-c2", "admin_content"], "tok-super": ["u-super", "super_admin"], "tok-sup": ["u-sup", "admin_supervisor"], "tok-pg": ["u-pg", "peer_guide"] };
  globalThis.__studioMock = {
    db,
    getUser: async (t) => (profiles[t] ? { data: { user: { id: profiles[t][0] } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
    roleOf: (t) => profiles[t]?.[1],
    logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } },
  };
  const mocks = { name: "mocks", setup(b) {
    b.onResolve({ filter: /(^|\/)lib\/supabase$|^\.\.\/supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
    b.onResolve({ filter: /(^|\/)logger$/ }, () => ({ path: "logger", namespace: "mock" }));
    b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "sbjs", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: {
      supabase: `const M = globalThis.__studioMock;
        export const supabaseServiceRole = M.db;
        export const supabaseAsUser = (token) => M.db.asUser(token);
        export const supabase = { auth: { getUser: (t) => M.getUser(t) } };
        export async function verifyCaller() { return null; }`,
      logger: "export const logger = globalThis.__studioMock.logger;",
      sbjs: `export function createClient(url, key, opts) {
        const token = (opts?.global?.headers?.Authorization ?? "").replace("Bearer ", "");
        const role = globalThis.__studioMock.roleOf(token);
        const c = { from: () => c, select: () => c, eq: () => c, single: async () => (role ? { data: { role }, error: null } : { data: null, error: { message: "none" } }) };
        return c;
      }`,
    }[a.path] }));
  } };
  const posix = (p) => p.replace(/\\/g, "/");
  writeFileSync(path.join(tmp, "app-entry.ts"), `import express from "express";
import studio from ${JSON.stringify(posix(path.join(root, "src/routes/studio.ts")))};
import stories from ${JSON.stringify(posix(path.join(root, "src/routes/kingdomStories.ts")))};
export const app = express();
app.use(express.json());
app.use("/api/studio", studio);
app.use("/api/kingdom-stories", stories);
`);
  const appBuild = await build({ entryPoints: [path.join(tmp, "app-entry.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mocks],
    nodePaths: [path.join(root, "node_modules")], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  writeFileSync(path.join(tmp, "app.mjs"), appBuild.outputFiles[0].text);
  const { app } = await import(pathToFileURL(path.join(tmp, "app.mjs")).href);
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const apiBase = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, p, tok, body, headers = {}) => {
    const res = await fetch(apiBase + p, { method, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const rpcCount = () => db.rpcCalls.length;
  const noRpc = async (fn) => { const before = rpcCount(); const r = await fn(); return { r, none: rpcCount() === before }; };
  try {
    const story = "11111111-1111-4111-8111-111111111111";
    const winId = "22222222-2222-4222-8222-222222222222";
    db.tables.p2p_kingdom_stories.push({ id: story, title: "Synthetic story", status: "draft", content_type: "historical_story", scripture_reference_id: null, updated_at: "2026-10-01T00:00:00Z", published_at: null, archived_at: null });
    db.tables.p2p_kingdom_wins.push({ id: winId, title: "Synthetic win", status: "submitted", visibility: "p2p_network", updated_at: "2026-10-01T00:00:00Z", published_at: null });
    const sp = `/studio/items/kingdom_story/${story}`;
    const future = (days) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 16);
    const sched = (tok, body, key) => call("POST", `${sp}/schedules`, tok, body, key ? { "Idempotency-Key": key } : {});

    ok("http: no token → 401", (await call("GET", "/studio/items", null)).status === 401);
    ok("http: ordinary user → 403", (await call("GET", "/studio/items", "tok-student")).status === 403);
    ok("http: admin role outside the Studio (peer_guide) → 403", (await call("GET", "/studio/items", "tok-pg")).status === 403);
    const list = await call("GET", "/studio/items", "tok-mod");
    ok("http: moderator can view, not edit", list.status === 200 && list.body.editable === false && list.body.items.length === 1);

    // M3: refused before any database write.
    let t = await noRpc(() => call("POST", `${sp}/review`, "tok-mod", { to: "in_review", version: 1 }));
    ok("M3 http: moderator review refused, no DB write attempted", t.r.status === 403 && t.none);
    t = await noRpc(() => sched("tok-mod", { action: "archive", localTime: future(2), timezone: "UTC" }, "key-mod-000001"));
    ok("M3 http: moderator schedule refused, no DB write attempted", t.r.status === 403 && t.none);
    t = await noRpc(() => call("POST", `${sp}/status`, "tok-mod", { status: "published" }));
    ok("M3 http: moderator publish-now refused, no DB write attempted", t.r.status === 403 && t.none);
    t = await noRpc(() => call("POST", `/studio/items/kingdom_win/${winId}/schedules`, "tok-super", { action: "archive", localTime: future(2), timezone: "UTC" }, { "Idempotency-Key": "key-win-000001" }));
    ok("M3 http: Kingdom Win schedule refused for super_admin, no DB write", t.r.status === 403 && t.none);
    t = await noRpc(() => call("POST", `/studio/items/kingdom_win/${winId}/review`, "tok-super", { to: "in_review", version: 1 }));
    ok("M3 http: Kingdom Win review refused for super_admin, no DB write", t.r.status === 403 && t.none);
    t = await noRpc(() => call("POST", `/studio/items/kingdom_win/${winId}/status`, "tok-super", { status: "published" }));
    ok("M3 http: Kingdom Win status change refused for super_admin, no DB write", t.r.status === 403 && t.none);
    t = await noRpc(() => call("POST", "/studio/schedules/33333333-3333-4333-8333-333333333333/cancel", "tok-mod"));
    ok("M3 http: moderator cancel refused, no DB write", t.r.status === 403 && t.none);
    t = await noRpc(() => sched("tok-c1", { action: "publish", localTime: future(2), timezone: "UTC" }, "key-pub-000001"));
    ok("M3 http: publish schedule without approval refused, no DB write", t.r.status === 403 && t.none);

    // L9 + validation: refused before any write.
    t = await noRpc(() => call("POST", `${sp}/review`, "tok-c1", { to: "in_review" }));
    ok("L9 http: missing version → 400, no DB write", t.r.status === 400 && /version/.test(t.r.body.error) && t.none);
    t = await noRpc(() => call("POST", `${sp}/review`, "tok-c1", { to: "in_review", version: "1" }));
    ok("L9 http: malformed version → 400, no DB write", t.r.status === 400 && t.none);
    t = await noRpc(() => call("POST", `${sp}/review`, "tok-c1", { to: "in_review", version: 7 }));
    ok("L9 http: stale version → 409, no DB write", t.r.status === 409 && t.none);
    t = await noRpc(() => sched("tok-c1", { action: "archive", localTime: future(2), timezone: "UTC" }));
    ok("http: schedule without Idempotency-Key → 400, no DB write", t.r.status === 400 && t.none);
    t = await noRpc(() => sched("tok-c1", { action: "archive", localTime: "2027-03-28T01:30", timezone: "Europe/London" }, "key-dst-000001"));
    ok("http: DST-gap time → 400, no DB write", t.r.status === 400 && t.none);
    t = await noRpc(() => sched("tok-c1", { action: "archive", localTime: "2026-10-25T01:30", timezone: "Europe/London" }, "key-amb-000001"));
    ok("http: ambiguous DST time without explicit choice → 400, no DB write", t.r.status === 400 && t.r.body.code === "ambiguous_local_time" && t.none);

    // Permitted requests: exactly one database function call, made AS the
    // signed-in user, with no actor parameter (even if the body forges one).
    db.rpcHandler = () => ({ data: { itemId: "i1", reviewState: "in_review", version: 2, cancelledPublishSchedules: 0 }, error: null });
    const sub = await call("POST", `${sp}/review`, "tok-c1", { to: "in_review", version: 1, p_actor_id: "u-forged" });
    const c0 = db.rpcCalls.at(-1);
    ok("identity http: write runs as the caller's own session, no actor parameter", sub.status === 200 && c0.fn === "p2p_studio_review_transition"
      && c0.as === "tok-c1" && !("p_actor_id" in c0.args) && c0.args.p_expected_version === 1 && c0.args.p_to === "in_review", JSON.stringify(c0));
    db.rpcHandler = () => ({ data: { replayed: false, schedule: { id: "s1" } }, error: null });
    const s1 = await sched("tok-c1", { action: "archive", localTime: "2027-01-15T09:00", timezone: "Africa/Lagos" }, "key-arc-000001");
    const c1 = db.rpcCalls.at(-1);
    ok("http: schedule → one DB call as the user with server-computed UTC", s1.status === 201 && c1.fn === "p2p_studio_create_schedule" && c1.as === "tok-c1" && c1.args.p_run_at === "2027-01-15T08:00:00.000Z" && c1.args.p_idempotency_key === "key-arc-000001");

    // Database refusals map to clear HTTP answers.
    const mapped = async (code, message) => { db.rpcHandler = () => ({ data: null, error: { code, message } }); return call("POST", `${sp}/review`, "tok-c1", { to: "in_review", version: 1 }); };
    let m = await mapped("S0409", "studio_version_conflict");
    ok("http: DB version conflict → 409", m.status === 409 && /changed by someone else/.test(m.body.error));
    m = await mapped("S0403", "studio_four_eyes");
    ok("http: DB four-eyes refusal → 403", m.status === 403 && /other than the submitter/.test(m.body.error));
    m = await mapped("S0401", "studio_unauthenticated");
    ok("http: DB 'no session user' → 401", m.status === 401);
    m = await mapped("42883", "function p2p_studio_review_transition does not exist");
    ok("http: migration not applied → 503", m.status === 503 && /not set up yet/.test(m.body.error));
    db.rpcHandler = () => ({ data: null, error: { code: "S0423", message: "studio_approval_stale" } });
    const pn = await call("POST", `${sp}/status`, "tok-c1", { status: "published" });
    ok("http: Publish now refused by the gate → 409 'remains unpublished'", pn.status === 409 && /remains unpublished/.test(pn.body.error) && db.rpcCalls.at(-1).as === "tok-c1");

    // Existing editor route: status changes go through the gated function as the user.
    db.rpcHandler = (fn) => (fn === "p2p_kingdom_story_set_status" ? { data: null, error: { code: "S0423", message: "studio_approval_required" } } : { data: null, error: null });
    const p1 = await call("PUT", `/kingdom-stories/${story}`, "tok-c1", { status: "published" });
    const cp = db.rpcCalls.at(-1);
    ok("H2 http: editor Publish goes through the gated DB function as the editor", cp.fn === "p2p_kingdom_story_set_status" && cp.args.p_status === "published" && cp.as === "tok-c1" && !("p_actor_id" in cp.args));
    ok("H2 http: unapproved publish → 409 explaining it remains unpublished, flagged for the Studio", p1.status === 409 && /remains unpublished/.test(p1.body.error) && p1.body.studioRequired === true);
    db.rpcHandler = () => ({ data: null, error: { code: "S0423", message: "studio_approval_stale" } });
    const p2 = await call("PUT", `/kingdom-stories/${story}`, "tok-c1", { status: "published" });
    ok("H1 http: changed-since-approval → 409 asking for re-review", p2.status === 409 && /changed after it was approved/.test(p2.body.error));
    const before = rpcCount();
    const e1 = await call("PUT", `/kingdom-stories/${story}`, "tok-c1", { body: "Edited text" });
    ok("http: content-only edit needs no status function call", e1.status === 200 && rpcCount() === before && db.tables.p2p_kingdom_stories[0].body === "Edited text");
    db.failNextWrite = { code: "S0423", message: "studio_live_edit_blocked" };
    const le = await call("PUT", `/kingdom-stories/${story}`, "tok-c1", { body: "Live change" });
    ok("LIVE http: frozen live story edit → 409 with guidance", le.status === 409 && le.body.code === "studio_live_edit_blocked" && /Unpublish it/.test(le.body.error));
    db.rpcHandler = () => ({ data: { ...db.tables.p2p_kingdom_stories[0], status: "archived" }, error: null });
    const a1 = await call("PUT", `/kingdom-stories/${story}`, "tok-c1", { status: "archived" });
    ok("http: archive still works through the same function", a1.status === 200 && db.rpcCalls.at(-1).args.p_status === "archived");
    db.rpcHandler = null;

    ok("http: moderator cannot read audit", (await call("GET", "/studio/audit", "tok-mod")).status === 403);
    ok("http: supervisor can read audit", (await call("GET", "/studio/audit", "tok-sup")).status === 200);
    ok("http: audit filter validated", (await call("GET", "/studio/audit?action=x;drop", "tok-sup")).status === 400);
    ok("http: settings readable, scheduler reported off", (await call("GET", "/studio/settings", "tok-mod")).body.schedulerEnabled === false);
    db.failNext = { table: "p2p_kingdom_stories", error: { code: "42P01", message: 'relation "p2p_studio_items" does not exist' } };
    ok("http: list survives DB error with a clear status", (await call("GET", "/studio/items", "tok-c1")).status === 500);
    ok("http: Studio routes never write tables directly", db.directWrites.filter((w) => w.startsWith("p2p_studio_")).length === 0, JSON.stringify(db.directWrites));
    const serviceCalls = [...new Set(db.rpcCalls.filter((c) => c.as === "service").map((c) => c.fn))];
    ok("http: the service role only calls the read-only stale-approval lookup (never a write function)",
      serviceCalls.every((fn) => fn === "p2p_studio_stale_approvals"), serviceCalls.join(","));
  } finally {
    server.close();
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Stub database: reads from in-memory tables; records rpc calls (and who made
// them) and any direct table writes (Studio tables must never be written).
function makeDb() {
  const tables = { p2p_kingdom_stories: [], p2p_kingdom_wins: [], p2p_studio_items: [], p2p_studio_schedules: [], p2p_studio_audit_log: [], p2p_curriculums: [], p2p_prayer_topics: [], p2p_prayer_paths: [] };
  const state = { tables, failNext: null, failNextWrite: null, rpcCalls: [], rpcHandler: null, directWrites: [] };
  state.from = (table) => {
    const q = { op: "select", filters: [], payload: null, single: false, limit: null };
    const match = (r) => q.filters.every(([op, c, v]) => (op === "eq" ? r[c] === v : op === "in" ? v.includes(r[c]) : true));
    const exec = () => {
      if (state.failNext?.table === table) { const e = state.failNext.error; state.failNext = null; return { data: null, error: e, count: null }; }
      const rows = tables[table] ?? [];
      if (q.op !== "select") {
        state.directWrites.push(`${table}:${q.op}`);
        if (state.failNextWrite) { const e = state.failNextWrite; state.failNextWrite = null; return { data: null, error: e }; }
      }
      if (q.op === "update") { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, q.payload)); return { data: q.single ? (hit[0] ?? null) : hit, error: null }; }
      if (q.op === "insert") { rows.push({ ...q.payload }); return { data: q.single ? q.payload : [q.payload], error: null }; }
      let out = rows.filter(match);
      const count = out.length;
      if (q.limit) out = out.slice(0, q.limit);
      return { data: q.single ? (out[0] ?? null) : out, error: null, count };
    };
    const c = {
      select: () => c, insert: (p) => { q.op = "insert"; q.payload = p; return c; },
      update: (p) => { q.op = "update"; q.payload = p; return c; }, delete: () => { q.op = "delete"; return c; },
      eq: (k, v) => { q.filters.push(["eq", k, v]); return c; }, in: (k, v) => { q.filters.push(["in", k, v]); return c; },
      not: () => c, ilike: () => c, like: () => c, gte: () => c, lt: () => c,
      order: () => c, limit: (n) => { q.limit = n; return c; }, range: () => c,
      single: () => { q.single = true; return c; }, maybeSingle: () => { q.single = true; return c; },
      then: (res, rej) => { try { const r = exec(); res({ ...r, data: r.data == null ? r.data : structuredClone(r.data) }); } catch (e) { rej(e); } },
    };
    return c;
  };
  const rpcAs = (as) => async (fn, args) => {
    state.rpcCalls.push({ fn, args, as });
    return state.rpcHandler ? state.rpcHandler(fn, args) : (fn === "p2p_studio_stale_approvals" ? { data: [], error: null } : { data: null, error: { code: "XX000", message: "no handler" } });
  };
  state.rpc = rpcAs("service");
  state.asUser = (token) => ({ rpc: rpcAs(token), from: state.from });
  state.storage = { from: () => ({ remove: async () => ({ data: null, error: null }) }) };
  return state;
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
