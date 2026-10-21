// Tests for push delivery: src/lib/expoPush.ts (Expo batching, retries,
// project split, ticket mapping), src/lib/apnsVoipStatus.ts (VoIP config and
// Apple's responses), and src/lib/pushDispatch.ts end to end against an
// in-memory database and a mocked Expo endpoint. SYNTHETIC tokens only; no
// network, no database, nothing written outside the OS temp directory.
// Run: node tests/pushDelivery.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
function load(rel) {
  const js = ts.transpileModule(readFileSync(path.join(root, rel), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, AbortSignal, JSON, Math, Number, String, Array, Map, Set, Object, Promise });
  return mod.exports;
}
const E = load("src/lib/expoPush.ts");
const A = load("src/lib/apnsVoipStatus.ts");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const tok = (i, p = "a") => `ExponentPushToken[${p}synthetic${String(i).padStart(4, "0")}]`;
const msgs = (n, p = "a") => Array.from({ length: n }, (_, i) => ({ to: tok(i, p), title: "t", body: "b" }));

// ---- mocked Expo endpoint -------------------------------------------------
function resp(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}
const okTickets = (batch) => resp(200, { data: batch.map((_, i) => ({ status: "ok", id: `ticket-${i}` })) });
function harness(handler) {
  const calls = [], sleeps = [], logs = [];
  const log = (level) => (obj, msg) => logs.push({ level, obj, msg });
  const deps = {
    fetch: async (url, init) => { const batch = JSON.parse(init.body); calls.push({ url, batch, headers: init.headers }); return handler(batch, calls.length); },
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
    logger: { info: log("info"), warn: log("warn"), error: log("error") },
  };
  return { deps, calls, sleeps, logs };
}
const kinds = (outs) => outs.map((o) => o.kind);
const allKind = (outs, k) => outs.length > 0 && outs.every((o) => o.kind === k);

