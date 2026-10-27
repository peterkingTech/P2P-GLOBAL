// Tests for the My P2P widget dashboard:
//  1. lib/myP2P.ts — layout normalisation (unknown ids dropped, new widgets
//     appended, the two discipleship widgets can never be hidden), reorder,
//     Journal preview hidden by default, Journey milestones from the real
//     activity timeline (never marked by the app), stage progress, previews.
//  2. Source checks — Home shows the dashboard, every widget reads existing
//     services, nothing writes progress, no fabricated Audio Bible or
//     scheduled sessions, private previews only on request.
// Run: node tests/myP2P.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${detail}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const store = {};
const AsyncStorage = { getItem: async (k) => store[k] ?? null, setItem: async (k, v) => { store[k] = v; } };
const js = ts.transpileModule(src("lib/myP2P.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(js, { module: mod, exports: mod.exports, require: () => ({ __esModule: true, default: AsyncStorage }), JSON, Array, Set, Math });
const m = mod.exports;

// 1. layout
const d = m.DEFAULT_LAYOUT;
ok("default: all ten widgets, discipleship first", d.order.length === 10 && d.order[0] === "journey" && d.order.includes("journal"));
ok("default: journal preview hidden", d.journalPreview === false);
const n = m.normalizeLayout({ order: ["bible", "nope", "bible", "journal"], hidden: ["journey", "journal", "updates", "zzz"], journalPreview: "yes" });
ok("normalize: unknown + duplicate ids dropped", n.order[0] === "bible" && n.order[1] === "journal" && !n.order.includes("nope"));
ok("normalize: missing widgets appended", n.order.length === 10);
ok("normalize: required widgets can't be hidden", !n.hidden.includes("journey") && !n.hidden.includes("journal") && n.hidden.join() === "updates");
ok("normalize: preview only on explicit true", n.journalPreview === false);
ok("normalize: garbage → default", JSON.stringify(m.normalizeLayout("x")) === JSON.stringify({ ...d, order: [...d.order] }));
ok("hide optional", m.setWidgetVisible(d, "bible", false).hidden.join() === "bible");
ok("hide required refused", m.setWidgetVisible(d, "journey", false).hidden.length === 0);
ok("visible excludes hidden", !m.visibleWidgets(m.setWidgetVisible(d, "prayer", false)).includes("prayer"));
const mv = m.moveWidget(d, "continue", -1);
ok("move up", mv.order[0] === "continue" && mv.order[1] === "journey");
ok("move past the edge is a no-op", m.moveWidget(d, "journey", -1) === d);
await m.saveLayout("u1", m.setWidgetVisible(d, "updates", false));
ok("persisted per account", (await m.loadLayout("u1")).hidden.join() === "updates" && (await m.loadLayout("u2")).hidden.length === 0);

// Journey
const none = m.journeyMilestones(null);
ok("journey: not started", none.done === 0 && none.total === 4 && !none.started && none.next.key === "firstLesson");
const tl = { firstLesson: { label: "First lesson completed", at: "2026-01-01" }, firstModule: { label: "First module completed", at: null }, firstMentee: { label: "x", at: null }, firstFruit: { label: "First fruit earned", at: "2026-02-01" } };
const j = m.journeyMilestones(tl);
ok("journey: counts only dated milestones", j.done === 2 && j.started);
ok("journey: next step is the first missing milestone in order", j.next.key === "firstModule");
ok("journey: done uses the server's label", j.list[0].label === "First lesson completed");
const stages = [{ name: "Seed", unlockPoints: 0 }, { name: "Sprout", unlockPoints: 100 }, { name: "Tree", unlockPoints: 300 }];
const sp = m.stageProgress(150, stages, 1);
ok("stage: progress toward the next", sp.stage.name === "Sprout" && sp.nextStage.name === "Tree" && sp.pct === 25 && sp.number === 2 && sp.of === 3);
ok("stage: last stage is 100%", m.stageProgress(999, stages, 2).pct === 100);
const long = m.previewText("a  b\n c".repeat(40), 20);
ok("preview: trimmed to one short line", long.length <= 20 && long.endsWith("…") && !long.includes("\n") && m.previewText(" hi ") === "hi");

// 2. source checks
const home = src("app/(tabs)/index.tsx");
ok("home shows My P2P", home.includes("<MyP2PDashboard />"));
const w = src("components/myp2p/MyP2PWidgets.tsx");
ok("journey: existing activity timeline + growth stage", w.includes('"p2p_get_activity_timeline"') && w.includes("getStageFromPoints"));
ok("journey: continue + view full journey", w.includes("Continue Journey") && w.includes("View Full Journey") && w.includes('"/my-discipleship/journey"'));
ok("journal: existing timeline, new entry, view journal", w.includes("getJournalTimeline") && w.includes("/my-discipleship/journal/reflection/new") && w.includes("View Journal"));
ok("journal: preview only when shown", /\{showPreview \? <Text style=\{s\.preview\}/.test(w));
ok("widgets never write learning data", !/\.(insert|update|upsert|delete)\(/.test(w) && !/finishKingdomStoryChapter|markLessonComplete|submit/.test(w));
ok("growth: real tracked minutes + configured goal", w.includes("studyMinutesToday") && w.includes("loadReminderSettings"));
ok("bible: last position + compare shortcut", w.includes("loadPosition") && w.includes('compare: "1"'));
ok("bible: no fabricated Audio Bible", !/audio bible/i.test(w));
ok("together: real invitations/studies, no invented schedule", w.includes("getMyStudies") && !/scheduled|upcoming session/i.test(w));
ok("bible screen opens compare from ?compare=1", src("app/bible/index.tsx").includes('params.compare === "1"'));
const dash = src("components/myp2p/MyP2PDashboard.tsx");
ok("customize: show/hide, reorder, restore default", dash.includes("setWidgetVisible") && dash.includes("moveWidget") && dash.includes("Restore the default layout"));
ok("customize: required widgets' switches disabled", dash.includes("disabled={!!info.required}"));

console.log(`myP2P: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
