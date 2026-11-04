// Your growth journey (migrations 235–237) — routes/growth.ts over HTTP with
// an in-memory database, plus lib/growthStages.ts:
//   • signed out → 401; only ever the caller's own journey;
//   • a first visit asks the engine to record where the person is;
//   • the next stage's checklist is grouped by the four dimensions, with
//     "not required yet" said plainly and no percentages anywhere;
//   • Forest Builder is the highest personal stage; Forest of Nations is the
//     collective view (old Forest of Nations points count as Forest Builder);
//   • the official names and Scripture match the app's.
// Run: node tests/growthJourney.test.mjs
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

const checklist = { stages: [
  { stage: 2, met: true, requirements: [{ key: "lessons_completed", dimension: "learning", label: "First 3 lessons completed", have: 4, need: 3, met: true }] },
  { stage: 3, met: false, requirements: [
    { key: "active_weeks", dimension: "consistency", label: "Active in 8 different weeks", have: 8, need: 8, met: true },
    { key: "modules_completed", dimension: "learning", label: "A whole module completed", have: 0, need: 1, met: false },
    { key: "scripture_prayer_days", dimension: "fruit", label: "Time in Scripture and prayer on 8 different days", have: 5, need: 8, met: false },
  ] },
] };
const T = {
  p2p_growth_status: [{ user_id: "ann", stage: 2, stage_since: "2026-10-01T00:00:00Z", verification: "legacy_unverified", legacy_note: "Recognised from the previous growth system", eligible_stage: 2, checklist, evaluated_at: "2026-11-04T00:00:00Z" }],
  p2p_growth_settings: [{ thresholds_status: "draft", promotions_enabled: false }],
  p2p_growth_history: [{ user_id: "ann", to_stage: 2, achieved_at: "2026-10-01T00:00:00Z", kind: "legacy_import" }],
};
const rpc = [];
const db = {
  from(name) {
    const f = [];
    const q = {
      select() { return q; }, order() { return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      async maybeSingle() { const r = (T[name] ?? []).filter((x) => f.every((p) => p(x))); return { data: r[0] ? { ...r[0] } : null, error: null }; },
      then(res) { return Promise.resolve({ data: (T[name] ?? []).filter((x) => f.every((p) => p(x))), error: null }).then(res); },
    };
    return q;
  },
  async rpc(fn, args) { rpc.push([fn, args]); if (fn === "p2p_growth_recalculate") T.p2p_growth_status.push({ user_id: args.p_user, stage: 1, stage_since: "2026-11-04T00:00:00Z", verification: "verified", legacy_note: null, eligible_stage: 1, checklist: { stages: [] }, evaluated_at: "2026-11-04T00:00:00Z" }); return { data: null, error: null }; },
};
globalThis.__gj = db;

const tmpDir = path.join(root, "tests", `.tmp-growth-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__gj; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;" }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/growth.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const f = path.join(tmpDir, "growth.mjs"); writeFileSync(f, out.outputFiles[0].text);
  const app = express(); app.use("/growth", (await import(pathToFileURL(f).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/growth`;

  let r = await fetch(base + "/me");
  ok("signed out → 401", r.status === 401);
  r = await fetch(base + "/me", { headers: { "x-test-user": "ann" } });
  const j = await r.json();
  ok("Ann's own journey: Sprout, recognised (legacy) with the reason, since 1 Oct", j.stage.name === "Sprout" && j.stage.verification === "legacy_unverified" && /previous growth/.test(j.stage.legacyNote) && j.stage.since.startsWith("2026-10-01"));
  ok("…with the stage's own description and Scripture", j.stage.verseRef === "Psalm 1:3" && /prayer and Scripture take hold/.test(j.stage.description));
  const dims = Object.fromEntries(j.next.dimensions.map((d) => [d.dimension, d]));
  ok("next stage (Young Tree): checklist grouped by the four dimensions", j.next.name === "Young Tree" && ["consistency", "learning", "fruit", "discipleship"].every((k) => dims[k]));
  ok("…consistency met; learning and spiritual fruit still to come; each item has have/need", dims.consistency.met && !dims.learning.met && !dims.fruit.met && dims.fruit.items[0].have === 5 && dims.fruit.items[0].need === 8);
  ok("…discipleship plainly 'not required yet' for this stage", dims.discipleship.required === false && dims.discipleship.items.length === 0);
  ok("no percentages anywhere in the answer", !/percent|%/i.test(JSON.stringify(j)));
  ok("Forest of Nations is the collective view, said plainly", j.collective.name === "Forest of Nations" && /not a personal stage/.test(j.collective.note));
  ok("milestones still a draft; promotions off", j.milestones === "draft" && j.promotionsEnabled === false);
  ok("history: the stages reached, with how", j.history.length === 1 && j.history[0].name === "Sprout" && j.history[0].kind === "legacy_import");
  r = await fetch(base + "/me", { headers: { "x-test-user": "new-person" } });
  const n = await r.json();
  ok("first visit (a new account): the engine records it, Dormant Seed", r.status === 200 && rpc.some(([fn, a]) => fn === "p2p_growth_recalculate" && a.p_user === "new-person") && n.stage.name === "Dormant Seed");
  ok("only the caller's own data is ever read (no id in the URL)", !/:userId|req\.params/.test(readFileSync(path.join(root, "src/routes/growth.ts"), "utf8")));
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

// ── lib/growthStages ──
const lib = await (async () => {
  const out = await build({ entryPoints: [path.join(root, "src/lib/growthStages.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" });
  const f = path.join(root, "tests", `.tmp-gs-${process.pid}.mjs`); writeFileSync(f, out.outputFiles[0].text);
  try { return await import(pathToFileURL(f).href); } finally { rmSync(f, { force: true }); }
})();
ok("personal stages: five, ending at Forest Builder", lib.PERSONAL_STAGES.length === 5 && lib.PERSONAL_STAGES[4].name === "Forest Builder");
ok("old points → personal stage; Forest of Nations points count as Forest Builder", [0, 4, 12, 28, 60, 115].map(lib.personalStageFromPoints).join() === "1,2,3,4,5,5");
const app = readFileSync(path.join(repo, "artifacts/mobile/constants/stages.ts"), "utf8");
ok("names, descriptions and Scripture match the app", [...lib.PERSONAL_STAGES, lib.COLLECTIVE_STAGE].every((s) => app.includes(`name: "${s.name}"`) && app.includes(s.description) && app.includes(s.verseRef)));
ok("the stage-reached notification is categorised", /growth_stage_reached: "fruit"/.test(readFileSync(path.join(root, "src/lib/notificationCategories.ts"), "utf8")));

console.log(`growthJourney: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
