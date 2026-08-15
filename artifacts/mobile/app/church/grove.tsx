import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, GroveData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const STAGES = [
  { key: "dormant_seed", emoji: "🌰", label: "Seeds", color: "#8B8B8B" },
  { key: "sprout", emoji: "🌱", label: "Sprouts", color: "#4CAF50" },
  { key: "young_tree", emoji: "🌿", label: "Growing", color: "#2E7D32" },
  { key: "fruitful_tree", emoji: "🌳", label: "Fruitful", color: "#1D9E75" },
  { key: "forest_builder", emoji: "🌲", label: "Multiplying", color: "#B8860B" },
  { key: "forest_of_nations", emoji: "🌍", label: "Nations", color: "#4A90D9" },
];

export default function GroveDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, getGroveData } = useData();
  const [loading, setLoading] = useState(true);
  const [grove, setGrove] = useState<GroveData | null>(null);

  const load = useCallback(async () => {
    if (!userChurch) return;
    setLoading(true);
    const data = await getGroveData(userChurch.id);
    setGrove(data);
    setLoading(false);
  }, [userChurch, getGroveData]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !grove) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  const totalMembers = Object.values(grove.stageCounts).reduce((a, b) => a + b, 0) || 1;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 20, paddingBottom: 40, paddingHorizontal: 20 }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="arrow-back" size={22} color={colors.textDark} /></TouchableOpacity>
        <Text style={styles.title}>Grove Dashboard</Text>
        <View style={{ width: 22 }} />
      </View>

      <Text style={styles.sectionTitle}>Congregation Growth</Text>
      <View style={styles.stageBar}>
        {STAGES.map((s) => (
          <View key={s.key} style={{ flex: Math.max(grove.stageCounts[s.key] ?? 0, 0.001), backgroundColor: s.color }} />
        ))}
      </View>
      <View style={styles.legendRow}>
        {STAGES.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <Text>{s.emoji}</Text>
            <Text style={styles.legendText}>{s.label}: {grove.stageCounts[s.key] ?? 0}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Key Metrics</Text>
      <View style={styles.metricsGrid}>
        <MetricCard value={grove.activeLearners} label="Active Learners" />
        <MetricCard value={grove.lessonsThisWeek} label="Lessons This Week" />
        <MetricCard value={grove.activePeerGuides} label="Peer Guides Active" />
        <MetricCard value={grove.nationsReached} label="Nations Reached" />
        <MetricCard value={grove.totalGrainPlanted} label="Grain Planted" />
        <MetricCard value={grove.deepestDiscipleshipChain} label="Generations Deep" />
      </View>

      {(grove.inactiveMembers > 0 || grove.newBelieversWithoutGuides > 0) && (
        <>
          <Text style={styles.sectionTitle}>⚠️ Needs Attention</Text>
          <View style={styles.attentionBox}>
            {grove.inactiveMembers > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push("/church/members" as any)}>
                <Text style={styles.attentionRowText}>Inactive members (14+ days)</Text>
                <Text style={styles.attentionRowValue}>{grove.inactiveMembers}</Text>
              </TouchableOpacity>
            )}
            {grove.newBelieversWithoutGuides > 0 && (
              <TouchableOpacity style={styles.attentionRow} onPress={() => router.push("/church/members" as any)}>
                <Text style={styles.attentionRowText}>New believers without guides</Text>
                <Text style={styles.attentionRowValue}>{grove.newBelieversWithoutGuides}</Text>
              </TouchableOpacity>
            )}
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>Recent Activity</Text>
      {grove.recentActivity.length === 0 ? (
        <Text style={styles.emptyText}>No activity in the last 7 days.</Text>
      ) : (
        grove.recentActivity.map((a, i) => (
          <View key={i} style={styles.activityRow}>
            <Text style={styles.activityText}>{a.userDisplayName} {a.action}</Text>
            <Text style={styles.activityTime}>{new Date(a.createdAt).toLocaleDateString()}</Text>
          </View>
        ))
      )}

      <Text style={styles.sectionTitle}>Nations Reached</Text>
      <Text style={styles.nationsText}>Your church's discipleship has touched {grove.nationsReached} nation{grove.nationsReached === 1 ? "" : "s"}.</Text>
    </ScrollView>
  );
}

function MetricCard({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  centerFill: { alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  title: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.textMid, marginTop: 20, marginBottom: 10, textTransform: "uppercase", fontFamily: "Inter_700Bold" },
  stageBar: { flexDirection: "row", height: 14, borderRadius: 7, overflow: "hidden" },
  legendRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: {
    width: "31%", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.borderBeige,
    borderRadius: 12, padding: 12, alignItems: "center",
  },
  metricValue: { fontSize: 20, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  metricLabel: { fontSize: 10, color: colors.textMuted, textAlign: "center", marginTop: 4, fontFamily: "Inter_400Regular" },
  attentionBox: { backgroundColor: "rgba(217,119,6,0.08)", borderWidth: 1, borderColor: "rgba(217,119,6,0.3)", borderRadius: 12, overflow: "hidden" },
  attentionRow: { flexDirection: "row", justifyContent: "space-between", padding: 12, borderBottomWidth: 1, borderBottomColor: "rgba(217,119,6,0.2)" },
  attentionRowText: { fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  attentionRowValue: { fontSize: 13, fontWeight: "700", color: "#D97706", fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  activityRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.borderBeige },
  activityText: { flex: 1, fontSize: 13, color: colors.textDark, fontFamily: "Inter_400Regular" },
  activityTime: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  nationsText: { fontSize: 13, color: colors.textMid, lineHeight: 19, fontFamily: "Inter_400Regular" },
});