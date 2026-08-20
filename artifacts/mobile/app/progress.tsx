import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Stack, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, Plan } from "@/contexts/DataContext";
import { useAuth, supabase } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

// Kingdom Impact's all-time discipleship metrics (formerly a separate
// app/dashboard.tsx screen, reached via Home's "Kingdom Impact" tile) now
// live here, under My Progress — the Home tile was renamed "Peer Connect"
// and repointed to the Connect hub, so this content moved to the one
// remaining progress-flavored destination rather than being stranded on an
// orphaned route.
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

const SEVEN_MOUNTAINS = ["Marketplace", "Education", "Government", "Media", "Innovation", "Family", "Church"];

function StatRow({ label, value, c }: { label: string; value: number | string; c: AppColors }) {
  const s = makeStyles(c);
  return (
    <View style={s.statRow}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={s.statValue}>{value}</Text>
    </View>
  );
}

function MountainsGrid({ touched, c }: { touched: string[]; c: AppColors }) {
  const s = makeStyles(c);
  const touchedSet = new Set(touched);
  return (
    <View style={s.mountainsGrid}>
      {SEVEN_MOUNTAINS.map((name) => {
        const isTouched = touchedSet.has(name);
        return (
          <View key={name} style={[s.mountainTile, isTouched && s.mountainTileTouched]}>
            <Ionicons name="triangle" size={16} color={isTouched ? "#fff" : c.textMuted} />
            <Text style={[s.mountainTileText, isTouched && s.mountainTileTextTouched]}>{name}</Text>
          </View>
        );
      })}
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

// ── Unified plan-in-progress card — all plans (p2p_curriculums type='plan')
// now share one schema and one progress source (DataContext.getPlanProgress),
// so there is no more legacy/v2 split here. ──
function PlanProgressCard({ plan, progress, styles, router }: { plan: Plan; progress: number; styles: ReturnType<typeof makeStyles>; router: ReturnType<typeof useRouter> }) {
  return (
    <TouchableOpacity
      style={styles.planCard}
      onPress={() => router.push(`/plan/${plan.id}` as any)}
      activeOpacity={0.82}
    >
      <Text style={styles.planTitle}>{plan.title}</Text>
      <View style={styles.planBar}>
        <View style={[styles.planBarFill, { width: `${progress}%` as any }]} />
      </View>
      <Text style={styles.planProgress}>{progress}% complete</Text>
    </TouchableOpacity>
  );
}

export default function ProgressDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile } = useAuth();
  const { modules, lessons, plans, getPlanProgress } = useData();
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [refreshKey, setRefreshKey] = useState(0);
  const onRefresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const [impactData, setImpactData] = useState<DashboardData | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [impactLoading, setImpactLoading] = useState(true);

  const loadImpact = useCallback(async () => {
    if (!profile?.id) return;
    setImpactLoading(true);
    const [{ data: dash }, { data: tl }] = await Promise.all([
      supabase.rpc("p2p_get_growth_dashboard", { p_user_id: profile.id }),
      supabase.rpc("p2p_get_activity_timeline", { p_user_id: profile.id }),
    ]);
    setImpactData(dash as DashboardData);
    setTimeline(tl as TimelineData);
    setImpactLoading(false);
  }, [profile?.id]);

  useFocusEffect(useCallback(() => { loadImpact(); }, [loadImpact, refreshKey]));

  const timelineEvents = timeline
    ? [timeline.firstLesson, timeline.firstModule, timeline.firstMentee, timeline.firstFruit]
        .filter((e) => e.at)
        .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
    : [];

  const plansInProgress = plans.filter(p => {
    const progress = getPlanProgress(p.id);
    return progress > 0 && progress < 100;
  });

  // Core curriculum: the first lesson that's neither completed nor locked is
  // "current" — everything before it is done, this is what the user should
  // work on next.
  const currentCoreLesson = lessons.find(l => !l.isCompleted && !l.isLocked);
  const currentCoreModule = currentCoreLesson ? modules.find(m => m.id === currentCoreLesson.moduleId) : null;
  const coreCompletedLessons = lessons.filter(l => l.isCompleted).length;
  const coreHasStarted = coreCompletedLessons > 0 || Boolean(currentCoreLesson);

  const nothingToShow = plansInProgress.length === 0 && !currentCoreModule;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Progress</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={colors.accentGreen} />}
      >
        {/* ── Core Curriculum In Progress ── */}
        {currentCoreModule && currentCoreLesson && (
          <>
            <Text style={styles.sectionHeader}>Core Curriculum In Progress</Text>
            <TouchableOpacity
              style={styles.planCard}
              onPress={() => router.push(`/module/${currentCoreModule.id}` as any)}
              activeOpacity={0.82}
            >
              <Text style={styles.planTitle}>{currentCoreModule.title}</Text>
              <Text style={styles.planCurrent}>Current lesson: {currentCoreLesson.title}</Text>
              <View style={styles.planBar}>
                <View style={[styles.planBarFill, { width: `${lessons.length > 0 ? Math.round((coreCompletedLessons / lessons.length) * 100) : 0}%` as any }]} />
              </View>
              <Text style={styles.planProgress}>{coreCompletedLessons}/{lessons.length} lessons approved</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Plans In Progress ── */}
        {plansInProgress.length > 0 && (
          <>
            <Text style={styles.sectionHeader}>Plans In Progress</Text>
            {plansInProgress.map(p => (
              <PlanProgressCard key={p.id} plan={p} progress={getPlanProgress(p.id)} styles={styles} router={router} />
            ))}
          </>
        )}

        {/* Empty state when nothing is actively in progress */}
        {nothingToShow && (
          <View style={[styles.empty, { marginTop: 20 }]}>
            <Ionicons name="leaf-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {coreHasStarted
                ? "Nothing in progress right now.\nStart a plan or continue your curriculum to track it here."
                : "Nothing to show yet.\nStart a lesson to track your progress here."}
            </Text>
          </View>
        )}

        {/* ── Kingdom Impact — all-time discipleship metrics ── */}
        <Text style={styles.sectionHeader}>Your Kingdom Impact</Text>
        {impactLoading || !impactData ? (
          <View style={styles.impactLoading}><ActivityIndicator color={colors.accentGreen} /></View>
        ) : (
          <>
            <Text style={styles.intro}>
              Not a leaderboard — just a look at the fruit of your own walk with God so far.
            </Text>

            <SectionCard title="📚 Learning Activity" c={colors}>
              <StatRow label="Lessons Completed" value={impactData.lessonsCompleted} c={colors} />
              <StatRow label="Modules Completed" value={impactData.modulesCompleted} c={colors} />
              <StatRow label="Plans Completed" value={impactData.plansCompleted} c={colors} />
              <StatRow label="Assignments Submitted" value={impactData.assignmentsSubmitted} c={colors} />
              <StatRow label="Reflections Answered" value={impactData.reflectionsAnswered} c={colors} />
              <StatRow label="Current Learning Streak" value={`${impactData.currentStreakDays} day${impactData.currentStreakDays === 1 ? "" : "s"}`} c={colors} />
              <StatRow label="Total Days Active" value={impactData.totalDaysActive} c={colors} />
            </SectionCard>

            <SectionCard title="🤝 Community Activity" c={colors}>
              <StatRow label="Peer Sessions Held" value={impactData.peerSessionsHeld} c={colors} />
              <StatRow label="Peers Encouraged" value={impactData.peersEncouraged} c={colors} />
              <StatRow label="Prayers Offered for Others" value={impactData.prayersOfferedForOthers} c={colors} />
              <StatRow label="Scripture References Opened" value={impactData.scriptureReferencesOpened} c={colors} />
            </SectionCard>

            <SectionCard title="🌾 Multiplication Activity" c={colors}>
              <StatRow label="Active Mentees" value={impactData.activeMentees} c={colors} />
              <StatRow label="Mentees Who Completed a Module" value={impactData.menteesModuleComplete} c={colors} />
              <StatRow label="Mentees Who Graduated" value={impactData.menteesGraduated} c={colors} />
              <StatRow label="Generational Depth" value={impactData.generationalDepth} c={colors} />
              <StatRow label="Countries Reached" value={impactData.countriesReached} c={colors} />
            </SectionCard>

            <SectionCard title="🍇 Fruit Collection" c={colors}>
              <StatRow label="Total Fruits Earned" value={impactData.fruitsTotal} c={colors} />
              {Object.entries(impactData.fruitsByCategory).map(([cat, count]) => (
                <StatRow key={cat} label={CATEGORY_LABEL[cat] ?? cat} value={count} c={colors} />
              ))}
              {impactData.mostRecentFruit && (
                <TouchableOpacity style={styles.fruitLink} onPress={() => router.push(`/fruit/${impactData.mostRecentFruit!.fruitKey}` as any)}>
                  <Text style={styles.fruitLinkIcon}>{impactData.mostRecentFruit.icon}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fruitLinkLabel}>Most Recently Earned</Text>
                    <Text style={styles.fruitLinkName}>{impactData.mostRecentFruit.name}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
              {impactData.nextFruitProgress && (
                <View style={styles.nextFruitBlock}>
                  <Text style={styles.fruitLinkLabel}>Next Fruit You're Close To</Text>
                  <View style={styles.fruitLink}>
                    <Text style={styles.fruitLinkIcon}>{impactData.nextFruitProgress.icon}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fruitLinkName}>{impactData.nextFruitProgress.name}</Text>
                      <View style={styles.impactProgressTrack}>
                        <View style={[styles.impactProgressFill, { width: `${Math.min(100, (impactData.nextFruitProgress.current / impactData.nextFruitProgress.required) * 100)}%` }]} />
                      </View>
                      <Text style={styles.impactProgressLabel}>{impactData.nextFruitProgress.current} of {impactData.nextFruitProgress.required}</Text>
                    </View>
                  </View>
                </View>
              )}
            </SectionCard>

            <SectionCard title="🌍 Kingdom Influence" c={colors}>
              <StatRow label="Kingdom Plans Completed" value={impactData.kingdomPlansCompleted} c={colors} />
              <Text style={[styles.statLabel, { marginTop: 10, marginBottom: 8 }]}>Mountains Touched</Text>
              <MountainsGrid touched={impactData.mountainsTouched} c={colors} />
            </SectionCard>

            {timelineEvents.length > 0 && (
              <SectionCard title="🕊 Your Journey So Far" c={colors}>
                {timelineEvents.map((e, i) => (
                  <View key={i} style={styles.timelineRow}>
                    <View style={styles.timelineDotCol}>
                      <View style={styles.timelineDot} />
                      {i < timelineEvents.length - 1 && <View style={styles.timelineLine} />}
                    </View>
                    <View style={{ flex: 1, paddingBottom: 16 }}>
                      <Text style={styles.timelineLabel}>{e.label}</Text>
                      <Text style={styles.timelineDate}>
                        {new Date(e.at!).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
                      </Text>
                    </View>
                  </View>
                ))}
              </SectionCard>
            )}
          </>
        )}
      </ScrollView>
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

    scroll: { paddingHorizontal: 16, paddingTop: 20 },

    sectionHeader: { fontSize: 13, fontWeight: "700", color: c.textMuted, fontFamily: "Inter_700Bold", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10, marginTop: 24 },

    planCard: {
      backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.borderBeige,
      padding: 14, marginBottom: 10,
    },
    planTitle: { fontSize: 14, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    planCurrent: { fontSize: 12, color: c.textMid, fontFamily: "Inter_500Medium", marginTop: 4 },
    planBar: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 8 },
    planBarFill: { height: 4, backgroundColor: c.accentGreen, borderRadius: 2 },
    planProgress: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
    emptyText: { fontSize: 14, color: c.textMuted, fontFamily: "Inter_400Regular", textAlign: "center" },

    impactLoading: { paddingVertical: 30, alignItems: "center" },
    intro: { fontSize: 13, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 14, fontStyle: "italic" },

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
    impactProgressTrack: { height: 4, backgroundColor: c.progressTrack, borderRadius: 2, marginTop: 6, overflow: "hidden" },
    impactProgressFill: { height: "100%", backgroundColor: c.accentGreen, borderRadius: 2 },
    impactProgressLabel: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 4 },

    timelineRow: { flexDirection: "row", gap: 12 },
    timelineDotCol: { alignItems: "center", width: 16 },
    timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentGreen, marginTop: 4 },
    timelineLine: { flex: 1, width: 1, backgroundColor: c.borderBeige, marginTop: 2 },
    timelineLabel: { fontSize: 13, fontWeight: "600", color: c.textDark, fontFamily: "Inter_600SemiBold" },
    timelineDate: { fontSize: 11, color: c.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },

    mountainsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    mountainTile: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: c.cardBeige, borderRadius: 10, borderWidth: 1, borderColor: c.borderBeige,
      paddingHorizontal: 10, paddingVertical: 7,
    },
    mountainTileTouched: { backgroundColor: c.amber, borderColor: c.amber },
    mountainTileText: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_500Medium" },
    mountainTileTextTouched: { color: "#fff", fontFamily: "Inter_600SemiBold" },
  });
}