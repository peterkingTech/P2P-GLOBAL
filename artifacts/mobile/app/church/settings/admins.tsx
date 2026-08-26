import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchMember } from "@/contexts/DataContext";
import colors from "@/constants/colors";

// Church Portal — General Overseer's Church Admin management screen.
// "Church Admin" here means p2p_church_members.role IN (discipleship_pastor,
// small_group_leader) — the same tier constants/churchRoles.ts already
// labels "Church Admin" everywhere else in the app. Promotion/removal both
// reuse the existing updateMemberRole/removeChurchMember endpoints (now
// creator-only server-side, see churches.ts) rather than a new invitation
// workflow — the target is always an existing church member, so there's no
// pending/accepted state to track.
const CHURCH_ADMIN_ROLES = ["discipleship_pastor", "small_group_leader"];

export default function ChurchAdminsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchCreator, getChurchMembers, updateMemberRole, removeChurchMember } = useData();
  const [members, setMembers] = useState<ChurchMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    setMembers(await getChurchMembers(userChurch.id));
    setLoading(false);
  }, [userChurch, getChurchMembers]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!userChurch) return null;

  const overseer = members.find((m) => m.userId === userChurch.createdBy);
  const admins = members.filter((m) => CHURCH_ADMIN_ROLES.includes(m.role) && m.userId !== userChurch.createdBy);
  const promotable = members.filter((m) => !CHURCH_ADMIN_ROLES.includes(m.role) && m.userId !== userChurch.createdBy && m.visible);

  async function handlePromote(member: ChurchMember) {
    if (!userChurch) return;
    Alert.alert(
      `Make ${member.displayName ?? "this member"} a Church Admin?`,
      "They'll be able to manage members, cohorts, announcements, and learning goals for this church.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Make Church Admin",
          onPress: async () => {
            setBusyId(member.userId);
            const error = await updateMemberRole(userChurch.id, member.userId, "discipleship_pastor");
            setBusyId(null);
            if (error) Alert.alert("Couldn't update role", error);
            else load();
          },
        },
      ]
    );
  }

  function handleAddAdmin() {
    if (!promotable.length) {
      Alert.alert("No members available", "Every visible member is already a Church Admin, or no members have joined yet.");
      return;
    }
    Alert.alert(
      "Add Church Admin",
      "Choose a member to promote",
      [
        ...promotable.slice(0, 10).map((m) => ({ text: m.displayName ?? m.username ?? "Member", onPress: () => handlePromote(m) })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }

  async function handleRemoveAdmin(member: ChurchMember) {
    if (!userChurch) return;
    const confirmed = Platform.OS === "web"
      ? window.confirm(`Remove ${member.displayName ?? "this admin"}'s Church Admin access? They will remain a regular member.`)
      : await new Promise<boolean>((resolve) => {
          Alert.alert(
            "Remove Church Admin access?",
            `${member.displayName ?? "This admin"} will remain a regular member.`,
            [
              { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
              { text: "Remove", style: "destructive", onPress: () => resolve(true) },
            ]
          );
        });
    if (!confirmed) return;
    setBusyId(member.userId);
    const error = await updateMemberRole(userChurch.id, member.userId, "member");
    setBusyId(null);
    if (error) Alert.alert("Couldn't remove admin access", error);
    else load();
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 40 : 16) }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Church Admins</Text>
      </View>

      {!isChurchCreator && (
        <View style={styles.lockBanner}>
          <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
          <Text style={styles.lockBannerText}>Only the General Overseer can manage Church Admins.</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>General Overseer</Text>
          {overseer ? (
            <View style={styles.row}>
              <View style={styles.avatar}><Ionicons name="star" size={18} color="#D97706" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{overseer.displayName ?? "@" + (overseer.username ?? "unknown")}</Text>
                <Text style={styles.rowSub}>Founded this church · cannot be removed or reassigned here</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.emptyInlineText}>Founder's profile is hidden.</Text>
          )}

          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Church Admins ({admins.length})</Text>
            {isChurchCreator && (
              <TouchableOpacity style={styles.addBtn} onPress={handleAddAdmin}>
                <Ionicons name="add" size={16} color={colors.accentGreen} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>

          {admins.length === 0 ? (
            <Text style={styles.emptyInlineText}>No Church Admins yet. Only the General Overseer manages church-wide settings.</Text>
          ) : (
            admins.map((m) => (
              <View key={m.userId} style={styles.row}>
                <View style={styles.avatar}><Ionicons name="shield-checkmark" size={18} color={colors.accentGreen} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{m.visible ? (m.displayName ?? "@" + (m.username ?? "unknown")) : "[Anonymous member]"}</Text>
                  <Text style={styles.rowSub}>{m.role === "discipleship_pastor" ? "Discipleship Pastor" : "Small Group Leader"}</Text>
                </View>
                {isChurchCreator && (
                  <TouchableOpacity onPress={() => handleRemoveAdmin(m)} disabled={busyId === m.userId}>
                    <Text style={styles.removeLink}>{busyId === m.userId ? "…" : "Remove"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  lockBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 10, padding: 12, margin: 16, marginBottom: 0,
  },
  lockBannerText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  content: { padding: 20, paddingBottom: 60 },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.4, fontFamily: "Inter_700Bold" },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  addBtnText: { color: colors.accentGreen, fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, marginTop: 10,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(29,158,117,0.1)", alignItems: "center", justifyContent: "center" },
  rowName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  removeLink: { color: "#DC2626", fontSize: 13, fontWeight: "700", fontFamily: "Inter_700Bold" },
  emptyInlineText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 10, lineHeight: 19 },
});