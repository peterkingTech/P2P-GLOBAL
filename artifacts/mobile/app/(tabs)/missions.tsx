import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useData, Mission } from "@/contexts/DataContext";
import colors from "@/constants/colors";

function MissionCard({ mission, onPray }: { mission: Mission; onPray: (id: string) => void }) {
  return (
    <View style={styles.missionCard}>
      <View style={styles.missionHeader}>
        <View style={styles.nationBadge}>
          <Ionicons name="earth" size={14} color={colors.amber} />
          <Text style={styles.nationText}>{mission.nation}</Text>
        </View>
        <Text style={styles.missionPopulation}>{mission.population}</Text>
      </View>
      <Text style={styles.missionTitle}>{mission.title}</Text>
      <Text style={styles.missionDesc}>{mission.description}</Text>

      <View style={styles.missionMeta}>
        <View style={styles.metaTag}>
          <Ionicons name="language" size={12} color={colors.textMuted} />
          <Text style={styles.metaTagText}>{mission.language}</Text>
        </View>
        <View style={styles.metaTag}>
          <Ionicons name="book" size={12} color={colors.textMuted} />
          <Text style={styles.metaTagText}>{mission.religion}</Text>
        </View>
      </View>

      <View style={styles.missionFooter}>
        <View style={styles.prayerCountRow}>
          <Ionicons name="heart" size={13} color={colors.amber} />
          <Text style={styles.prayerCountText}>{mission.prayerCount.toLocaleString()} praying</Text>
        </View>
        <TouchableOpacity
          style={styles.prayMissionBtn}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPray(mission.id);
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.prayMissionText}>Pray</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const WEEKLY_CHALLENGE = {
  title: "The Parable of the Sower",
  verse: "Mark 4:1–20",
  task: "Read the parable of the sower and identify what kind of soil you are in this season. Discuss with your study partner.",
  daysLeft: 3,
  participants: 847,
};

export default function MissionsTab() {
  const insets = useSafeAreaInsets();
  const { missions, isLoading } = useData();
  const [prayedFor, setPrayedFor] = useState<string[]>([]);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  function handlePray(id: string) {
    if (!prayedFor.includes(id)) {
      setPrayedFor((prev) => [...prev, id]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 20, paddingBottom: insets.bottom + 100 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={styles.title}>Missions</Text>
      <Text style={styles.subtitle}>Pray for the unreached peoples of the earth</Text>

      {/* Weekly Challenge */}
      <View style={styles.challengeCard}>
        <View style={styles.challengeTop}>
          <View style={styles.challengeBadge}>
            <Ionicons name="trophy" size={13} color={colors.brightYellow} />
            <Text style={styles.challengeBadgeText}>Weekly Challenge</Text>
          </View>
          <Text style={styles.challengeDays}>{WEEKLY_CHALLENGE.daysLeft}d left</Text>
        </View>
        <Text style={styles.challengeTitle}>{WEEKLY_CHALLENGE.title}</Text>
        <Text style={styles.challengeVerse}>{WEEKLY_CHALLENGE.verse}</Text>
        <Text style={styles.challengeTask}>{WEEKLY_CHALLENGE.task}</Text>
        <View style={styles.challengeFooter}>
          <View style={styles.participantRow}>
            <Ionicons name="people" size={13} color={colors.lightGreen} />
            <Text style={styles.participantText}>{WEEKLY_CHALLENGE.participants.toLocaleString()} participants</Text>
          </View>
          <TouchableOpacity style={styles.acceptBtn}>
            <Text style={styles.acceptBtnText}>Accept</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>7,380</Text>
          <Text style={styles.statLabel}>Unreached Groups</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>3.1B</Text>
          <Text style={styles.statLabel}>Unreached People</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statNum}>2,847</Text>
          <Text style={styles.statLabel}>Praying Today</Text>
        </View>
      </View>

      {/* Unreached Peoples */}
      <Text style={styles.sectionTitle}>Unreached Peoples</Text>
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : (
        missions.map((mission) => (
          <MissionCard key={mission.id} mission={mission} onPray={handlePray} />
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  content: { paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 4, marginBottom: 20, fontFamily: "Inter_400Regular" },
  challengeCard: {
    backgroundColor: colors.primaryGreen,
    borderRadius: 18, padding: 18, marginBottom: 20,
  },
  challengeTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  challengeBadge: {
    flexDirection: "row", gap: 5, alignItems: "center",
    backgroundColor: "rgba(247,201,72,0.2)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  challengeBadgeText: { color: colors.brightYellow, fontSize: 11, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  challengeDays: { color: colors.lightGreen, fontSize: 12, fontFamily: "Inter_400Regular" },
  challengeTitle: { fontSize: 18, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold", marginBottom: 4 },
  challengeVerse: { fontSize: 12, color: colors.lightGreen, fontFamily: "Inter_500Medium", marginBottom: 10 },
  challengeTask: { fontSize: 13, color: colors.lightCream, lineHeight: 20, fontFamily: "Inter_400Regular", opacity: 0.85, marginBottom: 14 },
  challengeFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  participantRow: { flexDirection: "row", gap: 5, alignItems: "center" },
  participantText: { fontSize: 12, color: colors.lightGreen, fontFamily: "Inter_400Regular" },
  acceptBtn: {
    backgroundColor: colors.cream,
    borderRadius: 10, paddingHorizontal: 16, paddingVertical: 7,
  },
  acceptBtnText: { color: colors.primaryGreen, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
  statsRow: {
    flexDirection: "row",
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, marginBottom: 24, justifyContent: "space-around",
  },
  statBox: { alignItems: "center" },
  statNum: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2, textAlign: "center" },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 14 },
  loading: { alignItems: "center", paddingVertical: 40 },
  missionCard: {
    backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 16, marginBottom: 14,
  },
  missionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  nationBadge: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: "rgba(186,117,23,0.1)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  nationText: { fontSize: 11, color: colors.amber, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  missionPopulation: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  missionTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
  missionDesc: { fontSize: 13, color: colors.textMid, lineHeight: 20, fontFamily: "Inter_400Regular", marginBottom: 12 },
  missionMeta: { flexDirection: "row", gap: 8, marginBottom: 14 },
  metaTag: {
    flexDirection: "row", gap: 4, alignItems: "center",
    backgroundColor: colors.cardBeige,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  metaTagText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  missionFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  prayerCountRow: { flexDirection: "row", gap: 5, alignItems: "center" },
  prayerCountText: { fontSize: 13, color: colors.textMid, fontFamily: "Inter_500Medium" },
  prayMissionBtn: {
    backgroundColor: colors.accentGreen,
    borderRadius: 10, paddingHorizontal: 20, paddingVertical: 8,
  },
  prayMissionText: { color: colors.cream, fontWeight: "700", fontSize: 13, fontFamily: "Inter_700Bold" },
});
