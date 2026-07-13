import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout, MAX_CONTENT_WIDTH } from "@/hooks/useLayout";
import { Ionicons } from "@expo/vector-icons";
import { useData, Module, Plan } from "@/contexts/DataContext";
import { useTheme } from "@/contexts/ThemeContext";
import { AppColors } from "@/constants/themes";

function ModuleThumbnail({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <Image
        source={{ uri }}
        style={[styles.thumb, isLocked && styles.thumbLocked]}
        resizeMode="cover"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <View style={[styles.thumb, styles.thumbPlaceholder, isLocked && styles.thumbLocked]}>
      <Ionicons name="book-outline" size={18} color={isLocked ? colors.borderBeige : colors.accentGreen} />
    </View>
  );
}

function ModuleCard({ module, onPress }: { module: Module; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const pct = module.lessonCount > 0 ? (module.completedLessons / module.lessonCount) * 100 : 0;
  const isStarted = module.completedLessons > 0;
  const isComplete = pct === 100;
  const isLocked = module.isLocked;

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.borderBeige }, isLocked && styles.cardLocked]}
      onPress={onPress}
      activeOpacity={isLocked ? 1 : 0.85}
      disabled={isLocked}
    >
      <View style={styles.cardLeft}>
        <ModuleThumbnail uri={module.imageUrl} isLocked={isLocked} />
        <View style={[styles.levelBadge, { backgroundColor: isLocked ? colors.borderBeige : isComplete ? colors.accentGreen : isStarted ? colors.amber : colors.borderBeige }]}>
          <Text style={[styles.levelText, { color: isComplete || isStarted ? colors.cream : colors.textMuted }]}>
            L{module.level}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.moduleTitle, { color: colors.textDark }, isLocked && { color: colors.textMuted }]}>{module.title}</Text>
        <Text style={[styles.moduleDesc, { color: colors.textMuted }]}>{module.description}</Text>
        {!isLocked && (
          <View style={styles.progressRow}>
            <View style={[styles.progressBg, { backgroundColor: colors.progressTrack }]}>
              <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: colors.progressFill }]} />
            </View>
            <Text style={[styles.progressText, { color: colors.textMuted }]}>
              {module.completedLessons}/{module.lessonCount}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.cardRight}>
        {isLocked ? (
          <Ionicons name="lock-closed" size={18} color={colors.textMuted} />
        ) : isComplete ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

function PlanThumbnail({ uri, isLocked }: { uri?: string; isLocked: boolean }) {
  const { colors } = useTheme();
  const [err, setErr] = useState(false);
  if (uri && !err) {
    return (
      <View style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", flexShrink: 0 }}>
        <Image
          source={{ uri }}
          style={{ width: 64, height: 64, opacity: isLocked ? 0.4 : 1 }}
          resizeMode="cover"
          onError={() => setErr(true)}
        />
        {isLocked && (
          <View style={{
            position: "absolute", inset: 0, alignItems: "center", justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.25)",
          }}>
            <Ionicons name="lock-closed" size={18} color="#fff" />
          </View>
        )}
      </View>
    );
  }
  return (
    <View style={{
      width: 64, height: 64, borderRadius: 12, flexShrink: 0,
      backgroundColor: isLocked ? colors.borderBeige : "rgba(29,158,117,0.08)",
      alignItems: "center", justifyContent: "center",
    }}>
      <Ionicons
        name={isLocked ? "lock-closed" : "book-outline"}
        size={22}
        color={isLocked ? colors.textMuted : colors.accentGreen}
      />
    </View>
  );
}

