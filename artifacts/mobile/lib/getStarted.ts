import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Ionicons } from "@expo/vector-icons";
import { DISCOVER_ROUTE, PRAYER_ROUTE } from "@/lib/moreRoutes";

// "How to use P2P" — a reopenable, step-by-step guide. Progress is stored
// per user on this device (AsyncStorage, same as other per-user UI state).

export type GetStartedStepId =
  | "understand" | "learning-path" | "bible" | "plans" | "peer-evaluation" | "connect" | "learn-together" | "pray" | "growth" | "help-grow" | "discover";

export interface GetStartedStep {
  id: GetStartedStepId;
  number: number;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  summary: string;
  points: string[];
  /** Where "Open" takes the user. Omitted when the step is read-only. */
  route?: string;
  actionLabel?: string;
  /**
   * When set, the step is finished only by ticking this statement (the participant confirms they
   * understood) — never by opening the route, and never inferred from activity.
   */
  acknowledgement?: string;
  /** Show whether the service behind this step is running (peer evaluation readiness). */
  showsServiceStatus?: boolean;
}

export const GET_STARTED_STEPS: GetStartedStep[] = [
  {
    id: "understand", number: 1, title: "Understand P2P", icon: "leaf-outline",
    summary: "Everyone is learning from someone and helping someone grow.",
    points: [
      "P2P is peer-to-peer discipleship: you grow through Scripture, prayer and people walking alongside you.",
      "You are never only a learner — as you grow, you help someone else grow too.",
      "Your profile and settings (Profile tab) control what others can see.",
    ],
  },
  {
    id: "learning-path", number: 2, title: "Find your learning path", icon: "book-outline",
    summary: "Kingdom School walks you through the Bible step by step.",
    points: [
      "Go through each module at your own pace.",
      "As you learn, take time to write your personal reflections — these remain private and are saved in your My Discipleship Journal, where you can revisit them anytime.",
      "When you complete a Comprehensive Check, submit it for peer review by a fellow peer.",
      "Through this process, you learn from others while also helping others grow.",
    ],
    route: "/kingdom-school", actionLabel: "Open Kingdom School",
  },
  {
    // 2026-11-18: the Bible tab and its study tools (guide version 2).
    id: "bible", number: 3, title: "Read, hear and study the Bible", icon: "book",
    summary: "The Bible tab: read, listen, compare translations and study deeper.",
    points: [
      "Choose a book and chapter, select verses to highlight them, save them or add a note.",
      "Tap Listen to hear the chapter read aloud — it keeps going while you scroll.",
      "Compare translations side by side, or switch to another one in your language.",
      "Deep Study shows the original Hebrew and Greek words, cross-references, people and places, and commentaries — each with its source.",
    ],
    route: "/bible", actionLabel: "Open the Bible",
  },
  {
    id: "plans", number: 4, title: "Plan your study", icon: "calendar-outline",
    summary: "P2P Plans organise what you want to study, at your own pace.",
    points: [
      "Choose a Bible book, a topic such as Love, or a Kingdom School course — P2P shows what it has for it and why.",
      "Build your own plan step by step, or start a prepared plan, on your own or together.",
      "Pausing never loses your place, and there are no streaks or points.",
    ],
    route: "/plans", actionLabel: "Open P2P Plans",
  },
  {
    // Peer evaluation: there is no sign-up and no volunteer list. Passing a resource through an
    // independent evaluation is what qualifies someone, for that exact resource only.
    id: "peer-evaluation", number: 5, title: "Learn Together. Help Others Grow.", icon: "people-circle-outline",
    summary: "How peer evaluation works — and how you'll be invited to help.",
    points: [
      "You learn through Kingdom School, Kingdom Stories, reading plans and other P2P resources.",
      "When you finish a Comprehensive Check, a peer who has already passed that same resource evaluates it.",
      "When your own work on a resource is approved by an independent peer, you automatically become able to evaluate others on that exact resource.",
      "You will only ever be invited for resources you have passed yourself — never for anything else.",
      "There is nothing to register for and no volunteer sign-up. Invitations come to you when someone needs a peer for a resource you passed.",
      "You never evaluate your own work, and you keep learning while you help others grow.",
    ],
    route: "/evaluation", actionLabel: "Open My Evaluations",
    acknowledgement: "I understand how peer evaluation works",
    showsServiceStatus: true,
  },
  {
    id: "connect", number: 6, title: "Connect with peers", icon: "people-outline",
    summary: "Find people to grow with, and stay in touch.",
    points: [
      "Connect with peers from Discover or a peer's profile.",
      "Messages keeps your conversations, and you can start a voice or video call from any chat.",
      "Missed a call? Tap it to call back.",
    ],
    route: "/connect", actionLabel: "Find peers",
  },
  {
    id: "learn-together", number: 7, title: "Learn together", icon: "school-outline",
    summary: "Study the Bible with others, live.",
    points: [
      "Peer Circles meet regularly for Bible study.",
      "During a call, Study Together lets you go through a lesson side by side.",
      "Live rooms and gatherings let you listen and share in real time.",
    ],
    route: "/circles/discover", actionLabel: "Explore Peer Circles",
  },
  {
    id: "pray", number: 8, title: "Pray together", icon: "hand-left-outline",
    summary: "Bring requests, pray for others, and share what God has done.",
    points: [
      "Post a prayer request or pray for someone else's.",
      "Share testimonies so others are encouraged.",
    ],
    route: PRAYER_ROUTE, actionLabel: "Open Prayer",
  },
  {
    id: "growth", number: 9, title: "See how you grow", icon: "leaf",
    summary: "Your tree shows real growth — not points.",
    points: [
      "Your growth stage moves forward through verified learning, application, consistency and service — never by opening content.",
      "My Growth shows what you have done, what is next, and what each stage needs.",
      "These milestones never measure your relationship with God or your worth.",
    ],
    route: "/my-growth", actionLabel: "Open My Growth",
  },
  {
    id: "help-grow", number: 10, title: "Help someone grow", icon: "person-add-outline",
    summary: "Be an Electronic Evangelist.",
    points: [
      "Your phone can be more than a place to consume. Use it to help someone grow.",
      "Invite someone who could benefit from growing with you on P2P.",
    ],
    route: "/connect/invite", actionLabel: "Invite a peer",
  },
  {
    id: "discover", number: 11, title: "Discover Kingdom opportunities", icon: "compass-outline",
    summary: "See what God is doing, and where you can take part.",
    points: [
      "Discover shows live rooms, peer groups, churches and Kingdom Stories.",
      "Missions — stories, mission fields and ways to pray — now live inside Discover.",
    ],
    route: DISCOVER_ROUTE, actionLabel: "Open Discover",
  },
];

