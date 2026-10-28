// Tests for the Handwriting Studio + attachments on Comprehensive Check
// answers (Universal Learning System step 2, migration 218), app side:
//  1. lib/handwriting.ts — page coordinates, pressure only when reported,
//     stroke simplification, smooth paths, eraser hits, limits that mirror
//     the server, newer-copy-wins recovery, Studio → answer box hand-off.
//  2. lib/learningAttachmentsApi.ts — labels, the "answered with a drawing"
//     words (same as the server), file links.
//  3. Source checks — tray only on Comprehensive Check answers (never
//     reflections), hidden when switched off; core answers link BEFORE the
//     unchanged insert; group answers send attachmentIds; reviewers see the
//     files; the Studio saves locally + to the account and never loses work
//     on leaving; drawings are data rendered by one read-only renderer.
// The server side is proven in scripts/studio-db-test/learning-attachments.mjs.
// Run: node tests/handwriting.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
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

const store = new Map();
const mocks = {
  "@react-native-async-storage/async-storage": { __esModule: true, default: { getItem: async (k) => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async (k) => { store.delete(k); } } },
  "@/contexts/AuthContext": { supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } } },
  "@/lib/apiUrl": { getApiUrl: () => "http://test/api" },
};
function load(rel) {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => mocks[m] ?? {}, console, Date, Math, JSON, TextEncoder, fetch: (...x) => globalThis.fetch(...x) });
  return mod.exports;
}

