// The privacy reminder shown inside EVERY message composer (owner request 2026-11-11): chats (one-to-one,
// group, Family, Church, communities and their groups), P2P Mail (new letters, forwards and replies), Study
// Together discussions, Gathering and church-call chat, announcements and admin replies. NOT Contact P2P
// Global (owner, 2026-11-11): people may need to describe their situation to the support or crisis team.
//
// English: "Do not enter sensitive personal information" — translated through the app's own i18n
// (locales/*.json → messages.privacyPlaceholder; a language without it falls back to English).
//
// It is ONLY a placeholder: shown while the box is empty, gone as soon as someone types. It never
// checks, blocks, stores or sends anything differently. Not for search boxes, profile forms, lesson
// answers or assessments. New message composers: use `useMessagePlaceholder()` with
// `placeholderTextColor={colors.textMuted}` (readable in light and dark themes).
import { useTranslation } from "react-i18next";

export const MESSAGE_PRIVACY_KEY = "messages.privacyPlaceholder";
export const MESSAGE_PRIVACY_TEXT = "Do not enter sensitive personal information";

/** The localised privacy reminder for a message composer's empty input. */
export function useMessagePlaceholder(): string {
  const { t } = useTranslation();
  return t(MESSAGE_PRIVACY_KEY, { defaultValue: MESSAGE_PRIVACY_TEXT });
}
