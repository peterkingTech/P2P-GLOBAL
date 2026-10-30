# Home-screen widgets and offline

## How it works

```
app (React Native)                                   phone home screen
DataContext + existing APIs ─┐
                             ├─ lib/widgetSnapshot.ts  (builds ONE JSON snapshot, version 1)
components/widgets/          │
  WidgetSyncHost.tsx ────────┘─ lib/widgetSync.ts ──► modules/p2p-widgets (native)
                                                        iOS:  App Group UserDefaults → WidgetKit extension
                                                              (plugins/withP2PWidgets.js + plugins/p2p-widgets/P2PWidgets.swift)
                                                        Android: SharedPreferences → AppWidgetProviders
                                                              (modules/p2p-widgets/android, shared card layout)
```

- **The widgets never fetch anything.** They show the last snapshot the app wrote.
- **What works offline:** the greeting (time of day) and the verse of the day (`constants/dailyVerses`, rule: day of month % list length, same as Home) are worked out on the phone.
- **Old data:** everything else is the last synchronised data, marked "may be out of date" after 24 hours.
- **When the app writes:**
  - on sign-in;
  - when it returns to the foreground (network data at most every 15 minutes);
  - when loaded data or widget settings change.
- **Write only on change:** the app compares against the last snapshot first, and signing out clears it.

## Sources of truth (nothing duplicated)

| Widget data | Comes from |
|---|---|
| Current lesson / Kingdom School | `lib/learningHome.currentModule` over DataContext `modules` |
| Core Curriculum progress | finished modules ÷ modules with lessons (the counts Kingdom School shows) |
| Learning Plans | `p2p_plan_enrollments` (not completed) + DataContext `plans` titles |
| Kingdom Stories | `lib/learningHome.isStoryInProgress` over `GET /kingdom-stories/discover` |
| My Learning (Comprehensive Checks) | `GET /learning/centre/overview` — counts only |
| Study Together | `GET /study-together/mine` (active) |
| Upcoming Gathering | `GET /churches/:id/calls` (upcoming) — church only; family Gatherings aren't scheduled ahead |
| Bible (continue reading) | `lib/bibleReadingPrefs` (this phone) |

## Privacy

- **Never in the snapshot:** journal text, prayer requests, messages, answers, feedback, tokens or account ids.
- **Group names:** family and church names and Gathering details appear only with "Community details" on (default off).
- **Lock Screen (iOS):** shows generic text unless "Details on the Lock Screen" is on.
- **Signed out:** widgets show "Open P2P Global" and nothing personal.

## Reminders (`lib/dailyReminders.ts`)

Local daily notifications, fired by the phone so they work offline:

| Reminder | Set in | When | Opens |
|---|---|---|---|
| Morning confession | Settings → Prayer (profile) | Chosen time | `/prayer/build-confession` |
| Prayer journal | Settings → Prayer (profile) | 20:00 | `/prayer/journal` |
| Discipleship Journal | Settings → Widgets & Offline (this phone) | Chosen time | `/my-discipleship/journal` |

The two Prayer switches existed before but nothing scheduled them. Taps only open the allowed screens listed in `lib/push.ts`.

## Not built (and why)

- **Bible reading plans (weekly, monthly, yearly):** no reading plan exists in P2P yet (see `app/bible-study/index.tsx`).
- **Scripture by topic, and verses in other translations:** they would need licensed Bible text stored on the device, which the licence arrangement doesn't cover. The verse widget uses P2P's own verse list.
- **My Discipleship Journey widget:** there is no single "next step" source to show; the Journal reminder and Progress widget cover it for now.

## Building

- **Native code:** compiled only by EAS. This repo's machine has no Xcode or Android SDK.
- **iOS, first build after this change:** must be an **interactive** `eas build`, because the new `P2PWidgets` extension target needs a provisioning profile and the app and extension need the App Group capability. After that, builds can be non-interactive.
- **Skip the iOS widgets for a build:** `P2P_IOS_WIDGETS=0`.
- **Android:** no extra signing is needed.
- **Tests:** `tests/widgets.test.mjs` (in `test:release`). The iOS target wiring was also checked against Expo's blank iOS template with node-xcode (harness in the session notes).
