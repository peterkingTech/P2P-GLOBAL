// Tests for the API server's backend guard (src/lib/serverEnv.ts +
// src/lib/envGuard.ts). SYNTHETIC tokens only. Also bundles the server IN
// MEMORY with esbuild (nothing written to dist/) to prove the guard runs
// before any module creates a Supabase client.
// Run: node tests/serverEnv.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const js = ts.transpileModule(readFileSync(path.join(root, "src/lib/serverEnv.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, Buffer });
const S = mod.exports;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64u({ alg: "HS256" })}.${b64u(p)}.synthetic`;
const PROD = S.PRODUCTION_REF, STG = "stagingrefaaaaaaaaaa";
const good = { P2P_ENV: "staging", SUPABASE_URL: `https://${STG}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: STG, role: "service_role" }), SUPABASE_ANON_KEY: jwt({ ref: STG, role: "anon" }) };
const has = (r, re) => r.errors.some((m) => re.test(m));

ok("production (unset): no-op, no errors", S.checkServerEnv({}).errors.length === 0 && S.checkServerEnv({}).target === "production");
ok("production with missing vars still a no-op (unchanged behaviour)", S.checkServerEnv({ P2P_ENV: "production" }).errors.length === 0);
ok("invalid P2P_ENV rejected", has(S.checkServerEnv({ P2P_ENV: "stage" }), /must be "production" or "staging"/));
ok("valid staging accepted", S.checkServerEnv(good).errors.length === 0 && S.checkServerEnv(good).ref === STG);
ok("staging with nothing set rejected (never falls back to production)", S.checkServerEnv({ P2P_ENV: "staging" }).errors.length >= 3);
ok("staging pointed at production URL rejected", has(S.checkServerEnv({ ...good, SUPABASE_URL: `https://${PROD}.supabase.co` }), /PRODUCTION Supabase project/));
ok("staging via an https SUPABASE_DB_URL to production rejected", has(S.checkServerEnv({ ...good, SUPABASE_DB_URL: `https://${PROD}.supabase.co` }), /PRODUCTION Supabase project/));
ok("staging with production service key rejected", has(S.checkServerEnv({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD, role: "service_role" }) }), /PRODUCTION service_role/));
ok("staging with production anon key rejected", has(S.checkServerEnv({ ...good, SUPABASE_ANON_KEY: jwt({ ref: PROD, role: "anon" }) }), /PRODUCTION anon key/));
ok("anon key in the service-role slot rejected", has(S.checkServerEnv({ ...good, SUPABASE_SERVICE_ROLE_KEY: good.SUPABASE_ANON_KEY }), /not a service_role key/));
ok("keys from another project rejected", has(S.checkServerEnv({ ...good, SUPABASE_ANON_KEY: jwt({ ref: "otherprojectbbbbbbbb", role: "anon" }) }), /different project/));
ok("malformed URL rejected", has(S.checkServerEnv({ ...good, SUPABASE_URL: "https://example.com" }), /must look like/));
ok("error messages never contain key material", S.checkServerEnv({ ...good, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD, role: "service_role" }) }).errors.every((m) => !m.includes("synthetic") && !m.includes("eyJ")));

const idx = readFileSync(path.join(root, "src/index.ts"), "utf8");
const firstImport = idx.split("\n").find((l) => /^import /.test(l));
ok("index.ts: envGuard is the very first import", firstImport === 'import "./lib/envGuard";', firstImport);

// In-memory bundle: guard code must precede every createClient( call.
const { build } = require("esbuild");
const res = await build({
  entryPoints: [path.join(root, "src/index.ts")], platform: "node", bundle: true, format: "esm", write: false, logLevel: "silent",
  external: ["*.node", "sharp", "pg-native", "bufferutil", "utf-8-validate", "pino", "pino-pretty", "thread-stream"],
});
const out = res.outputFiles[0].text;
const guardAt = out.indexOf("[envGuard] refusing to start");
const firstClient = out.search(/\bcreateClient\d*\(\s*[A-Za-z_$]/);
ok("bundle: guard runs before the first Supabase client is created", guardAt > -1 && firstClient > -1 && guardAt < firstClient, `guard@${guardAt} client@${firstClient}`);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
