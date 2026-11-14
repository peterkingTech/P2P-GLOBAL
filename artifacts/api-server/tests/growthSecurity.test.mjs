// Growth-related security fixes (2026-11-14), checked in the route sources:
//   • PATCH /profiles/:userId — was unauthenticated and wrote growth_level and role with the service-role
//     client. Now: signed-in owner only; growth_level and role are never written by it.
//   • The Guide-stage rule (migration 239) refusing a resume/accept gives a clear 409, not a generic 500.
// Run: node tests/growthSecurity.test.mjs
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const src = (f) => readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "routes", f), "utf8");
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("FAIL " + n); } };

const profiles = src("profiles.ts");
const start = profiles.indexOf('router.patch("/:userId"');
const patch = profiles.slice(start, profiles.indexOf("// ── Generational Forest", start));
ok("profile PATCH exists", start > 0);
ok("profile PATCH requires a signed-in caller", patch.includes("verifyCaller(req)") && patch.includes("status(401)"));
ok("profile PATCH: only the owner (403 otherwise)", patch.includes("caller !== userId") && patch.includes("status(403)"));
ok("profile PATCH never writes growth_level", !patch.includes("growth_level"));
ok("profile PATCH never writes role", !/dbUpdates\.role\b/.test(patch));

const disc = src("discipleship.ts");
const le = disc.slice(disc.indexOf("function linkError"), disc.indexOf("function linkError") + 800);
ok("Guide-stage refusal → clear 409 message", le.includes('m.startsWith("P2P_GUIDE_STAGE")') && le.includes("409"));

const gen = src("genealogy.ts");
const hist = gen.slice(gen.indexOf('router.get("/history/:personId"'));
ok("history access counts only real relationships (active, paused, ended)", (hist.match(/\.in\("status", \["active", "paused", "ended"\]\)/g) ?? []).length >= 2);

console.log(`growthSecurity (api): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
