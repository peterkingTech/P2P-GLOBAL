# P2P Global button system

One set of shared button parts for the whole app — `components/ui`
(colours and sizes: `lib/buttonTheme.ts`; one-action-at-a-time guard:
`lib/pressGuard.ts`). Preview every part in light and dark on localhost at
`/design/buttons` (development builds only).

| Part | Use for |
|---|---|
| `AppButton` variant `primary` | The main action on a screen (Continue Learning, Save Changes) |
| `AppButton` variant `secondary` | Important supporting actions (View Details, Study Together) |
| `AppButton` variant `tertiary` | Low-emphasis links (View All, Read More) |
| `AppButton` variant `outline` | Bounded neutral actions (Cancel, Edit) |
| `AppButton` variant `destructive` | Delete, Remove, Leave — keep the existing confirmation |
| `IconButton` `plain` / `tinted` / `overlay` | Icon actions; `overlay` over artwork or video. A label is required |
| `Chip` | A small action chip |
| `FilterChip` | On/off filters (`selection="multiple"` = checkbox, `"single"` = radio) |
| `SegmentedControl` | Choosing one of 2–5 related options |
| `CallControl` | Mute / camera / speaker / end in calls (presentation only) |

Sizes: `sm` 36 (still 44 to tap), `md` 44 (default), `lg` 52. Radius 10–12;
only chips are pill-shaped. Primary colour = the theme's green, never gold.

Rules: keep every `onPress` exactly as it was. If an action is a save, send,
join or submit, let `onPress` return its promise — the button then shows it
is busy and ignores repeat taps until it finishes (success or failure).

## Migration status (2026-10-29)

| | Count |
|---|---|
| `AppButton` in screens | 692 (312 primary, 178 outline, 102 secondary, 84 tertiary, 16 destructive; 82 large, 101 small) |
| `IconButton` | 71 |
| `FilterChip` / `SegmentedControl` | 3 / 2 (plus the Studio `Pill`, which is now a `FilterChip`) |
| Studio `Button` / `Pill` (wrappers over the shared parts) | 38 uses, all admin |
| Files using the shared parts | 228 |
| `TouchableOpacity` left (of 1,936) | 1,187 — see below; 847 now announce a button role |

How it was done: a converter turned each recognisable label / icon-label /
spinner-or-label button into `AppButton`, carrying every action prop across
unchanged (`onPress` — now also receiving the press event — `disabled`, labels,
hints, test ids, layout). Variant from the old fill: brand green → primary;
other solid fills → primary unless the words are low-emphasis (Dismiss, Close,
Cancel, Archive, Warn, Skip, Not now, Later, Retry → secondary); light tints →
secondary; border only → outline; nothing → tertiary; red → destructive only
for Delete / Remove / Leave / Block / Report / End / Revoke / Discard / Clear /
Deactivate / Reject / Restrict, otherwise outline (soft red) or primary (solid
red "Go Live"). Size from the old height. 795 old button styles left unused were
deleted (four still in use were restored).

Accessibility pass on what stayed `TouchableOpacity` (no visual change): 801
missing button roles, 153 spoken labels for icon-only buttons with an
unambiguous icon, 30 state-aware labels (Show/Hide password, Play/Pause,
Save/Remove from saved, Star, Move up/down, Expand/Collapse, Report…), and a
44-point invisible tap area (`hitSlop`) on 248 small icons. Every icon-only
tappable now has a spoken label (checked by `tests/buttonSystem.test.mjs`).
Symbol "icons" in labels (→ ✓ ✗ 📷 🎥 ✋) became real icons.

### What intentionally stays `TouchableOpacity`

- **Not buttons:** cards, list rows, menu rows, banners, tiles (icon over label
  or ≥ 60 tall), options, pickers, tabs and inline text links. They are
  tappable but keep their own design (the brief: don't turn rows, tabs or
  selectors into buttons).
- **Controls with extra behaviour:** long-press, selection state (toggles,
  radio/checkbox rows), dynamic or conditional styles, nested content (badges,
  avatars, two-line labels). Each needs a hand redesign, not a mechanical swap.
