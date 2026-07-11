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
import { Ionicons } from "@expo/vector-icons";
import { useData, Module } from "@/contexts/DataContext";
import colors from "@/constants/colors";

const MODULE_PLACEHOLDER_COLORS = ["#4ADE80","#60A5FA","#F472B6","#FB923C","#A78BFA","#34D399","#FBBF24"];
function placeholderColor(index: number) { return MODULE_PLACEHOLDER_COLORS[index % MODULE_PLACEHOLDER_COLORS.length]; }

function ModuleThumbnail({ uri, index, size = 48 }: { uri?: string; index: number; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 10 }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: placeholderColor(index), alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" }}>
        L{index + 1}
      </Text>
    </View>
  );
}

function ModuleCard({ module, index, onPress }: { module: Module; index: number; onPress: () => void }) {
  const pct = module.lessonCount > 0 ? (module.completedLessons / module.lessonCount) * 100 : 0;
  const isStarted = module.completedLessons > 0;
  const isComplete = pct === 100;
  const isLocked = module.isLocked;

  return (
    <TouchableOpacity
      style={[styles.card, isLocked && styles.cardLocked]}
      onPress={onPress}
      activeOpacity={isLocked ? 1 : 0.85}
      disabled={isLocked}
    >
      <View style={styles.cardLeft}>
        <ModuleThumbnail uri={module.imageUrl} index={index} size={48} />
        {(isComplete || isStarted) && (
          <View style={[styles.thumbBadge, { backgroundColor: isComplete ? colors.accentGreen : colors.amber }]}>
            <Text style={styles.thumbBadgeText}>L{module.level}</Text>
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.moduleTitle, isLocked && styles.textLocked]}>{module.title}</Text>
        <Text style={styles.moduleDesc}>{module.description}</Text>
        {!isLocked && (
          <View style={styles.progressRow}>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { width: `${pct}%` }]} />
            </View>
            <Text style={styles.progressText}>
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

const COMING_SOON_PLANS: { key: string; title: string; desc: string; imageUrl?: string }[] = [
  { key: "1", title: "40 Days of Prayer", desc: "A guided journey through prayer disciplines." },
  { key: "2", title: "Marriage & Family", desc: "Building godly homes together." },
  { key: "3", title: "Faith at Work", desc: "Living out your calling in the workplace." },
  { key: "4", title: "New Believer's Path", desc: "The first steps of following Jesus." },
  { key: "5", title: "Spiritual Warfare", desc: "Standing firm against the enemy's schemes." },
  { key: "6", title: "Old Testament Overview", desc: "Tracing God's story from Genesis to Malachi." },
  { key: "7", title: "Missions & Outreach", desc: "Carrying the gospel to the nations." },
  { key: "8", title: "Biblical Generosity", desc: "Stewardship, giving, and contentment." },
];

export default function LearnTab() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { modules, isLoading } = useData();
  const [section, setSection] = useState<"curriculum" | "plans">("curriculum");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const totalLessons = modules.reduce((a, m) => a + m.lessonCount, 0);
  const completedLessons = modules.reduce((a, m) => a + m.completedLessons, 0);
  const overallPct = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
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
              <View style={[styles.overallBarFill, { width: `${overallPct}%` }]} />
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
                  index={index}
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
        <FlatList
          key="plans-grid"
          data={COMING_SOON_PLANS}
          keyExtractor={(p) => p.key}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={[styles.plansList, { paddingBottom: insets.bottom + 100 }]}
          renderItem={({ item, index }) => (
            <View style={styles.planCard}>
              <ModuleThumbnail uri={item.imageUrl} index={index} size={48} />
              <Text style={[styles.planTitle, { marginTop: 10 }]}>{item.title}</Text>
              <Text style={styles.planDesc}>{item.desc}</Text>
              <View style={styles.comingSoonPill}>
                <Text style={styles.comingSoonText}>Coming Soon</Text>
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
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    backgroundColor: colors.lightCream,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderBeige,
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, color: colors.textMuted, marginTop: 2, fontFamily: "Inter_400Regular", marginBottom: 16 },
  segmentRow: {
    flexDirection: "row", backgroundColor: colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: colors.borderBeige, padding: 4, marginBottom: 16,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: "center" },
  segmentBtnActive: { backgroundColor: colors.primaryGreen },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.textMid, fontFamily: "Inter_600SemiBold" },
  segmentTextActive: { color: "#fff" },
  plansList: { paddingHorizontal: 20, paddingTop: 16, gap: 12 },
  planCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.borderBeige, padding: 14, marginBottom: 12,
  },
  planIconWrap: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(29,158,117,0.1)",
    alignItems: "center", justifyContent: "center", marginBottom: 10,
  },
  planTitle: { fontSize: 14, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 4 },
  planDesc: { fontSize: 11, color: colors.textMuted, fontFamily: "Inter_400Regular", lineHeight: 16, marginBottom: 10 },
  comingSoonPill: {
    alignSelf: "flex-start", backgroundColor: "rgba(201,180,138,0.2)",
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
  },
  comingSoonText: { fontSize: 10, fontWeight: "700", color: colors.amber, fontFamily: "Inter_700Bold" },
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
  cardLocked: { opacity: 0.55 },
  textLocked: { color: colors.textMuted },
  cardLeft: { position: "relative" },
  thumbBadge: {
    position: "absolute", bottom: -4, right: -4,
    borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1,
  },
  thumbBadgeText: { fontSize: 9, fontWeight: "700", color: "#fff", fontFamily: "Inter_700Bold" },
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
