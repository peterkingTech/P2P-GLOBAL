// The 26 botanical assets for the modular Growth Tree (owner brief 2026-11-12) — a VERSIONED MANIFEST.
// An asset counts as integrated only after its file has been located, validated (format, size, textures,
// orientation, scale, polygon count, rendering from every side) and given a hosted URL. Until then its
// status says so. The v1 models (Forests/models/v1/) were never hosted and are no longer referenced;
// every Growth Tree view uses these v2 copies (components/growth/LivingTreeView).
//
// 2026-11-13: the owner's exports were found in iCloudDrive\Meshy AI\Meshy Models (25 of 26). Each was
// validated (GLB 2.0, one fused mesh, one PBR material, 3 JPEG textures, upright, ~1.9 units tall,
// rendered front/side/back: all volumetric) and an OPTIMISED COPY made (originals untouched; sha256
// below is of the original). The copies the tree uses are hosted in Forests/models/v2/ (see below).
// Notes found during validation (both confirmed by the owner 2026-11-13):
//   • "P2P - Petal to  Fruitlet Transition_.glb" actually shows a golden autumn leaf → used as micro-9;
//   • the balloon-stage bud has no file of that name; "Tight Pink Bud Cluster (Early Spring)" shows plump,
//     pale balloon-stage buds → used as micro-7 (identified by eye);
//   • the "Bare" bodies are bare of FRUIT only — they carry their own leaves and roots;
//   • Forest of Nations exists only as a 2D image (PNG): no 3D landscape, so it stays not_located.
//   • Meshy splits its meshes at every texture seam; the two largest trees are WELDED before decimation
//     (Blender: merge by distance, then collapse) — without that, heavy reduction tears the bark.
// 2026-11-13 (owner approval): the 13 release-"v2" files + anchors + close-ups were uploaded to
// Forests/models/v2/ and verified from their public URLs → status "integrated". Later the same day (owner
// approval) the 17 lifecycle models followed (LIFECYCLE_UPLOAD below): 30 hosted in all. Only the two
// special apples stay local ("validated", reserved), and Forest of Nations has no 3D file.
// Owner decisions 2026-11-13: both by-eye matches CONFIRMED (the model, not its filename, decides; the
// original filenames stay recorded); first upload = only the assets the tree uses now (release "v2");
// leaves and buds re-made at 1024 px (leaves at 20k triangles so the veins survive); close-up copies
// for the three large trees. Apple ripening stages may be used later as APPEARANCE ONLY — never a rank,
// and never changing what a fruit's contribution is or counts for.

export type AssetStatus = "not_located" | "located" | "validated" | "needs_rebuild" | "integrated";
export type AttachmentType = "body" | "landscape" | "socket" | "leaf" | "blossom" | "fruit" | "micro";
export interface AssetFile {
  /** Optimised copy (served from the v2 base). */
  name: string;
  /** The owner's original export (read only). */
  source: string;
  version: string;
  bytes: number;
  sourceBytes: number;
  /** sha256 of the ORIGINAL export, so the copy can always be traced to it. */
  sha256: string;
  triangles: number;
  sourceTriangles: number;
  lods: ("standard" | "close")[];
  views: ("full" | "front_only")[];
  /** Close-up copy of a large tree, downloaded only when zoomed in (the standard copy stays the default). */
  close?: { name: string; bytes: number; triangles: number };
}
export interface TreeAsset {
  id: string; group: "body" | "modular" | "apple" | "micro" | "variant" | "extra";
  attachment: AttachmentType;
  /** What it depicts (from the brief). */
  depicts: string;
  status: AssetStatus;
  file?: AssetFile;
  /** How the file was matched to this asset: by its name, or by looking at it (owner to confirm). */
  identifiedBy?: "filename" | "visual";
  /** A by-eye match the owner has confirmed (date). */
  confirmedByOwner?: string;
  /** In the first hosted upload (Forests/models/v2/). Owner 2026-11-13: only assets the current tree uses;
   *  the rest stay in the validated local library until a visual need is identified. */
  release?: "v2";
  /** Bodies that already carry their own leaves (no leaf clusters added on top). */
  hasFoliage?: boolean;
  /** Presentation only — never driven by a participant's activity (lib/growthTreeComposition.ts SEASONAL_ONLY). */
  seasonalOnly?: boolean;
}

