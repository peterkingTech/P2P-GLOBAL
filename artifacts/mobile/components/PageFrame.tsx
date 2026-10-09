import React from "react";
import { View } from "react-native";
import { useLayout } from "@/hooks/useLayout";
import { useTheme } from "@/contexts/ThemeContext";
import fixedColors from "@/constants/colors";

// Wraps every root Stack screen (via the Stack's screenLayout) so screens that
// never had a tablet layout get the same fluid page column as the main tabs:
// the window width minus gutters on tablets, centered and capped on very wide
// windows (see pageContentWidth). Phones get the identical layout as before.
//
// The two views are ALWAYS rendered — only their styles change — so resizing
// a window across the tablet breakpoint (Split View, Stage Manager, foldables)
// never remounts the screen and loses its state.

// Routes that stay full-bleed: navigators with their own layout, screens that
// already size their own content, immersive/call screens, and screens whose
// page background is not the standard lightCream (a centered column there
// would show mismatched side bands).
const FULL_BLEED_ROUTES = new Set([
  "(tabs)", "(auth)", "admin",
  // own width handling
  "lesson/[id]", "plan/[id]", "living-tree", "missions/index", "plans/index",
  // immersive or non-standard page background
  "church/index", "church/join", "church/register", "completion",
  "family/worship/[sessionId]", "fruit", "fruit/[fruitKey]", "hall-of-faith",
  "prayer/build-confession", "prayer/journal", "prayer/sinners-prayer",
  "session/[id]", "write-completion-letter",
]);

// Screens whose page background is the fixed light cream from
// constants/colors (they don't follow the theme). Their margins use that same
// fixed colour so the column never sits between margins of a different
// theme colour. Their own content and design are unchanged.
const FIXED_LIGHT_BACKGROUND_ROUTES = new Set([
  "church/announcements", "church/call-summary", "church/calls", "church/cohorts", "church/create-cohort",
  "church/grove", "church/member-profile", "church/members", "church/settings/admins",
  "church/settings/announcements", "church/settings/branding", "church/settings/general",
  "church/settings/index", "church/settings/learning", "church/settings/privacy", "church/settings/profile",
  "church/settings/social-media", "church/studies/index", "church/studies/lesson/[lessonId]",
  "church/studies/[studyId]", "church/study-plans/[planId]", "confirmations", "connect/by-username",
  "connect/discover", "connect/group/[id]", "connect/index", "connect/smart-match", "curriculum/[id]",
  "curriculum", "elijah-response", "evaluations", "forest", "graduates", "highlights",
  "messages/contact-p2p", "messages/contact-thread/[messageId]", "messages/index",
  "messages/my-contact-messages", "messages/[id]", "module/[id]", "notes", "pastoral-alert",
  "peer-guide-requests", "stages",
]);

export function isFullBleedRoute(routeName: string): boolean {
  // Calls and Gatherings (incl. protected call screens) are never wrapped.
  return FULL_BLEED_ROUTES.has(routeName) || routeName.startsWith("call/");
}

export function PageFrame({ routeName, children }: { routeName: string; children: React.ReactNode }) {
  const { contentMaxWidth } = useLayout();
  const { colors } = useTheme();
  if (isFullBleedRoute(routeName)) return <>{children}</>;
  const framed = contentMaxWidth !== undefined;
  const marginColor = FIXED_LIGHT_BACKGROUND_ROUTES.has(routeName) ? fixedColors.lightCream : colors.lightCream;
  return (
    <View style={framed ? { flex: 1, backgroundColor: marginColor } : { flex: 1 }}>
      <View style={framed ? { flex: 1, width: "100%", maxWidth: contentMaxWidth, alignSelf: "center" } : { flex: 1 }}>
        {children}
      </View>
    </View>
  );
}
