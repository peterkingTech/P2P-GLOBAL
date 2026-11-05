// The official P2P Global growth milestones (migrations 235–239). Five PERSONAL
// milestones; Forest of Nations is COLLECTIVE — what participants build
// together — never a personal rank. Same names, descriptions and Scripture as
// the app (constants/stages.ts). Milestones record participation, assessed
// learning, practical application and contribution on P2P Global; they never
// measure a person's relationship with God, faith or worth.

export interface GrowthStageInfo { stage: number; key: string; name: string; emoji: string; description: string; verse: string; verseRef: string }

// `key` values are stable identifiers older app builds may look up (stage 1 keeps "dormant_seed").
export const PERSONAL_STAGES: GrowthStageInfo[] = [
  { stage: 1, key: "dormant_seed", name: "Seed", emoji: "🌰", description: "The starting point. Everyone begins here, with all of P2P Global open to explore.", verse: "Unless a seed falls to the ground and dies…", verseRef: "John 12:24" },
  { stage: 2, key: "sprout", name: "Sprout", emoji: "🌱", description: "First steady steps: a rhythm of taking part, passing assessed learning, putting it into practice and helping others.", verse: "He is like a tree planted by streams of water.", verseRef: "Psalm 1:3" },
  { stage: 3, key: "young_tree", name: "Young Tree", emoji: "🌿", description: "A consistent rhythm over months, with more learning passed, more practice and more help given to others.", verse: "Rooted and built up in Him.", verseRef: "Colossians 2:7" },
  { stage: 4, key: "fruitful_tree", name: "Fruitful Tree", emoji: "🌳", description: "Sustained participation, and helping at least one learner develop who is now helping someone else.", verse: "By their fruit you will recognize them.", verseRef: "Matthew 7:20" },
  { stage: 5, key: "forest_builder", name: "Forest Builder", emoji: "🌲", description: "The whole Core Curriculum passed, and a long record of helping others learn that those you helped carry on.", verse: "Go and make disciples of all nations.", verseRef: "Matthew 28:19" },
];

export const COLLECTIVE_STAGE = {
  key: "forest_of_nations", name: "Forest of Nations", emoji: "🌍",
  description: "What P2P Global's participants build together, generation after generation — shown only as shared totals.",
  verse: "The nations will walk by its light.", verseRef: "Revelation 21:24",
  note: "Forest of Nations is not a personal stage: it is what P2P Global's participants build together.",
};

/**
 * What each stage is FOR — observable development responsibilities, growing from
 * personal foundations to generational impact. Descriptive only: they add no
 * requirement beyond the matrix, and never describe anyone's spiritual condition.
 */
export interface StageObjective { title: string; objective: string; focus: string[] }
export const STAGE_OBJECTIVES: Record<number, StageObjective> = {
  1: { title: "Establish your foundation", objective: "Begin building consistent foundations through meaningful participation, learning and practical application.",
       focus: ["Establish consistent participation", "Begin assessed learning", "Develop practical application habits", "Become connected to the P2P learning community", "Begin receiving and benefiting from peer support"] },
  2: { title: "Develop and strengthen", objective: "Strengthen your learning, application and contribution habits while becoming more actively involved in helping others.",
       focus: ["Build on foundational learning", "Demonstrate practical application", "Develop consistent participation", "Begin meaningful contributions", "Participate in peer learning"] },
  3: { title: "Become established and help others", objective: "Develop stronger foundations and begin making a meaningful, verifiable difference in the development of others.",
       focus: ["Continue assessed learning", "Strengthen practical application", "Make meaningful contributions", "Support another participant's development", "Begin contributing to the development of a wider learning community"] },
  4: { title: "Develop others who develop others", objective: "Demonstrate sustained contribution to other learners and help establish the next generation of contributors.",
       focus: ["Continue personal development", "Demonstrate sustained support for at least one learner", "Verify observable progress in that learner", "Help establish second-generation contribution", "Develop a multiplying pattern of peer support"] },
  5: { title: "Build lasting generational impact", objective: "Develop people who continue developing others, establishing sustained and multiplying networks of learning and contribution.",
       focus: ["Complete every Kingdom School Foundations lesson and its required assessment", "Meet all four independent milestone dimensions", "Demonstrate sustained contribution to learners",
               "Demonstrate second-generation contribution continuing for at least three months", "Build a sustained generational contribution network"] },
};
export const COLLECTIVE_OBJECTIVE = {
  title: "Collective global impact",
  objective: "The collective impact of a growing global network of people helping others grow across communities and nations — a shared vision, never an individual stage.",
};
export const stageObjective = (n: number): StageObjective => STAGE_OBJECTIVES[Math.max(1, Math.min(5, Math.round(n)))];