- **Small inline icons without a tap box (~230):** turning them into 36–44 pt
  icon buttons would shift layouts; they got labels, roles and `hitSlop`
  instead.
- **Filled circular icon buttons** (message Send, floating actions): the three
  `IconButton` looks can't reproduce a filled circle faithfully.
- **Calls:** `components/call/P2PControlButton` stays — it is already the
  shared call control, follows each call theme, and announces its state. The
  in-call study strip's mute/speaker/camera/end controls now say what they do.
  No Agora or call logic was touched.
- **In-call / Together panels** (church call, Scripture, chat, prayer, notes,
  study tabs, Add people, More): their colours come from the call palette
  passed in by the parent.
- **Celebration pop-ups** (`CategoryCompletionModal`, `FruitCelebrationModal`):
  the main button takes the celebrated category's colour by design.
- **Emoji reactions** in Messages: the emoji are the content; kept large.
- **Native alert pop-ups** (`Alert.alert`, 137 files): their buttons are drawn
  by the operating system and can't be restyled.

## Known exception: screens still in the fixed light palette

These screens draw with `@/constants/colors` (light only) and do not follow
the app's light/dark setting. Owner decision (2026-10-29, option A): their
buttons use `palette="fixedLight"` (or `<FixedLightButtons>`) so they stay
light like the screen. Making these screens theme-aware is a separate, future
task. Always-dark screens (calls, Together) use `palette="fixedDark"`.

Generated list (files importing `@/constants/colors` without `useTheme`):

