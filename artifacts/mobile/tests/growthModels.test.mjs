// 3D growth models (lib/growthModels.ts, lib/treeViewerHtml.ts, app/tree-3d.tsx):
//   • only models approved for full rotation are offered — Seed and Fruitful Tree as stages,
//     Blossom and Fruits as supporting views; Sprout and Young Tree (flat reliefs) and Forest
//     Builder (no approved close-up) keep their image;
//   • files come from a versioned folder, overridable for local review;
//   • the viewer page: standard copy first, detailed copy only when zoomed in past 1.5× screen
//     height, back below 0.9×, the replaced copy always disposed, in-flight downloads cancelled,
//     reduced motion respected, the config can't break out of its script tag;
//   • screens: entry points only for stages with a model, accessible description, retry on error.
// Run: node tests/growthModels.test.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log(`FAIL ${n} ${d}`); } };
const src = (p) => readFileSync(path.join(root, p), "utf8");
const load = (rel, env = {}) => {
  const js = ts.transpileModule(src(rel), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (m) => { throw new Error(`unexpected require ${m}`); }, process: { env }, JSON, Object, String, Number });
  return mod.exports;
};

// ── Registry ──
const reg = load("lib/growthModels.ts");
ok("registry: the five stages plus Blossom and Fruits", JSON.stringify(Object.keys(reg.GROWTH_MODELS).sort()) === JSON.stringify(["blossom", "forest_builder", "fruitful_tree", "fruits", "seed", "sprout", "young_tree"]));
ok("registry: every personal stage (Seed … Forest Builder) has its model", JSON.stringify(reg.STAGE_MODELS) === JSON.stringify({ 0: "seed", 1: "sprout", 2: "young_tree", 3: "fruitful_tree", 4: "forest_builder" }));
ok("registry: Blossom and Fruits are supporting views of Fruitful Tree, not stages", JSON.stringify(reg.SUPPORTING_MODELS) === JSON.stringify({ fruitful_tree: ["blossom", "fruits"] })
  && !Object.values(reg.STAGE_MODELS).some((m) => m === "blossom" || m === "fruits"));
ok("registry: every model has a standard copy, size and description; detailed copies are larger",
  Object.values(reg.GROWTH_MODELS).every((m) => m.standard.endsWith("-mobile.glb") && m.standardMb > 0 && m.description.length > 20
    && (m.detailed === null ? m.detailedMb === null : m.detailed.endsWith("-high.glb") && m.detailedMb >= m.standardMb)));
ok("limits: Sprout and Young Tree are front-only (flat reliefs), stated to the person",
  ["sprout", "young_tree"].every((id) => reg.GROWTH_MODELS[id].limits?.frontOnly && /front only/.test(reg.limitNote(reg.GROWTH_MODELS[id]))));
