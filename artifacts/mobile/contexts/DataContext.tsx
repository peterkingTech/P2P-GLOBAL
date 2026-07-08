import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase, useAuth } from "./AuthContext";

export interface Module {
  id: string;
  curriculumId: string;
  title: string;
  description: string;
  level: number;
  lessonCount: number;
  completedLessons: number;
  isLocked: boolean;
  imageUrl?: string;
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

export interface PendingEvaluation {
  id: string;
  submissionId: string;
  lessonId: string;
  lessonTitle: string;
  submitterId: string;
  submitterName: string;
  content: string;
  assignedAt: string;
}

interface DataContextValue {
  modules: Module[];
  lessons: Lesson[];
  prayers: PrayerRequest[];
  sessions: StudySession[];
  forestNodes: ForestNode[];
  fruits: Fruit[];
  missions: Mission[];
  dailyVerse: { ref: string; text: string } | null;
  pendingEvaluations: PendingEvaluation[];
  isLoading: boolean;
  addPrayer: (text: string, nation?: string) => Promise<void>;
  prayForRequest: (id: string) => Promise<void>;
  markLessonComplete: (lessonId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  getAssignmentForLesson: (lessonId: string) => Promise<Assignment | null>;
  getMySubmission: (lessonId: string) => Promise<{ id: string; content: string } | null>;
  submitAssignment: (assignmentId: string, lessonId: string, content: string) => Promise<string | null>;
  refreshPendingEvaluations: () => Promise<void>;
  resolveEvaluation: (
    evaluationId: string,
    status: "approved" | "revision_requested",
    feedback: string
  ) => Promise<string | null>;
}

const DataContext = createContext<DataContextValue | null>(null);

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
  { id: "m1", curriculumId: "", title: "Foundations of Faith", description: "The essentials of Christian discipleship", level: 1, lessonCount: 6, completedLessons: 0, isLocked: false, imageUrl: undefined },
];

const MOCK_MISSIONS: Mission[] = [
  { id: "ms1", title: "Pray for the Fulani", nation: "West Africa", population: "38 million", description: "Nomadic pastoralists across the Sahel, one of Africa's largest unreached peoples.", prayerCount: 2847, language: "Fula", religion: "Islam" },
  { id: "ms2", title: "Light for the Uyghur", nation: "Xinjiang, China", population: "12 million", description: "Living in one of the most surveilled regions on earth, longing for freedom.", prayerCount: 1934, language: "Uyghur", religion: "Islam" },
  { id: "ms3", title: "The Unreached Pashtun", nation: "Afghanistan/Pakistan", population: "50 million", description: "Bound by Pashtunwali code; few believers exist among them.", prayerCount: 3102, language: "Pashto", religion: "Islam" },
  { id: "ms4", title: "Reach the Brahmin", nation: "India", population: "60 million", description: "Hindu priests and scholars — intellectuals open to truth, closed to conversion.", prayerCount: 891, language: "Hindi/Sanskrit", religion: "Hinduism" },
];

const MOCK_FRUITS: Fruit[] = [
  { id: "f1", name: "First Fruit", description: "Completed your first Bible study session", earnedAt: "2026-06-01", iconName: "leaf" },
  { id: "f2", name: "Faithful Root", description: "Studied for 7 consecutive days", earnedAt: "2026-06-08", iconName: "git-branch" },
  { id: "f3", name: "Prayer Warrior", description: "Prayed for 30 different requests", earnedAt: "2026-06-15", iconName: "heart" },
];

export function DataProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, profile } = useAuth();
  const [modules, setModules] = useState<Module[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [prayers, setPrayers] = useState<PrayerRequest[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [forestNodes, setForestNodes] = useState<ForestNode[]>([]);
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [missions] = useState<Mission[]>(MOCK_MISSIONS);
  const [dailyVerse, setDailyVerse] = useState<{ ref: string; text: string } | null>(null);
  const [pendingEvaluations, setPendingEvaluations] = useState<PendingEvaluation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!isAuthenticated) return;
    setIsLoading(true);
    try {
      // Daily verse (rotate by day)
      const dayIdx = new Date().getDate() % DAILY_VERSES.length;
      setDailyVerse(DAILY_VERSES[dayIdx]);

      // Try to load from Supabase, fall back to mock
      const [prayersRes, sessionsRes] = await Promise.all([
        supabase
          .from("p2p_prayer_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase
          .from("p2p_sessions")
          .select("*")
          .order("scheduled_at", { ascending: true })
          .limit(10),
      ]);

      if (prayersRes.data && prayersRes.data.length > 0) {
        const mapped: PrayerRequest[] = prayersRes.data.map((p: Record<string, unknown>) => ({
          id: p.id as string,
          userId: (p.user_id ?? "") as string,
          userName: (p.user_name ?? "Anonymous") as string,
          nation: p.nation as string | undefined,
          text: p.text as string,
          prayerCount: (p.prayer_count ?? 0) as number,
          createdAt: p.created_at as string,
          hasPrayed: false,
        }));
        setPrayers(mapped);
      } else {
        setPrayers([
          { id: "p1", userId: "u1", userName: "Emmanuel K.", nation: "Ghana", text: "Pray for our church plant in Kumasi — we need a gathering place.", prayerCount: 23, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p2", userId: "u2", userName: "Sarah M.", nation: "Kenya", text: "Pray for my discipleship group — 3 members are facing persecution.", prayerCount: 47, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p3", userId: "u3", userName: "David L.", nation: "South Korea", text: "Intercede for unreached villages in North Korea. God can open doors.", prayerCount: 89, createdAt: new Date().toISOString(), hasPrayed: false },
          { id: "p4", userId: "u4", userName: "Grace A.", nation: "Nigeria", text: "Our weekly study group needs wisdom to navigate difficult theological questions.", prayerCount: 15, createdAt: new Date().toISOString(), hasPrayed: false },
        ]);
      }

      if (sessionsRes.data && sessionsRes.data.length > 0) {
        const mapped: StudySession[] = sessionsRes.data.map((s: Record<string, unknown>) => ({
          id: s.id as string,
          title: s.title as string,
          description: s.description as string | undefined,
          scheduledAt: s.scheduled_at as string,
          durationMinutes: (s.duration_minutes ?? 45) as number,
          participantCount: (s.participant_count ?? 0) as number,
          isLive: (s.is_live ?? false) as boolean,
          hostName: (s.host_name ?? "Unknown") as string,
        }));
        setSessions(mapped);
      } else {
        const now = new Date();
        setSessions([
          { id: "s1", title: "Book of John — Chapter 15", description: "Abiding in the Vine", scheduledAt: new Date(now.getTime() + 3600000).toISOString(), durationMinutes: 45, participantCount: 4, isLive: true, hostName: "Pastor James" },
          { id: "s2", title: "Romans Deep Dive", description: "Justification by faith", scheduledAt: new Date(now.getTime() + 86400000).toISOString(), durationMinutes: 60, participantCount: 2, isLive: false, hostName: "Sister Ruth" },
        ]);
      }

      await loadCurriculum(profile?.id);
      if (profile?.id) await refreshPendingEvaluations(profile.id);
      setFruits(MOCK_FRUITS);

      // Build simple forest from profile
      if (profile) {
        setForestNodes([
          {
            id: profile.id,
            name: profile.displayName,
            role: profile.role,
            growthLevel: profile.growthLevel,
            country: profile.country,
            depth: 0,
            children: [
              { id: "n1", name: "Thomas A.", role: "disciple", growthLevel: 2, country: "Uganda", depth: 1, children: [] },
              { id: "n2", name: "Maria G.", role: "seeker", growthLevel: 0, country: "Brazil", depth: 1, children: [
                { id: "n3", name: "João F.", role: "seeker", growthLevel: 0, country: "Brazil", depth: 2, children: [] },
              ] },
            ],
          },
        ]);
      }
    } catch {
      setDailyVerse(DAILY_VERSES[0]);
      setModules(FALLBACK_MODULES);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCurriculum = useCallback(async (userId?: string) => {
    try {
      const { data: curriculums } = await supabase
        .from("p2p_curriculums")
        .select("id,title,status")
        .eq("status", "published");

      if (!curriculums || curriculums.length === 0) {
        setModules(FALLBACK_MODULES);
        setLessons([]);
        return;
      }

      const curriculumIds = curriculums.map((c: Record<string, unknown>) => c.id as string);
      const { data: allModules } = await supabase
        .from("p2p_modules")
        .select("id,curriculum_id,title,description,order_index")
        .in("curriculum_id", curriculumIds)
        .order("order_index", { ascending: true });

      if (!allModules || allModules.length === 0) {
        setModules(FALLBACK_MODULES);
        setLessons([]);
        return;
      }

      // Pick the published curriculum with the most modules (the "real" active one).
      const countsByCurriculum = new Map<string, number>();
      for (const m of allModules as Record<string, unknown>[]) {
        const cId = m.curriculum_id as string;
        countsByCurriculum.set(cId, (countsByCurriculum.get(cId) ?? 0) + 1);
      }
      let activeCurriculumId = curriculumIds[0];
      let bestCount = -1;
      for (const [cId, count] of countsByCurriculum) {
        if (count > bestCount) {
          bestCount = count;
          activeCurriculumId = cId;
        }
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
        const moduleComplete = lessonCount > 0 && completedLessons === lessonCount;
        const moduleLocked = !previousModuleComplete;

        builtModules.push({
          id: moduleId,
          curriculumId: activeCurriculumId,
          title: m.title as string,
          description: (m.description as string) ?? "",
          level: moduleIdx + 1,
          lessonCount,
          completedLessons,
          isLocked: moduleLocked,
        });

        let previousLessonComplete = true;
        moduleLessons.forEach((l) => {
          const isCompleted = Boolean(progressByLesson.get(l.id as string));
          builtLessons.push({
            id: l.id as string,
            moduleId,
            title: l.title as string,
            content: (l.subtitle as string) ?? "",
            isCompleted,
            isLocked: moduleLocked || !previousLessonComplete,
            order: l.order_index as number,
          });
          previousLessonComplete = isCompleted;
        });

        previousModuleComplete = moduleComplete;
      });

      setModules(builtModules);
      setLessons(builtLessons);
    } catch {
      setModules(FALLBACK_MODULES);
      setLessons([]);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addPrayer = useCallback(async (text: string, nation?: string) => {
    if (!profile) return;
    const newPrayer: PrayerRequest = {
      id: Date.now().toString(),
      userId: profile.id,
      userName: profile.displayName,
      nation,
      text,
      prayerCount: 0,
      createdAt: new Date().toISOString(),
      hasPrayed: false,
    };
    try {
      await supabase.from("p2p_prayer_requests").insert({
        user_id: profile.id,
        user_name: profile.displayName,
        nation,
        text,
        prayer_count: 0,
        created_at: newPrayer.createdAt,
      });
    } catch {}
    setPrayers((prev) => [newPrayer, ...prev]);
  }, [profile]);

  const prayForRequest = useCallback(async (id: string) => {
    setPrayers((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, prayerCount: p.prayerCount + 1, hasPrayed: true } : p
      )
    );
    try {
      await supabase.rpc("increment_prayer_count", { prayer_id: id });
    } catch {}
  }, []);

  const markLessonComplete = useCallback(async (lessonId: string) => {
    try {
      await AsyncStorage.setItem(`lesson_complete_${lessonId}`, "true");
    } catch {}

    if (profile) {
      try {
        await supabase.from("p2p_lesson_progress").upsert(
          {
            user_id: profile.id,
            lesson_id: lessonId,
            completed: true,
            progress_percent: 100,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,lesson_id" }
        );
      } catch {}
      // Recompute module/lesson lock state now that progress changed.
      await loadCurriculum(profile.id);
    } else {
      setLessons((prev) =>
        prev.map((l) => (l.id === lessonId ? { ...l, isCompleted: true } : l))
      );
    }
  }, [profile, loadCurriculum]);

  const refreshData = useCallback(() => loadData(), [loadData]);

  const getAssignmentForLesson = useCallback(async (lessonId: string): Promise<Assignment | null> => {
    try {
      const { data, error } = await supabase
        .from("p2p_assignments")
        .select("id,lesson_id,title,instructions")
        .eq("lesson_id", lessonId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id as string,
        lessonId: data.lesson_id as string,
        title: (data.title as string) ?? "Assignment",
        instructions: (data.instructions as string) ?? "",
      };
    } catch {
      return null;
    }
  }, []);

  const getMySubmission = useCallback(async (lessonId: string): Promise<{ id: string; content: string } | null> => {
    if (!profile) return null;
    try {
      const { data, error } = await supabase
        .from("p2p_assignment_submissions")
        .select("id,content")
        .eq("lesson_id", lessonId)
        .eq("user_id", profile.id)
        .maybeSingle();
      if (error || !data) return null;
      return { id: data.id as string, content: (data.content as string) ?? "" };
    } catch {
      return null;
    }
  }, [profile]);

  const submitAssignment = useCallback(async (assignmentId: string, lessonId: string, content: string): Promise<string | null> => {
    if (!profile) return "You must be signed in to submit.";
    try {
      const { error } = await supabase.from("p2p_assignment_submissions").insert({
        assignment_id: assignmentId,
        lesson_id: lessonId,
        user_id: profile.id,
        content,
      });
      if (error) return error.message;
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Failed to submit assignment.";
    }
  }, [profile]);

  const refreshPendingEvaluations = useCallback(async (userId?: string) => {
    const uid = userId ?? profile?.id;
    if (!uid) return;
    try {
      const { data: evalRows, error } = await supabase
        .from("p2p_lesson_evaluations")
        .select("id,submission_id,lesson_id,submitter_id,assigned_at")
        .eq("evaluator_id", uid)
        .eq("status", "pending")
        .order("assigned_at", { ascending: true });

      if (error || !evalRows || evalRows.length === 0) {
        setPendingEvaluations([]);
        return;
      }

      const rows = evalRows as Record<string, unknown>[];
      const submissionIds = Array.from(new Set(rows.map((r) => r.submission_id as string)));
      const lessonIds = Array.from(new Set(rows.map((r) => r.lesson_id as string)));
      const submitterIds = Array.from(new Set(rows.map((r) => r.submitter_id as string)));

      const [{ data: subs }, { data: lessonsData }, { data: submitters }] = await Promise.all([
        supabase.from("p2p_assignment_submissions").select("id,content").in("id", submissionIds),
        supabase.from("p2p_lessons").select("id,title").in("id", lessonIds),
        supabase.from("p2p_profiles").select("id,full_name").in("id", submitterIds),
      ]);

      const contentById = new Map((subs ?? []).map((s: Record<string, unknown>) => [s.id as string, (s.content as string) ?? ""]));
      const titleById = new Map((lessonsData ?? []).map((l: Record<string, unknown>) => [l.id as string, (l.title as string) ?? "Lesson"]));
      const nameById = new Map((submitters ?? []).map((p: Record<string, unknown>) => [p.id as string, (p.full_name as string) ?? "A fellow disciple"]));

      const mapped: PendingEvaluation[] = rows.map((row) => ({
        id: row.id as string,
        submissionId: row.submission_id as string,
        lessonId: row.lesson_id as string,
        lessonTitle: titleById.get(row.lesson_id as string) ?? "Lesson",
        submitterId: row.submitter_id as string,
        submitterName: nameById.get(row.submitter_id as string) ?? "A fellow disciple",
        content: contentById.get(row.submission_id as string) ?? "",
        assignedAt: row.assigned_at as string,
      }));
      setPendingEvaluations(mapped);
    } catch {
      setPendingEvaluations([]);
    }
  }, [profile]);

  const resolveEvaluation = useCallback(async (
    evaluationId: string,
    status: "approved" | "revision_requested",
    feedback: string
  ): Promise<string | null> => {
    if (!profile) return "You must be signed in.";
    try {
      const { error } = await supabase
        .from("p2p_lesson_evaluations")
        .update({
          status,
          feedback,
          resolved_at: new Date().toISOString(),
        })
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

  return (
    <DataContext.Provider
      value={{
        modules,
        lessons,
        prayers,
        sessions,
        forestNodes,
        fruits,
        missions,
        dailyVerse,
        pendingEvaluations,
        isLoading,
        addPrayer,
        prayForRequest,
        markLessonComplete,
        refreshData,
        getAssignmentForLesson,
        getMySubmission,
        submitAssignment,
        refreshPendingEvaluations,
        resolveEvaluation,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
