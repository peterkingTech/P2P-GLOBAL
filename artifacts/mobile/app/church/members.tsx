import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Alert } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchMember, ChurchRole } from "@/contexts/DataContext";
import colors from "@/constants/colors";
import { churchRoleLabel, ASSIGNABLE_CHURCH_ROLES } from "@/constants/churchRoles";

const STAGE_LABELS: Record<string, string> = {
  dormant_seed: "Seed", sprout: "Sprout", young_tree: "Young Tree",
  fruitful_tree: "Fruitful Tree 🌳", forest_builder: "Forest Builder 🌲", forest_of_nations: "Forest of Nations 🌍",
};

export default function ChurchMembersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, userChurchRole, getChurchMembers, removeChurchMember, updateMemberRole } = useData();
  const [members, setMembers] = useState<ChurchMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const canChangeRoles = userChurchRole === "senior_pastor";

  const load = useCallback(async (q?: string) => {
    if (!userChurch) return;
    setLoading(true);
    const data = await getChurchMembers(userChurch.id, q);
    setMembers(data);
    setLoading(false);
  }, [userChurch, getChurchMembers]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function handleChangeRole(member: ChurchMember) {
    if (!userChurch) return;
    Alert.alert(`Change ${member.displayName ?? "member"}'s role`, undefined, [
      ...ASSIGNABLE_CHURCH_ROLES.map((role) => ({
        text: churchRoleLabel(role) + (role === member.role ? " (current)" : ""),
        onPress: async () => {
          if (role === member.role) return;
          const err = await updateMemberRole(userChurch.id, member.userId, role as ChurchRole);
          if (err) Alert.alert("Couldn't change role", err);
          else load(search);
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }

  function handleMenu(member: ChurchMember) {
    if (!member.visible || !userChurch) return;
    Alert.alert(member.displayName ?? "Member", undefined, [
      { text: "View Profile", onPress: () => router.push({ pathname: "/church/member-profile", params: { userId: member.userId } } as any) },
      ...(canChangeRoles && member.role !== "senior_pastor" ? [{ text: "Change Role", onPress: () => handleChangeRole(member) }] : []),
      {
        text: "Remove from Church", style: "destructive" as const,
        onPress: () => Alert.alert("Remove member?", `Remove ${member.displayName} from ${userChurch.name}?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove", style: "destructive",
            onPress: async () => {
              const err = await removeChurchMember(userChurch.id, member.userId);
              if (err) Alert.alert("Couldn't remove member", err);
              else load(search);
            },
          },
        ]),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title}>Members ({members.length})</Text>
        <View style={{ width: 22 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => load(search)}
          placeholder="Search by name or username"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(m) => m.userId}
          contentContainerStyle={{ padding: 16, gap: 8 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No members found.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              onPress={() => item.visible && router.push({ pathname: "/church/member-profile", params: { userId: item.userId } } as any)}
              onLongPress={() => handleMenu(item)}
            >
              <View style={styles.avatarCircle}><Ionicons name="person" size={18} color={colors.primaryGreen} /></View>
              <View style={{ flex: 1 }}>
                {item.visible ? (
                  <>
                    <View style={styles.nameRow}>
                      <Text style={styles.rowName}>@{item.username ?? "unknown"}</Text>
                      {item.role !== "member" && <Text style={styles.roleBadge}>{churchRoleLabel(item.role)}</Text>}
                    </View>
                    <Text style={styles.rowSub}>{item.displayName} {item.country ? `· ${item.country}` : ""}</Text>
                    <Text style={styles.rowSub}>{STAGE_LABELS[item.treeStage ?? ""] ?? item.treeStage}</Text>
                    <Text style={styles.rowMeta}>
                      {item.lastActiveAt ? `Active ${new Date(item.lastActiveAt).toLocaleDateString()}` : "No activity yet"}
                      {" · "}{item.hasPeerGuide ? "Peer guide ✓" : "No peer guide ⚠️"}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.rowName}>[Anonymous member]</Text>
                    <Text style={styles.rowSub}>Profile hidden from leadership</Text>
                  </>
                )}
              </View>
              {item.visible && <TouchableOpacity onPress={() => handleMenu(item)}><Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} /></TouchableOpacity>}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 17, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.textDark, fontFamily: "Inter_400Regular" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  row: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 12,
  },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(29,158,117,0.12)", alignItems: "center", justifyContent: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowName: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  roleBadge: {
    fontSize: 10, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold",
    backgroundColor: "rgba(29,158,117,0.12)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  rowSub: { fontSize: 12, color: colors.textMid, marginTop: 1, fontFamily: "Inter_400Regular" },
  rowMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
});