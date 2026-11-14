// Self-contained three.js page for the growth-model viewer, loaded into a WebView (iOS/Android)
// or an iframe (web). Level of detail: the standard copy loads first; the detailed copy is
// downloaded only when the model fills more than 1.5× the screen height, swapped in the moment it
// is ready (the standard copy is freed in the same frame), and swapped back after zooming out.
// Only one copy of a model is ever kept. Messages to the app: { type: "status", state, ... }.
// Known limitations are applied openly (the screen states them): frontOnly limits turning to the
// front of a flat relief; noCloseUp (no detailed copy) stops zooming before detail breaks down.
//
// LIVING TREE (owner brief 2026-11-13): the Meshy bodies are ONE fused mesh with ONE material and no
// hierarchy (inspected: 1 node, 1 primitive, POSITION/NORMAL/TEXCOORD_0 only), so leaves can't be moved
// as separate objects. Wind is a vertex-shader displacement on the real model, weighted by:
//   • height above the base of the roots and distance from the trunk axis — roots, trunk and main limbs
//     stay still; only the outer canopy and branch tips move;
//   • the model's OWN base-colour texture — where it is leaf-green the surface flutters (small, quick,
//     out of step from leaf to leaf); bark, apples and roots don't.
// Branch sway is slow and varies with a gusting wind; fruit and buds on the branches sway with them.
// Nothing is rotated or scaled as a whole. Off when the person prefers reduced motion; the app can turn
// it off (__p2pWind) and pause all drawing (__p2pPause), e.g. when the screen isn't visible.

export interface TreeViewerConfig {
  standardUrl: string;
  /** Null when the model has no detailed copy. */
  detailedUrl: string | null;
  background: string;
  reduceMotion: boolean;
  frontOnly?: boolean;
  noCloseUp?: boolean;
  /** Wind on at start (never when reduceMotion). */
  wind?: boolean;
  /** The body's trunk base [x, minY, z], height and canopy radius (its anchors file); else measured from the model. */
  windFrame?: { trunk: [number, number, number]; height: number; rMax: number } | null;
  /** A card (Home, stage cards): no gestures or buttons, framed close, slow turn; taps are the app's. */
  compact?: boolean;
  /** Modular Growth Tree (lib/growthTreePlacement.ts): parts drawn on the body, one instanced mesh per
   *  part. Each instance: [x,y,z, nx,ny,nz, size, yaw, hang]. ids[asset][i] is reported when tapped. */
  parts?: { urls: Record<string, string>; instances: Record<string, number[][]>; ids: Record<string, string[]> };
}

const THREE_VERSION = "0.170.0";

export function treeViewerHtml(cfg: TreeViewerConfig): string {
  // "<" escaped so the JSON can never close the script tag.
  const json = JSON.stringify(cfg).replace(/</g, "\\u003c");
  const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;overflow:hidden;background:${cfg.background};touch-action:${cfg.compact ? "pan-y" : "none"};-webkit-user-select:none;user-select:none}
canvas{display:block;width:100%;height:100%;outline:none}
</style>
<script async src="https://cdn.jsdelivr.net/npm/es-module-shims@1.10.0/dist/es-module-shims.js"></script>
<script type="importmap">{"imports":{"three":"${cdn}/build/three.module.js","three/addons/":"${cdn}/examples/jsm/"}}</script>
</head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const CFG = ${json};
const post = (msg) => {
  const s = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.parent !== window) window.parent.postMessage({ p2pTreeViewer: msg }, "*");
};
window.onerror = (m) => post({ type: "status", state: "error", message: String(m) });

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
} catch (e) {
  post({ type: "status", state: "error", message: "3D isn't available on this device." });
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
renderer.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); post({ type: "status", state: "error", message: "The 3D view was interrupted." }); });

