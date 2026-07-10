import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, PeerGroup } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function Groups() {
  const insets = useSafeAreaInsets();
  const { getGroups, joinGroup, leaveGroup } = useData();
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setGroups(await getGroups());
    setLoading(false);
  }, [getGroups]);

  useEffect(() => { load(); }, [load]);

  async function toggleMembership(g: PeerGroup) {
    setBusyId(g.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const err = g.isMember ? await leaveGroup(g.id) : await joinGroup(g.id);
    if (!err) await load();
    setBusyId(null);
  }

  return (
    <>
      <Stack.Screen options={{ title: "Join a Group" }} />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 60 }} color={colors.primaryGreen} />
      ) : (
        <FlatList
          style={styles.container}
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 60 }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="people-circle-outline" size={32} color={colors.textMuted} />
              <Text style={styles.emptyText}>No groups have been created yet.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardIcon}>
                <Ionicons name="people" size={20} color={colors.accentGreen} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                {!!item.description && <Text style={styles.desc}>{item.description}</Text>}
                <Text style={styles.meta}>{item.memberCount} member{item.memberCount === 1 ? "" : "s"}</Text>
              </View>
              <TouchableOpacity
                style={[styles.joinBtn, item.isMember && styles.leaveBtn]}
                onPress={() => toggleMembership(item)}
                disabled={busyId === item.id}
              >
                <Text style={[styles.joinBtnText, item.isMember && styles.leaveBtnText]}>
                  {busyId === item.id ? "..." : item.isMember ? "Leave" : "Join"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  card: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 10,
  },
  cardIcon: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  name: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  desc: { fontSize: 12, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular" },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontFamily: "Inter_400Regular" },
  joinBtn: { backgroundColor: colors.primaryGreen, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  leaveBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.textMuted },
  joinBtnText: { color: "#fff", fontWeight: "700", fontSize: 12, fontFamily: "Inter_700Bold" },
  leaveBtnText: { color: colors.textMuted },
  empty: { alignItems: "center", gap: 12, marginTop: 60 },
  emptyText: { fontSize: 14, color: colors.textMuted, fontFamily: "Inter_400Regular" },
});
