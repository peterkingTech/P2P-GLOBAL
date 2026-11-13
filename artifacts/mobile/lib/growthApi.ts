import { apiRequest } from "@/lib/apiClient";

// Your growth milestones (GET /growth/me — migrations 235–239). The milestone is
// calculated on the server from verified evidence in four independent
// dimensions; the app only shows it.

export interface GrowthStageInfo { stage: number; key: string; name: string; emoji: string; description: string; verse: string; verseRef: string }
export interface GrowthChecklistItem { key?: string; label: string; met: boolean; have: number; need: number; percent?: number; remaining?: number; explanation?: string | null; missing?: string | null }
export interface StageObjective { title: string; objective: string; focus: string[] }
export interface GrowthDimension { dimension: "consistency" | "learning" | "application" | "service"; label: string; required: boolean; met: boolean; items: GrowthChecklistItem[] }
export interface GrowthVerified {
  activeWeeks: number; activeMonths: number; learningUnits: number; coreLessons: { passed: number; total: number; percent?: number };
  practicalActions: number; contributions: number; pendingReview: number; pausedNow: boolean;
}
export interface GrowthPause { id: string; startsOn: string; endsOn: string; reason: string; current: boolean; upcoming: boolean }
export interface GrowthJourney {
  explanation?: string;
  disclaimer?: string;
  stage: GrowthStageInfo & { objective?: StageObjective; since: string; verification: "verified" | "legacy_unverified" | "exception"; legacyNote: string | null };
  next: (GrowthStageInfo & { objective?: StageObjective; eligible?: boolean; dimensions: GrowthDimension[] }) | null;
  verified?: GrowthVerified;
  milestones: "draft" | "approved";
  promotionsEnabled: boolean;
  history: { stage: number; name: string; achievedAt: string; kind: "automatic" | "legacy_import" | "correction" }[];
  pauses?: GrowthPause[];
  shareCountryInCollective?: boolean;
  collective: { name: string; emoji: string; description: string; verse: string; verseRef: string; note: string; objective?: { title: string; objective: string } };
  evaluatedAt: string | null;
}

// The exact wording (also returned by the server); kept here so it shows offline and before loading.
export const MILESTONE_EXPLANATION =
  "Growth milestones celebrate how you take part in P2P Global: how consistently you participate, what you learn, how you put learning into practice, and how you help others learn. They are a record of participation and contribution on P2P Global — nothing more.";
export const MILESTONE_DISCLAIMER =
  "These milestones do not measure your relationship with God, your faith, or your worth. Only God knows the heart. They simply recognise the activity you've chosen to record here.";

export const getGrowthJourney = () => apiRequest<GrowthJourney>("/growth/me", {}, { fallbackError: "Couldn't load your growth journey." });
export const startGrowthPause = (startsOn: string, endsOn: string, reason: string) =>
  apiRequest<{ id: string }>("/growth/me/pause", { method: "POST", body: JSON.stringify({ startsOn, endsOn, reason }) }, { fallbackError: "Couldn't pause your milestones." });
export const endGrowthPause = (id: string) =>
  apiRequest<{ ended: boolean }>(`/growth/me/pause/${encodeURIComponent(id)}/end`, { method: "POST" }, { fallbackError: "Couldn't end the pause." });
export const setShareCountryInCollective = (share: boolean) =>
  apiRequest<{ shareCountryInCollective: boolean }>("/growth/me/collective-country", { method: "PUT", body: JSON.stringify({ share }) }, { fallbackError: "Couldn't save that." });

export type CoreStatus = "passed" | "awaiting_evaluation" | "returned" | "answer_again" | "not_yet_passed" | "submitted" | "in_progress" | "not_started";
export interface CoreFoundations {
  name: string; passed: number; total: number; percent: number; outstanding: number; counts: Partial<Record<CoreStatus, number>>; note: string;
  modules: { id: string; title: string; curriculumId?: string; curriculumTitle?: string; lessons: { id: string; title: string; status: CoreStatus; statusLabel: string; passedAt: string | null }[] }[];
  /** Kingdom School Foundations is every published Kingdom School curriculum (e.g. Peer-to-Peer Orientation, The Gospel & Salvation, The Christian Foundation). */
  curricula?: { id: string; title: string; passed: number; total: number; percent: number; modules: CoreFoundations["modules"] }[];
  next: { id: string; title: string; status: CoreStatus } | null;
}
export const getCoreFoundations = () => apiRequest<CoreFoundations>("/growth/me/core-foundations", {}, { fallbackError: "Couldn't load the Core Foundations Curriculum." });

