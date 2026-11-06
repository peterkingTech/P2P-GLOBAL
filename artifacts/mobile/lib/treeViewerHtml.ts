// Self-contained three.js page for the growth-model viewer, loaded into a WebView (iOS/Android)
// or an iframe (web). Level of detail: the standard copy loads first; the detailed copy is
// downloaded only when the model fills more than 1.5× the screen height, swapped in the moment it
// is ready (the standard copy is freed in the same frame), and swapped back after zooming out.
// Only one copy of a model is ever kept. Messages to the app: { type: "status", state, ... }.
// Known limitations are applied openly (the screen states them): frontOnly limits turning to the
// front of a flat relief; noCloseUp (no detailed copy) stops zooming before detail breaks down.

export interface TreeViewerConfig {
  standardUrl: string;
  /** Null when the model has no detailed copy. */
  detailedUrl: string | null;
  background: string;
  reduceMotion: boolean;
  frontOnly?: boolean;
  noCloseUp?: boolean;
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
html,body{margin:0;height:100%;overflow:hidden;background:${cfg.background};touch-action:none;-webkit-user-select:none;user-select:none}
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
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(3, 5, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.01, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.enablePan = true; controls.screenSpacePanning = true;
// Two-finger pan lets people bring any part close (apples, roots), but never off the model.
let bounds = null;
controls.addEventListener("change", () => { if (bounds) bounds.clampPoint(controls.target, controls.target); });
// A flat relief only turns ±30° and stays near eye level; it doesn't auto-turn into its edges.
controls.autoRotate = !CFG.reduceMotion && !CFG.frontOnly; controls.autoRotateSpeed = 0.6;
if (CFG.frontOnly) {
  controls.minAzimuthAngle = -Math.PI / 6; controls.maxAzimuthAngle = Math.PI / 6;
  controls.minPolarAngle = Math.PI / 2 - 0.35; controls.maxPolarAngle = Math.PI / 2 + 0.2;
}
controls.addEventListener("start", () => { controls.autoRotate = false; });

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

function show(gltf, level) {
  const root = gltf.scene;
  if (!current) {
    // Frame the camera on the first (standard) copy; the detailed copy shares its coordinates.
    const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    height = s.y || Math.max(s.x, s.z);
    bounds = box.clone();
    const dist = (Math.max(s.x, s.y, s.z) / 2) / Math.tan(THREE.MathUtils.degToRad(15)) * 1.15;
    controls.target.copy(c); camera.position.set(c.x, c.y + height * 0.08, c.z + dist);
    // No close-up copy: stop zooming at about 1.4× screen height, where the standard copy still holds up.
    controls.minDistance = dist * (CFG.noCloseUp ? 0.6 : 0.12); controls.maxDistance = dist * 2.2;
    camera.near = dist / 200; camera.far = dist * 10; camera.updateProjectionMatrix();
  }
  scene.add(root);
  if (current) { scene.remove(current); dispose(current); }
  current = root; currentLevel = level;
  post({ type: "status", state: level, triangles: renderer.info.render.triangles });
}

async function load(level) {
  if (pending) pending.abort();
  const ctl = new AbortController(); pending = ctl;
  post({ type: "status", state: level === "standard" ? "loading" : "detail-loading", progress: 0 });
  try {
    const data = await fetchModel(level === "standard" ? CFG.standardUrl : CFG.detailedUrl, ctl.signal,
      (p) => post({ type: "status", state: level === "standard" ? "loading" : "detail-loading", progress: Math.round(p * 100) }));
    const gltf = await loader.parseAsync(data, "");
    if (ctl.signal.aborted) { dispose(gltf.scene); return; }
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

function tick(now) {
  requestAnimationFrame(tick);
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
requestAnimationFrame(tick);
load("standard");
</script>
</body></html>`;
}
