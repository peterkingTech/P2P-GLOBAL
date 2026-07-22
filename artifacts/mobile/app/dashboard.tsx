import React, { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

interface DashboardData {
  lessonsCompleted: number; modulesCompleted: number; plansCompleted: number;
  assignmentsSubmitted: number; reflectionsAnswered: number;
  currentStreakDays: number; totalDaysActive: number;
  peerSessionsHeld: number; peersEncouraged: number;
  prayersOfferedForOthers: number; scriptureReferencesOpened: number;
  activeMentees: number; menteesModuleComplete: number; menteesGraduated: number;
  generationalDepth: number; countriesReached: number;
  fruitsTotal: number; fruitsByCategory: Record<string, number>;
  mostRecentFruit: { fruitKey: string; name: string; icon: string; awardedAt: string } | null;
  nextFruitProgress: { fruitKey: string; name: string; icon: string; current: number; required: number } | null;
  kingdomPlansCompleted: number; mountainsTouched: string[];
}

interface TimelineData {
  firstLesson: { label: string; at: string | null };
  firstModule: { label: string; at: string | null };
  firstMentee: { label: string; at: string | null };
  firstFruit: { label: string; at: string | null };
}

const CATEGORY_LABEL: Record<string, string> = {
  personal_growth: "Personal Growth", community: "Community", multiplication: "Multiplication",
  faithfulness: "Faithfulness", kingdom_influence: "Kingdom Influence", special: "Special", legendary: "Legendary",
};

function StatRow({ label, value, comingSoon, c }: { label: string; value: number | string; comingSoon?: boolean; c: AppColors }) {
  const s = makeStyles(c);
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}{comingSoon ? " (coming soon)" : ""}</Text>
      <Text style={[s.statValue, comingSoon && { color: c.textMuted }]}>{value}</Text>
    </View>
  );
}

