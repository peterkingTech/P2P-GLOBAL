// Discipleship lineage + relationships on the app side (migrations 233–234):
//   • both screens use the server (no direct table reads from the phone);
//   • a lineage opens progressively — only my mentors and disciples first,
//     each branch loaded when tapped — so thousands never load at once;
//   • private people show without identity; nothing ranks people;
//   • ending asks first (and keeps history); pausing asks first; only the
//     disciple sees "Make primary"; entry points from the journey and My Tree.
// Run: node tests/genealogy.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
const src = (p) => readFileSync(path.join(root, p), "utf8");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const code = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

const calls = [];
const js = ts.transpileModule(src("lib/genealogyApi.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, JSON, encodeURIComponent, require: (n) => { if (n === "@/lib/apiClient") return { apiRequest: async (p, init, o) => { calls.push([o.base + p, init.method ?? "GET", init.body ?? null]); return {}; } }; throw new Error(n); } });
const A = mod.exports;
await A.getMyLineage(); await A.getBranch("a b"); await A.getGeneration(2, 50); await A.searchLineage("Ann Lee"); await A.getCollective();
await A.getMyRelationships(); await A.changeRelationship("l1", "end", "Moved"); await A.makePrimaryMentor("l2");
ok("client calls the right routes (ids encoded)", JSON.stringify(calls.map((c) => c[0])) === JSON.stringify([
  "/genealogy/me", "/genealogy/branch/a%20b", "/genealogy/me/generation/2?offset=50", "/genealogy/me/search?q=Ann%20Lee", "/genealogy/collective",
  "/discipleship/relationships/me", "/discipleship/relationships/l1/end", "/discipleship/relationships/l2/primary"]), JSON.stringify(calls.map((c) => c[0])));
ok("changes are PUTs with only a reason (never who / which stage)", calls[6][1] === "PUT" && JSON.parse(calls[6][2]).reason === "Moved" && Object.keys(JSON.parse(calls[6][2])).join() === "reason");
ok("plain generation wording", A.generationLabel(2, 62) === "Generation 2 · 62 people" && A.generationLabel(1, 1) === "Generation 1 · 1 person");

const lin = src("app/lineage.tsx"), rel = src("app/relationships.tsx");
ok("lineage + relationships read only through the server", ![lin, rel].some((s) => /supabase|p2p_discipleship_links|from\(/.test(code(s))));
ok("progressive: a branch loads its disciples only when opened", /if \(next && !kids\) \{ try \{ setKids\(\(await getBranch\(p\.id!\)\)\.people\)/.test(lin) && lin.includes("accessibilityState={has ? { expanded: open } : undefined}"));
ok("private people show without photo or identity", lin.includes("p.private ? <View style={s.privateDot}>"));
ok("mentors: primary marked, others 'also walking with you'; the line above follows", lin.includes('p.isPrimary ? "Your primary mentor" : "Also walking with you"') && lin.includes("data.lineAbove"));
ok("Forest of Nations: together, totals only, never a ranking", lin.includes("TOGETHER") && /not a personal stage or a ranking/.test(lin) && !/\b(top|leader ?board|most influential|rank(ed|ing)? #)/i.test(code(lin)));
ok("search within my lineage", lin.includes("searchLineage(q.trim())") && lin.includes('accessibilityLabel="Find someone in your lineage"'));
ok("ending asks first, says history is kept, and is marked destructive", /confirmAction\("End this relationship\?", `[^`]*stays in your history[^`]*`[\s\S]*?destructive: true/.test(rel));
ok("pausing asks first; resuming doesn't need to", rel.includes('confirmAction("Pause this relationship?"') && /label="Resume"[^\n]*onPress=\{\(\) => act\(/.test(rel));
ok("only the disciple can choose their primary mentor", rel.includes('iAmDisciple && r.status === "active" && !r.isPrimary ? (') && rel.includes("card(r, true)") && rel.includes("card(r, false)"));
ok("entry points: journey (Forest of Nations card) and My Tree open the lineage", src("app/stages.tsx").includes('router.push("/lineage" as any)') && src("app/living-tree.tsx").includes('router.push("/lineage" as any)'));

console.log(`genealogy (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
