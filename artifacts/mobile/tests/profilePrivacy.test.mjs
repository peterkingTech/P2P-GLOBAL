// Regression guard for migration 185 (owner-only profile fields).
// Static checks over the app source: the app must never select another
// user's private profile fields, never select("*") or upsert p2p_profiles,
// and must load the user's own private fields through
// p2p_my_private_profile(). Run: node tests/profilePrivacy.test.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const PRIVATE = ["email", "date_of_birth", "latitude", "longitude", "location_point", "send_read_receipts"];
const files = [];
(function walk(d) {
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e.startsWith(".") || e === "tests") continue;
    const p = path.join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e)) files.push(p);
  }
})(root);
const rel = (p) => path.relative(root, p).split(path.sep).join("/");
const src = Object.fromEntries(files.map((f) => [rel(f), readFileSync(f, "utf8")]));

// 1. The own-profile column list never contains a private column.
const pc = readFileSync(path.join(root, "lib/profileColumns.ts"), "utf8");
const cols = /PROFILE_COLUMNS = `([\s\S]*?)`/.exec(pc)[1].replace(/\s+/g, "").split(",");
ok("PROFILE_COLUMNS excludes every owner-only column", PRIVATE.every((c) => !cols.includes(c)), PRIVATE.filter((c) => cols.includes(c)).join());
ok("PROFILE_COLUMNS still has the core public fields", ["id", "full_name", "username", "role", "photo_url"].every((c) => cols.includes(c)));

// 2. Direct reads of p2p_profiles: no "*", no private column, except the two
//    documented fallbacks for servers without migration 185.
const ALLOWED_PRIVATE_READS = [
  ["contexts/AuthContext.tsx", 'select("email,date_of_birth")'],
  ["contexts/DataContext.tsx", 'select("id, full_name, email, role")'],
];
const offenders = [];
for (const [f, s] of Object.entries(src)) {
  for (const m of s.matchAll(/from\(\s*["']p2p_profiles["']\s*\)([\s\S]{0,300}?)(?=;|\n\s*\n)/g)) {
    const chain = m[1];
    const sel = /\.select\(\s*([`"'])([\s\S]*?)\1/.exec(chain);
    if (/\.upsert\(/.test(chain)) offenders.push(`${f}: upsert on p2p_profiles`);
    if (!sel) continue;
    const list = sel[2].replace(/\s+/g, "").split(",");
    if (list.includes("*")) offenders.push(`${f}: select("*")`);
    const priv = list.filter((c) => PRIVATE.includes(c));
    if (priv.length && !ALLOWED_PRIVATE_READS.some(([af, frag]) => af === f && chain.includes(frag))) offenders.push(`${f}: selects ${priv.join(",")}`);
  }
  // embedded joins p2p_profiles(...)
  for (const m of s.matchAll(/p2p_profiles(?:![a-z_]+)?\s*\(([^)]*)\)/g)) {
    const priv = m[1].replace(/\s+/g, "").split(",").filter((c) => PRIVATE.includes(c) || c === "*");
    if (priv.length) offenders.push(`${f}: embedded p2p_profiles(${priv.join(",")})`);
  }
}
ok("no direct or embedded read of private profile columns, no select('*'), no upsert", offenders.length === 0, offenders.join(" | "));

// 3. The fallbacks only run when the function is missing.
const auth = src["contexts/AuthContext.tsx"];
ok("own private fields come from p2p_my_private_profile()", /rpc\("p2p_my_private_profile"\)/.test(auth));
ok("legacy own-field read is guarded by isMissingFunction", /if \(isMissingFunction\(error\)\) \{\s*const \{ data: legacy \} = await supabase\.from\("p2p_profiles"\)\.select\("email,date_of_birth"\)\.eq\("id", userId\)/.test(auth));
ok("legacy own-field read is scoped to the signed-in user's id", /select\("email,date_of_birth"\)\.eq\("id", userId\)/.test(auth));
const data = src["contexts/DataContext.tsx"];
ok("admin Team directory comes from p2p_admin_team_directory()", /rpc\("p2p_admin_team_directory"\)/.test(data));
ok("admin legacy read only when the function is missing", /if \(!r\.error \|\| !isMissingFunction\(r\.error\)\) return r;/.test(data));

// 4. Registration uses a plain insert and recognises a retried sign-up safely.
ok("registration inserts (no upsert)", /from\("p2p_profiles"\)\.insert\(profileRow\)/.test(auth) && !/from\("p2p_profiles"\)\.upsert\(/.test(auth));
ok("duplicate treated as success only if the user's own row exists", /insertErr\?\.code === "23505"[\s\S]{0,200}select\("id"\)\.eq\("id", data\.user\.id\)\.maybeSingle\(\)[\s\S]{0,80}alreadyCreated = !!own/.test(auth));

// 4b. Account switching / transient failure: private fields are only ever
//     carried over for the SAME user, never from a previous account.
ok("transient private-field failure keeps values only for the same user", /const keep = !priv && prev\?\.id === userId \? prev : null;/.test(auth));
ok("fresh private fields always replace kept ones", /email: priv \? priv\.email : keep\?\.email \?\? null/.test(auth) && /date_of_birth: priv \? priv\.date_of_birth : keep\?\.dateOfBirth \?\? null/.test(auth));
ok("sign-out clears the session's delivery acknowledgements (receipts)", /deliveryAcker\.reset\(\)/.test(data));

// 5. isMissingFunction behaviour.
const js = ts.transpileModule(pc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports });
const { isMissingFunction, PRIVATE_PROFILE_COLUMNS } = mod.exports;
ok("isMissingFunction: PostgREST unknown function", isMissingFunction({ code: "PGRST202" }) === true);
ok("isMissingFunction: SQL undefined function", isMissingFunction({ code: "42883" }) === true);
ok("isMissingFunction: permission denied is NOT treated as missing", isMissingFunction({ code: "42501" }) === false);
ok("isMissingFunction: no error", isMissingFunction(null) === false);
ok("PRIVATE_PROFILE_COLUMNS matches migration 185", JSON.stringify([...PRIVATE_PROFILE_COLUMNS]) === JSON.stringify(PRIVATE));
const mig = readFileSync(path.join(root, "../../migrations/185_profile_private_fields.sql"), "utf8");
ok("migration 185 withholds exactly the same columns", PRIVATE.every((c) => mig.includes(`'${c}'`)));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