const V = "v2-2026-11-13";
const f = (name: string, source: string, sha256: string, sourceBytes: number, sourceTriangles: number, triangles: number, bytes: number): AssetFile =>
  ({ name, source, version: V, bytes, sourceBytes, sha256, triangles, sourceTriangles, lods: ["standard"], views: ["full"] });
/** A large tree with a close-up copy (made from the same original; same coordinates as the standard copy). */
const withClose = (file: AssetFile, close: { name: string; bytes: number; triangles: number }): AssetFile => ({ ...file, lods: ["standard", "close"], close });
/** Second upload (owner approval 2026-11-13): the 17 lifecycle models — fruit development, leaves, blossom
 *  and buds, root sets — uploaded to Forests/models/v2/ (nothing existing overwritten) and verified byte for
 *  byte from their public URLs. Used by "How My Tree Grows" (lib/botanicalLifecycle.ts) only: they are
 *  never put on a person's tree (the composition doesn't use them; the stage trees carry their own leaves and roots). */
const LIFECYCLE_UPLOAD = new Set([
  "asset-apple-stage-1-fruitlet", "asset-apple-stage-2-green", "asset-apple-stage-3-yellow-green", "asset-apple-stage-4-golden-yellow", "asset-04c-young-green-applelet",
  "asset-micro-4-petal-fall-fruitlet", "asset-micro-8-june-drop-fruitlet", "asset-07-single-leaf-particle", "extra-leaf-cluster-small", "extra-leaf-cluster-dense",
  "asset-micro-9-golden-autumn-leaf", "asset-apple-blossoms", "asset-micro-2-pink-bud-cluster", "asset-micro-6-dormant-winter-bud", "extra-roots-young", "extra-roots-established", "extra-roots-deep",
]);
const a = (id: string, group: TreeAsset["group"], attachment: AttachmentType, depicts: string, file?: AssetFile, extra: Partial<TreeAsset> = {}): TreeAsset => {
  const release = extra.release ?? (file && LIFECYCLE_UPLOAD.has(id) ? "v2" as const : undefined);
  return { id, group, attachment, depicts, status: file ? (release === "v2" ? "integrated" : "validated") : "not_located", ...(file ? { file, identifiedBy: "filename" as const } : {}), ...extra, ...(release ? { release } : {}) };
};

