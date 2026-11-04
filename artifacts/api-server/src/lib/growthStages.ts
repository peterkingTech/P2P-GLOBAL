// The official P2P Global growth journey (migrations 235–237). Five PERSONAL
// stages; Forest of Nations is the COLLECTIVE multiplication of disciples
// across generations — never a personal rank. Same names, descriptions and
// Scripture as the app (constants/stages.ts).

export interface GrowthStageInfo { stage: number; key: string; name: string; emoji: string; description: string; verse: string; verseRef: string }

export const PERSONAL_STAGES: GrowthStageInfo[] = [
  { stage: 1, key: "dormant_seed", name: "Dormant Seed", emoji: "🌰", description: "The journey begins in stillness. A seed rests in the soil, holding the promise of everything to come.", verse: "Unless a seed falls to the ground and dies…", verseRef: "John 12:24" },
  { stage: 2, key: "sprout", name: "Sprout", emoji: "🌱", description: "First light. Tender shoots break the surface as new habits of prayer and Scripture take hold.", verse: "He is like a tree planted by streams of water.", verseRef: "Psalm 1:3" },
  { stage: 3, key: "young_tree", name: "Young Tree", emoji: "🌿", description: "A trunk forms and branches reach outward. Consistency is turning belief into a settled root system.", verse: "Rooted and built up in Him.", verseRef: "Colossians 2:7" },
  { stage: 4, key: "fruitful_tree", name: "Fruitful Tree", emoji: "🌳", description: "The canopy fills and fruit appears — the visible overflow of a life abiding and bearing witness.", verse: "By their fruit you will recognize them.", verseRef: "Matthew 7:20" },
  { stage: 5, key: "forest_builder", name: "Forest Builder", emoji: "🌲", description: "Saplings rise in your shade. You are no longer only growing — you are helping others take root.", verse: "Go and make disciples of all nations.", verseRef: "Matthew 28:19" },
];

export const COLLECTIVE_STAGE = {
  key: "forest_of_nations", name: "Forest of Nations", emoji: "🌍",
  description: "A whole grove flourishes. Generations of disciples now shelter, feed, and multiply one another.",
  verse: "The nations will walk by its light.", verseRef: "Revelation 21:24",
  note: "Forest of Nations is not a personal stage: it is what P2P Global's disciples become together, generation after generation.",
};

export const DIMENSIONS: Record<string, string> = {
  consistency: "Consistency over time",
  learning: "Learning",
  fruit: "Spiritual fruit",
  discipleship: "Discipleship",
};

export const stageInfo = (n: number): GrowthStageInfo => PERSONAL_STAGES[Math.max(1, Math.min(5, Math.round(n))) - 1];

/** The old ladder's points (0 · 4 · 12 · 28 · 60 · 110) → the PERSONAL stage (Forest of Nations points count as Forest Builder). */
export function personalStageFromPoints(points: number): number {
  const p = Number(points) || 0;
  return p >= 60 ? 5 : p >= 28 ? 4 : p >= 12 ? 3 : p >= 4 ? 2 : 1;
}

interface Requirement { key: string; dimension: string; label: string; have: number; need: number; met: boolean }
interface StageCheck { stage: number; met: boolean; requirements: Requirement[] }

/**
 * The checklist for reaching `target`, grouped by dimension, from the engine's
 * evaluation. Milestones only — no percentages (the requirements aren't
 * comparable quantities). Dimensions a stage doesn't ask for are said plainly.
 */
export function checklistFor(target: number, stages: StageCheck[] | undefined) {
  const s = (stages ?? []).find((x) => x.stage === target);
  const reqs = s?.requirements ?? [];
  return Object.entries(DIMENSIONS).map(([dimension, label]) => {
    const items = reqs.filter((r) => r.dimension === dimension).map((r) => ({ label: r.label, met: !!r.met, have: Number(r.have) || 0, need: Number(r.need) || 0 }));
    return { dimension, label, required: items.length > 0, met: items.length > 0 && items.every((i) => i.met), items };
  });
}
