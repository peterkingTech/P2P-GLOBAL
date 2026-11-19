import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";
import { STUDIO_VIEW_ROLES } from "@/lib/studioModel";
import { IMPACT_REVIEWER_ROLES } from "@/lib/winsModerationModel";
import { AppButton } from "@/components/ui";
import { endAdminSession } from "@/lib/adminSession";
import { useAdminNotificationSummary } from "@/lib/adminNotificationsApi";

// Admin Centre notifications (2026-11-18): the bell (unread count) and each section's outstanding count. Both read
// ONE shared, live summary (lib/adminNotificationsApi — realtime with a polling fallback); the server decides which
// modules this administrator may see. Small and calm: a number, never an animation.
function NotificationBell() {
  const router = useRouter();
  const sum = useAdminNotificationSummary();
  const n = sum?.unread ?? 0;
  const critical = (sum?.critical ?? 0) > 0;
  return (
    <TouchableOpacity onPress={() => router.push("/admin/notifications" as any)} style={bellStyles.btn} accessibilityRole="button"
      accessibilityLabel={`Notifications${n ? `: ${n} unread` : ""}${critical ? `, ${sum!.critical} critical` : ""}`}>
      <Ionicons name={n ? "notifications" : "notifications-outline"} size={21} color={colors.cream} />
      {n ? <View style={[bellStyles.badge, critical && bellStyles.badgeCritical]}><Text style={bellStyles.badgeText}>{n > 99 ? "99+" : n}</Text></View> : null}
    </TouchableOpacity>
  );
}
function NavBadge({ path }: { path: string }) {
  const sum = useAdminNotificationSummary();
  const n = sum?.badges?.[path] ?? 0;
  if (!n) return null;
  return <View style={bellStyles.navBadge} accessibilityLabel={`${n} need attention`}><Text style={bellStyles.navBadgeText}>{n > 99 ? "99+" : n}</Text></View>;
}
const bellStyles = StyleSheet.create({
  btn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  badge: { position: "absolute", top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: "#F2C94C", alignItems: "center", justifyContent: "center" },
  badgeCritical: { backgroundColor: "#F97066" },
  badgeText: { fontSize: 10, color: "#1B1B1B", fontFamily: "Inter_700Bold" },
  navBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  navBadgeText: { fontSize: 11, color: "#fff", fontFamily: "Inter_700Bold" },
});
import { ADMIN_WIDE as WIDE } from "@/lib/adminLayout";

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
  { label: "Dashboard", path: "/admin", icon: "grid" as const, roles: Array.from(ADMIN_ROLES), section: "Overview" },
  { label: "Content", path: "/admin/content", icon: "library" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_content"], section: "Content" },
  { label: "Kingdom Stories", path: "/admin/kingdom-stories", icon: "book" as const, roles: ["super_admin", "admin_content"], section: "Content" },
  // Official Kingdom Stories narration (P2P Voices, 2026-11-18): OWNER ONLY — the API requires super_admin on every action.
  { label: "Story Narration", path: "/admin/narrations", icon: "mic" as const, roles: ["super_admin"], section: "Content" },
  // Bible licences (owner 2026-11-19): OWNER ONLY — the API requires super_admin (routes/bibleTranslationsAdmin).
  { label: "Bible Licences", path: "/admin/bible-licences", icon: "shield-checkmark" as const, roles: ["super_admin"], section: "Content" },
  // Publishing Studio — same role list as the API's STUDIO_VIEW_ROLES (display only; /api/studio enforces it).
  { label: "Publishing Studio", path: "/admin/studio", icon: "megaphone" as const, roles: STUDIO_VIEW_ROLES, section: "Content" },
  { label: "Registrations", path: "/admin/registrations", icon: "people" as const, roles: ["church_leader", "regional_admin", "super_admin"], section: "People & Communities" },
  { label: "Help Requests", path: "/admin/help-requests", icon: "medkit" as const, roles: ["peer_guide", "church_leader", "regional_admin", "moderator", "super_admin", "admin_help"], section: "Help & Support" },
  { label: "P2P Official Mail", path: "/admin/email-inbox", icon: "mail" as const, roles: ["admin_help", "admin_marketing", "super_admin"], section: "Help & Support" },
  { label: "Moderation", path: "/admin/moderation", icon: "flag" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_moderation"], section: "People & Communities" },
  // Kingdom Wins review (held posts, P2P Impact, posting restrictions) — the API's IMPACT_REVIEWER_ROLES (display only; enforced server-side).
  { label: "Kingdom Wins", path: "/admin/kingdom-wins-review", icon: "sparkles" as const, roles: IMPACT_REVIEWER_ROLES, section: "People & Communities" },
  { label: "Usernames", path: "/admin/usernames", icon: "at" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_username"], section: "People & Communities" },
  { label: "Verification", path: "/admin/verification", icon: "shield-checkmark" as const, roles: ["moderator", "church_leader", "regional_admin", "super_admin", "admin_verification"], section: "People & Communities" },
  { label: "Translations", path: "/admin/translations", icon: "language" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_translation"], section: "Content" },
  // Discipleship & Learning: the growth milestones, relationship corrections, and Peer Evaluation oversight (all checked on the server).
  { label: "Discipleship & Growth", path: "/admin/discipleship", icon: "leaf" as const, roles: ["super_admin", "admin_supervisor", "regional_admin", "admin_zone", "admin_national"], section: "Discipleship & Learning" },
  { label: "Peer Evaluations", path: "/evaluation/admin", icon: "checkmark-done" as const, roles: ["super_admin", "admin_supervisor"], section: "Discipleship & Learning" },
  // Platform: administrators, sessions, permissions and the append-only audit (migration 238).
  { label: "Access & Audit", path: "/admin/access", icon: "key" as const, roles: ["super_admin", "admin_supervisor"], section: "Platform" },
  { label: "Team", path: "/admin/team", icon: "people-circle" as const, roles: ["super_admin", "admin_supervisor"], section: "Platform" },
  // Admin Recycle Bin (migration 214) — the roles whose admin screens delete content (Kingdom School,
  // Kingdom Stories). The API lists only the types each role may restore and enforces it.
  { label: "Recycle Bin", path: "/admin/recycle-bin", icon: "trash" as const, roles: ["peer_guide", "church_leader", "regional_admin", "super_admin", "admin_content"], section: "Content" },
];

// The six areas of the Admin Centre, in order. Groupings only — each screen keeps its own server-side checks.
const SECTIONS = ["Overview", "People & Communities", "Discipleship & Learning", "Content", "Platform", "Help & Support"];

// RESPONSIVE ADMIN CENTRE (owner brief 2026-11-18 §10). One navigation, two layouts:
//   • desktop / wide tablet (≥ 1024 px): a fixed sidebar grouped by the six areas, the page beside it;
//   • phone / narrow tablet: a top bar with the current page and a Menu button that opens the same grouped
//     list as a drawer (no sideways-scrolling tab strip, nothing hidden off-screen).
// Roles, the sign-in gate and every screen's own server-side checks are unchanged.

export default function AdminLayout() {
  const { profile, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= WIDE;
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);

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

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(profile.role))
    .sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section));
  // The most specific item matching the current page ("/admin" matches every page).
  const active = visibleNav
    .filter((item) => pathname.startsWith(item.path))
    .sort((a, b) => b.path.length - a.path.length)[0] ?? null;
  const exit = async () => { await endAdminSession(); router.replace("/(tabs)"); };

  const navList = (
    <ScrollView contentContainerStyle={styles.navList}>
      {SECTIONS.map((section) => {
        const items = visibleNav.filter((i) => i.section === section);
        if (!items.length) return null;
        return (
          <View key={section} style={{ gap: 2 }}>
            <Text style={styles.navSection} accessibilityRole="header">{section}</Text>
            {items.map((item) => {
              const on = active?.path === item.path;
              return (
                <TouchableOpacity key={item.path} style={[styles.navItem, on && styles.navItemActive]} onPress={() => router.push(item.path as any)}
                  accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{ selected: on }} aria-selected={on}>
                  <Ionicons name={item.icon} size={17} color={on ? colors.cream : "rgba(255,255,255,0.65)"} />
                  <Text style={[styles.navLabel, on && styles.navLabelActive]} numberOfLines={1}>{item.label}</Text>
                  <NavBadge path={item.path} />
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );

  if (wide) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, flexDirection: "row" }]}>
        <View style={styles.sidebar}>
          <View style={styles.brand}>
            <Ionicons name="shield-checkmark" size={16} color={colors.lightGreen} />
            <Text style={[styles.brandText, { flex: 1 }]}>Admin Centre</Text>
            <NotificationBell />
          </View>
          {navList}
          <View style={styles.sidebarFoot}>
            <AppButton label="Exit Admin" onPress={exit} variant="outline" icon="exit-outline" palette="fixedLight" fullWidth />
          </View>
        </View>
        <View style={styles.body}><Slot /></View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(true)} accessibilityRole="button" accessibilityLabel="Open the admin menu" accessibilityState={{ expanded: menuOpen }}>
          <Ionicons name="menu" size={22} color={colors.cream} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.topKicker} numberOfLines={1}>Admin{active ? ` · ${active.section}` : ""}</Text>
          <Text style={styles.topTitle} numberOfLines={1} accessibilityRole="header">{active?.label ?? "Admin Centre"}</Text>
        </View>
        <NotificationBell />
        <AppButton label="Exit" onPress={exit} variant="outline" icon="exit-outline" size="sm" style={{ flexShrink: 0 }} palette="fixedLight" accessibilityLabel="Exit Admin" />
      </View>
      <View style={styles.body}><Slot /></View>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.drawerWrap}>
          <View style={[styles.drawer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8, width: Math.min(320, width * 0.86) }]} accessibilityViewIsModal>
            <View style={styles.brand}>
              <Ionicons name="shield-checkmark" size={16} color={colors.lightGreen} />
              <Text style={[styles.brandText, { flex: 1 }]}>Admin Centre</Text>
              <TouchableOpacity onPress={() => setMenuOpen(false)} style={styles.menuBtn} accessibilityRole="button" accessibilityLabel="Close the menu">
                <Ionicons name="close" size={22} color={colors.cream} />
              </TouchableOpacity>
            </View>
            {navList}
            <View style={styles.sidebarFoot}>
              <AppButton label="Exit Admin" onPress={exit} variant="outline" icon="exit-outline" palette="fixedLight" fullWidth />
            </View>
          </View>
          <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(false)} accessibilityRole="button" accessibilityLabel="Close the menu" />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.lightCream },
  sidebar: { width: 248, backgroundColor: colors.primaryGreen, paddingVertical: 10 },
  brand: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  brandText: { fontSize: 16, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  navList: { paddingHorizontal: 8, paddingBottom: 12, gap: 10 },
  navSection: { fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.6)", fontFamily: "Inter_600SemiBold", paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2 },
  navItem: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 10, borderRadius: 10 },
  navItemActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  navLabel: { flex: 1, fontSize: 14, color: "rgba(255,255,255,0.75)", fontFamily: "Inter_500Medium" },
  navLabelActive: { color: colors.cream, fontFamily: "Inter_700Bold" },
  sidebarFoot: { paddingHorizontal: 12, paddingTop: 8 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.primaryGreen, paddingHorizontal: 8, paddingVertical: 4, minHeight: 56 },
  menuBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  topKicker: { fontSize: 11, color: "rgba(255,255,255,0.65)", fontFamily: "Inter_500Medium" },
  topTitle: { fontSize: 16, color: colors.cream, fontFamily: "Inter_700Bold" },
  drawerWrap: { flex: 1, flexDirection: "row", backgroundColor: "rgba(0,0,0,0.45)" },
  drawer: { backgroundColor: colors.primaryGreen, height: "100%" },
  body: { flex: 1, minWidth: 0 },
});