export const TREE_ASSET_MANIFEST_VERSION = 4;
export const TREE_ASSETS: TreeAsset[] = [
  a("asset-00-germinating-seed", "body", "body", "Seed: split seed coat with emerging root (stage Seed)",
    f("body-00-germinating-seed.glb", "P2P - Germinating Seed. _.glb", "12fcfd58b0cd761a097d176ffe7ea755b81fba1595b27bc76b131fb62b39cf87", 23560472, 272692, 80000, 984016), { release: "v2" }),
  a("asset-02-sprout", "body", "body", "Sprout: volumetric seedling with first leaves and root fan (stage Sprout)",
    f("body-02-sprout.glb", "P2P - Bare Sprout.glb", "5b478c2efa3aa7bfec96f466be1e24976579ef74ec361edf2cb3b0dd24b39f18", 43505264, 723140, 99998, 1552220), { hasFoliage: true, release: "v2" }),
  a("asset-03-young-apple-tree", "body", "body", "Young apple tree with open canopy and roots (stage Young Tree)",
    withClose(f("body-03-young-tree.glb", "P2P - Bare Young Tree_.glb", "8e7571d4139a1a9bbbbbc4466bee1bbce11cca606cb9b9cd4d241993a02e2bc0", 96588420, 2365568, 159992, 2508244),
      { name: "body-03-young-tree.close.glb", bytes: 9426696, triangles: 900000 }), { hasFoliage: true, release: "v2" }),
  a("asset-04-fruitful-apple-tree", "body", "body", "Mature fruiting apple tree (stage Fruitful Tree)",
    withClose(f("body-04-fruitful-tree.glb", "P2P - Bare Fruitful Tree_.glb", "a5297437bfc566e8329102900f3be2e0a128402d550ebda97992095819e2efb2", 339782932, 7622300, 250000, 4744872),
      { name: "body-04-fruitful-tree.close.glb", bytes: 15158532, triangles: 1000000 }), { hasFoliage: true, release: "v2" }),
  a("asset-05-forest-builder-apple-tree", "body", "body", "Veteran apple tree with broad foundation roots (stage Forest Builder)",
    withClose(f("body-05-forest-builder.glb", "P2P - Bare Forest Builder_.glb", "546b6c93bcd98d8785049e27a2bb3f00fff78089362e44acbd52cc13ec486b31", 361645604, 7674068, 250000, 6497032),
      { name: "body-05-forest-builder.close.glb", bytes: 20302128, triangles: 1000000 }), { hasFoliage: true, release: "v2" }),
  // Forest of Nations (owner's Meshy export 2026-11-14, Meshy-named only — identified by eye: a globe whose
  // continents are covered in small fruit trees). Collective, never an individual stage. Welded + decimated
  // in Blender (like the large trees) to a 300k standard copy and a close-up copy; not hosted yet.
  a("forest-of-nations-3d-landscape", "body", "landscape", "Forest of Nations: a globe whose continents are covered in fruit trees — the collective forest, never an individual stage",
    withClose(f("collective-forest-of-nations.glb", "export_Meshy_AI_2026-11-14_d4ff73.glb", "f9f584a9b4154d5ef426b15400808ce9b4f6eba9c1661451c59b7a4e0d0f9fb9", 338438596, 7630676, 299999, 8530708),
      { name: "collective-forest-of-nations.close.glb", bytes: 19144136, triangles: 999999 }), { identifiedBy: "visual" }),
  a("asset-06-fruiting-spur-socket", "modular", "socket", "Woody fruiting spur: attachment point for blossoms and fruit",
    f("part-06-fruiting-spur.glb", "P2P - Fruiting Spur Twig Socket_.glb", "e6e9a0bf7f99ed35213dfad8739d091646e52798dcab3549e4942eebddc53816", 60091692, 1029868, 4000, 149616), { release: "v2" }),
  a("asset-07-single-leaf-particle", "modular", "leaf", "Single curved apple leaf for the canopy",
    f("part-07-single-leaf.glb", "P2P - Single Leaf Particle Asset_.glb", "417ca34a89b16aa570fb2c2b19488707fc5bc0f01ad432d545c0ba0bef5a617e", 63094048, 1254864, 20000, 559328)),
  a("asset-apple-blossoms", "modular", "blossom", "Apple blossom cluster",
    f("part-blossom-cluster.glb", "P2P - Blossom Cluster_.glb", "3124924704f01c0b81c96b435518b3e6c4927c3ae58557cc2668ab12f086d0e2", 70014432, 1532182, 8374, 211212)),
  a("asset-apple-stage-1-fruitlet", "apple", "fruit", "Apple development: fruitlet",
    f("apple-stage-1-fruitlet.glb", "P2P - Tiny Green Fruitlet_.glb", "3b5741be2a8507bddc30d9fa522f7e04791e3e67d9a1e4f6e181a975d6ed9924", 34163032, 322044, 2500, 133208)),
  a("asset-apple-stage-2-green", "apple", "fruit", "Apple development: green",
    f("apple-stage-2-green.glb", "P2P - Grown Green Apple._.glb", "4046094c69865abfcbf3553931f6c946ee20b678775a955c2f187d304781ee21", 20968716, 47656, 2500, 88584)),
  a("asset-apple-stage-3-yellow-green", "apple", "fruit", "Apple development: yellow-green",
    f("apple-stage-3-yellow-green.glb", "P2P - Turning Yellow Green_.glb", "1d9dc74c3198d4d6a46d4864450f7a455245c2a016349754ab5d053e5df5c809", 22207712, 119642, 2500, 82488)),
  a("asset-apple-stage-4-golden-yellow", "apple", "fruit", "Apple development: golden yellow",
    f("apple-stage-4-golden-yellow.glb", "P2P - Golden Yellow Apple_.glb", "3c9681310efbafb6c0934acc767b4573dbcd4919568da25c4fb1070e04689bb7", 24641416, 128888, 2500, 86240)),
  a("asset-apple-stage-5-ripe-red", "apple", "fruit", "Apple development: ripe red",
    f("apple-stage-5-ripe-red.glb", "P2P - Vibrant Ripe Red Apple_.glb", "93d87bb077e1eb6f600e78392db77201be0e8405ef02a5e846e813944459e73f", 27394012, 137456, 2500, 110676), { release: "v2" }),
  a("asset-apple-stage-6-striped-red", "apple", "fruit", "Apple development: striped red",
    f("apple-stage-6-striped-red.glb", "P2P - Red & Gold Stripped Gala_Honeyscrip.glb", "965f30368e0eec9ec2403469423bc51a33c7ed8b8bd7a66c29d74af90f1a25a7", 32372692, 213238, 2500, 116288), { release: "v2" }),
  a("asset-micro-6-dormant-winter-bud", "micro", "micro", "Dormant winter bud (seasonal only)",
    f("micro-6-dormant-winter-bud.glb", "P2P - Dormant Winter Bud_.glb", "01d4289f9d4628712dca7ff1450bad105d8ff022bb847714aecf24207e908e43", 44516028, 463948, 3000, 463596), { seasonalOnly: true }),
  a("asset-micro-1-green-tip-bud", "micro", "micro", "Green tip bud: new growth",
    f("micro-1-green-tip-bud.glb", "P2P - Green Tip Bud_.glb", "2481acf993c459a77520d8efc70637fc69e319eaabc5d4e7f9db1b9074b51956", 45075948, 691676, 3806, 374388), { release: "v2" }),
  a("asset-micro-2-pink-bud-cluster", "micro", "micro", "Pink bud cluster: blossom forming",
    f("micro-2-pink-bud-cluster.glb", "P2P - Tight Pink Bud Cluster_.glb", "92a443f8fb3f9b88f89dbfd34488dd386de9698905c4d8ab4914cd57824c7bbe", 54589280, 904370, 5824, 442180)),
  a("asset-micro-7-balloon-stage-bud", "micro", "micro", "Balloon-stage bud: about to open",
    f("micro-7-balloon-stage-bud.glb", "P2P - Tight Pink Bud Cluster (Early Spring)_.glb", "b417138ae69e7df37a0d293e376f3e63bb8f8e3581c0702e65a6da83f65d80ca", 62025852, 1298958, 13574, 449656), { identifiedBy: "visual", confirmedByOwner: "2026-11-13", release: "v2" }),
  a("asset-micro-3-unfurling-shoot-tip", "micro", "micro", "Unfurling shoot tip: active growth",
    f("micro-3-unfurling-shoot-tip.glb", "P2P - Unfurling Shoot Tip_.glb", "f240d347a07ca451eb74fc01f6c4edce105f0c30b4bccf3be4a26516a5b1df5e", 43562132, 566604, 3000, 368720), { release: "v2" }),
  a("asset-micro-4-petal-fall-fruitlet", "micro", "micro", "Petal fall to fruitlet",
    f("micro-4-petal-fall-fruitlet.glb", "P2P - Petal Fall & Young Fruitlet_.glb", "b6397ca2d32ed62e439bb6da48549513d087f2cb109bbdc491ab836044b799ba", 49057964, 778466, 4114, 149652)),
  a("asset-micro-5-active-root-tip", "micro", "micro", "Active root tip: foundational growth",
    f("micro-5-active-root-tip.glb", "P2P - Active White Root Tip._.glb", "eeddce53b6ddfb9080e7cd1a13fefbf5b2a1b9c592f320a40dceb192d5ed6e54", 101782236, 2749174, 11766, 241992), { release: "v2" }),
  a("asset-micro-8-june-drop-fruitlet", "micro", "micro", "June-drop fruitlet (botanical demonstration only)",
    f("micro-8-june-drop-fruitlet.glb", "P2P - June Drop Fruitlet_.glb", "ab2a873caaffdadfe31b4198df5c8c335a2768c0ec666f8a1e8933b7eedbe6ac", 36190416, 333836, 2998, 124928), { seasonalOnly: true }),
  a("asset-micro-9-golden-autumn-leaf", "micro", "micro", "Golden autumn leaf (seasonal only)",
    f("micro-9-golden-autumn-leaf.glb", "P2P - Petal to  Fruitlet Transition_.glb", "ac0b1cd4ff2d8e0138d47feb2d963cf4bfd0eb254baa0fa01d8f12191f5f6fbd", 54119508, 918576, 20000, 488284), { seasonalOnly: true, identifiedBy: "visual", confirmedByOwner: "2026-11-13" }),
  a("asset-04c-young-green-applelet", "variant", "fruit", "Intermediate: young green applelet",
    f("variant-04c-young-green-applelet.glb", "P2P - Young green Applelet.glb", "5c8245ddcf96149873b076343294723f8d4a297bf3ed0ccb0e8e45cd516fdedf", 42296788, 447566, 2500, 132204)),
  a("asset-04d-blushed-apple", "variant", "fruit", "Intermediate: blushed apple",
    f("variant-04d-blushed-apple.glb", "P2P - Half-Ripe Blushed Apple.glb", "c885ad50bfb7708d6b5de39c890479391bfe514de23b63fff05907d675b276ac", 34583664, 259280, 2500, 117516), { release: "v2" }),
];