const scene = new THREE.Scene();
scene.background = new THREE.Color(CFG.background);
// The lighting environment is baked once; its scene and generator are freed straight away.
let envTarget = null;
{
  const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
  envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  room.dispose?.(); pmrem.dispose();
}
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 5, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = true; controls.screenSpacePanning = true;
// Two-finger pan lets people bring any part close (apples, roots), but never off the model.
let bounds = null;
controls.addEventListener("change", () => { if (bounds) bounds.clampPoint(controls.target, controls.target); });
// A flat relief only turns ±30° and stays near eye level; it doesn't auto-turn into its edges.
controls.autoRotate = !CFG.reduceMotion && !CFG.frontOnly; controls.autoRotateSpeed = CFG.compact ? 0.35 : 0.6;
// A card takes no gestures (the page scrolls past it; a tap is the app's).
if (CFG.compact) { controls.enabled = false; renderer.domElement.style.touchAction = "pan-y"; }
if (CFG.frontOnly) {
  controls.minAzimuthAngle = -Math.PI / 6; controls.maxAzimuthAngle = Math.PI / 6;
  controls.minPolarAngle = Math.PI / 2 - 0.35; controls.maxPolarAngle = Math.PI / 2 + 0.2;
}
// While a finger is down the copy swap waits (its one-off GPU upload never interrupts a pinch or drag).
let interacting = false;
controls.addEventListener("start", () => { controls.autoRotate = false; interacting = true; });
controls.addEventListener("end", () => { interacting = false; });