// 1. Exactly 100 messages: one request.
{
  const h = harness(okTickets);
  const outs = await E.sendExpoMessages(msgs(100), h.deps);
  ok("100 messages → 1 request", h.calls.length === 1 && h.calls[0].batch.length === 100);
  ok("100 messages → 100 accepted", outs.length === 100 && allKind(outs, "accepted"));
}
// 2. More than 100: chunked, never > 100 per request, mapping preserved.
{
  const h = harness((batch) => resp(200, { data: batch.map((m) => ({ status: "ok", id: `id-${m.to}` })) }));
  const input = msgs(250);
  const outs = await E.sendExpoMessages(input, h.deps);
  ok("250 messages → 3 requests (100/100/50)", h.calls.map((c) => c.batch.length).join(",") === "100,100,50");
  ok("no request over 100", h.calls.every((c) => c.batch.length <= 100) && E.EXPO_MAX_PER_REQUEST === 100);
  ok("multi-chunk tickets map back to the right message", outs.length === 250 && outs.every((o, i) => o.ticketId === `id-${input[i].to}`));
}
// 3. Mixed projects: split using Expo's own details map.
{
  const input = [...msgs(3, "old"), ...msgs(2, "new")];
  const h = harness((batch, n) => {
    const projects = new Set(batch.map((m) => (m.to.includes("old") ? "@amen/old" : "@prod/new")));
    if (projects.size > 1) {
      return resp(400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "All push notification messages in the same request must be for the same project; check the details field to investigate conflicting tokens.",
        details: { "@amen/old": batch.filter((m) => m.to.includes("old")).map((m) => m.to), "@prod/new": batch.filter((m) => m.to.includes("new")).map((m) => m.to) } }] });
    }
    return okTickets(batch);
  });
  const outs = await E.sendExpoMessages(input, h.deps);
  ok("mixed projects → 1 rejected + 2 per-project requests", h.calls.length === 3, `calls=${h.calls.length}`);
  ok("each re-sent request has a single project", h.calls.slice(1).every((c) => new Set(c.batch.map((m) => m.to.includes("old"))).size === 1));
  ok("mixed projects → every message accepted, in input order", outs.length === 5 && allKind(outs, "accepted"));
  ok("split logged without full tokens", h.logs.some((l) => l.obj.decision === "split_by_project") && !JSON.stringify(h.logs).includes("synthetic0000]"));
}
// 4. Unknown project: a token Expo doesn't place is not guessed — it fails visibly.
{
  const input = [...msgs(2, "old"), ...msgs(2, "new"), { to: tok(9, "orphan"), title: "t" }];
  const h = harness((batch) => {
    if (batch.length === 5) return resp(400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "mixed", details: { "@amen/old": [tok(0, "old"), tok(1, "old")], "@prod/new": [tok(0, "new"), tok(1, "new")] } }] });
    return okTickets(batch);
  });
  const outs = await E.sendExpoMessages(input, h.deps);
  ok("unknown-project token → permanent UNKNOWN_EXPO_PROJECT", outs[4].kind === "permanent" && outs[4].code === "UNKNOWN_EXPO_PROJECT");
  ok("unknown-project token never re-sent", h.calls.slice(1).every((c) => c.batch.every((m) => !m.to.includes("orphan"))));
  ok("known tokens still delivered", kinds(outs.slice(0, 4)).every((k) => k === "accepted"));
  const errLog = h.logs.find((l) => l.obj.code === "UNKNOWN_EXPO_PROJECT");
  ok("unknown-project log has masked tokens only", errLog && errLog.obj.tokens.every((t) => t.startsWith("…") && t.length <= 5));
}
// 4b. Expo claims mixed projects but lists one: no loop.
{
  const h = harness((batch) => resp(400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "mixed", details: { "@x/one": batch.map((m) => m.to) } }] }));
  const outs = await E.sendExpoMessages(msgs(3), h.deps);
  ok("single-project 'split' → permanent, one request, no loop", h.calls.length === 1 && allKind(outs, "permanent"));
}
// 5. Ticket errors and stale tokens.
{
  const h = harness((batch) => resp(200, { data: [
    { status: "ok", id: "x" },
    { status: "error", message: `"${batch[1].to}" is not a registered push notification recipient`, details: { error: "DeviceNotRegistered" } },
    { status: "error", message: "rate", details: { error: "MessageRateExceeded" } },
    { status: "error", message: "too big", details: { error: "MessageTooBig" } },
  ] }));
  const outs = await E.sendExpoMessages(msgs(4), h.deps);
  ok("ticket mapping: ok / DeviceNotRegistered / rate / other", kinds(outs).join(",") === "accepted,token_invalid,transient,permanent");
  ok("ticket errors logged as codes, no tokens", !JSON.stringify(h.logs).includes("asynthetic0001"));
}
// 6. Transient 5xx / 429: bounded retries with backoff, then success.
{
  const h = harness((batch, n) => (n < 3 ? resp(503, "unavailable") : okTickets(batch)));
  const outs = await E.sendExpoMessages(msgs(2), h.deps);
  ok("503 twice then 200 → accepted after 3 attempts", h.calls.length === 3 && allKind(outs, "accepted"));
  ok("backoff is exponential with jitter (500, 1000 at random=0.5)", h.sleeps.join(",") === "500,1000", h.sleeps.join(","));
}
{
  const h = harness(() => resp(429, { errors: [{ code: "TOO_MANY_REQUESTS", message: "slow down" }] }, { "retry-after": "2" }));
  const outs = await E.sendExpoMessages(msgs(2), h.deps);
  ok("429 always → stops after maxAttempts (3), transient", h.calls.length === 3 && allKind(outs, "transient"));
  ok("Retry-After respected (2s)", h.sleeps.every((s) => s === 2000));
}
{
  const h = harness(() => resp(500, "boom"));
  await E.sendExpoMessages(msgs(1), h.deps, { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 2500 });
  ok("backoff capped at maxDelayMs", h.calls.length === 4 && Math.max(...h.sleeps) <= 2500, h.sleeps.join(","));
}
// 7. Permanent 4xx: no retry.
{
  const h = harness(() => resp(401, { errors: [{ code: "UNAUTHORIZED", message: "The bearer token is invalid" }] }));
  const outs = await E.sendExpoMessages(msgs(3), h.deps);
  ok("401 → permanent, single attempt", h.calls.length === 1 && allKind(outs, "permanent") && outs[0].code === "UNAUTHORIZED");
}
// 8. Partial chunk failure: one chunk fails, the others still go out.
{
  const h = harness((batch, n) => (n === 2 ? resp(400, { errors: [{ code: "VALIDATION_ERROR", message: "bad" }] }) : okTickets(batch)));
  const outs = await E.sendExpoMessages(msgs(250), h.deps);
  ok("failing middle chunk does not stop the others", h.calls.length === 3);
  ok("only the failing chunk's messages fail", allKind(outs.slice(0, 100), "accepted") && allKind(outs.slice(100, 200), "permanent") && allKind(outs.slice(200), "accepted"));
}
// 9. Ambiguous timeout: not re-sent. Connection never made: retried.
{
  const h = harness(() => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; });
  const outs = await E.sendExpoMessages(msgs(2), h.deps);
  ok("timeout → ambiguous, sent once (no duplicate)", h.calls.length === 1 && allKind(outs, "ambiguous"));
}
{
  const h = harness(() => { const e = new TypeError("fetch failed"); e.cause = { code: "ECONNRESET" }; throw e; });
  const outs = await E.sendExpoMessages(msgs(1), h.deps);
  ok("connection reset → ambiguous, not re-sent", h.calls.length === 1 && allKind(outs, "ambiguous"));
}
{
  const h = harness((batch, n) => { if (n === 1) { const e = new TypeError("fetch failed"); e.cause = { code: "ENOTFOUND" }; throw e; } return okTickets(batch); });
  const outs = await E.sendExpoMessages(msgs(1), h.deps);
  ok("DNS failure (never reached Expo) → retried and accepted", h.calls.length === 2 && allKind(outs, "accepted"));
}
// 9b. Ticket count mismatch → ambiguous; PUSH_TOO_MANY_NOTIFICATIONS → halved.
{
  const h = harness(() => resp(200, { data: [{ status: "ok", id: "only-one" }] }));
  const outs = await E.sendExpoMessages(msgs(3), h.deps);
  ok("ticket count mismatch → ambiguous (no guessed mapping)", allKind(outs, "ambiguous") && h.calls.length === 1);
}
{
  const h = harness((batch) => (batch.length > 40 ? resp(400, { errors: [{ code: "PUSH_TOO_MANY_NOTIFICATIONS", message: "too many" }] }) : okTickets(batch)));
  const outs = await E.sendExpoMessages(msgs(100), h.deps);
  ok("PUSH_TOO_MANY_NOTIFICATIONS → split until accepted", allKind(outs, "accepted") && outs.length === 100);
}
// 10. Access token header only when configured; never logged.
{
  const h = harness(okTickets);
  h.deps.accessToken = "synthetic-access-token";
  await E.sendExpoMessages(msgs(1), h.deps);
  ok("Authorization header sent when EXPO_ACCESS_TOKEN set", h.calls[0].headers.Authorization === "Bearer synthetic-access-token");
  ok("access token never logged", !JSON.stringify(h.logs).includes("synthetic-access-token"));
  const h2 = harness(okTickets);
  await E.sendExpoMessages(msgs(1), h2.deps);
  ok("no Authorization header otherwise", !("Authorization" in h2.calls[0].headers));
}
ok("sanitizeProviderText strips tokens", !E.sanitizeProviderText(`bad ${tok(1)} here`).includes("synthetic"));
ok("sanitizeProviderText bounds length", E.sanitizeProviderText("x".repeat(5000)).length === 300);
ok("maskToken shows last 4 only", E.maskToken(tok(1234)) === "…1234");