/** Further exports found beside the 26 (not in the brief). Prepared, kept for later use; the current
 *  bodies already have their own roots, so the root sets are not placed. */
export const EXTRA_ASSETS: TreeAsset[] = [
  a("extra-leaf-cluster-small", "extra", "leaf", "Small apple-leaf cluster",
    f("extra-leaf-cluster-small.glb", "P2P - Small Leaf Clusters_.glb", "9f5de95031452622c3c2841ce963e77a0b468b09bd06d5eeed3eb0f92b725256", 51183520, 746362, 3000, 383308)),
  a("extra-leaf-cluster-dense", "extra", "leaf", "Dense apple-leaf cluster",
    f("extra-leaf-cluster-dense.glb", "P2P - Dense Leaf Cluster_.glb", "83dcef26b927954841b641ed81e030cdbb51c1095b6f153e4b7ce015ebcdecfe", 80275400, 1886866, 6874, 369156)),
  a("extra-roots-young", "extra", "body", "Young roots",
    f("extra-roots-young.glb", "P2P - Young Roots_.glb", "678243a05eaf519b46b0600b3ec42019cc62bbd38c0dd904f26deb85f3b2bc18", 134424292, 3622498, 39878, 798992)),
  a("extra-roots-established", "extra", "body", "Established roots",
    f("extra-roots-established.glb", "P2P - Established Roots_.glb", "fd72b5b02e48847314bba3ac2475a077201536a41a222f3cf2b03a5861a23223", 116335420, 3077822, 39974, 715036)),
  a("extra-roots-deep", "extra", "body", "Deep roots",
    f("extra-roots-deep.glb", "P2P - Deep Roots_.glb", "813757c15e69db27e19469dd19895b7c2a8a82de39a7822f7943115df3e0e965", 257912740, 7664126, 57848, 1145900)),
];