/** The four independent dimensions. Every one must be met; none compensates for another. */
export const DIMENSIONS: Record<string, string> = {
  consistency: "Consistency",
  learning: "Learning",
  application: "Application",
  service: "Service & Contribution",
};

export const MILESTONE_EXPLANATION =
  "Growth milestones celebrate how you take part in P2P Global: how consistently you participate, what you learn, how you put learning into practice, and how you help others learn. They are a record of participation and contribution on P2P Global — nothing more.";
export const MILESTONE_DISCLAIMER =
  "These milestones do not measure your relationship with God, your faith, or your worth. Only God knows the heart. They simply recognise the activity you've chosen to record here.";

export const stageInfo = (n: number): GrowthStageInfo => PERSONAL_STAGES[Math.max(1, Math.min(5, Math.round(n))) - 1];

/** The old ladder's points (0 · 4 · 12 · 28 · 60 · 110) → the PERSONAL stage (Forest of Nations points count as Forest Builder). */
export function personalStageFromPoints(points: number): number {
  const p = Number(points) || 0;
  return p >= 60 ? 5 : p >= 28 ? 4 : p >= 12 ? 3 : p >= 4 ? 2 : 1;
}

// The unit of what is still missing, so "50 more to go" reads "50 more days to go".
const UNITS: Record<string, [string, string]> = {
  journey_days: ["day", "days"], days_in_stage: ["day", "days"], active_weeks: ["active week", "active weeks"],
  active_weeks_window: ["active week", "active weeks"], active_months: ["active month", "active months"],
  learning_units: ["learning unit", "learning units"], core_curriculum_complete: ["Core lesson", "Core lessons"],
  application_actions: ["practical action", "practical actions"], contributions: ["contribution", "contributions"],
};
/** Whole-number percentage of one requirement (0 when nothing is required yet is met → 100). Never averaged across requirements. */
export const percentOf = (have: number, need: number) => (need <= 0 ? 100 : Math.max(0, Math.min(100, Math.floor((have / need) * 100))));

interface Requirement { key: string; dimension: string; label: string; explanation?: string; note?: string | null; have: number; need: number; met: boolean }
interface StageCheck { stage: number; met: boolean; requirements: Requirement[] }

/**
 * The checklist for reaching `target`, grouped by the four dimensions, from the
 * engine's evaluation. Counts only — no percentages or rankings. Each item says
 * what counts and, when not yet met, what is still missing.
 */
export function checklistFor(target: number, stages: StageCheck[] | undefined) {
  const s = (stages ?? []).find((x) => x.stage === target);
  const reqs = s?.requirements ?? [];
  return Object.entries(DIMENSIONS).map(([dimension, label]) => {
    const items = reqs.filter((r) => r.dimension === dimension).map((r) => {
      const have = Number(r.have) || 0, need = Number(r.need) || 0, gap = need - have;
      const unit = UNITS[r.key] ? ` ${UNITS[r.key][gap === 1 ? 0 : 1]}` : "";
      return {
        key: r.key, label: r.label, met: !!r.met, have, need,
        // Fraction and percentage of THIS requirement only (dimensions are never averaged together).
        percent: percentOf(have, need), remaining: Math.max(0, need - have),
        explanation: r.explanation ?? null,
        missing: r.met ? null : (r.note ?? (gap > 0 ? `${gap} more${unit} to go` : null)),
      };
    });
    return { dimension, label, required: items.length > 0, met: items.length > 0 && items.every((i) => i.met), items };
  });
}

/** What has already been verified, in plain words — counts per dimension (never content). */
export function verifiedSummary(facts: Record<string, unknown> | undefined) {
  const f = facts ?? {};
  const n = (k: string) => Number((f as Record<string, unknown>)[k]) || 0;
  return {
    activeWeeks: n("active_weeks"),
    activeMonths: n("active_months"),
    learningUnits: n("learning_units"),
    coreLessons: { passed: n("core_lessons_passed"), total: n("core_lessons_total"), percent: percentOf(n("core_lessons_passed"), n("core_lessons_total")) },
    practicalActions: n("application_actions"),
    contributions: n("contributions"),
    pendingReview: n("pending_review"),
    pausedNow: !!(f as { paused_now?: boolean }).paused_now,
  };
}
