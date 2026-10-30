// Tests for build/run-time backend selection: config/supabaseEnv.js and
// app.config.js. Uses SYNTHETIC tokens (fake signature) — never real keys.
// Run: node tests/backendConfig.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const E = require(path.join(root, "config/supabaseEnv.js"));

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const jwt = (payload) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u(payload)}.synthetic-signature`;

const PROD = E.PRODUCTION_REF;
const STG = "stagingrefaaaaaaaaaa"; // 20 chars, synthetic
const OTHER = "otherprojectbbbbbbbb";
const prodUrl = `https://${PROD}.supabase.co`, stgUrl = `https://${STG}.supabase.co`;
const prodAnon = jwt({ iss: "supabase", ref: PROD, role: "anon" });
const prodService = jwt({ iss: "supabase", ref: PROD, role: "service_role" });
const stgAnon = jwt({ iss: "supabase", ref: STG, role: "anon" });
const stgService = jwt({ iss: "supabase", ref: STG, role: "service_role" });
const compiled = { url: prodUrl, anonKey: prodAnon };
const errs = (r) => (r.ok ? [] : r.errors).join(" | ");
const has = (r, re) => !r.ok && r.errors.some((m) => re.test(m));

// ── production (default) ────────────────────────────────────────────────────
let r = E.resolveSupabaseConfig({}, compiled);
ok("unset env → production, compiled-in project", r.ok && r.config.target === "production" && r.config.url === prodUrl && r.config.anonKey === prodAnon, errs(r));
r = E.resolveSupabaseConfig({ EXPO_PUBLIC_P2P_ENV: "production" }, compiled);
ok("explicit production → ok", r.ok);
r = E.resolveSupabaseConfig({ EXPO_PUBLIC_SUPABASE_URL: stgUrl }, compiled);
ok("production pointed at a non-production URL → rejected", has(r, /production build is pointed at a non-production Supabase URL/));
r = E.resolveSupabaseConfig({ EXPO_PUBLIC_SUPABASE_ANON_KEY: prodService }, compiled);
ok("production with a service_role key → rejected", has(r, /service_role/));
r = E.resolveSupabaseConfig({}, { url: prodUrl, anonKey: prodService });
ok("compiled-in service_role key → rejected at run time", has(r, /service_role/));
r = E.resolveSupabaseConfig({}, { url: prodUrl, anonKey: stgAnon });
ok("compiled-in key from another project → rejected", has(r, /different project/));
r = E.resolveSupabaseConfig({}, { url: stgUrl, anonKey: prodAnon });
ok("compiled-in URL not production → rejected", has(r, /not the production project/));
r = E.resolveSupabaseConfig({}, { url: null, anonKey: null });
ok("build time (no compiled values) → production ok", r.ok && r.config.url === prodUrl);
r = E.resolveSupabaseConfig({ EXPO_PUBLIC_P2P_ENV: "prod" }, compiled);
ok("invalid EXPO_PUBLIC_P2P_ENV → rejected", has(r, /must be "production" or "staging"/));

