// Real focus-area taxonomy (from the app's mission-focus tags — see the
// project audit). No fabricated mission fields, locations, or statistics —
// this file intentionally contains no MissionField[] array, because none
// exist as verified content yet.

export const MISSION_FOCUS_AREAS = [
  "Evangelism",
  "Discipleship",
  "Church planting",
  "Bible translation",
  "Unreached peoples",
  "Compassion",
  "Persecuted church",
  "Youth",
  "Medical missions",
  "Digital missions",
] as const;

export type MissionStory = {
  slug: string;
  title: string;
  focus: (typeof MISSION_FOCUS_AREAS)[number];
  status: "verified" | "pending";
};

// Intentionally empty — no verified real mission stories exist yet. Do not
// add placeholder entries here; the missions page's empty-state component
// handles the "not yet available" case honestly instead.
export const MISSION_STORIES: MissionStory[] = [];
