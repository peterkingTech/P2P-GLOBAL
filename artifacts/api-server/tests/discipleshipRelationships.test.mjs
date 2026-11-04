// Discipleship relationships (migration 233) — routes/discipleship.ts run for
// real over HTTP against an in-memory database (synthetic ids, localhost only):
//   • /relationships/me lists only the caller's own mentors and disciples;
//   • end / pause / resume: either person; strangers get 404; the database's
//     refusals come back as plain 409 answers; the other person is told,
//     never the (possibly personal) reason;
//   • primary mentor: only the disciple chooses;
//   • every "who is my mentor?" lookup asks for the PRIMARY mentor, so a
//     second mentor never breaks a single-mentor read.
// Run: node tests/discipleshipRelationships.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(root, "../..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// ── In-memory tables + the two server-only functions ──
const T = {
  p2p_discipleship_links: [
    { id: "l1", mentor_id: "ann", disciple_id: "ben", status: "active", is_primary: true, started_at: "2026-10-01", paused_at: null, ended_at: null, end_reason: null, created_at: "2026-10-01" },
    { id: "l2", mentor_id: "cat", disciple_id: "ben", status: "active", is_primary: false, started_at: "2026-10-05", paused_at: null, ended_at: null, end_reason: null, created_at: "2026-10-05" },
    { id: "l3", mentor_id: "ben", disciple_id: "dan", status: "ended", is_primary: false, started_at: "2026-09-01", paused_at: null, ended_at: "2026-09-20", end_reason: "Moved", created_at: "2026-09-01" },
    { id: "l4", mentor_id: "eve", disciple_id: "fay", status: "active", is_primary: true, started_at: "2026-10-01", paused_at: null, ended_at: null, end_reason: null, created_at: "2026-10-01" },
  ],
  p2p_profiles: [{ id: "ann", full_name: "Ann" }, { id: "ben", full_name: "Ben" }, { id: "cat", full_name: "Cat" }, { id: "dan", full_name: "Dan" }, { id: "eve", full_name: "Eve" }, { id: "fay", full_name: "Fay" }],
  p2p_notifications: [],
};
const rpcCalls = [];
function query(name) {
  let rows = () => T[name] ?? [];
  const f = [];
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; },
    eq(c, v) { f.push((r) => r[c] === v); return q; },
    in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
    or(expr) { const ids = [...expr.matchAll(/(mentor_id|disciple_id)\.eq\.([\w-]+)/g)]; f.push((r) => ids.some(([, c, v]) => r[c] === v)); return q; },
    insert(row) { (T[name] ??= []).push(...[].concat(row)); return Promise.resolve({ data: null, error: null }); },
    async maybeSingle() { const r = rows().filter((x) => f.every((p) => p(x))); return { data: r[0] ? { ...r[0] } : null, error: null }; },   // copies, as the real client returns
    then(res) { return Promise.resolve({ data: rows().filter((x) => f.every((p) => p(x))).map((x) => ({ ...x })), error: null }).then(res); },
  };
  return q;
}
const db = {
  from: query,
  async rpc(fn, args) {
    rpcCalls.push([fn, args]);
    const l = T.p2p_discipleship_links.find((x) => x.id === args.p_link);
    if (fn === "p2p_link_set_status") {
      if (l.status === "ended") return { data: null, error: { message: "P2P_LINK: only an active or paused relationship can be ended" } };
      if (l.status === args.p_status) return { data: l.status, error: null };
      l.status = args.p_status; return { data: l.status, error: null };
    }
    if (fn === "p2p_link_set_primary") { for (const x of T.p2p_discipleship_links) if (x.disciple_id === l.disciple_id) x.is_primary = x.id === l.id; return { data: null, error: null }; }
    return { data: null, error: { message: "unknown" } };
  },
};
globalThis.__dr = db;

