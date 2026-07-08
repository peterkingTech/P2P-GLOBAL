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
  title: string;
  description: string;
  level: number;
  lessonCount: number;
  completedLessons: number;
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

interface DataContextValue {
  modules: Module[];
  lessons: Lesson[];
  prayers: PrayerRequest[];
  sessions: StudySession[];
  forestNodes: ForestNode[];
  fruits: Fruit[];
  missions: Mission[];
  dailyVerse: { ref: string; text: string } | null;
  isLoading: boolean;
  addPrayer: (text: string, nation?: string) => Promise<void>;
  prayForRequest: (id: string) => Promise<void>;
  markLessonComplete: (lessonId: string) => Promise<void>;
  refreshData: () => Promise<void>;
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

const MOCK_MODULES: Module[] = [
  { id: "m1", title: "Foundations of Faith", description: "The essentials of Christian discipleship", level: 1, lessonCount: 6, completedLessons: 3, imageUrl: undefined },
  { id: "m2", title: "The Word of God", description: "How to study and apply Scripture", level: 1, lessonCount: 8, completedLessons: 0, imageUrl: undefined },
  { id: "m3", title: "Prayer & Intercession", description: "Developing a vibrant prayer life", level: 2, lessonCount: 5, completedLessons: 0, imageUrl: undefined },
  { id: "m4", title: "Sharing Your Faith", description: "Evangelism in everyday life", level: 2, lessonCount: 7, completedLessons: 0, imageUrl: undefined },
  { id: "m5", title: "Discipling Others", description: "How to walk alongside new believers", level: 3, lessonCount: 9, completedLessons: 0, imageUrl: undefined },
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

      setModules(MOCK_MODULES);
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
      setModules(MOCK_MODULES);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, profile]);

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
    setLessons((prev) =>
      prev.map((l) => (l.id === lessonId ? { ...l, isCompleted: true } : l))
    );
    try {
      await AsyncStorage.setItem(`lesson_complete_${lessonId}`, "true");
    } catch {}
  }, []);

  const refreshData = useCallback(() => loadData(), [loadData]);

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
        isLoading,
        addPrayer,
        prayForRequest,
        markLessonComplete,
        refreshData,
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
