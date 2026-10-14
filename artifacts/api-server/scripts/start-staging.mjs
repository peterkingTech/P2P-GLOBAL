// Starts a LOCAL, ISOLATED staging API server.
//   node scripts/start-staging.mjs [--port 5055] [--check-only]
//
// - Reads ONLY artifacts/api-server/.env.staging.local (must be git-ignored):
//     STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_SUPABASE_SERVICE_ROLE_KEY
// - Starts from a clean environment: every production-related variable that
//   may be set in the parent shell (SUPABASE_*, AGORA_*, APNS_*, call/AI/Bible
//   secrets, …) is removed, so nothing from production can leak in.
// - Forces P2P_ENV=staging, so src/lib/envGuard.ts validates the project and
//   blocks every request to production at the network layer.
// - Compiles to dist/staging-run/ (inside the git-ignored dist/, never the
//   production dist/index.mjs) with dependencies left external.
// - Push (APNs), Agora calls, AI translation, Bible API and account deletion
//   are deliberately unconfigured: those features fail closed on staging.
// Never prints keys.
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { build } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";

export const STAGING_BANNER = `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';
globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);`;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
globalThis.require = createRequire(import.meta.url); // as build.mjs does (needed by the pino plugin)
const ENV_FILE = path.join(root, ".env.staging.local");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const port = String(arg("--port", "5055"));
const checkOnly = process.argv.includes("--check-only");
const stop = (m) => { console.error(`[start-staging] ${m}`); process.exit(1); };

if (!existsSync(ENV_FILE)) stop(".env.staging.local not found");
if (spawnSync("git", ["check-ignore", "-q", ENV_FILE], { cwd: root }).status !== 0) stop(".env.staging.local is not git-ignored — refusing to read it");
const file = Object.fromEntries(readFileSync(ENV_FILE, "utf8").split(/\r?\n/)
  .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")]));
const missing = ["STAGING_SUPABASE_URL", "STAGING_SUPABASE_ANON_KEY", "STAGING_SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !file[k]);
if (missing.length) stop(`missing in .env.staging.local: ${missing.join(", ")} (add them there yourself; never paste keys into chat)`);

const PRODUCTION_LIKE = /^(SUPABASE_|AGORA_|APNS_|CALL_ACTION_SECRET$|ANTHROPIC_|API_BIBLE|API_B$|INVITE_BASE_URL$|NATIVE_CALLS_|ACCOUNT_DELETION|DATABASE_URL$|PG[A-Z]*$|PROD_|RAILWAY_)/;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !PRODUCTION_LIKE.test(k) && k !== "P2P_ENV"));
Object.assign(env, {
  P2P_ENV: "staging",
  SUPABASE_URL: file.STAGING_SUPABASE_URL,
  SUPABASE_ANON_KEY: file.STAGING_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: file.STAGING_SUPABASE_SERVICE_ROLE_KEY,
  ACCOUNT_DELETION_ENABLED: "false",
  NODE_ENV: "development",
  PORT: port,
});

const outdir = path.join(root, "dist", "staging-run");
mkdirSync(outdir, { recursive: true });
// Same approach as build.mjs (production): bundle everything, keep only native
// add-ons external, pino transports via its plugin, CJS interop banner.
await build({
  entryPoints: [path.join(root, "src/index.ts")],
  platform: "node", bundle: true, format: "esm",
  outdir, outExtension: { ".js": ".mjs" }, logLevel: "warning", sourcemap: "linked",
  external: ["*.node", "pg-native", "bufferutil", "utf-8-validate", "fsevents"],
  plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  banner: { js: STAGING_BANNER },
});
console.log(`[start-staging] compiled to dist/staging-run; starting on port ${port} with P2P_ENV=staging`);
// --check-only: the guard validates the configuration, proves production is
// blocked, and exits before the server listens or starts scheduled jobs.
if (checkOnly) env.P2P_STAGING_CHECK_ONLY = "1";
const child = spawn(process.execPath, ["--enable-source-maps", path.join(outdir, "index.mjs")], { env, stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
