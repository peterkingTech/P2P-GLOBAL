export const GROWTH_VIDEO_SOURCE = require("../assets/videos/growth.mp4");

// Video is 75.63s, 352x624 portrait. It shows one tree's full life cycle
// (seed -> sprout -> sapling -> mature fruiting tree) and contains NO forest
// imagery, so it only maps to the first 4 growth stages (indices 0-3).
// Stages 4-5 (Forest Builder, Forest of Nations) use the Personal Forest
// screen with real discipleship data instead of video footage.
export interface StageVideoSegment {
  start: number;
  end: number;
}

export const STAGE_VIDEO_SEGMENTS: StageVideoSegment[] = [
  { start: 0, end: 20 }, // Dormant Seed
  { start: 20, end: 40 }, // Sprout
  { start: 40, end: 45 }, // Young Tree
  { start: 45, end: 75.6 }, // Fruitful Tree (video end)
];

export const LAST_VIDEO_STAGE_INDEX = STAGE_VIDEO_SEGMENTS.length - 1; // 3 (Fruitful Tree)

export type WatchGrowthPlan =
  | { type: "segment"; start: number; end: number }
  | { type: "levelup-video"; start: number; end: number }
  | { type: "forest-transition" }
  | { type: "forest-direct" };

/**
 * Decide what "Watch your growth" should do.
 * - stageIndex: the user's CURRENT stage (0-5)
 * - prevStageIndex: only passed when triggered from a growth event, i.e. the
 *   stage the user was in immediately before the event that just fired.
 * - hasSeenForestTransition: whether the user has already seen the one-time
 *   seed-to-forest transition animation.
 */
export function getWatchGrowthPlan(
  stageIndex: number,
  prevStageIndex: number | null,
  hasSeenForestTransition: boolean
): WatchGrowthPlan {
  const leveledUp = prevStageIndex !== null && stageIndex > prevStageIndex;

  if (stageIndex <= LAST_VIDEO_STAGE_INDEX) {
    if (leveledUp && prevStageIndex !== null) {
      return {
        type: "levelup-video",
        start: STAGE_VIDEO_SEGMENTS[prevStageIndex].start,
        end: STAGE_VIDEO_SEGMENTS[stageIndex].end,
      };
    }
    const seg = STAGE_VIDEO_SEGMENTS[stageIndex];
    return { type: "segment", start: seg.start, end: seg.end };
  }

  // stageIndex is 4 or 5 (Forest Builder / Forest of Nations)
  const firstTimeCrossingIntoForest =
    !hasSeenForestTransition &&
    (leveledUp ? prevStageIndex === LAST_VIDEO_STAGE_INDEX : true);

  return firstTimeCrossingIntoForest ? { type: "forest-transition" } : { type: "forest-direct" };
}
