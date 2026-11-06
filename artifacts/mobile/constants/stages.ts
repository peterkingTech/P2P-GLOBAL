import { stageStillUrl } from "@/lib/growthModels";

export type StageImageSource = { uri: string };

// The five personal stages are stills of their 3D models (transparent background — show them with
// resizeMode "contain"); Forest of Nations is the collective landscape scene.
export const STAGE_IMAGES: StageImageSource[] = [
  ...[0, 1, 2, 3, 4].map((i) => ({ uri: stageStillUrl(i)! })),
  { uri: "https://omkqkasniakcnmfcwrvs.supabase.co/storage/v1/object/public/Forests/Forest%20of%20nations.jpeg" },
];

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
    name: "Seed",
    emoji: "🌰",
    description:
      "The starting point. Everyone begins here, with all of P2P Global open to explore.",
    verse: "Unless a seed falls to the ground and dies…",
    verseRef: "John 12:24",
    unlockPoints: 0,
  },
  {
    name: "Sprout",
    emoji: "🌱",
    description:
      "First steady steps: a rhythm of taking part, passing assessed learning, putting it into practice and helping others.",
    verse: "He is like a tree planted by streams of water.",
    verseRef: "Psalm 1:3",
    unlockPoints: 4,
  },
  {
    name: "Young Tree",
    emoji: "🌿",
    description:
      "A consistent rhythm over months, with more learning passed, more practice and more help given to others.",
    verse: "Rooted and built up in Him.",
    verseRef: "Colossians 2:7",
    unlockPoints: 12,
  },
  {
    name: "Fruitful Tree",
    emoji: "🌳",
    description:
      "Sustained participation, and helping at least one learner develop who is now helping someone else.",
    verse: "By their fruit you will recognize them.",
    verseRef: "Matthew 7:20",
    unlockPoints: 28,
  },
  {
    name: "Forest Builder",
    emoji: "🌲",
    description:
      "The whole Core Curriculum passed, and a long record of helping others learn that those you helped carry on.",
    verse: "Go and make disciples of all nations.",
    verseRef: "Matthew 28:19",
    unlockPoints: 60,
  },
  {
    name: "Forest of Nations",
    emoji: "🌍",
    description:
      "What P2P Global's participants build together, generation after generation — shown only as shared totals.",
    verse: "The nations will walk by its light.",
    verseRef: "Revelation 21:24",
    unlockPoints: 110,
  },
];

// Five PERSONAL milestones (indexes 0–4, Seed → Forest Builder). Forest of
// Nations (index 5) is COLLECTIVE — what P2P Global's participants build
// together — never a person's own stage. The milestone itself is calculated on
// the server from verified evidence (migrations 235–239; GET /growth/me). The
// points below are only the older ladder that earlier app builds read.
export const PERSONAL_STAGE_COUNT = 5;
export const COLLECTIVE_STAGE_INDEX = 5;

/** A person's stage from their growth points: never Forest of Nations (collective), so at most Forest Builder. */
export function getStageFromPoints(points: number): number {
  let idx = 0;
  for (let i = PERSONAL_STAGE_COUNT - 1; i >= 0; i--) {
    if (points >= STAGES[i].unlockPoints) {
      idx = i;
      break;
    }
  }
  return idx;
}

export const stageByName = (name: string): Stage | undefined => STAGES.find((s) => s.name === name);
