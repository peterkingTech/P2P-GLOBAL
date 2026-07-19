import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, useAuth } from "./AuthContext";
import { STAGES, getStageFromPoints } from "@/constants/stages";

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

export interface PlanModule {
  id: string;
  title: string;
  description: string;
  lessonCount: number;
  completedLessons: number;
  isLocked: boolean;
  imageUrl?: string;
  iconName: string;
}

export interface Plan {
  id: string;           // curriculum id
  curriculumId: string; // same as id
  title: string;        // curriculum title
  description: string;
  iconName: string;
  lessonCount: number;
  completedLessons: number;
  isLocked: boolean;
  imageUrl?: string;
  modules: PlanModule[];
  isSingleModule: boolean;
  singleModuleId?: string;
}

export interface PlanV2Teacher {
  id: string;
  name: string;
  ministryOrChurch: string;
  location: string;
  youtubeHandle?: string;
  instagramHandle?: string;
  otherSocialHandle?: string;
}

export interface PlanV2 {
  id: string;
  title: string;
  tagline: string;
  overview: string;
  hasSubmodules: boolean;
  status: "draft" | "published";
  lessonCount: number;
  completedLessons: number;
  isLocked: boolean;
  teachers: PlanV2Teacher[];
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
}

export interface Fruit {
  id: string;
  name: string;
  description: string;
  earnedAt: string;
  iconName: string;
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
  // Which evaluation gate this came from — core curriculum (p2p_lesson_evaluations)
  // or Plans (p2p_plan_lesson_evaluations), a separate mirrored system. Needed so
  // resolveEvaluation() updates the right table.
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

// Plan reflection answers are private, personal-processing content — never
// peer-evaluated (see migration 026). No evaluation-related fields at all.
export interface PlanReflectionSubmission {
  id: string;
  questionId: string;
  content: string;
  createdAt: string;
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

interface DataContextValue {
  modules: Module[];
  lessons: Lesson[];
  plans: Plan[];
  plansLoading: boolean;
  plansV2: PlanV2[];
  plansV2Loading: boolean;
  refreshPlansV2: () => void;
  prayers: PrayerRequest[];
  sessions: StudySession[];
  forestNodes: ForestNode[];
  forestStats: ForestStats;
  fruits: Fruit[];
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
  addNote: (title: string | null, body: string) => Promise<string | null>;
  deleteNote: (id: string) => Promise<string | null>;
  getMyHighlights: () => Promise<UserHighlight[]>;
  addHighlight: (reference: string, quote: string | null) => Promise<string | null>;
  deleteHighlight: (id: string) => Promise<string | null>;
  getHighlightsForLesson: (lessonId: string) => Promise<UserHighlight[]>;
  addSectionHighlight: (params: {
    lessonId: string; sectionId: string; reference: string; quote: string;
    startOffset: number; endOffset: number; color?: string;
  }) => Promise<string | null>;
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
  submitPlanReflection: (params: { lessonId: string; questionId: string; text: string }) => Promise<string | null>;
  getPlanReflectionSubmissionsForLesson: (lessonId: string) => Promise<PlanReflectionSubmission[]>;
  submitContent: (params: SubmitContentParams) => Promise<string | null>;
  submitAssignment: (assignmentId: string, lessonId: string, content: string) => Promise<string | null>;
  refreshPendingEvaluations: () => Promise<void>;
  resolveEvaluation: (
    evaluationId: string,
    status: "approved" | "needs_revision",
    feedback: string,
    source?: "core" | "plan"
  ) => Promise<string | null>;
  getSubmitterEvaluationContext: (evaluationId: string, source?: "core" | "plan") => Promise<SubmitterEvaluationContext | null>;
  toastEvent: GrowthEvent | null;
  celebrationEvent: GrowthEvent | null;
  dismissToastEvent: () => void;
  dismissCelebrationEvent: () => void;
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
    const rawExt = localUri.split(".").pop()?.toLowerCase() ?? "m4a";
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

// ── Provider ──────────────────────────────────────────────────────────────────

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile, isLoading: authLoading } = useAuth();
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansV2, setPlansV2] = useState<PlanV2[]>([]);
  const [plansV2Loading, setPlansV2Loading] = useState(false);
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [dailyVerse, setDailyVerse] = useState<{ ref: string; text: string } | null>(null);
  const [pendingEvaluations, setPendingEvaluations] = useState<PendingEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toastEvent, setToastEvent] = useState<GrowthEvent | null>(null);
  const [celebrationEvent, setCelebrationEvent] = useState<GrowthEvent | null>(null);

  const loadPlans = useCallback(async (userId?: string) => {
    setPlansLoading(true);
    try {
      const { data: allCurriculums } = await supabase
        .from("p2p_curriculums")
        .select("*")
        .eq("status", "published");
      const planCurriculums = (allCurriculums ?? []).filter(
        (c: Record<string, unknown>) => (c.type as string) === "plan"
      );
      if (planCurriculums.length === 0) { setPlans([]); setPlansLoading(false); return; }
      const curriculumIds = planCurriculums.map((c: Record<string, unknown>) => c.id as string);
      const { data: planModules } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id,title,description,order_index,image_url,icon_name")
        .in("curriculum_id", curriculumIds)
        .eq("status", "published")
        .order("order_index", { ascending: true });
      if (!planModules || planModules.length === 0) { setPlans([]); setPlansLoading(false); return; }
      const moduleIds = (planModules as Record<string, unknown>[]).map((m) => m.id as string);
      const { data: planLessons } = await supabase
        .from("p2p_lessons")
        .select("id,module_id")
        .in("module_id", moduleIds);
      let progressByLesson = new Map<string, boolean>();
      if (userId) {
        const { data: progressRows } = await supabase
          .from("p2p_lesson_progress")
          .select("lesson_id,completed")
          .eq("user_id", userId);
        for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
          progressByLesson.set(p.lesson_id as string, Boolean(p.completed));
        }
      }
      const lessonsRaw = (planLessons ?? []) as Record<string, unknown>[];
      // Build one Plan per curriculum (not per module)
      const builtPlans: Plan[] = planCurriculums.map((currRow) => {
        const c = currRow as Record<string, unknown>;
        const currModules = ((planModules ?? []) as Record<string, unknown>[])
          .filter((m) => (m.curriculum_id as string) === (c.id as string))
          .sort((a, b) => (a.order_index as number) - (b.order_index as number));

        const subModules: PlanModule[] = currModules.map((m) => {
          const mLessons = lessonsRaw.filter((l) => (l.module_id as string) === (m.id as string));
          const lessonCount = mLessons.length;
          const completedLessons = mLessons.filter((l) => progressByLesson.get(l.id as string)).length;
          return {
            id: m.id as string,
            title: m.title as string,
            description: (m.description as string) ?? "",
            lessonCount,
            completedLessons,
            isLocked: false,
            imageUrl: (m.image_url as string) ?? undefined,
            iconName: (m.icon_name as string) ?? "book-outline",
          };
        });
        // Sequential locking within the curriculum
        for (let i = 1; i < subModules.length; i++) {
          const prev = subModules[i - 1];
          subModules[i].isLocked = prev.lessonCount === 0 || prev.completedLessons < prev.lessonCount;
        }

        const totalLessons = subModules.reduce((a, m) => a + m.lessonCount, 0);
        const totalCompleted = subModules.reduce((a, m) => a + m.completedLessons, 0);
        const isSingleModule = subModules.length === 1;

        return {
          id: c.id as string,
          curriculumId: c.id as string,
          title: c.title as string,
          description: (c.description as string) ?? "",
          iconName: (currModules[0]?.icon_name as string) ?? "book-outline",
          lessonCount: totalLessons,
          completedLessons: totalCompleted,
          isLocked: false,
          imageUrl: (currModules[0]?.image_url as string) ?? undefined,
          modules: subModules,
          isSingleModule,
          singleModuleId: isSingleModule ? (currModules[0]?.id as string) : undefined,
        };
      });
      setPlans(builtPlans);
    } catch {
      setPlans([]);
    } finally {
      setPlansLoading(false);
    }
  }, []);

  const loadPlansV2 = useCallback(async (userId?: string, languageCode?: string) => {
    setPlansV2Loading(true);
    try {
      const { data: allPlans } = await supabase
        .from("p2p_plans")
        .select("id,title,tagline,overview,has_submodules,status")
        .eq("status", "published")
        .order("created_at", { ascending: true });
      if (!allPlans || allPlans.length === 0) { setPlansV2([]); return; }
      const planIds = (allPlans as Record<string, unknown>[]).map(p => p.id as string);

      // Overlay translated title/tagline/overview when a non-English content
      // language is selected — same pattern as loadCurriculum()'s overlay,
      // via the unified p2p_content_translations table (content_type='plan').
      // End-user path: only serve approved translations (review gate).
      const planTitleOverrides = new Map<string, string>();
      const planTaglineOverrides = new Map<string, string>();
      const planOverviewOverrides = new Map<string, string>();
      if (languageCode && languageCode !== "en" && planIds.length > 0) {
        const { data: planTrans } = await supabase
          .from("p2p_content_translations")
          .select("content_id,title,subtitle,description")
          .eq("content_type", "plan")
          .in("content_id", planIds)
          .eq("language_code", languageCode)
          .eq("status", "approved");
        for (const row of (planTrans ?? []) as Record<string, unknown>[]) {
          const id = row.content_id as string;
          if (row.title) planTitleOverrides.set(id, row.title as string);
          if (row.subtitle) planTaglineOverrides.set(id, row.subtitle as string);
          if (row.description) planOverviewOverrides.set(id, row.description as string);
        }
      }

      const [{ data: lessons }, { data: teachers }, { data: progressRows }] = await Promise.all([
        supabase.from("p2p_plan_lessons").select("id,plan_id").in("plan_id", planIds),
        supabase.from("p2p_plan_source_teachers")
          .select("id,plan_id,name,ministry_or_church,location,youtube_handle,instagram_handle,other_social_handle")
          .in("plan_id", planIds),
        userId
          ? supabase.from("p2p_plan_lesson_progress").select("lesson_id,completed").eq("user_id", userId)
          : Promise.resolve({ data: [] }),
      ]);
      const progressMap = new Map<string, boolean>();
      for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
        progressMap.set(p.lesson_id as string, Boolean(p.completed));
      }
      const builtPlans: PlanV2[] = (allPlans as Record<string, unknown>[]).map(plan => {
        const planLessons = ((lessons ?? []) as Record<string, unknown>[]).filter(l => (l.plan_id as string) === (plan.id as string));
        const lessonCount = planLessons.length;
        const completedLessons = planLessons.filter(l => progressMap.get(l.id as string)).length;
        const planTeachers: PlanV2Teacher[] = ((teachers ?? []) as Record<string, unknown>[])
          .filter(t => (t.plan_id as string) === (plan.id as string))
          .map(t => ({
            id: t.id as string, name: t.name as string,
            ministryOrChurch: (t.ministry_or_church as string) ?? "",
            location: (t.location as string) ?? "",
            youtubeHandle: (t.youtube_handle as string) ?? undefined,
            instagramHandle: (t.instagram_handle as string) ?? undefined,
            otherSocialHandle: (t.other_social_handle as string) ?? undefined,
          }));
        const planId = plan.id as string;
        return {
          id: planId, title: planTitleOverrides.get(planId) ?? (plan.title as string),
          tagline: planTaglineOverrides.get(planId) ?? ((plan.tagline as string) ?? ""),
          overview: planOverviewOverrides.get(planId) ?? ((plan.overview as string) ?? ""),
          hasSubmodules: Boolean(plan.has_submodules),
          status: plan.status as "draft" | "published",
          lessonCount, completedLessons, isLocked: false,
          teachers: planTeachers,
        };
      });
      setPlansV2(builtPlans);
    } catch { setPlansV2([]); }
    finally { setPlansV2Loading(false); }
  }, []);

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

        // Primary: query the new unified p2p_content_translations table
        // End-user path: only serve approved translations (review gate)
        const allIds = [...moduleIds, ...lessonIdList];
        const { data: newTrans } = await supabase
          .from("p2p_content_translations")
          .select("content_type,content_id,title,subtitle,description,status")
          .in("content_id", allIds)
          .eq("language_code", languageCode)
          .eq("status", "approved");

        const newModMap = new Map<string, string>();
        const newLesMap = new Map<string, string>();
        for (const row of (newTrans ?? []) as Record<string, unknown>[]) {
          if (row.title) {
            if (row.content_type === "module") newModMap.set(row.content_id as string, row.title as string);
            if (row.content_type === "lesson") newLesMap.set(row.content_id as string, row.title as string);
          }
        }

        // Fallback: legacy tables for any IDs not found in the new table
        const missingModuleIds = moduleIds.filter((id) => !newModMap.has(id));
        const missingLessonIds = lessonIdList.filter((id) => !newLesMap.has(id));

        const [{ data: modTrans }, { data: lessTrans }] = await Promise.all([
          missingModuleIds.length
            ? supabase
                .from("p2p_module_translations")
                .select("module_id,title")
                .in("module_id", missingModuleIds)
                .eq("language_code", languageCode)
            : Promise.resolve({ data: [] }),
          missingLessonIds.length
            ? supabase
                .from("p2p_lesson_translations")
                .select("lesson_id,title")
                .in("lesson_id", missingLessonIds)
                .eq("language_code", languageCode)
            : Promise.resolve({ data: [] }),
        ]);

        // Merge: new table wins, legacy is fallback
        for (const [id, title] of newModMap) moduleTitleOverrides.set(id, title);
        for (const [id, title] of newLesMap) lessonTitleOverrides.set(id, title);
        for (const mt of (modTrans ?? []) as Record<string, unknown>[]) {
          if (mt.title && !moduleTitleOverrides.has(mt.module_id as string))
            moduleTitleOverrides.set(mt.module_id as string, mt.title as string);
        }
        for (const lt of (lessTrans ?? []) as Record<string, unknown>[]) {
          if (lt.title && !lessonTitleOverrides.has(lt.lesson_id as string))
            lessonTitleOverrides.set(lt.lesson_id as string, lt.title as string);
        }
      }
      let progressByLesson = new Map<string, boolean>();
      const evalStatusByLesson = new Map<string, "pending" | "needs_revision">();
      if (userId) {
        const { data: progressRows } = await supabase
          .from("p2p_lesson_progress")
          .select("lesson_id,completed")
          .eq("user_id", userId);
        for (const p of (progressRows ?? []) as Record<string, unknown>[]) {
          progressByLesson.set(p.lesson_id as string, Boolean(p.completed));
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
        const submittedLessons = moduleLessons.filter((l) =>
          progressByLesson.get(l.id as string) || evalStatusByLesson.has(l.id as string)
        ).length;
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
          const evalSt = isCompleted ? undefined : evalStatusByLesson.get(l.id as string) ?? undefined;
          const passedForUnlock = isCompleted || evalSt === "pending";
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

  const refreshPendingEvaluations = useCallback(async (userId?: string) => {
    const uid = userId ?? profile?.id;
    if (!uid) return;
    try {
      const [{ data: evalRows }, { data: planEvalRows }] = await Promise.all([
        supabase.from("p2p_lesson_evaluations")
          .select("id,submission_id,lesson_id,submitter_id,assigned_at")
          .eq("evaluator_id", uid).eq("status", "pending").order("assigned_at", { ascending: true }),
        supabase.from("p2p_plan_lesson_evaluations")
          .select("id,submission_id,lesson_id,submitter_id,assigned_at")
          .eq("evaluator_id", uid).eq("status", "pending").order("assigned_at", { ascending: true }),
      ]);
      const rows = (evalRows ?? []) as Record<string, unknown>[];
      const planRows = (planEvalRows ?? []) as Record<string, unknown>[];
      if (rows.length === 0 && planRows.length === 0) {
        setPendingEvaluations([]); return;
      }

      const submissionIds = Array.from(new Set(rows.map((r) => r.submission_id as string)));
      const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string)));
      const planSubmissionIds = Array.from(new Set(planRows.map((r) => r.submission_id as string)));
      const planLessonIds = Array.from(new Set(planRows.map((r) => r.lesson_id as string)));
      const submitterIds = Array.from(new Set([...rows, ...planRows].map((r) => r.submitter_id as string)));

      const [{ data: subs }, { data: lessonsData }, { data: planSubs }, { data: planLessonsData }, { data: submitters }] = await Promise.all([
        submissionIds.length
          ? supabase.from("p2p_submissions").select("id,submission_type,text_content,media_url,duration_seconds").in("id", submissionIds)
          : Promise.resolve({ data: [] }),
        lessonIds.length ? supabase.from("p2p_lessons").select("id,title").in("id", lessonIds) : Promise.resolve({ data: [] }),
        planSubmissionIds.length
          ? supabase.from("p2p_plan_assignment_submissions").select("id,content").in("id", planSubmissionIds)
          : Promise.resolve({ data: [] }),
        planLessonIds.length ? supabase.from("p2p_plan_lessons").select("id,title").in("id", planLessonIds) : Promise.resolve({ data: [] }),
        supabase.from("p2p_profiles").select("id,full_name").in("id", submitterIds),
      ]);
      const subById = new Map((subs ?? []).map((s: Record<string, unknown>) => [s.id as string, s]));
      const planSubById = new Map((planSubs ?? []).map((s: Record<string, unknown>) => [s.id as string, s]));
      const titleById = new Map((lessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Lesson"]));
      const planTitleById = new Map((planLessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Plan Lesson"]));
      const nameById = new Map((submitters ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.full_name as string) ?? "A fellow disciple"]));

      const mapped: PendingEvaluation[] = rows.map((row) => {
        const sub = subById.get(row.submission_id as string) as Record<string, unknown> | undefined;
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
          source: "core",
        };
      });
      const mappedPlan: PendingEvaluation[] = planRows.map((row) => {
        const sub = planSubById.get(row.submission_id as string) as Record<string, unknown> | undefined;
        return {
          id: row.id as string,
          submissionId: row.submission_id as string,
          lessonId: row.lesson_id as string,
          lessonTitle: planTitleById.get(row.lesson_id as string) ?? "Plan Lesson",
          submitterId: row.submitter_id as string,
          submitterName: nameById.get(row.submitter_id as string) ?? "A fellow disciple",
          submissionType: "text",
          content: (sub?.content as string) ?? "",
          mediaUrl: null,
          durationSeconds: null,
          assignedAt: row.assigned_at as string,
          source: "plan",
        };
      });

      setPendingEvaluations(
        [...mapped, ...mappedPlan].sort((a, b) => new Date(a.assignedAt).getTime() - new Date(b.assignedAt).getTime())
      );
    } catch {
      setPendingEvaluations([]);
    }
  }, [profile]);

  const loadForestNetwork = useCallback(async (userId: string, userNode: ForestNode) => {
    try {
      type LinkRow = { mentor_id: string; disciple_id: string };
      type ProfileRow = { id: string; full_name: string | null; role: string | null; growth_level: number | null; country: string | null };

      const allLinks: LinkRow[] = [];
      let frontier = [userId];
      const visitedMentors = new Set<string>();
      for (let depth = 0; depth < 5 && frontier.length > 0; depth++) {
        const { data } = await supabase
          .from("p2p_discipleship_links")
          .select("mentor_id,disciple_id")
          .eq("active", true)
          .in("mentor_id", frontier);
        const rows = (data ?? []) as LinkRow[];
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

      const { data: profiles } = await supabase
        .from("p2p_profiles")
        .select("id,full_name,role,growth_level,country")
        .in("id", discipleIds);
      const profileById = new Map(
        ((profiles ?? []) as ProfileRow[]).map((p) => [p.id, p])
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

  const resetAllState = useCallback(() => {
    setModules([]);
    setLessons([]);
    setPlans([]);
    setPrayers([]);
    setSessions([]);
    setForestNodes([]);
    setForestStats({ totalDisciples: 0, hasDiscipleMaker: false, countriesReached: [] });
    setFruits([]);
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
        loadPlans(profile?.id),
        loadPlansV2(profile?.id, profile?.contentLanguage ?? "en"),
      ]);
      if (profile?.id) {
        await refreshPendingEvaluations(profile.id);
        await checkGrowthEvents(profile.id);
      }
      if (profile?.id) {
        const { data: fruitsData } = await supabase
          .from("p2p_user_fruits")
          .select("id,fruit_name,description,icon_name,earned_at")
          .eq("user_id", profile.id)
          .order("earned_at", { ascending: false });
        setFruits((fruitsData ?? []).map((f: Record<string, unknown>) => ({
          id: f.id as string,
          name: (f.fruit_name as string) ?? "",
          description: (f.description as string) ?? "",
          earnedAt: (f.earned_at as string) ?? "",
          iconName: (f.icon_name as string) ?? "leaf",
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
      }
    } catch {
      setDailyVerse(DAILY_VERSES[0]);
      setModules(FALLBACK_MODULES);
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, isAuthenticated, profile, loadCurriculum, loadPlans, loadPlansV2, refreshPendingEvaluations, loadForestNetwork]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const channel = supabase
      .channel(`p2p_unlock_sync_${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "p2p_lesson_evaluations", filter: `submitter_id=eq.${userId}` },
        () => { loadCurriculum(userId, contentLanguage); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "p2p_plan_lesson_evaluations", filter: `submitter_id=eq.${userId}` },
        () => { loadPlansV2(userId, contentLanguage); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, profile?.contentLanguage, loadCurriculum, loadPlansV2]);

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
      let query = supabase
        .from("p2p_profiles")
        .select("id, full_name, country, role, gifts, skills, photo_url")
        .neq("id", profile.id)
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
        .select("id, title, body, created_at")
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((n: any) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.created_at }));
    } catch (e) {
      console.error("getMyNotes failed", e);
      return [];
    }
  }, [profile]);

  const addNote = useCallback(async (title: string | null, body: string): Promise<string | null> => {
    if (!profile) return "Not signed in";
    try {
      const { error } = await supabase.from("p2p_user_notes").insert({ user_id: profile.id, title, body });
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
    }
  }, [profile, loadCurriculum, checkGrowthEvents]);

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

  const getMySubmissions = useCallback(async (): Promise<MySubmission[]> => {
    if (!profile) return [];
    try {
      const [{ data: subs }, { data: planSubs }] = await Promise.all([
        supabase.from("p2p_submissions")
          .select("id,lesson_id,submission_type,text_content,media_url,duration_seconds,created_at")
          .eq("user_id", profile.id).not("assignment_id", "is", null).order("created_at", { ascending: false }),
        supabase.from("p2p_plan_assignment_submissions")
          .select("id,lesson_id,content,created_at")
          .eq("user_id", profile.id).order("created_at", { ascending: false }),
      ]);

      const rows = (subs ?? []) as Record<string, unknown>[];
      const planRows = (planSubs ?? []) as Record<string, unknown>[];
      if (rows.length === 0 && planRows.length === 0) return [];

      const submissionIds = rows.map((r) => r.id as string);
      const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string)));
      const planSubmissionIds = planRows.map((r) => r.id as string);
      const planLessonIds = Array.from(new Set(planRows.map((r) => r.lesson_id as string)));

      const [{ data: evals }, { data: lessonsData }, { data: planEvals }, { data: planLessonsData }] = await Promise.all([
        submissionIds.length
          ? supabase.from("p2p_lesson_evaluations").select("submission_id,status,feedback,self_approved").in("submission_id", submissionIds)
          : Promise.resolve({ data: [] }),
        lessonIds.length ? supabase.from("p2p_lessons").select("id,title").in("id", lessonIds) : Promise.resolve({ data: [] }),
        planSubmissionIds.length
          ? supabase.from("p2p_plan_lesson_evaluations").select("submission_id,status,feedback,self_approved").in("submission_id", planSubmissionIds)
          : Promise.resolve({ data: [] }),
        planLessonIds.length ? supabase.from("p2p_plan_lessons").select("id,title").in("id", planLessonIds) : Promise.resolve({ data: [] }),
      ]);
      const evalBySubmission = new Map((evals ?? []).map((e: Record<string, unknown>) => [e.submission_id as string, e]));
      const planEvalBySubmission = new Map((planEvals ?? []).map((e: Record<string, unknown>) => [e.submission_id as string, e]));
      const titleByLesson = new Map((lessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Lesson"]));
      const planTitleByLesson = new Map((planLessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Plan Lesson"]));

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
      const mappedPlan: MySubmission[] = planRows.map((r) => {
        const ev = planEvalBySubmission.get(r.id as string) as Record<string, unknown> | undefined;
        return {
          id: r.id as string,
          lessonId: r.lesson_id as string,
          lessonTitle: planTitleByLesson.get(r.lesson_id as string) ?? "Plan Lesson",
          submissionType: "text",
          content: (r.content as string) ?? "",
          mediaUrl: null,
          durationSeconds: null,
          createdAt: r.created_at as string,
          evaluationStatus: (ev?.status as MySubmission["evaluationStatus"]) ?? null,
          feedback: (ev?.feedback as string) ?? null,
          selfApproved: Boolean(ev?.self_approved),
          source: "plan",
        };
      });

      return [...mapped, ...mappedPlan].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch { return []; }
  }, [profile]);

  // Plan reflections are private, personal-processing content — see migration
  // 026. This insert has no evaluation gate/trigger attached at all: no
  // evaluator is ever assigned, and RLS restricts visibility to the submitter
  // (and admins) only.
  const submitPlanReflection = useCallback(async (params: { lessonId: string; questionId: string; text: string }): Promise<string | null> => {
    if (!profile) return "You must be signed in to submit.";
    try {
      const { error } = await supabase.from("p2p_plan_reflection_submissions").insert({
        lesson_id: params.lessonId,
        question_id: params.questionId,
        user_id: profile.id,
        content: params.text,
      });
      return error ? error.message : null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to submit.";
    }
  }, [profile]);

  const getPlanReflectionSubmissionsForLesson = useCallback(async (lessonId: string): Promise<PlanReflectionSubmission[]> => {
    if (!profile) return [];
    try {
      const { data, error } = await supabase
        .from("p2p_plan_reflection_submissions")
        .select("id,question_id,content,created_at")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .order("created_at", { ascending: false });
      if (error || !data) return [];
      const seen = new Set<string>();
      return (data as Record<string, unknown>[])
        .filter((r) => {
          const qid = r.question_id as string;
          if (seen.has(qid)) return false;
          seen.add(qid);
          return true;
        })
        .map((r) => ({
          id: r.id as string,
          questionId: r.question_id as string,
          content: (r.content as string) ?? "",
          createdAt: r.created_at as string,
        }));
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
      // Covers the self-approval edge case (no evaluator available yet), where
      // the evaluation — and any resulting growth event — is created synchronously.
      await checkGrowthEvents(profile.id);
      // The submitted/unlock state shown on Learn, module and progress screens
      // is computed inside loadCurriculum from evaluation rows — without this
      // refetch, a submission shows 0 submitted and keeps the next lesson
      // locked until a manual refresh/app reload.
      await loadCurriculum(profile.id, profile.contentLanguage ?? "en");
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to submit.";
    }
  }, [profile, checkGrowthEvents, loadCurriculum]);

  const submitAssignment = useCallback(async (assignmentId: string, lessonId: string, content: string): Promise<string | null> => {
    return submitContent({ lessonId, assignmentId, type: "text", text: content });
  }, [submitContent]);

  const resolveEvaluation = useCallback(async (
    evaluationId: string,
    status: "approved" | "needs_revision",
    feedback: string,
    source: "core" | "plan" = "core"
  ): Promise<string | null> => {
    if (!profile) return "You must be signed in.";
    try {
      const table = source === "plan" ? "p2p_plan_lesson_evaluations" : "p2p_lesson_evaluations";
      const { error } = await supabase
        .from(table)
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
  // evaluator on that specific p2p_lesson_evaluations / p2p_plan_lesson_evaluations
  // row, and if so returns only name/avatar/growth-level/streak/context-label
  // — never registration/spiritual intake, other submissions, or help-request
  // history. Mirrors identically for core curriculum and Plans.
  const getSubmitterEvaluationContext = useCallback(async (
    evaluationId: string,
    source: "core" | "plan" = "core"
  ): Promise<SubmitterEvaluationContext | null> => {
    if (!profile) return null;
    try {
      const { data, error } = await supabase.rpc("p2p_get_submitter_evaluation_context", {
        p_evaluation_id: evaluationId,
        p_source: source,
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

  return (
    <DataContext.Provider value={{
      modules, lessons, plans, plansLoading, plansV2, plansV2Loading, refreshPlansV2: loadPlansV2, prayers, sessions, forestNodes, forestStats, fruits, missions,
      dailyVerse, pendingEvaluations, isLoading,
      addPrayer, prayForRequest,
      getPrayerWallPosts, createPrayerWallPost, reactToPost, markPostAnswered, getComments, addComment,
      submitHelpRequest, getHelpRequests, updateHelpRequestStatus,
      reportContent, getModerationQueue, moderateFlag,
      getAllProfiles, getCrisisResponderIds, setCrisisResponder,
      getDiscoverablePeers, getSmartMatch, getGroups, joinGroup, leaveGroup,
      createGroup, getGroupMembers, addGroupMember, removeGroupMember,
      getMyNotes, addNote, deleteNote, getMyHighlights, addHighlight, deleteHighlight,
      getHighlightsForLesson, addSectionHighlight,
      markLessonComplete, refreshCurriculumData, refreshData,
      getAssignmentForLesson, getMySubmission, getSubmissionStatus,
      getQuestionSubmissionsForLesson, getAssignmentQuestionsForLesson, getAssignmentQuestionSubmissionsForLesson,
      getMySubmissions,
      submitPlanReflection, getPlanReflectionSubmissionsForLesson,
      submitContent, submitAssignment,
      refreshPendingEvaluations, resolveEvaluation, getSubmitterEvaluationContext,
      toastEvent, celebrationEvent, dismissToastEvent, dismissCelebrationEvent,
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