// 11. Verdicts.
const V = (outs, ageMs = 0, max = 1000) => E.decideNotification(outs, { ageMs, maxRetryAgeMs: max });
const acc = { kind: "accepted" }, tr = { kind: "transient", code: "HTTP_503" }, pm = { kind: "permanent", code: "X" }, inv = { kind: "token_invalid", code: "DeviceNotRegistered" }, amb = { kind: "ambiguous", code: "TIMEOUT" };
ok("verdict: none → no_devices (finished)", V([]).verdict === "no_devices" && V([]).finished);
ok("verdict: all accepted", V([acc, acc]).verdict === "accepted" && V([acc]).finished);
ok("verdict: some accepted → partial, finished (no duplicate resend)", V([acc, tr]).verdict === "partial" && V([acc, tr]).finished);
ok("verdict: transient only → retry, NOT finished", V([tr, inv]).verdict === "retry" && !V([tr]).finished);
ok("verdict: transient past window → abandoned, finished", V([tr], 5000, 1000).verdict === "abandoned" && V([tr], 5000, 1000).finished);
ok("verdict: ambiguous → finished, not re-sent", V([amb, tr]).verdict === "ambiguous" && V([amb]).finished);
ok("verdict: permanent / stale tokens → permanent_failure", V([pm, inv]).verdict === "permanent_failure" && V([inv]).finished);

