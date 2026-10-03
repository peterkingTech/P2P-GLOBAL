import AsyncStorage from "@react-native-async-storage/async-storage";

// "Everyone is learning from someone and helping someone grow."
//
// Encouragement to invite a peer, framed as helping someone grow — never as
// user acquisition, points or rewards. State is per user, per device
// (AsyncStorage, the same mechanism Home already uses for its dismissal
// flags); no new database structures.

export type EncouragementStage = "seed" | "help" | "evangelist" | "returning";

export interface Encouragement {
  stage: EncouragementStage;
  title: string;
  body: string;
}

const MESSAGES: Record<EncouragementStage, Encouragement[]> = {
  seed: [
    { stage: "seed", title: "Plant a Seed", body: "Invite someone to begin growing with you." },
  ],
  help: [
    { stage: "help", title: "Who Can You Help Grow?", body: "Think of someone who could benefit from growing with you on P2P." },
  ],
  evangelist: [
    { stage: "evangelist", title: "Be an Electronic Evangelist", body: "Your phone can be more than a place to consume. Use it to help someone grow." },
    { stage: "evangelist", title: "Make Your Technology Count", body: "Your technology can help carry encouragement and discipleship farther." },
  ],
  returning: [
    { stage: "returning", title: "Don't Keep the Seed to Yourself", body: "Share P2P with someone you care about." },
  ],
};

export interface ReminderState {
  /** When the card was last put in front of the user. */
  lastShownAt: string | null;
  /** "Remind Me Later": the card stays hidden until this time. */
  snoozedUntil: string | null;
  lastRemindLaterAt: string | null;
  /** When the user last opened the share sheet with their invite link. */
  lastInviteSharedAt: string | null;
  /** Last time Home was opened, to recognise a returning user. */
  lastVisitAt: string | null;
}

const EMPTY: ReminderState = {
  lastShownAt: null, snoozedUntil: null, lastRemindLaterAt: null, lastInviteSharedAt: null, lastVisitAt: null,
};

const DAY = 24 * 60 * 60 * 1000;
// Minimum gap between appearances when the user has neither acted nor
// snoozed. Longer once they have already invited someone.
const DEFAULT_GAP = 3 * DAY;
const AFTER_INVITE_GAP = 21 * DAY;
const RETURNING_AFTER = 14 * DAY;

export type SnoozeOption = "laterToday" | "tomorrow" | "nextWeek";
export const SNOOZE_LABELS: Record<SnoozeOption, string> = {
  laterToday: "Later today",
  tomorrow: "Tomorrow",
  nextWeek: "Next week",
};
const SNOOZE_MS: Record<SnoozeOption, number> = {
  laterToday: 4 * 60 * 60 * 1000,
  tomorrow: DAY,
  nextWeek: 7 * DAY,
};

const keyFor = (userId: string) => `inviteEncouragement:${userId}`;

export async function loadReminderState(userId: string): Promise<ReminderState> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<ReminderState>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

async function save(userId: string, state: ReminderState): Promise<void> {
  try { await AsyncStorage.setItem(keyFor(userId), JSON.stringify(state)); } catch {}
}

export function hasInvitedSomeone(state: ReminderState, grainCount: number): boolean {
  return grainCount > 0 || !!state.lastInviteSharedAt;
}

// Whether the card may appear now. A pending "Remind Me Later" decides on
// its own: hidden until the chosen time, shown once it passes — the minimum
// gap must not push "Tomorrow" out to day three. Showing the card again
// clears the snooze (recordShown), after which the normal gap applies.
export function isEligible(state: ReminderState, grainCount: number, now = Date.now()): boolean {
  if (state.snoozedUntil) return Date.parse(state.snoozedUntil) <= now;
  if (!state.lastShownAt) return true;
  const gap = hasInvitedSomeone(state, grainCount) ? AFTER_INVITE_GAP : DEFAULT_GAP;
  return now - Date.parse(state.lastShownAt) >= gap;
}

export function pickEncouragement(input: {
  state: ReminderState; grainCount: number; modulesCompleted: number; accountCreatedAt: string | null; now?: number;
}): Encouragement {
  const now = input.now ?? Date.now();
  const lastVisit = input.state.lastVisitAt ? Date.parse(input.state.lastVisitAt) : null;
  const accountAge = input.accountCreatedAt ? now - Date.parse(input.accountCreatedAt) : 0;

  let stage: EncouragementStage;
  if (lastVisit !== null && now - lastVisit >= RETURNING_AFTER) stage = "returning";
  else if (hasInvitedSomeone(input.state, input.grainCount) || input.modulesCompleted >= 3) stage = "evangelist";
  else if (input.modulesCompleted >= 1 || accountAge >= 7 * DAY) stage = "help";
  else stage = "seed";

  // Rotate within a stage by day, so the wording varies without changing on
  // every render.
  const options = MESSAGES[stage];
  return options[Math.floor(now / DAY) % options.length];
}

export async function recordVisit(userId: string): Promise<ReminderState> {
  const state = await loadReminderState(userId);
  // The stage is decided from the PREVIOUS visit, so return the state as it
  // was, and store the new visit time for next time.
  await save(userId, { ...state, lastVisitAt: new Date().toISOString() });
  return state;
}

export async function recordShown(userId: string): Promise<void> {
  const state = await loadReminderState(userId);
  // The snooze (if any) has now done its job.
  await save(userId, { ...state, lastShownAt: new Date().toISOString(), snoozedUntil: null });
}

export async function recordRemindLater(userId: string, option: SnoozeOption): Promise<void> {
  const state = await loadReminderState(userId);
  const now = Date.now();
  await save(userId, {
    ...state,
    lastRemindLaterAt: new Date(now).toISOString(),
    snoozedUntil: new Date(now + SNOOZE_MS[option]).toISOString(),
  });
}

export async function recordInviteShared(userId: string): Promise<void> {
  const state = await loadReminderState(userId);
  const nowIso = new Date().toISOString();
  await save(userId, { ...state, lastInviteSharedAt: nowIso, lastShownAt: nowIso, snoozedUntil: null });
}
