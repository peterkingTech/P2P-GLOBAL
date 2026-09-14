// Phase 4 — visual prototype only. This is a single, internally coherent
// fictional environment used to demonstrate what the app's UI and
// community could look like. Nothing here is a real P2P user, family,
// church, mission, or statistic. Every value that reaches the page is
// labeled "Demo" / "Sample UI data" at the point it renders — see
// components/media/DemoBadge.tsx — never presented as real P2P activity.
// Real content should replace this file wholesale once it exists; no
// component should need to change shape when that happens.

export const DEMO_FAMILY = {
  name: "Grace Family",
  memberCount: 12,
  shepherd: "Sarah",
  nextGathering: "Tonight · 19:00",
  currentStudy: "Knowing God",
  lessonProgress: "5 of 6 people completed this lesson",
};

export const DEMO_PERSON = {
  name: "Daniel",
  learning: "Knowing God",
  helping: "Michael",
  streak: "Studying for 3 weeks",
};

export const DEMO_STUDY = {
  title: "Identity in Christ",
  module: "Module 2",
  lesson: "Lesson 5",
  progressLabel: "4 / 6 lessons",
  progressPct: 67,
};

export const DEMO_CURRICULUM_TOPICS = [
  "Identity in Christ",
  "Knowing God",
  "The Lordship of Jesus",
];

export const DEMO_MISSIONS = [
  { title: "Serve Your Community", place: "Berlin", kind: "Serve" },
  { title: "Pray for Students", place: "Manila", kind: "Pray" },
  { title: "Support a Local Need", place: "Nairobi", kind: "Give" },
  { title: "Share the Gospel", place: "Lima", kind: "Go" },
  { title: "Serve Together", place: "Accra", kind: "Serve" },
] as const;

export const DEMO_WIN = {
  quote: "I started learning with others. Then I realized I could help someone else grow too.",
  attribution: "Sample participant",
};

export const DEMO_NOTIFICATIONS = [
  { title: "Family Gathering tonight", time: "19:00" },
  { title: "Michael finished Lesson 4", time: "2h ago" },
  { title: "New Kingdom Win shared", time: "Yesterday" },
];

export const DEMO_HOME_FEED = {
  greeting: "Good morning, Daniel",
  continueLabel: "Continue your journey",
  todaysScripture: "2 Timothy 2:2",
  stages: ["Learn", "Grow", "Help", "Multiply"] as const,
};
