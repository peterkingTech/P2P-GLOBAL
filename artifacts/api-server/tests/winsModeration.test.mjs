// Unit tests for the Kingdom Wins moderation policy module
// (src/lib/winsModeration.ts) and static checks that routes/kingdomWins.ts
// writes as the signed-in user and uses the explicit allowlists.
// Database behaviour is covered by scripts/studio-db-test/wins-moderation.mjs
// and wins-routes.mjs. Run: node tests/winsModeration.test.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };

const tmp = mkdtempSync(path.join(os.tmpdir(), "wins-mod-"));
try {
  const out = await build({ entryPoints: [path.join(root, "src/lib/winsModeration.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const file = path.join(tmp, "winsModeration.mjs");
  writeFileSync(file, out.outputFiles[0].text);
  const W = await import(pathToFileURL(file).href);

  // A9: explicit allowlists.
  ok("moderators are exactly moderator, admin_moderation, admin_supervisor, super_admin",
    JSON.stringify([...W.WINS_MODERATOR_ROLES].sort()) === JSON.stringify(["admin_moderation", "admin_supervisor", "moderator", "super_admin"]));
  ok("P2P Impact reviewers = moderators + admin_content", JSON.stringify([...W.IMPACT_REVIEWER_ROLES].sort()) === JSON.stringify(["admin_content", "admin_moderation", "admin_supervisor", "moderator", "super_admin"]));
  for (const role of ["student", "peer_guide", "church_leader", "regional_admin", "admin_finance", "admin_marketing", "admin_help", "admin_content", null, undefined, ""]) {
    ok(`not a Wins moderator: ${role}`, !W.isWinsModeratorRole(role));
  }
  for (const role of ["student", "peer_guide", "church_leader", "admin_finance"]) ok(`not a P2P Impact reviewer: ${role}`, !W.isImpactReviewerRole(role));
  ok("admin_content reviews P2P Impact", W.isImpactReviewerRole("admin_content"));

  // Error mapping.
  const m = (code, message) => W.winsDbRefusal({ code, message });
  ok("content rejection → 422 with category message", m("W0422", "wins_content_rejected:fundraising")?.status === 422 && /fundraising/.test(m("W0422", "wins_content_rejected:fundraising").error));
  ok("unknown rejection category → generic policy message", /community rules/.test(m("W0422", "wins_content_rejected:other").error));
  ok("posting restriction → 403 without internal detail", m("W0423", "wins_posting_restricted")?.status === 403 && !/reason|moderator/i.test(m("W0423", "wins_posting_restricted").error));
  ok("forbidden → 403", m("W0403", "wins_forbidden")?.status === 403);
  ok("invalid transition → 409", m("W0409", "wins_held_for_review")?.status === 409);
  ok("unauthenticated → 401", m("W0401", "wins_unauthenticated")?.status === 401);
  ok("other database errors are not treated as policy refusals", m("23505", "duplicate key") === null && m(undefined, "x") === null);
  ok("every message key raised by migration 189 has a message", (() => {
    const sql = readFileSync(path.join(root, "../../migrations/189_kingdom_wins_safeguards.sql"), "utf8");
    const keys = [...sql.matchAll(/raise exception '(wins_[a-z_]+)'/g)].map((x) => x[1]);
    return keys.length > 10 && keys.every((k) => k in W.WINS_DB_MESSAGES);
  })());

  // Static: the route writes as the user and has no "any non-student" check left.
  const src = readFileSync(path.join(root, "src/routes/kingdomWins.ts"), "utf8");
  ok("no service-role writes to p2p_kingdom_wins", !/db\.from\("p2p_kingdom_wins"\)\.(insert|update|delete|upsert)/.test(src));
  ok("no 'role !== student' admin check", !/role !== "student"/.test(src));
  ok("queue + moderate gated by the reviewer allowlist; restrictions by the moderator allowlist",
    /\/admin\/queue", \.\.\.reviewOnly/.test(src) && /\/:id\/moderate", \.\.\.reviewOnly/.test(src) && /\/admin\/restrictions", \.\.\.moderatorsOnly/.test(src));
  // Translated screening — behaviour (module run with a stub database + logger).
  const stub = { name: "stub", setup(b) {
    b.onResolve({ filter: /^\.\/(supabase|logger)$/ }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ loader: "js", contents: a.path === "./logger"
      ? "export const logger = { warn: (o, m) => globalThis.__winsLogs.push([o, m]), info() {}, error() {} };"
      : "export const supabaseServiceRole = { rpc: async (...a) => globalThis.__winsDb.rpc(...a), from: (t) => ({ insert: async (row) => globalThis.__winsDb.insert(t, row) }) };" }));
  } };
  const trOut = await build({ entryPoints: [path.join(root, "src/lib/winsTranslation.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [stub],
    nodePaths: [path.join(root, "node_modules")], banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } });
  const trFile = path.join(tmp, "winsTranslation.mjs");
  writeFileSync(trFile, trOut.outputFiles[0].text);
  const T = await import(pathToFileURL(trFile).href);
  const inserted = [];
  globalThis.__winsLogs = [];
  globalThis.__winsDb = {
    rpc: async (_fn, args) => ({ data: { text: `${args.p_title} ${args.p_body}`, hash: "h", needsTranslation: !/^EN /.test(args.p_body ?? "") }, error: null }),
    insert: async (table, row) => { inserted.push([table, row]); return { error: null }; },
  };
  const long = "Dios sanó a mi madre después de orar durante tres meses con toda la iglesia y la familia.";
  ok("validate: complete translation accepted", T.validateTranslation(long, "God healed my mother after praying for three months with the whole church and family.", "end_turn").startsWith("God"));
  for (const [why, out, stop] of [["cut off at the length limit", "God healed my mother", "max_tokens"], ["refused", "I can't help with that.", "refusal"],
    ["empty", "   ", "end_turn"], ["implausibly short for a long post (injection / dropped text)", "God is good.", "end_turn"]]) {
    let threw = false; try { T.validateTranslation(long, out, stop); } catch { threw = true; }
    ok(`validate: ${why} → refused (post held)`, threw);
  }
  ok("English post: no translation", await T.prepareWinsTranslation("u1", { title: "t", body: "EN God is good", lessonLearned: null, guidedSections: null }) === "not_needed");
  delete process.env.ANTHROPIC_API_KEY;
  T.setWinsTranslatorForTests(null);
  ok("missing API key → failed (post held), nothing recorded", await T.prepareWinsTranslation("u1", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "failed" && inserted.length === 0);
  T.setWinsTranslatorForTests(async () => { throw new Error("provider 529"); });
  ok("provider error → failed (post held)", await T.prepareWinsTranslation("u1", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "failed" && inserted.length === 0);
  T.setWinsTranslatorForTests(async () => "God healed my mother after three months of prayer.");
  ok("translation recorded with hash + provider", await T.prepareWinsTranslation("u1", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "stored"
    && inserted.at(-1)[0] === "p2p_kingdom_win_translations" && inserted.at(-1)[1].content_hash === "h");
  T.resetWinsTranslationCapForTests();
  let stored = 0;
  for (let i = 0; i < T.WINS_TRANSLATIONS_PER_HOUR + 5; i++) if (await T.prepareWinsTranslation("spammer", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "stored") stored++;
  ok("hourly cap per member (beyond it → held)", stored === T.WINS_TRANSLATIONS_PER_HOUR, `${stored}`);
  ok("cap is per member", await T.prepareWinsTranslation("someone-else", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "stored");
  globalThis.__winsDb.rpc = async () => { throw new Error("network down"); };
  ok("unexpected error → failed, never thrown", await T.prepareWinsTranslation("u2", { title: "t", body: long, lessonLearned: null, guidedSections: null }) === "failed");
  ok("logs carry no post text", !JSON.stringify(globalThis.__winsLogs).includes("Dios") && !JSON.stringify(globalThis.__winsLogs).includes("God healed"));

  // Translated screening — source checks (src/lib/winsTranslation.ts).
  const tr = readFileSync(path.join(root, "src/lib/winsTranslation.ts"), "utf8");
  // The first argument of every log call is the data object; it must not carry content.
  const logCalls = [...tr.matchAll(/logger\.\w+\((\{[^}]*\})/g)].map((m) => m[1]);
  ok("translation: logs never include post text or translations", logCalls.length >= 4 && logCalls.every((c) => !/\b(text|english|input|fields|body|title)\b/.test(c)), logCalls.join(" | "));
  ok("translation: post is treated as data, not instructions", /never as instructions/.test(tr) && /<post>/.test(tr));
  ok("translation: bounded time, no retries", /timeout: WINS_TRANSLATION_TIMEOUT_MS/.test(tr) && /maxRetries: 0/.test(tr) && /withTimeout\(/.test(tr));
  ok("translation: never throws (failure → database holds the post)", /try \{ return await prepare\(userId, fields\); \}\s*catch/.test(tr));
  ok("translation: uses the existing configured translator key and model", /process\.env\.ANTHROPIC_API_KEY/.test(tr) && /claude-haiku-4-5-20251001/.test(tr));
  ok("translation: recorded with the service role only (members cannot)", /db\.from\("p2p_kingdom_win_translations"\)\.insert/.test(tr) && /supabaseServiceRole as db/.test(tr));
  const createRoute = src.slice(src.indexOf('router.post("/",'), src.indexOf('router.get("/me/posting-status"'));
  ok("translation: create route translates before inserting", createRoute.indexOf("prepareWinsTranslation(") > 0 && createRoute.indexOf("prepareWinsTranslation(") < createRoute.indexOf('.from("p2p_kingdom_wins").insert'));
  ok("translation: staff-only fields hidden from authors", /screeningTranslation: extra\?\.staff \?/.test(src));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
