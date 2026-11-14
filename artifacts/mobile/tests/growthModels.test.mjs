// The living Growth Tree (owner brief 2026-11-13: "replace all growth tree visuals with the original Meshy
// 3D models and implement a living tree"):
//   • ONE renderer (components/growth/LivingTreeView → TreeModelViewer → lib/treeViewerHtml.ts) for Home,
//     My Tree, the stage cards, full screen and the celebrations — always the owner's real Meshy model for
//     the stage, from the hosted v2 folder; no picture, emoji, illustration or substitute tree, ever;
//   • the viewer page: standard copy first, close-up only when zoomed in, one copy in memory, disposal,
//     cancelled downloads, the config can't break out of its script tag;
//   • wind: a vertex-shader displacement on the real mesh (the bodies are one fused mesh), weighted by
//     height, distance from the trunk and the model's own leaf-green texture; off with reduced motion,
//     switchable; drawing pauses when hidden; Full tree / Roots / Canopy camera views;
//   • the v1 models (never hosted) and their stills are gone from the app.
// Run: node tests/growthModels.test.mjs
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
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

// ── Viewer page ──
const { treeViewerHtml } = load("lib/treeViewerHtml.ts");
const html = treeViewerHtml({ standardUrl: "https://x/a.glb", detailedUrl: "https://x/a.close.glb", background: "#FBF7EE", reduceMotion: false, wind: true });
ok("viewer: three.js pinned to one version, meshopt decoder wired", /three@\d+\.\d+\.\d+\/build\/three\.module\.js/.test(html) && html.includes("setMeshoptDecoder(MeshoptDecoder)"));
ok("viewer: import maps work on older iOS WebViews (shim loaded)", html.includes("es-module-shims"));
ok("viewer: close-up copy at 1.5× screen height, standard again below 0.9× after a delay", html.includes("DETAIL_AT = 1.5") && html.includes("STANDARD_AT = 0.9") && html.includes("STANDARD_AFTER_MS"));
ok("viewer: the replaced copy is removed and disposed in the same step (one copy in memory)", /scene\.add\(root\);\s*if \(current\) \{ scene\.remove\(current\); dispose\(current\); \}/.test(html));
ok("viewer: dispose frees geometry, every texture and the material", html.includes("o.geometry?.dispose()") && html.includes("v.isTexture) v.dispose()") && html.includes("m.dispose()"));
ok("viewer: downloads can be cancelled (zooming out mid-download)", html.includes("new AbortController()") && html.includes("pending.abort()") && html.includes("fetch(url, { signal })"));
ok("viewer: a failed close-up download keeps the standard copy", html.includes("detailFailed: true"));
ok("viewer: offline gets its own message", html.includes("You're offline"));
ok("viewer: messages reach both the WebView and the web iframe", html.includes("window.ReactNativeWebView.postMessage") && html.includes("window.parent.postMessage({ p2pTreeViewer: msg }"));
ok("viewer: panning stays on the model", html.includes("bounds.clampPoint(controls.target, controls.target)"));
ok("viewer: auto-rotate follows reduced motion and stops when touched", html.includes("controls.autoRotate = !CFG.reduceMotion") && html.includes('addEventListener("start", () => { controls.autoRotate = false;'));
ok("viewer: a copy swap never interrupts a gesture", html.includes("while (interacting && !ctl.signal.aborted)") && html.includes("renderer.compileAsync(") && html.includes("renderer.initTexture(") && html.includes("MeshoptDecoder.useWorkers"));
ok("viewer: no close-up copy → nothing to swap, and zoom stops before detail breaks down", treeViewerHtml({ standardUrl: "a", detailedUrl: null, background: "#fff", reduceMotion: false, noCloseUp: true }).includes("CFG.noCloseUp ? 0.6 : 0.12"));
const nasty = treeViewerHtml({ standardUrl: "https://x/</script><script>alert(1)</script>", detailedUrl: "b", background: "#fff", reduceMotion: false });
ok("viewer: the config can't close its script tag", !nasty.includes("</script><script>alert(1)") && nasty.includes("\\u003c/script>"));

// ── Wind (the living tree) ──
ok("wind: a vertex-shader displacement on the real model's own material (onBeforeCompile), not a whole-tree rotation or scale",
  html.includes("material.onBeforeCompile") && html.includes('replace("#include <project_vertex>", WIND_PROJECT)') && html.includes("p2pW.xyz += p2pWind(") && !/root\.(rotation|scale)\.[xyz]?\s*[+=]/.test(html));
ok("wind: leaves found from the model's OWN colour texture (leaf-green flutters; bark, apples and roots don't)",
  html.includes("addWind(m, m.map || null)") && html.includes("textureLod( uLeafMap, uv, 4.0 )") && html.includes("p2pC.g - max( p2pC.r, p2pC.b )"));
