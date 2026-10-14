// Process-level isolation test for a staging API server. Compiles the real
// server the same way as build.mjs / scripts/start-staging.mjs (into the
// git-ignored dist/staging-test/) and starts it under misconfigurations: each
// must exit BEFORE listening or contacting anything. A valid (synthetic)
// staging configuration runs in check-only mode and must prove that requests
// to production are blocked inside the process.
// Never starts a production-mode server; uses SYNTHETIC keys only.
// Run: node tests/stagingIsolation.test.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
globalThis.require = createRequire(import.meta.url); // as build.mjs does (needed by the pino plugin)

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (p) => `${b64u({ alg: "HS256" })}.${b64u(p)}.synthetic`;
const PROD = "omkqkasniakcnmfcwrvs", STG = "stagingrefaaaaaaaaaa";

const outdir = path.join(root, "dist", "staging-test");
await build({
  entryPoints: [path.join(root, "src/index.ts")], platform: "node", bundle: true, format: "esm",
  outdir, outExtension: { ".js": ".mjs" }, logLevel: "silent",
  external: ["*.node", "pg-native", "bufferutil", "utf-8-validate", "fsevents"],
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: { js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);` },
});
const out = path.join(outdir, "index.mjs");

// Clean base environment: nothing production-related from this shell.
const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(SUPABASE_|AGORA_|APNS_|CALL_ACTION_SECRET$|ANTHROPIC_|API_BIBLE|INVITE_BASE_URL$|NATIVE_CALLS_|P2P_ENV$|PORT$)/.test(k)));
const run = (vars) => {
  const r = spawnSync(process.execPath, [out], { env: { ...base, PORT: "59999", ...vars }, encoding: "utf8", timeout: 60000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}`, timedOut: r.error?.code === "ETIMEDOUT" };
};
const good = { P2P_ENV: "staging", SUPABASE_URL: `https://${STG}.supabase.co`, SUPABASE_ANON_KEY: jwt({ ref: STG, role: "anon" }), SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: STG, role: "service_role" }) };
const refused = (r) => r.code === 1 && /\[envGuard\] refusing to start/.test(r.out) && !/listening|Server (started|running)/i.test(r.out) && !r.timedOut;

const cases = [
  ["staging flag with nothing configured", { P2P_ENV: "staging" }],
  ["staging pointed at the production URL", { ...good, SUPABASE_URL: `https://${PROD}.supabase.co` }],
  ["staging with production URL via SUPABASE_DB_URL", { ...good, SUPABASE_DB_URL: `https://${PROD}.supabase.co` }],
  ["staging with the production service_role key", { ...good, SUPABASE_SERVICE_ROLE_KEY: jwt({ ref: PROD, role: "service_role" }) }],
  ["staging with the production anon key", { ...good, SUPABASE_ANON_KEY: jwt({ ref: PROD, role: "anon" }) }],
  ["staging missing the service_role key", { ...good, SUPABASE_SERVICE_ROLE_KEY: undefined }],
  ["staging with an anon key in the service slot", { ...good, SUPABASE_SERVICE_ROLE_KEY: good.SUPABASE_ANON_KEY }],
  ["staging with keys from a different project", { ...good, SUPABASE_ANON_KEY: jwt({ ref: "otherprojectbbbbbbbb", role: "anon" }) }],
  ["misspelled environment flag", { ...good, P2P_ENV: "stage" }],
];
for (const [name, vars] of cases) {
  const env = Object.fromEntries(Object.entries(vars).filter(([, v]) => v !== undefined));
  const r = run(env);
  ok(`refuses to start: ${name}`, refused(r), `exit ${r.code}${r.timedOut ? " (timed out — it started!)" : ""} ${r.out.split("\n").find((l) => /Error|refusing/.test(l)) ?? ""}`.slice(0, 220));
  ok(`no key material in output: ${name}`, !/synthetic|eyJ/.test(r.out));
}

const chk = run({ ...good, P2P_STAGING_CHECK_ONLY: "1" });
ok("valid staging config accepted (check-only)", chk.code === 0 && /STAGING API: non-production project only/.test(chk.out), `exit ${chk.code} ${chk.out.split("\n").find((l) => /Error/.test(l)) ?? ""}`.slice(0, 220));
ok("inside the real process, a request to production is BLOCKED", /production request BLOCKED/.test(chk.out));
ok("check-only never starts listening", !/listening|Server (started|running)/i.test(chk.out));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
