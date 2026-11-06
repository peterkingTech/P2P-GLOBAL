# 3D growth models

The growth journey's stages can be viewed as 3D models (Meshy exports, prepared for phones). This page covers what is shown, how the viewer works, and how to add or replace a model.

## What is shown

Every personal growth milestone has a 3D model, and the **growth milestone** (server-calculated, `hooks/useGrowthStage.ts`) decides which one a person sees, everywhere, so the picture and its label always agree. The old drawn 2D tree is no longer used on any screen.

| Model | Shown as | Files (`models/v1/`) |
|---|---|---|
| Seed | Stage 1 | `P2P-Seed-mobile.glb` (100k triangles, 4.5 MB), `P2P-Seed-high.glb` (200k, 5.1 MB) |
| Sprout | Stage 2. **Front only**: the export is a flat relief | `P2P-Sprout-mobile.glb` (100k, 5.2 MB), `P2P-Sprout-high.glb` (200k, 5.8 MB) |
| Young Tree | Stage 3. **Front only**: the export is a flat relief | `P2P-YoungTree-mobile.glb` (400k, 8.4 MB), `P2P-YoungTree-high.glb` (800k, 10.8 MB) |
| Fruitful Tree | Stage 4 | `P2P-FruitfulTree-mobile.glb` (397k, 12.1 MB), `P2P-FruitfulTree-high.glb` (798k, 16.3 MB) |
| Forest Builder | Stage 5. **No close-up**: detail breaks down up close | `P2P-ForestBuilder-mobile.glb` (791k, 18.4 MB) |
| Blossom, Fruits | Supporting views inside the Fruitful Tree viewer (not stages) | `P2P-Blossom-*.glb`, `P2P-Fruits-*.glb` |

The limitations are applied openly. Turning is limited for Sprout and Young Tree, and zoom for Forest Builder, and the screens say so (`limitNote()` in `lib/growthModels.ts`). Replace those three files with full 3D models when they exist.

**Where each form appears:**

- **Stills** (`models/v1/stills/P2P-<Stage>-still.webp`, transparent background, 36–250 KB) appear in small places: the Home growth card, the Profile "My growth" card, the completion ceremony, the milestones screen and the invite card. They load instantly and use no extra memory. `STAGE_IMAGES[0–4]` in `constants/stages.ts` point at them; Forest of Nations keeps its landscape image (a collective scene, not a model).
- **Live 3D** appears on the Living Tree screen's hero and in the full-screen viewer (`app/tree-3d.tsx`).

## How it works

- **Viewer page.** `lib/treeViewerHtml.ts` is a self-contained three.js page, pinned to one three.js version from jsDelivr, with meshopt decoding. On iOS and Android it runs in `react-native-webview` (`components/growth/TreeModelViewer.native.tsx`); on web it runs in an iframe (`TreeModelViewer.web.tsx`). The screen is `app/tree-3d.tsx?model=<id>`; the registry is `lib/growthModels.ts`.
- **Level of detail.** The standard copy loads first. When the model fills more than 1.5× the screen height, the detailed copy downloads. It replaces the standard copy as soon as it is ready, and the replaced copy is disposed in the same step, so only one copy is ever in memory. Below 0.9× (held for 1.5 s) the standard copy returns. Zooming out mid-download cancels the download. The two copies have their own textures, because the re-baked trees can't share one texture set without visible faceting.
- **Interaction.** Drag to turn, pinch or use the buttons to zoom, two fingers to move (kept on the model). Auto-rotation is off when the device asks for reduced motion, and stops when touched. The screen gives a text description of the model, the download sizes, and an error state with Try again (including an offline message).

## Hosting

Files live in the public Supabase Storage bucket `Forests` under a **versioned** folder (`models/v1/`). A changed model goes into a new folder (`v2/`) and `GROWTH_MODEL_BASE_URL` is bumped, so cached copies are never stale. Upload with a long cache lifetime (`cacheControl: "31536000"`); the WebView's HTTP cache keeps them on the device.

For local review, set `EXPO_PUBLIC_GROWTH_MODEL_BASE_URL` to a local file server.

## Preparing a model

All copies use a 4096 colour texture (2048 bled colour across neighbouring texture areas on Blossom), a 2048 normal map, a 1024 metallic-roughness map, and meshopt geometry compression. Models whose textures are split into very many pieces (Fruitful Tree) were rebuilt in Blender: simplified by position, given a new texture layout, and re-baked from the original. The full validation report, with comparisons from every angle and at close range, sits with the source models (`validation-report/index.html`).

## Not done yet

- **KTX2 textures** (about 29 MB instead of 117 MB of GPU memory per model) need the native `toktx` encoder; the browser encoder can't handle 4096 images.
- **Device checks.** Compatibility on real iPhones and Android phones still needs to be confirmed.
