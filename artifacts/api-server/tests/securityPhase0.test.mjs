// Phase 0 security fixes — the real route files run over HTTP with a mocked
// database (synthetic ids only, nothing leaves localhost):
//   • GET /profiles/:userId/forest: signed out → 401; someone else's lineage
//     → 403; your own (or a super admin) passes the check;
//   • POST /discipleship (an ACTIVE relationship without the other person's
//     consent) is retired: 410, and nothing is written;
//   • migration 232 removes growth_level from what signed-in users may update,
//     and the app no longer writes it.
// Run: node tests/securityPhase0.test.mjs
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

// ── Mocked database: records every write; answers the reads these routes make ──
globalThis.__p0 = { writes: [], profiles: { "u-admin": { id: "u-admin", role: "super_admin" }, "u-ann": { id: "u-ann", role: "student" }, "u-ben": { id: "u-ben", role: "student" } }, rootLookups: [] };
function table(name) {
  const st = { name, filters: {} };
  const q = {
    select() { return q; }, order() { return q; }, limit() { return q; }, in() { return q; }, or() { return q; },
    eq(col, v) { st.filters[col] = v; return q; },
    insert(row) { globalThis.__p0.writes.push(["insert", name, row]); return q; },
    update(row) { globalThis.__p0.writes.push(["update", name, row]); return q; },
    upsert(row) { globalThis.__p0.writes.push(["upsert", name, row]); return q; },
    delete() { globalThis.__p0.writes.push(["delete", name]); return q; },
    async maybeSingle() { return { data: name === "p2p_profiles" ? globalThis.__p0.profiles[st.filters.id] ?? null : null, error: null }; },
    async single() {
      // The forest's root-profile lookup: count it (it means the request got past the access check), answer "not found".
      if (name === "p2p_profiles") globalThis.__p0.rootLookups.push(st.filters.id);
      return { data: null, error: { message: "not found" } };
    },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return q;
}
const db = { from: table, storage: { from: () => ({}) }, auth: { getUser: async () => ({ data: { user: null }, error: null }) }, rpc: async () => ({ data: null, error: null }) };
globalThis.__p0.db = db;

const tmpDir = path.join(root, "tests", `.tmp-phase0-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mocks = {
  "supabase-js": "export const createClient = () => globalThis.__p0.db;",
  supabase: "export const supabaseServiceRole = globalThis.__p0.db; export const supabase = globalThis.__p0.db; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;",
  username: "export const validateUsername = () => null; export const formatUsername = (u) => u;",
  minors: "export const withoutChildren = async (_db, ids) => ids;",
  studyPartnerAuth: "export const getEligibleStudyPartners = async () => new Map();",
  multer: "const m = () => ({ single: () => (_q, _s, n) => n() }); m.memoryStorage = () => ({}); export default m;",
};
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: "supabase-js", namespace: "mock" }));
  b.onResolve({ filter: /^multer$/ }, () => ({ path: "multer", namespace: "mock" }));
  b.onResolve({ filter: /(^|\/)(supabase|username|minors|studyPartnerAuth)$/ }, (a) => ({ path: a.path.split("/").pop(), namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ loader: "js", contents: mocks[a.path] }));
} };
const bundle = async (entry, name) => {
  const out = await build({ entryPoints: [path.join(root, entry)], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, name); writeFileSync(f, out.outputFiles[0].text); return import(pathToFileURL(f).href);
};

try {
  const profiles = (await bundle("src/routes/profiles.ts", "profiles.mjs")).default;
  const discipleship = (await bundle("src/routes/discipleship.ts", "discipleship.mjs")).default;
  const app = express();
  app.use(express.json());
  app.use("/profiles", profiles);
  app.use("/discipleship", discipleship);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, user) => fetch(base + p, { headers: user ? { "x-test-user": user } : {} });

  // ── The forest (lineage) route ──
  let r = await get("/profiles/u-ann/forest");
  ok("forest: signed out → 401, and nothing is looked up", r.status === 401 && globalThis.__p0.rootLookups.length === 0, String(r.status));
  r = await get("/profiles/u-ann/forest", "u-ben");
  ok("forest: someone else's lineage → 403, and nothing is looked up", r.status === 403 && globalThis.__p0.rootLookups.length === 0, String(r.status));
  r = await get("/profiles/u-ann/forest", "u-ann");
  ok("forest: your own lineage passes the check", r.status === 404 && globalThis.__p0.rootLookups.at(-1) === "u-ann", String(r.status));
  r = await get("/profiles/u-ann/forest", "u-admin");
  ok("forest: a super admin may look at anyone's", r.status === 404 && globalThis.__p0.rootLookups.at(-1) === "u-ann", String(r.status));
  r = await get("/profiles/u-ann/forest", "u-unknown");
  ok("forest: an account with no profile → 403", r.status === 403, String(r.status));

  // ── Creating an active relationship without consent ──
  const before = globalThis.__p0.writes.length;
  r = await fetch(base + "/discipleship", { method: "POST", headers: { "content-type": "application/json", "x-test-user": "u-ann" }, body: JSON.stringify({ mentorId: "u-ann", discipleId: "u-ben" }) });
  const body = await r.json();
  ok("POST /discipleship is retired (410) and points to the consent flow", r.status === 410 && /request/.test(body.error));
  ok("…and writes nothing", globalThis.__p0.writes.length === before);
  r = await fetch(base + "/discipleship", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  ok("…signed out too", r.status === 410 && globalThis.__p0.writes.length === before);
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── Growth level: database + app ──
const m232 = readFileSync(path.join(repo, "migrations/232_growth_level_server_only.sql"), "utf8");
const code232 = m232.replace(/--.*$/gm, "");
ok("232: growth_level update revoked from signed-in users and anon; nothing else", /revoke update \(growth_level\) on public\.p2p_profiles from authenticated;/.test(code232)
  && /revoke update \(growth_level\) on public\.p2p_profiles from anon;/.test(code232) && !/\b(grant|delete|drop|truncate|insert)\b/i.test(code232));
const auth = readFileSync(path.join(repo, "artifacts/mobile/contexts/AuthContext.tsx"), "utf8");
ok("app: updateProfile no longer writes growth_level", !/dbUpdates\.growth_level\s*=/.test(auth));
const data = readFileSync(path.join(repo, "artifacts/mobile/contexts/DataContext.tsx"), "utf8");
ok("app: the forest is fetched signed in (apiFetch)", data.includes("await apiFetch(`/profiles/${userId}/forest`)") && !data.includes("fetch(`${getApiUrl()}/profiles/${userId}/forest`)"));

console.log(`securityPhase0: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