// ── Wind (see the note at the top of lib/treeViewerHtml.ts). Everything in world units of the body. ──
const WIND = { time: { value: 0 }, strength: { value: CFG.wind && !CFG.reduceMotion ? 1 : 0 }, base: { value: new THREE.Vector3() }, height: { value: 1 }, rmax: { value: 1 } };
let windTarget = WIND.strength.value;
const WIND_GLSL = \`
uniform float uWindTime; uniform float uWindStrength; uniform vec3 uWindBase; uniform float uWindHeight; uniform float uWindRmax;
vec3 p2pWind(vec3 p, float leaf) {
  if (uWindStrength <= 0.0) return vec3(0.0);
  float t = uWindTime;
  float gust = 0.6 + 0.4 * sin(t * 0.31) * sin(t * 0.17 + 1.3);
  float h = clamp((p.y - uWindBase.y) / uWindHeight, 0.0, 1.0);
  float r = clamp(length(p.xz - uWindBase.xz) / uWindRmax, 0.0, 1.0);
  // Branch tips: slow sway, growing toward the outer canopy; trunk, limbs and roots stay put.
  float bend = smoothstep(0.4, 1.0, h) * smoothstep(0.2, 1.0, r);
  float ph = dot(p.xz, vec2(1.7, 2.3));
  vec3 sway = vec3(sin(t * 0.9 + ph) + 0.35 * sin(t * 2.1 + ph * 1.7), 0.0, 0.6 * cos(t * 0.7 + ph * 1.3)) * bend * 0.010;
  // Leaves: quick, small, each a little out of step with its neighbours.
  float q = dot(p, vec3(9.1, 7.3, 8.7));
  float fl = leaf * smoothstep(0.3, 0.75, h) * smoothstep(0.1, 0.6, r);
  vec3 flutter = vec3(sin(t * 3.7 + q), 0.6 * sin(t * 4.9 + q * 1.3), cos(t * 3.1 + q * 0.7)) * fl * 0.0045;
  return (sway + flutter) * uWindHeight * gust * uWindStrength;
}
\`;
const WIND_PROJECT = \`
vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 p2pW = modelMatrix * mvPosition;
float p2pLeaf = 0.0;
#ifdef P2P_LEAF
  vec3 p2pC = textureLod( uLeafMap, uv, 4.0 ).rgb;
  p2pLeaf = smoothstep( 0.03, 0.15, p2pC.g - max( p2pC.r, p2pC.b ) );
#endif
p2pW.xyz += p2pWind( p2pW.xyz, p2pLeaf );
mvPosition = viewMatrix * p2pW;
gl_Position = projectionMatrix * mvPosition;
\`;
/** Gives a material the wind; leafMap (the body's own colour texture) marks what flutters. */
function addWind(material, leafMap) {
  if (!material || material.userData.p2pWind) return;
  material.userData.p2pWind = true;
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uWindTime: WIND.time, uWindStrength: WIND.strength, uWindBase: WIND.base, uWindHeight: WIND.height, uWindRmax: WIND.rmax });
    if (leafMap) sh.uniforms.uLeafMap = { value: leafMap };
    sh.vertexShader = (leafMap ? "#define P2P_LEAF\\nuniform sampler2D uLeafMap;\\n" : "") + WIND_GLSL + sh.vertexShader.replace("#include <project_vertex>", WIND_PROJECT);
  };
  material.customProgramCacheKey = () => "p2p-wind-" + (leafMap ? "leaf" : "rigid");
  material.needsUpdate = true;
}
/** The trunk axis, measured on the model: of the height bands between the roots and the crown, the one
 *  whose surface is narrowest is the bare trunk; its median x/z is the axis. (Roots that spread one way
 *  would pull an average of the lowest points sideways; a low crown would pull a fixed band.) */
function measureTrunk(root, box) {
  const H = box.max.y - box.min.y, BANDS = 8, from = 0.12, to = 0.6, bands = Array.from({ length: BANDS }, () => ({ xs: [], zs: [] })), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 80000));
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const k = Math.floor(((v.y - box.min.y) / H - from) / ((to - from) / BANDS));
      if (k >= 0 && k < BANDS) { bands[k].xs.push(v.x); bands[k].zs.push(v.z); }
    }
  });
  const q = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
  let best = null;
  for (const b of bands) {
    if (b.xs.length < 30) continue;
    b.xs.sort((p, r) => p - r); b.zs.sort((p, r) => p - r);
    const spread = (q(b.xs, 0.8) - q(b.xs, 0.2)) + (q(b.zs, 0.8) - q(b.zs, 0.2));
    if (!best || spread < best.spread) best = { spread, axis: [q(b.xs, 0.5), q(b.zs, 0.5)] };
  }
  return best ? best.axis : null;
}
function setWindFrame(box, root) {
  const w = CFG.windFrame, c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
  const axis = measureTrunk(root, box) || (w ? [w.trunk[0], w.trunk[2]] : [c.x, c.z]);
  WIND.base.value.set(axis[0], box.min.y, axis[1]);
  WIND.height.value = w ? w.height : s.y || 1;
  WIND.rmax.value = w ? w.rMax : Math.max(s.x, s.z) / 2 || 1;
}

// Geometry is decoded in background workers so a large copy never freezes the view while it arrives.
try { MeshoptDecoder.useWorkers?.(2); } catch (e) { /* main-thread decoding still works */ }
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let current = null, currentLevel = null, height = 1, pending = null, lowFillSince = 0;
const DETAIL_AT = 1.5, STANDARD_AT = 0.9, STANDARD_AFTER_MS = 1500;

function dispose(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { for (const v of Object.values(m)) if (v && v.isTexture) v.dispose(); m.dispose(); }
  });
}

async function fetchModel(url, signal, onProgress) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error("download failed (" + res.status + ")");
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress(got / total); }
  const buf = new Uint8Array(got); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf.buffer;
}

let home = null; // the framed "full tree" view: { target, position }
function frameDistance(s) {
  // Fit the whole model (height and width) in the view; a card frames closer so the tree fills it.
  const vFov = THREE.MathUtils.degToRad(camera.fov / 2), hFov = Math.atan(Math.tan(vFov) * camera.aspect);
  const r = Math.max(s.x, s.z) / 2;
  return Math.max((s.y / 2) / Math.tan(vFov), r / Math.tan(hFov)) + r * 0.6;
}
function show(gltf, level) {
  const root = gltf.scene;
  // The wind lives in the model's own material; its colour texture marks the leaves.
  root.traverse((o) => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) addWind(m, m.map || null); });
  if (!current) {
    // Frame the camera on the first (standard) copy; the detailed copy shares its coordinates.
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    height = s.y || Math.max(s.x, s.z);
    bounds = box.clone();
    setWindFrame(box, root);
    const dist = frameDistance(s) * (CFG.compact ? 1.02 : 1.12);
    controls.target.copy(c); camera.position.set(c.x, c.y + height * 0.08, c.z + dist);
    home = { target: c.clone(), position: camera.position.clone(), dist };
    // No close-up copy: stop zooming at about 1.4× screen height, where the standard copy still holds up.
    controls.minDistance = dist * (CFG.noCloseUp ? 0.6 : 0.12); controls.maxDistance = dist * 2.2;
    camera.near = dist / 200; camera.far = dist * 10; camera.updateProjectionMatrix();
  }
  scene.add(root);
  if (current) { scene.remove(current); dispose(current); }
  current = root; currentLevel = level;
  post({ type: "status", state: level, triangles: renderer.info.render.triangles });
  if (CFG.parts && !partsGroup) loadParts();
}

// ── Modular parts: each part file is downloaded once and drawn as ONE instanced mesh. Sizes are in
// the body's own units (the body is never moved, so part positions share its coordinates).
let partsGroup = null;
async function loadParts() {
  partsGroup = new THREE.Group(); scene.add(partsGroup);
  const UP = new THREE.Vector3(0, 1, 0);
  await Promise.all(Object.entries(CFG.parts.instances).map(async ([asset, list]) => {
    const url = CFG.parts.urls[asset]; if (!url || !list.length) return;
    try {
      const g = await loader.loadAsync(url);
      g.scene.updateMatrixWorld(true);
      let mesh = null; g.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) return;
      // Normalise the part to unit size; hanging parts (fruit) hang from their top centre.
      const box = new THREE.Box3().setFromObject(g.scene), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const k = 1 / Math.max(s.x, s.y, s.z);
      // Fruit and buds sway with the branch they hang from (rigid: no leaf flutter).
      addWind(mesh.material, null);
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), turn = new THREE.Quaternion();
      list.forEach((v, i) => {
        const hang = v[8] === 1;
        const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-c.x, hang ? -box.max.y : -c.y, -c.z)).multiply(mesh.matrixWorld);
        // Upright parts lean a little toward the branch's outward normal; fruit hangs straight down.
        q.setFromUnitVectors(UP, hang ? UP : new THREE.Vector3(v[3], v[4], v[5]).lerp(UP, 0.6).normalize());
        turn.setFromAxisAngle(UP, v[7]); q.multiply(turn);
        m.compose(new THREE.Vector3(v[0], v[1], v[2]), q, new THREE.Vector3(v[6], v[6], v[6])).multiply(norm);
        im.setMatrixAt(i, m);
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.userData = { asset, ids: CFG.parts.ids[asset] || [] };
      partsGroup.add(im);
    } catch (e) { post({ type: "status", state: currentLevel, partFailed: asset }); }
  }));
  post({ type: "status", state: currentLevel, parts: partsGroup.children.length, triangles: renderer.info.render.triangles });
}

// Tap a fruit, bud or tip → the app shows what it stands for (its record).
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!partsGroup || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(partsGroup.children, false)[0];
  if (hit && hit.instanceId != null) post({ type: "select", asset: hit.object.userData.asset, id: hit.object.userData.ids[hit.instanceId] ?? null });
});
window.addEventListener("pagehide", () => {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  if (partsGroup) dispose(partsGroup); if (current) dispose(current);
  envTarget?.dispose(); scene.environment = null;
  window.__p2pStats = { ...window.__p2pStats, afterDispose: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
  renderer.dispose();
});

async function load(level) {
  if (pending) pending.abort();
  const ctl = new AbortController(); pending = ctl;
  post({ type: "status", state: level === "standard" ? "loading" : "detail-loading", progress: 0 });
  try {
    const data = await fetchModel(level === "standard" ? CFG.standardUrl : CFG.detailedUrl, ctl.signal,
      (p) => post({ type: "status", state: level === "standard" ? "loading" : "detail-loading", progress: Math.round(p * 100) }));
    const gltf = await loader.parseAsync(data, "");
    if (ctl.signal.aborted) { dispose(gltf.scene); return; }
    if (current) {
      // Swapping copies: upload textures and compile shaders BEFORE showing it, so the swap is one smooth frame.
      gltf.scene.traverse((o) => { const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []; for (const m of mats) for (const v of Object.values(m)) if (v && v.isTexture) renderer.initTexture(v); });
      try { await renderer.compileAsync(gltf.scene, camera, scene); } catch (e) { /* shown anyway */ }
      while (interacting && !ctl.signal.aborted) await new Promise((r) => setTimeout(r, 100));
      if (ctl.signal.aborted) { dispose(gltf.scene); return; }
    }
    pending = null; show(gltf, level);
  } catch (e) {
    if (ctl.signal.aborted) return;
    pending = null;
    if (level === "standard") post({ type: "status", state: "error", message: navigator.onLine === false ? "You're offline. Connect to the internet to see this model." : "The model couldn't be loaded." });
    else post({ type: "status", state: currentLevel, detailFailed: true });
  }
}

function fill() {
  const d = camera.position.distanceTo(controls.target);
  return height / (2 * d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// Camera moves for Full tree / Roots / Canopy: eased over ~0.8 s (instant with reduced motion).
let flight = null;
function flyTo(target, position) {
  if (CFG.reduceMotion) { controls.target.copy(target); camera.position.copy(position); return; }
  flight = { t0: performance.now(), from: { target: controls.target.clone(), position: camera.position.clone() }, to: { target, position } };
}
window.__p2pView = (mode) => {
  if (!home || !bounds) return;
  controls.autoRotate = false;
  const b = WIND.base.value, H = WIND.height.value, d = home.dist;
  const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
  if (!dir.lengthSq()) dir.set(0, 0, 1);
  if (mode === "roots") {
    // The real model's roots: the lowest part of the body around the trunk, seen from a little above.
    const t = new THREE.Vector3(b.x, b.y + H * 0.14, b.z);
    flyTo(t, t.clone().add(dir.multiplyScalar(d * 0.62)).setY(t.y + H * 0.12));
  } else if (mode === "canopy") {
    // The crown: centred on the model's own upper bounds, seen level.
    const c = bounds.getCenter(new THREE.Vector3()), t = new THREE.Vector3(c.x, b.y + H * 0.76, c.z);
    flyTo(t, t.clone().add(dir.multiplyScalar(d * 0.5)).setY(t.y + H * 0.03));
  } else flyTo(home.target.clone(), home.position.clone());
};
window.__p2pWind = (on) => { windTarget = on && !CFG.reduceMotion ? 1 : 0; };

// Drawing stops while paused (screen hidden, app in the background); one loop only, ever.
let rafId = null, appPaused = false;
function setRunning() {
  const run = !appPaused && !document.hidden;
  if (run && rafId === null) { fpsSince = performance.now(); frames = 0; rafId = requestAnimationFrame(tick); }
  if (!run && rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  window.__p2pStats = { ...window.__p2pStats, running: run };
}
window.__p2pPause = (p) => { appPaused = !!p; setRunning(); };
document.addEventListener("visibilitychange", setRunning);

// Performance readout for tests: frames per second and what is on the GPU.
let frames = 0, fpsSince = performance.now(), ticks = 0;
window.__p2pStats = { fps: 0 };
function tick(now) {
  rafId = requestAnimationFrame(tick);
  frames++; ticks++;
  if (now - fpsSince >= 1000) {
    const i = renderer.info;
    window.__p2pStats = { fps: Math.round((frames * 1000) / (now - fpsSince)), triangles: i.render.triangles, calls: i.render.calls, geometries: i.memory.geometries, textures: i.memory.textures,
      level: currentLevel, fill: current ? Math.round(fill() * 100) / 100 : 0, wind: WIND.strength.value, running: true, ticks };
    frames = 0; fpsSince = now;
  }
  // Wind: eases in and out (never a jump), time keeps flowing.
  WIND.time.value = now / 1000;
  WIND.strength.value += (windTarget - WIND.strength.value) * 0.05;
  if (Math.abs(windTarget - WIND.strength.value) < 0.01) WIND.strength.value = windTarget;
  if (flight) {
    const k = Math.min(1, (now - flight.t0) / 800), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    controls.target.lerpVectors(flight.from.target, flight.to.target, e);
    camera.position.lerpVectors(flight.from.position, flight.to.position, e);
    if (k >= 1) flight = null;
  }
  controls.update();
  if (current) {
    const f = fill();
    if (!CFG.detailedUrl) { /* single copy: nothing to swap */ }
    else if (currentLevel === "standard" && f > DETAIL_AT && !pending) load("detailed");
    else if (pending && currentLevel === "standard" && f < STANDARD_AT) { pending.abort(); pending = null; post({ type: "status", state: "standard" }); }
    else if (currentLevel === "detailed") {
      if (f < STANDARD_AT) { lowFillSince ||= now; if (now - lowFillSince > STANDARD_AFTER_MS && !pending) load("standard"); }
      else lowFillSince = 0;
    }
  }
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
window.__p2pZoom = (factor) => { // buttons in the app: factor < 1 zooms in
  const v = camera.position.clone().sub(controls.target).multiplyScalar(factor);
  const len = THREE.MathUtils.clamp(v.length(), controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(v.setLength(len)); controls.autoRotate = false;
};
window.__p2pReset = () => { if (current) { const r = current; current = null; scene.remove(r); show({ scene: r }, currentLevel); } };
setRunning();
load("standard");
</script>
</body></html>`;
}