function PlanCard({ plan, onPress }: { plan: Plan; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const pct = plan.lessonCount > 0 ? (plan.completedLessons / plan.lessonCount) * 100 : 0;
  const isComplete = pct === 100;
  const isLocked = plan.isLocked;
  return (
    <TouchableOpacity
      style={[styles.planCard, isLocked && styles.planCardLocked]}
      onPress={onPress}
      activeOpacity={isLocked ? 1 : 0.85}
      disabled={isLocked}
    >
      <PlanThumbnail uri={plan.imageUrl} isLocked={isLocked} />
      <View style={styles.planCardBody}>
        <Text style={[styles.planTitle, isLocked && { color: colors.textMuted }]}>{plan.title}</Text>
        {isLocked ? (
          <Text style={[styles.planDesc, { fontStyle: "italic" }]}>Complete the previous plan to unlock</Text>
        ) : (
          <>
            <Text style={styles.planDesc} numberOfLines={2}>{plan.description}</Text>
            {plan.lessonCount > 0 && (
              <View style={[styles.progressRow, { marginTop: 6 }]}>
                <View style={[styles.progressBg, { backgroundColor: colors.progressTrack }]}>
                  <View style={[styles.progressFill, { width: `${pct}%` as any, backgroundColor: isComplete ? colors.accentGreen : colors.amber }]} />
                </View>
                <Text style={[styles.progressText, { color: colors.textMuted }]}>
                  {plan.completedLessons}/{plan.lessonCount}
                </Text>
              </View>
            )}
          </>
        )}
      </View>
      {!isLocked && (
        isComplete ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )
      )}
    </TouchableOpacity>
  );
}