/** Two exports found after the first register (2026-11-13 audit): validated and optimised LOCALLY (originals
 *  untouched; checked by eye against the original from three sides). Not integrated, never hosted — owner
 *  approval needed before either is used anywhere. ("Stall" in the export name means the apple's stalk.) */
export const SPECIAL_ASSETS: TreeAsset[] = [
  a("special-half-apple-with-seeds", "extra", "fruit", "Apple cut in half: cream flesh, star-shaped core, dark seeds",
    f("special-half-apple-seeds.glb", "P2P - Half Apple with Seeds_.glb", "666981bc2f4d0bdeee31c5be3bfe4d70b2003f9827971acc4e98aabd73e86cb2", 28293888, 264528, 7398, 446992)),
  a("special-single-apple-on-stalk", "extra", "fruit", "Single ripe apple on its stalk with one leaf",
    f("special-single-apple-stalk.glb", "P2P - Single Apple on Stall_.glb", "055ef17be6564f08784d9382b0e95421d38186e1d346baf739043ccbb3a00e76", 29688104, 141168, 5157, 410716)),
];

export const assetById = (id: string) => TREE_ASSETS.find((x) => x.id === id) ?? EXTRA_ASSETS.find((x) => x.id === id) ?? SPECIAL_ASSETS.find((x) => x.id === id);
/** True only when every asset a plan needs is integrated (hosted) — until then the viewer keeps the v1 models. */
export const modularTreeReady = (ids: string[]) => ids.every((id) => assetById(id)?.status === "integrated");

