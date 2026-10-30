import { type OfficialAccountType } from "../AuthContext";
import { type OutgoingStatus } from "@/lib/messageReceipts";
import type { SubmissionType } from "./learningModel";

// The app's data shapes (prayer, messages, church, admin, discovery, growth,
// calls, assignments …) and the growth-tree builders. DataContext re-exports
// everything here, so existing imports from "@/contexts/DataContext" keep working.

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

export interface UserChurchSummary { id: string; name: string; logoUrl: string | null; role: ChurchRole; isCurrent: boolean }
export type ConversationType = "direct" | "crisis_response" | "help_request" | "pastoral" | "support" | "peer_group" | "circle" | "family" | "church";

export interface ConversationSummary {
  id: string;
  type: "direct" | "group";
  conversationType: ConversationType;
  name: string | null;
  otherUserId: string | null;
  otherUserVerified: boolean;
  otherUserIsOfficial: boolean;
  otherUserOfficialType: OfficialAccountType | null;
  otherUserPhotoUrl: string | null;
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  /** Receipt status of the last message when the user sent it; null otherwise. */
  lastMessageStatus: OutgoingStatus | null;
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
export type ModerationContentType = "prayer_post" | "prayer_comment" | "message" | "profile" | "prayer_testimony" | "mission_story" | "kingdom_win";

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

export type DiscoveryConnectionStatus = "none" | "pending_sent" | "pending_received" | "connected";
export interface DiscoverablePeer {
  id: string;
  username: string | null;
  fullName: string;
  // Public location only: null when the person hides their country.
  country: string | null;
  city: string | null;
  // The person's own stated calling (free text); null if not written.
  calling: string | null;
  role: string;
  gifts: string[];
  skills: string[];
  photoUrl: string | null;
  // Populated by a separate batched call (getDiscoveryRelationshipStatus) —
  // undefined until that resolves, not a security boundary in itself
  // (p2p_can_contact_directly is re-checked server-side on every actual
  // message/call/connection-request attempt regardless of what this says).
  canContact?: boolean;
  connectionStatus?: DiscoveryConnectionStatus;
  connectionRequestId?: string | null;
}

export type DiscoveryLocationMode = "worldwide" | "nearby";
export interface DiscoverySearchOptions {
  mode?: DiscoveryLocationMode;
  // Nearby only; 5–1000 km. The origin is always the caller's own verified location.
  radiusKm?: number;
  search?: string;
  skillKeys?: string[];
}
export interface DiscoverySearchResult {
  peers: DiscoverablePeer[];
  // "location_required": Nearby needs the caller to verify their location first.
  error: null | "location_required" | "failed";
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
  /** Who it's from (public name/photo), for types with a verified sender; null for system events. */
  actor?: { id: string; name: string | null; photoUrl: string | null; username: string | null } | null;
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
  // My Tree redesign — a dedicated, granular score (migration 113/114),
  // independent of growthStage above (which existing screens still read
  // unchanged). Drives constants/treeStages.ts's 8-stage visual ladder.
  treeGrowthScore: number;
  treeEnvironmentPreference: string | null;
}

export function computeGrowthStage(modulesCompleted: number, activeMentees: number, fruitCount: number, secondGenDisciples: number): GrowthStage {
  // Checked from most- to least-advanced — the given rules overlap (e.g. a
  // fruitful_tree case also satisfies young_tree), so the highest qualifying
  // stage must win.
  if (modulesCompleted === 12 && secondGenDisciples >= 1) return "forest_builder";
  if (modulesCompleted >= 9 && activeMentees >= 2 && fruitCount >= 5) return "fruitful_tree";
  if (modulesCompleted >= 4 && activeMentees >= 1) return "young_tree";
  if (modulesCompleted >= 1 || activeMentees >= 1) return "sprout";
  return "seed";
}

export function computeHealthStatus(daysInactive: number): HealthStatus {
  // dormant's range (>=60) is a subset of wilting's stated range (>=30), so
  // the more severe status must be checked first.
  if (daysInactive >= 60) return "dormant";
  if (daysInactive >= 30) return "wilting";
  if (daysInactive >= 14) return "drought";
  return "healthy";
}

export function buildTreeData(raw: Record<string, unknown>): TreeData {
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
    treeGrowthScore: (raw.treeGrowthScore as number) ?? 0,
    treeEnvironmentPreference: (raw.treeEnvironmentPreference as string) ?? null,
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
  // Caller's profile photo for the full-screen ringing UI (null = avatar).
  callerPhotoUrl: string | null;
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

// Family Worship invite banner — same shape/purpose as CircleSessionInvite
// above, sourced from a p2p_notifications row of type family_worship_invite
// (inserted by POST /family/worship/start for every other active family
// member). Dismissible, not a ringing call — a member can join whenever
// they're ready, or never, with no "missed call" consequence.
export interface FamilyWorshipInvite {
  notificationId: string;
  sessionId: string;
  familyId: string;
  hostName: string;
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
  /** Drawings / photos / PDFs (drafts) to send with a Comprehensive Check answer (migration 218). */
  attachmentIds?: string[];
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