function makeStyles(c: AppColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.lightCream },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 16,
      backgroundColor: c.lightCream,
      borderBottomWidth: 1,
      borderBottomColor: c.borderBeige,
    },
    headerTitle: { fontSize: 22, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold" },
    headerSub: { fontSize: 13, color: c.textMuted, marginTop: 2, fontFamily: "Inter_400Regular", marginBottom: 16 },
    segmentRow: {
      flexDirection: "row", backgroundColor: c.card, borderRadius: 12,
      borderWidth: 1, borderColor: c.borderBeige, padding: 4, marginBottom: 16,
    },
    segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
    segmentBtnActive: { backgroundColor: c.primaryGreen },
    segmentText: { fontSize: 13, fontWeight: "600", color: c.textMid, fontFamily: "Inter_600SemiBold" },
    segmentTextActive: { color: "#fff" },
    plansList: { paddingHorizontal: 20, paddingTop: 16 },
    planCard: {
      backgroundColor: c.card, borderRadius: 16,
      borderWidth: 1, borderColor: c.borderBeige, padding: 14, marginBottom: 12,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    planCardLocked: { opacity: 0.55 },
    planIconWrap: {
      width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)",
      alignItems: "center", justifyContent: "center", flexShrink: 0,
    },
    planCardBody: { flex: 1 },
    planTitle: { fontSize: 14, fontWeight: "700", color: c.textDark, fontFamily: "Inter_700Bold", marginBottom: 3 },
    planDesc: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular", lineHeight: 17 },
    comingSoonPill: {
      backgroundColor: "rgba(201,180,138,0.2)", borderRadius: 8,
      paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0,
    },
    comingSoonText: { fontSize: 10, fontWeight: "700", color: c.amber, fontFamily: "Inter_700Bold" },
    overallProgress: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
    overallLeft: {},
    overallLabel: { fontSize: 12, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overallPct: { fontSize: 16, fontWeight: "700", color: c.primaryGreen, fontFamily: "Inter_700Bold" },
    overallCircle: {
      width: 52, height: 52, borderRadius: 26,
      backgroundColor: "rgba(29,158,117,0.12)",
      borderWidth: 2, borderColor: c.accentGreen,
      alignItems: "center", justifyContent: "center",
    },
    overallCircleText: { fontSize: 16, fontWeight: "700", color: c.accentGreen, fontFamily: "Inter_700Bold" },
    overallCircleSub: { fontSize: 9, color: c.textMuted, fontFamily: "Inter_400Regular" },
    overallBarBg: { height: 6, backgroundColor: c.progressTrack, borderRadius: 3 },
    overallBarFill: { height: 6, backgroundColor: c.progressFill, borderRadius: 3 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
    list: { paddingHorizontal: 20, paddingTop: 16 },
    milestoneRow: { alignItems: "flex-start", paddingLeft: 26 },
    milestoneDot: {
      width: 20, height: 20, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
    },
    milestoneLine: {
      width: 2, height: 16,
      backgroundColor: c.borderBeige,
      marginLeft: 35,
    },
    card: {
      borderRadius: 16, borderWidth: 1,
      padding: 14, flexDirection: "row", gap: 12, alignItems: "center",
      marginBottom: 2,
    },
    cardLocked: { opacity: 0.55 },
    cardLeft: { alignItems: "center", gap: 6 },
    thumb: { width: 48, height: 48, borderRadius: 10 },
    thumbLocked: { opacity: 0.4 },
    thumbPlaceholder: { backgroundColor: "rgba(29,158,117,0.08)", alignItems: "center", justifyContent: "center" },
    levelBadge: {
      width: 36, height: 36, borderRadius: 10,
      alignItems: "center", justifyContent: "center",
    },
    levelText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
    cardBody: { flex: 1 },
    moduleTitle: { fontSize: 14, fontWeight: "600", fontFamily: "Inter_600SemiBold", marginBottom: 2 },
    moduleDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressBg: { flex: 1, height: 4, borderRadius: 2 },
    progressFill: { height: 4, borderRadius: 2 },
    progressText: { fontSize: 11, fontFamily: "Inter_400Regular", minWidth: 28 },
    cardRight: {},
  });
}

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules, isLoading, plans, plansLoading } = useData();
  const { colors } = useTheme();
  const [section, setSection] = useState<"curriculum" | "plans">("curriculum");

  const styles = makeStyles(colors);
  const { isTablet } = useLayout();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);
  const completedLessons = modules.reduce((a, m) => a + m.completedLessons, 0);
  const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={isTablet ? { flex: 1, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%' } : { flex: 1 }}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>Learn</Text>
        <Text style={styles.headerSub}>Walk the path, one lesson at a time</Text>

        <View style={styles.segmentRow}>
          <TouchableOpacity
            style={[styles.segmentBtn, section === "curriculum" && styles.segmentBtnActive]}
            onPress={() => setSection("curriculum")}
          >
            <Text style={[styles.segmentText, section === "curriculum" && styles.segmentTextActive]}>Core Curriculum</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, section === "plans" && styles.segmentBtnActive]}
            onPress={() => setSection("plans")}
          >
            <Text style={[styles.segmentText, section === "plans" && styles.segmentTextActive]}>Plans</Text>
          </TouchableOpacity>
        </View>

        {section === "curriculum" && (
          <>
            <View style={styles.overallProgress}>
              <View style={styles.overallLeft}>
                <Text style={styles.overallLabel}>Overall Progress</Text>
                <Text style={styles.overallPct}>{overallPct}% complete</Text>
              </View>
              <View style={styles.overallCircle}>
                <Text style={styles.overallCircleText}>{completedLessons}</Text>
                <Text style={styles.overallCircleSub}>lessons</Text>
              </View>
            </View>
            <View style={styles.overallBarBg}>
              <View style={[styles.overallBarFill, { width: `${overallPct}%` as any }]} />
            </View>
          </>
        )}
      </View>

      {section === "curriculum" ? (
        isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.accentGreen} />
          </View>
        ) : (
          <FlatList
            key="curriculum-list"
            data={modules}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <View>
                {index === 0 && <View style={styles.milestoneLine} />}
                <View style={styles.milestoneRow}>
                  <View style={[styles.milestoneDot, {
                    backgroundColor: item.completedLessons === item.lessonCount
                      ? colors.accentGreen
                      : item.completedLessons > 0 ? colors.amber : colors.borderBeige
                  }]}>
                    {item.completedLessons === item.lessonCount && (
                      <Ionicons name="checkmark" size={10} color={colors.cream} />
                    )}
                  </View>
                </View>
                <ModuleCard
                  module={item}
                  onPress={() => router.push(`/module/${item.id}`)}
                />
                <View style={styles.milestoneLine} />
              </View>
            )}
            contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : (
        plansLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.accentGreen} />
          </View>
        ) : plans.length === 0 ? (
          <View style={styles.loadingContainer}>
            <Ionicons name="radio-outline" size={40} color={colors.textMuted} />
            <Text style={[styles.moduleDesc, { textAlign: "center", marginTop: 12, paddingHorizontal: 40 }]}>
              No plans available yet. Check back soon!
            </Text>
          </View>
        ) : (
          <FlatList
            key="plans-list"
            data={plans}
            keyExtractor={(p) => p.id}
            contentContainerStyle={[styles.plansList, { paddingBottom: insets.bottom + 100 }]}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <PlanCard
                plan={item}
                onPress={() => {
                  if (item.isSingleModule && item.singleModuleId) {
                    router.push(`/module/${item.singleModuleId}`);
                  } else {
                    router.push(`/module/${item.id}`);
                  }
                }}
              />
            )}
          />
        )
      )}
      </View>
    </View>
  );
}