export interface HistoryPerson { id: string | null; name: string; photoUrl: string | null; private: boolean; stage: { number: number; name: string; emoji: string } | null }
export interface HistoryCheckpoint { kind: string; at: string; participantStage: string | null; guideStage: string | null; recorded: boolean; correction: boolean; changed: string | null; note: string | null }
export interface DevelopmentHistory {
  person: HistoryPerson; currentStage: { name: string; since: string; verification: string } | null;
  guides: { linkId: string; guide: HistoryPerson; status: string; isPrimary: boolean; startedAt: string; endedAt: string | null; checkpoints: HistoryCheckpoint[]; verifiedContributions: number }[];
  guiding: { linkId: string; participant: HistoryPerson; status: string; isPrimary: boolean; startedAt: string; endedAt: string | null; checkpoints: HistoryCheckpoint[]; verifiedContributions: number }[];
  contributors: { person: HistoryPerson; verifiedContributions: number; firstAt: string; lastAt: string; designatedGuide: boolean; kinds: string[] }[];
  helped: { person: HistoryPerson; verifiedContributions: number; nowHelpingOthers: boolean }[];
  note: string;
}
export const getDevelopmentHistory = (personId: string = "me") =>
  apiRequest<DevelopmentHistory>(`/genealogy/history/${encodeURIComponent(personId)}`, {}, { fallbackError: "Couldn't load this development history." });

/** "3 weeks" / "2 months" in the current stage — whole units, never a percentage. */
export function timeInStage(since: string, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000));
  if (days < 1) return "since today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.44);
  return months < 24 ? `${months} months` : `${Math.floor(months / 12)} years`;
}

/** One requirement's own percentage (never an average across dimensions); a zero requirement is complete. */
export const percentOf = (have: number, need: number) => (need <= 0 ? 100 : Math.max(0, Math.min(100, Math.floor((have / need) * 100))));
/** "10 / 20 — 50%" for a requirement: fraction and percentage of that requirement only. */
export const progressText = (i: GrowthChecklistItem) => `${Math.min(i.have, i.need)} / ${i.need} — ${i.percent ?? percentOf(i.have, i.need)}%`;

/** A local calendar date, YYYY-MM-DD, `days` from today. */
export function localDate(days = 0, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── My Growth Tree (GET /growth/me/tree) — a VIEW of what the Matrix already verified, never a score ──
export interface TreeFruit {
  /** The evidence ledger record's id: one fruit = one verified action. */
  id: string; type: string; label: string; date: string; area: string; areaLabel: string;
  /** A group session is ONE fruit for its facilitator; peopleHelped is only a count. */
  kind: "group" | "individual"; peopleHelped: number | null;
  status: "verified" | "pending_review" | "rejected" | "withdrawn"; countsTowardMilestone: boolean;
}
export interface GrowthTree {
  stage: GrowthStageInfo & { objective: StageObjective; since: string; verification: string };
  history: { stage: number; name: string; achievedAt: string; kind: string }[];
  roots: { coreLessons: { passed: number; total: number; percent: number }; learningUnits: number; activeWeeks: number; activeMonths: number };
  stems: { practicalActions: number };
  branches: { area: string; label: string; verified: number }[];
  fruits: TreeFruit[];
  fruitTotals: { verified: number; pendingReview: number; withdrawn: number; rejected: number };
  seeds: { ref: string; verifiedContributionsToThem: number; nowHelpingOthers: boolean; firstHelpedOthersOn: string | null }[];
  disclaimer: string; note: string;
}
export const getGrowthTree = () => apiRequest<GrowthTree>("/growth/me/tree", {}, { fallbackError: "Couldn't load your tree." });
