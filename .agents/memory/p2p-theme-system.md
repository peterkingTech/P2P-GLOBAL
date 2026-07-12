---
name: P2P Theme System
description: Architecture of the 4-theme system, migration pattern, and which screens are/aren't migrated.
---

## Core files
- `constants/themes.ts` — `AppColors` interface + 4 theme objects (light/dark/sepia/midnight) + `THEME_META` (labels, 4-color preview swatches, isDark flag)
- `contexts/ThemeContext.tsx` — `ThemeProvider` + `useTheme()` hook; persists to AsyncStorage key `@p2p/theme`; default = "light"
- `hooks/useColors.ts` — thin wrapper: `return useTheme().colors`
- `app/_layout.tsx` — `ThemeProvider` wraps `SafeAreaProvider` as the outermost provider

## Migration pattern
Every migrated screen uses **makeStyles(c: AppColors)** — a function that calls `StyleSheet.create({...})` — invoked inside each component:
```tsx
function makeStyles(c: AppColors) {
  return StyleSheet.create({ container: { backgroundColor: c.lightCream }, ... });
}
export default function MyScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  ...
}
```
Sub-components in the same file each call `useTheme()` and `makeStyles(colors)` independently.

## Fully migrated screens (theme-reactive)
- `app/(tabs)/index.tsx`
- `app/(tabs)/learn.tsx`
- `app/(tabs)/missions.tsx`
- `app/(tabs)/discover.tsx`
- `app/(tabs)/prayer.tsx` (CommentsPanel + PostCard + PrayerTab all migrated)
- `app/(tabs)/_layout.tsx` (tab bar colors)
- `app/profile.tsx` (includes Appearance section with 4-theme picker swatches)
- `app/lesson/[id].tsx` (TypeTabs/makeTabStyles + QuestionResponseCard/makeQStyles + LessonScreen/makeStyles)
- `app/settings.tsx` (SettingsSwitchRow + SettingsScreen)
- `app/module/[id].tsx`

## NOT yet migrated (use static light palette)
- `components/*` — Avatar, HelpButton, AudioRecorder, VideoRecorder, GrowthToast, ModuleCelebrationModal, GrowthVideoModal, ForestTransition, LivingTree, MediaPlayer
- `app/session/[id].tsx`, `app/messages/*`, `app/connect/*`
- `app/notes.tsx`, `app/highlights.tsx`
- `app/hall-of-faith.tsx`, `app/stages.tsx`, `app/living-tree.tsx`, `app/fruit.tsx`
- `app/(auth)/*`, `app/admin/*` — intentionally light-only

## AppColors token names (never rename these)
Key tokens: `lightCream` (bg), `card`, `cream`, `cardBeige`, `warmBeige`, `borderBeige`, `textDark`, `textMid`, `textMuted`, `textMutedLight`, `primaryGreen`, `accentGreen`, `lightGreen`, `amber`, `brightYellow`, `navBg`, `navBorder`, `darkBg`, `progressFill`, `progressTrack`, `upperRoom*` (prayer screen palette), `radius`

**Why:** makeStyles pattern avoids frozen module-level StyleSheet (which ignores theme changes). Each call to makeStyles(colors) is cheap — StyleSheet.create is idempotent in RN.
