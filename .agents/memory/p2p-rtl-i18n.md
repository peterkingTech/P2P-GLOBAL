---
name: P2P RTL & I18n Manager
description: Phase 6 RTL support — I18nManager setup, restart-on-toggle, style sweep plan
---

# P2P RTL Support (Phase 6)

## Core mechanism — `_layout.tsx` (AuthGate)
`I18nManager.forceRTL` + `I18nManager.allowRTL` are called in the `profile?.appLanguage` useEffect.
RTL languages: `ar`, `he`, `fa`, `ur` (matches `is_rtl=true` in `p2p_languages`).

Behavior:
- If `shouldBeRTL !== I18nManager.isRTL` → force RTL + show restart prompt.
- Web: `window.location.reload()` (immediate, seamless).
- Native: `Alert` asking user to restart manually. No `Updates.reloadAsync()` used (expo-updates not installed).
- RTL is driven by `appLanguage` (UI language), NOT `contentLanguage` — matches the separation already in DataContext.

**Why restart is needed:** React Native's `I18nManager` layout direction is read at startup. Toggling mid-session changes the flag but does not re-layout until the app process restarts.

## Style sweep (STILL NEEDED for full RTL visual correctness)
Physical props have NOT yet been replaced with logical props across screens.
When a user switches to Arabic/Hebrew, `marginLeft` will NOT auto-mirror.

Sweep target files:
- `app/(tabs)/index.tsx` (Home)
- `app/(tabs)/learn.tsx`
- `app/(tabs)/discover.tsx`
- `app/(tabs)/missions.tsx`
- `app/(tabs)/prayer.tsx`
- `app/module/[id].tsx` (ModuleDetailScreen)
- `app/lesson/[id].tsx` (LessonDetailScreen)
- Shared components: headers, cards, list items

Key replacements:
- `marginLeft/Right` → `marginStart/End`
- `paddingLeft/Right` → `paddingStart/End`
- `left/right` in absolute positioning → `start/end`
- `flexDirection: 'row'` auto-mirrors under I18nManager.isRTL — do NOT override with row-reverse

Icon mirror allowlist (only flip these):
- `arrow-back` / `arrow-forward` / chevrons → flip
- Checkmarks, play buttons, app logo → do NOT flip

LTR wrapper needed for:
- Scripture references (e.g. "John 3:16")
- Numerals / progress percentages
- URLs / email addresses
Use: `<Text style={{ writingDirection: 'ltr' }}>` or a `<View style={{ direction: 'ltr' }}>` wrapper.

## Note on LessonDetailScreen scripture references
The `verseRef` text ("— John 3:16 (KJV)") should be wrapped in an LTR container since it's a scripture ref + Western text.
