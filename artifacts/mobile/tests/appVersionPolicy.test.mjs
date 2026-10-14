// Tests for the minimum-supported-build check: lib/appVersionPolicy.ts (pure
// logic, transpiled with the project's TypeScript) plus static checks of
// components/AppVersionGate.tsx and migration 186.
// Run: node tests/appVersionPolicy.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const js = ts.transpileModule(readFileSync(path.join(root, "lib/appVersionPolicy.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, RegExp });
const V = mod.exports;

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

// Build numbers
ok("build '54' → 54", V.parseBuildNumber("54") === 54);
ok("build 54 (number) → 54", V.parseBuildNumber(54) === 54);
for (const bad of ["", "0", "1.0.0", "54a", "-3", " ", null, undefined, 0, 1.5, "054"]) ok(`build ${JSON.stringify(bad)} → unknown`, V.parseBuildNumber(bad) === null);

// Native build selection (iOS + Android)
ok("Android: versionCode from ExpoApplication", V.pickNativeBuild({ platform: "android", applicationBuild: "57", iosConstantsBuild: undefined }) === 57);
ok("iOS: CFBundleVersion from ExpoApplication", V.pickNativeBuild({ platform: "ios", applicationBuild: "54", iosConstantsBuild: "1" }) === 54);
ok("iOS: falls back to expo-constants CFBundleVersion", V.pickNativeBuild({ platform: "ios", applicationBuild: undefined, iosConstantsBuild: "54" }) === 54);
ok("Android: no module → unknown (never blocks)", V.pickNativeBuild({ platform: "android", applicationBuild: undefined, iosConstantsBuild: "54" }) === null);
ok("garbage build values → unknown", V.pickNativeBuild({ platform: "ios", applicationBuild: "1.0.0", iosConstantsBuild: "x" }) === null);
ok("web → unknown", V.pickNativeBuild({ platform: "web", applicationBuild: undefined, iosConstantsBuild: undefined }) === null);

// Update destinations (official only)
ok("App Store URL allowed (iOS)", V.safeUpdateUrl("https://apps.apple.com/app/id6815116019", "ios") !== null);
ok("TestFlight URL allowed (iOS)", V.safeUpdateUrl("https://testflight.apple.com/join/ABCDEF", "ios") !== null);
ok("itms-beta allowed (iOS)", V.safeUpdateUrl("itms-beta://", "ios") !== null);
ok("Play Store URL for this app allowed (Android)", V.safeUpdateUrl("https://play.google.com/store/apps/details?id=com.amentech.p2pglobaldiscipleshipnetwork", "android") !== null);
for (const [u, p] of [["https://evil.example/apps.apple.com", "ios"], ["http://apps.apple.com/app/x", "ios"], ["javascript:alert(1)", "ios"],
  ["https://apps.apple.com.evil.example/x", "ios"], ["https://play.google.com/store/apps/details?id=com.other.app", "android"],
  ["https://play.google.com/store/apps/details?id=com.amentech.p2pglobaldiscipleshipnetworkX", "android"], ["https://apps.apple.com/app/x", "android"], [42, "ios"]]) {
  ok(`rejects ${JSON.stringify(u)} on ${p}`, V.safeUpdateUrl(u, p) === null);
}

// Rows
const row = (o) => ({ platform: "ios", min_supported_build: null, update_url: null, message: null, ...o });
ok("row: no minimum", JSON.stringify(V.policyFromRow(row({}), "ios")) === JSON.stringify({ platform: "ios", minSupportedBuild: null, updateUrl: null, message: null }));
ok("row: minimum parsed", V.policyFromRow(row({ min_supported_build: 60 }), "ios").minSupportedBuild === 60);
ok("row: wrong platform ignored", V.policyFromRow(row({}), "android") === null);
ok("row: malformed minimum → ignored entirely", V.policyFromRow(row({ min_supported_build: "abc" }), "ios") === null);
ok("row: unsafe URL dropped, rest kept", (() => { const p = V.policyFromRow(row({ min_supported_build: 60, update_url: "https://evil.example" }), "ios"); return p && p.minSupportedBuild === 60 && p.updateUrl === null; })());
ok("row: cached camelCase copy round-trips", (() => { const p = V.policyFromRow(row({ min_supported_build: 60, update_url: "itms-beta://" }), "ios"); return JSON.stringify(V.policyFromRow(p, "ios")) === JSON.stringify(p); })());
ok("row: null/garbage → null", V.policyFromRow(null, "ios") === null && V.policyFromRow("x", "ios") === null);

// Decisions
const pol = (min) => ({ platform: "ios", minSupportedBuild: min, updateUrl: null, message: null });
ok("no minimum → supported", V.evaluateVersion(53, pol(null)) === "supported");
ok("at the minimum → supported", V.evaluateVersion(60, pol(60)) === "supported");
ok("above the minimum → supported", V.evaluateVersion(61, pol(60)) === "supported");
ok("below the minimum → outdated", V.evaluateVersion(59, pol(60)) === "outdated");
ok("unknown build → unknown (never blocks)", V.evaluateVersion(null, pol(60)) === "unknown");
ok("no policy → unknown (never blocks)", V.evaluateVersion(53, null) === "unknown");

