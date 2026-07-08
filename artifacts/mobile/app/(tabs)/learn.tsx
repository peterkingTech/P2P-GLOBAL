import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData, Module } from "@/contexts/DataContext";
import colors from "@/constants/colors";

function ModuleCard({ module, onPress }: { module: Module; onPress: () => void }) {
  const pct = module.lessonCount > 0 ? (module.completedLessons / module.lessonCount) * 100 : 0;
  const isStarted = module.completedLessons > 0;
  const isComplete = pct === 100;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.cardLeft}>
        <View style={[styles.levelBadge, { backgroundColor: isComplete ? colors.accentGreen : isStarted ? colors.amber : colors.borderBeige }]}>
          <Text style={[styles.levelText, { color: isComplete || isStarted ? colors.cream : colors.textMuted }]}>
            L{module.level}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.moduleTitle}>{module.title}</Text>
        <Text style={styles.moduleDesc}>{module.description}</Text>
        <View style={styles.progressRow}>
          <View style={styles.progressBg}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.progressText}>
            {module.completedLessons}/{module.lessonCount}
          </Text>
        </View>
      </View>
      <View style={styles.cardRight}>
        {isComplete ? (
          <Ionicons name="checkmark-circle" size={22} color={colors.accentGreen} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules, isLoading } = useData();

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);
  const completedLessons = modules.reduce((a, m) => a + m.completedLessons, 0);
  const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={[styles.header, { paddingTop: 20 }]}>
        <Text style={styles.headerTitle}>Module Journey</Text>
        <Text style={styles.headerSub}>Walk the path, one lesson at a time</Text>

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
          <View style={[styles.overallBarFill, { width: `${overallPct}%` }]} />
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={colors.accentGreen} />
        </View>
      ) : (
        <FlatList
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: colors.lightCream,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderBeige,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular", marginBottom: 16 },
  overallProgress: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  overallLeft: {},
  overallLabel: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  overallPct: { fontSize: 16, fontWeight: "700", color: colors.primaryGreen, fontFamily: "Inter_700Bold" },
  overallCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: "rgba(29,158,117,0.12)",
    borderWidth: 2, borderColor: colors.accentGreen,
    alignItems: "center", justifyContent: "center",
  },
  overallCircleText: { fontSize: 16, fontWeight: "700", color: colors.accentGreen, fontFamily: "Inter_700Bold" },
  overallCircleSub: { fontSize: 9, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  overallBarBg: { height: 6, backgroundColor: colors.progressTrack, borderRadius: 3 },
  overallBarFill: { height: 6, backgroundColor: colors.progressFill, borderRadius: 3 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingHorizontal: 20, paddingTop: 16 },
  milestoneRow: { alignItems: "flex-start", paddingLeft: 26 },
  milestoneDot: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  milestoneLine: {
    width: 2, height: 16,
    backgroundColor: colors.borderBeige,
    marginLeft: 35,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", gap: 12, alignItems: "center",
    marginBottom: 2,
  },
  cardLeft: {},
  levelBadge: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },
  levelText: { fontSize: 11, fontWeight: "700", fontFamily: "Inter_700Bold" },
  cardBody: { flex: 1 },
  moduleTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  moduleDesc: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginBottom: 8 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressBg: { flex: 1, height: 4, backgroundColor: colors.progressTrack, borderRadius: 2 },
  progressFill: { height: 4, backgroundColor: colors.progressFill, borderRadius: 2 },
  progressText: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", minWidth: 28 },
  cardRight: {},
});