- `app/(auth)/account-paused.tsx`
- `app/(auth)/forgot-password.tsx`
- `app/(auth)/goals-onboarding.tsx`
- `app/(auth)/intake.tsx`
- `app/(auth)/join/[username].tsx`
- `app/(auth)/journey.tsx`
- `app/(auth)/login.tsx`
- `app/(auth)/onboarding.tsx`
- `app/(auth)/profile-setup.tsx`
- `app/(auth)/register.tsx`
- `app/(auth)/reset-password.tsx`
- `app/(auth)/username-setup.tsx`
- `app/admin/_layout.tsx`
- `app/admin/appoint-admin.tsx`
- `app/admin/churches.tsx`
- `app/admin/content.tsx`
- `app/admin/curriculum.tsx`
- `app/admin/email-inbox.tsx`
- `app/admin/email-message/[messageId].tsx`
- `app/admin/help-mail/[helpRequestId].tsx`
- `app/admin/help-requests.tsx`
- `app/admin/index.tsx`
- `app/admin/kingdom-stories/[id].tsx`
- `app/admin/kingdom-stories/catalogue.tsx`
- `app/admin/kingdom-stories/collections.tsx`
- `app/admin/kingdom-stories/create.tsx`
- `app/admin/kingdom-stories/index.tsx`
- `app/admin/kingdom-stories/topics/[topicId].tsx`
- `app/admin/kingdom-stories/topics/index.tsx`
- `app/admin/kingdom-wins-review.tsx`
- `app/admin/login.tsx`
- `app/admin/moderation.tsx`
- `app/admin/recycle-bin.tsx`
- `app/admin/registrations.tsx`
- `app/admin/studio/_layout.tsx`
- `app/admin/studio/analytics.tsx`
- `app/admin/studio/audit.tsx`
- `app/admin/studio/calendar.tsx`
- `app/admin/studio/create.tsx`
- `app/admin/studio/distribution.tsx`
- `app/admin/studio/index.tsx`
- `app/admin/studio/library.tsx`
- `app/admin/studio/media.tsx`
- `app/admin/studio/review.tsx`
- `app/admin/studio/schedule.tsx`
- `app/admin/submit-report.tsx`
- `app/admin/team.tsx`
- `app/admin/translation-jobs.tsx`
- `app/admin/translation-review.tsx`
- `app/admin/translations.tsx`
- `app/admin/usernames.tsx`
- `app/admin/verification.tsx`
- `app/call/history.tsx`
- `app/church/announcements.tsx`
- `app/church/calls.tsx`
- `app/church/cohorts.tsx`
- `app/church/create-cohort.tsx`
- `app/church/grove.tsx`
- `app/church/index.tsx`
- `app/church/join.tsx`
- `app/church/member-profile.tsx`
- `app/church/members.tsx`
- `app/church/register.tsx`
- `app/church/settings/admins.tsx`
- `app/church/settings/announcements.tsx`
- `app/church/settings/branding.tsx`
- `app/church/settings/general.tsx`
- `app/church/settings/learning.tsx`
- `app/church/settings/privacy.tsx`
- `app/church/settings/profile.tsx`
- `app/church/settings/social-media.tsx`
- `app/church/studies/[studyId].tsx`
- `app/church/studies/index.tsx`
- `app/church/studies/lesson/[lessonId].tsx`
- `app/church/study-plans/[planId].tsx`
- `app/completion.tsx`
- `app/confirmations.tsx`
- `app/connect/by-username.tsx`
- `app/connect/discover.tsx`
- `app/connect/group/[id].tsx`
- `app/connect/groups.tsx`
- `app/connect/index.tsx`
- `app/connect/invite.tsx`
- `app/connect/smart-match.tsx`
- `app/curriculum.tsx`
- `app/curriculum/[id].tsx`
- `app/elijah-response.tsx`
- `app/evaluations.tsx`
- `app/forest.tsx`
- `app/graduates.tsx`
- `app/hall-of-faith.tsx`
- `app/highlights.tsx`
- `app/living-tree.tsx`
- `app/messages/[id].tsx`
- `app/messages/contact-p2p.tsx`
- `app/messages/contact-thread/[messageId].tsx`
- `app/messages/index.tsx`
- `app/messages/my-contact-messages.tsx`
- `app/module/[id].tsx`
- `app/notes.tsx`
- `app/pastoral-alert.tsx`
- `app/peer-guide-requests.tsx`
- `app/session/[id].tsx`
- `app/stages.tsx`
- `app/write-completion-letter.tsx`
- `components/AudioRecorder.tsx`
- `components/Avatar.tsx`
- `components/ChurchQRCode.tsx`
- `components/CircleSessionBanner.tsx`
- `components/ComposeMessageModal.tsx`
- `components/DateOfBirthInput.tsx`
- `components/DiscoveryRadiusSlider.tsx`
- `components/FamilyWorshipBanner.tsx`
- `components/ForestTransition.tsx`
- `components/GrowthToast.tsx`
- `components/GrowthVideoModal.tsx`
- `components/KingdomStoryMediaGallery.tsx`
- `components/KingdomStoryVideoPlayer.tsx`
- `components/KingdomWinVideoPlayer.tsx`
- `components/LivingTree.tsx`
- `components/MediaPlayer.tsx`
- `components/MessageBanner.tsx`
- `components/MessageInfoSheet.tsx`
- `components/MinistryRolePicker.tsx`
- `components/MissionVideoPlayer.tsx`
- `components/ModuleCelebrationModal.tsx`
- `components/PeerGuideRequestModal.tsx`
- `components/ReviewPrompts.tsx`
- `components/SignedPhotoView.tsx`
- `components/SkillsMultiSelect.tsx`
- `components/TestimonyVideoPlayer.tsx`
- `components/VideoRecorder.tsx`
- `components/VoiceMessageBubble.tsx`
- `components/admin/BlockEditorPanel.tsx`
- `components/admin/BlockRenderer.tsx`
- `components/admin/PdfImportModal.tsx`
- `components/admin/PlanCategoryManager.tsx`
- `components/family/SyncedMediaPlayer.tsx`
- `components/kingdom-stories/ChaptersEditor.tsx`
- `components/kingdom-stories/ImageSlots.tsx`
- `components/kingdom-stories/MediaDetailsEditor.tsx`
- `components/studio/StudioUI.tsx`
- `components/study/CustomLessonViewer.tsx`
- `components/tree/EnvironmentPicker.tsx`
- `components/tree/FruitDetailCard.tsx`
- `components/tree/TreeAccessibleSummary.tsx`