/** Where the v2 copies are served from: the versioned public folder Forests/models/v2/ (uploaded and
 *  verified byte-for-byte 2026-11-13, owner approval). EXPO_PUBLIC_GROWTH_MODEL_V2_BASE_URL overrides it
 *  (e.g. a local copy for review). A new set of files always goes to a NEW folder (v3), never over v2. */
const DEFAULT_V2_BASE = "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Forests/models/v2/";
export const MODULAR_TREE_BASE_URL: string | null = (process.env.EXPO_PUBLIC_GROWTH_MODEL_V2_BASE_URL || DEFAULT_V2_BASE).replace(/\/?$/, "/");
const usable = (id: string) => { const x = assetById(id); return x?.file && x.release === "v2" && (x.status === "validated" || x.status === "integrated") ? x.file : null; };
/** URL of an asset's optimised copy, or null (not configured, or no validated file — never a guess). */
export function modularFileUrl(id: string): string | null {
  const file = usable(id);
  return MODULAR_TREE_BASE_URL && file ? MODULAR_TREE_BASE_URL + file.name : null;
}
/** Close-up copy of a large tree, or null (then the viewer limits zoom openly — it never fakes detail). */
export function modularCloseUrl(id: string): string | null {
  const file = usable(id);
  return MODULAR_TREE_BASE_URL && file?.close ? MODULAR_TREE_BASE_URL + file.close.name : null;
}
/** A body's measured branch anchors (lib/growthTreePlacement.ts), shipped beside its model. */
export function anchorsUrl(bodyId: string): string | null {
  const file = usable(bodyId);
  return MODULAR_TREE_BASE_URL && file && assetById(bodyId)?.group === "body" ? MODULAR_TREE_BASE_URL + file.name.replace(/\.glb$/, ".anchors.json") : null;
}

// ── BOTANICAL ASSET SYSTEM (owner brief 2026-11-13) ────────────────────────────────────────────────────
// One register for every Meshy model, used by every feature (the Growth Tree is one user of it). Each asset
// has a botanical CATEGORY, an intended USE and an INTEGRATION state. A category is never a participant
// stage: the six Growth Matrix stages are fixed (constants/stages.ts) and only the stage trees stand for them.
export type BotanicalCategory =
  | "stage_tree"          // the five participant stage models (Seed … Forest Builder)
  | "collective"          // Forest of Nations (shared environment, never a person's stage)
  | "contribution_fruit"  // one per verified contribution on a person's tree
  | "fruit_development"   // fruitlet → green → yellow-green → golden (appearance only)
  | "bud_blossom"         // buds, shoot tips, blossoms
  | "leaf"
  | "root"
  | "structure"           // fruiting spur (where blossom and fruit attach)
  | "special";            // special teaching close-ups (not integrated)
