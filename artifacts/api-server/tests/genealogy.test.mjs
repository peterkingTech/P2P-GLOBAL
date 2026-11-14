// Discipleship genealogy — routes/genealogy.ts over HTTP with an in-memory
// database whose lineage functions follow migration 234 (synthetic ids):
//   • my mentors (primary first) and the line above; my disciples with how
//     many disciples they have; people per generation (deep lines included);
//   • expanding a branch only inside MY lineage (anyone else's → 404);
//   • privacy beyond my direct relationships: a private profile is "A
//     disciple" with no id; a hidden real name shows the @username; a hidden
//     progress shows no stage; direct relationships always show by name;
//   • a generation 50 at a time; search only within my lineage and only what
//     I may see; Forest of Nations: totals only — no names, no ids.
// Run: node tests/genealogy.test.mjs
import { createRequire } from "node:module";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const express = require("express");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };

// People: gran → mum (primary) → ME; aunt also mentors ME. ME → kid1, kid2; kid1 → gk1 (private), gk2 (hides real name + progress);
// gk2 → ggk; plus a 60-wide generation under kid2; and an unrelated family (other → stranger).
const P = (id, extra = {}) => ({ id, full_name: id.toUpperCase(), username: id, photo_url: `https://img/${id}`, country: "Ghana", profile_visibility: "public", show_real_name_publicly: true, show_progress_publicly: true, ...extra });
const profiles = [P("gran"), P("mum"), P("aunt", { country: "Kenya" }), P("me"), P("kid1"), P("kid2"), P("gk1", { profile_visibility: "private" }), P("gk2", { show_real_name_publicly: false, show_progress_publicly: false }), P("ggk"), P("other"), P("stranger")];
const links = [["gran", "mum", true], ["mum", "me", true], ["aunt", "me", false], ["me", "kid1", true], ["me", "kid2", true], ["kid1", "gk1", true], ["kid1", "gk2", true], ["gk2", "ggk", true], ["other", "stranger", true]];
for (let i = 0; i < 60; i++) { profiles.push(P(`w${i}`)); links.push(["kid2", `w${i}`, true]); }
const T = {
  p2p_profiles: profiles,
  p2p_discipleship_links: links.map(([m, d, prim], i) => ({ id: `l${i}`, mentor_id: m, disciple_id: d, is_primary: prim, status: "active", started_at: "2026-0" + (1 + (i % 9)) + "-01T00:00:00Z" })),
  p2p_growth_status: profiles.map((p, i) => ({ user_id: p.id, stage: 1 + (i % 5) })),
};
const open = (l) => ["active", "paused"].includes(l.status);
function descendants(rootId) {
  const out = new Map(); let frontier = [{ id: rootId, path: [rootId] }]; let gen = 0;
  while (frontier.length) {
    gen++; const next = [];
    for (const f of frontier) for (const l of T.p2p_discipleship_links.filter((x) => x.mentor_id === f.id && open(x))) {
      if (f.path.includes(l.disciple_id)) continue;
      const prev = out.get(l.disciple_id);
      if (!prev || gen < prev.generation || (gen === prev.generation && l.is_primary && !prev.is_primary)) out.set(l.disciple_id, { person_id: l.disciple_id, mentor_id: l.mentor_id, generation: gen, is_primary: l.is_primary, status: l.status, started_at: l.started_at });
      next.push({ id: l.disciple_id, path: [...f.path, l.disciple_id] });
    }
    frontier = next;
  }
  return [...out.values()];
}
function ancestors(person) {
  const out = []; const first = T.p2p_discipleship_links.filter((l) => l.disciple_id === person && open(l)).sort((a, b) => b.is_primary - a.is_primary);
  for (const l of first) out.push({ person_id: l.mentor_id, generation: 1, is_primary: l.is_primary, status: l.status, started_at: l.started_at });
  let cur = first.find((l) => l.is_primary)?.mentor_id; let g = 1;
  while (cur) { const up = T.p2p_discipleship_links.find((l) => l.disciple_id === cur && open(l) && l.is_primary); if (!up) break; g++; out.push({ person_id: up.mentor_id, generation: g, is_primary: true, status: up.status, started_at: up.started_at }); cur = up.mentor_id; }
  return out;
}
const db = {
  from(name) {
    const f = []; let lim = Infinity;
    const q = {
      select() { return q; }, order() { return q; }, limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      in(c, vs) { f.push((r) => vs.includes(r[c])); return q; },
      or(expr) { const pairs = [...expr.matchAll(/(mentor_id|disciple_id)\.eq\.([\w-]+)/g)].map(([, c, v]) => [c, v]);
        // "and(a,b),and(c,d)" → either pair matches; "x.eq.1,y.eq.1" → any.
        const ands = [...expr.matchAll(/and\(([^)]*)\)/g)].map((m) => [...m[1].matchAll(/(mentor_id|disciple_id)\.eq\.([\w-]+)/g)].map(([, c, v]) => [c, v]));
        f.push((r) => (ands.length ? ands.some((g) => g.every(([c, v]) => r[c] === v)) : pairs.some(([c, v]) => r[c] === v))); return q; },
      then(res) { return Promise.resolve({ data: (T[name] ?? []).filter((x) => f.every((p) => p(x))).slice(0, lim).map((x) => ({ ...x })), error: null }).then(res); },
    };
    return q;
  },
  async rpc(fn, a) {
    if (fn === "p2p_lineage_descendants") return { data: descendants(a.p_root), error: null };
    if (fn === "p2p_lineage_ancestors") return { data: ancestors(a.p_person), error: null };
    if (fn === "p2p_development_history") return { data: {
      stage: { stage: 2, verification: "verified", since: "2026-09-01" },
      guides: [{ linkId: "l1", guideId: "mum", status: "active", isPrimary: true, startedAt: "2026-02-01", endedAt: null, contributions: 3, contributionsByType: {},
        checkpoints: [{ id: "c1", kind: "start", at: "2026-02-01", participantStage: null, guideStage: null, source: "unavailable", changed: null, corrects: null, note: null },
                      { id: "c2", kind: "stage_change", at: "2026-09-01", participantStage: 2, guideStage: 4, source: "recorded", changed: "participant", corrects: null, note: null }] }],
      guiding: [{ linkId: "l3", participantId: "kid1", status: "active", isPrimary: true, startedAt: "2026-04-01", endedAt: null, contributions: 1, checkpoints: [] }],
      contributors: [{ personId: "gk1", contributions: 2, firstAt: "2026-05-01", lastAt: "2026-06-01", kinds: { "service.learning_feedback": true }, wasDesignatedGuide: false }],
      helped: [{ personId: "kid1", contributions: 1, helpsOthers: true }] }, error: null };
    // The server's collective view (239): small groups already suppressed there.
    if (fn === "p2p_growth_collective") return { data: { minimumGroup: 5, countries: 2, months: [{ month: "2026-10", participants: 9, learningUnitsPassed: 30, practicalActions: 4, contributions: 12 }, { month: "2026-11", suppressed: true }],
      stages: [{ stage: 1, people: 40, suppressed: false }, { stage: 2, people: 23, suppressed: false }, { stage: 3, people: null, suppressed: true }, { stage: 4, people: null, suppressed: true }, { stage: 5, people: null, suppressed: false }] }, error: null };
    return { data: null, error: { message: "?" } };
  },
};
globalThis.__gen = db;

