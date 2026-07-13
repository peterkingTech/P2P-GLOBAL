import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppColors, THEMES, ThemeName } from "@/constants/themes";

const STORAGE_KEY = "@p2p/theme";

interface ThemeContextValue {
  theme: ThemeName;
  colors: AppColors;
  setTheme: (t: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  colors: THEMES.dark,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("dark");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved && saved in THEMES) setThemeState(saved as ThemeName);
    });
  }, []);

  function setTheme(t: ThemeName) {
    setThemeState(t);
    AsyncStorage.setItem(STORAGE_KEY, t);
  }

  return (
    <ThemeContext.Provider value={{ theme, colors: THEMES[theme], setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
