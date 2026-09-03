import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, useAuth, type OfficialAccountType, type DiscipleRole } from "./AuthContext";
import { STAGES, getStageFromPoints } from "@/constants/stages";
import { getApiUrl } from "@/lib/apiUrl";
import { authedFetch } from "@/lib/adminFetch";

// ── Types ─────────────────────────────────────────────────────────────────────

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
function getMountainForPlan(tags: string[]): string | null {
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
const FOUNDATION_COMPLETION_KEY_PREFIX = "kingdomSchoolFoundationCompletedAt:";

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

export interface Lesson {
  id: string;
  moduleId: string;
  title: string;
  content: string;
  verseRef?: string;
  verseText?: string;
  isCompleted: boolean;
  isLocked: boolean;
  order: number;
  // Set only when the lesson isn't completed yet but has a submission awaiting
  // or returned from peer review — lets the module list show a third state
  // distinct from both "not started" and "done".
  evaluationStatus?: "pending" | "needs_revision" | null;
}

export interface PrayerRequest {
  id: string;
  userId: string;
  userName: string;
  nation?: string;
  text: string;
  prayerCount: number;
  createdAt: string;
  hasPrayed?: boolean;
}

export type PrayerWallPostType = "request" | "testimony";
export type PrayerWallVisibility = "global" | "peer_group";
export type PrayerWallReactionType = "praying" | "amen";

export interface PrayerWallPost {
  id: string;
  userId: string;
  userName: string;
  postType: PrayerWallPostType;
  nationCode: string | null;
  body: string;
  isAnonymous: boolean;
  visibility: PrayerWallVisibility;
  answeredFromPostId: string | null;
  answeredFromPost: { id: string; body: string; userName: string; isAnonymous: boolean } | null;
  status: "open" | "answered";
  createdAt: string;
  prayingCount: number;
  amenCount: number;
  myReactions: PrayerWallReactionType[];
  commentCount: number;
}

export interface PrayerWallComment {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  body: string;
  createdAt: string;
}

export type HelpRequestTier = "crisis" | "struggling";
export type HelpRequestStatus = "open" | "contacted" | "resolved";

export interface HelpRequest {
  id: string;
  userId: string | null;
  userName: string;
  tier: HelpRequestTier;
  category: string | null;
  note: string | null;
  status: HelpRequestStatus;
  createdAt: string;
}

export type ConversationType = "direct" | "crisis_response" | "help_request" | "pastoral" | "support" | "peer_group" | "circle";

export interface ConversationSummary {
  id: string;
  type: "direct" | "group";
  conversationType: ConversationType;
  name: string | null;
  otherUserId: string | null;
  otherUserVerified: boolean;
  otherUserIsOfficial: boolean;
  otherUserOfficialType: OfficialAccountType | null;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isPinnedBySystem: boolean;
  isPinnedByUser: boolean;
  isFavourite: boolean;
  isMuted: boolean;
}

export interface IncomingMessageBannerInfo {
  conversationId: string;
  messageBody: string;
  senderName: string;
  senderPhotoUrl: string | null;
  senderIsOfficial: boolean;
  senderOfficialType: OfficialAccountType | null;
}

export interface AdminFeedbackInput {
  conversationId: string;
  helpRequestId?: string | null;
  adminUserId: string;
  rating: number;
  wasTimely: boolean;
  wasRespectful: boolean;
  wasHelpful: boolean;
  wasRude: boolean;
  didNotAddressConcern: boolean;
  freeText?: string;
}

export interface AdminStats {
  role: string;
  casesHandled: number;
  avgResponseMinutes: number | null;
  avgFeedbackRating: number | null;
  openCases: number;
  weekLabel: string;
}

export interface AdminActivityEntry {
  id: string;
  adminId: string;
  adminName: string;
  adminRole: string;
  actionType: string;
  targetUserId: string | null;
  actionDetail: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAccountEntry {
  id: string;
  username: string | null;
  fullName: string;
  role: string;
  adminZone: string | null;
  adminCountry: string | null;
  adminIsActive: boolean;
  adminAppointedAt: string | null;
  lastActiveAt: string | null;
  casesThisWeek: number;
  avgRating: number | null;
}

// ── Church Discipleship Portal — completely free, no tiers ──────────────────
export type ChurchRole = "senior_pastor" | "discipleship_pastor" | "small_group_leader" | "peer_guide" | "member";

export interface Church {
  id: string; name: string; description: string | null; logoUrl: string | null; website: string | null;
  city: string | null; country: string; countryCode: string | null; timezone: string | null;
  denomination: string | null; languageCode: string; contactEmail: string | null; contactName: string | null;
  inviteCode: string; inviteLink: string; status: string; isVerified: boolean; verifiedAt: string | null;
  createdAt: string; createdBy: string;
  churchType: string | null; churchTypeOther: string | null; locationHidden: boolean; churchSlug: string | null;
}

export interface ChurchSocialAccountData { platform: string; handleOrUrl: string }
export interface ChurchSocialAccount extends ChurchSocialAccountData { id: string; churchId: string; displayOrder: number }

export interface ChurchRegistrationData {
  name: string; description?: string; city?: string; country: string; countryCode?: string;
  timezone?: string; denomination?: string; languageCode?: string;
  contactEmail?: string; contactName?: string; website?: string;
  churchType?: string; churchTypeOther?: string; locationHidden?: boolean; logoUrl?: string;
  socialAccounts?: ChurchSocialAccountData[];
}

// Editable subset of a church's own fields — used by updateChurch(), which
// backs the creator-only General/Profile/Branding settings screens.
export interface ChurchUpdateData {
  name?: string; description?: string; churchType?: string; churchTypeOther?: string; website?: string;
  contactName?: string; contactEmail?: string; city?: string; country?: string; countryCode?: string;
  timezone?: string; denomination?: string; languageCode?: string; locationHidden?: boolean; logoUrl?: string;
}

export type LearningGoalLevel = "lesson" | "module" | "curriculum";
export type LearningGoalTimeframe = "today" | "this_week" | "this_month" | "custom";
export type LearningGoalTargetType = "percentage" | "member_count";

export interface LearningGoal {
  id: string; churchId: string; createdBy: string; title: string;
  goalLevel: LearningGoalLevel; lessonId: string | null; moduleId: string | null; curriculumId: string | null;
  timeframe: LearningGoalTimeframe; startsAt: string; endsAt: string;
  targetType: LearningGoalTargetType; targetValue: number; status: "active" | "completed" | "archived"; createdAt: string;
  completedCount?: number; totalMembers?: number; progressPercent?: number; achieved?: boolean;
}

export interface LearningGoalCreateData {
  title: string; goalLevel: LearningGoalLevel; lessonId?: string; moduleId?: string; curriculumId?: string;
  timeframe: LearningGoalTimeframe; startsAt?: string; endsAt?: string;
  targetType: LearningGoalTargetType; targetValue: number;
}

export interface GroveData {
  stageCounts: Record<string, number>;
  activeLearners: number; lessonsThisWeek: number; modulesCompletedTotal: number; newMembersThisMonth: number;
  activePeerGuides: number; nationsReached: number; totalGrainPlanted: number; totalFruitsEarned: number;
  inactiveMembers: number; newBelieversWithoutGuides: number; deepestDiscipleshipChain: number;
  recentActivity: { userDisplayName: string; action: string; createdAt: string }[];
}

export interface ChurchMember {
  userId: string; role: ChurchRole; visible: boolean; joinedAt: string;
  username?: string | null; displayName?: string; photoUrl?: string | null; country?: string | null;
  treeStage?: string; lastActiveAt?: string | null; hasPeerGuide?: boolean; fruitsCount?: number; grainCount?: number;
}

export interface ChurchMemberProfile {
  userId: string; username: string | null; displayName: string; photoUrl: string | null; country: string | null;
  treeStage: string; growthLevel: number; lastActiveAt: string | null;
  peerGuide: { username: string | null; displayName: string | null; country: string | null } | null;
  guidingCount: number; nationsGuided: number;
  fruits: { key: string; awardedAt: string }[]; grainCount: number;
  cohorts: { cohortId: string; status: string; name: string }[]; adminNotes: string | null;
}

export interface ChurchCohort {
  id: string; churchId: string; name: string; description: string | null;
  curriculumId: string | null; moduleId: string | null; leaderId: string | null;
  targetStartDate: string | null; targetEndDate: string | null; maxMembers: number | null;
  status: string; createdAt: string; memberCount?: number; leaderUsername?: string | null; leaderName?: string | null;
}

export interface ChurchCohortData {
  name: string; description?: string; curriculumId?: string; moduleId?: string; leaderId?: string;
  targetStartDate?: string; targetEndDate?: string; maxMembers?: number;
}

export type ChurchAnnouncementType =
  "general" | "bible_study" | "discipleship" | "prayer" | "learning_goal" | "study_plan" | "event" | "important" | "reminder" | "other";
export type ChurchAnnouncementStatus = "draft" | "scheduled" | "published" | "archived";

export interface ChurchAnnouncement {
  id: string; churchId: string; title: string; body: string; authorId: string; authorName: string | null;
  isPinned: boolean; createdAt: string; expiresAt: string | null;
  announcementType: ChurchAnnouncementType; announcementTypeOther: string | null;
  imageUrl: string | null; videoUrl: string | null; publishAt: string | null;
  status: ChurchAnnouncementStatus; isFeatured: boolean; audience: string; updatedAt: string;
}

export interface ChurchAnnouncementCreateData {
  title: string; body: string; expiresAt?: string; announcementType?: ChurchAnnouncementType;
  announcementTypeOther?: string; imageUrl?: string; videoUrl?: string; publishAt?: string; isFeatured?: boolean;
}

export type ContactDepartment = "help_request" | "crisis_response" | "p2p_support" | "marketing";
export type ContactMessageStatus = "unread" | "read" | "replied" | "forwarded" | "closed";
export type ContactPriority = "normal" | "high" | "urgent";

export interface ContactMessage {
  id: string; referenceNumber: string; fromUserId: string; toDepartment: ContactDepartment;
  subject: string; body: string; attachmentUrl: string | null; attachmentType: "image" | "pdf" | null;
  status: ContactMessageStatus; priority: ContactPriority; assignedTo: string | null;
  forwardedFrom: string | null; forwardedNote: string | null; originalDepartment: string | null;
  feedbackRequested: boolean; feedbackSubmitted: boolean; isArchived: boolean; createdAt: string; updatedAt: string;
}
export interface ContactMessageListItem extends ContactMessage {
  bodyPreview: string; replyCount: number; latestReplyAt: string | null;
}
export interface ContactAdminInboxItem extends ContactMessage {
  bodyPreview: string; fromUsername: string | null; fromDisplayName: string; fromPhotoUrl: string | null;
  fromCountry: string | null; fromMinistryRole: string | null; fromTreeStage: string;
  fromIsVerified: boolean; fromAccountAgeDays: number | null; isStarredByMe: boolean;
}
export interface ContactReply {
  // fromAdminId/fromAdminUsername are only present in admin-facing responses
  // (ContactAdminMessageDetail) -- the peer-facing thread (ContactThread)
  // never receives the real admin's identity, only fromDepartment (rendered
  // as an official identity badge, never a personal name).
  id: string; messageId: string; fromAdminId?: string; fromAdminUsername?: string | null;
  fromDepartment: string; body: string; isInternalNote: boolean; createdAt: string;
}
export interface ContactNote {
  id: string; messageId: string; adminId: string; adminUsername: string | null; noteText: string; createdAt: string;
}
export interface ContactThread { message: ContactMessage; replies: ContactReply[] }
export interface ContactAdminMessageDetail {
  message: ContactAdminInboxItem & { fromModulesCompleted: number };
  replies: ContactReply[]; notes: ContactNote[];
}
export interface ContactMessageSendData { toDepartment: ContactDepartment; subject: string; body: string; attachmentUrl?: string; attachmentType?: "image" | "pdf" }
export interface ContactMessageSendResult { success: boolean; referenceNumber?: string; estimatedResponse?: string; error?: string }
export interface ContactWeekStats { received: number; replied: number; closed: number; forwarded: number }
export interface ContactDeptStats {
  totalUnread: number; totalOpen: number; totalReplied: number; totalClosed: number;
  overdue: number; avgResponseHours: number; thisWeek: ContactWeekStats;
}

// Admin → User official messages (Compose) — separate from Contact P2P
// Global above. Reuses the existing p2p_conversations/p2p_messages +
// official-account system (see officialMessages.ts), so there's no
// dedicated "thread" type here — the resulting message just shows up in
// the normal conversations list/thread with an OfficialBadge, like any
// other official-account DM. Compose's department is a distinct concept
// from official_account_type: department is what the admin picks, and the
// server derives the actual sending identity (which OfficialBadge shows)
// from it automatically.
export type ComposeDepartment =
  | "support_help" | "crisis_safeguarding" | "account_security"
  | "report_user" | "feedback_suggestions" | "general_contact";
export interface OfficialMessageSendData {
  targetUserId: string; department: ComposeDepartment; subject: string; body: string; draftId?: string;
}
export interface OfficialMessageSendResult { success: boolean; conversationId?: string; error?: string }
export interface OfficialMailDraft {
  id: string; targetUserId: string | null; targetUsername: string | null;
  department: ComposeDepartment | null; subject: string; body: string;
  createdAt: string; updatedAt: string;
}
export interface OfficialMailDraftSaveData {
  draftId?: string; targetUserId?: string; targetUsername?: string;
  department?: ComposeDepartment; subject?: string; body?: string;
}
export interface OfficialMailDraftSaveResult { draftId: string | null; error: string | null }
export interface SentOfficialMessage {
  id: string; conversationId: string; subject: string; department: ComposeDepartment;
  bodyPreview: string; createdAt: string; sentByAdminUsername: string | null;
  recipientUserId: string | null; recipientUsername: string | null; recipientFullName: string | null;
  isRead: boolean;
}
export interface ComposeUserSearchResult {
  userId: string; username: string; fullName: string | null; photoUrl: string | null; email: string | null;
}
export interface OfficialMailThreadMessage {
  id: string; isFromOfficial: boolean; body: string; createdAt: string; sentByAdminUsername: string | null;
}
export interface OfficialMailThread {
  conversationId: string | null; subject: string | null; department: ComposeDepartment | null;
  messages: OfficialMailThreadMessage[];
}

export type ModerationFlagStatus = "open" | "dismissed" | "warned" | "removed" | "escalated";
export type ModerationContentType = "prayer_post" | "prayer_comment" | "message" | "profile";

export interface ModerationPosterIdentity {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalFlags: number;
  dismissedCount: number;
  warnedCount: number;
  removedCount: number;
  escalatedCount: number;
}

export interface ModerationFlag {
  id: string;
  contentType: ModerationContentType;
  contentId: string;
  authorId: string | null;
  reporterId: string | null;
  reporterName: string | null;
  reason: string | null;
  contentSnapshot: string | null;
  status: ModerationFlagStatus;
  createdAt: string;
  poster: ModerationPosterIdentity | null;
}

export interface TeamProfile {
  id: string;
  fullName: string;
  email: string | null;
  role: string;
  isCrisisResponder: boolean;
}

export interface DiscoverablePeer {
  id: string;
  fullName: string;
  country: string | null;
  role: string;
  gifts: string[];
  skills: string[];
  photoUrl: string | null;
}

export interface UsernameSearchResult {
  userId: string;
  username: string;
  fullName: string | null;
  photoUrl: string | null;
  country: string | null;
}

export interface PublicUserProfile {
  userId: string; username: string; fullName: string | null; photoUrl: string | null;
  country: string | null; countryCode: string | null; bio: string | null;
  isPeerGuideEligible: boolean; joinedAt: string; showProgressPublicly: boolean;
  growthLevel: number | null; modulesCompleted: number | null; fruitCount: number | null;
  activeMenteesCount: number | null; isVerified: boolean;
}

export type VerificationStatusValue = "unverified" | "pending" | "approved" | "declined" | "revoked";

export interface VerificationStatus {
  status: VerificationStatusValue;
  method: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  declineReason: string | null;
  canReapplyAt: string | null;
  attemptNumber: number;
  isVerified: boolean;
  badgeVisible: boolean;
}

export interface BlockedUserEntry {
  userId: string;
  username: string | null;
  fullName: string;
  blockedAt: string;
}

export interface PeerGroup {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  isMember: boolean;
  peerGuideId: string | null;
  isCreator: boolean;
}

export interface GroupMember {
  userId: string;
  fullName: string;
  role: string;
  photoUrl: string | null;
}

export interface UserNote {
  id: string;
  title: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  // Study Together C6 — lesson-scoped notes. Optional/nullable: every note
  // created before this addition (and every general note going forward)
  // simply has none of these set, same as today.
  lessonId: string | null;
  lessonTitle: string | null;
  moduleId: string | null;
  studySessionId: string | null;
}

export interface UserHighlight {
  id: string;
  reference: string;
  quote: string | null;
  createdAt: string;
  lessonId?: string | null;
  lessonTitle?: string | null;
  sectionId?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  color?: string;
}

export interface JournalReflection {
  id: string;
  rootId: string;
  parentId: string | null;
  prompt: string | null;
  content: string;
  linkedLessonId: string | null;
  linkedLessonTitle?: string | null;
  createdAt: string;
}

export interface AppNotification {
  id: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: string;
  notificationType: string | null;
  data: Record<string, unknown> | null;
}

export interface JournalTimelineEntry {
  type: "note" | "highlight" | "prayer" | "reflection";
  id: string;
  title: string;
  preview: string;
  at: string;
}

export interface StudySession {
  id: string;
  title: string;
  description?: string;
  scheduledAt: string;
  durationMinutes: number;
  participantCount: number;
  isLive: boolean;
  hostName: string;
}

export interface ForestNode {
  id: string;
  name: string;
  role: string;
  growthLevel: number;
  country?: string;
  depth: number;
  children: ForestNode[];
  username?: string | null;
  isVerified?: boolean;
}

// ── Living Tree (real SVG visualization) ────────────────────────────────────
export type GrowthStage = "seed" | "sprout" | "young_tree" | "fruitful_tree" | "forest_builder";
export type HealthStatus = "healthy" | "drought" | "wilting" | "dormant";

export interface MenteeBranchInfo {
  id: string;
  name: string;
  currentModule: string | null;
  daysAgo: number;
  isWilting: boolean;
}

export interface TreeData {
  lessonsCompleted: number;
  modulesCompleted: number;
  activeDays: number;
  activeMentees: number;
  wiltingMentees: number;
  fruitCount: number;
  fruitKeys: string[];
  secondGenDisciples: number;
  lastActiveAt: string | null;
  joinedAt: string | null;
  streakDays: number;
  rootDepth: number;
  trunkHeight: number;
  branchCount: number;
  canopySize: number;
  growthStage: GrowthStage;
  healthStatus: HealthStatus;
  daysInactive: number;
}

function computeGrowthStage(modulesCompleted: number, activeMentees: number, fruitCount: number, secondGenDisciples: number): GrowthStage {
  // Checked from most- to least-advanced — the given rules overlap (e.g. a
  // fruitful_tree case also satisfies young_tree), so the highest qualifying
  // stage must win.
  if (modulesCompleted === 12 && secondGenDisciples >= 1) return "forest_builder";
  if (modulesCompleted >= 9 && activeMentees >= 2 && fruitCount >= 5) return "fruitful_tree";
  if (modulesCompleted >= 4 && activeMentees >= 1) return "young_tree";
  if (modulesCompleted >= 1 || activeMentees >= 1) return "sprout";
  return "seed";
}

function computeHealthStatus(daysInactive: number): HealthStatus {
  // dormant's range (>=60) is a subset of wilting's stated range (>=30), so
  // the more severe status must be checked first.
  if (daysInactive >= 60) return "dormant";
  if (daysInactive >= 30) return "wilting";
  if (daysInactive >= 14) return "drought";
  return "healthy";
}

function buildTreeData(raw: Record<string, unknown>): TreeData {
  const modulesCompleted = (raw.modulesCompleted as number) ?? 0;
  const activeMentees = (raw.activeMentees as number) ?? 0;
  const wiltingMentees = (raw.wiltingMentees as number) ?? 0;
  const fruitCount = (raw.fruitCount as number) ?? 0;
  const secondGenDisciples = (raw.secondGenDisciples as number) ?? 0;
  const activeDays = (raw.activeDays as number) ?? 0;
  const lastActiveAt = (raw.lastActiveAt as string) ?? null;
  const daysInactive = lastActiveAt
    ? Math.floor((Date.now() - new Date(lastActiveAt).getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  return {
    lessonsCompleted: (raw.lessonsCompleted as number) ?? 0,
    modulesCompleted,
    activeDays,
    activeMentees,
    wiltingMentees,
    fruitCount,
    fruitKeys: (raw.fruitKeys as string[]) ?? [],
    secondGenDisciples,
    lastActiveAt,
    joinedAt: (raw.joinedAt as string) ?? null,
    streakDays: (raw.streakDays as number) ?? 0,
    rootDepth: Math.min(modulesCompleted, 12),
    trunkHeight: Math.min(100, Math.round((activeDays / 60) * 100)),
    branchCount: activeMentees,
    canopySize: activeMentees + secondGenDisciples,
    growthStage: computeGrowthStage(modulesCompleted, activeMentees, fruitCount, secondGenDisciples),
    healthStatus: computeHealthStatus(daysInactive),
    daysInactive,
  };
}

// A catalog row describes every possible fruit, earned or not — the display
// screen merges this with a user's earned rows and progress rows to render
// the full "My Fruits" journey (see app/fruit.tsx and app/fruit/[fruitKey].tsx).
export interface FruitCatalogEntry {
  fruitKey: string;
  name: string;
  description: string;
  category: "personal_growth" | "community" | "multiplication" | "faithfulness" | "kingdom_influence" | "special" | "legendary";
  verificationLevel: "system" | "peer" | "mentor";
  rarity: "common" | "rare" | "epic" | "legendary";
  icon: string;
  themeVerse: string | null;
  themeVerseText: string | null;
  biblicalMeaning: string | null;
  unlockConditionDescription: string | null;
  isHidden: boolean;
  displayOrder: number | null;
}

export interface EarnedFruit {
  fruitKey: string;
  awardedAt: string;
  awardedBy: "system" | "peer" | "mentor" | "admin";
  evidence: Record<string, unknown>;
  evidenceSummary: string | null;
}

export interface FruitProgressEntry {
  fruitKey: string;
  currentCount: number;
  requiredCount: number;
}

// One queued celebration moment — built the instant a new p2p_user_fruits
// row is seen over realtime, merging the award row with its catalog display
// info (and, for mentor-awarded fruits, the mentee's first name).
export interface FruitCelebration {
  fruitKey: string;
  name: string;
  icon: string;
  themeVerse: string | null;
  evidenceSummary: string | null;
  menteeName: string | null;
}

// One queued "you finished every plan in this category" moment — detected
// client-side (see checkCategoryCompletion) rather than a server-computed
// flag, since a category's completeness depends on the live progress of
// every plan inside it, which the plans-with-progress endpoint already
// computes per-user on each fetch.
export interface CategoryCompletion {
  categoryId: string;
  categoryTitle: string;
  categoryColorTheme: string;
  planCount: number;
}

export type PeerConfirmationType = "encouragement" | "compassion" | "service" | "fellowship" | "unity" | "global";

// A pending confirmation the current user needs to action — someone else's
// real action (feedback, prayer, session, mentoring) that only THIS user can
// vouch actually happened/helped. One tap either way; no essay required.
export interface PendingPeerConfirmation {
  id: string;
  confirmationType: PeerConfirmationType;
  actorId: string;
  actorName: string;
  actorPhotoUrl: string | null;
  contextSummary: string | null;
  createdAt: string;
  expiresAt: string | null;
}

// A ringing call for the current user — set the instant a new
// p2p_incoming_calls row targeting them is seen over realtime (see the
// subscription below), cleared once the incoming-call screen navigates away
// (accepted/declined/missed). Modeled on the fruitCelebrationQueue pattern
// just above, but single-slot rather than a queue — only one call rings at
// a time. "audio"/"video" are peer-initiated; "pastoral" and "crisis" carry
// the special rules built out in the pastoral-care/Watchtower integration.
export type CallType = "audio" | "video" | "pastoral" | "crisis";
export interface IncomingCallInfo {
  callId: string;
  channelName: string;
  callType: CallType;
  callerId: string;
  callerName: string;
  conversationId: string | null;
  callLogId: string | null;
  // Study Together C2 — set only when this ringing row was created by an
  // Add People invitation (not an ordinary 1:1 call); tells
  // call/incoming.tsx to run the invitation-accept flow before navigating.
  invitationId: string | null;
}

// A Peer Circle "Start Session" invite banner for the current user — set the
// instant a p2p_notifications row of type circle_session_start targeting them
// is seen over realtime. Modeled on incomingCall above, but dismissible
// (tapping away just clears the banner, it doesn't count as a missed call).
export interface CircleSessionInvite {
  notificationId: string;
  circleId: string;
  circleName: string;
  channelName: string;
}

export interface Mission {
  id: string;
  title: string;
  nation: string;
  population: string;
  description: string;
  prayerCount: number;
  language: string;
  religion: string;
}

export interface Assignment {
  id: string;
  lessonId: string;
  title: string;
  instructions: string;
}

export interface AssignmentQuestion {
  id: string;
  question: string;
}

export interface PendingEvaluation {
  id: string;
  submissionId: string;
  lessonId: string;
  lessonTitle: string;
  submitterId: string;
  submitterName: string;
  submissionType: SubmissionType;
  content: string;
  mediaUrl: string | null;
  durationSeconds: number | null;
  assignedAt: string;
  // The original assignment question this answer responds to. Null when the
  // lesson's assignment has no discrete questions.
  questionText: string | null;
  // Historical: Plans used to have a separate mirrored evaluation gate
  // (p2p_plan_lesson_evaluations). Migration 041 unified Plans into
  // p2p_curriculums, so every submission now goes through the same
  // p2p_lesson_evaluations table and this is always "core".
  source: "core" | "plan";
}

// Deliberately narrow: name, avatar, growth stage, streak, and this
// submission's in-curriculum/plan position — enough to give an evaluator real
// context without exposing registration/spiritual-background intake
// (p2p_registration_profiles), other reflections/submissions, help-request
// history, or any other private profile field. Same restraint already
// applied to getAllProfiles()/moderator access.
export interface SubmitterEvaluationContext {
  submitterId: string;
  fullName: string;
  photoUrl: string | null;
  growthStageName: string;
  growthStageEmoji: string;
  streakDays: number;
  contextLabel: string;
}

export interface SubmissionStatus {
  submissionId: string;
  submissionType: SubmissionType;
  content: string;
  mediaUrl: string | null;
  durationSeconds: number | null;
  evaluationStatus: "pending" | "approved" | "needs_revision" | null;
  feedback: string | null;
  selfApproved: boolean;
}

export interface QuestionSubmission {
  id: string;
  questionId: string;
  submissionType: SubmissionType;
  textContent: string | null;
  mediaUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  // Only ever populated for assignment-kind submissions — reflection
  // questions are never peer-evaluated (see p2p_assign_evaluator_on_submission).
  evaluationStatus?: "pending" | "approved" | "needs_revision" | null;
  feedback?: string | null;
  selfApproved?: boolean;
}

export interface MySubmission {
  id: string;
  lessonId: string;
  lessonTitle: string;
  submissionType: SubmissionType;
  content: string;
  mediaUrl: string | null;
  durationSeconds: number | null;
  createdAt: string;
  evaluationStatus: "pending" | "approved" | "needs_revision" | null;
  feedback: string | null;
  selfApproved: boolean;
  // Which system this came from — core curriculum or the separate, mirrored
  // Plans evaluation gate — so the UI can route taps to the right lesson screen.
  source: "core" | "plan";
}

export interface SubmitContentParams {
  lessonId: string;
  assignmentId?: string | null;
  questionId?: string | null;
  assignmentQuestionId?: string | null;
  type: SubmissionType;
  text?: string | null;
  mediaUri?: string | null;
  durationSeconds?: number | null;
}

export type GrowthEventType = "lesson_completed" | "module_completed" | "disciple_gained";

export interface GrowthEvent {
  id: string;
  eventType: GrowthEventType;
  label: string;
  scoreBefore: number;
  scoreAfter: number;
  createdAt: string;
}

export interface ForestStats {
  totalDisciples: number;
  hasDiscipleMaker: boolean;
  countriesReached: string[];
}

// ── Generational Forest View (GET /profiles/:userId/forest) — a richer,
// server-computed lineage than ForestNode/loadForestNetwork above (which is
// an unlimited-depth client-side walk used by the simple list view on
// living-tree.tsx). This one is capped at 3 forward generations + a minimal
// 4th-gen preview, includes backward ancestry, and aggregate stats. ──
export interface ForestPerson {
  userId: string;
  displayName: string;
  photoUrl: string | null;
  country: string | null;
  growthLevel: number;
  lastActiveAt: string | null;
  modulesCompleted: number;
  username: string | null;
  isVerified: boolean;
}
export interface ForestMenteeNode extends ForestPerson {
  mentees: ForestMenteeNode[];
}
export interface ForestAncestor extends ForestPerson {
  generation: number;
}
export interface ForestMinimalPerson {
  userId: string;
  country: string | null;
  growthLevel: number;
}
export interface GenerationalForestData {
  self: ForestPerson & { fruitCount: number };
  mentees: ForestMenteeNode[];
  ancestry: ForestAncestor[];
  stats: {
    totalInLineage: number;
    generationsDeep: number;
    countriesRepresented: string[];
    totalModulesCompletedAcrossLineage: number;
    totalFruitsAcrossLineage: number;
  };
}

interface DataContextValue {
  modules: Module[];
  lessons: Lesson[];
  getCurriculumCatalog: () => Promise<CurriculumCatalogItem[]>;
  loadModuleWithLessons: (moduleId: string, userId?: string) => Promise<{ module: Module; lessons: Lesson[] } | null>;
  loadCurriculumDetail: (curriculumId: string, userId?: string) => Promise<{ curriculum: { id: string; title: string; description: string; coverImage: string | null; icon: string | null; colorTheme: string }; modules: Module[] } | null>;
  plans: Plan[];
  featuredPlans: Plan[];
  plansLoading: boolean;
  loadPlans: () => Promise<void>;
  getPlanById: (planId: string) => Plan | undefined;
  getPlanProgress: (planId: string) => number;
  planCategories: PlanCategory[];
  loadPlanCategories: () => Promise<void>;
  getCategoryPlans: (categoryId: string) => Promise<PlanWithLockStatus[]>;
  searchPlans: (query: string) => Promise<PlanSearchResult[]>;
  getAllPlansAZ: () => Promise<PlanWithCategory[]>;
  prayers: PrayerRequest[];
  sessions: StudySession[];
  forestNodes: ForestNode[];
  forestStats: ForestStats;
  forestData: GenerationalForestData | null;
  forestDataLoading: boolean;
  loadForestData: (userId: string) => Promise<void>;
  treeData: TreeData | null;
  treeMentees: MenteeBranchInfo[];
  refreshTreeData: () => Promise<void>;
  pendingCompletionMoment: boolean;
  dismissPendingCompletionMoment: () => void;
  fruitCatalog: FruitCatalogEntry[];
  userFruits: EarnedFruit[];
  fruitProgress: FruitProgressEntry[];
  fruitCount: number;
  missions: Mission[];
  dailyVerse: { ref: string; text: string } | null;
  pendingEvaluations: PendingEvaluation[];
  isLoading: boolean;
  addPrayer: (text: string, nation?: string) => Promise<void>;
  prayForRequest: (id: string) => Promise<void>;
  getPrayerWallPosts: (sort: "recent" | "engaged") => Promise<PrayerWallPost[]>;
  createPrayerWallPost: (params: {
    postType: PrayerWallPostType;
    nationCode?: string | null;
    body: string;
    isAnonymous: boolean;
    visibility: PrayerWallVisibility;
    answeredFromPostId?: string | null;
  }) => Promise<string | null>;
  reactToPost: (postId: string, reactionType: PrayerWallReactionType) => Promise<string | null>;
  markPostAnswered: (postId: string) => Promise<string | null>;
  getComments: (postId: string) => Promise<PrayerWallComment[]>;
  addComment: (postId: string, body: string) => Promise<string | null>;
  submitHelpRequest: (params: {
    tier: HelpRequestTier;
    category?: string | null;
    note?: string | null;
  }) => Promise<string | null>;
  getHelpRequests: (filters?: { tier?: HelpRequestTier; status?: HelpRequestStatus }) => Promise<HelpRequest[]>;
  updateHelpRequestStatus: (id: string, status: HelpRequestStatus) => Promise<string | null>;
  reportContent: (contentType: ModerationContentType, contentId: string, reason: string) => Promise<string | null>;
  getModerationQueue: (status?: ModerationFlagStatus) => Promise<ModerationFlag[]>;
  moderateFlag: (flagId: string, action: "dismiss" | "warn" | "remove" | "escalate", note?: string) => Promise<string | null>;
  getAllProfiles: () => Promise<TeamProfile[]>;
  getCrisisResponderIds: () => Promise<string[]>;
  setCrisisResponder: (userId: string, enabled: boolean) => Promise<string | null>;
  getDiscoverablePeers: (search?: string, skillKeys?: string[]) => Promise<DiscoverablePeer[]>;
  getSmartMatch: () => Promise<DiscoverablePeer | null>;
  getGroups: () => Promise<PeerGroup[]>;
  joinGroup: (groupId: string) => Promise<string | null>;
  leaveGroup: (groupId: string) => Promise<string | null>;
  createGroup: (name: string, description: string | null) => Promise<string | null>;
  getGroupMembers: (groupId: string) => Promise<GroupMember[]>;
  addGroupMember: (groupId: string, userId: string) => Promise<string | null>;
  removeGroupMember: (groupId: string, userId: string) => Promise<string | null>;
  getMyNotes: () => Promise<UserNote[]>;
  addNote: (title: string | null, body: string, context?: { lessonId?: string; moduleId?: string; studySessionId?: string }) => Promise<string | null>;
  updateNote: (id: string, body: string) => Promise<string | null>;
  deleteNote: (id: string) => Promise<string | null>;
  getMyHighlights: () => Promise<UserHighlight[]>;
  addHighlight: (reference: string, quote: string | null) => Promise<string | null>;
  deleteHighlight: (id: string) => Promise<string | null>;
  getHighlightsForLesson: (lessonId: string) => Promise<UserHighlight[]>;
  addSectionHighlight: (params: {
    lessonId: string; sectionId: string; reference: string; quote: string;
    startOffset: number; endOffset: number; color?: string;
  }) => Promise<string | null>;
  getMyReflections: () => Promise<JournalReflection[]>;
  addReflection: (params: { prompt?: string | null; content: string; linkedLessonId?: string | null }) => Promise<string | null>;
  addReflectionUpdate: (rootId: string, parentId: string, content: string) => Promise<string | null>;
  getJournalTimeline: () => Promise<JournalTimelineEntry[]>;
  markLessonComplete: (lessonId: string) => Promise<void>;
  refreshCurriculumData: () => Promise<void>;
  refreshData: () => Promise<void>;
  getAssignmentForLesson: (lessonId: string) => Promise<Assignment | null>;
  getMySubmission: (lessonId: string) => Promise<{ id: string; content: string } | null>;
  getSubmissionStatus: (lessonId: string) => Promise<SubmissionStatus | null>;
  getQuestionSubmissionsForLesson: (lessonId: string) => Promise<QuestionSubmission[]>;
  getAssignmentQuestionsForLesson: (lessonId: string) => Promise<AssignmentQuestion[]>;
  getAssignmentQuestionSubmissionsForLesson: (lessonId: string) => Promise<QuestionSubmission[]>;
  getMySubmissions: () => Promise<MySubmission[]>;
  submitContent: (params: SubmitContentParams) => Promise<string | null>;
  submitAssignment: (assignmentId: string, lessonId: string, content: string) => Promise<string | null>;
  refreshPendingEvaluations: () => Promise<void>;
  resolveEvaluation: (
    evaluationId: string,
    status: "approved" | "needs_revision",
    feedback: string
  ) => Promise<string | null>;
  getSubmitterEvaluationContext: (evaluationId: string) => Promise<SubmitterEvaluationContext | null>;
  toastEvent: GrowthEvent | null;
  celebrationEvent: GrowthEvent | null;
  dismissToastEvent: () => void;
  dismissCelebrationEvent: () => void;
  fruitCelebrationQueue: FruitCelebration[];
  dismissCurrentFruitCelebration: () => void;
  categoryCompletionQueue: CategoryCompletion[];
  dismissCurrentCategoryCompletion: () => void;
  checkCategoryCompletion: (categoryId: string) => Promise<void>;
  pendingConfirmations: PendingPeerConfirmation[];
  pendingConfirmationCount: number;
  confirmPeer: (confirmationId: string) => Promise<string | null>;
  declinePeer: (confirmationId: string) => Promise<string | null>;
  incomingCall: IncomingCallInfo | null;
  dismissIncomingCall: () => void;
  circleSessionInvite: CircleSessionInvite | null;
  dismissCircleSessionInvite: () => void;
  // Study Together C7 — Notification Center. unreadNotificationCount updates
  // live via the same RLS-protected direct-client realtime subscription
  // pattern already used for circleSessionInvite above; the list/read
  // actions go through the new JWT-verified /notifications/me endpoints
  // (never the legacy :userId-trusting ones) since identity here must come
  // from the real authenticated session, not a route param.
  unreadNotificationCount: number;
  getMyNotifications: () => Promise<AppNotification[]>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  searchUsersByUsername: (query: string) => Promise<UsernameSearchResult[]>;
  getProfileByUsername: (username: string) => Promise<PublicUserProfile | null>;
  sendConnectionRequest: (params: {
    toUserId: string; requestType: "connect" | "circle_invite"; circleId?: string; message?: string;
  }) => Promise<string | null>;
  respondToConnectionRequest: (requestId: string, response: "accepted" | "declined") => Promise<string | null>;
  blockUser: (userId: string) => Promise<string | null>;
  unblockUser: (userId: string) => Promise<string | null>;
  blockedUsers: BlockedUserEntry[];
  refreshBlockedUsers: () => Promise<void>;
  verificationStatus: VerificationStatus | null;
  loadVerificationStatus: () => Promise<void>;
  submitVerification: (method: "selfie_note" | "video_selfie", fileUri: string, fileName: string, mimeType: string) => Promise<string | null>;
  withdrawVerification: () => Promise<string | null>;
  toggleBadgeVisibility: (visible: boolean) => Promise<string | null>;
  grainCount: number;
  inviteLink: string | null;
  peopleInvited: number;
  getMyInviteLink: () => Promise<string>;
  refreshGrainCount: () => Promise<void>;

  // ── Messaging overhaul ──────────────────────────────────────────────────────
  conversations: ConversationSummary[];
  conversationsLoading: boolean;
  totalUnreadCount: number;
  mostRecentUnread: ConversationSummary | null;
  loadConversations: () => Promise<void>;
  pinMessage: (messageId: string, label?: string) => Promise<string | null>;
  unpinMessage: (messageId: string) => Promise<string | null>;
  pinConversation: (conversationId: string) => Promise<string | null>;
  unpinConversation: (conversationId: string) => Promise<string | null>;
  addToFavourites: (conversationId: string) => Promise<string | null>;
  removeFromFavourites: (conversationId: string) => Promise<string | null>;
  submitAdminFeedback: (data: AdminFeedbackInput) => Promise<string | null>;
  pendingConnectionRequestCount: number;
  incomingMessageBanner: IncomingMessageBannerInfo | null;
  dismissMessageBanner: () => void;
  setActiveConversationId: (id: string | null) => void;

  // ── Admin hierarchy ──────────────────────────────────────────────────────────
  adminRole: DiscipleRole | null;
  adminStats: AdminStats | null;
  loadAdminStats: () => Promise<void>;
  submitAdminReport: (report: { reportPeriod: "weekly" | "monthly" | "annual"; periodStart: string; periodEnd: string; adminNotes: string }) => Promise<string | null>;
  appointAdmin: (username: string, role: string, options: { adminZone?: string; adminCountry?: string; reason: string }) => Promise<string | null>;
  removeAdmin: (userId: string, reason: string) => Promise<string | null>;
  suspendAdmin: (userId: string, reason: string) => Promise<string | null>;
  getAdminList: () => Promise<AdminAccountEntry[]>;
  getAdminActivityFeed: (cursor?: string) => Promise<AdminActivityEntry[]>;

  // ── Church Discipleship Portal — completely free, no tiers ─────────────────
  userChurch: Church | null;
  userChurchRole: ChurchRole | null;
  isChurchLeader: boolean;
  isChurchCreator: boolean;
  churchMemberCount: number;
  churchCohortCount: number;
  loadUserChurch: () => Promise<void>;
  registerChurch: (data: ChurchRegistrationData) => Promise<{ church: Church | null; error: string | null }>;
  updateChurch: (churchId: string, data: ChurchUpdateData) => Promise<{ church: Church | null; error: string | null }>;
  checkDuplicateChurch: (name: string, country?: string, website?: string) => Promise<{ id: string; name: string; city: string | null; country: string; website: string | null }[]>;
  getSocialAccounts: (churchId: string) => Promise<ChurchSocialAccount[]>;
  updateSocialAccounts: (churchId: string, accounts: ChurchSocialAccountData[]) => Promise<string | null>;
  joinChurch: (inviteCode: string) => Promise<{ church: Church | null; error: string | null }>;
  leaveChurch: () => Promise<string | null>;
  getGroveData: (churchId: string) => Promise<GroveData | null>;
  getChurchMembers: (churchId: string, search?: string) => Promise<ChurchMember[]>;
  getChurchMemberProfile: (churchId: string, userId: string) => Promise<ChurchMemberProfile | null>;
  updateChurchMemberNotes: (churchId: string, userId: string, notes: string) => Promise<string | null>;
  updateMemberRole: (churchId: string, userId: string, role: ChurchRole) => Promise<string | null>;
  removeChurchMember: (churchId: string, userId: string) => Promise<string | null>;
  createCohort: (churchId: string, data: ChurchCohortData) => Promise<{ cohort: ChurchCohort | null; error: string | null }>;
  getChurchCohorts: (churchId: string) => Promise<ChurchCohort[]>;
  updateCohort: (churchId: string, cohortId: string, data: Partial<ChurchCohortData> & { status?: string }) => Promise<string | null>;
  addMemberToCohort: (churchId: string, cohortId: string, usernameOrUserId: { userId?: string; username?: string }) => Promise<string | null>;
  removeMemberFromCohort: (churchId: string, cohortId: string, userId: string) => Promise<string | null>;
  createAnnouncement: (churchId: string, data: ChurchAnnouncementCreateData) => Promise<{ announcement: ChurchAnnouncement | null; error: string | null }>;
  updateAnnouncement: (churchId: string, id: string, data: Partial<ChurchAnnouncementCreateData> & { status?: ChurchAnnouncementStatus }) => Promise<string | null>;
  getAnnouncements: (churchId: string, includeAll?: boolean) => Promise<ChurchAnnouncement[]>;
  pinAnnouncement: (churchId: string, id: string, pinned: boolean) => Promise<string | null>;
  createLearningGoal: (churchId: string, data: LearningGoalCreateData) => Promise<{ goal: LearningGoal | null; error: string | null }>;
  getLearningGoals: (churchId: string, status?: string) => Promise<LearningGoal[]>;
  updateLearningGoal: (churchId: string, goalId: string, data: { title?: string; targetType?: LearningGoalTargetType; targetValue?: number; status?: string }) => Promise<string | null>;
  getLearningGoalsDashboard: (churchId: string) => Promise<LearningGoal[]>;

  // Contact P2P Global (peer side)
  sendContactMessage: (data: ContactMessageSendData) => Promise<ContactMessageSendResult>;
  getMyContactMessages: () => Promise<ContactMessageListItem[]>;
  getContactThread: (messageId: string) => Promise<ContactThread | null>;

  // Contact P2P Global (admin side)
  getAdminContactInbox: (filters?: { status?: string; priority?: string; search?: string; archived?: boolean }) => Promise<ContactAdminInboxItem[]>;
  getAdminContactMessage: (messageId: string) => Promise<ContactAdminMessageDetail | null>;
  replyToContactMessage: (messageId: string, body: string, isInternalNote: boolean) => Promise<string | null>;
  forwardContactMessage: (messageId: string, data: { toDepartment?: ContactDepartment; toAdminId?: string; toUsername?: string; note?: string }) => Promise<string | null>;
  closeContactMessage: (messageId: string) => Promise<string | null>;
  setContactMessagePriority: (messageId: string, priority: ContactPriority) => Promise<string | null>;
  setContactMessageStatus: (messageId: string, status: ContactMessageStatus) => Promise<string | null>;
  archiveContactMessage: (messageId: string, archived: boolean) => Promise<string | null>;
  starContactMessage: (messageId: string, starred: boolean) => Promise<string | null>;
  getContactAdminStats: () => Promise<ContactDeptStats | null>;
  getContactAllDepartmentStats: () => Promise<Record<ContactDepartment, ContactDeptStats> | null>;

  // Admin → User official "P2P Global" messages (Compose) — "P2P Official Mail"
  getOfficialMessageAllowedTypes: () => Promise<OfficialAccountType[]>;
  sendOfficialMessage: (data: OfficialMessageSendData) => Promise<OfficialMessageSendResult>;
  getSentOfficialMessages: () => Promise<SentOfficialMessage[]>;
  searchUsersForCompose: (query: string) => Promise<ComposeUserSearchResult[]>;
  getOfficialMailDrafts: () => Promise<OfficialMailDraft[]>;
  saveOfficialMailDraft: (data: OfficialMailDraftSaveData) => Promise<OfficialMailDraftSaveResult>;
  deleteOfficialMailDraft: (draftId: string) => Promise<string | null>;
  getOfficialMailThreadWithUser: (targetUserId: string, officialType: OfficialAccountType) => Promise<OfficialMailThread>;
}

// Optimistic local mirror of a p2p_conversation_settings upsert, so the inbox
// list reflects a pin/favourite toggle immediately rather than waiting on the
// next loadConversations() poll/realtime tick.
function mapSettingUpdatesToSummary(updates: Record<string, unknown>): Partial<ConversationSummary> {
  const out: Partial<ConversationSummary> = {};
  if ("is_pinned" in updates) out.isPinnedByUser = updates.is_pinned as boolean;
  if ("is_favourite" in updates) out.isFavourite = updates.is_favourite as boolean;
  if ("is_muted" in updates) out.isMuted = updates.is_muted as boolean;
  return out;
}

const DataContext = createContext<DataContextValue | null>(null);

// ── Static data ───────────────────────────────────────────────────────────────

const DAILY_VERSES = [
  { ref: "Matthew 28:19", text: "Go therefore and make disciples of all nations, baptizing them in the name of the Father and of the Son and of the Holy Spirit." },
  { ref: "John 15:5", text: "I am the vine; you are the branches. If you remain in me and I in you, you will bear much fruit; apart from me you can do nothing." },
  { ref: "Proverbs 27:17", text: "As iron sharpens iron, so one person sharpens another." },
  { ref: "Hebrews 10:24-25", text: "Let us consider how we may spur one another on toward love and good deeds, not giving up meeting together." },
  { ref: "Colossians 3:16", text: "Let the message of Christ dwell among you richly as you teach and admonish one another with all wisdom." },
  { ref: "2 Timothy 2:2", text: "And the things you have heard me say in the presence of many witnesses entrust to reliable people who will also be qualified to teach others." },
  { ref: "Acts 2:42", text: "They devoted themselves to the apostles' teaching and to fellowship, to the breaking of bread and to prayer." },
];

const FALLBACK_MODULES: Module[] = [
  { id: "m1", curriculumId: "", title: "Foundations of Faith", description: "The essentials of Christian discipleship", level: 1, lessonCount: 6, completedLessons: 0, isLocked: false },
];


// ── UUID helper (no external dep needed) ─────────────────────────────────────
function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ── Media upload helper ───────────────────────────────────────────────────────
async function uploadSubmissionMedia(
  localUri: string,
  submissionId: string,
  userId: string
): Promise<{ storagePath: string; contentType: string } | null> {
  try {
    // On web, localUri is a blob: URL with no dot-extension, so a plain
    // split(".").pop() returns the entire URL as "ext" — validate before
    // trusting it as a storage-path segment (see lib/mediaUpload.ts for the
    // same guard applied to ImagePicker uploads).
    const rawExtCandidate = localUri.split(".").pop()?.toLowerCase();
    const rawExt = rawExtCandidate && /^[a-z0-9]{2,5}$/.test(rawExtCandidate) ? rawExtCandidate : "m4a";
    const isVideo = ["mp4", "mov", "webm", "avi"].includes(rawExt);
    const ext = rawExt === "mov" ? "mp4" : rawExt;
    const contentType = isVideo ? "video/mp4" : "audio/m4a";
    const storagePath = `${userId}/${submissionId}/recording.${ext}`;

    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const { error } = await supabase.storage
      .from("submissions")
      .upload(storagePath, arrayBuffer, { contentType, upsert: false });
    if (error) return null;
    return { storagePath, contentType };
  } catch {
    return null;
  }
}

// ── Chunked query helper ──────────────────────────────────────────────────────
// Same chunking discipline the API server already uses (churches.ts,
// curriculum.ts's selectInChunks/chunk) — a plain .in() over an id list that
// scales with catalog/network size (not a single user's own bounded records)
// can build a URL PostgREST rejects with a 400 once it grows large enough.
// Confirmed incident: the Plans progress loader below built a ~39KB URL from
// every lesson across every plan and 400'd on every fresh account.
const IN_CHUNK_SIZE = 100;
function chunkIds<T>(items: T[], size = IN_CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
async function selectInChunks<T = Record<string, unknown>>(
  table: string,
  columns: string,
  column: string,
  ids: string[],
  extraFilter?: (query: any) => any
): Promise<T[]> {
  if (!ids.length) return [];
  const results: T[] = [];
  for (const c of chunkIds(ids)) {
    let query = supabase.from(table).select(columns).in(column, c);
    if (extraFilter) query = extraFilter(query);
    const { data, error } = await query;
    if (error) {
      console.error(`${table}.${column} chunked query failed:`, error.message);
      continue;
    }
    results.push(...((data ?? []) as T[]));
  }
  return results;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile, isLoading: authLoading } = useAuth();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [pendingConnectionRequestCount, setPendingConnectionRequestCount] = useState(0);
  const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
  const [userChurch, setUserChurch] = useState<Church | null>(null);
  const [userChurchRole, setUserChurchRole] = useState<ChurchRole | null>(null);
  const [churchMemberCount, setChurchMemberCount] = useState(0);
  const [churchCohortCount, setChurchCohortCount] = useState(0);
  const [incomingMessageBanner, setIncomingMessageBanner] = useState<IncomingMessageBannerInfo | null>(null);
  // Ref, not state — read inside the realtime callback's closure without
  // forcing the channel to resubscribe every time the user opens/leaves a
  // conversation (see setActiveConversationId / messages/[id].tsx).
  const activeConversationIdRef = useRef<string | null>(null);
  const setActiveConversationId = useCallback((id: string | null) => { activeConversationIdRef.current = id; }, []);
  const dismissMessageBanner = useCallback(() => setIncomingMessageBanner(null), []);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserEntry[]>([]);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus | null>(null);
  const [grainCount, setGrainCount] = useState(0);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [peopleInvited, setPeopleInvited] = useState(0);
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [prayers, setPrayers] = useState<PrayerRequest[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [forestNodes, setForestNodes] = useState<ForestNode[]>([]);
  const [forestStats, setForestStats] = useState<ForestStats>({
    totalDisciples: 0,
    hasDiscipleMaker: false,
    countriesReached: [],
  });
  const [forestData, setForestData] = useState<GenerationalForestData | null>(null);
  const [forestDataLoading, setForestDataLoading] = useState(false);
  const [treeData, setTreeData] = useState<TreeData | null>(null);
  const [treeMentees, setTreeMentees] = useState<MenteeBranchInfo[]>([]);
  const [pendingCompletionMoment, setPendingCompletionMoment] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  // 0-100 completion percentage per plan id — computed from the same
  // p2p_lesson_progress table core curriculum uses (plans ARE p2p_curriculums
  // rows now, see migration 041_unify_plans_system.sql), not a separate table.
  const [planProgress, setPlanProgress] = useState<Map<string, number>>(new Map());
  const [planCategories, setPlanCategories] = useState<PlanCategory[]>([]);
  const [categoryCompletionQueue, setCategoryCompletionQueue] = useState<CategoryCompletion[]>([]);
  const [fruitCatalog, setFruitCatalog] = useState<FruitCatalogEntry[]>([]);
  const [userFruits, setUserFruits] = useState<EarnedFruit[]>([]);
  const [fruitProgress, setFruitProgress] = useState<FruitProgressEntry[]>([]);
  const [fruitCelebrationQueue, setFruitCelebrationQueue] = useState<FruitCelebration[]>([]);
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingPeerConfirmation[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [circleSessionInvite, setCircleSessionInvite] = useState<CircleSessionInvite | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [dailyVerse, setDailyVerse] = useState<{ ref: string; text: string } | null>(null);
  const [pendingEvaluations, setPendingEvaluations] = useState<PendingEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toastEvent, setToastEvent] = useState<GrowthEvent | null>(null);
  const [celebrationEvent, setCelebrationEvent] = useState<GrowthEvent | null>(null);

  // Unified plans loader — a Plan IS a p2p_curriculums row (type='plan'), the
  // same table the old p2p_plans/p2p_plan_modules/p2p_plan_lessons system
  // used to duplicate (see migration 041_unify_plans_system.sql). Fetches
  // from curriculum.ts's GET /plans rather than reading p2p_curriculums
  // directly, since that endpoint already does the module/lesson counting.
  const loadPlans = useCallback(async (userId?: string, languageCode?: string) => {
    setPlansLoading(true);
    try {
      const apiUrl = getApiUrl();
      const res = await fetch(`${apiUrl}/plans`);
      const data = await res.json();
      let builtPlans: Plan[] = Array.isArray(data)
        ? data.map((p: Record<string, unknown>) => ({
            id: p.id as string,
            title: p.title as string,
            description: (p.description as string) ?? null,
            subtitle: (p.subtitle as string) ?? null,
            coverImageUrl: (p.coverImageUrl as string) ?? null,
            thumbnailUrl: (p.thumbnailUrl as string) ?? null,
            colorTheme: (p.colorTheme as string) ?? "#1D9E75",
            tags: (p.tags as string[]) ?? [],
            isFeatured: Boolean(p.isFeatured),
            difficultyLevel: (p.difficultyLevel as string) ?? "beginner",
            estimatedWeeks: (p.estimatedWeeks as number) ?? null,
            teachingCreditName: (p.teachingCreditName as string) ?? null,
            teachingCreditRole: (p.teachingCreditRole as string) ?? null,
            teachingCreditChurch: (p.teachingCreditChurch as string) ?? null,
            teachingCreditLocation: (p.teachingCreditLocation as string) ?? null,
            teachingCreditYoutube: (p.teachingCreditYoutube as string) ?? null,
            teachingCreditInstagram: (p.teachingCreditInstagram as string) ?? null,
            status: (p.status as string) ?? "published",
            displayOrder: (p.displayOrder as number) ?? null,
            moduleCount: (p.moduleCount as number) ?? 0,
            lessonCount: (p.lessonCount as number) ?? 0,
          }))
        : [];

      // Progress — direct Supabase against the same p2p_modules/p2p_lessons/
      // p2p_lesson_progress tables core curriculum already reads this way.
      // No separate progress table exists for plans anymore.
      if (userId && builtPlans.length > 0) {
        const planIds = builtPlans.map((p) => p.id);
        const planModules = await selectInChunks<Record<string, unknown>>(
          "p2p_modules", "id,curriculum_id", "curriculum_id", planIds
        );
        const moduleToPlanId = new Map<string, string>();
        for (const m of planModules) {
          moduleToPlanId.set(m.id as string, m.curriculum_id as string);
        }
        const moduleIds = Array.from(moduleToPlanId.keys());
        const planLessons = await selectInChunks<Record<string, unknown>>(
          "p2p_lessons", "id,module_id", "module_id", moduleIds
        );
        const lessonIds = planLessons.map((l) => l.id as string);
        const progressRows = await selectInChunks<Record<string, unknown>>(
          "p2p_lesson_progress", "lesson_id,completed", "lesson_id", lessonIds,
          (q) => q.eq("user_id", userId)
        );
        const completedSet = new Set(
          progressRows.filter((p) => p.completed).map((p) => p.lesson_id as string)
        );
        const totalByPlan = new Map<string, number>();
        const completedByPlan = new Map<string, number>();
        for (const l of planLessons) {
          const planId = moduleToPlanId.get(l.module_id as string);
          if (!planId) continue;
          totalByPlan.set(planId, (totalByPlan.get(planId) ?? 0) + 1);
          if (completedSet.has(l.id as string)) completedByPlan.set(planId, (completedByPlan.get(planId) ?? 0) + 1);
        }
        const progressMap = new Map<string, number>();
        for (const p of builtPlans) {
          const total = totalByPlan.get(p.id) ?? 0;
          const done = completedByPlan.get(p.id) ?? 0;
          progressMap.set(p.id, total > 0 ? Math.round((done / total) * 100) : 0);
        }
        setPlanProgress(progressMap);

        // Dashboard tracking (Prompt 7) — a plan that just reached 100% and
        // whose enrollment isn't already marked completed fires plan_completed
        // + mountain_touched exactly once, then flips the enrollment row so
        // it never fires again for the same plan.
        const completedPlanIds = builtPlans.filter((p) => (progressMap.get(p.id) ?? 0) === 100).map((p) => p.id);
        if (completedPlanIds.length > 0) {
          const enrollments = await selectInChunks<Record<string, unknown>>(
            "p2p_plan_enrollments", "id, plan_id, status", "plan_id", completedPlanIds,
            (q) => q.eq("user_id", userId)
          );
          const newlyCompleted = enrollments.filter((e) => e.status !== "completed");
          for (const enrollment of newlyCompleted) {
            const plan = builtPlans.find((p) => p.id === enrollment.plan_id);
            if (!plan) continue;
            await supabase.from("p2p_plan_enrollments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", enrollment.id as string);
            await supabase.from("p2p_user_activity_events").insert({
              user_id: userId, event_type: "plan_completed",
              metadata: { plan_id: plan.id, plan_title: plan.title },
            });
            const mountain = getMountainForPlan(plan.tags);
            if (mountain) {
              await supabase.from("p2p_user_activity_events").insert({
                user_id: userId, event_type: "mountain_touched",
                metadata: { mountain_name: mountain, plan_id: plan.id },
              });
            }
          }
        }
      } else {
        setPlanProgress(new Map());
      }

      // On-demand title/description/subtitle translation, permanently cached
      // server-side — parallel via Promise.all, never sequential, English
      // fallback always (see translations.ts's GET /translations/curriculum/:id).
      if (languageCode && languageCode !== "en" && builtPlans.length > 0) {
        const results = await Promise.all(
          builtPlans.map((p) =>
            fetch(`${apiUrl}/translations/curriculum/${p.id}?language=${languageCode}`)
              .then((r) => r.json())
              .catch(() => null)
          )
        );
        builtPlans = builtPlans.map((p, i) => {
          const t = results[i];
          if (!t?.translation_available) return p;
          return {
            ...p,
            title: t.title ?? p.title,
            description: t.description ?? p.description,
            subtitle: t.subtitle ?? p.subtitle,
          };
        });
      }

      setPlans(builtPlans);
    } catch {
      setPlans([]);
      setPlanProgress(new Map());
    } finally {
      setPlansLoading(false);
    }
  }, []);

  const getPlanById = useCallback((planId: string) => plans.find((p) => p.id === planId), [plans]);
  const getPlanProgress = useCallback((planId: string) => planProgress.get(planId) ?? 0, [planProgress]);

  const loadPlanCategories = useCallback(async () => {
    try {
      const res = await fetch(`${getApiUrl()}/plans/categories`);
      const data = (await res.json()) as PlanCategory[];
      setPlanCategories(Array.isArray(data) ? data : []);
    } catch {
      setPlanCategories([]);
    }
  }, []);

  const getCategoryPlans = useCallback(async (categoryId: string): Promise<PlanWithLockStatus[]> => {
    try {
      const params = profile?.id ? `?userId=${profile.id}` : "";
      const res = await fetch(`${getApiUrl()}/plans/categories/${categoryId}/plans${params}`);
      const data = (await res.json()) as PlanWithLockStatus[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, [profile?.id]);

  // Fires from the plan detail screen every time it loads a plan that
  // belongs to a category — cheap to call repeatedly since the AsyncStorage
  // flag below makes it a no-op once this category has already celebrated
  // for this user, and getCategoryPlans is a single lightweight fetch.
  const checkCategoryCompletion = useCallback(async (categoryId: string) => {
    if (!profile?.id) return;
    const storageKey = `category_complete_${profile.id}_${categoryId}`;
    try {
      if (await AsyncStorage.getItem(storageKey)) return;
      const plansInCategory = await getCategoryPlans(categoryId);
      if (plansInCategory.length === 0) return;
      if (!plansInCategory.every((p) => p.progressPercent >= 100)) return;

      await AsyncStorage.setItem(storageKey, "true");
      const category = planCategories.find((c) => c.id === categoryId);
      setCategoryCompletionQueue((prev) => [...prev, {
        categoryId,
        categoryTitle: category?.title ?? "this category",
        categoryColorTheme: category?.colorTheme ?? "#1D9E75",
        planCount: plansInCategory.length,
      }]);
    } catch {
      // Not critical — the celebration simply won't fire this time.
    }
  }, [profile?.id, getCategoryPlans, planCategories]);

  const dismissCurrentCategoryCompletion = useCallback(() => {
    setCategoryCompletionQueue((prev) => prev.slice(1));
  }, []);

  const searchPlans = useCallback(async (query: string): Promise<PlanSearchResult[]> => {
    const q = query.trim();
    if (!q) return [];
    try {
      const params = new URLSearchParams({ q });
      if (profile?.id) params.set("userId", profile.id);
      const res = await fetch(`${getApiUrl()}/plans/search?${params.toString()}`);
      const data = (await res.json()) as PlanSearchResult[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, [profile?.id]);

  // All 144 plans across all 10 categories, for the A-Z tab — categories are
  // a small, fixed set (10), so fetching each one's plans in parallel is
  // simpler and just as fast as a dedicated flat endpoint would be.
  const getAllPlansAZ = useCallback(async (): Promise<PlanWithCategory[]> => {
    try {
      const apiUrl = getApiUrl();
      const catRes = await fetch(`${apiUrl}/plans/categories`);
      const categories = (await catRes.json()) as PlanCategory[];
      if (!Array.isArray(categories) || categories.length === 0) return [];

      const params = profile?.id ? `?userId=${profile.id}` : "";
      const perCategory = await Promise.all(
        categories.map((c) =>
          fetch(`${apiUrl}/plans/categories/${c.id}/plans${params}`)
            .then((r) => r.json())
            .then((plansInCat: PlanWithLockStatus[]) =>
              (Array.isArray(plansInCat) ? plansInCat : []).map((p) => ({
                id: p.id,
                title: p.title,
                topicNumber: p.topicNumber,
                categoryId: c.id,
                categoryTitle: c.title,
                categoryColorTheme: c.colorTheme,
                locked: p.locked,
              }))
            )
            .catch(() => [] as PlanWithCategory[])
        )
      );
      return perCategory.flat().sort((a, b) => a.title.localeCompare(b.title));
    } catch {
      return [];
    }
  }, [profile?.id]);

  const loadCurriculum = useCallback(async (userId?: string, languageCode?: string) => {
    try {
      const { data: allCurriculumsRaw } = await supabase
        .from("p2p_curriculums")
        .select("*")
        .eq("status", "published");
      const curriculums = (allCurriculumsRaw ?? []).filter(
        (c: Record<string, unknown>) => (c.type as string) !== "plan"
      );
      if (!curriculums || curriculums.length === 0) {
        setModules(FALLBACK_MODULES); setLessons([]); return;
      }
      const curriculumIds = curriculums.map((c: Record<string, unknown>) => c.id as string);
      const { data: allModules } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id,title,description,order_index,image_url")
        .in("curriculum_id", curriculumIds)
        .order("order_index", { ascending: true });
      if (!allModules || allModules.length === 0) {
        setModules(FALLBACK_MODULES); setLessons([]); return;
      }
      const countsByCurriculum = new Map<string, number>();
      for (const m of allModules as Record<string, unknown>[]) {
        const cId = m.curriculum_id as string;
        countsByCurriculum.set(cId, (countsByCurriculum.get(cId) ?? 0) + 1);
      }
      let activeCurriculumId = curriculumIds[0];
      let bestCount = -1;
      for (const [cId, count] of countsByCurriculum) {
        if (count > bestCount) { bestCount = count; activeCurriculumId = cId; }
      }
      const activeModulesRaw = (allModules as Record<string, unknown>[])
        .filter((m) => (m.curriculum_id as string) === activeCurriculumId)
        .sort((a, b) => (a.order_index as number) - (b.order_index as number));
      const moduleIds = activeModulesRaw.map((m) => m.id as string);
      const { data: allLessons } = await supabase
        .from("p2p_lessons")
        .select("id,module_id,title,subtitle,order_index")
        .in("module_id", moduleIds)
        .order("order_index", { ascending: true });
      const lessonsRaw = (allLessons ?? []) as Record<string, unknown>[];

      // Overlay translated titles when a non-English content language is selected
      const moduleTitleOverrides = new Map<string, string>();
      const lessonTitleOverrides = new Map<string, string>();
      if (languageCode && languageCode !== "en" && moduleIds.length > 0) {
        const lessonIdList = lessonsRaw.map((l) => l.id as string);

        // Primary: query the new unified p2p_content_translations table.
        // No status filter — on-demand translations (see curriculum.ts's
        // GET /lessons/:lessonId) are generated automatically and cached
        // permanently at status 'draft'; there's no separate human-approval
        // step in that flow, so gating on 'approved' here would mean a
        // freshly-generated title never actually shows up in this list.
        const allIds = [...moduleIds, ...lessonIdList];
        const newTrans = await selectInChunks<Record<string, unknown>>(
          "p2p_content_translations", "content_type,content_id,title,subtitle,description,status", "content_id", allIds,
          (q) => q.eq("language_code", languageCode)
        );

        const newModMap = new Map<string, string>();
        const newLesMap = new Map<string, string>();
        for (const row of newTrans) {
          if (row.title) {
            if (row.content_type === "module") newModMap.set(row.content_id as string, row.title as string);
            if (row.content_type === "lesson") newLesMap.set(row.content_id as string, row.title as string);
          }
        }

        // Fallback: legacy tables for any IDs not found in the new table
        const missingModuleIds = moduleIds.filter((id) => !newModMap.has(id));
        const missingLessonIds = lessonIdList.filter((id) => !newLesMap.has(id));

        const [modTrans, lessTrans] = await Promise.all([
          selectInChunks<Record<string, unknown>>(
            "p2p_module_translations", "module_id,title", "module_id", missingModuleIds,
            (q) => q.eq("language_code", languageCode)
          ),
          selectInChunks<Record<string, unknown>>(
            "p2p_lesson_translations", "lesson_id,title", "lesson_id", missingLessonIds,
            (q) => q.eq("language_code", languageCode)
          ),
        ]);

        // Merge: new table wins, legacy is fallback
        for (const [id, title] of newModMap) moduleTitleOverrides.set(id, title);
        for (const [id, title] of newLesMap) lessonTitleOverrides.set(id, title);
        for (const mt of modTrans) {
          if (mt.title && !moduleTitleOverrides.has(mt.module_id as string))
            moduleTitleOverrides.set(mt.module_id as string, mt.title as string);
        }
        for (const lt of lessTrans) {
          if (lt.title && !lessonTitleOverrides.has(lt.lesson_id as string))
            lessonTitleOverrides.set(lt.lesson_id as string, lt.title as string);
        }
      }
      let progressByLesson = new Map<string, boolean>();
      // Authoritative "all questions submitted" / "all questions approved"
      // signal, set server-side by p2p_lesson_progress_recompute() (031) —
      // replaces the old, buggy inference from "does ANY evaluation for this
      // lesson exist" (see below), which fired on the first submitted/
      // approved question rather than the last one.
      const statusByLesson = new Map<string, "not_started" | "submitted" | "completed">();
      const evalStatusByLesson = new Map<string, "pending" | "needs_revision">();
      if (userId) {
        const { data: progressRows } = await supabase
          .from("p2p_lesson_progress")
          .select("lesson_id,completed,status")
          .eq("user_id", userId);
        for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
          progressByLesson.set(p.lesson_id as string, Boolean(p.completed));
          statusByLesson.set(p.lesson_id as string, (p.status as "not_started" | "submitted" | "completed") ?? "not_started");
        }

        // Not-yet-resolved evaluations for this user's own assignment
        // submissions, so the module list can show "waiting on review" /
        // "needs revision" as a state distinct from both not-started and done.
        const { data: myEvals } = await supabase
          .from("p2p_lesson_evaluations")
          .select("lesson_id,status")
          .eq("submitter_id", userId)
          .in("status", ["pending", "needs_revision"]);
        for (const e of (myEvals ?? []) as Record<string, unknown>[]) {
          const lessonId = e.lesson_id as string;
          const status = e.status as "pending" | "needs_revision";
          // needs_revision takes priority over pending if a lesson somehow has both.
          if (status === "needs_revision" || !evalStatusByLesson.has(lessonId)) {
            evalStatusByLesson.set(lessonId, status);
          }
        }
      }
      const builtModules: Module[] = [];
      const builtLessons: Lesson[] = [];
      let previousModuleComplete = true;
      activeModulesRaw.forEach((m, moduleIdx) => {
        const moduleId = m.id as string;
        const moduleLessons = lessonsRaw
          .filter((l) => (l.module_id as string) === moduleId)
          .sort((a, b) => (a.order_index as number) - (b.order_index as number));
        const lessonCount = moduleLessons.length;
        const completedLessons = moduleLessons.filter((l) => progressByLesson.get(l.id as string)).length;
        // "Submitted" = every assignment question for the lesson has been
        // answered (status transitions to 'submitted' only once ALL are in —
        // see p2p_lesson_progress_recompute), not merely "at least one
        // question has a pending evaluation somewhere."
        const submittedLessons = moduleLessons.filter((l) => {
          const st = statusByLesson.get(l.id as string);
          return st === "submitted" || st === "completed";
        }).length;
        const moduleComplete = lessonCount > 0 && completedLessons === lessonCount;
        const moduleLocked = !previousModuleComplete;
        builtModules.push({
          id: moduleId, curriculumId: activeCurriculumId,
          title: moduleTitleOverrides.get(moduleId) ?? (m.title as string), description: (m.description as string) ?? "",
          level: moduleIdx + 1, lessonCount, completedLessons, submittedLessons, isLocked: moduleLocked,
          imageUrl: (m.image_url as string) ?? undefined,
        });
        // Track two independent unlock signals:
        // • prevPassedForUnlock — whether the immediately-prior lesson was submitted OR approved
        //   (used to unlock regular lessons immediately on submission)
        // • allPrevCompleted — whether every prior lesson is fully approved
        //   (used to gate the module's Discussion & Review lesson)
        let prevPassedForUnlock = true;
        let allPrevCompleted = true;
        moduleLessons.forEach((l, lessonIdx) => {
          const isCompleted = Boolean(progressByLesson.get(l.id as string));
          const lessonStatus = statusByLesson.get(l.id as string) ?? "not_started";
          // needs_revision always surfaces (a learner needs to know to fix
          // it); otherwise show "awaiting review" only once every question
          // has genuinely been submitted, not just the first one.
          const evalSt = isCompleted
            ? undefined
            : evalStatusByLesson.get(l.id as string) === "needs_revision"
              ? "needs_revision"
              : lessonStatus === "submitted" ? "pending" : undefined;
          // Layer 1 (submission gate): the next lesson unlocks once every
          // question in this one has been submitted — approval isn't required.
          const passedForUnlock = isCompleted || lessonStatus === "submitted";
          // A module's "Discussion & Review" lesson is seeded with
          // order_index 999 — that data convention, not list position, is
          // what marks it. Modules without one (e.g. Module 0) have a normal
          // content lesson last, which must unlock like any other lesson.
          const isReviewLesson = (l.order_index as number) >= 999;
          const isThisLocked = moduleLocked || (
            lessonIdx === 0 ? false
            : isReviewLesson ? !allPrevCompleted
            : !prevPassedForUnlock
          );
          builtLessons.push({
            id: l.id as string, moduleId,
            title: lessonTitleOverrides.get(l.id as string) ?? (l.title as string),
            content: (l.subtitle as string) ?? "",
            isCompleted, isLocked: isThisLocked,
            order: l.order_index as number,
            evaluationStatus: evalSt,
          });
          prevPassedForUnlock = passedForUnlock;
          allPrevCompleted = allPrevCompleted && isCompleted;
        });
        previousModuleComplete = moduleComplete;
      });
      setModules(builtModules);
      setLessons(builtLessons);
    } catch {
      setModules(FALLBACK_MODULES); setLessons([]);
    }
  }, []);

  // Curriculum redesign — lists every stand-alone core curriculum (never
  // Kingdom School Plans, type='plan') with real counts computed from its
  // own rows. Deliberately independent of loadCurriculum's single-"active"-
  // curriculum state above.
  const getCurriculumCatalog = useCallback(async (): Promise<CurriculumCatalogItem[]> => {
    try {
      const { data: curriculumsRaw } = await supabase
        .from("p2p_curriculums")
        .select("id,title,description,color_theme,display_order,cover_image,icon")
        .eq("status", "published")
        .neq("type", "plan")
        .neq("type", "plan_category");
      const curriculums = (curriculumsRaw ?? []) as Record<string, unknown>[];
      if (!curriculums.length) return [];

      const curriculumIds = curriculums.map((c) => c.id as string);
      const { data: modulesRaw } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id")
        .in("curriculum_id", curriculumIds);
      const modules = (modulesRaw ?? []) as Record<string, unknown>[];
      const moduleIds = modules.map((m) => m.id as string);

      const { data: lessonsRaw } = moduleIds.length
        ? await supabase.from("p2p_lessons").select("id,module_id,estimated_minutes").in("module_id", moduleIds)
        : { data: [] as Record<string, unknown>[] };
      const lessons = (lessonsRaw ?? []) as Record<string, unknown>[];

      const moduleCurriculumById = new Map(modules.map((m) => [m.id as string, m.curriculum_id as string]));

      return curriculums
        .map((c) => {
          const cId = c.id as string;
          const cModuleIds = modules.filter((m) => m.curriculum_id === cId).map((m) => m.id as string);
          const cLessons = lessons.filter((l) => moduleCurriculumById.get(l.module_id as string) === cId);
          return {
            id: cId,
            title: c.title as string,
            description: (c.description as string) ?? "",
            colorTheme: (c.color_theme as string) ?? "#1D9E75",
            coverImage: (c.cover_image as string) ?? null,
            icon: (c.icon as string) ?? null,
            moduleCount: cModuleIds.length,
            lessonCount: cLessons.length,
            estimatedMinutes: cLessons.reduce((sum, l) => sum + ((l.estimated_minutes as number) ?? 0), 0),
            displayOrder: (c.display_order as number) ?? 999,
          };
        })
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map(({ displayOrder: _displayOrder, ...rest }) => rest);
    } catch {
      return [];
    }
  }, []);

  // Curriculum redesign — fetches a single module and its lessons directly
  // by module id, independent of which curriculum is currently "active" in
  // the global modules/lessons state. Needed because module/[id].tsx used
  // to only ever look a module up inside that global array, which only ever
  // held one curriculum's modules — any module belonging to a different
  // stand-alone curriculum (Peer-to-Peer Orientation, Identity in Christ,
  // The Gospel & Salvation) would never be found. Mirrors loadCurriculum's
  // real progress/evaluation-status/sequential-locking logic exactly (same
  // rules, just scoped to one module) rather than a simplified stand-in, so
  // existing lessons with real peer-evaluated assignments (Orientation,
  // Identity in Christ) keep behaving identically to before.
  const loadModuleWithLessons = useCallback(async (
    moduleId: string, userId?: string
  ): Promise<{ module: Module; lessons: Lesson[] } | null> => {
    try {
      const { data: moduleRow } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id,title,description,order_index,image_url")
        .eq("id", moduleId)
        .maybeSingle();
      if (!moduleRow) return null;

      const { data: lessonsRaw } = await supabase
        .from("p2p_lessons")
        .select("id,module_id,title,subtitle,order_index")
        .eq("module_id", moduleId)
        .order("order_index", { ascending: true });
      const moduleLessons = ((lessonsRaw ?? []) as Record<string, unknown>[])
        .sort((a, b) => (a.order_index as number) - (b.order_index as number));

      const progressByLesson = new Map<string, boolean>();
      const statusByLesson = new Map<string, "not_started" | "submitted" | "completed">();
      const evalStatusByLesson = new Map<string, "pending" | "needs_revision">();
      if (userId && moduleLessons.length) {
        const lessonIds = moduleLessons.map((l) => l.id as string);
        const [{ data: progressRows }, { data: myEvals }] = await Promise.all([
          supabase.from("p2p_lesson_progress").select("lesson_id,completed,status").eq("user_id", userId).in("lesson_id", lessonIds),
          supabase.from("p2p_lesson_evaluations").select("lesson_id,status").eq("submitter_id", userId).in("status", ["pending", "needs_revision"]).in("lesson_id", lessonIds),
        ]);
        for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
          progressByLesson.set(p.lesson_id as string, Boolean(p.completed));
          statusByLesson.set(p.lesson_id as string, (p.status as "not_started" | "submitted" | "completed") ?? "not_started");
        }
        for (const e of (myEvals ?? []) as Record<string, unknown>[]) {
          const lessonId = e.lesson_id as string;
          const status = e.status as "pending" | "needs_revision";
          if (status === "needs_revision" || !evalStatusByLesson.has(lessonId)) evalStatusByLesson.set(lessonId, status);
        }
      }

      const lessonCount = moduleLessons.length;
      const completedLessons = moduleLessons.filter((l) => progressByLesson.get(l.id as string)).length;
      const submittedLessons = moduleLessons.filter((l) => {
        const st = statusByLesson.get(l.id as string);
        return st === "submitted" || st === "completed";
      }).length;

      const module: Module = {
        id: moduleRow.id as string, curriculumId: (moduleRow.curriculum_id as string) ?? "",
        title: moduleRow.title as string, description: (moduleRow.description as string) ?? "",
        level: 1, lessonCount, completedLessons, submittedLessons, isLocked: false,
        imageUrl: (moduleRow.image_url as string) ?? undefined,
      };

      const builtLessons: Lesson[] = [];
      let prevPassedForUnlock = true;
      let allPrevCompleted = true;
      moduleLessons.forEach((l, lessonIdx) => {
        const isCompleted = Boolean(progressByLesson.get(l.id as string));
        const lessonStatus = statusByLesson.get(l.id as string) ?? "not_started";
        const evalSt = isCompleted
          ? undefined
          : evalStatusByLesson.get(l.id as string) === "needs_revision"
            ? "needs_revision"
            : lessonStatus === "submitted" ? "pending" : undefined;
        const passedForUnlock = isCompleted || lessonStatus === "submitted";
        const isReviewLesson = (l.order_index as number) >= 999;
        const isThisLocked = lessonIdx === 0 ? false : isReviewLesson ? !allPrevCompleted : !prevPassedForUnlock;
        builtLessons.push({
          id: l.id as string, moduleId: moduleId,
          title: l.title as string, content: (l.subtitle as string) ?? "",
          isCompleted, isLocked: isThisLocked, order: l.order_index as number, evaluationStatus: evalSt,
        });
        prevPassedForUnlock = passedForUnlock;
        allPrevCompleted = allPrevCompleted && isCompleted;
      });

      return { module, lessons: builtLessons };
    } catch {
      return null;
    }
  }, []);

  // Curriculum redesign — a single stand-alone curriculum's own detail:
  // its title/description plus its modules (with real lesson/completion
  // counts, no per-lesson detail — the detail screen's module list doesn't
  // need it). Independent of the global "active curriculum" state for the
  // same reason loadModuleWithLessons is.
  const loadCurriculumDetail = useCallback(async (
    curriculumId: string, userId?: string
  ): Promise<{ curriculum: { id: string; title: string; description: string; coverImage: string | null; icon: string | null; colorTheme: string }; modules: Module[] } | null> => {
    try {
      const { data: curriculumRow } = await supabase
        .from("p2p_curriculums")
        .select("id,title,description,cover_image,icon,color_theme")
        .eq("id", curriculumId)
        .maybeSingle();
      if (!curriculumRow) return null;

      const { data: modulesRaw } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id,title,description,order_index,image_url")
        .eq("curriculum_id", curriculumId)
        .order("order_index", { ascending: true });
      const modulesRows = ((modulesRaw ?? []) as Record<string, unknown>[]).sort(
        (a, b) => (a.order_index as number) - (b.order_index as number)
      );
      const moduleIds = modulesRows.map((m) => m.id as string);

      const { data: lessonsRaw } = moduleIds.length
        ? await supabase.from("p2p_lessons").select("id,module_id").in("module_id", moduleIds)
        : { data: [] as Record<string, unknown>[] };
      const lessonRows = (lessonsRaw ?? []) as Record<string, unknown>[];

      const progressByLesson = new Map<string, boolean>();
      if (userId && lessonRows.length) {
        const lessonIds = lessonRows.map((l) => l.id as string);
        const { data: progressRows } = await supabase
          .from("p2p_lesson_progress").select("lesson_id,completed").eq("user_id", userId).in("lesson_id", lessonIds);
        for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
          progressByLesson.set(p.lesson_id as string, Boolean(p.completed));
        }
      }

      const modules: Module[] = modulesRows.map((m, idx) => {
        const mLessons = lessonRows.filter((l) => l.module_id === m.id);
        const completedLessons = mLessons.filter((l) => progressByLesson.get(l.id as string)).length;
        return {
          id: m.id as string, curriculumId, title: m.title as string, description: (m.description as string) ?? "",
          level: idx + 1, lessonCount: mLessons.length, completedLessons, isLocked: false,
          imageUrl: (m.image_url as string) ?? undefined,
        };
      });

      return {
        curriculum: {
          id: curriculumRow.id as string, title: curriculumRow.title as string, description: (curriculumRow.description as string) ?? "",
          coverImage: (curriculumRow.cover_image as string) ?? null, icon: (curriculumRow.icon as string) ?? null,
          colorTheme: (curriculumRow.color_theme as string) ?? "#1D9E75",
        },
        modules,
      };
    } catch {
      return null;
    }
  }, []);

  // Pending peer confirmations — real actions (encouraging feedback, prayer,
  // a completed peer session, mentoring help) that only the RECIPIENT can
  // vouch actually happened. Created entirely by DB triggers (migration 036)
  // on tables the app already writes to — nothing here originates a
  // confirmation, this just reads and actions them.
  const loadPendingConfirmations = useCallback(async () => {
    if (!profile?.id) { setPendingConfirmations([]); return; }
    try {
      const { data: rows } = await supabase
        .from("p2p_peer_confirmations")
        .select("id,confirmation_type,actor_user_id,source_type,source_id,created_at,expires_at")
        .eq("confirmer_user_id", profile.id)
        .eq("confirmation_status", "pending")
        .order("created_at", { ascending: false });

      if (!rows || rows.length === 0) { setPendingConfirmations([]); return; }

      const actorIds = Array.from(new Set(rows.map((r) => r.actor_user_id as string)));
      const evalIds = rows.filter((r) => r.source_type === "evaluation_feedback").map((r) => r.source_id as string);
      const reactionIds = rows.filter((r) => r.source_type === "prayer").map((r) => r.source_id as string);
      const sessionIds = rows.filter((r) => r.source_type === "session").map((r) => r.source_id as string);

      const [{ data: actors }, { data: evalRows }, { data: reactionRows }, { data: sessionRows }] = await Promise.all([
        supabase.rpc("p2p_get_confirmation_actor_profiles", { p_actor_ids: actorIds }),
        evalIds.length ? supabase.from("p2p_lesson_evaluations").select("id,lesson_id,feedback").in("id", evalIds) : Promise.resolve({ data: [] }),
        reactionIds.length ? supabase.from("p2p_prayer_wall_reactions").select("id,post_id").in("id", reactionIds) : Promise.resolve({ data: [] }),
        sessionIds.length ? supabase.from("p2p_sessions").select("id,title").in("id", sessionIds) : Promise.resolve({ data: [] }),
      ]);
      const actorById = new Map((actors ?? []).map((a: Record<string, unknown>) => [a.id as string, a]));

      const lessonIds = Array.from(new Set((evalRows ?? []).map((e: Record<string, unknown>) => e.lesson_id as string)));
      const { data: lessons } = lessonIds.length
        ? await supabase.from("p2p_lessons").select("id,title").in("id", lessonIds)
        : { data: [] };
      const lessonTitleById = new Map((lessons ?? []).map((l: Record<string, unknown>) => [l.id as string, l.title as string]));
      const evalById = new Map((evalRows ?? []).map((e: Record<string, unknown>) => [e.id as string, e]));

      const postIds = Array.from(new Set((reactionRows ?? []).map((r: Record<string, unknown>) => r.post_id as string)));
      const { data: posts } = postIds.length
        ? await supabase.from("p2p_prayer_wall_posts").select("id,body").in("id", postIds)
        : { data: [] };
      const postBodyById = new Map((posts ?? []).map((p: Record<string, unknown>) => [p.id as string, p.body as string]));
      const reactionById = new Map((reactionRows ?? []).map((r: Record<string, unknown>) => [r.id as string, r]));
      const sessionTitleById = new Map((sessionRows ?? []).map((s: Record<string, unknown>) => [s.id as string, s.title as string]));

      const truncate = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

      const mapped: PendingPeerConfirmation[] = rows.map((r) => {
        const actor = actorById.get(r.actor_user_id as string) as Record<string, unknown> | undefined;
        let contextSummary: string | null = null;
        if (r.source_type === "evaluation_feedback") {
          const e = evalById.get(r.source_id as string) as Record<string, unknown> | undefined;
          const title = e ? lessonTitleById.get(e.lesson_id as string) ?? "a lesson" : "a lesson";
          const feedback = (e?.feedback as string) ?? "";
          contextSummary = feedback ? `${title} — "${truncate(feedback, 80)}"` : title;
        } else if (r.source_type === "prayer") {
          const reaction = reactionById.get(r.source_id as string) as Record<string, unknown> | undefined;
          const body = reaction ? postBodyById.get(reaction.post_id as string) : null;
          contextSummary = body ? `"${truncate(body, 80)}"` : null;
        } else if (r.source_type === "session") {
          contextSummary = sessionTitleById.get(r.source_id as string) ?? null;
        }
        return {
          id: r.id as string,
          confirmationType: r.confirmation_type as PeerConfirmationType,
          actorId: r.actor_user_id as string,
          actorName: (actor?.full_name as string) ?? "A fellow disciple",
          actorPhotoUrl: (actor?.photo_url as string) ?? null,
          contextSummary,
          createdAt: r.created_at as string,
          expiresAt: (r.expires_at as string) ?? null,
        };
      });
      setPendingConfirmations(mapped);
    } catch {
      setPendingConfirmations([]);
    }
  }, [profile?.id]);

  const confirmPeer = useCallback(async (confirmationId: string): Promise<string | null> => {
    try {
      const { error } = await supabase.rpc("p2p_process_confirmation", { p_confirmation_id: confirmationId });
      if (error) return error.message;
      setPendingConfirmations((prev) => prev.filter((c) => c.id !== confirmationId));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not confirm.";
    }
  }, []);

  const declinePeer = useCallback(async (confirmationId: string): Promise<string | null> => {
    try {
      const { error } = await supabase.rpc("p2p_decline_confirmation", { p_confirmation_id: confirmationId });
      if (error) return error.message;
      setPendingConfirmations((prev) => prev.filter((c) => c.id !== confirmationId));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Could not decline.";
    }
  }, []);

  useEffect(() => { loadPendingConfirmations(); }, [loadPendingConfirmations]);

  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    const channel = supabase
      .channel(`p2p_peer_confirmations_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "p2p_peer_confirmations", filter: `confirmer_user_id=eq.${userId}` },
        () => { loadPendingConfirmations(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, loadPendingConfirmations]);

  // Plans are p2p_curriculums rows now (migration 041_unify_plans_system.sql)
  // — their lessons use the SAME p2p_lesson_evaluations/p2p_submissions
  // pipeline as core curriculum, so there's no more separate "plan" source
  // to fetch or merge here.
  const refreshPendingEvaluations = useCallback(async (userId?: string) => {
    const uid = userId ?? profile?.id;
    if (!uid) return;
    try {
      const { data: evalRows } = await supabase.from("p2p_lesson_evaluations")
        .select("id,submission_id,lesson_id,submitter_id,assigned_at")
        .eq("evaluator_id", uid).eq("status", "pending").order("assigned_at", { ascending: true });
      const rows = (evalRows ?? []) as Record<string, unknown>[];
      if (rows.length === 0) {
        setPendingEvaluations([]); return;
      }

      const submissionIds = Array.from(new Set(rows.map((r) => r.submission_id as string)));
      const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string)));
      const submitterIds = Array.from(new Set(rows.map((r) => r.submitter_id as string)));

      const [{ data: subs }, { data: lessonsData }, { data: submitters }] = await Promise.all([
        submissionIds.length
          ? supabase.from("p2p_submissions").select("id,submission_type,text_content,media_url,duration_seconds,assignment_question_id").in("id", submissionIds)
          : Promise.resolve({ data: [] }),
        lessonIds.length ? supabase.from("p2p_lessons").select("id,title").in("id", lessonIds) : Promise.resolve({ data: [] }),
        supabase.from("p2p_profiles").select("id,full_name").in("id", submitterIds),
      ]);
      const subById = new Map((subs ?? []).map((s: Record<string, unknown>) => [s.id as string, s]));
      const titleById = new Map((lessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Lesson"]));
      const nameById = new Map((submitters ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.full_name as string) ?? "A fellow disciple"]));

      // Original assignment-question text, so the reviewer sees what was
      // actually asked, not just the learner's answer.
      const assignmentQuestionIds = Array.from(new Set(
        (subs ?? [])
          .map((s: Record<string, unknown>) => s.assignment_question_id as string | null)
          .filter((v): v is string => Boolean(v))
      ));
      const { data: assignmentQs } = assignmentQuestionIds.length
        ? await supabase.from("p2p_assignment_questions").select("id,question").in("id", assignmentQuestionIds)
        : { data: [] };
      const questionTextById = new Map((assignmentQs ?? []).map((q: Record<string, unknown>) => [q.id as string, q.question as string]));

      const mapped: PendingEvaluation[] = rows.map((row) => {
        const sub = subById.get(row.submission_id as string) as Record<string, unknown> | undefined;
        const questionId = sub?.assignment_question_id as string | null | undefined;
        return {
          id: row.id as string,
          submissionId: row.submission_id as string,
          lessonId: row.lesson_id as string,
          lessonTitle: titleById.get(row.lesson_id as string) ?? "Lesson",
          submitterId: row.submitter_id as string,
          submitterName: nameById.get(row.submitter_id as string) ?? "A fellow disciple",
          submissionType: ((sub?.submission_type as SubmissionType) ?? "text"),
          content: (sub?.text_content as string) ?? "",
          mediaUrl: (sub?.media_url as string) ?? null,
          durationSeconds: (sub?.duration_seconds as number) ?? null,
          assignedAt: row.assigned_at as string,
          questionText: questionId ? questionTextById.get(questionId) ?? null : null,
          source: "core",
        };
      });

      setPendingEvaluations(
        mapped.sort((a, b) => new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime())
      );
    } catch {
      setPendingEvaluations([]);
    }
  }, [profile]);

  const loadForestNetwork = useCallback(async (userId: string, userNode: ForestNode) => {
    try {
      type LinkRow = { mentor_id: string; disciple_id: string };
      type ProfileRow = { id: string; full_name: string | null; role: string | null; growth_level: number | null; country: string | null; username: string | null; is_verified: boolean | null };

      const allLinks: LinkRow[] = [];
      let frontier = [userId];
      const visitedMentors = new Set<string>();
      for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
        const rows = await selectInChunks<LinkRow>(
          "p2p_discipleship_links", "mentor_id,disciple_id", "mentor_id", frontier,
          (q) => q.eq("active", true)
        );
        frontier.forEach((m) => visitedMentors.add(m));
        allLinks.push(...rows);
        frontier = [...new Set(rows.map((r) => r.disciple_id))].filter((id) => !visitedMentors.has(id));
      }

      const discipleIds = [...new Set(allLinks.map((l) => l.disciple_id))];
      if (discipleIds.length === 0) {
        setForestNodes([userNode]);
        setForestStats({ totalDisciples: 0, hasDiscipleMaker: false, countriesReached: [] });
        return;
      }

      const profiles = await selectInChunks<ProfileRow>(
        "p2p_profiles", "id,full_name,role,growth_level,country,username,is_verified", "id", discipleIds
      );
      const profileById = new Map(
        profiles.map((p) => [p.id, p])
      );
      const childrenByMentor = new Map<string, string[]>();
      allLinks.forEach((l) => {
        const arr = childrenByMentor.get(l.mentor_id) ?? [];
        arr.push(l.disciple_id);
        childrenByMentor.set(l.mentor_id, arr);
      });

      function buildNode(id: string, depth: number): ForestNode {
        const p = profileById.get(id);
        return {
          id,
          name: p?.full_name ?? "A disciple",
          role: p?.role ?? "student",
          growthLevel: p?.growth_level ?? 0,
          country: p?.country ?? undefined,
          depth,
          children: (childrenByMentor.get(id) ?? []).map((childId) => buildNode(childId, depth + 1)),
          username: p?.username ?? null,
          isVerified: p?.is_verified ?? false,
        };
      }

      const rootWithChildren: ForestNode = {
        ...userNode,
        children: (childrenByMentor.get(userId) ?? []).map((id) => buildNode(id, 1)),
      };
      setForestNodes([rootWithChildren]);

      const hasDiscipleMaker = rootWithChildren.children.some((c) => c.children.length > 0);
      const countriesReached = [
        ...new Set(
          discipleIds
            .map((id) => profileById.get(id)?.country)
            .filter((c): c is string => !!c)
        ),
      ];
      setForestStats({
        totalDisciples: discipleIds.length,
        hasDiscipleMaker,
        countriesReached,
      });
    } catch {
      setForestNodes([userNode]);
      setForestStats({ totalDisciples: 0, hasDiscipleMaker: false, countriesReached: [] });
    }
  }, []);

  // Generational Forest View data — cached in state, only refetched on
  // explicit call (pull-to-refresh on /forest, or a fresh screen mount).
  const loadForestData = useCallback(async (userId: string) => {
    setForestDataLoading(true);
    try {
      const res = await fetch(`${getApiUrl()}/profiles/${userId}/forest`);
      if (!res.ok) { setForestData(null); return; }
      const data = (await res.json()) as GenerationalForestData;
      setForestData(data);
    } catch {
      setForestData(null);
    } finally {
      setForestDataLoading(false);
    }
  }, []);

  // Living Tree real data (Prompt 5) — get_user_tree_data RPC (migration 051)
  // + the mentee list used for branch tap tooltips.
  const loadTreeData = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase.rpc("get_user_tree_data", { p_user_id: userId });
      if (error || !data) { setTreeData(null); return; }
      setTreeData(buildTreeData(data as Record<string, unknown>));
    } catch {
      setTreeData(null);
    }

    try {
      const { data: links } = await supabase
        .from("p2p_discipleship_links")
        .select("disciple_id")
        .eq("mentor_id", userId)
        .eq("active", true);
      const discipleIds = ((links ?? []) as Record<string, unknown>[]).map((l) => l.disciple_id as string);
      if (discipleIds.length === 0) { setTreeMentees([]); return; }

      // profiles_select_scoped (migration 046) already lets a mentor read
      // their active disciples' profiles — growth_level is used here as an
      // honest stand-in for "current module," since reading another user's
      // literal lesson-by-lesson progress would need RLS surface area this
      // app doesn't grant a mentor today.
      const menteeProfiles = await selectInChunks<Record<string, unknown>>(
        "p2p_profiles", "id, full_name, growth_level, last_active_at", "id", discipleIds
      );

      const mentees: MenteeBranchInfo[] = menteeProfiles.map((p) => {
        const lastActive = p.last_active_at as string | null;
        const daysAgo = lastActive ? Math.floor((Date.now() - new Date(lastActive).getTime()) / (24 * 60 * 60 * 1000)) : 0;
        return {
          id: p.id as string,
          name: (p.full_name as string) ?? "A disciple",
          currentModule: `Level ${(p.growth_level as number) ?? 0}`,
          daysAgo,
          isWilting: daysAgo >= 14,
        };
      });
      setTreeMentees(mentees);
    } catch {
      setTreeMentees([]);
    }
  }, []);

  // The Completion Moment (Prompt 6) — fires exactly once, the moment all 12
  // Core Curriculum modules (order_index 1-12; 0 is the orientation module,
  // same convention as the Maturity Fruit trigger) are fully complete.
  // Setting curriculum_completed_at happens immediately here; the actual
  // navigation to the cinematic screen is deferred (see
  // pendingCompletionMoment / CompletionMomentHost in _layout.tsx) so it
  // never interrupts a lesson mid-session.
  const checkCurriculumCompletion = useCallback(async (userId: string) => {
    try {
      const { data: profileRow } = await supabase.from("p2p_profiles").select("curriculum_completed_at").eq("id", userId).maybeSingle();
      if ((profileRow as Record<string, unknown> | null)?.curriculum_completed_at) return;

      const { data: curriculumId } = await supabase.rpc("p2p_active_curriculum_id");
      if (!curriculumId) return;

      const { data: coreModules } = await supabase
        .from("p2p_modules")
        .select("id")
        .eq("curriculum_id", curriculumId as string)
        .gte("order_index", 1)
        .lte("order_index", 12);
      const moduleIds = ((coreModules ?? []) as Record<string, unknown>[]).map((m) => m.id as string);
      if (moduleIds.length < 12) return;

      const results = await Promise.all(
        moduleIds.map((id) => supabase.rpc("p2p_module_fully_completed", { p_user_id: userId, p_module_id: id }))
      );
      const completedCount = results.filter((r) => r.data === true).length;
      if (completedCount < 12) return;

      await supabase.from("p2p_profiles").update({ curriculum_completed_at: new Date().toISOString() }).eq("id", userId);

      await supabase.rpc("p2p_award_fruit", {
        p_user_id: userId, p_fruit_key: "maturity_fruit", p_trigger_event: "curriculum_complete",
        p_source_type: "milestone", p_source_id: null,
        p_evidence: { summary: "Completed the entire 12-module Core Curriculum." },
      });
      await supabase.rpc("p2p_award_fruit", {
        p_user_id: userId, p_fruit_key: "harvest_fruit", p_trigger_event: "curriculum_complete",
        p_source_type: "milestone", p_source_id: null,
        p_evidence: { summary: "Reached the harvest moment — ready to guide others." },
      });

      setPendingCompletionMoment(true);
    } catch {}
  }, []);

  const resetAllState = useCallback(() => {
    setModules([]);
    setLessons([]);
    setPlans([]);
    setPrayers([]);
    setSessions([]);
    setForestNodes([]);
    setForestStats({ totalDisciples: 0, hasDiscipleMaker: false, countriesReached: [] });
    setFruitCatalog([]);
    setUserFruits([]);
    setFruitProgress([]);
    setDailyVerse(null);
    setPendingEvaluations([]);
    setToastEvent(null);
    setCelebrationEvent(null);
  }, []);

  const lastLoadedUserId = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    if (authLoading) return;
    if (!isAuthenticated || !profile?.id) {
      resetAllState();
      lastLoadedUserId.current = null;
      setIsLoading(false);
      return;
    }
    if (lastLoadedUserId.current !== profile.id) {
      resetAllState();
      lastLoadedUserId.current = profile.id;
    }
    setIsLoading(true);
    try {
      const dayIdx = new Date().getDate() % DAILY_VERSES.length;
      setDailyVerse(DAILY_VERSES[dayIdx]);
      const [prayersRes, sessionsRes] = await Promise.all([
        supabase.from("p2p_prayer_requests").select("*").order("created_at", { ascending: false }).limit(30),
        supabase.from("p2p_sessions").select("*").order("scheduled_time", { ascending: true }).limit(10),
      ]);
      if (prayersRes.data && prayersRes.data.length > 0) {
        setPrayers(prayersRes.data.map((p: Record<string, unknown>) => ({
          id: p.id as string, userId: (p.user_id ?? "") as string,
          userName: (p.user_name ?? "Anonymous") as string, nation: p.nation as string | undefined,
          text: p.text as string, prayerCount: (p.prayer_count ?? 0) as number,
          createdAt: p.created_at as string, hasPrayed: false,
        })));
      } else {
        setPrayers([
          { id: "p1", userId: "u1", userName: "Emmanuel K.", nation: "Ghana", text: "Pray for our church plant in Kumasi — we need a gathering place.", prayerCount: 23, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p2", userId: "u2", userName: "Sarah M.", nation: "Kenya", text: "Pray for my discipleship group — 3 members are facing persecution.", prayerCount: 47, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p3", userId: "u3", userName: "David L.", nation: "South Korea", text: "Intercede for unreached villages in North Korea. God can open doors.", prayerCount: 89, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p4", userId: "u4", userName: "Grace A.", nation: "Nigeria", text: "Our weekly study group needs wisdom to navigate difficult theological questions.", prayerCount: 15, createdAt: new Date().toISOString(), hasPrayed: false },
        ]);
      }
      if (sessionsRes.data && sessionsRes.data.length > 0) {
        setSessions(sessionsRes.data.map((s: Record<string, unknown>) => ({
          id: s.id as string, title: s.title as string, description: s.description as string | undefined,
          scheduledAt: s.scheduled_time as string, durationMinutes: (s.duration_minutes ?? 45) as number,
          participantCount: (s.participant_count ?? 0) as number, isLive: (s.is_live ?? false) as boolean,
          hostName: (s.host_name ?? "Unknown") as string,
        })));
      } else {
        const now = new Date();
        setSessions([
          { id: "s1", title: "Book of John — Chapter 15", description: "Abiding in the Vine", scheduledAt: new Date(now.getTime() + 3600000).toISOString(), durationMinutes: 45, participantCount: 4, isLive: true, hostName: "Pastor James" },
          { id: "s2", title: "Romans Deep Dive", description: "Justification by faith", scheduledAt: new Date(now.getTime() + 86400000).toISOString(), durationMinutes: 60, participantCount: 2, isLive: false, hostName: "Sister Ruth" },
        ]);
      }
      await Promise.all([
        loadCurriculum(profile?.id, profile?.contentLanguage ?? "en"),
        loadPlans(profile?.id, profile?.contentLanguage ?? "en"),
      ]);
      if (profile?.id) {
        await refreshPendingEvaluations(profile.id);
        await checkGrowthEvents(profile.id);
      }
      {
        // Catalog is public (RLS: any authenticated user) so it loads
        // regardless of whether profile is set yet.
        const { data: catalogData } = await supabase
          .from("p2p_fruits_catalog")
          .select("fruit_key,name,description,category,verification_level,rarity,icon,theme_verse,theme_verse_text,biblical_meaning,unlock_condition_description,is_hidden,display_order")
          .eq("is_active", true)
          .order("display_order", { ascending: true });
        setFruitCatalog((catalogData ?? []).map((f: Record<string, unknown>) => ({
          fruitKey: f.fruit_key as string,
          name: f.name as string,
          description: f.description as string,
          category: f.category as FruitCatalogEntry["category"],
          verificationLevel: f.verification_level as FruitCatalogEntry["verificationLevel"],
          rarity: f.rarity as FruitCatalogEntry["rarity"],
          icon: f.icon as string,
          themeVerse: (f.theme_verse as string) ?? null,
          themeVerseText: (f.theme_verse_text as string) ?? null,
          biblicalMeaning: (f.biblical_meaning as string) ?? null,
          unlockConditionDescription: (f.unlock_condition_description as string) ?? null,
          isHidden: Boolean(f.is_hidden),
          displayOrder: (f.display_order as number) ?? null,
        })));
      }
      if (profile?.id) {
        const [{ data: fruitsData }, { data: progressData }] = await Promise.all([
          supabase
            .from("p2p_user_fruits")
            .select("fruit_key,awarded_at,awarded_by,evidence,evidence_summary")
            .eq("user_id", profile.id)
            .order("awarded_at", { ascending: false }),
          supabase
            .from("p2p_fruit_progress")
            .select("fruit_key,current_count,required_count")
            .eq("user_id", profile.id),
        ]);
        setUserFruits((fruitsData ?? []).map((f: Record<string, unknown>) => ({
          fruitKey: f.fruit_key as string,
          awardedAt: f.awarded_at as string,
          awardedBy: f.awarded_by as EarnedFruit["awardedBy"],
          evidence: (f.evidence as Record<string, unknown>) ?? {},
          evidenceSummary: (f.evidence_summary as string) ?? null,
        })));
        setFruitProgress((progressData ?? []).map((p: Record<string, unknown>) => ({
          fruitKey: p.fruit_key as string,
          currentCount: (p.current_count as number) ?? 0,
          requiredCount: (p.required_count as number) ?? 0,
        })));
        const { data: missionsData } = await supabase
          .from("p2p_missions")
          .select("id,title,nation,population,description,prayer_count,language,religion")
          .order("prayer_count", { ascending: false });
        setMissions((missionsData ?? []).map((m: Record<string, unknown>) => ({
          id: m.id as string,
          title: (m.title as string) ?? "",
          nation: (m.nation as string) ?? "",
          population: (m.population as string) ?? "",
          description: (m.description as string) ?? "",
          prayerCount: (m.prayer_count as number) ?? 0,
          language: (m.language as string) ?? "",
          religion: (m.religion as string) ?? "",
        })));
      }
      if (profile) {
        await loadForestNetwork(profile.id, {
          id: profile.id, name: profile.displayName, role: profile.role,
          growthLevel: profile.growthLevel, country: profile.country, depth: 0,
          children: [],
        });
        await loadTreeData(profile.id);
        // Catches the case a self-submission check can't: a peer evaluator
        // approving this user's last lesson flips completion via a DB
        // trigger (p2p_apply_evaluation_outcome), from the EVALUATOR's
        // session, not this user's — so this user's own next app load is
        // what actually catches it.
        await checkCurriculumCompletion(profile.id);
      }
    } catch {
      setDailyVerse(DAILY_VERSES[0]);
      setModules(FALLBACK_MODULES);
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated, profile, loadCurriculum, loadPlans, refreshPendingEvaluations, loadForestNetwork, loadTreeData, checkCurriculumCompletion]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadData(); }, [loadData]);

  // Curriculum/Plans unlock state is only computed from `modules`/`lessons`/`plans`,
  // which loadData() populates once per login and never refetches. A peer evaluator
  // approving a submission on their own device flips p2p_lesson_progress.completed
  // (or the Plans equivalent) server-side, but this submitter's cached state never
  // hears about it, so the "next lesson unlocked" UI stays stale until a manual
  // pull-to-refresh or full app reload. Subscribe to the submitter's own evaluation
  // rows so an approval/needs_revision resolution refetches the state that actually
  // drives lock computation.
  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    const contentLanguage = profile.contentLanguage ?? "en";
    // event "*": INSERT covers a new evaluation being created on submission
    // (submitted counts + next-lesson unlock), UPDATE covers an evaluator
    // resolving it (approved counts + review-lesson/module unlocks).
    // Plans are p2p_curriculums rows now (migration 041_unify_plans_system.sql)
    // — a plan's lessons share the SAME p2p_lesson_evaluations table core
    // curriculum uses, so this one subscription covers both; there is no
    // more separate p2p_plan_lesson_evaluations table to listen on.
    const channel = supabase
      .channel(`p2p_unlock_sync_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "p2p_lesson_evaluations", filter: `submitter_id=eq.${userId}` },
        () => { loadCurriculum(userId, contentLanguage); loadPlans(userId, contentLanguage); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, profile?.contentLanguage, loadCurriculum, loadPlans]);

  // Fruit celebration — fires the instant the award engine (migration 033)
  // inserts a new p2p_user_fruits row for this user. Queued rather than
  // shown immediately: a single event (e.g. finishing a module) can award
  // several fruits at once, and they should celebrate one at a time, not
  // stack on top of each other.
  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    const channel = supabase
      .channel(`p2p_fruit_celebration_${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_user_fruits", filter: `user_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;
          const fruitKey = row.fruit_key as string;

          let catalogEntry = fruitCatalog.find((f) => f.fruitKey === fruitKey);
          if (!catalogEntry) {
            const { data } = await supabase
              .from("p2p_fruits_catalog")
              .select("fruit_key,name,icon,theme_verse")
              .eq("fruit_key", fruitKey)
              .maybeSingle();
            if (data) {
              catalogEntry = {
                fruitKey: data.fruit_key, name: data.name, icon: data.icon,
                themeVerse: data.theme_verse ?? null,
              } as FruitCatalogEntry;
            }
          }
          if (!catalogEntry) return;

          let menteeName: string | null = null;
          if (row.source_type === "mentor_action" && row.source_id) {
            const { data: menteeProfile } = await supabase
              .from("p2p_profiles").select("full_name").eq("id", row.source_id as string).maybeSingle();
            menteeName = (menteeProfile?.full_name as string)?.split(" ")[0] ?? null;
          }

          const celebration: FruitCelebration = {
            fruitKey,
            name: catalogEntry.name,
            icon: catalogEntry.icon,
            themeVerse: catalogEntry.themeVerse,
            evidenceSummary: (row.evidence_summary as string) ?? null,
            menteeName,
          };
          setFruitCelebrationQueue((prev) => [...prev, celebration]);
          setUserFruits((prev) => [
            { fruitKey, awardedAt: row.awarded_at as string, awardedBy: row.awarded_by as EarnedFruit["awardedBy"], evidence: (row.evidence as Record<string, unknown>) ?? {}, evidenceSummary: (row.evidence_summary as string) ?? null },
            ...prev,
          ]);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, fruitCatalog]);

  const dismissCurrentFruitCelebration = useCallback(() => {
    setFruitCelebrationQueue((prev) => prev.slice(1));
  }, []);

  // Incoming call detection — fires the moment someone inserts a
  // p2p_incoming_calls row targeting this user, regardless of which screen
  // they're currently on. IncomingCallHost (app/_layout.tsx) reads
  // incomingCall and navigates to the ringing screen the same way
  // GrowthCelebrationHost does for fruit celebrations.
  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    const channel = supabase
      .channel(`p2p_incoming_calls_${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_incoming_calls", filter: `recipient_id=eq.${userId}` },
        async (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.status !== "ringing") return;

          const { data: callerProfile } = await supabase
            .from("p2p_profiles").select("full_name").eq("id", row.caller_id as string).maybeSingle();

          setIncomingCall({
            callId: row.id as string,
            channelName: row.channel_name as string,
            callType: row.call_type as CallType,
            callerId: row.caller_id as string,
            callerName: (callerProfile?.full_name as string) ?? "Someone",
            conversationId: (row.conversation_id as string) ?? null,
            callLogId: (row.call_log_id as string) ?? null,
            invitationId: (row.invitation_id as string) ?? null,
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const dismissIncomingCall = useCallback(() => {
    setIncomingCall(null);
  }, []);

  // Peer Circle "Start Session" invites — same shape as incomingCall above,
  // but sourced from p2p_notifications (a generic table also used by Break
  // Rooms and pastoral/crisis calls) rather than a dedicated table, since
  // this is a dismissible banner, not a ringing call.
  useEffect(() => {
    if (!profile?.id) return;
    const userId = profile.id;
    const channel = supabase
      .channel(`p2p_notifications_${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (row.notification_type !== "circle_session_start") return;
          const data = row.data as Record<string, unknown> | null;
          if (!data?.circleId || !data?.channelName) return;
          setCircleSessionInvite({
            notificationId: row.id as string,
            circleId: data.circleId as string,
            circleName: (data.circleName as string) ?? "Peer Circle",
            channelName: data.channelName as string,
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id]);

  const dismissCircleSessionInvite = useCallback(() => {
    setCircleSessionInvite(null);
  }, []);

  // Study Together C7 — Notification Center unread badge. Reuses the exact
  // RLS-protected direct-client realtime pattern above (auth.uid()=user_id
  // on p2p_notifications), just for every notification type rather than
  // one specific one, since a badge count has no reason to filter by type.
  const getMyNotifications = useCallback(async (): Promise<AppNotification[]> => {
    if (!profile) return [];
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${getApiUrl()}/notifications/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return [];
      const rows = await res.json();
      return (rows as Record<string, unknown>[]).map((r) => ({
        id: r.id as string, title: r.title as string, message: (r.message as string) ?? null,
        isRead: (r.isRead as boolean) ?? false, createdAt: r.createdAt as string,
        notificationType: (r.notificationType as string) ?? null, data: (r.data as Record<string, unknown>) ?? null,
      }));
    } catch (e) {
      console.error("getMyNotifications failed", e);
      return [];
    }
  }, [profile]);

  const markNotificationRead = useCallback(async (id: string): Promise<void> => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      await fetch(`${getApiUrl()}/notifications/me/${id}/read`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      setUnreadNotificationCount((c) => Math.max(0, c - 1));
    } catch (e) {
      console.error("markNotificationRead failed", e);
    }
  }, []);

  const markAllNotificationsRead = useCallback(async (): Promise<void> => {
    try {
      await authedFetch("/notifications/me/read-all", { method: "POST" });
      setUnreadNotificationCount(0);
    } catch (e) {
      console.error("markAllNotificationsRead failed", e);
    }
  }, []);

  useEffect(() => {
    if (!profile?.id) return;
    getMyNotifications().then((rows) => setUnreadNotificationCount(rows.filter((r) => !r.isRead).length));
    const channel = supabase
      .channel(`p2p_notifications_unread_${profile.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "p2p_notifications", filter: `user_id=eq.${profile.id}` },
        () => setUnreadNotificationCount((c) => c + 1)
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, getMyNotifications]);

  const checkGrowthEvents = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("p2p_growth_events")
        .select("id,event_type,label,score_before,score_after,created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error || !data || data.length === 0) return;

      const lastSeenKey = `growth_event_last_seen_${userId}`;
      let lastSeenAt = "";
      try { lastSeenAt = (await AsyncStorage.getItem(lastSeenKey)) ?? ""; } catch {}

      const rows = data as Record<string, unknown>[];
      const newest = rows[0].created_at as string;

      const unseen = rows.filter((r) => !lastSeenAt || (r.created_at as string) > lastSeenAt);
      if (unseen.length === 0) return;

      const toEvent = (r: Record<string, unknown>): GrowthEvent => ({
        id: r.id as string,
        eventType: r.event_type as GrowthEventType,
        label: r.label as string,
        scoreBefore: r.score_before as number,
        scoreAfter: r.score_after as number,
        createdAt: r.created_at as string,
      });

      const moduleEvent = unseen.find((r) => r.event_type === "module_completed");
      const lessonEvent = unseen.find((r) => r.event_type === "lesson_completed");

      if (moduleEvent) {
        setCelebrationEvent(toEvent(moduleEvent));
      } else if (lessonEvent) {
        setToastEvent(toEvent(lessonEvent));
      }

      try { await AsyncStorage.setItem(lastSeenKey, newest); } catch {}
    } catch {}
  }, []);

  const dismissToastEvent = useCallback(() => setToastEvent(null), []);
  const dismissCelebrationEvent = useCallback(() => setCelebrationEvent(null), []);

  const addPrayer = useCallback(async (text: string, nation?: string) => {
    if (!profile) return;
    const newPrayer: PrayerRequest = {
      id: Date.now().toString(), userId: profile.id, userName: profile.displayName,
      nation, text, prayerCount: 0, createdAt: new Date().toISOString(), hasPrayed: false,
    };
    try {
      await supabase.from("p2p_prayer_requests").insert({
        user_id: profile.id, user_name: profile.displayName, nation, text,
        prayer_count: 0, created_at: newPrayer.createdAt,
      });
    } catch {}
    setPrayers((prev) => [newPrayer, ...prev]);
  }, [profile]);

  const prayForRequest = useCallback(async (id: string) => {
    setPrayers((prev) => prev.map((p) => p.id === id ? { ...p, prayerCount: p.prayerCount + 1, hasPrayed: true } : p));
    try { await supabase.rpc("increment_prayer_count", { prayer_id: id }); } catch {}
  }, []);

  const mapPrayerWallRow = useCallback((r: any, myId?: string): PrayerWallPost => {
    const reactions: Array<{ user_id: string; reaction_type: PrayerWallReactionType }> = r.p2p_prayer_wall_reactions || [];
    const comments: Array<{ id: string }> = r.p2p_prayer_wall_comments || [];
    const answeredFrom = r.answered_from_post
      ? {
          id: r.answered_from_post.id,
          body: r.answered_from_post.body,
          userName: r.answered_from_post.is_anonymous ? "Anonymous" : (r.answered_from_post.p2p_profiles?.full_name || "A believer"),
          isAnonymous: r.answered_from_post.is_anonymous,
        }
      : null;
    return {
      id: r.id,
      userId: r.user_id,
      userName: r.is_anonymous ? "Anonymous" : (r.p2p_profiles?.full_name || "A believer"),
      postType: r.post_type,
      nationCode: r.nation_code,
      body: r.body,
      isAnonymous: r.is_anonymous,
      visibility: r.visibility,
      answeredFromPostId: r.answered_from_post_id,
      answeredFromPost: answeredFrom,
      status: r.status,
      createdAt: r.created_at,
      prayingCount: reactions.filter((x) => x.reaction_type === "praying").length,
      amenCount: reactions.filter((x) => x.reaction_type === "amen").length,
      myReactions: myId ? reactions.filter((x) => x.user_id === myId).map((x) => x.reaction_type) : [],
      commentCount: comments.length,
    };
  }, []);

  const getPrayerWallPosts = useCallback(async (sort: "recent" | "engaged"): Promise<PrayerWallPost[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_prayer_wall_posts")
        .select(`
          *,
          p2p_profiles ( full_name ),
          p2p_prayer_wall_reactions ( user_id, reaction_type ),
          p2p_prayer_wall_comments ( id ),
          answered_from_post:answered_from_post_id ( id, body, is_anonymous, p2p_profiles ( full_name ) )
        `)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data || []).map((r: any) => mapPrayerWallRow(r, profile.id));
      if (sort === "engaged") {
        rows.sort((a, b) => (b.prayingCount + b.amenCount + b.commentCount) - (a.prayingCount + a.amenCount + a.commentCount));
      }
      return rows;
    } catch (e) {
      console.error("getPrayerWallPosts failed", e);
      return [];
    }
  }, [profile, mapPrayerWallRow]);

  const createPrayerWallPost = useCallback(async (params: {
    postType: PrayerWallPostType;
    nationCode?: string | null;
    body: string;
    isAnonymous: boolean;
    visibility: PrayerWallVisibility;
    answeredFromPostId?: string | null;
  }): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_prayer_wall_posts").insert({
        user_id: profile.id,
        post_type: params.postType,
        nation_code: params.nationCode || null,
        body: params.body,
        is_anonymous: params.isAnonymous,
        visibility: params.visibility,
        answered_from_post_id: params.answeredFromPostId || null,
        status: params.postType === "testimony" ? "answered" : "open",
      });
      if (error) throw error;
      if (params.answeredFromPostId) {
        await supabase.from("p2p_prayer_wall_posts")
          .update({ status: "answered" })
          .eq("id", params.answeredFromPostId)
          .eq("user_id", profile.id);
      }
      return null;
    } catch (e: any) {
      console.error("createPrayerWallPost failed", e);
      return e?.message || "Could not create post";
    }
  }, [profile]);

  const reactToPost = useCallback(async (postId: string, reactionType: PrayerWallReactionType): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_prayer_wall_reactions").insert({
        post_id: postId, user_id: profile.id, reaction_type: reactionType,
      });
      if (error) {
        if ((error as any).code === "23505") return null; // already reacted, treat as no-op success
        throw error;
      }
      try {
        await supabase.rpc("p2p_increment_servant_score", { p_user_id: profile.id, p_amount: 1 });
      } catch {}
      return null;
    } catch (e: any) {
      console.error("reactToPost failed", e);
      return e?.message || "Could not react";
    }
  }, [profile]);

  const markPostAnswered = useCallback(async (postId: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_prayer_wall_posts")
        .update({ status: "answered" })
        .eq("id", postId)
        .eq("user_id", profile.id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("markPostAnswered failed", e);
      return e?.message || "Could not update post";
    }
  }, [profile]);

  const getComments = useCallback(async (postId: string): Promise<PrayerWallComment[]> => {
    try {
      const { data, error } = await supabase
        .from("p2p_prayer_wall_comments")
        .select("*, p2p_profiles ( full_name )")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id, postId: r.post_id, userId: r.user_id,
        userName: r.p2p_profiles?.full_name || "A believer",
        body: r.body, createdAt: r.created_at,
      }));
    } catch (e) {
      console.error("getComments failed", e);
      return [];
    }
  }, []);

  const addComment = useCallback(async (postId: string, body: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_prayer_wall_comments").insert({
        post_id: postId, user_id: profile.id, body,
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addComment failed", e);
      return e?.message || "Could not add comment";
    }
  }, [profile]);

  const submitHelpRequest = useCallback(async (params: {
    tier: HelpRequestTier;
    category?: string | null;
    note?: string | null;
  }): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_help_requests").insert({
        user_id: profile.id,
        tier: params.tier,
        category: params.category || null,
        note: params.note || null,
        status: "open",
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("submitHelpRequest failed", e);
      return e?.message || "Could not submit help request";
    }
  }, [profile]);

  const getHelpRequests = useCallback(async (filters?: { tier?: HelpRequestTier; status?: HelpRequestStatus }): Promise<HelpRequest[]> => {
    if (!profile) return [];
    try {
      let query = supabase
        .from("p2p_help_requests")
        .select("*, p2p_profiles ( full_name )")
        .order("created_at", { ascending: false });
      if (filters?.tier) query = query.eq("tier", filters.tier);
      if (filters?.status) query = query.eq("status", filters.status);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        userName: r.p2p_profiles?.full_name || "A user",
        tier: r.tier,
        category: r.category,
        note: r.note,
        status: r.status,
        createdAt: r.created_at,
      }));
    } catch (e) {
      console.error("getHelpRequests failed", e);
      return [];
    }
  }, [profile]);

  const updateHelpRequestStatus = useCallback(async (id: string, status: HelpRequestStatus): Promise<string | null> => {
    try {
      const { error } = await supabase.from("p2p_help_requests").update({ status }).eq("id", id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("updateHelpRequestStatus failed", e);
      return e?.message || "Could not update status";
    }
  }, []);

  const reportContent = useCallback(async (contentType: ModerationContentType, contentId: string, reason: string): Promise<string | null> => {
    try {
      const { error } = await supabase.rpc("p2p_report_content", {
        p_content_type: contentType,
        p_content_id: contentId,
        p_reason: reason,
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("reportContent failed", e);
      return e?.message || "Could not submit report";
    }
  }, []);

  const getModerationQueue = useCallback(async (status?: ModerationFlagStatus): Promise<ModerationFlag[]> => {
    try {
      let query = supabase
        .from("p2p_content_flags")
        .select("*, reporter:p2p_profiles!p2p_content_flags_reporter_id_fkey(full_name)")
        .order("created_at", { ascending: false });
      if (status) query = query.eq("status", status);
      else query = query.eq("status", "open");
      const { data, error } = await query;
      if (error) throw error;

      const rows = data || [];
      const identities = await Promise.all(
        rows.map((r: any) =>
          r.author_id
            ? supabase.rpc("p2p_flag_poster_identity", { p_user_id: r.author_id })
            : Promise.resolve({ data: null, error: null })
        )
      );

      return rows.map((r: any, i: number) => {
        const idRow = identities[i]?.data?.[0];
        return {
          id: r.id,
          contentType: r.content_type,
          contentId: r.content_id,
          authorId: r.author_id,
          reporterId: r.reporter_id,
          reporterName: r.reporter?.full_name || null,
          reason: r.reason,
          contentSnapshot: r.content_snapshot,
          status: r.status,
          createdAt: r.created_at,
          poster: idRow
            ? {
                id: idRow.id,
                fullName: idRow.full_name || "Unnamed",
                avatarUrl: idRow.avatar_url,
                totalFlags: Number(idRow.total_flags) || 0,
                dismissedCount: Number(idRow.dismissed_count) || 0,
                warnedCount: Number(idRow.warned_count) || 0,
                removedCount: Number(idRow.removed_count) || 0,
                escalatedCount: Number(idRow.escalated_count) || 0,
              }
            : null,
        };
      });
    } catch (e) {
      console.error("getModerationQueue failed", e);
      return [];
    }
  }, []);

  const moderateFlag = useCallback(async (flagId: string, action: "dismiss" | "warn" | "remove" | "escalate", note?: string): Promise<string | null> => {
    try {
      const { error } = await supabase.rpc("p2p_moderate_flag", {
        p_flag_id: flagId,
        p_action: action,
        p_note: note ?? null,
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("moderateFlag failed", e);
      return e?.message || "Could not complete action";
    }
  }, []);

  const searchUsersByUsername = useCallback(async (query: string): Promise<UsernameSearchResult[]> => {
    if (query.trim().length < 2) return [];
    try {
      const params = new URLSearchParams({ q: query.trim() });
      if (profile?.id) params.set("viewerId", profile.id);
      const res = await fetch(`${getApiUrl()}/profiles/search?${params.toString()}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("searchUsersByUsername failed", e);
      return [];
    }
  }, [profile?.id]);

  const getProfileByUsername = useCallback(async (username: string): Promise<PublicUserProfile | null> => {
    try {
      const params = profile?.id ? `?viewerId=${profile.id}` : "";
      const res = await fetch(`${getApiUrl()}/profiles/username/${encodeURIComponent(username)}${params}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getProfileByUsername failed", e);
      return null;
    }
  }, [profile?.id]);

  const sendConnectionRequest = useCallback(async (params: {
    toUserId: string; requestType: "connect" | "circle_invite"; circleId?: string; message?: string;
  }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/connections/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromUserId: profile.id, toUserId: params.toUserId, requestType: params.requestType, circleId: params.circleId, message: params.message }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't send request";
      return null;
    } catch (e: any) {
      console.error("sendConnectionRequest failed", e);
      return e?.message || "Couldn't send request";
    }
  }, [profile?.id]);

  const respondToConnectionRequest = useCallback(async (requestId: string, response: "accepted" | "declined"): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/connections/${requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responderId: profile.id, response }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't respond to request";
      return null;
    } catch (e: any) {
      console.error("respondToConnectionRequest failed", e);
      return e?.message || "Couldn't respond to request";
    }
  }, [profile?.id]);

  const refreshBlockedUsers = useCallback(async (): Promise<void> => {
    if (!profile?.id) { setBlockedUsers([]); return; }
    try {
      const res = await fetch(`${getApiUrl()}/connections/blocked/${profile.id}`);
      setBlockedUsers(res.ok ? await res.json() : []);
    } catch (e) {
      console.error("refreshBlockedUsers failed", e);
    }
  }, [profile?.id]);

  const blockUser = useCallback(async (userId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/connections/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockerId: profile.id, blockedId: userId }),
      });
      if (!res.ok) { const body = await res.json(); return body?.error ?? "Couldn't block user"; }
      await refreshBlockedUsers();
      return null;
    } catch (e: any) {
      console.error("blockUser failed", e);
      return e?.message || "Couldn't block user";
    }
  }, [profile?.id, refreshBlockedUsers]);

  const unblockUser = useCallback(async (userId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/connections/unblock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockerId: profile.id, blockedId: userId }),
      });
      if (!res.ok) { const body = await res.json(); return body?.error ?? "Couldn't unblock user"; }
      await refreshBlockedUsers();
      return null;
    } catch (e: any) {
      console.error("unblockUser failed", e);
      return e?.message || "Couldn't unblock user";
    }
  }, [profile?.id, refreshBlockedUsers]);

  const loadVerificationStatus = useCallback(async (): Promise<void> => {
    if (!profile?.id) { setVerificationStatus(null); return; }
    try {
      const res = await fetch(`${getApiUrl()}/profiles/verification/status?userId=${profile.id}`);
      setVerificationStatus(res.ok ? await res.json() : null);
    } catch (e) {
      console.error("loadVerificationStatus failed", e);
    }
  }, [profile?.id]);

  // React Native's fetch FormData accepts { uri, name, type } for a file
  // part — same shape as account.tsx's avatar upload, just posted to Express
  // (multer) instead of straight to Supabase storage, since the verification
  // bucket is service-role-only (see migration 065).
  const submitVerification = useCallback(async (
    method: "selfie_note" | "video_selfie", fileUri: string, fileName: string, mimeType: string
  ): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const form = new FormData();
      form.append("userId", profile.id);
      form.append("method", method);
      form.append("file", { uri: fileUri, name: fileName, type: mimeType } as any);
      const res = await fetch(`${getApiUrl()}/profiles/verification/submit`, { method: "POST", body: form as any });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't submit verification";
      await loadVerificationStatus();
      return null;
    } catch (e: any) {
      console.error("submitVerification failed", e);
      return e?.message || "Couldn't submit verification";
    }
  }, [profile?.id, loadVerificationStatus]);

  const withdrawVerification = useCallback(async (): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/profiles/verification/withdraw`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: profile.id }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't withdraw application";
      await loadVerificationStatus();
      return null;
    } catch (e: any) {
      console.error("withdrawVerification failed", e);
      return e?.message || "Couldn't withdraw application";
    }
  }, [profile?.id, loadVerificationStatus]);

  const toggleBadgeVisibility = useCallback(async (visible: boolean): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/profiles/verification/badge-visibility`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: profile.id, visible }),
      });
      if (!res.ok) { const body = await res.json(); return body?.error ?? "Couldn't update badge visibility"; }
      await loadVerificationStatus();
      return null;
    } catch (e: any) {
      console.error("toggleBadgeVisibility failed", e);
      return e?.message || "Couldn't update badge visibility";
    }
  }, [profile?.id, loadVerificationStatus]);

  const refreshGrainCount = useCallback(async (): Promise<void> => {
    if (!profile?.id) { setGrainCount(0); setPeopleInvited(0); return; }
    try {
      const res = await fetch(`${getApiUrl()}/profiles/${profile.id}/grain`);
      if (!res.ok) return;
      const body = await res.json();
      setGrainCount(body.grainCount ?? 0);
      setPeopleInvited(body.peopleInvited ?? 0);
    } catch (e) {
      console.error("refreshGrainCount failed", e);
    }
  }, [profile?.id]);

  const getMyInviteLink = useCallback(async (): Promise<string> => {
    if (!profile?.id) return "";
    try {
      const res = await fetch(`${getApiUrl()}/profiles/invite/my-link?userId=${profile.id}`);
      if (!res.ok) return "";
      const body = await res.json();
      setInviteLink(body.inviteLink ?? null);
      setGrainCount(body.grainCount ?? 0);
      setPeopleInvited(body.peopleInvited ?? 0);
      return body.inviteLink ?? "";
    } catch (e) {
      console.error("getMyInviteLink failed", e);
      return "";
    }
  }, [profile?.id]);

  const getAllProfiles = useCallback(async (): Promise<TeamProfile[]> => {
    try {
      const [{ data: profilesData, error: profilesErr }, { data: rolesData, error: rolesErr }] = await Promise.all([
        supabase.from("p2p_profiles").select("id, full_name, email, role").order("full_name", { ascending: true }),
        supabase.from("p2p_admin_roles").select("user_id").eq("role", "crisis_responder"),
      ]);
      if (profilesErr) throw profilesErr;
      if (rolesErr) throw rolesErr;
      const crisisIds = new Set((rolesData || []).map((r: any) => r.user_id));
      return (profilesData || []).map((p: any) => ({
        id: p.id,
        fullName: p.full_name || "Unnamed",
        email: p.email,
        role: p.role,
        isCrisisResponder: crisisIds.has(p.id),
      }));
    } catch (e) {
      console.error("getAllProfiles failed", e);
      return [];
    }
  }, []);

  const getCrisisResponderIds = useCallback(async (): Promise<string[]> => {
    try {
      const { data, error } = await supabase.from("p2p_admin_roles").select("user_id").eq("role", "crisis_responder");
      if (error) throw error;
      return (data || []).map((r: any) => r.user_id);
    } catch (e) {
      console.error("getCrisisResponderIds failed", e);
      return [];
    }
  }, []);

  const setCrisisResponder = useCallback(async (userId: string, enabled: boolean): Promise<string | null> => {
    try {
      if (enabled) {
        const { error } = await supabase.from("p2p_admin_roles").insert({ user_id: userId, role: "crisis_responder" });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("p2p_admin_roles").delete().eq("user_id", userId).eq("role", "crisis_responder");
        if (error) throw error;
      }
      return null;
    } catch (e: any) {
      console.error("setCrisisResponder failed", e);
      return e?.message || "Could not update crisis responder status";
    }
  }, []);

  const getDiscoverablePeers = useCallback(async (search?: string, skillKeys?: string[]): Promise<DiscoverablePeer[]> => {
    if (!profile) return [];
    try {
      // Admin Identity Separation: admin/official accounts must not appear
      // in Discover. The real enforcement is RLS (profiles_select_scoped,
      // migration 101) — a direct query can't see them regardless of this
      // filter — this just keeps the query's own intent explicit.
      let query = supabase
        .from("p2p_profiles")
        .select("id, full_name, country, role, gifts, skills, photo_url")
        .neq("id", profile.id)
        .eq("is_official_account", false)
        .order("full_name", { ascending: true })
        .limit(50);
      if (search && search.trim()) query = query.ilike("full_name", `%${search.trim()}%`);
      if (skillKeys && skillKeys.length > 0) query = query.overlaps("skills", skillKeys);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((p: any) => ({
        id: p.id, fullName: p.full_name || "Unnamed",
        country: p.country, role: p.role, gifts: p.gifts || [],
        skills: p.skills || [],
        photoUrl: p.photo_url || null,
      }));
    } catch (e) {
      console.error("getDiscoverablePeers failed", e);
      return [];
    }
  }, [profile]);

  const getSmartMatch = useCallback(async (): Promise<DiscoverablePeer | null> => {
    if (!profile) return null;
    try {
      const myGifts: string[] = profile.gifts || [];
      const mySkills: string[] = profile.skills || [];
      const { data, error } = await supabase
        .from("p2p_profiles")
        .select("id, full_name, country, role, gifts, skills, photo_url")
        .neq("id", profile.id)
        .limit(200);
      if (error) throw error;
      const candidates = (data || []) as any[];
      if (candidates.length === 0) return null;
      let best = candidates[0];
      let bestScore = -1;
      for (const c of candidates) {
        const gifts: string[] = c.gifts || [];
        const skills: string[] = c.skills || [];
        let score = gifts.filter((g) => myGifts.includes(g)).length * 2;
        score += skills.filter((s) => mySkills.includes(s)).length * 2;
        if (c.country && c.country === profile.country) score += 1;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return {
        id: best.id, fullName: best.full_name || "Unnamed",
        country: best.country, role: best.role, gifts: best.gifts || [],
        skills: best.skills || [],
        photoUrl: best.photo_url || null,
      };
    } catch (e) {
      console.error("getSmartMatch failed", e);
      return null;
    }
  }, [profile]);

  const getGroups = useCallback(async (): Promise<PeerGroup[]> => {
    if (!profile) return [];
    try {
      const [{ data: groupsData, error: groupsErr }, { data: myMemberships, error: memErr }] = await Promise.all([
        supabase.from("p2p_groups").select("id, name, description, peer_guide_id"),
        supabase.from("p2p_group_members").select("group_id").eq("user_id", profile.id),
      ]);
      if (groupsErr) throw groupsErr;
      if (memErr) throw memErr;
      const myGroupIds = new Set((myMemberships || []).map((m: any) => m.group_id));
      const counts: Record<string, number> = {};
      const { data: allMembers } = await supabase.from("p2p_group_members").select("group_id");
      (allMembers || []).forEach((m: any) => { counts[m.group_id] = (counts[m.group_id] || 0) + 1; });
      return (groupsData || []).map((g: any) => ({
        id: g.id, name: g.name || "Unnamed Group", description: g.description,
        memberCount: counts[g.id] || 0, isMember: myGroupIds.has(g.id),
        peerGuideId: g.peer_guide_id ?? null, isCreator: g.peer_guide_id === profile.id,
      }));
    } catch (e) {
      console.error("getGroups failed", e);
      return [];
    }
  }, [profile]);

  const joinGroup = useCallback(async (groupId: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_group_members").insert({ group_id: groupId, user_id: profile.id });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("joinGroup failed", e);
      return e?.message || "Could not join group";
    }
  }, [profile]);

  const leaveGroup = useCallback(async (groupId: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_group_members").delete().eq("group_id", groupId).eq("user_id", profile.id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("leaveGroup failed", e);
      return e?.message || "Could not leave group";
    }
  }, [profile]);

  const createGroup = useCallback(async (name: string, description: string | null): Promise<string | null> => {
    if (!profile) return "Not signed in";
    if (!name.trim()) return "Please enter a group name";
    try {
      const { data, error } = await supabase
        .from("p2p_groups")
        .insert({ name: name.trim(), description: description?.trim() || null, peer_guide_id: profile.id, church_id: profile.churchId ?? null })
        .select("id")
        .single();
      if (error) throw error;
      const { error: memberErr } = await supabase
        .from("p2p_group_members")
        .insert({ group_id: data.id, user_id: profile.id });
      if (memberErr) throw memberErr;
      return null;
    } catch (e: any) {
      console.error("createGroup failed", e);
      return e?.message || "Could not create group";
    }
  }, [profile]);

  const getGroupMembers = useCallback(async (groupId: string): Promise<GroupMember[]> => {
    try {
      const { data: memberRows, error } = await supabase
        .from("p2p_group_members")
        .select("user_id")
        .eq("group_id", groupId);
      if (error) throw error;
      const userIds = (memberRows || []).map((m: any) => m.user_id);
      if (userIds.length === 0) return [];
      const { data: profileRows, error: profErr } = await supabase
        .from("p2p_profiles")
        .select("id, full_name, role, photo_url")
        .in("id", userIds);
      if (profErr) throw profErr;
      const profileMap = new Map((profileRows || []).map((p: any) => [p.id, p]));
      return userIds.map((uid: string) => ({
        userId: uid,
        fullName: profileMap.get(uid)?.full_name || "Unnamed",
        role: profileMap.get(uid)?.role || "student",
        photoUrl: profileMap.get(uid)?.photo_url || null,
      }));
    } catch (e) {
      console.error("getGroupMembers failed", e);
      return [];
    }
  }, []);

  const addGroupMember = useCallback(async (groupId: string, userId: string): Promise<string | null> => {
    try {
      const { error } = await supabase.from("p2p_group_members").insert({ group_id: groupId, user_id: userId });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addGroupMember failed", e);
      return e?.message || "Could not add peer to group";
    }
  }, []);

  const removeGroupMember = useCallback(async (groupId: string, userId: string): Promise<string | null> => {
    try {
      const { error } = await supabase.from("p2p_group_members").delete().eq("group_id", groupId).eq("user_id", userId);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("removeGroupMember failed", e);
      return e?.message || "Could not remove peer from group";
    }
  }, []);

  const getMyNotes = useCallback(async (): Promise<UserNote[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_user_notes")
        .select("id, title, body, created_at, updated_at, lesson_id, module_id, study_session_id, p2p_lessons(title)")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((n: any) => ({
        id: n.id, title: n.title, body: n.body, createdAt: n.created_at, updatedAt: n.updated_at ?? n.created_at,
        lessonId: n.lesson_id ?? null, lessonTitle: n.p2p_lessons?.title ?? null,
        moduleId: n.module_id ?? null, studySessionId: n.study_session_id ?? null,
      }));
    } catch (e) {
      console.error("getMyNotes failed", e);
      return [];
    }
  }, [profile]);

  // Study Together C6 — context is optional so every existing caller (the
  // general /notes screen) keeps working unchanged; only a note created
  // from inside an active Study Together session passes lesson/module/
  // studySessionId. Never shared: this always writes user_id = profile.id
  // (the note's own owner, via RLS's owner-only policy) regardless of how
  // many other people are in the same study session.
  const addNote = useCallback(async (
    title: string | null, body: string,
    context?: { lessonId?: string; moduleId?: string; studySessionId?: string },
  ): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_notes").insert({
        user_id: profile.id, title, body,
        lesson_id: context?.lessonId ?? null, module_id: context?.moduleId ?? null,
        study_session_id: context?.studySessionId ?? null,
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addNote failed", e);
      return e?.message || "Could not save note";
    }
  }, [profile]);

  const deleteNote = useCallback(async (id: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_notes").delete().eq("id", id).eq("user_id", profile.id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("deleteNote failed", e);
      return e?.message || "Could not delete note";
    }
  }, [profile]);

  // Study Together C4.3 — "My Note ... Edit". Scoped by both id AND
  // user_id (matching deleteNote's own pattern) so this can never touch
  // another user's row even if an id were guessed/manipulated; RLS's
  // owner-only policy is the actual backstop either way.
  const updateNote = useCallback(async (id: string, body: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_notes")
        .update({ body, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", profile.id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("updateNote failed", e);
      return e?.message || "Could not update note";
    }
  }, [profile]);

  const getMyHighlights = useCallback(async (): Promise<UserHighlight[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_user_highlights")
        .select("id, reference, quote, created_at, lesson_id, section_id, start_offset, end_offset, color")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []) as any[];
      const lessonIds = Array.from(new Set(rows.map((h) => h.lesson_id).filter(Boolean)));
      let titleMap = new Map<string, string>();
      if (lessonIds.length > 0) {
        const { data: lessonsData } = await supabase.from("p2p_lessons").select("id, title").in("id", lessonIds);
        titleMap = new Map((lessonsData || []).map((l: any) => [l.id, l.title]));
      }
      return rows.map((h) => ({
        id: h.id,
        reference: h.reference,
        quote: h.quote,
        createdAt: h.created_at,
        lessonId: h.lesson_id,
        lessonTitle: h.lesson_id ? titleMap.get(h.lesson_id) ?? null : null,
        sectionId: h.section_id,
        startOffset: h.start_offset,
        endOffset: h.end_offset,
        color: h.color ?? "yellow",
      }));
    } catch (e) {
      console.error("getMyHighlights failed", e);
      return [];
    }
  }, [profile]);

  const addHighlight = useCallback(async (reference: string, quote: string | null): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_highlights").insert({ user_id: profile.id, reference, quote });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addHighlight failed", e);
      return e?.message || "Could not save highlight";
    }
  }, [profile]);

  const deleteHighlight = useCallback(async (id: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_highlights").delete().eq("id", id).eq("user_id", profile.id);
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("deleteHighlight failed", e);
      return e?.message || "Could not delete highlight";
    }
  }, [profile]);

  const getHighlightsForLesson = useCallback(async (lessonId: string): Promise<UserHighlight[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_user_highlights")
        .select("id, reference, quote, created_at, lesson_id, section_id, start_offset, end_offset, color")
        .eq("user_id", profile.id)
        .eq("lesson_id", lessonId);
      if (error) throw error;
      return (data || []).map((h: any) => ({
        id: h.id, reference: h.reference, quote: h.quote, createdAt: h.created_at,
        lessonId: h.lesson_id, sectionId: h.section_id, startOffset: h.start_offset,
        endOffset: h.end_offset, color: h.color ?? "yellow",
      }));
    } catch (e) {
      console.error("getHighlightsForLesson failed", e);
      return [];
    }
  }, [profile]);

  const addSectionHighlight = useCallback(async (params: {
    lessonId: string; sectionId: string; reference: string; quote: string;
    startOffset: number; endOffset: number; color?: string;
  }): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_highlights").insert({
        user_id: profile.id,
        lesson_id: params.lessonId,
        section_id: params.sectionId,
        reference: params.reference,
        quote: params.quote,
        start_offset: params.startOffset,
        end_offset: params.endOffset,
        color: params.color ?? "yellow",
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addSectionHighlight failed", e);
      return e?.message || "Could not save highlight";
    }
  }, [profile]);

  // My Discipleship Journal — reflections are the one genuinely new
  // subsystem; personal notes/highlights/prayer above and getMyPrayerJournal
  // below already existed. root_id makes "the whole chain, oldest first" a
  // single indexed lookup instead of a recursive parent walk (see
  // migrations/082_journal_reflections.sql).
  const getMyReflections = useCallback(async (): Promise<JournalReflection[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_journal_reflections")
        .select("id, root_id, parent_id, prompt, content, linked_lesson_id, created_at")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data || []) as any[];
      const lessonIds = Array.from(new Set(rows.map((r) => r.linked_lesson_id).filter(Boolean)));
      let titleMap = new Map<string, string>();
      if (lessonIds.length > 0) {
        const { data: lessonsData } = await supabase.from("p2p_lessons").select("id, title").in("id", lessonIds);
        titleMap = new Map((lessonsData || []).map((l: any) => [l.id, l.title]));
      }
      return rows.map((r) => ({
        id: r.id, rootId: r.root_id, parentId: r.parent_id, prompt: r.prompt, content: r.content,
        linkedLessonId: r.linked_lesson_id,
        linkedLessonTitle: r.linked_lesson_id ? titleMap.get(r.linked_lesson_id) ?? null : null,
        createdAt: r.created_at,
      }));
    } catch (e) {
      console.error("getMyReflections failed", e);
      return [];
    }
  }, [profile]);

  const addReflection = useCallback(async (params: {
    prompt?: string | null; content: string; linkedLessonId?: string | null;
  }): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      // Two-step insert: root_id must equal the row's own id for an
      // original, which Postgres only assigns once the insert runs — no
      // client-side UUID generator needed.
      const { data, error } = await supabase.from("p2p_journal_reflections").insert({
        user_id: profile.id, root_id: "00000000-0000-0000-0000-000000000000",
        prompt: params.prompt ?? null, content: params.content, linked_lesson_id: params.linkedLessonId ?? null,
      }).select("id").single();
      if (error || !data) throw error ?? new Error("No row returned");
      const { error: fixupError } = await supabase.from("p2p_journal_reflections").update({ root_id: data.id }).eq("id", data.id);
      if (fixupError) throw fixupError;
      return null;
    } catch (e: any) {
      console.error("addReflection failed", e);
      return e?.message || "Could not save reflection";
    }
  }, [profile]);

  const addReflectionUpdate = useCallback(async (rootId: string, parentId: string, content: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_journal_reflections").insert({
        user_id: profile.id, root_id: rootId, parent_id: parentId, content,
      });
      if (error) throw error;
      return null;
    } catch (e: any) {
      console.error("addReflectionUpdate failed", e);
      return e?.message || "Could not save reflection update";
    }
  }, [profile]);

  const getJournalTimeline = useCallback(async (): Promise<JournalTimelineEntry[]> => {
    if (!profile) return [];
    const [notes, highlights, reflections, prayerRes] = await Promise.all([
      getMyNotes(), getMyHighlights(), getMyReflections(),
      supabase.from("p2p_prayer_journal").select("id, prayer_text, category, created_at").eq("user_id", profile.id),
    ]);

    const noteEntries: JournalTimelineEntry[] = notes.map((n) => ({
      // Study Together C6 — a lesson-linked note surfaces its lesson as the
      // timeline title ("Note from Lesson 5") so the Journal can point the
      // user back to that learning context; a general note (no lessonId)
      // keeps the exact original title fallback.
      type: "note", id: n.id, title: n.title ?? (n.lessonTitle ? `Note from ${n.lessonTitle}` : "Personal Note"), preview: n.body, at: n.createdAt,
    }));
    const highlightEntries: JournalTimelineEntry[] = highlights.map((h) => ({
      type: "highlight", id: h.id, title: h.lessonTitle ?? h.reference, preview: h.quote ?? h.reference, at: h.createdAt,
    }));
    const prayerRows = (prayerRes.data ?? []) as { id: string; prayer_text: string; category: string | null; created_at: string }[];
    const prayerEntries: JournalTimelineEntry[] = prayerRows.map((p) => ({
      type: "prayer", id: p.id, title: p.category ?? "Prayer Request", preview: p.prayer_text, at: p.created_at,
    }));

    // One timeline entry per reflection CHAIN (its latest update, or the
    // original if it has none yet) — the full history lives on the
    // reflection detail screen, not the top-level feed.
    const latestByRoot = new Map<string, JournalReflection>();
    for (const r of reflections) {
      const current = latestByRoot.get(r.rootId);
      if (!current || new Date(r.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        latestByRoot.set(r.rootId, r);
      }
    }
    const reflectionEntries: JournalTimelineEntry[] = Array.from(latestByRoot.values()).map((r) => ({
      type: "reflection", id: r.rootId, title: r.prompt ?? "Reflection", preview: r.content, at: r.createdAt,
    }));

    return [...noteEntries, ...highlightEntries, ...prayerEntries, ...reflectionEntries]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [profile, getMyNotes, getMyHighlights, getMyReflections]);

  const markLessonComplete = useCallback(async (lessonId: string) => {
    // Optimistic update first so the UI reacts immediately regardless of DB latency.
    setLessons((prev) => prev.map((l) => l.id === lessonId ? { ...l, isCompleted: true } : l));
    try { await AsyncStorage.setItem(`lesson_complete_${lessonId}`, "true"); } catch {}
    if (profile) {
      try {
        const { error } = await supabase.from("p2p_lesson_progress").upsert(
          { user_id: profile.id, lesson_id: lessonId, completed: true, progress_percent: 100, updated_at: new Date().toISOString() },
          { onConflict: "user_id,lesson_id" }
        );
        if (error) console.error("markLessonComplete upsert:", error.message);
      } catch (e) { console.error("markLessonComplete failed:", e); }
      await loadCurriculum(profile.id, profile.contentLanguage ?? "en");
      await checkGrowthEvents(profile.id);
      await checkCurriculumCompletion(profile.id);
      void loadTreeData(profile.id);
    }
  }, [profile, loadCurriculum, checkGrowthEvents, checkCurriculumCompletion, loadTreeData]);

  const refreshData = useCallback(() => loadData(), [loadData]);

  const refreshCurriculumData = useCallback(async () => {
    if (!profile?.id) return;
    await loadCurriculum(profile.id, profile.contentLanguage ?? "en");
  }, [profile?.id, profile?.contentLanguage, loadCurriculum]);

  const getAssignmentForLesson = useCallback(async (lessonId: string): Promise<Assignment | null> => {
    try {
      const { data, error } = await supabase
        .from("p2p_assignments")
        .select("id,lesson_id,title,instructions")
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id as string, lessonId: data.lesson_id as string, title: (data.title as string) ?? "Assignment", instructions: (data.instructions as string) ?? "" };
    } catch { return null; }
  }, []);

  const getMySubmission = useCallback(async (lessonId: string): Promise<{ id: string; content: string } | null> => {
    if (!profile) return null;
    try {
      const { data, error } = await supabase
        .from("p2p_submissions")
        .select("id,text_content")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .not("assignment_id", "is", null)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id as string, content: (data.text_content as string) ?? "" };
    } catch { return null; }
  }, [profile]);

  const getSubmissionStatus = useCallback(async (lessonId: string): Promise<SubmissionStatus | null> => {
    if (!profile) return null;
    try {
      const { data: sub, error: subError } = await supabase
        .from("p2p_submissions")
        .select("id,submission_type,text_content,media_url,duration_seconds")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .not("assignment_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (subError || !sub) return null;
      const { data: evaluation } = await supabase
        .from("p2p_lesson_evaluations")
        .select("status,feedback,self_approved")
        .eq("submission_id", sub.id)
        .maybeSingle();
      return {
        submissionId: sub.id as string,
        submissionType: (sub.submission_type as SubmissionType) ?? "text",
        content: (sub.text_content as string) ?? "",
        mediaUrl: (sub.media_url as string) ?? null,
        durationSeconds: (sub.duration_seconds as number) ?? null,
        evaluationStatus: (evaluation?.status as SubmissionStatus["evaluationStatus"]) ?? null,
        feedback: (evaluation?.feedback as string) ?? null,
        selfApproved: Boolean(evaluation?.self_approved),
      };
    } catch { return null; }
  }, [profile]);

  const getQuestionSubmissionsForLesson = useCallback(async (lessonId: string): Promise<QuestionSubmission[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_submissions")
        .select("id,reflection_question_id,submission_type,text_content,media_url,duration_seconds,created_at")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .not("reflection_question_id", "is", null)
        .order("created_at", { ascending: false });
      if (error || !data) return [];
      const seen = new Set<string>();
      return (data as Record<string, unknown>[])
        .filter((r) => {
          const qid = r.reflection_question_id as string;
          if (seen.has(qid)) return false;
          seen.add(qid);
          return true;
        })
        .map((r) => ({
          id: r.id as string,
          questionId: r.reflection_question_id as string,
          submissionType: (r.submission_type as SubmissionType) ?? "text",
          textContent: (r.text_content as string) ?? null,
          mediaUrl: (r.media_url as string) ?? null,
          durationSeconds: (r.duration_seconds as number) ?? null,
          createdAt: r.created_at as string,
        }));
    } catch { return []; }
  }, [profile]);

  const getAssignmentQuestionsForLesson = useCallback(async (lessonId: string): Promise<AssignmentQuestion[]> => {
    try {
      const { data: assignment } = await supabase
        .from("p2p_assignments")
        .select("id")
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (!assignment) return [];
      const { data, error } = await supabase
        .from("p2p_assignment_questions")
        .select("id,question,display_order")
        .eq("assignment_id", assignment.id)
        .order("display_order", { ascending: true });
      if (error || !data) return [];
      return (data as Record<string, unknown>[]).map((q) => ({ id: q.id as string, question: q.question as string }));
    } catch { return []; }
  }, []);

  const getAssignmentQuestionSubmissionsForLesson = useCallback(async (lessonId: string): Promise<QuestionSubmission[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_submissions")
        .select("id,assignment_question_id,submission_type,text_content,media_url,duration_seconds,created_at")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .not("assignment_question_id", "is", null)
        .order("created_at", { ascending: false });
      if (error || !data) return [];
      const seen = new Set<string>();
      const deduped = (data as Record<string, unknown>[]).filter((r) => {
        const qid = r.assignment_question_id as string;
        if (seen.has(qid)) return false;
        seen.add(qid);
        return true;
      });

      // Assignment submissions are peer-evaluated — pull each one's evaluation
      // status/feedback so the lesson screen can show a real state instead of
      // a flat "Responded" badge.
      const submissionIds = deduped.map((r) => r.id as string);
      const evalBySubmission = new Map<string, Record<string, unknown>>();
      if (submissionIds.length > 0) {
        const { data: evals } = await supabase
          .from("p2p_lesson_evaluations")
          .select("submission_id,status,feedback,self_approved")
          .in("submission_id", submissionIds);
        for (const e of (evals ?? []) as Record<string, unknown>[]) {
          evalBySubmission.set(e.submission_id as string, e);
        }
      }

      return deduped.map((r) => {
        const ev = evalBySubmission.get(r.id as string);
        return {
          id: r.id as string,
          questionId: r.assignment_question_id as string,
          submissionType: (r.submission_type as SubmissionType) ?? "text",
          textContent: (r.text_content as string) ?? null,
          mediaUrl: (r.media_url as string) ?? null,
          durationSeconds: (r.duration_seconds as number) ?? null,
          createdAt: r.created_at as string,
          evaluationStatus: (ev?.status as QuestionSubmission["evaluationStatus"]) ?? null,
          feedback: (ev?.feedback as string) ?? null,
          selfApproved: Boolean(ev?.self_approved),
        };
      });
    } catch { return []; }
  }, [profile]);

  // Plans are p2p_curriculums rows now (migration 041_unify_plans_system.sql)
  // — their assignment submissions use the SAME p2p_submissions/
  // p2p_lesson_evaluations tables as core curriculum, so there's no more
  // separate "plan" source to fetch or merge here.
  const getMySubmissions = useCallback(async (): Promise<MySubmission[]> => {
    if (!profile) return [];
    try {
      const { data: subs } = await supabase.from("p2p_submissions")
        .select("id,lesson_id,submission_type,text_content,media_url,duration_seconds,created_at")
        .eq("user_id", profile.id).not("assignment_id", "is", null).order("created_at", { ascending: false });

      const rows = (subs ?? []) as Record<string, unknown>[];
      if (rows.length === 0) return [];

      const submissionIds = rows.map((r) => r.id as string);
      const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string)));

      const [{ data: evals }, { data: lessonsData }] = await Promise.all([
        submissionIds.length
          ? supabase.from("p2p_lesson_evaluations").select("submission_id,status,feedback,self_approved").in("submission_id", submissionIds)
          : Promise.resolve({ data: [] }),
        lessonIds.length ? supabase.from("p2p_lessons").select("id,title").in("id", lessonIds) : Promise.resolve({ data: [] }),
      ]);
      const evalBySubmission = new Map((evals ?? []).map((e: Record<string, unknown>) => [e.submission_id as string, e]));
      const titleByLesson = new Map((lessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Lesson"]));

      const mapped: MySubmission[] = rows.map((r) => {
        const ev = evalBySubmission.get(r.id as string) as Record<string, unknown> | undefined;
        return {
          id: r.id as string,
          lessonId: r.lesson_id as string,
          lessonTitle: titleByLesson.get(r.lesson_id as string) ?? "Lesson",
          submissionType: (r.submission_type as SubmissionType) ?? "text",
          content: (r.text_content as string) ?? "",
          mediaUrl: (r.media_url as string) ?? null,
          durationSeconds: (r.duration_seconds as number) ?? null,
          createdAt: r.created_at as string,
          evaluationStatus: (ev?.status as MySubmission["evaluationStatus"]) ?? null,
          feedback: (ev?.feedback as string) ?? null,
          selfApproved: Boolean(ev?.self_approved),
          source: "core",
        };
      });

      return mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch { return []; }
  }, [profile]);

  const submitContent = useCallback(async (params: SubmitContentParams): Promise<string | null> => {
    if (!profile) return "You must be signed in to submit.";
    const { lessonId, assignmentId, questionId, assignmentQuestionId, type, text, mediaUri, durationSeconds } = params;
    try {
      const submissionId = generateUUID();
      let mediaPath: string | null = null;

      if ((type === "audio" || type === "video") && mediaUri) {
        const uploaded = await uploadSubmissionMedia(mediaUri, submissionId, profile.id);
        if (!uploaded) return "Failed to upload media. Please check your connection and try again.";
        mediaPath = uploaded.storagePath;
      }

      const { error } = await supabase.from("p2p_submissions").insert({
        id: submissionId,
        user_id: profile.id,
        lesson_id: lessonId,
        assignment_id: assignmentId ?? null,
        reflection_question_id: questionId ?? null,
        assignment_question_id: assignmentQuestionId ?? null,
        submission_type: type,
        text_content: text ?? null,
        media_url: mediaPath,
        duration_seconds: durationSeconds ?? null,
      });
      if (error) return error.message;
      // Pastoral care (Elijah Protocol / Dormant Seed) reads last_active_at
      // to detect inactivity — best-effort, never blocks the real submission.
      void supabase.from("p2p_profiles").update({ last_active_at: new Date().toISOString() }).eq("id", profile.id);
      // Covers the self-approval edge case (no evaluator available yet), where
      // the evaluation — and any resulting growth event — is created synchronously.
      await checkGrowthEvents(profile.id);
      // The submitted/unlock state shown on Learn, module and progress screens
      // is computed inside loadCurriculum from evaluation rows — without this
      // refetch, a submission shows 0 submitted and keeps the next lesson
      // locked until a manual refresh/app reload.
      await loadCurriculum(profile.id, profile.contentLanguage ?? "en");
      await checkCurriculumCompletion(profile.id);
      void loadTreeData(profile.id);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to submit.";
    }
  }, [profile, checkGrowthEvents, loadCurriculum, checkCurriculumCompletion, loadTreeData]);

  const submitAssignment = useCallback(async (assignmentId: string, lessonId: string, content: string): Promise<string | null> => {
    return submitContent({ lessonId, assignmentId, type: "text", text: content });
  }, [submitContent]);

  // Plans are p2p_curriculums rows now (migration 041_unify_plans_system.sql)
  // — their evaluations live in the SAME p2p_lesson_evaluations table core
  // curriculum uses, so there's no more separate "plan" source table to
  // route to. p2p_get_submitter_evaluation_context's p_source defaults to
  // 'core', which is now the only value this ever calls it with.
  const resolveEvaluation = useCallback(async (
    evaluationId: string,
    status: "approved" | "needs_revision",
    feedback: string
  ): Promise<string | null> => {
    if (!profile) return "You must be signed in.";
    try {
      const { error } = await supabase
        .from("p2p_lesson_evaluations")
        .update({ status, feedback, resolved_at: new Date().toISOString() })
        .eq("id", evaluationId)
        .eq("evaluator_id", profile.id)
        .eq("status", "pending");
      if (error) return error.message;
      setPendingEvaluations((prev) => prev.filter((e) => e.id !== evaluationId));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to resolve evaluation.";
    }
  }, [profile]);

  // Fetches a compact submitter profile for the "To Review" screen via the
  // p2p_get_submitter_evaluation_context RPC (migration 030). p2p_profiles
  // RLS ("profiles_select_scoped") only lets a user read another profile if
  // they share a group, are admin, or lead that person's church/region — an
  // assigned evaluator who happens not to share a group with the submitter
  // would otherwise get nothing back. The RPC is SECURITY DEFINER and opens
  // exactly one narrow path instead: it checks the caller is genuinely the
  // evaluator on that specific p2p_lesson_evaluations row, and if so returns
  // only name/avatar/growth-level/streak/context-label — never registration/
  // spiritual intake, other submissions, or help-request history.
  const getSubmitterEvaluationContext = useCallback(async (
    evaluationId: string
  ): Promise<SubmitterEvaluationContext | null> => {
    if (!profile) return null;
    try {
      const { data, error } = await supabase.rpc("p2p_get_submitter_evaluation_context", {
        p_evaluation_id: evaluationId,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
      if (!row) return null;

      const stage = STAGES[getStageFromPoints((row.growth_level as number) ?? 0)];
      return {
        submitterId: row.submitter_id as string,
        fullName: (row.full_name as string) ?? "Unnamed",
        photoUrl: (row.photo_url as string) ?? null,
        growthStageName: stage.name,
        growthStageEmoji: stage.emoji,
        streakDays: (row.streak_days as number) ?? 0,
        contextLabel: (row.context_label as string) ?? "",
      };
    } catch (e) {
      console.error("getSubmitterEvaluationContext failed", e);
      return null;
    }
  }, [profile]);

  // ── Messaging overhaul ──────────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!profile) { setConversations([]); return; }
    setConversationsLoading(true);
    try {
      const { data: memberships } = await supabase
        .from("p2p_conversation_members")
        .select("conversation_id, last_read_at")
        .eq("user_id", profile.id);
      const convIds = (memberships ?? []).map((m: any) => m.conversation_id as string);
      const lastReadById = new Map((memberships ?? []).map((m: any) => [m.conversation_id, m.last_read_at as string]));
      if (convIds.length === 0) { setConversations([]); setConversationsLoading(false); return; }

      const [convs, allMembers, recentMessages, settingsRows] = await Promise.all([
        selectInChunks<any>(
          "p2p_conversations", "id, type, conversation_type, name, group_id, circle_id, is_pinned_by_system", "id", convIds
        ),
        selectInChunks<any>(
          "p2p_conversation_members",
          "conversation_id, user_id, p2p_profiles(full_name, is_verified, is_official_account, official_account_type)",
          "conversation_id", convIds,
          (q) => q.neq("user_id", profile.id)
        ),
        selectInChunks<any>(
          "p2p_messages", "conversation_id, body, sender_id, created_at, message_type", "conversation_id", convIds,
          (q) => q.order("created_at", { ascending: false }).limit(500)
        ),
        selectInChunks<any>(
          "p2p_conversation_settings", "conversation_id, is_pinned, is_favourite, is_muted", "conversation_id", convIds,
          (q) => q.eq("user_id", profile.id)
        ),
      ]);

      const otherMemberByConv = new Map<string, any>();
      const memberCountByConv = new Map<string, number>();
      for (const m of allMembers as any[]) {
        memberCountByConv.set(m.conversation_id, (memberCountByConv.get(m.conversation_id) ?? 0) + 1);
        if (!otherMemberByConv.has(m.conversation_id)) otherMemberByConv.set(m.conversation_id, m);
      }

      const lastMsgByConv = new Map<string, any>();
      const unreadCountByConv = new Map<string, number>();
      for (const m of (recentMessages ?? []) as any[]) {
        if (!lastMsgByConv.has(m.conversation_id)) lastMsgByConv.set(m.conversation_id, m);
        const lastRead = lastReadById.get(m.conversation_id);
        if (m.sender_id !== profile.id && (!lastRead || m.created_at > lastRead)) {
          unreadCountByConv.set(m.conversation_id, (unreadCountByConv.get(m.conversation_id) ?? 0) + 1);
        }
      }
      const settingsByConv = new Map((settingsRows ?? []).map((s: any) => [s.conversation_id, s]));

      const results: ConversationSummary[] = ((convs ?? []) as any[]).map((c) => {
        const other = otherMemberByConv.get(c.id);
        const otherProfile = other?.p2p_profiles;
        const lastMsg = lastMsgByConv.get(c.id);
        const settings = settingsByConv.get(c.id);
        let name = c.name as string | null;
        if (c.type === "direct" && otherProfile) name = otherProfile.full_name ?? "Direct message";
        return {
          id: c.id,
          type: c.type,
          conversationType: (c.conversation_type ?? "direct") as ConversationType,
          name,
          otherUserId: other?.user_id ?? null,
          otherUserVerified: otherProfile?.is_verified ?? false,
          otherUserIsOfficial: otherProfile?.is_official_account ?? false,
          otherUserOfficialType: otherProfile?.official_account_type ?? null,
          memberCount: memberCountByConv.get(c.id) ?? 0,
          lastMessage: lastMsg?.message_type === "voice" ? "🎤 Voice message" : lastMsg?.body ?? null,
          lastMessageAt: lastMsg?.created_at ?? null,
          unreadCount: unreadCountByConv.get(c.id) ?? 0,
          isPinnedBySystem: c.is_pinned_by_system ?? false,
          // P2P Official conversations default to pinned until the user
          // explicitly acts on it: no settings row yet -> pinned iff
          // official, matching "auto-pinned initially, but respect an
          // explicit unpin forever after." Once a settings row exists
          // (created by the very first pin/unpin tap), its stored value is
          // used as-is regardless of official status, so an explicit unpin
          // is never silently overridden by this default again.
          isPinnedByUser: settings ? !!settings.is_pinned : !!otherProfile?.is_official_account,
          isFavourite: settings?.is_favourite ?? false,
          isMuted: settings?.is_muted ?? false,
        };
      });
      results.sort((a, b) => {
        if (a.isPinnedBySystem !== b.isPinnedBySystem) return a.isPinnedBySystem ? -1 : 1;
        if (a.isPinnedByUser !== b.isPinnedByUser) return a.isPinnedByUser ? -1 : 1;
        return (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "");
      });
      setConversations(results);
    } catch (e) {
      console.error("loadConversations failed", e);
    } finally {
      setConversationsLoading(false);
    }
  }, [profile]);

  // In-app banner for a new message on a conversation the user isn't
  // currently viewing (activeConversationIdRef, set by messages/[id].tsx on
  // mount/unmount) and didn't send themselves. Auto-clears after 4s.
  const handleIncomingMessageForBanner = useCallback(async (row: Record<string, unknown>) => {
    if (!profile) return;
    const conversationId = row.conversation_id as string;
    const senderId = row.sender_id as string | null;
    if (!senderId || senderId === profile.id) return;
    if (conversationId === activeConversationIdRef.current) return;
    if (row.message_type && row.message_type !== "text") return;

    const { data: sender } = await supabase
      .from("p2p_profiles")
      .select("full_name, photo_url, is_official_account, official_account_type")
      .eq("id", senderId)
      .maybeSingle();
    if (!sender) return;

    setIncomingMessageBanner({
      conversationId,
      messageBody: (row.body as string) ?? "",
      senderName: (sender.full_name as string) ?? "Someone",
      senderPhotoUrl: (sender.photo_url as string | null) ?? null,
      senderIsOfficial: (sender.is_official_account as boolean) ?? false,
      senderOfficialType: (sender.official_account_type as OfficialAccountType | null) ?? null,
    });
    setTimeout(() => {
      setIncomingMessageBanner((prev) => (prev?.conversationId === conversationId ? null : prev));
    }, 4000);
  }, [profile]);

  useEffect(() => {
    if (!profile?.id) return;
    loadConversations();
    const channel = supabase
      .channel(`p2p_inbox_${profile.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "p2p_messages" }, (payload) => {
        loadConversations();
        handleIncomingMessageForBanner(payload.new as Record<string, unknown>);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) { setPendingConnectionRequestCount(0); return; }
    (async () => {
      try {
        const res = await fetch(`${getApiUrl()}/connections/pending/${profile.id}`);
        const body = await res.json();
        setPendingConnectionRequestCount(Array.isArray(body) ? body.length : 0);
      } catch {
        setPendingConnectionRequestCount(0);
      }
    })();
  }, [profile?.id]);

  const mostRecentUnread = conversations.filter((c) => c.unreadCount > 0)
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""))[0] ?? null;
  const totalUnreadCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const pinMessage = useCallback(async (messageId: string, label?: string): Promise<string | null> => {
    if (!profile) return "Not authenticated";
    const { error } = await supabase.from("p2p_messages").update({
      is_pinned: true, pinned_by: profile.id, pinned_at: new Date().toISOString(), pinned_label: label ?? null,
    }).eq("id", messageId);
    return error ? error.message : null;
  }, [profile]);

  const unpinMessage = useCallback(async (messageId: string): Promise<string | null> => {
    const { error } = await supabase.from("p2p_messages").update({
      is_pinned: false, pinned_by: null, pinned_at: null, pinned_label: null,
    }).eq("id", messageId);
    return error ? error.message : null;
  }, []);

  const upsertConversationSetting = useCallback(async (conversationId: string, updates: Record<string, unknown>): Promise<string | null> => {
    if (!profile) return "Not authenticated";
    const { error } = await supabase.from("p2p_conversation_settings").upsert(
      { user_id: profile.id, conversation_id: conversationId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: "user_id,conversation_id" }
    );
    if (!error) setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, ...mapSettingUpdatesToSummary(updates) } : c)));
    return error ? error.message : null;
  }, [profile]);

  const pinConversation = useCallback((id: string) => upsertConversationSetting(id, { is_pinned: true, pinned_at: new Date().toISOString() }), [upsertConversationSetting]);
  const unpinConversation = useCallback((id: string) => upsertConversationSetting(id, { is_pinned: false }), [upsertConversationSetting]);
  const addToFavourites = useCallback((id: string) => upsertConversationSetting(id, { is_favourite: true, favourited_at: new Date().toISOString() }), [upsertConversationSetting]);
  const removeFromFavourites = useCallback((id: string) => upsertConversationSetting(id, { is_favourite: false }), [upsertConversationSetting]);

  const submitAdminFeedback = useCallback(async (data: AdminFeedbackInput): Promise<string | null> => {
    if (!profile) return "Not authenticated";
    try {
      const res = await fetch(`${getApiUrl()}/feedback/admin-interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, peerUserId: profile.id }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't submit feedback";
      return null;
    } catch {
      return "Couldn't submit feedback. Please check your connection.";
    }
  }, [profile]);

  // ── Admin hierarchy ──────────────────────────────────────────────────────────
  const adminRole = (profile?.role && profile.role !== "student" ? profile.role : null) as DiscipleRole | null;

  const loadAdminStats = useCallback(async () => {
    if (!adminRole) { setAdminStats(null); return; }
    try {
      const res = await authedFetch("/admin/activity/my-stats");
      if (!res.ok) { setAdminStats(null); return; }
      const body = await res.json();
      setAdminStats(body as AdminStats);
    } catch (e) {
      console.error("loadAdminStats failed", e);
      setAdminStats(null);
    }
  }, [adminRole]);

  const submitAdminReport = useCallback(async (report: { reportPeriod: "weekly" | "monthly" | "annual"; periodStart: string; periodEnd: string; adminNotes: string }): Promise<string | null> => {
    try {
      const res = await authedFetch("/admin/reports/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(report),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't submit report";
      return null;
    } catch {
      return "Couldn't submit report. Please check your connection.";
    }
  }, []);

  const appointAdmin = useCallback(async (username: string, role: string, options: { adminZone?: string; adminCountry?: string; reason: string }): Promise<string | null> => {
    try {
      const res = await authedFetch("/admin/appointments/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, role, admin_zone: options.adminZone, admin_country: options.adminCountry, reason: options.reason }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't appoint admin";
      return null;
    } catch {
      return "Couldn't appoint admin. Please check your connection.";
    }
  }, []);

  const removeAdmin = useCallback(async (userId: string, reason: string): Promise<string | null> => {
    try {
      const res = await authedFetch(`/admin/appointments/${userId}/remove`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't remove admin";
      return null;
    } catch {
      return "Couldn't remove admin. Please check your connection.";
    }
  }, []);

  const suspendAdmin = useCallback(async (userId: string, reason: string): Promise<string | null> => {
    try {
      const res = await authedFetch(`/admin/appointments/${userId}/suspend`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't suspend admin";
      return null;
    } catch {
      return "Couldn't suspend admin. Please check your connection.";
    }
  }, []);

  const getAdminList = useCallback(async (): Promise<AdminAccountEntry[]> => {
    try {
      const res = await authedFetch("/admin/appointments/list");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getAdminList failed", e);
      return [];
    }
  }, []);

  const getAdminActivityFeed = useCallback(async (cursor?: string): Promise<AdminActivityEntry[]> => {
    try {
      const res = await authedFetch(`/admin/activity/live${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getAdminActivityFeed failed", e);
      return [];
    }
  }, []);

  // ── Church Discipleship Portal — completely free, no tiers ─────────────────
  const isChurchLeader = userChurchRole === "senior_pastor" || userChurchRole === "discipleship_pastor" || userChurchRole === "small_group_leader";
  // Ownership is a separate axis from role — the church's actual creator,
  // independent of whether they still hold (or ever held) senior_pastor.
  const isChurchCreator = !!profile?.id && !!userChurch && profile.id === userChurch.createdBy;

  const loadUserChurch = useCallback(async () => {
    if (!profile?.id) { setUserChurch(null); setUserChurchRole(null); setChurchMemberCount(0); setChurchCohortCount(0); return; }
    try {
      const res = await authedFetch("/churches/my-church");
      const body = await res.json();
      setUserChurch(body?.church ?? null);
      setUserChurchRole(body?.userRole ?? null);
      setChurchMemberCount(body?.memberCount ?? 0);
      setChurchCohortCount(body?.cohortCount ?? 0);
    } catch (e) {
      console.error("loadUserChurch failed", e);
    }
  }, [profile?.id]);

  useEffect(() => { loadUserChurch(); }, [loadUserChurch]);

  const registerChurch = useCallback(async (data: ChurchRegistrationData): Promise<{ church: Church | null; error: string | null }> => {
    if (!profile?.id) return { church: null, error: "Not authenticated" };
    try {
      const res = await authedFetch("/churches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name, description: data.description, city: data.city,
          country: data.country, country_code: data.countryCode, timezone: data.timezone,
          denomination: data.denomination, language_code: data.languageCode,
          contact_email: data.contactEmail, contact_name: data.contactName, website: data.website,
          church_type: data.churchType, church_type_other: data.churchTypeOther,
          location_hidden: data.locationHidden, logo_url: data.logoUrl, social_accounts: data.socialAccounts,
        }),
      });
      const body = await res.json();
      if (!res.ok) return { church: null, error: body?.error ?? "Couldn't register church" };
      await loadUserChurch();
      return { church: body as Church, error: null };
    } catch {
      return { church: null, error: "Couldn't register church. Please check your connection." };
    }
  }, [profile?.id, loadUserChurch]);

  const updateChurch = useCallback(async (churchId: string, data: ChurchUpdateData): Promise<{ church: Church | null; error: string | null }> => {
    if (!profile?.id) return { church: null, error: "Not authenticated" };
    try {
      const res = await authedFetch(`/churches/${churchId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) return { church: null, error: body?.error ?? "Couldn't update church" };
      await loadUserChurch();
      return { church: body as Church, error: null };
    } catch {
      return { church: null, error: "Couldn't update church. Please check your connection." };
    }
  }, [profile?.id, loadUserChurch]);

  const checkDuplicateChurch = useCallback(async (name: string, country?: string, website?: string) => {
    if (!profile?.id) return [];
    try {
      const params = new URLSearchParams({ name });
      if (country) params.set("country", country);
      if (website) params.set("website", website);
      const res = await authedFetch(`/churches/check-duplicate?${params.toString()}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body?.matches ?? []) as { id: string; name: string; city: string | null; country: string; website: string | null }[];
    } catch {
      return [];
    }
  }, [profile?.id]);

  const getSocialAccounts = useCallback(async (churchId: string): Promise<ChurchSocialAccount[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch(`/churches/${churchId}/social-accounts`);
      if (!res.ok) return [];
      return (await res.json()) as ChurchSocialAccount[];
    } catch {
      return [];
    }
  }, [profile?.id]);

  const updateSocialAccounts = useCallback(async (churchId: string, accounts: ChurchSocialAccountData[]): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/social-accounts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      if (!res.ok) { const body = await res.json(); return body?.error ?? "Couldn't update social media accounts"; }
      return null;
    } catch {
      return "Couldn't update social media accounts. Please check your connection.";
    }
  }, [profile?.id]);

  const joinChurch = useCallback(async (inviteCode: string): Promise<{ church: Church | null; error: string | null }> => {
    if (!profile?.id) return { church: null, error: "Not authenticated" };
    try {
      const res = await authedFetch("/churches/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      });
      const body = await res.json();
      if (!res.ok) return { church: null, error: body?.error ?? "Couldn't join church" };
      await loadUserChurch();
      return { church: body as Church, error: null };
    } catch {
      return { church: null, error: "Couldn't join church. Please check your connection." };
    }
  }, [profile?.id, loadUserChurch]);

  const leaveChurch = useCallback(async (): Promise<string | null> => {
    if (!profile?.id || !userChurch) return "Not in a church";
    try {
      const res = await authedFetch(`/churches/${userChurch.id}/members/${profile.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) return body?.error ?? "Couldn't leave church";
      await loadUserChurch();
      return null;
    } catch {
      return "Couldn't leave church. Please check your connection.";
    }
  }, [profile?.id, userChurch, loadUserChurch]);

  const getGroveData = useCallback(async (churchId: string): Promise<GroveData | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch(`/churches/${churchId}/grove`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getGroveData failed", e);
      return null;
    }
  }, [profile?.id]);

  const getChurchMembers = useCallback(async (churchId: string, search?: string): Promise<ChurchMember[]> => {
    if (!profile?.id) return [];
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      const qs = params.toString();
      const res = await authedFetch(`/churches/${churchId}/members${qs ? `?${qs}` : ""}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getChurchMembers failed", e);
      return [];
    }
  }, [profile?.id]);

  const getChurchMemberProfile = useCallback(async (churchId: string, userId: string): Promise<ChurchMemberProfile | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch(`/churches/${churchId}/members/${userId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getChurchMemberProfile failed", e);
      return null;
    }
  }, [profile?.id]);

  const updateChurchMemberNotes = useCallback(async (churchId: string, userId: string, notes: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/members/${userId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't save note");
    } catch {
      return "Couldn't save note. Please check your connection.";
    }
  }, [profile?.id]);

  const updateMemberRole = useCallback(async (churchId: string, userId: string, role: ChurchRole): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/members/${userId}/role`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't update role");
    } catch {
      return "Couldn't update role. Please check your connection.";
    }
  }, [profile?.id]);

  const removeChurchMember = useCallback(async (churchId: string, userId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/members/${userId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't remove member");
    } catch {
      return "Couldn't remove member. Please check your connection.";
    }
  }, [profile?.id]);

  const createCohort = useCallback(async (churchId: string, data: ChurchCohortData): Promise<{ cohort: ChurchCohort | null; error: string | null }> => {
    if (!profile?.id) return { cohort: null, error: "Not authenticated" };
    try {
      const res = await authedFetch(`/churches/${churchId}/cohorts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) return { cohort: null, error: body?.error ?? "Couldn't create cohort" };
      return { cohort: body as ChurchCohort, error: null };
    } catch {
      return { cohort: null, error: "Couldn't create cohort. Please check your connection." };
    }
  }, [profile?.id]);

  const getChurchCohorts = useCallback(async (churchId: string): Promise<ChurchCohort[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch(`/churches/${churchId}/cohorts`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getChurchCohorts failed", e);
      return [];
    }
  }, [profile?.id]);

  const updateCohort = useCallback(async (churchId: string, cohortId: string, data: Partial<ChurchCohortData> & { status?: string }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/cohorts/${cohortId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't update cohort");
    } catch {
      return "Couldn't update cohort. Please check your connection.";
    }
  }, [profile?.id]);

  const addMemberToCohort = useCallback(async (churchId: string, cohortId: string, target: { userId?: string; username?: string }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/cohorts/${cohortId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't add member to cohort");
    } catch {
      return "Couldn't add member to cohort. Please check your connection.";
    }
  }, [profile?.id]);

  const removeMemberFromCohort = useCallback(async (churchId: string, cohortId: string, userId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/cohorts/${cohortId}/members/${userId}`, {
        method: "DELETE",
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't remove member from cohort");
    } catch {
      return "Couldn't remove member from cohort. Please check your connection.";
    }
  }, [profile?.id]);

  const createAnnouncement = useCallback(async (churchId: string, data: ChurchAnnouncementCreateData): Promise<{ announcement: ChurchAnnouncement | null; error: string | null }> => {
    if (!profile?.id) return { announcement: null, error: "Not authenticated" };
    try {
      const res = await authedFetch(`/churches/${churchId}/announcements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const responseBody = await res.json();
      if (!res.ok) return { announcement: null, error: responseBody?.error ?? "Couldn't post announcement" };
      return { announcement: responseBody as ChurchAnnouncement, error: null };
    } catch {
      return { announcement: null, error: "Couldn't post announcement. Please check your connection." };
    }
  }, [profile?.id]);

  const updateAnnouncement = useCallback(async (churchId: string, id: string, data: Partial<ChurchAnnouncementCreateData> & { status?: ChurchAnnouncementStatus }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/announcements/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't update announcement");
    } catch {
      return "Couldn't update announcement. Please check your connection.";
    }
  }, [profile?.id]);

  const getAnnouncements = useCallback(async (churchId: string, includeAll?: boolean): Promise<ChurchAnnouncement[]> => {
    if (!profile?.id) return [];
    try {
      const params = new URLSearchParams();
      if (includeAll) params.set("includeAll", "true");
      const qs = params.toString();
      const res = await authedFetch(`/churches/${churchId}/announcements${qs ? `?${qs}` : ""}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getAnnouncements failed", e);
      return [];
    }
  }, [profile?.id]);

  const pinAnnouncement = useCallback(async (churchId: string, id: string, pinned: boolean): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/announcements/${id}/pin`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't update announcement");
    } catch {
      return "Couldn't update announcement. Please check your connection.";
    }
  }, [profile?.id]);

  const createLearningGoal = useCallback(async (churchId: string, data: LearningGoalCreateData): Promise<{ goal: LearningGoal | null; error: string | null }> => {
    if (!profile?.id) return { goal: null, error: "Not authenticated" };
    try {
      const res = await authedFetch(`/churches/${churchId}/learning-goals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) return { goal: null, error: body?.error ?? "Couldn't create learning goal" };
      return { goal: body as LearningGoal, error: null };
    } catch {
      return { goal: null, error: "Couldn't create learning goal. Please check your connection." };
    }
  }, [profile?.id]);

  const getLearningGoals = useCallback(async (churchId: string, status?: string): Promise<LearningGoal[]> => {
    if (!profile?.id) return [];
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const qs = params.toString();
      const res = await authedFetch(`/churches/${churchId}/learning-goals${qs ? `?${qs}` : ""}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getLearningGoals failed", e);
      return [];
    }
  }, [profile?.id]);

  const updateLearningGoal = useCallback(async (churchId: string, goalId: string, data: { title?: string; targetType?: LearningGoalTargetType; targetValue?: number; status?: string }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/churches/${churchId}/learning-goals/${goalId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      return res.ok ? null : (body?.error ?? "Couldn't update learning goal");
    } catch {
      return "Couldn't update learning goal. Please check your connection.";
    }
  }, [profile?.id]);

  const getLearningGoalsDashboard = useCallback(async (churchId: string): Promise<LearningGoal[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch(`/churches/${churchId}/learning-goals/dashboard`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body?.goals ?? []) as LearningGoal[];
    } catch (e) {
      console.error("getLearningGoalsDashboard failed", e);
      return [];
    }
  }, [profile?.id]);

  // ── Contact P2P Global ────────────────────────────────────────────────────
  const sendContactMessage = useCallback(async (data: ContactMessageSendData): Promise<ContactMessageSendResult> => {
    if (!profile?.id) return { success: false, error: "Not authenticated" };
    try {
      const res = await authedFetch("/contact/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_department: data.toDepartment, subject: data.subject, body: data.body,
          attachment_url: data.attachmentUrl, attachment_type: data.attachmentType,
        }),
      });
      const body = await res.json();
      if (!res.ok) return { success: false, error: body?.error ?? "Failed to send message" };
      return body as ContactMessageSendResult;
    } catch (e) {
      console.error("sendContactMessage failed", e);
      return { success: false, error: "Failed to send message" };
    }
  }, [profile?.id]);

  const getMyContactMessages = useCallback(async (): Promise<ContactMessageListItem[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch("/contact/my-messages");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getMyContactMessages failed", e);
      return [];
    }
  }, [profile?.id]);

  const getContactThread = useCallback(async (messageId: string): Promise<ContactThread | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch(`/contact/my-messages/${messageId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getContactThread failed", e);
      return null;
    }
  }, [profile?.id]);

  const getAdminContactInbox = useCallback(async (filters?: { status?: string; priority?: string; search?: string; archived?: boolean }): Promise<ContactAdminInboxItem[]> => {
    if (!profile?.id) return [];
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.priority) params.set("priority", filters.priority);
      if (filters?.search) params.set("search", filters.search);
      if (filters?.archived) params.set("archived", "true");
      const qs = params.toString();
      const res = await authedFetch(`/contact/admin/inbox${qs ? `?${qs}` : ""}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getAdminContactInbox failed", e);
      return [];
    }
  }, [profile?.id]);

  const getAdminContactMessage = useCallback(async (messageId: string): Promise<ContactAdminMessageDetail | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch(`/contact/admin/inbox/${messageId}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getAdminContactMessage failed", e);
      return null;
    }
  }, [profile?.id]);

  const replyToContactMessage = useCallback(async (messageId: string, body: string, isInternalNote: boolean): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/reply/${messageId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, is_internal_note: isInternalNote }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to send";
    } catch (e) {
      console.error("replyToContactMessage failed", e);
      return "Failed to send";
    }
  }, [profile?.id]);

  const forwardContactMessage = useCallback(async (messageId: string, data: { toDepartment?: ContactDepartment; toAdminId?: string; toUsername?: string; note?: string }): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/forward/${messageId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to_department: data.toDepartment, to_admin_id: data.toAdminId,
          to_username: data.toUsername, note: data.note,
        }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to forward";
    } catch (e) {
      console.error("forwardContactMessage failed", e);
      return "Failed to forward";
    }
  }, [profile?.id]);

  const closeContactMessage = useCallback(async (messageId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/close/${messageId}`, {
        method: "PUT",
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to close";
    } catch (e) {
      console.error("closeContactMessage failed", e);
      return "Failed to close";
    }
  }, [profile?.id]);

  const setContactMessagePriority = useCallback(async (messageId: string, priority: ContactPriority): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/priority/${messageId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to update priority";
    } catch (e) {
      console.error("setContactMessagePriority failed", e);
      return "Failed to update priority";
    }
  }, [profile?.id]);

  const getContactAdminStats = useCallback(async (): Promise<ContactDeptStats | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch("/contact/admin/stats");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getContactAdminStats failed", e);
      return null;
    }
  }, [profile?.id]);

  const getContactAllDepartmentStats = useCallback(async (): Promise<Record<ContactDepartment, ContactDeptStats> | null> => {
    if (!profile?.id) return null;
    try {
      const res = await authedFetch("/contact/admin/all-departments");
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error("getContactAllDepartmentStats failed", e);
      return null;
    }
  }, [profile?.id]);

  const setContactMessageStatus = useCallback(async (messageId: string, status: ContactMessageStatus): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/status/${messageId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to update status";
    } catch (e) {
      console.error("setContactMessageStatus failed", e);
      return "Failed to update status";
    }
  }, [profile?.id]);

  const archiveContactMessage = useCallback(async (messageId: string, archived: boolean): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/archive/${messageId}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to update";
    } catch (e) {
      console.error("archiveContactMessage failed", e);
      return "Failed to update";
    }
  }, [profile?.id]);

  const starContactMessage = useCallback(async (messageId: string, starred: boolean): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/contact/admin/star/${messageId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred }),
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to update";
    } catch (e) {
      console.error("starContactMessage failed", e);
      return "Failed to update";
    }
  }, [profile?.id]);

  const getOfficialMessageAllowedTypes = useCallback(async (): Promise<OfficialAccountType[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch("/official-messages/allowed-types");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getOfficialMessageAllowedTypes failed", e);
      return [];
    }
  }, [profile?.id]);

  const sendOfficialMessage = useCallback(async (data: OfficialMessageSendData): Promise<OfficialMessageSendResult> => {
    if (!profile?.id) return { success: false, error: "Not authenticated" };
    try {
      const res = await authedFetch("/official-messages/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId: data.targetUserId,
          department: data.department, subject: data.subject, body: data.body, draftId: data.draftId,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { success: false, error: json?.error ?? "Message could not be sent. Please try again." };
      return { success: true, conversationId: json.conversationId };
    } catch (e) {
      console.error("sendOfficialMessage failed", e);
      return { success: false, error: "Message could not be sent. Please try again." };
    }
  }, [profile?.id]);

  const getSentOfficialMessages = useCallback(async (): Promise<SentOfficialMessage[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch("/official-messages/sent");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getSentOfficialMessages failed", e);
      return [];
    }
  }, [profile?.id]);

  const searchUsersForCompose = useCallback(async (query: string): Promise<ComposeUserSearchResult[]> => {
    if (!profile?.id || query.trim().length < 2) return [];
    try {
      const params = new URLSearchParams({ q: query.trim() });
      const res = await authedFetch(`/official-messages/search-users?${params.toString()}`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("searchUsersForCompose failed", e);
      return [];
    }
  }, [profile?.id]);

  const getOfficialMailDrafts = useCallback(async (): Promise<OfficialMailDraft[]> => {
    if (!profile?.id) return [];
    try {
      const res = await authedFetch("/official-messages/drafts");
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      console.error("getOfficialMailDrafts failed", e);
      return [];
    }
  }, [profile?.id]);

  const saveOfficialMailDraft = useCallback(async (data: OfficialMailDraftSaveData): Promise<OfficialMailDraftSaveResult> => {
    if (!profile?.id) return { draftId: null, error: "Not authenticated" };
    try {
      const res = await authedFetch("/official-messages/drafts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: data.draftId, targetUserId: data.targetUserId,
          targetUsername: data.targetUsername, department: data.department, subject: data.subject, body: data.body,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { draftId: null, error: json?.error ?? "Failed to save draft" };
      return { draftId: json.id, error: null };
    } catch (e) {
      console.error("saveOfficialMailDraft failed", e);
      return { draftId: null, error: "Failed to save draft" };
    }
  }, [profile?.id]);

  const deleteOfficialMailDraft = useCallback(async (draftId: string): Promise<string | null> => {
    if (!profile?.id) return "Not authenticated";
    try {
      const res = await authedFetch(`/official-messages/drafts/${draftId}`, {
        method: "DELETE",
      });
      if (res.ok) return null;
      const err = await res.json().catch(() => ({}));
      return err?.error ?? "Failed to delete draft";
    } catch (e) {
      console.error("deleteOfficialMailDraft failed", e);
      return "Failed to delete draft";
    }
  }, [profile?.id]);

  const getOfficialMailThreadWithUser = useCallback(async (targetUserId: string, officialType: OfficialAccountType): Promise<OfficialMailThread> => {
    const empty: OfficialMailThread = { conversationId: null, subject: null, department: null, messages: [] };
    if (!profile?.id) return empty;
    try {
      const params = new URLSearchParams({ targetUserId, officialType });
      const res = await authedFetch(`/official-messages/thread-with-user?${params.toString()}`);
      if (!res.ok) return empty;
      return await res.json();
    } catch (e) {
      console.error("getOfficialMailThreadWithUser failed", e);
      return empty;
    }
  }, [profile?.id]);

  const featuredPlans = plans.filter((p) => p.isFeatured);

  const refreshTreeData = useCallback(async () => {
    if (profile?.id) await loadTreeData(profile.id);
  }, [profile, loadTreeData]);

  const dismissPendingCompletionMoment = useCallback(() => setPendingCompletionMoment(false), []);

  return (
    <DataContext.Provider value={{
      modules, lessons, getCurriculumCatalog, loadModuleWithLessons, loadCurriculumDetail, plans, featuredPlans, plansLoading, loadPlans, getPlanById, getPlanProgress,
      planCategories, loadPlanCategories, getCategoryPlans, searchPlans, getAllPlansAZ,
      prayers, sessions, forestNodes, forestStats, forestData, forestDataLoading, loadForestData,
      treeData, treeMentees, refreshTreeData, pendingCompletionMoment, dismissPendingCompletionMoment,
      fruitCatalog, userFruits, fruitProgress, fruitCount: userFruits.length, missions,
      dailyVerse, pendingEvaluations, isLoading,
      addPrayer, prayForRequest,
      getPrayerWallPosts, createPrayerWallPost, reactToPost, markPostAnswered, getComments, addComment,
      submitHelpRequest, getHelpRequests, updateHelpRequestStatus,
      reportContent, getModerationQueue, moderateFlag,
      searchUsersByUsername, getProfileByUsername, sendConnectionRequest, respondToConnectionRequest,
      blockUser, unblockUser, blockedUsers, refreshBlockedUsers,
      verificationStatus, loadVerificationStatus, submitVerification, withdrawVerification, toggleBadgeVisibility,
      grainCount, inviteLink, peopleInvited, getMyInviteLink, refreshGrainCount,
      getAllProfiles, getCrisisResponderIds, setCrisisResponder,
      getDiscoverablePeers, getSmartMatch, getGroups, joinGroup, leaveGroup,
      createGroup, getGroupMembers, addGroupMember, removeGroupMember,
      getMyNotes, addNote, updateNote, deleteNote, getMyHighlights, addHighlight, deleteHighlight,
      getHighlightsForLesson, addSectionHighlight,
      getMyReflections, addReflection, addReflectionUpdate, getJournalTimeline,
      markLessonComplete, refreshCurriculumData, refreshData,
      getAssignmentForLesson, getMySubmission, getSubmissionStatus,
      getQuestionSubmissionsForLesson, getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson,
      getMySubmissions,
      submitContent, submitAssignment,
      refreshPendingEvaluations, resolveEvaluation, getSubmitterEvaluationContext,
      toastEvent, celebrationEvent, dismissToastEvent, dismissCelebrationEvent,
      fruitCelebrationQueue, dismissCurrentFruitCelebration,
      categoryCompletionQueue, dismissCurrentCategoryCompletion, checkCategoryCompletion,
      pendingConfirmations, pendingConfirmationCount: pendingConfirmations.length, confirmPeer, declinePeer,
      incomingCall, dismissIncomingCall,
      circleSessionInvite, dismissCircleSessionInvite,
      unreadNotificationCount, getMyNotifications, markNotificationRead, markAllNotificationsRead,
      conversations, conversationsLoading, totalUnreadCount, mostRecentUnread, loadConversations,
      pinMessage, unpinMessage, pinConversation, unpinConversation, addToFavourites, removeFromFavourites,
      submitAdminFeedback, pendingConnectionRequestCount,
      incomingMessageBanner, dismissMessageBanner, setActiveConversationId,
      adminRole, adminStats, loadAdminStats, submitAdminReport,
      appointAdmin, removeAdmin, suspendAdmin, getAdminList, getAdminActivityFeed,
      userChurch, userChurchRole, isChurchLeader, isChurchCreator, churchMemberCount, churchCohortCount, loadUserChurch,
      registerChurch, updateChurch, checkDuplicateChurch, getSocialAccounts, updateSocialAccounts,
      joinChurch, leaveChurch, getGroveData, getChurchMembers, getChurchMemberProfile,
      updateChurchMemberNotes, updateMemberRole, removeChurchMember, createCohort, getChurchCohorts,
      updateCohort, addMemberToCohort, removeMemberFromCohort, createAnnouncement, updateAnnouncement,
      getAnnouncements, pinAnnouncement, createLearningGoal, getLearningGoals, updateLearningGoal, getLearningGoalsDashboard,
      sendContactMessage, getMyContactMessages, getContactThread, getAdminContactInbox, getAdminContactMessage,
      replyToContactMessage, forwardContactMessage, closeContactMessage, setContactMessagePriority,
      setContactMessageStatus, archiveContactMessage, starContactMessage, getContactAdminStats, getContactAllDepartmentStats,
      getOfficialMessageAllowedTypes, sendOfficialMessage, getSentOfficialMessages, searchUsersForCompose,
      getOfficialMailDrafts, saveOfficialMailDraft, deleteOfficialMailDraft, getOfficialMailThreadWithUser,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