ok("limits: Forest Builder has no close-up copy and says so", reg.GROWTH_MODELS.forest_builder.detailed === null && reg.GROWTH_MODELS.forest_builder.limits?.noCloseUp
  && /Close-up zoom isn't available/.test(reg.limitNote(reg.GROWTH_MODELS.forest_builder)) && reg.modelUrls(reg.GROWTH_MODELS.forest_builder).detailed === null);
ok("limits: full models carry no note", ["seed", "fruitful_tree", "blossom", "fruits"].every((id) => reg.limitNote(reg.GROWTH_MODELS[id]) === null));
ok("stills: every personal stage has a still of its model, from the same versioned folder",
  [0, 1, 2, 3, 4].every((i) => (reg.stageStillUrl(i) ?? "").startsWith(reg.GROWTH_MODEL_BASE_URL + "stills/") && reg.stageStillUrl(i).endsWith(".webp")) && reg.stageStillUrl(5) === null);
ok("registry: default files come from the versioned Forests/models/v1/ folder", reg.GROWTH_MODEL_BASE_URL.endsWith("/Forests/models/v1/") && reg.modelUrls(reg.GROWTH_MODELS.seed).standard === reg.GROWTH_MODEL_BASE_URL + "P2P-Seed-mobile.glb");
const local = load("lib/growthModels.ts", { EXPO_PUBLIC_GROWTH_MODEL_BASE_URL: "http://127.0.0.1:8795" });
ok("registry: base URL can be overridden for local review (trailing slash added)", local.GROWTH_MODEL_BASE_URL === "http://127.0.0.1:8795/");
ok("registry: unknown ids are rejected", reg.isGrowthModelId("seed") && reg.isGrowthModelId("forest_builder") && !reg.isGrowthModelId("forest_of_nations") && !reg.isGrowthModelId(undefined));

// ── Viewer page ──
const { treeViewerHtml } = load("lib/treeViewerHtml.ts");
const html = treeViewerHtml({ standardUrl: "https://x/a-mobile.glb", detailedUrl: "https://x/a-high.glb", background: "#FBF7EE", reduceMotion: false });
ok("viewer: three.js pinned to one version, meshopt decoder wired", /three@\d+\.\d+\.\d+\/build\/three\.module\.js/.test(html) && html.includes("setMeshoptDecoder(MeshoptDecoder)"));
ok("viewer: import maps work on older iOS WebViews (shim loaded)", html.includes("es-module-shims"));
ok("viewer: detailed copy at 1.5× screen height, standard again below 0.9× after a delay", html.includes("DETAIL_AT = 1.5") && html.includes("STANDARD_AT = 0.9") && html.includes("STANDARD_AFTER_MS"));
ok("viewer: the replaced copy is removed and disposed in the same step (one copy in memory)", /scene\.add\(root\);\s*if \(current\) \{ scene\.remove\(current\); dispose\(current\); \}/.test(html));
ok("viewer: dispose frees geometry, every texture and the material", html.includes("o.geometry?.dispose()") && html.includes("v.isTexture) v.dispose()") && html.includes("m.dispose()"));
ok("viewer: downloads can be cancelled (zooming out mid-download)", html.includes("new AbortController()") && html.includes("pending.abort()") && html.includes("fetch(url, { signal })"));
ok("viewer: a failed detailed download keeps the standard copy", html.includes("detailFailed: true"));
ok("viewer: offline gets its own message", html.includes("You're offline"));
ok("viewer: messages reach both the WebView and the web iframe", html.includes("window.ReactNativeWebView.postMessage") && html.includes("window.parent.postMessage({ p2pTreeViewer: msg }"));
ok("viewer: panning stays on the model", html.includes("bounds.clampPoint(controls.target, controls.target)"));
ok("viewer: auto-rotate follows reduced motion and stops when touched", html.includes("controls.autoRotate = !CFG.reduceMotion") && html.includes('addEventListener("start", () => { controls.autoRotate = false; })'));
const front = treeViewerHtml({ standardUrl: "a", detailedUrl: "b", background: "#fff", reduceMotion: false, frontOnly: true });
ok("viewer: front-only turns ±30° near eye level and never auto-turns into its edges", front.includes("controls.minAzimuthAngle = -Math.PI / 6") && front.includes("!CFG.frontOnly") && front.includes('"frontOnly":true'));
const single = treeViewerHtml({ standardUrl: "a", detailedUrl: null, background: "#fff", reduceMotion: false, noCloseUp: true });
ok("viewer: no detailed copy → nothing to swap, and zoom stops before detail breaks down", single.includes('"detailedUrl":null') && single.includes("if (!CFG.detailedUrl)") && single.includes("CFG.noCloseUp ? 0.6 : 0.12"));
ok("viewer: reduced motion is passed through", treeViewerHtml({ standardUrl: "a", detailedUrl: "b", background: "#fff", reduceMotion: true }).includes('"reduceMotion":true'));
const nasty = treeViewerHtml({ standardUrl: "https://x/</script><script>alert(1)</script>", detailedUrl: "b", background: "#fff", reduceMotion: false });
ok("viewer: the config can't close its script tag", !nasty.includes("</script><script>alert(1)") && nasty.includes("\\u003c/script>"));

// ── Platform views ──
const native = src("components/growth/TreeModelViewer.native.tsx"), web = src("components/growth/TreeModelViewer.web.tsx");
ok("native: WebView with the generated page, status messages parsed", native.includes('from "react-native-webview"') && native.includes("treeViewerHtml(") && native.includes("onMessage"));
ok("native: a crashed WebView shows the error state", native.includes("onContentProcessDidTerminate") && native.includes("onRenderProcessGone"));
ok("web: iframe srcDoc, only messages from its own frame are accepted", web.includes("srcDoc={html}") && web.includes("e.source !== frame.current?.contentWindow"));
ok("barrel: type-only re-export like YouTubePlayer", src("components/growth/TreeModelViewer.tsx").includes('export { default } from "./TreeModelViewer.web"'));

// ── Screens ──
const screen = src("app/tree-3d.tsx"), stages = src("app/stages.tsx");
const view = src("components/growth/GrowthModelView.tsx");
ok("model view: accessible description of the model for people who can't see it", view.includes('accessibilityRole="image"') && view.includes("model.description"));
ok("model view: zoom and reset buttons for people who can't pinch", ["Zoom in", "Zoom out", "Reset the view"].every((l) => view.includes(`accessibilityLabel="${l}"`)));
ok("model view: error state with Try again", view.includes('label="Try again"') && view.includes("setReloadKey"));
ok("model view: limits passed to the viewer", view.includes("frontOnly={model.limits?.frontOnly}") && view.includes("noCloseUp={model.limits?.noCloseUp}"));
ok("screen: the model's limitation is stated", screen.includes("limitNote(model)") && screen.includes("{note}"));
ok("screen: download size shown before anything heavy is fetched", screen.includes("model.standardMb") && screen.includes("model.detailedMb"));
ok("screen: status announced politely", screen.includes('accessibilityLiveRegion="polite"'));
ok("screen: unknown model ids fall back to Seed", screen.includes('isGrowthModelId(params.model) ? params.model : "seed"'));
// ── The 2D tree is replaced everywhere (owner decision 2026-11-06) ──
for (const f of ["app/(tabs)/index.tsx", "app/(tabs)/profile.tsx", "app/completion.tsx", "app/living-tree.tsx"]) {
  ok(`${f}: no drawn 2D tree`, !src(f).includes("<LivingTree") && !src(f).includes('from "@/components/LivingTree"'));
}
ok("stage images: the five personal stages are the 3D stills; Forest of Nations keeps its landscape", src("constants/stages.ts").includes("[0, 1, 2, 3, 4].map((i) => ({ uri: stageStillUrl(i)! }))") && src("constants/stages.ts").includes("Forest%20of%20nations"));
const hook = src("hooks/useGrowthStage.ts");
ok("stage: one shared source — the server-calculated growth milestone, last known stage kept offline", hook.includes("getGrowthJourney()") && hook.includes("AsyncStorage.setItem(storeKey(userId)") && hook.includes("Math.min(4,"));
for (const f of ["app/(tabs)/index.tsx", "app/(tabs)/profile.tsx", "app/completion.tsx", "app/living-tree.tsx"]) ok(`${f}: follows the growth milestone`, src(f).includes("useGrowthStage()"));
const living = src("app/living-tree.tsx");
ok("living tree: the hero is the live 3D model of the milestone stage, with a full-screen button", living.includes("<GrowthModelView") && living.includes("modelId={modelId}") && living.includes('accessibilityLabel="Open full screen"'));
ok("living tree: growth story kept; fruit listed with details; roots view and seasons gone",
  living.includes('label="Watch full growth story"') && living.includes("setSelectedFruitKey(f.fruitKey)") && !living.includes("EnvironmentPicker") && !living.includes("Tap the roots"));
ok("living tree: a model's limitation is stated on the screen", living.includes("limitNote(GROWTH_MODELS[modelId])") && living.includes("{note}"));
ok("living tree / home: progress as requirements met, never points", !living.includes("more points of shared study") && living.includes("requirements met for"));
ok("small places use stills (no live 3D in cards)", !src("app/(tabs)/index.tsx").includes("GrowthModelView") && !src("app/(tabs)/profile.tsx").includes("GrowthModelView") && src("app/completion.tsx").includes("<StageStill"));

ok("stages: entry points only where a stage has a model, and only for reached stages in the list",
  stages.includes("STAGE_MODELS[stageIndex] ?") && stages.includes("reached && STAGE_MODELS[i] ?") && stages.includes('pathname: "/tree-3d"'));

console.log(`growthModels (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
