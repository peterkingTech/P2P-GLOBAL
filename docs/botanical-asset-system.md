# Botanical Asset System

Owner brief, 2026-11-13. Every Meshy model P2P has, in one register (`artifacts/mobile/lib/growthTreeAssets.ts`, `BOTANICAL_REGISTRY`), shown through one renderer (`TreeModelViewer` → `lib/treeViewerHtml.ts`). The audit was made on 2026-11-13 by hashing every file (SHA-256) and reading each GLB's structure; the script and its raw output are in the session scratchpad, and the tables below are generated from them.

## 1. Two separate systems

| | Participant Growth Stage | Botanical development |
|---|---|---|
| What it is | Verified progress under the Growth Milestone Matrix | How the tree looks |
| Values | Seed, Sprout, Young Tree, Fruitful Tree, Forest Builder (+ Forest of Nations, collective) — fixed | Fruit, buds, new growth, new shoot, roots, fruiting branches, foliage, seeds |
| Source | Server (`GET /growth/me`, migrations 235–239) | The tree composition of verified data (`lib/growthTreeComposition.ts`) |
| Changes when | Verified milestone requirements are met | The verified records it reflects change |
| Shown as | "Your Growth Stage: Sprout" | "Botanical development: 6 fruit, 1 bud awaiting verification, …" + "not a rank or a milestone" |
| Code | `hooks/useGrowthStage.ts` (unchanged) | `lib/botanicalDevelopment.ts` (pure, read-only) |

Botanical development never reads or writes the stage, awards nothing, counts toward nothing, and has no timer. There is no new table, API field or migration.

## 2. Audit summary and reconciliation

- **iCloud `Meshy AI/Meshy Models/`:** 72 files = 40 unique (39 GLB + 1 PNG).
  - 32 pairs of byte-identical exports. Every 12 Nov model is saved twice: once under its P2P name and once under Meshy's own name.
- **Unique 12 Nov models:** 32.
  - 25 of the brief's 26 assets. The 26th, the Forest of Nations 3D landscape, arrived on 2026-11-14 as `export_Meshy_AI_2026-11-14_d4ff73.glb` (identified by eye: a globe whose continents are covered in fruit trees).
  - 5 extras: 2 leaf clusters and 3 root sets.
  - **2 previously missed:** *P2P - Half Apple with Seeds* and *P2P - Single Apple on Stall*. "Stall" means the stalk.
- **Older exports (5 Nov):** 7 first-generation models, also copied identically in `Downloads/Meshy Models/`. They are superseded and not used.
- **v1 optimised copies:** 13 files in `Downloads/Meshy Models/mobile-ready/`. They were never hosted (`Forests/models/v1/` is empty) and are no longer referenced by the app.
- **Hosted, `Forests/models/v2/`:** 38 files = **30 live assets** + 3 close-up copies + 5 anchor files. Every hosted file is byte-identical to its local optimised copy.
  - **First upload — 13 assets** (the tree): 5 stage trees, 3 contribution fruit (ripe red, striped red, blushed), 4 buds and tips (balloon bud, green tip, shoot tip, root tip) and 1 fruiting spur.