// ── staging ─────────────────────────────────────────────────────────────────
const stg = { EXPO_PUBLIC_P2P_ENV: "staging", EXPO_PUBLIC_SUPABASE_URL: stgUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: stgAnon, EXPO_PUBLIC_API_URL: "disabled" };
r = E.resolveSupabaseConfig(stg, compiled);
ok("valid staging → staging project (compiled production values ignored)", r.ok && r.config.target === "staging" && r.config.url === stgUrl && r.config.anonKey === stgAnon, errs(r));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_URL: prodUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: prodAnon }, compiled);
ok("staging pointed at the PRODUCTION project → rejected", has(r, /PRODUCTION Supabase project/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_ANON_KEY: prodAnon }, compiled);
ok("staging with the PRODUCTION anon key → rejected", has(r, /PRODUCTION anon key|different project/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_ANON_KEY: stgService }, compiled);
ok("staging with a service_role key → rejected", has(r, /service_role/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt({ ref: OTHER, role: "anon" }) }, compiled);
ok("staging key from another project → rejected", has(r, /different project/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_ANON_KEY: "not-a-jwt" }, compiled);
ok("malformed key → rejected", has(r, /not a valid Supabase JWT/));
r = E.resolveSupabaseConfig({ EXPO_PUBLIC_P2P_ENV: "staging" }, compiled);
ok("staging with nothing set → rejected (never falls back to production)", !r.ok && r.errors.length >= 3, errs(r));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_SUPABASE_URL: "https://example.com" }, compiled);
ok("staging URL not a Supabase project URL → rejected", has(r, /must look like/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_API_URL: undefined }, compiled);
ok("staging without an API setting → rejected", has(r, /needs EXPO_PUBLIC_API_URL/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_API_URL: "https://workspaceapi-server-production-6d56.up.railway.app/api" }, compiled);
ok("staging pointed at the PRODUCTION API → rejected", has(r, /PRODUCTION API server/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_API_URL: "http://api.example.com/api" }, compiled);
ok("staging with a public plain-http API → rejected", has(r, /plain http/));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_API_URL: "http://192.168.1.20:5000/api" }, compiled);
ok("staging with a LAN test API → ok", r.ok, errs(r));
r = E.resolveSupabaseConfig({ ...stg, EXPO_PUBLIC_API_URL: "https://staging-api.example.com/api" }, compiled);
ok("staging with a separate https API → ok", r.ok, errs(r));

// ── EAS profile rules ───────────────────────────────────────────────────────
const prodApi = { EXPO_PUBLIC_API_URL: "https://workspaceapi-server-production-6d56.up.railway.app/api" };
ok("profile production + production env + production API → ok", E.validateBuildProfile("production", prodApi).length === 0);
ok("profile production + staging env → rejected", E.validateBuildProfile("production", { ...prodApi, EXPO_PUBLIC_P2P_ENV: "staging" }).some((m) => /must build EXPO_PUBLIC_P2P_ENV=production/.test(m)));
ok("profile production + non-production API → rejected", E.validateBuildProfile("production", { EXPO_PUBLIC_API_URL: "https://staging-api.example.com/api" }).some((m) => /production API server/.test(m)));
ok("profile production + missing API → rejected", E.validateBuildProfile("production", {}).length > 0);
ok("profile staging + production env → rejected", E.validateBuildProfile("staging", {}).some((m) => /must build EXPO_PUBLIC_P2P_ENV=staging/.test(m)));
ok("profile staging + staging env → ok", E.validateBuildProfile("staging", stg).length === 0);
ok("other profiles unaffected", E.validateBuildProfile("development", prodApi).length === 0 && E.validateBuildProfile(null, {}).length === 0);