// Fallbacks
ok("fresh answer wins over cache", V.choosePolicy({ ok: true, policy: pol(70) }, pol(60)).minSupportedBuild === 70);
ok("fresh 'no policy' wins over an old cached minimum", V.choosePolicy({ ok: true, policy: null }, pol(60)) === null);
ok("failed request → last fetched policy", V.choosePolicy({ ok: false }, pol(60)).minSupportedBuild === 60);
ok("failed request, nothing cached → unknown", V.choosePolicy({ ok: false }, null) === null && V.evaluateVersion(10, null) === "unknown");
ok("missing table (server without 186) recognised", V.isMissingPolicyTable({ code: "PGRST205" }) && V.isMissingPolicyTable({ code: "42P01" }));
ok("other errors are not 'missing table'", !V.isMissingPolicyTable({ code: "42501" }) && !V.isMissingPolicyTable(null));
ok("enforcement only on native release builds", V.enforcementApplies({ isDev: false, platform: "ios" }) && V.enforcementApplies({ isDev: false, platform: "android" })
  && !V.enforcementApplies({ isDev: true, platform: "ios" }) && !V.enforcementApplies({ isDev: false, platform: "web" }));
ok("instructions per platform", /TestFlight/.test(V.updateInstructions("ios")) && /Google Play/.test(V.updateInstructions("android")));

// Gate component (static)
const gate = readFileSync(path.join(root, "components/AppVersionGate.tsx"), "utf8");
ok("gate: children render unless the status is exactly 'outdated'", /if \(status !== "outdated"\) return <>\{children\}<\/>;/.test(gate));
ok("gate: initial state is 'unknown' (never blocks while checking)", /useState<VersionStatus>\("unknown"\)/.test(gate));
ok("gate: iOS build from the native CFBundleVersion (Constants.platform.ios.buildNumber)", /Constants\.platform[\s\S]{0,80}\?\.ios\?\.buildNumber/.test(gate));
ok("gate: does not use app.json's static buildNumber (remote versioning)", !/expoConfig\?\.ios\?\.buildNumber/.test(gate));
ok("gate: reads the linked ExpoApplication module optionally (no hard dependency)", /requireOptionalNativeModule<[^>]*>\("ExpoApplication"\)/.test(gate) && /from "expo";/.test(gate));
ok("gate: build number chosen by the tested pickNativeBuild()", /pickNativeBuild\(\{[\s\S]{0,200}applicationBuild: ExpoApplication\?\.nativeBuildVersion/.test(gate));
ok("gate: only opens URLs that passed safeUpdateUrl (via policyFromRow)", /policyFromRow\(/.test(gate) && !/Linking\.openURL\((?!url\))/.test(gate));
ok("gate: rechecks on return to foreground (throttled)", /AppState\.addEventListener\("change"/.test(gate) && /RECHECK_MS/.test(gate));
ok("gate: caches only fresh results", /if \(fresh\.ok\) await writeCache\(fresh\.policy\)/.test(gate));
const layout = readFileSync(path.join(root, "app/_layout.tsx"), "utf8");
ok("root layout: the whole app (incl. auth/data providers) sits inside the gate", /<AppVersionGate>\s*<RootLayoutNav \/>\s*<\/AppVersionGate>/.test(layout));

// Build reporting (migration 187)
ok("report: native release build with a number", V.shouldReportBuild({ isDev: false, platform: "ios", build: 54 }) && V.shouldReportBuild({ isDev: false, platform: "android", build: 57 }));
ok("report: never from dev builds, web, or an unreadable build", !V.shouldReportBuild({ isDev: true, platform: "ios", build: 54 }) && !V.shouldReportBuild({ isDev: false, platform: "web", build: 1 }) && !V.shouldReportBuild({ isDev: false, platform: "ios", build: null }));
const rep = readFileSync(path.join(root, "components/ClientBuildReporter.tsx"), "utf8");
ok("reporter: calls p2p_report_client_build with platform + build only (no user id)", /rpc\("p2p_report_client_build", \{ p_platform: platform, p_build: build \}\)/.test(rep) && !/p_user_id|user_id:/.test(rep));
ok("reporter: once per user+build per session", /done\.current === key\) return;/.test(rep));
ok("reporter: server without 187 is not retried in a loop", /if \(error && !isMissingFunction\(error\)\) done\.current = null;/.test(rep));
ok("reporter: mounted inside the auth/data providers", /<ClientBuildReporter \/>\s*<\/DataProvider>/.test(layout));
const mig187 = readFileSync(path.join(root, "../../migrations/187_client_build_reports.sql"), "utf8");
ok("187: identity from auth.uid(), no user id parameter", /p2p_report_client_build\(p_platform text, p_build integer\)/.test(mig187) && /v_uid uuid := auth\.uid\(\)/.test(mig187));
ok("187: table unreadable/unwritable by clients", /revoke all on table public\.p2p_client_build_reports from public, anon, authenticated;/.test(mig187) && !/create policy/i.test(mig187));
ok("187: function not executable by anon/PUBLIC", /revoke all on function public\.p2p_report_client_build\(text, integer\) from public, anon;/.test(mig187));

// Migration 186
const mig = readFileSync(path.join(root, "../../migrations/186_app_version_policy.sql"), "utf8");
ok("186: starts with NO minimum (nothing enforced)", /insert into public\.p2p_app_version_policy \(platform\) values \('ios'\), \('android'\)/.test(mig) && !/min_supported_build\s*=\s*\d/.test(mig.split("-- Rollback")[0].replace(/^--.*$/gm, "")));
ok("186: read-only for clients", /grant select on table public\.p2p_app_version_policy to anon, authenticated;/.test(mig) && !/grant (insert|update|delete|all)/i.test(mig));
ok("186: RLS enabled", /enable row level security/.test(mig));
ok("186: update_url limited to official destinations", /apps\\\.apple\\\.com\|testflight\\\.apple\\\.com/.test(mig) && /play\\\.google\\\.com/.test(mig));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