ok("wind: roots, trunk and main limbs stay still — weighted by height above the root base and distance from the trunk",
  html.includes("float bend = smoothstep(0.4, 1.0, h) * smoothstep(0.2, 1.0, r)") && html.includes("smoothstep(0.3, 0.75, h) * smoothstep(0.1, 0.6, r)"));
ok("wind: leaves out of step with each other; gusting, slow branch sway; small amplitudes",
  html.includes("float q = dot(p, vec3(9.1, 7.3, 8.7))") && html.includes("float gust = 0.6 + 0.4 * sin(t * 0.31)") && html.includes("* bend * 0.010") && html.includes("* fl * 0.0045"));
ok("wind: fruit and buds sway rigidly with their branch (no flutter)", html.includes("addWind(mesh.material, null)"));
ok("wind: centred on the trunk axis measured on the model (narrowest height band), sized by the body's anchors",
  html.includes("function measureTrunk(root, box)") && html.includes("if (!best || spread < best.spread)") && html.includes("const w = CFG.windFrame") && html.includes("WIND.base.value.set(axis[0], box.min.y, axis[1])"));
ok("wind: eases in and out, switchable from the app", html.includes("WIND.strength.value += (windTarget - WIND.strength.value) * 0.05") && html.includes("window.__p2pWind = (on) => { windTarget = on && !CFG.reduceMotion ? 1 : 0; }"));
ok("memory: the lighting environment is freed too (its render target on leaving)", html.includes("room.dispose?.(); pmrem.dispose();") && html.includes("envTarget?.dispose()"));
ok("card: Try again sits beside the tree button, never inside it", src("components/growth/LivingTreeView.tsx").includes("{errorOverlay}\n      </View>") && src("components/growth/LivingTreeView.tsx").includes('<View pointerEvents="none" style={StyleSheet.absoluteFill}>{scene}</View>'));
ok("wind: off with reduced motion", treeViewerHtml({ standardUrl: "a", detailedUrl: null, background: "#fff", reduceMotion: true, wind: true }).includes("CFG.wind && !CFG.reduceMotion ? 1 : 0"));
ok("drawing: pauses when hidden or paused by the app; one loop only; cancelled on page hide",
  html.includes('document.addEventListener("visibilitychange", setRunning)') && html.includes("window.__p2pPause = (p) =>") && html.includes("if (run && rafId === null)") && html.includes("cancelAnimationFrame(rafId)"));
ok("views: Full tree / Roots / Canopy move the camera over the real model (eased; instant with reduced motion)",
  html.includes("window.__p2pView = (mode) =>") && html.includes('mode === "roots"') && html.includes('mode === "canopy"') && html.includes("if (CFG.reduceMotion) { controls.target.copy(target)"));
const card = treeViewerHtml({ standardUrl: "a", detailedUrl: null, background: "#fff", reduceMotion: false, compact: true });
ok("card: no gestures (the page scrolls past it), framed close", card.includes("touch-action:pan-y") && card.includes("if (CFG.compact) { controls.enabled = false;") && card.includes("CFG.compact ? 1.02 : 1.12"));

// ── Platform views ──
const native = src("components/growth/TreeModelViewer.native.tsx"), web = src("components/growth/TreeModelViewer.web.tsx");
ok("native: WebView with the generated page, status messages parsed, crash → error state", native.includes('from "react-native-webview"') && native.includes("treeViewerHtml(") && native.includes("onContentProcessDidTerminate") && native.includes("onRenderProcessGone"));
ok("native: pauses in the background and when its screen isn't in view", native.includes('AppState.addEventListener("change"') && native.includes("const stop = !!paused || inBackground") && native.includes("__p2pPause"));
ok("web: iframe srcDoc, only its own frame's messages; paused when not in view; a card takes no pointer events", web.includes("srcDoc={html}") && web.includes("e.source !== frame.current?.contentWindow") && web.includes("__p2pPause?.(!!paused)") && web.includes('pointerEvents: compact ? "none" : undefined'));
ok("both: view and wind handles", [native, web].every((f) => f.includes("view: (mode)") && f.includes("setWind: (on)")));

