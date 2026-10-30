import AsyncStorage from "@react-native-async-storage/async-storage";

// Learning data shapes and pure Kingdom School progress rules, shared by
// DataContext (which re-exports everything here) and any screen that needs
// them without the provider.


export type SubmissionType = "text" | "audio" | "video";

export interface Module {
  id: string;
  curriculumId: string;
  title: string;
  description: string;
  level: number;
  lessonCount: number;
  completedLessons: number;
  // Lessons with any submission on record (pending, needs_revision, or
  // approved). Display-only — growth credit still counts completedLessons.
  submittedLessons?: number;
  isLocked: boolean;
  imageUrl?: string;
}

// Curriculum redesign — a stand-alone curriculum tile, as opposed to a
// numbered "level." One p2p_curriculums row (type='core'), summarized with
// real module/lesson counts computed from its own modules only (never
// fabricated). Used by the new curriculum.tsx list screen and
// curriculum/[id].tsx detail screen — deliberately separate from the
// existing modules/lessons global state (which stays scoped to the single
// "active" curriculum other features like Continue Learning already
// depend on) so this addition can't regress anything already working.
export interface CurriculumCatalogItem {
  id: string;
  title: string;
  description: string;
  colorTheme: string;
  coverImage: string | null;
  icon: string | null;
  moduleCount: number;
  lessonCount: number;
  estimatedMinutes: number;
  // Whether this whole curriculum is reachable yet under Kingdom School's
  // sequential progression (see getKingdomSchoolLockState) — false for the
  // curriculum the learner is currently on or has already finished, true
  // for anything still ahead of them in curriculum display_order.
  isLocked: boolean;
}

// One deterministic Kingdom School progression model spanning every
// published core curriculum, keyed by id — see getKingdomSchoolLockState.
export interface KingdomSchoolLockState {
  lessonLocked: Map<string, boolean>;
  moduleLocked: Map<string, boolean>;
  curriculumLocked: Map<string, boolean>;
  curriculumOrder: string[];
}

// Unified plans system — a Plan IS a p2p_curriculums row (type='plan'), the
// same table/API as core curriculum (see migration 041_unify_plans_system.sql
// and curriculum.ts's GET /plans). There is no second table/system anymore.
export interface Plan {
  id: string;
  title: string;
  description: string | null;
  subtitle: string | null;
  coverImageUrl: string | null;
  thumbnailUrl: string | null;
  colorTheme: string;
  tags: string[];
  isFeatured: boolean;
  difficultyLevel: string;
  estimatedWeeks: number | null;
  teachingCreditName: string | null;
  teachingCreditRole: string | null;
  teachingCreditChurch: string | null;
  teachingCreditLocation: string | null;
  teachingCreditYoutube: string | null;
  teachingCreditInstagram: string | null;
  status: string;
  displayOrder: number | null;
  moduleCount: number;
  lessonCount: number;
}

// ── Plan categories (migration 054_plan_categories.sql / 055_plan_locking.sql) ──
// The 10 top-level collections that group individual topic plans
// (p2p_curriculums rows with type='plan_category'), each with a sequential
// per-category unlock chain — see resolveLockStatus() in curriculum.ts.
export interface PlanCategory {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  colorTheme: string;
  coverImage: string | null;
  displayOrder: number | null;
  planCount: number;
  totalLessons: number;
}

export interface PlanWithLockStatus {
  id: string;
  title: string;
  description: string | null;
  subtitle: string | null;
  topicNumber: number | null;
  moduleCount: number;
  lessonCount: number;
  difficultyLevel: string;
  estimatedWeeks: number | null;
  locked: boolean;
  unlockMessage: string | null;
  progressPercent: number;
}

export interface PlanSearchResult {
  id: string;
  title: string;
  topicNumber: number | null;
  categoryId: string | null;
  categoryTitle: string | null;
  categoryColorTheme: string;
  moduleCount: number;
  lessonCount: number;
  locked: boolean;
  unlockMessage: string | null;
  matchType: "exact" | "partial" | "content";
}

