// My Tree's own 8-stage growth ladder, driven by p2p_profiles.
// tree_growth_score (migration 113) — deliberately separate from
// constants/stages.ts's unrelated 6-stage growth_level ladder (home badge,
// admin Grove Dashboard), which is untouched by this feature.
//
// Thresholds are a tunable starting point: small enough that no single
// action (lesson +3, module +15, category +50 — see migration 113) skips
// more than roughly one stage, wide enough that reaching Flourishing
// genuinely represents a long discipleship journey, not a few sessions.

export type TreeStageId =
  | "seed"
  | "root"
  | "sprout"
  | "young_tree"
  | "growing_tree"
  | "developing_tree"
  | "mature_tree"
  | "flourishing_tree";

export interface TreeStageDef {
  id: TreeStageId;
  name: string;
  threshold: number;
  description: string;
}

export const TREE_STAGES: TreeStageDef[] = [
  { id: "seed", name: "Seed", threshold: 0, description: "A seed has been planted in fertile soil." },
  { id: "root", name: "Root", threshold: 8, description: "Roots are beginning to take hold." },
  { id: "sprout", name: "Sprout", threshold: 22, description: "The first shoot and leaves have appeared." },
  { id: "young_tree", name: "Young Tree", threshold: 50, description: "A trunk and first branches are forming." },
  { id: "growing_tree", name: "Growing Tree", threshold: 110, description: "The tree is developing real structure." },
  { id: "developing_tree", name: "Developing Tree", threshold: 220, description: "A wide canopy and deep roots are forming." },
  { id: "mature_tree", name: "Mature Tree", threshold: 400, description: "A substantial, well-branched tree bearing much fruit." },
  { id: "flourishing_tree", name: "Flourishing Tree", threshold: 650, description: "A flourishing tree representing a long journey of discipleship." },
];

export function getTreeStageIndex(score: number): number {
  let idx = 0;
  for (let i = 0; i < TREE_STAGES.length; i++) {
    if (score >= TREE_STAGES[i].threshold) idx = i;
  }
  return idx;
}

export function getTreeStage(score: number): TreeStageDef {
  return TREE_STAGES[getTreeStageIndex(score)];
}

// Progress (0-1) toward the next stage, for progress bars — 1 if already
// at the final stage.
export function getTreeStageProgress(score: number): number {
  const idx = getTreeStageIndex(score);
  const current = TREE_STAGES[idx];
  const next = TREE_STAGES[idx + 1];
  if (!next) return 1;
  const span = next.threshold - current.threshold;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (score - current.threshold) / span));
}