// 1. Drawing document
const h = load("lib/handwriting.ts");
ok("page is A4-shaped, 1000 wide", h.PAGE.width === 1000 && h.PAGE.height === 1414);
ok("touch → page point (scaled, rounded, kept on the page)", JSON.stringify(h.toPagePoint(100, 50, 2)) === "[200,100]" && JSON.stringify(h.toPagePoint(-5, 99999, 1)) === "[0,1414]");
ok("pressure only when the device reports it", JSON.stringify(h.toPagePoint(10, 10, 1, 0.456)) === "[10,10,0.46]" && h.toPagePoint(10, 10, 1, null).length === 2 && h.toPagePoint(10, 10, 1, 0).length === 2);
const line = Array.from({ length: 50 }, (_, i) => [i * 2, 100]);
ok("simplify: a straight line keeps only its ends", h.simplify(line).length === 2);
const corner = [...Array.from({ length: 20 }, (_, i) => [i * 5, 0]), ...Array.from({ length: 20 }, (_, i) => [95, i * 5])];
const sc = h.simplify(corner);
ok("simplify: a corner keeps its shape", sc.length >= 3 && sc.some((p) => p[0] === 95 && p[1] === 0));
ok("paths: dot, line, smooth curve", h.strokePath([[5, 5]]).startsWith("M5 5L") && h.strokePath([[0, 0], [10, 10]]) === "M0 0L10 10" && h.strokePath([[0, 0], [10, 10], [20, 0]]).includes("Q"));
const st = { tool: "pen", color: "#000000", width: 4, points: [[0, 0], [100, 0]] };
ok("eraser: touches the stroke along its length, not far away", h.hitsStroke(st, [50, 3], 4) && !h.hitsStroke(st, [50, 60], 4));
ok("width: pressure widens/thins pen lines; highlighter is broad", h.strokeWidth({ ...st, points: [[0, 0, 1], [1, 1, 1]] }) > h.strokeWidth({ ...st, points: [[0, 0, 0.1], [1, 1, 0.1]] }) && h.strokeWidth({ ...st, tool: "highlighter" }) === 16);
ok("every colour has a name", h.COLORS.length === 8 && h.COLORS.every((c) => /^[A-Z][a-z]+$/.test(c.name) && /^#[0-9a-f]{6}$/.test(c.hex)));
ok("limits mirror the server (20 pages, 2 MB)", h.LIMITS.pages === 20 && h.LIMITS.bytes === 2 * 1024 * 1024);
ok("problems in words: too many pages", /1 to 20 pages/.test(h.docProblem({ version: 1, pages: Array.from({ length: 21 }, () => h.emptyPage()) })) && h.docProblem(h.emptyDoc()) === null);
ok("empty drawing detected", h.isEmpty(h.emptyDoc()) && !h.isEmpty({ version: 1, pages: [{ background: "blank", strokes: [st] }] }));
ok("recovery: the newer copy wins", h.pickNewer({ savedAt: Date.parse("2026-10-28T10:00:00Z") }, { updatedAt: "2026-10-28T09:00:00Z" }) === "local"
  && h.pickNewer({ savedAt: Date.parse("2026-10-28T08:00:00Z") }, { updatedAt: "2026-10-28T09:00:00Z" }) === "server" && h.pickNewer(null, null) === null);
await h.saveLocalDraft("u1", "new:k", { doc: h.emptyDoc(), caption: "c", attachmentId: null, savedAt: 1 });
ok("local draft per account + drawing", (await h.loadLocalDraft("u1", "new:k"))?.caption === "c" && (await h.loadLocalDraft("u2", "new:k")) === null);
await h.clearLocalDraft("u1", "new:k");
ok("local draft cleared", (await h.loadLocalDraft("u1", "new:k")) === null);
let got = null; const off = h.onStudioSaved("k1", (a) => { got = a; });
h.emitStudioSaved("k1", { id: "a1", pageCount: 2, caption: null }); h.emitStudioSaved("other", { id: "x" });
off(); h.emitStudioSaved("k1", { id: "a2" });
ok("Studio hands the saved drawing back to the answer box that opened it (only)", got?.id === "a1");

// 2. API helpers
const api = load("lib/learningAttachmentsApi.ts");
ok("labels say what it is", api.attachmentLabel({ kind: "handwriting", pageCount: 2 }) === "Drawing, 2 pages" && api.attachmentLabel({ kind: "pdf", fileName: "notes.pdf" }).startsWith("PDF"));
const serverLib = readFileSync(path.join(root, "../api-server/src/lib/learningAttachments.ts"), "utf8");
const serverWords = JSON.parse(serverLib.match(/export const ATTACHED_ONLY = ("[^"]+");/)[1]);
ok("'answered with a drawing' words are the same on app and server", api.ATTACHED_ONLY === serverWords && api.isAttachedOnlyText(` ${serverWords} `) && !api.isAttachedOnlyText("My answer"));
ok("sizes in words", api.formatBytes(2048) === "2 KB" && api.formatBytes(3 * 1024 * 1024) === "3.0 MB");
let lastUrl = null; globalThis.fetch = async (u) => { lastUrl = u; return { ok: true, json: async () => ({ attachments: {} }) }; };
await api.attachmentsFor("core_submission", ["a", "a", "b"]);
ok("answer files fetched in one call, de-duplicated", lastUrl === "http://test/api/learning/attachments/for?kind=core_submission&ids=a,b");
globalThis.fetch = async () => { throw new Error("offline"); };
ok("status unreachable → hidden (never blocks typing)", (await api.getAttachmentStatus()).enabled === false);

// 3. Wiring
const card = src("app/lesson/[id].tsx");
ok("lesson card: tray only on Comprehensive Check answers", card.includes('{kind === "assignment" ? <AttachmentTray') && !/kind === "reflection"[^\n]*AttachmentTray/.test(card));
ok("lesson card: typing still works; send needs words or a ready file, waits for uploads", card.includes('const canSend = (!!text.trim() || (kind === "assignment" && files.ids.length > 0)) && !files.busy;'));
ok("lesson card: sent answers show their files", card.includes('<AttachmentList kind="core_submission" submissionId={submitted.id}'));
const dc = src("contexts/DataContext.tsx");
const linkAt = dc.indexOf("await linkToCoreAnswer("), insertAt = dc.indexOf('supabase.from("p2p_submissions").insert(');
ok("core: files linked to the answer's id BEFORE the unchanged insert", linkAt > 0 && insertAt > linkAt && dc.includes("!!assignmentQuestionId"));
ok("core: a drawing-only answer still carries words for older apps", dc.includes("ATTACHED_ONLY : (text ?? null)"));
const grp = src("app/learning/assignment/[assignmentId].tsx");
ok("group: tray on the answer, ids sent with the attempt, files under each attempt (mine + reviewer)", grp.includes("<AttachmentTray") && grp.includes("submitAssignment(scope, assignmentId, draft.text, files.ids)")
  && (grp.match(/<AttachmentList kind="group_submission"/g) ?? []).length === 2);
const ev = src("app/evaluations.tsx");
ok("peer review: the evaluator sees the answer's files", ev.includes('<AttachmentList kind="core_submission" submissionId={evaluation.submissionId}'));
const tray = src("components/handwriting/AttachmentTray.tsx");
ok("tray: hidden unless switched on", tray.includes("if (!status?.enabled) return null;"));
ok("tray: photos as JPEG/PNG/WebP (HEIC handed over as JPEG), PDFs only", tray.includes("UIImagePickerPreferredAssetRepresentationMode.Compatible") && tray.includes('type: "application/pdf"') && !/launchCameraAsync/.test(tray));
ok("tray: progress, retry, remove, words for every state", tray.includes("Retry upload of") && tray.includes("percent") && tray.includes("Remove ${it.label}"));
const studio = src("app/learning/studio/[docId].tsx");
ok("Studio exists; read-only view for sent work", existsSync(path.join(root, "app/learning/studio/[docId].tsx")) && studio.includes('view === "1"'));
ok("Studio: saves on this device every 3 s and on backgrounding, to the account every 30 s", studio.includes("LOCAL_EVERY_MS = 3000") && studio.includes("SERVER_EVERY_MS = 30000") && studio.includes('AppState.addEventListener("change"'));
ok("Studio: leaving never loses work (saved first, then leaves)", studio.includes('"beforeRemove"') && studio.includes("e.preventDefault()") && studio.includes("navigation.dispatch(e.data.action)"));
ok("Studio: undo/redo, pages, clear/delete asks first, zoom, caption", ["Undo", "Redo", "Add a page after this one", "Delete this page?", "Zoom in", "Describe your drawing"].every((w) => studio.includes(w)));
const surface = src("components/handwriting/DrawingSurface.tsx");
ok("surface: stylus pressure only from a stylus; finger ignored once a stylus is used (palm rest)", surface.includes("isStylus ? e.stylusData?.pressure : null") && surface.includes("stylusSeen.current && e.pointerType === PointerType.TOUCH"));
ok("drawings are data: rendered by one read-only renderer (no markup)", !/dangerouslySetInnerHTML|SvgXml|WebView/.test(src("components/handwriting/DrawingView.tsx") + surface));
ok("Learning Centre untouched by this step", !src("app/learning/index.tsx").includes("Attachment"));

console.log(`handwriting: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
