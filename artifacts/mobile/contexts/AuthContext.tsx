import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { createClient, SupabaseClient, Session, User } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = "https://omkqkasniakcnmfcwrvs.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ta3FrYXNuaWFrY25tZmN3cnZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4ODM5MzYsImV4cCI6MjA5ODQ1OTkzNn0.093jpH0sX9gAcCBirXunIL0i1qNm6jzIZm8JqwVnIxM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type SpiritualGift =
  | "teaching"
  | "evangelism"
  | "mercy"
  | "leadership"
  | "intercession"
  | "hospitality"
  | "giving"
  | "prophecy";

export type DiscipleRole =
  | "student"
  | "peer_guide"
  | "church_leader"
  | "regional_admin"
  | "moderator"
  | "super_admin";

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
  languageCode: string;
  growthLevel: number;
  role: DiscipleRole;
  gifts: SpiritualGift[];
  mentorId?: string;
  isPraying: boolean;
  createdAt: string;
}

interface AuthContextValue {
  supabase: SupabaseClient;
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  signUp: (email: string, password: string, name: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapProfileRow(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    displayName: (row.full_name as string) ?? "",
    email: (row.email as string) ?? "",
    avatarUrl: row.photo_url as string | undefined,
    city: row.city as string | undefined,
    country: row.country as string | undefined,
    languageCode: (row.language as string) ?? "en",
    growthLevel: (row.growth_level as number) ?? 0,
    role: ((row.role as string) ?? "student") as DiscipleRole,
    gifts: ((row.gifts as string[]) ?? []) as SpiritualGift[],
    mentorId: row.mentor_id as string | undefined,
    isPraying: (row.is_praying as boolean) ?? false,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("p2p_profiles")
        .select("*")
        .eq("id", userId)
        .single();
      if (!error && data) {
        setProfile(mapProfileRow(data as Record<string, unknown>));
      }
    } catch {}
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) fetchProfile(s.user.id).finally(() => setIsLoading(false));
      else setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) fetchProfile(s.user.id);
      else setProfile(null);
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    name: string
  ): Promise<string | null> => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name } },
    });
    if (error) return error.message;

    if (data.user) {
      const { error: profileErr } = await supabase.from("p2p_profiles").upsert({
        id: data.user.id,
        email,
        full_name: name,
        created_at: new Date().toISOString(),
      });
      if (profileErr) return profileErr.message;
    }
    return null;
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (session?.user) await fetchProfile(session.user.id);
  }, [session, fetchProfile]);

  const updateProfile = useCallback(async (
    updates: Partial<UserProfile>
  ): Promise<string | null> => {
    if (!session?.user) return "Not authenticated";
    const dbUpdates: Record<string, unknown> = {};
    if (updates.displayName !== undefined) dbUpdates.full_name = updates.displayName;
    if (updates.country !== undefined) dbUpdates.country = updates.country;
    if (updates.gifts !== undefined) dbUpdates.gifts = updates.gifts;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.growthLevel !== undefined) dbUpdates.growth_level = updates.growthLevel;
    if (updates.isPraying !== undefined) dbUpdates.is_praying = updates.isPraying;

    const { error } = await supabase
      .from("p2p_profiles")
      .update(dbUpdates)
      .eq("id", session.user.id);
    if (!error) {
      setProfile((prev) => (prev ? { ...prev, ...updates } : prev));
    }
    return error ? error.message : null;
  }, [session]);

  return (
    <AuthContext.Provider
      value={{
        supabase,
        session,
        user: session?.user ?? null,
        profile,
        isLoading,
        isAuthenticated: !!session,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
