// 3D models of the growth journey (Meshy exports, prepared and checked — see docs/growth-models.md).
// Every personal milestone has a model and a still image of it (used in cards). Where an export has
// a known limitation the viewer applies it openly and the screen says so:
//   • Sprout and Young Tree are nearly flat reliefs → viewed from the front only;
//   • Forest Builder loses detail up close → no detailed copy, close-up zoom limited.
// Models with a detailed copy load it only when the person zooms in (one copy in memory at a time).

export type GrowthModelId = "seed" | "sprout" | "young_tree" | "fruitful_tree" | "forest_builder" | "blossom" | "fruits";

export interface GrowthModelLimits {
  /** The model is a flat relief: turning is limited to the front. */
  frontOnly?: boolean;
  /** No close-up copy: zooming stops before detail breaks down. */
  noCloseUp?: boolean;
}

export interface GrowthModel {
  id: GrowthModelId;
  title: string;
  /** Spoken/text description for people who can't see the model. */
  description: string;
  standard: string;
  /** Close-up copy, downloaded only when zoomed in. Null when there is none. */
  detailed: string | null;
  /** Still image of the model (transparent background), for cards. */
  still?: string;
  /** Download sizes in MB, shown before anything is fetched. */
  standardMb: number;
  detailedMb: number | null;
  limits?: GrowthModelLimits;
}

// Versioned folder: replacing a model means a new folder, never overwriting cached files.
const DEFAULT_BASE = "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Forests/models/v1/";
export const GROWTH_MODEL_BASE_URL = (process.env.EXPO_PUBLIC_GROWTH_MODEL_BASE_URL || DEFAULT_BASE).replace(/\/?$/, "/");

export const GROWTH_MODELS: Record<GrowthModelId, GrowthModel> = {
  seed: {
    id: "seed", title: "Seed",
    description: "A dark brown seed with a split coat, sending a pale first root downward.",
    standard: "P2P-Seed-mobile.glb", detailed: "P2P-Seed-high.glb", still: "stills/P2P-Seed-still.webp", standardMb: 4.5, detailedMb: 5.1,
  },
  sprout: {
    id: "sprout", title: "Sprout",
    description: "A young green shoot with its first leaves, rising from the seed above a fan of fine roots.",
    standard: "P2P-Sprout-mobile.glb", detailed: "P2P-Sprout-high.glb", still: "stills/P2P-Sprout-still.webp", standardMb: 5.2, detailedMb: 5.8,
    limits: { frontOnly: true },
  },
  young_tree: {
    id: "young_tree", title: "Young Tree",
    description: "A young tree with a slender trunk, many light green leaves and a wide spread of roots.",
    standard: "P2P-YoungTree-mobile.glb", detailed: "P2P-YoungTree-high.glb", still: "stills/P2P-YoungTree-still.webp", standardMb: 8.4, detailedMb: 10.8,
    limits: { frontOnly: true },
  },
  fruitful_tree: {
    id: "fruitful_tree", title: "Fruitful Tree",
    description: "A broad apple tree full of red and yellow apples, with a thick trunk and deep, spreading roots.",
    standard: "P2P-FruitfulTree-mobile.glb", detailed: "P2P-FruitfulTree-high.glb", still: "stills/P2P-FruitfulTree-still.webp", standardMb: 12.1, detailedMb: 16.3,
  },
  forest_builder: {
    id: "forest_builder", title: "Forest Builder",
    description: "A ring of fruit trees growing together, their canopies joined above one shared web of roots.",
    standard: "P2P-ForestBuilder-mobile.glb", detailed: null, still: "stills/P2P-ForestBuilder-still.webp", standardMb: 18.4, detailedMb: null,
    limits: { noCloseUp: true },
  },
  blossom: {
    id: "blossom", title: "Blossom",
    description: "A cluster of white and pink apple blossoms with buds and green leaves on a dark branch.",
    standard: "P2P-Blossom-mobile.glb", detailed: "P2P-Blossom-high.glb", standardMb: 5.6, detailedMb: 6.2,
  },
  fruits: {
    id: "fruits", title: "Fruits",
    description: "A row of six apples growing from small and green to large, ripe and red.",
    standard: "P2P-Fruits-mobile.glb", detailed: "P2P-Fruits-high.glb", standardMb: 4.3, detailedMb: 4.5,
  },
};

/** Personal growth stage index (constants/stages.ts, 0 = Seed … 4 = Forest Builder) → its 3D model. */
export const STAGE_MODELS: Record<number, GrowthModelId> = { 0: "seed", 1: "sprout", 2: "young_tree", 3: "fruitful_tree", 4: "forest_builder" };

/** Supporting models shown alongside a stage's own model (not stages themselves). */
export const SUPPORTING_MODELS: Partial<Record<GrowthModelId, GrowthModelId[]>> = { fruitful_tree: ["blossom", "fruits"] };

/** What the screen tells people about a model's limitation (never hidden). */
export function limitNote(m: GrowthModel): string | null {
  if (m.limits?.frontOnly) return "Shown from the front only for now: this model is still flat at the sides. A full 3D model is coming.";
  if (m.limits?.noCloseUp) return "Close-up zoom isn't available for this model yet: its detail breaks down up close. A detailed model is coming.";
  return null;
}

export function modelUrls(m: GrowthModel): { standard: string; detailed: string | null } {
  return { standard: GROWTH_MODEL_BASE_URL + m.standard, detailed: m.detailed ? GROWTH_MODEL_BASE_URL + m.detailed : null };
}

/** The still image of a personal stage's model (for cards), or null. */
export function stageStillUrl(stageIndex: number): string | null {
  const m = GROWTH_MODELS[STAGE_MODELS[stageIndex]];
  return m?.still ? GROWTH_MODEL_BASE_URL + m.still : null;
}

export function isGrowthModelId(v: unknown): v is GrowthModelId {
  return typeof v === "string" && v in GROWTH_MODELS;
}