const keyFor = (userId: string) => `getStarted:${userId}`;

// ── The introduction after onboarding, and "what's new" (2026-11-18) ───────────
/** Raise when significant new features are added to the guide; list them in WHATS_NEW. */
export const GUIDE_VERSION = 2;
/** The guide steps that are new in each version — shown once to people who saw an earlier version. */
export const WHATS_NEW: Record<number, GetStartedStepId[]> = { 2: ["bible", "plans", "growth"] };
const introKey = (userId: string) => `getStarted:intro:${userId}`;
/** The guide version this person last saw as an introduction (0 = never). */
export async function loadIntroSeen(userId: string): Promise<number> {
  try { return Number(await AsyncStorage.getItem(introKey(userId))) || 0; } catch { return 0; }
}
export async function markIntroSeen(userId: string, version = GUIDE_VERSION): Promise<void> {
  try { await AsyncStorage.setItem(introKey(userId), String(version)); } catch {}
}
/** New steps to point out to someone who last saw version `seen` (never on a first introduction). */
export function whatsNewSince(seen: number, version = GUIDE_VERSION): GetStartedStepId[] {
  const out: GetStartedStepId[] = [];
  for (let v = Math.max(seen + 1, 2); v <= version; v++) out.push(...(WHATS_NEW[v] ?? []));
  return out;
}

export async function loadCompletedSteps(userId: string): Promise<Set<GetStartedStepId>> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return new Set(raw ? (JSON.parse(raw) as GetStartedStepId[]) : []);
  } catch {
    return new Set();
  }
}

export async function markStepComplete(userId: string, stepId: GetStartedStepId): Promise<Set<GetStartedStepId>> {
  const done = await loadCompletedSteps(userId);
  done.add(stepId);
  try { await AsyncStorage.setItem(keyFor(userId), JSON.stringify([...done])); } catch {}
  return done;
}

// Steps the app can already confirm from real activity, so users are not
// asked to repeat something they have done.
export function inferCompletedSteps(input: { modulesStarted: number; hasInvited: boolean }): GetStartedStepId[] {
  const out: GetStartedStepId[] = [];
  if (input.modulesStarted > 0) out.push("learning-path");
  if (input.hasInvited) out.push("help-grow");
  return out;
}
