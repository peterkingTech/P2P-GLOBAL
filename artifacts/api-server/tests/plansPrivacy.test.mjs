// Learning Centre plans privacy (2026-11-14): /plans/saved|active|completed|recommended/:userId, the
// progress route and save/unsave used to trust a userId from the path / body, so anyone could read or
// change anyone's saved plans. Now a signed-in token always decides (the userId must be the caller's own);
// token-less legacy builds keep working until PLANS_REQUIRE_AUTH=true. Executes the real planUser().
// Run: node tests/plansPrivacy.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = readFileSync(path.join(root, "src/routes/curriculum.ts"), "utf8");
const fn = src.slice(src.indexOf("async function planUser("), src.indexOf("// GET /plans/:planId/progress/:userId"));
const js = ts.transpileModule(fn, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const verifyCaller = async (req) => (req.headers.authorization === "Bearer ann-token" ? "ann" : null);
const planUser = new Function("verifyCaller", "process", `${js}; return planUser;`);
const run = async (headers, claimed, env = {}) => {
  const out = { status: 200, body: null };
  const res = { status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  const id = await planUser(verifyCaller, { env })({ headers }, res, claimed);
  return { id, ...out };
};
const signed = { authorization: "Bearer ann-token" };
let r = await run(signed, "ann"); ok("signed in, own id → allowed", r.id === "ann");
r = await run(signed, "ben"); ok("signed in as Ann, asking for Ben's plans → 403", r.id === null && r.status === 403);
r = await run(signed, undefined); ok("signed in, no userId (save/unsave) → the caller", r.id === "ann");
r = await run({ authorization: "Bearer forged" }, "ben"); ok("a bad token → 401 (never falls back to the claimed id)", r.id === null && r.status === 401);
r = await run({}, "ben"); ok("legacy build (no token) keeps working until the switch", r.id === "ben");
r = await run({}, "ben", { PLANS_REQUIRE_AUTH: "true" }); ok("PLANS_REQUIRE_AUTH=true → token required (401)", r.id === null && r.status === 401);
r = await run({}, undefined); ok("legacy build with no userId → 400", r.id === null && r.status === 400);
for (const route of ["/plans/saved/:userId", "/plans/active/:userId", "/plans/completed/:userId", "/plans/recommended/:userId", "/plans/:planId/progress/:userId"]) {
  const body = src.slice(src.indexOf(`router.get("${route}"`), src.indexOf(`router.get("${route}"`) + 260);
  ok(`${route} goes through planUser`, body.includes("await planUser(req, res, req.params.userId)") && !body.includes("const { userId } = req.params"));
}
const save = src.slice(src.indexOf('router.post("/plans/:planId/save"'), src.indexOf('// GET /plans/saved/:userId'));
ok("save and unsave go through planUser (body / query userId no longer trusted)", (save.match(/await planUser\(/g) ?? []).length === 2);
const app = readFileSync(path.join(root, "../mobile/app/plans/learning.tsx"), "utf8");
ok("the app sends its sign-in token on every plans call", !app.includes("fetch(`${getApiUrl()}/plans/") && (app.match(/apiFetch\(`\/plans\//g) ?? []).length === 5);
console.log(`plansPrivacy (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
