import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { Appearance, useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppColors, THEMES, ThemeName, THEME_META } from "@/constants/themes";
import { AppStyle, APP_STYLES, DEFAULT_APP_STYLE_ID, getAppStyle, resolveAppStyleColors } from "@/constants/appStyles";
import { supabase } from "./AuthContext";

const LEGACY_THEME_KEY = "@p2p/theme";
const STYLE_KEY = "@p2p/appStyleId";
const MODE_KEY = "@p2p/appStyleMode";
const ILLUSTRATION_KEY = "@p2p/illustrationLevel";
const FAVORITES_KEY = "@p2p/appStyleFavorites";

export type AppearanceMode = "light" | "dark" | "system";
export type IllustrationLevel = "minimal" | "balanced" | "expressive";

interface ThemeContextValue {
  // Legacy API — unchanged shape, kept for any existing consumer.
  theme: ThemeName;
  colors: AppColors;
  setTheme: (t: ThemeName) => void;

  // App Style API
  styleId: string;
  style: AppStyle;
  mode: AppearanceMode;
  resolvedMode: "light" | "dark";
  illustrationLevel: IllustrationLevel;
  favorites: string[];
  setStyle: (id: string) => void;
  setMode: (m: AppearanceMode) => void;
  setIllustrationLevel: (l: IllustrationLevel) => void;
  toggleFavorite: (id: string) => void;
}

const defaultStyle = getAppStyle(DEFAULT_APP_STYLE_ID);

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  colors: THEMES.dark,
  setTheme: () => {},
  styleId: DEFAULT_APP_STYLE_ID,
  style: defaultStyle,
  mode: "dark",
  resolvedMode: "dark",
  illustrationLevel: "balanced",
  favorites: [],
  setStyle: () => {},
  setMode: () => {},
  setIllustrationLevel: () => {},
  toggleFavorite: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [styleId, setStyleId] = useState<string>(DEFAULT_APP_STYLE_ID);
  const [mode, setModeState] = useState<AppearanceMode>("system");
  const [illustrationLevel, setIllustrationLevelState] = useState<IllustrationLevel>("balanced");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const systemScheme = useColorScheme();

  // ── Load local preferences (instant, offline-first) ───────────────────────
  useEffect(() => {
    (async () => {
      const [savedStyle, savedMode, savedIllustration, savedFavorites, legacyTheme] = await Promise.all([
        AsyncStorage.getItem(STYLE_KEY),
        AsyncStorage.getItem(MODE_KEY),
        AsyncStorage.getItem(ILLUSTRATION_KEY),
        AsyncStorage.getItem(FAVORITES_KEY),
        AsyncStorage.getItem(LEGACY_THEME_KEY),
      ]);

      if (savedStyle && APP_STYLES.some((s) => s.id === savedStyle)) {
        setStyleId(savedStyle);
      } else if (legacyTheme && legacyTheme in THEMES) {
        // Migrate a pre-App-Style user: their existing single-palette theme
        // becomes the equivalent Original style, zero visual change.
        const migratedId = `original-${legacyTheme}`;
        setStyleId(migratedId);
        AsyncStorage.setItem(STYLE_KEY, migratedId);
      }
      if (savedMode === "light" || savedMode === "dark" || savedMode === "system") setModeState(savedMode);
      if (savedIllustration === "minimal" || savedIllustration === "balanced" || savedIllustration === "expressive") {
        setIllustrationLevelState(savedIllustration);
      }
      if (savedFavorites) {
        try { setFavorites(JSON.parse(savedFavorites)); } catch { /* ignore malformed cache */ }
      }
    })();
  }, []);

  // ── Cross-device sync via p2p_profiles (best-effort, additive columns) ────
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("p2p_profiles")
        .select("app_style_id,app_style_mode,app_style_illustration_level,app_style_favorites")
        .eq("id", userId)
        .maybeSingle();
      if (cancelled || !data) return;
      // The DB row is the cross-device source of truth once it has ever been
      // written; a device that has never synced (fresh install, existing
      // user) keeps whatever it already resolved locally above.
      if (data.app_style_id && APP_STYLES.some((s) => s.id === data.app_style_id)) {
        setStyleId(data.app_style_id as string);
        AsyncStorage.setItem(STYLE_KEY, data.app_style_id as string);
      }
      const dbMode = data.app_style_mode as string | null;
      if (dbMode === "light" || dbMode === "dark" || dbMode === "system") {
        setModeState(dbMode);
        AsyncStorage.setItem(MODE_KEY, dbMode);
      }
      const dbIllustration = data.app_style_illustration_level as string | null;
      if (dbIllustration === "minimal" || dbIllustration === "balanced" || dbIllustration === "expressive") {
        setIllustrationLevelState(dbIllustration);
        AsyncStorage.setItem(ILLUSTRATION_KEY, dbIllustration);
      }
      if (Array.isArray(data.app_style_favorites)) {
        setFavorites(data.app_style_favorites as string[]);
        AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(data.app_style_favorites));
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Best-effort push to the user's own profile row — never blocks the UI,
  // never surfaces an error (a failed sync just means the next device pull
  // won't see this change yet; local AsyncStorage already has it).
  const syncToProfile = useCallback((patch: Record<string, unknown>) => {
    if (!userId) return;
    supabase.from("p2p_profiles").update(patch).eq("id", userId).then(() => {}, () => {});
  }, [userId]);

  const setStyle = useCallback((id: string) => {
    if (!APP_STYLES.some((s) => s.id === id)) return;
    setStyleId(id);
    AsyncStorage.setItem(STYLE_KEY, id);
    syncToProfile({ app_style_id: id });
  }, [syncToProfile]);

  const setMode = useCallback((m: AppearanceMode) => {
    setModeState(m);
    AsyncStorage.setItem(MODE_KEY, m);
    syncToProfile({ app_style_mode: m });
  }, [syncToProfile]);

  const setIllustrationLevel = useCallback((l: IllustrationLevel) => {
    setIllustrationLevelState(l);
    AsyncStorage.setItem(ILLUSTRATION_KEY, l);
    syncToProfile({ app_style_illustration_level: l });
  }, [syncToProfile]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      syncToProfile({ app_style_favorites: next });
      return next;
    });
  }, [syncToProfile]);

  // Legacy setTheme — a direct-select of one of the 4 Original styles.
  const setTheme = useCallback((t: ThemeName) => setStyle(`original-${t}`), [setStyle]);

  const style = useMemo(() => getAppStyle(styleId), [styleId]);

  const resolvedMode: "light" | "dark" = style.isExisting
    ? (THEME_META[style.legacyThemeName].isDark ? "dark" : "light")
    : mode === "system"
      ? ((systemScheme ?? Appearance.getColorScheme() ?? "dark") === "dark" ? "dark" : "light")
      : mode;

  const colors = useMemo(() => resolveAppStyleColors(style, resolvedMode), [style, resolvedMode]);

  // Legacy `theme` field — meaningful only while an Original style is
  // active (which is exactly when any old consumer would care).
  const theme: ThemeName = style.isExisting ? style.legacyThemeName : (resolvedMode === "dark" ? "dark" : "light");

  return (
    <ThemeContext.Provider
      value={{
        theme, colors, setTheme,
        styleId, style, mode, resolvedMode, illustrationLevel, favorites,
        setStyle, setMode, setIllustrationLevel, toggleFavorite,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}