const tmpDir = path.join(root, "tests", `.tmp-genealogy-${process.pid}`);
mkdirSync(tmpDir, { recursive: true });
const mockPlugin = { name: "mocks", setup(b) {
  b.onResolve({ filter: /(^|\/)supabase$/ }, () => ({ path: "supabase", namespace: "mock" }));
  b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: "export const supabaseServiceRole = globalThis.__gen; export const verifyCaller = async (req) => req.headers['x-test-user'] || null;" }));
} };
try {
  const out = await build({ entryPoints: [path.join(root, "src/routes/genealogy.ts")], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent", plugins: [mockPlugin], external: ["express"] });
  const file = path.join(tmpDir, "genealogy.mjs"); writeFileSync(file, out.outputFiles[0].text);
  const app = express(); app.use("/genealogy", (await import(pathToFileURL(file).href)).default);
  const server = app.listen(0, "127.0.0.1"); await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}/genealogy`;
  const get = async (p, u = "me") => { const r = await fetch(base + p, { headers: u ? { "x-test-user": u } : {} }); return { status: r.status, j: await r.json() }; };

  ok("signed out → 401 everywhere", (await Promise.all(["/me", "/branch/kid1", "/me/generation/1", "/me/search?q=ki", "/collective"].map((p) => get(p, null)))).every((x) => x.status === 401));
  let { j } = await get("/me");
  ok("my mentors: both, primary first (mum), with since dates", j.mentors.map((m) => m.name).join() === "MUM,AUNT" && j.mentors[0].isPrimary && !j.mentors[1].isPrimary && !!j.mentors[0].since);
  ok("the line above follows my primary mentor (gran)", j.lineAbove.length === 1 && j.lineAbove[0].name === "GRAN" && j.lineAbove[0].generationsAbove === 2);
  ok("my disciples, each with how many disciples they have", j.disciples.map((d) => `${d.name}:${d.disciples}`).sort().join() === "KID1:2,KID2:60");
  ok("people per generation, deep lines counted (4 generations)", JSON.stringify(j.generations) === JSON.stringify([{ generation: 1, people: 2 }, { generation: 2, people: 62 }, { generation: 3, people: 1 }]) && j.totalDescendants === 65, JSON.stringify(j.generations));
  ok("direct relationships always show by name, photo and stage", j.disciples.every((d) => d.id && d.photoUrl && d.stage));

  ({ j } = await get("/branch/kid1"));
  const gk1 = j.people.find((p) => p.private), gk2 = j.people.find((p) => !p.private);
  ok("expanding kid1: a private profile is just 'A disciple' — no id, no photo, no stage", gk1 && gk1.id === null && gk1.name === "A disciple" && !gk1.photoUrl && !gk1.stage);
  ok("…someone hiding their real name shows their @username; hidden progress shows no stage", gk2 && gk2.name === "@gk2" && gk2.stage === null && gk2.disciples === 1);
  ok("…generation numbers continue (grandchildren are generation 2)", j.generation === 2);
  let r = await get("/branch/stranger");
  ok("expanding someone outside my lineage → 404", r.status === 404);
  r = await get("/branch/gran");
  ok("…including my own mentors' line (not below me) → 404", r.status === 404);
  ({ j } = await get("/branch/gk2"));
  ok("expanding deeper still (generation 3)", j.generation === 3 && j.people.length === 1 && j.people[0].name === "GGK");

  ({ j } = await get("/me/generation/2"));
  ok("a generation 50 at a time, with the next page", j.total === 62 && j.people.length === 50 && j.nextOffset === 50);
  ({ j } = await get("/me/generation/2?offset=50"));
  ok("…and the rest", j.people.length === 12 && j.nextOffset === null);

  ({ j } = await get("/me/search?q=gk"));
  ok("search: only my lineage, only what I may see (gk1 private, gk2's hidden real name not searchable by it)", j.people.map((p) => p.name).sort().join() === "@gk2,GGK", JSON.stringify(j.people.map((p) => p.name)));
  ({ j } = await get("/me/search?q=stranger"));
  ok("search never reaches outside my lineage", j.people.length === 0);

  // Development history.
  ({ j } = await get("/history/me"));
  ok("history (mine): Guides with checkpoints — stages by name as they were, 'not recorded' where unknown", j.guides[0].guide.name === "MUM" && j.guides[0].checkpoints[0].recorded === false
    && j.guides[0].checkpoints[0].participantStage === null && j.guides[0].checkpoints[1].participantStage === "Sprout" && j.guides[0].checkpoints[1].guideStage === "Fruitful Tree" && j.guides[0].verifiedContributions === 3);
  ok("history (mine): the people I guide, everyone who verifiably helped me, and those I helped who now help others",
    j.guiding[0].participant.name === "KID1" && j.contributors[0].designatedGuide === false && j.contributors[0].kinds[0] === "service.learning_feedback" && j.helped[0].nowHelpingOthers === true);
  ok("history: counts, stages and dates only — never answers, messages, journals or reflections", !/answer|message|journal|reflection/i.test(JSON.stringify(j).replace(/"note":"[^"]*"/, "")));
  r = await get("/history/stranger");
  ok("history: someone outside my relationships and lineage → 404", r.status === 404);
  r = await get("/history/kid1");
  ok("history: someone in my lineage (my disciple) can be opened", r.status === 200);
  r = await get("/history/gran");
  ok("history: my line above can be opened too", r.status === 200);
  r = await get("/history/ggk");
  ok("history: in someone else's history, a private person I'm not related to is just 'A disciple'", r.status === 200 && r.j.contributors[0].person.name === "A disciple" && r.j.contributors[0].person.id === null);
  ok("history: signed out → 401", (await get("/history/me", null)).status === 401);
  // A pending/declined/expired REQUEST is not a relationship: it opens nothing (2026-11-14 fix).
  T.p2p_discipleship_links.push({ id: "ldecl", mentor_id: "asker", disciple_id: "me", is_primary: false, status: "declined", started_at: null });
  T.p2p_discipleship_links.push({ id: "lpend", mentor_id: "me", disciple_id: "hopeful", is_primary: false, status: "pending", started_at: null });
  ok("history: a declined request does not open the other person's history", (await get("/history/asker")).status === 404);
  ok("history: a pending request does not open the other person's history", (await get("/history/hopeful")).status === 404);

  ({ j } = await get("/collective"));
  ok("Forest of Nations: totals (relationships, people, generations, countries, stages, months)", j.activeRelationships === links.length && j.peopleBeingDiscipled === 68 && j.generations === 6 && j.countries === 2 && j.stages.length === 5, JSON.stringify({ g: j.generations, p: j.peopleBeingDiscipled }));
  ok("…with no names and no ids", !/"(id|name|username|photoUrl)"/.test(JSON.stringify(j).replace(/"name":"(Seed|Sprout|Young Tree|Fruitful Tree|Forest Builder)"/g, "")));
  ok("…milestone counts below the minimum group are suppressed (fewer than 5), never shown", j.stages[2].people === null && j.stages[2].fewerThan === 5 && j.stages[0].people === 40 && j.stages[4].fewerThan === null);
  ok("…countries only from the server's opt-in, small-group-safe count", j.countries === 2 && j.minimumGroup === 5);
  ok("…months with fewer than 5 new relationships are suppressed", j.relationshipsBegun.every((m) => m.relationships === null ? m.fewerThan === 5 : m.relationships >= 5));
  ok("…participation totals by month, with small months suppressed", j.participation.length === 2 && j.participation[1].suppressed === true);
  server.close();
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
console.log(`genealogy: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