// 12. APNs VoIP.
const full = { APNS_KEY_ID: "KEYSYNTH01", APNS_TEAM_ID: "TEAMSYNTH1", APNS_AUTH_KEY: "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----" };
{
  const s = A.voipConfigStatus(full);
  ok("APNs: configured with all vars, production by default", s.configured && s.missing.length === 0 && !s.sandbox);
  ok("APNs: topic is <bundle>.voip", s.topic === "com.amentech.p2pglobaldiscipleshipnetwork.voip");
  const m = A.voipConfigStatus({ APNS_TEAM_ID: "TEAMSYNTH1", APNS_AUTH_KEY: "  " });
  ok("APNs: missing config reported by NAME", !m.configured && m.missing.join(",") === "APNS_KEY_ID,APNS_AUTH_KEY");
  ok("APNs: status never contains secret values", !JSON.stringify(A.voipConfigStatus({ ...full, APNS_KEY_ID: "" })).includes("synthetic"));
  ok("APNs: NATIVE_CALLS_IOS=false reported as disabled", !A.voipConfigStatus({ ...full, NATIVE_CALLS_IOS: "false" }).configured && A.voipConfigStatus({ ...full, NATIVE_CALLS_IOS: "false" }).disabledByFlag);
  ok("APNs: APNS_SANDBOX=true flagged", A.voipConfigStatus({ ...full, APNS_SANDBOX: "true" }).sandbox);
}
ok("APNs: 200 → accepted", A.classifyApnsResult(200) === "accepted");
ok("APNs: 410 / BadDeviceToken / Unregistered → token_invalid", ["410:", "400:BadDeviceToken", "410:Unregistered"].every((s) => { const [c, r] = s.split(":"); return A.classifyApnsResult(Number(c), r || undefined) === "token_invalid"; }));
ok("APNs: DeviceTokenNotForTopic is NOT treated as a stale token", A.classifyApnsResult(400, "DeviceTokenNotForTopic") === "rejected");
ok("APNs: 403 InvalidProviderToken → rejected", A.classifyApnsResult(403, "InvalidProviderToken") === "rejected");
ok("APNs: timeout / 429 / 503 → transient", A.classifyApnsResult(0, "timeout") === "transient" && A.classifyApnsResult(429, "TooManyRequests") === "transient" && A.classifyApnsResult(503) === "transient");

// 13. apnsVoip.ts wiring (static): shared classifier used, config visibly logged.
{
  const src = readFileSync(path.join(root, "src/lib/apnsVoip.ts"), "utf8");
  ok("apnsVoip: uses classifyApnsResult for stale-token decisions", /classifyApnsResult\(result\.status, result\.reason\)/.test(src) && /kind === "token_invalid"/.test(src));
  ok("apnsVoip: missing config is logged, not silent", /VoIP ringing NOT configured/.test(src) && /VoIP push not attempted/.test(src));
  ok("apnsVoip: success outcome logged with counts", /incoming-call push outcome/.test(src));
  ok("apnsVoip: never logs tokens or the key", !/logger\.\w+\([^)]*(r\.token|AUTH_KEY|deviceToken)/.test(src));
}

