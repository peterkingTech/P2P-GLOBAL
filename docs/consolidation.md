# One implementation per job (pre-launch consolidation, 2026-10-30)

Use these instead of writing a local copy. `tests/consolidation.test.mjs`
(part of `npm run test:release`) checks the behaviour of each and fails if a
copy comes back.

| Job | Use | Notes |
|---|---|---|
| Alert / confirm dialog | `lib/alerts` — `showAlert`, `confirmAction` | Works on web too (React Native's `Alert` does nothing there). Multi-option dialogs (3+ buttons, settings links) still use `Alert.alert` directly. |
| "5m ago", clocks, durations, dates | `lib/timeFormat` | Each wording is a named style (`ago`, `compact`, `days`, `long`; `minSec`, `hourMin`, `words`; `long`, `medium`, `todayTime`, `dateTime`). |
| Calling the API | `lib/apiClient` — `apiRequest` (JSON), `apiFetch` (raw), `accessToken` | Features pass a base path, fallback message, offline message or their own error class. Never build an `Authorization` header by hand. |
| Family / Church studies and plans | `lib/communityStudyApi` + `components/community/*` with `scope="family" \| "church"` | Who may manage, the API prefix and family-only features (study source) are decided by `scope`; the server enforces all of it. |
| Video (private buckets) | `components/media/VideoPlayer` with the feature's `resolveUrl` | |
| Profile picture | `components/Avatar` | Falls back to the initial or a `fallbackIcon`. |
| Content picture with fallback | `components/media/ContentImage` | Module, curriculum and plan artwork. Never forced into a circle. |
| Story form photo / video | `components/story/StoryMedia` (`useStoryMedia`, `StoryMediaField`, `uploadStoryMedia`) | Each feature keeps its own bucket, upload function, record and moderation. |
| Scripture typed into a form | `lib/scriptureInput` — `scriptureReferenceIdFor` | |
| "What to continue next" | `lib/learningHome` — `currentModule`, `isStoryInProgress`, `continueItems` | Community pages keep the server's group-chosen next lesson. |
| A way into Study Together | `components/learning/StudyTogetherLink` | |
| Call "No answer" result | `components/call/CallNoAnswerView` | Presentation only; call logic stays in each call screen. |
| Data shapes | `contexts/data/learningModel.ts`, `contexts/data/types.ts` | Re-exported by `@/contexts/DataContext`. |

## One destination per feature

- Kingdom School's Foundations: `/kingdom-school` (`/curriculum` redirects there; a journey's own page is `/curriculum/[id]`).
- Bible Reader, Notes and Highlights: Bible Study (`/bible-study`). Lessons keep their in-context Scripture actions.
- Appearance (mode, App Style, decoration): `/settings/appearance` (`/settings/app-style` and `/settings/style-details` redirect).
- Finding people and groups: the Discover tab (`/connect` redirects there). Circles and Groups are different things and stay separate.
- Communities: `/community` (My Community) → each family, the church, Gatherings, community Learning, Study Together.
- Old routes kept as redirects: `/messages` (index) → Messages tab, `/family/calls` → that family's Members, `/hall-of-faith` → Graduates (it showed made-up people), `/session/[id]` → My Discipleship.

## Deliberately not merged

- Prayer Journal and the Discipleship Journal: different records; the Discipleship Journal already shows prayer entries under "Prayers".
- Kingdom Wins, Mission stories and prayer testimonies: separate records, privacy and moderation — only the form parts are shared.
- Audio and video call logic (Agora events, reconnect timers, call state): the duplicated parts are timing-sensitive and need real-device call testing before they are merged.
- The DataContext provider body (~4,900 lines): one provider holding shared state; splitting it into per-domain hooks changes re-render behaviour across the app and needs its own tested pass.
- Screens still drawn with the fixed light palette (`@/constants/colors`): see `docs/button-system.md`. Every screen created or merged in this pass follows the theme.

## Needs approval (database)

Study Together can't yet include Bible-passage studies or scheduled gatherings:
both need migration `219_study_together_schedule.sql` (drafted, not applied).