function SectionCard({ title, children, c }: { title: string; children: React.ReactNode; c: AppColors }) {
  const s = makeStyles(c);
  return (
    <View style={s.sectionCard}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function GrowthDashboardScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { colors } = useTheme();
  const s = makeStyles(colors);

  const [data, setData] = useState<DashboardData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!profile?.id) return;
    setLoading(true);
    const [{ data: dash }, { data: tl }] = await Promise.all([
      supabase.rpc("p2p_get_growth_dashboard", { p_user_id: profile.id }),
      supabase.rpc("p2p_get_activity_timeline", { p_user_id: profile.id }),
    ]);
    setData(dash as DashboardData);
    setTimeline(tl as TimelineData);
    setLoading(false);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const timelineEvents = timeline
    ? [timeline.firstLesson, timeline.firstModule, timeline.firstMentee, timeline.firstFruit]
        .filter((e) => e.at)
        .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
    : [];

  return (
    <View style={[s.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Your Kingdom Impact</Text>
      </View>

      {loading || !data ? (
        <View style={s.loading}><ActivityIndicator color={colors.accentGreen} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <Text style={s.intro}>
            Not a leaderboard — just a look at the fruit of your own walk with God so far.
          </Text>

          <SectionCard title="📚 Learning Activity" c={colors}>
            <StatRow label="Lessons Completed" value={data.lessonsCompleted} c={colors} />
            <StatRow label="Modules Completed" value={data.modulesCompleted} c={colors} />
            <StatRow label="Plans Completed" value={data.plansCompleted} c={colors} />
            <StatRow label="Assignments Submitted" value={data.assignmentsSubmitted} c={colors} />
            <StatRow label="Reflections Answered" value={data.reflectionsAnswered} c={colors} />
            <StatRow label="Current Learning Streak" value={`${data.currentStreakDays} day${data.currentStreakDays === 1 ? "" : "s"}`} c={colors} />
            <StatRow label="Total Days Active" value={data.totalDaysActive} c={colors} />
          </SectionCard>

          <SectionCard title="🤝 Community Activity" c={colors}>
            <StatRow label="Peer Sessions Held" value={data.peerSessionsHeld} comingSoon c={colors} />
            <StatRow label="Peers Encouraged" value={data.peersEncouraged} comingSoon c={colors} />
            <StatRow label="Prayers Offered for Others" value={data.prayersOfferedForOthers} comingSoon c={colors} />
            <StatRow label="Scripture References Opened" value={data.scriptureReferencesOpened} comingSoon c={colors} />
          </SectionCard>

          <SectionCard title="🌾 Multiplication Activity" c={colors}>
            <StatRow label="Active Mentees" value={data.activeMentees} c={colors} />
            <StatRow label="Mentees Who Completed a Module" value={data.menteesModuleComplete} c={colors} />
            <StatRow label="Mentees Who Graduated" value={data.menteesGraduated} c={colors} />
            <StatRow label="Generational Depth" value={data.generationalDepth} c={colors} />
            <StatRow label="Countries Reached" value={data.countriesReached} c={colors} />
          </SectionCard>

          <SectionCard title="🍇 Fruit Collection" c={colors}>
            <StatRow label="Total Fruits Earned" value={data.fruitsTotal} c={colors} />
            {Object.entries(data.fruitsByCategory).map(([cat, count]) => (
              <StatRow key={cat} label={CATEGORY_LABEL[cat] ?? cat} value={count} c={colors} />
            ))}
            {data.mostRecentFruit && (
              <TouchableOpacity style={s.fruitLink} onPress={() => router.push(`/fruit/${data.mostRecentFruit!.fruitKey}` as any)}>
                <Text style={s.fruitLinkIcon}>{data.mostRecentFruit.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.fruitLinkLabel}>Most Recently Earned</Text>
                  <Text style={s.fruitLinkName}>{data.mostRecentFruit.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
            {data.nextFruitProgress && (
              <View style={s.nextFruitBlock}>
                <Text style={s.fruitLinkLabel}>Next Fruit You're Close To</Text>
                <View style={s.fruitLink}>
                  <Text style={s.fruitLinkIcon}>{data.nextFruitProgress.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.fruitLinkName}>{data.nextFruitProgress.name}</Text>
                    <View style={s.progressTrack}>
                      <View style={[s.progressFill, { width: `${Math.min(100, (data.nextFruitProgress.current / data.nextFruitProgress.required) * 100)}%` }]} />
                    </View>
                    <Text style={s.progressLabel}>{data.nextFruitProgress.current} of {data.nextFruitProgress.required}</Text>
                  </View>
                </View>
              </View>
            )}
          </SectionCard>

          <SectionCard title="🌍 Kingdom Influence" c={colors}>
            <StatRow label="Kingdom Plans Completed" value={data.kingdomPlansCompleted} comingSoon c={colors} />
            <StatRow label="Mountains Touched" value={data.mountainsTouched.length > 0 ? data.mountainsTouched.join(", ") : "None yet"} comingSoon c={colors} />
          </SectionCard>

          {timelineEvents.length > 0 && (
            <SectionCard title="🕊 Your Journey So Far" c={colors}>
              {timelineEvents.map((e, i) => (
                <View key={i} style={s.timelineRow}>
                  <View style={s.timelineDotCol}>
                    <View style={s.timelineDot} />
                    {i < timelineEvents.length - 1 && <View style={s.timelineLine} />}
                  </View>
                  <View style={{ flex: 1, paddingBottom: 16 }}>
                    <Text style={s.timelineLabel}>{e.label}</Text>
                    <Text style={s.timelineDate}>
                      {new Date(e.at!).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                    </Text>
                  </View>
                </View>
              ))}
            </SectionCard>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      flexDirection: "row", alignItems: "center", gap: 12,
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.borderBeige,
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center" },
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 18, fontStyle: "italic" },

    sectionCard: {
      backgroundColor: c.card, borderRadius: 16, borderWidth: 1, borderColor: c.borderBeige,
      padding: 16, marginBottom: 16,
    },
    sectionTitle: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 12 },

    statRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 7 },
    statLabel: { fontSize: 13, color: c.textMid, fontFamily: "Inter_400Regular", flex: 1 },
    statValue: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },

    fruitLink: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.borderBeige },
    fruitLinkIcon: { fontSize: 26 },
    fruitLinkLabel: { fontSize: 10, color: c.textMuted, fontFamily: "Inter_400Regular", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2 },
    fruitLinkName: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    nextFruitBlock: { marginTop: 4 },
    progressTrack: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 6, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: c.accentGreen, borderRadius: 2 },
    progressLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    timelineRow: { flexDirection: "row", gap: 12 },
    timelineDotCol: { alignItems: "center", width: 16 },
    timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentGreen, marginTop: 4 },
    timelineLine: { flex: 1, width: 1, backgroundColor: c.borderBeige, marginTop: 2 },
    timelineLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    timelineDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
  });
}
