import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator, ScrollView } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useData, ChurchCohort, ChurchAnnouncement, LearningGoal } from "@/contexts/DataContext";
import { ChurchQRCode } from "@/components/ChurchQRCode";
import colors from "@/constants/colors";

export default function ChurchHomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userChurch, isChurchLeader, churchMemberCount, loadUserChurch, getChurchCohorts, getAnnouncements, getGroveData, getLearningGoalsDashboard } = useData();
  const [loading, setLoading] = useState(true);
  const [cohorts, setCohorts] = useState<ChurchCohort[]>([]);
  const [announcements, setAnnouncements] = useState<ChurchAnnouncement[]>([]);
  const [goalDashboard, setGoalDashboard] = useState<LearningGoal[]>([]);
  const [grove, setGrove] = useState<{ activeLearners: number; lessonsThisWeek: number; nationsReached: number; totalGrainPlanted: number; inactiveMembers: number; newBelieversWithoutGuides: number } | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      (async () => {
        setLoading(true);
        await loadUserChurch();
        setLoading(false);
      })();
    }, [loadUserChurch])
  );

  useEffect(() => {
    if (!userChurch) return;
    (async () => {
      const dashboardGoals = await getLearningGoalsDashboard(userChurch.id);
      setGoalDashboard(dashboardGoals);
      if (isChurchLeader) {
        const g = await getGroveData(userChurch.id);
        if (g) setGrove(g);
      } else {
        const [c, a] = await Promise.all([getChurchCohorts(userChurch.id), getAnnouncements(userChurch.id)]);
        setCohorts(c);
        setAnnouncements(a);
      }
    })();
  }, [userChurch, isChurchLeader, getGroveData, getChurchCohorts, getAnnouncements, getLearningGoalsDashboard]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centerFill]}>
        <ActivityIndicator color={colors.accentGreen} />
      </View>
    );
  }

  if (!userChurch) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.emptyContent, { paddingTop: insets.top + 60 }]}>
        <Text style={styles.emptyEmoji}>⛪</Text>
        <Text style={styles.emptyTitle}>Your Church on P2P Global</Text>
        <Text style={styles.emptyBody}>
          Connect your local church to P2P Global Kingdom School. Track discipleship. Support your congregation. See your grove grow.
        </Text>
        <Text style={styles.freeText}>Completely free. Always.{"\n"}No subscription. No payment. No catch.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={() => router.push("/church/register" as any)}>
          <Text style={styles.primaryBtnText}>Register Your Church</Text>
          <Ionicons name="arrow-forward" size={18} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.orText}>Already have a code?</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.push("/church/join" as any)}>
          <Text style={styles.secondaryBtnText}>Join with Invite Code</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: 40, paddingHorizontal: 20 }}>
      <View style={styles.churchHeader}>
        {userChurch.logoUrl ? (
          <Image source={{ uri: userChurch.logoUrl }} style={styles.logo} />
        ) : (
          <View style={styles.logoPlaceholder}><Text style={{ fontSize: 26 }}>⛪</Text></View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.churchName}>{userChurch.name}</Text>
          <Text style={styles.churchLocation}>
            {[userChurch.city, userChurch.country].filter(Boolean).join(", ")}
            {isChurchLeader ? ` · ${churchMemberCount} members` : ""}
          </Text>
        </View>
      </View>

      {goalDashboard.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>How Is Our Church Learning?</Text>
          {goalDashboard.map((g) => (
            <View key={g.id} style={styles.goalCard}>
              <Text style={styles.goalTitle}>{g.title}</Text>
              <View style={styles.goalProgressTrack}>
                <View style={[styles.goalProgressFill, { width: `${Math.min(100, g.progressPercent ?? 0)}%` }, g.achieved && styles.goalProgressFillAchieved]} />
              </View>
              <Text style={styles.goalProgressText}>
                {g.achieved
                  ? `🎉 Goal reached! ${g.completedCount ?? 0} member${(g.completedCount ?? 0) === 1 ? "" : "s"} completed this ${g.timeframe === "today" ? "lesson" : g.timeframe === "this_week" ? "week's lesson" : "goal"}.`
                  : `${g.completedCount ?? 0} of ${g.totalMembers ?? 0} members so far — there's still time to grow together.`}
              </Text>
            </View>
          ))}
        </>
      )}

      {isChurchLeader ? (
        <>
          <Text style={styles.sectionTitle}>Grove Overview</Text>
          {grove ? (
            <View style={styles.statsCard}>
              <StatRow icon="pulse" label="Active learners" value={grove.activeLearners} />
              <StatRow icon="book" label="Lessons this week" value={grove.lessonsThisWeek} />
              <StatRow icon="earth" label="Nations reached" value={grove.nationsReached} />
              <StatRow icon="leaf" label="Grain planted" value={grove.totalGrainPlanted} />
            </View>
          ) : (
            <ActivityIndicator color={colors.accentGreen} style={{ marginVertical: 12 }} />
          )}

          {grove && (grove.inactiveMembers > 0 || grove.newBelieversWithoutGuides > 0) && (
            <TouchableOpacity style={styles.attentionCard} onPress={() => router.push("/church/grove" as any)}>
              <Text style={styles.attentionTitle}>⚠️ Needs Attention</Text>
              {grove.inactiveMembers > 0 && <Text style={styles.attentionLine}>{grove.inactiveMembers} members inactive 14+ days</Text>}
              {grove.newBelieversWithoutGuides > 0 && <Text style={styles.attentionLine}>{grove.newBelieversWithoutGuides} new believers without guides</Text>}
              <Text style={styles.attentionLink}>View Details →</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.sectionTitle}>Invite Members</Text>
          <ChurchQRCode church={{ name: userChurch.name, city: userChurch.city, country: userChurch.country, inviteLink: userChurch.inviteLink, inviteCode: userChurch.inviteCode }} />

          <View style={{ gap: 10, marginTop: 16 }}>
            <NavRow icon="leaf-outline" label="Grove Dashboard" onPress={() => router.push("/church/grove" as any)} />
            <NavRow icon="people-outline" label="Members" onPress={() => router.push("/church/members" as any)} />
            <NavRow icon="school-outline" label="Cohorts" onPress={() => router.push("/church/cohorts" as any)} />
            <NavRow icon="megaphone-outline" label="Announcements" onPress={() => router.push("/church/announcements" as any)} />
            <NavRow icon="settings-outline" label="Church Settings" onPress={() => router.push("/church/settings" as any)} />
          </View>
        </>
      ) : (
        <>
          <Text style={styles.sectionTitle}>My Cohorts</Text>
          {cohorts.length === 0 ? (
            <Text style={styles.emptyInlineText}>You are not in a cohort yet.</Text>
          ) : (
            cohorts.slice(0, 3).map((c) => (
              <TouchableOpacity key={c.id} style={styles.cohortRow} onPress={() => router.push("/church/cohorts" as any)}>
                <Text style={styles.cohortName}>{c.name}</Text>
                <Text style={styles.cohortSub}>{c.memberCount ?? 0} members · {c.status}</Text>
              </TouchableOpacity>
            ))
          )}

          <Text style={styles.sectionTitle}>Announcements</Text>
          {announcements.length === 0 ? (
            <Text style={styles.emptyInlineText}>No announcements yet.</Text>
          ) : (
            announcements.slice(0, 2).map((a) => (
              <TouchableOpacity key={a.id} style={styles.announcementRow} onPress={() => router.push("/church/announcements" as any)}>
                <Text style={styles.announcementTitle}>{a.isPinned ? "📌 " : ""}{a.title}</Text>
                <Text style={styles.announcementBody} numberOfLines={2}>{a.body}</Text>
              </TouchableOpacity>
            ))
          )}

          <TouchableOpacity style={styles.viewAllBtn} onPress={() => router.push("/church/announcements" as any)}>
            <Text style={styles.viewAllText}>View all announcements</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

function StatRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: number }) {
  return (
    <View style={styles.statRow}>
      <Ionicons name={icon} size={16} color={colors.accentGreen} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function NavRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.navRow} onPress={onPress}>
      <Ionicons name={icon} size={18} color={colors.accentGreen} />
      <Text style={styles.navRowText}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.darkBg },
  centerFill: { alignItems: "center", justifyContent: "center" },
  emptyContent: { paddingHorizontal: 32, alignItems: "center", paddingBottom: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 22, fontWeight: "700", color: colors.cream, textAlign: "center", fontFamily: "Inter_700Bold", marginBottom: 12 },
  emptyBody: { fontSize: 14, color: colors.lightGreen, textAlign: "center", lineHeight: 21, opacity: 0.85, fontFamily: "Inter_400Regular", marginBottom: 16 },
  freeText: { fontSize: 13, color: colors.accentGreen, textAlign: "center", fontWeight: "700", fontFamily: "Inter_700Bold", marginBottom: 28, lineHeight: 19 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.accentGreen, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 24, width: "100%",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15, fontFamily: "Inter_700Bold" },
  orText: { color: colors.textMuted, fontSize: 13, marginTop: 24, marginBottom: 10, fontFamily: "Inter_400Regular" },
  secondaryBtn: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 24, width: "100%", alignItems: "center" },
  secondaryBtnText: { color: colors.cream, fontWeight: "600", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  churchHeader: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 24 },
  logo: { width: 56, height: 56, borderRadius: 12 },
  logoPlaceholder: { width: 56, height: 56, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  churchName: { fontSize: 19, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  churchLocation: { fontSize: 13, color: colors.lightGreen, opacity: 0.8, marginTop: 2, fontFamily: "Inter_400Regular" },
  sectionTitle: { fontSize: 12, fontWeight: "700", color: colors.lightGreen, opacity: 0.7, marginTop: 20, marginBottom: 10, textTransform: "uppercase", fontFamily: "Inter_700Bold" },
  statsCard: { backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: 14, gap: 10 },
  statRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  statLabel: { flex: 1, fontSize: 13, color: colors.cream, fontFamily: "Inter_400Regular" },
  statValue: { fontSize: 15, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  attentionCard: { backgroundColor: "rgba(217,119,6,0.1)", borderWidth: 1, borderColor: "rgba(217,119,6,0.35)", borderRadius: 14, padding: 14, marginTop: 14, gap: 4 },
  attentionTitle: { fontSize: 13, fontWeight: "700", color: "#D97706", fontFamily: "Inter_700Bold" },
  attentionLine: { fontSize: 12, color: colors.cream, opacity: 0.85, fontFamily: "Inter_400Regular" },
  attentionLink: { fontSize: 12, color: "#D97706", fontWeight: "600", marginTop: 4, fontFamily: "Inter_600SemiBold" },
  goalCard: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 14, padding: 14, marginBottom: 10 },
  goalTitle: { fontSize: 14, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  goalProgressTrack: { height: 8, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 4, marginTop: 10, overflow: "hidden" },
  goalProgressFill: { height: "100%", backgroundColor: colors.accentGreen, borderRadius: 4 },
  goalProgressFillAchieved: { backgroundColor: "#D97706" },
  goalProgressText: { fontSize: 12, color: colors.lightGreen, opacity: 0.85, marginTop: 8, lineHeight: 17, fontFamily: "Inter_400Regular" },
  navRow: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, padding: 14,
  },
  navRowText: { flex: 1, fontSize: 14, color: colors.cream, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  emptyInlineText: { fontSize: 13, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  cohortRow: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, padding: 14, marginBottom: 8 },
  cohortName: { fontSize: 14, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  cohortSub: { fontSize: 12, color: colors.lightGreen, opacity: 0.7, marginTop: 2, fontFamily: "Inter_400Regular" },
  announcementRow: { backgroundColor: "rgba(255,255,255,0.05)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 12, padding: 14, marginBottom: 8 },
  announcementTitle: { fontSize: 14, fontWeight: "700", color: colors.cream, fontFamily: "Inter_700Bold" },
  announcementBody: { fontSize: 12, color: colors.lightGreen, opacity: 0.75, marginTop: 4, fontFamily: "Inter_400Regular" },
  viewAllBtn: { alignItems: "center", paddingVertical: 10, marginTop: 4 },
  viewAllText: { fontSize: 13, color: colors.accentGreen, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
});