import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Slot, useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const ADMIN_ROLES = new Set([
  "peer_guide",
  "church_leader",
  "regional_admin",
  "moderator",
  "super_admin",
]);

const NAV_ITEMS = [
  { label: "Curriculum", path: "/admin/curriculum", icon: "book" as const },
  { label: "Registrations", path: "/admin/registrations", icon: "people" as const },
];

export default function AdminLayout() {
  const { profile, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

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

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Top bar */}
      <View style={styles.topBar}>
        {/* Left: logo wordmark */}
        <View style={styles.topBarLeft}>
          <Ionicons name="shield-checkmark" size={15} color={colors.lightGreen} />
          <Text style={styles.topBarTitle}>Admin</Text>
        </View>

        {/* Centre: section tabs */}
        <View style={styles.topBarNav}>
          {NAV_ITEMS.map((item) => {
            const active = pathname.startsWith(item.path);
            return (
              <TouchableOpacity
                key={item.path}
                style={[styles.navTab, active && styles.navTabActive]}
                onPress={() => router.push(item.path as any)}
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
        </View>

        {/* Right: Exit Admin */}
        <TouchableOpacity
          style={styles.exitBtn}
          onPress={() => router.replace("/(tabs)")}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="exit-outline" size={15} color="rgba(255,255,255,0.6)" />
          <Text style={styles.exitBtnText}>Exit Admin</Text>
        </TouchableOpacity>
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
    paddingVertical: 10,
    gap: 8,
  },

  topBarLeft: {
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

  topBarNav: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
  },
  navTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  navTabActive: { backgroundColor: "rgba(255,255,255,0.18)" },
  navTabLabel: {
    fontSize: 13,
    color: "rgba(255,255,255,0.5)",
    fontFamily: "Inter_500Medium",
  },
  navTabLabelActive: { color: colors.cream },

  // Exit Admin button — right side, understated but visible
  exitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  exitBtnText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
    fontFamily: "Inter_500Medium",
  },

  body: { flex: 1 },
});