// ── The one shared renderer ──
const lt = src("components/growth/LivingTreeView.tsx");
ok("LivingTreeView: always the hosted Meshy body for the stage (v2), with the same stage→body map as the tree", lt.includes("modularFileUrl(body)") && lt.includes("STAGE_BODIES[Math.min(5, Math.max(1, stageIndex + 1))]") && lt.includes("plan?.body ?? bodyForStage(stageIndex)"));
ok("LivingTreeView: no picture fallback — loading, Try again, or 'not available yet'", !/<Image\b/.test(lt) && lt.includes('label="Try again"') && lt.includes("isn't available yet") && !lt.includes("emoji"));
ok("LivingTreeView: the person's tree keeps its verified fruit (placement on measured anchors)", lt.includes("placeTree(plan, anchors") && lt.includes("instancesByAsset(placed)") && lt.includes("useGrowthTree(mode === \"tree\")"));
ok("LivingTreeView: wind (not with reduced motion), anchors cached, close-up never on a card", lt.includes("wind={!reduceMotion}") && lt.includes("anchorsCache") && lt.includes("const closeUrl = compact ? null : modularCloseUrl(body)"));
ok("LivingTreeView: pauses when its route isn't the current one", lt.includes("const focused = pathname === openedOn") && lt.includes("paused={!focused}"));
ok("LivingTreeView: Full tree / Roots / Canopy and a wind switch (with an accessible label)", lt.includes('["full", "Full tree"], ["roots", "Roots"], ["canopy", "Canopy"]') && lt.includes("Stop the leaves moving"));
ok("LivingTreeView: accessible description; zoom and reset for people who can't pinch", lt.includes('accessibilityRole="image"') && ["Zoom in", "Zoom out", "Reset the view"].every((l) => lt.includes(`accessibilityLabel="${l}"`)));
const users = { "app/(tabs)/index.tsx": 'mode="tree" compact', "app/living-tree.tsx": 'mode="tree"', "app/(tabs)/profile.tsx": 'mode="tree" compact', "app/stages.tsx": 'mode="stage" compact', "app/tree-3d.tsx": "showViewControls",
  "app/completion.tsx": 'mode="stage" compact', "components/ModuleCelebrationModal.tsx": 'mode="stage" compact', "components/ForestTransition.tsx": "stageIndex={4}" };
for (const [f, needle] of Object.entries(users)) ok(`${f}: shows the real Meshy model through the shared LivingTreeView`, src(f).includes('import LivingTreeView') && src(f).includes(needle));
const home = src("app/(tabs)/index.tsx");
ok("Home: the tree fills a square card; no image, no emoji fallback, no emoji in the stage label", home.includes('treeCard: { aspectRatio: 1') && !home.includes("STAGE_IMAGES") && !home.includes("treeFallbackEmoji") && !home.includes("stage.emoji") && !home.includes("nextStage.emoji"));
const living = src("app/living-tree.tsx");
ok("My Tree: views shown; full-screen opens your own tree; Growth Story, Fruit Harvest and genealogy kept", living.includes("showViewControls") && living.includes('mine: "1"') && living.includes('label="Watch full growth story"') && living.includes("/fruit-harvest") && living.includes("/growth-timeline") && living.includes("/lineage"));
ok("My Tree / Home: progress as requirements met, never points", !living.includes("more points of shared study") && living.includes("requirements met for") && home.includes("requirements met for"));
const stages = src("app/stages.tsx");
ok("Stages: one live model (yours); every stage opens its own model in 3D on request; no pictures; Forest of Nations stated unavailable in 3D",
  !stages.includes("<Image") && stages.includes('params: { stage: String(i) }') && stages.includes("The 3D Forest of Nations scene isn&apos;t available yet."));
const full = src("app/tree-3d.tsx");
ok("Full screen: a stage (0–4) or your own tree; real download sizes from the manifest", full.includes('mode={mine ? "tree" : "stage"}') && full.includes("asset.file.bytes") && full.includes("asset.file.close"));

// ── The old representations are gone ──
for (const f of ["lib/growthModels.ts", "components/growth/GrowthModelView.tsx", "components/growth/StageStill.tsx", "components/growth/ModularTreeView.tsx", "components/LivingTree.tsx"]) ok(`removed: ${f}`, !existsSync(path.join(root, f)));
const growthScreens = ["app/(tabs)/index.tsx", "app/(tabs)/profile.tsx", "app/living-tree.tsx", "app/stages.tsx", "app/tree-3d.tsx", "app/completion.tsx", "app/growth-timeline.tsx", "app/forest.tsx", "app/lineage.tsx", "app/development-history.tsx", "components/ModuleCelebrationModal.tsx", "components/ForestTransition.tsx", "components/InviteEncouragementCard.tsx", "constants/stages.ts"];
for (const f of growthScreens) {
  const s = src(f);
  ok(`${f}: no v1 model path, still image or stage picture`, !s.includes("models/v1") && !s.includes("STAGE_IMAGES") && !s.includes("stageStillUrl") && !s.includes("Forest%20of%20nations"));
  ok(`${f}: no stage emoji standing in for a tree`, !/\b(stage|nextStage|me|st|collective)\.emoji\b|STAGES\[[^\]]+\]\??\.emoji|\.stage\.emoji/.test(s) && !s.includes("🌳</Text>"));
}
const hook = src("hooks/useGrowthStage.ts");
ok("stage: one shared source — the server-calculated growth milestone, last known stage kept offline", hook.includes("getGrowthJourney()") && hook.includes("AsyncStorage.setItem(storeKey(userId)") && hook.includes("Math.min(4,"));

console.log(`growthModels (app): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