// ── app.config.js (what EAS actually evaluates) ────────────────────────────
const appJson = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8")).expo;
const KEYS = ["EXPO_PUBLIC_P2P_ENV", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_API_URL", "EAS_BUILD_PROFILE"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const withEnv = (vars, fn) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try { return fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const appConfig = require(path.join(root, "app.config.js"));
const run = (vars) => withEnv(vars, () => { try { return { config: appConfig({ config: structuredClone(appJson) }) }; } catch (e) { return { error: String(e.message) }; } });

let c = run({});
// Default build: app.json unchanged except the home-screen widgets plugin added at the end.
const withWidgets = { ...structuredClone(appJson), plugins: [...(appJson.plugins ?? []), "./plugins/withP2PWidgets.js"] };
ok("app.config: default → app.json unchanged (plus the widgets plugin)", !c.error && JSON.stringify(c.config) === JSON.stringify(withWidgets), c.error ?? "");
c = run({ ...prodApi, EAS_BUILD_PROFILE: "production" });
ok("app.config: production profile → unchanged production identity", !c.error && c.config.ios.bundleIdentifier === appJson.ios.bundleIdentifier && c.config.android.package === appJson.android.package);
c = run({ ...stg, EAS_BUILD_PROFILE: "staging" });
ok("app.config: staging → separate app identity", !c.error && c.config.ios.bundleIdentifier === `${appJson.ios.bundleIdentifier}.staging`
  && c.config.android.package === `${appJson.android.package}.staging` && c.config.name.endsWith("Staging") && c.config.scheme === `${appJson.scheme}-staging`, c.error ?? "");
ok("app.config: staging drops the production Firebase file (no prod push wiring)", !c.error && !("googleServicesFile" in c.config.android));
ok("app.config: staging keeps the same EAS project", !c.error && JSON.stringify(c.config.extra.eas) === JSON.stringify(appJson.extra.eas));
c = run({ ...stg, ...prodApi, EAS_BUILD_PROFILE: "production" });
ok("app.config: production profile with staging env → BUILD FAILS", !!c.error && /must build EXPO_PUBLIC_P2P_ENV=production/.test(c.error));
c = run({ ...stg, EXPO_PUBLIC_SUPABASE_URL: prodUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: prodAnon, EAS_BUILD_PROFILE: "staging" });
ok("app.config: staging profile pointed at production → BUILD FAILS", !!c.error && /PRODUCTION Supabase project/.test(c.error));
c = run({ EAS_BUILD_PROFILE: "staging" });
ok("app.config: staging profile without staging env → BUILD FAILS", !!c.error && /must build EXPO_PUBLIC_P2P_ENV=staging/.test(c.error));
c = run({ EXPO_PUBLIC_SUPABASE_URL: stgUrl, ...prodApi, EAS_BUILD_PROFILE: "production" });
ok("app.config: production profile with a staging URL leaked in → BUILD FAILS", !!c.error && /non-production Supabase URL/.test(c.error));
c = run({ EXPO_PUBLIC_SUPABASE_URL: stgUrl, EAS_BUILD_PROFILE: "preview" });
ok("app.config: preview profile with a staging URL but no staging flag → BUILD FAILS", !!c.error);
ok("app.config: error messages never contain key material", [run({ ...stg, EXPO_PUBLIC_SUPABASE_ANON_KEY: stgService, EAS_BUILD_PROFILE: "staging" }).error ?? ""].every((m) => !m.includes("synthetic-signature") && !m.includes(stgService)));

// ── run-time wiring in the app ──────────────────────────────────────────────
const auth = readFileSync(path.join(root, "contexts/AuthContext.tsx"), "utf8");
ok("AuthContext creates the client from the validated config", /createClient\(BACKEND\.config\.url, BACKEND\.config\.anonKey/.test(auth));
ok("AuthContext throws (no silent fallback) on invalid config", /if \(!BACKEND\.ok\) \{[\s\S]{0,120}throw new Error/.test(auth));
for (const k of ["EXPO_PUBLIC_P2P_ENV", "EXPO_PUBLIC_SUPABASE_URL", "EXPO_PUBLIC_SUPABASE_ANON_KEY", "EXPO_PUBLIC_API_URL"]) {
  ok(`AuthContext reads ${k} literally (so Expo inlines it)`, auth.includes(`${k}: process.env.${k},`));
}
const api = readFileSync(path.join(root, "lib/apiUrl.ts"), "utf8");
ok("apiUrl: 'disabled' returns no base URL (never production)", /EXPO_PUBLIC_API_URL === "disabled"[\s\S]{0,200}return "";/.test(api));
const eas = JSON.parse(readFileSync(path.join(root, "eas.json"), "utf8"));
ok("eas.json: staging profile is internal-only and flagged staging", eas.build.staging?.distribution === "internal" && eas.build.staging?.env?.EXPO_PUBLIC_P2P_ENV === "staging");
ok("eas.json: staging profile carries no keys or URLs", !JSON.stringify(eas.build.staging).match(/eyJ|supabase\.co|https?:/));
ok("eas.json: production profile has no staging flag", !eas.build.production?.env?.EXPO_PUBLIC_P2P_ENV);
ok("eas.json: no submit configuration for staging", !eas.submit?.staging);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