const tmpDir = path.join(root, "tests", `.tmp-relationships-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mocks = {
  "supabase-js": "export const createClient = () => globalThis.__dr;",
  supabase: "export const verifyCaller = async (req) => req.headers['x-test-user'] || null; export const supabaseServiceRole = globalThis.__dr;",
  studyPartnerAuth: "export const getEligibleStudyPartners = async () => new Map();",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "supabase-js", namespace: "mock" }));
  b.onResolve({ filter: /(^|\/)(supabase|studyPartnerAuth)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };

try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/discipleship.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, "discipleship.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const router = (await import(pathToFileURL(f).href)).default;
  const app = express(); app.use(express.json()); app.use("/discipleship", router);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/discipleship`;
  const call = (method, p, user, body) => fetch(base + p, { method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });

  let r = await call("GET", "/relationships/me");
  ok("list: signed out → 401", r.status === 401);
  r = await call("GET", "/relationships/me", "ben");
  let j = await r.json();
  ok("list: Ben sees his two mentors (primary marked) and his ended disciple (history kept)", j.mentors.length === 2 && j.mentors.find((m) => m.person.name === "Ann").isPrimary && j.disciples.length === 1 && j.disciples[0].status === "ended" && j.disciples[0].endReason === "Moved");
  ok("list: nobody else's relationships", ![...j.mentors, ...j.disciples].some((x) => ["Eve", "Fay"].includes(x.person.name)));

  r = await call("PUT", "/relationships/l4/end", "ben", { reason: "x" });
  ok("end: a stranger can't touch someone else's relationship (404)", r.status === 404 && T.p2p_discipleship_links.find((x) => x.id === "l4").status === "active");
  r = await call("PUT", "/relationships/l2/pause", "cat", { reason: "Travelling" });
  j = await r.json();
  const n1 = T.p2p_notifications.at(-1);
  ok("pause: the mentor may pause; the actor and reason go to the database", r.status === 200 && j.status === "paused" && rpcCalls.at(-1)[1].p_actor === "cat" && rpcCalls.at(-1)[1].p_reason === "Travelling");
  ok("…the disciple is told — without the reason", n1?.user_id === "ben" && n1.notification_type === "peer_guide_relationship_changed" && !/Travelling/.test(n1.message) && /paused/.test(n1.message));
  r = await call("PUT", "/relationships/l2/resume", "ben");
  ok("resume: the disciple may resume", r.status === 200 && (await r.json()).status === "active" && T.p2p_notifications.at(-1).user_id === "cat");
  const before = T.p2p_notifications.length;
  r = await call("PUT", "/relationships/l2/resume", "ben");
  ok("resume again: no change, nobody notified twice", r.status === 200 && T.p2p_notifications.length === before);
  r = await call("PUT", "/relationships/l3/end", "ben");
  j = await r.json();
  ok("the database's refusal comes back as a plain 409", r.status === 409 && /only an active or paused relationship can be ended/i.test(j.error), JSON.stringify(j));

  r = await call("PUT", "/relationships/l2/primary", "cat");
  ok("primary: a mentor can't make themselves primary (403)", r.status === 403 && !T.p2p_discipleship_links.find((x) => x.id === "l2").is_primary);
  r = await call("PUT", "/relationships/l2/primary", "ben");
  ok("primary: the disciple chooses — exactly one primary", r.status === 200 && T.p2p_discipleship_links.filter((x) => x.disciple_id === "ben" && x.is_primary).map((x) => x.id).join() === "l2");
  r = await call("PUT", "/relationships/l1/end", "ann", { reason: "Season ended" });
  ok("end: either person may end it", r.status === 200 && T.p2p_discipleship_links.find((x) => x.id === "l1").status === "ended");
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── Single-mentor reads now ask for the primary mentor ──
const read = (p) => readFileSync(path.join(repo, p), "utf8");
const sites = [
  ["artifacts/api-server/src/lib/pastoralCare.ts", 1], ["artifacts/api-server/src/routes/discipleship.ts", 2], ["artifacts/api-server/src/routes/prayer.ts", 1],
  ["artifacts/api-server/src/routes/profiles.ts", 1], ["artifacts/api-server/src/routes/churches.ts", 1],
  ["artifacts/mobile/app/(auth)/journey.tsx", 1], ["artifacts/mobile/app/completion.tsx", 1],
];
for (const [p, n] of sites) ok(`${p.split("/").pop()}: "who is my mentor?" asks for the primary mentor (${n})`, (read(p).match(/\.eq\("active", true\)\.eq\("is_primary", true\)/g) ?? []).length === n);
const cats = read("artifacts/api-server/src/lib/notificationCategories.ts");
ok("the new notification type is categorised (peer guide)", /peer_guide_relationship_changed: "peer_guide"/.test(cats));

console.log(`discipleshipRelationships: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
