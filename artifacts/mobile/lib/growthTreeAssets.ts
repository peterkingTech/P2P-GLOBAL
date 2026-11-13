// The 26 botanical assets for the modular Growth Tree (owner brief 2026-11-12) — a VERSIONED MANIFEST.
// An asset counts as integrated only after its file has been located, validated (format, size, textures,
// orientation, scale, polygon count, rendering from every side) and given a hosted URL. Until then its
// status says so, and the app keeps using the validated v1 models (lib/growthModels.ts).
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
// Forests/models/v2/ and verified from their public URLs → status "integrated"; the rest stay "validated" (local).
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
const a = (id: string, group: TreeAsset["group"], attachment: AttachmentType, depicts: string, file?: AssetFile, extra: Partial<TreeAsset> = {}): TreeAsset =>
  ({ id, group, attachment, depicts, status: file ? (extra.release === "v2" ? "integrated" : "validated") : "not_located", ...(file ? { file, identifiedBy: "filename" as const } : {}), ...extra });

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
  a("forest-of-nations-3d-landscape", "body", "landscape", "Collective forest — Global Forest only, never an individual stage (only a 2D image exists)"),
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

export const assetById = (id: string) => TREE_ASSETS.find((x) => x.id === id) ?? EXTRA_ASSETS.find((x) => x.id === id);
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
