import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STUDIO_VIEW_ROLES } from "@/lib/studioModel";
import { IMPACT_REVIEWER_ROLES } from "@/lib/winsModerationModel";
import { AppButton } from "@/components/ui";

const ADMIN_ROLES = new Set([
  "peer_guide",
  "church_leader",
  "regional_admin",
  "moderator",
  "super_admin",
  // Admin hierarchy roles (migration 069) — additive; none of the six above
  // are removed or renamed.
  "admin_supervisor",
  "admin_zone",
  "admin_national",
  "admin_content",
  "admin_translation",
  "admin_moderation",
  "admin_verification",
  "admin_help",
  "admin_username",
  "admin_finance",
  "admin_marketing",
  "admin_church",
]);

const NAV_ITEMS = [
  { label: "Dashboard", path: "/admin", icon: "grid" as const, roles: Array.from(ADMIN_ROLES) },
  { label: "Content", path: "/admin/content", icon: "library" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_content"] },
  { label: "Kingdom Stories", path: "/admin/kingdom-stories", icon: "book" as const, roles: ["super_admin", "admin_content"] },
  // Publishing Studio — same role list as the API's STUDIO_VIEW_ROLES (display only; /api/studio enforces it).
  { label: "Publishing Studio", path: "/admin/studio", icon: "megaphone" as const, roles: STUDIO_VIEW_ROLES },
  { label: "Registrations", path: "/admin/registrations", icon: "people" as const, roles: ["church_leader", "regional_admin", "super_admin"] },
  { label: "Help Requests", path: "/admin/help-requests", icon: "medkit" as const, roles: ["peer_guide", "church_leader", "regional_admin", "moderator", "super_admin", "admin_help"] },
  { label: "P2P Official Mail", path: "/admin/email-inbox", icon: "mail" as const, roles: ["admin_help", "admin_marketing", "super_admin"] },
  { label: "Moderation", path: "/admin/moderation", icon: "flag" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_moderation"] },
  // Kingdom Wins review (held posts, P2P Impact, posting restrictions) — the API's IMPACT_REVIEWER_ROLES (display only; enforced server-side).
  { label: "Kingdom Wins", path: "/admin/kingdom-wins-review", icon: "sparkles" as const, roles: IMPACT_REVIEWER_ROLES },
  { label: "Usernames", path: "/admin/usernames", icon: "at" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_username"] },
  { label: "Verification", path: "/admin/verification", icon: "shield-checkmark" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_verification"] },
  { label: "Translations", path: "/admin/translations", icon: "language" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_translation"] },
  { label: "Team", path: "/admin/team", icon: "people-circle" as const, roles: ["super_admin", "admin_supervisor"] },
  // Admin Recycle Bin (migration 214) — the roles whose admin screens delete content (Kingdom School,
  // Kingdom Stories). The API lists only the types each role may restore and enforces it.
  { label: "Recycle Bin", path: "/admin/recycle-bin", icon: "trash" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_content"] },
];

export default function AdminLayout() {
  const { profile, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  // The tab row scrolls sideways when it is wider than the screen (phones, or
  // roles with many tabs); keep the active tab in view after navigating.
  const navScroll = useRef<ScrollView>(null);
  const tabX = useRef<Record<string, number>>({});
  const activeTabPath = useRef<string | null>(null);
  const scrollToActive = () => {
    const p = activeTabPath.current;
    const x = p ? tabX.current[p] : undefined;
    if (x !== undefined) navScroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  };
  useEffect(() => { scrollToActive(); }, [pathname]);

  const isLoginScreen = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginScreen) return; // login screen manages its own auth state
    if (isLoading) return;

    if (!isAuthenticated) {
      // Not logged in → send to admin login (not the regular app)
      router.replace("/admin/login");
      return;
    }

    if (profile && !ADMIN_ROLES.has(profile.role)) {
      // Authenticated but no admin role → back to regular app
      router.replace("/(tabs)");
    }
  }, [isLoading, isAuthenticated, profile, isLoginScreen]);

  // ── Admin login screen: no chrome, just render the page ──────────────────

  if (isLoginScreen) {
    return (
      <View style={{ flex: 1, backgroundColor: "#05100C" }}>
        <Slot />
      </View>
    );
  }

  // ── Loading / role-check gate ─────────────────────────────────────────────

  if (isLoading || !profile) return null;
  if (!ADMIN_ROLES.has(profile.role)) return null;

  // ── Admin shell ───────────────────────────────────────────────────────────

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(profile.role));
  // The most specific tab matching the current page ("/admin" matches every page).
  activeTabPath.current = visibleNav
    .filter((item) => pathname.startsWith(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0]?.path ?? null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        {/* Left: logo wordmark */}
        <View style={styles.topBarLeft}>
          <Ionicons name="shield-checkmark" size={15} color={colors.lightGreen} />
          <Text style={styles.topBarTitle}>Admin</Text>
        </View>

        {/* Centre: section tabs — scroll sideways when they don't fit, so they
            never run underneath the Admin title or the Exit Admin button. */}
        <ScrollView
          ref={navScroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topBarNav}
          contentContainerStyle={styles.topBarNavContent}
        >
          {visibleNav.map((item) => {
            const active = pathname.startsWith(item.path);
            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navTab, active && styles.navTabActive]}
                onPress={() => router.push(item.path as any)}
                onLayout={(e) => {
                  tabX.current[item.path] = e.nativeEvent.layout.x;
                  if (item.path === activeTabPath.current) scrollToActive();
                }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: active }}
                aria-selected={active}
              >
                <Ionicons
                  name={item.icon}
                  size={14}
                  color={active ? colors.cream : "rgba(255,255,255,0.5)"}
                />
                <Text style={[styles.navTabLabel, active && styles.navTabLabelActive]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Right: Exit Admin */}
        <AppButton label="Exit Admin" onPress={() => router.replace("/(tabs)")} variant="outline" icon="exit-outline" style={{ flexShrink: 0 }} palette="fixedLight" />
      </View>

      {/* Page content */}
      <View style={styles.body}>
        <Slot />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryGreen,
    paddingHorizontal: 14,
    paddingVertical: 4,
    gap: 8,
  },

  topBarLeft: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginRight: 4,
  },
  topBarTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.cream,
    fontFamily: "Inter_700Bold",
  },

  // Takes the space between the title and Exit Admin and may shrink below
  // its content width; the content then scrolls instead of overflowing.
  topBarNav: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  // flexGrow keeps the tabs centred when they fit (desktop, few tabs).
  topBarNavContent: {
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    justifyContent: "center",
  },
  // 44px tall: a full-size touch target (the bar's own padding was reduced).
  navTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    minHeight: 44,
    borderRadius: 8,
  },
  navTabActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  navTabLabel: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Inter_500Medium",
  },
  navTabLabelActive: { color: colors.cream },

  body: { flex: 1 },
});