export interface PlanWithCategory {
  id: string;
  title: string;
  topicNumber: number | null;
  categoryId: string | null;
  categoryTitle: string | null;
  categoryColorTheme: string;
  locked: boolean;
}

// ── 7 Mountains mapping (Dashboard activity tracking) ───────────────────────
// p2p_curriculums has no dedicated category column, only freeform `tags` —
// same honest, non-fabricated taxonomy substitute already used elsewhere in
// this codebase (Plans hub category browsing, recommendation engine).
const MOUNTAIN_MAP: Record<string, string> = {
  business: "Marketplace",
  education: "Education",
  government: "Government",
  media: "Media",
  technology: "Innovation",
  family: "Family",
  church: "Church",
};
export function getMountainForPlan(tags: string[]): string | null {
  for (const tag of tags) {
    const mountain = MOUNTAIN_MAP[tag.toLowerCase()];
    if (mountain) return mountain;
  }
  return null;
}

// ── Kingdom School status (Core Curriculum rebrand) ─────────────────────────
// Pure, stateless — callers pass in whatever counts they already have from
// `modules` rather than this file computing them, since the same numbers are
// needed in different shapes on Home, Learn, and Profile.
export type KingdomSchoolStatus =
  | "exploring"
  | "enrolled"
  | "in_progress"
  | "foundation_complete"
  | "guiding_others";

export function getKingdomSchoolStatus(
  modulesStarted: number,
  modulesCompleted: number,
  totalModules: number,
  hasActiveMentee: boolean
): KingdomSchoolStatus {
  if (totalModules > 0 && modulesCompleted === totalModules) {
    return hasActiveMentee ? "guiding_others" : "foundation_complete";
  }
  if (modulesCompleted >= 1) return "in_progress";
  if (modulesStarted >= 1) return "enrolled";
  return "exploring";
}

export function getFoundationProgress(modulesCompleted: number, totalModules: number): number {
  if (totalModules <= 0) return 0;
  return Math.round((modulesCompleted / totalModules) * 100);
}

export const KINGDOM_SCHOOL_STATUS_LABELS: Record<KingdomSchoolStatus, string> = {
  exploring: "Exploring",
  enrolled: "Enrolled",
  in_progress: "In Progress",
  foundation_complete: "Foundation Complete",
  guiding_others: "Guiding Others",
};

// Derives modulesStarted/modulesCompleted from the Module[] shape everywhere
// else in the app already has, so Home/Learn/Profile don't each reimplement
// the same "what counts as started/completed" rule.
export function getModuleProgressCounts(modules: Module[]): {
  modulesStarted: number;
  modulesCompleted: number;
  totalModules: number;
} {
  const modulesCompleted = modules.filter(
    (m) => m.lessonCount > 0 && m.completedLessons === m.lessonCount
  ).length;
  const modulesStarted = modules.filter(
    (m) => (m.submittedLessons ?? m.completedLessons) > 0
  ).length;
  return { modulesStarted, modulesCompleted, totalModules: modules.length };
}

// AsyncStorage-backed "have we already celebrated this" flag — Prompt 1
// explicitly rules out new DB tables/columns for this rebrand, so the
// Foundation completion date and first-time-reached flag live on-device.
export const FOUNDATION_COMPLETION_KEY_PREFIX = "kingdomSchoolFoundationCompletedAt:";

export async function getFoundationCompletionDate(userId: string): Promise<string | null> {
  return AsyncStorage.getItem(`${FOUNDATION_COMPLETION_KEY_PREFIX}${userId}`);
}

export async function recordFoundationCompletion(
  userId: string
): Promise<{ date: string; isFirstTime: boolean }> {
  const key = `${FOUNDATION_COMPLETION_KEY_PREFIX}${userId}`;
  const existing = await AsyncStorage.getItem(key);
  if (existing) return { date: existing, isFirstTime: false };
  const date = new Date().toISOString();
  await AsyncStorage.setItem(key, date);
  return { date, isFirstTime: true };
}

