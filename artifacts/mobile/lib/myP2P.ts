import AsyncStorage from "@react-native-async-storage/async-storage";

// My P2P — the in-app widget dashboard (Home + /my-p2p). Every widget reads
// the EXISTING records and services (Kingdom School modules, story progress,
// the Bible reading position, Study Together, the Journey's growth stage and
// activity timeline, the Journal timeline, notifications) — no copies.
// Layout preferences live where the other personal settings live (study
// reminders): per account, on this device. These are IN-APP widgets only —
// nothing here feeds a phone home-screen widget, so private content never
// leaves the signed-in app.

export type WidgetId =
  | "journey" | "journal" | "continue" | "growth" | "bible"
  | "stories" | "together" | "communities" | "prayer" | "updates";

export interface WidgetInfo { id: WidgetId; title: string; description: string; required?: boolean }

// The two discipleship widgets are required: they can be moved but not hidden.
export const WIDGETS: readonly WidgetInfo[] = [
  { id: "journey", title: "My Discipleship Journey", description: "Your stage, milestones and next step", required: true },
  { id: "journal", title: "My Discipleship Journal", description: "Your private reflections and entries", required: true },
  { id: "continue", title: "Continue Learning", description: "Your current lesson and story" },
  { id: "growth", title: "Daily Growth", description: "Today's study time toward your goal" },
  { id: "bible", title: "My Bible", description: "Pick up where you left off" },
  { id: "stories", title: "Kingdom Stories", description: "A story to read or continue" },
  { id: "together", title: "Study Together", description: "Invitations and shared studies" },
  { id: "communities", title: "My Communities", description: "Family Circle, Church, Circles, messages" },
  { id: "prayer", title: "Prayer and Reflection", description: "Your prayer journal and reflections" },
  { id: "updates", title: "P2P Updates", description: "Recent notifications and new stories" },
];
export const WIDGET_IDS = WIDGETS.map((w) => w.id);
export const widgetInfo = (id: WidgetId) => WIDGETS.find((w) => w.id === id)!;

export interface Layout { order: WidgetId[]; hidden: WidgetId[]; journalPreview: boolean }
export const DEFAULT_LAYOUT: Layout = {
  order: ["journey", "continue", "journal", "growth", "bible", "stories", "together", "communities", "prayer", "updates"],
  hidden: [],
  // Journal previews stay hidden until the person chooses to show them.
  journalPreview: false,
};

/** Any stored value → a valid layout: unknown ids dropped, missing ones appended, required ones never hidden. */
export function normalizeLayout(raw: unknown): Layout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Layout>;
  const seen = new Set<WidgetId>();
  const order: WidgetId[] = [];
  for (const id of Array.isArray(o.order) ? o.order : []) {
    if (WIDGET_IDS.includes(id as WidgetId) && !seen.has(id as WidgetId)) { seen.add(id as WidgetId); order.push(id as WidgetId); }
  }
  for (const id of DEFAULT_LAYOUT.order) if (!seen.has(id)) order.push(id);
  const hidden = (Array.isArray(o.hidden) ? o.hidden : [])
    .filter((id): id is WidgetId => WIDGET_IDS.includes(id as WidgetId) && !widgetInfo(id as WidgetId).required);
  return { order, hidden: Array.from(new Set(hidden)), journalPreview: o.journalPreview === true };
}
export const visibleWidgets = (l: Layout) => l.order.filter((id) => !l.hidden.includes(id));

export function moveWidget(l: Layout, id: WidgetId, dir: -1 | 1): Layout {
  const i = l.order.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= l.order.length) return l;
  const order = [...l.order];
  [order[i], order[j]] = [order[j], order[i]];
  return { ...l, order };
}
export function setWidgetVisible(l: Layout, id: WidgetId, visible: boolean): Layout {
  if (widgetInfo(id).required) return l;
  const hidden = l.hidden.filter((x) => x !== id);
  return { ...l, hidden: visible ? hidden : [...hidden, id] };
}

const key = (userId: string) => `p2p.myp2p.layout.v1:${userId}`;
export async function loadLayout(userId: string): Promise<Layout> {
  try { const v = await AsyncStorage.getItem(key(userId)); return v ? normalizeLayout(JSON.parse(v)) : DEFAULT_LAYOUT; }
  catch { return DEFAULT_LAYOUT; }
}
export async function saveLayout(userId: string, l: Layout): Promise<void> {
  await AsyncStorage.setItem(key(userId), JSON.stringify(normalizeLayout(l))).catch(() => {});
}

// ── My Discipleship Journey ─────────────────────────────────────────────────
// The Journey screen's own milestones (p2p_get_activity_timeline): first
// lesson, first module, first disciple, first fruit — in that order. A
// milestone is complete only when the server has a date for it; nothing here
// marks anything complete.
export type MilestoneKey = "firstLesson" | "firstModule" | "firstMentee" | "firstFruit";
export const MILESTONES: { key: MilestoneKey; goal: string; route: string; action: string }[] = [
  { key: "firstLesson", goal: "Complete your first Kingdom School lesson", route: "/(tabs)/learn", action: "Open Kingdom School" },
  { key: "firstModule", goal: "Complete your first Kingdom School module", route: "/(tabs)/learn", action: "Continue Kingdom School" },
  { key: "firstMentee", goal: "Begin guiding your first disciple", route: "/connect", action: "Find someone to guide" },
  { key: "firstFruit", goal: "Receive your first Fruit of the Spirit award", route: "/my-discipleship/journey", action: "See how fruit is earned" },
];
export type Timeline = Partial<Record<MilestoneKey, { label: string; at: string | null }>> | null;

export function journeyMilestones(t: Timeline) {
  const list = MILESTONES.map((m) => ({ ...m, done: !!t?.[m.key]?.at, at: t?.[m.key]?.at ?? null, label: t?.[m.key]?.label ?? m.goal }));
  const done = list.filter((m) => m.done).length;
  const next = list.find((m) => !m.done) ?? null;
  return { list, done, total: list.length, next, started: done > 0 };
}

/** Growth stage progress (same rule as the Home growth card). */
export function stageProgress(points: number, stages: { name: string; unlockPoints: number }[], index: number) {
  const stage = stages[index];
  const nextStage = stages[index + 1] ?? null;
  const pct = nextStage ? Math.max(0, Math.min(100, Math.round(((points - stage.unlockPoints) / (nextStage.unlockPoints - stage.unlockPoints)) * 100))) : 100;
  return { stage, nextStage, pct, number: index + 1, of: stages.length };
}

/** A short single-line preview (never more than `max` characters). */
export function previewText(text: string | null | undefined, max = 90): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Notification types shown in P2P Updates (others stay in the Notification Center). */
export const UPDATE_TYPES = new Set([
  "shared_study_invite", "shared_study_accepted", "shared_study_declined", "shared_study_started",
  "study_invitation_received", "family_invitation", "family_join_approved", "family_worship_invite", "church_announcement",
  "circle_member_added", "assignment_reviewed", "evaluation_resolved", "lesson_completed", "fruit_awarded",
]);