/** live = hosted and used; local_review = optimised copy on this computer only; reserved = validated, owner
 *  approval needed before any use; excluded = the owner has ruled it out; missing = no 3D file exists. */
export type Integration = "live" | "local_review" | "reserved" | "excluded" | "missing";
const BOTANY: Record<string, { category: BotanicalCategory; use: string; integration: Integration; wind?: boolean }> = {
  "asset-00-germinating-seed": { category: "stage_tree", use: "Seed stage tree (Home, My Tree, stage cards)", integration: "live", wind: true },
  "asset-02-sprout": { category: "stage_tree", use: "Sprout stage tree", integration: "live", wind: true },
  "asset-03-young-apple-tree": { category: "stage_tree", use: "Young Tree stage tree", integration: "live", wind: true },
  "asset-04-fruitful-apple-tree": { category: "stage_tree", use: "Fruitful Tree stage tree", integration: "live", wind: true },
  "asset-05-forest-builder-apple-tree": { category: "stage_tree", use: "Forest Builder stage tree", integration: "live", wind: true },
  "forest-of-nations-3d-landscape": { category: "collective", use: "Forest of Nations: the collective global forest (Stages 'Together' card, Global Forest tab, full screen) — never an individual stage. Not hosted yet (upload needs owner approval)", integration: "local_review" },
  "asset-apple-stage-5-ripe-red": { category: "contribution_fruit", use: "Contribution fruit on the tree; ripe apple in the lifecycle", integration: "live" },
  "asset-apple-stage-6-striped-red": { category: "contribution_fruit", use: "Contribution fruit (variety only — it carries no meaning)", integration: "live" },
  "asset-04d-blushed-apple": { category: "contribution_fruit", use: "Contribution fruit; blushed apple in the lifecycle", integration: "live" },
  "asset-micro-7-balloon-stage-bud": { category: "bud_blossom", use: "Contribution awaiting verification (closed bud); balloon bud in the lifecycle", integration: "live" },
  "asset-micro-1-green-tip-bud": { category: "bud_blossom", use: "Recent verified contribution (new growth); green tip in the lifecycle", integration: "live" },
  "asset-micro-3-unfurling-shoot-tip": { category: "bud_blossom", use: "Recent milestone (new shoot); shoot tip in the lifecycle", integration: "live" },
  "asset-micro-5-active-root-tip": { category: "root", use: "Learning under way (active root tip) on the tree; root tip in the lifecycle", integration: "live" },
  "asset-06-fruiting-spur-socket": { category: "structure", use: "Branch areas with verified evidence; fruiting spur in the lifecycle", integration: "live" },
  "asset-micro-2-pink-bud-cluster": { category: "bud_blossom", use: "Apple lifecycle: tight pink buds before blossom", integration: "live", wind: true },
  "asset-apple-blossoms": { category: "bud_blossom", use: "Apple lifecycle: blossom", integration: "live", wind: true },
  "asset-micro-6-dormant-winter-bud": { category: "bud_blossom", use: "Apple lifecycle: dormant winter bud (a season — never inactivity)", integration: "live" },
  "asset-micro-4-petal-fall-fruitlet": { category: "fruit_development", use: "Apple lifecycle: petal fall and young fruitlet", integration: "live" },
  "asset-apple-stage-1-fruitlet": { category: "fruit_development", use: "Apple lifecycle: tiny green fruitlet", integration: "live" },
  "asset-micro-8-june-drop-fruitlet": { category: "fruit_development", use: "Apple lifecycle: June drop (natural thinning — never removed fruit)", integration: "live" },
  "asset-04c-young-green-applelet": { category: "fruit_development", use: "Apple lifecycle: young green applelet", integration: "live" },
  "asset-apple-stage-2-green": { category: "fruit_development", use: "Apple lifecycle: grown green apple", integration: "live" },
  "asset-apple-stage-3-yellow-green": { category: "fruit_development", use: "Apple lifecycle: turning yellow-green", integration: "live" },
  "asset-apple-stage-4-golden-yellow": { category: "fruit_development", use: "Apple lifecycle: golden yellow", integration: "live" },
  "asset-07-single-leaf-particle": { category: "leaf", use: "Apple lifecycle: one leaf, close up (the stage trees carry their own leaves)", integration: "live", wind: true },
  "extra-leaf-cluster-small": { category: "leaf", use: "Apple lifecycle: leaves on a twig", integration: "live", wind: true },
  "extra-leaf-cluster-dense": { category: "leaf", use: "Apple lifecycle: dense foliage", integration: "live", wind: true },
  "asset-micro-9-golden-autumn-leaf": { category: "leaf", use: "Apple lifecycle: autumn leaf (a season — never decline)", integration: "live", wind: true },
  "extra-roots-young": { category: "root", use: "Root development: young roots (the stage trees carry their own roots)", integration: "live" },
  "extra-roots-established": { category: "root", use: "Root development: established roots", integration: "live" },
  "extra-roots-deep": { category: "root", use: "Root development: deep roots", integration: "live" },
  "special-half-apple-with-seeds": { category: "special", use: "Excluded by the owner (2026-11-14) — never used", integration: "excluded" },
  "special-single-apple-on-stalk": { category: "special", use: "Reserved: single-fruit close-up (not integrated)", integration: "reserved" },
};
export interface BotanicalAsset extends TreeAsset { category: BotanicalCategory; use: string; integration: Integration; wind: boolean }
/** Every Meshy model P2P has, one entry per unique model, with its category, use and integration. */
export const BOTANICAL_REGISTRY: BotanicalAsset[] = [...TREE_ASSETS, ...EXTRA_ASSETS, ...SPECIAL_ASSETS].map((x) => ({ ...x, ...BOTANY[x.id], wind: !!BOTANY[x.id]?.wind }));
export const botanicalAsset = (id: string) => BOTANICAL_REGISTRY.find((x) => x.id === id);

