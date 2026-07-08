import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/contexts/AuthContext";
import colors from "@/constants/colors";

const GIFT_LABELS: Record<string, string> = {
  teaching: "Teaching",
  evangelism: "Evangelism",
  mercy: "Mercy",
  leadership: "Leadership",
  intercession: "Intercession",
  hospitality: "Hospitality",
  giving: "Giving",
  prophecy: "Prophecy",
};

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, signOut } = useAuth();

  async function handleSignOut() {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar & Name */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {profile?.displayName?.charAt(0)?.toUpperCase() ?? "?"}
            </Text>
          </View>
          <Text style={styles.displayName}>{profile?.displayName ?? "Anonymous"}</Text>
          <Text style={styles.email}>{profile?.email ?? ""}</Text>

          <View style={styles.locationRow}>
            {profile?.city && <Text style={styles.locationText}>{profile.city}</Text>}
            {profile?.city && profile?.country && <Text style={styles.locationText}> · </Text>}
            {profile?.country && <Text style={styles.locationText}>{profile.country}</Text>}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.growthLevel ?? 0}</Text>
            <Text style={styles.statLabel}>Growth Level</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.role ?? "student"}</Text>
            <Text style={styles.statLabel}>Role</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.gifts?.length ?? 0}</Text>
            <Text style={styles.statLabel}>Gifts</Text>
          </View>
        </View>

        {/* Spiritual Gifts */}
        {profile?.gifts && profile.gifts.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Spiritual Gifts</Text>
            <View style={styles.giftsRow}>
              {profile.gifts.map((gift) => (
                <View key={gift} style={styles.giftChip}>
                  <Text style={styles.giftChipText}>{GIFT_LABELS[gift] ?? gift}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Settings */}
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.settingsList}>
          {[
            { icon: "create-outline", label: "Edit Profile" },
            { icon: "notifications-outline", label: "Notifications" },
            { icon: "language-outline", label: "Language" },
            { icon: "shield-outline", label: "Privacy" },
          ].map((item) => (
            <TouchableOpacity key={item.label} style={styles.settingsRow} activeOpacity={0.8}>
              <Ionicons name={item.icon as any} size={20} color={colors.textMid} />
              <Text style={styles.settingsLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.borderBeige} />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={18} color="#B91C1C" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  avatarSection: { alignItems: "center", marginBottom: 24 },
  avatarCircle: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(29,158,117,0.15)",
    borderWidth: 3, borderColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  avatarInitial: { fontSize: 32, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  displayName: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" },
  locationRow: { flexDirection: "row", marginTop: 6 },
  locationText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_400Regular" },
  statsCard: {
    flexDirection: "row",
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 28, justifyContent: "space-around", alignItems: "center",
  },
  statItem: { alignItems: "center" },
  statNum: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1, height: 32, backgroundColor: colors.borderBeige },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 },
  giftsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 28 },
  giftChip: {
    backgroundColor: "rgba(29,158,117,0.1)",
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(29,158,117,0.25)",
  },
  giftChipText: { fontSize: 13, color: colors.accentGreen, fontFamily: "Inter_500Medium" },
  settingsList: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    overflow: "hidden", marginBottom: 24,
  },
  settingsRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  settingsLabel: { flex: 1, fontSize: 15, color: colors.textDark, fontFamily: "Inter_400Regular" },
  signOutBtn: {
    flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(185,28,28,0.08)",
    borderRadius: 14, borderWidth: 1, borderColor: "rgba(185,28,28,0.2)",
    height: 48,
  },
  signOutText: { fontSize: 15, color: "#B91C1C", fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});
