import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchCohort } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const STATUS_COLORS: Record<string, string> = {
  forming: "#D97706", active: colors.accentGreen, completed: colors.primaryGreen, archived: colors.textMuted,
};

export default function ChurchCohortsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader, getChurchCohorts } = useData();
  const [cohorts, setCohorts] = useState<ChurchCohort[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    setCohorts(await getChurchCohorts(userChurch.id));
    setLoading(false);
  }, [userChurch, getChurchCohorts]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title}>Cohorts ({cohorts.length})</Text>
        <View style={{ width: 22 }} />
      </View>

      {isChurchLeader && (
        <TouchableOpacity style={styles.createBtn} onPress={() => router.push("/church/create-cohort" as any)}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.createBtnText}>Create New Cohort</Text>
        </TouchableOpacity>
      )}

      {loading ? (
        <View style={styles.centerFill}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <FlatList
          data={cohorts}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={<Text style={styles.emptyText}>No cohorts yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cohortName}>{item.name}</Text>
              {item.leaderUsername && <Text style={styles.cohortMeta}>Led by @{item.leaderUsername}</Text>}
              <Text style={styles.cohortMeta}>
                {item.memberCount ?? 0} member{(item.memberCount ?? 0) === 1 ? "" : "s"}
                {item.targetEndDate ? ` · Target: ${new Date(item.targetEndDate).toLocaleDateString()}` : " · No deadline"}
              </Text>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] ?? colors.textMuted }]}>
                <Text style={styles.statusBadgeText}>{item.status}</Text>
              </View>
            </View>
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
  createBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    backgroundColor: colors.accentGreen, borderRadius: 10, height: 42, marginHorizontal: 16,
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  emptyText: { textAlign: "center", color: colors.textMuted, marginTop: 40, fontFamily: "Inter_400Regular" },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige, borderRadius: 12, padding: 14, gap: 4 },
  cohortName: { fontSize: 15, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  cohortMeta: { fontSize: 12, color: colors.textMid, fontFamily: "Inter_400Regular" },
  statusBadge: { alignSelf: "flex-start", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  statusBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff", textTransform: "capitalize", fontFamily: "Inter_700Bold" },
});