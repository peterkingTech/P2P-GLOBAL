import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useData } from "@/contexts/DataContext";
import colors from "@/constants/colors";

export default function ModuleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { modules, lessons } = useData();

  const module = modules.find((m) => m.id === id) ?? modules[0];
  const moduleLessons = lessons
    .filter((l) => l.moduleId === module?.id)
    .sort((a, b) => a.order - b.order);

  const completed = moduleLessons.filter((l) => l.isCompleted).length;
  const pct = moduleLessons.length > 0 ? Math.round((completed / moduleLessons.length) * 100) : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + (Platform.OS === "web" ? 67 : 0) }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.textDark} />
        </TouchableOpacity>
        <Text style={styles.headerLabel}>Module</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Module Info */}
        <View style={styles.infoCard}>
          <View style={styles.levelTag}>
            <Text style={styles.levelTagText}>Level {module?.level ?? 1}</Text>
          </View>
          <Text style={styles.moduleTitle}>{module?.title ?? "Module"}</Text>
          <Text style={styles.moduleDesc}>{module?.description ?? ""}</Text>

          {module?.isLocked ? (
            <View style={styles.lockedBanner}>
              <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
              <Text style={styles.lockedBannerText}>Finish the previous level to unlock this one</Text>
            </View>
          ) : (
            <View style={styles.progressSection}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>{pct}% complete</Text>
                <Text style={styles.progressCount}>{completed}/{moduleLessons.length}</Text>
              </View>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${pct}%` }]} />
              </View>
            </View>
          )}
        </View>

        {/* Lessons */}
        <Text style={styles.sectionTitle}>Lessons</Text>
        <View style={styles.lessonList}>
          {moduleLessons.map((lesson, idx) => {
            const isLocked = lesson.isLocked;
            return (
              <TouchableOpacity
                key={lesson.id}
                style={[styles.lessonRow, isLocked && styles.lessonRowLocked]}
                onPress={() => !isLocked && router.push(`/lesson/${lesson.id}`)}
                activeOpacity={isLocked ? 1 : 0.8}
              >
                <View style={[
                  styles.lessonBullet,
                  lesson.isCompleted && styles.lessonBulletDone,
                  isLocked && styles.lessonBulletLocked,
                ]}>
                  {lesson.isCompleted ? (
                    <Ionicons name="checkmark" size={12} color={colors.cream} />
                  ) : (
                    <Text style={styles.lessonBulletText}>{idx + 1}</Text>
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.lessonTitle, isLocked && styles.lessonTitleLocked]}>
                    {lesson.title}
                  </Text>
                </View>
                {isLocked ? (
                  <Ionicons name="lock-closed" size={16} color={colors.borderBeige} />
                ) : (
                  <Ionicons name="play-circle" size={20} color={lesson.isCompleted ? colors.accentGreen : colors.textMuted} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.lightCream },
  header: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.borderBeige,
  },
  backBtn: { padding: 4 },
  headerLabel: { fontSize: 16, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  content: { paddingHorizontal: 16, paddingTop: 16 },
  infoCard: {
    backgroundColor: colors.card, borderRadius: 18,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 18, marginBottom: 24,
  },
  levelTag: {
    backgroundColor: "rgba(29,158,117,0.12)",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    alignSelf: "flex-start", marginBottom: 10,
  },
  levelTagText: { fontSize: 11, color: colors.accentGreen, fontWeight: "600", fontFamily: "Inter_600SemiBold" },
  moduleTitle: { fontSize: 20, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 6 },
  moduleDesc: { fontSize: 14, color: colors.textMuted, lineHeight: 22, fontFamily: "Inter_400Regular", marginBottom: 16 },
  lockedBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.lightCream, borderRadius: 10,
    padding: 10, borderWidth: 1, borderColor: colors.borderBeige,
  },
  lockedBannerText: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", flex: 1 },
  progressSection: {},
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressLabel: { fontSize: 13, fontWeight: "600", color: colors.primaryGreen, fontFamily: "Inter_600SemiBold" },
  progressCount: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular" },
  progressBg: { height: 8, backgroundColor: colors.progressTrack, borderRadius: 4 },
  progressFill: { height: 8, backgroundColor: colors.progressFill, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: colors.textDark, fontFamily: "Inter_700Bold", marginBottom: 12 },
  lessonList: { gap: 8 },
  lessonRow: {
    backgroundColor: colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderBeige,
    padding: 14, flexDirection: "row", alignItems: "center", gap: 12,
  },
  lessonRowLocked: { opacity: 0.5 },
  lessonBullet: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.borderBeige,
    alignItems: "center", justifyContent: "center",
  },
  lessonBulletDone: { backgroundColor: colors.accentGreen },
  lessonBulletLocked: { backgroundColor: colors.borderBeige },
  lessonBulletText: { fontSize: 12, fontWeight: "700", color: colors.textMid, fontFamily: "Inter_700Bold" },
  lessonTitle: { fontSize: 14, fontWeight: "600", color: colors.textDark, fontFamily: "Inter_600SemiBold" },
  lessonTitleLocked: { color: colors.textMuted },
  lessonDuration: { fontSize: 12, color: colors.textMuted, fontFamily: "Inter_400Regular", marginTop: 2 },
});