// 14. pushDispatch.ts end to end: bundled in memory with mocked supabase,
// logger and accountStatus; global fetch replaced by the mocked Expo.
const { build } = require("esbuild");
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^\.\/(supabase|logger|accountStatus)$/ }, (a) => ({ path: a.path.slice(2), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: {
    supabase: "export const supabaseServiceRole = globalThis.__pushMock.db;",
    logger: "export const logger = globalThis.__pushMock.logger;",
    accountStatus: "export const getDeactivatedUserIds = (ids) => globalThis.__pushMock.deactivated(ids);",
  }[a.path] }));
} };
const bundled = await build({ entryPoints: [path.join(root, "src/lib/pushDispatch.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin] });
const tmp = mkdtempSync(path.join(os.tmpdir(), "pushdispatch-test-"));
const bundlePath = path.join(tmp, "pushDispatch.mjs");
writeFileSync(bundlePath, bundled.outputFiles[0].text);

// Minimal chainable query builder over in-memory tables.
function makeDb(state) {
  const match = (row, filters) => filters.every(([op, col, val]) =>
    op === "eq" ? row[col] === val : op === "neq" ? row[col] !== val : op === "is" ? (row[col] ?? null) === val : op === "in" ? val.includes(row[col]) : true);
  return { from(table) {
    const q = { table, op: "select", filters: [], payload: null, single: false };
    const exec = () => {
      const rows = state.tables[table] ?? [];
      if (q.op === "update") {
        const hit = rows.filter((r) => match(r, q.filters));
        hit.forEach((r) => Object.assign(r, q.payload));
        state.writes.push({ table, payload: { ...q.payload }, ids: hit.map((r) => r.id ?? r.token) });
        return { data: q.single ? (hit[0] ?? null) : hit, error: null };
      }
      let out = rows.filter((r) => match(r, q.filters));
      if (q.limit) out = out.slice(0, q.limit);
      return { data: q.single ? (out[0] ?? null) : out, error: null };
    };
    const chain = {
      select() { return chain; }, order() { return chain; },
      limit(n) { q.limit = n; return chain; },
      update(p) { q.op = "update"; q.payload = p; return chain; },
      eq(c, v) { q.filters.push(["eq", c, v]); return chain; },
      neq(c, v) { q.filters.push(["neq", c, v]); return chain; },
      is(c, v) { q.filters.push(["is", c, v]); return chain; },
      in(c, v) { q.filters.push(["in", c, v]); return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(res, rej) { try { res(exec()); } catch (e) { rej(e); } },
    };
    return chain;
  } };
}
const logs = [];
const lg = (level) => (obj, msg) => logs.push({ level, obj, msg });
const state = { tables: {}, writes: [] };
globalThis.__pushMock = { db: makeDb(state), logger: { info: lg("info"), warn: lg("warn"), error: lg("error"), debug() {} }, deactivated: async () => new Set() };
let expoHandler = okTickets;
const expoCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { const batch = JSON.parse(init.body); expoCalls.push(batch); return expoHandler(batch, expoCalls.length); };
const PD = await import(pathToFileURL(bundlePath).href);

const nowIso = (agoMs = 0) => new Date(Date.now() - agoMs).toISOString();
function seed({ notes, tokens }) {
  state.tables = { p2p_notifications: notes.map((n) => ({ pushed_at: null, title: "T", message: "M", data: {}, ...n })), p2p_push_tokens: tokens.map((t) => ({ is_active: true, platform: "ios", device_id: null, ...t })) };
  state.writes = []; expoCalls.length = 0; logs.length = 0;
}
const pushedAt = (id) => state.tables.p2p_notifications.find((n) => n.id === id).pushed_at;

try {
  // Mixed-project recipient (old + new era tokens) — the production pattern.
  seed({ notes: [{ id: "n1", user_id: "u1", notification_type: "message", created_at: nowIso() }],
    tokens: [{ id: "t1", user_id: "u1", token: tok(1, "old") }, { id: "t2", user_id: "u1", token: tok(2, "new") }] });
  expoHandler = (batch) => {
    const old = batch.filter((m) => m.to.includes("old")).map((m) => m.to), nw = batch.filter((m) => m.to.includes("new")).map((m) => m.to);
    if (old.length && nw.length) return resp(400, { errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS", message: "mixed", details: { "@amen/old": old, "@prod/new": nw } }] });
    return okTickets(batch);
  };
  let r = await PD.dispatchPendingPushes();
  ok("cron: mixed-project recipient delivered to both devices", r.pushed === 2 && r.verdicts.accepted === 1, JSON.stringify(r));
  ok("cron: delivered notification marked pushed", !!pushedAt("n1"));

  // Whole batch rejected permanently → finished, but logged as permanent_failure (not 'pushed' count).
  seed({ notes: [{ id: "n2", user_id: "u1", notification_type: "message", created_at: nowIso() }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = () => resp(400, { errors: [{ code: "VALIDATION_ERROR", message: "bad" }] });
  r = await PD.dispatchPendingPushes();
  ok("cron: permanent failure → pushed=0, verdict logged", r.pushed === 0 && r.verdicts.permanent_failure === 1 && logs.some((l) => l.obj.verdict === "permanent_failure" && l.obj.notificationId === "n2"));

  // Transient failure → NOT marked pushed; stays pending for the next run.
  seed({ notes: [{ id: "n3", user_id: "u1", notification_type: "message", created_at: nowIso() }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = () => resp(503, "down");
  r = await PD.dispatchPendingPushes();
  ok("cron: transient failure → not marked pushed (retried later)", pushedAt("n3") === null && r.retrying === 1 && r.verdicts.retry === 1);
  ok("cron: transient retries bounded (3 attempts)", expoCalls.length === 3, `calls=${expoCalls.length}`);
  expoHandler = okTickets;
  r = await PD.dispatchPendingPushes();
  ok("cron: next run delivers it and marks pushed", !!pushedAt("n3") && r.pushed === 1);

  // Transient past the 6h window → abandoned, finished.
  seed({ notes: [{ id: "n4", user_id: "u1", notification_type: "message", created_at: nowIso(7 * 3600e3) }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = () => resp(503, "down");
  r = await PD.dispatchPendingPushes();
  ok("cron: transient past retry window → abandoned, no infinite retry", !!pushedAt("n4") && r.verdicts.abandoned === 1);

  // Expired incoming call → not sent, reported separately.
  seed({ notes: [{ id: "c1", user_id: "u1", notification_type: "incoming_call", created_at: nowIso(60e3) }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = okTickets;
  r = await PD.dispatchPendingPushes();
  ok("cron: expired call ring not sent, counted as expired", expoCalls.length === 0 && r.verdicts.expired === 1 && r.pushed === 0 && !!pushedAt("c1"));

  // DeviceNotRegistered → token deactivated; others untouched.
  seed({ notes: [{ id: "n5", user_id: "u1", notification_type: "message", created_at: nowIso() }],
    tokens: [{ id: "t1", user_id: "u1", token: tok(1) }, { id: "t2", user_id: "u1", token: tok(2) }] });
  expoHandler = () => resp(200, { data: [{ status: "ok", id: "a" }, { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }] });
  r = await PD.dispatchPendingPushes();
  const tokRows = state.tables.p2p_push_tokens;
  ok("cron: DeviceNotRegistered token deactivated, other kept", r.staleTokens === 1 && tokRows[0].is_active === true && tokRows[1].is_active === false);
  ok("cron: VoIP tokens never sent through Expo", (() => { seed({ notes: [{ id: "n6", user_id: "u1", notification_type: "message", created_at: nowIso() }], tokens: [{ id: "v", user_id: "u1", token: "voipsynthetic", platform: "ios_voip" }] }); return true; })());
  r = await PD.dispatchPendingPushes();
  ok("cron: VoIP-only recipient → no Expo request, no_devices", expoCalls.length === 0 && r.verdicts.no_devices === 1);

  // Immediate dispatch (incoming call): failure rolls the claim back.
  seed({ notes: [{ id: "c2", user_id: "u1", notification_type: "incoming_call", created_at: nowIso() }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = () => resp(502, "bad gateway");
  await PD.dispatchNotificationNow("c2");
  ok("immediate: transient failure → pushed_at rolled back to null", pushedAt("c2") === null);
  ok("immediate: outcome logged as retry", logs.some((l) => l.obj.notificationId === "c2" && l.obj.verdict === "retry"));
  expoHandler = okTickets;
  await PD.dispatchNotificationNow("c2");
  ok("immediate: success → pushed_at set", !!pushedAt("c2"));
  const before = expoCalls.length;
  await PD.dispatchNotificationNow("c2");
  ok("immediate: already claimed → no duplicate send", expoCalls.length === before);

  // Immediate: ambiguous timeout → kept (not rolled back → cron won't re-send).
  seed({ notes: [{ id: "c3", user_id: "u1", notification_type: "incoming_call", created_at: nowIso() }], tokens: [{ id: "t1", user_id: "u1", token: tok(1) }] });
  expoHandler = () => { const e = new Error("t"); e.name = "TimeoutError"; throw e; };
  await PD.dispatchNotificationNow("c3");
  ok("immediate: ambiguous timeout → not re-sent, not rolled back", expoCalls.length === 1 && !!pushedAt("c3"));

  // Immediate: skipDeviceIds (VoIP already ringing that device).
  seed({ notes: [{ id: "c4", user_id: "u1", notification_type: "incoming_call", created_at: nowIso() }],
    tokens: [{ id: "t1", user_id: "u1", token: tok(1), device_id: "dev-ios" }, { id: "t2", user_id: "u1", token: tok(2), device_id: "dev-android" }] });
  expoHandler = okTickets;
  await PD.dispatchNotificationNow("c4", { skipDeviceIds: new Set(["dev-ios"]) });
  ok("immediate: VoIP-reached device skipped, other device pushed", expoCalls.length === 1 && expoCalls[0].length === 1 && expoCalls[0][0].to === tok(2));

  // Own-message guard (Prompt 1): a group message notifies the OTHER
  // members only — a row addressed to the message's own sender (whatever
  // produced it) is never pushed, on the cron path or the immediate one.
  seed({ notes: [
      { id: "m-self", user_id: "author", notification_type: "new_message", created_at: nowIso(), data: { conversationId: "g1", messageId: "msg1", senderId: "author" } },
      { id: "m-ben", user_id: "ben", notification_type: "new_message", created_at: nowIso(), data: { conversationId: "g1", messageId: "msg1", senderId: "author" } },
      { id: "m-cy", user_id: "cy", notification_type: "new_message", created_at: nowIso(), data: { conversationId: "g1", messageId: "msg2", senderId: "author", } },
    ],
    tokens: [{ id: "ta", user_id: "author", token: tok(7, "author") }, { id: "tb", user_id: "ben", token: tok(8, "ben") }, { id: "tc", user_id: "cy", token: tok(9, "cy") }] });
  expoHandler = okTickets;
  r = await PD.dispatchPendingPushes();
  const sentTo = expoCalls.flat().map((m) => m.to);
  ok("own message: the author's own phone gets nothing", !sentTo.includes(tok(7, "author")), JSON.stringify(sentTo));
  ok("own message: the other members are still notified", sentTo.includes(tok(8, "ben")) && sentTo.includes(tok(9, "cy")));
  ok("own message: the self row is handled (never retried)", !!pushedAt("m-self"));
  ok("own message: refusal logged without content", logs.some((l) => l.obj.verdict === "own_message" && l.obj.notificationId === "m-self"));
  ok("each push names its intended recipient (the app hides pushes for another account)",
    expoCalls.flat().every((m) => (m.to === tok(8, "ben") ? m.data.recipientId === "ben" : m.to === tok(9, "cy") ? m.data.recipientId === "cy" : true)));
  seed({ notes: [{ id: "m-now", user_id: "author", notification_type: "new_message", created_at: nowIso(), data: { conversationId: "g1", senderId: "author" } }],
    tokens: [{ id: "ta", user_id: "author", token: tok(7, "author") }] });
  await PD.dispatchNotificationNow("m-now");
  ok("own message (immediate path): not sent, not rolled back", expoCalls.length === 0 && !!pushedAt("m-now"));
  ok("isOwnMessageNotification: only new_message rows whose sender is the recipient",
    PD.isOwnMessageNotification({ user_id: "a", notification_type: "new_message", data: { senderId: "a" } }) === true
    && PD.isOwnMessageNotification({ user_id: "a", notification_type: "new_message", data: { senderId: "b" } }) === false
    && PD.isOwnMessageNotification({ user_id: "a", notification_type: "incoming_call", data: { callerId: "a", senderId: "a" } }) === false
    && PD.isOwnMessageNotification({ user_id: "a", notification_type: "new_message", data: {} }) === false);

  // No log line anywhere contains a full push token.
  ok("pushDispatch logs never contain full tokens", !JSON.stringify(logs).includes("synthetic0001]"));
} finally {
  globalThis.fetch = realFetch;
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