/** LOCAL REVIEW ONLY: the optimised copies served from this computer (EXPO_PUBLIC_BOTANICAL_LOCAL_BASE_URL),
 *  so prepared-but-unhosted assets can be reviewed before any upload. Never set for a release build: there,
 *  only hosted assets resolve and everything else is honestly "not available yet". Reserved assets never resolve. */
export const BOTANICAL_LOCAL_BASE_URL: string | null = process.env.EXPO_PUBLIC_BOTANICAL_LOCAL_BASE_URL
  ? process.env.EXPO_PUBLIC_BOTANICAL_LOCAL_BASE_URL.replace(/\/?$/, "/") : null;
export type Availability = "hosted" | "local_review" | "unavailable";
export function botanicalAvailability(id: string): Availability {
  const x = botanicalAsset(id);
  if (!x?.file || x.integration === "reserved" || x.integration === "excluded" || x.integration === "missing") return "unavailable";
  if (x.release === "v2" && MODULAR_TREE_BASE_URL) return "hosted";
  return BOTANICAL_LOCAL_BASE_URL && x.integration === "local_review" ? "local_review" : "unavailable";
}
/** Where to load an asset from: its hosted v2 copy, a local review copy, or null (never a guess). */
export function botanicalAssetUrl(id: string): string | null {
  const x = botanicalAsset(id), av = botanicalAvailability(id);
  if (!x?.file || av === "unavailable") return null;
  return av === "hosted" ? modularFileUrl(id) : BOTANICAL_LOCAL_BASE_URL + x.file.name;
}
/** Its close-up copy (large models only; loaded only when zoomed in), from the same place, or null. */
export function botanicalCloseUrl(id: string): string | null {
  const x = botanicalAsset(id), av = botanicalAvailability(id);
  if (!x?.file?.close || av === "unavailable") return null;
  return av === "hosted" ? modularCloseUrl(id) : BOTANICAL_LOCAL_BASE_URL + x.file.close.name;
}
