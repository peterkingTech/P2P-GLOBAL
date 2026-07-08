export const STAGE_IMAGES = [
  require("../assets/images/stages/stage-0-seed.png"),
  require("../assets/images/stages/stage-1-sprout.png"),
  require("../assets/images/stages/stage-2-young.png"),
  require("../assets/images/stages/stage-3-fruitful.png"),
  require("../assets/images/stages/stage-4-builder.png"),
  require("../assets/images/stages/stage-5-nations.png"),
] as const;

export interface Stage {
  name: string;
  emoji: string;
  description: string;
  verse: string;
  verseRef: string;
  unlockPoints: number;
}

export const STAGES: Stage[] = [
  {
    name: "Dormant Seed",
    emoji: "🌰",
    description:
      "The journey begins in stillness. A seed rests in the soil, holding the promise of everything to come.",
    verse: "Unless a seed falls to the ground and dies…",
    verseRef: "John 12:24",
    unlockPoints: 0,
  },
  {
    name: "Sprout",
    emoji: "🌱",
    description:
      "First light. Tender shoots break the surface as new habits of prayer and Scripture take hold.",
    verse: "He is like a tree planted by streams of water.",
    verseRef: "Psalm 1:3",
    unlockPoints: 4,
  },
  {
    name: "Young Tree",
    emoji: "🌿",
    description:
      "A trunk forms and branches reach outward. Consistency is turning belief into a settled root system.",
    verse: "Rooted and built up in Him.",
    verseRef: "Colossians 2:7",
    unlockPoints: 12,
  },
  {
    name: "Fruitful Tree",
    emoji: "🌳",
    description:
      "The canopy fills and fruit appears — the visible overflow of a life abiding and bearing witness.",
    verse: "By their fruit you will recognize them.",
    verseRef: "Matthew 7:20",
    unlockPoints: 28,
  },
  {
    name: "Forest Builder",
    emoji: "🌲",
    description:
      "Saplings rise in your shade. You are no longer only growing — you are helping others take root.",
    verse: "Go and make disciples of all nations.",
    verseRef: "Matthew 28:19",
    unlockPoints: 60,
  },
  {
    name: "Forest of Nations",
    emoji: "🌍",
    description:
      "A whole grove flourishes. Generations of disciples now shelter, feed, and multiply one another.",
    verse: "The nations will walk by its light.",
    verseRef: "Revelation 21:24",
    unlockPoints: 110,
  },
];

export function getStageFromPoints(points: number): number {
  let idx = 0;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    if (points >= STAGES[i].unlockPoints) {
      idx = i;
      break;
    }
  }
  return idx;
}