- **Second upload, 2026-11-13 (owner approval) — the 17 lifecycle models** (12 of the brief's assets + the 5 extras; more than the "twelve" previously stated).
  - Nothing existing was overwritten: the upload refused existing names.
  - Each file was verified byte for byte from its public URL, and the first 21 files were re-checked afterwards: unchanged.
  - The 17:
  - Fruit development: fruitlet, green, yellow-green, golden, young green applelet, petal fall, June drop.
  - Leaves: single leaf, small cluster, dense cluster, autumn leaf.
  - Blossom and buds: blossom cluster, tight pink bud cluster, dormant winter bud.
  - Roots: young, established, deep.
- **No model has animations or more than one mesh.** Every model is a single fused mesh with one PBR material (3 textures), so leaves can't be moved as separate objects. The wind is a vertex shader on the real mesh (see section 5).

## 3. Register: every unique model

Register counts: 33 entries, all with a 3D file (Forest of Nations added 2026-11-14).

| Category | Entries |
|---|---|
| Stage trees | 5 |
| Collective | 1 |
| Contribution fruit | 3 |
| Fruit development | 7 |
| Bud / blossom | 6 |
| Leaf | 4 |
| Root | 4 |
| Structure | 1 |
| Special | 2 |

Integration states:
- **live:** hosted and in use.
- **local_review:** optimised copy on this computer only. It resolves only when `EXPO_PUBLIC_BOTANICAL_LOCAL_BASE_URL` is set, which never happens in a release build.
- **reserved:** validated, and needs the owner's approval before any use.
- **missing:** no 3D file exists.

| Asset (register id) | Category | Original export (iCloud) | Original | Optimised copy (local: Downloads/Meshy Models/modular-v2/) | Optimised | Triangles (original → copy) | Hosted path | Integration | Validation | Intended use | Dependencies |
|---|---|---|---|---|---|---|---|---|---|---|---|
| asset-00-germinating-seed | stage_tree | export_Meshy_AI_2026-11-12_cae8ec.glb<br>P2P - Germinating Seed. _.glb | GLB · 23.6 MB | body-00-germinating-seed.glb | GLB (meshopt, WebP) · 0.98 MB | 272,692 → 80,000 | Forests/models/v2/body-00-germinating-seed.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Seed stage tree (Home, My Tree, stage cards) | anchors (body-00-germinating-seed.anchors.json) |
| asset-02-sprout | stage_tree | P2P - Bare Sprout.glb<br>Photorealistic young apple seedling, delicate green stem, fresh leaves, split brown seed coat, pale fine roots_Meshy_AI_2026-11-12_bc255a.glb | GLB · 43.5 MB | body-02-sprout.glb | GLB (meshopt, WebP) · 1.6 MB | 723,140 → 99,998 | Forests/models/v2/body-02-sprout.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Sprout stage tree | anchors (body-02-sprout.anchors.json) |
| asset-03-young-apple-tree | stage_tree | P2P - Bare Young Tree_.glb<br>Photorealistic young apple tree, slender woody trunk with grey-brown bark, fresh green leaves, exposed fibrous root system_Meshy_AI_2026-11-12_7d529b.glb | GLB · 96.6 MB | body-03-young-tree.glb | GLB (meshopt, WebP) · 2.5 MB | 2,365,568 → 159,992 | Forests/models/v2/body-03-young-tree.glb (+ body-03-young-tree.close.glb) | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Young Tree stage tree | anchors (body-03-young-tree.anchors.json), close-up body-03-young-tree.close.glb |
| asset-04-fruitful-apple-tree | stage_tree | P2P - Bare Fruitful Tree_.glb<br>Photorealistic mature European apple tree with no fruit, textured grey-brown bark, lush green foliage canopy, spreading roots_Meshy_AI_2026-11-12_73a6af.glb | GLB · 339.8 MB | body-04-fruitful-tree.glb | GLB (meshopt, WebP) · 4.7 MB | 7,622,300 → 250,000 | Forests/models/v2/body-04-fruitful-tree.glb (+ body-04-fruitful-tree.close.glb) | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Fruitful Tree stage tree | anchors (body-04-fruitful-tree.anchors.json), close-up body-04-fruitful-tree.close.glb |
| asset-05-forest-builder-apple-tree | stage_tree | Ancient European apple tree, massive gnarled trunk with deep bark furrows, expansive green canopy, thick web of structural foundation roots, no fruit_Meshy_AI_2026-11-12_69c8ce.glb<br>P2P - Bare Forest Builder_.glb | GLB · 361.6 MB | body-05-forest-builder.glb | GLB (meshopt, WebP) · 6.5 MB | 7,674,068 → 250,000 | Forests/models/v2/body-05-forest-builder.glb (+ body-05-forest-builder.close.glb) | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Forest Builder stage tree | anchors (body-05-forest-builder.anchors.json), close-up body-05-forest-builder.close.glb |
| forest-of-nations-3d-landscape | collective | export_Meshy_AI_2026-11-14_d4ff73.glb | GLB · 338.4 MB | collective-forest-of-nations.glb (+ .close.glb) | GLB (meshopt, WebP 2048) · 8.5 MB / 19.1 MB | 7,630,676 → 299,999 / 999,999 | — | local_review | Welded + decimated in Blender, optimised, checked by eye vs original 2026-11-14 | Collective Forest of Nations: Stages card, Global Forest tab, full screen `/tree-3d?forest=1`. Never an individual stage; no wind (slow turn only) | — |
| asset-06-fruiting-spur-socket | structure | export_Meshy_AI_2026-11-12_dbf4a8.glb<br>P2P - Fruiting Spur Twig Socket_.glb | GLB · 60.1 MB | part-06-fruiting-spur.glb | GLB (meshopt, WebP) · 0.15 MB | 1,029,868 → 4,000 | Forests/models/v2/part-06-fruiting-spur.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Branch areas with verified evidence; fruiting spur in the lifecycle | — |
| asset-07-single-leaf-particle | leaf | export_Meshy_AI_2026-11-12_f06c27.glb<br>P2P - Single Leaf Particle Asset_.glb | GLB · 63.1 MB | part-07-single-leaf.glb | GLB (meshopt, WebP) · 0.56 MB | 1,254,864 → 20,000 | Forests/models/v2/part-07-single-leaf.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: one leaf, close up (the stage trees carry their own leaves) | — |
| asset-apple-blossoms | bud_blossom | Delicate European apple blossoms, white and soft pink petals, yellow stamens, pink buds, green leaves, woody twig, PBR textures_Meshy_AI_2026-11-12_ef470a.glb<br>P2P - Blossom Cluster_.glb | GLB · 70.0 MB | part-blossom-cluster.glb | GLB (meshopt, WebP) · 0.21 MB | 1,532,182 → 8,374 | Forests/models/v2/part-blossom-cluster.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: blossom | — |
| asset-apple-stage-1-fruitlet | fruit_development | export_Meshy_AI_2026-11-12_b05261.glb<br>P2P - Tiny Green Fruitlet_.glb | GLB · 34.2 MB | apple-stage-1-fruitlet.glb | GLB (meshopt, WebP) · 0.13 MB | 322,044 → 2,500 | Forests/models/v2/apple-stage-1-fruitlet.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: tiny green fruitlet | — |
| asset-apple-stage-2-green | fruit_development | export_Meshy_AI_2026-11-12_053153.glb<br>P2P - Grown Green Apple._.glb | GLB · 21.0 MB | apple-stage-2-green.glb | GLB (meshopt, WebP) · 0.09 MB | 47,656 → 2,500 | Forests/models/v2/apple-stage-2-green.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: grown green apple | — |
| asset-apple-stage-3-yellow-green | fruit_development | export_Meshy_AI_2026-11-12_ca85c0.glb<br>P2P - Turning Yellow Green_.glb | GLB · 22.2 MB | apple-stage-3-yellow-green.glb | GLB (meshopt, WebP) · 0.08 MB | 119,642 → 2,500 | Forests/models/v2/apple-stage-3-yellow-green.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: turning yellow-green | — |
| asset-apple-stage-4-golden-yellow | fruit_development | export_Meshy_AI_2026-11-12_ec8da3.glb<br>P2P - Golden Yellow Apple_.glb | GLB · 24.6 MB | apple-stage-4-golden-yellow.glb | GLB (meshopt, WebP) · 0.09 MB | 128,888 → 2,500 | Forests/models/v2/apple-stage-4-golden-yellow.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: golden yellow | — |
| asset-apple-stage-5-ripe-red | contribution_fruit | export_Meshy_AI_2026-11-12_7015e3.glb<br>P2P - Vibrant Ripe Red Apple_.glb | GLB · 27.4 MB | apple-stage-5-ripe-red.glb | GLB (meshopt, WebP) · 0.11 MB | 137,456 → 2,500 | Forests/models/v2/apple-stage-5-ripe-red.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Contribution fruit on the tree; ripe apple in the lifecycle | placed on a stage tree's anchors |
| asset-apple-stage-6-striped-red | contribution_fruit | export_Meshy_AI_2026-11-12_10fe98.glb<br>P2P - Red & Gold Stripped Gala_Honeyscrip.glb | GLB · 32.4 MB | apple-stage-6-striped-red.glb | GLB (meshopt, WebP) · 0.12 MB | 213,238 → 2,500 | Forests/models/v2/apple-stage-6-striped-red.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Contribution fruit (variety only — it carries no meaning) | placed on a stage tree's anchors |
| asset-micro-6-dormant-winter-bud | bud_blossom | export_Meshy_AI_2026-11-12_520449.glb<br>P2P - Dormant Winter Bud_.glb | GLB · 44.5 MB | micro-6-dormant-winter-bud.glb | GLB (meshopt, WebP) · 0.46 MB | 463,948 → 3,000 | Forests/models/v2/micro-6-dormant-winter-bud.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: dormant winter bud (a season — never inactivity) | — |
| asset-micro-1-green-tip-bud | bud_blossom | export_Meshy_AI_2026-11-12_d8bbce.glb<br>P2P - Green Tip Bud_.glb | GLB · 45.1 MB | micro-1-green-tip-bud.glb | GLB (meshopt, WebP) · 0.37 MB | 691,676 → 3,806 | Forests/models/v2/micro-1-green-tip-bud.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Recent verified contribution (new growth); green tip in the lifecycle | — |
| asset-micro-2-pink-bud-cluster | bud_blossom | export_Meshy_AI_2026-11-12_99e734.glb<br>P2P - Tight Pink Bud Cluster_.glb | GLB · 54.6 MB | micro-2-pink-bud-cluster.glb | GLB (meshopt, WebP) · 0.44 MB | 904,370 → 5,824 | Forests/models/v2/micro-2-pink-bud-cluster.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: tight pink buds before blossom | — |
| asset-micro-7-balloon-stage-bud | bud_blossom | export_Meshy_AI_2026-11-12_51d627.glb<br>P2P - Tight Pink Bud Cluster (Early Spring)_.glb | GLB · 62.0 MB | micro-7-balloon-stage-bud.glb | GLB (meshopt, WebP) · 0.45 MB | 1,298,958 → 13,574 | Forests/models/v2/micro-7-balloon-stage-bud.glb | live | Validated; matched by eye, owner-confirmed | Contribution awaiting verification (closed bud); balloon bud in the lifecycle | placed on a stage tree's anchors |
| asset-micro-3-unfurling-shoot-tip | bud_blossom | export_Meshy_AI_2026-11-12_014127.glb<br>P2P - Unfurling Shoot Tip_.glb | GLB · 43.6 MB | micro-3-unfurling-shoot-tip.glb | GLB (meshopt, WebP) · 0.37 MB | 566,604 → 3,000 | Forests/models/v2/micro-3-unfurling-shoot-tip.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Recent milestone (new shoot); shoot tip in the lifecycle | — |
| asset-micro-4-petal-fall-fruitlet | fruit_development | export_Meshy_AI_2026-11-12_044eda.glb<br>P2P - Petal Fall & Young Fruitlet_.glb | GLB · 49.1 MB | micro-4-petal-fall-fruitlet.glb | GLB (meshopt, WebP) · 0.15 MB | 778,466 → 4,114 | Forests/models/v2/micro-4-petal-fall-fruitlet.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: petal fall and young fruitlet | — |
| asset-micro-5-active-root-tip | root | export_Meshy_AI_2026-11-12_f7e629.glb<br>P2P - Active White Root Tip._.glb | GLB · 101.8 MB | micro-5-active-root-tip.glb | GLB (meshopt, WebP) · 0.24 MB | 2,749,174 → 11,766 | Forests/models/v2/micro-5-active-root-tip.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Learning under way (active root tip) on the tree; root tip in the lifecycle | — |
| asset-micro-8-june-drop-fruitlet | fruit_development | export_Meshy_AI_2026-11-12_b83c2d.glb<br>P2P - June Drop Fruitlet_.glb | GLB · 36.2 MB | micro-8-june-drop-fruitlet.glb | GLB (meshopt, WebP) · 0.12 MB | 333,836 → 2,998 | Forests/models/v2/micro-8-june-drop-fruitlet.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: June drop (natural thinning — never removed fruit) | — |
| asset-micro-9-golden-autumn-leaf | leaf | export_Meshy_AI_2026-11-12_ffd03f.glb<br>P2P - Petal to  Fruitlet Transition_.glb | GLB · 54.1 MB | micro-9-golden-autumn-leaf.glb | GLB (meshopt, WebP) · 0.49 MB | 918,576 → 20,000 | Forests/models/v2/micro-9-golden-autumn-leaf.glb | live | Validated; matched by eye, owner-confirmed | Apple lifecycle: autumn leaf (a season — never decline) | — |
| asset-04c-young-green-applelet | fruit_development | export_Meshy_AI_2026-11-12_64d87c.glb<br>P2P - Young green Applelet.glb | GLB · 42.3 MB | variant-04c-young-green-applelet.glb | GLB (meshopt, WebP) · 0.13 MB | 447,566 → 2,500 | Forests/models/v2/variant-04c-young-green-applelet.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: young green applelet | — |
| asset-04d-blushed-apple | contribution_fruit | export_Meshy_AI_2026-11-12_e0b332.glb<br>P2P - Half-Ripe Blushed Apple.glb | GLB · 34.6 MB | variant-04d-blushed-apple.glb | GLB (meshopt, WebP) · 0.12 MB | 259,280 → 2,500 | Forests/models/v2/variant-04d-blushed-apple.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Contribution fruit; blushed apple in the lifecycle | placed on a stage tree's anchors |
| extra-leaf-cluster-small | leaf | P2P - Small Leaf Clusters_.glb<br>Photorealistic European apple leaves, delicate serrated edges, visible veins, short woody twig, natural green PBR materials_Meshy_AI_2026-11-12_38bb18.glb | GLB · 51.2 MB | extra-leaf-cluster-small.glb | GLB (meshopt, WebP) · 0.38 MB | 746,362 → 3,000 | Forests/models/v2/extra-leaf-cluster-small.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: leaves on a twig | — |
| extra-leaf-cluster-dense | leaf | P2P - Dense Leaf Cluster_.glb<br>Photorealistic dense cluster of green apple leaves, overlapping foliage, detailed venation, woody forked stem, PBR textures_Meshy_AI_2026-11-12_feedae.glb | GLB · 80.3 MB | extra-leaf-cluster-dense.glb | GLB (meshopt, WebP) · 0.37 MB | 1,886,866 → 6,874 | Forests/models/v2/extra-leaf-cluster-dense.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Apple lifecycle: dense foliage | — |
| extra-roots-young | root | P2P - Young Roots_.glb<br>Photorealistic young apple tree root system, pale cream and light brown fibrous roots, delicate taproot, earthy organic texture_Meshy_AI_2026-11-12_3fe761.glb | GLB · 134.4 MB | extra-roots-young.glb | GLB (meshopt, WebP) · 0.80 MB | 3,622,498 → 39,878 | Forests/models/v2/extra-roots-young.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Root development: young roots (the stage trees carry their own roots) | — |
| extra-roots-established | root | P2P - Established Roots_.glb<br>Photorealistic established apple tree root system, sturdy woody lateral roots with textured brown bark, fibrous secondary rootlets_Meshy_AI_2026-11-12_703b03.glb | GLB · 116.3 MB | extra-roots-established.glb | GLB (meshopt, WebP) · 0.72 MB | 3,077,822 → 39,974 | Forests/models/v2/extra-roots-established.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Root development: established roots | — |
| extra-roots-deep | root | P2P - Deep Roots_.glb<br>Photorealistic deep ancient apple tree root system, gnarled weathered bark texture, massive spreading roots, intricate root web_Meshy_AI_2026-11-12_440cd1.glb | GLB · 257.9 MB | extra-roots-deep.glb | GLB (meshopt, WebP) · 1.1 MB | 7,664,126 → 57,848 | Forests/models/v2/extra-roots-deep.glb | live | Validated (GLB 2.0, 1 mesh, PBR, upright) | Root development: deep roots | — |
| special-half-apple-with-seeds | special | P2P - Half Apple with Seeds_.glb<br>Photorealistic sliced apple half showing pale cream flesh, star-shaped core, glossy dark brown seeds, red skin on exterior, PBR textures_Meshy_AI_2026-11-12_602940.glb | GLB · 28.3 MB | special-half-apple-seeds.glb | GLB (meshopt, WebP) · 0.45 MB | 264,528 → 7,398 | — | reserved | Validated + optimised 2026-11-13 (checked by eye vs original) | Reserved: seed-in-the-fruit teaching close-up (not integrated) | — |
| special-single-apple-on-stalk | special | P2P - Single Apple on Stall_.glb<br>Photorealistic ripe red European apple with subtle yellow streaks, short stem with one green leaf, natural sheen, PBR textures_Meshy_AI_2026-11-12_b11b6c.glb | GLB · 29.7 MB | special-single-apple-stalk.glb | GLB (meshopt, WebP) · 0.41 MB | 141,168 → 5,157 | — | reserved | Validated + optimised 2026-11-13 (checked by eye vs original) | Reserved: single-fruit close-up (not integrated) | — |

### Older exports (5 Nov, superseded)

| Export (iCloud) | Size | Triangles | Also in Downloads | Status |
|---|---|---|---|---|
| P2P - Blossom - 3D_.glb | 96.7 MB | 2,364,494 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Forest Builder - 3D_.glb | 371.3 MB | 7,612,748 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Fruitful Tree - 3D_.glb | 339.9 MB | 7,613,792 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Fruits - 3D_.glb | 29.4 MB | 200,040 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Seed - 3D_.glb | 38.0 MB | 473,528 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Sprout - 3D_.glb | 40.0 MB | 469,450 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |
| P2P - Young Tree - 3D_.glb | 177.0 MB | 4,944,560 | yes (identical) | 5 Nov 2026 first-generation export — superseded by the 12 Nov models; not used, never hosted |

### Images

- `icloud/P2P - Forest of nations - Image_.PNG` — 3.4 MB, 2D image (the only Forest of Nations file; not a 3D environment)
- `downloads_nov5/P2P - Forest of nations - Image_.PNG` — 3.4 MB, 2D image (the only Forest of Nations file; not a 3D environment)

### v1 optimised copies (never hosted, not referenced)

| File | Size | Triangles | Hosted |
|---|---|---|---|
| P2P-Blossom-high.glb | 6.2 MB | 199,956 | no (Forests/models/v1/ is empty) |
| P2P-Blossom-mobile.glb | 5.6 MB | 99,950 | no (Forests/models/v1/ is empty) |
| P2P-ForestBuilder-mobile.glb | 18.4 MB | 791,334 | no (Forests/models/v1/ is empty) |
| P2P-FruitfulTree-high.glb | 16.2 MB | 798,473 | no (Forests/models/v1/ is empty) |
| P2P-FruitfulTree-mobile.glb | 12.1 MB | 397,358 | no (Forests/models/v1/ is empty) |
| P2P-Fruits-high.glb | 4.5 MB | 99,998 | no (Forests/models/v1/ is empty) |
| P2P-Fruits-mobile.glb | 4.3 MB | 50,010 | no (Forests/models/v1/ is empty) |
| P2P-Seed-high.glb | 5.1 MB | 200,016 | no (Forests/models/v1/ is empty) |
| P2P-Seed-mobile.glb | 4.5 MB | 100,006 | no (Forests/models/v1/ is empty) |
| P2P-Sprout-high.glb | 5.8 MB | 199,982 | no (Forests/models/v1/ is empty) |
| P2P-Sprout-mobile.glb | 5.2 MB | 99,990 | no (Forests/models/v1/ is empty) |
| P2P-YoungTree-high.glb | 10.8 MB | 800,028 | no (Forests/models/v1/ is empty) |
| P2P-YoungTree-mobile.glb | 8.4 MB | 400,000 | no (Forests/models/v1/ is empty) |

### Duplicates

32 pairs of byte-identical files (same SHA-256): every 12 Nov export exists twice — the P2P-named copy and Meshy's own file name. Each pair is ONE asset.

## 4. The two missed apples

Both were validated and optimised on 2026-11-13, then compared by eye with the original from the front, side and back. The originals are untouched.

| | Half Apple with Seeds | Single Apple on Stall (stalk) |
|---|---|---|
| Original | 264,528 triangles, 28.3 MB, textures 4096/2048/4096 JPEG | 141,168 triangles, 29.7 MB, same textures |
| Optimised copy | `special-half-apple-seeds.glb` — 7,398 triangles, 0.45 MB, WebP 1024 | `special-single-apple-stalk.glb` — 5,157 triangles, 0.41 MB, WebP 1024 |
| Structure | 1 mesh, 1 PBR material, upright | Same |
| Shows | Two halves: cream flesh, star-shaped core, dark seeds | Ripe red apple with yellow streaks; stalk and one leaf |
| Status | **reserved** — not integrated, not hosted | Same |
| Possible future use | Seed-in-the-fruit teaching ("a seed inside every fruit"), e.g. a lesson about multiplication | Close-up of one fruit, e.g. when a person taps one of their contribution fruits |

## 5. Rendering (one system)

- **`TreeModelViewer`** (`lib/treeViewerHtml.ts`): three.js 0.170 in a WebView (iOS/Android) or iframe (web). It handles:
  - meshopt decoding in workers;
  - a close-up copy only when zoomed in;
  - one copy in memory, everything disposed on leaving (the lighting environment included);
  - pausing when hidden or backgrounded;
  - reduced motion;
  - the Full tree / Roots / Canopy camera views;
  - wind.
- **`LivingTreeView`:** a person's tree (stage tree plus contribution fruit, buds and tips placed on measured anchors). Used by Home, My Tree, Profile, Stages, full screen and the celebrations.
- **`BotanicalModelView`:** any one registered asset, with loading / Try again / not-available states and no picture fallback. Used by "How My Tree Grows"; ready for other features.
- **`hooks/useGrowthTree`:** one shared copy of `GET /growth/me/tree`, so Home, My Tree and the 3D tree always describe the same tree.
- **Wind:**
  - Stage trees: a vertex-shader displacement, weighted by the model's own leaf-green texture, height and distance from the measured trunk axis. The trunk, main limbs and roots stay still.
  - Leaf and blossom assets: the same shader, measured from the model.
  - Fruit, roots, spur, buds: no wind.
  - Nothing is rotated or scaled as a whole.

## 6. Botanical development within the fixed stages

Each stage model already carries its own leaves and roots. The extra leaf and root models are therefore **never** added to a person's tree, so there are no doubled leaves and no overlapping roots.

**What a person's tree shows** (all from verified data, through the existing composition rules):

| Feature | Comes from | Model |
|---|---|---|
| Fruit | One per verified contribution. A group session is one fruit; rejected or withdrawn give none. | Ripe red / striped / blushed (variety carries no meaning) |
| Bud awaiting verification | A contribution under review — not fruit | Balloon bud |
| New growth | A contribution verified in the last 14 days | Green tip bud |
| A new shoot | A milestone reached in the last 14 days | Unfurling shoot tip |
| Roots growing | Learning units passed | Active root tip |
| Fruiting branches | P2P areas with verified evidence | Fruiting spur |
| Foliage | Active weeks. It never thins with rest. | Part of the stage model |

**Stage appearance:** the stage model's own look, for example "A young tree: slender trunk, open branches and fresh leaves".

**Not applied to anyone's tree:** blossom, fruitlets, ripening colours and seasons. These are explained in "How My Tree Grows" (`app/botanical/index.tsx`, `lib/botanicalLifecycle.ts`, `lib/howMyTreeGrows.ts`), each step tied to the person's own verified progress: 26 lifecycle items in five sections (seed and roots, buds and shoots, leaves, blossom, fruitlet to ripe). They are labelled as the apple tree's natural year, not growth stages. All 26 are hosted, so a release build offers every one.

### Proposed ripening rule (not implemented — needs a decision)

The fruit data today has: `status` (verified / pending_review / rejected / withdrawn), `date`, `kind`, `area` and `peopleHelped`. There is no field that would justify a ripening state other than time. Options:

1. **Keep as now (recommended until decided):** pending is a closed bud; verified is a ripe apple.
2. **Appearance by age** (e.g. fruitlet → green → golden → ripe over N weeks after verification). This is a timer: everyone's fruit ripens on the same schedule regardless of anything they do. It is simple, but it is decoration, and new contributions would look "less finished".
3. **Appearance by the verification step**, if the ledger ever records intermediate review steps (e.g. peer-verified → independently confirmed). That would need a schema change and isn't proposed now.

In every option a fruit stays one contribution, and its colour never counts for anything.

## 7. App-wide placement map

| Feature / screen | Asset(s) | Purpose | Interactive? | Performance | Status |
|---|---|---|---|---|---|
| Home — growth card | The person's stage tree + their fruit and buds | Their living tree; "Your Growth Stage" and the botanical line shown apart | Card (tap opens My Tree) | One model; paused when off-screen | **Implemented** (hosted) |
| My Tree (Living Tree) | Same tree | Explore: rotate, zoom, Full tree / Roots / Canopy, wind switch, tap a fruit for its record; botanical development card | Yes | One model, plus a close-up copy only when zoomed | **Implemented** (hosted) |
| My Profile — growth card | Same tree | Profile summary | Card | One model | **Implemented** (hosted) |
| Stages / full screen / celebrations | Each stage tree | See any stage in 3D on request | Yes / card | One model at a time | **Implemented** (hosted) |
| Growth Story | — (text) | Stage changes, contribution fruit and botanical events labelled apart; "See this stage in 3D" | Link | None until opened | **Implemented** |
| How My Tree Grows | 26 lifecycle models | Each step explained as part of the person's own journey, with their verified progress; never extra stages | Yes | One model at a time | **Implemented** — all 26 hosted |
| Learning / Kingdom School | — | — | — | — | **Not needed** (owner decision 2026-11-13) |
| Kingdom Stories | — | — | — | — | **Not needed** (owner decision 2026-11-13) |
| Bible / Deep Study | — | — | — | — | **Not needed** (owner decision 2026-11-13) |
| Study Together / Family / Church | Lifecycle models | Shared teaching moment (leader shows one model) | On request | One model | **Reserved** — no second growth or contribution system |
| Forest of Nations (Global Forest) | collective-forest-of-nations | Collective environment | On open | One model (+ close-up on zoom, full screen only) | **Integrated, local review**: not hosted yet, so release builds show "This 3D model isn't available yet" (never the PNG) |

## 8. Decisions

**Done (owner approval, 2026-11-13):**
- The 17 lifecycle models were uploaded to `Forests/models/v2/`: 17 files, 6.4 MB, nothing overwritten, each verified byte for byte.
- 3D models in lessons, stories and Bible passages: **not needed**.

**Still open:**
1. **Special apples:** whether and where to use them. If approved, upload them too: 2 files, 0.86 MB.
2. **Ripening rule:** keep option 1, or choose another (section 6).
3. **Forest of Nations upload (needs approval):** `Forests/models/v2/collective-forest-of-nations.glb` (8,530,708 bytes) and `Forests/models/v2/collective-forest-of-nations.close.glb` (19,144,136 bytes). New paths, nothing overwritten. After upload, set its integration to `live` in `lib/growthTreeAssets.ts`.
4. **Half Apple with Seeds:** excluded by the owner (2026-11-14). **Single Apple on Stalk:** held back.

No database change, migration or configuration change was needed. The only production change is the upload of the 17 models.
